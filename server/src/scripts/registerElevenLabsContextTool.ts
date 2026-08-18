/**
 * Register the Bridge context-center webhook tool on an ElevenLabs
 * Conversational AI agent, so the voice agent can pull assessment /
 * conversation / timeline / code context during a call.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/registerElevenLabsContextTool.ts [--dry-run]
 *     [--agent=agent_xxx] [--url=https://.../api/agent-tools/context]
 *
 *   --local   point the tool at the ngrok tunnel currently forwarding to the
 *             local backend (auto-discovered from ngrok's API on :4040), so a
 *             live call hits this machine instead of Render. Free ngrok URLs
 *             change on every restart — re-run this after restarting the tunnel.
 *   --prod    point the tool back at the deployed Render URL.
 *   --sync-settings  also PATCH the agent's LLM and turn timeout to the
 *             code-managed values below (AGENT_LLM / AGENT_TURN_TIMEOUT_SECONDS).
 *             Dashboard edits drift silently; this makes the settings
 *             re-appliable from source.
 *
 * Env (config.env):
 *   ELEVENLABS_API_KEY  — ElevenLabs API key with Conversational AI access (required)
 *   AGENT_SECRET        — shared secret the backend expects in X-Agent-Secret (required)
 *   ELEVENLABS_AGENT_ID — default agent when --agent is not passed (optional)
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

const apiKey = process.env.ELEVENLABS_API_KEY;
const agentSecret = process.env.AGENT_SECRET;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const syncSettings = args.includes("--sync-settings");
const useProd = args.includes("--prod");
// --prod is the default, but naming it explicitly makes "switch back" obvious
// and keeps a stray --local from silently winning.
const useLocal = args.includes("--local") && !useProd;
const agentId =
  args.find((a) => a.startsWith("--agent="))?.slice("--agent=".length) ||
  process.env.ELEVENLABS_AGENT_ID ||
  DEFAULT_AGENT_ID;

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
      description:
        "Get evidence about how this candidate actually built their project: the assessment brief, the session broken into labelled episodes ('researching validation approaches'), behavioural metrics (read vs write, whether writes were tested, how much code came from the AI agent), a moment-by-moment timeline including what was on their screen, what they have said, and their code. Call this at the start of the interview with topics ['assessment','episodes','metrics'] to ground your questions, and again with a question plus topics ['code'] when they describe an implementation. Use it to ask specific questions — never read the output aloud, never mention that you have it.",
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
            question: {
              type: "string",
              description:
                "What you want to know about the candidate's code, phrased as a search query (e.g. 'how is user creation validated'). Only affects the code section. Omit if you are not asking about code.",
            },
            topics: {
              type: "array",
              description:
                "Optional: limit the response to a subset of sections, which keeps the answer fast and focused. assessment = what they were asked to build; episodes = the session as labelled stretches of work (best for grounding questions); metrics = behavioural counts like read-vs-write and whether writes were tested; timeline = moment-by-moment activity including what was on screen; conversation = what they have said; code = their actual code (pair with question). Omit for everything.",
              items: {
                type: "string",
                description:
                  "One of: assessment, episodes, metrics, timeline, conversation, code.",
                enum: [
                  "assessment",
                  "episodes",
                  "metrics",
                  "timeline",
                  "conversation",
                  "code",
                ],
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
  const existingTool = (toolsRes.json?.tools || []).find(
    (t: any) => t?.tool_config?.name === TOOL_NAME
  );

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
  const llmStale = syncSettings && currentLlm !== AGENT_LLM;
  const timeoutStale =
    syncSettings && currentTimeout !== AGENT_TURN_TIMEOUT_SECONDS;
  const turnModelStale = syncSettings && currentTurnModel !== AGENT_TURN_MODEL;

  if (alreadyAttached && !llmStale && !timeoutStale && !turnModelStale) {
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
