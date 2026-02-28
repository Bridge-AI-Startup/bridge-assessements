/**
 * Billing controller
 * Handles Stripe Checkout session creation and webhook processing
 */

import { RequestHandler } from "express";
import Stripe from "stripe";
import { stripe } from "../services/stripe.js";
import { getUserIdFromFirebaseUid } from "../utils/auth.js";
import UserModel from "../models/user.js";
import { AuthError } from "../errors/auth.js";

/**
 * Create Stripe Checkout Session
 * POST /api/billing/checkout
 */
export const createCheckoutSession: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid: string };

    if (!uid) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const userId = await getUserIdFromFirebaseUid(uid);
    const user = await UserModel.findById(userId);

    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    // Validate required environment variables
    if (!process.env.STRIPE_PRICE_ID) {
      throw new Error("STRIPE_PRICE_ID is not configured");
    }

    if (!process.env.APP_URL) {
      throw new Error("APP_URL is not configured");
    }

    // Create or retrieve Stripe Customer
    let customerId =
      user.stripeCustomerId || (user as any).subscription?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: userId,
        },
      });
      customerId = customer.id;

      // Save customer ID to user
      user.stripeCustomerId = customerId;
      // Also update nested field for backwards compatibility
      if (!(user as any).subscription) {
        (user as any).subscription = {};
      }
      (user as any).subscription.stripeCustomerId = customerId;
      await user.save();
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      client_reference_id: userId,
      metadata: {
        userId: userId,
      },
      success_url: `${process.env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/billing/cancel`,
    });

    res.status(200).json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("❌ [billing] Error creating checkout session:", error);
    next(error);
  }
};

/**
 * Get billing status
 * GET /api/billing/status
 */
export const getBillingStatus: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid: string };

    if (!uid) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const userId = await getUserIdFromFirebaseUid(uid);
    const user = await UserModel.findById(userId);

    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    res.status(200).json({
      subscribed:
        user.subscriptionStatus === "active" ||
        (user as any).subscription?.subscriptionStatus === "active",
      subscriptionStatus:
        user.subscriptionStatus ||
        (user as any).subscription?.subscriptionStatus ||
        null,
      currentPeriodEnd:
        user.currentPeriodEnd ||
        (user as any).subscription?.currentPeriodEnd ||
        null,
      cancelAtPeriodEnd: user.cancelAtPeriodEnd || false,
      stripeCustomerId:
        user.stripeCustomerId ||
        (user as any).subscription?.stripeCustomerId ||
        null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel subscription
 * POST /api/billing/cancel
 */
export const cancelSubscription: RequestHandler = async (req, res, next) => {
  try {
    const { uid, reason } = req.body as { uid: string; reason?: string };

    if (!uid) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const userId = await getUserIdFromFirebaseUid(uid);
    const user = await UserModel.findById(userId);

    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const subscriptionId =
      user.stripeSubscriptionId ||
      (user as any).subscription?.stripeSubscriptionId;

    if (!subscriptionId) {
      return res.status(400).json({
        error: "NO_SUBSCRIPTION",
        message: "No active subscription found.",
      });
    }

    // Cancel the subscription at period end (don't cancel immediately)
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // Update user's cancelAtPeriodEnd flag and store cancellation reason
    user.cancelAtPeriodEnd = true;
    if (reason) {
      (user as any).cancellationReason = reason;
      (user as any).cancellationDate = new Date();
    }
    await user.save();

    // Log cancellation reason if provided
    if (reason) {
      console.log(
        `📝 [billing] Cancellation reason stored for ${subscriptionId}: ${reason}`
      );
    }

    console.log(
      "✅ [billing] Subscription scheduled for cancellation:",
      subscriptionId
    );

    res.status(200).json({
      success: true,
      message:
        "Subscription will be canceled at the end of the billing period.",
      cancelAtPeriodEnd: true,
    });
  } catch (error) {
    console.error("❌ [billing] Error canceling subscription:", error);
    next(error);
  }
};

/**
 * Reactivate subscription (remove cancellation)
 * POST /api/billing/reactivate
 */
export const reactivateSubscription: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { uid } = req.body as { uid: string };

    if (!uid) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const userId = await getUserIdFromFirebaseUid(uid);
    const user = await UserModel.findById(userId);

    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const subscriptionId =
      user.stripeSubscriptionId ||
      (user as any).subscription?.stripeSubscriptionId;

    if (!subscriptionId) {
      return res.status(400).json({
        error: "NO_SUBSCRIPTION",
        message: "No subscription found.",
      });
    }

    // Reactivate by removing cancel_at_period_end
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });

    // Update user's cancelAtPeriodEnd flag and clear cancellation reason
    user.cancelAtPeriodEnd = false;
    (user as any).cancellationReason = null;
    (user as any).cancellationDate = null;
    await user.save();

    console.log("✅ [billing] Subscription reactivated:", subscriptionId);

    res.status(200).json({
      success: true,
      message: "Subscription has been reactivated.",
      cancelAtPeriodEnd: false,
    });
  } catch (error) {
    console.error("❌ [billing] Error reactivating subscription:", error);
    next(error);
  }
};

/**
 * Handle Stripe webhook events
 * POST /api/billing/webhook
 * This endpoint must use raw body parsing (configured in server.ts)
 */
export const handleStripeWebhook: RequestHandler = async (req, res, next) => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("❌ [billing] STRIPE_WEBHOOK_SECRET is not configured");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  // Get raw body (must be Buffer for Stripe signature verification)
  const rawBody = (req as any).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    console.error("❌ [billing] Raw body is missing or not a Buffer");
    return res.status(400).json({ error: "Invalid request body" });
  }

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error(
      "❌ [billing] Webhook signature verification failed:",
      err.message
    );
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle the event
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionEvent(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      default:
        console.log(`ℹ️ [billing] Unhandled event type: ${event.type}`);
    }

    // Return 200 quickly to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ [billing] Error processing webhook:", error);
    // Still return 200 to prevent Stripe from retrying
    // Log the error for manual investigation
    res
      .status(200)
      .json({ received: true, error: "Processing failed but acknowledged" });
  }
};

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session
) {
  console.log(
    "🔄 [billing] Processing checkout.session.completed:",
    session.id
  );

  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  const userId = session.metadata?.userId || session.client_reference_id;

  if (!userId) {
    console.error(
      "❌ [billing] No userId found in checkout session metadata or client_reference_id"
    );
    return;
  }

  // Find user by userId, customerId, or subscriptionId
  let user = await UserModel.findById(userId);

  if (!user && customerId) {
    user = await UserModel.findOne({
      $or: [
        { stripeCustomerId: customerId },
        { "subscription.stripeCustomerId": customerId },
      ],
    });
  }

  if (!user) {
    console.error(
      "❌ [billing] User not found for checkout session:",
      session.id
    );
    return;
  }

  // Update user with Stripe IDs
  if (customerId && !user.stripeCustomerId) {
    user.stripeCustomerId = customerId;
    if (!(user as any).subscription) {
      (user as any).subscription = {};
    }
    (user as any).subscription.stripeCustomerId = customerId;
  }

  if (subscriptionId && !user.stripeSubscriptionId) {
    user.stripeSubscriptionId = subscriptionId;
    if (!(user as any).subscription) {
      (user as any).subscription = {};
    }
    (user as any).subscription.stripeSubscriptionId = subscriptionId;
  }

  // If subscription exists, fetch it to get status
  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await updateUserFromSubscription(user, subscription);
    } catch (error) {
      console.error("❌ [billing] Error fetching subscription:", error);
    }
  }

  await user.save();
  console.log("✅ [billing] Updated user from checkout session:", user._id);
}

/**
 * Handle subscription created/updated events
 */
async function handleSubscriptionEvent(subscription: Stripe.Subscription) {
  console.log(
    `🔄 [billing] Processing ${subscription.status} subscription:`,
    subscription.id,
    `cancel_at_period_end: ${subscription.cancel_at_period_end}`
  );

  const customerId = subscription.customer as string;
  const subscriptionId = subscription.id;

  // Find user by customerId or subscriptionId
  let user = await UserModel.findOne({
    $or: [
      { stripeCustomerId: customerId },
      { stripeSubscriptionId: subscriptionId },
      { "subscription.stripeCustomerId": customerId },
      { "subscription.stripeSubscriptionId": subscriptionId },
    ],
  });

  if (!user) {
    console.error(
      "❌ [billing] User not found for subscription:",
      subscriptionId
    );
    return;
  }

  // If subscription status is "canceled", handle it like a deletion
  if (subscription.status === "canceled") {
    console.log(
      "⚠️ [billing] Subscription is canceled, updating user to free tier:",
      subscriptionId
    );
    user.subscriptionStatus = "canceled";
    if (!(user as any).subscription) {
      (user as any).subscription = {};
    }
    (user as any).subscription.subscriptionStatus = "canceled";
    (user as any).subscription.tier = "free";
    user.cancelAtPeriodEnd = false;
    await user.save();
    console.log("✅ [billing] Updated user to canceled status:", user._id);
    return;
  }

  await updateUserFromSubscription(user, subscription);
  await user.save();
  console.log("✅ [billing] Updated user from subscription event:", user._id);
}

/**
 * Handle subscription deleted event
 * This is triggered when Stripe actually cancels the subscription at period end
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log(
    "🔄 [billing] Processing subscription deleted (canceled at period end):",
    subscription.id
  );

  const customerId = subscription.customer as string;
  const subscriptionId = subscription.id;

  // Find user by customerId or subscriptionId
  let user = await UserModel.findOne({
    $or: [
      { stripeCustomerId: customerId },
      { stripeSubscriptionId: subscriptionId },
      { "subscription.stripeCustomerId": customerId },
      { "subscription.stripeSubscriptionId": subscriptionId },
    ],
  });

  if (!user) {
    console.error(
      "❌ [billing] User not found for deleted subscription:",
      subscriptionId
    );
    return;
  }

  // Update subscription status to canceled
  user.subscriptionStatus = "canceled";
  if (!(user as any).subscription) {
    (user as any).subscription = {};
  }
  (user as any).subscription.subscriptionStatus = "canceled";
  (user as any).subscription.tier = "free"; // Update tier for backwards compatibility

  // Clear subscription ID but keep customer ID (for potential future subscriptions)
  (user as any).stripeSubscriptionId = null;
  (user as any).subscription.stripeSubscriptionId = null;

  (user as any).currentPeriodEnd = null;
  (user as any).subscription.currentPeriodEnd = null;

  // Clear cancellation flags since subscription is now actually canceled
  user.cancelAtPeriodEnd = false;

  await user.save();
  console.log(
    "✅ [billing] Updated user after subscription deletion (now on free tier):",
    user._id
  );
}

/**
 * Update user document from Stripe subscription object
 */
async function updateUserFromSubscription(
  user: any,
  subscription: Stripe.Subscription
) {
  // Update subscription status (only "active" means subscribed)
  const status = subscription.status;
  const isActive = status === "active";

  user.subscriptionStatus = status;
  if (!(user as any).subscription) {
    (user as any).subscription = {};
  }
  (user as any).subscription.subscriptionStatus = status;

  // Also update tier field for backwards compatibility
  (user as any).subscription.tier = isActive ? "paid" : "free";

  // Update subscription ID
  if (subscription.id) {
    user.stripeSubscriptionId = subscription.id;
    (user as any).subscription.stripeSubscriptionId = subscription.id;
  }

  // Update customer ID if not set
  const customerId = subscription.customer as string;
  if (customerId && !user.stripeCustomerId) {
    user.stripeCustomerId = customerId;
    (user as any).subscription.stripeCustomerId = customerId;
  }

  // Update period end
  if (subscription.current_period_end) {
    user.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    (user as any).subscription.currentPeriodEnd = new Date(
      subscription.current_period_end * 1000
    );
  }

  // Update cancel at period end
  user.cancelAtPeriodEnd = subscription.cancel_at_period_end || false;
}
