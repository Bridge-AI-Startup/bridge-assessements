/**
 * Collect grading storage keys referenced by a persisted behavioral grading report.
 * Only keys under `submissions/<submissionId>/` are returned.
 */
export function collectBehavioralArtifactKeys(
  report: unknown,
  submissionId: string
): string[] {
  const keys = new Set<string>();
  if (!report || typeof report !== "object") {
    return [];
  }
  const r = report as Record<string, unknown>;
  if (typeof r.reportArtifactKey === "string") {
    keys.add(r.reportArtifactKey);
  }
  const runbook = r.runbook as Record<string, unknown> | undefined;
  if (runbook?.evidence && Array.isArray(runbook.evidence)) {
    for (const ev of runbook.evidence) {
      addKeysFromStepEvidence(ev, keys);
    }
  }
  if (Array.isArray(r.cases)) {
    for (const c of r.cases) {
      if (!c || typeof c !== "object") continue;
      const ca = c as Record<string, unknown>;
      if (Array.isArray(ca.artifacts)) {
        for (const a of ca.artifacts) {
          if (typeof a === "string") keys.add(a);
        }
      }
      if (Array.isArray(ca.evidence)) {
        for (const ev of ca.evidence) {
          addKeysFromStepEvidence(ev, keys);
        }
      }
    }
  }
  const prefix = `submissions/${submissionId}/`;
  return [...keys].filter((k) => k.startsWith(prefix));
}

function addKeysFromStepEvidence(ev: unknown, keys: Set<string>): void {
  if (!ev || typeof ev !== "object") return;
  const e = ev as Record<string, unknown>;
  if (Array.isArray(e.artifactKeys)) {
    for (const k of e.artifactKeys) {
      if (typeof k === "string") keys.add(k);
    }
  }
  if (Array.isArray(e.agentTrace)) {
    for (const t of e.agentTrace) {
      if (
        t &&
        typeof t === "object" &&
        typeof (t as Record<string, unknown>).artifactKey === "string"
      ) {
        keys.add((t as Record<string, string>).artifactKey);
      }
    }
  }
}
