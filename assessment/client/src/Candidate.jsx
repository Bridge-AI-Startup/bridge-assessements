import { useEffect, useState } from "react";
import { getSubmissionByToken, startAssessment, submitAssessment } from "./api.js";

export default function Candidate({ initialToken }) {
  const [tokenInput, setTokenInput] = useState(initialToken);
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const d = await getSubmissionByToken(tokenInput.trim());
      setData(d);
    } catch (e) {
      setErr(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialToken) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onStart() {
    setErr(null);
    setLoading(true);
    try {
      const d = await startAssessment(tokenInput.trim());
      setData((prev) => ({
        ...prev,
        submission: { ...prev.submission, ...d.submission },
        assessment: d.assessment,
      }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit() {
    setErr(null);
    setLoading(true);
    try {
      const d = await submitAssessment(tokenInput.trim(), notes);
      setData((prev) => ({
        ...prev,
        submission: { ...prev.submission, ...d.submission },
      }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  const s = data?.submission;
  const a = data?.assessment;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ fontSize: "1.35rem", fontWeight: 600 }}>Candidate</h1>
      <p style={{ opacity: 0.85, fontSize: "0.95rem" }}>
        Open your invite link or paste the token from email.
      </p>

      <label style={{ display: "block", marginTop: "1rem" }}>Token</label>
      <input
        style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
        value={tokenInput}
        onChange={(e) => setTokenInput(e.target.value)}
      />
      <button type="button" style={{ marginTop: 8 }} onClick={load} disabled={loading}>
        Load
      </button>

      {err && <p style={{ color: "#f87171", marginTop: 12 }}>{err}</p>}

      {a && (
        <section style={{ marginTop: "1.5rem", padding: "1rem", background: "#192734", borderRadius: 8 }}>
          <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>{a.title}</h2>
          {s?.displayName ? (
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", opacity: 0.9 }}>{s.displayName}</p>
          ) : null}
          <p style={{ margin: 0, opacity: 0.9 }}>{a.description}</p>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.9rem" }}>Time limit: {a.timeLimit} min</p>
        </section>
      )}

      {s && (
        <section style={{ marginTop: "1rem" }}>
          <p>
            Status: <strong>{s.status}</strong>
          </p>
          {s.startedAt && (
            <p style={{ fontSize: "0.9rem", opacity: 0.85 }}>Started: {new Date(s.startedAt).toLocaleString()}</p>
          )}
          {s.submittedAt && (
            <p style={{ fontSize: "0.9rem", opacity: 0.85 }}>
              Submitted: {new Date(s.submittedAt).toLocaleString()} — time spent {s.timeSpent ?? "—"} min
            </p>
          )}

          {s.status === "pending" && (
            <button type="button" style={{ marginTop: 8 }} onClick={onStart} disabled={loading}>
              Start assessment
            </button>
          )}

          {s.status === "in-progress" && (
            <div style={{ marginTop: "1rem" }}>
              <label style={{ display: "block" }}>Notes for employer (optional)</label>
              <textarea
                style={{ width: "100%", minHeight: 80, padding: 8, borderRadius: 6, border: "1px solid #38444d", background: "#15202b", color: "#e7e9ea" }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button type="button" style={{ marginTop: 8 }} onClick={onSubmit} disabled={loading}>
                Submit
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
