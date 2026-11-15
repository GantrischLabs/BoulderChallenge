# Datenbank für die Boulder-Challenge (Supabase)

Mit der Datenbank ist die Boulder-Challenge **privat**: Ohne Gruppen-Passwort sieht man nur eine Anmeldeseite. Alle Teilnehmer erfassen ihre Resultate direkt in der App, und jede Änderung wird mit Namen protokolliert.

Solange `config.js` leer ist, läuft die App genau wie bisher mit `data.json`.

## Was wo liegt

Alles liegt in Supabase: Saisons, Teilnehmer, Archiv, Challenges, Resultate und das Änderungsprotokoll. `data.json` braucht es nur noch für die einmalige Übernahme. Danach wird die Datei aus dem Repo gelöscht.

- **Lesen und Schreiben** geht nur mit dem gemeinsamen Gruppen-Passwort. Ohne Anmeldung gibt die Datenbank nichts heraus, auch nicht direkt über die API.
- Nach dem Passwort wählt jeder „Wer bist du?“. Dieser Name steht bei jeder Änderung im Protokoll.
- **Löschen** ist absichtlich gar nicht möglich, auch nicht mit dem Passwort.

> Hinweis: Weil alle dasselbe Passwort nutzen, ist der Name eine Selbstangabe. Unter Freunden reicht das, um nachzuvollziehen, wer was geändert hat. Gegen Fälschung schützt es nicht.

> Die **alten Stände von `data.json`** bleiben in der Git-Historie des öffentlichen Repos auffindbar. Geschützt ist alles, was ab der Umstellung dazukommt.

## Einrichtung (einmalig, ca. 15 Minuten)

1. **Projekt anlegen:** Auf [supabase.com](https://supabase.com) ein Konto erstellen und ein neues Projekt anlegen, z.B. `boulder-challenge`. Als Region eine europäische wählen (Zürich, falls angeboten, sonst Frankfurt). Das Datenbank-Passwort sicher ablegen. Die App braucht es nicht.
2. **Tabellen anlegen:** Im Projekt den **SQL Editor** öffnen, den Inhalt von [`setup.sql`](setup.sql) einfügen und **Run** klicken. Das Skript darf später erneut laufen.
3. **Registrierung sperren (wichtig!):** Unter **Authentication → Sign In / Providers**:
   - *Allow new users to sign up* **aus**. Sonst könnte sich jeder ein eigenes Konto machen und alles lesen.
   - *Allow anonymous sign-ins* **aus** lassen. Die Datenbank sperrt solche Logins zusätzlich.
4. **Gruppen-Konto anlegen:** Unter **Authentication → Users → Add user → Create new user**:
   - E-Mail: eine beliebige Adresse, z.B. Deine eigene mit Zusatz (`du+boulder@…`). Es werden keine Mails verschickt.
   - Passwort: das **Gruppen-Passwort**, das Du den anderen gibst. Wähle ein gutes, die App ist öffentlich erreichbar.
   - *Auto Confirm User* aktivieren.
5. **App verbinden:** Unter **Project Settings → API Keys** die **Project URL** und den **anon / publishable** Key kopieren und in [`config.js`](../config.js) eintragen, dazu die E-Mail des Gruppen-Kontos. Committen.
   - Der anon/publishable Key darf öffentlich sein: Ohne Passwort bekommt man damit nichts. Den **service_role / secret** Key **nie** eintragen.
6. **Daten übernehmen:** App öffnen → mit dem Gruppen-Passwort anmelden → Namen wählen → **Alles übernehmen**.
   - Damit werden alle Saisons inkl. Archiv aus `data.json` kopiert.
   - Am besten auf dem Gerät, auf dem zuletzt erfasst wurde: Lokale, noch nicht committete Änderungen werden mit übernommen.
7. **Prüfen, dann `data.json` löschen:** Kontrollieren, ob Rangliste und Archiv stimmen. Danach `data.json` im Repo löschen und committen.
   - Ab dann steht im Repo nur noch Code.
   - Eine Sicherung gibt es jederzeit unter **Admin → Backup → JSON herunterladen**. Die Datei privat ablegen, nicht ins Repo.
8. **Wach halten:** Gratis-Projekte pausieren nach 7 Tagen ohne Zugriff. Der Workflow [`supabase-wach-halten.yml`](../.github/workflows/supabase-wach-halten.yml) ruft zweimal pro Woche die Funktion `ping()` auf. Sie gibt nur `1` zurück, keine Daten.
   - Unter **Actions** einmal manuell starten (*Run workflow*) und prüfen, ob er grün wird.
   - GitHub schaltet geplante Workflows ab, wenn ein Repo 60 Tage keine Commits hat. Dann kommt eine Mail, und der Workflow lässt sich mit einem Klick wieder einschalten.
   - Falls das Projekt doch pausiert: Im Supabase-Dashboard auf *Restore* klicken. Die Daten bleiben erhalten.

## Saisonwechsel

Unter **Admin → Saisons & Teilnehmer** stehen Saisons, Teilnehmer und `currentSeasonId` als JSON, so wie früher in `data.json`.

1. Bei der alten Saison `"archived": true` setzen.
2. Die neue Saison mit ihren Teilnehmern ergänzen.
3. `currentSeasonId` auf die neue Saison stellen.
4. **Saisons speichern.**

Saisons lassen sich nicht löschen oder umbenennen (`id`), nur ergänzen und ändern. Wird ein Teilnehmer mit Resultaten entfernt, fragt die App nach. Seine Resultate bleiben gespeichert, werden aber nicht mehr angezeigt.

## Protokoll ansehen

- In der App: **Admin → Änderungsprotokoll** (letzte 50 Einträge, inkl. Saison-Änderungen).
- Vollständig: Supabase → **Table Editor → change_log**. Dort steht pro Änderung der alte und der neue Wert als JSON.
