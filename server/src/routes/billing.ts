/**
 * Billing routes
 * Handles Stripe Checkout and webhook endpoints
 */

import express from "express";
import { verifyAuthToken } from "../validators/auth.js";
import * as BillingController from "../controllers/billing.js";

const router = express.Router();

// Create checkout session (requires authentication)
router.post(
  "/checkout",
  verifyAuthToken,
  BillingController.createCheckoutSession
);

// Get billing status (requires authentication)
router.get("/status", verifyAuthToken, BillingController.getBillingStatus);

// Cancel subscription (requires authentication)
router.post("/cancel", verifyAuthToken, BillingController.cancelSubscription);

// Reactivate subscription (requires authentication)
router.post(
  "/reactivate",
  verifyAuthToken,
  BillingController.reactivateSubscription
);

// Stripe webhook (no authentication, uses signature verification)
router.post("/webhook", BillingController.handleStripeWebhook);

export default router;
