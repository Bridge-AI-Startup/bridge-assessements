import express from "express";
import * as WebhookController from "../controllers/webhook.js";

const router = express.Router();

/**
 * ElevenLabs post-call webhook endpoint
 * POST /webhooks/elevenlabs
 *
 * This endpoint receives post-call transcription events from ElevenLabs
 * and persists the transcript data to the Submission document.
 *
 * Note: This route uses raw body parsing middleware (configured in server.ts)
 * to enable HMAC signature verification.
 */
router.post("/elevenlabs", WebhookController.handleElevenLabsWebhook);

export default router;
