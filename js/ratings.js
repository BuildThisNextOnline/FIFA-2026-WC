/**
 * ratings.js — Elo seed → attack/defense ratings + in-tournament update
 *
 * Rating representation per team:
 *   { attack, defense, eloSeed, currentElo, priorAttack, priorDefense }
 *
 * attack and defense are additive terms in log-goal space.
 * By construction they are symmetric: attack_i = defense_i = (Elo_i - meanElo) / ELO_SCALE.
 * This means log(λ_A) − log(λ_B) = 2*(attack_A − attack_B) for two equal-rest neutral games.
 *
 * Calibration constant (document here, never bury in code):
 *   ELO_PER_GOAL = 300  →  300 Elo difference ≈ 1 expected goal difference at neutral venue.
 *   MEAN_GOALS   = 1.35 →  average goals per team per game in World Cup group stage.
 *   ELO_SCALE    = 2 * ELO_PER_GOAL * MEAN_GOALS = 810  (denominator for attack/defense)
 *
 * Derivation: E[GD] = λ_A − λ_B ≈ exp(MU) * (log(λ_A)−log(λ_B)) = MEAN_GOALS * 2*(ΔElo/ELO_SCALE)
 *   Setting E[GD]=1 at ΔElo=300 → ELO_SCALE = 2*300*MEAN_GOALS = 810.
 */

export const MEAN_GOALS = 1.35;
export const MU = Math.log(MEAN_GOALS); // model intercept (log-goal baseline for equal teams)

const ELO_PER_GOAL = 300; // calibration constant
export const ELO_SCALE = 2 * ELO_PER_GOAL * MEAN_GOALS; // = 810

// Step size for in-tournament gradient update (equivalent to Elo K≈50 in goal space)
const K_GOAL = 0.05;

/**
 * Convert Elo deviation from mean to attack/defense rating (symmetric).
 * @param {number} elo      Team's current Elo
 * @param {number} meanElo  Mean Elo across all 48 teams
 */
function eloToRating(elo, meanElo) {
  return (elo - meanElo) / ELO_SCALE;
}

/**
 * Initialise ratings from elo-seed.json data.
 * @param {{ ratings: Record<string,number> }} eloData  Parsed elo-seed.json
 * @returns {Record<string, TeamRating>}
 */
export function initRatings(eloData) {
  const eloMap = eloData.ratings ?? eloData;
  const teams = Object.keys(eloMap);
  const elos = Object.values(eloMap);
  const meanElo = elos.reduce((a, b) => a + b, 0) / elos.length;

  const ratings = {};
  for (const team of teams) {
    const r = eloToRating(eloMap[team], meanElo);
    ratings[team] = {
      attack:       r,
      defense:      r,
      priorAttack:  r,
      priorDefense: r,
      eloSeed:      eloMap[team],
      currentElo:   eloMap[team],
      meanElo,      // stored for reference
    };
  }
  return ratings;
}

/**
 * Blowout damping function.
 * Compresses margins above 3 goals logarithmically so a 7-0 blowout doesn't
 * wildly distort ratings.
 * Invariants: effectiveMargin(0)=0, effectiveMargin(3)=3, monotonically increasing,
 * sub-linear above 3, always same sign as input.
 *
 * @param {number} rawMargin  Signed goal difference (positive = team A won by that margin)
 * @returns {number}          Damped signed margin
 */
export function effectiveMargin(rawMargin) {
  const m = Math.abs(rawMargin);
  const damped = Math.min(m, 3) + Math.log1p(Math.max(0, m - 3));
  return rawMargin >= 0 ? damped : -damped;
}

/**
 * Update ratings (pure function — returns a new ratings object) after one match.
 * Uses gradient ascent on the Poisson log-likelihood with blowout damping.
 *
 * For each team A:
 *   attack_A  += K * (eff_gA − λ_A)    [scored more/less than expected]
 *   defense_A += K * (λ_B − eff_gB)    [conceded less/more than expected]
 *
 * @param {Record<string,TeamRating>} ratings   Current ratings (not mutated)
 * @param {{ home: string, away: string, score: Score }} match
 * @param {{ lambdaHome: number, lambdaAway: number }} expected  Pre-match expected goals
 * @returns {Record<string,TeamRating>}          New ratings object
 */
export function updateRatings(ratings, match, expected) {
  const { home, away, score } = match;
  const { lambdaHome, lambdaAway } = expected;

  if (!score) return ratings; // unplayed

  const rawMargin = score.ft_home - score.ft_away;
  const effDiff   = effectiveMargin(rawMargin);
  const totalGoals = score.ft_home + score.ft_away;

  // Damped effective goals (preserves total goal count, compresses margin)
  const eff_home = (totalGoals + effDiff) / 2;
  const eff_away = (totalGoals - effDiff) / 2;

  const h = { ...ratings[home] };
  const a = { ...ratings[away] };

  h.attack   += K_GOAL * (eff_home - lambdaHome);
  h.defense  += K_GOAL * (lambdaAway - eff_away);
  a.attack   += K_GOAL * (eff_away - lambdaAway);
  a.defense  += K_GOAL * (lambdaHome - eff_home);

  return {
    ...ratings,
    [home]: h,
    [away]: a,
  };
}
