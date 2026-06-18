# TicketFlow — Debug + Build Challenge

## Scenario

You're joining a team that maintains **TicketFlow**, a lightweight internal support ticket tracker. The MVP shipped quickly and a few regressions slipped through QA. Your job is to fix the bugs, then add two small product features.

**Stack:** React (Vite) frontend + Express/TypeScript API with an in-memory ticket store.

**Time box:** ~90 minutes.

## What already works

- Create tickets (`POST /api/tickets`)
- List tickets (`GET /api/tickets`)
- Update tickets (`PATCH /api/tickets/:id`)
- Basic React UI: list, filters, create form, status dropdown

Each ticket has:

| Field | Values |
|-------|--------|
| `title` | string |
| `description` | string |
| `priority` | `low` \| `medium` \| `high` |
| `status` | `open` \| `in_progress` \| `resolved` |
| `createdAt` | ISO timestamp |

## Part 1 — Fix three bugs

Run the test suite first:

```bash
cd server
npm install
npm test
```

Three tests fail — one per bug. Fix each bug so its test passes. Commit fixes separately if you can.

### Bug 1: Status state machine violation

**Requirement:** Tickets must go through `in_progress` before they can be marked `resolved`. You cannot jump from `open` → `resolved` directly.

**Symptom:** `PATCH /api/tickets/:id` accepts `status: "resolved"` on an `open` ticket.

**Hint:** Look at the PATCH handler in `server/src/routes/tickets.ts`. The allowed transitions are documented in `server/src/types.ts`.

### Bug 2: Priority filter returns wrong results

**Requirement:** `GET /api/tickets?priority=high` must return **only** high-priority tickets.

**Symptom:** Filtering by `high` also returns `low`-priority tickets.

**Hint:** Inspect `filterByPriority()` in `server/src/routes/tickets.ts`. String comparison is not the same as priority ordering.

### Bug 3: Wrong sort order

**Requirement:** Ticket lists must be sorted **oldest first** by `createdAt`.

**Symptom:** Newer tickets appear at the top of the list.

**Hint:** Check `sortTickets()` in `server/src/routes/tickets.ts`.

## Part 2 — Add two features

### Feature 1: Full-text search

Add search support end-to-end:

- **Backend:** `GET /api/tickets?search=query` filters tickets where `title` **or** `description` contains the query (case-insensitive).
- **Frontend:** Add a search input. Typing should filter results.

**Consider:** Should the search input fire on every keystroke? Think about debouncing and API load.

### Feature 2: Stats dashboard

Add a summary of ticket counts by status:

- **Backend:** `GET /api/stats` returns counts grouped by status, e.g. `{ "open": 4, "in_progress": 2, "resolved": 8 }`.
- **Frontend:** Display a summary bar like `Open: 4 | In Progress: 2 | Resolved: 8`.

**Consider:** This endpoint runs on every page load. Would you cache it? Why or why not?

## Acceptance criteria

- [ ] All `npm test` cases in `server/` pass
- [ ] Priority filter returns exact matches only
- [ ] Tickets are listed oldest-first
- [ ] Invalid status transitions return `400` with a clear error
- [ ] Search works on title and description (case-insensitive)
- [ ] Stats endpoint and UI summary bar are implemented
- [ ] App still runs locally (`npm run dev` in server + client)

## Constraints

- Keep the in-memory store — no database required
- Do not rewrite the app from scratch; extend the existing structure
- Focus on correctness and clear error messages

## Deliverables

1. Fixed + extended source code
2. Brief notes in the PR or README on any tradeoffs (debouncing, caching, etc.)

## Nice-to-haves (optional)

- Separate commits per bug fix
- Client-side debounce for search
- Small UI polish without changing core flows
