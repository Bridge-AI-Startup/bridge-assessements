import { describe, expect, it, vi } from "vitest";

// serverlessMake.ts reaches the Shorts models, and shortsConnection.ts throws at
// import time without ATLAS_URI. Nothing here calls connectPlayMongoose(), so a
// placeholder is enough to import the module — no connection is ever opened.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/serverless-make-test";
});

import {
  GENERATE_TIMEOUT_MS,
  classifyMakeResponse,
  isGenerationTimeoutError,
} from "../../src/services/shorts/serverlessMake.js";
import { listPlayModelsPublic } from "../../src/services/shorts/models.js";

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

  it("classifies follow-up search/replace blocks as patches", () => {
    const raw = `Colour's in.\n\n*** SEARCH\n<h1 id="clock">00:00</h1>\n*** REPLACE\n<h1 id="clock" style="color:tomato">00:00</h1>\n*** END`;
    const result = classifyMakeResponse(raw);

    expect(result.kind).toBe("patches");
    if (result.kind !== "patches") return;
    expect(result.patches).toEqual([
      {
        search: `<h1 id="clock">00:00</h1>`,
        replace: `<h1 id="clock" style="color:tomato">00:00</h1>`,
      },
    ]);
    expect(result.note).toContain("Colour");
    expect(result.fallbackHtml).toBeNull();
  });

  it("keeps a full document beside patches as a fallback rewrite", () => {
    const raw = `*** SEARCH\n<h1 id="clock">00:00</h1>\n*** REPLACE\n<h1 id="clock">hi</h1>\n*** END\n\n${DOC}`;
    const result = classifyMakeResponse(raw);

    expect(result.kind).toBe("patches");
    if (result.kind !== "patches") return;
    expect(result.fallbackHtml).toBe(DOC);
  });
});

describe("serverless generation latency policy", () => {
  it("allows enough time for a complete full-file generation", () => {
    expect(GENERATE_TIMEOUT_MS).toBe(300_000);
  });

  it("recognizes Node fetch timeout errors without treating other aborts as timeouts", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(isGenerationTimeoutError(timeout)).toBe(true);
    expect(isGenerationTimeoutError(new Error("socket disconnected"))).toBe(
      false,
    );
  });

  it("defaults the consumer build loop to Sonnet while keeping Fable opt-in", () => {
    const publicModels = listPlayModelsPublic();
    expect(publicModels.defaultModel).toBe("claude-sonnet-4-5-20250929");
    expect(
      publicModels.models.find((model) => model.id === "claude-fable-5")
        ?.serverlessOnly,
    ).toBe(true);
  });
});
