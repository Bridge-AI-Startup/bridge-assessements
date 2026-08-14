const path = require("path");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const messages = [];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/messages", (_req, res) => {
  res.status(200).json({ messages });
});

app.post("/api/messages", (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }
  const message = {
    id: String(Date.now()),
    text,
    createdAt: new Date().toISOString(),
  };
  messages.unshift(message);
  res.status(201).json({ message });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`guestbook http://0.0.0.0:${PORT}`);
});
