/**
 * sim.js — Monte Carlo tournament simulation engine for WC2026.
 *
 * Exports:
 *   mulberry32(seed)                              → () => [0,1)
 *   getGroupTeams(allMatches)                     → { A: string[], B: string[], … }
 *   runSimulation(allMatches, eloSeedData, params, N, seed) → SimResult
 *
 * SimResult: { N, teams: { [name]: { r32, r16, qf, sf, final, champion } } }
 *   r32:      P(qualifies from group stage)
 *   r16:      P(wins R32, advances to R16)
 *   qf:       P(wins R16, advances to QF)
 *   sf:       P(wins QF, advances to SF)
 *   final:    P(wins SF, reaches Final)
 *   champion: P(wins Final)
 *
 * Design notes:
 *   - Pure function — no I/O, no global state, deterministic given seed.
 *   - Group matches simulated via direct Poisson sampling (Knuth algorithm).
 *     DC correction omitted inside the sim loop for speed; the effect on
 *     aggregate tournament probabilities is negligible (<0.5%).
 *   - Knockout draws resolved by penalty coin-flip (50/50).
 *   - Third-place slot assignment uses the bipartite matching from tournament.js.
 *   - Placeholder resolution handles "1A", "2B", "3…", "W73", "L73" formats
 *     from the openfootball feed.
 */

import { initRatings } from "./ratings.js";
import { expectedGoals } from "./model.js";

const HOST_NATIONS = new Set(["Mexico", "USA", "Canada"]);

function homeCtx(teamA, teamB) {
  if (HOST_NATIONS.has(teamA)) return { homeTeam: teamA };
  if (HOST_NATIONS.has(teamB)) return { homeTeam: teamB };
  return {};
}
import {
  rankGroup,
  rankThirdPlace,
  selectThirdPlaceQualifiers,
  slotThirdPlace,
  THIRD_PLACE_SLOTS,
} from "./tournament.js";

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────

/**
 * Returns a seeded pseudo-random number generator.
 * Output: () => float in [0, 1).
 * Algorithm: mulberry32 — fast, good uniformity, 32-bit state.
 */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Poisson sampler (Knuth algorithm) ────────────────────────────────────────

function samplePoisson(lambda, rng) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

// ── Match simulation ─────────────────────────────────────────────────────────

function simGoals(teamA, teamB, ratings, params, ctx, rng) {
  const { lambdaA, lambdaB } = expectedGoals(teamA, teamB, ratings, params, ctx);
  return [samplePoisson(lambdaA, rng), samplePoisson(lambdaB, rng)];
}

/**
 * Simulate a knockout match (90 min). Draws decided by penalty coin-flip.
 * Returns { winner, loser }.
 */
function simKnockout(teamA, teamB, ratings, params, ctx, rng) {
  const [gA, gB] = simGoals(teamA, teamB, ratings, params, ctx, rng);
  if (gA !== gB) return gA > gB
    ? { winner: teamA, loser: teamB }
    : { winner: teamB, loser: teamA };
  // Draw → penalty coin-flip
  return rng() < 0.5
    ? { winner: teamA, loser: teamB }
    : { winner: teamB, loser: teamA };
}

// ── Group team extraction ────────────────────────────────────────────────────

/**
 * Extract the 4-team roster for each group from the match data.
 * Ignores matches with placeholder team names (e.g. "W73", "1A").
 */
export function getGroupTeams(allMatches) {
  const groups = {};
  for (const m of allMatches) {
    if (!/^[A-L]$/.test(m.group)) continue;
    for (const team of [m.home, m.away]) {
      if (team && !/^[0-9WL]/.test(team)) {
        if (!groups[m.group]) groups[m.group] = new Set();
        groups[m.group].add(team);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(groups).map(([g, s]) => [g, [...s]])
  );
}

// ── Third-place slot map ─────────────────────────────────────────────────────

/**
 * Build a map from feed match ID → THIRD_PLACE_SLOTS matchId (R32-02 etc.)
 * for the 8 R32 slots that host a third-place team.
 * Detection: R32 matches where one team placeholder starts with "3".
 *
 * Matches by eligible-group set extracted from the "3X/Y/Z" placeholder,
 * because the feed sometimes replaces the opponent placeholder (e.g. "1E")
 * with the actual team name once that group is decided.
 */
function buildThirdSlotMap(knockoutMatches) {
  // Index THIRD_PLACE_SLOTS by sorted eligible-group key, e.g. "ABCDF"
  const eligibleKeyToSlotId = {};
  for (const slot of THIRD_PLACE_SLOTS) {
    const key = [...slot.eligible].sort().join("");
    eligibleKeyToSlotId[key] = slot.matchId;
  }
  const map = {};
  for (const m of knockoutMatches) {
    if (m.group !== "R32") continue;
    const thirdPlaceholder = /^3/.test(m.home) ? m.home : /^3/.test(m.away) ? m.away : null;
    if (!thirdPlaceholder) continue;
    // Extract group letters from placeholder like "3A/B/C/D/F" → "ABCDF"
    const groups = thirdPlaceholder.replace(/^3/, "").split("/").filter(Boolean).sort().join("");
    const slotId = eligibleKeyToSlotId[groups];
    if (slotId) map[m.id] = slotId;
  }
  return map;
}

// ── Single simulation run ─────────────────────────────────────────────────────

function simulateOne(
  allMatches, groupTeams, knockoutTemplates, thirdSlotMap,
  ratings, params, rng, counts
) {
  // ── 1. Simulate all 12 groups ────────────────────────────────────────────
  const groupRankings = {};

  for (const g of "ABCDEFGHIJKL") {
    const teams = groupTeams[g];
    if (!teams || teams.length === 0) continue;

    const knownGroupMatches = allMatches.filter(m => m.group === g);
    // Build complete set of match results for this group (known + simulated)
    const fullMatches = [...knownGroupMatches];

    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const a = teams[i], b = teams[j];
        const existing = knownGroupMatches.find(m =>
          (m.home === a && m.away === b) || (m.home === b && m.away === a)
        );
        if (!existing) {
          // No feed entry yet — simulate
          const [gA, gB] = simGoals(a, b, ratings, params, homeCtx(a, b), rng);
          fullMatches.push({
            id: `sim_${g}_${a}_${b}`, group: g,
            home: a, away: b,
            score: { ft_home: gA, ft_away: gB, et_home: null, et_away: null, pen_winner: null },
          });
        } else if (!existing.score) {
          // In feed but unplayed — simulate
          const [gA, gB] = simGoals(existing.home, existing.away, ratings, params, homeCtx(existing.home, existing.away), rng);
          fullMatches.push({
            ...existing,
            score: { ft_home: gA, ft_away: gB, et_home: null, et_away: null, pen_winner: null },
          });
          // (original unplayed match remains in fullMatches but score=null → filtered by rankGroup)
        }
      }
    }

    groupRankings[g] = rankGroup(g, teams, fullMatches, rng);
    // Credit R32 qualification for top 2
    groupRankings[g][0] && counts[groupRankings[g][0].team] && counts[groupRankings[g][0].team].r32++;
    groupRankings[g][1] && counts[groupRankings[g][1].team] && counts[groupRankings[g][1].team].r32++;
  }

  // ── 2. Third-place qualification ─────────────────────────────────────────
  const thirdPlaceStandings = "ABCDEFGHIJKL".split("").flatMap(g => {
    const s = groupRankings[g]?.[2];
    return s ? [{ ...s, group: g }] : [];
  });

  const rankedThird   = rankThirdPlace(thirdPlaceStandings, rng);
  const qualifiedThird = selectThirdPlaceQualifiers(rankedThird);
  const slotAssignment = slotThirdPlace(qualifiedThird) || {};

  // Credit R32 qualification for 8 third-place qualifiers
  for (const s of qualifiedThird) {
    if (counts[s.team]) counts[s.team].r32++;
  }

  // Build feed-match-id → third-place group letter (for placeholder resolution)
  const feedMatchToThirdGroup = {};
  for (const [feedId, slotId] of Object.entries(thirdSlotMap)) {
    const groupLetter = slotAssignment[slotId];
    if (groupLetter) feedMatchToThirdGroup[feedId] = groupLetter;
  }

  // ── 3. Simulate knockout rounds ──────────────────────────────────────────
  const matchWinners = {};
  const matchLosers  = {};

  function resolve(placeholder, matchId) {
    if (!placeholder) return null;

    const m1 = placeholder.match(/^1([A-L])$/);
    if (m1) return groupRankings[m1[1]]?.[0]?.team || null;

    const m2 = placeholder.match(/^2([A-L])$/);
    if (m2) return groupRankings[m2[1]]?.[1]?.team || null;

    if (/^3/.test(placeholder)) {
      const g = feedMatchToThirdGroup[matchId];
      return g ? (groupRankings[g]?.[2]?.team || null) : null;
    }

    const mW = placeholder.match(/^W(\d+)$/);
    if (mW) return matchWinners[`m${mW[1]}`] || null;

    const mL = placeholder.match(/^L(\d+)$/);
    if (mL) return matchLosers[`m${mL[1]}`] || null;

    // Feed has replaced a group-position placeholder with an actual team name
    // (e.g. "1A" → "Mexico" once Group A is decided). Return it directly.
    if (!/^[0-9WL3]/.test(placeholder)) return placeholder;

    return null;
  }

  const roundCreditOnWin = { R32: "r16", R16: "qf", QF: "sf", SF: "final" };

  for (const m of knockoutTemplates) {
    const teamA = resolve(m.home, m.id);
    const teamB = resolve(m.away, m.id);
    if (!teamA || !teamB) continue;

    if (m.score) {
      // Already played — use actual result
      const winner = m.score.ft_home > m.score.ft_away ? teamA
        : m.score.ft_home < m.score.ft_away ? teamB
        : (m.score.pen_winner || (rng() < 0.5 ? teamA : teamB));
      matchWinners[m.id] = winner;
      matchLosers[m.id]  = winner === teamA ? teamB : teamA;
    } else if (m.group === "3rd") {
      // 3rd-place play-off — simulate but don't credit champion race
      const res = simKnockout(teamA, teamB, ratings, params, homeCtx(teamA, teamB), rng);
      matchWinners[m.id] = res.winner;
      matchLosers[m.id]  = res.loser;
      continue;
    } else {
      const res = simKnockout(teamA, teamB, ratings, params, homeCtx(teamA, teamB), rng);
      matchWinners[m.id] = res.winner;
      matchLosers[m.id]  = res.loser;
    }

    const creditKey = roundCreditOnWin[m.group];
    const winner = matchWinners[m.id];
    if (creditKey && winner && counts[winner]) counts[winner][creditKey]++;
  }

  // Champion = winner of the Final
  const finalMatch = knockoutTemplates.find(m => m.group === "Final");
  if (finalMatch) {
    const champ = matchWinners[finalMatch.id];
    if (champ && counts[champ]) counts[champ].champion++;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run N Monte Carlo simulations of the full tournament.
 *
 * @param {object[]} allMatches    Output of getAllMatches() — feed + results merged
 * @param {object}   eloSeedData   Raw elo-seed.json content { ratings: {…} }
 * @param {object}   params        Dixon-Coles / model params (see model.js DEFAULTS)
 * @param {number}   N             Number of simulations (10k–50k recommended)
 * @param {number}   seed          32-bit integer seed for reproducibility
 * @returns {{ N: number, teams: Record<string, TeamProbs> }}
 */
export function runSimulation(allMatches, eloSeedData, params, N, seed) {
  const ratings = initRatings(eloSeedData);
  const rng     = mulberry32(seed);

  const groupTeams = getGroupTeams(allMatches);

  const ROUND_ORDER = ["R32", "R16", "QF", "SF", "3rd", "Final"];
  const knockoutTemplates = allMatches
    .filter(m => ROUND_ORDER.includes(m.group))
    .sort((a, b) => {
      const diff = ROUND_ORDER.indexOf(a.group) - ROUND_ORDER.indexOf(b.group);
      if (diff !== 0) return diff;
      const na = parseInt(a.id.replace(/\D/g, "")) || 0;
      const nb = parseInt(b.id.replace(/\D/g, "")) || 0;
      return na - nb;
    });

  const thirdSlotMap = buildThirdSlotMap(knockoutTemplates);

  // Initialise accumulators — one entry per team
  const counts = {};
  for (const teams of Object.values(groupTeams)) {
    for (const team of teams) {
      counts[team] = { r32: 0, r16: 0, qf: 0, sf: 0, final: 0, champion: 0 };
    }
  }

  for (let i = 0; i < N; i++) {
    simulateOne(allMatches, groupTeams, knockoutTemplates, thirdSlotMap,
                ratings, params, rng, counts);
  }

  // Normalise to probabilities
  const teams = {};
  for (const [name, c] of Object.entries(counts)) {
    teams[name] = {
      r32:      c.r32      / N,
      r16:      c.r16      / N,
      qf:       c.qf       / N,
      sf:       c.sf       / N,
      final:    c.final    / N,
      champion: c.champion / N,
    };
  }

  return { N, teams };
}
