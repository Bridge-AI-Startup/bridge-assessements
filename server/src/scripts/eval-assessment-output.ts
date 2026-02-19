/**
 * Eval checker: validate a generated assessment against the criteria in
 * docs/ASSESSMENT_PROMPT_CRITERIA.md. Used by run-eval.ts and can be run
 * standalone on a JSON file.
 *
 * Usage (standalone):
 *   npx tsx src/scripts/eval-assessment-output.ts <path-to-output.json>
 *
 * Or import and call checkAssessmentOutput(result) with { title, description, timeLimit }.
 */

import { readFileSync } from "fs";

const SECTION_ALIASES: Record<string, string[]> = {
  "Provided / Assumptions": ["Provided / Assumptions", "Provided", "Assumptions"],
  "Nice-to-haves (optional)": ["Nice-to-haves (optional)", "Nice-to-haves"],
};

const TITLE_WORD_COUNT_MIN = 6;
const TITLE_WORD_COUNT_MAX = 12;
const DESCRIPTION_WORD_COUNT_MIN = 300;
const DESCRIPTION_WORD_COUNT_MAX = 650;
const TIME_LIMIT_MIN = 30;
const TIME_LIMIT_MAX = 480;
const ACCEPTANCE_CHECKLIST_MIN = 10;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractSections(md: string): Array<{ name: string; start: number; end: number }> {
  const sections: Array<{ name: string; start: number; end: number }> = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+)$/);
    if (m) {
      const name = m[1].trim();
      const nextHeader = lines.slice(i + 1).findIndex((l) => /^##\s+/.test(l));
      const end = nextHeader === -1 ? lines.length : i + 1 + nextHeader;
      sections.push({ name, start: i, end });
    }
  }
  return sections;
}

function normalizeSectionName(name: string): string {
  for (const [canonical, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.some((a) => name === a || name.startsWith(a))) return canonical;
  }
  return name;
}

function sectionMatchesRequired(name: string, required: string): boolean {
  const n = normalizeSectionName(name);
  if (n === required) return true;
  const aliases = SECTION_ALIASES[required];
  return aliases ? aliases.includes(name) || aliases.some((a) => name.startsWith(a)) : false;
}

function countChecklistItemsInSection(description: string, sectionName: string): number {
  const sections = extractSections(description);
  const ac = sections.find(
    (s) =>
      s.name === "Acceptance Criteria (definition of done)" ||
      s.name.startsWith("Acceptance Criteria")
  );
  if (!ac) return 0;
  const lines = description.split("\n").slice(ac.start, ac.end);
  const checklistRe = /^[-*]\s*\[\s*\]/;
  return lines.filter((l) => checklistRe.test(l.trim())).length;
}

export interface AssessmentOutput {
  title: string;
  description: string;
  timeLimit: number;
}

export interface CheckResult {
  passed: boolean;
  violations: string[];
}

export function checkAssessmentOutput(output: AssessmentOutput): CheckResult {
  const violations: string[] = [];

  if (typeof output.title !== "string") {
    violations.push("Missing or invalid 'title'");
  } else {
    const tw = wordCount(output.title);
    if (tw < TITLE_WORD_COUNT_MIN) violations.push(`Title word count ${tw} < ${TITLE_WORD_COUNT_MIN}`);
    if (tw > TITLE_WORD_COUNT_MAX) violations.push(`Title word count ${tw} > ${TITLE_WORD_COUNT_MAX}`);
  }

  if (typeof output.description !== "string") {
    violations.push("Missing or invalid 'description'");
  } else {
    const dw = wordCount(output.description);
    if (dw < DESCRIPTION_WORD_COUNT_MIN)
      violations.push(`Description word count ${dw} < ${DESCRIPTION_WORD_COUNT_MIN}`);
    if (dw > DESCRIPTION_WORD_COUNT_MAX)
      violations.push(`Description word count ${dw} > ${DESCRIPTION_WORD_COUNT_MAX}`);

    const sections = extractSections(output.description);
    const expectedOrder = [
      "Scenario",
      "What you will build",
      "Requirements (must-have)",
      "Acceptance Criteria (definition of done)",
      "Constraints",
      "Provided / Assumptions",
      "Deliverables",
      "Nice-to-haves (optional)",
    ];
    let sectionIdx = 0;
    for (const expected of expectedOrder) {
      while (sectionIdx < sections.length && !sectionMatchesRequired(sections[sectionIdx].name, expected)) {
        sectionIdx++;
      }
      if (sectionIdx >= sections.length) {
        violations.push(`Missing required section: ## ${expected}`);
      } else {
        sectionIdx++;
      }
    }

    const checklistCount = countChecklistItemsInSection(output.description, "Acceptance Criteria (definition of done)");
    if (checklistCount < ACCEPTANCE_CHECKLIST_MIN)
      violations.push(
        `Acceptance Criteria checklist items: ${checklistCount} < ${ACCEPTANCE_CHECKLIST_MIN}`
      );
  }

  if (typeof output.timeLimit !== "number" || !Number.isInteger(output.timeLimit)) {
    violations.push("'timeLimit' must be an integer");
  } else {
    if (output.timeLimit < TIME_LIMIT_MIN)
      violations.push(`timeLimit ${output.timeLimit} < ${TIME_LIMIT_MIN}`);
    if (output.timeLimit > TIME_LIMIT_MAX)
      violations.push(`timeLimit ${output.timeLimit} > ${TIME_LIMIT_MAX}`);
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx src/scripts/eval-assessment-output.ts <path-to-output.json>");
    process.exit(1);
  }
  const content = readFileSync(path, "utf-8");
  let data: AssessmentOutput;
  try {
    data = JSON.parse(content) as AssessmentOutput;
  } catch {
    console.error("Invalid JSON");
    process.exit(1);
  }
  const result = checkAssessmentOutput(data);
  if (result.passed) {
    console.log("All checks passed.");
  } else {
    console.log("Violations:");
    result.violations.forEach((v) => console.log(" -", v));
    process.exit(1);
  }
}

// Run main when executed directly (node/tsx this file)
const isMain = process.argv[1]?.includes("eval-assessment-output");
if (isMain) {
  main();
}
