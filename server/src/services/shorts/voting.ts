import createHttpError from "http-errors";
import { Types } from "mongoose";
import { getPlaySubmissionModel } from "../../models/shorts/submission.js";
import {
  getPlayVoteModel,
  getPlayVoteRoundModel,
} from "../../models/shorts/vote.js";
import {
  isProvisional,
  pairInformationValue,
  pairKeyFor,
  publicScoreFrom,
  rankingScoreFrom,
  updateRatings1v1,
  VOTE_ROUND_SIZE,
} from "./bayesianRating.js";
import { getActiveChallengeDate } from "./challenges.js";
import { getPlayPreviewRevision } from "./preview.js";
import { filterPlayPublicFiles } from "./sandbox.js";

type LeanSubmission = {
  _id: Types.ObjectId;
  anonymousId: string;
  firebaseUid?: string;
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
      /** False for a voter who has not submitted: they play, nothing moves. */
      weighted: boolean;
      pairsRemaining: number;
      allPairsComplete: false;
      canContinue: true;
    }
  | {
      pairAvailable: false;
      challengeDate: string;
      reason:
        // Retired: anyone may play now. Kept in the union so an older client
        // that still branches on it keeps type-checking.
        | "must_submit"
        | "not_enough_submissions"
        | "no_pairs_left"
        // Retired: there is no vote-count budget. Voting stops when every
        // unique pair is seen (`no_pairs_left`) and resumes when a new build
        // creates unseen combinations. Kept so an older client still type-checks.
        | "vote_cap_reached";
      message: string;
      round: RoundProgress;
      canVote: boolean;
      weighted: boolean;
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
  /** False when the voter had not submitted: the vote is stored and inert. */
  weighted: boolean;
  /** This pick closed a five-pick round. Unweighted rounds carry no recap. */
  roundComplete: boolean;
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
  opts: { rank?: number; anonymousId?: string; firebaseUid?: string } = {},
): PublicSubmissionSummary {
  const r = ensureRating(doc);
  const isMine = Boolean(
    (opts.anonymousId && doc.anonymousId === opts.anonymousId) ||
      (opts.firebaseUid &&
        doc.firebaseUid &&
        doc.firebaseUid === opts.firebaseUid),
  );
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
    ...(opts.anonymousId || opts.firebaseUid ? { isMine } : {}),
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

/**
 * Weighted votes only. This drives the recap round index — an unweighted play
 * must never advance a ranking recap.
 *
 * Deliberately NOT the same question as "which pairs has this person seen":
 * pair exhaustion counts every vote regardless of weight (see
 * `countRemainingPairs` / `selectPair`), or a non-submitter would be served the
 * same matchup forever and then collide with the unique pairKey index.
 */
async function countVotesToday(
  anonymousId: string,
  challengeDate: string,
): Promise<number> {
  const Vote = getPlayVoteModel();
  return Vote.countDocuments({
    anonymousId,
    challengeDate,
    weighted: { $ne: false },
  });
}

/** Every pick this person made, weighted or not. Their play counter. */
async function countPlayedVotesToday(
  anonymousId: string,
  challengeDate: string,
): Promise<number> {
  const Vote = getPlayVoteModel();
  return Vote.countDocuments({ anonymousId, challengeDate });
}

/**
 * Every vote currently moves the ratings — submitters and spectators alike.
 * Early rounds need vote volume (both for the ranking and as data to collect)
 * more than they need gate-keeping, so the submit gate on weighting is
 * switched off. The weighted/unweighted mechanism stays fully wired:
 * `weighted` is still stamped on every vote document, historical
 * `weighted: false` votes stay inert everywhere they are counted, and
 * restoring the gate is flipping this to `false` — the `hasSubmitted` check
 * below takes over again.
 */
const EVERY_VOTE_IS_WEIGHTED = true;

/**
 * Has this builder entered at least one build for the challenge? Decides
 * whether their votes move the ratings — not whether they may vote at all.
 * Deliberately not "which submission is theirs" — a builder may have several.
 * Currently bypassed by `EVERY_VOTE_IS_WEIGHTED`.
 */
async function hasSubmitted(
  anonymousId: string,
  challengeDate: string,
): Promise<boolean> {
  const Submission = getPlaySubmissionModel();
  return (await Submission.exists({ anonymousId, challengeDate })) !== null;
}

async function loadRankedForDate(
  challengeDate: string,
): Promise<LeanSubmission[]> {
  const Submission = getPlaySubmissionModel();
  const docs = (await Submission.find({ challengeDate })
    .select(
      "anonymousId firebaseUid displayName challengeSlug challengeDate fileCount totalBytes submittedAt ratingMean ratingDeviation rankingScore wins losses matches",
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

/**
 * `votesToday` is the counter the round meter shows — weighted votes for a
 * submitter, plain plays for everyone else. There is no vote-count budget:
 * `maxVotes` / `remainingWeightedVotes` describe unique unseen matchups
 * (`pairsRemaining`), so a new submission that creates combinations raises
 * the ceiling instead of waiting for the next period.
 */
function buildRoundProgress(
  votesToday: number,
  pairsRemaining: number = 0,
): RoundProgress {
  const votesInRound = votesToday % VOTE_ROUND_SIZE;
  return {
    votesInRound,
    roundSize: VOTE_ROUND_SIZE,
    votesToday,
    maxVotes: votesToday + pairsRemaining,
    roundIndex: Math.floor(votesToday / VOTE_ROUND_SIZE),
    remainingWeightedVotes: pairsRemaining,
  };
}

function unavailableVotePair(input: {
  challengeDate: string;
  reason: Extract<VoteNextResult, { pairAvailable: false }>["reason"];
  message: string;
  round: RoundProgress;
  canVote: boolean;
  weighted: boolean;
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
    weighted: input.weighted,
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

  // The pair scan is O(n²) over every candidate, so it never loads file
  // contents — only the two entries actually shown fetch their files, below.
  const candidates = (await Submission.find({
    challengeDate: input.challengeDate,
    anonymousId: { $ne: input.anonymousId },
  })
    .select(
      "anonymousId firebaseUid displayName challengeSlug challengeDate fileCount totalBytes submittedAt ratingMean ratingDeviation rankingScore wins losses matches",
    )
    .lean()) as LeanSubmission[];

  if (candidates.length < 2) return null;

  // Deliberately NOT filtered by `weighted`: an unweighted play still burns
  // its pair (the unique {anonymousId, challengeDate, pairKey} index says so),
  // so filtering here would re-serve the same matchup until it 409s.
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
  const ordered: [LeanSubmission, LeanSubmission] =
    Math.random() < 0.5 ? [best.a, best.b] : [best.b, best.a];

  if (!includeFiles) return ordered;

  const withFiles = await Submission.find({
    _id: { $in: ordered.map((c) => c._id) },
  })
    .select("files")
    .lean();
  const filesById = new Map<string, Array<{ path: string; content: string }>>(
    withFiles.map((d) => [
      String(d._id),
      (d.files || []) as Array<{ path: string; content: string }>,
    ]),
  );

  return ordered.map((c) => ({
    ...c,
    files: filesById.get(String(c._id)) || [],
  })) as [LeanSubmission, LeanSubmission];
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

  // Weight-blind on purpose — see the same note in `selectPair`.
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
  mine: PublicSubmissionSummary[];
}> {
  const challengeDate = options.challengeDate || (await getActiveChallengeDate());
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const ranked = await loadRankedForDate(challengeDate);

  // Returned separately from the (limited) page so a builder always finds all
  // of their own entries, even when they fall outside the first `limit` rows.
  const mine = options.anonymousId
    ? ranked
        .map((doc, i) => ({ doc, rank: i + 1 }))
        .filter(({ doc }) => doc.anonymousId === options.anonymousId)
        .map(({ doc, rank }) =>
          toPublicSummary(doc, { rank, anonymousId: options.anonymousId }),
        )
    : [];

  return {
    challengeDate,
    total: ranked.length,
    submissions: ranked.slice(0, limit).map((doc, i) =>
      toPublicSummary(doc, {
        rank: i + 1,
        anonymousId: options.anonymousId,
      }),
    ),
    mine,
  };
}

/**
 * Every submission belonging to any of `anonymousIds` — plus any submitted
 * while signed in as `firebaseUid` — newest round first, each with its rank
 * within its round. Powers the account "My submissions" view, so it must work
 * across challenge dates (unlike the gallery).
 *
 * The uid arm is what makes an account-attributed build survive a browser id
 * that is never linked again (cleared storage, a different device).
 */
export async function listOwnerSubmissions(
  anonymousIds: string[],
  firebaseUid?: string | null,
): Promise<PublicSubmissionSummary[]> {
  const ids = [...new Set(anonymousIds.map((s) => s.trim()).filter(Boolean))];
  const uid = firebaseUid?.trim() || null;
  if (ids.length === 0 && !uid) return [];

  const ownerClauses: Array<Record<string, unknown>> = [];
  if (ids.length) ownerClauses.push({ anonymousId: { $in: ids } });
  if (uid) ownerClauses.push({ firebaseUid: uid });

  const Submission = getPlaySubmissionModel();
  const own = (await Submission.find(
    ownerClauses.length === 1 ? ownerClauses[0] : { $or: ownerClauses },
  )
    .select(
      "anonymousId firebaseUid displayName challengeSlug challengeDate fileCount totalBytes submittedAt ratingMean ratingDeviation rankingScore wins losses matches",
    )
    .lean()) as LeanSubmission[];
  if (own.length === 0) return [];

  // Rank each submission within its round; one ranked load per distinct date.
  const dates = [...new Set(own.map((d) => d.challengeDate))];
  const rankById = new Map<string, number>();
  for (const date of dates) {
    const ranked = await loadRankedForDate(date);
    ranked.forEach((doc, i) => rankById.set(String(doc._id), i + 1));
  }

  own.sort((a, b) => {
    if (a.challengeDate !== b.challengeDate) {
      return a.challengeDate < b.challengeDate ? 1 : -1;
    }
    return (
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  });

  return own.map((doc) => ({
    ...toPublicSummary(doc, { rank: rankById.get(String(doc._id)) }),
    isMine: true,
  }));
}

/**
 * Public summaries for an explicit id list (the saved/starred list). Preserves
 * the caller's id order, silently drops ids whose submission no longer exists,
 * and ranks each entry within its own round.
 */
export async function listSubmissionSummariesByIds(
  ids: string[],
  viewer: { anonymousId?: string; firebaseUid?: string | null } = {},
): Promise<PublicSubmissionSummary[]> {
  const validIds = [
    ...new Set(ids.filter((id) => Types.ObjectId.isValid(id))),
  ];
  if (validIds.length === 0) return [];

  const Submission = getPlaySubmissionModel();
  const docs = (await Submission.find({ _id: { $in: validIds } })
    .select(
      "anonymousId firebaseUid displayName challengeSlug challengeDate fileCount totalBytes submittedAt ratingMean ratingDeviation rankingScore wins losses matches",
    )
    .lean()) as LeanSubmission[];
  if (docs.length === 0) return [];

  const dates = [...new Set(docs.map((d) => d.challengeDate))];
  const rankById = new Map<string, number>();
  for (const date of dates) {
    const ranked = await loadRankedForDate(date);
    ranked.forEach((doc, i) => rankById.set(String(doc._id), i + 1));
  }

  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const out: PublicSubmissionSummary[] = [];
  for (const id of validIds) {
    const doc = byId.get(id);
    if (!doc) continue;
    out.push(
      toPublicSummary(doc, {
        rank: rankById.get(id),
        anonymousId: viewer.anonymousId,
        firebaseUid: viewer.firebaseUid || undefined,
      }),
    );
  }
  return out;
}

export async function getPublicSubmissionById(
  id: string,
  anonymousId?: string,
  options: { includeFiles?: boolean; firebaseUid?: string } = {},
): Promise<PublicSubmissionDetail> {
  if (!Types.ObjectId.isValid(id)) {
    throw createHttpError(400, "invalid submission id");
  }
  const includeFiles = options.includeFiles !== false;
  const Submission = getPlaySubmissionModel();
  const selectFields = includeFiles
    ? undefined
    : "anonymousId firebaseUid displayName challengeSlug challengeDate fileCount totalBytes submittedAt ratingMean ratingDeviation rankingScore wins losses matches";
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
    ...toPublicSummary(doc, {
      rank,
      anonymousId,
      firebaseUid: options.firebaseUid,
    }),
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
  const challengeDate = options.challengeDate || (await getActiveChallengeDate());
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  // One row per submission — every build ranks independently, including
  // multiple entries from the same builder.
  const ranked = await loadRankedForDate(challengeDate);
  const entries = ranked.slice(0, limit).map((doc, i) =>
    toPublicSummary(doc, {
      rank: i + 1,
      anonymousId: options.anonymousId,
    }),
  );

  // `ranked` is rank-sorted, so the first match is this builder's best entry.
  // Their other entries still appear as their own rows, flagged `isMine`.
  let you: PublicSubmissionSummary | null = null;
  if (options.anonymousId) {
    const idx = ranked.findIndex((d) => d.anonymousId === options.anonymousId);
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
  const challengeDate = input.challengeDate || (await getActiveChallengeDate());
  // Anyone may play the matchups, and (for now) every pick moves the ratings.
  const weighted =
    EVERY_VOTE_IS_WEIGHTED || (await hasSubmitted(anonymousId, challengeDate));
  const weightedVotesToday = weighted
    ? await countVotesToday(anonymousId, challengeDate)
    : 0;
  const votesToday = weighted
    ? weightedVotesToday
    : await countPlayedVotesToday(anonymousId, challengeDate);

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
      round: buildRoundProgress(votesToday, 0),
      canVote: true,
      weighted,
    });
  }

  // PlayVoteRound is a submitter feature — it exists to power the recap of how
  // the ranking moved. Nothing moves for an unweighted player, so no row.
  if (weighted) {
    await ensureRoundSnapshot({ anonymousId, challengeDate, votesToday });
  }

  const pairsRemaining = await countRemainingPairs({
    anonymousId,
    challengeDate,
  });
  const round = buildRoundProgress(votesToday, pairsRemaining);
  if (pairsRemaining === 0) {
    return unavailableVotePair({
      challengeDate,
      reason: "no_pairs_left",
      message:
        "You're done for now — you've compared every available matchup. Check back if more people submit.",
      round,
      canVote: false,
      weighted,
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
      weighted,
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
    weighted,
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

  // Weighted only: `roundIndex` counts weighted votes, so slicing an array
  // that also held this voter's pre-submission plays would take the wrong five.
  const votes = await Vote.find({
    anonymousId: input.anonymousId,
    challengeDate: input.challengeDate,
    weighted: { $ne: false },
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

  const challengeDate = input.challengeDate || (await getActiveChallengeDate());
  // Anyone may play, and (for now) every pick is weighted into the ratings.
  const weighted =
    EVERY_VOTE_IS_WEIGHTED || (await hasSubmitted(anonymousId, challengeDate));
  const weightedVotesToday = weighted
    ? await countVotesToday(anonymousId, challengeDate)
    : 0;
  const votesToday = weighted
    ? weightedVotesToday
    : await countPlayedVotesToday(anonymousId, challengeDate);

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
  // Checked against the entries themselves, not a single "own" submission, so
  // every build this voter entered is excluded — not just one of them.
  if (
    winner.anonymousId === anonymousId ||
    loser.anonymousId === anonymousId
  ) {
    throw createHttpError(400, "cannot_vote_own");
  }

  const key = pairKeyFor(winnerId, loserId);
  try {
    await Vote.create({
      anonymousId,
      challengeDate,
      winnerId: winner._id,
      loserId: loser._id,
      pairKey: key,
      weighted,
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

  const roundIndex = Math.floor(votesToday / VOTE_ROUND_SIZE);

  // Everything below the vote record itself is submitter-only. An unweighted
  // vote is stored (so its pair is burned and can't be re-served) and is
  // otherwise completely inert: no rating move, no round row, no recap.
  if (weighted) {
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
    await VoteRound.updateOne(
      { anonymousId, challengeDate, roundIndex },
      {
        $inc: { votesInRound: 1 },
        $addToSet: {
          seenSubmissionIds: { $each: [winnerId, loserId] },
        },
      },
    );
  }

  const newVotesToday = votesToday + 1;
  const roundComplete = newVotesToday % VOTE_ROUND_SIZE === 0;
  const pairsRemaining = await countRemainingPairs({
    anonymousId,
    challengeDate,
  });
  const allPairsComplete = pairsRemaining === 0;
  let round = buildRoundProgress(newVotesToday, pairsRemaining);
  if (roundComplete) {
    // Present as 5/5 completed for the recap UI.
    round = {
      ...round,
      votesInRound: VOTE_ROUND_SIZE,
      roundIndex: Math.floor((newVotesToday - 1) / VOTE_ROUND_SIZE),
    };
  }
  const canContinue = !allPairsComplete;

  let recap: RoundRecap | undefined;
  // Full round or last unique pair mid-round → break for an interstitial.
  // Unweighted players get the same break, but no recap: the recap reports
  // how the ranking moved, and theirs moved nothing.
  const shouldBreak = roundComplete || allPairsComplete;
  if (shouldBreak) {
    if (!roundComplete && allPairsComplete) {
      // Partial final round: show how many votes landed in this round.
      const votesInPartial = (votesToday % VOTE_ROUND_SIZE) + 1;
      round = {
        ...round,
        votesInRound: votesInPartial,
        roundIndex,
      };
    }
    if (weighted) {
      recap = await buildRecap({
        anonymousId,
        challengeDate,
        roundIndex,
      });
    }

    return {
      recorded: true,
      challengeDate,
      round,
      pairAvailable: false,
      recap,
      weighted,
      roundComplete,
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
      weighted,
      roundComplete,
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
    weighted,
    roundComplete,
    pairsRemaining: next.pairsRemaining,
    allPairsComplete: next.allPairsComplete,
    canContinue: next.canContinue,
  };
}
