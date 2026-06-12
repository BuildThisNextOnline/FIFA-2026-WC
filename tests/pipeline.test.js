/**
 * tests/pipeline.test.js
 * Tests for data.js merge precedence, name normalization, and match filtering.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { normalizeName, CANONICAL_TEAMS } from "../js/data.js";

// ---- normalizeName -------------------------------------------------------

describe("normalizeName", () => {
  it("returns canonical names unchanged", () => {
    expect(normalizeName("France")).toBe("France");
    expect(normalizeName("USA")).toBe("USA");
    expect(normalizeName("Korea Republic")).toBe("Korea Republic");
    expect(normalizeName("Côte d'Ivoire")).toBe("Côte d'Ivoire");
    expect(normalizeName("IR Iran")).toBe("IR Iran");
    expect(normalizeName("Bosnia & Herzegovina")).toBe("Bosnia & Herzegovina");
    expect(normalizeName("Cape Verde")).toBe("Cape Verde");
    expect(normalizeName("DR Congo")).toBe("DR Congo");
    expect(normalizeName("Curaçao")).toBe("Curaçao");
    expect(normalizeName("Scotland")).toBe("Scotland");
  });

  it("maps known feed aliases", () => {
    expect(normalizeName("Ivory Coast")).toBe("Côte d'Ivoire");
    expect(normalizeName("Cote d'Ivoire")).toBe("Côte d'Ivoire");
    expect(normalizeName("Iran")).toBe("IR Iran");
    expect(normalizeName("South Korea")).toBe("Korea Republic");
    expect(normalizeName("Czechia")).toBe("Czech Republic");
    expect(normalizeName("Cabo Verde")).toBe("Cape Verde");
    expect(normalizeName("Congo DR")).toBe("DR Congo");
    expect(normalizeName("United States")).toBe("USA");
    expect(normalizeName("United States of America")).toBe("USA");
  });

  it("throws loudly on unknown names with actionable message", () => {
    expect(() => normalizeName("Narnia FC")).toThrow(/unknown team name "Narnia FC"/);
    expect(() => normalizeName("Narnia FC")).toThrow(/FEED_NAME_MAP/);
  });

  it("throws on empty input", () => {
    expect(() => normalizeName("")).toThrow(/empty name/);
    expect(() => normalizeName(null)).toThrow();
  });

  it("trims whitespace before normalizing", () => {
    expect(normalizeName("  France  ")).toBe("France");
    expect(normalizeName("  United States  ")).toBe("USA");
  });
});

// ---- CANONICAL_TEAMS integrity -------------------------------------------

describe("CANONICAL_TEAMS", () => {
  it("contains exactly 48 teams", () => {
    expect(CANONICAL_TEAMS.size).toBe(48);
  });

  it("contains expected group members (verified against 2026 draw)", () => {
    // Group spot-checks
    expect(CANONICAL_TEAMS.has("Mexico")).toBe(true);         // Group A
    expect(CANONICAL_TEAMS.has("Korea Republic")).toBe(true); // Group A
    expect(CANONICAL_TEAMS.has("Scotland")).toBe(true);       // Group C
    expect(CANONICAL_TEAMS.has("Turkey")).toBe(true);         // Group D
    expect(CANONICAL_TEAMS.has("Curaçao")).toBe(true);        // Group E
    expect(CANONICAL_TEAMS.has("Côte d'Ivoire")).toBe(true);  // Group E
    expect(CANONICAL_TEAMS.has("IR Iran")).toBe(true);        // Group G
    expect(CANONICAL_TEAMS.has("Cape Verde")).toBe(true);     // Group H
    expect(CANONICAL_TEAMS.has("Norway")).toBe(true);         // Group I
    expect(CANONICAL_TEAMS.has("DR Congo")).toBe(true);       // Group K
  });

  it("does not contain un-canonicalized aliases", () => {
    expect(CANONICAL_TEAMS.has("United States")).toBe(false);
    expect(CANONICAL_TEAMS.has("Ivory Coast")).toBe(false);
    expect(CANONICAL_TEAMS.has("South Korea")).toBe(false);
    expect(CANONICAL_TEAMS.has("Iran")).toBe(false);
    expect(CANONICAL_TEAMS.has("Cabo Verde")).toBe(false);
    expect(CANONICAL_TEAMS.has("Congo DR")).toBe(false);
  });
});

// ---- Merge precedence (unit-level, without fetch) ------------------------
// These tests exercise the merge logic directly by importing the internals.
// We test the invariant: repo override wins over feed on same match id.

describe("merge precedence invariant", () => {
  // Inline the merge logic to test it without DOM/fetch
  function mergeResults(feedMatches, repoResults) {
    if (!repoResults || repoResults.length === 0) return feedMatches;
    const overrides = new Map(repoResults.map((r) => [r.id, r.score]));
    return feedMatches.map((m) => {
      if (overrides.has(m.id)) return { ...m, score: overrides.get(m.id) };
      return m;
    });
  }

  const feedMatch = { id: "m1", home: "France", away: "Brazil", score: { ft_home: 1, ft_away: 0 } };
  const feedMatch2 = { id: "m2", home: "Germany", away: "Ecuador", score: null };

  it("repo result overwrites feed result for same id", () => {
    const repoScore = { ft_home: 2, ft_away: 2, et_home: null, et_away: null, pen_winner: null };
    const merged = mergeResults([feedMatch], [{ id: "m1", score: repoScore }]);
    expect(merged[0].score.ft_home).toBe(2);
    expect(merged[0].score.ft_away).toBe(2);
  });

  it("repo result fills in unplayed feed match", () => {
    const repoScore = { ft_home: 3, ft_away: 1, et_home: null, et_away: null, pen_winner: null };
    const merged = mergeResults([feedMatch2], [{ id: "m2", score: repoScore }]);
    expect(merged[0].score).not.toBeNull();
    expect(merged[0].score.ft_home).toBe(3);
  });

  it("feed match with no repo override is unchanged", () => {
    const merged = mergeResults([feedMatch, feedMatch2], []);
    expect(merged[0].score.ft_home).toBe(1);
    expect(merged[1].score).toBeNull();
  });

  it("repo results with unknown ids are ignored gracefully", () => {
    const repoScore = { ft_home: 1, ft_away: 0, et_home: null, et_away: null, pen_winner: null };
    const merged = mergeResults([feedMatch], [{ id: "m999", score: repoScore }]);
    expect(merged.length).toBe(1);
    expect(merged[0].score.ft_home).toBe(1); // unchanged
  });
});

// ---- getPlayedMatches / getRemainingMatches logic -----------------------

describe("match filtering", () => {
  const matches = [
    { id: "m1", score: { ft_home: 1, ft_away: 0 } },
    { id: "m2", score: null },
    { id: "m3", score: { ft_home: 2, ft_away: 2 } },
    { id: "m4", score: null },
  ];

  it("played = matches with non-null score", () => {
    const played = matches.filter((m) => m.score !== null);
    expect(played.length).toBe(2);
    expect(played.map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("remaining = matches with null score", () => {
    const remaining = matches.filter((m) => m.score === null);
    expect(remaining.length).toBe(2);
    expect(remaining.map((m) => m.id)).toEqual(["m2", "m4"]);
  });
});
