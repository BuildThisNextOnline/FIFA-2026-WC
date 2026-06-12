/**
 * model.js — Poisson + Dixon-Coles scoring model
 *
 * Core formula:
 *   log(λ_A) = MU + attack_A − defense_B + γ·homeA + δ·restDiff − ε·travelA − ET_A
 *
 * Dixon-Coles (1997) low-score correction:
 *   Multiplies raw Poisson joint probabilities for (0,0), (1,0), (0,1), (1,1) by
 *   a correction factor τ(i,j,λ_A,λ_B,ρ) where ρ<0 increases 0-0 and 1-1 cells,
 *   decreasing 1-0 and 0-1.  Without this, draw probabilities run ~2-3 pts low.
 *
 * Parameters (all slider-exposed in v2 UI):
 *   γ (gamma)    host bonus       default  0.30 goals to log-λ
 *   δ (delta)    rest advantage   default  0.06 goals/day (capped at 5-day diff)
 *   ε (epsilon)  travel fatigue   default  0.04 goals/timezone crossed
 *   ET penalty                    default  0.10 goals subtracted if team went to ET
 *   τ (tau)      DC correlation   default −0.10 (negative = more draws than raw Poisson)
 */

import { MU } from "./ratings.js";

// ---- Defaults (all overridable via params object) ------------------------
export const DEFAULTS = {
  gamma:     0.30,
  delta:     0.06,
  epsilon:   0.04,
  etPenalty: 0.10,
  tau:      -0.10,
  maxGoals:  10,
};

// ---- Poisson helpers -----------------------------------------------------

// Precompute log-factorials for k up to MAX_GOALS
const _logFact = [0];
for (let k = 1; k <= 20; k++) _logFact[k] = _logFact[k - 1] + Math.log(k);

/**
 * Poisson probability mass function P(X = k | λ).
 * Uses log-space for numerical stability.
 */
export function poissonPMF(k, lambda) {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - _logFact[Math.min(k, 20)]);
}

// ---- Dixon-Coles correction ---------------------------------------------

/**
 * DC correction factor for the four low-score cells.
 * With ρ < 0: boosts P(0,0) and P(1,1), suppresses P(1,0) and P(0,1).
 *
 * Original DC paper notation (rho = τ here):
 *   τ(0,0) = 1 − λ_A·λ_B·ρ
 *   τ(1,0) = 1 + λ_A·ρ
 *   τ(0,1) = 1 + λ_B·ρ
 *   τ(1,1) = 1 − ρ
 */
function dcFactor(i, j, lambdaA, lambdaB, rho) {
  if (i === 0 && j === 0) return 1 - lambdaA * lambdaB * rho;
  if (i === 1 && j === 0) return 1 + lambdaA * rho;
  if (i === 0 && j === 1) return 1 + lambdaB * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

// ---- Core model functions -----------------------------------------------

/**
 * Compute expected goals for both teams given ratings and match context.
 *
 * @param {string} teamA           Canonical home/first team name
 * @param {string} teamB           Canonical away/second team name
 * @param {Record<string,TeamRating>} ratings
 * @param {object} [params]        Override any DEFAULTS key
 * @param {object} [ctx]           Match context
 * @param {string} [ctx.homeTeam]  Which team (if any) has a home-venue advantage
 * @param {number} [ctx.restDiff]  min(rest_A,5) − min(rest_B,5) in days (positive = A more rested)
 * @param {number} [ctx.travelA]   Timezones crossed by A since last match
 * @param {number} [ctx.travelB]   Timezones crossed by B since last match
 * @param {boolean} [ctx.etA]      True if team A's previous match went to ET/pens
 * @param {boolean} [ctx.etB]
 * @returns {{ lambdaA: number, lambdaB: number }}
 */
export function expectedGoals(teamA, teamB, ratings, params = {}, ctx = {}) {
  const p = { ...DEFAULTS, ...params };
  const ratA = ratings[teamA] ?? { attack: 0, defense: 0 };
  const ratB = ratings[teamB] ?? { attack: 0, defense: 0 };

  const homeBonus = ctx.homeTeam === teamA
    ? p.gamma
    : ctx.homeTeam === teamB ? -p.gamma : 0;

  const restA = Math.min(ctx.restDiff ?? 0, 5);
  const etA   = ctx.etA ? p.etPenalty : 0;
  const etB   = ctx.etB ? p.etPenalty : 0;

  const logLambdaA = MU
    + ratA.attack - ratB.defense
    + homeBonus
    + p.delta * restA
    - p.epsilon * (ctx.travelA ?? 0)
    - etA;

  const logLambdaB = MU
    + ratB.attack - ratA.defense
    - homeBonus
    - p.delta * restA
    - p.epsilon * (ctx.travelB ?? 0)
    - etB;

  return {
    lambdaA: Math.exp(logLambdaA),
    lambdaB: Math.exp(logLambdaB),
  };
}

/**
 * Build the joint scoreline probability matrix with Dixon-Coles correction.
 * Returns a (maxGoals+1) × (maxGoals+1) array where matrix[i][j] = P(A scores i, B scores j).
 * Matrix is renormalized to sum to 1 after DC adjustment.
 *
 * @param {number} lambdaA
 * @param {number} lambdaB
 * @param {number} [tau]       DC correlation parameter (default −0.1, must be ≤ 0)
 * @param {number} [maxGoals]  Maximum goals per team modelled (default 10)
 * @returns {number[][]}
 */
export function scorelineMatrix(lambdaA, lambdaB, tau = DEFAULTS.tau, maxGoals = DEFAULTS.maxGoals) {
  const n = maxGoals + 1;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  let total = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let p = poissonPMF(i, lambdaA) * poissonPMF(j, lambdaB);
      // Apply DC correction only to the four low-score cells
      if (i <= 1 && j <= 1) {
        p *= dcFactor(i, j, lambdaA, lambdaB, tau);
      }
      matrix[i][j] = p;
      total += p;
    }
  }

  // Renormalize so matrix sums to exactly 1
  if (total > 0) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        matrix[i][j] /= total;
      }
    }
  }

  return matrix;
}

/**
 * Aggregate a scoreline matrix into match outcome probabilities.
 *
 * @param {number[][]} matrix  From scorelineMatrix()
 * @returns {{ home: number, draw: number, away: number }}
 */
export function matchOdds(matrix) {
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (i > j) home += matrix[i][j];
      else if (i === j) draw += matrix[i][j];
      else away += matrix[i][j];
    }
  }
  return { home, draw, away };
}

/**
 * Most likely scoreline (mode of the matrix).
 * @param {number[][]} matrix
 * @returns {{ homeGoals: number, awayGoals: number, prob: number }}
 */
export function mostLikelyScore(matrix) {
  let best = { homeGoals: 0, awayGoals: 0, prob: -1 };
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (matrix[i][j] > best.prob) {
        best = { homeGoals: i, awayGoals: j, prob: matrix[i][j] };
      }
    }
  }
  return best;
}
