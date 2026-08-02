import { Schema } from "mongoose";
import { getPlayConnection } from "../../db/shortsConnection.js";

/**
 * Links a Firebase account to the anonymous ids it has claimed.
 *
 * Shorts identity is per-browser (`anonymousId` in localStorage). Signing in
 * claims the current browser's id for the account; signing in on another
 * device claims that one too. History views query the union of linked ids —
 * existing submissions/votes are never rewritten.
 */
const AccountLinkSchema = new Schema(
  {
    firebaseUid: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    anonymousId: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true },
);

// One link row per (account, anonymousId) pair.
AccountLinkSchema.index({ firebaseUid: 1, anonymousId: 1 }, { unique: true });

export function getPlayAccountLinkModel() {
  const conn = getPlayConnection();
  return (
    conn.models.PlayAccountLink ||
    conn.model("PlayAccountLink", AccountLinkSchema)
  );
}
