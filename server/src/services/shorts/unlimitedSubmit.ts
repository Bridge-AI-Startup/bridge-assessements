import UserModel from "../../models/user.js";
import { firebaseAdminAuth } from "../../utils/firebase.js";

/**
 * Signed-in accounts that skip the 3-builds-per-round cap. Matched on the
 * verified Firebase uid (User doc email, then Auth record) — never on the
 * display name, which anyone could type.
 */
export const UNLIMITED_SUBMIT_EMAILS = ["smahadkar@ucsd.edu"] as const;

export const SUBMISSION_LIMIT_MESSAGE =
  "You ran out of builds for the week." as const;

export function isUnlimitedSubmitEmail(
  email?: string | null,
): boolean {
  const normalized = (email || "").trim().toLowerCase();
  return (UNLIMITED_SUBMIT_EMAILS as readonly string[]).includes(normalized);
}

export async function isUnlimitedSubmitter(
  firebaseUid?: string | null,
): Promise<boolean> {
  const uid = firebaseUid?.trim() || "";
  if (!uid) return false;

  try {
    const user = await UserModel.findOne({ firebaseUid: uid })
      .select("email")
      .lean();
    if (
      user &&
      typeof user === "object" &&
      isUnlimitedSubmitEmail((user as { email?: string }).email)
    ) {
      return true;
    }
  } catch {
    // Assessments User lookup is best-effort; fall through to Firebase Auth.
  }

  try {
    const record = await firebaseAdminAuth.getUser(uid);
    return isUnlimitedSubmitEmail(record.email);
  } catch {
    return false;
  }
}
