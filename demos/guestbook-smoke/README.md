# Guestbook

A one-file Express app that serves a page and a tiny messages API. No database.

## How to run

```bash
npm install
npm start
```

- App: http://localhost:3000
- Health: `GET /health` → `{ "ok": true }`
- List: `GET /api/messages`
- Create: `POST /api/messages` with `{ "text": "hello" }`

The process reads `PORT` (default `3000`) and binds `0.0.0.0`.

## What to finish

`POST /api/messages` is stubbed and returns **501**. Save the message and return it so the page can show new entries.

Reject a blank `text` with **400**. On success return **201** and `{ message: { id, text, createdAt } }`. Newest messages first on `GET /api/messages`.
