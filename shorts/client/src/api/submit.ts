import {
  authPost,
  getRequestErrorMessage,
  getResponseErrorMessage,
  readJsonBody,
} from "@/api/requests";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import { clearStoredSessionId } from "@/api/session";

export type SubmitSuccess = {
  submissionId: string;
  displayName: string;
  fileCount: number;
  totalBytes: number;
  challenge: {
    slug: string;
    challengeDate: string;
  };
};

export type SubmitResult =
  | { status: "ok"; result: SubmitSuccess }
  | {
      status: "error";
      message: string;
      httpStatus?: number;
      code?: string;
    };

const STARTER_ONLY_USER_MESSAGE =
  "Build something first — your project still looks like the unchanged starter.";

export async function submitSession(input: {
  sessionId: string;
  displayName: string;
}): Promise<SubmitResult> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    // authPost attaches the Firebase ID token when signed in and nothing when
    // not — a build submitted right after signing in is stamped with that
    // account server-side, so it is never left as a guest-only entry.
    const res = await authPost("/submit", {
      sessionId: input.sessionId,
      anonymousId,
      displayName: input.displayName.trim(),
    });
    const body = await readJsonBody(res);
    if (!res.ok) {
      const code = typeof body.code === "string" ? body.code : undefined;
      if (code === "starter_only" || body.error === "starter_only") {
        return {
          status: "error",
          message:
            typeof body.error === "string" && body.error !== "starter_only"
              ? body.error
              : STARTER_ONLY_USER_MESSAGE,
          httpStatus: res.status,
          code: "starter_only",
        };
      }
      if (code === "submission_limit") {
        return {
          status: "error",
          message:
            typeof body.error === "string"
              ? body.error
              : "You ran out of builds for the week.",
          httpStatus: res.status,
          code: "submission_limit",
        };
      }
      return {
        status: "error",
        message: getResponseErrorMessage(body, res.status, ["error", "message"]),
        httpStatus: res.status,
        code,
      };
    }
    clearStoredSessionId();
    return { status: "ok", result: body as SubmitSuccess };
  } catch (error) {
    return {
      status: "error",
      message: getRequestErrorMessage(error),
    };
  }
}
