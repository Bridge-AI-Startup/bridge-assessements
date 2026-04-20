import express from "express";
import rateLimit from "express-rate-limit";
import * as CompetitionController from "../controllers/competition.js";
import { competitionJoinValidation } from "../validators/competitionValidation.js";

const router = express.Router();

router.get("/hackathon-default", CompetitionController.getHackathonDefaultSlug);

/** Stricter limit for self-serve join (abuse resistance). Disabled in development. */
const competitionJoinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many registration attempts from this IP. Try again later.",
  },
  skip: () => process.env.NODE_ENV === "development",
});

router.get("/:slug/leaderboard", CompetitionController.getCompetitionLeaderboard);

router.get("/:slug", CompetitionController.getCompetitionBySlug);

router.post(
  "/:slug/join",
  competitionJoinLimiter,
  ...competitionJoinValidation,
  CompetitionController.joinCompetition,
);

export default router;
