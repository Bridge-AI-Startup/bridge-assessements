import createHttpError from "http-errors";
import { Sandbox } from "e2b";
import {
  CHALLENGE_CATEGORIES,
  CHALLENGE_STATUSES,
  getPlayChallengeModel,
} from "../../models/shorts/challenge.js";
import { getPlayBuildSessionModel } from "../../models/shorts/buildSession.js";
import { getPlaySubmissionModel } from "../../models/shorts/submission.js";

export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];
export type ChallengeMakeMode = "e2b" | "serverless";

export type PublicChallenge = {
  challengeDate: string;
  slug: string;
  title: string;
  prompt: string;
  tokenBudget: number;
  category: ChallengeCategory;
  /** Build path override; unset → server SHORTS_MAKE_MODE default. */
  makeMode?: ChallengeMakeMode;
  /** True only for the manually selected current round. */
  isActive?: boolean;
};

/** UTC date helper for seed scripts. It does not select the active round. */
export function getUtcChallengeDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export type ChallengeInput = {
  slug: string;
  challengeDate: string;
  title: string;
  prompt: string;
  tokenBudget: number;
  category: ChallengeCategory;
  status?: ChallengeStatus;
  makeMode?: ChallengeMakeMode;
};

export type ChallengePatch = Partial<ChallengeInput>;

export type ListChallengesOptions = {
  limit?: number;
  fromDate?: string;
  toDate?: string;
  status?: ChallengeStatus;
};

function toPublicChallenge(doc: {
  challengeDate: string;
  slug: string;
  title: string;
  prompt: string;
  tokenBudget: number;
  category: ChallengeCategory;
  makeMode?: ChallengeMakeMode;
  isActive?: boolean;
}): PublicChallenge {
  const result: PublicChallenge = {
    challengeDate: doc.challengeDate,
    slug: doc.slug,
    title: doc.title,
    prompt: doc.prompt,
    tokenBudget: doc.tokenBudget,
    category: doc.category,
  };
  if (doc.makeMode === "e2b" || doc.makeMode === "serverless") {
    result.makeMode = doc.makeMode;
  }
  if (doc.isActive) result.isActive = true;
  return result;
}

/** The current round is explicit state; dates and cadence never select it. */
export async function getCurrentChallenge(): Promise<PublicChallenge | null> {
  const Challenge = getPlayChallengeModel();
  const doc = (await Challenge.findOne({
    status: "published",
    isActive: true,
  }).lean()) as PublicChallenge | null;
  return doc ? toPublicChallenge(doc) : null;
}

/** Date key of the manually selected current round. */
export async function getActiveChallengeDate(): Promise<string> {
  const live = await getCurrentChallenge();
  if (!live) throw createHttpError(404, "no_active_round");
  return live.challengeDate;
}

export type PastChallengeSummary = {
  slug: string;
  title: string;
  challengeDate: string;
  category: ChallengeCategory;
  submissionCount: number;
  /** True for the manually selected current round. */
  isCurrent: boolean;
};

/**
 * All published rounds, newest first, with per-round submission counts.
 */
export async function listPastChallenges(
  options: { limit?: number } = {},
): Promise<{ challenges: PastChallengeSummary[]; total: number }> {
  const Challenge = getPlayChallengeModel();
  const limit = Math.min(Math.max(options.limit ?? 52, 1), 200);
  const current = await getCurrentChallenge();
  const currentKey = current?.challengeDate ?? null;

  const filter = {
    status: "published",
  };

  const [docs, total] = await Promise.all([
    Challenge.find(filter)
      .select("slug title challengeDate category")
      .sort({ challengeDate: -1 })
      .limit(limit)
      .lean(),
    Challenge.countDocuments(filter),
  ]);

  // One aggregation for all rounds on the page, not a count per round.
  const Submission = getPlaySubmissionModel();
  const counts = (await Submission.aggregate([
    { $match: { challengeDate: { $in: docs.map((d) => d.challengeDate) } } },
    { $group: { _id: "$challengeDate", count: { $sum: 1 } } },
  ])) as Array<{ _id: string; count: number }>;
  const countByDate = new Map(counts.map((c) => [c._id, c.count]));

  return {
    total,
    challenges: docs.map((doc) => ({
      slug: doc.slug as string,
      title: doc.title as string,
      challengeDate: doc.challengeDate as string,
      category: doc.category as ChallengeCategory,
      submissionCount: countByDate.get(doc.challengeDate) ?? 0,
      isCurrent: doc.challengeDate === currentKey,
    })),
  };
}

export async function listChallenges(options: ListChallengesOptions = {}) {
  const Challenge = getPlayChallengeModel();
  const limit = options.limit ?? 100;
  const filter: Record<string, unknown> = {};

  if (options.status) {
    filter.status = options.status;
  }
  if (options.fromDate || options.toDate) {
    const dateFilter: Record<string, string> = {};
    if (options.fromDate) {
      dateFilter.$gte = options.fromDate;
    }
    if (options.toDate) {
      dateFilter.$lte = options.toDate;
    }
    filter.challengeDate = dateFilter;
  }

  return Challenge.find(filter)
    .sort({ challengeDate: -1 })
    .limit(limit)
    .lean();
}

export async function getChallengeBySlug(slug: string) {
  const Challenge = getPlayChallengeModel();
  return Challenge.findOne({ slug: slug.toLowerCase() }).lean();
}

/**
 * Make one published challenge the current round. This is the only operation
 * that changes the round; dates, windows, publishing, and wall-clock time do not.
 *
 * The updates deliberately fail closed: if the process stops between clearing
 * the old marker and setting the new one, Shorts has no active round rather
 * than silently serving the wrong challenge.
 */
export async function activateChallenge(slug: string) {
  const Challenge = getPlayChallengeModel();
  const BuildSession = getPlayBuildSessionModel();
  const normalizedSlug = slug.toLowerCase();
  const target = await Challenge.findOne({ slug: normalizedSlug });
  if (!target) throw createHttpError(404, "Challenge not found");
  if (target.status !== "published") {
    throw createHttpError(409, "Publish the challenge before activating it");
  }

  const now = new Date();
  const oldSessions = await BuildSession.find({
    challengeSlug: { $ne: normalizedSlug },
    status: { $in: ["active", "provisioning"] },
    e2bSandboxId: { $exists: true, $ne: null },
  })
    .select("e2bSandboxId")
    .lean();

  await Challenge.updateMany(
    { isActive: true, slug: { $ne: normalizedSlug } },
    { $set: { isActive: false, deactivatedAt: now } },
  );
  target.isActive = true;
  target.activatedAt = now;
  target.deactivatedAt = undefined;
  await target.save();

  // A round switch closes unfinished builds from prior rounds. Current-round
  // sessions lose legacy calendar expiry so they remain usable until the next
  // explicit activation.
  await Promise.all([
    BuildSession.updateMany(
      {
        challengeSlug: { $ne: normalizedSlug },
        status: { $in: ["active", "provisioning"] },
      },
      {
        $set: { status: "expired", error: "Round replaced" },
        $unset: { expiresAt: 1 },
      },
    ),
    BuildSession.updateMany(
      {
        challengeSlug: normalizedSlug,
        status: { $in: ["active", "provisioning"] },
      },
      { $unset: { expiresAt: 1, error: 1 } },
    ),
  ]);

  // Mongo state changes first so old sessions stop accepting work immediately;
  // sandbox cleanup is best-effort and cannot roll the round switch back.
  await Promise.allSettled(
    oldSessions
      .map((session) => session.e2bSandboxId)
      .filter((id): id is string => Boolean(id))
      .map((id) => Sandbox.kill(id)),
  );

  return target.toObject();
}

async function assertUniqueSlugAndDate(
  slug: string,
  challengeDate: string,
  excludeSlug?: string,
) {
  const Challenge = getPlayChallengeModel();
  const normalizedSlug = slug.toLowerCase();
  const exclude = excludeSlug?.toLowerCase();

  const slugConflict = await Challenge.findOne({ slug: normalizedSlug }).lean();
  if (slugConflict && slugConflict.slug !== exclude) {
    throw createHttpError(409, "A challenge with this slug already exists");
  }

  const dateConflict = await Challenge.findOne({ challengeDate }).lean();
  if (dateConflict && dateConflict.slug !== exclude) {
    throw createHttpError(
      409,
      "A challenge is already scheduled for this date",
    );
  }
}

export async function createChallenge(input: ChallengeInput) {
  const Challenge = getPlayChallengeModel();
  const slug = input.slug.toLowerCase();

  await assertUniqueSlugAndDate(slug, input.challengeDate);

  const doc = await Challenge.create({
    ...input,
    slug,
    status: input.status ?? "draft",
    // Empty string means "use env default" — store nothing rather than fail the enum.
    makeMode: input.makeMode || undefined,
  });

  return doc.toObject();
}

export async function updateChallenge(slug: string, patch: ChallengePatch) {
  const Challenge = getPlayChallengeModel();
  const normalizedSlug = slug.toLowerCase();
  const existing = await Challenge.findOne({ slug: normalizedSlug });

  if (!existing) {
    throw createHttpError(404, "Challenge not found");
  }

  const nextSlug = patch.slug?.toLowerCase() ?? normalizedSlug;
  const nextDate = patch.challengeDate ?? existing.challengeDate;

  if (
    existing.isActive &&
    (nextSlug !== normalizedSlug || nextDate !== existing.challengeDate)
  ) {
    throw createHttpError(
      409,
      "Activate another round before changing the current round key",
    );
  }

  if (nextSlug !== normalizedSlug || nextDate !== existing.challengeDate) {
    await assertUniqueSlugAndDate(nextSlug, nextDate, normalizedSlug);
  }

  if (patch.slug !== undefined) {
    existing.slug = nextSlug;
  }
  if (patch.challengeDate !== undefined) {
    existing.challengeDate = patch.challengeDate;
  }
  if (patch.title !== undefined) {
    existing.title = patch.title;
  }
  if (patch.prompt !== undefined) {
    existing.prompt = patch.prompt;
  }
  if (patch.tokenBudget !== undefined) {
    existing.tokenBudget = patch.tokenBudget;
  }
  if (patch.category !== undefined) {
    existing.category = patch.category;
  }
  if (patch.status !== undefined) {
    if (existing.isActive && patch.status !== "published") {
      throw createHttpError(
        409,
        "Activate another round before unpublishing the current one",
      );
    }
    existing.status = patch.status;
  }
  if (patch.makeMode !== undefined) {
    // Empty string from the form clears the override (back to env default).
    existing.makeMode = patch.makeMode || undefined;
  }

  await existing.save();
  return existing.toObject();
}
