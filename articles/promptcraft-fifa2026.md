# Building a Live World Cup Probability Engine with Claude

**Tagline:** A football prediction model, a Monte Carlo simulator, and the bracket problem that didn't have a clean answer.

**Tags:** Claude, AI-Assisted Build, Football Analytics, Monte Carlo, Web Architecture, Promptcraft

---

*The product story — what the tracker does, who it's for, and how to use the what-if sliders — is on Build This Next: [FIFA World Cup 2026: What Actually Happens Next](https://buildthisnext.online)*

*This is the build story. How the model works, how Claude put it all together, and the one problem that turned out not to have a perfect solution.*

---

The idea going in was straightforward:

> A World Cup probability tracker is just a series of match predictions chained together

That turned out to be right — and much more complicated than it sounds.

---

## The Architecture

Claude kept three things deliberately separate.

**The model** — the maths that predicts individual match outcomes. Given two teams and a set of parameters, it returns win/draw/loss probabilities and an expected scoreline. Runs instantly. Completely isolated from everything else.

**The simulator** — a process that runs the entire 104-match tournament thousands of times, varying outcomes according to those probabilities, and tallies up how often each team reaches each round. Runs in the background so it doesn't freeze the page.

**The interface** — a single HTML file with no server, no framework, and no ongoing cost. Four tabs, a live data feed, and five sliders that let you change the model's assumptions.

Keeping these three things separate was the right architectural call. A change to the model doesn't touch the simulator. A change to the interface doesn't require re-running anything. They talk to each other through clean handoffs.

---

## The Model

### Why Poisson — and why that's not the whole story

Football scores are discrete numbers — 0, 1, 2, 3 goals. The Poisson distribution is a standard statistical tool for modelling how many times something rare happens in a fixed window. It fits football well.

The basic version has a known problem, though: it predicts too few low-scoring draws. A 0-0 or 1-1 in real football happens more often than the pure maths suggests. Dixon and Coles, two statisticians, worked out a correction for this in 1997. Claude implemented it:

```
If the score is 0-0: multiply the probability by (1 − λA × λB × τ)
If the score is 1-0: multiply by (1 + λA × τ)
If the score is 0-1: multiply by (1 + λB × τ)
If the score is 1-1: multiply by (1 − τ)
All other scores: unchanged
```

`λA` and `λB` are the expected goals for each team. `τ` is the draw correction parameter — it's one of the five user-facing sliders. Set it to zero and you get raw Poisson. More negative means more draws.

### Where the team strengths come from

The model is seeded from Elo ratings — the same system used in chess, adapted for international football. Every national team gets a number: higher means stronger. The gap between two teams' Elo scores drives the expected goals calculation.

Claude fetched these ratings from eloratings.net. The data comes as a tab-separated text file with the site's own two-letter country codes — SQ for Scotland, EN for England, and so on. Mapping those codes to the match feed's canonical team names required a careful normalisation step. A few names caused problems: Curaçao, Côte d'Ivoire, and Bosnia & Herzegovina all had encoding mismatches that produced null predictions until Claude caught and fixed them.

### The adjustable parameters

Beyond raw team strength, the model applies three real-world factors — all user-controllable:

- **Home advantage (γ)**: Mexico, USA, and Canada are playing in their own backyard. This parameter adds a scoring boost for them.
- **Rest advantage (δ)**: Applied when one team has had significantly more recovery time — five or more days more than their opponent.
- **Extra time penalty**: If a team just played 120 minutes in their last match, this shaves their expected output in the next one.

---

## The Simulator

### Monte Carlo in the background

Running one prediction for one match is fast. Running 10,000 complete tournaments — each with 104 matches, each match sampled from a probability distribution — is not something you want blocking the main page.

Claude put the simulator in a Web Worker: a background process that runs separately from the interface. The main page sends it the match data, the parameters, and the number of runs. The worker sends back the results when it's done. The interface stays responsive throughout.

The output for each simulation run is simple: for each team, did they reach each round? Tally those across all runs and you get a percentage — the probability of that team reaching that stage across all possible tournament paths.

### The discrete simulation slider

The number of simulations is itself a slider — but not a continuous one. Claude mapped it to four fixed values: 1,000, 10,000, 25,000, and 50,000. The slider has four positions. Picking in between isn't useful when the meaningful choices are "fast and rough" versus "slow and precise."

---

## The Data Pipeline

Match data flows through three layers:

**Live feed** → the openfootball project on GitHub maintains a structured file of World Cup results that updates as matches are played.

**results.json** → a daily automated process fetches the live feed and commits the latest scores to this repo. This is what the app actually reads.

**localStorage** → on first load, the app caches the data locally so it works offline on repeat visits.

The fixture schedule — which holds the bracket structure — is separate. It contains placeholder values like `W73` (winner of match 73) and `1A` (Group A winner) that get resolved at display time.

---

## The Hard Problems

### Third-place qualification

48 teams. 12 groups of 4. The top 2 from each group advance automatically — that's 24 teams. The remaining 8 spots in the Round of 32 go to the 8 best third-place finishers from across all 12 groups.

Ranking those 12 third-place teams fairly requires a specific tiebreaker sequence: points, then goal difference, then goals scored, then disciplinary record, then drawing of lots. Claude implemented this exactly.

Then those 8 teams have to be slotted into specific bracket positions — and *which* position depends on which groups they came from. FIFA has a defined rule for this. Claude implemented the slot-assignment logic and cross-checked it against the known historical format.

Getting this wrong produces a bracket that looks correct but isn't. There's no obvious error message — the results are just subtly wrong.

### Resolving the bracket step by step

Predicting the knockout bracket requires working through rounds in order. You can't predict the quarter-finals until you know who's in the Round of 16. You can't know that until you've resolved the Round of 32. And so on.

Claude's `buildPredictedDraw` function works through each round in sequence — resolving placeholder names like `W73` into actual team names, then running a head-to-head prediction to determine the winner, then passing that winner forward into the next round.

```
Round of 32 → Round of 16 → Quarter-final → Semi-final → Final
```

Each step depends on the previous one. Sequential, not parallel. And it has to handle the mix of real results (for completed matches) and predictions (for everything still to come) correctly at every step.

### The Stage Probabilities vs Tournament Draw problem

This turned out to be the most interesting problem — and the one that didn't have a clean solution.

**Stage Probabilities** runs 10,000 simulated tournaments. In each run, group outcomes vary. England might face an easy opponent in the Round of 16 in some runs and get France in others. The 25% QF probability for England is an average across all of those paths.

**Tournament Draw** shows one specific predicted bracket — the most likely group outcomes lead to specific matchups, and the model picks one winner per match from there. In that specific bracket, England might face France in the Round of 16 and lose (the model gives France a 60% win chance head-to-head). England doesn't reach the QF in the bracket.

Both numbers are correct. They answer different questions.

Claude tried two approaches to make them agree:

**Approach 1**: Use each team's simulated QF probability directly to decide bracket winners — the team with the higher simulated probability of reaching the next round advances. This improved things but still produced one mismatch, because a team's absolute QF probability combines two things: how likely they are to *reach* the Round of 16, and how likely they are to *win* their Round of 16 match. Those are different.

**Approach 2**: Use the *conditional* probability instead — for a Round of 16 match, compare each team's QF probability divided by their R16 probability. This gives "given you're already here, how often do you advance?" More correct in theory — but in practice it made things worse, because the teams each team faces in the simulation vary across runs. England's conditional win rate is averaged across many different opponents, not just the one they face in this specific bracket.

The truly correct fix would require the simulation to track who won each specific match in each run — not just which teams reached each round. That's a more significant change to the simulation engine.

The pragmatic fix: Claude reverted to head-to-head match prediction for bracket winners (internally consistent), re-wired the bracket to re-render *after* the simulation completes rather than before (a timing bug that was causing stale data to be used), and added an explanation in the interface itself:

> *Tournament Draw shows the single most-likely bracket path. Stage Probabilities aggregates 10,000 simulated tournaments where group outcomes also vary. A team can have a high QF% overall yet lose in this specific bracket draw — both are correct, they answer different questions.*

Sometimes the right answer is to explain the limitation honestly rather than paper over it.

---

## The Interface

### Header redesign

The original design had model parameters in a sidebar. Claude moved them into the header itself — five parameter boxes in a row, always visible, taking up the rightmost 72% of the header bar. The left side holds the brand and live status. The middle holds the Current / Prediction mode toggle.

This keeps the parameters in view without taking up page space below the header. The full width below is for the actual content.

### Mobile

A five-column fixture grid (one date column, four match columns) at 430px screen width gives each match card about 87 pixels. Unusable.

Claude added a breakpoint at 500px that switches the fixture grid to `display: block` — single column, each match card full width, date labels becoming full-width section dividers. No JavaScript change needed: the CSS `display: block` context simply ignores the inline `grid-row: span N` values set by JavaScript. The layout adapts correctly from that alone.

---

## What Building This Way Actually Means

The model is a few hundred lines. The simulator is a few hundred more. The bracket resolution is the most complex piece.

None of those numbers are the interesting part.

The interesting part is every decision that preceded the code: what does "prediction mode" mean when half the tournament has already been played? When Stage Probabilities and Tournament Draw show different teams in the quarter-finals — is that a bug, a limitation to explain, or a feature that reflects two genuinely different questions? What should happen when you change the home advantage slider — what *exactly* needs to update, and what should stay fixed?

Those aren't coding questions. They're product questions that only then become coding questions.

Building with Claude means those upstream decisions matter more, not less. Claude can implement the answer quickly once the question is clear. The work is getting the question right.

---

*Promptcraft is where the work of building with GenAI gets documented — what works, what doesn't, and where the tools still fall short.*

*The product story is on Build This Next: [FIFA World Cup 2026: What Actually Happens Next](https://buildthisnext.online)*

*Source: [BuildThisNextOnline/FIFA-2026-WC on GitHub](https://github.com/BuildThisNextOnline/FIFA-2026-WC)*

---

> If this improved how you think about building with AI, [subscribe to Promptcraft](https://promptcraftai.substack.com) — it's the only signal I get that this work is worth continuing.
>
> And if it gave you something useful, share it. It might change how someone else approaches their next build.
