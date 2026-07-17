#!/bin/bash
# Starts static preview on :8080 (keeps the sandbox alive).
# Bind 0.0.0.0 so E2B port tunneling (getHost) works.
set -euo pipefail

WORKSPACE="${PLAY_WORKSPACE:-/home/user/project}"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

# Preview stdout/stderr → log file for ops / smoke debugging.
: > /tmp/preview.log
python3 -m http.server 8080 --bind 0.0.0.0 >>/tmp/preview.log 2>&1 &
PREVIEW_PID=$!

# Ready when preview answers.
for _ in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:8080/" >/dev/null 2>&1; then
    echo "Play sandbox ready: preview=:8080" | tee -a /tmp/preview.log
    break
  fi
  sleep 1
done

# Keep sandbox alive on the preview server.
wait "$PREVIEW_PID"
