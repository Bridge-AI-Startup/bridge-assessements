import { describe, expect, it } from "vitest";
import { fileUpdatesFromCaptureEvents } from "../../src/services/workflowCapture/fileState.js";

const SERVER_JS = `import express from "express";

let count = 0;

app.post("/api/greet", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  // BUG: ignores name
  void name;
  res.json({ greeting: "Hello, stranger" });
});
`;

const SERVER_JS_FIXED = `import express from "express";

let count = 0;

app.post("/api/greet", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  res.json({ greeting: \`Hello, \${name || "stranger"}\` });
});
`;

const OLD = `  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  // BUG: ignores name
  void name;
  res.json({ greeting: "Hello, stranger" });`;

const NEW = `  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  res.json({ greeting: \`Hello, \${name || "stranger"}\` });`;

describe("fileUpdatesFromCaptureEvents", () => {
  it("does not treat an Edit tool_use as an empty file", () => {
    const updates = fileUpdatesFromCaptureEvents([
      {
        type: "tool_use",
        toolName: "Edit",
        text: "/tmp/starter/server.js (edit)",
        payload: {
          tool_input: {
            file_path: "/tmp/starter/server.js",
            old_string: OLD,
            new_string: NEW,
          },
        },
      },
    ]);
    expect(updates).toEqual([]);
  });

  it("stores Read tool_result contents (Claude Code file shape)", () => {
    const updates = fileUpdatesFromCaptureEvents([
      {
        type: "tool_result",
        toolName: "Read",
        text: JSON.stringify({
          type: "text",
          file: {
            filePath: "/tmp/starter/server.js",
            content: SERVER_JS,
            numLines: 12,
            startLine: 1,
            totalLines: 12,
          },
        }),
        payload: {},
      },
    ]);
    expect(updates).toEqual([
      { path: "/tmp/starter/server.js", content: SERVER_JS },
    ]);
  });

  it("applies Edit tool_result originalFile + old/new strings", () => {
    const updates = fileUpdatesFromCaptureEvents([
      {
        type: "tool_result",
        toolName: "Edit",
        text: JSON.stringify({
          filePath: "/tmp/starter/server.js",
          oldString: OLD,
          newString: NEW,
          originalFile: SERVER_JS,
        }),
        payload: {},
      },
    ]);
    expect(updates).toEqual([
      { path: "/tmp/starter/server.js", content: SERVER_JS_FIXED },
    ]);
  });

  it("lets a later Edit result win over an earlier Read in the same batch", () => {
    const updates = fileUpdatesFromCaptureEvents([
      {
        type: "tool_result",
        toolName: "Read",
        text: JSON.stringify({
          type: "text",
          file: { filePath: "/tmp/starter/server.js", content: SERVER_JS },
        }),
      },
      {
        type: "tool_result",
        toolName: "Edit",
        text: JSON.stringify({
          filePath: "/tmp/starter/server.js",
          oldString: OLD,
          newString: NEW,
          originalFile: SERVER_JS,
        }),
      },
    ]);
    expect(updates).toEqual([
      { path: "/tmp/starter/server.js", content: SERVER_JS_FIXED },
    ]);
  });

  it("stores Write tool_use content and skips image Reads", () => {
    const updates = fileUpdatesFromCaptureEvents([
      {
        type: "tool_use",
        toolName: "Write",
        payload: {
          tool_input: {
            file_path: "/tmp/starter/hello.js",
            content: "console.log(1)\n",
          },
        },
      },
      {
        type: "tool_result",
        toolName: "Read",
        text: JSON.stringify({
          type: "image",
          file: { filePath: "/tmp/shot.png", content: "iVBORw0KGgo" },
        }),
      },
    ]);
    expect(updates).toEqual([
      { path: "/tmp/starter/hello.js", content: "console.log(1)\n" },
    ]);
  });
});
