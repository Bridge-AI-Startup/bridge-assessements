export type TicketPriority = "low" | "medium" | "high";
export type TicketStatus = "open" | "in_progress" | "resolved";

export interface Ticket {
  id: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
}

export interface CreateTicketBody {
  title: string;
  description: string;
  priority: TicketPriority;
}

export interface UpdateTicketBody {
  title?: string;
  description?: string;
  priority?: TicketPriority;
  status?: TicketStatus;
}

export const VALID_PRIORITIES: TicketPriority[] = ["low", "medium", "high"];
export const VALID_STATUSES: TicketStatus[] = ["open", "in_progress", "resolved"];

/** Allowed status transitions per product requirements. */
export const ALLOWED_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress"],
  in_progress: ["resolved", "open"],
  resolved: ["open"],
};
