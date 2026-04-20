import { API_BASE_URL } from "./config";

function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function bootstrapUser(body = {}) {
  const res = await fetch(`${API_BASE_URL}/users/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export async function createAssessment(token, { title, description, timeLimit }) {
  const res = await fetch(`${API_BASE_URL}/assessments`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ title, description, timeLimit }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export async function getAssessment(token, id) {
  const res = await fetch(`${API_BASE_URL}/assessments/${id}`, {
    headers: authHeaders(token),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export async function generateLink(token, { assessmentId, candidateName, candidateEmail, displayName, website }) {
  const res = await fetch(`${API_BASE_URL}/submissions/generate-link`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      assessmentId,
      candidateName,
      candidateEmail,
      ...(displayName != null ? { displayName } : {}),
      ...(website != null ? { website } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export async function listSubmissions(token, assessmentId, { status, search, page, limit } = {}) {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  if (search) q.set("search", search);
  if (page != null) q.set("page", String(page));
  if (limit != null) q.set("limit", String(limit));
  const res = await fetch(
    `${API_BASE_URL}/submissions/assessments/${assessmentId}/submissions?${q}`,
    { headers: authHeaders(token) },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export async function getSubmissionByToken(token) {
  const res = await fetch(`${API_BASE_URL}/submissions/token/${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export async function startAssessment(token) {
  const res = await fetch(`${API_BASE_URL}/submissions/token/${encodeURIComponent(token)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export async function submitAssessment(token, submissionNotes) {
  const res = await fetch(`${API_BASE_URL}/submissions/token/${encodeURIComponent(token)}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionNotes: submissionNotes || "" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}
