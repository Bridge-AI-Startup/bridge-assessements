import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * "What they did" — the candidate's AI conversation, with screen-context
 * beats interleaved.
 *
 * Under `both` the screen recording is never transcribed, so this is the
 * text index of the footage. It lives under the player on the Recording tab
 * (click a row to seek). Leftover workflow-only assessments have no player,
 * so the same component stays on Summary.
 *
 * The analysis timeline still contains every Read/Edit/Bash for grading.
 * This view keeps only what a reviewer can skim: prompts, agent replies,
 * and Gemini surface switches (browser, IDE, running app).
 */

const SCREEN_RE = /^On screen\s*\(([^)]+)\)(?::\s*(.*))?$/i;
const PROMPT_RE = /^Candidate prompted the AI assistant:\s*/i;
const REPLY_RE = /^AI assistant replied:\s*/i;

const SCREEN_SURFACES = {
  ide: { in: "in the IDE", switched: "the IDE", back: "back in the IDE" },
  terminal: {
    in: "in the terminal",
    switched: "the terminal",
    back: "back in the terminal",
  },
  cli_agent: {
    in: "in the coding agent",
    switched: "the coding agent",
    back: "back in the coding agent",
  },
  "browser:search": {
    in: "in browser · search",
    switched: "browser · search",
    back: "back in browser · search",
  },
  "browser:docs": {
    in: "in browser · docs",
    switched: "browser · docs",
    back: "back in browser · docs",
  },
  "browser:ai_chat": {
    in: "in browser · AI chat",
    switched: "browser · AI chat",
    back: "back in browser · AI chat",
  },
  "browser:own_app": {
    in: "in browser · own app",
    switched: "browser · own app",
    back: "back in browser · own app",
  },
  other: {
    in: "in another window",
    switched: "another window",
    back: "back in another window",
  },
};

const AGENT_LABEL = {
  claude: "Claude",
  cursor: "Cursor",
  copilot: "Codex",
  chatgpt: "ChatGPT",
};

const formatOffset = (sec) => {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
};

/**
 * Map a session-relative second (an episode start, a timeline ts) onto the
 * merged recording's offset. `ts` and `videoOffsetSeconds` share no origin —
 * capture-kit start vs proctoring captureStartedAt — but differ by a constant
 * except across stream gaps, so anchor on the nearest row that carries both
 * and carry the delta. Null when nothing on the timeline maps (no recording).
 */
export function sessionSecondToVideoOffset(timeline, sec) {
  if (!Number.isFinite(sec)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const row of timeline || []) {
    const ts = Number(row?.ts);
    const off = row?.videoOffsetSeconds;
    if (!Number.isFinite(ts) || off == null || !Number.isFinite(off)) continue;
    const dist = Math.abs(ts - sec);
    if (dist < bestDist) {
      bestDist = dist;
      best = { ts, off };
    }
  }
  if (!best) return null;
  return Math.max(0, best.off + (sec - best.ts));
}

function unwrapQuoted(text) {
  return String(text || "")
    .trim()
    .replace(/^"|"$/g, "")
    .trim();
}

function screenPhrase(label, prevLabel, detail) {
  const surf = SCREEN_SURFACES[label] || {
    in: `on screen · ${label}`,
    switched: label,
    back: `back to ${label}`,
  };
  let phrase;
  if (!prevLabel) phrase = surf.in;
  else if (label === prevLabel) phrase = surf.in;
  else if (label === "ide" || label === "terminal") phrase = surf.back;
  else phrase = `switched to ${surf.switched}`;
  const extra = String(detail || "").trim();
  if (extra && extra.length <= 48) phrase = `${phrase} · ${extra}`;
  return phrase;
}

/**
 * Map one analysis timeline row onto a conversation beat, or null to drop.
 * Relies on description prefixes from `buildTranscriptEvents` plus
 * `prompt_text` / `action_type` so we don't need a new API field.
 */
function toConversationBeat(row) {
  if (!row || !Number.isFinite(Number(row.ts))) return null;
  const desc = String(row.description || "").trim();

  const screen = desc.match(SCREEN_RE);
  if (screen) {
    const label = (screen[1] || "").trim();
    if (!label || label === "idle") return null;
    return {
      kind: "screen",
      ts: Number(row.ts),
      offset: row.videoOffsetSeconds,
      label,
      detail: unwrapQuoted(screen[2] || ""),
    };
  }

  if (row.prompt_text || PROMPT_RE.test(desc)) {
    const text = unwrapQuoted(row.prompt_text || desc.replace(PROMPT_RE, ""));
    if (!text) return null;
    return {
      kind: "prompt",
      ts: Number(row.ts),
      offset: row.videoOffsetSeconds,
      text,
      speaker: "Candidate",
    };
  }

  if (row.action_type === "ai_response" || REPLY_RE.test(desc)) {
    const text = unwrapQuoted(desc.replace(REPLY_RE, ""));
    if (!text) return null;
    return {
      kind: "reply",
      ts: Number(row.ts),
      offset: row.videoOffsetSeconds,
      text,
      speaker: AGENT_LABEL[row.ai_tool] || "Agent",
    };
  }

  return null;
}

function buildConversation(timeline) {
  const beats = [];
  let prevScreen = null;
  for (const row of timeline || []) {
    const beat = toConversationBeat(row);
    if (!beat) continue;
    if (beat.kind === "screen") {
      if (prevScreen === beat.label) continue;
      beat.phrase = screenPhrase(beat.label, prevScreen, beat.detail);
      prevScreen = beat.label;
    }
    beats.push(beat);
  }
  return beats;
}

function Clock({ clock, seekable, offset, onSeek, label, className }) {
  const classes = cn(
    "w-12 shrink-0 font-mono text-[11px] tabular-nums text-gray-400",
    className
  );
  if (!seekable) {
    return <span className={classes}>{clock}</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSeek(offset);
      }}
      aria-label={label}
      title={label}
      className={cn(classes, "text-left hover:text-[#21201C]")}
    >
      {clock}
    </button>
  );
}

function MessageBody({ text, expanded, onToggle, muted = false }) {
  const long = text.length > 420 || text.split("\n").length > 8;
  return (
    <div>
      <p
        className={cn(
          "min-w-0 text-sm leading-relaxed whitespace-pre-wrap break-words",
          muted ? "text-gray-600" : "text-[#21201C]",
          long && !expanded && "line-clamp-6"
        )}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mt-1 text-[11px] text-gray-500 underline underline-offset-2 hover:text-gray-800"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

export default function WorkflowActivityTimeline({
  timeline = [],
  /** Persisted session episodes; rendered as chapter dividers inside the conversation. */
  episodes = [],
  onSeek = null,
  /** Capture/scoring still running — render a waiting card instead of nothing. */
  pending = false,
  className,
}) {
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());

  const hasAnyTimeline = useMemo(
    () => (timeline || []).some((r) => r && Number.isFinite(Number(r.ts))),
    [timeline]
  );

  const beats = useMemo(() => buildConversation(timeline), [timeline]);

  // Chapters (episodes) slot in at their start second, ahead of the beat they
  // introduce, so the conversation reads as a chaptered document rather than
  // an undifferentiated scroll.
  const items = useMemo(() => {
    const rows = beats.map((b) => ({ ...b, chapter: false }));
    for (const ep of episodes || []) {
      const start = Number(ep?.startSeconds);
      if (!Number.isFinite(start)) continue;
      rows.push({
        kind: "chapter",
        chapter: true,
        ts: start,
        offset: sessionSecondToVideoOffset(timeline, start),
        index: ep.index,
        label: ep.label,
        episodeKind: ep.kind,
        summary: ep.summary,
      });
    }
    rows.sort(
      (a, b) =>
        a.ts - b.ts || (a.chapter === b.chapter ? 0 : a.chapter ? -1 : 1)
    );
    return rows;
  }, [beats, episodes, timeline]);

  const counts = useMemo(() => {
    let prompts = 0;
    let replies = 0;
    let screens = 0;
    for (const b of beats) {
      if (b.kind === "prompt") prompts += 1;
      else if (b.kind === "reply") replies += 1;
      else screens += 1;
    }
    return { prompts, replies, screens };
  }, [beats]);

  if (!hasAnyTimeline) {
    if (!pending) return null;
    return (
      <div className={cn("rounded-xl border border-gray-200 bg-white", className)}>
        <div className="px-4 py-3">
          <h4 className="text-sm font-medium tracking-[-0.012em] text-[#21201C]">
            What they did
          </h4>
          <p className="text-xs text-gray-500 mt-1">
            Capture still processing — the conversation appears here once it
            lands.
          </p>
        </div>
      </div>
    );
  }

  const toggleExpanded = (key) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const subtitleParts = [];
  if (counts.prompts)
    subtitleParts.push(
      `${counts.prompts} prompt${counts.prompts === 1 ? "" : "s"}`
    );
  if (counts.replies)
    subtitleParts.push(
      `${counts.replies} ${counts.replies === 1 ? "reply" : "replies"}`
    );
  if (counts.screens)
    subtitleParts.push(
      `${counts.screens} screen moment${counts.screens === 1 ? "" : "s"}`
    );
  const chapterCount = items.filter((it) => it.chapter).length;
  if (chapterCount)
    subtitleParts.push(
      `${chapterCount} chapter${chapterCount === 1 ? "" : "s"}`
    );

  return (
    <div className={cn("rounded-xl border border-gray-200 bg-white", className)}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h4 className="text-sm font-medium tracking-[-0.012em] text-[#21201C]">
          What they did
        </h4>
        <p className="text-xs text-gray-500 mt-0.5">
          {beats.length === 0
            ? "No prompts or screen moments in this capture — only tool activity was recorded."
            : [
                subtitleParts.join(" · "),
                onSeek ? "click a line to jump the recording there" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      </div>

      {beats.length > 0 ? (
        <div className="max-h-[46vh] overflow-y-auto">
          {items.map((beat, i) => {
            const key = `${beat.kind}-${beat.ts}-${i}`;
            const offset = beat.offset;
            const seekable =
              Boolean(onSeek) && offset != null && Number.isFinite(offset);
            const clock = formatOffset(
              offset != null && Number.isFinite(offset) ? offset : beat.ts
            );
            const seekLabel = `Jump the recording to ${clock}`;

            if (beat.kind === "chapter") {
              return (
                <div
                  key={key}
                  onClick={seekable ? () => onSeek(offset) : undefined}
                  title={beat.summary || undefined}
                  className={cn(
                    "flex items-baseline gap-3 px-4 py-2 bg-[#FAF9F2] border-y border-gray-100",
                    seekable && "cursor-pointer hover:bg-[#F3F1E6]"
                  )}
                >
                  <Clock
                    clock={clock}
                    seekable={seekable}
                    offset={offset}
                    onSeek={onSeek}
                    label={seekLabel}
                  />
                  <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#21201C]">
                    {beat.index != null ? (
                      <span className="mr-1.5 tabular-nums text-gray-400">
                        {beat.index}
                      </span>
                    ) : null}
                    {beat.label}
                    {beat.episodeKind ? (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.03em] text-gray-400">
                        {beat.episodeKind}
                      </span>
                    ) : null}
                  </p>
                </div>
              );
            }

            if (beat.kind === "screen") {
              return (
                <div
                  key={key}
                  onClick={seekable ? () => onSeek(offset) : undefined}
                  className={cn(
                    "flex items-baseline gap-3 px-4 py-2",
                    seekable && "cursor-pointer hover:bg-gray-50"
                  )}
                >
                  <Clock
                    clock={clock}
                    seekable={seekable}
                    offset={offset}
                    onSeek={onSeek}
                    label={seekLabel}
                  />
                  <p className="min-w-0 flex-1 text-[12px] italic leading-relaxed text-gray-500">
                    {beat.phrase}
                  </p>
                </div>
              );
            }

            const isPrompt = beat.kind === "prompt";
            return (
              <div
                key={key}
                onClick={seekable ? () => onSeek(offset) : undefined}
                className={cn(
                  "flex gap-3 px-4 py-3 border-b border-gray-50 last:border-0",
                  seekable && "cursor-pointer hover:bg-gray-50"
                )}
              >
                <Clock
                  clock={clock}
                  seekable={seekable}
                  offset={offset}
                  onSeek={onSeek}
                  label={seekLabel}
                  className="pt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "eyebrow text-[10px]",
                      isPrompt ? "text-[#21201C]" : "text-gray-500"
                    )}
                  >
                    {beat.speaker}
                  </span>
                  <div
                    className={cn(
                      "mt-1",
                      isPrompt
                        ? "rounded-2xl rounded-tl-md bg-[#FAF9F2] px-3 py-2"
                        : "pl-0.5"
                    )}
                  >
                    <MessageBody
                      text={beat.text}
                      muted={!isPrompt}
                      expanded={expandedKeys.has(key)}
                      onToggle={() => toggleExpanded(key)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
