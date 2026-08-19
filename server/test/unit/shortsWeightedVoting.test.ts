import { beforeEach, describe, expect, it, vi } from "vitest";

// voting.ts reaches the Shorts models, and shortsConnection.ts throws at import
// time without ATLAS_URI. The models themselves are faked below.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/shorts-voting-test";
});

const DATE = "2026-08-17";
const VOTER = "voter-anon-1";

type SubmissionDoc = {
  _id: string;
  anonymousId: string;
  displayName: string;
  challengeSlug: string;
  challengeDate: string;
  fileCount: number;
  totalBytes: number;
  submittedAt: Date;
  ratingMean: number;
  ratingDeviation: number;
  rankingScore: number;
  wins: number;
  losses: number;
  matches: number;
  files: Array<{ path: string; content: string }>;
  save: ReturnType<typeof vi.fn>;
};

type VoteDoc = {
  anonymousId: string;
  challengeDate: string;
  winnerId: string;
  loserId: string;
  pairKey: string;
  weighted?: boolean;
  createdAt: Date;
};

let submissions: SubmissionDoc[] = [];
let votes: VoteDoc[] = [];
/** Every filter handed to Vote.countDocuments / Vote.find, for assertions. */
let voteCountFilters: Record<string, unknown>[] = [];
let voteFindFilters: Record<string, unknown>[] = [];

const ID_PREFIX = "64b7f9c2e1a2b3c4d5e6f7";
let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `${ID_PREFIX}${String(idSeq).padStart(2, "0")}`;
}

function makeSubmission(anonymousId: string, displayName: string): SubmissionDoc {
  return {
    _id: nextId(),
    anonymousId,
    displayName,
    challengeSlug: "one-button-game",
    challengeDate: DATE,
    fileCount: 1,
    totalBytes: 1200,
    submittedAt: new Date("2026-08-17T10:00:00Z"),
    ratingMean: 25,
    ratingDeviation: 25 / 3,
    rankingScore: 0,
    wins: 0,
    losses: 0,
    matches: 0,
    files: [{ path: "index.html", content: "<html></html>" }],
    save: vi.fn(async () => undefined),
  };
}

/** Just enough of a Mongo filter to serve the queries voting.ts actually makes. */
function matches(doc: Record<string, unknown>, filter: Record<string, unknown>) {
  return Object.entries(filter).every(([key, want]) => {
    const got = doc[key];
    if (want && typeof want === "object" && !Array.isArray(want)) {
      const cond = want as Record<string, unknown>;
      if ("$ne" in cond) return got !== cond.$ne;
      if ("$in" in cond) return (cond.$in as unknown[]).includes(got);
    }
    return got === want;
  });
}

function chain(rows: unknown[]) {
  const q: Record<string, unknown> = {
    select: () => q,
    sort: () => q,
    lean: async () => rows,
  };
  return q as {
    select: (s?: string) => typeof q;
    sort: (s?: unknown) => typeof q;
    lean: () => Promise<unknown[]>;
  };
}

const SubmissionModel = {
  exists: vi.fn(async (filter: Record<string, unknown>) => {
    const hit = submissions.find((s) => matches(s, filter));
    return hit ? { _id: hit._id } : null;
  }),
  find: vi.fn((filter: Record<string, unknown>) =>
    chain(submissions.filter((s) => matches(s, filter))),
  ),
  countDocuments: vi.fn(
    async (filter: Record<string, unknown>) =>
      submissions.filter((s) => matches(s, filter)).length,
  ),
  findById: vi.fn(async (id: string) => submissions.find((s) => s._id === id) || null),
};

const VoteModel = {
  countDocuments: vi.fn(async (filter: Record<string, unknown>) => {
    voteCountFilters.push(filter);
    return votes.filter((v) => matches(v, filter)).length;
  }),
  find: vi.fn((filter: Record<string, unknown>) => {
    voteFindFilters.push(filter);
    return chain(votes.filter((v) => matches(v, filter)));
  }),
  create: vi.fn(async (doc: Omit<VoteDoc, "createdAt">) => {
    const dup = votes.find(
      (v) =>
        v.anonymousId === doc.anonymousId &&
        v.challengeDate === doc.challengeDate &&
        v.pairKey === doc.pairKey,
    );
    if (dup) {
      throw Object.assign(new Error("duplicate key"), { code: 11000 });
    }
    const row: VoteDoc = { ...doc, createdAt: new Date() };
    votes.push(row);
    return row;
  }),
};

const VoteRoundModel = {
  findOne: vi.fn(async () => null),
  create: vi.fn(async () => ({})),
  updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
};

vi.mock("../../src/models/shorts/submission.js", () => ({
  getPlaySubmissionModel: () => SubmissionModel,
}));
vi.mock("../../src/models/shorts/vote.js", () => ({
  getPlayVoteModel: () => VoteModel,
  getPlayVoteRoundModel: () => VoteRoundModel,
}));

const { castVote, getNextVotePair } = await import(
  "../../src/services/shorts/voting.js"
);
const { pairKeyFor } = await import(
  "../../src/services/shorts/bayesianRating.js"
);

/** Three builds by other people → three unique pairs for our voter. */
function seedOthers(count = 3): SubmissionDoc[] {
  const made: SubmissionDoc[] = [];
  for (let i = 0; i < count; i++) {
    const doc = makeSubmission(`builder-${i}`, `Build ${i}`);
    submissions.push(doc);
    made.push(doc);
  }
  return made;
}

/** A build owned by the voter, which is what makes their votes weighted. */
function seedOwnBuild() {
  submissions.push(makeSubmission(VOTER, "My build"));
}

function seedFillerVotes(count: number, weighted: boolean) {
  for (let i = 0; i < count; i++) {
    votes.push({
      anonymousId: VOTER,
      challengeDate: DATE,
      winnerId: `filler-w-${i}`,
      loserId: `filler-l-${i}`,
      // Deliberately not a real pairKey, so these don't consume real matchups.
      pairKey: `filler:${i}`,
      weighted,
      createdAt: new Date(),
    });
  }
}

describe("Shorts weighted voting", () => {
  beforeEach(() => {
    submissions = [];
    votes = [];
    voteCountFilters = [];
    voteFindFilters = [];
    idSeq = 0;
    vi.clearAllMocks();
    VoteRoundModel.findOne.mockResolvedValue(null);
  });

  it("serves a matchup to someone who has not submitted — weighted, with a round open", async () => {
    seedOthers();

    const result = await getNextVotePair({
      anonymousId: VOTER,
      challengeDate: DATE,
      includeFiles: false,
    });

    expect(result.pairAvailable).toBe(true);
    // EVERY_VOTE_IS_WEIGHTED: spectators' picks count too.
    expect(result.weighted).toBe(true);
    // The old "submit first" wall is gone.
    expect(result.pairAvailable === false && result.reason).toBeFalsy();
    expect(VoteRoundModel.create).toHaveBeenCalledTimes(1);
  });

  it("marks a submitter's matchup weighted and opens their round", async () => {
    seedOthers();
    seedOwnBuild();

    const result = await getNextVotePair({
      anonymousId: VOTER,
      challengeDate: DATE,
      includeFiles: false,
    });

    expect(result.pairAvailable).toBe(true);
    expect(result.weighted).toBe(true);
    expect(VoteRoundModel.create).toHaveBeenCalledTimes(1);
  });

  it("moves ratings on a weighted vote and stores it as weighted", async () => {
    const [a, b] = seedOthers(4);
    seedOwnBuild();

    const result = await castVote({
      anonymousId: VOTER,
      challengeDate: DATE,
      winnerId: a._id,
      loserId: b._id,
      includeFiles: false,
    });

    expect(result.weighted).toBe(true);
    expect(VoteModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ weighted: true, pairKey: pairKeyFor(a._id, b._id) }),
    );
    expect(a.ratingMean).toBeGreaterThan(25);
    expect(b.ratingMean).toBeLessThan(25);
    expect(a.wins).toBe(1);
    expect(b.losses).toBe(1);
    expect(a.matches).toBe(1);
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(b.save).toHaveBeenCalledTimes(1);
    expect(VoteRoundModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it("weights a non-submitter's vote like any other: stored and ratings move", async () => {
    const [a, b] = seedOthers(4);

    const result = await castVote({
      anonymousId: VOTER,
      challengeDate: DATE,
      winnerId: a._id,
      loserId: b._id,
      includeFiles: false,
    });

    expect(result.recorded).toBe(true);
    expect(result.weighted).toBe(true);
    expect(VoteModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ weighted: true }),
    );
    expect(votes).toHaveLength(1);
    expect(votes[0].weighted).toBe(true);

    expect(a.ratingMean).toBeGreaterThan(25);
    expect(b.ratingMean).toBeLessThan(25);
    expect(a.wins).toBe(1);
    expect(b.losses).toBe(1);
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(b.save).toHaveBeenCalledTimes(1);
    expect(VoteRoundModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it("hands a non-submitter the recap when their fifth pick closes the round", async () => {
    const others = seedOthers(6);

    // Four picks in, then the fifth closes the round.
    for (let i = 0; i < 5; i++) {
      const result = await castVote({
        anonymousId: VOTER,
        challengeDate: DATE,
        winnerId: others[i]._id,
        loserId: others[i + 1]._id,
        includeFiles: false,
      });
      expect(result.weighted).toBe(true);
      if (i === 4) {
        expect(result.roundComplete).toBe(true);
        expect(result.pairAvailable).toBe(false);
        expect(result.recap).toBeDefined();
      } else {
        expect(result.recap).toBeUndefined();
      }
    }
  });

  it("keeps serving matchups after many picks as long as unique pairs remain", async () => {
    const [a, b] = seedOthers(4);
    seedOwnBuild();
    // The old ranking-vote budget was 25. Filler votes consume that count
    // without burning real pairKeys — this is the regression: a budget stop
    // would 429 here even though unseen combinations still exist.
    seedFillerVotes(25, true);

    const next = await getNextVotePair({
      anonymousId: VOTER,
      challengeDate: DATE,
      includeFiles: false,
    });
    expect(next.pairAvailable).toBe(true);
    expect(next.pairsRemaining).toBeGreaterThan(0);

    const result = await castVote({
      anonymousId: VOTER,
      challengeDate: DATE,
      winnerId: a._id,
      loserId: b._id,
      includeFiles: false,
    });
    expect(result.recorded).toBe(true);
    expect(result.weighted).toBe(true);
  });

  it("does not treat historical unweighted plays as pair exhaustion", async () => {
    const [a, b] = seedOthers(4);
    // Old inert plays from before the everyone-weighted switch: they burned
    // dummy pairKeys, not the live matchups.
    seedFillerVotes(30, false);

    const result = await castVote({
      anonymousId: VOTER,
      challengeDate: DATE,
      winnerId: a._id,
      loserId: b._id,
      includeFiles: false,
    });
    expect(result.recorded).toBe(true);
    expect(result.weighted).toBe(true);
  });

  it("counts only weighted votes toward the round index", async () => {
    seedOthers();
    seedOwnBuild();
    seedFillerVotes(3, false);
    seedFillerVotes(2, true);

    const result = await getNextVotePair({
      anonymousId: VOTER,
      challengeDate: DATE,
      includeFiles: false,
    });

    // Two weighted votes → third pick of round one, not the sixth.
    expect(result.round.votesToday).toBe(2);
    expect(result.round.votesInRound).toBe(3);
    expect(result.round.roundIndex).toBe(0);
    expect(
      voteCountFilters.some(
        (f) => JSON.stringify(f.weighted) === JSON.stringify({ $ne: false }),
      ),
    ).toBe(true);
  });

  it("counts unweighted votes toward pair exhaustion", async () => {
    const others = seedOthers(3);
    // Every unique pair among the three, all cast unweighted.
    const pairs = [
      [others[0], others[1]],
      [others[0], others[2]],
      [others[1], others[2]],
    ];
    for (const [x, y] of pairs) {
      votes.push({
        anonymousId: VOTER,
        challengeDate: DATE,
        winnerId: x._id,
        loserId: y._id,
        pairKey: pairKeyFor(x._id, y._id),
        weighted: false,
        createdAt: new Date(),
      });
    }

    const result = await getNextVotePair({
      anonymousId: VOTER,
      challengeDate: DATE,
      includeFiles: false,
    });

    // If exhaustion were weight-filtered, the same pair would be served again
    // and then collide with the unique {anonymousId, challengeDate, pairKey}.
    expect(result.pairAvailable).toBe(false);
    expect(result.pairAvailable === false && result.reason).toBe("no_pairs_left");
    expect(result.pairsRemaining).toBe(0);

    // The pairKey lookups must never filter on weight.
    const pairKeyLookups = voteFindFilters.filter((f) => "anonymousId" in f);
    expect(pairKeyLookups.length).toBeGreaterThan(0);
    for (const f of pairKeyLookups) {
      expect(f).not.toHaveProperty("weighted");
    }
  });

  it("reopens matchups when a new build creates unseen pairs", async () => {
    const others = seedOthers(3);
    const pairs = [
      [others[0], others[1]],
      [others[0], others[2]],
      [others[1], others[2]],
    ];
    for (const [x, y] of pairs) {
      votes.push({
        anonymousId: VOTER,
        challengeDate: DATE,
        winnerId: x._id,
        loserId: y._id,
        pairKey: pairKeyFor(x._id, y._id),
        weighted: true,
        createdAt: new Date(),
      });
    }

    const exhausted = await getNextVotePair({
      anonymousId: VOTER,
      challengeDate: DATE,
      includeFiles: false,
    });
    expect(exhausted.pairAvailable).toBe(false);
    expect(exhausted.pairAvailable === false && exhausted.reason).toBe(
      "no_pairs_left",
    );

    seedOthers(1);

    const reopened = await getNextVotePair({
      anonymousId: VOTER,
      challengeDate: DATE,
      includeFiles: false,
    });
    expect(reopened.pairAvailable).toBe(true);
    expect(reopened.pairsRemaining).toBeGreaterThan(0);
  });

  it("keeps self-exclusion working without a submitter check", async () => {
    const [a] = seedOthers(3);
    const mine = makeSubmission(VOTER, "My build");
    submissions.push(mine);

    await expect(
      castVote({
        anonymousId: VOTER,
        challengeDate: DATE,
        winnerId: mine._id,
        loserId: a._id,
        includeFiles: false,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
