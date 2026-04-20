import type { RequestHandler } from "express";
import { createUser, listUsers } from "../repositories/inMemoryStore.js";
import { generateApiToken } from "../utils/token.js";

/**
 * Dev convenience: create the first employer user if the database is empty.
 * Disable in production by omitting calls or checking NODE_ENV.
 */
export const bootstrapUser: RequestHandler = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    const users = listUsers();
    if (users.length > 0) {
      const existing = users[0];
      return res.status(200).json({
        email: existing.email,
        companyName: existing.companyName,
        apiToken: existing.apiToken,
        hint: "Using existing seeded user. Send Authorization: Bearer <apiToken>.",
      });
    }
    const email =
      typeof req.body?.email === "string" && req.body.email.trim()
        ? req.body.email.trim().toLowerCase()
        : "employer@example.com";
    const companyName =
      typeof req.body?.companyName === "string" ? req.body.companyName.trim() : "Demo Co";
    const apiToken = generateApiToken();
    const user = createUser({ email, companyName, apiToken });
    res.status(201).json({
      email: user.email,
      companyName: user.companyName,
      apiToken: user.apiToken,
      hint: "Send Authorization: Bearer <apiToken> on employer routes.",
    });
  } catch (e) {
    next(e);
  }
};
