/**
 * tests/ratings.test.js
 * Validates ratings.js: Elo→rating conversion and in-tournament update step.
 */
import { describe, it, expect } from "@jest/globals";
import { initRatings, updateRatings, effectiveMargin, MEAN_GOALS, MU, ELO_SCALE } from "../js/ratings.js";
import { expectedGoals } from "../js/model.js";

// ---- initRatings ---------------------------------------------------------

describe("initRatings", () => {
  const eloData = {
    ratings: {
      Strong: 2100,
      Average: 1800,
      Weak: 1500,
    },
  };

  it("produces a rating for every team", () => {
    const r = initRatings(eloData);
    expect(Object.keys(r)).toEqual(expect.arrayContaining(["Strong", "Average", "Weak"]));
  });

  it("mean attack across all teams ≈ 0 (symmetric by construction)", () => {
    const r = initRatings(eloData);
    const meanAttack = Object.values(r).reduce((s, t) => s + t.attack, 0) / Object.values(r).length;
    expect(meanAttack).toBeCloseTo(0, 6);
  });

  it("higher Elo → higher attack (monotone)", () => {
    const r = initRatings(eloData);
    expect(r["Strong"].attack).toBeGreaterThan(r["Average"].attack);
    expect(r["Average"].attack).toBeGreaterThan(r["Weak"].attack);
  });

  it("higher Elo → higher defense (monotone)", () => {
    const r = initRatings(eloData);
    expect(r["Strong"].defense).toBeGreaterThan(r["Weak"].defense);
  });

  it("attack equals defense for each team (symmetric initial seed)", () => {
    const r = initRatings(eloData);
    for (const t of Object.values(r)) {
      expect(t.attack).toBeCloseTo(t.defense, 8);
    }
  });

  it("stores eloSeed and currentElo", () => {
    const r = initRatings(eloData);
    expect(r["Strong"].eloSeed).toBe(2100);
    expect(r["Strong"].currentElo).toBe(2100);
  });

  it("priorAttack equals initial attack", () => {
    const r = initRatings(eloData);
    expect(r["Strong"].priorAttack).toBeCloseTo(r["Strong"].attack, 8);
  });

  it("ELO_SCALE is documented value 810", () => {
    // 2 * 300 Elo/goal * 1.35 mean goals = 810
    expect(ELO_SCALE).toBeCloseTo(810, 3);
  });

  it("Elo difference of 300 → λ_A − λ_B ≈ 1 at neutral venue (calibration check)", () => {
    const r = initRatings({ ratings: { A: 1950, B: 1650 } }); // 300 diff
    const { lambdaA, lambdaB } = expectedGoals("A", "B", r);
    const expectedGD = lambdaA - lambdaB;
    // Should be close to 1.0; allow ±0.2 for rounding
    expect(expectedGD).toBeGreaterThan(0.8);
    expect(expectedGD).toBeLessThan(1.2);
  });
});

// ---- updateRatings -------------------------------------------------------

describe("updateRatings", () => {
  function makeRatings(eloA = 1800, eloB = 1800) {
    return initRatings({ ratings: { TeamA: eloA, TeamB: eloB } });
  }

  function makeExpected(ratings) {
    const { lambdaA, lambdaB } = expectedGoals("TeamA", "TeamB", ratings);
    return { lambdaHome: lambdaA, lambdaAway: lambdaB };
  }

  it("returns a new object (pure, does not mutate input)", () => {
    const r = makeRatings();
    const exp = makeExpected(r);
    const match = { home: "TeamA", away: "TeamB", score: { ft_home: 2, ft_away: 0 } };
    const updated = updateRatings(r, match, exp);
    expect(updated).not.toBe(r);
    expect(r["TeamA"].attack).toBe(initRatings({ ratings: { TeamA: 1800, TeamB: 1800 } })["TeamA"].attack);
  });

  it("winner's attack increases after a win", () => {
    const r = makeRatings();
    const exp = makeExpected(r);
    const match = { home: "TeamA", away: "TeamB", score: { ft_home: 2, ft_away: 0 } };
    const updated = updateRatings(r, match, exp);
    expect(updated["TeamA"].attack).toBeGreaterThan(r["TeamA"].attack);
  });

  it("loser's attack decreases after a loss", () => {
    const r = makeRatings();
    const exp = makeExpected(r);
    const match = { home: "TeamA", away: "TeamB", score: { ft_home: 2, ft_away: 0 } };
    const updated = updateRatings(r, match, exp);
    expect(updated["TeamB"].attack).toBeLessThan(r["TeamB"].attack);
  });

  it("winner's defense increases after a clean sheet", () => {
    const r = makeRatings();
    const exp = makeExpected(r);
    const match = { home: "TeamA", away: "TeamB", score: { ft_home: 1, ft_away: 0 } };
    const updated = updateRatings(r, match, exp);
    expect(updated["TeamA"].defense).toBeGreaterThan(r["TeamA"].defense);
  });

  it("blowout (5-0) produces smaller per-goal update than linear extrapolation (dampened)", () => {
    const r = makeRatings();
    const exp = makeExpected(r);
    const bigWin     = { home: "TeamA", away: "TeamB", score: { ft_home: 5, ft_away: 0 } };
    const smallerWin = { home: "TeamA", away: "TeamB", score: { ft_home: 3, ft_away: 0 } };
    const updBig   = updateRatings(r, bigWin, exp);
    const updSmall = updateRatings(r, smallerWin, exp);
    const deltaBig   = updBig["TeamA"].attack   - r["TeamA"].attack;
    const deltaSmall = updSmall["TeamA"].attack - r["TeamA"].attack;
    // 5-0 update still larger than 3-0 (more dominant win = bigger update)
    expect(deltaBig).toBeGreaterThan(deltaSmall);
    // But ratio must be LESS than the undamped ratio (5-λ)/(3-λ) ≈ 2.21
    // Blowout damping compresses 5 → ~4.1, so damped ratio ≈ 1.94 < undamped 2.21
    const undampedRatio = (5 - MEAN_GOALS) / (3 - MEAN_GOALS);
    expect(deltaBig / deltaSmall).toBeLessThan(undampedRatio);
  });

  it("unplayed match (score=null) returns ratings unchanged", () => {
    const r = makeRatings();
    const exp = makeExpected(r);
    const match = { home: "TeamA", away: "TeamB", score: null };
    const updated = updateRatings(r, match, exp);
    expect(updated["TeamA"].attack).toBeCloseTo(r["TeamA"].attack, 8);
  });

  it("draw: attack updates are small and in the right direction", () => {
    // Equal teams draw 1-1; both λ ≈ MEAN_GOALS; effective goals = (2 ± 0) / 2 = 1 each
    const r = makeRatings();
    const exp = makeExpected(r);
    const match = { home: "TeamA", away: "TeamB", score: { ft_home: 1, ft_away: 1 } };
    const updated = updateRatings(r, match, exp);
    // Scored exactly as expected → near-zero update
    const delta = Math.abs(updated["TeamA"].attack - r["TeamA"].attack);
    expect(delta).toBeLessThan(0.05);
  });
});
