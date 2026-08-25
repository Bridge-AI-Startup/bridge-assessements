# CLAUDE.md - BridgeAI Codebase Reference

## What This App Is

BridgeAI is a technical hiring assessment platform. Employers create take-home coding assessments from job descriptions using AI, share unique links with candidates, and then candidates submit their code via GitHub or a local archive. While the candidate works, an optional in-session ElevenLabs voice companion can capture their reasoning. Submissions are scored across process (how they worked) and behavioral (does the product pass checks) dimensions. Employers view results through an analytics dashboard with recordings, transcripts, and scoring breakdowns.

## Monorepo Structure

```
bridge-assessements/
├── client/          # React frontend (Vite + JSX/TS) — assessments product
├── shorts/client/     # React frontend — Shorts consumer app (separate Vercel deploy)
├── shorts/e2b-template/ # Custom E2B image for Shorts (Claude Code + static preview)
├── server/          # Express.js backend (TypeScript, run via tsx) — assessments + /api/shorts
├── capture-kit/     # Experimental: hooks-first AI-workflow capture run by candidates
├── notebooks/       # Jupyter notebooks (test-assessment-generation.ipynb)
├── package.json     # Root-level shared deps (firebase-admin, express-validator, @vercel/analytics)
└── *.md             # Documentation files
```

The client, shorts/client, shorts/e2b-template, and server each have their own `package.json` and `node_modules` where applicable. They are NOT managed by a workspace tool -- you must install dependencies and run commands independently in each directory.

## Shorts product (consumer daily challenge)

Separate promotional product — **not** part of hiring assessments. See [`shorts/README.md`](shorts/README.md).

> **Naming (Play → Shorts):** the product is **Shorts**. Frontend tree (`shorts/`), server dirs (`routes/shorts.ts`, `services/shorts/`, `models/shorts/`, `controllers/shorts/`), API namespace (`/api/shorts`), and env keys (`SHORTS_*`) all use `shorts`. For gradual migration the server still serves the legacy `/api/play` route alias and reads legacy `PLAY_*` env keys as a fallback via `server/src/utils/shortsEnv.ts`. **Deliberately unchanged** (bound to live data): the Mongo database `bridge-play` (`SHORTS_DB_NAME` default), Mongoose model names (`PlaySubmission`, `PlayChallenge`, `PlayBuildSession`, `PlayVote`, `PlayVoteRound`), the E2B template names `bridge-play-dev` / `bridge-play-v1`, and the legacy `play.bridge-jobs.com` CORS origin.

| Piece | Location | Deploy |
|-------|----------|--------|
| Frontend | `shorts/client/` | Vercel project #2 (root `shorts/client`), `shorts.bridge-jobs.com` |
| API | `server/src/routes/shorts.ts` | Same Render service as assessments (`/api/shorts/*`) |
| Database | `bridge-play` on same Atlas cluster | `SHORTS_DB_NAME` env var |
| Models | `server/src/models/shorts/` | Registered on Shorts Mongoose connection |
| E2B template | `shorts/e2b-template/` | Custom image `bridge-play-dev` / `bridge-play-v1` (no-cache preview :8080, Claude Code CLI; no code-server) |

- `SHORTS_ENABLED=false` by default — gates feature routes; `GET /api/shorts/health` is always on.
- Phase A (implemented): daily challenges, `GET /today`, Firebase-gated admin CRUD at `/admin/challenges/*`, Shorts client `Home` + `/Admin` page, build sessions (`POST/GET /session`) with E2B iframes on `/Build`, submit snapshot (`POST /submit`) + Admin Submissions tab (files + blob preview).
- **Challenge text is markdown.** Rendered by `shorts/client/src/components/Markdown.jsx` on Home, the Build chat intro, and as a live preview under the Admin challenge textarea. It is a dependency-free JSX renderer (no `dangerouslySetInnerHTML`) covering headings, bold/italic, inline + fenced code, ordered/unordered lists, blockquotes, rules, and links (`http(s)`/`mailto` only). Tables, images, and nested lists are **not** supported — swap in `react-markdown` if challenges ever need them; call sites only pass a `text` prop. The stored field is still `prompt` (API/schema); public copy calls it the **challenge**. **Prompt** is reserved for what the builder types to the model.
- Claude Code + token budget: Anthropic-compatible Messages proxy at `/session/:id/llm/v1/messages` (Bearer `llmProxyToken`, meters `tokensUsed` / `tokenBudget`); sandbox provisioned with `ANTHROPIC_BASE_URL` + session token (no user Anthropic login). Build page: desktop defaults to **Chat** mode (chat stream + live preview; toggle to **Studio** for Monaco + chat + preview); mobile (<768px) is always chat-first with change-triggered preview cards and a fullscreen interactive preview. Preference stored in `localStorage` (`playBuildLayout.v1`). Chat relay `POST /session/:id/claude/message` **claims a durable Mongo lock and returns 202 `{ turnId, status: "running" }` immediately**; generation runs in the same process (`services/shorts/turns.ts`) and the client polls `GET /session/:id/turn/:turnId`. Same prompt while a turn is running is idempotent (returns the existing turnId); a different prompt is **409**. A running turn older than 11 minutes is marked failed so a crash cannot stick the lock. E2B path still runs `claude -p` in the sandbox. Pause is skipped while `currentTurn.status === "running"` so leaving the tab cannot kill an in-flight E2B stream. Chat + workspace files persist on the session (refresh/resume within the build window; snapshot restore if sandbox dies). **No build clock:** a session runs until it is submitted or its challenge round ends (`expiresAt` = round end). Builds used to expire a fixed number of minutes after `startedAt`, which lost finished work while people typed a name or signed in; the per-build timer, its countdown UI, the warning/time's-up pop-ups and the submit-hold were all removed together. Leaving Build pauses the sandbox; paused sessions do **not** count toward `SHORTS_MAX_CONCURRENT_SESSIONS`. Requires `SHORTS_LLM_PROXY_PUBLIC_URL` (E2B cannot reach localhost). code-server and the `/session/:id/terminal*` PTY routes are **removed** — the Build UI is Monaco + Claude chat + preview iframe only.
- **Make mode (E2B vs serverless):** builds can be made two ways, selected per-session at creation via `challenge.makeMode` (admin toggle) → `SHORTS_MAKE_MODE` env → `e2b` default. **E2B** = sandbox + Claude Code (`claude -p`), true multi-file, sandbox static preview. **Serverless** = one direct Anthropic Messages call: a first BUILD returns a single self-contained `index.html` (CSS/JS inlined, CDN libs allowed); follow-up BUILDs prefer exact `*** SEARCH` / `*** REPLACE` / `*** END` patches (`htmlPatches.ts`) and fall back to a full document if a patch does not uniquely match. Stored on the session `workspaceSnapshot`, served by the backend at `GET /session/:id/preview` (no sandbox, no concurrency cap, no pause/resume). Downstream is identical because both produce `{ path, content }[]`. Serverless forces the chat-first Build layout (no Monaco/Studio) and hides the effort picker (the serverless call sends no `output_config.effort` — model still applies). The make mode is **not named in the Build UI**: `ModelEffortPicker`'s trigger used to carry a "Serverless" / "Claude Code" tag beside the model name, which read as a status badge rather than a control; it now reads `<model> · <effort> — change model ▾` so the pill advertises what clicking it does. Mode is stamped on the session (`PlayBuildSession.makeMode`) so flipping the toggle/env never mis-routes an active session. Serverless make lives in `server/src/services/shorts/serverlessMake.ts`.
- **Model allowlist + serverless-only models (`services/shorts/models.ts`):** `PLAY_MODEL_OPTIONS` drives both `GET /api/shorts/models` and the Build picker. The picker default is **Sonnet 4.5** (`DEFAULT_PLAY_MODEL_ID`) because Shorts' full-file serverless loop is latency-sensitive; Opus and Fable remain explicit slower choices. `SHORTS_ANTHROPIC_MODEL` still overrides the E2B CLI / unresolved-request fallback. An option flagged `serverlessOnly: true` is admitted **only** by `resolvePlayModel(raw, { serverless: true })` — every other caller (E2B `claude -p`, the CLI-facing Messages proxy) rewrites it to the default model, because the Shorts E2B template's Claude Code CLI rejects model ids it doesn't know. **Claude Fable 5** (`claude-fable-5`) is the first such model: Anthropic's most capable, $10/$50 per MTok (~3× Sonnet 4.5), thinking always on (never send a `thinking` param — it 400s) and billed inside `SERVERLESS_MAX_TOKENS`, and its safety classifiers can decline with HTTP 200 + `stop_reason: "refusal"`. The serverless call therefore sends `fallbacks: "default"` + beta `server-side-fallback-2026-07-01` for Fable only, and handles `stop_reason: "refusal"` explicitly. Fable requires 30-day data retention — a zero-retention org 400s on every request. Effort is not plumbed through serverless, so Fable advertises `efforts: []` and runs at the API default. Its picker warning says it is experimental, can take several minutes, and uses more credits. Serverless generation has a **5-minute** wall (up from 2 minutes, which aborted normal 8k–16k-token full-file builds), emits structured `turn_start` / `turn_complete` / `turn_failed` latency logs, returns a human 504 on timeout, and the client restores the prompt for retry.
- **Serverless turns are BUILD or TALK.** Not every prompt has to produce HTML: the serverless system prompt tells the model to return a full HTML document only when the user wants the app created/changed, and to answer in short plain text otherwise (brainstorming, questions, ideas). **A turn that both asks something and requests a change is a BUILD that answers first** — the prompt asks for at most two plain-text sentences before the document, and `classifyMakeResponse` keeps that prose as the chat message, so neither half of a mixed message is dropped (before this, "never both, never a mix" made the model pick one and silently discard the other — the user had to split it into two turns without being told to, burning tokens and wall clock). The reply is classified server-side by `classifyMakeResponse` — `*** SEARCH`/`*** REPLACE`/`*** END` patches (optional full-HTML fallback if they fail), or a complete `<!DOCTYPE html>…</html>` / `<html>…</html>` block (≥200 chars, fences stripped, prose alongside it kept as the chat message; falls back to one of the rotating `BUILD_CONFIRMATIONS` lines when there is none) rewrites `workspaceSnapshot`; anything else leaves the workspace untouched and is read back into chat. The turn response carries `workspaceChanged` (`true`/`false` serverless, `null` on E2B) and the Build page only refreshes the preview / drops a preview card when it is not `false`. Serverless turns also replay the last 8 `chatMessages` (truncated) as prior Messages-API turns so TALK has conversational memory.
- **Assistant voice (`services/shorts/voice.ts`).** `SHORTS_VOICE` is the personality block spliced into `SERVERLESS_SYSTEM_PROMPT`: warm, casual, texting-a-friend — contractions, lower-case openers, at most one emoji, and an explicit **never** list ("Certainly!", "Great question!", "I'd be happy to", sign-offs, bullet-point essays) that is doing most of the work, since "be friendly" alone just yields exclamation marks. It applies to every chat surface of a turn — the one-line opener before a BUILD document, the answer half of a mixed turn, and TALK replies. BUILD turns are told to open with one short friendly line (under ~12 words) so `classifyMakeResponse` has prose to keep as the chat message; TALK is capped at **80 words and three ideas**. **Currently serverless only** — the E2B path (`PLAY_PROJECT_CLAUDE_MD`, `PLAY_CLAUDE_PROMPT_PREAMBLE`) deliberately keeps its own voice; import `SHORTS_VOICE` there if the two should ever match. `toPlainChatText()` is the deterministic backstop: the Build chat renders messages with `whitespace-pre-wrap` and **no** markdown parser (only the challenge text goes through `Markdown.jsx`), so leaked `**bold**` would reach the builder as literal asterisks — it unwraps bold/inline code, strips heading markers and fences, and turns `-` bullets into `•`. **Chat text only — never run it over a generated HTML document.** Covered by `server/test/unit/shortsVoice.test.ts`.
- Admin auth: Firebase + `SHORTS_ADMIN_EMAIL` allowlist (default `saaz.m@icloud.com`); looks up assessments `User` by `firebaseUid`.
- **Consumer accounts (optional):** Firebase sign-in in the Shorts client (`AccountModal`, `lib/useAuth.js`, `lib/socialAuth.js`) — email/password plus **Google** and **Apple** via `signInWithPopup`; no admin allowlist, no assessments `User` doc needed. Redirect sign-in is deliberately unused (the Firebase auth handler is on a different domain than the Shorts client, which breaks under third-party storage partitioning). Provider collisions on the same email (`auth/account-exists-with-different-credential`) hold the pending credential and `linkWithCredential` it after the user signs in with the original method. Google/Apple require enabling the provider + authorized domains in the Firebase console; Apple additionally needs an Apple Developer Services ID and Sign in with Apple key. Which buttons render is gated by `shorts/client/src/config/auth.js`: `VITE_SHORTS_GOOGLE_AUTH` defaults **on**, `VITE_SHORTS_APPLE_AUTH` defaults **off** (Apple needs a paid Apple Developer account, a Services ID, and a Sign in with Apple key in Firebase — showing the button before that is a dead end). The Apple code path in `lib/socialAuth.js` is complete and stays in place; flipping the flag is the only change needed to enable it. Signing in **claims** the browser's `anonymousId` via `POST /api/shorts/account/link` (`PlayAccountLink`: firebaseUid → anonymousIds, max 25); history = union of linked ids, existing submissions/votes are never rewritten. `/MySubmissions` shows all builds across linked ids; the Build submit modal offers guest submit vs. create-account/sign-in. Anonymous (guest) tier keeps working unchanged.
- **Manual rounds:** exactly one published challenge has `isActive: true`. Dates are stable grouping keys for submissions/votes, not a scheduler. A round remains current indefinitely until an admin explicitly activates another via **Make current round**, `POST /admin/challenges/:slug/activate`, or `activateShortsRound.ts`. Publishing never activates. Public `GET /api/shorts/challenges` lists all published rounds with per-round submission counts and marks the active one `isCurrent`.
- No shared models with assessments `Submission`; admin reuses Bridge Firebase accounts.
- Shorts E2B: build via `cd shorts/e2b-template && npx tsx build.dev.ts`; smoke with `npx tsx src/scripts/shorts-sandbox-smoke.ts` from `server/`. The Python preview server sends `Cache-Control: no-store` so live JS/CSS edits cannot be replaced by cached starter assets. Set `SHORTS_E2B_TEMPLATE_ID`. Grading still uses the default E2B image.
- **Starter project (two copies, keep in sync):** `shorts/e2b-template/starter-project/` is baked into the E2B image; `STARTER_FILES` in `server/src/services/shorts/starterDetection.ts` is the copy serverless sessions are seeded from *and* the reference the starter-only submit gate compares against. Edit both. The page is one muted centred line pointing at the prompt box — **"Enter a prompt in the chat and your build will pop up here."** — and nothing else. It deliberately does not explain the preview pane, reassure the builder that the blankness is normal, or walk through the steps: a preview pane full of instructions reads as a broken build rather than an empty one. Keep any replacement to one sentence, and keep it direction-free ("in the chat", not "on the left") — chat sits beside the preview on desktop and above it on mobile. When the copy changes, add the outgoing version to `LEGACY_STARTER_FILES` and its distinctive lines to `STARTER_INDEX_PHRASES`: live sessions still hold the old starter in `workspaceSnapshot`, and an unrecognised starter sails past the "you haven't built anything yet" gate. E2B sandboxes keep serving the old page until the template is rebuilt; serverless picks it up on server restart.
- **Empty Build preview:** while the workspace is still the starter, the preview pane is covered by `DraftRoulette` (`shorts/client/src/components/workspace/DraftRoulette.jsx`) so it is not a blank sheet. The panel is the same tilted punch-card as Home, with three spinning reel squares in the middle. Lead copy is **"Enter your first prompt"** / **"Type it on the left."** (desktop) or **"Type it below."** (mobile) — there is no second text box in the preview. Spinning a random first draft is optional: the full spin animation lands on a result, then **Build that** (sends the spun prompt / starts the turn, uses credits) or **Spin again** — it never auto-starts a build. Reels and copy live in `shorts/client/src/lib/draftRoulette.js` (general-audience, same humor rule as the waiting room). Once the builder has sent anything, the overlay goes away and the live preview takes over. Choosing Build that still shows `BuildWaitCard` in the chat column — do not hide the riddles/games for this path.
- **Vote / browse / rankings:** public gallery + pairwise five-vote rounds with recap; Bayesian (TrueSkill-style) ranking; date-scoped. **Anyone can play the matchups, and currently every vote moves the ratings** — the submit gate on weighting is switched off via `EVERY_VOTE_IS_WEIGHTED` in `services/shorts/voting.ts` because early rounds need the vote data; the full weighted/unweighted mechanism stays wired for reversal (see the weighted-vote section under PlayVote). All of a voter's own entries are excluded from their pairs — which needs no special handling for non-submitters, who own nothing. **There is no separate leaderboard page** — the Gallery *is* the ranking: `GET /submissions` already returns rows ordered by `rankingScore` with a `rank` on each, and `SubmissionCard` shows that rank as a badge on the preview (podium tint for the top three). `/Leaderboard` redirects to `/Gallery` (query string preserved) in `App.jsx` so old links survive; `GET /api/shorts/leaderboard` still exists server-side but no client calls it. Every build is its own ranked row; the gallery adds a "Your submissions" section above the rankings. Saved submission previews are served by `GET /api/shorts/preview/:id/:revision/*` (API-origin iframes by default); Build live previews still use E2B. Client toggle: `shorts/client/src/config/submissionPreview.js` `SUBMISSION_PREVIEW_MODE` (`"api"` | `"blob"`). The Vote page carries **one line of copy** — "Try both, then pick the one you'd rather keep open." — and nothing else: the how-voting-works guide, the round sub-line, the footer note and the recap subtitle were all removed, because the matchup explains itself and prose above it just delays the pick. Round progress lives in the header `RoundMeter`. Keep it that way; if something needs explaining, fix the UI. The page labels the two panes **A** / **B** with matching `Pick A` / `Pick B` buttons, and deliberately **hides ratings mid-vote** (a visible score anchors the pick) — they live in the gallery's ranking instead. Two further single-sentence strings exist for unweighted players only: a persistent strip ("Your picks aren't counting toward the ranking yet.") and the five-pick interstitial ("Build one and your picks start moving the ranking."). Both are **dormant while `EVERY_VOTE_IS_WEIGHTED` is on** (the server never returns `weighted: false`) but stay in the client for reversal. There is **no vote-count budget** — `RoundMeter` is only the current five-pick round; voting stops when every unique pair is seen and resumes when a new build creates combinations. The old "Submit first" dead-end wall is gone.
- **Waiting room (`BuildWaitCard`):** a build turn is one long in-process job with no token stream, so `shorts/client/src/components/workspace/BuildWaitCard.jsx` fills the wait with an elapsed timer, rotating stage narration, and an interactive riddle / knock-knock / joke / trivia / prompting tip. Content lives in `shorts/client/src/lib/waitingRoom.js`; text bits share one shape — `{ id, label, steps: [{ text, cta? }] }`, where a step's `cta` labels the button that reveals the next step — so one-liners, riddles and three-beat knock-knocks render through the same code path. **Humor is general-audience by rule** (Shorts is for everyone): no jokes that need programming knowledge to land. The pool also includes **minigames** — `{ id, label, kind: "game", game }` entries rendered by `shorts/client/src/components/workspace/waitGames.jsx` (reaction test, odd-one-out shade grid, rock-paper-scissors), each a self-contained touch-first component confined to the card; `nextWaitBit` deals a game on a fixed ~30% of draws so adding jokes never starves them out, and the card keys the game by bit id so a redraw restarts it fresh. The stage narration is **cosmetic** (there is no real progress signal), which is why the lines stay vague. Used by both chat surfaces: `ChatFirstBuild` (mobile + desktop chat-first) and the Studio chat pane in `Build.jsx`.
- **Token meter breakdown (`TokenBreakdown`):** spend is metered as `input_tokens + output_tokens` — the budget is that plain sum — but the two directions are also stored separately on the session (`inputTokensUsed` / `outputTokensUsed`, returned as `inputTokens` / `outputTokens` from `GET /session/:id/usage`). Hovering, focusing or tapping the token gauge (chat-first) or the Studio "Tokens" meter opens a panel with the input/output split, total and remaining. Both counters are 0 on sessions that predate the split, and the panel says so rather than showing a fake 0/0. The panel measures its anchor on open and slides itself back inside the viewport — it sits near the left edge of a phone header, and it must ignore a 0-width `window.innerWidth` (hidden pane) or the maths throws it off screen.
- **Dropped-turn recovery (Build chat):** `POST /session/:id/claude/message` returns 202 as soon as the lock is claimed, then the client polls `GET /session/:id/turn/:turnId` (up to 330s). A refresh while `session.currentTurn.status === "running"` resumes that poll and shows the prompt as a user bubble. If the POST itself dies at the network layer (no HTTP status), `recoverDroppedTurn` first looks at `currentTurn`, then falls back to the persisted `chatMessages` pair (createdAt-guarded against identical re-sends). The wait card stays up throughout, so recovery is invisible. Only if polling times out does the builder see a red chat line ("Connection dropped — your message is back in the box…") with the prompt restored to the input. Error chat lines carry `error: true` (styled red by `ChatFirstBuild`; the legacy `^\(Error:` sniff remains as fallback). Relatedly, `ApiNetworkError` in `shorts/client/src/api/requests.ts` shows its check-the-dev-server/CORS diagnostic only in dev builds; production users get one plain "check your connection" sentence.
- **Out of credits (`OutOfCreditsModal`):** the token budget is called **credits** everywhere the builder sees it. `shorts/client/src/components/workspace/OutOfCreditsModal.jsx` pops up when a session's budget is gone — after the turn that drains it, when a send is refused (`429 token_budget_exceeded`, both make modes), or from the **What now?** link in the exhausted banner. Three actions: **Submit build** (opens the submit modal), **Try again** (re-reads `GET /session/:id/usage` first and only re-sends the last prompt if credits actually came back — an upstream 429 can look the same as an exhausted budget), **Cancel** (dismiss; Escape does the same). The retry re-sends with a `force` flag because the page's `usage` state in that closure is still the stale exhausted one.
- **Credits kickoff (`CreditsKickoffModal`):** a punch-card overlay shown once when a **fresh** Build session is ready (`tokensUsed === 0`, no chat, no running turn). It is not a gate — the 40k budget is unchanged; this is just the visual of that number ("You've got credits" / **Let's go**). Dismissed into `sessionStorage` keyed by session id (`shortsCreditsIntro.v1.${sessionId}`) so a refresh does not replay it. Skip if they already used credits or have chat.
- **Legacy submit grace (`SHORTS_SUBMIT_GRACE_SECONDS`, default 120):** compatibility only for old sessions that still carry `expiresAt`. New manually managed rounds create sessions without calendar expiry; switching rounds explicitly expires unfinished sessions from the previous round.
- **About page (`/About`):** the "what is this and why does it exist" page — the long-form version of the Shorts → Bridge connection that the footer can only assert. Four sections: hero ("Everyone gets the same challenge and the same model. The difference is you."), the thesis (*coding interviews stopped measuring the job* — the README's framing, that Shorts showcases Bridge's bet on evaluating how well people build with AI rather than Leetcode recall), a four-step "how a round works", and a **Made by Bridge** card that names the relationship outright and links to bridge-jobs.com. Reached from the header nav (`About`, so it is also in the mobile hamburger via `NAV`) and from the footer's "Why we built Shorts →". Copy is the product's public argument, not decoration — if the format changes (cadence, credits, voting, how many builds a person can send), this page has to change with it. Public copy never calls the round's written assignment a **prompt** — that word is reserved for talking to the model.
- **Shorts look ("punch" design language):** the browsing surfaces are styled like a game, not a dashboard. Shared pieces live in `shorts/client/src/index.css`: `.punch-card` / `.punch-card-sm` (thick ink border + hard offset shadow — the sticker/table-card surface used by the Home hero card, `SubmissionCard`, vote panes, About steps, and empty states) and `.btn-pill`, which carries the signature amber hard shadow + hover lift on every primary CTA (`.btn-pill-secondary` stays quiet so a page's primary CTA is always loudest). The Home page is the Wordle-shaped ritual: `SHORTS` sticker tiles (white tiles, ink border, accent-colored letters, per-tile tilt via `--tile-rot` — deliberately **not** Wordle's solid squares), the challenge title as the headline, the brief in a tilted `.punch-card` collapsed behind "Read the full brief" past ~280 chars, one big **Play this round** pill, a live ticking round-end countdown pill (`useCountdown`), and a 3-card "Leading the round" podium. Tile-flip/card-deal keyframes are `prefers-reduced-motion`-guarded.
- **Shorts nav (`ShortsHeader`):** inline sections + account dropdown above `sm`; below it both collapse into one hamburger dropdown holding the same links plus Build and the account actions. The page CTA pill stays visible at every width. The wordmark links to Shorts home (never to bridge-jobs.com — clicking "Bridge Shorts" must not leave the app); the way back to the main site is a dedicated **Bridge Jobs** `btn-pill-secondary` beside the account control (hidden below `sm`, mirrored as a full-width pill at the bottom of the hamburger). It is deliberately not the dark `btn-pill` so a page's `cta` pill stays the loudest thing in the header.
- **Shorts footer (`ShortsFooter`):** `shorts/client/src/components/ShortsFooter.jsx` — the Shorts → Bridge traffic bridge: one sentence on what Bridge is ("the hiring platform where employers create AI-powered take-home assessments…") plus a **Visit Bridge** `btn-pill-secondary`, both linking to `https://www.bridge-jobs.com`, plus a "Why we built Shorts →" link into `/About` for the longer argument. Mounted on the browsing pages only (Home, Gallery, Submission, MySubmissions, About); deliberately absent from Build and Vote, which are focused task flows. Those page shells are `flex min-h-screen flex-col` with a `flex-1` main so the footer pins to the bottom on short pages.
- **Share a build (`ShareBuild`):** `shorts/client/src/components/ShareBuild.jsx`, mounted on the Submission page title row and the Build page's post-submit "Submitted" screen (submit response carries `submissionId` for the link). Share URL is the plain `/Submission?id=…` page. Touch devices with `navigator.share` get the native OS sheet; everything else gets a popover (Copy link with "Copied ✓" feedback, X, WhatsApp) that self-anchors left/right to stay on screen. A denied clipboard write (privacy browsers) reveals the URL in a selectable field instead of failing silently. Link unfurls come from `GET /api/shorts/share` via the vercel.json bot-UA rewrite (see route list), and now carry an `og:image` — one static, round-agnostic 1200×630 card at `shorts/client/public/og/shorts-card.png`, regenerated by `server/src/scripts/generateShortsOgCard.ts`. Per-build screenshots are still the open item; until then every share unfurls with the same product card.
- **Download a build (`DownloadBuild`):** `shorts/client/src/components/DownloadBuild.jsx`, next to Share on the Submission page and the Build post-submit screen — anyone can take a build home, not just its owner. Fetch-then-save (blob + object URL) instead of a plain link so a failure shows on the button ("Download failed") rather than navigating to a JSON error page; saved name comes from the response `Content-Disposition`, falling back to a client-side slug + `.html`/`.zip` guess from `fileCount`. Server side is `GET /api/shorts/submissions/:id/download` (see route list) backed by `services/shorts/download.ts`.
- **Save a build (`StarButton` + `/Saved`):** private bookmarks — star any build from a gallery card overlay (`shorts/client/src/components/StarButton.jsx`, icon variant) or the Submission page action row (pill variant, "Save"/"Saved"), then find it on the **Saved** page (`shorts/client/src/pages/Saved.jsx`, in the header `NAV`). Works for guests off the browser `anonymousId`; signing in unions saves across linked devices server-side (same ownership rules as submissions). Optimistic toggle with revert on error. **Deliberately no public counts** — visible star tallies would anchor votes like visible ratings would, so only the owner ever sees what's saved. Model `PlayStar` (`server/src/models/shorts/star.ts`), service `services/shorts/stars.ts`; `deleteSubmission` also deletes stars pointing at the removed build. Covered by `server/test/unit/shortsStars.test.ts`.
- **Delete a build (`DeleteBuildModal`):** `shorts/client/src/components/DeleteBuildModal.jsx`. Owners can take a build down from My builds, the gallery "Your submissions" strip, and the Submission page when `isMine`. Confirm copy is one sentence (leaves the gallery and the ranking; can't be undone). Same server cleanup as admin delete. The submit dialog names the 3-per-round cap; a fourth submit is **409** `{ code: "submission_limit" }` with copy **"You ran out of builds for this round."** — it does not tell them to delete one to free a slot. Signed-in `smahadkar@ucsd.edu` skips the cap (`unlimitedSubmit.ts`).

## Ports and URLs

| Service         | Dev URL                          | Production URL                                           |
|-----------------|----------------------------------|----------------------------------------------------------|
| Frontend (Vite) | `http://localhost:5173`          | `https://www.bridge-jobs.com` (Vercel)                   |
| Shorts (Vite)     | `http://localhost:5174`          | `https://shorts.bridge-jobs.com` (Vercel, root `shorts/client`); legacy `play.bridge-jobs.com` is no longer attached to a deployment |
| Backend (Express)| `http://localhost:5050`         | `https://bridge-assessements-1.onrender.com` (Render)    |
| Health check    | `http://localhost:5050/health`   | `https://bridge-assessements-1.onrender.com/health`      |
| API base        | `http://localhost:5050/api`      | `https://bridge-assessements-1.onrender.com/api`         |
| Shorts API        | `http://localhost:5050/api/shorts` | `https://bridge-assessements-1.onrender.com/api/shorts`    |

- The backend port is configured via `PORT` env var (defaults to `5050`).
- The frontend Vite dev server runs on port `5173` by default; Shorts runs on `5174`.
- The client resolves its API base URL in `client/src/config/api.js`: uses `VITE_API_URL` env var if set, otherwise `localhost:5050` in dev mode and the Render URL in production.
- Shorts client uses `shorts/client/src/config/api.js` with base `${VITE_API_URL}/api/shorts`.
- CORS allowed origins are hardcoded in `server/src/server.ts` -- if you add a new frontend domain, update the `allowedOrigins` array there.
- Current allowed CORS origins: `FRONTEND_URL`, `SHORTS_FRONTEND_URL`, `PLAY_FRONTEND_URL` (legacy alias), `https://app.bridge-jobs.com`, `https://www.bridge-jobs.com`, `https://bridge-jobs.com`, `https://shorts.bridge-jobs.com`, `https://play.bridge-jobs.com` (legacy), `https://bridge-play.vercel.app`, two Vercel preview domains, plus `localhost:5173`, `localhost:5174`, and `localhost:3000` in dev.

## How to Run Locally

```bash
# Terminal 1: Start backend
cd server
cp config.env.example config.env   # First time only, then fill in secrets
npm install
npm run dev                         # Uses nodemon + tsx, loads config.env via --env-file

# Terminal 2: Start frontend
cd client
npm install
npm run dev                         # Vite dev server on :5173
```

For Stripe webhook testing locally, also run:
```bash
stripe listen --forward-to localhost:5050/api/billing/webhook
```

## Tech Stack and External Services

### Frontend (`client/`)
- **React 18** with **JSX** (not TSX -- pages/components are `.jsx`, API layer is `.ts`)
- **Vite** for dev server and builds (with Base44 vite plugin for legacy SDK imports)
- **React Router v6** for routing
- **TanStack React Query v5** for data fetching/caching
- **Shadcn UI** (Radix primitives + Tailwind CSS, "new-york" style) for component library
- **Framer Motion** for animations
- **Firebase Auth v12** (client SDK) for authentication
- **Stripe.js + React Stripe** for checkout UI
- **ElevenLabs React SDK** (`@elevenlabs/react` 1.x) for the in-assessment voice companion
- **Recharts** for data visualization / charts
- **React Hook Form** + `@hookform/resolvers` for form state management
- **React Quill** for rich text editing
- **React Markdown** for markdown rendering
- **@hello-pangea/dnd** for drag-and-drop
- **React Resizable Panels** for resizable UI panels
- **Three.js** for 3D graphics
- **Leaflet / React Leaflet** for maps
- **Sonner** + **React Hot Toast** for toast notifications
- **Embla Carousel** for carousel/slider components
- **Vercel Analytics** for production analytics
- **Zod** for validation
- Deployed on **Vercel** with SPA rewrites (`vercel.json`)

### Backend (`server/`)
- **Express.js** with TypeScript (run directly via `tsx`, no compile step)
- **Mongoose v9** ODM connecting to **MongoDB Atlas**
- **Firebase Admin SDK v13** for server-side auth token verification
- **LangChain** with pluggable AI providers for:
  - Assessment generation from job descriptions
  - Assessment chat assistant
  - Base code generation
  - Code change / diff analysis
  - Completeness scoring
- **AI Provider SDKs**: OpenAI (`openai`), Anthropic (`@anthropic-ai/sdk`), Google Gemini (`@google/generative-ai`)
- **E2B SDK** (`e2b`) for isolated cloud sandbox execution during behavioral grading
- **Pinecone** vector database for code indexing and retrieval
- **Stripe** for subscription billing (checkout sessions + webhooks)
- **Resend** for sending candidate invitation emails
- **ElevenLabs** Conversational AI for the in-session voice companion
- **multer** for file uploads (LLM trace uploads)
- **unzipper** for ZIP extraction
- **Zod** for schema validation
- **express-rate-limit** for rate limiting (disabled in dev, enabled in prod)
- Deployed on **Render**

### Database
- **MongoDB Atlas** -- connection string set via `ATLAS_URI` env var
- Database name: `bridge-assessments` (set via `DB_NAME` env var)

## Environment Variables

### Backend (`server/config.env`)
See `server/config.env.example` for the full list. Key variables:

**Database & Server:**
- `ATLAS_URI` / `DB_NAME` -- MongoDB connection
- `PORT` -- Server port (default: 5050)
- `FRONTEND_URL` -- For CORS (default: `http://localhost:5173`)
- `NODE_ENV` -- `development` or `production`

**Authentication:**
- `FIREBASE_SERVICE_ACCOUNT_JSON` -- Firebase Admin credentials (JSON string, required in prod)
- `FIREBASE_SERVICE_ACCOUNT_PATH` -- Path to service account file (dev only)
- `OPS_ADMIN_EMAIL` -- Comma-separated emails allowed to view `GET /api/ops/workload` / `/OpsDashboard` (cross-account workload). Defaults to `HACKATHON_ADMIN_EMAIL`, then `saaz@bridge-jobs.com`

**AI Providers:**
- `AI_PROVIDER` -- Global default: `openai`, `anthropic`, or `gemini`
- `AI_PROVIDER_ASSESSMENT_GENERATION` / `AI_PROVIDER_ASSESSMENT_CHAT` -- Per-use-case overrides
- `OPENAI_API_KEY` / `OPENAI_MODEL` -- OpenAI config (default: `gpt-5.6-luna`; `gpt-5.6-terra` for assessment generation)
- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` -- Anthropic config (default: `claude-3-5-sonnet-20241022`)
- `GEMINI_API_KEY` / `GEMINI_MODEL` -- Gemini config (default: `gemini-1.5-pro`)
- Per-use-case model overrides: `{PROVIDER}_MODEL_{USECASE}` (e.g., `OPENAI_MODEL_ASSESSMENT_GENERATION`)

**Vector DB:**
- `PINECONE_API_KEY` / `PINECONE_INDEX_NAME` -- Pinecone vector DB

**Behavioral Grading Sandbox:**
- `E2B_API_KEY` -- API key for E2B sandbox execution
- `GRADING_STORAGE_DIR` -- Local directory for behavioral grading artifacts/reports (default: `./storage/grading`)
- `SUBMISSION_UPLOAD_STORAGE_DIR` -- Local directory for uploaded submission archives when not using S3 (default: `./storage/submissions`)
- `SUBMISSION_UPLOAD_STORAGE_BACKEND` -- `s3` or `local`. If unset, S3 is used whenever `SUBMISSION_S3_BUCKET` / `PROCTORING_S3_BUCKET` / `AWS_S3_BUCKET` is set (same durable-storage rule as proctoring). Production must use S3 — Render's disk is ephemeral, and a missing zip breaks runtime setup and behavioral grading.
- `SUBMISSION_S3_BUCKET` -- Optional bucket override for submission zips (default: the proctoring/AWS bucket). Objects are stored under `submissions/{submissionId}/archives/…`
- `SUBMISSION_SOURCE_MODE` -- Allowed candidate submission sources (`both`/`github`/`upload`, default: `both`)
- `SUBMISSION_UPLOAD_MAX_BYTES` -- Max upload bytes accepted by `/api/submissions/token/:token/upload` (default: `104857600`)
- `SUBMISSION_UPLOAD_MAX_EXTRACTED_BYTES` -- Max bytes after archive extraction for indexing/execution (default: `314572800`)
- `SUBMISSION_UPLOAD_MAX_EXTRACTED_FILES` -- Max extracted file count per uploaded archive (default: `20000`)
- `BEHAVIORAL_GRADING_MAX_CONCURRENT` -- Max concurrent behavioral grading jobs (default: `2`)
- `BEHAVIORAL_GRADING_UPLOAD_ENABLED` -- Enable behavioral grading for uploaded archives (default: `true`)

**Runtime setup (post-submit candidate-authored run config):**
- `RUNTIME_SETUP_ENABLED` -- Gate candidate runtime-setup routes and UI (default: disabled)
- `RUNTIME_SETUP_MAX_CONCURRENT` -- Cap on **running or provisioning** setup sandboxes (default: `3`). `provisioning` counts because the box is already being created; `paused` does not, since a paused E2B box is cheap and resuming it creates nothing
- `RUNTIME_SETUP_SANDBOX_TTL_MS` -- Hard cap per live sandbox (default: `1800000` = 30m)
- `RUNTIME_SETUP_IDLE_PAUSE_MS` -- Idle → E2B pause (default: `240000` = 4m). Any status **or log** poll from a client watching a live box counts as activity, so a preview someone is clicking through is not reaped mid-use
- `RUNTIME_SETUP_INSTALL_TIMEOUT_MS` / `RUNTIME_SETUP_BUILD_TIMEOUT_MS` -- per-step caps
- `RUNTIME_SETUP_RUN_MAX_MS` -- **whole-run** budget (default: `900000` = 15m). Install, build, start, and the health wait share it; each step gets whichever is smaller, its own timeout or the time left (`createRunDeadline` in `services/runtimeSetup/run.ts`). There is no `RUNTIME_SETUP_CPU` / `RUNTIME_SETUP_MEM_MIB` — sandbox size is fixed by the E2B template, not by `Sandbox.create`
- `RUNTIME_SETUP_DENY_EGRESS_AT_RUNTIME` -- After start, lock outbound traffic except `declaredEgressDomains` (default: `true`; requires E2B `updateNetwork`, SDK ≈2.28+)
- `RUNTIME_SETUP_RUNS_PER_HOUR` -- Per-submission run cap (default: `12`)
- `RUNTIME_SETUP_HEALTH_WAIT_MS` -- Poll for app ready after start (default: `90000`)

**Shorts (consumer daily challenge):**
- `SHORTS_ENABLED` -- Gate `/api/shorts` feature routes (default: disabled); `GET /api/shorts/health` always on
- `SHORTS_DB_NAME` -- Mongo database for Shorts product (default: `bridge-play`, same Atlas cluster)
- `SHORTS_FRONTEND_URL` -- CORS origin for Shorts Vercel app (`https://shorts.bridge-jobs.com`)
- `SHORTS_ADMIN_EMAIL` -- Email allowed to manage challenges via `/api/shorts/admin/*` (default: `saaz.m@icloud.com`)
- `SHORTS_E2B_TEMPLATE_ID` -- Custom E2B template for Shorts sandboxes (default `bridge-play-dev`; build from `shorts/e2b-template/`)
- `SHORTS_MAKE_MODE` -- Build path when a challenge doesn't set its own: `e2b` (default, sandbox + Claude Code) or `serverless` (single self-contained HTML generated by one direct Anthropic Messages call, no sandbox). Resolution: per-challenge `makeMode` (admin toggle) > `SHORTS_MAKE_MODE` > `e2b`. Stamped per-session at creation, so flipping it never mis-routes a live session.
- `SHORTS_MAX_CONCURRENT_SESSIONS` -- Soft cap on **running** (non-paused) Shorts sessions (default: `5`; serverless sessions are exempt — no sandbox)
- `SHORTS_SUBMIT_GRACE_SECONDS` -- Compatibility grace for legacy session documents with `expiresAt` (default `120`). New manually managed rounds do not create calendar expiry
- `SHORTS_LLM_PROXY_PUBLIC_URL` -- Public base URL for the Shorts LLM proxy that E2B sandboxes can reach (e.g. Render or a tunnel). Required for Claude Code; sandboxes cannot call `localhost`
- `SHORTS_PUBLIC_API_URL` -- Base URL the **browser** uses for serverless preview iframes (`GET /session/:id/preview`). Leave unset normally: dev falls back to `http://localhost:$PORT`, production falls back to `SHORTS_LLM_PROXY_PUBLIC_URL`. Set it only when the browser is not on the API host (e.g. phone testing through a tunnel). Keeping this separate from the E2B-facing proxy URL is what stops a dead tunnel from breaking local serverless previews
- `SHORTS_OG_IMAGE_URL` -- Absolute `http(s)` URL of the share-card image emitted as `og:image` by `GET /api/shorts/share` (legacy alias `PLAY_OG_IMAGE_URL`). Unset uses the committed card at `shorts/client/public/og/shorts-card.png`, resolved against the Shorts client base. A value that is not an absolute http(s) URL is **ignored**, not emitted — and if no card is vouched for at all, the page emits zero image tags and keeps `twitter:card: summary` rather than risk a broken preview
- `SHORTS_ANTHROPIC_MODEL` -- Optional override for the Claude model used when a request does not pick one (default **Sonnet 4.5**; the Build picker uses that same latency-oriented default)
- `ANTHROPIC_API_KEY` -- Org Anthropic key used by the Shorts Messages proxy (never written into the sandbox)

**Billing:**
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` / `APP_URL` -- Stripe billing

**In-session voice companion (ElevenLabs):**
- `AGENT_SECRET` -- Authenticates ElevenLabs agent tool requests (sent as `X-Agent-Secret`; stored on ElevenLabs as the workspace secret `bridge_agent_secret` so the tool config never holds it in plaintext). **Required — the agent routes fail closed**: when unset, `/api/agent-tools/*` and `/api/workflow-capture/agent-context` return 503 instead of allowing unauthenticated access (comparison is timing-safe; helpers in `server/src/utils/agentSecret.ts`)
- `ELEVENLABS_API_KEY` -- Management API key used **only** by `src/scripts/registerElevenLabsContextTool.ts` to create/attach the agent's context tool. Not needed at runtime
- `ELEVENLABS_AGENT_ID` -- Production agent for that script (falls back to a hardcoded companion agent id)
- `ELEVENLABS_DEV_AGENT_ID` -- Dev twin agent (`Interview (dev)`, `agent_5001m0dqx0jafyxrdk87x66p2fz9`), created by `src/scripts/createElevenLabsDevAgent.ts`; required by the register script's `--local` mode

**Testing the agent tool against localhost.** ElevenLabs calls the tool from its own
servers, so it cannot reach `localhost` — but you do **not** have to deploy to test. Local
testing runs on a **separate dev agent** (`ELEVENLABS_DEV_AGENT_ID`) with its own
ngrok-pointed twin of the `get_candidate_context` tool: `--local` used to repoint the shared
production agent's tool at the developer's tunnel — while set, a real candidate's tool calls
hit the developer's laptop, and a dead tunnel 404'd them (this silent failure burned three
assessment runs in Aug 2026). Now: `ngrok http 5050`, then from `server/`:
`npx tsx src/scripts/registerElevenLabsContextTool.ts --local` (targets the dev agent + dev
tool only, and **refuses** to run against the production agent); point the local client at the
dev agent via `VITE_ELEVENLABS_AGENT_ID` in `client/.env.local` (prod id stays on Vercel).
`--prod` (the default) updates the production tool/agent. There is usually no need for
`--local` at all: production runs the same code against the same Atlas cluster, so the prod
tool URL works for local candidate tests — `--local` matters only when changing the context
endpoint itself. This account's ngrok has a **static domain**, so the dev tool URL survives
tunnel restarts — but the tool is only as alive as the tunnel. `getCompanionPrompt` checks
ngrok's :4040 API when a companion session starts in development and prints a loud warning if
no tunnel is up. The script adds an `ngrok-skip-browser-warning` header on ngrok URLs —
without it the free tier's HTML interstitial reaches the agent instead of JSON. The tool
schema is **live-companion-scoped**: topics enum is `assessment/metrics/timeline/conversation`
only — `episodes` and `code` were removed from the schema (2026-08-19) so the prompt's
prohibition is structurally enforced rather than resting on late-session rule retention; the
server endpoint still accepts both topics for other consumers. Agent-creation gotcha:
ElevenLabs clones the source agent's webhook tools on create even when `tool_ids` is stripped
— `createElevenLabsDevAgent.ts` deletes the clones after creating.

**Email:**
- `RESEND_API_KEY` -- Resend email service key

**Proctoring / Screen Capture:**
- `PROCTORING_STORAGE_DIR` -- Local filesystem root when not using S3 (default: `./storage/proctoring`)
- `PROCTORING_STORAGE_BACKEND` -- `local` (default) or `s3`. If `PROCTORING_S3_BUCKET` or `AWS_S3_BUCKET` is set, S3 is used even when this is unset.
- `PROCTORING_S3_BUCKET` / `AWS_S3_BUCKET` -- S3 bucket for frames, video chunks, merged `playback.webm`, transcripts (same key layout as local)
- `PROCTORING_VIDEO_MERGE_MAX_CONCURRENT` -- Max concurrent eager WebM merge jobs (concat + remux; default: `2`)
- `AWS_REGION` / `AWS_DEFAULT_REGION` -- Required for S3
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` -- IAM user credentials on hosts like Render (or use default credential chain)
- One-time migration: `npx tsx src/scripts/migrateProctoringLocalToS3.ts` (see `server/docs/VIDEO_PROCTORING_SYSTEM.md`)
- Retroactive WebM merge (chunks → `playback.webm`): from `server/`, `npm run backfill:proctoring-video` (same as `npx tsx src/scripts/backfillMergedProctoringVideos.ts`; use `--dry-run` first)
- `TRANSCRIPT_GENERATION_ENABLED` -- Enable/disable AI transcript generation (default: `true`)
- `PROCTORING_FRAME_INTERVAL_MS` -- Capture interval in ms (default: `5000`)
- `PROCTORING_DEDUP_THRESHOLD` -- Pixel diff threshold for dedup (default: `0.03`)
- `TRANSCRIPT_REGION_BATCH_SIZE` -- Max crops per region before flush (default: `5`)
- `TRANSCRIPT_LAYOUT_REDETECT_INTERVAL` -- Re-detect layout every N frames (default: `90`)
- `TRANSCRIPT_LAYOUT_MAX_PIXELS` -- Max dimension for layout image sent to vision (default: `1280`)
- `TRANSCRIPT_OCR_CACHE_CHANGE_THRESHOLD` -- Thumb-diff threshold for reusing cached OCR (default: `0.6`)
- `TRANSCRIPT_DEBUG_SAVE_CACHE_THUMBS` -- Save cached region thumbs to disk (default: `false`)
- `TRANSCRIPT_DEBUG_CACHE_THUMBS_DIR` -- Directory for debug thumbs (default: `{PROCTORING_STORAGE_DIR}/ocr-cache-thumbs`)
- `TRANSCRIPT_ENGINE` -- `frames` (default) or `gemini`. `gemini` uploads the session's merged WebM to the Gemini Files API and transcribes it natively (one request per ~20-min window) instead of extracting + OCRing frames; falls back to the frames engine on any error or when `GEMINI_API_KEY` is unset. Screen 0 only; incremental mode always uses the frames engine.
- `TRANSCRIPT_GEMINI_MODEL` -- Video model for the Gemini engine (default: `gemini-3.6-flash`)
- `TRANSCRIPT_GEMINI_FPS` -- Video sampling rate sent to Gemini (default: `1`)
- `TRANSCRIPT_GEMINI_MEDIA_RESOLUTION` -- `low`/`medium`/`high` (default: `high`; 280 tok/frame — required for reading dense IDE text)
- `TRANSCRIPT_GEMINI_CHUNK_MINUTES` -- Window length per Gemini request (default: `20`)
- `TRANSCRIPT_GEMINI_CHUNK_OVERLAP_SEC` -- Lead-in overlap between windows (default: `30`)
- `TRANSCRIPT_INCREMENTAL_ENABLED` -- Enable sliding-window incremental transcript for active sessions (default: `false`). Set to `true` in production so transcript is built during the assessment and submit only finalizes.
- `TRANSCRIPT_INCREMENTAL_INTERVAL_MS` -- Interval for incremental runs in ms (default: `60000`)
- `ATTEMPT_REAPER_ENABLED` -- Sweep in-progress attempts past `timeLimit` + 5-minute grace and expire them (default: on; set `false` to disable). Same outcome as the client recording-only submit, so a closed tab still merges video and closes capture-kit.
- `ATTEMPT_REAPER_INTERVAL_MS` -- Reaper interval in ms (default: `60000`)

### Frontend (`client/.env.local`)
- `VITE_API_URL` -- Override API base URL (optional, auto-detected from mode)
- `VITE_DEFAULT_COMPETITION_SLUG` -- Optional override for the competition slug (overrides [`client/src/config/competition.js`](client/src/config/competition.js) `SINGLE_COMPETITION_SLUG` when set)
- `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID`
- `VITE_ELEVENLABS_AGENT_ID` -- ElevenLabs agent for the in-assessment voice companion. Unset disables the overlay **and** the microphone copy on the consent screen

## Backend Architecture

### Directory Layout (`server/src/`)
```
server/src/
├── server.ts              # Express app entry point, middleware setup, route registration
├── config/
│   ├── loadEnv.ts         # Loads config.env via dotenv (must be imported first)
│   └── firebaseAdmin.ts   # Initializes Firebase Admin SDK (JSON env var or file path)
├── db/
│   └── mongooseConnection.ts  # Mongoose connection with caching
├── models/
│   ├── user.ts            # User schema (Firebase UID, company, Stripe subscription fields)
│   ├── assessment.ts      # Assessment schema (title, description, time limit, settings)
│   ├── competition.ts     # Competition / hackathon: slug, assessmentId, rules, registration window, leaderboard flag
│   ├── submission.ts      # Submission schema (token, candidate info, GitHub repo, scores, LLM workflow)
│   ├── runtimeSetupSession.ts # Ephemeral E2B box for candidate runtime setup / recruiter replay
│   ├── repoIndex.ts       # Repository indexing metadata for Pinecone
│   └── proctoringSession.ts  # Proctoring session (frames, events, transcript, video chunks)
├── routes/
│   ├── user.ts            # /api/users/* -- create, whoami, delete
│   ├── assessment.ts      # /api/assessments/* -- CRUD + generate + chat
│   ├── submission.ts      # /api/submissions/* -- link generation, token access, submit, grading
│   ├── competition.ts     # /api/competitions/* -- public competition metadata, self-serve join, leaderboard
│   ├── ops.ts             # /api/ops/* -- workload dashboard (OPS_ADMIN_EMAIL)
│   ├── billing.ts         # /api/billing/* -- checkout, status, cancel, reactivate, webhook
│   ├── agentTools.ts      # /api/agent-tools/* -- ElevenLabs agent context retrieval
│   └── proctoring.ts      # /api/proctoring/* -- screen capture sessions, frames, transcripts
├── controllers/
│   ├── user.ts            # User creation, login (with tier limits), account deletion
│   ├── assessment.ts      # Assessment CRUD, AI generation, chat
│   ├── submission.ts      # All submission handlers (share links, submissions, grading)
│   ├── runtimeSetup.ts    # Candidate/recruiter runtime setup (config, run, pause, finalize, replay)
│   ├── competition.ts     # Public competitions: get by slug, join (creates pending submission), leaderboard
│   ├── ops.ts             # Ops workload aggregation (employer attribution for heavy jobs)
│   ├── billing.ts         # Stripe checkout, status, cancel, reactivate, webhook handler
│   ├── webhook.ts         # ElevenLabs post-call transcript processing + summary generation
│   ├── agentTools.ts      # Code context retrieval for ElevenLabs agent (Pinecone search)
│   └── proctoring.ts      # Proctoring: session CRUD, frame upload, consent, sidecar, transcript generation
├── services/
│   ├── langchainAI.ts     # LangChain abstraction: createChatCompletion(), structured output, provider/model selection
│   ├── assessmentGeneration.ts  # 3-step AI assessment generation (extract reqs → generate → quality review)
│   ├── assessmentChat.ts  # Bridge Assistant: chat → validated assessment updates (see below)
│   ├── email.ts           # Resend email service for candidate invitations
│   ├── repoIndexing.ts    # GitHub repo → Pinecone indexing (download, chunk, embed, upsert)
│   ├── repoRetrieval.ts   # Code chunk retrieval from Pinecone (search, dedup, budget)
│   ├── stripe.ts          # Stripe client initialization (API v2024-12-18.acacia)
│   ├── agentContext/
│   │   └── contextCenter.ts   # Unified budgeted context bundle for the ElevenLabs voice agent (assessment/conversation/timeline/code)
│   ├── companion/
│   │   └── firstMessage.ts    # Spoken opener after Start: title + unzip/command walkthrough; resume is a short welcome-back
│   ├── behavioralGrading/
│   │   ├── index.ts           # E2B behavioral grading orchestrator + in-process concurrency queue + in-flight dedupe + boot sweep
│   │   ├── log.ts             # [behavioral] stdout logger; run context stamps submissionId on every line
│   │   ├── progress.ts        # Live behavioralGradingProgress writer (throttled); shared by real runs and the stress demo
│   │   ├── planner.ts         # LLM: README → runbook plan (install/test/start)
│   │   ├── runtimeConfigRunbook.ts # Candidate's finalized+verified runtimeConfig → runbook (skips the LLM planner)
│   │   ├── schema.ts          # Zod schemas for runbook
│   │   ├── executor.ts        # Executes runbook commands with per-step timeouts; optional candidate envVars; secret-scrubbed evidence
│   │   ├── checkSpecs.ts      # Zod BehavioralCheckSpec + resolver (legacy strings → kind agent)
│   │   ├── compileCheckSpec.ts # Grade-time leftover agent check → link inventory IDs + purpose template (invalid → inconclusive)
│   │   ├── extractUiControls.ts # Heuristic scan of candidate source → button/textbox/link catalog (Playwright locators come from here, never getByText); nameless buttons kept
│   │   ├── extractCapabilities.ts # Unified inventory: UI controls + fetch/Express routes with source file:line
│   │   ├── linkCheckCapabilities.ts # Heuristic (then constrained LLM) purpose tags; IDs must exist in the inventory
│   │   ├── synthesizeAcceptance.ts # Purpose templates: create / toggle_done+reload / delete-in-row / health
│   │   ├── deterministicChecks.ts # http/http_sequence/restart_persistence/cli/ui acceptance runner (no LLM; UI clicks are getByRole exact or click_in_row; never getByText)
│   │   ├── scoring.ts         # report.score: decided/total, passRate excludes inconclusive/blocked
│   │   ├── proofGuards.ts     # Reject agent passes that cite only inline probes; reject UI fails unless a fill/click succeeded and browser_expect ran
│   │   ├── specSuggestions.ts # LLM acceptance suggestions → validated specs (UI walkthrough or grounded HTTP; invented paths dropped)
│   │   ├── judge.ts           # One-shot LLM judge (stdout/source/HTTP seed)
│   │   ├── agentJudge.ts      # Tool-using judge (run_command/read_file in sandbox, then finish); browser_fill retries textbox/placeholder
│   │   └── artifacts.ts       # collectJudgeArtifacts + bashLc helpers
│   ├── runtimeSetup/
│   │   ├── sessions.ts        # Persistent E2B lifecycle (create/pause/resume/run/finalize)
│   │   ├── run.ts             # Candidate runtimeConfig → install/build/start + health
│   │   ├── sandbox.ts         # Long-lived sandbox (does not auto-kill like grader)
│   │   ├── network.ts         # Two-phase egress via updateNetwork
│   │   └── schema.ts          # Zod runtimeConfig + secret redaction helpers
│   ├── play/
│   │   ├── challenges.ts      # Shorts daily challenge CRUD + UTC today lookup + public past-rounds archive
│   │   ├── account.ts         # Consumer accounts: claim anonymousIds, cross-round submission history
│   │   ├── sandbox.ts         # Shorts E2B create/getUrls/kill (custom template)
│   │   ├── sessions.ts        # Create/resume build sessions + response shaping
│   │   ├── submissions.ts     # Snapshot workspace → PlaySubmission (E2B sandbox or serverless snapshot; rejects starter-only)
│   │   ├── unlimitedSubmit.ts # 3-per-round cap skip list (smahadkar@ucsd.edu)
│   │   ├── download.ts        # Public build download: filename slug + single-file vs zip shape + ABOUT.txt
│   │   ├── stars.ts           # Private save-this-build bookmarks: star/unstar + saved list (account-linked union)
│   │   ├── serverlessMake.ts  # Serverless make: direct Anthropic call → HTML or search/replace patches
│   │   ├── htmlPatches.ts     # Parse/apply *** SEARCH / *** REPLACE / *** END blocks
│   │   ├── turns.ts           # Durable Mongo turn lock + async in-process execute + poll
│   │   ├── starterDetection.ts # Heuristics for unchanged / near-empty Shorts starter
│   │   ├── voting.ts          # Public gallery, pairwise votes, Bayesian ranking, leaderboard
│   │   ├── preview.ts         # Revisioned submission previews + live serverless session preview (path-safe)
│   │   ├── bayesianRating.ts  # TrueSkill-style 1v1 updates + matchmaking heuristic
│   │   ├── ratingConstants.ts # Shared μ/σ defaults + round size caps
│   │   ├── llmProxy.ts        # Anthropic Messages proxy + token budget + claude -p relay
│   │   ├── claudeProvision.ts # Write Claude settings + ANTHROPIC_BASE_URL/AUTH_TOKEN in sandbox
│   │   ├── workspaceFiles.ts  # List/read/write E2B project files for Monaco sync
│   │   ├── models.ts          # Allowed Claude models / aliases for Shorts
│   │   ├── sessionPersist.ts  # Claude chat + workspace snapshot save/restore for resume
│   │   └── index.ts
│   ├── gradingEvidence/
│   │   └── storage.ts         # Artifact storage abstraction for behavioral grading reports/screenshots
│   ├── submission/
│   │   ├── closeAttempt.ts    # completeProctoring + closeCapture for an ended attempt
│   │   └── finalizeExpired.ts # Expire past-grace in-progress attempts (reaper + recording-only)
│   ├── capture/
│   │   ├── storage.ts       # IFrameStorage + getFrameStorage() (local vs S3)
│   │   ├── s3FrameStorage.ts # S3FrameStorage (PROCTORING_STORAGE_BACKEND=s3 or bucket set)
│   │   ├── frameStorage.ts  # Store/retrieve frames and video chunks, update session model
│   │   ├── sessionVideoMerge.ts # Eager merge chunks → playback.webm + delete chunks; buildSessionWebmForPlayback
│   │   ├── serverDedup.ts   # SHA-256 hash-based server-side frame deduplication
│   │   └── framePrep.ts     # PreparedSessionData builder (boundary contract for AI module)
│   └── schemas/
│       └── assessmentGeneration.ts  # Zod schemas for assessment generation structured output
├── types/
│   └── assessmentGeneration.ts  # TypeScript types for assessment generation
├── validators/
│   ├── auth.ts            # Firebase token verification middleware (verifyAuthToken)
│   ├── submissionAuth.ts  # Submission access: verifySubmissionAccess (auth OR token), verifySubmissionToken
│   ├── assessmentValidation.ts  # create/update/generate validation rules
│   ├── submissionValidation.ts  # generateLink, bulkGenerateLinks, sendInvites, start, submit validation
│   ├── userValidation.ts       # createUser validation
│   └── proctoringValidation.ts # Proctoring endpoint validation rules
├── utils/
│   ├── auth.ts            # decodeAuthToken(), getUserIdFromFirebaseUid()
│   ├── subscription.ts    # isSubscribed(), getSubscriptionStatus() -- checks both top-level and legacy nested fields
│   ├── opsAdmin.ts        # OPS_ADMIN_EMAIL allowlist helpers
│   ├── firebase.ts        # Firebase Admin Auth export
│   ├── github.ts          # parseGithubRepoUrl(), resolvePinnedCommit(), fetchRepoMetadata(), resolveBranchToCommit()
│   ├── embeddings.ts      # generateEmbedding(), generateEmbeddings() -- OpenAI embeddings
│   ├── pinecone.ts        # getPineconeClient(), getPineconeIndex(), upsertVectors(), deleteNamespace(), queryPinecone()
│   ├── repoSnapshot.ts    # downloadAndExtractRepoSnapshot(), cleanupRepoSnapshot()
│   ├── leaderboardScore.ts # Combined Screen + Behavioral score for public competition leaderboard
│   ├── submissionTiming.ts # timeLimit + 5-minute grace window (keep in lockstep with the candidate client)
│   ├── rateLimitPaths.ts  # Skip helpers so Shorts/proctoring never share the general 100/15min API bucket
│   └── validationErrorParser.ts  # Express-validator error formatting
├── prompts/
│   └── index.ts           # All AI prompt templates (see Prompts section below)
├── errors/
│   ├── errors.ts          # CustomError base class (statusCode, message)
│   ├── auth.ts            # AuthError: DECODE_ERROR, TOKEN_NOT_IN_HEADER, INVALID_AUTH_TOKEN
│   ├── internal.ts        # InternalError class
│   ├── proctoring.ts      # ProctoringError class (session/consent/frame/transcript errors)
│   ├── handler.ts         # Express error handler middleware (CustomError → JSON response)
│   └── index.ts           # Exports
├── ai/
│   └── transcript/
│       ├── generator.ts   # Orchestrator: batch → vision → stitch → store; parallel region flushes; generateTranscriptIncremental; dispatches to geminiVideoEngine when TRANSCRIPT_ENGINE=gemini
│       ├── geminiVideoEngine.ts # Native-video transcript engine: merged WebM → Gemini Files API → windowed structured segments (no frame extraction)
│       ├── incrementalScheduler.ts # Sliding-window: run incremental transcript for active sessions on interval
│       ├── batcher.ts     # Split frames into vision API batches
│       ├── visionClient.ts # OpenAI vision API calls (detail:high; OPENAI_VISION_MODEL, default gpt-5.6-luna)
│       ├── stitcher.ts    # Merge batch outputs into chronological JSONL; parseTranscriptJsonlToSegments for merge
│       └── manifestInjector.ts  # Inject sidecar events into transcript
└── scripts/               # Utility/migration scripts
    ├── backfillMergedProctoringVideos.ts # Merge legacy WebM chunks → playback.webm + mergedVideo
    ├── listSubmissions.ts
    ├── seedCompetition.ts   # Link Mongo Competition slug → assessment (hackathon dashboard)
    ├── seedRuntimeSetupMernDemo.ts # Upsert MERN Notes Board assessment + candidate link under demo@bridgeai-demo.com; submit folder is demos/runtime-setup-mern
    ├── seedRuntimeSetupPathfinderDemo.ts # Upsert Warehouse Pathfinder (Python A*/TSP) assessment + candidate link; submit folder is demos/runtime-setup-pathfinder
    ├── seedGuestbookSmoke.ts # 10-min Guestbook smoke under saaz.m@icloud.com + demo@bridgeai-demo.com; evidenceMode both + deterministic E2B checks; completed folder is demos/guestbook-smoke
    ├── seedDemoAssessments.ts # Four demo-grade assessments under saaz.m@icloud.com + demo@bridgeai-demo.com: Webhook Ledger (idempotency/out-of-order, 75m), Flaky Checkout (4 planted bugs to debug, 60m), Standup Board (full-stack rules + UI checks, 90m; known one-shottable — greenfield + full spec), Studio Bookings (brownfield legacy handoff: waitlists + conflict rule + FIFO promotion-with-skip on an inherited working app, regression + new-feature checks, 90m); starters inline, deterministic specs + one agent check each
    ├── seedShortsChallenge.ts # Upsert Shorts daily challenge from shorts/challenges/*.json
    ├── seedShortsLaunchRound.ts # Cold-start round seed driven by shorts/seed-builds/<date>/seed.json: upsert challenge, insert seeded builds + simulated vote graph (--date=YYYY-MM-DD, dry-run unless --apply; refuses if the round already has submissions)
    ├── moveShortsLaunchRound.ts # One-off: re-dated the week-1 seeded round from 2026-08-03 onto 2026-07-27 (kept as a template for date moves)
    ├── swapShortsRounds.ts  # One-off: swapped the seeded memory-match and make-time-visible rounds between 2026-07-27 and 2026-08-03 (kept as a template for round swaps)
    ├── revertShortsRoundSwap.ts # One-off: reversed that swap on 2026-08-03 so make-time-visible is the live launch week; handles real (non-seeded) docs with +1h stamps instead of ±7d
    ├── dropShortsSubmissionUniqueIndex.ts # One-time: drop legacy unique {anonymousId, challengeDate} on PlaySubmission
    ├── generateShortsOgCard.ts # Regenerate the static Shorts share card PNG (SVG → sharp, 1200×630); needs FONTCONFIG_PATH pointing at Inter + Geist Mono to render in-brand
    ├── shorts-sandbox-smoke.ts # Create Shorts E2B template sandbox; print preview URL + Claude check
    ├── transcriptEngineAB.ts # A/B compare transcript engines (gemini vs frames) on one session, no DB writes; list mode + --plan-only cost preview
    ├── registerElevenLabsContextTool.ts # Register/update the `get_candidate_context` webhook tool and attach it (`--dry-run`, `--local` = dev agent + ngrok-pointed dev tool only (refuses the prod agent), `--prod` = production agent + Render tool (default), `--url=`, `--sync-settings` = also PATCH the code-managed agent LLM `claude-haiku-4-5`, 25s turn timeout, `turn_v3` turn detection, and 7200s conversation cap); idempotent
    ├── createElevenLabsDevAgent.ts # One-time: create the `Interview (dev)` twin agent for --local testing (copies prod config + override switches, strips + deletes the webhook tools ElevenLabs clones on create)
    ├── behavioral-grading-smoke.ts
    ├── e2b-smoke.ts
    └── test-assessment-generation.ts
```

### API Routes Summary

**User routes** (`/api/users`):
- `POST /create` -- Register new user (auth required)
- `GET /whoami` -- Get current user info / login with tier limits (auth required, strict rate limit: 5/15min)
- `POST /delete` -- Delete account + all data including Pinecone namespaces (auth required)

**Assessment routes** (`/api/assessments`):
- `POST /generate` -- AI-generate assessment from job description; response includes `behavioralChecks` and `starterCodeFiles` (auth required)
- `POST /generate-behavioral-checks` -- Generate stack-agnostic behavioral checks from `title` + `description` (manual creation path; auth required)
- `POST /` -- Create assessment with subscription tier check (auth required); optional `behavioralChecks` array
- `GET /` -- List user's assessments (auth required)
- `GET /:id` -- Get single assessment (auth required)
- `PATCH /:id` -- Update assessment (auth required); optional `evidenceMode` (`both` / `none`; leftover `workflow` / `screen` still accepted)
- `DELETE /:id` -- Delete assessment + all submissions + Pinecone data (auth required)
- `POST /:id/chat` -- **Bridge Assistant**: chat with AI about an assessment (auth required). Body `{ message, allowedSections?, history? }`; `history` is prior turns oldest-first (last 8 replayed). **This route is the single writer for the changes it makes** — it persists them and returns the saved `assessment`, and the editor renders that rather than re-saving. Returns **502** with a readable sentence when the model returns nothing or a cut-off reply, instead of falling through to the generic 500

**Competition routes** (`/api/competitions`, public):
- `GET /:slug` -- Competition + assessment summary for hackathon dashboard (metadata, rules, dates)
- `POST /:slug/join` -- Self-serve registration: creates a **pending** submission (same as employer generate-link) and returns `token` + `shareLink`; does **not** apply employer free-tier submission limits; stricter rate limit in production (30/hour/IP); duplicate email per assessment returns 409
- `GET /:slug/leaderboard` -- Public leaderboard for submitted candidates (rank by combined Screen + Behavioral score via `leaderboardScore.ts`); top 50 default, `?limit=` max 100; respects `leaderboardPublic` on the competition document

**Ops routes** (`/api/ops`, Firebase auth + `OPS_ADMIN_EMAIL` allowlist — cross-account):
- `GET /workload` -- Aggregated heavy/risk workload: active merges, transcript generation, pending behavioral/evaluation, large sessions; attributes employer (email/company), assessment, submission, proctoring stats; includes in-process merge/grading queue depths for this Render instance. Query: `hours` (default 24), `limit` (default 80). Not crash telemetry — correlate with Render logs.

**Shorts routes** (`/api/shorts`, consumer product — requires `SHORTS_ENABLED=true` except health; every route is also served under the legacy `/api/play` alias):
- `GET /health` -- Always on; smoke check `{ ok: true, product: "shorts" }`
- `GET /round` -- Manually selected current round (`isActive: true`); 404 `{ error: "no_active_round" }` if none. `GET /today` is a legacy alias.
- `GET /period` -- Compatibility shape `{ cadence: "manual", periodKey, periodEndsAt: "", label }`; `periodKey` is the active round's `challengeDate`, never a calendar-derived key.
- `GET /challenges` -- Public archive: all published rounds, newest first (`limit` ≤ 200, default 52); each with `slug`, `title`, `challengeDate`, `category`, `submissionCount`, `isCurrent`
- `POST /account/link` -- Claim the caller's `anonymousId` for the signed-in Firebase account (Bearer ID token; no admin allowlist). Idempotent; max 25 linked ids per account
- `GET /account/submissions` -- All submissions across every `anonymousId` linked to the signed-in account, newest round first, each with per-round `rank` and `challengeTitle`
- `GET /admin/challenges` -- List challenges (Firebase + `SHORTS_ADMIN_EMAIL`; query: `limit`, `from`, `to`, `status`)
- `GET /admin/challenges/:slug` -- Single challenge (admin)
- `POST /admin/challenges` -- Create challenge (admin); optional `makeMode` (`e2b` | `serverless`)
- `PATCH /admin/challenges/:slug` -- Update challenge (admin); optional `makeMode` (`e2b` | `serverless`) — the site's Build-mode toggle
- `POST /admin/challenges/:slug/activate` -- Make a published challenge the current round (admin). This is the only operation that changes rounds; publishing and dates do not. Closes unfinished sessions from the previous round, best-effort kills their E2B sandboxes, and removes legacy calendar expiry from current-round sessions
- `POST /session` -- Create or resume E2B build session (`{ anonymousId }`); returns `previewUrl`, `chatMessages`, `expiresAt` (wall-clock build limit); reconnects sandbox or restores `workspaceSnapshot` if box died; provisions Claude `ANTHROPIC_*` + `llmProxyToken`. When running seats are full: **503** `{ code: "session_queue", activeCount, maxConcurrent, estimatedWaitSeconds }` (client waitlist polls)
- `POST /session/:id/pause` -- Pause E2B sandbox while user leaves Build (`{ anonymousId }`); skipped while `currentTurn.status === "running"` so an in-flight `claude -p` is not killed. Session stays active until submitted/cancelled or an admin activates another round.
- `POST /session/:id/cancel` -- Abandon an in-progress build (`{ anonymousId }`): kill the E2B sandbox if any, mark the session `expired` with reason "Cancelled by user" so it frees a concurrent seat (serverless included — status flip only). Idempotent when already expired/failed; **400** if already submitted. Client navigates to Shorts home (`/`) after success.
- `POST /session/:id/restart` -- Reset an active build to the starter once per session (`{ anonymousId }`): clears chat + `workspaceSnapshot`, increments `restartsUsed` (max **1** — **409** `{ code: "restart_limit" }` on a second try), reprovisions E2B or refreshes serverless preview. **409** `turn_running` while a turn is in flight. Credits are unchanged.
- `POST /session/:id/resume` -- Resume paused sandbox / keep-alive running box; refresh `previewUrl`
- `GET /session/:id/usage` -- Token meter (`?anonymousId=`) → `{ tokensUsed, tokenBudget, remaining, exhausted }`
- `GET /session/:id/files` -- List workspace files for Monaco (`?anonymousId=`)
- `GET /session/:id/file` -- Read one file (`?anonymousId=&path=`)
- `PUT /session/:id/file` -- Write one file (`{ anonymousId, path, content }`) into E2B; upserts session `workspaceSnapshot`
- `GET /session/:id/workspace-revision` -- Workspace fingerprint for preview refresh (`?anonymousId=`); serverless returns a `workspaceSnapshotAt`-derived revision (no sandbox)
- `GET /session/:id/preview` and `GET /session/:id/preview/*` -- **Serverless make mode only:** serve the live session's generated file(s) from `workspaceSnapshot` (`?anonymousId=`; ownership-checked; `Cache-Control: no-store`). This is the iframe `previewUrl` for serverless builds (E2B builds preview from the sandbox instead); its absolute base comes from `SHORTS_PUBLIC_API_URL` → `http://localhost:$PORT` in dev → `SHORTS_LLM_PROXY_PUBLIC_URL` in production, and is re-stamped on every session create/resume so a stale base can't strand an existing session
- `POST /session/:id/llm/v1/messages` -- Anthropic-compatible Messages proxy for Claude Code in E2B (Bearer `llmProxyToken`); streams; increments `tokensUsed`; **429** when over `tokenBudget`
- `POST /session/:id/claude/message` -- Claim a durable turn lock and start generation in-process. **202** `{ turnId, status: "running" }` immediately. Same prompt while running is idempotent; a different in-flight prompt is **409**. Dispatches on the session's `makeMode`: **E2B** runs `claude -p` in the sandbox; **serverless** makes one Anthropic Messages call that returns patches, a full HTML document, or a plain-text chat answer. Both meter tokens and append `chatMessages` when the turn finishes (`{ anonymousId, prompt, model?, effort? }`; `effort` is ignored in serverless). Poll `GET /session/:id/turn/:turnId` for `output` / `workspaceChanged` (`true`/`false` serverless, `null` for E2B). Session GET also returns `currentTurn` so a refresh can resume waiting.
- `GET /session/:id/turn/:turnId` -- Poll one claimed turn (`?anonymousId=`; ownership-checked). `{ id, status, prompt, startedAt, finishedAt?, error?, output?, workspaceChanged?, usage? }` — `usage` is present when the turn has completed.
- `POST /submit` -- Snapshot workspace files into a **new** `PlaySubmission` (`{ sessionId, anonymousId, displayName }`), mark session submitted, kill sandbox. **Optional auth** (`optionalAuthToken`): a valid Bearer ID token stamps `firebaseUid` on the submission and links the `anonymousId` to that account in the same request; guests submit unauthenticated exactly as before; **400** `{ code: "starter_only" }` if snapshot is still the unchanged / near-empty starter. Never overwrites an earlier build — repeat submits create additional independent entries, each starting at default μ/σ, **capped at 3 live builds per person per round** (`MAX_SUBMISSIONS_PER_ROUND`); a fourth is **409** `{ code: "submission_limit", count, max }` with error **"You ran out of builds for this round."** Signed-in `smahadkar@ucsd.edu` is exempt (`unlimitedSubmit.ts`).
- `GET /submissions` -- Public gallery list (`challengeDate`, `limit`, `anonymousId`); metadata only (no `files`); includes `previewRevision` and `isMine`. Also returns `mine[]` — every entry belonging to `anonymousId`, independent of `limit`, so a builder always finds their own work
- `GET /submissions/:id` -- Public submission detail (`previewRevision`; optional `includeFiles`, default true; omit `files` when false). **Optional auth** so `isMine` is also true for a build stamped with that account (another device)
- `GET /submissions/:id/download` -- Download a build's files (public, like the gallery preview). A single stored file — the common serverless self-contained `index.html` — downloads as itself (`<slug>.html`, opens straight in a browser); multi-file builds stream as a zip (`archiver`) rooted in a `<slug>/` folder with an `ABOUT.txt` naming the build, round, and submission URL. Filename slug from `displayName` (`playDownloadBaseName`); snapshot secrets dirs re-filtered via `filterPlayPublicFiles`; `Access-Control-Expose-Headers: Content-Disposition` so the client can read the chosen name cross-origin
- `POST /submissions/:id/star` / `DELETE /submissions/:id/star` -- Save/unsave a build as a **private bookmark** (optional auth; body `{ anonymousId }`). Starring upserts on the unique `{anonymousId, submissionId}` index (idempotent); unstarring deletes across the whole signed-in account (browser id + linked ids + uid stamp) so a build unsaved on one device doesn't reappear from another. **No public star counts anywhere, by design** — a visible tally on gallery cards would anchor votes the same way visible ratings would
- `GET /stars` -- The caller's saved builds (`?anonymousId=`, optional auth), newest star first, across linked identities; returns `{ ids, submissions }` where submissions are gallery-card summaries with per-round ranks. `?idsOnly=true` skips the summary/rank load — the gallery only needs membership to paint filled stars. Stars on deleted builds are dropped (and `deleteSubmission` removes the rows)
- `DELETE /submissions/:id` -- Owner-delete (`{ anonymousId? }` + optional Bearer). Guest: this browser's `anonymousId` must match. Signed-in: uid stamp, linked browser ids, or this browser. Same cleanup as admin delete (votes + round-recap scrub; ratings not recomputed). **401** if neither credential is presented; **403** `submission_forbidden` if they don't own it. Returns `{ deleted: true, id, displayName, challengeDate, votesRemoved }`
- `PATCH /submissions/:id` -- Owner-rename (`{ displayName, anonymousId? }` + optional Bearer). Same ownership rules as owner-delete; `displayName` validated like submit (trim, 1–40 chars). Returns `{ renamed: true, id, displayName, challengeDate }`
- `GET /share` -- OpenGraph share card (HTML, not JSON) for a submission (`?id=`). Target of the Shorts Vercel **bot-UA rewrite**: `shorts/client/vercel.json` rewrites `/Submission` to this endpoint when the user-agent is a social crawler (iMessage/WhatsApp/X/Slack/…), so shared links unfurl with the build + challenge title while humans get the SPA. Unknown ids fall back to a generic Bridge Shorts card (never 404 — that would kill the preview). Meta-refreshes humans to the client page; canonical base from `SHORTS_FRONTEND_URL` → prod `shorts.bridge-jobs.com` → dev `localhost:5174`. Lives in `services/shorts/sharePage.ts`
- `GET /preview/:id/:revision` -- Serve stored `index.html` for a submission at immutable `submittedAt` revision (security headers + long cache)
- `GET /preview/:id/:revision/*` -- Serve a stored snapshot asset by exact relative path (same headers); path-safe, skips `.claude`/`.git`/`node_modules`
- `GET /admin/submissions` -- List submissions (admin; query `challengeDate`, `limit`; omits `files`)
- `GET /admin/submissions/:id` -- Full submission including `files` (admin)
- `DELETE /admin/submissions/:id` -- Delete a submission (admin). Also deletes every `PlayVote` naming it on either side, and `$pull`s / `$unset`s it out of that date's `PlayVoteRound` snapshots, so nothing dangles. Ratings are **not** recomputed — opponents keep the points they already won from beating it (unwinding would mean replaying the round). Returns `{ deleted: true, id, displayName, challengeDate, votesRemoved }`
- `GET /vote/next` -- Next pairwise pair (`anonymousId`, optional `challengeDate`, `preferId`, `includeFiles` default true); **open to everyone — no submit required**; returns round counter (`n/5`), `previewRevision`, and `weighted` (whether this voter's picks count toward the ranking). Stops with `no_pairs_left` when every unique opponent pair has been seen; a new submission that creates combinations reopens matchups. The `must_submit` and `vote_cap_reached` reasons are retired and no longer emitted, though the union members survive for older clients
- `POST /vote` -- Cast pairwise vote; optional body `includeFiles` (default true). Response carries `weighted` and `roundComplete`. A **weighted** vote (voter has submitted for this round) updates Bayesian ratings and returns a round ranking recap every 5th vote; voting continues until unique pairs run out (no count budget). An **unweighted** vote is persisted and completely inert — no rating change, no `wins`/`losses`/`matches`, no `PlayVoteRound` row, no recap. The `403 must_submit` is retired
- `GET /leaderboard` -- Rankings by conservative Bayesian score `μ−3σ` (`challengeDate`, `limit`, `anonymousId`). **One row per submission** — every build ranks independently, so a builder with several entries occupies several rows (each flagged `isMine`); `total` is the submission count. `you` is that builder's highest-ranked entry. Ranks match the gallery's, which uses the same all-submissions ordering

**Workflow capture routes** (`/api/workflow-capture` — always mounted):

Hooks-first capture of the candidate's AI-agent conversation + code changes, as an alternative to screen recording. The candidate runs [`capture-kit/setup.js`](capture-kit/setup.js) in the assessment repo; it discloses what is recorded, requires typed consent, then writes `.claude/settings.json` hooks that POST each prompt / tool call / assistant reply here in real time. See [`capture-kit/README.md`](capture-kit/README.md).

**Per-tool coverage:** **Claude Code** streams live via hooks. **Codex CLI** and **Cursor** have no usable live hook path for us, so they are imported from the stores they already keep — `capture-kit/codex-adapter.js` reads `~/.codex/sessions/**/rollout-*.jsonl` (only rollouts whose recorded `cwd` matches the project; reads `response_item` records only, since `event_msg` duplicates them; skips `developer`-role system context) and `capture-kit/cursor-adapter.js` reads a **copy** of Cursor's `state.vscdb` (`cursorDiskKV` → `bubbleId:*`). Both offer `--probe` (report only, sends nothing) and `--watch`. Cursor's schema is reverse-engineered and has already changed once (2.6 → 3.0) — probe after any Cursor update. Windsurf/Amp route through vendor backends and **cannot** be captured at all.

- `GET /health` -- always on; `{ ok: true, product: "workflow-capture" }`
- `POST /sessions` -- create a capture session; **400 `consent_required` unless `consentGranted: true`**. Returns `captureToken` exactly once
- `POST /events` -- batch ingest from the kit (Bearer `captureToken`). Idempotent on `(sessionId, seq)` so the kit's offline queue can retry freely; oversized payloads are truncated, never rejected. Only kit-legal event types are accepted — `screen_context` is rejected at ingest because it is server-derived trusted evidence a candidate must not be able to forge. A `Write` tool event carries the new file contents and updates live code state. After the session is completed, returns **202** `{ closed: true, note: "session_completed" }` so the kit can stop locally.
- `POST /snapshot` -- changed-file snapshot (Bearer `captureToken`); git when available, else a bounded project walk (unzipped starters often have no repo). Catches hand edits the agent never made
- `POST /complete` -- close the session (Bearer `captureToken`)
- `GET /me` -- the candidate's own captured record (Bearer `captureToken`). Transparency feature, not a debug route: the setup disclosure promises they can see exactly what was collected, and this is how that is kept. Backs `capture-kit/view.js`
- `GET /agent-context` -- **live** context for the ElevenLabs interviewer agent (`X-Agent-Secret`, shared with `/api/agent-tools`): recent conversation in chronological order + current code state, by `submissionToken` or `sessionId`
- `GET /sessions/:id` -- full timeline for employer review (Firebase auth; ownership-checked via the linked submission; never returns `captureToken`). Each event is stamped with `videoOffsetSeconds` when the submission also has a screen recording, so a reviewer can click a prompt and seek the player to it; response carries a `video` block (merged-recording status/duration). Events outside the recording window get `null`, not a bogus offset
- `POST /video/start`, `POST /video/chunk` (multipart, field `chunk`), `POST /video/stop` -- leftover kit recorder (Bearer `captureToken`), kept for the local tester. **Refused on `both`** (`409 screen_recorded_by_proctoring`) — that mode already records via proctoring. Sync origin for Review is proctoring `stats.captureStartedAt`, not kit `video.startedAt`. Chunks go to disk via multer diskStorage, never the heap.
- `GET /sessions/:id/video` -- kit playback (dev/tester); production Review plays the proctoring signed S3 URL, never this stream

**Grading a workflow submission.** When `evidenceMode` resolves to `workflow`/`both`, `ensureProctoringTranscriptAndEvaluate` grades the hook stream via [`evaluateWorkflowSession`](server/src/services/workflowCapture/evaluate.ts) (same `evaluateTranscript` orchestrator). Same `evaluationReport` shape is stored on the submission. If no capture-kit session is linked, evaluation **fails clearly** — it does **not** fall back to `generateTranscript` / video OCR. Screen recording in `both` is **one** movie: the proctoring merged `{sessionId}/playback.webm` (Review `<video>`, signed S3). After merge (`mergeSessionVideo` / `completeProctoringForSubmission`), `classifyScreenGaps` runs Gemini surface identification on **that** file (`MEDIA_RESOLUTION_LOW` / 1fps — not OCR, not `TRANSCRIPT_ENGINE=gemini`) and writes `screen_context` events. Sync origin is proctoring `stats.captureStartedAt` (`event.at − start`), matching Review seeks. `workflow` has no proctoring movie — classification is skipped. The capture-kit recorder is not started on `both`. **Closing capture sessions.** The kit only ends a session when it calls `POST /complete` itself, which the web submit never triggers — sessions sat `active` forever, and since episodes are computed once when capture ends, a finished assessment showed the reviewer "capture is still in progress" and no episode summary. [`services/workflowCapture/finalize.ts`](server/src/services/workflowCapture/finalize.ts) fixes this: `closeCaptureForSubmission(submissionId)` is fired (unawaited) from **every** path that ends an attempt — both GitHub submits, the upload submit, the recording-only finalise, opt-out, and the past-grace reaper (`services/submission/finalizeExpired.ts`). After close, leftover kit POSTs get **202 `closed: true`**; the kit writes `.bridge/ended` and subsequent hooks/watch loops no-op. When a proctoring recording exists (`both`), finalize **closes only** and leaves episodes to `prepareScreenContextForEvaluation` (await merge + classify, then group) inside `evaluateWorkflowCaptureForSubmission`, so hook-silent stretches are described. `none` skips observational evaluation entirely (clears a pending status rather than failing as if the candidate skipped capture). `POST /api/evaluate` kicks off this same background pipeline and returns 202.

**Voice in the graded timeline.** `evaluateWorkflowSession` merges the in-session voice companion transcript (read via [`services/companion/transcript.ts`](server/src/services/companion/transcript.ts), the single reader for the `{proctoringSessionId}/companion/*.jsonl` blobs — the context center uses the same one) into the event stream before `buildTranscriptEvents`, as `voice_utterance` events rendered "Candidate said aloud: …" / "Voice companion asked: …" with action type **`speaking`**. `speaking` is a first-class `ActionType` (types, zod schema, grounder prompt, and `compactTranscript`'s HIGH_SIGNAL set all know it — the last one matters: utterances are rare and must survive downsampling). So the judge sees *"said X"* chronologically beside *"did Y"*, and criteria can cite spoken intent. `EVIDENCE_INVENTORY` (workflow profile) now lists voice with the coverage caveat: criteria may cite what WAS said but must not require narration to exist. **`workflowMetrics` stay voice-free on purpose** — they are the deterministic behavioural floor and speech volume must not move them. Known limitation: the timeline origin is capture-kit start, and the companion starts earlier (at consent), so pre-capture utterances clamp to ts 0.

**Communication assessment** ([`services/evaluation/communication.ts`](server/src/services/evaluation/communication.ts)) runs after grading when any voice exists and lands on the report as `evaluationReport.communication` — **supplementary, deliberately excluded from every combined score** (narration volume measures comfort talking to a bot, not skill; the prompt judges only what WAS said, never how much). Shape: `{ available, utteranceCount, wordCount, clarity 1-10, summary, highlights[], claimChecks[] }`. `claimChecks` is the piece no single stream could produce: every falsifiable spoken assertion ("I tested it", "I'll do the backend first") is checked against the captured timeline and marked supported / contradicted / unverifiable — with screen classification merged in, even "I opened it in Chrome" becomes checkable via `browser:own_app` spans. All citations are validated against real spoken moments (±30s) before storage; fewer than 3 utterances or 25 words → `available: false` with reason, never a hollow score. Costs one extra LLM call per evaluation. Rendered on the Review dialog's Summary tab by [`CommunicationCard.jsx`](client/src/components/submissions/CommunicationCard.jsx) (between the rubric and "How they worked"): clarity + summary, quotable highlights, and the claim-check list with Supported / **Not seen in capture** / Unverifiable badges — "unverifiable" styled grey on purpose (it describes the record, not the candidate). Timestamps seek the recording via the same `handleSeekRecording` path as rubric evidence chips. Render rules: `communication` absent or pipeline-failed → nothing; too-little-speech → one muted factual line ("staying quiet is normal and doesn't affect their score"), never a hollow 0/10.

- **Episodes** ([`episodes.ts`](server/src/services/workflowCapture/episodes.ts)) -- computed **once** when capture ends (after screen classification, so they can describe hook-silent stretches) and **persisted** on the session as `episodes` + `episodesComputedAt`; recomputing per request would cost an LLM call on every dashboard poll. `?episodes=true` on the analysis route also groups raw events into ~15-40 narrative stretches ("fixing stale summary counts", kind `debugging`), each carrying `evidenceIndices` back to the raw events. Thousands of events are too granular to grade and too big for one context; episodes are the middle layer, and the back-pointers are what keep every downstream claim traceable. Text-only, so cost is independent of session length. Opt-in per request because it costs an LLM call. On very long sessions the prompt **samples with a stride** rather than truncating — keeping the first 400 events would describe only the opening minutes and silently discard the rest of the story
- **Evidence validator** ([`evidenceValidator.ts`](server/src/services/workflowCapture/evidenceValidator.ts)) -- checks every citation in a criterion verdict against the captured timeline (±30s tolerance, since a judge summarising a stretch may cite its middle) and **drops what cannot be matched**. A judge will happily cite a timestamp that never existed, and once a verdict reaches an employer a fabricated citation is indistinguishable from a real one. When more than half the support is dropped the verdict is marked non-evaluable rather than keeping a score nothing stands behind
- `GET /sessions/:id/analysis` -- the **gradable** view: deterministic metrics + the timeline as `TranscriptEvent[]`, the exact shape `services/evaluation/` already consumes, so `grounder` → `evaluator` run against a workflow session unchanged (same adapter role as `proctoringTranscriptAdapter`). Every row carries `videoOffsetSeconds` so a cited moment is one click from the footage. Metrics live in [`services/workflowCapture/metrics.ts`](server/src/services/workflowCapture/metrics.ts): read:edit ratio, verified-write ratio, low-effort-prompt ratio, median think time, agent-vs-human authorship, and **token usage** (Claude Code hooks carry no usage, so the kit reads the tail of the `transcript_path` the hook hands it; Codex `token_count` records feed the same field). Counted, never asked of a model — free, reproducible, and it frees the judge for interpretive calls
- Screen classification ([`screenContext.ts`](server/src/services/workflowCapture/screenContext.ts)) runs **after the proctoring merge is ready** on `{sessionId}/playback.webm` (kicked from `mergeSessionVideo` and awaited in the evaluate path before episodes). `POST /sessions/:id/classify-screen` re-runs it manually after a prompt/model change; a re-run **replaces** prior `screen_context` events rather than appending. Auto paths skip if `screen_context` already exists. Gemini over video time ranges at `MEDIA_RESOLUTION_LOW` (**deliberately the opposite of the transcript engine's HIGH** — identifying a surface needs a quarter of the tokens that reading its text does) and **1 fps**. Note "native video input" does not mean continuous watching: Gemini samples frames and charges per frame, so `fps` sets temporal resolution. This was originally 0.2 in gaps / 0.05 elsewhere to save tokens, which meant a 15-second switch to a running app produced at most one frame and was routinely missed; a 90-min session at 1 fps is ~380k tokens (~10¢). The **whole recording** is swept, not just hook-silent gaps — gaps-only was blind to anything happening *alongside* agent activity, such as a ChatGPT window open while Claude Code works. The gap/active distinction survives only in what counts as evidence: during hook-active stretches, editor/terminal observations are stored flagged `redundant: true` so the coverage band stays unbroken while `buildTranscriptEvents` excludes them from grading. A window straddling a recording break is skipped — its endpoints map to valid offsets with no continuous footage between them. `workflow` (no screen share) skips classification.
- `GET /tester` and `GET /dev/data` -- **development only** (not mounted when `NODE_ENV=production`, and `dev/data` re-checks): a self-contained live page that polls every 2s and renders the timeline, stats, and code state as events arrive. Open `http://localhost:5050/api/workflow-capture/tester` while working in Claude Code. Page markup lives in [`services/workflowCapture/testerPage.ts`](server/src/services/workflowCapture/testerPage.ts)

**Submission routes** (`/api/submissions`):

*Employer endpoints (auth required):*
- `POST /generate-link` -- Generate candidate share link (returns token + shareLink)
- `POST /bulk-generate-links` -- Bulk generate share links for multiple candidates (up to 100)
- `POST /send-invites` -- Send invitation emails to candidates via Resend
- `GET /assessments/:id/submissions` -- List submissions for assessment
- `DELETE /:submissionId` -- Delete submission
- `POST /:submissionId/index-repo` -- Index submitted code snapshot into Pinecone (GitHub or uploaded archive)
- `GET /:submissionId/repo-index/status` -- Check repo indexing status
- `POST /:submissionId/search-code` -- Search indexed code (debug)
- `POST /:submissionId/grade-behavioral` -- Trigger manual behavioral grading re-run (E2B + evidence capture); **409** if a run is already in flight for that submission
- `GET /:submissionId/behavioral-artifact` -- Retrieve stored behavioral grading artifacts (screenshots/report files)
- `GET /:submissionId/code-archive` -- Download uploaded candidate archive (upload-source submissions only)
- `POST /:submissionId/runtime/preview` -- Recruiter replay: accept a `kind: "replay"` sandbox job for the **finalized** runtime config (auth + ownership); returns quickly (`accepted`) and runs install/build/start in the background. A session that is already `ready` and still listening is **reused** rather than rebuilt; pass `{ restart: true }` (the panel's Restart) to kill the box and reinstall from scratch. **409** if any behavioral grade is in flight — new replay sandboxes are refused so they cannot evict the grading box; warm reconnect is still allowed
- `GET /:submissionId/runtime/preview/status` -- Recruiter poll: session state + redacted config + previewUrl/health (auth + ownership)
- `GET /:submissionId/runtime/preview/logs` -- Recruiter poll: build/runtime logs (`?after=` seq; auth + ownership)
- `POST /:submissionId/runtime/preview/stop` -- Kill the recruiter replay sandbox (auth + ownership)

*Candidate endpoints (no auth, token-based):*
- `GET /assessments/public/:id` -- Get public assessment details
- `GET /token/:token` -- Get submission by token. If the attempt is still `in-progress` but past `timeLimit` + 5-minute grace, expires it (recording-only tie-out) before responding so a closed tab cannot sit `in-progress` forever.
- `POST /token/:token/start` -- Start assessment (pending → in-progress, captures metadata)
- `POST /token/:token/submit` -- Legacy GitHub URL submit flow (can be disabled via `SUBMISSION_SOURCE_MODE`); accepts late submits within a 5-minute grace period after `timeLimit`, then returns 400 once grace expires
- `POST /token/:token/submit-recording-only` -- Finalize timed-out attempts with proctoring/screen-recording evidence only (no code repo required); marks submission `expired`. Also run by a process reaper (`ATTEMPT_REAPER_*`) and by `GET /token/:token` once grace has elapsed.
- `POST /token/:token/upload` -- Submit code by archive upload (`multipart/form-data`, field `archive`), stores upload metadata, starts indexing, auto-triggers behavioral grading; same 5-minute post-time-limit grace window as GitHub submit
- `POST /token/:token/opt-out` -- Opt out with reason
- `PUT /token/:token/runtime/config` -- Autosave runtime config (feature-gated: `RUNTIME_SETUP_ENABLED`)
- `POST /token/:token/runtime/session` -- Create or resume the setup sandbox (loads snapshot; reconnects paused/running box)
- `POST /token/:token/runtime/restart` -- Kill the current sandbox (if any) and provision a fresh one from the submitted snapshot
- `POST /token/:token/runtime/run` -- Install → build → start using saved config; requires a live setup sandbox (`running`/`paused`); **409** if the environment has not been started; returns previewUrl
- `GET /token/:token/runtime/status` -- Session state + previewUrl + health + last run
- `GET /token/:token/runtime/logs` -- Poll build/runtime logs (`?after=` seq)
- `POST /token/:token/runtime/pause` / `.../resume` -- Idle pause / reconnect
- `POST /token/:token/runtime/finalize` -- Persist config, mark verified, tear down sandbox. **409** when the setup has never had a successful run unless the body carries `confirmUnverified: true` — the candidate's confirm dialog is the acknowledgement, not a client-only formality (see "Finalizing an unverified config" below)
- `PATCH /:id` -- Update submission (auto-save)
- `GET /:id` -- Get submission by ID
- `POST /:id/submit` -- Final submission (legacy, also auto-triggers behavioral grading)

**Billing routes** (`/api/billing`):
- `POST /checkout` -- Create Stripe checkout session (auth required)
- `GET /status` -- Get billing status (auth required)
- `POST /cancel` -- Cancel subscription at period end (auth required)
- `POST /reactivate` -- Reactivate canceled subscription (auth required)
- `POST /webhook` -- Stripe webhook (signature verified, handles checkout.session.completed, subscription.*)

**Proctoring routes** (`/api/proctoring`):

*Candidate endpoints (token-based, no auth):*
- `POST /sessions` -- Create proctoring session for a submission
- `POST /sessions/:sessionId/consent` -- Grant screen recording consent
- `POST /sessions/:sessionId/frames` -- Upload a frame (multer, FormData with token)
- `POST /sessions/:sessionId/frames/batch` -- Batch frame upload (not implemented yet)
- `POST /sessions/:sessionId/events` -- Record sidecar events (blur/focus/copy/paste)
- `POST /sessions/:sessionId/complete` -- Mark session as completed
- `POST /sessions/:sessionId/video` -- Upload video chunk (multer, FormData with token)

*Shared endpoints (production requires candidate `?token=` or employer auth + ownership; open in dev for the test pages):*
- `GET /sessions/:sessionId` -- Get session details (response never includes the session `token` — it is the candidate-side credential; also stripped from the employer `by-submission` payload)
- `GET /sessions/:sessionId/transcript` -- Get JSONL transcript

*Companion (in-session voice transcript; candidate token or employer auth for GET):*
- `POST /sessions/:sessionId/companion/prompt` -- Get system prompt + spoken opener for the ElevenLabs companion (body: token). The prompt is assessment-aware (title only) and explicitly forbids solutions, hints, and code. `firstMessage` is a post-start briefing: check-in, title-only project intro, then unzip / starter repo / Node command (screen share already happened on the previous screen). A remount after the companion has already spoken (`companion.status` active/completed) gets a short welcome-back instead of repeating the briefing.
- `POST /sessions/:sessionId/companion/messages` -- Record companion transcript messages (body: token, conversationId?, messages[]); one JSONL blob per flush under `{sessionId}/companion/`
- `POST /sessions/:sessionId/companion/complete` -- Mark the companion conversation finished (body: token)
- `GET /sessions/:sessionId/companion/transcript` -- Get persisted companion transcript (query token or auth; `?format=jsonl` for raw)

**In-session voice companion.** While the candidate works, an ElevenLabs agent listens and
asks the occasional one-line follow-up so their *reasoning* is captured alongside their code.
The spoken opener
(`services/companion/firstMessage.ts`) runs **after Start**, when the companion mounts: a short check-in, the assessment **title** only (never the description), then the on-the-clock setup — unzip starter-code.zip / open the starter repo, run the Node command on the page, type agree, open Claude/Cursor/Codex in that folder. Screen share already happened on the pre-timer gate, so the opener does not re-brief it; a one-liner to keep sharing the entire screen is enough. Prompt notes recap those post-start steps if they ask what to do first, and never read the token or URL aloud. Resume (companion already spoke this session) is a short welcome-back.
When screen recording is required, a lost stream (including resume-after-refresh)
sends an ElevenLabs `sendContextualUpdate` so the companion **speaks every time**
and tells them to reshare their entire screen — not a window/tab; they cannot
continue without sharing. Standing instructions in `COMPANION_PROMPT_BASE` recap
the same if they ask. **It is proactive**, not
answer-only: `COMPANION_PROMPT_BASE` (in `controllers/proctoring.ts`) tells it to poll
`get_candidate_context` with `topics: ["timeline"]` roughly every couple of minutes, read the
`latest` array, and open with a question about something concrete the candidate just did
("you re-ran the dev server twice — what are you checking for?"). It was previously "only
speak when spoken to", which meant it never used the evidence at all. Guardrails that must
survive any edit: at most one proactive question every couple of minutes, `skip_turn` when the
candidate is mid-flow, **never** `code` or `episodes` topics (code makes hinting too easy;
episodes only exist after capture ends, so live it always returns empty), and the hint ban —
"why did you pick that order?" is fine, "have you considered the other way?" is forbidden.
A second set of guardrails came from a live smoke test where the agent interrogated a
candidate all through setup ("what are you working on right now?" on loop), pinged every
silence with "are you still there?", re-read its whole opener mid-conversation, and lectured
about Google Cloud Code after mishearing "Claude Code". All of these must also survive any
edit: **setup is quiet time** (until the timeline shows a prompt to their AI assistant, a
file edit, or an app/test run, the default on every turn is `skip_turn` — unzip/install/agree
activity is never question material); every proactive question must be **anchored to a named
timeline entry**, generic "what are you doing / trying to achieve" invitations are forbidden;
**silence never gets a nudge** (the ElevenLabs turn-timeout hands the LLM a turn when the
candidate is quiet — the prompt tells it that turn is `skip_turn`, never "are you still
there?"; the one sanctioned exception is a single warm "what are you working on?" after
roughly ten minutes of no narration *and* no timeline-anchored question — a fallback, never
a loop, and never used when a concrete question is available); questions target what the
candidate has **not already narrated aloud** — self-explained decisions are captured and are
not re-asked; a bare status update gets at most a brief acknowledgment, not a follow-up question;
the opener is never repeated or paraphrased (and if the candidate says "you already said
that", apologize briefly and go quiet); and the agent never explains or defines tools —
misheard names are let pass, not guessed at.
A third set came from the 2026-08-15 Guestbook smoke, where the agent narrated its own
plumbing — five consecutive turns of "I'm sorry, I'm still unable to access the timeline",
each padded with a re-brief of the setup steps, ending with it asking the candidate to
describe work the tool could already return. These must also survive any edit: **the tool is
never mentioned to the candidate** — not its name, not that it returned nothing, not that it
failed; this now sits in `Hard limits` beside the no-hints rule, which is the one that
demonstrably survives. **Having nothing to say is always `skip_turn`, never a spoken
explanation** — an apology is a turn, and so is "let me know when you're ready" or a repeat of
the setup steps. **Never send the same thought twice in a row**, in any phrasing. **Every tool
result describes that one call only** — an empty read is never a verdict on the session and
never a reason to stop calling, so re-call immediately before every question. And the positive
form of the same rule: *if you want to know what they are doing, call the tool, do not ask
them.* A `user_prompt` with `tool_use` entries behind it in `latest` is now named as the best
question material there is.
A fourth set came from the 2026-08-16 Studio Bookings run, where the agent (then
`gemini-2.5-flash-lite` on a 7s turn timeout) narrated its own waiting five times in a row
("Still in the setup phase. I'll check back in a moment."), replied to every bare "yep"/"all
right", attributed Claude's autonomous file edits to the candidate ("You've made edits to
`time.js` — what changes are you implementing?") and re-described the same activity in new
words each time the candidate corrected it, and quizzed the candidate to recite the
requirements. Fixes, all of which must survive any edit: timeline entries now carry an
**`actor`** field (`candidate` = their typed prompts and speech; `ai_assistant` = every tool
call/edit/command) and the prompt's "Who did what" section forbids attributing assistant
actions to the candidate — the question shape for assistant activity is the candidate's
intent/oversight, never "what are you implementing"; a correction ends that thread for good.
The proactive bar is **surprise, not activity** — routine steps get no question; a burst of
prompts, a reversal, or a contradiction of what they said aloud earns one specific question
naming the surprise. Bare acknowledgments always get `skip_turn` (including acks of the
agent's own line), and the "let me know if…" closing-invitation family is banned. Waiting
narration is banned by name in every phrasing ("I'll check back", "still in the setup
phase", "nothing specific to discuss yet"). Quizzing is banned — never ask them to recite
requirements/spec/plan; an answered question's reworded variants count as answered. The agent
LLM and turn timeout are code-managed (`claude-haiku-4-5`, 25s — up from 7s, which forced a turn
on the model eight times a minute during quiet setup) and re-applied via
`registerElevenLabsContextTool.ts --sync-settings`.
The 2026-08-18 run showed the over-correction: the agent went too quiet — a candidate's first
"just setting up on Terminal" got `skip_turn`, and "I'm testing it out in Chrome, it all looks
pretty good" (a narrated verification moment) got nothing. The rebalance, which must survive
beside the silence rules rather than replace them: **contentful speech always gets at least a
brief warm acknowledgment** (silence is only for bare acks of the agent's own line and repeats
of an already-acknowledged update); **narration is evidence the live timeline cannot see** —
screen classification is post-hoc, so in-browser testing exists live *only* in what the
candidate says aloud, and a narrated verification/decision moment earns an ack or one light
question, never nothing; and the surprise bar admits **firsts** (first prompt, first app run,
first manual test) as question-worthy even when expected.
The 2026-08-19 runs exposed the structural reason proactivity had never once fired: ElevenLabs
gives the LLM a turn only when the candidate speaks or the silence turn-timeout elapses, and
`skip_turn` — which the prompt makes the default — mutes the agent "until the user speaks
again", cancelling that timeout. Since the model ends nearly every turn with `skip_turn`, the
agent was permanently reactive (observed: 105s of silence, a timeline full of Claude Code
activity, zero agent turns, zero tool calls). The fix is a client-side **pulse**: the notch
sends a sentinel user message (`[pulse] …`, `PULSE_INTERVAL_MS` = 120s of no voice activity)
that grants the turn; the prompt's `## Pulses` section tells the agent a `[pulse]` message is
not the candidate — poll the timeline, then one anchored question or `skip_turn`. Pulse
sentinels are filtered out of the stored transcript in `onMessage`, so grading and the
communication assessment never see fake candidate speech (ElevenLabs' own dashboard transcript
still shows them). Same pass added one prompt rule: **never claim you cannot see their work**
(if they ask what they've been doing or what their assistant did, call the tool and answer
from it — the agent had answered "I don't have a way to show what Claude has done", which is
false). An overheard-speech rule (skip garbled dictation cross-talk) was added and then
deliberately reverted — real candidates are locked in during an assessment, and the rule's
failure mode (silently ignoring a candidate the ASR merely garbled) costs more than the
scenario it guarded. Also from this pass: the ElevenLabs conversation `max_duration_seconds` was 600 — the
companion died at 10 minutes — now 7200, the platform maximum, code-managed in
`registerElevenLabsContextTool.ts --sync-settings`; since 7200s is still shorter than the
longest assessment (240 min), the notch **auto-reconnects** on any non-deliberate disconnect
(exponential backoff 2s→30s, 12 attempts; `endedRef` marks deliberate hangups so
submit/opt-out/unmount never trigger it). The reconnect is load-bearing, not a backstop.
**A reconnect is a resume, not a fresh interview:** the reconnect path refetches
`/companion/prompt` first (the server returns a short welcome-back `firstMessage` once
`companion.status` is active, so the full opening briefing is not replayed mid-assessment),
falls back to the stale overrides only if the refetch fails, and sends a
`sendContextualUpdate` on the reconnected `onConnect` telling the agent the session resumed
and earlier topics are already covered — a new ElevenLabs conversation has no memory of the
old one, so without this the "never repeat yourself" rules reset.
**2026-08-19 (later): the prompt was rewritten purpose-first at Saaz's direction.** The
rule-accretion approach above had inverted: 24 rules ended in silence vs 5 permitting a
question, and a live run showed the agent acknowledging everything and asking nothing — a
candidate's delegation-strategy disclosure got "Got it", a stated verification plan got
"Sounds good", and "I think I'm done" got literal silence. `COMPANION_PROMPT_BASE` is now
~5.6k chars (from ~17k) built around purpose over prohibitions: what the interview is *for*
(four reviewer questions — how they decomposed, what they delegated, how they judged AI
output, what they verified before calling it done), the named **moments worth a question**
(approach/delegation explained; testing narrated; reaction to AI output; **completion —
"they say they're done → always ask"**; timeline firsts and surprises), and interview-mode
stance: asking about intentions is allowed ("how are you planning to check that?"),
steering never is ("have you considered…" stays forbidden). The prior waves' failure modes
(nagging, waiting-narration, misattribution, quizzing, opener repeats, tool-mention)
survive as single hard lines or condensed sections — the chronicle above is now the
**regression catalog to test new runs against**, not literal prompt text to preserve. If
the simplified prompt under-delivers on `claude-haiku-4-5`, the intended lever is upgrading
`AGENT_LLM` in `registerElevenLabsContextTool.ts` (then `--sync-settings`), not re-adding
rules. The full before/after with the marked-up old prompt lives in the "Companion Prompt
Atlas" artifact (2026-08-19).
It carries the same honesty carve-out as the interviewer: never volunteer that the session is
captured, but never deny it when asked directly (this is about the recording, not the tool —
the never-mention-your-tooling rule above does not license denying that they are recorded). The overlay is
[`ProctoringCompanionNotch.jsx`](client/src/components/proctoring/ProctoringCompanionNotch.jsx):
it auto-starts when mounted with a proctoring `sessionId` + candidate `token`, buffers
transcript lines in memory, and POSTs them every 10s (a failed flush pushes the lines back
onto the buffer rather than dropping them). The server `firstMessage` is passed into
ElevenLabs as `startSession({ overrides: { agent: { firstMessage } } })` — without that field
the dashboard default greeting plays. `CandidateAssessment` passes `reshareRequestId`
so every in-progress stream loss (and resume-after-refresh) calls `sendContextualUpdate`,
**and `shareRestoredRequestId` so every restore sends a superseding "share restored" update.**
The restore half is load-bearing: a contextual update does not force a turn, so the lost
update is routinely *spoken* seconds after the candidate has already reshared (observed live
2026-08-16: restore at 15:35:13, nag at 15:35:19, then four turns of "I can't see your screen"
against a healthy share — the agent has no way to verify a candidate's "it should be shared"
and latches). The restored update is only sent when a lost update was actually delivered
(`lostUpdateDeliveredRef`), so resume paths that resolved before the agent heard anything
inject no noise. The prompt's screen-share section pairs with this: the agent **cannot see
the screen and must never claim it can or cannot** — its only knowledge is these updates,
most recent wins, one demand per lost update, and it never argues with a candidate about
share state. The parent **must** call
`ref.current.endAndFlush()` before completing the proctoring session — `CandidateAssessment`
does this on submit, opt-out, and time-out (`stopProctoringCapture`), and unmount runs it as a backstop. It is gated on
`VITE_ELEVENLABS_AGENT_ID` through [`client/src/config/companion.js`](client/src/config/companion.js);
with no agent id the overlay renders nothing **and** `ConsentScreen` drops its microphone copy,
so a deployment without an agent never asks for the mic or claims it does. `@elevenlabs/react`
is on the 1.x API: `useConversation` requires a `ConversationProvider` ancestor (the component
wraps itself in one), `startSession` is synchronous with errors arriving via `onError`, the
conversation id comes from `getId()`, and `onMessage` receives **raw socket events**
(`user_transcript` / `agent_response`) rather than 0.x's flattened `{ message, source }` —
`normalizeMessage` handles both so an SDK downgrade doesn't silently stop recording.

*Employer endpoints (auth required):*
- `POST /sessions/:sessionId/generate-transcript` -- Trigger AI transcript generation
- `GET /sessions/by-submission/:submissionId` -- Get session by submission ID
- `GET /sessions/:sessionId/playback-video` -- Presigned S3 URL only (auth + ownership). `?format=url` returns `{ url }`; otherwise 302 to the same URL. Video bytes are **never** proxied through this API (a prior Express stream of `playback.webm` is what billed outbound). 503 if S3 cannot sign.
- `GET /sessions/:sessionId/download-video` -- Same as playback (auth + ownership, S3 only). `?format=url` returns `{ url }`; otherwise 302.

**Agent tools** (`/api/agent-tools`):
- `POST /context` -- **Context center**: one budgeted bundle for the in-session voice companion (X-Agent-Secret). Body `{ submissionId, question?, topics? }` → six fail-soft sections. Every section returns `{ available: false, reason }` rather than throwing, because a tool error mid-call stalls a live voice conversation; each is separately budgeted so the bundle stays inside a voice turn (~0.3s, ~5KB typical).
  - `assessment` — title, description, time limit, behavioral checks
  - `episodes` — the session as 15-40 labelled narrative stretches, read from the **persisted** `session.episodes` (computed once when capture ends, never on the request path). The highest-value section for a voice agent: raw events are far below the altitude an interviewer thinks at
  - `metrics` — deterministic behavioral counts. Prefers the copy on `evaluationReport.workflowMetrics`; computes live only when the session is under `METRICS_LIVE_EVENT_CAP` (4000) events, else reports `session_too_large_for_live_metrics_grade_first`
  - `timeline` — workflow-capture events merged chronologically with proctoring sidecar events, **including `screen_context`** (the Gemini screen classification — the only record of work done outside the captured agent, e.g. a browser AI chat). Also returns `latest` (the last 8 meaningful events, newest first, each with `secondsAgo`) — this is what a proactive question anchors on — and `counts`. **Two exclusion rules keep the entry cap spent on signal, and both are load-bearing:** `screen_context` observations flagged `redundant` are dropped (they exist to keep the coverage band unbroken), and consecutive duplicate sidecar events are collapsed with meaningful events claiming the budget first. Without the second rule a real session returned 32 blur/focus events (13 back-to-back duplicates) against 3 prompts — on a longer session the cap fills entirely with alt-tab churn and the agent sees no prompts at all, while the endpoint still reports `available: true`. **This section is the one exception to the `available: false` contract.** An empty-but-healthy read of a **live** submission (`pending`/`in-progress`) returns `available: true` with empty `latest`/`events` plus `status: "session_just_started"`, `phase: "setup"`, and a plain-language `guidance` line telling the agent to stay quiet and call again — because a realtime voice model reads `available: false` as breakage and says so out loud. It did exactly that on the 2026-08-15 Guestbook smoke: the capture-kit session did not exist for the first 67 seconds, and the agent told the candidate "I'm sorry, I can't access the timeline" on five consecutive turns, eventually asking them to describe activity the tool could already return. Populated reads also carry `status`/`phase`/`guidance`, with `phase: "setup"` (`setup_activity_only`) when only sidecar window-churn has landed — same stay-quiet vocabulary, since there is nothing askable either way. Genuine failure (both the workflow and sidecar queries throwing) is the only path that still returns `available: false`, now `reason: "timeline_unavailable"`; a finished submission with no timeline keeps `no_timeline_recorded_yet`. The `/api/agent-tools/context` log line prints `timeline:✓(empty/setup)` so an available-but-empty read stays visible in logs
  - `conversation` — companion voice transcript
  - `code` — Pinecone chunks keyed to `question` when the repo index is ready, else **live** `WorkflowFileState` files from capture (so the agent can see code mid-assessment, before any submission exists)

  Service: `services/agentContext/contextCenter.ts`. `submissionId` is the universal key (the companion overlay passes it via `dynamicVariables`). Registered on the ElevenLabs agent as the webhook tool `get_candidate_context` by `src/scripts/registerElevenLabsContextTool.ts`

### Rate Limiting (production only, disabled in dev)
- General API: 100 requests / 15 minutes per IP (shared across most `/api/*` routes; proctoring and all `/api/shorts` + `/api/play` excluded)
- Proctoring (`/api/proctoring/*`): 8000 requests / 15 minutes per IP (separate limiter; screen capture is high-volume)
- Agent tools (`/api/agent-tools/*`): 2000 requests / 15 minutes per IP (separate limiter; calls come from ElevenLabs' servers, so concurrent voice sessions share egress IPs — on the general bucket a busy day 429'd the context tool, which fail-soft turns into a silently mute companion. X-Agent-Secret gated)
- Shorts API (`/api/shorts/*`, `/api/play/*` except preview): 8000 requests / 15 minutes per IP (separate limiter). Build polls usage + workspace-revision + session; E2B sandboxes hit the LLM proxy from shared egress IPs. On the general 100/15min bucket a real builder 429'd with "Too many requests from this IP" within a couple of minutes
- Shorts preview (`/api/shorts/preview/*`): 3000 requests / 15 minutes per IP (separate limiter; gallery iframe assets)
- Auth endpoints (`/api/users/whoami`): 5 requests / 15 minutes per IP
- Competition join (`POST /api/competitions/:slug/join`): 30 requests / 60 minutes per IP

### Raw Body Parsing
`/api/billing/webhook` uses `express.raw()` before `express.json()` to preserve the raw body for Stripe signature verification. This is configured in `server.ts`.

### AI Prompts (`server/src/prompts/index.ts`)
- `PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS` -- Extract requirements, infer stack/level from job description
- `PROMPT_GENERATE_ASSESSMENT_COMPONENTS` -- Generate assessment title, description, timeLimit (with few-shot examples)
- `PROMPT_GENERATE_BEHAVIORAL_CHECKS` -- Generate stack-agnostic behavioral checks from title, description, and requirements summary, plus default UI/HTTP acceptance specs (agent is the rare leftover). The prompt spells out **how a check gets verified** — a sandbox agent that installs and starts the repo, drives it in a real Playwright browser, curls it, and reads source — and therefore what it must not ask for: third-party credentials or paid services, two simultaneous users, the passage of real time, absent hardware, pre-seeded data the candidate was never told to create, aesthetic judgement, or unbounded "is fast/secure" claims. One outcome per check (no "and")
- `PROMPT_SUGGEST_CRITERIA` / `PROMPT_VALIDATE_CRITERION` -- Evaluation criteria (the *process* rubric). Both `system` fields are **functions of a `CriterionEvidenceProfile`** (`"workflow"` default | `"screen"`), which splices in `EVIDENCE_INVENTORY` — an explicit list of what that record does and does not contain. This is not cosmetic: the hook stream knows every prompt and command verbatim but records **no reading at all** and no accept/reject event, while a screen recording is the reverse. Criteria written for the wrong record get scored on evidence that was never collected. Under `workflow` the prompts actively reject the old favourites ("reads the requirements before coding", "reviews AI-generated code before accepting") and steer to recorded equivalents ("inspects existing files before the first edit", "edits agent-written code rather than leaving it untouched"). Profile comes from the request's optional `evidence_mode`; only legacy `screen` maps to the screen profile — `workflow`/`both`/`none` all map to `workflow` (an employer writing criteria under `none` is writing them for the mode they'd turn on). Suggestions are re-validated under the same profile before being returned. Eval cases are pinned per profile in `src/scripts/runEvals.ts`. **Evaluability is decided once per criterion, not once per candidate:** grading used to call `validateCriterion` on every run, so a borderline criterion could be graded for one submission and refused (`score 0 · not evaluable`) for the next — an LLM coin flip per candidate. `ensureCriteriaValidations` (`services/evaluation/validator.ts`) now validates each criterion once (lazily, at first grading), persists the verdict on the assessment (`evaluationCriteriaValidations`), and the pipeline reuses it via `EvaluateTranscriptOptions.validations`; editing a criterion's text re-validates it (lookup is by exact text). The validator prompt also carries two boundary rules: recorded file-read/search/listing tool calls ARE what "inspects files" means (never reject over "opened" vs "actually read"), and a multi-route criterion ("exercises the UI or API") is evaluable when any named route leaves a trace — both added after the validator rejected the prompt's own recommended criterion wording in production
- `PROMPT_ASSESSMENT_QUALITY_REVIEW` -- Review and validate generated assessment quality
- `PROMPT_ASSESSMENT_CHAT` -- System prompt for the **Bridge Assistant** (the AI sidebar in AssessmentEditor). Carries the live assessment plus its product checks and evaluation criteria, and describes what each section *is* so edits land in the right one. Two rules are load-bearing: a turn that only asks a question must return empty `updates` and answer in `responseMessage` (it used to be forced to invent a change), and the two list fields are **replacement** lists that may never come back empty — see the wipe guard below
- `LEVEL_INSTRUCTIONS` -- Role-specific guidance for junior/mid/senior difficulty levels
- `PROMPT_TRANSCRIPT_SYSTEM` -- System prompt for GPT-4o-mini vision: raw observation, character-level text accuracy, JSONL output

## Frontend Architecture

### Directory Layout (`client/src/`)
```
client/src/
├── App.jsx                # Root: QueryClientProvider, BrowserRouter, routes, Toaster, Vercel Analytics
├── App.css                # App-level styles
├── index.css              # Global styles (Tailwind directives, CSS variables)
├── pages.config.js        # Page registry: maps page names to components, mainPage="AppIndex"
├── main.jsx               # Entry point, renders App (no StrictMode)
├── assets/
│   └── bridge-logo.svg    # BridgeAI logo
├── pages/
│   ├── Landing.jsx        # Marketing landing (in-code rebuild of the Framer site at bridge-jobs.com; anchor sections #how-it-works/#understand/#demo, assets in public/landing/)
│   ├── Home.jsx           # Authenticated dashboard -- lists assessments, create/delete, account dropdown
│   ├── GetStarted.jsx     # Registration -- email, password, company name
│   ├── CreateAssessment.jsx    # Assessment creation -- AI generation or manual, reads localStorage pending data
│   ├── AssessmentEditor.jsx    # Edit assessment -- title, desc, time, starter files, share links, bulk invite
│   ├── CandidateAssessment.jsx # Candidate views assessment -- workspace setup (screen/starters/capture-kit) before the timer; Start gated on entire-screen share when recording is required (no skip); then brief + submit; capture flushes before submit and only completes after success; pagehide beacons sidecar/companion; past-grace attempts redirect after the server reaper
│   ├── CandidateSubmission.jsx # Shows mock submission data with code review
│   ├── CandidateSubmitted.jsx  # Post-submission confirmation; CTA into RuntimeSetup when enabled
│   ├── RuntimeSetup.jsx        # Candidate runtime config + one-button "Run project" (provisions if needed) + live preview/logs + Restart environment + Finalize
│   ├── HackathonDashboard.jsx  # Challenge join + dashboard/leaderboard only; marketing landing may live on Framer (slug: `?slug=` > env > `config/competition.js`)
│   ├── OpsDashboard.jsx        # Internal ops workload dashboard (OPS_ADMIN_EMAIL); heavy merge/transcript/grading attribution
│   ├── SubmissionsDashboard.jsx # Employer views submissions -- stats, filtering, dropoff analysis, and the single candidate Review dialog (incl. runtime replay)
│   ├── Subscription.jsx        # Billing plans -- Free tier vs Early Access
│   ├── Pricing.jsx             # Public pricing page
│   ├── BillingSuccess.jsx      # Stripe success redirect
│   ├── BillingCancel.jsx       # Stripe cancel redirect
│   ├── CancelSubscription.jsx  # Cancellation form with reason
│   └── Contact.jsx             # Contact/support page
├── api/
│   ├── requests.ts        # Base HTTP client (fetch wrapper: get/post/put/patch/del; parses JSON error bodies so a user sees `error`/`message`, not the raw payload)
│   ├── assessment.ts      # Assessment API: create, list, get, update, delete, generate, chat
│   ├── submission.ts      # Submission API: generateLink, bulk, invites, start, submit, optOut, uploadTrace
│   ├── runtimeSetup.ts    # Candidate runtime setup + recruiter replay (preview/status/logs/stop)
│   ├── competition.ts     # Public competition API: get by slug, join, leaderboard
│   ├── ops.ts             # Ops workload API (admin allowlist)
│   ├── billing.ts         # Billing API: checkout, status, cancel, reactivate
│   ├── user.ts            # User API: verifyUser (whoami), createUser, deleteAccount
│   └── proctoring.ts      # Proctoring API: createSession, grantConsent, uploadFrame, events, complete, video, companion
├── components/
│   ├── assessment/
│   │   ├── AISidebar.jsx               # Bridge Assistant chat sidebar (presentational; the editor owns the conversation)
│   │   ├── sections.js                # Section-id ↔ label contract shared with the server's CHAT_EDITABLE_SECTIONS
│   │   ├── AssessmentSetup.jsx        # Pre-timer gate: entire-screen share + spoken mic check (permission + heard audio + ElevenLabs reachability) required to enable Start when recording/companion is on; zip/brief wait until start
│   │   ├── BehavioralCheckVerification.jsx # Per-check "How is this verified?" editor (UI walkthrough default; agent opt-in)
│   │   ├── CandidatePreviewModal.jsx   # Candidate assessment preview modal
│   │   ├── DocumentBlock.jsx          # Reusable content block with edit, auto-resizing textarea
│   │   └── PresetPills.jsx            # Quick preset job descriptions
│   ├── BulkInviteModal.jsx            # 3-step CSV upload wizard: upload → review → success
│   ├── landing/                       # Marketing-page demos ported verbatim from Framer code components (DemoReplayGlass hero, ProblemSolution comparison, AssessmentGenerator/DevToolsStack/WorkflowTimeline animated cards, SignalCards dark-glass panels, PrizePodium unmounted). Self-contained styles (DM Sans/JetBrains Mono), deliberately outside the app design tokens
│   ├── submissions/
│   │   ├── BehavioralGradingLiveTrace.jsx # Live agent-step trace while behavioral grading is pending
│   │   ├── CommunicationCard.jsx          # Spoken-reasoning assessment on Summary: clarity, highlights, claim checks vs captured timeline (never part of the score)
│   │   ├── EvidenceMomentChips.jsx        # Rubric evidence as clickable time+observation chips that seek the recording
│   │   ├── RuntimeReplayPanel.jsx         # Recruiter read-only runtime config + finalized-run evidence card + Run project / Restart preview/logs (stops the replay sandbox on unmount)
│   │   └── WorkflowActivityTimeline.jsx   # "What they did": prompting conversation + screen beats + episode chapter dividers under the Recording player for `both` (click-to-seek); Summary only for leftover workflow-only. Exports sessionSecondToVideoOffset (episode start → merged-video offset via nearest timeline row)
│   ├── proctoring/
│   │   ├── ConsentScreen.jsx          # Consent dialog before screen recording (no Skip when recording is required)
│   │   ├── RecordingIndicator.jsx     # Floating red recording badge
│   │   ├── StreamStatusPanel.jsx      # Upload stats panel (frames, uploads, dedup)
│   │   ├── ResharePrompt.jsx          # Stream-lost recovery modal (`required` hides continue-without)
│   │   ├── ProctoringCompanionNotch.jsx # In-session ElevenLabs voice companion (notch dropdown, transcript flush; speaks on every stream loss)
│   │   └── VideoTimelineWithCriteria.jsx # Recording player: scrub bar + one evidence lane per criterion (see below)
│   └── ui/                             # 60+ Shadcn UI components (auto-generated, rarely edited)
├── config/
│   ├── api.js             # API_BASE_URL: VITE_API_URL || localhost:5050 (dev) || Render URL (prod)
│   ├── companion.js       # COMPANION_ENABLED — in-session voice companion gate (VITE_ELEVENLABS_AGENT_ID)
│   └── competition.js     # SINGLE_COMPETITION_SLUG — default Mongo competition slug for `/HackathonDashboard`
├── firebase/
│   └── firebase.js        # Firebase client init (auth, analytics)
├── hooks/
│   ├── use-mobile.jsx          # useIsMobile(): viewport < 768px detection
│   ├── useScreenCapture.js     # getDisplayMedia stream lifecycle (single + multi-monitor)
│   ├── useScreenshotCapture.js # Canvas-based PNG frame extraction at intervals
│   ├── useFrameDedup.js        # Client-side pixel-diff dedup
│   └── useFrameUpload.js       # Batched upload with retry + flush
├── lib/
│   ├── query-client.js    # TanStack Query client (refetchOnWindowFocus=false, retry=1)
│   ├── captureUtils.js    # Pure capture utils: captureFrame, pixelDiff, enforceMaxSize, createVideoRecorder
│   ├── companionVoiceCheck.js # Pre-start spoken mic check + ElevenLabs reachability probe (ad-blocker gate)
│   ├── micLevel.js # RMS + speech-hold for that check (accumulates across gaps; the meter uses the same threshold)
│   ├── NavigationTracker.jsx
│   ├── VisualEditAgent.jsx
│   ├── PageNotFound.jsx
│   └── utils.js           # cn() (clsx + tailwind-merge), isIframe
└── utils/
    └── index.ts           # createPageUrl(pageName) → route path
```

### Routing
- Routes are auto-generated from `pages.config.js` -- each key in the `Pages` object becomes a route at `/<PageName>`.
- `mainPage` is set to `"AppIndex"` (auth check → Home or Login) — it renders at `/`. The marketing `Landing` page lives at `/Landing` until the apex domain moves off Framer.
- Additional custom routes for `/billing/success` and `/billing/cancel` are defined in `App.jsx`.
- `vercel.json` has a catch-all rewrite so all routes resolve to `index.html` (SPA behavior).
- Path alias configured: `@/*` maps to `./src/*` (via `jsconfig.json`).

### Authentication Flow
1. User signs up via `GetStarted.jsx`: `createUserWithEmailAndPassword()` + `createUser()` API call → redirect to CreateAssessment
2. User signs in via `Login.jsx`: `signInWithEmailAndPassword()` + `verifyUser()` (GET /users/whoami) → redirect to Home
3. Firebase ID token is sent as `Authorization: Bearer <token>` header on all authenticated API calls
4. Server validates token via `verifyAuthToken` middleware using Firebase Admin SDK
5. Server maps Firebase UID to MongoDB User document via `getUserIdFromFirebaseUid()`
6. Auth state checked via `onAuthStateChanged()` in page components; redirects to `/` if not authenticated

### Data Flow: Assessment Lifecycle
1. **Employer creates assessment**: Landing page → enters job description → stored in localStorage → CreateAssessment page auto-fills → AI generates assessment (extract requirements → generate components → quality review → behavioral checks) → saves to DB; manual path calls `generate-behavioral-checks` then create
2. **Employer edits assessment**: AssessmentEditor page → Bridge Assistant sidebar for refinements → configure time limit, starter files, evidence mode

**Bridge Assistant (the AI sidebar in AssessmentEditor).** Natural-language editing of one
assessment. `AISidebar.jsx` is presentational — `AssessmentEditor` owns `chatMessages` so the
conversation can be replayed to the model as `history` and so an error can render as a red
chat line instead of a `window.alert`. Five sections are editable, and their ids are a contract
between three places that must stay in lockstep: `CHAT_EDITABLE_SECTIONS`
([`services/assessmentChat.ts`](server/src/services/assessmentChat.ts)), the prompt's
`changedSections` list, and
[`client/src/components/assessment/sections.js`](client/src/components/assessment/sections.js) —
`projectDescription`, `title`, `timeLimit`, `behavioralChecks`, `evaluationCriteria`. A name only
one side knows is silently ignored by the other; the editor's "add to context" chips send these
same ids as `allowedSections`, and the server **drops** updates outside that scope rather than
trusting the model to honour the restriction, telling the user which sections it left alone.

Four things were load-bearing enough to be worth not undoing:
- **`maxTokens` is 4000, not 1000.** `assessment_chat` resolves to `gpt-5.6-luna`, a reasoning
  model, so reasoning tokens are billed against the completion budget. At 1000 the model routinely
  emitted nothing or a JSON object cut off mid-string; both surfaced as
  `"Unknown Error. Try Again"`, which is what made the assistant look broken. Empty and
  unparseable replies are now distinct `AssessmentChatError`s → **502** with a sentence that names
  the cause.
- **The chat route is the only writer.** It saves and returns the assessment; the editor calls
  `setAssessmentData(...)` and lets the existing `[assessmentData]` effect re-hydrate every field.
  The old handler additionally re-saved via `handleTitleSave()`, which read `editedTitle` and
  `assessmentData` from a stale closure and **PATCHed the old title back over the one the server
  had just written** — assistant title changes appeared to work and reverted on refresh.
- **`changedSections` is derived server-side from the updates that survived**, not taken from the
  model's own list. The two drifted, and the editor's section highlight runs off it.
- **An empty `behavioralChecks` / `evaluationCriteria` array is ignored.** They are replacement
  lists that drive grading, the chat has no undo, and an accidental `[]` from the model costs more
  than refusing to clear a list by conversation. Clearing is a UI action; the prompt says so.

A turn that only answers a question is a success with `updates: {}` — the prompt says not to
invent a change, and the client no longer requires a non-empty `changedSections` to treat the
response as valid. Covered by
[`server/test/unit/assessmentChat.test.ts`](server/test/unit/assessmentChat.test.ts).
3. **Employer shares link**: Generates unique token-based URL for candidate (single or bulk via CSV upload with email invitations via Resend)
4. **Candidate accesses assessment**: Opens token URL → CandidateAssessment page → pre-timer gate (consent + entire-screen share + voice check when the companion is on; starter files and the brief stay hidden). When `evidenceMode` records the screen (`both` or leftover `screen`), sharing is mandatory: no skip/continue-without, Start is disabled until they share their entire screen (`displaySurface === "monitor"`, or any share if the browser does not report a surface), and a lost stream must be reshared (no dismiss). When `VITE_ELEVENLABS_AGENT_ID` is set, the same gate also runs a spoken mic check (`acquireCompanionMicrophone` + `listenForMicrophoneAudio`) and an ElevenLabs reachability ping so a mute switch, wrong input, or ad blocker fails before the timer starts instead of as a live "Failed to fetch". The in-session companion tells them to reshare their entire screen on every drop after the timer starts. Observation off (`none`) or leftover `workflow` does not require screen share. Start assessment begins the timer (`in-progress`), downloads the zip, and reveals the assignment
5. **Candidate submits code**: Uploads project folder (client auto-zips) or submits GitHub link → backend stores source metadata (upload archive or pinned commit SHA) → status: submitted
6. **Code indexing**: Repo is downloaded, chunked (200 lines/chunk, 40 line overlap), embedded via OpenAI, and upserted to Pinecone (used by the companion context center's code section when the index is ready)
7. **Scoring**: Combined employer/leaderboard score from available signals — Process (how-they-worked rubric via `evaluationReport`) and Behavioral (E2B check pass rate). Deprecated Trace / LLM-workflow scoring was removed.
8. **Employer reviews**: SubmissionsDashboard → stats, filtering, dropoff analysis, and **one** candidate Review dialog. Observational evaluation starts automatically on submit (and the dashboard re-kicks recent/recoverable failures).

**Recording player (`VideoTimelineWithCriteria`).** The scrub bar and the criteria
evidence are **two separate surfaces**, and that separation is the fix for three problems
that all came from stacking them in one 56px bar. The playhead was a hairline with no
`z-index` while every coloured band animated to `z-index: 10/20`, so the marker telling a
reviewer where they were sat *behind* the colours. There was no drag — the bar took a click
and nothing else, so moving through a 90-minute recording meant clicking, watching, clicking
again. And every criterion's moments were layered into the same 48px block, which on a long
session compressed into a rainbow smear.

Now: a dedicated **scrub bar** (pointer drag with capture, click, `role="slider"` keyboard —
arrows ±5s, shift ±30s, Home/End, space — plus a buffered range, hover time bubble, ±10s
buttons and a 1×/1.5×/2× speed toggle), and below it a **lane per criterion**, each with its
name in a left gutter. Colour is now *secondary* to vertical position, so the palette no
longer has to carry the whole signal; clicking a lane name isolates that criterion and dims
the rest. One playhead line crosses the ruler and every lane at `z-30`, above all bands.
Keep it that way — anything that puts evidence and the playhead back in the same stacking
context reintroduces the original bug.

Scrubbing is **live**: the frame under the cursor updates mid-drag. Writing `currentTime`
on every pointermove queues a precise seek per move and the browser defers them, so the
picture only caught up on release — instead a seek pump keeps exactly one seek in flight
(latest drag target wins, drained from the element's `seeked` event), uses `fastSeek`
where it exists (keyframe-accurate is fine for a moving preview; Chrome lacks it and gets
the throttle alone), and lands one precise seek on release. While dragging, `timeupdate`
is ignored and the `currentSec` sync effect stands down — both would write the lagging,
keyframe-snapped element time back over the pointer position.

Two details are load-bearing: `setPointerCapture` is wrapped in try/catch (it throws for a
pointer id the element never saw, and an unguarded throw aborts the handler — i.e. the click
would not seek at all), and `onClick` on the track is a deliberate second path for anything
that delivers only a click. Seeking twice to the same second is a no-op. The pre-existing
`pendingSeekRef` / `flushPendingSeek` machinery — which holds an evidence-chip seek until
HAVE_METADATA — is untouched and still the reason a Summary chip can jump into a player that
has not loaded yet.

**Candidate review is a single surface.** Clicking a row (or its `Review` button) opens one dialog via `openReview(submission, tab?)` — the only entry point. It carries a persistent scoreboard (Combined / Process / Behavioral / Time spent + status badges) that does **not** move between tabs, an `Actions` menu (GitHub, download archive, re-run grading, re-run scoring, share, delete), and four tabs: **Summary** (capture-integrity warning first when dirty, then which product checks failed, then rubric verdicts + clickable evidence chips that seek the recording, session summary, workflow metrics + episodes), **Recording** (player with criteria timeline; under `both`, the prompting conversation + screen-context beats sit under the player as the click-to-seek index of the footage — there is no screen transcript; leftover `screen` assessments still show a video OCR transcript; the tab is hidden for `none` and leftover `workflow`), **Code** (behavioral grading, per-check evidence, execution log, run project), **Conversations** (opt-out notice, in-session voice companion).

**"What they did" vs "How they worked" are two altitudes of the same record, connected by
the chapters.** "What they did" (`WorkflowActivityTimeline`) is the conversation index —
prompts (cream bubble), agent replies, screen-surface beats — with the session's persisted
`episodes` interleaved as chapter divider rows at their start second, so the transcript reads
as a chaptered document. "How they worked" (Summary) is the summary altitude: counted stats,
the deterministic metrics grid, and the same episodes as a labelled list. Do not merge them —
but keep them connected: episode rows in both places are click-to-seek into the recording via
`sessionSecondToVideoOffset`, which maps a session-relative second onto the merged video by
anchoring on the nearest analysis-timeline row carrying both `ts` and `videoOffsetSeconds`
and carrying the delta (the two clocks share no origin — capture-kit start vs proctoring
`captureStartedAt`). The workflow-only Summary instance of the conversation deliberately gets
no chapter dividers: the episode list renders directly below it in the same card, and
dividers would duplicate it.

This replaced a maze: a right-side detail Sheet, a separate evaluation modal, a standalone Interview Details modal, a standalone Behavioral Grading Evidence modal, and two duplicate `View screen recording` shortcuts that existed only to jump past a default tab. Four ways to open evaluation and three renderings of the same behavioral evidence made the same content feel like different features. **Do not add a second path to any of this content** — deep-link a tab with `openReview(sub, "recording")` instead of building another modal. The video-load effect is still gated on `evaluationTab === "recording"`, so the recording only fetches when that tab is open.

### Subscription / Billing Flow
1. User clicks upgrade → `POST /api/billing/checkout` creates Stripe Checkout session
2. User completes payment on Stripe-hosted page
3. Stripe sends `checkout.session.completed` webhook → backend updates user's `subscriptionStatus` to `"active"`
4. Subscription changes (cancel, update, expire) come through as Stripe webhooks
5. Paid features are gated **inline in the controllers**, not by middleware: `controllers/assessment.ts` and `controllers/user.ts` read `user.subscriptionStatus || user.subscription?.subscriptionStatus` and compare against `"active"`. There is no `requireSubscription` middleware — it existed but was never mounted on a route, and was deleted.
6. `utils/subscription.ts` also exports `isSubscribed()` / `getSubscriptionStatus()` with the same top-level-then-legacy-nested fallback, but **nothing currently imports them** — the controllers duplicate that logic inline. Prefer calling the util if you touch this code.
7. Free-tier limits are **off for now** (`shouldEnforceFreeTierAssessmentLimit()` always returns `false`). When re-enabled, the production cap is 1 assessment (3-submission cap is documented but not enforced). Paid tier remains unlimited.

## Database Models

### User
Fields: `firebaseUid` (unique, indexed), `companyName`, `email` (unique, indexed), `companyLogoUrl`

Legacy subscription (nested): `subscription.tier` (free/paid), `subscription.stripeCustomerId`, `subscription.stripeSubscriptionId`, `subscription.subscriptionStatus`, `subscription.currentPeriodEnd`

Current subscription (top-level): `stripeCustomerId` (sparse indexed), `stripeSubscriptionId` (sparse indexed), `subscriptionStatus` (active/canceled/past_due/trialing/incomplete/incomplete_expired/unpaid/null), `currentPeriodEnd`, `cancelAtPeriodEnd`, `cancellationReason`, `cancellationDate`

### Assessment
Fields: `userId` (ref User, indexed), `title` (max 200), `description`, `timeLimit` (minutes, min 1), `starterFilesGitHubLink`, `starterCodeFiles[]` { path, content }, `evidenceMode` (`both` default for new assessments / `none` / leftover `workflow` / leftover `screen` — see below), `behavioralChecks[]` (plain-language observable product behaviors; stack-agnostic), `behavioralCheckSpecs[]` (optional Zod-validated acceptance specs with stable ids; never read raw — resolve via `resolveBehavioralCheckSpecs`), `evaluationCriteria[]` (proctoring/transcript rubric), `evaluationCriteriaGroundings` (optional), `evaluationCriteriaValidations` (optional; persisted per-criterion evaluability verdicts keyed by criterion text + profile — see below)

**`evidenceMode` — how a candidate's work is observed.** Employer choice in AssessmentEditor's timing panel is **Observe session** (`both`, default) or **None**. `both`: record the screen for human playback and low-res surface classification, and analyse the hook stream — the video is **not** transcribed (no OCR stills, no `TRANSCRIPT_ENGINE=gemini` on that movie). `none`: no screen recording and no capture-kit. `workflow` (hooks only, no screen) and `screen` (video + AI transcript) are leftover values: still honoured for existing assessments, not offered as new choices. Documents with no field still resolve to `screen`. Resolution lives in [`server/src/utils/evidenceMode.ts`](server/src/utils/evidenceMode.ts): the assessment field is returned as-is (`none` / `workflow` / `both` / leftover `screen`). There is no `WORKFLOW_CAPTURE_ENABLED` rewrite — that flag is unused, and `/api/workflow-capture` is always mounted. Never read the raw field client-side; `GET /api/submissions/token/:token` returns the *resolved* `evidenceMode`. The candidate sees the `capture-kit` setup command on the in-progress screen when observation is on (`both` or leftover `workflow`). `ensureProctoringTranscriptAndEvaluate` grades the hook stream for `workflow`/`both`, runs the video transcript for legacy `screen`, and skips observational evaluation for `none`. PNG frames are captured only for leftover `screen` (OCR); `both` still records sidecar events (tab/blur/clipboard/idle/stream_lost — the kit does not).

### Competition
Fields: `slug` (unique, lowercase), `assessmentId` (ref Assessment), optional `title` / `description` / `rulesMarkdown` (dashboard copy; title/description fall back to assessment), `registrationOpen`, `competitionStartsAt`, `competitionEndsAt`, `leaderboardPublic` (default true). **Ops:** create an assessment in the app, then insert or update a `Competition` document with that `assessmentId` and share `/HackathonDashboard?slug=<slug>`.

### Submission
Core: `token` (unique, indexed), `assessmentId` (ref Assessment, indexed), `candidateName`, `candidateEmail`, `status` (pending/in-progress/submitted/expired/opted-out), `startedAt`, `submittedAt`, `timeSpent` (minutes)

Code source: `codeSource` (`github`/`upload`), `codeUpload` { storageKey, originalFilename, sizeBytes, sha256, uploadedAt }

GitHub: `githubLink`, `githubRepo` { owner, repo, refType (commit/branch), ref, pinnedCommitSha }

Scores (legacy bag; not used for combined ranking): `scores` { overall, completeness… } — orphaned Trace/completeness fields may remain on old Mongo docs; app logic does not write or read them for scoring.

Screen evaluation: `evaluationReport`, `evaluationStatus`, `evaluationError`, `screenRecordingTranscript`, `enrichedTranscript`, `refinedTranscript`

Opt-out: `optedOut`, `optOutReason`, `optedOutAt`

Metadata: `metadata` { ipAddress, userAgent }

Behavioral grading: `behavioralGradingStatus` (`pending`/`completed`/`failed`), `behavioralGradingError`, `behavioralGradingReport` (runbook summary, per-check verdict/evidence including `blocked`, `verifiedBy`, artifact keys, timings, sandbox metadata, `runbookSource`, optional `runbookFallbackReason`, `score` `{ total, decided, passed, failed, inconclusive, blocked, coverage, passRate }`, `failureCategory`), `behavioralGradingProgress` (live trace written by real E2B runs and the stress-demo simulator; `$unset` when the run completes or fails). Grep server logs with `[behavioral]` plus the submission id.

`failureCategory` is `setup` (candidate project did not install/start), `environment` (E2B/clone/extract/storage), `interrupted` (server restart mid-run), `disabled`, `judge`, `timeout`, or `unknown`. Platform categories (`environment`/`interrupted`/`disabled`) render as amber "our side" in the recruiter UI, never as a red candidate fail. On boot, `sweepInterruptedBehavioralGrading` marks leftover `pending` rows `failed`/`interrupted` because the in-process queue dies with the process. Submit + manual re-run share an in-flight claim so two sandboxes cannot race one submission (`409` on the manual route).

**Grading prefers the candidate's verified commands.** When `runtimeSetup.status === "finalized"` and `verified`, [`runtimeConfigRunbook.ts`](server/src/services/behavioralGrading/runtimeConfigRunbook.ts) maps `runtimeConfig` onto a runbook (install → `install`, build → `setup`, start → `start`, `port` → `portsHint`, `rootDir` → step `cwd`, all steps `origin: "readme"` since nothing is guessed) and the README→runbook LLM call is skipped entirely; the candidate's `envVars` — secrets included, plus `PORT` when the config pins one and the candidate did not — are sourced into every step so the app starts the way it did for them, and secret values are scrubbed out of step evidence. If that attempt does not reach ready, grading kills whatever bound the config's ports, falls back to the planner, and records `runbookFallbackReason`. `runbookSource` (`candidate_config` | `llm`) makes a failure attributable, and the recruiter UI follows it: "README: pass/fail" is meaningless for a run that never read the README, so the badge reads `Commands: candidate setup` instead. Checks with a resolved acceptance spec run through `deterministicChecks.ts` (no LLM). After clone, `extractCapabilities.ts` builds a source-grounded command inventory (named and nameless UI controls plus `fetch`/Express routes); leftover `kind: "agent"` checks are linked to those IDs by purpose (`linkCheckCapabilities.ts`) and instantiated from templates (`synthesizeAcceptance.ts`), not page-text search. UI clicks are `getByRole({ exact: true })` or `click_in_row` (listitem filtered by nonce); leftover `click_text` binds to a catalog name or is `inconclusive` — never `getByText`. An invalid link is `inconclusive` — the agent judge is not asked for a verdict. HTTP `bodyContains` matches compact JSON and object subsets, so `"ok": true` passes against `{"ok":true}` and `{"title":"…"}` passes against a larger created-resource body. Subjective leftovers may still emit `kind: "agent"` and stay on the agent. Procedure errors (fill/click/goto/transport timeout) are `inconclusive`; only a failed assertion after a completed procedure is a candidate `fail`. Setup-failed checks that need a running app are `blocked`, not judged. `passRate` is `passed / decided`; inconclusive and blocked leave the denominator, and coverage under 50% publishes `null`.

**Proof guards cut both ways (`proofGuards.ts`).** A `pass` must rest on the candidate's files, an HTTP response, or a rendered page. A `fail` on a UI-shaped check is *also* rejected when a fill or click timed out and the agent never both mutated the page *and* ran `browser_expect` — `unproven_ui_fail`, which resolves to `inconclusive` after `MAX_GUARD_REJECTIONS`. A successful `browser_goto` alone is not a walkthrough: that is the test5 hole, where `input[type=text]` timed out on an untyped field after the page loaded. A fail built on source review or curl, with no browser mutation, still stands. Related: `browser_snapshot` returns ARIA roles, and `browser_fill`/`browser_click` take **CSS** — role names belong in `browser_fill_role`/`browser_click_role`. `browser_fill` coerces `input[type=text]` to role=textbox (an untyped `<input>` is not `[type=text]`), retries `getByRole('textbox')` / `getByPlaceholder` / the first input after a CSS timeout, and says so in the tool output so the agent stops retrying the dead selector.

Runtime setup: `runtimeConfig` { rootDir, runtime (`auto`/`node20`/`python312` — **stored but never read at execution time**; the E2B image decides which runtimes exist and the start command picks one, so the control is gone from both UIs and the field survives only so old documents parse), installCommand, buildCommand, startCommand, port, healthPath, executionProfile (`web_server`/`cli_stdout`/`unclear`), envVars[] { key, value, secret }, declaredEgressDomains[] }; `runtimeSetup` { status (`not_started`/`in_progress`/`finalized`), verified, lastRunAt, lastRunResult, finalizedAt, snapshotSha256, evidence { healthOk, healthSummary, port, capturedAt, logTail[] } }.

Secret env values are write-only — never returned on GET. Because a blanked secret is otherwise indistinguishable from one that was never filled in, `publicRuntimeConfig` adds `hasValue: boolean` per row and the candidate form renders a "Saved" chip beside an empty secret input.

`runtimeSetup.evidence` is captured **at finalize**, the one moment the health result, resolved port, and log tail are all still in hand, and is what makes `Verified` readable in the recruiter panel without booting a sandbox.

**Finalizing an unverified config.** A config finalized without a successful run is handed to recruiters as-is and fails in the replay exactly as it failed for the candidate — the recruiter sees the candidate's own error wall minutes after a sandbox boots, with no way to edit the commands (the replay panel is read-only). `finalizeSetup` therefore **refuses** (409, `UNVERIFIED_FINALIZE_MESSAGE`) unless the request carries `confirmUnverified: true`; `isVerifiedRuntimeSetup` is the single definition of verified (`runtimeSetup.verified || lastRunResult.ok`) and both the client dialog and the server gate read it, so they cannot drift. The check runs **before** the sandbox is torn down, so a refused finalize leaves the environment alive to run again. The candidate can still finalize a broken setup deliberately — the point is that it takes an acknowledgement, not that it is impossible.

**`npm ci` without a lockfile.** `resolveInstallCommand` in [`run.ts`](server/src/services/runtimeSetup/run.ts) rewrites a leading `npm ci` / `npm clean-install` to `npm install` when neither `package-lock.json` nor `npm-shrinkwrap.json` exists in the run directory, and logs the substitution. Candidates type `npm ci` from muscle memory against starters that ship `package.json` only (the Standup Board starter does), and npm's `EUSAGE` wall then kills install before anything is fetched — in both candidate setup and recruiter replay, which share this path. Only leading flags may sit between `npm` and `ci`, so a candidate's own `npm run ci` script is never rewritten; a probe that fails leaves the command untouched.

Indexes: `{ assessmentId: 1, status: 1 }`, `{ assessmentId: 1, candidateEmail: 1 }`, `{ candidateEmail: 1 }`

### RuntimeSetupSession
Ephemeral E2B box for candidate setup (`kind: setup`) or recruiter replay (`kind: replay`). Durable record is `Submission.runtimeConfig` + the stored code snapshot.

Fields: `submissionId` (indexed), `token`, `kind` (`setup`/`replay`), `e2bSandboxId`, `status` (`provisioning`/`running`/`paused`/`dead`), `runPhase`, `repoPath`, `port`, `previewUrl`, `health`, `startedAt`, `lastActiveAt`, `pausedAt`, `error`, `logLines[]`, `codeLoaded`

Indexes: unique `{ submissionId: 1, kind: 1 }`

`lastActiveAt` is bumped by status **and** log polls, so the idle reaper cannot pause a preview someone is watching. `logLines` are **not** reset on resume — only an explicit restart clears them, so a refresh keeps the history. A recruiter `Run project` on a session that is already `ready` reconnects and reuses the warm box (health re-probed via `appStillListening`); the kill-and-reinstall path lives behind the panel's explicit **Restart**.

### PlayChallenge (bridge-play DB)
Fields: `slug` (unique, lowercase `a-z0-9-`), `challengeDate` (unique, `YYYY-MM-DD` UTC grouping key), `title` (max 120), `prompt` (the written challenge — public copy says **challenge**, never **prompt**), `tokenBudget`, `category` (`widget`/`game`/`tool`/`other`), `status` (`draft`/`published`), `isActive` (default false; unique partial index permits exactly one true), `activatedAt` / `deactivatedAt` (manual switch audit timestamps), `makeMode` (optional `e2b`/`serverless`; unset → `SHORTS_MAKE_MODE` default — the site's Build-mode toggle). No date/window selects the round.

Indexes: unique on `slug`, unique on `challengeDate`, `{ status: 1, challengeDate: -1 }`

### PlayBuildSession (bridge-play DB)
Fields: `anonymousId` (indexed), `challengeSlug`, `challengeDate` (`YYYY-MM-DD` grouping key), `status` (`provisioning`/`active`/`failed`/`expired`/`submitted`), `makeMode` (optional `e2b`/`serverless`; stamped at creation, unset → treated as `e2b`), `e2bSandboxId` (absent for serverless), `previewUrl` (serverless: backend `/session/:id/preview`; E2B: sandbox URL), `tokenBudget`, `tokensUsed` (default 0), `llmProxyToken` (Bearer for Messages proxy; never returned to browser), `llmCalls` (optional counter), `startedAt`, optional legacy `expiresAt`, `chatMessages[]` `{ role, text, createdAt }`, `workspaceSnapshot[]` `{ path, content }` + `workspaceSnapshotAt`, `sandboxPaused`, `restartsUsed`, `currentTurn`, `error`. New sessions have no date-derived expiry.

Indexes: `{ anonymousId: 1, challengeDate: 1, status: 1 }`

**Resume:** same `anonymousId` + active round reconnects the E2B sandbox when alive (or **paused** — connect resumes it); if the box is gone, a new sandbox is provisioned on the **same** session document and `workspaceSnapshot` is restored. Leaving Build pauses the sandbox after a short idle unless a turn is running. The session stays usable until submitted/cancelled or another round is explicitly activated.

**No build clock (removed 2026-08-06):** builds are limited by **credits only**. There
used to be a per-session wall-clock window (default 10 min, `SHORTS_BUILD_TIME_LIMIT_MINUTES`
or per-challenge `timeLimitMinutes`) plus a whole apparatus around it — a header countdown, a
60s warning pop-up, a time's-up pop-up, a full-screen expired state, and a `submitHoldAt`
"submit clock" (`POST /session/:id/submit-hold`) that paused the deadline while the submit
dialog was open. All of it is gone, along with `BuildTimeModal.jsx` and
`getBuildTimeLimitMinutes()`. The reason: the clock's failure mode was losing a *finished*
build while its author typed a name or signed in — the worst thing the product can do — and
the hold that patched it was itself a request that could fail (a rate-limited `submit-hold`
silently resumed the clock). `expiresAt` now means one thing only: the end of the challenge
round. The manual-round migration unsets legacy `expiresAt` on active-round sessions. If a per-build limit is ever wanted again, add
it as a visible, server-enforced budget — do not reintroduce a countdown that can strand a
finished build at submit time.

### PlaySubmission (bridge-play DB)
Fields: `anonymousId` (indexed), `firebaseUid` (optional, sparse-indexed — set when the builder was signed in at submit time), `displayName` (max 40), `challengeSlug`, `challengeDate`, `sessionId`, `files[]` `{ path, content }`, `fileCount`, `totalBytes`, `submittedAt`, Bayesian rating: `ratingMean` (μ, default 25), `ratingDeviation` (σ, default 25/3), `rankingScore` (μ−3σ), `wins`, `losses`, `matches`

Indexes: `{ anonymousId: 1, challengeDate: 1, submittedAt: -1 }`, `{ challengeDate: -1, submittedAt: -1 }`, `{ challengeDate: 1, rankingScore: -1 }`, sparse `{ firebaseUid: 1, submittedAt: -1 }`

**Submissions are independent entries.** A builder may submit up to **3 builds per round** (`MAX_SUBMISSIONS_PER_ROUND` in `services/shorts/submissions.ts`); each is its own document with its own rating. A fourth is refused with **"You ran out of builds for this round."** rather than asking them to delete one. Signed-in `smahadkar@ucsd.edu` skips the cap (`unlimitedSubmit.ts`). There is **no** uniqueness on `{ anonymousId, challengeDate }` — that unique index was removed (submitting used to overwrite the previous build, and the replacement inherited the old build's votes). Owner-delete (`DELETE /submissions/:id`) still takes a build out of the gallery (and currently also frees a live slot). `anonymousId` remains as a non-unique owner tag powering `isMine`, self-vote exclusion, and the "Your submissions" gallery section; `firebaseUid` is the *account*-level owner, stamped when the submit request carried a valid Firebase ID token, so a build submitted right after signing in from the submit dialog belongs to the account even if the browser id is never linked again. The cap counts this browser + (when signed in) linked browsers and uid-stamped builds for that `challengeDate`. `GET /account/submissions` is the union of both. `displayName` is a free-form label — duplicates are allowed and it is not an identity. Existing deployments must drop the legacy unique index once: `npx tsx --env-file=config.env src/scripts/dropShortsSubmissionUniqueIndex.ts` (Mongoose does not drop indexes removed from a schema).

### PlayVote (bridge-play DB)
Fields: `anonymousId`, `challengeDate`, `winnerId`, `loserId` (refs PlaySubmission), `pairKey` (`minId:maxId`), `weighted` (default `true`), timestamps

Indexes: unique `{ anonymousId: 1, challengeDate: 1, pairKey: 1 }`, `{ challengeDate: 1, createdAt: -1 }`

**Weighted vs unweighted votes.** Playing the matchups is open to everyone. **Currently every vote is weighted** — `EVERY_VOTE_IS_WEIGHTED = true` in `services/shorts/voting.ts` short-circuits the `hasSubmitted` gate, because early rounds need vote volume (for the ranking and as collected data) more than gate-keeping; everyone therefore also gets rounds and recaps. Flipping the constant to `false` restores the submitted-a-build-this-`challengeDate` gate, and everything below describes that still-wired mechanism. The gate that used to block non-submitters from voting at all (`must_submit`) is gone — it locked the cheapest, most shareable action in the product behind its most expensive one. `weighted` defaults to `true` and is queried as `{ $ne: false }`, so pre-existing documents (all from submitters) read as weighted and **no migration is needed**. An unweighted vote is stored and completely inert: no `updateRatings1v1`, no `wins`/`losses`/`matches`/`rankingScore` write, no `PlayVoteRound` row, no recap. Historical `weighted: false` documents (from the brief gated window) stay inert in every count. **There is no vote-count budget** — a voter plays until `countRemainingPairs` is 0 (`no_pairs_left`); a new build that creates unseen combinations reopens matchups. The old `MAX_WEIGHTED_VOTES_PER_DAY` (25) cap is retired (`vote_cap_reached` is never emitted).

**One divergence is load-bearing.** Two counts of "votes this person cast" must use different filters, and mixing them up breaks voting:
- `countVotesToday` (the recap round index) and `buildRecap`'s slice → **weighted only**. `buildRecap` matters because `roundIndex` derives from the weighted count, so an unfiltered slice hands the wrong five votes to the first recap of someone who played unweighted and *then* submitted.
- `countRemainingPairs` and `selectPair`'s already-seen `pairKey` set → **every vote, regardless of weight**. Weight-filtering pair exhaustion re-serves a pair the voter already saw, which then 409s on the unique `{ anonymousId, challengeDate, pairKey }` index.

Covered by `server/test/unit/shortsWeightedVoting.test.ts`.

### PlayVoteRound (bridge-play DB)
Fields: `anonymousId`, `challengeDate`, `roundIndex`, `rankSnapshot` (Map of submissionId → `{ rank, score, displayName }` at round start), `seenSubmissionIds[]`, `votesInRound`, `completed`

Indexes: unique `{ anonymousId: 1, challengeDate: 1, roundIndex: 1 }`

### PlayAccountLink (bridge-play DB)
Fields: `firebaseUid` (indexed), `anonymousId`, timestamps. One row per claimed (account, anonymousId) pair — signing in on a device claims that browser's id; account history queries the union of linked ids. Submissions/votes are never rewritten to the account.

Indexes: unique `{ firebaseUid: 1, anonymousId: 1 }`

### PlayStar (bridge-play DB)
Fields: `anonymousId` (indexed), `firebaseUid` (optional — stamped when the starrer was signed in), `submissionId` (ref PlaySubmission), `challengeDate`, timestamps. A private save-this-build bookmark; never surfaced as a public count.

Indexes: unique `{ anonymousId: 1, submissionId: 1 }`, sparse `{ firebaseUid: 1, createdAt: -1 }`, `{ submissionId: 1 }` (delete cleanup)

### ProctoringSession
Core: `submissionId` (ref Submission, unique index), `token` (indexed), `status` (pending/active/paused/completed/failed)

Consent: `consent` { granted, grantedAt, screens }

Screens: `screens[]` { screenIndex, label, width, height, addedAt }

Frames: `frames[]` { storageKey, screenIndex, capturedAt, sizeBytes, width, height, isDuplicate, clientHash }

Sidecar Events: `sidecarEvents[]` { type (enum: tab_switch/window_blur/window_focus/clipboard_copy/clipboard_paste/url_change/idle_start/idle_end/stream_lost/stream_restored), timestamp, metadata (Mixed) }

Transcript: `transcript` { status (not_started/generating/completed/failed), storageKey, generatedAt, error, frameCount, tokenUsage { prompt, completion, total } }

Video: `videoChunks[]` { storageKey, screenIndex, startTime, endTime, sizeBytes } — screen-0 entries are removed after a successful eager merge; other screens' chunk references stay so multi-monitor recordings remain playable and transcribable. Chunk entries are dedup-guarded on `storageKey` (a client retry of an already-recorded chunk neither duplicates the array entry nor double-counts stats).

Merged recording (screen 0): `mergedVideo` { status (`not_started` / `merging` / `ready` / `failed`), storageKey (typically `{sessionId}/playback.webm`), sizeBytes, durationSeconds, mergedAt, error, chunksDeletedAt, mergingStartedAt }. After **complete**, **submit** (all submit paths), or **opt-out**, the server merges + remuxes chunk WebMs into one file in storage, updates Mongo, then deletes screen-0 chunk objects. The playback/download endpoints also run the merge on demand (idempotent, only once the session is `completed`/`failed`) so an early employer view persists the merged file instead of rebuilding it per request. **Video is never proxied through the API** — those routes only return or redirect to a presigned S3 GET. **Memory rule for this pipeline:** video is never held whole in RAM — chunk uploads land on disk via multer diskStorage, the merge streams chunk → temp file → storage (`storeBlobFromFile`), and transcript frame extraction returns disk-backed lazy frames (`makeDiskBackedFrame`; callers own `PreparedSessionData.cleanup()`). Don't reintroduce `fs.readFile` of merged videos or all-frames-in-an-array collections. Also never write `pipeline(src, out, { end: false })` in a per-chunk loop — pipeline does not detach its error/close/finish/end listeners from a destination it didn't end, so N chunks leak ~4N listeners on one WriteStream (a 470-chunk session leaked ~1,900 and OOMed the 512 MB instance); use the `writeWithBackpressure` helper in `videoMerge.ts`. Chunk reads skip blobs missing from storage rather than aborting the whole merge — Mongo can hold `videoChunks` refs to deleted S3 objects, and a merge that fails permanently means every playback request rebuilds the recording from scratch.

Stats: `stats` { totalFrames, uniqueFrames, duplicatesSkipped, totalSizeBytes, captureStartedAt, captureEndedAt }

**Screen-share loss and resume (client, `useScreenCapture.js` + `CandidateAssessment.jsx`).** A lost share must produce a `stream_lost` sidecar event and a resumed one a `stream_restored`. The restore half was silently dead: it was detected by an effect gated on `streams.length > 0 && streamLost`, but `addStreamInternal` calls `setStreams` and `setStreamLost(false)` back-to-back and React 18 auto-batches them, so the render satisfying both conditions never commits (the app does not use StrictMode, so nothing masked it). No session ever recorded a `stream_restored`. The transition now fires **imperatively** off a synchronous `streamLostRef` inside `addStreamInternal`; `noteSharingResumed()` in `CandidateAssessment` is the single writer, and the hook callback, the modal reshare, and a backstop effect (`proctoringEnabled && isSharing`) all funnel through it, so exactly one event lands however sharing came back — including resume-after-refresh, which previously recorded nothing. Related fixes in the same pass, each independently load-bearing: the unmount cleanup was keyed `[streams]`, so React ran the *previous* cleanup on every array change and **adding a second monitor stopped the first one's track** — it is now `[]`-keyed and reads `streamsRef`; `isSharing` is derived from `streams.length` rather than stored, because a stored flag stayed `true` after an external track end and let the setup gate accept a dead share; `internalStopRef` (a boolean cleared on a microtask, i.e. before any task-dispatched `ended` could read it) became `internalStopUntilRef`, a timestamp with a 2s grace plus a `wasTracked` check, so submit/navigation teardown still cannot raise a false `stream_lost`; and video recorders are keyed by the **MediaStream object**, not `screenIndex`, so a replacement stream after a reshare gets its own recorder. Browsers expose no reason code for an ended track, so the hook keeps an always-on ring of recent page events (focus/blur/visibility/pagehide/offline — console output stays behind `DEBUG_SCREEN_SHARE`) and the `stream_lost` sidecar event persists that ring plus the track's label/displaySurface as `metadata`, making every production drop self-diagnosing in Mongo instead of depending on an open DevTools console. **`stats.videoStats.durationSeconds` is client-reported** — `frameStorage.ts` `$inc`s it by each chunk's `endTime - startTime` and `sessionVideoMerge.ts` copies the sum to `mergedVideo.durationSeconds`. The client hardcoded `startTime: Date.now() - 30000`, so every chunk claimed 30s regardless of real length and a 190s session reported 210s (7 × 30). Chunks now carry real per-chunk timing from a `lastChunkAt` cursor. Note the merged file compresses out any gap between loss and reshare, so `videoOffsetSeconds` (`event.at − stats.captureStartedAt`) still drifts by that gap for events after a resume — `stream_restored` now existing is what would let the server correct it.

Companion: `companion` { status (not_started/active/completed/failed), conversationId, startedAt, endedAt, error } — in-session ElevenLabs voice companion transcript stored as JSONL chunks under storage prefix `{sessionId}/companion/`.

Indexes: `{ submissionId: 1 }` (unique), `{ token: 1 }`, `{ status: 1 }`

### WorkflowCaptureSession / WorkflowEvent / WorkflowFileState (experimental)
Hooks-first AI-workflow capture (see the `/api/workflow-capture` routes).

**WorkflowCaptureSession:** `submissionId` (ref Submission, indexed), `submissionToken` (indexed), `captureToken` (unique, secret — returned once at creation, never in review responses), `candidateName`, `source` (default `claude-code`), `status` (`pending`/`active`/`completed`), `consent` { granted, grantedAt, disclosureVersion }, `startedAt`/`lastEventAt`/`completedAt`, `stats` { totalEvents, promptCount, toolUseCount, payloadBytes }, `environment` { cwd, gitBranch, gitRemote, toolVersion, platform }

**WorkflowEvent:** `sessionId` (ref, indexed), `type` (`session_start`/`user_prompt`/`tool_use`/`tool_result`/`assistant_message`/`session_end`/`notification`), `at`, `seq` (kit-assigned monotonic counter), `toolSessionId`, `toolName`, `text` (prompt/reply/command, capped 20k chars), `payload` (Mixed — tool input/result), `truncated`, `cwd`, `gitBranch`, `receivedAt`. Indexes: **unique `{ sessionId, seq }`** (this is what makes ingest idempotent under kit retries), `{ sessionId, at }`

**WorkflowFileState:** `sessionId` (indexed), `path`, `content` (capped 100k chars), `truncated`, `sizeBytes`, `origin` (`agent` = Write contents, Read results, or Edit results with `originalFile`; `snapshot` = kit scan), `revision`, `updatedAt`. Unique `{ sessionId, path }`. Live code for the companion. An Edit tool_use carries only a diff — ingesting that as an empty file is forbidden (it made the voice companion tell a candidate `server.js` was empty). Contents come from the matching `tool_result` (`originalFile` + old/new strings) or a Read, and the kit snapshot fills in the rest. Snapshot uses `git status` when there is a repo; unzipped starters often have none, so the kit falls back to a bounded project walk.

Events live in their own collection rather than an array on the session — a long session produces thousands, and unbounded subdocument arrays are what OOMed the proctoring pipeline (see `videoChunks` history).

### RepoIndex
Fields: `submissionId` (ref Submission, indexed), `source` (`github`/`upload`), `owner` (indexed, github source), `repo` (indexed, github source), `pinnedCommitSha` (indexed, github source), `uploadSha256` (indexed, upload source), `status` (queued/indexing/ready/failed), `pinecone` { indexName, namespace }, `stats` { fileCount, chunkCount, totalChars, filesSkipped }, `error` { message, stack, at }

Indexes: github partial indexes `{ submissionId: 1, pinnedCommitSha: 1 }`, `{ owner: 1, repo: 1, pinnedCommitSha: 1 }`; upload partial index `{ submissionId: 1, uploadSha256: 1 }`

## AI Provider Configuration

The app uses LangChain to abstract AI providers. You can configure providers globally or per use case:

| Use Case                 | Env Override Key                          | Default Model                         |
|--------------------------|-------------------------------------------|---------------------------------------|
| Assessment generation    | `AI_PROVIDER_ASSESSMENT_GENERATION`       | Varies by provider                    |
| Assessment chat          | `AI_PROVIDER_ASSESSMENT_CHAT`             | Varies by provider                    |

Global default: `AI_PROVIDER` (defaults to `openai`).

Default models per provider:
- OpenAI: `gpt-5.6-luna` (`gpt-5.6-terra` for assessment generation)
- Anthropic: `claude-3-5-sonnet-20241022`
- Gemini: `gemini-1.5-pro`

Per-provider per-use-case model overrides follow the pattern: `{PROVIDER}_MODEL_{USECASE}` (e.g., `OPENAI_MODEL_ASSESSMENT_GENERATION=gpt-5.6-sol`).

## Deployment

- **Frontend**: Deployed on **Vercel**. Builds with `vite build` from the `client/` directory. SPA rewrites via `vercel.json`.
- **Backend**: Deployed on **Render**. Runs via `npm start` which executes `tsx src/server.ts`. No Docker. Environment variables set in Render's dashboard.
- **Database**: MongoDB Atlas (cloud).
- **No CI/CD**: No GitHub Actions or automated pipeline configured. Deployments are triggered via Git pushes to Vercel/Render.
- **Stripe webhooks**: Production endpoint is `https://bridge-assessements-1.onrender.com/api/billing/webhook`.

## Code Quality & Config

- **ESLint**: Client-side only (`client/eslint.config.js`, flat config v9+). Lints JSX components and pages. Plugins: react, react-hooks, unused-imports.
- **TypeScript**: Backend runs via `tsx` (no compile step). Frontend uses `jsconfig.json` with path aliases.
- **Tailwind CSS**: Custom theme in `client/tailwind.config.js` with Shadcn UI variables, sidebar variants, accordion animations, dark mode (class strategy).
- **Shadcn UI**: Configured in `client/components.json` with "new-york" style, Lucide icons, CSS variables enabled.
- **No Prettier** config found.

### Bridge design system (`client/`, the assessments app)

The app is styled to match the marketing site at `bridge-jobs.com`: warm monochrome, ink
`#21201C` on white and cream `#FAF9F2`, Inter at weight 500 with negative tracking for
headings, **Geist Mono uppercase** (`0.03em`) for CTA and nav labels. Fonts load from Google
Fonts in [`client/index.html`](client/index.html) — Inter is requested **with its `opsz` axis**,
so `font-optical-sizing: auto` gives the display cut the landing calls "Inter Display".

Three files own the look; change tokens there, not in pages:

| File | Owns |
|---|---|
| [`client/src/index.css`](client/src/index.css) | shadcn CSS variables (warm palette), `h1–h4` weight/tracking, the `.eyebrow` mono label utility |
| [`client/tailwind.config.js`](client/tailwind.config.js) | colour-ramp remap, `fontFamily`, `ink`/`cream`/`paper`, `rounded-card` + `rounded-pill` |
| `client/src/components/ui/` | primitive shapes — pill buttons, card radius, input height |

**Gotcha — the colour ramps are remapped.** In `tailwind.config.js`, `gray` / `slate` /
`zinc` / `neutral` / `stone` **and the cool accents** `blue` / `indigo` / `violet` / `purple` /
`sky` / `cyan` / `teal` all resolve to one warm neutral ramp. Writing `text-blue-600` gets you
warm grey, not blue — that is deliberate, and it is what let ~1,400 pre-existing utilities go
warm without touching JSX. Status colours stay distinguishable but warmed: `red`/`rose`/`pink`
→ brick, `amber`/`yellow` → ochre, `orange` → clay, `green`/`emerald`/`lime` → sage. For a
genuinely new accent, add a named colour rather than reaching for a cool ramp.

`Button` puts Geist Mono uppercase on the CTA-shaped variants (`default`, `secondary`,
`outline`, `destructive`) and deliberately leaves `ghost` and `link` in Inter sentence case —
those back inline table actions and dropdown triggers, where uppercase mono wrecks density.
The one deliberate exception to the monochrome rule is `REGION_COLORS` in
[`BoundingBoxOverlay.jsx`](client/src/components/proctoring/BoundingBoxOverlay.jsx) and
`FrameDebugViewer.jsx`: six proctoring region hues that encode data over screenshots, so they
stay separable (warmed and desaturated, but not collapsed).

## Keeping This File Updated

**This file must be updated whenever any of the following changes are made:**

1. **API routes**: A route is added, removed, or its path/method/auth changes → update "API Routes Summary"
2. **Pages or frontend routes**: A new page is added or routing changes → update "Frontend Architecture" and "Routing"
3. **Port configuration**: Server `PORT` default or Vite config changes → update "Ports and URLs"
4. **Database models**: A model is added or schema fields change → update "Database Models"
5. **External services**: A new integration is added (AI provider, payment, webhook, email) → update "Tech Stack" and relevant sections
6. **Environment variables**: Variables are added or changed → update "Environment Variables"
7. **Deployment**: Hosting targets change → update "Deployment"
8. **Middleware or rate limiting**: New middleware or rate limit rules → update "Rate Limiting" or "Backend Architecture"
9. **Authentication flow**: Auth mechanism changes → update "Authentication Flow"
10. **Directory structure**: Files/folders are added, moved, or removed → update the relevant directory layout
11. **AI provider configuration**: New use cases or providers → update "AI Provider Configuration"
12. **CORS origins**: Allowed origins change → update "Ports and URLs" and the `allowedOrigins` array in `server/src/server.ts`
13. **Prompts**: New AI prompts are added → update "AI Prompts" section
14. **New services or controllers**: Update the backend directory layout and add descriptions
15. **Frontend components**: New components added to `client/src/components/` → update the frontend directory layout
16. **Dependencies**: Major new packages added → update "Tech Stack"

**When in doubt, update this file.** It is the single source of truth for understanding this codebase.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. The
skill has multi-step workflows, checklists, and quality gates that produce better
results than an ad-hoc answer. When in doubt, invoke the skill. A false positive is
cheaper than a false negative.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke /office-hours
- Strategy, scope, "think bigger", "what should we build" → invoke /plan-ceo-review
- Architecture, "does this design make sense" → invoke /plan-eng-review
- Design system, brand, "how should this look" → invoke /design-consultation
- Design review of a plan → invoke /plan-design-review
- Developer experience of a plan → invoke /plan-devex-review
- "Review everything", full review pipeline → invoke /autoplan
- Bugs, errors, "why is this broken", "wtf", "this doesn't work" → invoke /investigate
- Test the site, find bugs, "does this work" → invoke /qa (or /qa-only for report only)
- Code review, check the diff, "look at my changes" → invoke /review
- Visual polish, design audit, "this looks off" → invoke /design-review
- Developer experience audit, try onboarding → invoke /devex-review
- Ship, deploy, create a PR, "send it" → invoke /ship
- Merge + deploy + verify → invoke /land-and-deploy
- Configure deployment → invoke /setup-deploy
- Post-deploy monitoring → invoke /canary
- Update docs after shipping → invoke /document-release
- Weekly retro, "how'd we do" → invoke /retro
- Second opinion, codex review → invoke /codex
- Safety mode, careful mode, lock it down → invoke /careful or /guard
- Restrict edits to a directory → invoke /freeze or /unfreeze
- Upgrade gstack → invoke /gstack-upgrade
- Save progress, "save my work" → invoke /context-save
- Resume, restore, "where was I" → invoke /context-restore
- Security audit, OWASP, "is this secure" → invoke /cso
- Make a PDF, document, publication → invoke /make-pdf
- Launch real browser for QA → invoke /open-gstack-browser
- Import cookies for authenticated testing → invoke /setup-browser-cookies
- Performance regression, page speed, benchmarks → invoke /benchmark
- Review what gstack has learned → invoke /learn
- Tune question sensitivity → invoke /plan-tune
- Code quality dashboard → invoke /health
