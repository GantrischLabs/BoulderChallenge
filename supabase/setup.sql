/*      #########################################################################################################################################################
		Created: 13.11.2026, Marco
		Purpose: Database schema for the Boulder-Challenge web app (seasons, participants, challenges, results and change log in Supabase)
		Description: Holds all competition data incl. archived seasons, so nothing has to be public in data.json any more. Only the shared group login can read or write; anonymous visitors see nothing. Every change is written by triggers into an audit log together with the participant who made it.

		History:
		Date		Who			Change description
		15.11.26	Marco		Read access only with group login; seasons and settings moved from data.json into the database; ping() for keep-alive.
		#########################################################################################################################################################  */

-- Run in the Supabase SQL editor. The script is idempotent and can be run again after changes.


/* ---------------- Tables ---------------- */

CREATE TABLE IF NOT EXISTS public.seasons (
	id				TEXT		PRIMARY KEY,
	-- Season object as in data.json without challenges (name, shortName, start, totalChallenges, archived, participants)
	data			JSONB		NOT NULL,
	changed_by		TEXT		NOT NULL,
	changed_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW()
);

-- Top-level values of data.json, today only currentSeasonId
CREATE TABLE IF NOT EXISTS public.settings (
	key				TEXT		PRIMARY KEY,
	value			JSONB,
	changed_by		TEXT		NOT NULL,
	changed_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.challenges (
	season_id		TEXT		NOT NULL,
	id				TEXT		NOT NULL,
	date			DATE		NOT NULL,
	label			TEXT		NOT NULL DEFAULT '',
	route			TEXT		NOT NULL,
	-- Gym-specific grade scale 4-9, required
	grade			SMALLINT	NOT NULL CHECK (grade BETWEEN 4 AND 9),
	set_by			TEXT		NOT NULL,
	removed_from	DATE,
	notes			TEXT		NOT NULL DEFAULT '',
	-- Participant name chosen in the app; the group shares one login, so this is the only way to see who changed what
	changed_by		TEXT		NOT NULL,
	changed_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW(),
	PRIMARY KEY (season_id, id)
);

CREATE TABLE IF NOT EXISTS public.results (
	season_id		TEXT		NOT NULL,
	challenge_id	TEXT		NOT NULL,
	participant_id	TEXT		NOT NULL,
	status			TEXT		NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'success', 'fail')),
	-- Mirrors "when" in data.json ('', 'live', 'makeup'); WHEN is a reserved word in Postgres
	when_type		TEXT		NOT NULL DEFAULT '',
	changed_by		TEXT		NOT NULL,
	changed_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW(),
	PRIMARY KEY (season_id, challenge_id, participant_id),
	-- ON UPDATE CASCADE: the challenge id is its date, so changing the date in the app moves the results along
	FOREIGN KEY (season_id, challenge_id) REFERENCES public.challenges (season_id, id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.change_log (
	id				BIGINT		GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	changed_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW(),
	changed_by		TEXT,
	table_name		TEXT		NOT NULL,
	action			TEXT		NOT NULL,
	season_id		TEXT,
	challenge_id	TEXT,
	participant_id	TEXT,
	old_data		JSONB,
	new_data		JSONB
);

CREATE INDEX IF NOT EXISTS ix_change_log_changed_at ON public.change_log (changed_at DESC);

-- Grade became required later; upgrades an existing table (fails if a challenge still has no grade)
ALTER TABLE public.challenges ALTER COLUMN grade SET NOT NULL;

-- Added separately so the script also upgrades a database created with the first version (challenges before seasons)
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_challenges_season') THEN
		-- Seasons already referenced by challenges get a placeholder row; the app's import overwrites it with the real data
		INSERT INTO public.seasons (id, data, changed_by)
		SELECT DISTINCT
			c.season_id,
			jsonb_build_object('id', c.season_id, 'name', c.season_id, 'archived', FALSE, 'participants', '[]'::JSONB),
			'setup'
		FROM public.challenges AS c
		ON CONFLICT (id) DO NOTHING;

		ALTER TABLE public.challenges
			ADD CONSTRAINT fk_challenges_season FOREIGN KEY (season_id) REFERENCES public.seasons (id) ON UPDATE CASCADE;
	END IF;
END;
$$;


/* ---------------- Triggers ---------------- */

-- Server time wins over whatever the client sends
CREATE OR REPLACE FUNCTION public.set_changed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.changed_at := NOW();
	RETURN NEW;
END;
$$;

-- SECURITY DEFINER: clients have no insert right on change_log, only this function writes to it
CREATE OR REPLACE FUNCTION public.log_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_row		JSONB;
	v_old		JSONB;
	v_new		JSONB;
BEGIN
	v_old := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
	v_new := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
	v_row := COALESCE(v_new, v_old);

	IF TG_OP = 'UPDATE' THEN
		-- Nothing relevant changed (e.g. the same status saved twice)
		IF (v_old - 'changed_at' - 'changed_by') = (v_new - 'changed_at' - 'changed_by') THEN
			RETURN NEW;
		END IF;

		-- A date change on the challenge cascades into results; that is already logged on the challenge itself
		IF TG_TABLE_NAME = 'results'
			AND (v_old - 'changed_at' - 'changed_by' - 'challenge_id') = (v_new - 'changed_at' - 'changed_by' - 'challenge_id') THEN
			RETURN NEW;
		END IF;
	END IF;

	INSERT INTO public.change_log (
		changed_by,
		table_name,
		action,
		season_id,
		challenge_id,
		participant_id,
		old_data,
		new_data
	)
	VALUES (
		v_row ->> 'changed_by',
		TG_TABLE_NAME,
		TG_OP,
		-- seasons store their own key in "id", challenges and results in "season_id"
		CASE WHEN TG_TABLE_NAME = 'seasons' THEN v_row ->> 'id' ELSE v_row ->> 'season_id' END,
		-- challenges store their own key in "id", results in "challenge_id"
		CASE
			WHEN TG_TABLE_NAME = 'challenges' THEN v_row ->> 'id'
			WHEN TG_TABLE_NAME = 'results' THEN v_row ->> 'challenge_id'
		END,
		v_row ->> 'participant_id',
		v_old,
		v_new
	);

	RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
	v_table		TEXT;
BEGIN
	-- Same two triggers on every data table: server timestamp before, audit log after
	FOREACH v_table IN ARRAY ARRAY['seasons', 'settings', 'challenges', 'results']
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_changed_at ON public.%1$I', v_table);
		EXECUTE format('CREATE TRIGGER trg_%1$s_changed_at BEFORE INSERT OR UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_changed_at()', v_table);
		EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_log ON public.%1$I', v_table);
		EXECUTE format('CREATE TRIGGER trg_%1$s_log AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.log_change()', v_table);
	END LOOP;
END;
$$;


/* ---------------- Access (Row Level Security) ---------------- */

-- TRUE only for a real login (the shared group account); Supabase "anonymous sign-ins" also get the role authenticated and are excluded here
CREATE OR REPLACE FUNCTION public.is_group_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
	SELECT auth.uid() IS NOT NULL
		AND COALESCE((auth.jwt() ->> 'is_anonymous')::BOOLEAN, FALSE) = FALSE;
$$;

DO $$
DECLARE
	v_table		TEXT;
BEGIN
	FOREACH v_table IN ARRAY ARRAY['seasons', 'settings', 'challenges', 'results', 'change_log']
	LOOP
		EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

		-- Anonymous visitors get nothing at all; explicit grants because newer Supabase projects no longer expose new tables automatically
		EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_table);
		EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);

		-- Policies from the first version allowed anon to read; drop them by their old names
		EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$I', v_table);
		EXECUTE format('CREATE POLICY %1$s_read ON public.%1$I FOR SELECT TO authenticated USING (public.is_group_member())', v_table);

		IF v_table <> 'change_log' THEN
			EXECUTE format('GRANT INSERT, UPDATE ON public.%I TO authenticated', v_table);
			-- No DELETE grant: the app never deletes, so a mistake cannot wipe a season
			EXECUTE format('REVOKE DELETE ON public.%I FROM authenticated', v_table);

			EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON public.%1$I', v_table);
			EXECUTE format('CREATE POLICY %1$s_insert ON public.%1$I FOR INSERT TO authenticated WITH CHECK (public.is_group_member())', v_table);
			EXECUTE format('DROP POLICY IF EXISTS %1$s_update ON public.%1$I', v_table);
			EXECUTE format('CREATE POLICY %1$s_update ON public.%1$I FOR UPDATE TO authenticated USING (public.is_group_member()) WITH CHECK (public.is_group_member())', v_table);
		ELSE
			-- The log is written only by the trigger function
			REVOKE INSERT, UPDATE, DELETE ON public.change_log FROM authenticated;
		END IF;
	END LOOP;
END;
$$;


/* ---------------- Keep-alive ---------------- */

-- Free Supabase projects pause after a week without database activity; the GitHub workflow calls this function twice a week without login and gets no data back
CREATE OR REPLACE FUNCTION public.ping()
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
	SELECT 1;
$$;

GRANT EXECUTE ON FUNCTION public.ping() TO anon;
