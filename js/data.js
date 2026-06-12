/**
 * data.js — 3-layer data pipeline
 * Merge precedence: repo results.json > live openfootball feed > localStorage cache
 *
 * Exports:
 *   loadData()           → Promise<TournamentData>
 *   getPlayedMatches()   → Match[]
 *   getRemainingMatches()→ Match[]
 *   refreshData()        → Promise<TournamentData>
 */

const OPENFOOTBALL_BASE =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026";
const FEED_URL = `${OPENFOOTBALL_BASE}/worldcup.json`;
const REPO_RESULTS_URL = "./data/results.json";
const CACHE_KEY = "wc2026_data_v1";
const CACHE_TS_KEY = "wc2026_data_ts_v1";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---- Name normalization -----------------------------------------------
// Feed name → canonical name used throughout the project.
// Any feed name not in this map AND not already canonical throws loudly.
// Canonical names follow FIFA official names where they differ from common usage.
const FEED_NAME_MAP = {
  // FIFA official names differ from common usage
  "Ivory Coast": "Côte d'Ivoire",
  "Cote d'Ivoire": "Côte d'Ivoire",
  Iran: "IR Iran",
  "South Korea": "Korea Republic",
  // Alternate spellings / openfootball variations
  "United States": "USA",
  "United States of America": "USA",
  Czechia: "Czech Republic",
  "Bosnia and Herzegovina": "Bosnia & Herzegovina",
  "Cape Verde Islands": "Cape Verde",
  "Cabo Verde": "Cape Verde",
  "Congo DR": "DR Congo",
  "Congo, DR": "DR Congo",
  "Democratic Republic of Congo": "DR Congo",
};

// The 48 canonical team names — sourced from openfootball worldcup.groups.json.
// Verified 2026-06-12. Must match elo-seed.json keys.
export const CANONICAL_TEAMS = new Set([
  // Group A
  "Mexico", "South Africa", "Korea Republic", "Czech Republic",
  // Group B
  "Canada", "Bosnia & Herzegovina", "Qatar", "Switzerland",
  // Group C
  "Brazil", "Morocco", "Haiti", "Scotland",
  // Group D
  "USA", "Paraguay", "Australia", "Turkey",
  // Group E
  "Germany", "Curaçao", "Côte d'Ivoire", "Ecuador",
  // Group F
  "Netherlands", "Japan", "Sweden", "Tunisia",
  // Group G
  "Belgium", "Egypt", "IR Iran", "New Zealand",
  // Group H
  "Spain", "Cape Verde", "Saudi Arabia", "Uruguay",
  // Group I
  "France", "Senegal", "Iraq", "Norway",
  // Group J
  "Argentina", "Algeria", "Austria", "Jordan",
  // Group K
  "Portugal", "DR Congo", "Uzbekistan", "Colombia",
  // Group L
  "England", "Croatia", "Ghana", "Panama",
]);

/**
 * Normalize a team name from an external feed to its canonical form.
 * Throws with a loud, actionable error if the name is unknown.
 */
export function normalizeName(rawName) {
  if (!rawName) throw new Error(`normalizeName: received empty name`);
  const trimmed = rawName.trim();
  if (CANONICAL_TEAMS.has(trimmed)) return trimmed;
  const mapped = FEED_NAME_MAP[trimmed];
  if (mapped) {
    if (!CANONICAL_TEAMS.has(mapped)) {
      throw new Error(
        `normalizeName: FEED_NAME_MAP maps "${trimmed}" → "${mapped}" but "${mapped}" is not in CANONICAL_TEAMS. ` +
        `Fix the map or add "${mapped}" to CANONICAL_TEAMS.`
      );
    }
    return mapped;
  }
  throw new Error(
    `normalizeName: unknown team name "${trimmed}". ` +
    `Add it to FEED_NAME_MAP in js/data.js mapping to the canonical name, ` +
    `or add it to CANONICAL_TEAMS if it is a new canonical name.`
  );
}

// ---- Match shape ---------------------------------------------------------
/**
 * @typedef {Object} Score
 * @property {number} ft_home
 * @property {number} ft_away
 * @property {number|null} et_home
 * @property {number|null} et_away
 * @property {string|null} pen_winner  canonical name or null
 */

/**
 * @typedef {Object} Match
 * @property {string} id           unique match identifier
 * @property {string} group        "A"–"L" or "R32"/"R16"/"QF"/"SF"/"3rd"/"Final"
 * @property {string} home         canonical team name
 * @property {string} away         canonical team name
 * @property {string} date         ISO date string
 * @property {string|null} venue   venue id from venues.json
 * @property {Score|null} score    null if unplayed
 */

// ---- Feed parsing --------------------------------------------------------

// Round name → short label used as match.group
const ROUND_LABELS = {
  "Round of 32": "R32",
  "Round of 16": "R16",
  "Quarter-final": "QF",
  "Quarter-finals": "QF",
  "Semi-final": "SF",
  "Semi-finals": "SF",
  "Match for third place": "3rd",
  "Third place": "3rd",
  Final: "Final",
};

// Returns true for placeholder team codes like "W73", "1A", "3A/B/C/D/F", "L101"
function isPlaceholder(name) {
  return /^[0-9WL]/.test(name);
}

function resolveTeamName(raw) {
  const s = (typeof raw === "object" ? raw?.name : raw) || "";
  if (!s || isPlaceholder(s)) return s; // keep placeholder as-is
  return normalizeName(s);
}

function parseScore(raw) {
  if (!raw) return null;
  const ft = raw.ft;
  if (!ft || ft.length < 2) return null;
  return {
    ft_home: ft[0],
    ft_away: ft[1],
    et_home: raw.et ? raw.et[0] : null,
    et_away: raw.et ? raw.et[1] : null,
    pen_winner: null, // resolved in tournament.js from pen data
  };
}

function groupLabel(match) {
  // openfootball 2026: group = "Group A", round = "Matchday 1" / "Round of 32" / …
  const g = match.group;
  if (g) {
    const m = g.match(/Group ([A-L])/i);
    if (m) return m[1];
  }
  const r = match.round || "";
  return ROUND_LABELS[r] || r || "?";
}

function parseFeedMatches(data) {
  const matches = [];
  let matchIdx = 0;

  // openfootball 2026 uses a flat top-level matches array
  const rawMatches = Array.isArray(data.matches)
    ? data.matches
    : (data.groups || []).flatMap((g) => g.matches || []);

  for (const match of rawMatches) {
    const home = resolveTeamName(match.team1);
    const away = resolveTeamName(match.team2);
    const label = groupLabel(match);
    matches.push({
      id: match.num != null ? `m${match.num}` : `${label}_${matchIdx}`,
      group: label,
      home,
      away,
      date: match.date || null,
      time: match.time || null,
      venue: match.ground || match.stadium?.key || match.stadium || null,
      score: parseScore(match.score),
    });
    matchIdx++;
  }

  return matches;
}

// ---- Merge layer ---------------------------------------------------------

/**
 * Merge repo override scores into feed matches.
 * repoResults: array of {id, score} objects from results.json.
 * Repo always wins on conflict.
 */
function mergeResults(feedMatches, repoResults) {
  if (!repoResults || repoResults.length === 0) return feedMatches;
  const overrides = new Map(repoResults.map((r) => [r.id, r.score]));
  return feedMatches.map((m) => {
    if (overrides.has(m.id)) {
      return { ...m, score: overrides.get(m.id) };
    }
    return m;
  });
}

// ---- Fetch helpers -------------------------------------------------------

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

function readCache() {
  try {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || "0", 10);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
  } catch {
    // storage full — silently skip
  }
}

// ---- Public API ----------------------------------------------------------

let _state = null; // {matches: Match[], loadedAt: number}

/**
 * Load tournament data through the 3-layer pipeline.
 * Returns cached in-memory state if already loaded this session.
 */
export async function loadData() {
  if (_state) return _state;
  return refreshData();
}

export async function refreshData() {
  let feedMatches = null;
  let repoResults = [];
  let source = "unknown";

  // Layer 1: try live openfootball feed + repo results.json in parallel
  try {
    const [feedData, repoData] = await Promise.all([
      fetchJSON(FEED_URL),
      fetchJSON(REPO_RESULTS_URL).catch(() => []),
    ]);
    feedMatches = parseFeedMatches(feedData);
    repoResults = Array.isArray(repoData) ? repoData : [];
    source = "live+repo";
  } catch (err) {
    console.warn("Live feed fetch failed:", err.message);
  }

  // Layer 2: fall back to localStorage cache if live failed
  if (!feedMatches) {
    const cached = readCache();
    if (cached) {
      console.warn("Using localStorage cache (live feed unavailable)");
      _state = { ...cached, source: "cache" };
      return _state;
    }
    throw new Error(
      "All data sources failed: live feed unreachable and no localStorage cache. " +
      "Check network and try again."
    );
  }

  const matches = mergeResults(feedMatches, repoResults);
  _state = { matches, loadedAt: Date.now(), source };
  writeCache(_state);
  return _state;
}

/** Matches with a completed score. */
export function getPlayedMatches() {
  if (!_state) throw new Error("Data not loaded — call loadData() first");
  return _state.matches.filter((m) => m.score !== null);
}

/** Matches without a score (not yet played). */
export function getRemainingMatches() {
  if (!_state) throw new Error("Data not loaded — call loadData() first");
  return _state.matches.filter((m) => m.score === null);
}

/** All matches in order. */
export function getAllMatches() {
  if (!_state) throw new Error("Data not loaded — call loadData() first");
  return _state.matches;
}
