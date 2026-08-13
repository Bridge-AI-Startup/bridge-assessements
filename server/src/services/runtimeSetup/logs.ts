import RuntimeSetupSessionModel from "../../models/runtimeSetupSession.js";
import { redactSecrets } from "./secrets.js";

export type LogStream = "stdout" | "stderr" | "system";

export type RuntimeLogLine = {
  seq: number;
  t: string;
  stream: LogStream;
  text: string;
};

const MAX_PERSISTED_LINES = 400;
const MAX_LINE_CHARS = 2_000;

type LiveBuffer = {
  seq: number;
  lines: RuntimeLogLine[];
  secrets: string[];
};

const live = new Map<string, LiveBuffer>();

function sessionKey(sessionId: string): string {
  return String(sessionId);
}

export function resetLiveLogs(sessionId: string, secrets: string[] = []): void {
  live.set(sessionKey(sessionId), { seq: 0, lines: [], secrets });
}

export function setLiveSecrets(sessionId: string, secrets: string[]): void {
  const buf = live.get(sessionKey(sessionId));
  if (buf) buf.secrets = secrets;
}

export function appendLiveLog(
  sessionId: string,
  stream: LogStream,
  text: string
): RuntimeLogLine | null {
  const key = sessionKey(sessionId);
  let buf = live.get(key);
  if (!buf) {
    buf = { seq: 0, lines: [], secrets: [] };
    live.set(key, buf);
  }
  const chunks = String(text || "").split(/\r?\n/);
  let last: RuntimeLogLine | null = null;
  for (const chunk of chunks) {
    const trimmed = chunk.replace(/\s+$/, "");
    if (!trimmed) continue;
    buf.seq += 1;
    const line: RuntimeLogLine = {
      seq: buf.seq,
      t: new Date().toISOString(),
      stream,
      text: redactSecrets(trimmed.slice(0, MAX_LINE_CHARS), buf.secrets),
    };
    buf.lines.push(line);
    if (buf.lines.length > MAX_PERSISTED_LINES) {
      buf.lines.splice(0, buf.lines.length - MAX_PERSISTED_LINES);
    }
    last = line;
  }
  return last;
}

export function getLiveLogs(sessionId: string, afterSeq = 0): RuntimeLogLine[] {
  const buf = live.get(sessionKey(sessionId));
  if (!buf) return [];
  return buf.lines.filter((l) => l.seq > afterSeq);
}

export async function persistLiveLogs(sessionId: string): Promise<void> {
  const buf = live.get(sessionKey(sessionId));
  if (!buf) return;
  await RuntimeSetupSessionModel.findByIdAndUpdate(sessionId, {
    $set: {
      logSeq: buf.seq,
      logLines: buf.lines.map((l) => ({
        seq: l.seq,
        t: new Date(l.t),
        stream: l.stream,
        text: l.text,
      })),
    },
  });
}

export function hydrateLiveFromSession(session: {
  _id: { toString(): string };
  logSeq?: number;
  logLines?: Array<{ seq: number; t: Date; stream: LogStream; text: string }>;
}): void {
  const key = sessionKey(session._id.toString());
  if (live.has(key)) return;
  const lines = (session.logLines || []).map((l) => ({
    seq: l.seq,
    t: new Date(l.t).toISOString(),
    stream: l.stream,
    text: l.text,
  }));
  live.set(key, {
    seq: session.logSeq || lines[lines.length - 1]?.seq || 0,
    lines,
    secrets: [],
  });
}

export function dropLiveLogs(sessionId: string): void {
  live.delete(sessionKey(sessionId));
}
