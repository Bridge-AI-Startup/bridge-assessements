import { randomBytes } from "node:crypto";

export type SubmissionStatus =
  | "pending"
  | "in-progress"
  | "submitted"
  | "opted-out"
  | "expired";

export type UserRecord = {
  id: string;
  email: string;
  companyName: string;
  apiToken: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AssessmentRecord = {
  id: string;
  userId: string;
  title: string;
  description: string;
  timeLimit: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SubmissionRecord = {
  id: string;
  token: string;
  assessmentId: string;
  candidateName: string;
  displayName: string;
  candidateEmail: string;
  status: SubmissionStatus;
  startedAt: Date | null;
  submittedAt: Date | null;
  timeSpent: number | null;
  submissionNotes: string;
  optedOut: boolean;
  optOutReason: string;
  createdAt: Date;
  updatedAt: Date;
};

type StoreState = {
  users: UserRecord[];
  assessments: AssessmentRecord[];
  submissions: SubmissionRecord[];
};

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function now(): Date {
  return new Date();
}

let state: StoreState = {
  users: [],
  assessments: [],
  submissions: [],
};

export function clearStore(): void {
  state = { users: [], assessments: [], submissions: [] };
}

export function seedStore(): {
  user: UserRecord;
  assessments: [AssessmentRecord, AssessmentRecord];
  submissions: [SubmissionRecord, SubmissionRecord, SubmissionRecord];
} {
  clearStore();
  const ts = now();
  const user: UserRecord = {
    id: makeId("usr"),
    email: "seed@bridge-mini.local",
    companyName: "Seed Co",
    apiToken: "brk_seed_assessment_local",
    createdAt: ts,
    updatedAt: ts,
  };
  state.users.push(user);

  const a1: AssessmentRecord = {
    id: makeId("assess"),
    userId: user.id,
    title: "Backend API exercise",
    description: "Implement the assessment endpoints.",
    timeLimit: 120,
    createdAt: ts,
    updatedAt: ts,
  };
  const a2: AssessmentRecord = {
    id: makeId("assess"),
    userId: user.id,
    title: "Frontend take-home",
    description: "Build a small React flow.",
    timeLimit: 90,
    createdAt: ts,
    updatedAt: ts,
  };
  state.assessments.push(a1, a2);

  const s1: SubmissionRecord = {
    id: makeId("sub"),
    token: "seed_pending_token",
    assessmentId: a1.id,
    candidateName: "Ada",
    displayName: "Ada L.",
    candidateEmail: "ada@example.com",
    status: "pending",
    startedAt: null,
    submittedAt: null,
    timeSpent: null,
    submissionNotes: "",
    optedOut: false,
    optOutReason: "",
    createdAt: ts,
    updatedAt: ts,
  };
  const s2: SubmissionRecord = {
    id: makeId("sub"),
    token: "seed_in_progress_token",
    assessmentId: a1.id,
    candidateName: "Bob",
    displayName: "",
    candidateEmail: "bob@example.com",
    status: "in-progress",
    startedAt: new Date(Date.now() - 15 * 60_000),
    submittedAt: null,
    timeSpent: null,
    submissionNotes: "",
    optedOut: false,
    optOutReason: "",
    createdAt: ts,
    updatedAt: ts,
  };
  const s3: SubmissionRecord = {
    id: makeId("sub"),
    token: "seed_submitted_token",
    assessmentId: a2.id,
    candidateName: "Chen",
    displayName: "",
    candidateEmail: "chen@example.com",
    status: "submitted",
    startedAt: new Date(Date.now() - 120 * 60_000),
    submittedAt: new Date(Date.now() - 30 * 60_000),
    timeSpent: 90,
    submissionNotes: "Completed all tasks.",
    optedOut: false,
    optOutReason: "",
    createdAt: ts,
    updatedAt: ts,
  };
  state.submissions.push(s1, s2, s3);

  return { user, assessments: [a1, a2], submissions: [s1, s2, s3] };
}

export function listUsers(): UserRecord[] {
  return state.users;
}

export function findUserByApiToken(apiToken: string): UserRecord | undefined {
  return state.users.find((u) => u.apiToken === apiToken);
}

export function createUser(input: {
  email: string;
  companyName: string;
  apiToken: string;
}): UserRecord {
  const t = now();
  const user: UserRecord = {
    id: makeId("usr"),
    email: input.email,
    companyName: input.companyName,
    apiToken: input.apiToken,
    createdAt: t,
    updatedAt: t,
  };
  state.users.push(user);
  return user;
}

export function createAssessment(input: {
  userId: string;
  title: string;
  description: string;
  timeLimit: number;
}): AssessmentRecord {
  const t = now();
  const assessment: AssessmentRecord = {
    id: makeId("assess"),
    userId: input.userId,
    title: input.title,
    description: input.description,
    timeLimit: input.timeLimit,
    createdAt: t,
    updatedAt: t,
  };
  state.assessments.push(assessment);
  return assessment;
}

export function findAssessmentById(id: string): AssessmentRecord | undefined {
  return state.assessments.find((a) => a.id === id);
}

export function findAssessmentByIdAndUser(
  id: string,
  userId: string,
): AssessmentRecord | undefined {
  return state.assessments.find((a) => a.id === id && a.userId === userId);
}

export function createSubmission(input: {
  token: string;
  assessmentId: string;
  candidateName: string;
  displayName: string;
  candidateEmail: string;
  status: SubmissionStatus;
}): SubmissionRecord {
  const t = now();
  const submission: SubmissionRecord = {
    id: makeId("sub"),
    token: input.token,
    assessmentId: input.assessmentId,
    candidateName: input.candidateName,
    displayName: input.displayName,
    candidateEmail: input.candidateEmail,
    status: input.status,
    startedAt: null,
    submittedAt: null,
    timeSpent: null,
    submissionNotes: "",
    optedOut: false,
    optOutReason: "",
    createdAt: t,
    updatedAt: t,
  };
  state.submissions.push(submission);
  return submission;
}

export function findSubmissionByToken(token: string): SubmissionRecord | undefined {
  return state.submissions.find((s) => s.token === token);
}

export function findSubmissionByAssessmentAndEmail(
  assessmentId: string,
  candidateEmail: string,
): SubmissionRecord | undefined {
  return state.submissions.find(
    (s) => s.assessmentId === assessmentId && s.candidateEmail === candidateEmail,
  );
}

export function listSubmissionsByAssessment(
  assessmentId: string,
): SubmissionRecord[] {
  return state.submissions.filter((s) => s.assessmentId === assessmentId);
}

export function touchSubmission(sub: SubmissionRecord): void {
  sub.updatedAt = now();
}
