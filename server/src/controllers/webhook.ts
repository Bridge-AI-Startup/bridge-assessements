import { RequestHandler } from "express";
import crypto from "crypto";
import SubmissionModel from "../models/submission.js";
import { generateInterviewSummary } from "../services/openai.js";

/**
 * Verify ElevenLabs webhook signature using HMAC
 * Based on: https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks
 */
function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader) {
    return false;
  }

  try {
    // Parse signature header: "t=timestamp,v0=hash"
    const headers = signatureHeader.split(",");
    const timestampHeader = headers.find((h) => h.startsWith("t="));
    const signatureHeaderPart = headers.find((h) => h.startsWith("v0="));

    if (!timestampHeader || !signatureHeaderPart) {
      return false;
    }

    const timestamp = timestampHeader.substring(2);
    const signature = signatureHeaderPart.substring(3); // Extract hash without "v0=" prefix

    // Validate timestamp (within 30 minutes)
    const reqTimestamp = parseInt(timestamp, 10) * 1000;
    const tolerance = Date.now() - 30 * 60 * 1000; // 30 minutes
    if (reqTimestamp < tolerance) {
      console.warn(
        `⚠️ [webhook] Request timestamp expired: ${new Date(
          reqTimestamp
        ).toISOString()}`
      );
      return false;
    }

    // Validate signature
    const bodyString =
      typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
    const message = `${timestamp}.${bodyString}`;
    const computedHash = crypto
      .createHmac("sha256", secret)
      .update(message)
      .digest("hex");
    const expectedSignature = "v0=" + computedHash;

    // Debug logging
    console.log("\n🔍 [verify] Signature computation details:");
    console.log(`   Timestamp: ${timestamp}`);
    console.log(`   Body string length: ${bodyString.length}`);
    console.log(`   Message length: ${message.length}`);
    console.log(
      `   Message (first 150 chars): ${message.substring(0, 150)}...`
    );
    console.log(`   Signature from header (full): ${signature}`);
    console.log(`   Signature length: ${signature.length} chars`);
    console.log(`   Computed hash (full): ${computedHash}`);
    console.log(`   Computed hash length: ${computedHash.length} chars`);

    // Check lengths before comparing (timingSafeEqual requires same length)
    if (signature.length !== computedHash.length) {
      console.log(`   ❌ Length mismatch! Cannot compare safely.`);
      console.log(`      Header signature length: ${signature.length}`);
      console.log(
        `      Computed hash length: ${computedHash.length} (expected 64 for SHA256)`
      );
      return false;
    }

    console.log(`   Match: ${signature === computedHash ? "✅ YES" : "❌ NO"}`);
    if (signature !== computedHash) {
      console.log(`   ⚠️  Hash mismatch! First 50 chars:`);
      console.log(`      Header:  ${signature.substring(0, 50)}`);
      console.log(`      Computed: ${computedHash.substring(0, 50)}`);
    }
    console.log("");

    // Compare: signature from header (without "v0=") vs computed hash (without "v0=")
    // Both are hex strings (64 chars for SHA256), convert to buffers for secure comparison
    try {
      const signatureBuffer = Buffer.from(signature, "hex");
      const computedBuffer = Buffer.from(computedHash, "hex");
      return crypto.timingSafeEqual(signatureBuffer, computedBuffer);
    } catch (error) {
      console.error(
        "❌ [webhook] Error creating buffers for comparison:",
        error
      );
      // Fallback to string comparison if hex parsing fails
      return signature === computedHash;
    }
  } catch (error) {
    console.error("❌ [webhook] Signature verification error:", error);
    return false;
  }
}

/**
 * Map ElevenLabs transcript turns to our schema format
 * Handles various transcript formats from ElevenLabs webhook payloads
 */
function mapTranscriptTurns(payloadData: any): Array<{
  role: "agent" | "candidate";
  text: string;
  startMs?: number;
  endMs?: number;
}> {
  // Try multiple possible locations for transcript data
  let transcript: any[] = [];

  if (Array.isArray(payloadData.transcript)) {
    transcript = payloadData.transcript;
  } else if (Array.isArray(payloadData.transcript_turns)) {
    transcript = payloadData.transcript_turns;
  } else if (Array.isArray(payloadData.turns)) {
    transcript = payloadData.turns;
  } else if (
    payloadData.transcript &&
    Array.isArray(payloadData.transcript.turns)
  ) {
    transcript = payloadData.transcript.turns;
  }

  if (!transcript || transcript.length === 0) {
    return [];
  }

  return transcript
    .filter((turn: any) => turn && (turn.text || turn.content || turn.message))
    .map((turn: any) => {
      // Map role: ElevenLabs uses various labels, normalize to our schema
      let role: "agent" | "candidate" = "candidate";

      // Common role mappings from ElevenLabs
      const roleStr = (
        turn.role ||
        turn.speaker ||
        turn.from ||
        ""
      ).toLowerCase();
      if (
        roleStr === "agent" ||
        roleStr === "assistant" ||
        roleStr === "system" ||
        roleStr === "interviewer" ||
        roleStr === "ai"
      ) {
        role = "agent";
      } else if (
        roleStr === "user" ||
        roleStr === "candidate" ||
        roleStr === "human" ||
        roleStr === "participant"
      ) {
        role = "candidate";
      }

      // Extract text from various possible fields
      const text =
        turn.text || turn.content || turn.message || turn.transcript || "";

      // Extract timing information (handle both snake_case and camelCase)
      const startMs =
        turn.start_ms || turn.startMs || turn.start_time_ms || undefined;
      const endMs = turn.end_ms || turn.endMs || turn.end_time_ms || undefined;

      return {
        role,
        text: text.trim(),
        startMs: startMs ? Number(startMs) : undefined,
        endMs: endMs ? Number(endMs) : undefined,
      };
    });
}

/**
 * Extract summary from webhook payload
 */
function extractSummary(payload: any): string | null {
  // Try multiple possible locations for summary
  if (payload.analysis?.transcript_summary) {
    return payload.analysis.transcript_summary;
  }
  if (payload.summary) {
    return payload.summary;
  }
  if (payload.analysis?.summary) {
    return payload.analysis.summary;
  }
  return null;
}

/**
 * ElevenLabs post-call webhook handler
 * POST /webhooks/elevenlabs
 *
 * Handles post_call_transcription events and persists transcript data to Submission
 * Based on: https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks
 */
export const handleElevenLabsWebhook: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
    if (!secret) {
      console.error("❌ [webhook] ELEVENLABS_WEBHOOK_SECRET not configured");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    // Get raw body (should be set by middleware)
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      console.error("❌ [webhook] Raw body not available");
      return res
        .status(400)
        .json({ error: "Raw body required for signature verification" });
    }

    // Verify signature
    const signatureHeader = req.headers["elevenlabs-signature"] as string;

    // Debug logging for signature verification
    console.log("\n" + "=".repeat(80));
    console.log("🔍 [webhook] Signature verification debug:");
    console.log("=".repeat(80));
    console.log(`   Secret length: ${secret.length}`);
    console.log(`   Secret preview: ${secret.substring(0, 20)}...`);
    console.log(`   Signature header: ${signatureHeader || "MISSING"}`);
    console.log(`   Raw body type: ${typeof rawBody}`);
    const rawBodyString =
      typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
    console.log(`   Raw body length: ${rawBodyString.length}`);
    console.log(
      `   Raw body preview (first 200 chars): ${rawBodyString.substring(
        0,
        200
      )}...`
    );
    console.log("=".repeat(80) + "\n");

    if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
      console.warn("❌ [webhook] Signature verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    console.log("✅ [webhook] Signature verification passed");

    // Parse JSON payload
    let payload: any;
    try {
      const bodyString =
        typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
      payload = JSON.parse(bodyString);
    } catch (error) {
      console.error("❌ [webhook] Failed to parse JSON:", error);
      return res.status(400).json({ error: "Invalid JSON" });
    }

    // Handle only transcription events
    if (payload.type !== "post_call_transcription") {
      // Return 200 for other event types (audio, etc.) - we ignore them for now
      console.log(
        `ℹ️ [webhook] Ignoring non-transcription event: ${payload.type}`
      );
      return res.status(200).json({ status: "ignored" });
    }

    const data = payload.data;
    if (!data) {
      console.error("❌ [webhook] Missing data in payload");
      return res.status(400).json({ error: "Missing data field" });
    }

    // Debug: Log the full payload structure to understand where submissionId might be
    console.log("\n🔍 [webhook] Full payload structure:");
    console.log("   payload.data keys:", Object.keys(data));
    if (data.metadata) {
      console.log("   data.metadata keys:", Object.keys(data.metadata));
      if (data.metadata.dynamic_variables) {
        console.log(
          "   data.metadata.dynamic_variables:",
          JSON.stringify(data.metadata.dynamic_variables)
        );
      }
    }
    if (data.dynamic_variables) {
      console.log(
        "   data.dynamic_variables:",
        JSON.stringify(data.dynamic_variables)
      );
    }
    if (data.conversation_initiation) {
      console.log(
        "   data.conversation_initiation keys:",
        Object.keys(data.conversation_initiation)
      );
      if (data.conversation_initiation.client_data) {
        console.log(
          "   data.conversation_initiation.client_data:",
          JSON.stringify(data.conversation_initiation.client_data)
        );
      }
    }
    if (data.conversation_initiation_client_data) {
      console.log(
        "   data.conversation_initiation_client_data:",
        JSON.stringify(data.conversation_initiation_client_data)
      );
    }
    console.log(
      "   Full data object (first 500 chars):",
      JSON.stringify(data).substring(0, 500)
    );
    console.log("");

    // Extract conversation_id and submissionId
    const conversationId = data.conversation_id;
    if (!conversationId) {
      console.error("❌ [webhook] Missing conversation_id");
      return res.status(400).json({ error: "Missing conversation_id" });
    }

    // Extract submissionId from dynamic_variables
    // ElevenLabs stores dynamic variables in conversation_initiation_client_data
    // This is the ONLY reliable location - no fallbacks
    let submissionId: string | undefined;

    // Primary location: conversation_initiation_client_data
    // This is where ElevenLabs stores the dynamic variables passed during session start
    if (data.conversation_initiation_client_data) {
      const clientData = data.conversation_initiation_client_data;
      console.log(
        "   data.conversation_initiation_client_data:",
        JSON.stringify(clientData)
      );

      // Handle different possible structures
      if (typeof clientData === "object" && clientData !== null) {
        // If it's an object, check for submissionId directly
        submissionId = (clientData as any).submissionId;

        // Also check if it's nested in a dynamic_variables property
        if (!submissionId && (clientData as any).dynamic_variables) {
          submissionId = (clientData as any).dynamic_variables.submissionId;
        }
      } else if (typeof clientData === "string") {
        // If it's a string, try to parse it as JSON
        try {
          const parsed = JSON.parse(clientData);
          submissionId =
            parsed.submissionId || parsed.dynamic_variables?.submissionId;
        } catch {
          // Not JSON, ignore
        }
      }
    }

    if (!submissionId) {
      console.error(
        `❌ [webhook] Missing submissionId in webhook payload. Type: ${payload.type}, Conversation ID: ${conversationId}`
      );
      console.error(
        `   Available keys in data: ${Object.keys(data).join(", ")}`
      );
      if (data.conversation_initiation_client_data) {
        console.error(
          `   conversation_initiation_client_data type: ${typeof data.conversation_initiation_client_data}`
        );
        console.error(
          `   conversation_initiation_client_data value: ${JSON.stringify(
            data.conversation_initiation_client_data
          )}`
        );
      }
      // Return 400 to indicate bad request - submissionId should always be present
      return res.status(400).json({
        error: "Missing submissionId in webhook payload",
        conversationId,
        debug: {
          hasConversationInitiationClientData:
            !!data.conversation_initiation_client_data,
          conversationInitiationClientDataType:
            typeof data.conversation_initiation_client_data,
        },
      });
    }

    // Find submission
    const submission = await SubmissionModel.findById(submissionId);
    if (!submission) {
      console.error(`❌ [webhook] Submission not found: ${submissionId}`);
      return res.status(404).json({ error: "Submission not found" });
    }

    // Map transcript turns (pass entire data object to handle various formats)
    const transcriptTurns = mapTranscriptTurns(data);

    // Generate summary using OpenAI instead of using ElevenLabs summary
    let summary: string | null = null;
    if (transcriptTurns.length > 0) {
      try {
        console.log(
          `🤖 [webhook] Generating interview summary from ${transcriptTurns.length} transcript turns...`
        );
        summary = await generateInterviewSummary(transcriptTurns);
        console.log("✅ [webhook] Interview summary generated successfully");
      } catch (error) {
        console.error("❌ [webhook] Error generating interview summary:", error);
        // Continue without summary - don't fail the webhook
      }
    }

    // Update submission with interview data
    // Initialize interview object if it doesn't exist
    if (!submission.interview) {
      (submission as any).interview = {};
    }

    // Preserve startedAt if it already exists (don't overwrite)
    const existingStartedAt = (submission as any).interview.startedAt;

    (submission as any).interview.provider = "elevenlabs";
    (submission as any).interview.status = "completed";
    (submission as any).interview.conversationId = conversationId;
    (submission as any).interview.transcript = {
      turns: transcriptTurns,
    };
    (submission as any).interview.summary = summary || null;
    (submission as any).interview.analysis = data.analysis || null;
    (submission as any).interview.completedAt = new Date();
    (submission as any).interview.updatedAt = new Date();

    // Preserve startedAt if it was already set
    if (existingStartedAt) {
      (submission as any).interview.startedAt = existingStartedAt;
    }

    // Mark interview field as modified for Mongoose
    submission.markModified("interview");
    await submission.save();

    // Log success
    console.log(
      `✅ [webhook] ElevenLabs transcription stored: submissionId=${submissionId}, conversationId=${conversationId}, turnsCount=${
        transcriptTurns.length
      }, hasSummary=${!!summary}`
    );

    return res.status(200).json({
      status: "success",
      submissionId,
      conversationId,
      turnsCount: transcriptTurns.length,
      hasSummary: !!summary,
    });
  } catch (error) {
    console.error("❌ [webhook] Error processing webhook:", error);
    next(error);
  }
};
