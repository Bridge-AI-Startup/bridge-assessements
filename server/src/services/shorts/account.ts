import createHttpError from "http-errors";
import { getPlayAccountLinkModel } from "../../models/shorts/accountLink.js";
import { getPlayChallengeModel } from "../../models/shorts/challenge.js";
import {
  listOwnerSubmissions,
  type PublicSubmissionSummary,
} from "./voting.js";

/** Safety cap so a scripted client cannot attach unbounded ids to one account. */
const MAX_LINKED_IDS = 25;

export type AccountSubmissionEntry = PublicSubmissionSummary & {
  challengeTitle: string;
};

/**
 * Claim an anonymous id for a signed-in account (idempotent). The claim model
 * is bearer-based on purpose: presenting an id from your own storage is the
 * same authority the rest of Shorts runs on.
 */
export async function linkAnonymousId(input: {
  firebaseUid: string;
  anonymousId: string;
}): Promise<{ linked: true; linkedIds: number }> {
  const firebaseUid = input.firebaseUid.trim();
  const anonymousId = input.anonymousId.trim();
  if (!firebaseUid) {
    throw createHttpError(401, "auth required");
  }
  if (!anonymousId || anonymousId.length < 8) {
    throw createHttpError(400, "anonymousId is required");
  }

  const AccountLink = getPlayAccountLinkModel();

  const existing = await AccountLink.countDocuments({ firebaseUid });
  const already = await AccountLink.exists({ firebaseUid, anonymousId });
  if (!already && existing >= MAX_LINKED_IDS) {
    throw createHttpError(429, "too_many_linked_ids");
  }

  await AccountLink.updateOne(
    { firebaseUid, anonymousId },
    { $setOnInsert: { firebaseUid, anonymousId } },
    { upsert: true },
  );

  return {
    linked: true,
    linkedIds: already ? existing : existing + 1,
  };
}

export async function getLinkedAnonymousIds(
  firebaseUid: string,
): Promise<string[]> {
  const AccountLink = getPlayAccountLinkModel();
  const links = await AccountLink.find({ firebaseUid })
    .select("anonymousId")
    .lean();
  return links.map((l) => l.anonymousId as string);
}

/**
 * All submissions across every anonymous id linked to this account, newest
 * round first, enriched with challenge titles.
 */
export async function getAccountSubmissions(
  firebaseUid: string,
): Promise<{ submissions: AccountSubmissionEntry[]; linkedIds: number }> {
  const ids = await getLinkedAnonymousIds(firebaseUid);
  const submissions = await listOwnerSubmissions(ids, firebaseUid);

  const slugs = [...new Set(submissions.map((s) => s.challengeSlug))];
  const Challenge = getPlayChallengeModel();
  const challenges = slugs.length
    ? await Challenge.find({ slug: { $in: slugs } })
        .select("slug title")
        .lean()
    : [];
  const titleBySlug = new Map(
    challenges.map((c) => [c.slug as string, c.title as string]),
  );

  return {
    linkedIds: ids.length,
    submissions: submissions.map((s) => ({
      ...s,
      challengeTitle: titleBySlug.get(s.challengeSlug) || s.challengeSlug,
    })),
  };
}
