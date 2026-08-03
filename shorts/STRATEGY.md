# Bridge Shorts — Strategy

> Companion to [`README.md`](README.md) (which covers setup and layout). This doc covers
> *why* Shorts exists, what it should feel like, and how we'd know it's working.
>
> Sections marked **[built]** describe what exists today. Sections marked **[argument]**
> are the strategic case, not shipped fact.

---

## The one-liner

**Shorts is a public, playable proof of Bridge's thesis: the interesting question is no
longer "can you code?" — it's "how well do you build with AI?"**

One challenge per week. Everyone gets the same brief, the same token budget, and the same
clock. You build with AI in the browser, submit, and the crowd votes. A leaderboard ranks
the results.

---

## Why this matters strategically **[argument]**

### 1. It's the thesis, made tangible
Bridge sells employers on a claim that is easy to say and hard to feel: *AI changed what
technical talent means, so it should change how you measure it.* A hiring deck can assert
that. A leaderboard where the best builder plainly beat the fastest typist **demonstrates**
it. Shorts turns an abstract pitch into something a skeptical VP Eng can play in five
minutes and immediately understand.

### 2. Distribution B2B can't buy
Enterprise assessment tooling is a slow, referral-driven sale with a brutal cold start.
A consumer product with a weekly cadence generates something the sales motion cannot:
**recurring, organic attention from exactly the audience employers are trying to reach.**
Every submission is a shareable artifact with its own URL. Every leaderboard is a reason
to come back. That compounds; outbound doesn't.

### 3. A data flywheel pointed at our hardest problem
The genuinely difficult part of Bridge's assessment product is **scoring workflow** —
prompt quality, decomposition, iteration efficiency, knowing when to stop. That rubric is
currently informed by judgment.

Shorts produces, at consumer volume, exactly the labeled data that problem needs:
a full prompt-by-prompt trace, token spend, time-to-working-app — paired with an
independent **human quality signal** from pairwise voting. That's a rare dataset:
*process* joined to *crowd-judged outcome*. It should make the assessment scoring
measurably better over time.

### 4. A warm, pre-ranked talent pool
Someone who consistently ranks top-10 in Shorts has publicly demonstrated the precise
skill employers are trying to hire for, under time and budget pressure, judged by peers.
That is a stronger signal than a résumé and it arrives inbound and self-selected. We are
not building this pipeline yet — but the option value is real and it costs nothing extra
to preserve.

### 5. A low-stakes proving ground for shared infrastructure
Shorts and assessments share real machinery: E2B sandboxes, the metered LLM proxy, preview
serving, snapshotting. Shorts stresses all of it under consumer traffic where the cost of
a bad day is an annoyed player, not a failed enterprise evaluation. Serverless make mode
came directly out of this pressure — and the lessons transfer back.

---

## What the product is **[built]**

**No signup.** A browser id (`anonymousId`) is your identity. Accounts are optional and
exist only to link history across devices.

**The loop:**

1. **Read the brief.** One published challenge per period (weekly today; daily is a
   one-env-var switch).
2. **Build by chatting.** Describe what you want; AI writes it; a live preview sits
   beside the chat (desktop) or streams as preview cards (mobile). Mobile is a
   first-class surface, not an afterthought.
3. **Feel the constraints.** A **token budget** (~50k) and a **wall clock** (10–30 min).
   Both meters are always visible.
4. **Submit** with a display name. You may submit more than once; each entry ranks
   independently.
5. **Vote.** Five pairwise head-to-heads — *this one or that one* — then a ranking recap.
   You must have submitted that period to vote, and you never judge your own work.
6. **Rank.** A Bayesian (TrueSkill-style) rating; the board sorts by a conservative
   μ−3σ score, so a build must win repeatedly, not once.

**Two build engines**, chosen per challenge from the admin page:

| | E2B sandbox | Serverless |
|---|---|---|
| Engine | Claude Code in a real sandbox | One direct Anthropic call |
| Output | true multi-file project | single self-contained HTML |
| Ceiling | higher — real projects | lower — one page |
| Cost / concurrency | expensive, capped seats | cheap, uncapped |
| Best for | ambitious rounds | mass-participation rounds |

This is a genuine strategic lever, not just plumbing: **serverless makes it economically
possible to open a round to everyone**, while E2B keeps the ceiling high when a challenge
deserves it.

---

## The constraint *is* the game **[argument]**

The token budget is the most important design decision in the product, and it's worth
being explicit about why.

Remove the budget and Shorts becomes a typing race — whoever nags the model most wins.
Keep it, and the winning move becomes **thinking before prompting**: a clear brief, good
decomposition, knowing when the thing is done. That is precisely the skill Bridge claims
to measure. The scarcity isn't a cost-control hack that happens to be interesting; it's
the mechanic that makes the game *about* the right thing.

Same logic for the clock. Ten minutes rewards scoping; unlimited time rewards obsession.

---

## Challenge design

**Categories in the schema today:** `widget` · `game` · `tool` · `other`.

**Shapes that work:**

- **Widget** — a small thing that's pleasant to use. Countdown, unit converter, habit
  tracker, weather card.
- **Game** — playable inside a minute. Reaction test, memory match, one-screen arcade.
- **Tool** — does an actual job. Color palette generator, regex tester, markdown→slides.
- **Constraint twist** — the fun is the limit. *One color only. No text. Must work
  one-handed on a phone.*
- **Live data** — hit a public keyless API (serverless mode explicitly permits CDN
  libraries and keyless APIs).
- **Remix** — rebuild or improve last round's winner. Great for a returning audience.

**A challenge is good when it is:**

1. **Sayable in one sentence.** If the brief needs a spec, it's an assessment, not a Short.
2. **Finishable in the window** — by a median player, not by us.
3. **Judgeable in ten seconds.** This is the constraint people forget. Voting is a
   snap pairwise judgment, so entries must differ *visibly or interactively*. A
   challenge whose quality is buried in code architecture cannot be voted on — it can
   only be graded, which is a different product.
4. **Open enough that taste separates entries.** If every correct answer converges on the
   same screen, there's nothing to vote on. Ambiguity is a feature.

**Cadence:** weekly is the right default. Daily (Wordle-style) demands a daily habit we
haven't earned yet and burns editorial effort fast — challenge curation is real work, and
quality collapses if it's rushed. Weekly also gives each round enough votes to produce a
meaningful ranking.

---

## Why we're doing this **[argument]**

The honest version:

**The old signal died and nobody has replaced it.** Take-homes and algorithm puzzles
measured unaided from-scratch coding. That skill is now largely commoditized — everyone
has a model. What separates people is judgment, taste, decomposition, iteration speed, and
knowing when it's good enough. Nobody has a credible, *enjoyable* way to measure that.

**Bridge's bet is to measure the workflow, not the artifact.** Shorts is the smallest,
most public expression of that bet — and it tests something the enterprise product can
never prove on its own: **that people will do this voluntarily, for fun.** Take-homes are
resented. If builders opt into a timed, budgeted, publicly-judged build *for sport*, the
underlying format is validated in a way no sales call can validate it.

**And it's a position, not just a funnel.** "Bridge is where AI-native builders hang out
and compete" is a far more defensible identity than "another assessment vendor." The
assessment product is what we sell; Shorts is who we are.

---

## Risks and open questions

Worth naming honestly:

- **Unit cost scales with players.** Every session spends real tokens. Serverless mode
  and the budget cap contain this, but a viral round is a bill. Know the ceiling per round
  before promoting one.
- **Voting quality.** Pairwise voting is gameable (alt browsers, brigading) and biased
  toward the immediately flashy over the genuinely clever. The submit-to-vote requirement
  and self-exclusion help; they don't solve it.
- **Cold start.** A leaderboard with four entries isn't a leaderboard. Early rounds need
  seeding and a real audience push, or the loop never catches.
- **Editorial burden.** Challenge quality *is* the product. One boring week is survivable;
  a boring month is fatal. Someone has to own this.
- **Conversion is unproven.** The line from "casual player" to "employer revenue" or
  "placed candidate" is currently a hypothesis. Worth building anyway for the brand and
  data value — but we shouldn't pretend the funnel is validated.

---

## What "working" looks like

Rough signals, in rough priority order:

1. **Return rate** — do players come back for the next round? This is the one that matters.
   Everything else is downstream.
2. **Completion rate** — of sessions started, how many submit? Low completion means the
   budget or clock is mis-tuned, or the brief was unclear.
3. **Votes per submission** — enough for rankings to mean something.
4. **Sharing** — do submission links get posted anywhere on their own?
5. **Inbound interest** — employers or candidates arriving *because of* Shorts.

If (1) holds and (2) is healthy, the rest is tuning. If (1) fails, the challenges are the
problem, not the tech.
