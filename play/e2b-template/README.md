# Bridge Play E2B template

Custom E2B sandbox image for Play: **Claude Code CLI** + **static preview**.

Build UI is **Monaco** + **Claude chat** + **preview iframe** — code-server is not installed.

Workspace path: `/home/user/project` (E2B default user cannot write `/workspace`).

## What is baked in

| Port | Service |
|------|---------|
| 8080 | `python3 -m http.server` serving `/home/user/project` (stdout/stderr → `/tmp/preview.log`) |

Also installed: Node 22, Python 3, Claude Code CLI (`claude` on PATH).

Starter files live in `starter-project/` and are copied to `/home/user/project` at build time. Daily challenge text is **not** baked in — the session layer writes `CHALLENGE.md` later.

## Prerequisites

- E2B account with template-build quota
- `E2B_API_KEY` in `server/config.env` (same key as grading) or `play/e2b-template/.env`

## Build

```bash
cd play/e2b-template
npm install

# Dev template (use this while iterating)
npx tsx build.dev.ts
# → template name: bridge-play-dev

# Production template (when stable)
npx tsx build.prod.ts
# → template name: bridge-play-v1
```

Build can take several minutes. After success, set on the server:

```env
PLAY_E2B_TEMPLATE_ID=bridge-play-dev
```

## Smoke test

From `server/`:

```bash
npx tsx src/scripts/play-sandbox-smoke.ts
# Leave sandbox up for manual browser checks:
npx tsx src/scripts/play-sandbox-smoke.ts --keep
```

The script prints `previewUrl` (and a legacy `vscodeUrl` field that is unused). Open preview in a browser:

1. Confirm starter `index.html` loads
2. Check smoke output shows `claude_ok` / `claude` on PATH

## Claude Code install note

Template uses Anthropic’s native installer (`https://claude.ai/install.sh`), with npm fallback:

```bash
npm install -g @anthropic-ai/claude-code
```

If Anthropic changes install URLs, update `template.ts` and rebuild.

## Rebuild when

- `start.sh` changes
- `starter-project/` changes
- Claude Code install steps change
