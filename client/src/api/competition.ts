import { API_BASE_URL } from "@/config/api";

export type CompetitionPublic = {
  slug: string;
  assessmentId: string;
  title: string;
  description: string;
  rulesMarkdown: string;
  registrationOpen: boolean;
  competitionStartsAt: string | null;
  competitionEndsAt: string | null;
  leaderboardPublic: boolean;
  assessment: {
    title: string;
    description: string;
    timeLimit: number;
  };
};

export type CompetitionLeaderboardResponse = {
  slug: string;
  entries: Array<{
    rank: number;
    displayName: string;
    score: number | null;
    submittedAt: string | null;
    /** Same segments as employer “Combined score” subtitle (Screen / Behavioral / Trace). */
    breakdown: string[];
  }>;
};

export type JoinCompetitionResponse = {
  token: string;
  shareLink: string;
  submissionId: string;
  candidateName: string;
};

/** Thrown when GET /competitions/:slug returns 404 (no Mongo document for this slug). */
export class CompetitionNotFoundError extends Error {
  readonly slug: string;
  constructor(slug: string) {
    super(`COMPETITION_NOT_FOUND:${slug}`);
    this.name = "CompetitionNotFoundError";
    this.slug = slug;
  }
}

function parseCompetitionError(res: Response, text: string, slug: string): Error {
  try {
    const j = text ? JSON.parse(text) : null;
    if (res.status === 404 && j?.error === "COMPETITION_NOT_FOUND") {
      return new CompetitionNotFoundError(slug);
    }
    if (j?.message) return new Error(j.message);
    if (j?.error) return new Error(String(j.error));
  } catch {
    /* use text */
  }
  return new Error(text || res.statusText);
}

export async function getCompetition(slug: string): Promise<CompetitionPublic> {
  const res = await fetch(
    `${API_BASE_URL}/competitions/${encodeURIComponent(slug)}`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw parseCompetitionError(res, text, slug);
  }
  return res.json();
}

export async function getCompetitionLeaderboard(
  slug: string,
  limit = 50,
): Promise<CompetitionLeaderboardResponse> {
  const q = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(
    `${API_BASE_URL}/competitions/${encodeURIComponent(slug)}/leaderboard?${q}`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export async function joinCompetition(
  slug: string,
  body: { candidateName: string; candidateEmail: string },
): Promise<JoinCompetitionResponse> {
  const res = await fetch(
    `${API_BASE_URL}/competitions/${encodeURIComponent(slug)}/join`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    const text = await res.text();
    try {
      const j = text ? JSON.parse(text) : null;
      if (j?.message) message = j.message;
      else if (j?.error) message = String(j.error);
      else if (text) message = text;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  return res.json();
}
