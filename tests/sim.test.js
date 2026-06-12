/**
 * tests/sim.test.js
 * Unit tests for the Monte Carlo simulation engine.
 *
 * Key invariants:
 *  - mulberry32 is deterministic and uniformly distributed
 *  - runSimulation returns valid probabilities for all 48 teams
 *  - champion probabilities sum to 1
 *  - strong Elo team has higher champion% than weak Elo team
 *  - same seed → identical results; different seed → different results
 *
 * Bracket structure (WC2026):
 *   72 group matches (12 groups × 6) → m1–m72
 *   16 R32 matches                   → m73–m88
 *    8 R16 matches                   → m89–m96
 *    4 QF  matches                   → m97–m100
 *    2 SF  matches                   → m101–m102
 *    1 3rd-place match               → m103
 *    1 Final                         → m104
 *   Total: 104 ✓
 */

import { describe, it, expect } from "@jest/globals";
import { mulberry32, getGroupTeams, runSimulation } from "../js/sim.js";

// ── Tournament data fixture ──────────────────────────────────────────────────

const GROUPS = {
  A: ["Mexico", "South Africa", "Korea Republic", "Czech Republic"],
  B: ["Canada", "Bosnia & Herzegovina", "Qatar", "Switzerland"],
  C: ["Brazil", "Morocco", "Haiti", "Scotland"],
  D: ["USA", "Paraguay", "Australia", "Turkey"],
  E: ["Germany", "Curaçao", "Côte d'Ivoire", "Ecuador"],
  F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "IR Iran", "New Zealand"],
  H: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
  I: ["France", "Senegal", "Iraq", "Norway"],
  J: ["Argentina", "Algeria", "Austria", "Jordan"],
  K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};

function makeTournamentMatches() {
  const matches = [];
  let num = 1;

  // ── Group stage: 72 matches (all unplayed) ────────────────────────────────
  for (const [g, teams] of Object.entries(GROUPS)) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        matches.push({ id: `m${num++}`, group: g, home: teams[i], away: teams[j], date: "2026-06-15", venue: null, score: null });
      }
    }
  }
  // num === 73 after group stage

  // ── R32: 16 matches ──────────────────────────────────────────────────────
  // 8 third-place slots — opponents from THIRD_PLACE_SLOTS.opponent field.
  // The 8 group winners who face a third-place team: A,B,D,E,G,I,K,L
  const thirdMatchups = [
    ["1E", "3A/B/C/D/F"],   // R32-02 slot
    ["1I", "3C/D/F/G/H"],   // R32-05
    ["1A", "3C/E/F/H/I"],   // R32-07
    ["1L", "3E/H/I/J/K"],   // R32-08
    ["1D", "3B/E/F/I/J"],   // R32-09
    ["1G", "3A/E/H/I/J"],   // R32-10
    ["1B", "3E/F/G/I/J"],   // R32-13
    ["1K", "3D/E/I/J/L"],   // R32-15
  ];
  for (const [home, away] of thirdMatchups) {
    matches.push({ id: `m${num++}`, group: "R32", home, away, date: "2026-06-29", venue: null, score: null });
  }
  // num === 81 (R32 third-place matches: m73–m80)

  // 8 direct R32 matches (remaining winners C,F,H,J vs selected runners-up;
  // then unpaired runners-up vs each other).
  // Each of the 16 teams in this block must appear exactly once.
  const directMatchups = [
    ["1C", "2A"], ["1F", "2B"], ["1H", "2C"], ["1J", "2D"],
    ["2E", "2F"], ["2G", "2H"], ["2I", "2J"], ["2K", "2L"],
  ];
  for (const [home, away] of directMatchups) {
    matches.push({ id: `m${num++}`, group: "R32", home, away, date: "2026-06-29", venue: null, score: null });
  }
  // num === 89 (R32 direct: m81–m88; all 16 R32 matches: m73–m88)

  // ── R16: 8 matches (winners of adjacent R32 pairs) ───────────────────────
  for (let i = 0; i < 8; i++) {
    const a = 73 + i * 2, b = 74 + i * 2;
    matches.push({ id: `m${num++}`, group: "R16", home: `W${a}`, away: `W${b}`, date: "2026-07-05", venue: null, score: null });
  }
  // num === 97 (R16: m89–m96)

  // ── QF: 4 matches ────────────────────────────────────────────────────────
  for (let i = 0; i < 4; i++) {
    const a = 89 + i * 2, b = 90 + i * 2;
    matches.push({ id: `m${num++}`, group: "QF", home: `W${a}`, away: `W${b}`, date: "2026-07-10", venue: null, score: null });
  }
  // num === 101 (QF: m97–m100)

  // ── SF: 2 matches ─────────────────────────────────────────────────────────
  matches.push({ id: `m${num++}`, group: "SF", home: "W97", away: "W98",   date: "2026-07-14", venue: null, score: null });
  matches.push({ id: `m${num++}`, group: "SF", home: "W99", away: "W100",  date: "2026-07-14", venue: null, score: null });
  // num === 103 (SF: m101–m102)

  // ── 3rd-place play-off ────────────────────────────────────────────────────
  matches.push({ id: `m${num++}`, group: "3rd",   home: "L101", away: "L102", date: "2026-07-18", venue: null, score: null });
  // ── Final ─────────────────────────────────────────────────────────────────
  matches.push({ id: `m${num++}`, group: "Final", home: "W101", away: "W102", date: "2026-07-19", venue: null, score: null });

  return matches;
}

// Elo ratings covering all 48 WC2026 teams
const ELO_SEED = {
  ratings: {
    "Mexico": 1876, "South Africa": 1627, "Korea Republic": 1787, "Czech Republic": 1735,
    "Canada": 1796, "Bosnia & Herzegovina": 1693, "Qatar": 1622, "Switzerland": 1901,
    "Brazil": 1991, "Morocco": 1866, "Haiti": 1561, "Scotland": 1745,
    "USA": 1799, "Paraguay": 1717, "Australia": 1724, "Turkey": 1789,
    "Germany": 1959, "Curaçao": 1554, "Côte d'Ivoire": 1726, "Ecuador": 1742,
    "Netherlands": 1960, "Japan": 1887, "Sweden": 1818, "Tunisia": 1698,
    "Belgium": 1931, "Egypt": 1648, "IR Iran": 1738, "New Zealand": 1596,
    "Spain": 2157, "Cape Verde": 1628, "Saudi Arabia": 1669, "Uruguay": 1857,
    "France": 2063, "Senegal": 1783, "Iraq": 1619, "Norway": 1815,
    "Argentina": 2115, "Algeria": 1691, "Austria": 1772, "Jordan": 1581,
    "Portugal": 1969, "DR Congo": 1644, "Uzbekistan": 1601, "Colombia": 1823,
    "England": 2024, "Croatia": 1840, "Ghana": 1609, "Panama": 1636,
  },
};

const ALL_MATCHES = makeTournamentMatches();
const PARAMS = {}; // use model DEFAULTS

// ── mulberry32 ───────────────────────────────────────────────────────────────

describe("mulberry32", () => {
  it("is deterministic — same seed produces same sequence", () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    for (let i = 0; i < 20; i++) {
      expect(r1()).toBe(r2());
    }
  });

  it("outputs values in [0, 1)", () => {
    const rng = mulberry32(999);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces different sequences from different seeds", () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });

  it("has reasonable uniformity (mean ≈ 0.5 over 10k samples)", () => {
    const rng = mulberry32(12345);
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += rng();
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });
});

// ── getGroupTeams ─────────────────────────────────────────────────────────────

describe("getGroupTeams", () => {
  it("returns 12 groups", () => {
    expect(Object.keys(getGroupTeams(ALL_MATCHES)).length).toBe(12);
  });

  it("extracts 4 teams per group", () => {
    const g = getGroupTeams(ALL_MATCHES);
    for (const label of "ABCDEFGHIJKL") {
      expect(g[label].length).toBe(4);
    }
  });

  it("does not include placeholder names", () => {
    const g = getGroupTeams(ALL_MATCHES);
    for (const teams of Object.values(g)) {
      for (const t of teams) {
        expect(/^[0-9WL]/.test(t)).toBe(false);
      }
    }
  });
});

// ── runSimulation ─────────────────────────────────────────────────────────────

describe("runSimulation", () => {
  const N = 500;
  const result = runSimulation(ALL_MATCHES, ELO_SEED, PARAMS, N, 42);

  it("returns the correct N", () => {
    expect(result.N).toBe(N);
  });

  it("returns an entry for all 48 teams", () => {
    expect(Object.keys(result.teams).length).toBe(48);
    for (const name of Object.keys(ELO_SEED.ratings)) {
      expect(result.teams).toHaveProperty(name);
    }
  });

  it("all probabilities are in [0, 1]", () => {
    for (const probs of Object.values(result.teams)) {
      for (const val of Object.values(probs)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("champion probabilities sum to 1 (exactly one winner per run)", () => {
    const total = Object.values(result.teams).reduce((s, p) => s + p.champion, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("advancement is monotone: r32 ≥ r16 ≥ qf ≥ sf ≥ final ≥ champion", () => {
    for (const probs of Object.values(result.teams)) {
      expect(probs.r32 + 1e-9).toBeGreaterThanOrEqual(probs.r16);
      expect(probs.r16 + 1e-9).toBeGreaterThanOrEqual(probs.qf);
      expect(probs.qf  + 1e-9).toBeGreaterThanOrEqual(probs.sf);
      expect(probs.sf  + 1e-9).toBeGreaterThanOrEqual(probs.final);
      expect(probs.final + 1e-9).toBeGreaterThanOrEqual(probs.champion);
    }
  });

  it("Spain (highest Elo 2157) has higher champion% than Cape Verde", () => {
    expect(result.teams["Spain"].champion).toBeGreaterThan(result.teams["Cape Verde"].champion);
  });

  it("Argentina (Elo 2115) has higher champion% than Jordan (Elo 1581)", () => {
    expect(result.teams["Argentina"].champion).toBeGreaterThan(result.teams["Jordan"].champion);
  });

  it("is deterministic — same seed gives identical result", () => {
    const r1 = runSimulation(ALL_MATCHES, ELO_SEED, PARAMS, N, 42);
    const r2 = runSimulation(ALL_MATCHES, ELO_SEED, PARAMS, N, 42);
    for (const name of Object.keys(ELO_SEED.ratings)) {
      expect(r1.teams[name].champion).toBe(r2.teams[name].champion);
    }
  });

  it("produces different results with a different seed", () => {
    const r1 = runSimulation(ALL_MATCHES, ELO_SEED, PARAMS, N, 1);
    const r2 = runSimulation(ALL_MATCHES, ELO_SEED, PARAMS, N, 2);
    const differs = Object.keys(ELO_SEED.ratings).some(
      name => r1.teams[name].champion !== r2.teams[name].champion
    );
    expect(differs).toBe(true);
  });

  it("32 teams qualify from the group stage per simulation (r32 total ≈ 32)", () => {
    const total = Object.values(result.teams).reduce((s, p) => s + p.r32, 0);
    expect(total).toBeCloseTo(32, 0);
  });

  it("16 teams reach R16 per simulation (r16 total ≈ 16)", () => {
    const total = Object.values(result.teams).reduce((s, p) => s + p.r16, 0);
    expect(total).toBeCloseTo(16, 0);
  });

  it("8 teams reach QF per simulation (qf total ≈ 8)", () => {
    const total = Object.values(result.teams).reduce((s, p) => s + p.qf, 0);
    expect(total).toBeCloseTo(8, 0);
  });

  it("4 teams reach SF per simulation (sf total ≈ 4)", () => {
    const total = Object.values(result.teams).reduce((s, p) => s + p.sf, 0);
    expect(total).toBeCloseTo(4, 0);
  });

  it("2 teams reach Final per simulation (final total ≈ 2)", () => {
    const total = Object.values(result.teams).reduce((s, p) => s + p.final, 0);
    expect(total).toBeCloseTo(2, 0);
  });
});
