# Notes Board (MERN)

A small notes board: React client, Express API, MongoDB when `MONGO_URI` is set (in-memory otherwise so it still boots in a sandbox).

## Install

```bash
npm install
npm run build
```

## Start

```bash
npm start
```

The API and the built client are served together.

- App: http://localhost:5050
- Health: http://localhost:5050/health

## Runtime setup (suggested)

| Field | Value |
|---|---|
| Root directory | `.` |
| Runtime | Node 20 |
| Install command | `npm install && npm run build` |
| Build command | _(leave empty — build is in install)_ |
| Start command | `npm start` |
| Port | `5050` |
| Health path | `/health` |
| Execution profile | Web server |

Optional env: `PORT=5050`. `MONGO_URI` is optional.

## What it does

- List / add / complete / delete notes
- `GET /api/notes` and `POST /api/notes` for the API
- `GET /health` returns `{ ok: true }`
