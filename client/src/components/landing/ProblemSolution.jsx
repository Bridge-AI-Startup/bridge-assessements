// Ported from the Framer code component "BridgeProblemSolution" — the
// Legacy-vs-Bridge comparison panel under the "Coding tests weren't built for
// the AI era" statement. Logic/styles verbatim; the global CSS reset from the
// Framer copy is scoped to .bps-root so it can't leak into the page.
import { useState, useEffect, useRef } from "react"

const CANDIDATES = [
    {
        id: "Sarah Chen",
        time: "38:12",
        score: "4/4",
        submitted: 38,
        workflow: 92,
        insights: [
            { label: "Explained tradeoffs clearly", tone: "green" },
            { label: "Wrote custom tests", tone: "green" },
            { label: "Methodical approach", tone: "green" },
        ],
        events: [
            {
                pos: 2,
                icon: "📄",
                label: "Read problem carefully",
                color: "#6366f1",
            },
            {
                pos: 5,
                icon: "💬",
                label: "Explained brute force vs optimal to agent",
                color: "#0ea5e9",
            },
            {
                pos: 8,
                icon: "✏️",
                label: "Wrote pseudocode outline",
                color: "#3b82f6",
            },
            {
                pos: 13,
                icon: "✏️",
                label: "Built solution incrementally",
                color: "#3b82f6",
            },
            {
                pos: 17,
                icon: "🐞",
                label: "Edge case bug — fixed quickly",
                color: "#ef4444",
            },
            {
                pos: 20,
                icon: "💬",
                label: "Walked agent through debugging logic",
                color: "#0ea5e9",
            },
            {
                pos: 24,
                icon: "🧪",
                label: "Wrote custom test cases",
                color: "#10b981",
            },
            {
                pos: 28,
                icon: "✏️",
                label: "Optimized time complexity",
                color: "#3b82f6",
            },
            {
                pos: 32,
                icon: "💬",
                label: "Explained time/space complexity tradeoff",
                color: "#0ea5e9",
            },
            {
                pos: 36,
                icon: "✏️",
                label: "Cleaned up and submitted",
                color: "#3b82f6",
            },
        ],
    },
    {
        id: "Marcus Johnson",
        time: "44:51",
        score: "4/4",
        submitted: 44,
        workflow: 34,
        insights: [
            { label: "Vague AI prompts", tone: "red" },
            { label: "Minimal communication with agent", tone: "red" },
            { label: "Didn't test AI output", tone: "red" },
        ],
        events: [
            {
                pos: 1,
                icon: "🤖",
                label: "Pasted entire problem into ChatGPT",
                color: "#8b5cf6",
            },
            {
                pos: 4,
                icon: "✏️",
                label: "Copied AI output without editing",
                color: "#3b82f6",
            },
            {
                pos: 6,
                icon: "🐞",
                label: "Solution failed — didn't investigate",
                color: "#ef4444",
            },
            {
                pos: 9,
                icon: "💬",
                label: "Told agent 'still working on it'",
                color: "#0ea5e9",
            },
            {
                pos: 12,
                icon: "🤖",
                label: "Told AI 'fix this' with no context",
                color: "#8b5cf6",
            },
            {
                pos: 18,
                icon: "🐞",
                label: "Still failing — pasted error back to AI",
                color: "#ef4444",
            },
            {
                pos: 24,
                icon: "🤖",
                label: "Asked AI to rewrite everything",
                color: "#8b5cf6",
            },
            {
                pos: 30,
                icon: "✏️",
                label: "Pasted new AI output verbatim",
                color: "#3b82f6",
            },
            {
                pos: 36,
                icon: "🤖",
                label: "Asked AI to 'make it pass'",
                color: "#8b5cf6",
            },
            {
                pos: 40,
                icon: "💬",
                label: "Told agent 'it works now' — no explanation",
                color: "#0ea5e9",
            },
            {
                pos: 43,
                icon: "🧪",
                label: "Passed — submitted immediately",
                color: "#10b981",
            },
        ],
    },
    {
        id: "Priya Patel",
        time: "31:07",
        score: "2/4",
        submitted: 31,
        workflow: 78,
        insights: [
            { label: "Articulated approach clearly", tone: "green" },
            { label: "Tested early and often", tone: "green" },
            { label: "Ran out of time optimizing", tone: "neutral" },
        ],
        events: [
            {
                pos: 2,
                icon: "📄",
                label: "Identified pattern quickly",
                color: "#6366f1",
            },
            {
                pos: 4,
                icon: "💬",
                label: "Explained two possible approaches to agent",
                color: "#0ea5e9",
            },
            {
                pos: 7,
                icon: "✏️",
                label: "Wrote clean brute force",
                color: "#3b82f6",
            },
            {
                pos: 11,
                icon: "🧪",
                label: "Tested — 2/4 passed",
                color: "#10b981",
            },
            {
                pos: 14,
                icon: "💬",
                label: "Told agent why brute force fails on large input",
                color: "#0ea5e9",
            },
            {
                pos: 17,
                icon: "✏️",
                label: "Attempted optimization",
                color: "#3b82f6",
            },
            {
                pos: 22,
                icon: "🐞",
                label: "Logic error in new approach",
                color: "#ef4444",
            },
            {
                pos: 26,
                icon: "💬",
                label: "Explained what went wrong and next steps",
                color: "#0ea5e9",
            },
            {
                pos: 29,
                icon: "✏️",
                label: "Debugging when time ran out",
                color: "#3b82f6",
            },
        ],
    },
    {
        id: "James Wright",
        time: "42:33",
        score: "4/4",
        submitted: 42,
        workflow: 56,
        insights: [
            { label: "Heavy research, light building", tone: "yellow" },
            { label: "Responded to agent but surface-level", tone: "yellow" },
            { label: "Persistent debugger", tone: "neutral" },
        ],
        events: [
            {
                pos: 3,
                icon: "🔍",
                label: "Searched 'two sum optimal'",
                color: "#6366f1",
            },
            {
                pos: 7,
                icon: "📄",
                label: "Read Stack Overflow answer",
                color: "#6366f1",
            },
            {
                pos: 10,
                icon: "💬",
                label: "Told agent he's using a hashmap approach",
                color: "#0ea5e9",
            },
            {
                pos: 14,
                icon: "✏️",
                label: "Adapted approach from SO",
                color: "#3b82f6",
            },
            {
                pos: 20,
                icon: "🐞",
                label: "TypeError — wrong variable",
                color: "#ef4444",
            },
            {
                pos: 24,
                icon: "🤖",
                label: "Used Copilot to autocomplete",
                color: "#8b5cf6",
            },
            {
                pos: 30,
                icon: "🐞",
                label: "Off-by-one in loop",
                color: "#ef4444",
            },
            {
                pos: 35,
                icon: "🔍",
                label: "Googled JS loop error",
                color: "#6366f1",
            },
            {
                pos: 40,
                icon: "✏️",
                label: "Fixed and submitted",
                color: "#3b82f6",
            },
        ],
    },
    {
        id: "Emily Nakamura",
        time: "34:18",
        score: "4/4",
        submitted: 34,
        workflow: 95,
        insights: [
            { label: "Specific, targeted AI prompts", tone: "green" },
            { label: "Tested after every AI suggestion", tone: "green" },
            { label: "Explained reasoning at each step", tone: "green" },
        ],
        events: [
            {
                pos: 2,
                icon: "✏️",
                label: "Outlined approach in comments",
                color: "#3b82f6",
            },
            {
                pos: 5,
                icon: "💬",
                label: "Explained plan and edge cases to agent",
                color: "#0ea5e9",
            },
            {
                pos: 8,
                icon: "✏️",
                label: "Built core logic manually",
                color: "#3b82f6",
            },
            {
                pos: 12,
                icon: "🤖",
                label: "Asked AI to optimize inner loop",
                color: "#8b5cf6",
            },
            {
                pos: 15,
                icon: "🧪",
                label: "Tested AI suggestion — found flaw",
                color: "#10b981",
            },
            {
                pos: 18,
                icon: "💬",
                label: "Told agent why AI output was wrong",
                color: "#0ea5e9",
            },
            {
                pos: 21,
                icon: "✏️",
                label: "Rewrote AI output with fix",
                color: "#3b82f6",
            },
            {
                pos: 24,
                icon: "🤖",
                label: "Asked AI for edge case ideas",
                color: "#8b5cf6",
            },
            {
                pos: 27,
                icon: "🧪",
                label: "Wrote tests for each edge case",
                color: "#10b981",
            },
            {
                pos: 30,
                icon: "💬",
                label: "Walked agent through final solution",
                color: "#0ea5e9",
            },
            {
                pos: 33,
                icon: "🧪",
                label: "Final test pass — submitted",
                color: "#10b981",
            },
        ],
    },
]

const DURATION = 45

function workflowColor(score) {
    if (score >= 80)
        return { bg: "#f0fdf4", border: "#86efac", text: "#15803d" }
    if (score >= 60)
        return { bg: "#fffbeb", border: "#fcd34d", text: "#b45309" }
    return { bg: "#fef2f2", border: "#fca5a5", text: "#dc2626" }
}

export default function ProblemSolution() {
    const [activeIdx, setActiveIdx] = useState(null)
    const [hasAnimated, setHasAnimated] = useState(false)
    const rootRef = useRef(null)

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !hasAnimated) {
                    setHasAnimated(true)
                    setActiveIdx(0)
                }
            },
            { threshold: 0.3 }
        )
        if (rootRef.current) observer.observe(rootRef.current)
        return () => observer.disconnect()
    }, [hasAnimated])

    return (
        <>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap');
        .bps-root, .bps-root * { box-sizing: border-box; margin: 0; }

        .bps-root {
          width: 100%;
          font-family: 'DM Sans', sans-serif;
          background: transparent;
        }

        .bps-root .glass {
          width: 100%;
          background: rgba(255,255,255,0.55);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.6);
          border-radius: 24px;
          padding: 20px;
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.15) inset,
            0 8px 40px rgba(0,0,0,0.06),
            0 2px 12px rgba(0,0,0,0.04);
          overflow: hidden;
        }

        .bps-root .split {
          display: flex;
          gap: 14px;
          width: 100%;
        }

        .bps-root .panel {
          width: calc(50% - 7px);
          flex: 0 0 calc(50% - 7px);
          max-width: calc(50% - 7px);
          border-radius: 14px;
          overflow: hidden;
        }

        /* ══ LEFT — dead ══ */
        .bps-root .pl {
          background: rgba(240,240,243,0.92);
          border: 1px solid rgba(200,200,208,0.7);
          box-shadow: 0 1px 3px rgba(0,0,0,0.03);
          filter: saturate(0.25);
        }
        .bps-root .pl .p-hdr {
          height: 48px;
          background: rgba(232,232,236,0.95);
          border-bottom: 1px solid rgba(200,200,208,0.8);
          padding: 0 16px;
          display: flex; align-items: center; justify-content: space-between;
        }
        .bps-root .pl .p-brand {
          font-size: 16px; font-weight: 700; color: #6a6a72;
          letter-spacing: -0.3px;
        }
        .bps-root .pl .p-tag {
          font-size: 9px; font-weight: 600;
          letter-spacing: 1.2px; text-transform: uppercase;
          color: #8a8a92;
        }

        .bps-root .pl .col-hdr {
          height: 28px;
          display: grid;
          grid-template-columns: 1fr 48px 36px;
          gap: 4px; padding: 0 16px;
          align-items: center;
          border-bottom: 1px solid rgba(200,200,208,0.6);
          font-size: 9px; font-weight: 600;
          letter-spacing: 1px; text-transform: uppercase;
          color: #9a9aa2;
        }
        .bps-root .pl .row {
          height: 38px;
          border-bottom: 1px solid rgba(210,210,218,0.5);
          cursor: default;
          transition: background .12s ease, border-left .12s ease;
          padding: 0 16px;
          display: grid;
          grid-template-columns: 1fr 48px 36px;
          gap: 4px; align-items: center;
          border-left: 3px solid transparent;
        }
        .bps-root .pl .row:last-child { border-bottom: none; }
        .bps-root .pl .row:hover {
          background: rgba(220,220,225,0.5);
          border-left-color: #b0b0b8;
        }
        .bps-root .pl .row.act {
          background: rgba(215,215,220,0.6);
          border-left-color: #8a8a92;
        }

        .bps-root .pl .r-name {
          font-size: 12.5px; font-weight: 500; color: #4a4a52;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .bps-root .pl .r-meta {
          font-size: 10.5px; color: #7a7a82;
          font-family: 'JetBrains Mono', monospace;
        }

        .bps-root .pl .detail {
          border-top: 1px solid rgba(200,200,208,0.6);
          padding: 14px 16px;
          height: 105px;
          min-height: 105px;
          max-height: 105px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          overflow: hidden;
        }

        .bps-root .empty-tl { position: relative; height: 24px; margin-bottom: 4px; }
        .bps-root .empty-bar {
          position: absolute; top: 10px; left: 0; right: 0;
          height: 3px; background: #c0c0c8; border-radius: 2px;
        }
        .bps-root .s-dot-w {
          position: absolute; top: 2px;
          display: flex; flex-direction: column; align-items: center;
        }
        .bps-root .s-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #a0a0a8;
          border: 2px solid rgba(240,240,243,0.9);
          box-shadow: 0 0 0 1px rgba(0,0,0,0.06);
        }
        .bps-root .s-dot-label {
          font-size: 8px; color: #8a8a92;
          font-family: 'JetBrains Mono', monospace;
          margin-top: 3px;
        }
        .bps-root .e-times {
          display: flex; justify-content: space-between;
          font-size: 8px; color: #a0a0a8;
          font-family: 'JetBrains Mono', monospace;
        }
        .bps-root .no-data {
          display: flex; align-items: center; gap: 5px;
          margin-top: 6px;
        }
        .bps-root .nd-dash {
          width: 12px; height: 12px; border-radius: 50%;
          border: 1.5px solid #a0a0a8;
          display: flex; align-items: center; justify-content: center;
          font-size: 8px; color: #a0a0a8; font-weight: 700;
        }
        .bps-root .nd-txt { font-size: 11px; color: #7a7a82; }


        /* ══ RIGHT — alive ══ */
        .bps-root .pr {
          background: rgba(255,255,255,0.92);
          border: 1px solid rgba(200,215,255,0.7);
          box-shadow: 0 1px 3px rgba(99,102,241,0.04), 0 4px 16px rgba(99,102,241,0.08);
        }
        .bps-root .pr .p-hdr {
          height: 48px;
          background: rgba(246,247,255,0.95);
          border-bottom: 1px solid rgba(220,228,255,0.8);
          padding: 0 16px;
          display: flex; align-items: center; justify-content: space-between;
        }
        .bps-root .pr .p-title-w { display: flex; align-items: center; gap: 7px; }
        .bps-root .pr .p-dot {
          width: 7px; height: 7px; border-radius: 50%; background: #6366f1;
        }
        .bps-root .pr .p-brand {
          font-size: 16px; font-weight: 700; color: #4f46e5;
          letter-spacing: -0.3px;
        }
        .bps-root .pr .p-tag {
          font-size: 9px; font-weight: 600;
          letter-spacing: 1.2px; text-transform: uppercase;
          color: #818cf8;
        }
        .bps-root .pr .col-hdr {
          height: 28px;
          display: grid;
          grid-template-columns: 1fr 48px 36px 58px;
          gap: 4px; padding: 0 16px;
          align-items: center;
          border-bottom: 1px solid rgba(220,228,255,0.8);
          font-size: 9px; font-weight: 600;
          letter-spacing: 1px; text-transform: uppercase;
          color: #a5b4fc;
        }
        .bps-root .pr .row {
          height: 38px;
          border-bottom: 1px solid rgba(230,235,255,0.6);
          cursor: default;
          transition: background .12s ease, border-left .12s ease;
          padding: 0 16px;
          display: grid;
          grid-template-columns: 1fr 48px 36px 58px;
          gap: 4px; align-items: center;
          border-left: 3px solid transparent;
        }
        .bps-root .pr .row:last-child { border-bottom: none; }
        .bps-root .pr .row:hover {
          background: rgba(238,242,255,0.6);
          border-left-color: #c7d2fe;
        }
        .bps-root .pr .row.act {
          background: rgba(230,235,255,0.5);
          border-left-color: #6366f1;
        }

        .bps-root .pr .r-name {
          font-size: 12.5px; font-weight: 500; color: #1e293b;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .bps-root .pr .r-meta {
          font-size: 10.5px; color: #64748b;
          font-family: 'JetBrains Mono', monospace;
        }

        .bps-root .wf-score {
          font-size: 13px; font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
          padding: 3px 8px; border-radius: 6px;
          width: fit-content; justify-self: end;
          line-height: 1;
        }

        .bps-root .pr .detail {
          border-top: 1px solid rgba(220,228,255,0.8);
          padding: 14px 16px;
          height: 105px;
          min-height: 105px;
          max-height: 105px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          overflow: hidden;
        }

        .bps-root .insights {
          display: flex; flex-wrap: wrap; gap: 5px;
          margin-bottom: 10px;
        }
        .bps-root .chip {
          font-size: 10.5px; font-weight: 500;
          padding: 3px 9px; border-radius: 5px;
          opacity: 0; transform: translateY(4px);
          transition: opacity .22s ease, transform .22s ease;
        }
        .bps-root .chip.vis { opacity: 1; transform: translateY(0); }
        .bps-root .chip-green { background: #f0fdf4; border: 1px solid #86efac; color: #15803d; }
        .bps-root .chip-yellow { background: #fffbeb; border: 1px solid #fcd34d; color: #b45309; }
        .bps-root .chip-red { background: #fef2f2; border: 1px solid #fca5a5; color: #dc2626; }
        .bps-root .chip-neutral { background: #f3f4f6; border: 1px solid #d1d5db; color: #4b5563; }

        .bps-root .tl-area { position: relative; height: 28px; margin-bottom: 4px; }
        .bps-root .tl-bar {
          position: absolute; top: 10px; left: 0; right: 0;
          height: 3px; background: #e0e7ff; border-radius: 2px;
        }
        .bps-root .tl-fill {
          position: absolute; top: 0; left: 0; bottom: 0;
          border-radius: 2px; width: 0%;
          background: #c7d2fe;
          transition: width .6s cubic-bezier(.22,1,.36,1);
        }
        .bps-root .tl-fill.full { width: 100%; }

        .bps-root .ev {
          position: absolute; top: 3px;
          opacity: 0; transform: translateY(3px) scale(0.4);
          transition: opacity .18s ease, transform .18s cubic-bezier(.22,1,.36,1);
          pointer-events: none; z-index: 2;
        }
        .bps-root .ev.vis { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
        .bps-root .ev-dot {
          width: 8px; height: 8px; border-radius: 50%;
          border: 2px solid #fff;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.08);
        }

        @keyframes bpsDotPop {
          0% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(1.4); }
          100% { transform: translateY(0) scale(1); }
        }
        .bps-root .ev.pop { animation: bpsDotPop .35s ease; }

        .bps-root .ev-tip {
          position: absolute; bottom: 20px; left: 50%;
          transform: translateX(-50%);
          background: #111; color: #fff;
          font-size: 10px; padding: 4px 8px;
          border-radius: 5px; white-space: nowrap;
          opacity: 0; transition: opacity .12s ease;
          pointer-events: none; z-index: 10;
        }
        .bps-root .ev-tip::after {
          content: ''; position: absolute;
          top: 100%; left: 50%; transform: translateX(-50%);
          border: 4px solid transparent; border-top-color: #111;
        }
        .bps-root .ev:hover .ev-tip { opacity: 1; }

        .bps-root .tl-times {
          display: flex; justify-content: space-between;
          font-size: 8px; color: #94a3b8;
          font-family: 'JetBrains Mono', monospace;
        }

        @media (max-width: 760px) {
          .bps-root .split { flex-direction: column; }
          .bps-root .panel { width: 100%; flex: 0 0 100%; max-width: 100%; }
          .bps-root .glass { padding: 14px; border-radius: 18px; }
        }
      `}</style>

            <div className="bps-root" ref={rootRef}>
                <div className="glass">
                    <div className="split">
                        {/* ── LEFT ── */}
                        <div className="panel pl">
                            <div className="p-hdr">
                                <span className="p-brand">Legacy</span>
                                <span className="p-tag">
                                    Your assessment tool
                                </span>
                            </div>
                            <div className="col-hdr">
                                <span>Candidate</span>
                                <span>Time</span>
                                <span>Score</span>
                            </div>
                            {CANDIDATES.map((c, i) => (
                                <div
                                    key={i}
                                    className={`row${activeIdx === i ? " act" : ""}`}
                                    onMouseEnter={() => setActiveIdx(i)}
                                    onMouseLeave={() => setActiveIdx(0)}
                                >
                                    <span className="r-name">{c.id}</span>
                                    <span className="r-meta">{c.time}</span>
                                    <span className="r-meta">{c.score}</span>
                                </div>
                            ))}
                            <div className="detail">
                                {activeIdx !== null && (
                                    <LeftDetail
                                        candidate={CANDIDATES[activeIdx]}
                                    />
                                )}
                            </div>
                        </div>

                        {/* ── RIGHT ── */}
                        <div className="panel pr">
                            <div className="p-hdr">
                                <div className="p-title-w">
                                    <div className="p-dot" />
                                    <span className="p-brand">Bridge</span>
                                </div>
                                <span className="p-tag">Session Recording</span>
                            </div>
                            <div className="col-hdr">
                                <span>Candidate</span>
                                <span>Time</span>
                                <span>Score</span>
                                <span style={{ textAlign: "right" }}>
                                    Workflow
                                </span>
                            </div>
                            {CANDIDATES.map((c, i) => {
                                const wc = workflowColor(c.workflow)
                                return (
                                    <div
                                        key={i}
                                        className={`row${activeIdx === i ? " act" : ""}`}
                                        onMouseEnter={() => setActiveIdx(i)}
                                        onMouseLeave={() => setActiveIdx(0)}
                                    >
                                        <span className="r-name">{c.id}</span>
                                        <span className="r-meta">{c.time}</span>
                                        <span className="r-meta">
                                            {c.score}
                                        </span>
                                        <span
                                            className="wf-score"
                                            style={{
                                                background: wc.bg,
                                                border: `1px solid ${wc.border}`,
                                                color: wc.text,
                                            }}
                                        >
                                            {c.workflow}
                                        </span>
                                    </div>
                                )
                            })}
                            <div className="detail">
                                {activeIdx !== null && (
                                    <RightDetail
                                        key={activeIdx}
                                        candidate={CANDIDATES[activeIdx]}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

function LeftDetail({ candidate }) {
    return (
        <>
            <div className="empty-tl">
                <div className="empty-bar" />
                <div
                    className="s-dot-w"
                    style={{
                        left: `${(candidate.submitted / DURATION) * 94}%`,
                        opacity: 1,
                    }}
                >
                    <div className="s-dot" />
                    <span className="s-dot-label">submitted</span>
                </div>
            </div>
            <div className="e-times">
                <span>0:00</span>
                <span>15:00</span>
                <span>30:00</span>
                <span>45:00</span>
            </div>
            <div className="no-data" style={{ opacity: 1 }}>
                <div className="nd-dash">—</div>
                <span className="nd-txt">No session data available</span>
            </div>
        </>
    )
}

function RightDetail({ candidate }) {
    const [eventCount, setEventCount] = useState(0)
    const [chipCount, setChipCount] = useState(0)
    const [fill, setFill] = useState(false)
    const [doPop, setDoPop] = useState(false)
    const timeouts = useRef([])

    useEffect(() => {
        const clear = () => {
            timeouts.current.forEach(clearTimeout)
            timeouts.current = []
        }
        clear()
        setDoPop(false)
        timeouts.current.push(setTimeout(() => setFill(true), 30))
        candidate.insights.forEach((_, i) => {
            timeouts.current.push(
                setTimeout(() => setChipCount(i + 1), 60 + i * 60)
            )
        })
        candidate.events.forEach((_, i) => {
            timeouts.current.push(
                setTimeout(() => setEventCount(i + 1), 100 + i * 40)
            )
        })
        const totalDotTime = 100 + candidate.events.length * 40 + 100
        timeouts.current.push(setTimeout(() => setDoPop(true), totalDotTime))
        return clear
    }, [candidate])

    const tc = (t) =>
        t === "green"
            ? "chip-green"
            : t === "yellow"
              ? "chip-yellow"
              : t === "red"
                ? "chip-red"
                : "chip-neutral"

    return (
        <>
            <div className="insights">
                {candidate.insights.map((ins, i) => (
                    <span
                        key={i}
                        className={`chip ${tc(ins.tone)}${i < chipCount ? " vis" : ""}`}
                    >
                        {ins.label}
                    </span>
                ))}
            </div>

            <div className="tl-area">
                <div className="tl-bar">
                    <div className={`tl-fill${fill ? " full" : ""}`} />
                </div>
                {candidate.events.map((evt, i) => (
                    <div
                        key={i}
                        className={`ev${i < eventCount ? " vis" : ""}${doPop && i < eventCount ? " pop" : ""}`}
                        style={{
                            left: `${(evt.pos / DURATION) * 94}%`,
                            animationDelay: doPop ? `${i * 40}ms` : undefined,
                        }}
                    >
                        <div className="ev-tip">
                            {evt.icon} {evt.label}
                        </div>
                        <div
                            className="ev-dot"
                            style={{ background: evt.color }}
                        />
                    </div>
                ))}
            </div>

            <div className="tl-times">
                <span>0:00</span>
                <span>15:00</span>
                <span>30:00</span>
                <span>45:00</span>
            </div>
        </>
    )
}
