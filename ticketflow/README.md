# TicketFlow

**Debug + Build** take-home starter for BridgeAI demos.

A minimal support ticket system (React + Express/TypeScript). The codebase runs end-to-end but contains **three deliberate bugs** and is missing **two features** described in [`CHALLENGE.md`](./CHALLENGE.md).

## Quick start

```bash
# Terminal 1 — API
cd server
npm install
npm run dev

# Terminal 2 — UI
cd client
npm install
npm run dev
```

- API: `http://localhost:5070`
- UI: `http://localhost:5175`
- Health check: `GET /health`

## Verify the bugs

From `server/`:

```bash
npm test
```

Three tests should **fail** until you fix the corresponding bugs.

## Project layout

```text
ticketflow/
├── CHALLENGE.md      # Candidate requirements
├── server/           # Express + TypeScript API (in-memory store)
└── client/           # Vite + React UI
```

## Intended demo flow

1. Candidate clones the repo and reads `CHALLENGE.md`.
2. They run `npm test` in `server/` and fix bugs one at a time.
3. They implement search + stats dashboard.
4. They submit via BridgeAI with a GitHub link (or upload).

## Notes for Bridge employers

- Link this repo as **Starter Files GitHub Link** on the assessment.
- Suggested time limit: **90 minutes**.
- Behavioral grading can run `npm test` in `server/` after install.
