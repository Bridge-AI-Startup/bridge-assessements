/**
 * Register the Bridge context-center webhook tool on an ElevenLabs
 * Conversational AI agent, so the voice agent can pull assessment /
 * conversation / timeline / code context during a call.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/registerElevenLabsContextTool.ts [--dry-run]
 *     [--agent=agent_xxx] [--url=https://.../api/agent-tools/context]
 *
 *   --local   register/update the DEV twin of the tool (pointed at the ngrok
 *             tunnel, auto-discovered from :4040) on the DEV agent
 *             (ELEVENLABS_DEV_AGENT_ID — created by createElevenLabsDevAgent.ts).
 *             Never touches the production agent or its tool; point the local
 *             client at the dev agent via VITE_ELEVENLABS_AGENT_ID.
 *   --prod    (default) register/update the production tool (Render URL) on the
 *             production agent.
 *   --sync-settings  also PATCH the agent's LLM, turn timeout, turn model and
 *             conversation duration cap to the code-managed values below
 *             (AGENT_LLM / AGENT_TURN_TIMEOUT_SECONDS / AGENT_TURN_MODEL /
 *             AGENT_MAX_DURATION_SECONDS).
 *             Dashboard edits drift silently; this makes the settings
 *             re-appliable from source.
 *
 * Env (config.env):
 *   ELEVENLABS_API_KEY  — ElevenLabs API key with Conversational AI access (required)
 *   AGENT_SECRET        — shared secret the backend expects in X-Agent-Secret (required)
 *   ELEVENLABS_AGENT_ID — production agent when --agent is not passed (optional)
 *   ELEVENLABS_DEV_AGENT_ID — dev agent used by --local (required for --local)
 *
 * Idempotent: re-running updates the existing tool in place and never
 * duplicates it; the agent's other tools are preserved (tool_ids is a
 * full-replace list, so we read-modify-write).
 */
import "../config/loadEnv.js";

const API_BASE = "https://api.elevenlabs.io";
const TOOL_NAME = "get_candidate_context";
const SECRET_NAME = "bridge_agent_secret";
const DEFAULT_AGENT_ID = "agent_6401kd1h9k5ne9g9r90h5hwthc4v";
const DEFAULT_TOOL_URL =
  "https://bridge-assessements-1.onrender.com/api/agent-tools/context";

/**
 * Code-managed agent settings, applied with --sync-settings.
 *
 * AGENT_LLM: claude-haiku-4-5 (~$0.88 per 90-min session). The companion
 * prompt is ~3.5k tokens carrying 40+ prohibition rules, and a session
 * accumulates 50-80k tokens of replayed context by its final third — late-
 * session rule retention under long context is the whole job, and mini-band
 * models regress to generic-assistant defaults exactly there. History:
 * gemini-2.5-flash-lite narrated its waiting and misattributed Claude's edits
 * to the candidate (2026-08-16 Studio Bookings run); gpt-5.6-luna ($0.18/
 * session) was the first replacement but is priced in the same mini band the
 * failure came from, so it was bumped before ever running live.
 *
 * AGENT_TURN_TIMEOUT_SECONDS: how long ElevenLabs waits through candidate
 * silence before forcing the agent to take a turn. This is the agent's only
 * heartbeat — proactive timeline questions depend on it, so it must not be
 * disabled — but at the old 7s a quiet setup phase handed the model a forced
 * turn eight times a minute, and it eventually filled one with "I'll check
 * back." 25s keeps ~2 chances per minute with far less pressure.
 */
const AGENT_LLM = "claude-haiku-4-5";
const AGENT_TURN_TIMEOUT_SECONDS = 25;
/**
 * turn_v3 = contextual end-of-utterance detection (semantic completeness, not
 * silence thresholds). Candidates narrate in halting fragments while coding;
 * turn_v2 fired into mid-thought pauses and treated noise fragments ("...") as
 * finished turns, each one granting the LLM a turn to fill with filler.
 * Allowed values are not documented — probe by PATCHing an invalid value and
 * reading the validation error (as of 2026-08-17: 'turn_v2' or 'turn_v3').
 */
const AGENT_TURN_MODEL = "turn_v3";
/**
 * AGENT_MAX_DURATION_SECONDS: hard cap ElevenLabs puts on one conversation.
 * The default of 600s (10 min) silently ended the companion a tenth of the way
 * into a session — assessments here run to 240 minutes (avg ~106) — and the
 * overlay had no reconnect, so the candidate lost the voice check-in for the
 * rest of the attempt with no error anywhere. Three live sessions ended at
 * 523s/541s/592s against that ceiling before it was spotted.
 *
 * 7200s is ElevenLabs' hard maximum (it 400s above that: "has to be between 60
 * and 7200 seconds"), and it is SHORTER than the longest assessment here, so a
 * 4-hour attempt still hits the ceiling mid-session. The overlay's
 * auto-reconnect in ProctoringCompanionNotch.jsx is therefore load-bearing, not
 * a backstop — do not remove it on the assumption this cap covers the session.
 */
const AGENT_MAX_DURATION_SECONDS = 7200;

const apiKey = process.env.ELEVENLABS_API_KEY;
const agentSecret = process.env.AGENT_SECRET;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const syncSettings = args.includes("--sync-settings");
const useProd = args.includes("--prod");
// --prod is the default, but naming it explicitly makes "switch back" obvious
// and keeps a stray --local from silently winning.
const useLocal = args.includes("--local") && !useProd;

/**
 * --local used to repoint the PRODUCTION agent's tool at the developer's ngrok
 * tunnel — while set, a real candidate's tool calls hit the developer's laptop
 * (and 404'd whenever the tunnel was down). Dev work now has its own agent
 * (ELEVENLABS_DEV_AGENT_ID, created by createElevenLabsDevAgent.ts) with its
 * own ngrok-pointed twin of the tool; --local targets only those and refuses
 * to run without them. The production agent + tool are never touched by
 * --local. Point the local client at the dev agent via
 * VITE_ELEVENLABS_AGENT_ID in client/.env.local.
 */
const prodAgentId = process.env.ELEVENLABS_AGENT_ID || DEFAULT_AGENT_ID;
const devAgentId = process.env.ELEVENLABS_DEV_AGENT_ID;
const agentId =
  args.find((a) => a.startsWith("--agent="))?.slice("--agent=".length) ||
  (useLocal ? devAgentId : prodAgentId);

if (useLocal && !agentId) {
  console.error(
    "❌ --local needs a dev agent so it never hijacks the shared production agent.\n" +
      "   Create one:  npx tsx src/scripts/createElevenLabsDevAgent.ts\n" +
      "   then add ELEVENLABS_DEV_AGENT_ID=<id> to config.env and re-run."
  );
  process.exit(1);
}
if (useLocal && agentId === prodAgentId) {
  console.error(
    "❌ --local refuses to target the production agent. Set ELEVENLABS_DEV_AGENT_ID\n" +
      "   to a separate dev agent (createElevenLabsDevAgent.ts creates one)."
  );
  process.exit(1);
}

/** Ask the local ngrok agent which public URL currently forwards to the backend. */
async function discoverNgrokUrl(): Promise<string> {
  let tunnels: any;
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels");
    tunnels = await res.json();
  } catch {
    console.error(
      "❌ --local: no ngrok agent found on 127.0.0.1:4040.\n" +
        `   Start one first:  ngrok http ${process.env.PORT || 5050}`
    );
    process.exit(1);
  }
  const https = (tunnels.tunnels || []).find((t: any) =>
    t.public_url?.startsWith("https://")
  );
  if (!https) {
    console.error("❌ --local: ngrok is running but exposes no https tunnel.");
    process.exit(1);
  }
  return `${https.public_url}/api/agent-tools/context`;
}

const explicitUrl = args
  .find((a) => a.startsWith("--url="))
  ?.slice("--url=".length);
const toolUrl = explicitUrl
  ? explicitUrl
  : useLocal
    ? await discoverNgrokUrl()
    : DEFAULT_TOOL_URL;

if (!apiKey) {
  console.error(
    "❌ ELEVENLABS_API_KEY is not set in server/config.env.\n" +
      "   Create one at elevenlabs.io → Profile → API keys (needs Conversational AI permissions), then re-run."
  );
  process.exit(1);
}
if (!agentSecret) {
  console.error("❌ AGENT_SECRET is not set in server/config.env.");
  process.exit(1);
}

async function xi(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "xi-api-key": apiKey as string,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function fail(step: string, status: number, json: any): never {
  console.error(`❌ ${step} failed (HTTP ${status}):`);
  console.error(JSON.stringify(json, null, 2));
  process.exit(1);
}

/** Ensure the backend agent secret exists as an ElevenLabs workspace secret. */
async function ensureWorkspaceSecret(): Promise<string | null> {
  const list = await xi("GET", "/v1/convai/secrets");
  if (list.status === 200) {
    const existing = (list.json?.secrets || []).find(
      (s: any) => s.name === SECRET_NAME
    );
    if (existing?.secret_id) {
      console.log(`🔐 Workspace secret "${SECRET_NAME}" exists (${existing.secret_id})`);
      return existing.secret_id;
    }
  }
  if (dryRun) {
    console.log(`🔐 [dry-run] would create workspace secret "${SECRET_NAME}"`);
    return null;
  }
  const created = await xi("POST", "/v1/convai/secrets", {
    type: "new",
    name: SECRET_NAME,
    value: agentSecret,
  });
  if (created.status >= 200 && created.status < 300 && created.json?.secret_id) {
    console.log(`🔐 Created workspace secret "${SECRET_NAME}" (${created.json.secret_id})`);
    return created.json.secret_id;
  }
  console.warn(
    `⚠️ Could not create a workspace secret (HTTP ${created.status}); falling back to a static header value.`
  );
  return null;
}

function buildToolConfig(secretId: string | null) {
  return {
    tool_config: {
      type: "webhook",
      name: TOOL_NAME,
      // LIVE-companion schema: `episodes` and `code` are deliberately absent.
      // Episodes only exist after capture ends (live they always return empty),
      // and seeing the candidate's code makes hinting far too easy. They used to
      // be prompt-prohibited but schema-allowed; a 3.5k-token rule list is
      // exactly where late-session rule retention fails, so the schema now
      // enforces what the prompt asks. The server endpoint still supports both
      // topics for other consumers.
      description:
        "See what the candidate is doing right now: a moment-by-moment timeline of the prompts they sent their AI assistant and the commands, file edits and runs that followed (newest first, with what was on their screen), plus the assessment brief, behavioural counts, and what they have said aloud. Call it with topics ['timeline'] before any proactive question, and again whenever you want to know what they are working on — never ask them to describe activity this returns. Never read the output aloud, never mention that you have it.",
      response_timeout_secs: 20,
      api_schema: {
        url: toolUrl,
        method: "POST",
        request_headers: {
          "X-Agent-Secret": secretId ? { secret_id: secretId } : agentSecret,
          // Free ngrok serves an HTML interstitial to browser-like clients,
          // which would reach the agent as unparseable junk instead of JSON.
          ...(toolUrl.includes("ngrok")
            ? { "ngrok-skip-browser-warning": "true" }
            : {}),
        },
        request_body_schema: {
          type: "object",
          required: ["submissionId"],
          properties: {
            // ElevenLabs allows exactly one of description | dynamic_variable
            // per property, so the binding carries no description.
            submissionId: {
              type: "string",
              dynamic_variable: "submissionId",
            },
            topics: {
              type: "array",
              description:
                "Optional: limit the response to a subset of sections, which keeps the answer fast and focused. timeline = moment-by-moment activity, newest first (what to call before any proactive question); assessment = what they were asked to build; metrics = behavioural counts like read-vs-write and whether writes were tested; conversation = what they have said aloud. Omit for everything.",
              items: {
                type: "string",
                description:
                  "One of: assessment, metrics, timeline, conversation.",
                enum: ["assessment", "metrics", "timeline", "conversation"],
              },
            },
          },
        },
      },
    },
  };
}

async function main() {
  console.log(`Agent:    ${agentId}`);
  console.log(`Tool URL: ${toolUrl}`);
  if (dryRun) console.log("Mode:     DRY RUN (no writes)\n");

  // 1. Workspace secret for the X-Agent-Secret header.
  const secretId = await ensureWorkspaceSecret();
  const toolConfig = buildToolConfig(secretId);

  // 2. Create or update the standalone tool.
  const toolsRes = await xi("GET", "/v1/convai/tools");
  if (toolsRes.status !== 200) fail("List tools", toolsRes.status, toolsRes.json);
  // Prod and dev each own a same-named tool, told apart by where they point:
  // the dev twin lives on the ngrok tunnel, prod on a real deploy. Matching on
  // name alone here would let a dev run update the production tool in place.
  const existingTool = (toolsRes.json?.tools || []).find((t: any) => {
    if (t?.tool_config?.name !== TOOL_NAME) return false;
    const url: string = t?.tool_config?.api_schema?.url || "";
    return useLocal ? url.includes("ngrok") : !url.includes("ngrok");
  });

  let toolId: string;
  if (existingTool) {
    toolId = existingTool.id;
    console.log(`🔧 Tool "${TOOL_NAME}" exists (${toolId}) — updating in place`);
    if (!dryRun) {
      const upd = await xi("PATCH", `/v1/convai/tools/${toolId}`, toolConfig);
      if (upd.status < 200 || upd.status >= 300) fail("Update tool", upd.status, upd.json);
    }
  } else {
    if (dryRun) {
      console.log(`🔧 [dry-run] would create tool "${TOOL_NAME}":`);
      console.log(JSON.stringify(toolConfig, null, 2));
      toolId = "<new>";
    } else {
      const created = await xi("POST", "/v1/convai/tools", toolConfig);
      if (created.status < 200 || created.status >= 300)
        fail("Create tool", created.status, created.json);
      toolId = created.json?.id;
      console.log(`🔧 Created tool "${TOOL_NAME}" (${toolId})`);
    }
  }

  // 3. Attach to the agent (tool_ids is full-replace: read, append, write).
  const agentRes = await xi("GET", `/v1/convai/agents/${agentId}`);
  if (agentRes.status !== 200) fail("Get agent", agentRes.status, agentRes.json);
  const prompt = agentRes.json?.conversation_config?.agent?.prompt || {};
  const currentIds: string[] = prompt.tool_ids || [];
  console.log(`🤖 Agent "${agentRes.json?.name || agentId}" has ${currentIds.length} tool(s) attached`);

  const alreadyAttached = toolId !== "<new>" && currentIds.includes(toolId);
  const nextIds = alreadyAttached ? currentIds : [...currentIds, toolId];

  // Settings drift check (only applied with --sync-settings).
  const currentLlm = prompt.llm;
  const currentTimeout =
    agentRes.json?.conversation_config?.turn?.turn_timeout;
  const currentTurnModel =
    agentRes.json?.conversation_config?.turn?.turn_model;
  const currentMaxDuration =
    agentRes.json?.conversation_config?.conversation?.max_duration_seconds;
  const llmStale = syncSettings && currentLlm !== AGENT_LLM;
  const timeoutStale =
    syncSettings && currentTimeout !== AGENT_TURN_TIMEOUT_SECONDS;
  const turnModelStale = syncSettings && currentTurnModel !== AGENT_TURN_MODEL;
  const maxDurationStale =
    syncSettings && currentMaxDuration !== AGENT_MAX_DURATION_SECONDS;

  if (
    alreadyAttached &&
    !llmStale &&
    !timeoutStale &&
    !turnModelStale &&
    !maxDurationStale
  ) {
    console.log(
      syncSettings
        ? "✅ Tool attached and settings already in sync — nothing to do."
        : "✅ Tool already attached — nothing to do."
    );
    return;
  }

  const promptPatch: Record<string, any> = {};
  if (!alreadyAttached) promptPatch.tool_ids = nextIds;
  if (llmStale) promptPatch.llm = AGENT_LLM;
  const agentPatch: Record<string, any> = { conversation_config: {} };
  if (Object.keys(promptPatch).length > 0) {
    agentPatch.conversation_config.agent = { prompt: promptPatch };
  }
  if (timeoutStale || turnModelStale) {
    const turnPatch: Record<string, any> = {};
    if (timeoutStale) turnPatch.turn_timeout = AGENT_TURN_TIMEOUT_SECONDS;
    if (turnModelStale) turnPatch.turn_model = AGENT_TURN_MODEL;
    agentPatch.conversation_config.turn = turnPatch;
  }
  if (maxDurationStale) {
    agentPatch.conversation_config.conversation = {
      max_duration_seconds: AGENT_MAX_DURATION_SECONDS,
    };
  }

  if (!alreadyAttached)
    console.log(`🤖 attaching tool → tool_ids ${JSON.stringify(nextIds)}`);
  if (llmStale)
    console.log(`🤖 llm: ${currentLlm} → ${AGENT_LLM}`);
  if (timeoutStale)
    console.log(
      `🤖 turn_timeout: ${currentTimeout}s → ${AGENT_TURN_TIMEOUT_SECONDS}s`
    );
  if (turnModelStale)
    console.log(`🤖 turn_model: ${currentTurnModel} → ${AGENT_TURN_MODEL}`);
  if (maxDurationStale)
    console.log(
      `🤖 max_duration_seconds: ${currentMaxDuration}s → ${AGENT_MAX_DURATION_SECONDS}s ` +
        `(${Math.round(AGENT_MAX_DURATION_SECONDS / 60)} min)`
    );

  if (dryRun) {
    console.log(`🤖 [dry-run] would PATCH: ${JSON.stringify(agentPatch)}`);
    return;
  }

  const patch = await xi("PATCH", `/v1/convai/agents/${agentId}`, agentPatch);
  if (patch.status < 200 || patch.status >= 300)
    fail("Update agent", patch.status, patch.json);

  console.log("🤖 Agent updated");
  console.log("✅ Done. The agent can now call get_candidate_context during calls.");
  console.log(
    "   Verify in the dashboard: Conversational AI → your agent → Tools."
  );
}

main().catch((e) => {
  console.error("❌ Unexpected error:", e);
  process.exit(1);
});
