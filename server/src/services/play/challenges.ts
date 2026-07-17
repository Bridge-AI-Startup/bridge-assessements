import createHttpError from "http-errors";
import {
  CHALLENGE_CATEGORIES,
  CHALLENGE_STATUSES,
  getPlayChallengeModel,
} from "../../models/play/challenge.js";

import {
  endOfChallengePeriod,
  getCurrentPeriodKey,
  getPlayChallengeCadence,
} from "./challengePeriod.js";

export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

export type PublicChallenge = {
  challengeDate: string;
  slug: string;
  title: string;
  prompt: string;
  tokenBudget: number;
  timeLimitMinutes?: number;
  category: ChallengeCategory;
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

  await existing.save();
  return existing.toObject();
}
