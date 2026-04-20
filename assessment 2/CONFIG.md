# Configuration (`assessment/`)

This starter uses an in-memory repository (no external database process).

- No Atlas setup
- No local Mongo daemon
- No Docker

## Runtime behavior

When the server starts, it seeds in-memory fixtures (user, assessments,
submissions) inside the process.

Restarting the process resets state to the fixture defaults.

## Backend (`assessment/server`)

`server/config.env` is committed with safe defaults:

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default `5060`) |
| `FRONTEND_URL` | CORS origin for the client (`http://localhost:5174`) |
| `NODE_ENV` | Runtime mode |

## Frontend (`assessment/client`)

`client/.env.local` is committed:

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | API base URL, default `http://localhost:5060/api` |

## Health check

`GET http://127.0.0.1:5060/health` should return:

```json
{ "ok": true }
```
