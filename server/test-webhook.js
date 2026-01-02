#!/usr/bin/env node

/**
 * Test script for ElevenLabs webhook endpoint
 *
 * Usage:
 *   node test-webhook.js <submissionId>
 *
 * This script:
 * 1. Generates a valid HMAC signature
 * 2. Sends a mock webhook payload to the local endpoint
 * 3. Displays the response
 */

import crypto from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables (same way as server does with --env-file)
function loadEnv() {
  try {
    const envFile = readFileSync(join(__dirname, "config.env"), "utf-8");
    const env = {};
    envFile.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...values] = trimmed.split("=");
        if (key && values.length > 0) {
          env[key.trim()] = values.join("=").trim();
        }
      }
    });
    return env;
  } catch (error) {
    console.error("❌ Failed to load config.env:", error.message);
    process.exit(1);
  }
}

const env = loadEnv();
const secret = env.ELEVENLABS_WEBHOOK_SECRET;

console.log("🔍 Debug: Secret loaded from config.env");
console.log(`   Secret length: ${secret ? secret.length : 0}`);
console.log(
  `   Secret preview: ${secret ? secret.substring(0, 20) + "..." : "NOT FOUND"}`
);

if (!secret) {
  console.error("❌ ELEVENLABS_WEBHOOK_SECRET not found in config.env");
  process.exit(1);
}

const submissionId = process.argv[2];

if (!submissionId) {
  console.error("❌ Usage: node test-webhook.js <submissionId>");
  console.error("   Example: node test-webhook.js 507f1f77bcf86cd799439011");
  process.exit(1);
}

// Create mock webhook payload
const payload = {
  type: "post_call_transcription",
  data: {
    conversation_id: `test-conv-${Date.now()}`,
    metadata: {
      dynamic_variables: {
        submissionId: submissionId,
      },
    },
    transcript: [
      {
        role: "agent",
        text: "Hello! Thank you for taking the time to interview with us today. Let's start with your background.",
        start_ms: 0,
        end_ms: 5000,
      },
      {
        role: "user",
        text: "Thank you for having me. I have 5 years of experience in full-stack development.",
        start_ms: 5500,
        end_ms: 10000,
      },
      {
        role: "agent",
        text: "Great! Can you walk me through how you implemented the authentication system in your submission?",
        start_ms: 10500,
        end_ms: 15000,
      },
      {
        role: "user",
        text: "Sure! I used JWT tokens with Express middleware. The tokens are signed with a secret key and expire after 24 hours.",
        start_ms: 15500,
        end_ms: 22000,
      },
    ],
    analysis: {
      transcript_summary:
        "The candidate discussed their background and explained their JWT-based authentication implementation.",
    },
  },
};

// Generate signature (matching ElevenLabs format)
const timestamp = Math.floor(Date.now() / 1000);
const payloadString = JSON.stringify(payload);
const message = `${timestamp}.${payloadString}`;
const hash = crypto.createHmac("sha256", secret).update(message).digest("hex");
const signature = `t=${timestamp},v0=${hash}`;

console.log("🔍 Debug: Signature generation");
console.log(`   Timestamp: ${timestamp}`);
console.log(`   Message length: ${message.length}`);
console.log(`   Hash: ${hash.substring(0, 20)}...`);
console.log(`   Full signature: ${signature.substring(0, 50)}...`);

console.log("🧪 Testing ElevenLabs Webhook Endpoint");
console.log("=".repeat(60));
console.log(`📋 Submission ID: ${submissionId}`);
console.log(`🔑 Secret loaded: ${secret ? "✅ Yes" : "❌ No"}`);
if (secret) {
  console.log(`   Secret length: ${secret.length} chars`);
  console.log(`   Secret preview: ${secret.substring(0, 20)}...`);
  console.log(
    `   Secret matches config.env: ${
      secret === env.ELEVENLABS_WEBHOOK_SECRET ? "✅" : "❌"
    }`
  );
}
console.log(`📝 Payload size: ${payloadString.length} bytes`);
console.log(`🔐 Signature: ${signature.substring(0, 60)}...`);
console.log("=".repeat(60));
console.log("\n📤 Sending webhook request...\n");

// Send request
try {
  const response = await fetch("http://localhost:5050/webhooks/elevenlabs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ElevenLabs-Signature": signature,
    },
    body: payloadString,
  });

  const responseText = await response.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = responseText;
  }

  console.log(`📥 Response Status: ${response.status} ${response.statusText}`);
  console.log(`📦 Response Body:`);
  console.log(JSON.stringify(responseData, null, 2));

  if (response.status === 200 && responseData.status === "success") {
    console.log("\n✅ Webhook test successful!");
    console.log(`   - Conversation ID: ${responseData.conversationId}`);
    console.log(`   - Transcript turns: ${responseData.turnsCount}`);
    console.log(`   - Has summary: ${responseData.hasSummary}`);
  } else if (response.status === 401) {
    console.log("\n❌ Signature verification failed!");
    console.log(
      "   Check that ELEVENLABS_WEBHOOK_SECRET matches ElevenLabs settings."
    );
  } else if (response.status === 404) {
    console.log("\n❌ Submission not found!");
    console.log(
      `   Verify that submission ID ${submissionId} exists in the database.`
    );
  } else {
    console.log("\n⚠️  Unexpected response");
  }
} catch (error) {
  console.error("\n❌ Request failed:", error.message);
  console.error("   Make sure the server is running on port 5050");
  process.exit(1);
}
