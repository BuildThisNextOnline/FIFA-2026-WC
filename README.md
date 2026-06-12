# World Cup 2026 Probability Tracker

Auto-updating probability page for FIFA World Cup 2026 (Canada / USA / Mexico, 48 teams, Jun 11 – Jul 19, 2026). After every completed match, recomputes per-match scoreline predictions and per-team advancement/champion probabilities for the entire remaining tournament.

**Live site:** https://BuildThisNextOnline.github.io/FIFA-2026-WC/

---

## What it shows

| Tab | What you see |
|-----|-------------|
| **Fixtures** | All 104 matches with flags · results for played matches · W/D/L probability bars + expected goals for every upcoming match |
| **Standings** | Live group tables for all 12 groups · champion probability (W%) per team from Monte Carlo simulation |
| **Bracket** | 48-team champion probability leaderboard switchable by round (Champion / Final / Semi-final / QF / R16 / Qualify) · adjustable model sliders · re-run button |

---

## How it works

### Data pipeline (3 layers, zero backend)

```
openfootball/worldcup.json (GitHub raw, CORS-friendly)
        ↓ live fetch
  data/results.json  ← GitHub Action commits every 2 h
        ↓ merged and name-normalized
   localStorage (30-min TTL)
        ↓
   UI renders
```

Scores flow in via a scheduled GitHub Action (`update-results.yml`) that runs every 2 hours, commits new results to `data/results.json`, and triggers an automatic GitHub Pages redeploy.

### Ratings seed

Teams start from [World Football Elo ratings](https://www.eloratings.net) (scraped via `scripts/fetch-elo.py` from the `World.tsv` endpoint, which is the tab-separated data file that powers their site). Each team's Elo is converted symmetrically to attack/defense strength:

```
attack = defense = (Elo − meanElo) / ELO_SCALE    (ELO_SCALE = 810)
```

After each played match, ratings update based on effective goal margin (blowout-damped above 3 goals to avoid over-rewarding padding).

### Match prediction model

**Poisson + Dixon-Coles (1997).** For each match, computes expected goals:

```
log(λ_A) = μ + attack_A − defense_B + γ·hostBonus + δ·restDiff − ε·travelA − ET_A
```

Then builds an 11 × 11 scoreline probability matrix. The Dixon-Coles correction multiplies the four low-score cells (0-0, 1-0, 0-1, 1-1) by a factor controlled by τ ≤ 0, which boosts draw probability to correct Poisson's known underestimation. W/D/L odds are the sums of the upper triangle, diagonal, and lower triangle.

**Tunable parameters** (adjustable via sliders in the Bracket tab):

| Parameter | Symbol | Default | Effect |
|-----------|--------|---------|--------|
| Host bonus | γ | 0.30 | log-goals advantage for host nation (Mexico / USA / Canada) at their own venues |
| Rest advantage | δ | 0.06 | Per-day rest difference, capped at 5 days |
| Travel fatigue | ε | 0.04 | Per timezone crossed since last match |
| ET penalty | — | 0.10 | Subtracted for teams coming off extra time |
| DC correlation | τ | −0.10 | Low-score correction strength (more negative = more draws) |
| Simulations | N | 10 000 | Monte Carlo runs; slider up to 50 000 |

### Monte Carlo simulation

A **Web Worker** (`js/simworker.js`) runs N complete tournament simulations in the background so the UI stays responsive. Each run:

1. **Group stage** — simulate remaining matches by sampling goals from Poisson(λ) independently for each team
2. **Group rankings** — apply the full FIFA 2026 tiebreaker cascade: points → GD → GF → H2H points → H2H GD → H2H GF → drawing of lots (seeded RNG)
3. **Third-place** — rank all 12 third-place finishers cross-group; select the best 8; assign to R32 slots via bipartite matching (augmenting-path algorithm)
4. **Knockout rounds** — R32 → R16 → QF → SF → Final; draws in knockout stages resolved by penalty coin-flip (50/50)
5. **Accumulate** — per-team counts of reaching each round, divided by N to produce probabilities

RNG: **mulberry32** — fast, 32-bit seeded generator with good uniformity.

---

## Repository layout

```
index.html                  Single-page app (ES modules, no build step)
css/
  styles.css                All styles
js/
  data.js                   3-layer data pipeline, team-name normalization, feed parsing
  ratings.js                Elo → attack/defense, in-tournament update step
  model.js                  Poisson + Dixon-Coles expected goals and scoreline matrix
  tournament.js             Group standings, FIFA tiebreaker cascade, third-place slot assignment
  sim.js                    Monte Carlo engine — mulberry32, Poisson sampler, full tournament sim
  simworker.js              Web Worker entry point
data/
  elo-seed.json             Pre-tournament Elo ratings for all 48 teams
  results.json              Committed match results, written by GitHub Action
  venues.json               16 host venues with timezone, lat/lng, capacity
scripts/
  fetch-elo.py              Scrapes eloratings.net/World.tsv → data/elo-seed.json
  update-results.py         Fetches openfootball feed → merges into data/results.json
tests/
  pipeline.test.js          14 tests — name normalization, feed parsing, merge precedence
  dixoncoles.test.js        29 tests — Poisson PMF, DC correction, matchOdds, expectedGoals
  ratings.test.js           28 tests — initRatings, updateRatings, blowout damping
  tiebreakers.test.js       23 tests — rankGroup full cascade, H2H, random tiebreak
  thirdplace.test.js        29 tests — rankThirdPlace, slotThirdPlace bipartite matching
  sim.test.js               21 tests — mulberry32, runSimulation structure invariants
.github/workflows/
  update-results.yml        Cron every 2 h — fetch scores, commit results.json
  deploy.yml                Push to main → deploy to GitHub Pages
```

**144 unit tests, all passing.**

---

## Running locally

```bash
# Serve the site (required — ES module imports and fetch() need a server)
python -m http.server 5555
# then open http://localhost:5555

# Run the test suite
npm test

# Regenerate Elo seed (run once before the tournament, or after a major rating shift)
python scripts/fetch-elo.py

# Pull in the latest scores from the openfootball feed
python scripts/update-results.py
```

No build step, no bundler, no framework. Pure ES modules served directly.

---

## Deploying to GitHub Pages

1. Push to `main` — the `deploy.yml` Action uploads the repo root as a static Pages artifact.
2. First-time setup: **Settings → Pages → Source → GitHub Actions → Save**.
3. For live score updates during the tournament, ensure the `update-results.yml` Action is enabled (cron fires every 2 hours while the repo has recent Activity).

---

## Data sources

| Source | Used for |
|--------|---------|
| [eloratings.net](https://www.eloratings.net) `World.tsv` | Pre-tournament Elo ratings |
| [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) | Fixture list and live match scores |
| [flagcdn.com](https://flagcdn.com) | Country flag images (no API key) |

---

## Changelog

### v1.0.0 — 2026-06-12

Initial release. Full end-to-end implementation across 5 sessions:

- **Data pipeline** — 3-layer fetch/merge/cache, team-name normalization for all 48 canonical teams, GitHub Action for automated score commits
- **Ratings** — Elo seed via `fetch-elo.py`, attack/defense conversion, in-tournament blowout-damped update
- **Model** — Poisson + Dixon-Coles scoreline matrix, expected goals with host/rest/travel/ET adjustments, W/D/L odds, most-likely score
- **Tournament logic** — full FIFA 2026 tiebreaker cascade, cross-group third-place ranking, R32 slot assignment via bipartite matching
- **Monte Carlo engine** — Web Worker, mulberry32 seeded RNG, 10k–50k full tournament simulations
- **UI** — Fixtures tab (results + prediction bars), Standings tab (live group tables + W%), Bracket tab (leaderboard by round + parameter sliders)
- **Deploy** — GitHub Pages via `actions/deploy-pages`, auto-triggered on every push to `main`
