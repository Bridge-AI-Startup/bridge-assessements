import { describe, expect, it } from "vitest";

import { ProcessContext, runProcess, withTimeout } from "../../e2e/lib/runner.js";

const meta = {
  id: "PX",
  title: "Test",
  description: "d",
  scriptPath: "x.ts",
};

describe("E2E runner", () => {
  it("withTimeout rejects when the budget is exceeded", async () => {
    await expect(
      withTimeout(new Promise(() => {}), 30, "hung")
    ).rejects.toThrow(/budget/);
  });

  it("records a passing step with evidence", async () => {
    const ctx = new ProcessContext(meta);
    await ctx.step("step1", async (ev) => {
      ev.json("k", "v");
      return 1;
    });
    const result = ctx.finish();
    expect(result.status).toBe("pass");
    expect(result.steps[0].status).toBe("pass");
    expect(result.steps[0].evidence[0]).toMatchObject({ label: "k", value: "v" });
  });

  it("records a failing step and derives fail status", async () => {
    const ctx = new ProcessContext(meta);
    await expect(
      ctx.step("boom", async () => {
        throw new Error("nope");
      })
    ).rejects.toThrow("nope");
    expect(ctx.finish().status).toBe("fail");
  });

  it("derives blocked when only blocked steps exist", () => {
    const ctx = new ProcessContext(meta);
    ctx.blocked("ext", "missing key");
    expect(ctx.finish().status).toBe("blocked");
  });

  it("runProcess captures a thrown body without crashing", async () => {
    const result = await runProcess(meta, async (ctx) => {
      await ctx.step("ok", async () => 1);
      throw new Error("late failure");
    });
    expect(result.steps[0].status).toBe("pass");
    expect(result.summary).toMatch(/Halted early/);
  });
});
