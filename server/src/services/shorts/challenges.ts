import createHttpError from "http-errors";
import {
  CHALLENGE_CATEGORIES,
  CHALLENGE_STATUSES,
  getPlayChallengeModel,
} from "../../models/shorts/challenge.js";
import { getPlaySubmissionModel } from "../../models/shorts/submission.js";

import {
  endOfChallengePeriod,
  getCurrentPeriodKey,
  getPlayChallengeCadence,
} from "./challengePeriod.js";

export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];
export type ChallengeMakeMode = "e2b" | "serverless";

export type PublicChallenge = {
  challengeDate: string;
  slug: string;
  title: string;
  prompt: string;
  tokenBudget: number;
  timeLimitMinutes?: number;
  category: ChallengeCategory;
  /** Build path override; unset → server SHORTS_MAKE_MODE default. */
  makeMode?: ChallengeMakeMode;
  /** Present on GET /today — mirrors PLAY_CHALLENGE_CADENCE */
  cadence?: "daily" | "weekly";
  periodEndsAt?: string;
};

/** @deprecated Prefer getCurrentPeriodKey — kept for call sites / seeds */
export function getUtcChallengeDate(date: Date = new Date()): string {
  return getCurrentPeriodKey(date);
}

export type ChallengeInput = {
  slug: string;
  challengeDate: string;
  title: string;
  prompt: string;
  tokenBudget: number;
  timeLimitMinutes?: number;
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
  timeLimitMinutes?: number;
  category: ChallengeCategory;
  makeMode?: ChallengeMakeMode;
}): PublicChallenge {
  const result: PublicChallenge = {
    challengeDate: doc.challengeDate,
    slug: doc.slug,
    title: doc.title,
    prompt: doc.prompt,
    tokenBudget: doc.tokenBudget,
    category: doc.category,
  };
  if (doc.timeLimitMinutes != null) {
    result.timeLimitMinutes = doc.timeLimitMinutes;
  }
  if (doc.makeMode === "e2b" || doc.makeMode === "serverless") {
    result.makeMode = doc.makeMode;
  }
  return result;
}

export async function getTodayChallenge(): Promise<PublicChallenge | null> {
  const Challenge = getPlayChallengeModel();
  const periodKey = getCurrentPeriodKey();
  const doc = await Challenge.findOne({
    challengeDate: periodKey,
    status: "published",
  }).lean();

  if (!doc) {
    return null;
  }

  const challenge = toPublicChallenge(doc as PublicChallenge);
  challenge.cadence = getPlayChallengeCadence();
  challenge.periodEndsAt = endOfChallengePeriod(periodKey).toISOString();
  return challenge;
}

export type PastChallengeSummary = {
  slug: string;
  title: string;
  challengeDate: string;
  category: ChallengeCategory;
  submissionCount: number;
  /** True for the current period's challenge. */
  isCurrent: boolean;
};

/**
 * Published challenges up to and including the current period, newest first,
 * with per-round submission counts. Public — powers the archive view.
 */
export async function listPastChallenges(
  options: { limit?: number } = {},
): Promise<{ challenges: PastChallengeSummary[]; total: number }> {
  const Challenge = getPlayChallengeModel();
  const limit = Math.min(Math.max(options.limit ?? 52, 1), 200);
  const currentKey = getCurrentPeriodKey();

  const filter = {
    status: "published",
    challengeDate: { $lte: currentKey },
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
  if (patch.timeLimitMinutes !== undefined) {
    existing.timeLimitMinutes = patch.timeLimitMinutes;
  }
  if (patch.category !== undefined) {
    existing.category = patch.category;
  }
  if (patch.status !== undefined) {
    existing.status = patch.status;
  }
  if (patch.makeMode !== undefined) {
    // Empty string from the form clears the override (back to env default).
    existing.makeMode = patch.makeMode || undefined;
  }

  await existing.save();
  return existing.toObject();
}
