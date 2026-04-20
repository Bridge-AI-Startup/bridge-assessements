import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "config.env") });
dotenv.config();
import cors from "cors";
import express from "express";
import { seedStore } from "./repositories/inMemoryStore.js";
import api from "./routes/index.js";

const PORT = Number(process.env.PORT) || 5060;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5174";

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

app.use("/api", api);

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

const seeded = seedStore();
const server = app.listen(PORT, () => {
  console.log(`Assessment mini API http://localhost:${PORT}`);
  console.log(`Seeded employer token: ${seeded.user.apiToken}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${signal})...`);
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
