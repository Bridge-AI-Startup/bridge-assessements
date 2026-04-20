import type { RequestHandler } from "express";
import { validationResult } from "express-validator";
import {
  createSubmission,
  findAssessmentById,
  findAssessmentByIdAndUser,
  findSubmissionByAssessmentAndEmail,
  findSubmissionByToken,
  listSubmissionsByAssessment,
  touchSubmission,
  type AssessmentRecord,
  type SubmissionRecord,
} from "../repositories/inMemoryStore.js";
import { generateSubmissionToken } from "../utils/token.js";

function publicAssessmentPayload(a: AssessmentRecord) {
  return {
    id: a.id,
    title: a.title,
    description: a.description ?? "",
    timeLimit: a.timeLimit,
  };
}

/** GET /api/submissions/assessments/public/:id — candidate-facing assessment card (no employer data). */
export const getPublicAssessment: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!id?.trim()) {
      return res.status(400).json({ error: "INVALID_ID" });
    }
    const a = findAssessmentById(id);
    if (!a) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Assessment not found." });
    }
    res.status(200).json({ assessment: publicAssessmentPayload(a) });
  } catch (e) {
    next(e);
  }
};

/** POST /api/submissions/generate-link */
export const generateLink: RequestHandler = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "VALIDATION", details: errors.array() });
    }
    const userId = req.employer!.userId;
    const { assessmentId, candidateName, candidateEmail, displayName } = req.body as {
      assessmentId: string;
      candidateName: string;
      candidateEmail: string;
      displayName?: string;
      website?: string;
    };
    if (typeof req.body?.website === "string" && req.body.website.trim()) {
      return res
        .status(400)
        .json({ error: "BOT_DETECTED", message: "Invalid form submission." });
    }
    const assessment = findAssessmentByIdAndUser(assessmentId, userId);
    if (!assessment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Assessment not found." });
    }
    const emailNorm = String(candidateEmail).trim().toLowerCase();
    const existing = findSubmissionByAssessmentAndEmail(assessment.id, emailNorm);
    if (existing) {
      return res.status(409).json({
        error: "DUPLICATE_EMAIL",
        message: "A link already exists for this email on this assessment.",
      });
    }
    const token = generateSubmissionToken();
    const sub = createSubmission({
      token,
      assessmentId: assessment.id,
      candidateName: candidateName.trim(),
      displayName: typeof displayName === "string" ? displayName.trim() : "",
      candidateEmail: emailNorm,
      status: "pending",
    });
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5174";
    const shareLink = `${frontendUrl}/candidate?token=${encodeURIComponent(token)}`;
    res.status(201).json({
      token: sub.token,
      shareLink,
      submissionId: sub.id,
      candidateName: sub.candidateName,
    });
  } catch (e) {
    next(e);
  }
};

/** GET /api/submissions/assessments/:assessmentId/submissions */
export const listSubmissionsForAssessment: RequestHandler = async (req, res, next) => {
  try {
    const employerUserId = req.employer!.userId;
    const { assessmentId } = req.params;
    if (!assessmentId?.trim()) {
      return res.status(400).json({ error: "INVALID_ID" });
    }
    const assessment = findAssessmentByIdAndUser(assessmentId, employerUserId);
    if (!assessment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Assessment not found." });
    }

    const statusQ = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const allowed = new Set(["pending", "in-progress", "submitted", "opted-out", "expired"]);

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    let rows = listSubmissionsByAssessment(assessment.id).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
    if (statusQ && allowed.has(statusQ)) {
      rows = rows.filter((s) => s.status === statusQ);
    }
    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.candidateName.toLowerCase().includes(needle) ||
          s.candidateEmail.toLowerCase().includes(needle),
      );
    }
    rows = rows.slice(skip, skip + limit);

    res.status(200).json({
      assessmentId: assessment.id,
      page,
      limit,
      submissions: rows.map((s) => ({
        id: s.id,
        token: s.token,
        candidateName: s.candidateName,
        displayName: s.displayName || "",
        candidateEmail: s.candidateEmail,
        status: s.status,
        startedAt: s.startedAt,
        submittedAt: s.submittedAt,
        timeSpent: s.timeSpent,
        hasNotes: Boolean(s.submissionNotes && String(s.submissionNotes).trim()),
        createdAt: s.createdAt,
      })),
    });
  } catch (e) {
    next(e);
  }
};

/** GET /api/submissions/token/:token — submission + scoped public assessment only. */
export const getSubmissionByToken: RequestHandler = async (req, res, next) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "INVALID_TOKEN" });
    }
    const sub = findSubmissionByToken(token);
    if (!sub) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invalid or expired link." });
    }
    const assessment = findAssessmentById(sub.assessmentId);
    if (!assessment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Assessment missing." });
    }

    res.status(200).json({
      submission: {
        token: sub.token,
        status: sub.status,
        candidateName: sub.candidateName,
        displayName: (sub as { displayName?: string }).displayName || "",
        candidateEmail: sub.candidateEmail,
        startedAt: sub.startedAt,
        submittedAt: sub.submittedAt,
        timeSpent: sub.timeSpent,
        submissionNotes: sub.submissionNotes || "",
      },
      assessment: publicAssessmentPayload(assessment),
    });
  } catch (e) {
    next(e);
  }
};

/** POST /api/submissions/token/:token/start */
export const startAssessment: RequestHandler = async (req, res, next) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "INVALID_TOKEN" });
    }
    const sub = findSubmissionByToken(token);
    if (!sub) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invalid link." });
    }
    if (sub.status === "submitted") {
      return res.status(400).json({
        error: "ALREADY_SUBMITTED",
        message: "This assessment was already submitted.",
      });
    }
    if (sub.status === "opted-out") {
      return res.status(400).json({ error: "OPTED_OUT", message: "You opted out of this assessment." });
    }
    if (sub.status === "expired") {
      return res.status(400).json({ error: "EXPIRED", message: "This link has expired." });
    }

    const now = new Date();
    if (sub.status === "pending") {
      sub.status = "in-progress";
      sub.startedAt = now;
    } else if (sub.status === "in-progress" && !sub.startedAt) {
      sub.startedAt = now;
    }
    touchSubmission(sub);

    const assessment = findAssessmentById(sub.assessmentId);
    if (!assessment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Assessment missing." });
    }

    res.status(200).json({
      submission: {
        token: sub.token,
        status: sub.status,
        startedAt: sub.startedAt,
      },
      assessment: publicAssessmentPayload(assessment),
    });
  } catch (e) {
    next(e);
  }
};

function minutesBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / 60000));
}

/** POST /api/submissions/token/:token/submit — finalize without GitHub. */
export const submitAssessment: RequestHandler = async (req, res, next) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "INVALID_TOKEN" });
    }
    const { submissionNotes } = (req.body || {}) as { submissionNotes?: string };
    const sub = findSubmissionByToken(token);
    if (!sub) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invalid link." });
    }
    if (sub.status === "submitted") {
      return res.status(400).json({
        error: "ALREADY_SUBMITTED",
        message: "Already submitted.",
      });
    }
    if (sub.status === "opted-out" || sub.status === "expired") {
      return res.status(400).json({ error: "INVALID_STATE", message: "Cannot submit from this state." });
    }

    const now = new Date();
    if (sub.status === "pending") {
      sub.startedAt = sub.startedAt || now;
      sub.status = "in-progress";
    }
    if (sub.status !== "in-progress") {
      return res.status(400).json({ error: "INVALID_STATE", message: "Start the assessment before submitting." });
    }

    sub.status = "submitted";
    sub.submittedAt = now;
    if (sub.startedAt) {
      sub.timeSpent = minutesBetween(sub.startedAt, now);
    }
    if (submissionNotes != null) {
      sub.submissionNotes = String(submissionNotes).trim();
    }
    touchSubmission(sub);

    res.status(200).json({
      submission: {
        token: sub.token,
        status: sub.status,
        submittedAt: sub.submittedAt,
        timeSpent: sub.timeSpent,
      },
    });
  } catch (e) {
    next(e);
  }
};
