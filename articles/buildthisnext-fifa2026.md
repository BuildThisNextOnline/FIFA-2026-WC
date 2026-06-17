# FIFA World Cup 2026: What Actually Happens Next

**Tagline:** A live probability tracker that updates as the tournament does — and lets you argue with the model.

**Tags:** World Cup 2026, Football, Sports Tech, Tools, What-If

---

Every four years, the same thing happens.

A pundit on TV tells you Spain are favourites. The betting site gives you odds you don't know how to interpret. Your group chat argues about whether France can win without Mbappé playing well. Someone insists England will bottle it.

Everyone has opinions. Nobody has a model.

That bothered me. So I built one — with Claude.

---

## What the tracker does

The **FIFA World Cup 2026 Probability Tracker** does two things simultaneously.

**Current mode** shows you the state of the tournament right now — actual results, group standings, who's qualified and who's out. Updated from live match data as games are played.

**Prediction mode** shows you what the model thinks happens next — win probabilities for every remaining match, expected scores, who finishes where in each group, and a full knockout bracket all the way to the champion.

Both views sit in the same interface. One click switches between them.

The tracker covers all 104 matches across 48 teams, grouped A through L. As matches are played, the prediction window shrinks — by the time you reach the Final, there's only one match left to call.

---

## Why this is more useful than odds

Betting odds tell you what the market thinks. That's useful — but it's not the same as a model with a theory.

The tracker is built on a football statistics technique called Poisson modelling — essentially, a mathematical way of estimating how many goals each team is likely to score, based on how strong they are relative to each other.

It's seeded from Elo ratings (the same system used in chess) which give every national team a baseline strength score. From there, the model applies real-world adjustments that matter in a World Cup:

- **Home ground**: Mexico, USA, and Canada get a boost on home soil
- **Rest between matches**: teams with more recovery days tend to score more
- **Extra time fatigue**: if a team just played 120 minutes, the next game is harder

You can change all of those assumptions. That's the point.

---

## The five sliders that make this yours

The parameters panel in the header isn't decoration. It's where you put in your own read on the tournament.

**Home advantage** — How much does playing in North America boost the host nations? The default is +20%. Set it to zero if you think home crowds don't matter. Crank it up if you think they'll be decisive.

**Draw correction** — The model naturally predicts slightly too few draws. This slider corrects for that. The default adds a modest nudge toward 1-1 and 0-0 results.

**Rest advantage** — Teams with more recovery days perform better. Default is +5% per significant rest gap.

**Extra time fatigue** — Did a team just play 120 gruelling minutes? The default applies a −10% penalty to their next match.

**Simulations** — The model runs thousands of complete simulated tournaments to estimate probabilities. 1,000 runs is fast and rough. 50,000 is slow and precise. The default is 10,000 — a good balance.

Change any slider. Hit **Apply**. Every fixture, every table, the full bracket — everything updates to your assumptions in seconds.

---

## Two views worth spending time in

**Stage Probabilities** strips away all the bracket narrative and shows you the raw numbers. All 48 teams, side by side, with their probability of reaching each round — Qualify, Round of 16, Quarter-final, Semi-final, Final, Champion. No punditry. No storylines. Just: here is what the model thinks, for every team.

**Tournament Draw** is the bracket. It shows you the single most-likely path — actual results where matches have been played, model predictions for everything still to come. You can see who the model has lifting the trophy, and who they'd have beaten to get there.

These two views will sometimes show different teams in the quarter-finals. That's not a bug.

> **Stage Probabilities** runs 10,000 simulated tournaments where groups can turn out differently in each run. A team can have a 25% QF chance overall because they reach the quarters across many different simulated paths — sometimes with an easy draw, sometimes not.
>
> **Tournament Draw** shows one specific predicted path. It anchors on the most likely group outcomes and predicts match by match from there.
>
> Both are correct. They answer different questions. The tracker says so, right there on the page.

---

## It gets more interesting as the tournament goes on

This is a *live* tracker, not a pre-tournament prediction frozen in amber.

When USA beat Paraguay 4-1, that result locks in. The model doesn't second-guess it. It takes the actual scoreline, updates the group table, and predicts forward from there.

By the quarter-finals, half the bracket is real. By the semis, almost everything is anchored in actual results. The model is only filling in the gaps.

This is where the tracker is most useful — not at the very start when everything is hypothetical, but mid-tournament, when you have real results to anchor to and real stakes on every remaining match.

---

## Try it

**Live at:** [buildthisnextonline.github.io/FIFA-2026-WC](https://buildthisnextonline.github.io/FIFA-2026-WC)

Change the sliders. Run your assumptions. See if your read on the tournament holds up.

Then send it to the group chat that's been arguing about the draw since January.

---

*Build This Next is about tools that fill real gaps — built fast, built properly, and put in front of people who need them.*

*The technical story behind how this was built with Claude — the model, the simulation engine, and what bracket resolution actually involves — is on Promptcraft.*
