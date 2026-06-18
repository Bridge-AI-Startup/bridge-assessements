import type { CreateTicketBody, Ticket, TicketPriority } from "./types.js";

let nextId = 1;
const tickets = new Map<string, Ticket>();

function makeTicket(
  partial: Omit<Ticket, "id" | "createdAt"> & { createdAt?: string },
): Ticket {
  const id = String(nextId++);
  const ticket: Ticket = {
    id,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    title: partial.title,
    description: partial.description,
    priority: partial.priority,
    status: partial.status,
  };
  tickets.set(id, ticket);
  return ticket;
}

export function resetStore(): void {
  tickets.clear();
  nextId = 1;
}

export function seedTickets(): Ticket[] {
  resetStore();
  const now = Date.now();
  return [
    makeTicket({
      title: "Login page returns 500",
      description: "Users cannot sign in after the latest deploy.",
      priority: "high",
      status: "open",
      createdAt: new Date(now - 5 * 60_000).toISOString(),
    }),
    makeTicket({
      title: "Export CSV missing headers",
      description: "Downloaded CSV has data rows but no column names.",
      priority: "medium",
      status: "in_progress",
      createdAt: new Date(now - 4 * 60_000).toISOString(),
    }),
    makeTicket({
      title: "Dark mode toggle misaligned",
      description: "Settings toggle overlaps the sidebar on mobile.",
      priority: "low",
      status: "open",
      createdAt: new Date(now - 3 * 60_000).toISOString(),
    }),
    makeTicket({
      title: "Webhook retries exhausted",
      description: "Partner integration stopped receiving events.",
      priority: "high",
      status: "resolved",
      createdAt: new Date(now - 2 * 60_000).toISOString(),
    }),
    makeTicket({
      title: "Password reset email delayed",
      description: "Reset emails arrive 30+ minutes late.",
      priority: "medium",
      status: "open",
      createdAt: new Date(now - 1 * 60_000).toISOString(),
    }),
  ];
}

export function listTickets(): Ticket[] {
  return Array.from(tickets.values());
}

export function getTicket(id: string): Ticket | undefined {
  return tickets.get(id);
}

export function createTicket(body: CreateTicketBody): Ticket {
  return makeTicket({
    title: body.title.trim(),
    description: body.description.trim(),
    priority: body.priority,
    status: "open",
  });
}

export function updateTicket(
  id: string,
  patch: Partial<Pick<Ticket, "title" | "description" | "priority" | "status">>,
): Ticket | undefined {
  const existing = tickets.get(id);
  if (!existing) return undefined;

  const updated: Ticket = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
  };
  tickets.set(id, updated);
  return updated;
}

export function priorityRank(priority: TicketPriority): number {
  return { low: 1, medium: 2, high: 3 }[priority];
}
