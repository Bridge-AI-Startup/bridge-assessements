/**
 * The capture lab is one HTML string with one inline script. A single stray
 * quote in that script does not throw a build error anywhere — it renders a
 * blank page with the header intact, which reads as "the server is down"
 * rather than "the page has a typo". That happened; this is the guard.
 */
import { describe, expect, it } from "vitest";
import { renderTesterPage } from "../../src/services/workflowCapture/testerPage.js";

function inlineScript(html: string): string {
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start + "<script>".length, end);
}

describe("capture lab page", () => {
  const html = renderTesterPage();

  it("emits a script that actually parses", () => {
    // new Function compiles without running: a syntax error throws here, an
    // undefined DOM does not.
    expect(() => new Function(inlineScript(html))).not.toThrow();
  });

  it("leaves no unresolved template placeholders", () => {
    // The script is injected into a template literal; a stray ${...} would be
    // interpolated at render time and silently disappear.
    expect(html).not.toContain("${");
  });

  it("mounts every element the script drives", () => {
    const script = inlineScript(html);
    const ids = new Set<string>();
    for (const m of script.matchAll(/\$\("([a-zA-Z][\w-]*)"\)/g)) ids.add(m[1]);
    // Ids the script creates in markup it renders itself.
    const rendered = new Set([
      "cmdText",
      "criteriaBox",
      "saveCriteria",
      "reloadTimeline",
    ]);
    const missing = [...ids].filter(
      (id) => !rendered.has(id) && !html.includes(`id="${id}"`)
    );
    expect(missing).toEqual([]);
  });
});
