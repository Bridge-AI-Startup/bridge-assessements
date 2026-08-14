import { describe, expect, it } from "vitest";

import {
  checkNeedsHttpProof,
  checkNeedsUiProof,
  checkProofGuards,
  classifyTraceEntry,
  hasAnySuccessfulBrowserObservation,
  hasFailedBrowserInteraction,
  passRestsOnAgentProbe,
  type ProofGuardInput,
  type TraceEntryLike,
} from "../../src/services/behavioralGrading/proofGuards.js";

const entry = (over: Partial<TraceEntryLike> = {}): TraceEntryLike => ({
  tool: "run_command",
  detail: "ls -la",
  outputPreview: "",
  success: true,
  ...over,
});

const guardInput = (over: Partial<ProofGuardInput> = {}): ProofGuardInput => ({
  behavioralCheck: "Someone can add a note.",
  executionProfile: "web_server",
  verdict: "pass",
  citations: [],
  trace: [],
  ...over,
});

describe("classifyTraceEntry", () => {
  it("treats repo reads as repo evidence", () => {
    expect(classifyTraceEntry(entry({ tool: "read_file", detail: "server.js" }))).toBe("repo");
    expect(classifyTraceEntry(entry({ detail: "cat server.js" }))).toBe("repo");
    expect(classifyTraceEntry(entry({ detail: "rg -n 'saveNotes' ." }))).toBe("repo");
  });

  it("treats curl as HTTP evidence", () => {
    expect(classifyTraceEntry(entry({ detail: 'curl -sS -i "http://127.0.0.1:4310/notes"' }))).toBe(
      "http"
    );
  });

  it("treats browser text tools as browser evidence and screenshots as neither", () => {
    expect(classifyTraceEntry(entry({ tool: "browser_expect", detail: "contains: Buy milk" }))).toBe(
      "browser"
    );
    expect(classifyTraceEntry(entry({ tool: "browser_snapshot", detail: "tree" }))).toBe("browser");
    expect(classifyTraceEntry(entry({ tool: "browser_screenshot", detail: "viewport" }))).toBe(
      "none"
    );
  });

  it("treats the agent's own scripts as its own output, even when they curl", () => {
    for (const detail of [
      'python3 -c "print(1)"',
      'node -e "console.log(1)"',
      "bash <<'EOF'\ncurl localhost:4310\nEOF",
      'echo \'{"notes":[]}\'',
    ]) {
      expect(classifyTraceEntry(entry({ detail }))).toBe("agent_probe");
    }
  });

  it("treats an unremarkable command as no evidence either way", () => {
    expect(classifyTraceEntry(entry({ detail: "env" }))).toBe("none");
  });
});

describe("checkNeedsHttpProof / checkNeedsUiProof", () => {
  it("wants HTTP proof for API-shaped checks on a served app", () => {
    expect(checkNeedsHttpProof("POST /notes returns 201.", "web_server")).toBe(true);
    expect(checkNeedsHttpProof("The endpoint rejects a blank title.", "web_server")).toBe(true);
  });

  it("does not want HTTP proof from a command-line program", () => {
    expect(checkNeedsHttpProof("POST /notes returns 201.", "cli_stdout")).toBe(false);
  });

  it("wants UI proof only for checks about what a user sees", () => {
    expect(checkNeedsUiProof("The notes page shows every saved note.")).toBe(true);
    expect(checkNeedsUiProof("Clicking Save adds the note to the list.")).toBe(true);
    expect(checkNeedsUiProof("Notes survive a restart of the process.")).toBe(false);
  });
});

describe("passRestsOnAgentProbe", () => {
  it("is not triggered when no inline script ran", () => {
    expect(
      passRestsOnAgentProbe(["Title is required."], [entry({ tool: "read_file", detail: "s.js" })])
    ).toBe(false);
  });

  it("rejects a pass whose only runtime evidence is the agent's own script", () => {
    expect(
      passRestsOnAgentProbe(
        ["notes list contains Buy milk"],
        [entry({ detail: 'python3 -c "print(\'ok\')"', outputPreview: "ok" })]
      )
    ).toBe(true);
  });

  it("accepts a pass whose citation appears in grounded output", () => {
    const trace = [
      entry({ detail: 'python3 -c "print(1)"', outputPreview: "1" }),
      entry({
        detail: 'curl -sS "http://127.0.0.1:4310/notes"',
        outputPreview: '{"notes":[{"title":"Buy milk"}]}',
      }),
    ];
    expect(passRestsOnAgentProbe(['{"notes":[{"title":"Buy milk"}]}'], trace)).toBe(false);
  });

  it("rejects when the citation is found in probe output and in no grounded output", () => {
    const trace = [
      entry({
        detail: 'python3 -c "print(\'validation rejected blank title\')"',
        outputPreview: "validation rejected blank title",
      }),
      entry({ tool: "read_file", detail: "README.md", outputPreview: "# Notes API" }),
    ];
    expect(passRestsOnAgentProbe(["validation rejected blank title"], trace)).toBe(true);
  });

  it("ignores citations too short to attribute", () => {
    const trace = [
      entry({ detail: 'node -e "console.log(201)"', outputPreview: "201" }),
      entry({ tool: "read_file", detail: "server.js", outputPreview: "const PORT = 4310;" }),
    ];
    expect(passRestsOnAgentProbe(["201"], trace)).toBe(false);
  });
});

describe("hasAnySuccessfulBrowserObservation / hasFailedBrowserInteraction", () => {
  it("counts a step that put the page in front of the agent", () => {
    for (const tool of ["browser_goto", "browser_snapshot", "browser_expect"]) {
      expect(hasAnySuccessfulBrowserObservation([entry({ tool, detail: "/" })])).toBe(true);
    }
  });

  it("does not count an observation step that errored", () => {
    expect(
      hasAnySuccessfulBrowserObservation([
        entry({ tool: "browser_snapshot", detail: "tree", success: false }),
      ])
    ).toBe(false);
  });

  it("counts a screenshot only when it actually stored a PNG", () => {
    expect(
      hasAnySuccessfulBrowserObservation([entry({ tool: "browser_screenshot", detail: "shot" })])
    ).toBe(false);
    expect(
      hasAnySuccessfulBrowserObservation([
        entry({ tool: "browser_screenshot", detail: "shot", artifactKey: "submissions/x/a.png" }),
      ])
    ).toBe(true);
  });

  it("does not treat an action step as an observation", () => {
    expect(
      hasAnySuccessfulBrowserObservation([entry({ tool: "browser_fill", detail: "#title" })])
    ).toBe(false);
  });

  it("spots a browser step that errored, and ignores non-browser failures", () => {
    expect(
      hasFailedBrowserInteraction([entry({ tool: "browser_fill", detail: "textbox", success: false })])
    ).toBe(true);
    expect(hasFailedBrowserInteraction([entry({ detail: "curl -sS /notes", success: false })])).toBe(
      false
    );
  });
});

describe("checkProofGuards", () => {
  it("lets an inconclusive through untouched", () => {
    expect(
      checkProofGuards(
        guardInput({
          verdict: "inconclusive",
          behavioralCheck: "The notes page shows every saved note.",
          browserBaseUrl: "https://sandbox.example/",
          trace: [entry({ tool: "browser_fill", detail: "textbox", success: false })],
        })
      )
    ).toBeNull();
  });

  it("does not apply the pass-side guards to a fail", () => {
    expect(
      checkProofGuards(
        guardInput({
          verdict: "fail",
          behavioralCheck: "GET /notes returns the saved notes.",
          sandboxAppOrigin: "http://127.0.0.1:4310",
          trace: [entry({ tool: "read_file", detail: "server.js" })],
        })
      )
    ).toBeNull();
  });

  it("blocks an HTTP-check pass with no request to the running app", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "GET /notes returns the saved notes.",
        sandboxAppOrigin: "http://127.0.0.1:4310",
        trace: [entry({ tool: "read_file", detail: "server.js" })],
      })
    );
    expect(violation?.code).toBe("no_http_probe");
  });

  it("allows an HTTP-check pass once the app was actually probed", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "GET /notes returns the saved notes.",
        sandboxAppOrigin: "http://127.0.0.1:4310",
        citations: ['{"notes":[]}'],
        trace: [
          entry({
            detail: 'curl -sS -i "http://127.0.0.1:4310/notes"',
            outputPreview: 'HTTP/1.1 200 OK\n{"notes":[]}',
          }),
        ],
      })
    );
    expect(violation).toBeNull();
  });

  it("does not demand HTTP proof when the app never came up", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "GET /notes returns the saved notes.",
        trace: [entry({ tool: "read_file", detail: "server.js" })],
      })
    );
    expect(violation).toBeNull();
  });

  it("blocks a UI-check pass that only read the component source", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "The notes page shows every saved note.",
        browserBaseUrl: "https://sandbox.example/",
        trace: [entry({ tool: "read_file", detail: "src/NotesPage.jsx" })],
      })
    );
    expect(violation?.code).toBe("no_ui_proof");
    expect(violation?.explanation).toContain("never asserted");
  });

  it("accepts a UI-check pass backed by a rendered assertion", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "The notes page shows every saved note.",
        browserBaseUrl: "https://sandbox.example/",
        trace: [
          entry({ tool: "browser_goto", detail: "/" }),
          entry({ tool: "browser_expect", detail: "contains: Buy milk" }),
        ],
      })
    );
    expect(violation).toBeNull();
  });

  it("accepts a UI-check pass backed by a stored screenshot", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "The notes page shows every saved note.",
        browserBaseUrl: "https://sandbox.example/",
        trace: [
          entry({
            tool: "browser_screenshot",
            detail: "notes list",
            artifactKey: "submissions/x/shot.png",
          }),
        ],
      })
    );
    expect(violation).toBeNull();
  });

  it("does not accept a screenshot step that failed to capture anything", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "The notes page shows every saved note.",
        browserBaseUrl: "https://sandbox.example/",
        trace: [entry({ tool: "browser_screenshot", detail: "notes list", success: false })],
      })
    );
    expect(violation?.code).toBe("no_ui_proof");
  });

  it("does not demand UI proof when there is no browser to use", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "The notes page shows every saved note.",
        trace: [entry({ tool: "read_file", detail: "src/NotesPage.jsx" })],
      })
    );
    expect(violation).toBeNull();
  });

  it("blocks a pass built entirely on the agent's own script", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "Notes survive a restart of the process.",
        citations: ["notes still present after restart"],
        trace: [
          entry({
            detail: 'python3 -c "print(\'notes still present after restart\')"',
            outputPreview: "notes still present after restart",
          }),
        ],
      })
    );
    expect(violation?.code).toBe("probe_only_citations");
  });

  it("rejects a UI fail where every browser interaction errored", () => {
    const violation = checkProofGuards(
      guardInput({
        verdict: "fail",
        behavioralCheck: "Clicking Save adds the note to the list on the page.",
        browserBaseUrl: "https://sandbox.example/",
        trace: [
          entry({
            tool: "browser_fill",
            detail: "textbox ← 8 chars",
            outputPreview: "[error] Timeout 20000ms exceeded waiting for locator('textbox')",
            success: false,
          }),
        ],
      })
    );
    expect(violation?.code).toBe("unproven_ui_fail");
    expect(violation?.instruction).toContain("browser_fill_role");
  });

  it("lets a UI fail stand once the agent actually saw the page", () => {
    const violation = checkProofGuards(
      guardInput({
        verdict: "fail",
        behavioralCheck: "Clicking Save adds the note to the list on the page.",
        browserBaseUrl: "https://sandbox.example/",
        trace: [
          entry({ tool: "browser_goto", detail: "/" }),
          entry({ tool: "browser_expect", detail: "contains: Buy milk", success: false }),
          entry({ tool: "browser_fill", detail: "textbox", success: false }),
        ],
      })
    );
    expect(violation).toBeNull();
  });

  it("lets a source- or CLI-evidenced fail stand when the browser was never used", () => {
    const violation = checkProofGuards(
      guardInput({
        verdict: "fail",
        behavioralCheck: "The notes page shows every saved note.",
        browserBaseUrl: "https://sandbox.example/",
        trace: [
          entry({ tool: "read_file", detail: "src/NotesPage.jsx", outputPreview: "export default null;" }),
          entry({ detail: 'curl -sS "http://127.0.0.1:4310/notes"', outputPreview: "404" }),
        ],
      })
    );
    expect(violation).toBeNull();
  });

  it("does not second-guess a non-UI fail whose browser steps happened to error", () => {
    const violation = checkProofGuards(
      guardInput({
        verdict: "fail",
        behavioralCheck: "Notes survive a restart of the process.",
        browserBaseUrl: "https://sandbox.example/",
        trace: [entry({ tool: "browser_fill", detail: "textbox", success: false })],
      })
    );
    expect(violation).toBeNull();
  });

  it("does not second-guess a UI fail on a run with no browser available", () => {
    const violation = checkProofGuards(
      guardInput({
        verdict: "fail",
        behavioralCheck: "The notes page shows every saved note.",
        trace: [entry({ tool: "browser_fill", detail: "textbox", success: false })],
      })
    );
    expect(violation).toBeNull();
  });

  it("reports the HTTP gap first when a check trips more than one guard", () => {
    const violation = checkProofGuards(
      guardInput({
        behavioralCheck: "The notes page shows the response from GET /notes.",
        sandboxAppOrigin: "http://127.0.0.1:4310",
        browserBaseUrl: "https://sandbox.example/",
        citations: ["a citation long enough to attribute"],
        trace: [
          entry({
            detail: 'node -e "console.log(\'a citation long enough to attribute\')"',
            outputPreview: "a citation long enough to attribute",
          }),
        ],
      })
    );
    expect(violation?.code).toBe("no_http_probe");
  });
});
