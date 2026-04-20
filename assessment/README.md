# Mini Bridge — Core Assessment Loop

A stripped-down Bridge assessment that focuses on three core behaviors:

1. Submission lifecycle (`pending` → `in-progress` → `submitted`).
2. Token-scoped candidate access.
3. Employer submission list filtering and ownership scope.

The challenge brief is in `challenge.md`.

## Layout

```text
assessment/
├── server/              # Express + Mongoose + TypeScript
├── client/              # Vite + React (employer + candidate flows)
├── challenge.md         # Candidate task list
└── CONFIG.md            # Configuration notes
```

## Run (candidate flow)

Config is already committed for local runs:
- `assessment/server/config.env`
- `assessment/client/.env.local`

Backend:

```bash
cd assessment/server
npm install
npm run seed   # optional: sample user + submissions
npm run dev
```

Frontend:

```bash
cd assessment/client
npm install
npm run dev
```

Open Vite (usually `http://localhost:5174`) and use the seeded token/UI.

## Runbook-friendly commands (for behavioral grading agents)

Install:

```bash
cd assessment/server && npm install
cd assessment/client && npm install
```

Start API:

```bash
cd assessment/server && npm run dev
```

Smoke test (API must already be running). Prefer **`curl`** — nested quotes in `node -e "…"` often break when run via `bash -lc` (E2B/grading), which can surface as `fetch failed` / `bad port`:

```bash
curl -sf http://127.0.0.1:5060/health
```

## Database strategy

`mongodb-memory-server` is the only supported DB strategy for this starter.

- No Atlas account required.
- No local `mongod` required.
- First run downloads a MongoDB binary and caches it.

## API overview

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/users/bootstrap` | No (dev-only) |
| POST | `/api/assessments` | Bearer |
| GET | `/api/assessments/:id` | Bearer, owner |
| POST | `/api/submissions/generate-link` | Bearer |
| GET | `/api/submissions/assessments/:assessmentId/submissions` | Bearer, owner |
| GET | `/api/submissions/assessments/public/:id` | Public |
| GET | `/api/submissions/token/:token` | Public (token) |
| POST | `/api/submissions/token/:token/start` | Public (token) |
| POST | `/api/submissions/token/:token/submit` | Public (token) |
