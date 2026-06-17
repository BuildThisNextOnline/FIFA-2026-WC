# World Cup 2026 Probability Tracker

Live probability dashboard for FIFA World Cup 2026 (Canada / USA / Mexico, 48 teams, Jun 11 – Jul 19, 2026). Updates automatically as matches are played — recomputes per-match predictions and per-team advancement probabilities for the entire remaining tournament.

**Live site:** https://BuildThisNextOnline.github.io/FIFA-2026-WC/

---

## What it shows

| Tab | What you see |
|-----|-------------|
| **Fixtures** | All 104 matches with flags · actual results for played matches · W/D/L probability bars + expected score for upcoming matches |
| **Standings** | Live group tables for all 12 groups · champion probability per team from Monte Carlo simulation |
| **Stage Probabilities** | All 48 teams × 6 rounds simultaneously (Qualify → R16 → QF → SF → Final → Champion) · sorted by probability |
| **Tournament Draw** | Visual knockout bracket · actual results lock in completed matches · model predicts remaining matchups |

### Current vs Prediction mode

The header has two modes, always visible:

- **Current** — shows live match data and actual results only
- **Prediction** — overlays model predictions on upcoming matches and runs the full knockout bracket

Five model parameters live in the header, always accessible regardless of which tab is active.

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

Teams start from [World Football Elo ratings](https://www.eloratings.net) (scraped via `scripts/fetch-elo.py` from the `World.tsv` endpoint). Each team's Elo is converted symmetrically to attack/defense strength:

```
attack = defense = (Elo − meanElo) / ELO_SCALE    (ELO_SCALE = 810)
```

After each played match, ratings update based on effective goal margin (blowout-damped above 3 goals).

### Match prediction model

**Poisson + Dixon-Coles (1997).** For each match, computes expected goals:

```
log(λ_A) = μ + attack_A − defense_B + γ·hostBonus + δ·restDiff − ET_A
```

Then builds an 11 × 11 scoreline probability matrix. The Dixon-Coles correction multiplies the four low-score cells (0-0, 1-0, 0-1, 1-1) by a factor controlled by τ ≤ 0, which boosts draw probability to correct Poisson's known underestimation. W/D/L odds are the sums of the upper triangle, diagonal, and lower triangle.

**Tunable parameters** (five sliders in the header, always visible):

| Parameter | Default | Effect |
|-----------|---------|--------|
| Home advantage (γ) | +20% | Scoring boost for Mexico / USA / Canada at home venues |
| Draw correction (τ) | −10% | Low-score correction; more negative = more draws |
| Rest advantage (δ) | +5% | Benefit per significant rest gap (5+ days difference) |
| ET fatigue | −10% | Penalty for teams coming off extra time or penalties |
| Simulations (N) | 10,000 | Monte Carlo runs; discrete steps: 1k / 10k / 25k / 50k |

### Monte Carlo simulation

A **Web Worker** (`js/simworker.js`) runs N complete tournament simulations in the background so the UI stays responsive. Each run:

1. **Group stage** — simulate remaining matches by sampling goals from Poisson(λ) independently
2. **Group rankings** — apply the full FIFA 2026 tiebreaker cascade: points → GD → GF → H2H points → H2H GD → H2H GF → drawing of lots
3. **Third-place** — rank all 12 third-place finishers cross-group; select the best 8; assign to R32 slots per FIFA rules
4. **Knockout rounds** — R32 → R16 → QF → SF → Final; draws resolved by 50/50 coin-flip
5. **Accumulate** — per-team counts of reaching each round, divided by N to produce probabilities

RNG: **mulberry32** — fast 32-bit seeded generator with good uniformity.

### Stage Probabilities vs Tournament Draw

These two tabs intentionally show different things and will sometimes list different teams at advanced rounds:

- **Stage Probabilities** aggregates 10,000 simulated tournaments where group outcomes vary. A team's QF% is an average across all simulated paths — some with easy draws, some with hard ones.
- **Tournament Draw** shows one specific predicted bracket: the most likely group outcomes → fixed matchups → head-to-head Poisson winner at each step.

Both are correct. They answer different questions.

---

## Repository layout

```
index.html                  Single-page app (ES modules, no build step)
css/
  styles.css                All styles (responsive, dark theme)
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
articles/
  buildthisnext-fifa2026.html   Product write-up (Build This Next)
  promptcraft-fifa2026.html     Technical write-up (Promptcraft)
  buildthisnext-fifa2026.md     Source markdown
  promptcraft-fifa2026.md       Source markdown
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

# Regenerate Elo seed
python scripts/fetch-elo.py

# Pull in the latest scores from the openfootball feed
python scripts/update-results.py
```

No build step, no bundler, no framework. Pure ES modules served directly.

---

## Data sources

| Source | Used for |
|--------|---------|
| [eloratings.net](https://www.eloratings.net) `World.tsv` | Pre-tournament Elo ratings |
| [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) | Fixture list and live match scores |
| [flagcdn.com](https://flagcdn.com) | Country flag images (no API key) |

---

## Changelog

### v2.0.0 — 2026-06-17

Full UI/UX overhaul. Model and data pipeline unchanged from v1.

- **Header redesign** — three-zone layout: brand/status · Current mode button · Prediction mode + 5 parameter sliders + Apply button. Parameters are now always visible regardless of active tab.
- **4-tab layout** — Fixtures · Standings · Stage Probabilities · Tournament Draw (was 3 tabs; Bracket renamed and split into two dedicated views)
- **Stage Probabilities** — redesigned as a 6-column grid showing all 48 teams × all 6 rounds simultaneously
- **Tournament Draw** — SVG bracket, fully responsive, country abbreviations for long names, champion box, explanatory note on Stage Probabilities divergence
- **Current / Prediction toggle** — colour-differentiated buttons; Apply disables after click, re-enables on any slider change
- **Parameter sliders** — snapped to labeled tick values only; N is discrete (1k / 10k / 25k / 50k); default hints shown per parameter
- **Mobile layout** — fixture grid switches to single-column below 500px
- **Analytics** — GoatCounter page view tracking
- **Favicon** — inline SVG ⚽ emoji, no image file required

### v1.0.0 — 2026-06-12

Initial release. Full end-to-end implementation:

- **Data pipeline** — 3-layer fetch/merge/cache, team-name normalization, GitHub Action for automated score commits
- **Ratings** — Elo seed, attack/defense conversion, in-tournament blowout-damped update
- **Model** — Poisson + Dixon-Coles scoreline matrix, expected goals with host/rest/ET adjustments
- **Tournament logic** — full FIFA 2026 tiebreaker cascade, cross-group third-place ranking, R32 slot assignment
- **Monte Carlo engine** — Web Worker, mulberry32 RNG, 10k–50k full tournament simulations
- **UI** — Fixtures, Standings, Bracket tabs
- **Deploy** — GitHub Pages via Actions, auto-triggered on push to main
