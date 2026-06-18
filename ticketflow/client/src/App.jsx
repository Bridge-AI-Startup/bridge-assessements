import { useCallback, useEffect, useState } from "react";
import { createTicket, fetchStats, fetchTickets, updateTicket } from "./api.js";

const PRIORITIES = ["low", "medium", "high"];
const STATUSES = ["open", "in_progress", "resolved"];

const EMPTY_FORM = {
  title: "",
  description: "",
  priority: "medium",
};

function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function App() {
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ticketData, statsData] = await Promise.all([
        fetchTickets({
          priority: priorityFilter || undefined,
          status: statusFilter || undefined,
          search: debouncedSearch || undefined,
        }),
        fetchStats(),
      ]);
      setTickets(ticketData.tickets);
      setStats(statsData.stats);
    } catch (err) {
      setError(err.message || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [priorityFilter, statusFilter, debouncedSearch]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  async function handleCreate(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await createTicket(form);
      setForm(EMPTY_FORM);
      await loadTickets();
    } catch (err) {
      setError(err.message || "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(ticketId, status) {
    setError("");
    try {
      await updateTicket(ticketId, { status });
      await loadTickets();
    } catch (err) {
      setError(err.message || "Failed to update ticket");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>TicketFlow</h1>
        <p>Support ticket triage — demo candidate submission.</p>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {stats ? (
        <section className="panel stats-bar">
          <span>Open: {stats.open}</span>
          <span>In Progress: {stats.in_progress}</span>
          <span>Resolved: {stats.resolved}</span>
        </section>
      ) : null}

      <section className="panel">
        <h2>Filters</h2>
        <div className="filters">
          <label>
            Search
            <input
              type="search"
              placeholder="Title or description"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <label>
            Priority
            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
            >
              <option value="">All priorities</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Create ticket</h2>
        <form className="form-grid" onSubmit={handleCreate}>
          <input
            required
            placeholder="Title"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
          <textarea
            required
            placeholder="Description"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
          <select
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: event.target.value })}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create ticket"}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Tickets</h2>
        {loading ? (
          <p className="muted">Loading tickets...</p>
        ) : tickets.length === 0 ? (
          <div className="empty">No tickets match the current filters.</div>
        ) : (
          <div className="ticket-list">
            {tickets.map((ticket) => (
              <article key={ticket.id} className="ticket-card">
                <h3>{ticket.title}</h3>
                <div className="ticket-meta">
                  <span className={`badge priority-${ticket.priority}`}>{ticket.priority}</span>
                  <span className={`badge status-${ticket.status}`}>
                    {ticket.status.replace("_", " ")}
                  </span>
                  <span className="muted">
                    Created {new Date(ticket.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="ticket-description">{ticket.description}</p>
                <div className="ticket-actions">
                  <select
                    value={ticket.status}
                    onChange={(event) => handleStatusChange(ticket.id, event.target.value)}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => loadTickets()}
                  >
                    Refresh
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
