/**
 * Create a DEV twin of the production ElevenLabs companion agent, so local
 * testing (`registerElevenLabsContextTool.ts --local`) never touches the
 * shared production agent. Before this existed, --local repointed the
 * production agent's tool at the developer's ngrok tunnel — while set, a real
 * candidate's tool calls hit the developer's laptop.
 *
 * Copies the production agent's conversation_config and platform_settings
 * (so the prompt/first_message override switches carry over), strips the
 * tool_ids (the dev agent gets its own ngrok-pointed tool from the register
 * script), and names it "<prod name> (dev)".
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/createElevenLabsDevAgent.ts [--dry-run]
 *
 * Then:
 *   1. Add the printed id to config.env:      ELEVENLABS_DEV_AGENT_ID=agent_…
 *   2. Point the local client at it:          VITE_ELEVENLABS_AGENT_ID=agent_…  (client/.env.local)
 *   3. Register the dev tool (needs ngrok):   npx tsx src/scripts/registerElevenLabsContextTool.ts --local --sync-settings
 *
 * Idempotent-ish: refuses to create a second dev agent if one with the target
 * name already exists (delete it in the dashboard first if you want a fresh one).
 */
import "../config/loadEnv.js";

const API_BASE = "https://api.elevenlabs.io";
const DEFAULT_AGENT_ID = "agent_6401kd1h9k5ne9g9r90h5hwthc4v";

const apiKey = process.env.ELEVENLABS_API_KEY;
const prodAgentId = process.env.ELEVENLABS_AGENT_ID || DEFAULT_AGENT_ID;
const dryRun = process.argv.includes("--dry-run");

async function xi(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "xi-api-key": apiKey as string,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response
  }
  return { status: res.status, json };
}

async function main() {
  if (!apiKey) {
    console.error("❌ ELEVENLABS_API_KEY missing from config.env");
    process.exit(1);
  }
  if (process.env.ELEVENLABS_DEV_AGENT_ID) {
    console.log(
      `✅ ELEVENLABS_DEV_AGENT_ID is already set (${process.env.ELEVENLABS_DEV_AGENT_ID}) — nothing to do.`
    );
    return;
  }

  const prod = await xi("GET", `/v1/convai/agents/${prodAgentId}`);
  if (prod.status !== 200) {
    console.error(`❌ Get production agent failed (HTTP ${prod.status}):`, prod.json);
    process.exit(1);
  }
  const prodName: string = prod.json?.name || "Interview";
  const devName = `${prodName} (dev)`;

  // Refuse to duplicate an existing dev agent.
  const list = await xi("GET", "/v1/convai/agents?page_size=100");
  const existing = (list.json?.agents || []).find((a: any) => a?.name === devName);
  if (existing) {
    console.log(`✅ Dev agent "${devName}" already exists: ${existing.agent_id}`);
    console.log(`   Add to config.env:  ELEVENLABS_DEV_AGENT_ID=${existing.agent_id}`);
    return;
  }

  const conversationConfig = structuredClone(prod.json?.conversation_config || {});
  // The dev agent gets its own ngrok-pointed tool from the register script —
  // sharing the production tool would defeat the isolation this exists for.
  if (conversationConfig?.agent?.prompt?.tool_ids) {
    conversationConfig.agent.prompt.tool_ids = [];
  }

  const body = {
    name: devName,
    conversation_config: conversationConfig,
    // Carries the prompt/first_message override switches — without them the
    // overlay's startSession overrides are silently ignored.
    platform_settings: prod.json?.platform_settings || undefined,
  };

  if (dryRun) {
    console.log(`[dry-run] would create agent "${devName}" copying ${prodAgentId}`);
    return;
  }

  const created = await xi("POST", "/v1/convai/agents/create", body);
  if (created.status < 200 || created.status >= 300) {
    console.error(`❌ Create dev agent failed (HTTP ${created.status}):`, JSON.stringify(created.json)?.slice(0, 500));
    process.exit(1);
  }
  const devId = created.json?.agent_id;
  console.log(`✅ Created dev agent "${devName}": ${devId}`);

  // ElevenLabs clones the source agent's webhook tools on create even when the
  // submitted tool_ids is empty (observed 2026-08-19: the new agent arrived
  // holding a same-named copy of the production tool, pointed at Render).
  // Strip those clones so the register script's ngrok twin is the only tool.
  const fresh = await xi("GET", `/v1/convai/agents/${devId}`);
  const clonedIds: string[] =
    fresh.json?.conversation_config?.agent?.prompt?.tool_ids || [];
  if (clonedIds.length > 0) {
    await xi("PATCH", `/v1/convai/agents/${devId}`, {
      conversation_config: { agent: { prompt: { tool_ids: [] } } },
    });
    for (const id of clonedIds) {
      const del = await xi("DELETE", `/v1/convai/tools/${id}`);
      console.log(`🧹 removed cloned tool ${id} (HTTP ${del.status})`);
    }
  }
  console.log("");
  console.log("Next steps:");
  console.log(`  1. config.env:          ELEVENLABS_DEV_AGENT_ID=${devId}`);
  console.log(`  2. client/.env.local:   VITE_ELEVENLABS_AGENT_ID=${devId}`);
  console.log("  3. With ngrok running:  npx tsx src/scripts/registerElevenLabsContextTool.ts --local --sync-settings");
}

main().catch((e) => {
  console.error("❌ Unexpected error:", e);
  process.exit(1);
});
