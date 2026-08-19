import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { authGet, authPatch, authPost } from "@/api/requests";
import {
  fetchChallengePeriod,
  periodPossessive,
} from "@/lib/challengePeriod";
import AdminSubmissions from "@/pages/AdminSubmissions";
import Markdown from "@/components/Markdown";

const CATEGORIES = ["widget", "game", "tool", "other"];
const MAKE_MODES = [
  { value: "e2b", label: "E2B sandbox (Claude Code)" },
  { value: "serverless", label: "Serverless (single-file HTML)" },
];

function addUtcDays(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function emptyForm(challengeDate, lockedDate = false) {
  return {
    slug: "",
    challengeDate,
    title: "",
    prompt: "",
    tokenBudget: 50000,
    category: "widget",
    status: "draft",
    makeMode: "e2b",
    lockedDate,
    isNew: true,
  };
}

function formFromChallenge(challenge, lockedDate = false) {
  return {
    slug: challenge.slug,
    challengeDate: challenge.challengeDate,
    title: challenge.title,
    prompt: challenge.prompt,
    tokenBudget: challenge.tokenBudget,
    category: challenge.category,
    status: challenge.status,
    makeMode: challenge.makeMode ?? "e2b",
    lockedDate,
    isNew: false,
  };
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "draft", label: "Draft" },
  { id: "past", label: "Past" },
  { id: "upcoming", label: "Upcoming" },
];

export default function Admin() {
  const [authUser, setAuthUser] = useState(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInError, setSignInError] = useState(null);
  const [signingIn, setSigningIn] = useState(false);

  const [challenges, setChallenges] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [listError, setListError] = useState(null);

  const [period, setPeriod] = useState(null);
  const periodKey = period?.periodKey || "";
  const cadence = period?.cadence || "weekly";

  const [viewMode, setViewMode] = useState("today");
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [form, setForm] = useState(() => emptyForm("", true));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [filter, setFilter] = useState("all");
  const [adminTab, setAdminTab] = useState("challenges");

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => setAuthUser(user));
  }, []);

  useEffect(() => {
    fetchChallengePeriod()
      .then(setPeriod)
      .catch(() => setPeriod(null));
  }, []);

  const loadChallenges = useCallback(async () => {
    if (!auth.currentUser) return;
    setListLoading(true);
    setForbidden(false);
    setListError(null);
    try {
      const res = await authGet("/admin/challenges?limit=100");
      if (res.status === 403) {
        setForbidden(true);
        setChallenges([]);
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setChallenges(data.challenges || []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authUser) {
      loadChallenges();
    }
  }, [authUser, loadChallenges]);

  const currentChallenge = useMemo(
    () =>
      periodKey
        ? challenges.find((c) => c.challengeDate === periodKey) || null
        : null,
    [challenges, periodKey],
  );

  useEffect(() => {
    if (!authUser || listLoading || !periodKey) return;
    if (viewMode === "today") {
      if (currentChallenge) {
        setForm(formFromChallenge(currentChallenge, true));
        setSelectedSlug(currentChallenge.slug);
      } else {
        setForm(emptyForm(periodKey, true));
        setSelectedSlug(null);
      }
    }
  }, [authUser, listLoading, viewMode, currentChallenge, periodKey]);

  const filteredChallenges = useMemo(() => {
    return challenges.filter((c) => {
      if (filter === "published") return c.status === "published";
      if (filter === "draft") return c.status === "draft";
      if (!periodKey) return true;
      if (filter === "past") return c.challengeDate < periodKey;
      if (filter === "upcoming") return c.challengeDate > periodKey;
      return true;
    });
  }, [challenges, filter, periodKey]);

  async function handleSignIn(e) {
    e.preventDefault();
    setSignInError(null);
    setSigningIn(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setSignInError(
        err instanceof Error ? err.message : "Sign in failed",
      );
    } finally {
      setSigningIn(false);
    }
  }

  function selectHistoryRow(challenge) {
    setViewMode("history");
    setSelectedSlug(challenge.slug);
    setForm(
      formFromChallenge(
        challenge,
        Boolean(periodKey && challenge.challengeDate === periodKey),
      ),
    );
    setMessage(null);
  }

  function backToCurrent() {
    setViewMode("today");
    setMessage(null);
    if (currentChallenge) {
      setForm(formFromChallenge(currentChallenge, true));
      setSelectedSlug(currentChallenge.slug);
    } else if (periodKey) {
      setForm(emptyForm(periodKey, true));
      setSelectedSlug(null);
    }
  }

  function startNewScheduled() {
    setViewMode("history");
    setSelectedSlug(null);
    const nextDate = periodKey
      ? addUtcDays(periodKey, cadence === "weekly" ? 7 : 1)
      : "";
    setForm(emptyForm(nextDate, false));
    setMessage(null);
  }

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        slug: form.slug.trim().toLowerCase(),
        challengeDate: form.challengeDate,
        title: form.title.trim(),
        prompt: form.prompt,
        tokenBudget: Number(form.tokenBudget),
        category: form.category,
        status: form.status,
        makeMode: form.makeMode,
      };
      let res;
      if (form.isNew) {
        res = await authPost("/admin/challenges", payload);
      } else {
        res = await authPatch(`/admin/challenges/${selectedSlug}`, payload);
      }

      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error || body.message || `HTTP ${res.status}`,
        );
      }

      const saved = await res.json();
      await loadChallenges();

      const savedIsCurrent = Boolean(
        periodKey && saved.challengeDate === periodKey,
      );
      if (savedIsCurrent) {
        setViewMode("today");
        setSelectedSlug(saved.slug);
        setForm(formFromChallenge(saved, true));
      } else {
        setViewMode("history");
        setSelectedSlug(saved.slug);
        setForm(formFromChallenge(saved, false));
      }

      setMessage({ type: "success", text: "Challenge saved." });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    if (form.isNew) {
      setMessage({
        type: "error",
        text: "Save the challenge before publishing.",
      });
      return;
    }

    const nextStatus = form.status === "published" ? "draft" : "published";

    setSaving(true);
    setMessage(null);
    try {
      const res = await authPatch(`/admin/challenges/${selectedSlug}`, {
        status: nextStatus,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      await loadChallenges();
      setForm((prev) => ({ ...prev, status: nextStatus }));
      setMessage({
        type: "success",
        text: nextStatus === "published" ? "Published." : "Unpublished.",
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Status update failed",
      });
    } finally {
      setSaving(false);
    }
  }

  if (authUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="text-fog-light">Loading…</p>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-6">
        <form
          onSubmit={handleSignIn}
          className="w-full max-w-sm rounded-2xl border border-line bg-paper p-6 shadow-card"
        >
          <h1 className="text-xl font-semibold text-ink">Shorts Admin</h1>
          <p className="mt-1 text-sm text-fog-light">Sign in with your Bridge account</p>
          <label className="mt-4 block text-sm font-medium text-fog">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-line px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="mt-3 block text-sm font-medium text-fog">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border border-line px-3 py-2 text-sm"
              required
            />
          </label>
          {signInError && (
            <p className="mt-3 text-sm text-red-600">{signInError}</p>
          )}
          <button
            type="submit"
            disabled={signingIn}
            className="mt-4 w-full rounded-2xl bg-ink py-2 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-50"
          >
            {signingIn ? "Signing in…" : "Sign in"}
          </button>
          <Link to="/" className="mt-4 block text-center text-sm text-accent-blue hover:underline">
            Back to home
          </Link>
        </form>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-6">
        <p className="text-lg font-medium text-ink">Access denied</p>
        <p className="mt-2 text-sm text-fog-light">
          Signed in as {authUser.email} — not a Shorts admin.
        </p>
        <button
          type="button"
          onClick={() => signOut(auth)}
          className="mt-4 text-sm text-accent-blue hover:underline"
        >
          Sign out
        </button>
      </div>
    );
  }

  const editingCurrent = viewMode === "today";
  const showBackToCurrent =
    viewMode === "history" &&
    Boolean(periodKey) &&
    form.challengeDate !== periodKey;
  const possessive = periodPossessive(cadence);
  const currentLabel =
    cadence === "weekly" ? "Current week" : "Today";
  const currentChallengeTitle =
    cadence === "weekly" ? "This week's challenge" : "Today's challenge";
  const noCurrentTitle =
    cadence === "weekly"
      ? "No challenge scheduled for this week"
      : "No challenge scheduled for today";
  const backLabel =
    cadence === "weekly" ? "← Back to current week" : "← Back to today";
  const currentBadge =
    cadence === "weekly" ? "This week" : "Today";

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-ink">Shorts Admin</h1>
            <nav className="flex gap-1 rounded-2xl bg-mist p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setAdminTab("challenges")}
                className={`rounded-md px-3 py-1 ${
                  adminTab === "challenges"
                    ? "bg-paper font-medium text-ink shadow-card"
                    : "text-fog hover:text-ink"
                }`}
              >
                Challenges
              </button>
              <button
                type="button"
                onClick={() => setAdminTab("submissions")}
                className={`rounded-md px-3 py-1 ${
                  adminTab === "submissions"
                    ? "bg-paper font-medium text-ink shadow-card"
                    : "text-fog hover:text-ink"
                }`}
              >
                Submissions
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-fog-light sm:inline">{authUser.email}</span>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="text-accent-blue hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {adminTab === "submissions" ? (
        <AdminSubmissions />
      ) : (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {showBackToCurrent && (
            <button
              type="button"
              onClick={backToCurrent}
              className="text-sm font-medium text-accent-blue hover:underline"
            >
              {backLabel}
            </button>
          )}
          <button
            type="button"
            onClick={startNewScheduled}
            className="ml-auto rounded border border-line bg-paper px-3 py-1.5 text-sm text-fog hover:bg-paper"
          >
            New challenge
          </button>
        </div>

        <section className="rounded-2xl border border-line bg-paper p-5 shadow-card">
          <h2 className="text-base font-semibold text-ink">
            {editingCurrent && !currentChallenge && form.isNew
              ? noCurrentTitle
              : editingCurrent
                ? currentChallengeTitle
                : `Edit: ${form.challengeDate}`}
          </h2>
          {editingCurrent && periodKey && (
            <p className="mt-1 text-xs text-fog-light">
              {currentLabel} · period key: {periodKey}
              {cadence === "weekly" ? " (Monday UTC)" : " (UTC)"}
            </p>
          )}

          {!periodKey ? (
            <p className="mt-4 text-sm text-fog-light">
              Loading {possessive} period…
            </p>
          ) : listLoading ? (
            <p className="mt-4 text-sm text-fog-light">Loading…</p>
          ) : (
            <form onSubmit={handleSave} className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-fog">Slug</span>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => updateField("slug", e.target.value)}
                    disabled={!form.isNew}
                    pattern="[-a-z0-9]+"
                    title="Lowercase letters, numbers, and hyphens only"
                    className="mt-1 w-full rounded border border-line px-3 py-2 font-mono text-sm disabled:bg-mist"
                    required
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-fog">
                    {cadence === "weekly"
                      ? "Week start (Monday UTC)"
                      : "Date (UTC)"}
                  </span>
                  <input
                    type="date"
                    value={form.challengeDate}
                    onChange={(e) => updateField("challengeDate", e.target.value)}
                    disabled={form.lockedDate}
                    className="mt-1 w-full rounded border border-line px-3 py-2 text-sm disabled:bg-mist"
                    required
                  />
                  {cadence === "weekly" && !form.lockedDate && (
                    <p className="mt-1 text-xs text-fog-light">
                      Use the Monday UTC that starts the challenge week.
                    </p>
                  )}
                </label>
              </div>

              <label className="block text-sm">
                <span className="font-medium text-fog">Title</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  maxLength={120}
                  className="mt-1 w-full rounded border border-line px-3 py-2 text-sm"
                  required
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-fog">Challenge</span>
                <textarea
                  value={form.prompt}
                  onChange={(e) => updateField("prompt", e.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded border border-line px-3 py-2 font-mono text-sm"
                  required
                />
                <p className="mt-1 text-xs text-fog-light">
                  Remind builders that Preview shows{" "}
                  <code className="rounded bg-mist px-1">index.html</code>{" "}
                  (static — no Vite/npm). The server also appends preview rules to{" "}
                  <code className="rounded bg-mist px-1">CHALLENGE.md</code>.
                </p>
              </label>

              {form.prompt.trim() && (
                <div className="rounded-xl border border-line bg-paper p-4">
                  <p className="label-mono mb-2">
                    Preview — how builders will see it
                  </p>
                  <Markdown text={form.prompt} />
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="font-medium text-fog">Token budget</span>
                  <input
                    type="number"
                    value={form.tokenBudget}
                    onChange={(e) => updateField("tokenBudget", e.target.value)}
                    min={1}
                    className="mt-1 w-full rounded border border-line px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-fog">Category</span>
                  <select
                    value={form.category}
                    onChange={(e) => updateField("category", e.target.value)}
                    className="mt-1 w-full rounded border border-line px-3 py-2 text-sm"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-fog">Build mode</span>
                  <select
                    value={form.makeMode}
                    onChange={(e) => updateField("makeMode", e.target.value)}
                    className="mt-1 w-full rounded border border-line px-3 py-2 text-sm"
                  >
                    {MAKE_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-fog-light">
                    Serverless generates a single-file HTML app with no sandbox.
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    form.status === "published"
                      ? "bg-accent-emerald/10 text-accent-emerald"
                      : "bg-accent-amber/10 text-accent-amber"
                  }`}
                >
                  {form.status}
                </span>
              </div>

              {message && (
                <p
                  className={`text-sm ${
                    message.type === "success" ? "text-emerald-700" : "text-red-600"
                  }`}
                >
                  {message.text}
                </p>
              )}

              {listError && (
                <p className="text-sm text-red-600">{listError}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  disabled={saving || form.isNew}
                  onClick={togglePublish}
                  className="rounded-2xl border border-line bg-paper px-4 py-2 text-sm font-medium text-fog hover:bg-paper disabled:opacity-50"
                >
                  {form.status === "published" ? "Unpublish" : "Publish"}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="mt-6">
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-2xl border border-line bg-paper px-4 py-3 text-left text-sm font-medium text-ink shadow-card"
          >
            Challenge history
            <span className="text-fog-light">{historyOpen ? "▾" : "▸"}</span>
          </button>

          {historyOpen && (
            <div className="mt-2 rounded-2xl border border-line bg-paper shadow-card">
              <div className="flex flex-wrap gap-1 border-b border-line p-2">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    className={`rounded px-2 py-1 text-xs ${
                      filter === f.id
                        ? "bg-ink text-white"
                        : "bg-mist text-fog hover:bg-line"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-paper text-xs uppercase text-fog-light">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Title</th>
                      <th className="px-3 py-2 hidden sm:table-cell">Slug</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChallenges.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-fog-light">
                          No challenges
                        </td>
                      </tr>
                    )}
                    {filteredChallenges.map((c) => {
                      const isPast = periodKey && c.challengeDate < periodKey;
                      const isCurrent =
                        Boolean(periodKey) && c.challengeDate === periodKey;
                      const isFuture = periodKey && c.challengeDate > periodKey;
                      const selected = c.slug === selectedSlug;
                      return (
                        <tr
                          key={c.slug}
                          onClick={() => selectHistoryRow(c)}
                          className={`cursor-pointer border-t border-line hover:bg-paper ${
                            selected ? "bg-accent-blue/5" : ""
                          } ${isPast ? "text-fog-light" : "text-ink"}`}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            {c.challengeDate}
                            {isCurrent && (
                              <span className="ml-1 text-xs font-medium text-accent-blue">
                                {currentBadge}
                              </span>
                            )}
                            {isFuture && (
                              <span className="ml-1 text-xs text-accent-violet">
                                Scheduled
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">{c.title}</td>
                          <td className="px-3 py-2 font-mono text-xs hidden sm:table-cell">
                            {c.slug}
                          </td>
                          <td className="px-3 py-2 capitalize">{c.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
      )}
    </div>
  );
}
