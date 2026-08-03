import { describe, expect, it, vi } from "vitest";

// serverlessMake.ts reaches the Shorts models, and shortsConnection.ts throws at
// import time without ATLAS_URI. Nothing here calls connectPlayMongoose(), so a
// placeholder is enough to import the module — no connection is ever opened.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/serverless-make-test";
});

import { classifyMakeResponse } from "../../src/services/shorts/serverlessMake.js";

const DOC = `<!DOCTYPE html>
<html>
<head><style>body{font:16px system-ui;margin:0;padding:24px}</style></head>
<body>
<h1 id="clock">00:00</h1>
<script>setInterval(()=>{document.getElementById("clock").textContent=new Date().toLocaleTimeString()},1000)</script>
</body>
</html>`;

describe("classifyMakeResponse", () => {
  it("keeps the lead-in answer when a turn both answers and rebuilds", () => {
    const raw = `The drift came from setInterval, which loses a few ms per tick. Switched it to read the clock each tick.\n\n${DOC}`;
    const result = classifyMakeResponse(raw);

    expect(result.kind).toBe("html");
    if (result.kind !== "html") return;
    expect(result.html).toBe(DOC);
    expect(result.note).toContain("setInterval");
    // The chat message must never carry the file itself.
    expect(result.note).not.toContain("<html");
  });

  it("returns an empty note for a build with no prose, so the caller can fall back", () => {
    const result = classifyMakeResponse(DOC);

    expect(result.kind).toBe("html");
    if (result.kind !== "html") return;
    expect(result.note).toBe("");
  });

  it("strips markdown fences the model wrapped around the document", () => {
    const result = classifyMakeResponse(
      "Bigger digits, and yes it stays centred on mobile.\n\n```html\n" +
        DOC +
        "\n```",
    );

    expect(result.kind).toBe("html");
    if (result.kind !== "html") return;
    expect(result.html).toBe(DOC);
    expect(result.note).toBe(
      "Bigger digits, and yes it stays centred on mobile.",
    );
  });

  it("treats a plain answer as chat and leaves the workspace alone", () => {
    const result = classifyMakeResponse(
      "You could show the time as a shrinking bar instead of digits — want me to try that?",
    );

    expect(result.kind).toBe("text");
  });

  it("does not let a tag mentioned in prose overwrite the build", () => {
    const result = classifyMakeResponse(
      "Wrap it in <html> ... </html> if you export it yourself.",
    );

    expect(result.kind).toBe("text");
  });
});
