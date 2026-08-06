/**
 * Persist Claude chat + workspace snapshots on PlayBuildSession for refresh/resume.
 */
import type { Sandbox } from "e2b";
import { Types } from "mongoose";
import { getShortsSubmitGraceSeconds } from "../../utils/shortsEnv.js";
import { getPlayBuildSessionModel } from "../../models/shorts/buildSession.js";
import { endOfChallengePeriod } from "./challengePeriod.js";
import {
  snapshotProjectFiles,
  writeChallengeMarkdown,
  writePlayProjectClaudeMd,
  type SnapshotFile,
} from "./sandbox.js";
import { writeProjectFile } from "./workspaceFiles.js";

const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_CHARS = 200_000;

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  createdAt?: Date;
};

export type { SnapshotFile };

/** End of the challenge period for a stored period key (day or week). */
export function endOfUtcChallengeDay(challengeDate: string): Date {
  return endOfChallengePeriod(challengeDate);
}

/**
 * When a build session stops accepting work: the end of its challenge round.
 *
 * There is deliberately **no per-build clock**. Builds used to expire a fixed
 * number of minutes after `startedAt`, which meant a finished build could be
 * lost while its author was typing a name or signing in. The only boundary now
 * is the round itself, because a submission has to belong to the round it was
 * built for.
 */
export function computeBuildSessionExpiresAt(input: {
  challengeDate: string;
  /** Window-override rounds end here instead of the cadence-derived period end. */
  periodEndsAt?: Date | null;
}): Date {
  return input.periodEndsAt ?? endOfUtcChallengeDay(input.challengeDate);
}

const DEFAULT_SUBMIT_GRACE_SECONDS = 120;

/**
 * Grace window after `expiresAt` in which a build can still be **submitted**.
 *
 * `expiresAt` is now the round boundary rather than a personal clock, so this
 * exists only to keep that boundary from being a cliff: someone who hits Submit
 * as the round rolls over still gets their build saved. Building itself is over
 * at `expiresAt` — chat turns are refused. `SHORTS_SUBMIT_GRACE_SECONDS=0`
 * disables it.
 */
export function getSubmitGraceSeconds(): number {
  const raw = getShortsSubmitGraceSeconds();
  if (!raw) return DEFAULT_SUBMIT_GRACE_SECONDS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SUBMIT_GRACE_SECONDS;
}

export function getSubmitGraceMs(): number {
  return getSubmitGraceSeconds() * 1000;
}

/** True while a round-ended session may still submit (never true before expiry). */
export function isWithinSubmitGrace(
  expiresAt?: Date | null,
  now: number = Date.now(),
): boolean {
  if (!expiresAt) return false;
  const end = expiresAt.getTime();
  return now > end && now <= end + getSubmitGraceMs();
}

/** E2B Hobby/default API rejects sandbox timeouts above 1 hour. */
const E2B_MAX_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * E2B sandbox lifetime for create/reprovision.
 * Mongo session still lasts until end of UTC challenge day; the box may be
 * recreated and restored from workspaceSnapshot when this shorter timeout elapses.
 * Clamped to E2B's hard max of 1 hour.
 */
export function e2bTimeoutMsForChallengeDay(
  _challengeDate: string,
  _now: Date = new Date(),
): number {
  return E2B_MAX_TIMEOUT_MS;
}

function trimChatMessages(messages: ChatMessage[]): ChatMessage[] {
  let trimmed = messages.slice(-MAX_CHAT_MESSAGES);
  let chars = trimmed.reduce((n, m) => n + (m.text?.length ?? 0), 0);
  while (trimmed.length > 1 && chars > MAX_CHAT_CHARS) {
    const removed = trimmed.shift();
    chars -= removed?.text?.length ?? 0;
  }
  return trimmed;
}

export function serializeChatMessages(
  messages: ChatMessage[] | undefined | null,
): Array<{ role: "user" | "assistant"; text: string; createdAt?: string }> {
  if (!messages?.length) return [];
  return messages.map((m) => ({
    role: m.role,
    text: m.text,
    ...(m.createdAt
      ? { createdAt: new Date(m.createdAt).toISOString() }
      : {}),
  }));
}

export async function appendSessionChatMessages(
  sessionId: string,
  additions: ChatMessage[],
): Promise<void> {
  if (!Types.ObjectId.isValid(sessionId) || additions.length === 0) return;
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) return;

  const existing = (doc.chatMessages || []) as ChatMessage[];
  const next = trimChatMessages([
    ...existing.map((m) => ({
      role: m.role,
      text: m.text,
      createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
    })),
    ...additions.map((m) => ({
      role: m.role,
      text: m.text,
      createdAt: m.createdAt ?? new Date(),
    })),
  ]);
  doc.chatMessages = next;
  await doc.save();
}

/** Upsert one file into the session workspace snapshot (Monaco save). */
export async function upsertSessionWorkspaceFile(
  sessionId: string,
  path: string,
  content: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(sessionId)) return;
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) return;

  const files = ([...(doc.workspaceSnapshot || [])] as SnapshotFile[]).filter(
    (f) => f.path !== path,
  );
  files.push({ path, content });
  doc.workspaceSnapshot = files;
  doc.workspaceSnapshotAt = new Date();
  await doc.save();
}

/** Full project snapshot from live sandbox into the session doc. */
export async function refreshSessionWorkspaceSnapshot(
  sessionId: string,
  sandbox: Sandbox,
): Promise<void> {
  if (!Types.ObjectId.isValid(sessionId)) return;
  let snapshot: { files: SnapshotFile[]; totalBytes: number };
  try {
    snapshot = await snapshotProjectFiles(sandbox);
  } catch (err) {
    console.warn(
      `[play/sessionPersist] snapshot failed for ${sessionId}:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) return;
  doc.workspaceSnapshot = snapshot.files;
  doc.workspaceSnapshotAt = new Date();
  await doc.save();
}

/** Write stored snapshot files into a (new) sandbox workspace. */
export async function restoreWorkspaceSnapshotToSandbox(
  sandbox: Sandbox,
  files: SnapshotFile[] | undefined | null,
): Promise<number> {
  if (!files?.length) return 0;
  let written = 0;
  for (const f of files) {
    if (!f?.path || typeof f.content !== "string") continue;
    try {
      await writeProjectFile(sandbox, f.path, f.content);
      written++;
    } catch (err) {
      console.warn(
        `[play/sessionPersist] restore skip ${f.path}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return written;
}

export async function restoreSessionSnapshotAndPrompt(
  sandbox: Sandbox,
  opts: {
    files?: SnapshotFile[] | null;
    challengeTitle: string;
    challengePrompt: string;
  },
): Promise<void> {
  const written = await restoreWorkspaceSnapshotToSandbox(sandbox, opts.files);
  if (written === 0) {
    // Fresh box / empty snapshot — still write challenge brief
    const challengeMd = `# ${opts.challengeTitle}\n\n${opts.challengePrompt}\n`;
    await writeChallengeMarkdown(sandbox, challengeMd);
  } else {
    // Ensure challenge.md exists even if snapshot omitted it
    try {
      await writeChallengeMarkdown(
        sandbox,
        `# ${opts.challengeTitle}\n\n${opts.challengePrompt}\n`,
      );
    } catch {
      // ignore if write fails; project files already restored
    }
  }
  try {
    await writePlayProjectClaudeMd(sandbox);
  } catch {
    // ignore
  }
}
