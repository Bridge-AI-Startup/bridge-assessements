import type { RequestHandler } from "express";
import { validationResult } from "express-validator";
import CompetitionModel from "../models/competition.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import validationErrorParser from "../utils/validationErrorParser.js";
import {
  getCombinedLeaderboardScore,
  getCombinedScoreBreakdownParts,
} from "../utils/leaderboardScore.js";

function assertCompetitionJoinWindow(comp: {
  registrationOpen: boolean;
  competitionStartsAt?: Date | null;
  competitionEndsAt?: Date | null;
}): { ok: true } | { ok: false; status: number; message: string } {
  if (!comp.registrationOpen) {
    return {
      ok: false,
      status: 403,
      message: "Registration is closed for this competition.",
    };
  }
  const now = Date.now();
  if (comp.competitionStartsAt) {
    const t = new Date(comp.competitionStartsAt).getTime();
    if (now < t) {
      return {
        ok: false,
        status: 403,
        message: "This competition has not started yet.",
      };
    }
  }
  if (comp.competitionEndsAt) {
    const t = new Date(comp.competitionEndsAt).getTime();
    if (now > t) {
      return {
        ok: false,
        status: 403,
        message: "This competition has ended.",
      };
    }
  }
  return { ok: true };
}

/**
 * GET /api/competitions/:slug
 * Public metadata for hackathon dashboard + assessment summary.
 */
export const getCompetitionBySlug: RequestHandler = async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return res.status(400).json({ error: "INVALID_SLUG" });
    }

    const competition = await CompetitionModel.findOne({ slug }).lean();
    if (!competition) {
      return res.status(404).json({ error: "COMPETITION_NOT_FOUND" });
    }

    const assessment = await AssessmentModel.findById(
      competition.assessmentId,
    ).select("title description timeLimit");

    if (!assessment) {
      return res.status(404).json({ error: "ASSESSMENT_NOT_FOUND" });
    }

    res.status(200).json({
      slug: competition.slug,
      assessmentId: String(competition.assessmentId),
      title: competition.title || assessment.title,
      description: competition.description || assessment.description,
      rulesMarkdown: competition.rulesMarkdown || "",
      registrationOpen: competition.registrationOpen,
      competitionStartsAt: competition.competitionStartsAt,
      competitionEndsAt: competition.competitionEndsAt,
      leaderboardPublic: competition.leaderboardPublic,
      assessment: {
        title: assessment.title,
        description: assessment.description,
        timeLimit: assessment.timeLimit,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/competitions/:slug/join
 * Self-serve registration: creates a pending submission (same as employer generate-link).
 * Does not enforce the employer free-tier submission cap — competitions are allowlisted by slug.
 */
export const joinCompetition: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { slug } = req.params;
    const { candidateName, candidateEmail } = req.body as {
      candidateName: string;
      candidateEmail: string;
    };

    const competition = await CompetitionModel.findOne({
      slug: String(slug).trim().toLowerCase(),
    });
    if (!competition) {
      return res.status(404).json({ error: "COMPETITION_NOT_FOUND" });
    }

    // Optional: match frontend pre-launch (VITE_HACKATHON_RELEASE_AT) — set the same ISO in Render config.
    const joinEarliest = process.env.COMPETITION_JOIN_EARLIEST_AT?.trim();
    if (joinEarliest) {
      const t = Date.parse(joinEarliest);
      if (Number.isFinite(t) && Date.now() < t) {
        return res.status(403).json({
          error: "NOT_STARTED",
          message: "This challenge hasn't started yet.",
        });
      }
    }

    const window = assertCompetitionJoinWindow(competition);
    if (!window.ok) {
      return res.status(window.status).json({
        error: "REGISTRATION_NOT_ALLOWED",
        message: window.message,
      });
    }

    const assessment = await AssessmentModel.findById(competition.assessmentId);
    if (!assessment) {
      return res.status(404).json({ error: "ASSESSMENT_NOT_FOUND" });
    }

    const emailNorm = String(candidateEmail).trim().toLowerCase();
    const existing = await SubmissionModel.findOne({
      assessmentId: competition.assessmentId,
      candidateEmail: emailNorm,
    }).select("_id");

    if (existing) {
      return res.status(409).json({
        error: "ALREADY_REGISTERED",
        message:
          "This email already has an entry for this competition. Use your original link from your inbox or contact support.",
      });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.get("user-agent");
    const submission = await SubmissionModel.create({
      assessmentId: competition.assessmentId,
      candidateName: candidateName.trim(),
      candidateEmail: emailNorm,
      status: "pending",
      ...(ipAddress || userAgent
        ? {
            metadata: {
              ...(ipAddress ? { ipAddress: String(ipAddress) } : {}),
              ...(userAgent ? { userAgent } : {}),
            },
          }
        : {}),
    });

    // Identical to employer POST /submissions/generate-link: canonical candidate URL for email / copy-link.
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const shareLink = `${frontendUrl}/CandidateAssessment?token=${submission.token}`;

    res.status(201).json({
      token: submission.token,
      shareLink,
      submissionId: String(submission._id),
      candidateName: submission.candidateName,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/competitions/:slug/leaderboard
 */
export const getCompetitionLeaderboard: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const slug = String(req.params.slug || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return res.status(400).json({ error: "INVALID_SLUG" });
    }

    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));

    const competition = await CompetitionModel.findOne({ slug }).lean();
    if (!competition) {
      return res.status(404).json({ error: "COMPETITION_NOT_FOUND" });
    }

    if (!competition.leaderboardPublic) {
      return res.status(403).json({
        error: "LEADERBOARD_PRIVATE",
        message: "Leaderboard is not public for this competition.",
      });
    }

    // Full documents (no .select) — same shape as employer GET submissions list so scoring matches.
    const submissions = await SubmissionModel.find({
      assessmentId: competition.assessmentId,
      status: "submitted",
    }).lean();

    type Row = {
      displayName: string;
      score: number | null;
      submittedAt: string | null;
      sortKey: number;
      tieAt: number;
      breakdown: string[];
    };

    const rows: Row[] = submissions.map((s) => {
      const sub = s as any;
      const score = getCombinedLeaderboardScore(sub);
      const breakdown = getCombinedScoreBreakdownParts(sub);
      const submittedAt = s.submittedAt
        ? new Date(s.submittedAt).toISOString()
        : null;
      const tieAt = s.submittedAt
        ? new Date(s.submittedAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      const sortKey =
        score != null && !Number.isNaN(score)
          ? score
          : Number.NEGATIVE_INFINITY;
      return {
        displayName: (sub.candidateName && String(sub.candidateName).trim()) || "Participant",
        score,
        submittedAt,
        sortKey,
        tieAt,
        breakdown,
      };
    });

    rows.sort((a, b) => {
      if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
      return a.tieAt - b.tieAt;
    });

    const ranked = rows.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      displayName: r.displayName,
      score: r.score != null ? Math.round(r.score) : null,
      submittedAt: r.submittedAt,
      breakdown: r.breakdown,
    }));

    res.status(200).json({ slug: competition.slug, entries: ranked });
  } catch (error) {
    next(error);
  }
};
