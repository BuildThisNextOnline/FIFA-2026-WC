/**
 * tournament.js — Group standings, FIFA tiebreaker cascade, third-place ranking
 * and R32 slot assignment for WC2026.
 *
 * FIFA 2026 tiebreaker order (group stage and third-place cross-group ranking):
 *   1. Points
 *   2. Goal difference (all group matches)
 *   3. Goals scored (all group matches)
 *   4. Head-to-head points     (among tied teams only; not used for cross-group 3rd-place)
 *   5. Head-to-head GD
 *   6. Head-to-head goals scored
 *   7. Fair play (omitted — use drawing of lots)
 *   8. Drawing of lots (seeded RNG)
 *
 * Third-place slot assignment:
 *   Encoded from openfootball R32 fixture data (fetched 2026-06-12).
 *   Uses bipartite matching (augmenting paths) to find a valid assignment
 *   for any combination of 8 qualifying groups.
 */

// ---- Third-place slot table (from openfootball R32 fixture list) ---------
// Each entry: { matchId, opponent (group winner), eligible groups }
// Source: fetched 2026-06-12 from openfootball/worldcup.json master/2026

export const THIRD_PLACE_SLOTS = [
  { matchId: "R32-02", opponent: "1E", eligible: ["A","B","C","D","F"] },
  { matchId: "R32-05", opponent: "1I", eligible: ["C","D","F","G","H"] },
  { matchId: "R32-07", opponent: "1A", eligible: ["C","E","F","H","I"] },
  { matchId: "R32-08", opponent: "1L", eligible: ["E","H","I","J","K"] },
  { matchId: "R32-09", opponent: "1D", eligible: ["B","E","F","I","J"] },
  { matchId: "R32-10", opponent: "1G", eligible: ["A","E","H","I","J"] },
  { matchId: "R32-13", opponent: "1B", eligible: ["E","F","G","I","J"] },
  { matchId: "R32-15", opponent: "1K", eligible: ["D","E","I","J","L"] },
];

// ---- Exported constants --------------------------------------------------

export const TIEBREAKER_STAGES = ["points","gd","gf","h2h_points","h2h_gd","h2h_gf","random"];

// ---- Internal stat helpers -----------------------------------------------

function computeStats(team, matches) {
  let played = 0, won = 0, drawn = 0, lost = 0, gf = 0, ga = 0;
  for (const m of matches) {
    if (!m.score) continue;
    const isHome = m.home === team;
    const isAway = m.away === team;
    if (!isHome && !isAway) continue;
    played++;
    const tg = isHome ? m.score.ft_home : m.score.ft_away;
    const og = isHome ? m.score.ft_away : m.score.ft_home;
    gf += tg; ga += og;
    if (tg > og) won++;
    else if (tg === og) drawn++;
    else lost++;
  }
  return { team, played, won, drawn, lost, gf, ga, gd: gf - ga, points: 3 * won + drawn };
}

/**
 * Build group standings from match results.
 * Returns an unsorted array of team stat objects.
 */
export function buildGroupStanding(groupLabel, teams, allMatches) {
  const groupMatches = allMatches.filter(
    m => m.group === groupLabel && m.score !== null
  );
  return teams.map(t => computeStats(t, groupMatches));
}

// ---- Tiebreaker cascade --------------------------------------------------

/**
 * Compare two stat objects using a chain of criteria.
 * criteria: array of functions t → number (higher = better).
 * Returns negative if a > b, positive if b > a, 0 if equal.
 */
function cascadeCompare(a, b, criteria) {
  for (const fn of criteria) {
    const d = fn(b) - fn(a); // descending: higher is better
    if (d !== 0) return d;
  }
  return 0;
}

/** Partition an array into groups of equal elements (using a comparator). */
function tiedGroups(items, cmp) {
  if (items.length === 0) return [];
  const groups = [[items[0]]];
  for (let i = 1; i < items.length; i++) {
    if (cmp(items[i - 1], items[i]) === 0) {
      groups[groups.length - 1].push(items[i]);
    } else {
      groups.push([items[i]]);
    }
  }
  return groups;
}

/**
 * Compute H2H stats for a subset of teams using only matches between those teams.
 */
function h2hStats(teams, allGroupMatches) {
  const teamSet = new Set(teams.map(t => t.team));
  const h2hMatches = allGroupMatches.filter(
    m => m.score && teamSet.has(m.home) && teamSet.has(m.away)
  );
  return teams.map(t => ({
    ...t,
    ...computeStats(t.team, h2hMatches),
  }));
}

/**
 * Sort a list of tied teams using the full cascade.
 * For within-group ties: applies H2H after global criteria.
 * For cross-group (3rd place): no H2H (teams never played each other).
 *
 * @param {object[]} tied         Subset of teams that are equal on prior criteria
 * @param {object[]} allGroupMatches  All played matches in the group
 * @param {boolean}  useH2H       Whether to apply H2H (false for cross-group)
 * @param {function} rng          () → [0,1) for drawing of lots
 * @returns {object[]}            Sorted copy (best first)
 */
function sortTied(tied, allGroupMatches, useH2H, rng) {
  if (tied.length === 1) return tied;

  const globalCriteria = [t => t.points, t => t.gd, t => t.gf];

  // Sort by global criteria first
  const sorted = [...tied].sort((a, b) => cascadeCompare(a, b, globalCriteria));

  // Identify groups still tied after global criteria
  const result = [];
  for (const group of tiedGroups(sorted, (a, b) => cascadeCompare(a, b, globalCriteria))) {
    if (group.length === 1 || !useH2H) {
      // Either resolved, or cross-group (no H2H) → random
      result.push(...breakByRandom(group, rng));
    } else {
      // Apply H2H cascade within this tied sub-group
      result.push(...applyH2H(group, allGroupMatches, rng));
    }
  }
  return result;
}

/**
 * Apply H2H cascade to a tied sub-group.
 */
function applyH2H(tied, allGroupMatches, rng) {
  if (tied.length === 1) return tied;

  const withH2H = h2hStats(tied, allGroupMatches);
  const h2hCriteria = [t => t.points, t => t.gd, t => t.gf];

  const sorted = [...withH2H].sort((a, b) => cascadeCompare(a, b, h2hCriteria));

  // Identify still-tied sub-groups after H2H
  const result = [];
  for (const group of tiedGroups(sorted, (a, b) => cascadeCompare(a, b, h2hCriteria))) {
    result.push(...breakByRandom(group, rng));
  }
  return result;
}

/**
 * Assign a random order to a group of equally-tied teams.
 * Uses rng() for sorting so the result is deterministic given a seeded rng.
 */
function breakByRandom(group, rng) {
  if (group.length === 1) return group;
  return [...group].sort(() => rng() - 0.5);
}

/**
 * Rank 4 teams within a group using the full FIFA 2026 tiebreaker cascade.
 *
 * @param {string}   groupLabel      e.g. "A"
 * @param {string[]} teams           Array of 4 canonical team names
 * @param {object[]} allMatches      All match objects (filtered internally to this group)
 * @param {function} [rng]           Seeded RNG for drawing of lots; default Math.random
 * @returns {object[]}               4 standing objects, best first (1st → 4th)
 */
export function rankGroup(groupLabel, teams, allMatches, rng = Math.random) {
  const groupMatches = allMatches.filter(
    m => m.group === groupLabel && m.score !== null
  );
  const standings = teams.map(t => computeStats(t, groupMatches));
  return sortTied(standings, groupMatches, true, rng);
}

// ---- Third-place ranking -------------------------------------------------

/**
 * Rank the 12 third-place finishers across all groups.
 * Cross-group comparison: points → GD → GF → random (no H2H, they never played).
 *
 * @param {object[]} thirdPlaceStandings  Array of 12 standing objects, one per group
 * @param {function} [rng]
 * @returns {object[]}  12 standings sorted best-first
 */
export function rankThirdPlace(thirdPlaceStandings, rng = Math.random) {
  return sortTied(thirdPlaceStandings, [], false, rng);
}

/**
 * Select the top 8 third-place qualifiers.
 * @param {object[]} rankedThird  Output of rankThirdPlace (12 entries)
 * @returns {object[]}            Best 8
 */
export function selectThirdPlaceQualifiers(rankedThird) {
  return rankedThird.slice(0, 8);
}

// ---- Third-place slot assignment (bipartite matching) --------------------

/**
 * Assign 8 qualifying third-place teams to R32 slots via bipartite matching.
 * Uses augmenting-path algorithm (Hopcroft-Karp style DFS) to find
 * a valid perfect matching between groups and eligible slots.
 *
 * @param {object[]} qualifiers  8 standing objects (each with .group)
 * @returns {Record<string,string>|null}  { matchId: groupLetter } or null if no valid matching
 */
export function slotThirdPlace(qualifiers) {
  const groups = qualifiers.map(q => q.group);

  // slotAssign[matchId] = groupLetter currently assigned
  const slotAssign = {};
  // groupAssign[groupLetter] = matchId currently assigned
  const groupAssign = {};

  /**
   * Try to find an augmenting path starting from group g.
   * visited: set of matchIds already explored in this DFS.
   */
  function augment(g, visited) {
    for (const slot of THIRD_PLACE_SLOTS) {
      if (visited.has(slot.matchId)) continue;
      if (!slot.eligible.includes(g)) continue;
      visited.add(slot.matchId);
      // If slot is free, or we can re-route the existing assignee
      const incumbent = slotAssign[slot.matchId];
      if (incumbent === undefined || augment(incumbent, visited)) {
        slotAssign[slot.matchId] = g;
        groupAssign[g] = slot.matchId;
        return true;
      }
    }
    return false;
  }

  for (const g of groups) {
    augment(g, new Set());
  }

  // Verify perfect matching (all 8 groups assigned)
  if (Object.keys(groupAssign).length !== 8) return null;

  return slotAssign; // { matchId → groupLetter }
}
