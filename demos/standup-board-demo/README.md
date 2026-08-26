# Standup Board

Build a small team task board: three columns, real rules, one Express process
serving both the page and the API. State must survive a restart (files on disk
are fine; a `data/` directory is gitignored for you). No external database.

## How to run

- Install: `npm install`
- Start: `npm start`
- Port: `3000` (or `PORT`)
- Health: `GET /health` → 200 `{ "ok": true }`

## Product rules (all enforced by the server, not just the UI)

- A task has a `title` (required), an optional `owner`, a `status` of
  `todo` → `doing` → `done`, and a `blocked` flag with an optional
  `blockedReason`.
- **WIP limit:** the Doing column holds at most **3** tasks. Moving a fourth
  task to `doing` → 409 `{ "error": "doing_full" }`, and the page shows the
  message **Doing is full** (exactly that text).
- **Blocked rule:** a blocked task cannot move to `done` → 409
  `{ "error": "blocked" }`. Unblock it first.
- **Owner filter:** `GET /api/tasks?owner=<owner>` returns only that owner's
  tasks (exact match).

## API

- `POST /api/tasks` with `{ title, owner?, ref? }` → 201 with the task.
  `ref` is an optional client-supplied unique reference; generate one when
  absent. New tasks start in `todo`, unblocked.
- `GET /api/tasks` → `{ "tasks": [...] }` (optionally filtered by `?owner=`)
- `PATCH /api/tasks/ref/:ref` with any of `{ status, blocked, blockedReason,
  owner }` → 200 with the updated task (or 409 per the rules above).
- `GET /health` → 200 `{ "ok": true }`

## UI contract (our automated review drives your page — keep these exact)

- Serve the board at `/`.
- A text input with placeholder exactly `Task title`, a second input with
  placeholder exactly `Owner`, and a button named `Add task`.
- Render each task as a **list item** (`<li>`) showing its title and owner.
- Each Todo task's row has a button named `Start` (moves it to Doing). Each
  Doing task's row has a button named `Finish` (moves it to Done).
- When the server refuses a move because Doing is full, show the message
  **Doing is full** somewhere on the page.
- Adding or moving a task updates the board without a manual page refresh.

Beyond the contract, layout and styling are yours.
