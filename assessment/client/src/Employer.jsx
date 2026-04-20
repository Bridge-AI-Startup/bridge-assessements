import { useEffect, useState } from "react";
import {
  bootstrapUser,
  createAssessment,
  generateLink,
  listSubmissions,
} from "./api.js";

const LS_KEY = "bridge-mini-api-token";

export default function Employer() {
  const [apiToken, setApiToken] = useState(() => localStorage.getItem(LS_KEY) || "");
  const [message, setMessage] = useState(null);
  const [err, setErr] = useState(null);

  const [title, setTitle] = useState("Sample assessment");
  const [description, setDescription] = useState("Describe the exercise here.");
  const [timeLimit, setTimeLimit] = useState(120);

  const [assessmentId, setAssessmentId] = useState("");
  const [candName, setCandName] = useState("");
  const [candDisplayName, setCandDisplayName] = useState("");
  const [candEmail, setCandEmail] = useState("");
  /** Honeypot (challenge E2): leave empty; bots often fill hidden fields. */
  const [honeypotWebsite, setHoneypotWebsite] = useState("");

  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [listPage, setListPage] = useState(1);
  const [listLimit, setListLimit] = useState(20);
  const [rows, setRows] = useState(null);
  const [listMeta, setListMeta] = useState(null);

  useEffect(() => {
    if (apiToken) localStorage.setItem(LS_KEY, apiToken);
  }, [apiToken]);

  async function onBootstrap() {
    setErr(null);
    setMessage(null);
    try {
      const u = await bootstrapUser({});
      setApiToken(u.apiToken);
      setMessage("Bootstrap ok — token saved.");
    } catch (e) {
      setErr(e.message);
    }
  }

  async function onCreate() {
    setErr(null);
    setMessage(null);
    try {
      const a = await createAssessment(apiToken, { title, description, timeLimit });
      setAssessmentId(a.id);
      setMessage(`Created assessment ${a.id}`);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function onGenerate() {
    setErr(null);
    setMessage(null);
    try {
      const r = await generateLink(apiToken, {
        assessmentId,
        candidateName: candName,
        candidateEmail: candEmail,
        displayName: candDisplayName || undefined,
        website: honeypotWebsite,
      });
      setMessage(`Link: ${r.shareLink}`);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function onLoadSubmissions() {
    setErr(null);
    setMessage(null);
    try {
      const data = await listSubmissions(apiToken, assessmentId, {
        status: filterStatus || undefined,
        search: search || undefined,
        page: listPage,
        limit: listLimit,
      });
      setRows(data.submissions);
      setListMeta({ page: data.page, limit: data.limit });
    } catch (e) {
      setErr(e.message);
      setRows(null);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ fontSize: "1.35rem", fontWeight: 600 }}>Employer — mini Bridge</h1>
      <p style={{ opacity: 0.85, fontSize: "0.95rem" }}>
        Core loop: create assessment → generate candidate link → track submissions (no GitHub). Exercise
        list: <code style={{ fontSize: "0.85em" }}>assessment/challenge.md</code>.
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <label style={{ display: "block", marginBottom: 6 }}>API token</label>
        <input
          style={{ width: "100%", padding: "0.5rem 0.65rem", borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder="Bearer token from seed or bootstrap"
        />
        <button type="button" style={{ marginTop: 8 }} onClick={onBootstrap}>
          Bootstrap first user (dev only)
        </button>
      </section>

      {message && (
        <p style={{ color: "#8fd460", marginTop: "1rem" }}>
          {message}
        </p>
      )}
      {err && (
        <p style={{ color: "#f87171", marginTop: "1rem" }}>
          {err}
        </p>
      )}

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Create assessment</h2>
        <label style={{ display: "block", marginTop: 8 }}>Title</label>
        <input
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label style={{ display: "block", marginTop: 8 }}>Description</label>
        <textarea
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea", minHeight: 72 }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label style={{ display: "block", marginTop: 8 }}>Time limit (minutes)</label>
        <input
          type="number"
          min={1}
          style={{ width: 120, padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={timeLimit}
          onChange={(e) => setTimeLimit(Number(e.target.value))}
        />
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={onCreate}>
            Create
          </button>
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Generate candidate link</h2>
        <label style={{ display: "block", marginTop: 8 }}>Assessment ID</label>
        <input
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={assessmentId}
          onChange={(e) => setAssessmentId(e.target.value)}
        />
        <label style={{ display: "block", marginTop: 8 }}>Candidate name</label>
        <input
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={candName}
          onChange={(e) => setCandName(e.target.value)}
        />
        <label style={{ display: "block", marginTop: 8 }}>Display name (optional)</label>
        <input
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={candDisplayName}
          onChange={(e) => setCandDisplayName(e.target.value)}
          placeholder="e.g. Ada L."
        />
        <label style={{ display: "block", marginTop: 8 }}>Candidate email</label>
        <input
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={candEmail}
          onChange={(e) => setCandEmail(e.target.value)}
        />
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={honeypotWebsite}
          onChange={(e) => setHoneypotWebsite(e.target.value)}
          style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
        />
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={onGenerate}>
            Generate link
          </button>
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Submissions for assessment</h2>
        <label style={{ display: "block", marginTop: 8 }}>Assessment ID</label>
        <input
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={assessmentId}
          onChange={(e) => setAssessmentId(e.target.value)}
        />
        <label style={{ display: "block", marginTop: 8 }}>Status filter</label>
        <select
          style={{ padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">(any)</option>
          <option value="pending">pending</option>
          <option value="in-progress">in-progress</option>
          <option value="submitted">submitted</option>
          <option value="opted-out">opted-out</option>
        </select>
        <label style={{ display: "block", marginTop: 8 }}>Search (name or email)</label>
        <input
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label style={{ display: "block", marginTop: 8 }}>Page / limit</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="number"
            min={1}
            style={{ width: 80, padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
            value={listPage}
            onChange={(e) => setListPage(Number(e.target.value))}
          />
          <input
            type="number"
            min={1}
            max={100}
            style={{ width: 80, padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
            value={listLimit}
            onChange={(e) => setListLimit(Number(e.target.value))}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={onLoadSubmissions}>
            Load submissions
          </button>
        </div>

        {listMeta && (
          <p style={{ fontSize: "0.85rem", opacity: 0.85, marginTop: 8 }}>
            Page {listMeta.page}, limit {listMeta.limit}
          </p>
        )}

        {rows && (
          <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #38444d" }}>
                <th style={{ padding: "6px 4px" }}>Display</th>
                <th style={{ padding: "6px 4px" }}>Name</th>
                <th style={{ padding: "6px 4px" }}>Email</th>
                <th style={{ padding: "6px 4px" }}>Status</th>
                <th style={{ padding: "6px 4px" }}>Time (min)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #2f3336" }}>
                  <td style={{ padding: "6px 4px" }}>{r.displayName ?? "—"}</td>
                  <td style={{ padding: "6px 4px" }}>{r.candidateName}</td>
                  <td style={{ padding: "6px 4px" }}>{r.candidateEmail}</td>
                  <td style={{ padding: "6px 4px" }}>{r.status}</td>
                  <td style={{ padding: "6px 4px" }}>{r.timeSpent ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
