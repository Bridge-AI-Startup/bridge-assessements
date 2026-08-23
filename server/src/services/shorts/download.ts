import createHttpError from "http-errors";
import { Types } from "mongoose";
import { getPlaySubmissionModel } from "../../models/shorts/submission.js";
import { filterPlayPublicFiles } from "./sandbox.js";
import { getShortsClientBase } from "./sharePage.js";

export type PlayDownloadFile = {
  path: string;
  content: string;
};

export type PlayDownloadBundle = {
  /** Filesystem-safe name derived from the build's display name (no extension). */
  baseName: string;
  displayName: string;
  challengeSlug: string;
  challengeDate: string;
  /** Public page for this build — included in the zip's ABOUT.txt. */
  submissionUrl: string;
  files: PlayDownloadFile[];
};

const MAX_BASE_NAME_LENGTH = 40;

/**
 * Turn a free-form display name into a safe download filename base.
 * "Sam's Maze Runner!!" → "sams-maze-runner". Falls back to "shorts-build"
 * for names that slug down to nothing (emoji-only, etc.).
 */
export function playDownloadBaseName(displayName: string | null | undefined): string {
  const slug = String(displayName || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_NAME_LENGTH)
    .replace(/-+$/, "");
  return slug || "shorts-build";
}

/**
 * Pick the download shape for a bundle: a single stored file downloads as
 * itself (a self-contained index.html opens straight in a browser — that is
 * the whole point of downloading a serverless build), anything multi-file
 * ships as a zip.
 */
export function resolvePlayDownloadFileName(
  baseName: string,
  files: PlayDownloadFile[],
): { kind: "file" | "zip"; fileName: string } {
  if (files.length === 1) {
    const match = /(\.[a-z0-9]{1,10})$/i.exec(files[0].path);
    const ext = match ? match[1].toLowerCase() : "";
    return { kind: "file", fileName: `${baseName}${ext}` };
  }
  return { kind: "zip", fileName: `${baseName}.zip` };
}

/** Plain-text provenance note included in multi-file zips. */
export function renderPlayDownloadAbout(bundle: PlayDownloadBundle): string {
  return [
    `${bundle.displayName}`,
    ``,
    `Built on Bridge Shorts — everyone gets the same challenge and the same model.`,
    `Round: ${bundle.challengeDate} (${bundle.challengeSlug})`,
    `See it ranked: ${bundle.submissionUrl}`,
    ``,
    `Open index.html in a browser to run it.`,
    ``,
  ].join("\n");
}

/**
 * Load a public submission's files for download. Public like the gallery
 * preview — anyone can grab a build; secrets dirs are already filtered out
 * of snapshots and filtered again here.
 */
export async function getPlaySubmissionDownloadBundle(
  submissionId: string,
): Promise<PlayDownloadBundle> {
  const id = String(submissionId || "").trim();
  if (!Types.ObjectId.isValid(id)) {
    throw createHttpError(400, "invalid submission id");
  }

  const Submission = getPlaySubmissionModel();
  const doc = (await Submission.findById(id)
    .select("displayName challengeSlug challengeDate files")
    .lean()) as {
    _id: Types.ObjectId;
    displayName?: string;
    challengeSlug?: string;
    challengeDate?: string;
    files?: PlayDownloadFile[];
  } | null;

  if (!doc) {
    throw createHttpError(404, "not_found");
  }

  const files = filterPlayPublicFiles(doc.files || []).filter(
    (f) => typeof f.content === "string",
  );
  if (files.length === 0) {
    throw createHttpError(404, "not_found");
  }

  return {
    baseName: playDownloadBaseName(doc.displayName),
    displayName: doc.displayName || "Untitled build",
    challengeSlug: doc.challengeSlug || "",
    challengeDate: doc.challengeDate || "",
    submissionUrl: `${getShortsClientBase()}/Submission?id=${doc._id.toString()}`,
    files,
  };
}
