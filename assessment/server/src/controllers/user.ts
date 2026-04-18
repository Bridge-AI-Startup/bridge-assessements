import type { RequestHandler } from "express";
import UserModel from "../models/user.js";
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
    const count = await UserModel.countDocuments();
    if (count > 0) {
      return res.status(400).json({
        error: "ALREADY_BOOTSTRAPPED",
        message: "A user already exists. Use your existing API token.",
      });
    }
    const email =
      typeof req.body?.email === "string" && req.body.email.trim()
        ? req.body.email.trim().toLowerCase()
        : "employer@example.com";
    const companyName =
      typeof req.body?.companyName === "string" ? req.body.companyName.trim() : "Demo Co";
    const apiToken = generateApiToken();
    const user = await UserModel.create({ email, companyName, apiToken });
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
