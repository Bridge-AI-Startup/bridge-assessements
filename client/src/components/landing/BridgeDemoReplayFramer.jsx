
/**
 * Self-contained glass box + video/timeline demo for Framer.
 * Copy this file into Framer; no other imports needed (React only).
 * Set placeholderImageUrl to your screenshot or leave null for a placeholder block.
 */

const DURATION_SEC = 8 * 60; // 8 minutes
const FIXED_SEC = 72; // Fixed playhead (inside "Uses AI effectively" 48–120)

const REGIONS = [
  { regionType: "file_tree", x: 0, y: 3, width: 14, height: 93, label: "File Tree", border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.2)" },
  { regionType: "editor", x: 14, y: 3, width: 56, height: 55, label: "Editor", border: "#3b82f6", bg: "rgba(59, 130, 246, 0.2)" },
  { regionType: "terminal", x: 14, y: 58, width: 56, height: 38, label: "Terminal", border: "#10b981", bg: "rgba(16, 185, 129, 0.2)" },
  { regionType: "ai_chat", x: 70, y: 3, width: 30, height: 93, label: "AI Chat", border: "#f59e0b", bg: "rgba(245, 158, 11, 0.2)" },
];

const HIGHLIGHTS = [
  { startSec: 12, endSec: 45, category: "Reads requirements", label: "Read problem and constraints", description: "Candidate scrolled through full spec and noted time limit.", score: 8 },
  { startSec: 48, endSec: 120, category: "Uses AI effectively", label: "Gave a detailed prompt, then refined the output", description: "Wrote a specific prompt with constraints and expected format; reviewed and edited the AI suggestion before using it.", score: 8 },
  { startSec: 125, endSec: 180, category: "Tests and debugs", label: "Wrote test and fixed edge case", description: "Added unit test for empty input; fixed off-by-one.", score: 9 },
  { startSec: 200, endSec: 260, category: "Code structure", label: "Extracted helper and error handling", description: "Pulled validation into a small function; added try/catch.", score: 8 },
  { startSec: 300, endSec: 340, category: "Uses AI effectively", label: "Reviewed AI suggestion before accepting", description: "Changed variable names and added a comment.", score: 8 },
];

const CATEGORY_COLORS = {
  "Uses AI effectively": { bg: "#f59e0b", dot: "#fbbf24" },
  "Reads requirements": { bg: "#3b82f6", dot: "#60a5fa" },
  "Tests and debugs": { bg: "#10b981", dot: "#34d399" },
  "Code structure": { bg: "#8b5cf6", dot: "#a78bfa" },
  default: { bg: "#6b7280", dot: "#9ca3af" },
};

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getActiveHighlightIndex(highlights, currentSec) {
  const inRange = highlights.findIndex(
    (h) => currentSec >= h.startSec && currentSec <= (h.endSec ?? h.startSec)
  );
  if (inRange >= 0) return inRange;
  let lastPassed = -1;
  for (let i = 0; i < highlights.length; i++) {
    if (highlights[i].startSec <= currentSec) lastPassed = i;
  }
  return lastPassed >= 0 ? lastPassed : 0;
}

export default function BridgeDemoReplayGlass({ placeholderImageUrl = null, layout = "vertical" }) {
  const isHorizontal = layout === "horizontal";
  const activeIndex = HIGHLIGHTS.length > 0 ? getActiveHighlightIndex(HIGHLIGHTS, FIXED_SEC) : 0;
  const active = HIGHLIGHTS[activeIndex];
  const playheadPct = (FIXED_SEC / DURATION_SEC) * 100;

  const categories = [...new Set(HIGHLIGHTS.map((h) => h.category).filter(Boolean))];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; }

        .bdrg-root {
          width: 100%;
          font-family: 'DM Sans', sans-serif;
          background: transparent;
        }

        .bdrg-glass {
          width: 100%;
          background: rgba(255,255,255,0.25);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          backdrop-filter: blur(24px) saturate(180%);
          border: 1px solid rgba(0,0,0,0.06);
          border-radius: 24px;
          overflow: hidden;
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.5) inset,
            0 1px 0 0 rgba(0,0,0,0.04),
            0 8px 40px rgba(0,0,0,0.08),
            0 2px 12px rgba(0,0,0,0.04),
            0 12px 24px -8px rgba(0,0,0,0.1);
        }
        @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
          .bdrg-glass { background: rgba(255,255,255,0.2); }
        }

        .bdrg-video-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 16/10;
          background: #0a0a0a;
          border-radius: 24px 24px 0 0;
          overflow: hidden;
        }
        .bdrg-video-wrap img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }
        .bdrg-placeholder {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #6b7280;
          font-size: 14px;
        }
        .bdrg-placeholder-inner {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: 2px dashed #4b5563;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 12px;
        }
        .bdrg-placeholder-inner::after {
          content: '';
          width: 0; height: 0;
          border: 8px solid transparent;
          border-left-color: #6b7280;
          margin-left: 4px;
        }

        .bdrg-region {
          position: absolute;
          border-radius: 4px;
          pointer-events: none;
          overflow: visible;
        }
        .bdrg-region-edge {
          position: absolute;
          background: currentColor;
          border-radius: 1px;
          opacity: 0;
          animation-fill-mode: both;
        }
        .bdrg-region-t {
          top: 0; left: 0;
          width: 100%; height: 2px;
          transform-origin: left center;
          animation: bdrg-draw-x 0.75s cubic-bezier(0.22,1,0.36,1) both;
        }
        .bdrg-region-r {
          top: 0; right: 0;
          width: 2px; height: 100%;
          transform-origin: center top;
          animation: bdrg-draw-y 0.75s 0.28s cubic-bezier(0.22,1,0.36,1) both;
        }
        .bdrg-region-b {
          bottom: 0; right: 0;
          width: 100%; height: 2px;
          transform-origin: right center;
          animation: bdrg-draw-x 0.75s 0.56s cubic-bezier(0.22,1,0.36,1) both;
        }
        .bdrg-region-l {
          bottom: 0; left: 0;
          width: 2px; height: 100%;
          transform-origin: center bottom;
          animation: bdrg-draw-y 0.75s 0.84s cubic-bezier(0.22,1,0.36,1) both;
        }
        @keyframes bdrg-draw-x {
          from { opacity: 0; transform: scaleX(0); }
          to { opacity: 1; transform: scaleX(1); }
        }
        @keyframes bdrg-draw-y {
          from { opacity: 0; transform: scaleY(0); }
          to { opacity: 1; transform: scaleY(1); }
        }
        .bdrg-region-fill {
          position: absolute;
          inset: 0;
          border-radius: 4px;
          opacity: 0;
          animation: bdrg-fill-in 0.5s 1.15s cubic-bezier(0.22,1,0.36,1) both;
        }
        @keyframes bdrg-fill-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .bdrg-region-glow {
          position: absolute;
          inset: -2px;
          border-radius: 6px;
          opacity: 0;
          animation: bdrg-glow-then-fade 3.2s ease-out both;
          pointer-events: none;
        }
        @keyframes bdrg-glow-then-fade {
          0% { opacity: 0; box-shadow: 0 0 0 0 currentColor; }
          18% { opacity: 0.85; box-shadow: 0 0 20px 1px currentColor, inset 0 0 20px 0 currentColor; }
          50% { opacity: 0.85; box-shadow: 0 0 20px 1px currentColor, inset 0 0 20px 0 currentColor; }
          100% { opacity: 0; box-shadow: 0 0 0 0 currentColor; }
        }
        .bdrg-region-label {
          position: absolute;
          top: 0; left: 0;
          font-size: 9px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 0 0 4px 0;
          color: #fff;
          opacity: 0;
          transform: translateY(-4px);
          animation: bdrg-label-in 0.35s 1.35s cubic-bezier(0.22,1,0.36,1) both;
        }
        @keyframes bdrg-label-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .bdrg-controls {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(248,250,252,0.9);
          -webkit-backdrop-filter: blur(12px);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(0,0,0,0.06);
        }
        .bdrg-play-icon {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(17,24,39,0.9);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .bdrg-play-icon::after {
          content: '';
          width: 0; height: 0;
          border: 6px solid transparent;
          border-left-color: currentColor;
          margin-left: 3px;
        }
        .bdrg-time {
          font-size: 14px;
          font-weight: 500;
          color: #4b5563;
          font-family: 'JetBrains Mono', monospace;
        }
        .bdrg-time span { color: #9ca3af; font-weight: 400; margin: 0 4px; }

        .bdrg-timeline-wrap {
          padding: 12px 16px;
          background: rgba(248,250,252,0.85);
          -webkit-backdrop-filter: blur(12px);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(0,0,0,0.05);
        }
        .bdrg-timeline-title {
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .bdrg-timeline {
          position: relative;
          height: 36px;
          border-radius: 10px;
          background: #f3f4f6;
          overflow: hidden;
          cursor: default;
        }
        .bdrg-tl-inner {
          position: absolute;
          inset: 4px;
          border-radius: 6px;
          background: rgba(229,231,235,0.6);
        }
        .bdrg-tl-seg {
          position: absolute;
          top: 6px;
          bottom: 6px;
          border-radius: 5px;
          overflow: hidden;
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        .bdrg-tl-seg-inner {
          width: 100%;
          height: 100%;
          border-radius: 6px;
        }
        .bdrg-tl-playhead {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          border-radius: 1px;
          background: #fff;
          box-shadow: 0 0 8px rgba(0,0,0,0.3);
          pointer-events: none;
          z-index: 20;
        }

        .bdrg-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }
        .bdrg-legend-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 500;
          color: #4b5563;
          background: #f9fafb;
          border: 1px solid rgba(229,231,235,0.8);
        }
        .bdrg-legend-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .bdrg-detail {
          margin: 0 16px 16px;
          padding: 16px;
          border-radius: 12px;
          background: rgba(255,255,255,0.7);
          -webkit-backdrop-filter: blur(12px);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(0,0,0,0.06);
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
          transition: opacity 0.2s ease;
        }
        .bdrg-detail-bar {
          width: 4px;
          height: 32px;
          border-radius: 2px;
          flex-shrink: 0;
        }
        .bdrg-detail-cat {
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .bdrg-detail-score {
          font-size: 11px;
          color: #6b7280;
          margin-left: auto;
        }
        .bdrg-detail-score strong { color: #374151; }
        .bdrg-detail-label {
          font-size: 14px;
          font-weight: 600;
          color: #111;
          line-height: 1.35;
          margin-top: 4px;
        }
        .bdrg-detail-desc {
          font-size: 12px;
          color: #4b5563;
          line-height: 1.4;
          margin-top: 6px;
        }
        .bdrg-detail-time {
          font-size: 11px;
          color: #9ca3af;
          font-family: 'JetBrains Mono', monospace;
          margin-top: 8px;
        }

        .bdrg-glass-horizontal {
          display: flex;
          flex-direction: row;
          min-height: 320px;
        }
        .bdrg-glass-horizontal .bdrg-video-wrap {
          flex: 0 0 52%;
          width: 52%;
          aspect-ratio: auto;
          min-height: 320px;
          border-radius: 24px 0 0 24px;
        }
        .bdrg-glass-horizontal .bdrg-right {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .bdrg-glass-horizontal .bdrg-controls {
          border-bottom: 1px solid rgba(0,0,0,0.06);
        }
        .bdrg-glass-horizontal .bdrg-timeline-wrap {
          flex: 1;
          min-height: 0;
        }
        .bdrg-glass-horizontal .bdrg-detail {
          margin: 0 16px 16px;
        }
        @media (max-width: 720px) {
          .bdrg-glass-horizontal { flex-direction: column; }
          .bdrg-glass-horizontal .bdrg-video-wrap {
            width: 100%;
            flex: none;
            aspect-ratio: 16/10;
            min-height: 0;
            border-radius: 24px 24px 0 0;
          }
        }
      `}</style>

      <div className="bdrg-root">
        <div className={`bdrg-glass${isHorizontal ? " bdrg-glass-horizontal" : ""}`}>
          {/* Video / placeholder */}
          <div className="bdrg-video-wrap">
            {placeholderImageUrl ? (
              <img src={placeholderImageUrl} alt="Screen recording" />
            ) : (
              <div className="bdrg-placeholder">
                <div className="bdrg-placeholder-inner" />
                <span>Screen recording</span>
              </div>
            )}
            {REGIONS.map((r, i) => {
              const delay = i * 0.5;
              return (
                <div
                  key={i}
                  className="bdrg-region"
                  style={{
                    left: `${r.x}%`,
                    top: `${r.y}%`,
                    width: `${r.width}%`,
                    height: `${r.height}%`,
                    color: r.border,
                  }}
                >
                  <div className="bdrg-region-edge bdrg-region-t" style={{ animationDelay: `${delay}s` }} />
                  <div className="bdrg-region-edge bdrg-region-r" style={{ animationDelay: `${delay + 0.28}s` }} />
                  <div className="bdrg-region-edge bdrg-region-b" style={{ animationDelay: `${delay + 0.56}s` }} />
                  <div className="bdrg-region-edge bdrg-region-l" style={{ animationDelay: `${delay + 0.84}s` }} />
                  <div
                    className="bdrg-region-fill"
                    style={{ backgroundColor: r.bg, animationDelay: `${delay + 1.15}s` }}
                  />
                  <div
                    className="bdrg-region-glow"
                    style={{ color: r.border, animationDelay: `${delay + 1.2}s` }}
                  />
                  <span className="bdrg-region-label" style={{ backgroundColor: r.border, animationDelay: `${delay + 1.35}s` }}>
                    {r.label}
                  </span>
                </div>
              );
            })}
          </div>

          {isHorizontal ? (
            <div className="bdrg-right">
              <div className="bdrg-controls">
                <div className="bdrg-play-icon" />
                <span className="bdrg-time">
                  {formatTime(FIXED_SEC)}
                  <span>/</span>
                  {formatTime(DURATION_SEC)}
                </span>
              </div>
              <div className="bdrg-timeline-wrap">
                <div className="bdrg-timeline-title">Candidate Session Timeline</div>
                <div className="bdrg-timeline">
              <div className="bdrg-tl-inner" />
              {HIGHLIGHTS.map((h, i) => {
                const startPct = (h.startSec / DURATION_SEC) * 100;
                const endSec = h.endSec ?? h.startSec;
                const endPct = (endSec / DURATION_SEC) * 100;
                const isRange = h.endSec != null && h.endSec > h.startSec;
                const c = CATEGORY_COLORS[h.category] || CATEGORY_COLORS.default;
                const w = isRange ? Math.max(3, endPct - startPct) : 2.5;
                return (
                  <div
                    key={i}
                    className="bdrg-tl-seg"
                    style={{
                      left: `${startPct}%`,
                      width: `${w}%`,
                      marginLeft: isRange ? 0 : "-1.25%",
                      transform: activeIndex === i ? "scaleY(1.02)" : "scaleY(1)",
                      zIndex: activeIndex === i ? 15 : 5,
                    }}
                  >
                    <div
                      className="bdrg-tl-seg-inner"
                      style={{
                        backgroundColor: c.bg,
                        opacity: isRange ? 0.7 : 0.9,
                        borderRadius: isRange ? 6 : 999,
                      }}
                    />
                  </div>
                );
              })}
              <div
                className="bdrg-tl-playhead"
                style={{ left: `${playheadPct}%` }}
              />
            </div>

            <div className="bdrg-legend">
              {categories.map((cat) => {
                const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.default;
                return (
                  <span key={cat} className="bdrg-legend-chip">
                    <span className="bdrg-legend-dot" style={{ backgroundColor: c.dot }} />
                    {cat}
                  </span>
                );
              })}
            </div>
          </div>
          {active && (
            <div className="bdrg-detail">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div
                  className="bdrg-detail-bar"
                  style={{
                    backgroundColor: (CATEGORY_COLORS[active.category] || CATEGORY_COLORS.default).bg,
                  }}
                />
                <span className="bdrg-detail-cat">{active.category ?? "Moment"}</span>
                {active.score != null && (
                  <span className="bdrg-detail-score">
                    <strong>{active.score}</strong>/10
                  </span>
                )}
              </div>
              <p className="bdrg-detail-label">{active.label}</p>
              {active.description && (
                <p className="bdrg-detail-desc">{active.description}</p>
              )}
              <p className="bdrg-detail-time">
                {formatTime(active.startSec)}
                {active.endSec != null && active.endSec > active.startSec && (
                  <> – {formatTime(active.endSec)}</>
                )}
              </p>
            </div>
          )}
            </div>
          ) : (
            <>
              <div className="bdrg-controls">
                <div className="bdrg-play-icon" />
                <span className="bdrg-time">
                  {formatTime(FIXED_SEC)}
                  <span>/</span>
                  {formatTime(DURATION_SEC)}
                </span>
              </div>
              <div className="bdrg-timeline-wrap">
                <div className="bdrg-timeline-title">Candidate Session Timeline</div>
                <div className="bdrg-timeline">
                  <div className="bdrg-tl-inner" />
                  {HIGHLIGHTS.map((h, i) => {
                    const startPct = (h.startSec / DURATION_SEC) * 100;
                    const endSec = h.endSec ?? h.startSec;
                    const endPct = (endSec / DURATION_SEC) * 100;
                    const isRange = h.endSec != null && h.endSec > h.startSec;
                    const c = CATEGORY_COLORS[h.category] || CATEGORY_COLORS.default;
                    const w = isRange ? Math.max(3, endPct - startPct) : 2.5;
                    return (
                      <div
                        key={i}
                        className="bdrg-tl-seg"
                        style={{
                          left: `${startPct}%`,
                          width: `${w}%`,
                          marginLeft: isRange ? 0 : "-1.25%",
                          transform: activeIndex === i ? "scaleY(1.02)" : "scaleY(1)",
                          zIndex: activeIndex === i ? 15 : 5,
                        }}
                      >
                        <div
                          className="bdrg-tl-seg-inner"
                          style={{
                            backgroundColor: c.bg,
                            opacity: isRange ? 0.7 : 0.9,
                            borderRadius: isRange ? 6 : 999,
                          }}
                        />
                      </div>
                    );
                  })}
                  <div
                    className="bdrg-tl-playhead"
                    style={{ left: `${playheadPct}%` }}
                  />
                </div>
                <div className="bdrg-legend">
                  {categories.map((cat) => {
                    const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.default;
                    return (
                      <span key={cat} className="bdrg-legend-chip">
                        <span className="bdrg-legend-dot" style={{ backgroundColor: c.dot }} />
                        {cat}
                      </span>
                    );
                  })}
                </div>
              </div>
              {active && (
                <div className="bdrg-detail">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div
                      className="bdrg-detail-bar"
                      style={{
                        backgroundColor: (CATEGORY_COLORS[active.category] || CATEGORY_COLORS.default).bg,
                      }}
                    />
                    <span className="bdrg-detail-cat">{active.category ?? "Moment"}</span>
                    {active.score != null && (
                      <span className="bdrg-detail-score">
                        <strong>{active.score}</strong>/10
                      </span>
                    )}
                  </div>
                  <p className="bdrg-detail-label">{active.label}</p>
                  {active.description && (
                    <p className="bdrg-detail-desc">{active.description}</p>
                  )}
                  <p className="bdrg-detail-time">
                    {formatTime(active.startSec)}
                    {active.endSec != null && active.endSec > active.startSec && (
                      <> – {formatTime(active.endSec)}</>
                    )}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function BridgeDemoReplayGlassHorizontal(props) {
  return <BridgeDemoReplayGlass {...props} layout="horizontal" />;
}
