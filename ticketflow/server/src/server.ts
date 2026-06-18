import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "config.env") });
dotenv.config();

import cors from "cors";
import express from "express";
import ticketsRouter from "./routes/tickets.js";
import { seedTickets } from "./store.js";

const PORT = Number(process.env.PORT) || 5070;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5175";

const app = express();
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use("/api", ticketsRouter);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    res.status(500).json({ error: "INTERNAL", message: "Server error." });
  },
);

seedTickets();

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`TicketFlow API http://localhost:${PORT}`);
  });
}

export default app;
