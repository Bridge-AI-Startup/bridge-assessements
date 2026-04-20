import type { RequestHandler } from "express";
import { findUserByApiToken } from "../repositories/inMemoryStore.js";

export type AuthedRequest = {
  userId: string;
  apiToken: string;
};

declare module "express-serve-static-core" {
  interface Request {
    employer?: AuthedRequest;
  }
}

export const verifyEmployerToken: RequestHandler = async (req, res, next) => {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: "Missing Bearer token." });
  }
  const apiToken = raw.slice(7).trim();
  if (!apiToken) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: "Empty token." });
  }
  const user = findUserByApiToken(apiToken);
  if (!user) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid token." });
  }
  req.employer = { userId: user.id, apiToken };
  next();
};
