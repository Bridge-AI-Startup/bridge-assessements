import { useEffect, useState } from "react";

export default function App() {
  const [notes, setNotes] = useState([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState(null);

  async function load() {
    try {
      const res = await fetch("/api/notes");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotes(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addNote(e) {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: value }),
    });
    if (!res.ok) {
      setError("Could not add note");
      return;
    }
    setTitle("");
    await load();
  }

  async function toggle(note) {
    await fetch(`/api/notes/${note._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !note.done }),
    });
    await load();
  }

  async function remove(note) {
    await fetch(`/api/notes/${note._id}`, { method: "DELETE" });
    await load();
  }

  return (
    <main>
      <header>
        <p className="eyebrow">MERN take-home</p>
        <h1>Notes board</h1>
        <p className="lede">Add a note, check it off, delete it. Data lives on the Express API.</p>
      </header>

      <form onSubmit={addNote} className="row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ship runtime setup…"
          autoFocus
        />
        <button type="submit">Add</button>
      </form>

      {error ? <p className="error">{error}</p> : null}

      <ul>
        {notes.length === 0 ? (
          <li className="empty">No notes yet.</li>
        ) : (
          notes.map((note) => (
            <li key={note._id} className={note.done ? "done" : ""}>
              <button type="button" className="check" onClick={() => toggle(note)}>
                {note.done ? "✓" : ""}
              </button>
              <span>{note.title}</span>
              <button type="button" className="ghost" onClick={() => remove(note)}>
                Delete
              </button>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
