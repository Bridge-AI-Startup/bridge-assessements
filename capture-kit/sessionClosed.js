/**
 * Local flag that the Bridge capture session has ended (submit / opt-out /
 * time expired). The kit cannot uninstall Claude Code hooks remotely, so
 * this is how subsequent hook fires become a no-op instead of retrying forever.
 */

const fs = require("fs");
const path = require("path");

const ENDED_PATH = path.join(process.cwd(), ".bridge", "ended");

function isSessionClosed() {
  try {
    return fs.existsSync(ENDED_PATH);
  } catch {
    return false;
  }
}

function markSessionClosed() {
  try {
    fs.writeFileSync(ENDED_PATH, new Date().toISOString());
  } catch {
    /* non-fatal */
  }
}

function applyClosedResponse(data) {
  const body = data && typeof data === "object" ? data : {};
  if (
    body.closed === true ||
    body.note === "session_completed" ||
    body.error === "submission_closed"
  ) {
    markSessionClosed();
    return true;
  }
  return false;
}

module.exports = {
  isSessionClosed,
  markSessionClosed,
  applyClosedResponse,
};
