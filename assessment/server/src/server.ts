import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "config.env") });
dotenv.config();
import cors from "cors";
import express from "express";
import { connectDb } from "./db.js";
import api from "./routes/index.js";

const PORT = Number(process.env.PORT) || 5060;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5174";
const ATLAS_URI = process.env.ATLAS_URI;
const DB_NAME = process.env.DB_NAME || "bridge-assessment-mini";

if (!ATLAS_URI) {
  console.error("Missing ATLAS_URI");
  process.exit(1);
}

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

await connectDb(ATLAS_URI, DB_NAME);
app.listen(PORT, () => {
  console.log(`Assessment mini API http://localhost:${PORT}`);
});
