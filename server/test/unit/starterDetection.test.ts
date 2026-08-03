import { describe, expect, it } from "vitest";

import {
  STARTER_FILES,
  isIndexHtmlStarterLike,
  isStarterOnlySubmission,
} from "../../src/services/shorts/starterDetection.js";

/**
 * Retired starter copy. Live sessions created under an older version still hold
 * it in `workspaceSnapshot`, so the gate has to keep recognising every one —
 * otherwise an untouched build sails past submit.
 */
const BARE_STARTER_INDEX = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bridge Shorts</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <p>Nothing here yet.</p>
    </main>
    <script src="main.js"></script>
  </body>
</html>
`;

const ONBOARDING_STARTER_INDEX = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bridge Shorts</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <p class="eyebrow">Preview</p>
      <h1>Nothing here yet — and that's normal.</h1>
      <p class="lede">
        Whatever you build will show up right here. It's blank because you
        haven't asked for anything yet.
      </p>
      <ol>
        <li>
          <strong>Read the challenge.</strong>
          It's at the top of the chat — that's what you're making today.
        </li>
        <li>
          <strong>Describe what you want in the chat, in plain English.</strong>
          Something like "a dice roller with one big red button" is enough to
          start.
        </li>
        <li>
          <strong>Watch this panel.</strong>
          It refreshes every time your build changes. Don't like it? Say what to
          change and ask again — as many times as you want.
        </li>
        <li>
          <strong>Press Submit when you're happy with it.</strong>
          Then go vote on what everyone else made.
        </li>
      </ol>
      <p class="hint">
        No coding needed. Keep an eye on <strong>Time left</strong> at the top —
        when it runs out, so does the round.
      </p>
    </main>
    <script src="main.js"></script>
  </body>
</html>
`;

const REAL_BUILD = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bridge Shorts</title>
    <style>
      body { margin: 0; display: grid; place-items: center; height: 100vh;
             background: #05060a; color: #f5f5f0; font: 600 12vw/1 system-ui; }
      #now { letter-spacing: -0.04em; }
    </style>
  </head>
  <body>
    <div id="now">--:--</div>
    <script>
      function tick() {
        const d = new Date();
        document.getElementById("now").textContent =
          String(d.getHours()).padStart(2, "0") + ":" +
          String(d.getMinutes()).padStart(2, "0");
      }
      tick();
      setInterval(tick, 1000);
    </script>
  </body>
</html>
`;

describe("starter detection", () => {
  it("catches the current starter", () => {
    expect(isIndexHtmlStarterLike(STARTER_FILES["index.html"])).toBe(true);
  });

  it("still catches every retired starter (live snapshots hold them)", () => {
    expect(isIndexHtmlStarterLike(BARE_STARTER_INDEX)).toBe(true);
    expect(isIndexHtmlStarterLike(ONBOARDING_STARTER_INDEX)).toBe(true);
  });

  it("rejects a submit whose whole workspace is the current starter", () => {
    const files = Object.entries(STARTER_FILES).map(([path, content]) => ({
      path,
      content,
    }));
    expect(isStarterOnlySubmission(files)).toBe(true);
  });

  it("lets a real build through", () => {
    expect(isIndexHtmlStarterLike(REAL_BUILD)).toBe(false);
    expect(
      isStarterOnlySubmission([{ path: "index.html", content: REAL_BUILD }]),
    ).toBe(false);
  });

  it("does not let a build through just because it kept the starter title", () => {
    // The serverless model often keeps <title>Bridge Shorts</title>; that alone
    // must not read as "unchanged starter".
    expect(REAL_BUILD).toContain("<title>Bridge Shorts</title>");
    expect(isIndexHtmlStarterLike(REAL_BUILD)).toBe(false);
  });
});
