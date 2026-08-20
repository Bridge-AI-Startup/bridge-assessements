import { beforeEach, describe, expect, it, vi } from "vitest";

const lean = vi.fn(async () => null as { email?: string } | null);
const select = vi.fn(() => ({ lean }));
const findOne = vi.fn(() => ({ select }));
const getUser = vi.fn(async () => ({ email: undefined as string | undefined }));

vi.mock("../../src/models/user.js", () => ({
  default: { findOne },
}));
vi.mock("../../src/utils/firebase.js", () => ({
  firebaseAdminAuth: { getUser },
}));

const {
  isUnlimitedSubmitEmail,
  isUnlimitedSubmitter,
  SUBMISSION_LIMIT_MESSAGE,
} = await import("../../src/services/shorts/unlimitedSubmit.js");

describe("unlimitedSubmit", () => {
  beforeEach(() => {
    findOne.mockClear();
    select.mockClear();
    lean.mockReset();
    lean.mockResolvedValue(null);
    getUser.mockReset();
    getUser.mockResolvedValue({ email: undefined });
  });

  it("matches only the allowlisted email", () => {
    expect(isUnlimitedSubmitEmail("smahadkar@ucsd.edu")).toBe(true);
    expect(isUnlimitedSubmitEmail("SMAHADKAR@UCSD.EDU")).toBe(true);
    expect(isUnlimitedSubmitEmail(" saaz.m@icloud.com ")).toBe(false);
    expect(isUnlimitedSubmitEmail("guest@example.com")).toBe(false);
    expect(isUnlimitedSubmitEmail("")).toBe(false);
    expect(isUnlimitedSubmitEmail(null)).toBe(false);
  });

  it("uses the assessments User email when the uid is signed in", async () => {
    lean.mockResolvedValue({ email: "smahadkar@ucsd.edu" });
    await expect(isUnlimitedSubmitter("uid-smahadkar")).resolves.toBe(true);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("falls back to Firebase Auth when there is no User doc", async () => {
    lean.mockResolvedValue(null);
    getUser.mockResolvedValue({ email: "smahadkar@ucsd.edu" });
    await expect(isUnlimitedSubmitter("uid-smahadkar")).resolves.toBe(true);
  });

  it("returns false for a signed-in account that is not allowlisted", async () => {
    lean.mockResolvedValue({ email: "someone@example.com" });
    await expect(isUnlimitedSubmitter("uid-other")).resolves.toBe(false);
  });

  it("returns false when nobody is signed in", async () => {
    await expect(isUnlimitedSubmitter(null)).resolves.toBe(false);
    await expect(isUnlimitedSubmitter("")).resolves.toBe(false);
    expect(findOne).not.toHaveBeenCalled();
  });

  it("keeps the fourth-build copy as a weekly stop", () => {
    expect(SUBMISSION_LIMIT_MESSAGE).toBe(
      "You ran out of builds for the week.",
    );
  });
});
