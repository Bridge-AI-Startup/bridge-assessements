# Mini Bridge — core assessment loop

A **stripped-down** version of Bridge’s core product (no GitHub, no competitions, no AI, no billing):

1. **Submission lifecycle** — `pending` → `in-progress` → `submitted` via token endpoints; `startedAt` / `submittedAt` / `timeSpent`.
2. **Token scope** — Candidate token loads **only** that submission and its assessment’s public fields; no cross-assessment data.
3. **Employer submission list** — Authenticated list for an assessment with `status` and `search` (email/name) filters.

## Challenges (take-home)

See **`challenge.md`** for the full list of intentional bugs and features to implement.

---

## What this mirrors (core Bridge, not hackathon)

1. **Submission lifecycle** — Token-based `pending` → `in-progress` → `submitted`, with `startedAt`, `submittedAt`, `timeSpent` (no GitHub submission).
2. **Token scope** — `GET /submissions/token/:token` returns only that submission plus **public** assessment fields; employer-only data never appears here.
3. **Employer list** — `GET /submissions/assessments/:assessmentId/submissions` with `?status=` and `?search=` (name/email), scoped to assessments owned by the bearer.

## Layout

```
assessment/
├── server/     # Express + Mongoose + TypeScript
└── client/     # Vite + React (employer + candidate flows)
```

## Run locally

### MongoDB

Use Atlas (see `server/config.env.example`) or local:

```bash
mongod --dbpath /path/to/data
```

### Backend

```bash
cd assessment/server
cp config.env.example config.env
# edit ATLAS_URI + DB_NAME
npm install
npm run seed   # optional: demo user + assessment + sample submissions
npm run dev
```

Server defaults to `http://localhost:5060`.

### Frontend

```bash
cd assessment/client
echo 'VITE_API_URL=http://localhost:5060/api' > .env.local
npm install
npm run dev
```

Open the Vite URL (e.g. `http://localhost:5174`). Paste **Employer API token** from seed output (or from `POST /api/users/bootstrap` response) into the employer screen. Use a **candidate token** from generate-link on the candidate screen.

## API overview

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/users/bootstrap` | No — dev-only, creates first user + token if none exist |
| POST | `/api/assessments` | Bearer |
| GET | `/api/assessments/:id` | Bearer, owner |
| POST | `/api/submissions/generate-link` | Bearer |
| GET | `/api/submissions/assessments/:assessmentId/submissions` | Bearer, owner |
| GET | `/api/submissions/assessments/public/:id` | Public |
| GET | `/api/submissions/token/:token` | Public (token) |
| POST | `/api/submissions/token/:token/start` | Public (token) |
| POST | `/api/submissions/token/:token/submit` | Public (token), body `{ submissionNotes? }` |

Authentication: `Authorization: Bearer <apiToken>` for employer routes. Tokens are opaque strings stored on the user document (not Firebase in this mini app).

## Environment

| Variable | Description |
|----------|-------------|
| `ATLAS_URI` | MongoDB connection string |
| `DB_NAME` | Database name |
| `PORT` | Server port (default `5060`) |
| `FRONTEND_URL` | CORS origin (e.g. `http://localhost:5174`) |
