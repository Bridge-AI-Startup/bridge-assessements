import { RequestHandler } from "express";
import {
  buildContextBundle,
  ContextTopic,
} from "../services/agentContext/contextCenter.js";

/**
 * Agent tool endpoint: unified context center for the voice agent.
 * POST /api/agent-tools/context
 *
 * Body: { submissionId, question?, topics? }
 * - `question` (optional) drives the semantic code search once the repo is
 *   indexed; without it the code section falls back to live captured files.
 * - `topics` (optional) narrows the bundle to a subset of
 *   ["assessment","conversation","timeline","code"].
 *
 * Every section is fail-soft: missing sources come back as
 * `{ available: false, reason }` instead of an error, because a tool failure
 * mid-call stalls the voice conversation.
 */
export const getContextCenter: RequestHandler = async (req, res, next) => {
  try {
    const { submissionId, question, topics } = req.body as {
      submissionId?: string;
      question?: string;
      topics?: ContextTopic[];
    };

    if (!submissionId || typeof submissionId !== "string") {
      return res.status(400).json({ error: "submissionId is required" });
    }
    const cleanQuestion =
      typeof question === "string" && question.trim()
        ? question.trim().slice(0, 2000)
        : undefined;
    const cleanTopics = Array.isArray(topics)
      ? (topics.filter((t) =>
          [
            "assessment",
            "conversation",
            "timeline",
            "code",
            "episodes",
            "metrics",
          ].includes(t)
        ) as ContextTopic[])
      : undefined;

    const bundle = await buildContextBundle(submissionId, {
      question: cleanQuestion,
      topics: cleanTopics,
    });
    if (!bundle) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Compact one-line log per call (this endpoint fires during live calls).
    const availability = (
      [
        "assessment",
        "conversation",
        "timeline",
        "code",
        "episodes",
        "metrics",
      ] as const
    )
      .map((k) => {
        const section = bundle[k] as { available?: boolean } | undefined;
        if (!section) return `${k}:-`;
        return `${k}:${section.available ? "✓" : "✗"}`;
      })
      .join(" ");
    console.log(
      `🔧 [agentTools/context] submission=${submissionId} q=${
        cleanQuestion ? `"${cleanQuestion.slice(0, 60)}"` : "none"
      } ${availability}`
    );

    res.status(200).json(bundle);
  } catch (error) {
    console.error("❌ [agentTools/context] failed:", error);
    next(error);
  }
};
