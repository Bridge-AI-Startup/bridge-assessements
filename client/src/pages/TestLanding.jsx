import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Terminal,
  Search,
  Code2,
  Bug,
  RefreshCw,
  Play,
} from "lucide-react";
import { createPageUrl } from "@/utils";

const timelineMarkers = [
  { label: "Cursor prompt", icon: Terminal, color: "bg-violet-100 text-violet-700 border-violet-200" },
  { label: "Google search", icon: Search, color: "bg-sky-100 text-sky-700 border-sky-200" },
  { label: "Code edit", icon: Code2, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { label: "Debugging", icon: Bug, color: "bg-amber-100 text-amber-700 border-amber-200" },
  { label: "Refactor", icon: RefreshCw, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { label: "Test run", icon: Play, color: "bg-sky-100 text-sky-700 border-sky-200" },
];

const eventChips = [
  { label: "AI Prompt", color: "bg-violet-50 text-violet-600 border border-violet-100" },
  { label: "Research Step", color: "bg-sky-50 text-sky-600 border border-sky-100" },
  { label: "Debug Loop", color: "bg-amber-50 text-amber-600 border border-amber-100" },
  { label: "Refactor", color: "bg-emerald-50 text-emerald-600 border border-emerald-100" },
  { label: "Test Run", color: "bg-sky-50 text-sky-600 border border-sky-100" },
];

const codeLines = [
  { text: "async function fetchUser(id: string) {", type: "keyword" },
  { text: "  const res = await fetch(`/api/users/${id}`);", type: "default" },
  { text: "  if (!res.ok) throw new Error('User not found');", type: "default" },
  { text: "  return res.json();", type: "default" },
  { text: "}", type: "keyword" },
  { text: "", type: "default" },
  { text: "// Added retry logic and error handling", type: "comment" },
];

export default function TestLanding() {
  return (
    <div className="min-h-screen bg-[#fafafa] text-foreground">
      {/* Hero section */}
      <section className="relative overflow-hidden px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 lg:items-center">
            {/* Left column — copy + CTAs */}
            <div className="order-2 lg:order-1">
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl lg:text-[2.75rem] lg:leading-[1.15]">
                See how engineers solve problems. Not just their final code.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-neutral-600 leading-relaxed">
                Bridge creates role-specific engineering projects and analyzes how candidates research, use AI, debug, and write code in their own environment.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  asChild
                  size="lg"
                  className="rounded-lg bg-neutral-900 px-6 text-base font-medium text-white shadow-sm hover:bg-neutral-800 transition-colors"
                >
                  <Link to={createPageUrl("DemoReplay")}>
                    See a candidate workflow
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="rounded-lg border-neutral-300 bg-white px-6 text-base font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  <Link to={createPageUrl("Contact")}>
                    Request demo
                  </Link>
                </Button>
              </div>
            </div>

            {/* Right column — product mockup card */}
            <div className="order-1 lg:order-2 flex justify-center lg:justify-end">
              <CandidateSessionReplayCard />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function CandidateSessionReplayCard() {
  return (
    <div
      className="w-full max-w-[520px] rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
      data-hero-visual
    >
      <div className="flex flex-col gap-4">
        {/* Main content row: session + insights */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
          {/* Candidate Session panel */}
          <div className="min-h-[200px] rounded-xl border border-neutral-100 bg-neutral-50/80 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                Candidate Session
              </span>
            </div>
            <div className="relative rounded-lg border border-neutral-200 bg-white font-mono text-[11px] leading-relaxed overflow-hidden">
              {/* Code editor area */}
              <div className="p-3">
                {codeLines.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.type === "comment"
                        ? "text-neutral-400"
                        : line.type === "keyword"
                        ? "text-violet-600"
                        : "text-neutral-700"
                    }
                  >
                    {line.text || " "}
                  </div>
                ))}
              </div>
              {/* Floating event chips — workflow signals */}
              <div className="absolute inset-0 pointer-events-none flex flex-wrap gap-1.5 p-2 items-start content-start">
                {eventChips.map((chip, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium shadow-sm ${chip.color}`}
                    style={{
                      position: "absolute",
                      left: `${12 + (i % 3) * 28}%`,
                      top: `${18 + Math.floor(i / 3) * 22}%`,
                    }}
                    data-event-chip
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Insights panel */}
          <div
            className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3"
            data-insights-panel
          >
            <div className="text-xs font-medium uppercase tracking-wider text-neutral-500 mb-2.5">
              Candidate Insights
            </div>
            <ul className="space-y-1.5 text-[11px] text-neutral-600">
              <li className="flex justify-between gap-2">
                <span>AI prompts</span>
                <span className="font-medium tabular-nums text-neutral-900" data-metric>4</span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Research steps</span>
                <span className="font-medium tabular-nums text-neutral-900" data-metric>3</span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Debug loops</span>
                <span className="font-medium tabular-nums text-neutral-900" data-metric>2</span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Test runs</span>
                <span className="font-medium tabular-nums text-neutral-900" data-metric>5</span>
              </li>
            </ul>
            <div className="mt-3 pt-2.5 border-t border-neutral-200">
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500 mb-1.5">
                Strengths
              </div>
              <ul className="space-y-1 text-[11px] text-neutral-700">
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-500">✓</span>
                  Structured problem solving
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-500">✓</span>
                  Efficient debugging
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-500">✓</span>
                  Good use of AI
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Workflow timeline */}
        <div
          className="rounded-xl border border-neutral-100 bg-neutral-50/60 px-3 py-2.5"
          data-workflow-timeline
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500 mb-2">
            Session timeline
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {timelineMarkers.map(({ label, icon: Icon, color }, i) => (
              <div
                key={i}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium ${color}`}
                data-timeline-marker
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
