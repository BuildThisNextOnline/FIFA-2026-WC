/**
 * tests/dixoncoles.test.js
 * Validates the Poisson + Dixon-Coles scoring model.
 *
 * Key invariants to guard:
 *  - scorelineMatrix sums to 1
 *  - DC correction increases draw% vs raw Poisson (its whole purpose)
 *  - DC with τ=0 == raw Poisson (degenerate case)
 *  - matchOdds sums to 1
 *  - Equal teams → symmetric odds; strong favourite → P(win) > 0.5
 *  - Host bonus / rest adjustment go in the right direction
 */
import { describe, it, expect } from "@jest/globals";
import {
  poissonPMF,
  scorelineMatrix,
  matchOdds,
  mostLikelyScore,
  expectedGoals,
  DEFAULTS,
} from "../js/model.js";
import { initRatings, effectiveMargin, MEAN_GOALS, ELO_SCALE } from "../js/ratings.js";

// ---- Helpers -------------------------------------------------------------

function matrixSum(m) {
  return m.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0);
}

function drawProb(m) {
  let d = 0;
  for (let i = 0; i < m.length; i++) d += m[i][i];
  return d;
}

function rawPoissonDrawProb(lambdaA, lambdaB, maxGoals = 10) {
  let d = 0;
  for (let k = 0; k <= maxGoals; k++) {
    d += poissonPMF(k, lambdaA) * poissonPMF(k, lambdaB);
  }
  return d;
}

// Minimal ratings fixture: two teams with given Elo
function twoTeamRatings(eloA, eloB) {
  return initRatings({ ratings: { TeamA: eloA, TeamB: eloB } });
}

// ---- poissonPMF ----------------------------------------------------------

describe("poissonPMF", () => {
  it("sums to ~1 over reasonable range", () => {
    const lambda = 1.4;
    let total = 0;
    for (let k = 0; k <= 30; k++) total += poissonPMF(k, lambda);
    expect(total).toBeCloseTo(1, 4);
  });

  it("P(0 | λ) = e^-λ", () => {
    expect(poissonPMF(0, 1.5)).toBeCloseTo(Math.exp(-1.5), 8);
    expect(poissonPMF(0, 2.0)).toBeCloseTo(Math.exp(-2.0), 8);
  });

  it("P(1 | λ) = λ·e^-λ", () => {
    const λ = 1.3;
    expect(poissonPMF(1, λ)).toBeCloseTo(λ * Math.exp(-λ), 8);
  });

  it("returns 0 for negative k", () => {
    expect(poissonPMF(-1, 1.5)).toBe(0);
  });

  it("returns 1 for k=0 when lambda=0", () => {
    expect(poissonPMF(0, 0)).toBe(1);
    expect(poissonPMF(1, 0)).toBe(0);
  });
});

// ---- scorelineMatrix -----------------------------------------------------

describe("scorelineMatrix", () => {
  it("sums to 1 for typical lambda values", () => {
    const m = scorelineMatrix(1.3, 1.1);
    expect(matrixSum(m)).toBeCloseTo(1, 5);
  });

  it("sums to 1 for equal teams", () => {
    const m = scorelineMatrix(1.35, 1.35);
    expect(matrixSum(m)).toBeCloseTo(1, 5);
  });

  it("sums to 1 for extreme mismatch (high lambda)", () => {
    const m = scorelineMatrix(2.8, 0.5);
    expect(matrixSum(m)).toBeCloseTo(1, 4);
  });

  it("all values non-negative", () => {
    const m = scorelineMatrix(1.4, 1.2, -0.1);
    for (const row of m) {
      for (const p of row) {
        expect(p).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("returns (maxGoals+1)×(maxGoals+1) matrix", () => {
    const m = scorelineMatrix(1.3, 1.1, -0.1, 8);
    expect(m.length).toBe(9);
    expect(m[0].length).toBe(9);
  });

  it("τ=0 → result matches raw Poisson matrix (no correction)", () => {
    const lambdaA = 1.4, lambdaB = 1.2;
    const m = scorelineMatrix(lambdaA, lambdaB, 0);
    // With τ=0 all DC factors are 1, so matrix should equal raw Poisson
    for (let i = 0; i <= 5; i++) {
      for (let j = 0; j <= 5; j++) {
        const rawP = poissonPMF(i, lambdaA) * poissonPMF(j, lambdaB);
        // Both are renormalized; compare ratios instead of raw values
        if (i > 0 || j > 0) {
          const rawBase = poissonPMF(0, lambdaA) * poissonPMF(0, lambdaB);
          expect(m[i][j] / m[0][0]).toBeCloseTo(rawP / rawBase, 4);
        }
      }
    }
  });
});

// ---- Dixon-Coles correction effect --------------------------------------

describe("Dixon-Coles correction", () => {
  const λA = 1.3, λB = 1.1;

  it("increases P(0,0) vs raw Poisson", () => {
    const dc  = scorelineMatrix(λA, λB, -0.1);
    const raw = scorelineMatrix(λA, λB, 0);
    expect(dc[0][0]).toBeGreaterThan(raw[0][0]);
  });

  it("increases P(1,1) vs raw Poisson", () => {
    const dc  = scorelineMatrix(λA, λB, -0.1);
    const raw = scorelineMatrix(λA, λB, 0);
    expect(dc[1][1]).toBeGreaterThan(raw[1][1]);
  });

  it("decreases P(1,0) vs raw Poisson", () => {
    const dc  = scorelineMatrix(λA, λB, -0.1);
    const raw = scorelineMatrix(λA, λB, 0);
    expect(dc[1][0]).toBeLessThan(raw[1][0]);
  });

  it("decreases P(0,1) vs raw Poisson", () => {
    const dc  = scorelineMatrix(λA, λB, -0.1);
    const raw = scorelineMatrix(λA, λB, 0);
    expect(dc[0][1]).toBeLessThan(raw[0][1]);
  });

  it("increases total draw probability vs raw Poisson", () => {
    const dc  = scorelineMatrix(λA, λB, -0.1);
    const raw = scorelineMatrix(λA, λB, 0);
    expect(drawProb(dc)).toBeGreaterThan(drawProb(raw));
  });

  it("draw boost is meaningful (> 1 percentage point)", () => {
    const dc  = scorelineMatrix(λA, λB, -0.1);
    const raw = scorelineMatrix(λA, λB, 0);
    expect(drawProb(dc) - drawProb(raw)).toBeGreaterThan(0.01);
  });

  it("larger |τ| → larger draw boost (monotonic in correction strength)", () => {
    const drawWith = (tau) => drawProb(scorelineMatrix(λA, λB, tau));
    expect(drawWith(-0.15)).toBeGreaterThan(drawWith(-0.10));
    expect(drawWith(-0.10)).toBeGreaterThan(drawWith(-0.05));
    expect(drawWith(-0.05)).toBeGreaterThan(drawWith(0));
  });

  it("cells beyond (1,1) are unaffected by τ", () => {
    const dc  = scorelineMatrix(λA, λB, -0.1);
    const raw = scorelineMatrix(λA, λB, 0);
    // Check a non-low-score cell — relative ratio should be same as raw Poisson
    // (differences only from renormalization, which is small)
    const ratioRaw = raw[2][1] / raw[3][2];
    const ratioDC  = dc[2][1] / dc[3][2];
    expect(ratioDC).toBeCloseTo(ratioRaw, 3);
  });
});

// ---- matchOdds -----------------------------------------------------------

describe("matchOdds", () => {
  it("sums to 1", () => {
    const m = scorelineMatrix(1.3, 1.2);
    const { home, draw, away } = matchOdds(m);
    expect(home + draw + away).toBeCloseTo(1, 6);
  });

  it("equal teams → P(home) ≈ P(away)", () => {
    const m = scorelineMatrix(1.35, 1.35);
    const { home, away } = matchOdds(m);
    expect(home).toBeCloseTo(away, 3);
  });

  it("strong favourite wins more than 60% of games", () => {
    // Spain (2157) vs Qatar (1421): Elo diff = 736
    const ratings = twoTeamRatings(2157, 1421);
    const { lambdaA, lambdaB } = expectedGoals("TeamA", "TeamB", ratings);
    const m = scorelineMatrix(lambdaA, lambdaB);
    const { home } = matchOdds(m);
    expect(home).toBeGreaterThan(0.60);
  });

  it("teams of similar Elo → all three outcomes have meaningful probability", () => {
    const ratings = twoTeamRatings(1850, 1830);
    const { lambdaA, lambdaB } = expectedGoals("TeamA", "TeamB", ratings);
    const { home, draw, away } = matchOdds(scorelineMatrix(lambdaA, lambdaB));
    expect(home).toBeGreaterThan(0.10);
    expect(draw).toBeGreaterThan(0.10);
    expect(away).toBeGreaterThan(0.10);
  });
});

// ---- expectedGoals adjustments ------------------------------------------

describe("expectedGoals", () => {
  const eloData = { ratings: { TeamA: 1900, TeamB: 1900 } };
  const ratings = initRatings(eloData);

  it("equal teams at neutral venue → both lambdas ≈ MEAN_GOALS", () => {
    const { lambdaA, lambdaB } = expectedGoals("TeamA", "TeamB", ratings);
    expect(lambdaA).toBeCloseTo(MEAN_GOALS, 3);
    expect(lambdaB).toBeCloseTo(MEAN_GOALS, 3);
  });

  it("host bonus increases λ for home team and decreases λ for away", () => {
    const neutral = expectedGoals("TeamA", "TeamB", ratings);
    const homeA   = expectedGoals("TeamA", "TeamB", ratings, {}, { homeTeam: "TeamA" });
    expect(homeA.lambdaA).toBeGreaterThan(neutral.lambdaA);
    expect(homeA.lambdaB).toBeLessThan(neutral.lambdaB);
  });

  it("host bonus effect equals gamma in log-goal space", () => {
    const { lambdaA: la } = expectedGoals("TeamA", "TeamB", ratings, {}, { homeTeam: "TeamA" });
    const { lambdaA: lb } = expectedGoals("TeamA", "TeamB", ratings);
    expect(Math.log(la) - Math.log(lb)).toBeCloseTo(DEFAULTS.gamma, 6);
  });

  it("rest advantage increases λ for more-rested team", () => {
    const neutral = expectedGoals("TeamA", "TeamB", ratings);
    const rested  = expectedGoals("TeamA", "TeamB", ratings, {}, { restDiff: 3 });
    expect(rested.lambdaA).toBeGreaterThan(neutral.lambdaA);
    expect(rested.lambdaB).toBeLessThan(neutral.lambdaB);
  });

  it("rest advantage is capped at 5 days", () => {
    const r5  = expectedGoals("TeamA", "TeamB", ratings, {}, { restDiff: 5 });
    const r10 = expectedGoals("TeamA", "TeamB", ratings, {}, { restDiff: 10 });
    expect(r5.lambdaA).toBeCloseTo(r10.lambdaA, 8);
  });

  it("ET fatigue reduces λ for fatigued team", () => {
    const fresh   = expectedGoals("TeamA", "TeamB", ratings);
    const fatigued = expectedGoals("TeamA", "TeamB", ratings, {}, { etA: true });
    expect(fatigued.lambdaA).toBeLessThan(fresh.lambdaA);
    expect(fatigued.lambdaB).toBeCloseTo(fresh.lambdaB, 8); // B unaffected
  });

  it("ET fatigue effect equals etPenalty in log-goal space", () => {
    const fresh    = expectedGoals("TeamA", "TeamB", ratings);
    const fatigued = expectedGoals("TeamA", "TeamB", ratings, {}, { etA: true });
    expect(Math.log(fresh.lambdaA) - Math.log(fatigued.lambdaA)).toBeCloseTo(DEFAULTS.etPenalty, 6);
  });

  it("stronger team (higher Elo) has higher λ at neutral venue", () => {
    const r = initRatings({ ratings: { Strong: 2000, Weak: 1600 } });
    const { lambdaA, lambdaB } = expectedGoals("Strong", "Weak", r);
    expect(lambdaA).toBeGreaterThan(lambdaB);
  });

  it("custom gamma overrides default", () => {
    const noBonus  = expectedGoals("TeamA", "TeamB", ratings, { gamma: 0 }, { homeTeam: "TeamA" });
    const bigBonus = expectedGoals("TeamA", "TeamB", ratings, { gamma: 0.5 }, { homeTeam: "TeamA" });
    expect(noBonus.lambdaA).toBeCloseTo(MEAN_GOALS, 3);
    expect(bigBonus.lambdaA).toBeGreaterThan(noBonus.lambdaA);
  });
});

// ---- ratings.js: effectiveMargin ----------------------------------------

describe("effectiveMargin", () => {
  it("effectiveMargin(0) = 0", () => {
    expect(effectiveMargin(0)).toBe(0);
  });

  it("effectiveMargin(3) = 3 (linear boundary)", () => {
    expect(effectiveMargin(3)).toBeCloseTo(3, 8);
  });

  it("is sub-linear above 3 (blowout damping)", () => {
    // If linear: effectiveMargin(6) would be 6; it should be less
    const em6 = effectiveMargin(6);
    expect(em6).toBeLessThan(6);
    expect(em6).toBeGreaterThan(3); // but still greater than boundary
  });

  it("is monotonically increasing", () => {
    for (let m = 1; m <= 10; m++) {
      expect(effectiveMargin(m)).toBeGreaterThan(effectiveMargin(m - 1));
    }
  });

  it("is antisymmetric: effectiveMargin(-m) = -effectiveMargin(m)", () => {
    for (const m of [1, 2, 4, 7]) {
      expect(effectiveMargin(-m)).toBeCloseTo(-effectiveMargin(m), 8);
    }
  });

  it("5-0 blowout: effective margin < 5", () => {
    expect(effectiveMargin(5)).toBeLessThan(5);
  });

  it("7-0 blowout: effective margin < 5 (heavy damping)", () => {
    // 7-goal blowout → 3 + ln(1+4) = 3 + 1.61 = 4.61
    expect(effectiveMargin(7)).toBeCloseTo(3 + Math.log(5), 4);
    expect(effectiveMargin(7)).toBeLessThan(5);
  });
});

// ---- mostLikelyScore -----------------------------------------------------

describe("mostLikelyScore", () => {
  it("returns the cell with highest probability", () => {
    const m = scorelineMatrix(1.0, 0.8);
    const { homeGoals, awayGoals, prob } = mostLikelyScore(m);
    // 1-0 or 0-0 typically most likely for λ≈1
    expect(prob).toBeGreaterThan(0.1);
    expect(m[homeGoals][awayGoals]).toBe(prob);
  });

  it("for dominant favourite, most likely score has more home goals", () => {
    // Lambda A = 2.5, B = 0.5 — home side heavily favoured
    const { homeGoals, awayGoals } = mostLikelyScore(scorelineMatrix(2.5, 0.5));
    expect(homeGoals).toBeGreaterThan(awayGoals);
  });
});
