# Competitive analysis — Bridge assessments (August 2026)

Scope: the assessments product as it exists in this repo today. Shorts is covered
separately at the end because it competes in a different market.

---

## 1. What we actually sell today

Stripping the marketing away, the product is four layers stacked:

| Layer | What it does | How defensible |
|---|---|---|
| **Assessment authoring** | JD → AI-generated assessment, behavioral checks, starter files | Commodity. Everyone has this. |
| **Evidence capture** | `capture-kit` hooks stream prompts / tool calls / replies / git snapshots from the candidate's own machine; optional screen recording for playback | **Differentiated**, but flag-gated |
| **Grading** | E2B behavioral grading (does the app run?), episode segmentation, deterministic metrics, evidence-validated rubric verdicts | **Strongest layer, least marketed** |
| **Voice** | ElevenLabs in-session companion + post-submit interview, fed live by the context center | **Differentiated combination**, commodity components |

The thesis is coherent: *judge the process and the product, not the keystrokes.*
The problem is that three of the four layers are either commodity or turned off by
default (`WORKFLOW_CAPTURE_ENABLED=false`, `evidenceMode: none`).

---

## 2. The category got real in April 2026 — and the biggest player named it

CodeSignal shipped **Agentic Coding Assessments** in April 2026, explicitly built
around Claude Code, Cursor and Codex, with a survey claiming 91% of US engineers
already use agentic tools and 75% have shipped partially AI-generated production
code. HackerRank shipped AI-Assisted Interviews in July 2025.

Read this two ways:

- **Good:** the market no longer has to be educated. "Let them use AI and grade how
  they use it" is now the incumbent narrative, not a contrarian bet. Nobody has to
  be convinced the old take-home is dead.
- **Bad:** the window to own the category label closed. The remaining wedge is
  *architectural*, not conceptual.

### The architectural wedge is real and it is narrow

CodeSignal's assessments run inside a hosted browser IDE. Their own documentation
concedes they have **no authority or technical means to monitor other software
running on a candidate's machine**. What they can produce is a chat transcript plus
keystroke playback — a recording, not a structured event log.

That is the gap Bridge's capture kit sits in: the candidate's own repo, own editor,
own agent subscription, and a typed, sequenced, idempotent event stream that grading
can actually run over. It is a genuine technical difference, not positioning.

It is also a *narrow* gap, because it is exactly the gap one other startup has
already noticed.

---

## 3. Direct competitor: Promptster

This is the closest thing to a mirror of us in the market, and it should be treated
as the primary competitor rather than CodeSignal.

| | **Bridge (capture-kit)** | **Promptster** |
|---|---|---|
| Capture mechanism | Claude Code **hooks** in `.claude/settings.json`; file-store adapters for Codex + Cursor | **Proxy** in the model request path, written server-side |
| Tamper resistance | Candidate can delete the hooks; we optimise for a cooperative candidate | "Nothing on the candidate's machine produces it or can edit it afterward" |
| Tool coverage | Claude Code live; Codex + Cursor via reverse-engineered stores; Windsurf/Amp impossible | Claude Code, Cursor, Codex, Copilot |
| Candidate setup | `node capture-kit/setup.js <token>`, consent, trust folder | `promptster start PST-XXXX-XXXX` |
| Rubric | Criteria + episodes + deterministic metrics + evidence validator | 8 named dimensions (task framing, direction quality, steering, verification loop, fix integrity, context management, ecosystem leverage, comprehension), tiered not numeric, each linked to a replay moment |
| Verifies the built thing runs | **Yes — E2B behavioral grading** | Not claimed |
| Voice interrogation | **Yes — live + post-submit, grounded in the capture** | Not claimed |
| Pricing | Stripe subscription, no public agentic tier | $199/mo founding rate locked to 2028, 12 teams, first 3 sessions free |
| Stage | Prototype behind two flags, no reviewer UI for the timeline | Shipped, sold, named rubric, comparison pages ranking for competitor keywords |

**The uncomfortable read:** Promptster is behind us on capability and ahead of us on
product. They have a named rubric, a price, a founding-customer motion, and SEO
pages targeting `vs/codesignal`. We have a better evidence pipeline sitting behind
`WORKFLOW_CAPTURE_ENABLED=false` with, per our own README, "no UI yet."

**Where they beat us architecturally:** the proxy is unforgeable and covers Cursor
properly. Our Cursor path reads a reverse-engineered SQLite store that already broke
once between Cursor 2.6 and 3.0. Their tradeoff is being in the critical path of
someone else's machine and handling keys — a real cost, but one enterprise buyers
will accept in exchange for "the candidate cannot edit the record."

---

## 4. The rest of the map

**Incumbent screeners — HackerRank, CodeSignal, Codility, CoderPad, Karat.**
Own the buyer relationship, the ATS integrations, the question libraries, the
procurement checkbox. Pricing anchors the market low: Codility ~$10/invite at the
starter tier, CoderPad $120/mo for 5 tests then $25 each. Volume screening is theirs
and is not winnable. They are structurally blocked from real-environment capture.

**Take-home platforms — CodeSubmit, Qualified, Devskiller, Hatchways, Byteboard.**
Qualified already does own-IDE tests with code playback; Hatchways does GitHub PR-shaped
tasks. Closest to our submission flow, furthest from our evidence thesis. They will
bolt on "AI usage insights" before they rebuild capture.

**AI interview layer — Mercor, Micro1, Apriora, HeyMilo, Braintrust AIR, Metaview.**
Crowded and commoditizing fast. Our ElevenLabs interview is *not* a differentiator on
its own. It becomes one only because of the context center: an interviewer that reads
episodes, deterministic metrics and the live timeline, and can ask about what the
candidate did ten minutes ago. That grounding is rare. The voice is not.

**AI-code detection — Coderbyte flags, exceeds.ai, various.**
The opposite thesis, and a shrinking one as norms flip from "detect AI" to "grade AI
use." Worth watching only as a source of buyer FUD we have to answer.

---

## 5. Honest assessment of our position

### Real advantages, ranked

1. **The evidence validator.** Checking every citation in a verdict against the
   captured timeline and dropping what cannot be matched — marking a verdict
   non-evaluable rather than scoring on fabrication. No competitor mentions anything
   like it. This is the difference between "an LLM said the candidate did X" and
   evidence an employer can defend in a rejection conversation. It is the most
   sellable thing we have built and it is invisible in our own positioning.
2. **E2B behavioral grading.** Nobody else in the agentic-assessment set claims to
   run the candidate's submission and judge observable behavior with a tool-using
   judge. "It works" plus "here is how they got there" is a two-signal product where
   competitors have one.
3. **Episodes.** Turning thousands of events into 15–40 narrative stretches with
   back-pointers to evidence is the right altitude for a human reviewer *and* for a
   voice agent. Computed once, persisted, text-only, cost independent of session
   length.
4. **Live agent context.** `GET /agent-context` reads mid-assessment. A companion
   that asks "why did you throw away that approach?" while it is still happening
   captures reasoning no post-hoc interview recovers.
5. **Deterministic metrics.** Read:edit ratio, verified-write ratio, low-effort-prompt
   ratio, median think time, agent-vs-human authorship, token usage — counted, not
   asked of a model. Free, reproducible, and they free the judge for interpretive
   calls. Promptster's eight dimensions are all model-judged.

### Real weaknesses, ranked

1. **The differentiator ships off.** Master switch off, `evidenceMode` defaults to
   `none`, capture kit self-described as a prototype, timeline reviewer surface thin.
   A competitor with half the capability and a price page beats this.
2. **No answer to the tamper question.** "Hooks are removable, we optimise for a
   cooperative candidate" is a defensible engineering position and an indefensible
   sales position against a proxy vendor. Every enterprise buyer asks this in the
   first call.
3. **Cursor coverage is fragile.** Reverse-engineered store, already broke once,
   breaks silently on any Cursor update. Cursor is a large share of the candidate
   population.
4. **Two legacy pipelines we still carry.** The screen-recording + Gemini transcript
   path costs $3–22/session, has caused production OOMs, and the new thesis makes it
   obsolete for grading. It is now infrastructure for a human "watch the moment"
   feature only, at full ops cost.
5. **No go-to-market surface.** No ATS integration, no question library, no public
   pricing for the agentic product, no comparison content. Promptster ranks for our
   category keywords today.
6. **Split focus.** Shorts is a second product with its own frontend, E2B template,
   database, model allowlist and ranking system.

---

## 6. What I would do

1. **Make workflow capture the product, not a flag.** Default `evidenceMode` to
   `workflow` for new assessments, flip `WORKFLOW_CAPTURE_ENABLED` on, and build the
   reviewer timeline UI. Everything else is downstream of this.
2. **Ship an integrity report instead of arguing about tamper resistance.** We
   already compute capture completeness. Turn it into a first-class, visible artifact:
   coverage gaps, event-vs-snapshot divergence, hooks-stripped detection, unexplained
   silent stretches. Reframe from "our record is unforgeable" (which loses to a proxy)
   to "we show you exactly how complete the record is" (which a proxy does not do).
3. **Lead with the triangle nobody else has: process + product + interrogation.**
   Promptster grades the process. CodeSignal grades the artifact in a sandbox. We are
   the only one that captures the process, *runs the result*, and *interviews them
   about it* with the record in hand. That is the one-line pitch and it is currently
   unsaid.
4. **Sell the evidence validator explicitly.** "Every claim in this report is
   traceable to a timestamped moment, and claims that were not traceable were
   deleted" is a legal-defensibility story for a hiring decision. That is a
   procurement-grade argument.
5. **Price above the incumbents, not against them.** Codility is $10/invite for
   volume screening; that market is lost and undesirable. This is a senior-loop,
   final-round product. Per-assessment pricing in the $50–150 range with a small
   monthly floor, aimed at teams making 5–20 senior hires a year.
6. **Fix or drop Cursor.** Either invest in the store adapter as a maintained
   surface with a probe-on-update CI check, or say plainly that Cursor candidates use
   the screen path. Silent breakage is worse than an honest gap.
7. **Decide on Shorts.** It is either a top-of-funnel distribution engine for
   assessments — in which case wire the two together and measure conversion — or it is
   a second startup. Right now it is the second while being justified as the first.

---

## 7. Shorts — separate market, brief note

Shorts competes with vibe-coding jams and builder communities, not hiring platforms:
Cursor Vibe Jam 2026 (Pieter Levels, $40k prize pool, April–May 2026), the
vibecoding.app hackathon calendar, and the community surfaces of Lovable, Bolt,
Replit and v0 — all of which have vastly larger built-in distribution and their own
build tooling.

Differentiators we have: daily/weekly cadence rather than annual, pairwise voting
with Bayesian ranking rather than a jury, and a serverless make mode with no signup
friction. Structural disadvantage: no distribution, and the AI app builders can add a
daily challenge to an existing audience of millions in a sprint.

The honest question is not "is Shorts good" — it is whether a builder who plays
Shorts is ever a buyer or a candidate for the assessments product. If the answer is
no, the engineering time is a subsidy from the business that has a real wedge to one
that does not.

---

## Sources

- [CodeSignal launches agentic coding assessments (PR Newswire, April 2026)](https://www.prnewswire.com/news-releases/codesignal-launches-industry-first-agentic-coding-assessments-for-ai-era-engineering-hiring-302732265.html)
- [CodeSignal — Agentic AI Assessments](https://codesignal.com/agentic-assessments/)
- [CodeSignal Knowledge Base — Agentic Interviewing](https://support.codesignal.com/hc/en-us/articles/38841637349015-How-can-I-use-Agentic-Interviewing-in-my-recruiting-process)
- [CodeSignal's Agentic Assessments Signal a New Era for Technical Interviews (InterviewQuery)](https://www.interviewquery.com/p/codesignal-ai-assisted-technical-interviews)
- [Promptster](https://hire.promptster.ai/)
- [Promptster vs CodeSignal](https://hire.promptster.ai/vs/codesignal)
- [HackerRank — AI-Assisted Interviews](https://support.hackerrank.com/articles/5821380141-ai-assisted-interviews)
- [HackerRank vs Codility vs CoderPad for AI hiring (index.dev)](https://www.index.dev/blog/hackerrank-codility-coderpad-ai-hiring-comparison)
- [Codility cost 2026](https://interviewcost.com/codility-cost)
- [CoderPad pricing 2026](https://www.testtrick.com/blogs/coderpad-pricing-and-reviews)
- [CodeSubmit — coding assessment tools 2026](https://www.codesubmit.io/blog/coding-assessment-tools)
- [Cursor Vibe Jam 2026](https://vibej.am/2026/)
- [Vibe coding hackathon calendar](https://vibecoding.app/events/hackathons)
