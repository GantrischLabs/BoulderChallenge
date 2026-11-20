/* ============================================================
   Boulder-Challenge Frontend
   ============================================================ */

/* ---------------- Datums-Helfer ---------------- */

function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function getIsoWeek(dateString) {
  if (!dateString) return null;
  const [y, m, d] = dateString.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function fmtDate(iso) { return iso; }

function fmtDateDE(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y ? `${d}.${m}.${y}` : iso;
}

function statusToIcon(status, when, effectiveImpossible) {
  if (effectiveImpossible) return "🚫";
  if (status === "success") return (when === "makeup" ? "✅⏳" : "✅");
  if (status === "fail") return (when === "makeup" ? "❌⏳" : "❌");
  return "—";
}

function pointsFor(status, effectiveImpossible) {
  if (effectiveImpossible) return 0;
  return status === "success" ? 1 : 0;
}

function computeEffectiveImpossible(challenge, status, now) {
  if (status !== "open") return false;
  if (!challenge.removedFrom) return false;
  const removed = parseISODate(challenge.removedFrom);
  return now >= removed;
}

function byNewestFirst(a, b) { return parseISODate(b.date) - parseISODate(a.date); }
function byOldestFirst(a, b) { return parseISODate(a.date) - parseISODate(b.date); }

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Escaped für HTML-Text und Attribute (Routennamen dürfen " und & enthalten)
function safeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

function getWeekLabel(ch) {
  if (ch.label && String(ch.label).trim()) return String(ch.label).trim();
  const week = getIsoWeek(ch.date);
  if (!week) return "";
  return `KW ${String(week).padStart(2, "0")}`;
}

function getSetterInitial(ch, pidToName) {
  const name = pidToName[ch.setBy] ?? ch.setBy ?? "";
  const c = String(name).trim().charAt(0);
  return c ? c.toUpperCase() : "";
}

/* ---------------- Saisons ---------------- */

const LS_DATA = "kletterliga_data_v2";
const LS_DATA_LEGACY = "kletterliga_data_local";
const SS_SEASON = "kletterliga_season";

function seasonIdFromName(name, start) {
  const m = String(name ?? "").match(/(\d{2})\s*\/\s*(\d{2})/);
  if (m) return `20${m[1]}-${m[2]}`;
  const year = String(start ?? "").slice(0, 4);
  return year || "saison";
}

function shortNameFromName(name) {
  const m = String(name ?? "").match(/\d{2}\s*\/\s*\d{2}/);
  return m ? m[0].replace(/\s+/g, "") : String(name ?? "Saison");
}

// Altes Format (eine Saison direkt auf oberster Ebene) → seasons[].
// Greift für data.json genauso wie für alte localStorage-Stände.
function migrateData(raw) {
  if (!raw || typeof raw !== "object") return { schemaVersion: 2, currentSeasonId: null, seasons: [] };
  if (Array.isArray(raw.seasons)) return raw;

  const legacy = raw.season ?? {};
  const name = legacy.name ?? "Boulder-Challenge";
  const id = seasonIdFromName(name, legacy.start);

  return {
    schemaVersion: 2,
    currentSeasonId: id,
    seasons: [{
      id,
      name,
      shortName: shortNameFromName(name),
      start: legacy.start ?? null,
      totalChallenges: legacy.totalChallenges ?? 0,
      archived: false,
      participants: raw.participants ?? [],
      challenges: raw.challenges ?? []
    }]
  };
}

// Lokaler Stand gewinnt für die Inhalte (Teilnehmer/Challenges),
// data.json gewinnt für die Metadaten (Name, Archiv-Flag, aktuelle Saison).
// So taucht eine neu veröffentlichte Saison auch bei Leuten auf,
// die schon einen lokalen Stand im Browser haben.
// Archivierte Saisons sind abgeschlossen: dort gilt immer data.json.
function mergeLocalIntoRemote(remote, local) {
  if (!local || !Array.isArray(local.seasons)) return remote;

  const localById = new Map(local.seasons.map(s => [s.id, s]));
  const seasons = (remote.seasons ?? []).map(s => {
    const l = localById.get(s.id);
    localById.delete(s.id);
    if (!l || s.archived) return s;
    return {
      ...s,
      participants: l.participants ?? s.participants,
      challenges: l.challenges ?? s.challenges
    };
  });

  // Saisons, die es nur lokal gibt (noch nicht committet), bleiben erhalten
  for (const l of localById.values()) seasons.push(l);

  return { ...remote, seasons };
}

// Neueste zuerst
function getSeasons(doc) {
  return [...(doc?.seasons ?? [])].sort(
    (a, b) => String(b.start ?? b.id).localeCompare(String(a.start ?? a.id))
  );
}

function getActiveSeason(doc) {
  const seasons = doc?.seasons ?? [];
  return seasons.find(s => s.id === window.__SEASON_ID__)
      ?? seasons.find(s => s.id === doc?.currentSeasonId)
      ?? seasons[0]
      ?? null;
}

function activeParticipants() {
  return window.__SEASON__?.participants ?? [];
}

function isArchived() {
  return !!window.__SEASON__?.archived;
}

/* ---------------- Datenbank-Modus ---------------- */

// "lokal":     wie bisher – data.json + localStorage + JSON-Export
// "db":        laufende Saisons aus Supabase, Änderungen direkt gespeichert
// "db-fehler": DB eingerichtet, aber nicht erreichbar → nur Anzeige aus data.json
window.__MODUS__ = "lokal";

function dbModus() { return window.__MODUS__ === "db"; }
function nurAnzeige() { return window.__MODUS__ === "db-fehler"; }

// Archivierte Saison oder DB weg: keine Änderungen möglich
function istGesperrt() { return isArchived() || nurAnzeige(); }

// Im DB-Modus braucht jede Änderung Anmeldung + Namen; sonst Dialog öffnen
function schreibbereit() {
  if (!dbModus()) return true;
  if (BoulderDB.angemeldet() && werGueltig()) return true;
  // Angemeldet, aber noch kein Name gewählt → "Wer bist du?"
  oeffneLogin();
  return false;
}

// URL-Parameter > Auswahl in diesem Tab > aktuelle Saison aus data.json
function resolveInitialSeasonId(doc) {
  const ids = new Set((doc?.seasons ?? []).map(s => s.id));

  const fromUrl = new URLSearchParams(location.search).get("season");
  if (fromUrl && ids.has(fromUrl)) return fromUrl;

  try {
    const fromSession = sessionStorage.getItem(SS_SEASON);
    if (fromSession && ids.has(fromSession)) return fromSession;
  } catch {}

  if (doc?.currentSeasonId && ids.has(doc.currentSeasonId)) return doc.currentSeasonId;
  return (doc?.seasons ?? [])[0]?.id ?? null;
}

function setSeason(id) {
  const doc = window.__DATA__;
  if (!doc || !(doc.seasons ?? []).some(s => s.id === id)) return;

  window.__SEASON_ID__ = id;
  window.__editingChallengeId = null;
  clearDraft();

  try { sessionStorage.setItem(SS_SEASON, id); } catch {}

  // Teilbare Links auf die Archiv-Saison
  const url = new URL(location.href);
  if (id === doc.currentSeasonId) url.searchParams.delete("season");
  else url.searchParams.set("season", id);
  history.replaceState(null, "", url);

  computeAndRenderAll(doc);
}

function renderSeasonSwitcher(doc, activeSeason) {
  const sel = document.getElementById("seasonSelect");
  if (!sel) return;

  const seasons = getSeasons(doc);
  sel.hidden = seasons.length < 2;

  sel.innerHTML = seasons.map(s => {
    const label = `${s.shortName ?? s.name}${s.archived ? " · Archiv" : ""}`;
    const selected = s.id === activeSeason?.id ? " selected" : "";
    return `<option value="${safeText(s.id)}"${selected}>${safeText(label)}</option>`;
  }).join("");

  if (!sel.dataset.wired) {
    sel.dataset.wired = "1";
    sel.addEventListener("change", () => setSeason(sel.value));
  }
}

/* ---------------- Lokaler Speicher ---------------- */

function saveLocal(doc) {
  try { localStorage.setItem(LS_DATA, JSON.stringify(doc)); } catch {}
}

function loadLocalDoc() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) return migrateData(JSON.parse(raw));

    // Einmalige Übernahme eines Standes aus der Zeit vor den Saisons
    const legacy = localStorage.getItem(LS_DATA_LEGACY);
    if (legacy) {
      const migrated = migrateData(JSON.parse(legacy));
      saveLocal(migrated);
      localStorage.removeItem(LS_DATA_LEGACY);
      return migrated;
    }
  } catch {}
  return null;
}

function clearLocal() {
  try {
    localStorage.removeItem(LS_DATA);
    localStorage.removeItem(LS_DATA_LEGACY);
  } catch {}
}

/* ---------------- Personen-Farben ---------------- */

// Feste Palette, auf Unterscheidbarkeit geprüft: der kleinste Abstand
// zweier Farben (OKLab) liegt bei 0.158 – frühere Palette hatte mit
// sky/cyan ein Paar bei 0.067, das auf vielen Displays gleich aussah.
// Die Reihenfolge ist so gewählt, dass auch jede Teilmenge der ersten
// n Farben noch gut auseinanderliegt.
// Alle Werte: Kontrast >= 4.5 gegen den dunklen Grund (#0b0f17).
const PERSON_COLOR_PALETTE = [
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#f472b6", // pink
  "#34d399", // emerald
  "#fbbf24", // amber
  "#a3e635", // lime (Reserve)
  "#fb923c", // orange (Reserve)
  "#e879f9", // fuchsia (Reserve)
];

// Farben werden über alle Saisons hinweg vergeben (älteste zuerst),
// damit dieselbe Person in Archiv und aktueller Saison gleich aussieht.
function buildPersonColorMap(doc) {
  const oldestFirst = [...(doc?.seasons ?? [])].sort(
    (a, b) => String(a.start ?? a.id).localeCompare(String(b.start ?? b.id))
  );

  const map = {};
  let idx = 0;
  for (const season of oldestFirst) {
    for (const p of (season.participants ?? [])) {
      if (map[p.id] === undefined) {
        map[p.id] = PERSON_COLOR_PALETTE[idx % PERSON_COLOR_PALETTE.length];
        idx += 1;
      }
    }
  }
  return map;
}

/* ---------------- Rangliste (Zeilen + Matrix) ---------------- */

function plural(n, one, many) { return n === 1 ? one : many; }

// ▲/▼ gegenüber dem Stand vor der jüngsten Challenge
function renderRankDelta(delta) {
  if (delta === null || delta === undefined) {
    return `<div class="lbDelta lbDeltaEmpty" aria-hidden="true"></div>`;
  }
  if (delta > 0) {
    const t = `${delta} ${plural(delta, "Platz", "Plätze")} gut gemacht`;
    return `<div class="lbDelta lbDeltaUp" title="${safeText(t)}">▲${delta}</div>`;
  }
  if (delta < 0) {
    const n = -delta;
    const t = `${n} ${plural(n, "Platz", "Plätze")} verloren`;
    return `<div class="lbDelta lbDeltaDown" title="${safeText(t)}">▼${n}</div>`;
  }
  return `<div class="lbDelta lbDeltaSame" title="Rang unverändert">–</div>`;
}

// Formkurve: die letzten Challenges als Punkte, jüngste rechts
function renderForm(form) {
  if (!form || !form.length) return `<div class="lbForm"></div>`;

  const dots = form.map((f, idx) => {
    let cls = "lbFormDot";
    if (f.impossible) cls += " dotImpossible";
    else if (f.status === "success") cls += " dotSuccess";
    else if (f.status === "fail") cls += " dotFail";
    else cls += " dotOpen";
    if (f.when === "makeup") cls += " dotMakeup";
    if (idx === form.length - 1) cls += " dotLatest";

    const icon = statusToIcon(f.status, f.when, f.impossible);
    const setter = f.isSetter ? " · selbst definiert" : "";
    const title = `${f.label || fmtDateDE(f.date)}: ${icon}${setter}`;
    return `<span class="${cls}" title="${safeText(title)}"></span>`;
  }).join("");

  return `<div class="lbForm" title="Letzte ${form.length} ${plural(form.length, "Challenge", "Challenges")}">${dots}</div>`;
}

function renderLeaderboardMatrix(leaderboardRows, challengesAsc, participants, pidToName, pidToColor, now) {
  const el = document.getElementById("leaderboard");

  if (!leaderboardRows.length) {
    el.innerHTML = `<p class="muted">Für diese Saison sind noch keine Teilnehmer erfasst.</p>`;
    return;
  }

  const maxPts = Math.max(...leaderboardRows.map(r => r.points), 1);
  const latestId = challengesAsc[challengesAsc.length - 1]?.id;

  // ---- Zeilen-Rangliste ----
  const rowsHtml = leaderboardRows.map((r, idx) => {
    const pct = Math.round((r.points / maxPts) * 100);
    const isFirst = idx === 0;
    const color = pidToColor[r.id] ?? "#38bdf8";
    const initial = String(r.name).trim().charAt(0).toUpperCase();
    return `
      <div class="lbRow${isFirst ? " lbRowFirst" : ""}" style="--pColor:${color}">
        <div class="lbRank">${idx + 1}</div>
        ${renderRankDelta(r.rankDelta)}
        <div class="lbAvatar">${safeText(initial)}</div>
        <div class="lbName">${safeText(r.name)}</div>
        ${renderForm(r.form)}
        <div class="lbBarWrap"><div class="lbBar" style="width:${pct}%"></div></div>
        <div class="lbPts">${r.points} P</div>
        <div class="lbRate" title="${r.successes} von ${r.attempts} Versuchen">${r.successRate !== null ? r.successRate + "\u202f%" : "\u2014"}</div>
        <div class="lbDefined" title="Definierte Challenges">${r.defined}\u00a0def.</div>
      </div>
    `;
  }).join("");

  // ---- Matrix-Header ----
  const headerCells = challengesAsc.map((ch, idx) => {
    const seq = String(idx + 1).padStart(2, "0");
    const initial = getSetterInitial(ch, pidToName);
    const display = `${seq}${initial}`;
    const cls = (ch.id === latestId) ? "weekCell weekCellLatest" : "weekCell";
    const title = `${fmtDate(ch.date)} · ${safeText(ch.route ?? "")}`;
    return `<div class="${cls}" title="${safeText(title)}">${safeText(display)}</div>`;
  }).join("");

  // ---- Matrix-Spielerzeilen ----
  const playersHtml = leaderboardRows.map(r => {
    const color = pidToColor[r.id] ?? "#38bdf8";
    const iconCells = challengesAsc.map(ch => {
      const res = (ch.results ?? {})[r.id] ?? { status: "open", when: "" };
      const status = res.status ?? "open";
      const when = res.when ?? "";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      const icon = statusToIcon(status, when, effectiveImpossible);
      const isSetter = (ch.setBy === r.id);
      let cls = (ch.id === latestId) ? "iconCell weekCellLatest" : "iconCell";
      if (isSetter) cls += " setterIcon";
      return `<div class="${cls}" title="${isSetter ? "Hat diese Challenge definiert" : ""}">${icon}</div>`;
    }).join("");

    return `
      <div class="playerBlock" style="--pColor:${color}">
        <div class="playerNameRow">
          <div class="playerName">${safeText(r.name)}</div>
          <div class="playerBadges">
            <span class="badge badgeAccent">${r.points} P</span>
            <span class="badge" title="${r.successes} von ${r.attempts} Versuchen">✓ ${r.successRate !== null ? r.successRate + " %" : "—"}</span>
            <span class="badge">Def.: ${r.defined}</span>
            <span class="badge">Offen: ${r.openPossible}</span>
            <span class="badge">🚫: ${r.openImpossible}</span>
          </div>
        </div>
        <div class="playerRow">
          <div class="matrixNameCol"></div>
          <div class="matrixScroll" data-matrix-scroll="1">
            <div class="iconRow">${iconCells}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Saisonstart: Teilnehmer stehen schon, Challenges noch nicht
  if (!challengesAsc.length) {
    el.innerHTML = `
      <div class="lbList">${rowsHtml}</div>
      <p class="muted lbEmptyHint">Noch keine Challenges erfasst – die Saison kann losgehen. 🧗</p>
    `;
    return;
  }

  el.innerHTML = `
    <div class="lbList">${rowsHtml}</div>

    <div style="margin-top:14px;">
      <button class="matrixToggle" id="matrixToggleBtn" type="button" aria-expanded="false" aria-controls="matrixWrap">
        <span>Detail-Matrix</span>
        <span class="mtArrow">▾</span>
      </button>
    </div>

    <div class="matrixWrap" id="matrixWrap" hidden>
      <details class="legendDetails">
        <summary>Legende</summary>
        <div class="legend">
          <span>✅ 1P</span><span>❌ 0P</span><span>⏳ nachgeholt</span><span>— offen</span><span>🚫 nicht möglich</span>
          <span class="legendSetter"><span class="legendSwatch"></span> hat Challenge definiert</span>
        </div>
      </details>
      <div class="matrix">
        <div class="matrixHeaderRow">
          <div class="matrixNameCol">Wer</div>
          <div class="matrixScroll" data-matrix-scroll="1">
            <div class="weekRow">${headerCells}</div>
          </div>
        </div>
        <div class="matrixBody">${playersHtml}</div>
      </div>
    </div>
  `;

  const toggleBtn = document.getElementById("matrixToggleBtn");
  const matrixWrap = document.getElementById("matrixWrap");
  toggleBtn.addEventListener("click", () => {
    const isOpen = !matrixWrap.hidden;
    matrixWrap.hidden = isOpen;
    toggleBtn.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) wireMatrixScrollSync();
  });
}

function wireMatrixScrollSync() {
  const scrollers = Array.from(document.querySelectorAll('.matrixScroll[data-matrix-scroll="1"]'));
  let syncing = false;
  scrollers.forEach(sc => {
    sc.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      const x = sc.scrollLeft;
      scrollers.forEach(other => { if (other !== sc) other.scrollLeft = x; });
      syncing = false;
    }, { passive: true });
  });
}

/* ---------------- Challenge Editing (Admin) ---------------- */

window.__editingChallengeId = null;

function startEditChallenge(chId) {
  try {
    const season = window.__SEASON__;
    if (!season || istGesperrt()) return;
    const participants = season.participants ?? [];
    const ch = (season.challenges ?? []).find(c => c.id === chId);
    if (!ch) return;
    window.__editingChallengeId = chId;
    const draft = {
      date: ch.date || "",
      label: ch.label || "",
      route: ch.route || "",
      grade: ch.grade == null ? "" : String(ch.grade),
      setBy: ch.setBy || (participants[0]?.id ?? ""),
      removedFrom: ch.removedFrom || "",
      notes: ch.notes || "",
      results: JSON.parse(JSON.stringify(ch.results || {}))
    };
    for (const p of participants) {
      if (!draft.results[p.id]) draft.results[p.id] = { status: "open", when: "" };
    }
    applyDraftToUi(draft, participants);
    saveDraft(draft);
    const btnAdd = document.getElementById("admAdd");
    if (btnAdd) btnAdd.textContent = "Challenge aktualisieren";
    switchTab("admin");
  } catch (err) {
    console.error(err);
  }
}

function wireChallengeEdit() {
  document.querySelectorAll('.challengeEditBtn').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const chid = btn.getAttribute('data-chid');
      if (chid) startEditChallenge(chid);
    });
  });
}

/* ---------------- Tap-Zyklus auf Ergebnis-Chips ---------------- */

// Zyklus: open → success → success+makeup → fail → fail+makeup → open
function nextStatus(status, when) {
  status = status ?? "open";
  when = when ?? "";
  if (status === "open") return { status: "success", when: "" };
  if (status === "success" && when !== "makeup") return { status: "success", when: "makeup" };
  if (status === "success" && when === "makeup") return { status: "fail", when: "" };
  if (status === "fail" && when !== "makeup") return { status: "fail", when: "makeup" };
  return { status: "open", when: "" };
}

function wireChipTap() {
  document.querySelectorAll('.resultChip[data-chid]').forEach(chip => {
    chip.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const chId = chip.getAttribute('data-chid');
      const pid = chip.getAttribute('data-pid');
      cycleChallengeStatus(chId, pid);
    });
  });
}

function cycleChallengeStatus(chId, pid) {
  const doc = window.__DATA__;
  const season = window.__SEASON__;
  if (!doc || !season || istGesperrt()) return;
  if (!schreibbereit()) return;
  const ch = (season.challenges ?? []).find(c => c.id === chId);
  if (!ch) return;
  ch.results = ch.results ?? {};
  const prev = ch.results[pid] ?? { status: "open", when: "" };

  // Für Undo merken
  window.__lastChipChange = {
    chId, pid,
    prev: { status: prev.status ?? "open", when: prev.when ?? "" }
  };

  const next = nextStatus(prev.status, prev.when);
  ch.results[pid] = next;

  // Persistieren und neu rendern
  if (dbModus()) speichereErgebnisInDb(season.id, chId, pid, next, prev);
  else saveLocal(doc);

  // Feedback
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch {} }
  const participants = season.participants ?? [];
  const pname = (participants.find(p => p.id === pid) || {}).name ?? pid;
  const icon = statusToIcon(next.status, next.when, false);
  showToast(`${pname}: ${icon}`, () => {
    // Undo
    const d = window.__DATA__;
    const s = getActiveSeason(d);
    const c = (s?.challenges ?? []).find(x => x.id === chId);
    if (!c) return;
    const zurueck = window.__lastChipChange.prev;
    const vorUndo = c.results[pid];
    c.results[pid] = zurueck;
    if (dbModus()) speichereErgebnisInDb(s.id, chId, pid, zurueck, vorUndo);
    else saveLocal(d);
    computeAndRenderAll(d);
  });

  computeAndRenderAll(doc);
}

// Optimistisch: die Anzeige ist schon umgeschaltet. Schlägt das
// Speichern fehl, wird der alte Stand wiederhergestellt.
async function speichereErgebnisInDb(seasonId, chId, pid, neu, alt) {
  try {
    await BoulderDB.speichereErgebnis(seasonId, chId, pid, neu);
  } catch (err) {
    console.error(err);
    const s = (window.__DATA__?.seasons ?? []).find(x => x.id === seasonId);
    const c = (s?.challenges ?? []).find(x => x.id === chId);
    if (c && c.results?.[pid] === neu) {
      c.results[pid] = alt;
      computeAndRenderAll(window.__DATA__);
    }
    showToast(`Nicht gespeichert: ${BoulderDB.fehlerText(err)}`);
  }
}

/* ---------------- Toast ---------------- */

let toastTimer = null;

function showToast(msg, undoHandler) {
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");
  const toastUndo = document.getElementById("toastUndo");
  if (!toast || !toastMsg || !toastUndo) return;

  toastMsg.textContent = msg;
  toast.hidden = false;

  // Undo handler frisch setzen (alte Listener entfernen)
  const newBtn = toastUndo.cloneNode(true);
  toastUndo.parentNode.replaceChild(newBtn, toastUndo);
  // Reine Meldungen (z.B. Fehler) ohne Rückgängig-Knopf
  newBtn.hidden = typeof undoHandler !== "function";
  newBtn.addEventListener("click", () => {
    if (typeof undoHandler === "function") undoHandler();
    hideToast();
  });

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3500);
}

function hideToast() {
  const toast = document.getElementById("toast");
  if (toast) toast.hidden = true;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}

/* ---------------- Saison-Fortschritt + Stats ---------------- */

// Erfolgsrate einer ganzen Saison über alle Teilnehmer:
// erfolgreiche / abgeschlossene Versuche, offen und "nicht möglich" zählen nicht.
// Zählt nur Einträge der erfassten Teilnehmer, damit Altlasten im JSON
// (z.B. Ergebnisse von jemandem, der die Saison nicht mitgeht) nichts verfälschen.
function saisonErfolgsrate(season) {
  const ids = (season?.participants ?? []).map(p => p.id);
  let erfolge = 0, versuche = 0;

  for (const ch of (season?.challenges ?? [])) {
    const results = ch.results ?? {};
    for (const id of ids) {
      const status = (results[id] ?? {}).status ?? "open";
      if (status === "success") { erfolge += 1; versuche += 1; }
      else if (status === "fail") { versuche += 1; }
    }
  }

  const rateRoh = versuche > 0 ? (erfolge / versuche) * 100 : null;
  return { erfolge, versuche, rateRoh, rate: rateRoh === null ? null : Math.round(rateRoh) };
}

function renderSeasonHeader(doc, season, allChallenges, leaderboardRows, now) {
  const title = season?.name ?? "Boulder-Challenge";
  document.getElementById("seasonTitle").textContent = title;
  document.title = title;

  const badge = document.getElementById("archiveBadge");
  if (badge) badge.hidden = !season?.archived;

  const totalChallenges = season?.totalChallenges ?? 0;
  const doneChallenges = allChallenges.length;
  const openChallenges = Math.max(0, totalChallenges - doneChallenges);

  const latestDate = [...allChallenges].sort(byNewestFirst)[0]?.date ?? null;
  const seasonMeta = document.getElementById("seasonMeta");

  // Fortschrittsbalken: durchgeführte / geplante Challenges
  const pct = totalChallenges > 0
    ? Math.min(100, Math.round((doneChallenges / totalChallenges) * 100))
    : 0;

  const progressLabel = totalChallenges > 0
    ? `${doneChallenges} von ${totalChallenges} Challenges`
    : `${doneChallenges} Challenges`;

  seasonMeta.textContent = latestDate
    ? `${progressLabel} · Letzte ${fmtDateDE(latestDate)}`
    : progressLabel;

  const fill = document.getElementById("seasonBarFill");
  if (fill) fill.style.width = `${pct}%`;

  // Stat-Strip
  const stripEl = document.getElementById("statStrip");
  if (stripEl) {
    const jetzt = saisonErfolgsrate(season);
    const rateLabel = jetzt.rate === null ? "\u2013" : `${jetzt.rate}\u00a0%`;

    // Dieselbe Rate der Vorsaison als Vergleich
    const vorher = vorherigeSaison(doc, season);
    const vor = vorher ? saisonErfolgsrate(vorher) : null;
    const zeigeVergleich = !!(vor && vor.rate !== null && jetzt.rate !== null);

    const delta = zeigeVergleich ? Math.round(jetzt.rateRoh - vor.rateRoh) : null;
    const vorName = vorher ? (vorher.shortName ?? vorher.name) : "";

    const rateTitel = `${jetzt.erfolge} von ${jetzt.versuche} Versuchen`
      + (zeigeVergleich
          ? ` \u2014 ${vorName}: ${vor.rate} % (${vor.erfolge} von ${vor.versuche})`
            + (delta === 0
                ? ", gleich"
                : `, ${Math.abs(delta)} Prozentpunkte ${delta > 0 ? "besser" : "schlechter"}`)
          : "");

    stripEl.innerHTML = `
      <div class="statCell">
        <div class="statV statAccent">${doneChallenges}</div>
        <div class="statL">Challenges</div>
      </div>
      <div class="statCell">
        <div class="statV" title="${safeText(rateTitel)}">${rateLabel}${zeigeVergleich ? renderDelta(delta) : ""}</div>
        <div class="statL">Erfolgsrate</div>
        ${zeigeVergleich ? `<div class="statVor">${safeText(vorName)}: ${vor.rate}\u00a0%</div>` : ""}
      </div>
      <div class="statCell">
        <div class="statV">${openChallenges}</div>
        <div class="statL">Offen</div>
      </div>
    `;
  }
}

/* ---------------- Rangliste berechnen ---------------- */

// Liefert die sortierte Rangliste für eine Menge von Challenges.
// Wird zweimal aufgerufen: einmal für den aktuellen Stand und einmal
// für den Stand vor der jüngsten Challenge (→ Rangveränderung).
function computeStandings(challenges, participants, now) {
  const stats = Object.fromEntries(participants.map(p => [
    p.id,
    { id: p.id, name: p.name, points: 0, defined: 0, openPossible: 0, openImpossible: 0, successes: 0, attempts: 0 }
  ]));

  for (const ch of challenges) {
    if (ch.setBy && stats[ch.setBy]) stats[ch.setBy].defined += 1;
    const results = ch.results ?? {};
    for (const p of participants) {
      const r = results[p.id] ?? { status: "open", when: "" };
      const status = r.status ?? "open";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      stats[p.id].points += pointsFor(status, effectiveImpossible);
      if (status === "open") {
        if (effectiveImpossible) stats[p.id].openImpossible += 1;
        else stats[p.id].openPossible += 1;
      }
      if (status === "success") { stats[p.id].successes += 1; stats[p.id].attempts += 1; }
      else if (status === "fail") { stats[p.id].attempts += 1; }
    }
  }

  for (const s of Object.values(stats)) {
    s.successRate = s.attempts > 0 ? Math.round((s.successes / s.attempts) * 100) : null;
  }

  return Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    // Bei Gleichstand: höhere Erfolgsrate vorn (null = noch keine Versuche = 0)
    const rateA = a.successRate ?? 0;
    const rateB = b.successRate ?? 0;
    if (rateB !== rateA) return rateB - rateA;
    return a.name.localeCompare(b.name, "de");
  });
}

// Wie viele Challenges die Formkurve zeigt
const FORM_LENGTH = 5;

// Ergänzt jede Zeile um rankDelta (Plätze gut/schlecht seit der
// vorletzten Challenge) und form (die letzten Ergebnisse).
function addTrendInfo(rows, challengesAsc, participants, now) {
  const prevRank = {};
  if (challengesAsc.length >= 2) {
    computeStandings(challengesAsc.slice(0, -1), participants, now)
      .forEach((r, idx) => { prevRank[r.id] = idx + 1; });
  }

  const recent = challengesAsc.slice(-FORM_LENGTH);

  rows.forEach((row, idx) => {
    const before = prevRank[row.id];
    row.rankDelta = before ? before - (idx + 1) : null;

    row.form = recent.map(ch => {
      const r = (ch.results ?? {})[row.id] ?? { status: "open", when: "" };
      const status = r.status ?? "open";
      return {
        status,
        when: r.when ?? "",
        impossible: computeEffectiveImpossible(ch, status, now),
        isSetter: ch.setBy === row.id,
        label: getWeekLabel(ch),
        date: ch.date
      };
    });
  });

  return rows;
}

/* ---------------- Auswertung: Grad-Profil + Saisonvergleich ---------------- */

// Erfolge/Versuche einer Person über eine Menge von Challenges.
// Gleiche Regel wie in der Rangliste: offen und "nicht möglich" zählen nicht.
function bilanz(challenges, pid) {
  let s = 0, a = 0;
  for (const ch of challenges) {
    const status = ((ch.results ?? {})[pid] ?? {}).status ?? "open";
    if (status === "success") { s += 1; a += 1; }
    else if (status === "fail") { a += 1; }
  }
  // rateRoh bleibt ungerundet, damit Differenzen nicht zweimal gerundet werden
  const rateRoh = a > 0 ? (s / a) * 100 : null;
  return { erfolge: s, versuche: a, rateRoh, rate: rateRoh === null ? null : Math.round(rateRoh) };
}

const mitGradVon = season => (season?.challenges ?? []).filter(c => c.grade != null);

// Grad-Profil der laufenden Saison, je Zelle mit dem Wert der Vorsaison
// als Messlatte. Die Vorsaison zählt dabei komplett – sie ist der
// abgeschlossene Bestwert, an dem man sich über die Saison abarbeitet.
function gradProfil(doc, season) {
  const vorher = vorherigeSaison(doc, season);
  const jetztMitGrad = mitGradVon(season);
  const vorherMitGrad = mitGradVon(vorher);

  // Grade beider Saisons, damit die Messlatte auch dort steht,
  // wo dieses Jahr noch nichts erfasst ist
  const grade = [...new Set([
    ...jetztMitGrad.map(c => Number(c.grade)),
    ...vorherMitGrad.map(c => Number(c.grade))
  ])].sort((a, b) => a - b);

  const proGrad = (challenges, g) => challenges.filter(c => Number(c.grade) === g);

  return {
    grade,
    vorsaison: vorher ? (vorher.shortName ?? vorher.name) : null,
    ohneGrad: (season?.challenges ?? []).length - jetztMitGrad.length,
    zeilen: (season?.participants ?? []).map(p => {
      const warDabei = (vorher?.participants ?? []).some(x => x.id === p.id);
      return {
        id: p.id,
        name: p.name,
        zellen: grade.map(g => ({
          grad: g,
          jetzt: bilanz(proGrad(jetztMitGrad, g), p.id),
          vorher: warDabei ? bilanz(proGrad(vorherMitGrad, g), p.id) : null
        })),
        gesamt: (() => {
          const jetzt = bilanz(season?.challenges ?? [], p.id);
          const vor = warDabei ? bilanz(vorher.challenges ?? [], p.id) : null;
          return {
            jetzt,
            vorher: vor,
            // Differenz in Prozentpunkten, aus den ungerundeten Raten
            rateDelta: (vor && jetzt.rateRoh !== null && vor.rateRoh !== null)
              ? Math.round(jetzt.rateRoh - vor.rateRoh)
              : null
          };
        })()
      };
    })
  };
}

// Die Saison davor (nach Startdatum), für den Vergleich
function vorherigeSaison(doc, season) {
  if (!season) return null;
  const aelter = (doc?.seasons ?? [])
    .filter(s => s.id !== season.id && String(s.start ?? "") < String(season.start ?? ""))
    .sort((a, b) => String(b.start ?? "").localeCompare(String(a.start ?? "")));
  return aelter[0] ?? null;
}

// Gleicher Zeitpunkt = gleiche Anzahl Challenges, nicht gleiches Datum.
// Sonst vergleicht man drei Wochen Saison mit einer ganzen Vorsaison.
function saisonVergleich(doc, season) {
  const vorher = vorherigeSaison(doc, season);
  const jetztAlle = [...(season?.challenges ?? [])].sort(byOldestFirst);
  if (!vorher || !jetztAlle.length) return null;

  const vorherAlle = [...(vorher.challenges ?? [])].sort(byOldestFirst);
  if (!vorherAlle.length) return null;

  // Falls die Vorsaison kürzer war, auf deren Länge begrenzen
  const n = Math.min(jetztAlle.length, vorherAlle.length);
  const jetzt = jetztAlle.slice(0, n);
  const damals = vorherAlle.slice(0, n);

  const zeilen = (season?.participants ?? []).map(p => {
    const warDabei = (vorher.participants ?? []).some(x => x.id === p.id);
    const a = bilanz(jetzt, p.id);
    const b = warDabei ? bilanz(damals, p.id) : null;
    return {
      id: p.id,
      name: p.name,
      jetzt: a,
      damals: b,
      punkteDelta: b ? a.erfolge - b.erfolge : null,
      rateDelta: (b && a.rateRoh !== null && b.rateRoh !== null)
        ? Math.round(a.rateRoh - b.rateRoh)
        : null
    };
  });

  return {
    anzahl: n,
    gekuerzt: jetztAlle.length > n,
    vorsaison: vorher.shortName ?? vorher.name,
    zeilen
  };
}

// Team-Punkte: Grad × Anzahl Erfolge, über alle Teilnehmer zusammengezählt.
// Ziel ist das Total der Vorsaison – aber nur von jenen, die auch jetzt
// dabei sind, sonst jagt ein kleineres Team die Punkte eines grösseren.
// Challenges ohne Grad geben keine Punkte.
function teamPunkte(doc, season) {
  const teilnehmer = season?.participants ?? [];
  if (!teilnehmer.length) return null;

  const vorher = vorherigeSaison(doc, season);
  const vorherIds = new Set((vorher?.participants ?? []).map(p => p.id));
  const gemeinsam = teilnehmer.filter(p => vorherIds.has(p.id)).map(p => p.id);
  const neu = teilnehmer.filter(p => !vorherIds.has(p.id)).map(p => p.name);

  const erfolgeVon = (ch, ids) =>
    ids.filter(id => ((ch.results ?? {})[id] ?? {}).status === "success").length;
  const punkteVon = (challenges, ids) =>
    challenges.reduce((sum, ch) => sum + Number(ch.grade) * erfolgeVon(ch, ids), 0);

  const jetztMitGrad = mitGradVon(season);
  const vorherMitGrad = mitGradVon(vorher);
  const alleIds = teilnehmer.map(p => p.id);

  const proPerson = teilnehmer.map(p => ({
    id: p.id,
    name: p.name,
    punkte: punkteVon(jetztMitGrad, [p.id])
  }));
  const punkte = proPerson.reduce((sum, p) => sum + p.punkte, 0);

  // Ohne gemeinsame Teilnehmer gibt es nichts Vergleichbares
  const ziel = (vorher && gemeinsam.length) ? punkteVon(vorherMitGrad, gemeinsam) : null;

  const gespielt = (season?.challenges ?? []).length;
  const offen = Math.max(0, (season?.totalChallenges ?? 0) - gespielt);

  // Erfolge pro Grad, jetzt gegen die ganze Vorsaison
  const grade = [...new Set([...jetztMitGrad, ...vorherMitGrad].map(c => Number(c.grade)))]
    .sort((a, b) => b - a);
  const proGrad = grade.map(g => ({
    grad: g,
    jetzt: jetztMitGrad.filter(c => Number(c.grade) === g)
      .reduce((sum, ch) => sum + erfolgeVon(ch, alleIds), 0),
    vorher: ziel === null ? null : vorherMitGrad.filter(c => Number(c.grade) === g)
      .reduce((sum, ch) => sum + erfolgeVon(ch, gemeinsam), 0)
  })).filter(z => z.jetzt > 0 || (z.vorher ?? 0) > 0);

  return {
    punkte,
    ziel,
    proPerson,
    proGrad,
    gespielt,
    offen,
    vorsaison: vorher ? (vorher.shortName ?? vorher.name) : null,
    neu: ziel === null ? [] : neu,
    ohneGrad: gespielt - jetztMitGrad.length,
    vorherOhneGrad: ziel === null ? 0 : (vorher.challenges ?? []).length - vorherMitGrad.length
  };
}

// Badges: alle aus den vorhandenen Resultaten berechnet, nichts wird gespeichert.
// "wert" ist je nach Badge eine Serie oder eine Anzahl; verdient ist ein Badge
// ab "ab". "zeigeWert" steuert, ob die Zahl immer dasteht (Serien) oder erst
// ab zwei (Anzahl).
const BADGES = [
  { id: "stammgast",  icon: "🎯", name: "Stammgast",    ab: 5, zeigeWert: true,
    regel: "5 Challenges in Folge live dabei, also am Tag selbst und nicht nachgeholt. Die Zahl ist die längste Serie." },
  { id: "lueckenlos", icon: "💯", name: "Lückenlos",    ab: 1, zeigeWert: false,
    regel: "Bei jeder Challenge der Saison live dabei (ab 5 Challenges)." },
  { id: "hattrick",   icon: "🔥", name: "Hattrick",     ab: 3, zeigeWert: true,
    regel: "3 Erfolge in Folge. Die Zahl ist die längste Serie." },
  { id: "alleingang", icon: "🦅", name: "Alleingang",   ab: 1, zeigeWert: false,
    regel: "Als Einzige:r eine Route geschafft, die mindestens 3 versucht haben." },
  { id: "achter",     icon: "💪", name: "8er-Sammler",  ab: 5, zeigeWert: true,
    regel: "5 Routen ab Grad 8 geschafft. Die Zahl ist die Anzahl." },
  { id: "gipfel",     icon: "⛰️", name: "Gipfelstürmer", ab: 1, zeigeWert: false,
    regel: "Eine Route mit Grad 9 geschafft." },
  { id: "uebertroffen", icon: "📈", name: "Übertroffen", ab: 1, zeigeWert: false,
    regel: "Mehr Routen ab Grad 8 geschafft als in der ganzen Vorsaison." },
  { id: "comeback",   icon: "⏳", name: "Comeback",     ab: 1, zeigeWert: false,
    regel: "Eine Route beim Nachholen geschafft." },
  { id: "fair",       icon: "⚖️", name: "Faire Route",  ab: 1, zeigeWert: false,
    regel: "Eigene Route, die etwa die Hälfte geschafft hat (40 bis 60 %, bei mindestens 3 Versuchen)." },
  { id: "unbezwungen", icon: "🧱", name: "Unbezwungen", ab: 1, zeigeWert: false,
    regel: "Eigene Route, die niemand geschafft hat (bei mindestens 3 Versuchen)." },
  { id: "eigentor",   icon: "🙈", name: "Eigentor",     ab: 1, zeigeWert: false,
    regel: "Die eigene Route selbst nicht geschafft." }
];

const TEAM_BADGES = [
  { id: "vollesHaus", icon: "🏠", name: "Volles Haus",
    regel: "Alle waren am Tag selbst dabei." },
  { id: "alleOben",   icon: "🎉", name: "Alle oben",
    regel: "Alle haben die Route geschafft." }
];

function badges(doc, season) {
  const teilnehmer = season?.participants ?? [];
  const challenges = [...(season?.challenges ?? [])].sort(byOldestFirst);
  if (!teilnehmer.length || !challenges.length) return null;

  const res = (ch, id) => (ch.results ?? {})[id] ?? {};
  const versucht = r => r.status === "success" || r.status === "fail";
  // Anwesend ist, wer ein Resultat hat, das nicht nachgeholt wurde
  const live = r => versucht(r) && r.when !== "makeup";
  const abAcht = ch => ch.grade != null && Number(ch.grade) >= 8;

  // Längste Serie; "neutral" überspringt eine Challenge, ohne die Serie zu brechen
  const laengsteSerie = (zaehlt, neutral = () => false) => {
    let beste = 0, lauf = 0;
    for (const ch of challenges) {
      if (neutral(ch)) continue;
      lauf = zaehlt(ch) ? lauf + 1 : 0;
      if (lauf > beste) beste = lauf;
    }
    return beste;
  };

  const ids = teilnehmer.map(p => p.id);
  const proChallenge = new Map(challenges.map(ch => [ch, {
    versuche: ids.filter(id => versucht(res(ch, id))).length,
    erfolge: ids.filter(id => res(ch, id).status === "success").length,
    live: ids.filter(id => live(res(ch, id))).length
  }]));

  const vorher = vorherigeSaison(doc, season);

  const personen = teilnehmer.map(p => {
    const erfolg = ch => res(ch, p.id).status === "success";
    const eigene = challenges.filter(ch => ch.setBy === p.id);
    const achterJetzt = challenges.filter(ch => abAcht(ch) && erfolg(ch)).length;

    const warDabei = (vorher?.participants ?? []).some(x => x.id === p.id);
    const achterVorher = warDabei
      ? (vorher.challenges ?? []).filter(ch => abAcht(ch) && res(ch, p.id).status === "success").length
      : null;

    const werte = {
      stammgast: laengsteSerie(ch => live(res(ch, p.id))),
      lueckenlos: (challenges.length >= 5 && challenges.every(ch => live(res(ch, p.id)))) ? 1 : 0,
      // Noch nicht versuchte Challenges brechen die Erfolgsserie nicht
      hattrick: laengsteSerie(erfolg, ch => !versucht(res(ch, p.id))),
      alleingang: challenges.filter(ch => {
        const c = proChallenge.get(ch);
        return erfolg(ch) && c.erfolge === 1 && c.versuche >= 3;
      }).length,
      achter: achterJetzt,
      gipfel: challenges.filter(ch => Number(ch.grade) === 9 && erfolg(ch)).length,
      uebertroffen: (achterVorher !== null && achterJetzt > achterVorher) ? 1 : 0,
      comeback: challenges.filter(ch => erfolg(ch) && res(ch, p.id).when === "makeup").length,
      fair: eigene.filter(ch => {
        const c = proChallenge.get(ch);
        return c.versuche >= 3 && Math.abs(c.erfolge / c.versuche - 0.5) <= 0.1 + 1e-9;
      }).length,
      unbezwungen: eigene.filter(ch => {
        const c = proChallenge.get(ch);
        return c.versuche >= 3 && c.erfolge === 0;
      }).length,
      eigentor: eigene.filter(ch => res(ch, p.id).status === "fail").length
    };

    return {
      id: p.id,
      name: p.name,
      werte,
      verdient: BADGES.filter(b => werte[b.id] >= b.ab).map(b => ({ ...b, wert: werte[b.id] }))
    };
  });

  const teamWerte = {
    vollesHaus: challenges.filter(ch => proChallenge.get(ch).live === ids.length).length,
    alleOben: challenges.filter(ch => proChallenge.get(ch).erfolge === ids.length).length
  };

  return {
    personen,
    team: TEAM_BADGES.filter(b => teamWerte[b.id] > 0).map(b => ({ ...b, wert: teamWerte[b.id] })),
    teamWerte
  };
}

/* ---------------- Gesamtrender ---------------- */

function computeAndRenderAll(doc) {
  const now = todayUTC();

  const season = getActiveSeason(doc);
  window.__DATA__ = doc;
  window.__SEASON__ = season;
  window.__SEASON_ID__ = season?.id ?? null;

  const allChallenges = season?.challenges ?? [];
  const challengesDesc = [...allChallenges].sort(byNewestFirst);
  const challengesAsc = [...allChallenges].sort(byOldestFirst);

  const participants = season?.participants ?? [];
  const pidToName = Object.fromEntries(participants.map(p => [p.id, p.name]));
  const pidToColor = buildPersonColorMap(doc);
  window.__pidToColor = pidToColor;

  const leaderboard = addTrendInfo(
    computeStandings(allChallenges, participants, now),
    challengesAsc,
    participants,
    now
  );

  const readOnly = !!season?.archived || nurAnzeige();

  renderDbStatus();
  renderSeasonSwitcher(doc, season);
  renderSeasonHeader(doc, season, allChallenges, leaderboard, now);
  renderLeaderboardMatrix(leaderboard, challengesAsc, participants, pidToName, pidToColor, now);
  renderTeamPunkte(doc, season, pidToColor);
  renderBadges(doc, season, pidToColor);
  renderAnalysis(doc, season, pidToColor);
  renderChallenges(challengesDesc, participants, pidToName, pidToColor, now, readOnly);
  renderAdmin(doc, season, participants);
}

/* ---------------- Auswertung rendern ---------------- */

function renderDelta(wert, einheit = "") {
  if (wert === null || wert === undefined) return `<span class="avDelta avDeltaEmpty">·</span>`;
  if (wert > 0) return `<span class="avDelta avDeltaUp">▲${wert}${einheit}</span>`;
  if (wert < 0) return `<span class="avDelta avDeltaDown">▼${-wert}${einheit}</span>`;
  return `<span class="avDelta avDeltaSame">±0</span>`;
}

function renderGradProfil(profil, pidToColor) {
  if (!profil.grade.length) {
    return `<p class="muted">Für diese Saison sind noch keine Schwierigkeitsgrade erfasst.</p>`;
  }

  const kopf = profil.grade.map(g => `<div class="gpHead">${g}</div>`).join("")
    + `<div class="gpHead gpHeadGesamt">Rate</div>`;

  // Eine Zelle: oben der laufende Stand, darunter die Vorsaison als Messlatte
  const zelle = (jetzt, vorher, titelPrefix, extraCls = "") => {
    const messlatte = (vorher && vorher.versuche)
      ? `<span class="gpVor">${vorher.erfolge}/${vorher.versuche}</span>`
      : (profil.vorsaison ? `<span class="gpVor gpVorLeer">·</span>` : "");

    if (!jetzt.versuche) {
      return `
        <div class="gpCell gpCellLeer ${extraCls}" title="${safeText(titelPrefix + ": noch kein Versuch")}">
          <span class="gpTxt">–</span>${messlatte}
        </div>`;
    }

    const titel = titelPrefix
      + `: ${jetzt.erfolge} von ${jetzt.versuche} · ${jetzt.rate} %`
      + ((vorher && vorher.versuche)
          ? ` — ${profil.vorsaison}: ${vorher.erfolge} von ${vorher.versuche} · ${vorher.rate} %`
          : "");

    return `
      <div class="gpCell ${extraCls}" title="${safeText(titel)}">
        <span class="gpFill" style="width:${jetzt.rate}%"></span>
        <span class="gpTxt">${jetzt.erfolge}/${jetzt.versuche}</span>${messlatte}
      </div>`;
  };

  const zeilen = profil.zeilen.map(z => {
    const farbe = pidToColor[z.id] ?? "#38bdf8";
    const zellen = z.zellen.map(c => zelle(c.jetzt, c.vorher, `Grad ${c.grad}`)).join("");

    // Gesamtspalte zeigt die Erfolgsrate statt Erfolge/Versuche
    const g = z.gesamt;
    const rate = g.jetzt.versuche ? `${g.jetzt.rate} %` : "–";
    const rateVor = (g.vorher && g.vorher.versuche)
      ? `${g.vorher.rate} %`
      : (profil.vorsaison ? "·" : "");
    const titelGesamt = `Erfolgsrate gesamt: `
      + (g.jetzt.versuche ? `${g.jetzt.erfolge} von ${g.jetzt.versuche}` : "noch kein Versuch")
      + ((g.vorher && g.vorher.versuche)
          ? ` — ${profil.vorsaison}: ${g.vorher.erfolge} von ${g.vorher.versuche} · ${g.vorher.rate} %`
          : "");

    const deltaTitel = g.rateDelta === null || g.rateDelta === 0
      ? ""
      : ` (${Math.abs(g.rateDelta)} Prozentpunkte ${g.rateDelta > 0 ? "besser" : "schlechter"})`;

    const gesamtZelle = `
      <div class="gpCell gpCellGesamt" title="${safeText(titelGesamt + deltaTitel)}">
        ${g.jetzt.versuche ? `<span class="gpFill" style="width:${g.jetzt.rate}%"></span>` : ""}
        <span class="gpTop">
          <span class="gpTxt">${rate}</span>${g.rateDelta !== null ? renderDelta(g.rateDelta) : ""}
        </span>${rateVor ? `<span class="gpVor">${rateVor}</span>` : ""}
      </div>`;

    return `
      <div class="gpRow" style="--pColor:${farbe}">
        <div class="gpName">${safeText(z.name)}</div>
        ${zellen}${gesamtZelle}
      </div>`;
  }).join("");

  const hinweis = profil.ohneGrad
    ? `<p class="muted avHint">${profil.ohneGrad} ${plural(profil.ohneGrad, "Challenge ohne", "Challenges ohne")} Gradangabe ${plural(profil.ohneGrad, "ist", "sind")} in den Grad-Spalten nicht enthalten.</p>`
    : "";

  return `
    <div class="gpTable">
      <div class="gpRow gpHeadRow">
        <div class="gpName">Grad</div>
        ${kopf}
      </div>
      ${zeilen}
    </div>
    ${hinweis}`;
}

// Punktestand zum selben Zeitpunkt der Vorsaison, als eine Zeile.
// Punkte lassen sich nur bei gleicher Challenge-Zahl fair vergleichen –
// deshalb steht das hier und nicht in der Gesamtspalte der Tabelle.
function renderPunkteZeile(v) {
  const teile = v.zeilen.map(z => {
    const damals = z.damals ? `${z.damals.erfolge}` : "–";
    return `<span class="pvItem"><span class="pvName">${safeText(z.name)}</span>`
         + `<span class="pvJetzt">${z.jetzt.erfolge}</span>`
         + `${renderDelta(z.punkteDelta)}`
         + `<span class="pvDamals">(${damals})</span></span>`;
  }).join("");

  const gekuerzt = v.gekuerzt
    ? ` Die Saison ${safeText(v.vorsaison)} hatte insgesamt nur ${v.anzahl} Challenges.`
    : "";

  return `
    <div class="pvBlock">
      <div class="pvLead">Punkte nach ${v.anzahl} ${plural(v.anzahl, "Challenge", "Challenges")} – in Klammern der Stand von ${safeText(v.vorsaison)} zum selben Zeitpunkt.${gekuerzt}</div>
      <div class="pvRow">${teile}</div>
    </div>`;
}

// Eine Dezimale, aber ohne ",0"
function fmtSchnitt(x) {
  return (Math.round(x * 10) / 10).toLocaleString("de-CH", { maximumFractionDigits: 1 });
}

function renderTeamPunkte(doc, season, pidToColor) {
  const el = document.getElementById("teamPunkte");
  if (!el) return;

  const t = teamPunkte(doc, season);
  // Ohne erfasste Grade gibt es keine Punkte zu zeigen
  if (!t || (season?.challenges ?? []).length === t.ohneGrad) { el.innerHTML = ""; return; }

  const hatZiel = t.ziel !== null && t.ziel > 0;
  const geschafft = hatZiel && t.punkte >= t.ziel;
  // Der Balken reicht bis zum Ziel – oder darüber hinaus, wenn es geknackt ist
  const skala = hatZiel ? Math.max(t.ziel, t.punkte) : t.punkte;

  const segmente = t.proPerson.filter(p => p.punkte > 0).map(p => `
      <span class="tpSeg" style="width:${(p.punkte / skala) * 100}%; --pColor:${pidToColor[p.id] ?? "#38bdf8"}"
            title="${safeText(p.name)}: ${p.punkte}"></span>`).join("");

  const marke = (geschafft && t.punkte > t.ziel)
    ? `<span class="tpMarke" style="left:${(t.ziel / skala) * 100}%" title="${safeText(t.vorsaison)}: ${t.ziel}"></span>`
    : "";

  const legende = t.proPerson.map(p => `
      <span class="tpPerson" style="--pColor:${pidToColor[p.id] ?? "#38bdf8"}">
        <span class="tpDot"></span>${safeText(p.name)} <b>${p.punkte}</b>
      </span>`).join("");

  let stand = "";
  if (hatZiel) {
    if (geschafft) {
      const plus = t.punkte - t.ziel;
      stand = plus > 0
        ? `<b class="tpOk">Ziel geknackt</b> – ${plus} ${plural(plus, "Punkt", "Punkte")} über der Saison ${safeText(t.vorsaison)}.`
        : `<b class="tpOk">Ziel erreicht</b> – gleichauf mit der Saison ${safeText(t.vorsaison)}.`;
    } else {
      const fehlt = t.ziel - t.punkte;
      stand = `Noch <b>${fehlt}</b> ${plural(fehlt, "Punkt", "Punkte")} bis zum Total der Saison ${safeText(t.vorsaison)}.`;
      // Tempo nur zeigen, wenn die Saison eine geplante Länge hat
      if (t.offen > 0 && t.gespielt > 0) {
        stand += ` Bisher Ø ${fmtSchnitt(t.punkte / t.gespielt)} pro Challenge, nötig Ø ${fmtSchnitt(fehlt / t.offen)} in den ${t.offen} offenen.`;
      }
    }
  }

  const gradZeilen = t.proGrad.map(z => {
    // Ohne Ziel gibt es auch pro Grad keine Messlatte
    const vor = hatZiel ? z.vorher : null;
    let status = "";
    let cls = "";
    if (vor !== null) {
      if (z.jetzt > vor) { status = `+${z.jetzt - vor} über Vorsaison`; cls = "tpGradOk"; }
      else if (z.jetzt === vor) { status = "gleichauf"; cls = "tpGradOk"; }
      else { status = `noch ${vor - z.jetzt}`; }
    }
    const max = Math.max(z.jetzt, vor ?? 0, 1);
    return `
      <div class="tpGrad ${cls}">
        <span class="tpGradNr">${z.grad}er</span>
        <span class="tpGradBar"><span style="width:${(z.jetzt / max) * 100}%"></span></span>
        <span class="tpGradZahl"><b>${z.jetzt}</b>${vor !== null ? ` / ${vor}` : ""}</span>
        <span class="tpGradStatus">${status}</span>
      </div>`;
  }).join("");

  const hinweise = [];
  if (t.neu.length) {
    hinweise.push(`${safeText(t.neu.join(", "))} ${plural(t.neu.length, "ist", "sind")} neu dabei und ${plural(t.neu.length, "zählt", "zählen")} mit, im Ziel aber nicht.`);
  }
  if (t.ohneGrad) {
    hinweise.push(`${t.ohneGrad} ${plural(t.ohneGrad, "Challenge", "Challenges")} dieser Saison ohne Grad ${plural(t.ohneGrad, "gibt", "geben")} keine Punkte.`);
  }
  if (t.vorherOhneGrad) {
    hinweise.push(`${t.vorherOhneGrad} ${plural(t.vorherOhneGrad, "Challenge", "Challenges")} der Saison ${safeText(t.vorsaison)} ohne Grad ${plural(t.vorherOhneGrad, "fehlt", "fehlen")} im Ziel.`);
  }

  el.innerHTML = `
    <div class="tpCard${geschafft ? " tpGeschafft" : ""}">
      <div class="tpKopf">
        <span class="tpTitel">Team-Punkte</span>
        <span class="tpZahl"><b>${t.punkte}</b>${hatZiel ? ` / ${t.ziel}` : ""}</span>
      </div>
      <div class="tpBar" role="img" aria-label="${safeText(hatZiel ? `${t.punkte} von ${t.ziel} Team-Punkten` : `${t.punkte} Team-Punkte`)}">${segmente}${marke}</div>
      <div class="tpLegende">${legende}</div>
      ${stand ? `<p class="tpStand">${stand}</p>` : ""}
      ${gradZeilen ? `
      <div class="tpGrade">
        <div class="tpGradeTitel">Geschaffte Routen pro Grad${hatZiel ? ` – gegen die ganze Saison ${safeText(t.vorsaison)}` : ""}</div>
        ${gradZeilen}
      </div>` : ""}
      <p class="muted tpHint">Punkte = Grad × Anzahl Erfolge.${hatZiel ? ` Ziel ist das Total der Saison ${safeText(t.vorsaison)} von denselben Teilnehmern.` : ""} ${hinweise.join(" ")}</p>
    </div>`;
}

function renderBadges(doc, season, pidToColor) {
  const el = document.getElementById("badges");
  if (!el) return;

  const b = badges(doc, season);
  if (!b) { el.innerHTML = ""; return; }

  // Serien zeigen ihre Länge immer, Anzahlen erst ab zwei
  const chip = (x, immerWert) => {
    const zahl = immerWert ? ` <b>${x.wert}</b>` : (x.wert > 1 ? ` <b>×${x.wert}</b>` : "");
    return `<span class="bdChip" title="${safeText(x.regel)}"><span class="bdIcon">${x.icon}</span>${safeText(x.name)}${zahl}</span>`;
  };

  const teamZeile = b.team.length ? `
      <div class="bdRow">
        <div class="bdName bdNameTeam">Team</div>
        <div class="bdChips">${b.team.map(x => chip(x, false)).join("")}</div>
      </div>` : "";

  const zeilen = b.personen.map(p => `
      <div class="bdRow" style="--pColor:${pidToColor[p.id] ?? "#38bdf8"}">
        <div class="bdName">${safeText(p.name)}</div>
        <div class="bdChips">${p.verdient.length
          ? p.verdient.map(x => chip(x, x.zeigeWert)).join("")
          : `<span class="bdLeer">noch keins</span>`}</div>
      </div>`).join("");

  const legende = [...BADGES, ...TEAM_BADGES].map(x => `
        <div class="bdRegel"><span class="bdIcon">${x.icon}</span><span><b>${safeText(x.name)}</b> – ${safeText(x.regel)}</span></div>`).join("");

  // Offen lassen, wenn die Legende vor dem Neuzeichnen offen war
  const warOffen = !!el.querySelector(".bdLegende")?.open;

  el.innerHTML = `
    <div class="tpCard bdCard">
      <div class="tpKopf"><span class="tpTitel">Badges</span></div>
      <div class="bdListe">${zeilen}${teamZeile}</div>
      <details class="bdLegende"${warOffen ? " open" : ""}>
        <summary>Was bedeuten die Badges?</summary>
        <div class="bdRegeln">${legende}</div>
        <p class="muted tpHint">Badges gelten für die gewählte Saison und werden aus den Resultaten berechnet. Ändert sich ein Resultat, ändern sie sich mit.</p>
      </details>
    </div>`;
}

function renderAnalysis(doc, season, pidToColor) {
  const el = document.getElementById("analysis");
  if (!el) return;

  if (!(season?.challenges ?? []).length) { el.innerHTML = ""; return; }

  const profil = gradProfil(doc, season);
  const vergleich = saisonVergleich(doc, season);

  const einleitung = profil.vorsaison
    ? `<p class="avLead">Oben der Stand dieser Saison, darunter blass die Saison ${safeText(profil.vorsaison)} als Messlatte.</p>`
    : "";

  // Bei wenigen Challenges schwanken Prozentwerte stark – das gehört dazugesagt
  const stichprobe = (vergleich && vergleich.anzahl < 5)
    ? `<p class="muted avHint">Erst ${vergleich.anzahl} ${plural(vergleich.anzahl, "Challenge", "Challenges")}: Die Prozentwerte springen noch stark, ein einzelner Versuch verschiebt sie deutlich.</p>`
    : "";

  el.innerHTML = `
    <div style="margin-top:10px;">
      <button class="matrixToggle" id="analysisToggleBtn" type="button" aria-expanded="false" aria-controls="analysisWrap">
        <span>Auswertung</span>
        <span class="mtArrow">▾</span>
      </button>
    </div>
    <div class="matrixWrap" id="analysisWrap" hidden>
      <div class="avBlock">
        <div class="avTitle">Grad-Profil</div>
        ${einleitung}
        ${renderGradProfil(profil, pidToColor)}
        ${vergleich ? renderPunkteZeile(vergleich) : ""}
        ${stichprobe}
      </div>
    </div>`;

  const btn = document.getElementById("analysisToggleBtn");
  const wrap = document.getElementById("analysisWrap");
  btn.addEventListener("click", () => {
    const isOpen = !wrap.hidden;
    wrap.hidden = isOpen;
    btn.setAttribute("aria-expanded", String(!isOpen));
  });
}

/* ---------------- Challenges (Karten) ---------------- */

// Schwierigkeitsgrad (hallen-eigene Skala 4–9); ohne Angabe wird nichts gezeigt
function renderGrade(grade) {
  if (grade == null || grade === "") return "";
  return `<span class="chGrade" title="Schwierigkeitsgrad ${safeText(grade)} (Hallenskala)">${safeText(grade)}</span> `;
}

function renderChallenges(challenges, participants, pidToName, pidToColor, now, readOnly = false) {
  const el = document.getElementById("challenges");

  const asc = [...challenges].sort(byOldestFirst);
  const seqMap = {};
  asc.forEach((c, idx) => { seqMap[c.id] = idx + 1; });

  const cards = challenges.map((ch, idx) => {
    const setByName = pidToName[ch.setBy] ?? ch.setBy ?? "—";
    const setterColor = pidToColor[ch.setBy] ?? "#38bdf8";
    const seq = String(seqMap[ch.id]).padStart(2, "0");
    const kwLabel = ch.label ? safeText(ch.label) : `Nr. ${seq}`;
    const dateFmt = fmtDateDE(ch.date);

    // Tags
    const tags = [];
    if (ch.removedFrom) {
      tags.push(`<span class="chTag">Route entfernt ab ${fmtDateDE(ch.removedFrom)}</span>`);
    }
    if (ch.notes) {
      tags.push(`<span class="chTag chTagAccent">${safeText(ch.notes)}</span>`);
    }
    const tagsHtml = tags.length ? `<div class="chTags">${tags.join("")}</div>` : "";

    const editBtn = readOnly
      ? ""
      : `<button class="challengeEditBtn" data-chid="${safeText(ch.id)}" type="button" title="Bearbeiten">✏️ bearbeiten</button>`;

    // Ergebnis-Chips (tap-fähig)
    const results = ch.results ?? {};
    const chips = participants.map(p => {
      const r = results[p.id] ?? { status: "open", when: "" };
      const status = r.status ?? "open";
      const when = r.when ?? "";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      const icon = statusToIcon(status, when, effectiveImpossible);
      const isSetter = (ch.setBy === p.id);

      let chipCls = "resultChip";
      if (isSetter) chipCls += " rcSetter";
      if (effectiveImpossible) chipCls += " rcImpossible";
      else if (status === "open") chipCls += " rcOpen";
      if (readOnly) chipCls += " rcStatic";

      const setterHint = isSetter ? `${p.name} hat diese Challenge definiert` : p.name;
      const title = readOnly ? setterHint : `${setterHint} – tippen zum Umschalten`;

      // Archivierte Saison: Chips nur noch anzeigen, nicht mehr umschaltbar
      if (readOnly) {
        return `
          <span class="${chipCls}" title="${safeText(title)}">
            <span class="rcIcon">${icon}</span>
            <span class="rcName">${safeText(p.name)}</span>
          </span>
        `;
      }

      return `
        <button type="button" class="${chipCls}" data-chid="${safeText(ch.id)}" data-pid="${safeText(p.id)}" title="${safeText(title)}">
          <span class="rcIcon">${icon}</span>
          <span class="rcName">${safeText(p.name)}</span>
        </button>
      `;
    }).join("");

    // Mini-Dots (eingeklappt)
    const miniDots = participants.map(p => {
      const r = results[p.id] ?? { status: "open", when: "" };
      const status = r.status ?? "open";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      const isSetter = (ch.setBy === p.id);
      let dotCls = "chMiniDot";
      if (effectiveImpossible) dotCls += " dotImpossible";
      else if (status === "success") dotCls += " dotSuccess";
      else if (status === "fail") dotCls += " dotFail";
      else dotCls += " dotOpen";
      if (isSetter) dotCls += " dotSetter";
      return `<span class="${dotCls}" title="${safeText(p.name)}"></span>`;
    }).join("");

    const isOpen = (idx === 0) ? " open" : "";

    return `
      <details class="challengeCard" data-chid="${safeText(ch.id)}" style="--pColor:${setterColor}"${isOpen}>
        <summary class="challengeSummary">
          <div class="challengeKw">${kwLabel}</div>
          <div class="challengeSummaryBody">
            <div class="challengeTitle">${safeText(ch.route ?? "—")}</div>
            <div class="challengeMeta">${renderGrade(ch.grade)}von <span class="setterName">${safeText(setByName)}</span> · ${dateFmt}</div>
          </div>
          <div class="chMiniDots" aria-hidden="true">${miniDots}</div>
          <span class="chChevron" aria-hidden="true">▾</span>
        </summary>
        <div class="challengeBody">
          ${editBtn}
          ${tagsHtml}
          <div class="resultChips">${chips}</div>
        </div>
      </details>
    `;
  }).join("");

  el.innerHTML = cards || `<p class="muted">Noch keine Challenges erfasst.</p>`;
  wireChallengeEdit();
  wireChipTap();
}

/* ---------------- Admin ---------------- */

// Der fest gewählte Name dieses Handys, sofern er zu den Teilnehmern gehört
function eigenerNameUnter(participants) {
  if (!dbModus()) return null;
  const wer = BoulderDB.wer();
  return participants.some(p => p.id === wer) ? wer : null;
}

function emptyDraft(participants) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;
  const week = getIsoWeek(date);
  const label = week ? `KW ${String(week).padStart(2, "0")}` : "";
  return {
    date, label, route: "", grade: "",
    // Vorbelegt mit dem eigenen Namen, im Formular frei änderbar
    setBy: eigenerNameUnter(participants) ?? participants[0]?.id ?? "",
    removedFrom: "", notes: "",
    results: Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]))
  };
}

const ADMIN_FIELD_IDS = ["admDate", "admLabel", "admRoute", "admGrade", "admSetBy", "admRemovedFrom", "admNotes", "admAdd"];

function renderAdmin(doc, season, participants) {
  const archived = !!season?.archived || nurAnzeige();

  const note = document.getElementById("admArchivedNote");
  if (note) {
    note.hidden = !archived;
    note.textContent = nurAnzeige()
      ? `Datenbank nicht erreichbar (${window.__DB_FEHLER__ ?? "unbekannter Fehler"}) – Erfassen ist gerade nicht möglich.`
      : archived
        ? `„${season?.name ?? "Diese Saison"}“ ist archiviert – Bearbeiten ist deaktiviert. Oben auf die laufende Saison wechseln, um Challenges zu erfassen.`
        : "";
  }

  renderAdminModus(season);

  const setBy = document.getElementById("admSetBy");
  if (setBy) setBy.innerHTML = participants.map(p => `<option value="${safeText(p.id)}">${safeText(p.name)}</option>`).join("");

  const draft = loadDraft(participants) ?? emptyDraft(participants);
  applyDraftToUi(draft, participants, archived);

  ADMIN_FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = archived;
  });

  if (!window.__adminWired) {
    wireAdminHandlers();
    window.__adminWired = true;
  }

  updateAdminPreview(doc);
}

function wireAdminHandlers() {
  const elDate = document.getElementById("admDate");
  const elLabel = document.getElementById("admLabel");
  const elRoute = document.getElementById("admRoute");
  const elGrade = document.getElementById("admGrade");
  const elSetBy = document.getElementById("admSetBy");
  const elRemoved = document.getElementById("admRemovedFrom");
  const elNotes = document.getElementById("admNotes");

  const btnAdd = document.getElementById("admAdd");
  const btnCopy = document.getElementById("admCopy");
  const btnDownload = document.getElementById("admDownload");
  const btnReset = document.getElementById("admResetLocal");

  const syncDraft = () => {
    const draft = readDraftFromUi(activeParticipants());
    saveDraft(draft);
    updateAdminPreview(window.__DATA__);
  };

  [elDate, elLabel, elRoute, elGrade, elSetBy, elRemoved, elNotes].forEach(el => {
    if (!el) return;
    el.addEventListener("input", syncDraft);
    el.addEventListener("change", syncDraft);
  });

  if (elDate && elLabel) {
    elDate.addEventListener("change", () => {
      const week = getIsoWeek(elDate.value);
      if (week) elLabel.value = `KW ${String(week).padStart(2, "0")}`;
      syncDraft();
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      clearLocal();
      clearDraft();
      location.reload();
    });
  }

  if (btnAdd) {
    btnAdd.addEventListener("click", async () => {
      const doc = window.__DATA__;
      const season = window.__SEASON__;
      if (!doc || !season || istGesperrt()) return;

      const participants = activeParticipants();
      const draft = readDraftFromUi(participants);

      if (!draft.date || !draft.route || !draft.setBy) {
        alert("Bitte mindestens Datum, Route und 'Definiert von' ausfüllen.");
        return;
      }

      if (dbModus() && !schreibbereit()) return;

      const updatedChallenge = {
        id: draft.date,
        date: draft.date,
        label: draft.label || "",
        route: draft.route,
        grade: draft.grade === "" || draft.grade == null ? null : Number(draft.grade),
        setBy: draft.setBy,
        removedFrom: draft.removedFrom || null,
        notes: draft.notes || "",
        results: draft.results
      };

      // DB-Modus: direkt speichern, danach frisch aus der DB laden
      if (dbModus()) {
        btnAdd.disabled = true;
        try {
          await BoulderDB.speichereChallenge(season.id, updatedChallenge, window.__editingChallengeId);
        } catch (err) {
          console.error(err);
          alert(`Nicht gespeichert: ${BoulderDB.fehlerText(err)}`);
          return;
        } finally {
          btnAdd.disabled = false;
        }
        window.__editingChallengeId = null;
        btnAdd.textContent = "Challenge hinzufügen";
        const fresh = emptyDraft(participants);
        fresh.date = draft.date;
        const w = getIsoWeek(draft.date);
        fresh.label = w ? `KW ${String(w).padStart(2, "0")}` : "";
        fresh.setBy = draft.setBy;
        saveDraft(fresh);
        showToast(`Gespeichert: ${updatedChallenge.route}`);
        await neuLaden();
        return;
      }

      season.challenges = season.challenges ?? [];

      if (window.__editingChallengeId) {
        const idx = season.challenges.findIndex(c => c.id === window.__editingChallengeId);
        if (idx !== -1) season.challenges.splice(idx, 1);
        season.challenges.unshift(updatedChallenge);
        window.__editingChallengeId = null;
        btnAdd.textContent = "Challenge hinzufügen";
      } else {
        season.challenges.unshift(updatedChallenge);
      }

      saveLocal(doc);

      const week = getIsoWeek(draft.date);
      const nextLabel = week ? `KW ${String(week).padStart(2, "0")}` : "";
      const fresh = {
        date: draft.date,
        label: nextLabel,
        route: "",
        grade: "",
        setBy: draft.setBy,
        removedFrom: "",
        notes: "",
        results: Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]))
      };
      saveDraft(fresh);
      applyDraftToUi(fresh, participants);

      computeAndRenderAll(doc);
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener("click", async () => {
      const jsonText = document.getElementById("admJson")?.value ?? "";
      try {
        await navigator.clipboard.writeText(jsonText);
        alert("JSON kopiert. Jetzt in GitHub in data.json einfügen und committen.");
      } catch {
        alert("Kopieren nicht möglich. Bitte Textfeld manuell markieren und kopieren.");
      }
    });
  }

  if (btnDownload) {
    btnDownload.addEventListener("click", () => {
      const jsonText = document.getElementById("admJson")?.value ?? "";
      const blob = new Blob([jsonText], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    });
  }
}

function applyDraftToUi(draft, participants, disabled = false) {
  document.getElementById("admDate").value = draft.date || "";
  document.getElementById("admLabel").value = draft.label || "";
  document.getElementById("admRoute").value = draft.route || "";
  document.getElementById("admGrade").value = draft.grade ?? "";
  document.getElementById("admSetBy").value = draft.setBy || (participants[0]?.id ?? "");
  document.getElementById("admRemovedFrom").value = draft.removedFrom || "";
  document.getElementById("admNotes").value = draft.notes || "";

  const box = document.getElementById("admResults");
  box.innerHTML = participants.map(p => {
    const r = draft.results?.[p.id] ?? { status: "open", when: "" };
    const icon = statusToIcon(r.status, r.when, false);
    return `
      <button class="resultBtn" type="button" data-pid="${safeText(p.id)}"${disabled ? " disabled" : ""}>
        <span>${safeText(p.name)}</span>
        <small>${icon}</small>
      </button>
    `;
  }).join("");

  if (disabled) return;

  box.querySelectorAll(".resultBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-pid");
      const d = readDraftFromUi(participants);
      const cur = d.results[pid] ?? { status: "open", when: "" };
      const nxt = nextStatus(cur.status, cur.when);
      d.results[pid] = nxt;
      saveDraft(d);
      applyDraftToUi(d, participants);
      updateAdminPreview(window.__DATA__);
    });
  });
}

function readDraftFromUi(participants) {
  const date = document.getElementById("admDate").value;
  const label = document.getElementById("admLabel").value.trim();
  const route = document.getElementById("admRoute").value.trim();
  const grade = document.getElementById("admGrade").value;
  const setBy = document.getElementById("admSetBy").value;
  const removedFrom = document.getElementById("admRemovedFrom").value;
  const notes = document.getElementById("admNotes").value.trim();

  const saved = loadDraft(participants);
  const results = saved?.results ?? Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]));
  return { date, label, route, grade, setBy, removedFrom, notes, results };
}

function updateAdminPreview(data) {
  const el = document.getElementById("admJson");
  if (!el) return;
  const d = data ?? window.__DATA__;
  if (!d) return;
  el.value = JSON.stringify(d, null, 2);
}

function loadDraft(participants) {
  try {
    const raw = localStorage.getItem("kletterliga_admin_draft");
    if (!raw) return null;
    const d = JSON.parse(raw);
    d.results = d.results ?? {};
    for (const p of participants) {
      if (!d.results[p.id]) d.results[p.id] = { status: "open", when: "" };
    }
    return d;
  } catch { return null; }
}

function saveDraft(draft) {
  localStorage.setItem("kletterliga_admin_draft", JSON.stringify(draft));
}

function clearDraft() {
  localStorage.removeItem("kletterliga_admin_draft");
}

/* ---------------- Tabs ---------------- */

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tabPanel").forEach(p => {
    p.hidden = (p.id !== `tab-${name}`);
  });
  if (name === "verwaltung") renderVerlauf();
  else window.__letzterTab = name;
  // Nach oben scrollen innerhalb des Tabs
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });
  document.getElementById("verwaltungLink")?.addEventListener("click", () => switchTab("verwaltung"));
  document.getElementById("verwaltungZurueck")?.addEventListener("click", () => switchTab(window.__letzterTab ?? "leaderboard"));
}

/* ---------------- Datenbank: Laden, Anmelden, Protokoll ---------------- */

// Zusätzliche Modi neben "lokal", "db", "db-fehler":
// "db-login": Datenbank eingerichtet, aber nicht angemeldet → nur Anmeldeseite
// "db-leer":  angemeldet, Datenbank noch leer → Übernahme aus data.json anbieten
function leeresDokument() {
  return { schemaVersion: 2, currentSeasonId: null, seasons: [] };
}

// Ohne Datenbank: data.json (+ lokale Änderungen) wie bisher.
// Mit Datenbank: nichts ohne Anmeldung, danach alles aus Supabase.
async function ladeDokument() {
  if (!BoulderDB.konfiguriert) {
    window.__MODUS__ = "lokal";
    const res = await fetch(`data.json?v=${Date.now()}`, { cache: "no-store" });
    const remote = migrateData(await res.json());
    return mergeLocalIntoRemote(remote, loadLocalDoc());
  }

  window.__DB_FEHLER__ = null;

  if (!BoulderDB.aktiv) {
    window.__MODUS__ = "db-fehler";
    window.__DB_FEHLER__ = "Supabase-Bibliothek nicht geladen";
    return leeresDokument();
  }

  if (!BoulderDB.angemeldet()) {
    window.__MODUS__ = "db-login";
    return leeresDokument();
  }

  try {
    const doc = await BoulderDB.ladeAlles();
    // Saisons ohne Teilnehmer sind Platzhalter aus einer älteren Einrichtung
    const leer = !doc.seasons.some(s => (s.participants ?? []).length);
    window.__MODUS__ = leer ? "db-leer" : "db";
    if (leer) window.__JSON_STAND__ = await ladeJsonStand();
    return doc;
  } catch (err) {
    console.error(err);
    if (BoulderDB.istAuthFehler(err)) {
      await BoulderDB.abmelden();
      window.__MODUS__ = "db-login";
    } else {
      window.__MODUS__ = "db-fehler";
      window.__DB_FEHLER__ = BoulderDB.fehlerText(err);
    }
    return leeresDokument();
  }
}

// Quelle für die einmalige Übernahme: data.json + lokale Änderungen
// dieses Browsers. null, wenn data.json schon aus dem Repo entfernt ist.
async function ladeJsonStand() {
  try {
    const res = await fetch(`data.json?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return mergeLocalIntoRemote(migrateData(await res.json()), loadLocalDoc());
  } catch {
    return null;
  }
}

async function neuLaden() {
  const doc = await ladeDokument();
  const ids = new Set(doc.seasons.map(s => s.id));
  if (!ids.has(window.__SEASON_ID__)) window.__SEASON_ID__ = resolveInitialSeasonId(doc);
  zeige(doc);
}

// Anmeldeseite oder normale Ansicht
function zeige(doc) {
  const gesperrt = ["db-login", "db-leer", "db-fehler"].includes(window.__MODUS__);
  document.body.classList.toggle("gesperrt", gesperrt);
  window.__DATA__ = doc;
  if (gesperrt) {
    renderSperre();
    renderDbStatus();
  } else {
    computeAndRenderAll(doc);
  }
}

function renderSperre() {
  const el = document.getElementById("loginGate");
  if (!el) return;

  const titel = document.getElementById("seasonTitle");
  if (titel) titel.textContent = "Boulder-Challenge";
  const meta = document.getElementById("seasonMeta");
  if (meta) meta.textContent = "Privater Wettbewerb";
  const footer = document.getElementById("footerText");
  if (footer) footer.textContent = "Privater Wettbewerb · nur mit Gruppen-Passwort";

  let html;
  if (window.__MODUS__ === "db-login") {
    html = `
      <div class="gateIcon">🔒</div>
      <h2>Privater Wettbewerb</h2>
      <p class="muted">Rangliste und Resultate sind nur mit dem Gruppen-Passwort sichtbar.</p>
      <button class="btnPrimary" type="button" data-aktion="login">Anmelden</button>`;
  } else if (window.__MODUS__ === "db-fehler") {
    html = `
      <div class="gateIcon">⚠️</div>
      <h2>Datenbank nicht erreichbar</h2>
      <p class="muted">${safeText(window.__DB_FEHLER__ ?? "Unbekannter Fehler")}</p>
      <button class="btnPrimary" type="button" data-aktion="neu">Neu versuchen</button>`;
  } else {
    const quelle = window.__JSON_STAND__;
    const saisons = quelle?.seasons ?? [];
    const anzahl = saisons.reduce((n, s) => n + (s.challenges ?? []).length, 0);
    html = quelle && saisons.length
      ? `
      <div class="gateIcon">📦</div>
      <h2>Datenbank ist noch leer</h2>
      <p class="muted">${saisons.length} ${plural(saisons.length, "Saison", "Saisons")} mit ${anzahl} Challenges aus
        <code>data.json</code> übernehmen – inkl. Archiv und lokaler Änderungen in diesem Browser?</p>
      <button class="btnPrimary" type="button" data-aktion="import">Alles übernehmen</button>`
      : `
      <div class="gateIcon">📦</div>
      <h2>Datenbank ist noch leer</h2>
      <p class="muted">Keine <code>data.json</code> gefunden, die übernommen werden könnte.</p>`;
  }
  el.innerHTML = html;

  el.querySelector("[data-aktion=login]")?.addEventListener("click", oeffneLogin);
  el.querySelector("[data-aktion=neu]")?.addEventListener("click", () => neuLaden());
  el.querySelector("[data-aktion=import]")?.addEventListener("click", importiereJsonStand);
}

async function importiereJsonStand() {
  const quelle = window.__JSON_STAND__;
  if (!quelle) return;
  if (!BoulderDB.wer()) { oeffneLogin(); return; }

  const btn = document.querySelector("#loginGate [data-aktion=import]");
  if (btn) btn.disabled = true;
  try {
    await BoulderDB.importiereAlles(quelle);
    showToast("Alles übernommen");
    await neuLaden();
  } catch (err) {
    console.error(err);
    alert(`Übernahme fehlgeschlagen: ${BoulderDB.fehlerText(err)}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function nameVon(pid) {
  const quellen = [window.__DATA__, window.__JSON_STAND__];
  for (const d of quellen) {
    for (const s of (d?.seasons ?? [])) {
      const p = (s.participants ?? []).find(x => x.id === pid);
      if (p) return p.name;
    }
  }
  return pid ?? "?";
}

// Teilnehmer für "Wer bist du?": laufende Saison, bei leerer DB aus data.json
function teilnehmerFuerLogin() {
  const aktiv = activeParticipants();
  if (aktiv.length && window.__MODUS__ === "db") return aktiv;
  const q = window.__JSON_STAND__;
  const s = (q?.seasons ?? []).find(x => x.id === q?.currentSeasonId) ?? (q?.seasons ?? [])[0];
  return s?.participants ?? aktiv;
}

// Der Name ist pro Handy fest. Neu wählen kann man nur, wenn noch keiner
// gesetzt ist oder der gespeicherte nicht mehr zur Saison gehört
// (z.B. neue Saison ohne diese Person).
function werGueltig() {
  const wer = BoulderDB.wer();
  return !!wer && teilnehmerFuerLogin().some(p => p.id === wer);
}

function renderDbStatus() {
  const el = document.getElementById("dbStatus");
  if (!el) return;

  // Ohne DB oder auf der Anmeldeseite braucht es den Knopf nicht
  if (!dbModus()) { el.hidden = true; return; }
  el.hidden = false;
  el.classList.remove("dbStatusFehler");
  el.textContent = werGueltig()
    ? `✎ Erfassen als ${nameVon(BoulderDB.wer())}`
    : "👤 Wer bist du? · Namen wählen";

  if (!el.dataset.wired) {
    el.dataset.wired = "1";
    el.addEventListener("click", oeffneLogin);
  }
}

function oeffneLogin() {
  const dlg = document.getElementById("loginDialog");
  if (!dlg) return;

  const angemeldet = BoulderDB.angemeldet();
  // Schritt 3: Name steht schon fest → nur anzeigen, kein Wechsel
  const fest = angemeldet && werGueltig();
  const participants = teilnehmerFuerLogin();
  const sel = document.getElementById("loginWer");
  sel.innerHTML = `<option value="">– bitte wählen –</option>`
    + participants.map(p => `<option value="${safeText(p.id)}">${safeText(p.name)}</option>`).join("");
  sel.value = "";

  // Schritt 1: nur Passwort (die Namen sind vor der Anmeldung nicht lesbar).
  // Schritt 2: angemeldet → einmalig die Person wählen.
  document.getElementById("loginWerFeld").hidden = !angemeldet || fest;
  document.getElementById("loginPwFeld").hidden = angemeldet;
  document.getElementById("loginPw").value = "";
  document.getElementById("loginTitel").textContent = fest
    ? `Angemeldet als ${nameVon(BoulderDB.wer())}`
    : (angemeldet ? "Wer bist du?" : "Anmelden");
  document.getElementById("loginOk").textContent = angemeldet ? "Übernehmen" : "Anmelden";
  document.getElementById("loginOk").hidden = fest;
  document.getElementById("loginAbbrechen").textContent = fest ? "Schliessen" : "Abbrechen";
  document.getElementById("loginAbmelden").hidden = !angemeldet;
  document.getElementById("loginFehler").hidden = true;
  document.getElementById("loginHinweis").textContent = fest
    ? "Auf diesem Handy wird unter diesem Namen erfasst. Falscher Name? Abmelden und mit dem Gruppen-Passwort neu anmelden."
    : (angemeldet
        ? "Der Name gilt danach fest für dieses Handy und steht bei jeder Änderung im Protokoll."
        : "Dein Name steht bei jeder Änderung im Protokoll.");

  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); }
  else dlg.setAttribute("open", "");
}

function schliesseLogin() {
  const dlg = document.getElementById("loginDialog");
  if (!dlg) return;
  if (typeof dlg.close === "function") dlg.close();
  else dlg.removeAttribute("open");
}

function wireLogin() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  const fehler = msg => {
    const el = document.getElementById("loginFehler");
    el.textContent = msg;
    el.hidden = false;
  };

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const btn = document.getElementById("loginOk");

    // Schritt 1: Passwort
    if (!BoulderDB.angemeldet()) {
      const pw = document.getElementById("loginPw").value;
      if (!pw) { fehler("Bitte das Gruppen-Passwort eingeben."); return; }
      btn.disabled = true;
      try {
        await BoulderDB.anmelden(pw);
      } catch (err) {
        fehler(BoulderDB.fehlerText(err));
        return;
      } finally {
        btn.disabled = false;
      }
      schliesseLogin();
      await neuLaden();
      // Gleich weiter zu Schritt 2, damit jede Änderung einen Namen trägt
      if (!werGueltig() && teilnehmerFuerLogin().length) oeffneLogin();
      return;
    }

    // Schritt 2: Name – nur, solange noch keiner fest ist
    if (werGueltig()) { schliesseLogin(); return; }
    const wer = document.getElementById("loginWer").value;
    if (!wer) { fehler("Bitte wählen, wer du bist."); return; }
    BoulderDB.setzeWer(wer);
    schliesseLogin();
    zeige(window.__DATA__);
  });

  document.getElementById("loginAbbrechen").addEventListener("click", schliesseLogin);

  document.getElementById("loginAbmelden").addEventListener("click", async () => {
    await BoulderDB.abmelden();
    // Neu laden statt neu zeichnen: so bleibt nichts von den Daten im Speicher oder im DOM
    location.reload();
  });
}

// Admin-Tab: Texte und Bereiche je nach Modus
function renderAdminModus(season) {
  const db = dbModus();
  const hinweis = document.getElementById("admModusHinweis");
  if (hinweis) {
    hinweis.innerHTML = db
      ? "Änderungen werden direkt in der Datenbank gespeichert – für alle sofort sichtbar."
      : "Änderungen werden als JSON kopiert (unter Verwaltung ganz unten) und in GitHub in <code>data.json</code> eingefügt.";
  }

  const reset = document.getElementById("admResetLocal");
  if (reset) reset.hidden = db;

  const titel = document.getElementById("admJsonTitel");
  if (titel) titel.textContent = db ? "Backup (alle Daten als JSON)" : "Vorschau (data.json)";
  const tipp = document.getElementById("admJsonTipp");
  if (tipp) {
    tipp.innerHTML = db
      ? "Zum Sichern herunterladen und privat ablegen – nicht ins öffentliche Repo committen."
      : "Tipp: Alles im Textfeld kopieren → GitHub <code>data.json</code> ersetzen → Commit.";
  }

  const footer = document.getElementById("footerText");
  if (footer) {
    footer.innerHTML = db
      ? "Privater Wettbewerb · Daten in der Datenbank, nur mit Gruppen-Passwort"
      : "Privater Wettbewerb · Daten aus <code>data.json</code>";
  }

  renderSaisonVerwaltung();
  renderVerlauf();
}

/* ---------------- Saisons & Teilnehmer pflegen (nur DB) ---------------- */

// Ersetzt das frühere Bearbeiten von data.json in GitHub:
// Saisons, Teilnehmer, Archiv-Flag und aktuelle Saison als JSON.
function saisonMetaJson(doc) {
  return JSON.stringify({
    currentSeasonId: doc?.currentSeasonId ?? null,
    seasons: getSeasons(doc).map(({ challenges, ...meta }) => meta)
  }, null, 2);
}

function renderSaisonVerwaltung() {
  const block = document.getElementById("admSaisonBlock");
  if (!block) return;
  block.hidden = !dbModus();
  if (!dbModus()) return;

  const ta = document.getElementById("admSaisonJson");
  // Nicht überschreiben, während jemand darin tippt
  if (document.activeElement !== ta) ta.value = saisonMetaJson(window.__DATA__);

  const btn = document.getElementById("admSaisonSpeichern");
  if (btn.dataset.wired) return;
  btn.dataset.wired = "1";

  btn.addEventListener("click", async () => {
    if (!schreibbereit()) return;
    let neu;
    try {
      neu = pruefeSaisonJson(JSON.parse(ta.value), window.__DATA__);
    } catch (err) {
      alert(err instanceof SyntaxError ? `Kein gültiges JSON: ${err.message}` : err.message);
      return;
    }
    if (neu.warnung && !confirm(neu.warnung)) return;

    btn.disabled = true;
    try {
      await BoulderDB.speichereSaisons(neu.seasons, neu.currentSeasonId);
      showToast("Saisons gespeichert");
      ta.blur();
      await neuLaden();
    } catch (err) {
      console.error(err);
      alert(`Nicht gespeichert: ${BoulderDB.fehlerText(err)}`);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("admSaisonZuruecksetzen").addEventListener("click", () => {
    ta.value = saisonMetaJson(window.__DATA__);
  });
}

function pruefeSaisonJson(obj, doc) {
  const seasons = obj?.seasons;
  if (!Array.isArray(seasons) || !seasons.length) throw new Error("\"seasons\" muss eine Liste mit mindestens einer Saison sein.");

  const ids = new Set();
  for (const s of seasons) {
    if (!s || typeof s.id !== "string" || !s.id.trim()) throw new Error("Jede Saison braucht eine \"id\".");
    if (ids.has(s.id)) throw new Error(`Saison "${s.id}" kommt doppelt vor.`);
    ids.add(s.id);
    if (typeof s.name !== "string" || !s.name.trim()) throw new Error(`Saison "${s.id}" braucht einen "name".`);
    if (!Array.isArray(s.participants)) throw new Error(`Saison "${s.id}": "participants" muss eine Liste sein.`);
    const pids = new Set();
    for (const p of s.participants) {
      if (!p || typeof p.id !== "string" || !p.id.trim() || typeof p.name !== "string" || !p.name.trim()) {
        throw new Error(`Saison "${s.id}": jeder Teilnehmer braucht "id" und "name".`);
      }
      if (pids.has(p.id)) throw new Error(`Saison "${s.id}": Teilnehmer "${p.id}" kommt doppelt vor.`);
      pids.add(p.id);
    }
  }

  // Saisons hängen an ihren Challenges: nicht löschen, nicht umbenennen
  const fehlend = (doc?.seasons ?? []).filter(s => !ids.has(s.id)).map(s => s.id);
  if (fehlend.length) {
    throw new Error(`Saison ${fehlend.join(", ")} fehlt. Saisons können nicht gelöscht oder umbenannt werden – nur neue dazukommen.`);
  }

  if (obj.currentSeasonId != null && !ids.has(obj.currentSeasonId)) {
    throw new Error(`"currentSeasonId" "${obj.currentSeasonId}" gibt es nicht.`);
  }

  // Teilnehmer mit Resultaten entfernt? Die Resultate bleiben gespeichert, werden aber nicht mehr angezeigt.
  const weg = [];
  for (const alt of (doc?.seasons ?? [])) {
    const neu = seasons.find(s => s.id === alt.id);
    const bleiben = new Set(neu.participants.map(p => p.id));
    const mitResultat = new Set((alt.challenges ?? []).flatMap(c =>
      Object.entries(c.results ?? {}).filter(([, r]) => (r?.status ?? "open") !== "open").map(([pid]) => pid)));
    for (const pid of mitResultat) if (!bleiben.has(pid)) weg.push(`${pid} (${alt.name})`);
  }

  return {
    seasons,
    currentSeasonId: obj.currentSeasonId ?? null,
    warnung: weg.length
      ? `Entfernte Teilnehmer mit Resultaten: ${weg.join(", ")}.\nIhre Resultate bleiben gespeichert, werden aber nicht mehr angezeigt. Trotzdem speichern?`
      : null
  };
}

function fmtZeitpunkt(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Eine Protokollzeile in Klartext
function verlaufText(e) {
  const alt = e.old_data ?? {};
  const neu = e.new_data ?? {};
  const season = (window.__DATA__?.seasons ?? []).find(s => s.id === e.season_id);
  const ch = (season?.challenges ?? []).find(c => c.id === e.challenge_id);
  const chName = ch ? (getWeekLabel(ch) || fmtDateDE(ch.date)) : fmtDateDE(e.challenge_id);

  if (e.table_name === "settings") {
    return e.new_data?.key === "currentSeasonId"
      ? `Aktuelle Saison: ${e.old_data?.value ?? "–"} → ${e.new_data?.value ?? "–"}`
      : `Einstellung ${e.new_data?.key ?? ""} geändert`;
  }

  if (e.table_name === "seasons") {
    const name = neu.data?.name ?? alt.data?.name ?? e.season_id;
    if (e.action === "INSERT") return `Saison „${name}“ angelegt`;
    const a = alt.data ?? {}, n = neu.data ?? {};
    const tn = x => (x.participants ?? []).map(p => p.name).join(", ");
    const diffs = [];
    if (tn(a) !== tn(n)) diffs.push(`Teilnehmer ${tn(a) || "–"} → ${tn(n) || "–"}`);
    if (!!a.archived !== !!n.archived) diffs.push(n.archived ? "archiviert" : "wieder aktiv");
    for (const [k, l] of [["name", "Name"], ["shortName", "Kurzname"], ["start", "Start"], ["totalChallenges", "Anzahl"]]) {
      if (String(a[k] ?? "") !== String(n[k] ?? "")) diffs.push(`${l} ${a[k] ?? "–"} → ${n[k] ?? "–"}`);
    }
    return `Saison „${name}“ geändert: ${diffs.join(", ") || "–"}`;
  }

  if (e.table_name === "results") {
    const icon = r => statusToIcon(r?.status ?? "open", r?.when_type ?? "", false);
    const von = e.action === "INSERT" ? "" : `${icon(alt)} → `;
    return `${chName} · ${nameVon(e.participant_id)}: ${von}${icon(neu)}`;
  }

  if (e.action === "INSERT") return `${chName} erfasst: ${neu.route ?? ""}`;

  const felder = [
    ["route", "Route"], ["date", "Datum"], ["label", "Label"], ["grade", "Grad"],
    ["set_by", "Definiert von"], ["removed_from", "Entfernt ab"], ["notes", "Notiz"]
  ];
  const wert = (k, v) => {
    if (v == null || v === "") return "–";
    if (k === "set_by") return nameVon(v);
    if (k === "date" || k === "removed_from") return fmtDateDE(v);
    return String(v);
  };
  const diffs = felder
    .filter(([k]) => String(alt[k] ?? "") !== String(neu[k] ?? ""))
    .map(([k, l]) => `${l} ${wert(k, alt[k])} → ${wert(k, neu[k])}`);
  return `${chName} geändert: ${diffs.join(", ") || "–"}`;
}

async function renderVerlauf() {
  const block = document.getElementById("admVerlaufBlock");
  const el = document.getElementById("admVerlauf");
  if (!block || !el) return;

  const zeigen = dbModus() && BoulderDB.angemeldet();
  block.hidden = !zeigen;
  if (!zeigen) return;

  // Nur laden, wenn die Verwaltung offen ist – nicht bei jedem Chip-Tipp
  if (document.getElementById("tab-verwaltung")?.hidden) return;

  try {
    // Neu angelegte, noch offene Ergebnisse sind Grundrauschen – weglassen
    const eintraege = (await BoulderDB.ladeVerlauf(80))
      .filter(e => !(e.table_name === "results" && e.action === "INSERT" && (e.new_data?.status ?? "open") === "open"))
      .slice(0, 50);

    el.innerHTML = eintraege.length
      ? eintraege.map(e => `
          <div class="verlaufZeile">
            <span class="verlaufWann">${safeText(fmtZeitpunkt(e.changed_at))}</span>
            <span class="verlaufWer">${safeText(nameVon(e.changed_by))}</span>
            <span class="verlaufWas">${safeText(verlaufText(e))}</span>
          </div>`).join("")
      : `<p class="muted">Noch keine Änderungen.</p>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p class="muted">Protokoll nicht ladbar: ${safeText(BoulderDB.fehlerText(err))}</p>`;
  }
}

/* ---------------- Boot ---------------- */

async function main() {
  wireTabs();
  wireLogin();
  await BoulderDB.init();

  const doc = await ladeDokument();

  window.__SEASON_ID__ = resolveInitialSeasonId(doc);
  zeige(doc);

  // Zurück in die App (z.B. nach dem Bouldern): frischen Stand holen,
  // damit man sieht, was die anderen inzwischen erfasst haben
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (["lokal", "db-login"].includes(window.__MODUS__) || window.__editingChallengeId) return;
    neuLaden().catch(err => console.error(err));
  });
}

main().catch(err => {
  console.error(err);
  const el = document.getElementById("challenges");
  if (el) el.innerHTML = `<p class="muted">Fehler beim Laden der Daten.</p>`;
});
