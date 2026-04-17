import mongoose from "mongoose";

const CompetitionSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    assessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assessment",
      required: true,
      index: true,
    },

    title: {
      type: String,
      trim: true,
      default: "",
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    rulesMarkdown: {
      type: String,
      default: "",
    },

    registrationOpen: {
      type: Boolean,
      default: true,
    },

    competitionStartsAt: {
      type: Date,
      default: null,
    },

    competitionEndsAt: {
      type: Date,
      default: null,
    },

    leaderboardPublic: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const CompetitionModel = mongoose.model("Competition", CompetitionSchema);
export default CompetitionModel;
