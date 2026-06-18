import { Router } from "express";
import {
  createTicket,
  getTicket,
  listTickets,
  updateTicket,
} from "../store.js";
import type { Ticket, TicketPriority, TicketStatus } from "../types.js";
import {
  ALLOWED_STATUS_TRANSITIONS,
  VALID_PRIORITIES,
  VALID_STATUSES,
} from "../types.js";

const router = Router();

function filterByPriority(tickets: Ticket[], priority: TicketPriority): Ticket[] {
  return tickets.filter((ticket) => ticket.priority === priority);
}

function filterBySearch(tickets: Ticket[], query: string): Ticket[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return tickets;
  return tickets.filter(
    (ticket) =>
      ticket.title.toLowerCase().includes(needle) ||
      ticket.description.toLowerCase().includes(needle),
  );
}

function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function isAllowedStatusTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

router.get("/stats", (_req, res) => {
  const counts: Record<TicketStatus, number> = {
    open: 0,
    in_progress: 0,
    resolved: 0,
  };
  for (const ticket of listTickets()) {
    counts[ticket.status] += 1;
  }
  res.json({ stats: counts });
});

router.get("/tickets", (req, res) => {
  let results = listTickets();

  const priority = req.query.priority as TicketPriority | undefined;
  if (priority) {
    if (!VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        error: "INVALID_PRIORITY",
        message: `priority must be one of: ${VALID_PRIORITIES.join(", ")}`,
      });
    }
    results = filterByPriority(results, priority);
  }

  const status = req.query.status as TicketStatus | undefined;
  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: "INVALID_STATUS",
        message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }
    results = results.filter((ticket) => ticket.status === status);
  }

  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  if (search !== undefined) {
    results = filterBySearch(results, search);
  }

  res.json({ tickets: sortTickets(results) });
});

router.post("/tickets", (req, res) => {
  const { title, description, priority } = req.body ?? {};

  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "INVALID_TITLE", message: "title is required" });
  }
  if (!description || typeof description !== "string") {
    return res
      .status(400)
      .json({ error: "INVALID_DESCRIPTION", message: "description is required" });
  }
  if (!priority || !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({
      error: "INVALID_PRIORITY",
      message: `priority must be one of: ${VALID_PRIORITIES.join(", ")}`,
    });
  }

  const ticket = createTicket({ title, description, priority });
  res.status(201).json({ ticket });
});

router.patch("/tickets/:id", (req, res) => {
  const existing = getTicket(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found" });
  }

  const { title, description, priority, status } = req.body ?? {};
  const patch: Partial<Pick<Ticket, "title" | "description" | "priority" | "status">> = {};

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "INVALID_TITLE", message: "title must be a string" });
    }
    patch.title = title.trim();
  }

  if (description !== undefined) {
    if (typeof description !== "string") {
      return res
        .status(400)
        .json({ error: "INVALID_DESCRIPTION", message: "description must be a string" });
    }
    patch.description = description;
  }

  if (priority !== undefined) {
    if (!VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        error: "INVALID_PRIORITY",
        message: `priority must be one of: ${VALID_PRIORITIES.join(", ")}`,
      });
    }
    patch.priority = priority;
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: "INVALID_STATUS",
        message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }
    if (!isAllowedStatusTransition(existing.status, status)) {
      return res.status(400).json({
        error: "INVALID_STATUS_TRANSITION",
        message: `Cannot transition from ${existing.status} to ${status}`,
      });
    }
    patch.status = status;
  }

  const ticket = updateTicket(req.params.id, patch);
  res.json({ ticket });
});

export { filterByPriority, filterBySearch, sortTickets, isAllowedStatusTransition };
export default router;
