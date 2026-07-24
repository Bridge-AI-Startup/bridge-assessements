import createHttpError from "http-errors";
import { Types } from "mongoose";
import { getPlaySubmissionModel } from "../../models/play/submission.js";
import {
  getPlayVoteModel,
  getPlayVoteRoundModel,
} from "../../models/play/vote.js";
import {
  isProvisional,
  MAX_WEIGHTED_VOTES_PER_DAY,
  pairInformationValue,
  pairKeyFor,
  publicScoreFrom,
  rankingScoreFrom,
  updateRatings1v1,
  VOTE_ROUND_SIZE,
} from "./bayesianRating.js";
import {
  getCurrentPeriodKey,
  getPlayChallengeCadence,
} from "./challengePeriod.js";
import { getPlayPreviewRevision } from "./preview.js";
import { filterPlayPublicFiles } from "./sandbox.js";

type LeanSubmission = {
  _id: Types.ObjectId;
  anonymousId: string;
  displayName: string;
  challengeSlug: string;
  challengeDate: string;
  fileCount: number;
  totalBytes: number;
  submittedAt: Date;
  ratingMean?: number;
  ratingDeviation?: number;
  rankingScore?: number;
  wins?: number;
  losses?: number;
  matches?: number;
  files?: Array<{ path: string; content: string }>;
};

export type PublicSubmissionSummary = {
  id: string;
  displayName: string;
  challengeSlug: string;
  challengeDate: string;
  fileCount: number;
  totalBytes: number;
  submittedAt: string;
  previewRevision: string;
  score: number;
  wins: number;
  losses: number;
  matches: number;
  provisional: boolean;
  rank?: number;
  isMine?: boolean;
};

export type PublicSubmissionDetail = PublicSubmissionSummary & {
  files?: Array<{ path: string; content: string }>;
};

export type RoundProgress = {
  votesInRound: number;
  roundSize: number;
  votesToday: number;
  maxVotes: number;
  roundIndex: number;
  remainingWeightedVotes: number;
};

export type VoteCard = {
  id: string;
  displayName: string;
  score: number;
  wins: number;
  losses: number;
  matches: number;
  provisional: boolean;
  previewRevision: string;
  files?: Array<{ path: string; content: string }>;
};

export type VoteNextResult =
  | {
      pairAvailable: true;
      challengeDate: string;
      left: VoteCard;
      right: VoteCard;
      round: RoundProgress;
      canVote: true;
      pairsRemaining: number;
      allPairsComplete: false;
      canContinue: true;
    }
  | {
      pairAvailable: false;
      challengeDate: string;
      reason:
        | "must_submit"
        | "not_enough_submissions"
        | "no_pairs_left"
        | "vote_cap_reached";
      message: string;
      round: RoundProgress;
      canVote: boolean;
      pairsRemaining: number;
      allPairsComplete: boolean;
      canContinue: boolean;
    };

export type RoundRecapMovement = {
  id: string;
  displayName: string;
  beforeRank: number | null;
  afterRank: number | null;
  beforeScore: number | null;
  afterScore: number;
  deltaRank: number | null;
};

export type RoundRecap = {
  roundIndex: number;
  choices: Array<{
    winnerId: string;
    winnerName: string;
    loserId: string;
    loserName: string;
  }>;
  movements: RoundRecapMovement[];
  biggestMover: RoundRecapMovement | null;
};

export type CastVoteResult = {
  recorded: true;
  challengeDate: string;
  round: RoundProgress;
  pairAvailable: boolean;
  left?: VoteCard;
  right?: VoteCard;
  recap?: RoundRecap;
  pairsRemaining: number;
  allPairsComplete: boolean;
  canContinue: boolean;
};

function ensureRating(doc: LeanSubmission) {
  const ratingMean = doc.ratingMean ?? 25;
  const ratingDeviation = doc.ratingDeviation ?? 25 / 3;
  const rankingScore =
    doc.rankingScore ?? rankingScoreFrom(ratingMean, ratingDeviation);
  const wins = doc.wins ?? 0;
  const losses = doc.losses ?? 0;
  const matches = doc.matches ?? 0;
  return { ratingMean, ratingDeviation, rankingScore, wins, losses, matches };
}

function toPublicSummary(
  doc: LeanSubmission,
  opts: { rank?: number; anonymousId?: string } = {},
): PublicSubmissionSummary {
  const r = ensureRating(doc);
  return {
    id: String(doc._id),
    displayName: doc.displayName,
    challengeSlug: doc.challengeSlug,
    challengeDate: doc.challengeDate,
    fileCount: doc.fileCount,
    totalBytes: doc.totalBytes,
    submittedAt: new Date(doc.submittedAt).toISOString(),
    previewRevision: getPlayPreviewRevision(doc.submittedAt),
    score: publicScoreFrom(r.rankingScore),
    wins: r.wins,
    losses: r.losses,
    matches: r.matches,
    provisional: isProvisional(r.matches),
    ...(opts.rank != null ? { rank: opts.rank } : {}),
    ...(opts.anonymousId
      ? { isMine: doc.anonymousId === opts.anonymousId }
      : {}),
  };
}

function toVoteCard(
  doc: LeanSubmission,
  includeFiles = true,
): VoteCard {
  const r = ensureRating(doc);
  const card: VoteCard = {
    id: String(doc._id),
    displayName: doc.displayName,
    score: publicScoreFrom(r.rankingScore),
    wins: r.wins,
    losses: r.losses,
    matches: r.matches,
    provisional: isProvisional(r.matches),
    previewRevision: getPlayPreviewRevision(doc.submittedAt),
  };
  if (includeFiles) {
    card.files = filterPlayPublicFiles(doc.files || []).map((f) => ({
      path: f.path,
      content: f.content,
    }));
  }
  return card;
}

async function countVotesToday(
  anonymousId: string,
  challengeDate: string,
): Promise<number> {
  const Vote = getPlayVoteModel();
  return Vote.countDocuments({ anonymousId, challengeDate });
}

async function findOwnSubmission(
  anonymousId: string,
  challengeDate: string,
): Promise<LeanSubmission | null> {
  const Submission = getPlaySubmissionModel();
  return (await Submission.findOne({ anonymousId, challengeDate }).lean()) as
    | LeanSubmission
    | null;
}

async function loadRankedForDate(
  challengeDate: string,
): Promise<LeanSubmission[]> {
  const Submission = getPlaySubmissionModel();
  const docs = (await Submission.find({ challengeDate })
    .select(
      "anonymousId displayName challengeSlug challengeDate fileCount totalBytes submittedAt ratingMean ratingDeviation rankingScore wins losses matches",
    )
    .lean()) as LeanSubmission[];

  // Backfill rating fields for submissions created before ranking shipped.
  const toFix: Promise<unknown>[] = [];
  for (const doc of docs) {
    if (
      doc.ratingMean == null ||
      doc.ratingDeviation == null ||
      doc.rankingScore == null
    ) {
      const ratingMean = doc.ratingMean ?? 25;
      const ratingDeviation = doc.ratingDeviation ?? 25 / 3;
      const rankingScore = rankingScoreFrom(ratingMean, ratingDeviation);
      doc.ratingMean = ratingMean;
      doc.ratingDeviation = ratingDeviation;
      doc.rankingScore = rankingScore;
      doc.wins = doc.wins ?? 0;
      doc.losses = doc.losses ?? 0;
      doc.matches = doc.matches ?? 0;
      toFix.push(
        Submission.updateOne(
          { _id: doc._id },
          {
            $set: {
              ratingMean,
              ratingDeviation,
              rankingScore,
              wins: doc.wins,
              losses: doc.losses,
              matches: doc.matches,
            },
          },
        ),
      );
    }
  }
  if (toFix.length) {
    await Promise.all(toFix);
  }

  docs.sort((a, b) => {
    const ra = ensureRating(a);
    const rb = ensureRating(b);
    if (rb.rankingScore !== ra.rankingScore) {
      return rb.rankingScore - ra.rankingScore;
    }
    if (rb.wins !== ra.wins) return rb.wins - ra.wins;
    return (
      new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    );
  });

  return docs;
}

function buildRoundProgress(
  votesToday: number,
): RoundProgress {
  const votesInRound = votesToday % VOTE_ROUND_SIZE;
  return {
    votesInRound,
    roundSize: VOTE_ROUND_SIZE,
    votesToday,
    maxVotes: MAX_WEIGHTED_VOTES_PER_DAY,
    roundIndex: Math.floor(votesToday / VOTE_ROUND_SIZE),
    remainingWeightedVotes: Math.max(
      0,
      MAX_WEIGHTED_VOTES_PER_DAY - votesToday,
    ),
  };
}

function unavailableVotePair(input: {
  challengeDate: string;
  reason: Extract<VoteNextResult, { pairAvailable: false }>["reason"];
  message: string;
  round: RoundProgress;
  canVote: boolean;
  pairsRemaining?: number;
  allPairsComplete?: boolean;
}): VoteNextResult {
  return {
    pairAvailable: false,
    challengeDate: input.challengeDate,
    reason: input.reason,
    message: input.message,
    round: input.round,
    canVote: input.canVote,
    pairsRemaining: input.pairsRemaining ?? 0,
    allPairsComplete: input.allPairsComplete ?? false,
    canContinue: false,
  };
}

async function ensureRoundSnapshot(input: {
  anonymousId: string;
  challengeDate: string;
  votesToday: number;
}): Promise<void> {
  // Snapshot only at the start of a round (before any votes in that round).
  if (input.votesToday % VOTE_ROUND_SIZE !== 0) return;
  if (input.votesToday >= MAX_WEIGHTED_VOTES_PER_DAY) return;

  const roundIndex = Math.floor(input.votesToday / VOTE_ROUND_SIZE);
  const VoteRound = getPlayVoteRoundModel();
  const existing = await VoteRound.findOne({
    anonymousId: input.anonymousId,
    challengeDate: input.challengeDate,
    roundIndex,
  });
  if (existing) return;

  const ranked = await loadRankedForDate(input.challengeDate);
  const rankSnapshot = new Map<
    string,
    { rank: number; score: number; displayName: string }
  >();
  ranked.forEach((doc, i) => {
    const r = ensureRating(doc);
    rankSnapshot.set(String(doc._id), {
      rank: i + 1,
      score: publicScoreFrom(r.rankingScore),
      displayName: doc.displayName,
    });
  });

  await VoteRound.create({
    anonymousId: input.anonymousId,
    challengeDate: input.challengeDate,
    roundIndex,
    rankSnapshot,
    seenSubmissionIds: [],
    votesInRound: 0,
    completed: false,
  });
}

async function selectPair(input: {
  anonymousId: string;
  challengeDate: string;
  preferId?: string;
  includeFiles?: boolean;
}): Promise<[LeanSubmission, LeanSubmission] | null> {
  const Submission = getPlaySubmissionModel();
  const Vote = getPlayVoteModel();
  const includeFiles = input.includeFiles !== false;

  const selectFields = includeFiles
    ? "anonymousId displayName challengeSlug challengeDate fileCount totalBytes submittedAt ratingMean ratingDeviation rankingScore wins losses matches files"
    : "anonymousId displayName challengeSlug challengeDate fileCount totalBytes submittedAt ratingMean ratingDeviation rankingScore wins losses matches";

  const candidates = (await Submission.find({
    challengeDate: input.challengeDate,
    anonymousId: { $ne: input.anonymousId },
  })
    .select(selectFields)
    .lean()) as LeanSubmission[];

  if (candidates.length < 2) return null;

  const prior = await Vote.find({
    anonymousId: input.anonymousId,
    challengeDate: input.challengeDate,
  })
    .select("pairKey")
    .lean();
  const seen = new Set(prior.map((v) => v.pairKey as string));

  type Cand = LeanSubmission & {
    ratingMean: number;
    ratingDeviation: number;
    matches: number;
  };
  const scored = candidates.map((c) => {
    const r = ensureRating(c);
    return { ...c, ...r };
  }) as Cand[];

  let best: { a: Cand; b: Cand; value: number } | null = null;

  for (let i = 0; i < scored.length; i++) {
    for (let j = i + 1; j < scored.length; j++) {
      const a = scored[i];
      const b = scored[j];
      const key = pairKeyFor(String(a._id), String(b._id));
      if (seen.has(key)) continue;

      let value = pairInformationValue(a, b);
      if (input.preferId) {
        if (
          String(a._id) === input.preferId ||
          String(b._id) === input.preferId
        ) {
          value += 5;
        }
      }
      if (!best || value > best.value) {
        best = { a, b, value };
      }
    }
  }

  if (!best) return null;

  // Randomize left/right presentation.
  if (Math.random() < 0.5) {
    return [best.a, best.b];
  }
  return [best.b, best.a];
}

/** Count unique opponent pairs this voter has not yet compared. */
async function countRemainingPairs(input: {
  anonymousId: string;
  challengeDate: string;
}): Promise<number> {
  const Submission = getPlaySubmissionModel();
  const Vote = getPlayVoteModel();

  const candidates = await Submission.find({
    challengeDate: input.challengeDate,
    anonymousId: { $ne: input.anonymousId },
  })
    .select("_id")
    .lean();

  if (candidates.length < 2) return 0;

  const prior = await Vote.find({
    anonymousId: input.anonymousId,
    challengeDate: input.challengeDate,
  })
    .select("pairKey")
    .lean();
  const seen = new Set(prior.map((v) => v.pairKey as string));

  let remaining = 0;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const key = pairKeyFor(String(candidates[i]._id), String(candidates[j]._id));
      if (!seen.has(key)) remaining += 1;
    }
  }
  return remaining;
}

export async function listPublicSubmissions(options: {
  challengeDate?: string;
  limit?: number;
  anonymousId?: string;
}): Promise<{
  challengeDate: string;
  submissions: PublicSubmissionSummary[];
  total: number;
}> {
  const challengeDate = options.challengeDate || getCurrentPeriodKey();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const ranked = await loadRankedForDate(challengeDate);

  return {
    challengeDate,
    total: ranked.length,
    submissions: ranked.slice(0, limit).map((doc, i) =>
      toPublicSummary(doc, {
        rank: i + 1,
        anonymousId: options.anonymousId,
      }),
    ),
  };
}

export async function getPublicSubmissionById(
  id: string,
  anonymousId?: string,
  options: { includeFiles?: boolean } = {},
): Promise<PublicSubmissionDetail> {
  if (!Types.ObjectId.isValid(id)) {
    throw createHttpError(400, "invalid submission id");
  }
  const includeFiles = options.includeFiles !== false;
  const Submission = getPlaySubmissionModel();
  const selectFields = includeFiles
    ? undefined
    : "anonymousId displayName challengeSlug challengeDate fileCount totalBytes submittedAt ratingMean ratingDeviation rankingScore wins losses matches";
  const doc = (await (includeFiles
    ? Submission.findById(id)
    : Submission.findById(id).select(selectFields!)
  ).lean()) as LeanSubmission | null;
  if (!doc) {
    throw createHttpError(404, "submission_not_found");
  }

  const ranked = await loadRankedForDate(doc.challengeDate);
  const rank =
    ranked.findIndex((d) => String(d._id) === String(doc._id)) + 1 || undefined;

  const detail: PublicSubmissionDetail = {
    ...toPublicSummary(doc, { rank, anonymousId }),
  };
  if (includeFiles) {
    detail.files = filterPlayPublicFiles(doc.files || []).map((f) => ({
      path: f.path,
      content: f.content,
    }));
  }
  return detail;
}

export async function getLeaderboard(options: {
  challengeDate?: string;
  limit?: number;
  anonymousId?: string;
}): Promise<{
  challengeDate: string;
  entries: PublicSubmissionSummary[];
  total: number;
  you: PublicSubmissionSummary | null;
}> {
  const challengeDate = options.challengeDate || getCurrentPeriodKey();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const ranked = await loadRankedForDate(challengeDate);
  const entries = ranked.slice(0, limit).map((doc, i) =>
    toPublicSummary(doc, {
      rank: i + 1,
      anonymousId: options.anonymousId,
    }),
  );

  let you: PublicSubmissionSummary | null = null;
  if (options.anonymousId) {
    const idx = ranked.findIndex(
      (d) => d.anonymousId === options.anonymousId,
    );
    if (idx >= 0) {
      you = toPublicSummary(ranked[idx], {
        rank: idx + 1,
        anonymousId: options.anonymousId,
      });
    }
  }

  return {
    challengeDate,
    entries,
    total: ranked.length,
    you,
  };
}

export async function getNextVotePair(input: {
  anonymousId: string;
  challengeDate?: string;
  preferId?: string;
  includeFiles?: boolean;
}): Promise<VoteNextResult> {
  const anonymousId = input.anonymousId.trim();
  if (!anonymousId) {
    throw createHttpError(400, "anonymousId is required");
  }
  const includeFiles = input.includeFiles !== false;
  const challengeDate = input.challengeDate || getCurrentPeriodKey();
  const votesToday = await countVotesToday(anonymousId, challengeDate);
  const round = buildRoundProgress(votesToday);

  const own = await findOwnSubmission(anonymousId, challengeDate);
  if (!own) {
    const weekly = getPlayChallengeCadence() === "weekly";
    return unavailableVotePair({
      challengeDate,
      reason: "must_submit",
      message: weekly
        ? "Submit this week's build before voting."
        : "Submit today's build before voting.",
      round,
      canVote: false,
    });
  }

  if (votesToday >= MAX_WEIGHTED_VOTES_PER_DAY) {
    const weekly = getPlayChallengeCadence() === "weekly";
    return unavailableVotePair({
      challengeDate,
      reason: "vote_cap_reached",
      message: weekly
        ? `You've completed this week's ${MAX_WEIGHTED_VOTES_PER_DAY} ranking votes. Come back next week.`
        : `You've completed today's ${MAX_WEIGHTED_VOTES_PER_DAY} ranking votes. Come back tomorrow.`,
      round,
      canVote: false,
      pairsRemaining: await countRemainingPairs({ anonymousId, challengeDate }),
    });
  }

  const Submission = getPlaySubmissionModel();
  const others = await Submission.countDocuments({
    challengeDate,
    anonymousId: { $ne: anonymousId },
  });
  if (others < 2) {
    return unavailableVotePair({
      challengeDate,
      reason: "not_enough_submissions",
      message: "Need at least two other builds to start voting. Check back soon.",
      round,
      canVote: true,
    });
  }

  await ensureRoundSnapshot({ anonymousId, challengeDate, votesToday });

  const pairsRemaining = await countRemainingPairs({
    anonymousId,
    challengeDate,
  });
  if (pairsRemaining === 0) {
    return unavailableVotePair({
      challengeDate,
      reason: "no_pairs_left",
      message:
        "You're done for now — you've compared every available matchup. Check back if more people submit.",
      round,
      canVote: false,
      allPairsComplete: true,
    });
  }

  const pair = await selectPair({
    anonymousId,
    challengeDate,
    preferId: input.preferId,
    includeFiles,
  });

  if (!pair) {
    return unavailableVotePair({
      challengeDate,
      reason: "no_pairs_left",
      message:
        "You're done for now — you've compared every available matchup. Check back if more people submit.",
      round,
      canVote: false,
      allPairsComplete: true,
    });
  }

  // Display counter as upcoming vote number in round (1..5).
  const displayRound: RoundProgress = {
    ...round,
    votesInRound: (votesToday % VOTE_ROUND_SIZE) + 1,
  };

  return {
    pairAvailable: true,
    challengeDate,
    left: toVoteCard(pair[0], includeFiles),
    right: toVoteCard(pair[1], includeFiles),
    round: displayRound,
    canVote: true,
    // After this vote is served, remaining includes this pair until cast.
    pairsRemaining,
    allPairsComplete: false,
    canContinue: true,
  };
}

async function buildRecap(input: {
  anonymousId: string;
  challengeDate: string;
  roundIndex: number;
}): Promise<RoundRecap> {
  const Vote = getPlayVoteModel();
  const VoteRound = getPlayVoteRoundModel();
  const Submission = getPlaySubmissionModel();

  const roundDoc = await VoteRound.findOne({
    anonymousId: input.anonymousId,
    challengeDate: input.challengeDate,
    roundIndex: input.roundIndex,
  });

  const votes = await Vote.find({
    anonymousId: input.anonymousId,
    challengeDate: input.challengeDate,
  })
    .sort({ createdAt: 1 })
    .lean();

  const start = input.roundIndex * VOTE_ROUND_SIZE;
  const roundVotes = votes.slice(start, start + VOTE_ROUND_SIZE);

  const idSet = new Set<string>();
  for (const v of roundVotes) {
    idSet.add(String(v.winnerId));
    idSet.add(String(v.loserId));
  }

  const ranked = await loadRankedForDate(input.challengeDate);
  const afterRank = new Map<string, { rank: number; score: number; name: string }>();
  ranked.forEach((doc, i) => {
    const r = ensureRating(doc);
    afterRank.set(String(doc._id), {
      rank: i + 1,
      score: publicScoreFrom(r.rankingScore),
      name: doc.displayName,
    });
  });

  const snapshot =
    roundDoc?.rankSnapshot instanceof Map
      ? roundDoc.rankSnapshot
      : new Map(
          Object.entries(
            (roundDoc?.rankSnapshot as Record<
              string,
              { rank: number; score: number; displayName: string }
            >) || {},
          ),
        );

  const movements: RoundRecapMovement[] = [...idSet].map((id) => {
    const before = snapshot.get?.(id) ?? snapshot.get(id);
    const after = afterRank.get(id);
    const beforeRank = before?.rank ?? null;
    const afterR = after?.rank ?? null;
    return {
      id,
      displayName: after?.name || before?.displayName || "Unknown",
      beforeRank,
      afterRank: afterR,
      beforeScore: before?.score ?? null,
      afterScore: after?.score ?? 0,
      deltaRank:
        beforeRank != null && afterR != null ? beforeRank - afterR : null,
    };
  });

  movements.sort((a, b) => {
    const da = Math.abs(a.deltaRank ?? 0);
    const db = Math.abs(b.deltaRank ?? 0);
    return db - da;
  });

  const nameById = new Map<string, string>();
  for (const m of movements) nameById.set(m.id, m.displayName);
  // Fill any missing names from DB
  const missing = [...idSet].filter((id) => !nameById.has(id));
  if (missing.length) {
    const docs = await Submission.find({
      _id: { $in: missing.map((id) => new Types.ObjectId(id)) },
    })
      .select("displayName")
      .lean();
    for (const d of docs) {
      nameById.set(String(d._id), d.displayName);
    }
  }

  const choices = roundVotes.map((v) => ({
    winnerId: String(v.winnerId),
    winnerName: nameById.get(String(v.winnerId)) || "Unknown",
    loserId: String(v.loserId),
    loserName: nameById.get(String(v.loserId)) || "Unknown",
  }));

  if (roundDoc) {
    roundDoc.completed = true;
    roundDoc.votesInRound = VOTE_ROUND_SIZE;
    roundDoc.seenSubmissionIds = [...idSet];
    await roundDoc.save();
  }

  return {
    roundIndex: input.roundIndex,
    choices,
    movements,
    biggestMover: movements.find((m) => (m.deltaRank ?? 0) !== 0) || null,
  };
}

export async function castVote(input: {
  anonymousId: string;
  challengeDate?: string;
  winnerId: string;
  loserId: string;
  includeFiles?: boolean;
}): Promise<CastVoteResult> {
  const anonymousId = input.anonymousId.trim();
  const winnerId = input.winnerId.trim();
  const loserId = input.loserId.trim();
  const includeFiles = input.includeFiles !== false;
  if (!anonymousId) {
    throw createHttpError(400, "anonymousId is required");
  }
  if (
    !Types.ObjectId.isValid(winnerId) ||
    !Types.ObjectId.isValid(loserId) ||
    winnerId === loserId
  ) {
    throw createHttpError(400, "invalid winner/loser");
  }

  const challengeDate = input.challengeDate || getCurrentPeriodKey();
  const votesToday = await countVotesToday(anonymousId, challengeDate);

  const own = await findOwnSubmission(anonymousId, challengeDate);
  if (!own) {
    throw createHttpError(403, "must_submit");
  }
  if (votesToday >= MAX_WEIGHTED_VOTES_PER_DAY) {
    throw createHttpError(429, "vote_cap_reached");
  }
  if (
    String(own._id) === winnerId ||
    String(own._id) === loserId
  ) {
    throw createHttpError(400, "cannot_vote_own");
  }

  const Submission = getPlaySubmissionModel();
  const Vote = getPlayVoteModel();

  const [winner, loser] = await Promise.all([
    Submission.findById(winnerId),
    Submission.findById(loserId),
  ]);
  if (!winner || !loser) {
    throw createHttpError(404, "submission_not_found");
  }
  if (
    winner.challengeDate !== challengeDate ||
    loser.challengeDate !== challengeDate
  ) {
    throw createHttpError(400, "challenge_date_mismatch");
  }

  const key = pairKeyFor(winnerId, loserId);
  try {
    await Vote.create({
      anonymousId,
      challengeDate,
      winnerId: winner._id,
      loserId: loser._id,
      pairKey: key,
    });
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: number }).code
        : undefined;
    if (code === 11000) {
      throw createHttpError(409, "already_voted_pair");
    }
    throw err;
  }

  await ensureRoundSnapshot({ anonymousId, challengeDate, votesToday });

  const updated = updateRatings1v1(
    {
      ratingMean: winner.ratingMean ?? 25,
      ratingDeviation: winner.ratingDeviation ?? 25 / 3,
    },
    {
      ratingMean: loser.ratingMean ?? 25,
      ratingDeviation: loser.ratingDeviation ?? 25 / 3,
    },
  );

  winner.ratingMean = updated.winner.ratingMean;
  winner.ratingDeviation = updated.winner.ratingDeviation;
  winner.rankingScore = rankingScoreFrom(
    updated.winner.ratingMean,
    updated.winner.ratingDeviation,
  );
  winner.wins = (winner.wins ?? 0) + 1;
  winner.matches = (winner.matches ?? 0) + 1;

  loser.ratingMean = updated.loser.ratingMean;
  loser.ratingDeviation = updated.loser.ratingDeviation;
  loser.rankingScore = rankingScoreFrom(
    updated.loser.ratingMean,
    updated.loser.ratingDeviation,
  );
  loser.losses = (loser.losses ?? 0) + 1;
  loser.matches = (loser.matches ?? 0) + 1;

  await Promise.all([winner.save(), loser.save()]);

  const VoteRound = getPlayVoteRoundModel();
  const roundIndex = Math.floor(votesToday / VOTE_ROUND_SIZE);
  await VoteRound.updateOne(
    { anonymousId, challengeDate, roundIndex },
    {
      $inc: { votesInRound: 1 },
      $addToSet: {
        seenSubmissionIds: { $each: [winnerId, loserId] },
      },
    },
  );

  const newVotesToday = votesToday + 1;
  const roundComplete = newVotesToday % VOTE_ROUND_SIZE === 0;
  let round = buildRoundProgress(newVotesToday);
  if (roundComplete) {
    // Present as 5/5 completed for the recap UI.
    round = {
      ...round,
      votesInRound: VOTE_ROUND_SIZE,
      roundIndex: Math.floor((newVotesToday - 1) / VOTE_ROUND_SIZE),
    };
  }

  const pairsRemaining = await countRemainingPairs({
    anonymousId,
    challengeDate,
  });
  const allPairsComplete = pairsRemaining === 0;
  const underCap = newVotesToday < MAX_WEIGHTED_VOTES_PER_DAY;
  const canContinue = underCap && !allPairsComplete;

  let recap: RoundRecap | undefined;
  // Full round, last unique pair mid-round, or daily vote cap → show recap.
  const shouldRecap =
    roundComplete || allPairsComplete || !underCap;
  if (shouldRecap) {
    if (!roundComplete && allPairsComplete) {
      // Partial final round: show how many votes landed in this round.
      const votesInPartial = (votesToday % VOTE_ROUND_SIZE) + 1;
      round = {
        ...round,
        votesInRound: votesInPartial,
        roundIndex,
      };
    }
    recap = await buildRecap({
      anonymousId,
      challengeDate,
      roundIndex,
    });
  }

  if (shouldRecap) {
    return {
      recorded: true,
      challengeDate,
      round,
      pairAvailable: false,
      recap,
      pairsRemaining,
      allPairsComplete,
      canContinue,
    };
  }

  const next = await getNextVotePair({
    anonymousId,
    challengeDate,
    includeFiles,
  });
  if (next.pairAvailable) {
    return {
      recorded: true,
      challengeDate,
      round: next.round,
      pairAvailable: true,
      left: next.left,
      right: next.right,
      pairsRemaining: next.pairsRemaining,
      allPairsComplete: false,
      canContinue: true,
    };
  }

  return {
    recorded: true,
    challengeDate,
    round,
    pairAvailable: false,
    pairsRemaining: next.pairsRemaining,
    allPairsComplete: next.allPairsComplete,
    canContinue: next.canContinue,
  };
}
