/**
 * Quick validation of markdown trace parsing.
 * Run: npx tsx src/scripts/validateMarkdownTrace.ts
 */
import { parseTraceMarkdown } from "../utils/fileUpload.js";

const sampleMd = `## User
How do I add auth to my MERN app?

## Assistant
Use JWT. Create a route /login that checks credentials and returns a token.

## User
What about the frontend?

## Assistant
Store the token in localStorage and send it in the Authorization header.

---
total_tokens: 1500
total_cost: 0.05
total_time_seconds: 3600
---
`;

const file = {
  buffer: Buffer.from(sampleMd, "utf-8"),
  originalname: "test.md",
  mimetype: "text/markdown",
} as any;

const out = parseTraceMarkdown(file);
console.log("Events:", out.events.length);
console.log("Session metadata:", out.sessionMetadata);
console.log("First prompt:", out.events[0].prompt?.slice(0, 60) + "...");
console.log("First response:", out.events[0].response?.slice(0, 60) + "...");
console.log("OK - markdown trace parsing works.");
