import { describe, expect, it } from "vitest";
import { withCaptureKit } from "../../src/services/workflowCapture/starterKit.js";

describe("withCaptureKit", () => {
  it("ships capture-kit/package.json so setup.js stays CommonJS inside ESM starters", () => {
    const merged = withCaptureKit([
      {
        path: "package.json",
        content: JSON.stringify({ name: "starter", type: "module" }),
      },
    ]);
    const kitPkg = merged.find((f) => f.path === "capture-kit/package.json");
    expect(kitPkg).toBeDefined();
    expect(JSON.parse(kitPkg!.content).type).toBe("commonjs");
    expect(merged.some((f) => f.path === "capture-kit/setup.js")).toBe(true);
    expect(merged.some((f) => f.path === "capture-kit/sessionClosed.js")).toBe(
      true
    );
  });
});
