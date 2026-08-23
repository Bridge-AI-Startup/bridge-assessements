import createHttpError from "http-errors";
import { Types } from "mongoose";
import { getPlayStarModel } from "../../models/shorts/star.js";
import { getPlaySubmissionModel } from "../../models/shorts/submission.js";
import { getLinkedAnonymousIds } from "./account.js";
import {
  listSubmissionSummariesByIds,
  type PublicSubmissionSummary,
} from "./voting.js";

/** Sanity cap; nobody curates more saved builds than this. */
const MAX_STARS_LISTED = 500;

function assertAnonymousId(anonymousId: string | null | undefined): string {
  const id = String(anonymousId || "").trim();
  if (!id || id.length < 8) {
    throw createHttpError(400, "anonymousId is required");
  }
  return id;
}

/**
 * Every identity this caller can act as: this browser's id, plus (signed in)
 * the account stamp and all linked browser ids — the same union submissions
 * ownership uses, so saved lists follow the account across devices.
 */
async function starOwnerClauses(
  anonymousId: string,
  firebaseUid?: string | null,
): Promise<Array<Record<string, unknown>>> {
  const clauses: Array<Record<string, unknown>> = [{ anonymousId }];
  const uid = firebaseUid?.trim();
  if (uid) {
    clauses.push({ firebaseUid: uid });
    const linked = await getLinkedAnonymousIds(uid);
    if (linked.length) {
      clauses.push({ anonymousId: { $in: linked } });
    }
  }
  return clauses;
}

/**
 * Star or unstar a build. Starring is idempotent (upsert on the unique
 * {anonymousId, submissionId} index); unstarring removes the star across the
 * whole signed-in account, so a build unsaved on one device doesn't pop back
 * from a star made on another.
 */
export async function setStarred(input: {
  submissionId: string;
  anonymousId: string;
  firebaseUid?: string | null;
  starred: boolean;
}): Promise<{ starred: boolean }> {
  const anonymousId = assertAnonymousId(input.anonymousId);
  const submissionId = String(input.submissionId || "").trim();
  if (!Types.ObjectId.isValid(submissionId)) {
    throw createHttpError(400, "invalid submission id");
  }

  const Star = getPlayStarModel();

  if (!input.starred) {
    await Star.deleteMany({
      submissionId: new Types.ObjectId(submissionId),
      $or: await starOwnerClauses(anonymousId, input.firebaseUid),
    });
    return { starred: false };
  }

  const Submission = getPlaySubmissionModel();
  const submission = (await Submission.findById(submissionId)
    .select("challengeDate")
    .lean()) as { challengeDate?: string } | null;
  if (!submission) {
    throw createHttpError(404, "submission_not_found");
  }

  const uid = input.firebaseUid?.trim();
  await Star.updateOne(
    { anonymousId, submissionId: new Types.ObjectId(submissionId) },
    {
      $setOnInsert: {
        anonymousId,
        submissionId: new Types.ObjectId(submissionId),
        challengeDate: submission.challengeDate || "1970-01-01",
      },
      ...(uid ? { $set: { firebaseUid: uid } } : {}),
    },
    { upsert: true },
  );
  return { starred: true };
}

/**
 * The caller's saved builds, newest star first, across every identity linked
 * to their account. `idsOnly` skips the summary/rank load — the gallery only
 * needs membership to paint filled stars.
 */
export async function listStarred(input: {
  anonymousId: string;
  firebaseUid?: string | null;
  idsOnly?: boolean;
}): Promise<{ ids: string[]; submissions?: PublicSubmissionSummary[] }> {
  const anonymousId = assertAnonymousId(input.anonymousId);
  const Star = getPlayStarModel();
  const stars = (await Star.find({
    $or: await starOwnerClauses(anonymousId, input.firebaseUid),
  })
    .select("submissionId createdAt")
    .sort({ createdAt: -1 })
    .limit(MAX_STARS_LISTED)
    .lean()) as Array<{ submissionId: Types.ObjectId }>;

  // Same build starred on two linked devices → one entry, newest star wins.
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const star of stars) {
    const id = String(star.submissionId);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  if (input.idsOnly) {
    return { ids };
  }

  const submissions = await listSubmissionSummariesByIds(ids, {
    anonymousId,
    firebaseUid: input.firebaseUid,
  });
  // Leftover stars on deleted builds are dropped from the response (the rows
  // themselves are cleaned up by deleteSubmission, so this is belt-and-braces).
  const live = new Set(submissions.map((s) => s.id));
  return { ids: ids.filter((id) => live.has(id)), submissions };
}
