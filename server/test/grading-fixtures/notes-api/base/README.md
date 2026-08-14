# Notes API

A small notes service. Notes are created over HTTP and listed back, and they
survive a restart of the process.

## Setup

```bash
npm install
```

## Run

```bash
npm start
```

The service listens on `http://localhost:4310` (override with `PORT`).

## Endpoints

| Method | Path      | Behavior                                                        |
| ------ | --------- | --------------------------------------------------------------- |
| GET    | `/health` | `200 {"ok": true}` once the service is up                        |
| GET    | `/notes`  | `200 {"notes": [...]}` — every note created so far               |
| POST   | `/notes`  | `201 {"note": {...}}` for `{"title": "..."}`; `400` with an      |
|        |           | `error` message when the title is missing or blank              |
