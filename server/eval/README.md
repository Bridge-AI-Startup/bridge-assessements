# Assessment generation eval set

This directory holds inputs and optional gold outputs for systematically testing and improving assessment-generation prompts.

## Layout

- **`jobs/`** — Fixed job descriptions (one per file, `.txt` or `.md`). The eval runner runs the generator once per file.
- **`gold/`** — (Optional) Ideal or "good enough" outputs for comparison or few-shot use. One JSON file per job, or a single `gold.json` keyed by job id (filename without extension).

## Job description files

- `backend-node.txt` — Backend Engineer, Node.js
- `frontend-react.txt` — Frontend Engineer, React
- `fullstack.txt` — Full-Stack Engineer
- `senior-backend.txt` — Senior Backend Engineer, Python
- `mobile-react-native.txt` — Mobile Engineer, React Native

Add or edit files in `jobs/` to change the eval set. The eval runner discovers all `.txt` and `.md` files in `jobs/`.

## Gold output format

Optional. Each gold file should be valid JSON with the same shape as generator output:

```json
{
  "title": "string (6–12 words)",
  "description": "Markdown string (300–650 words, all required sections)",
  "timeLimit": 120
}
```

- **Per-job file:** e.g. `gold/backend-node.json` (same base name as `jobs/backend-node.txt`).
- **Single file:** `gold/gold.json` with keys per job id, e.g. `{ "backend-node": { "title": "...", "description": "...", "timeLimit": 120 }, ... }`.

The eval checker does not require gold files; they are for manual comparison or future scoring (e.g. section overlap, word count target).
