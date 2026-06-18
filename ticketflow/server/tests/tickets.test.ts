import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import app from "../src/server.js";
import { createTicket, getTicket, resetStore, seedTickets } from "../src/store.js";

describe("TicketFlow API", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  describe("Bug 1 — status state machine", () => {
    it("rejects open → resolved without passing through in_progress", async () => {
      const ticket = createTicket({
        title: "Broken checkout",
        description: "Payment form fails on submit",
        priority: "high",
      });

      const response = await request(app)
        .patch(`/api/tickets/${ticket.id}`)
        .send({ status: "resolved" });

      assert.equal(response.status, 400, response.body?.message ?? "expected 400");
      assert.equal(response.body.error, "INVALID_STATUS_TRANSITION");
      assert.equal(getTicket(ticket.id)?.status, "open");
    });
  });

  describe("Bug 2 — priority filter", () => {
    it('returns only high-priority tickets when ?priority=high', async () => {
      createTicket({
        title: "High severity outage",
        description: "Production is down",
        priority: "high",
      });
      createTicket({
        title: "Minor copy tweak",
        description: "Button label typo",
        priority: "low",
      });

      const response = await request(app).get("/api/tickets?priority=high");

      assert.equal(response.status, 200);
      const priorities = response.body.tickets.map(
        (ticket: { priority: string }) => ticket.priority,
      );
      assert.ok(
        priorities.every((priority: string) => priority === "high"),
        `expected only high-priority tickets, got: ${priorities.join(", ")}`,
      );
    });
  });

  describe("Bug 3 — chronological sort order", () => {
    it("lists tickets oldest-first by createdAt", async () => {
      seedTickets();

      const response = await request(app).get("/api/tickets");

      assert.equal(response.status, 200);
      const titles = response.body.tickets.map((ticket: { title: string }) => ticket.title);
      assert.equal(
        titles[0],
        "Login page returns 500",
        `expected oldest ticket first, got order: ${titles.join(" → ")}`,
      );
      assert.equal(titles[titles.length - 1], "Password reset email delayed");
    });
  });

  describe("Baseline behavior", () => {
    it("creates and fetches tickets", async () => {
      seedTickets();
      const response = await request(app).get("/api/tickets");
      assert.equal(response.status, 200);
      assert.ok(response.body.tickets.length >= 5);
    });
  });
});
