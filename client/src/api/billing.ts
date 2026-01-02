import { APIResult, post, get, handleAPIError } from "./requests";
import { auth } from "@/firebase/firebase";

export type BillingStatus = {
  subscribed: boolean;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
};

export type CheckoutSession = {
  url: string;
  sessionId: string;
};

/**
 * Create a Stripe Checkout session
 */
export async function createCheckoutSession(
  token?: string
): Promise<APIResult<CheckoutSession>> {
  try {
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await post(
      "/billing/checkout",
      {},
      {
        Authorization: `Bearer ${authToken}`,
      }
    );

    const result = await response.json();
    if (result && result.url) {
      return { success: true, data: result as CheckoutSession };
    }

    return {
      success: false,
      error: result.error || "Failed to create checkout session",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Get billing status
 */
export async function getBillingStatus(
  token?: string
): Promise<APIResult<BillingStatus>> {
  try {
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await get("/billing/status", {
      Authorization: `Bearer ${authToken}`,
    });

    const result = await response.json();
    if (result && typeof result.subscribed === "boolean") {
      return { success: true, data: result as BillingStatus };
    }

    return {
      success: false,
      error: result.error || "Failed to get billing status",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(
  token?: string,
  reason?: string
): Promise<APIResult<{ success: boolean; message: string }>> {
  try {
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await post(
      "/billing/cancel",
      { reason: reason || null },
      {
        Authorization: `Bearer ${authToken}`,
      }
    );

    const result = await response.json();
    if (result && result.success) {
      return { success: true, data: result };
    }

    return {
      success: false,
      error: result.error || "Failed to cancel subscription",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Reactivate subscription
 */
export async function reactivateSubscription(
  token?: string
): Promise<APIResult<{ success: boolean; message: string }>> {
  try {
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await post(
      "/billing/reactivate",
      {},
      {
        Authorization: `Bearer ${authToken}`,
      }
    );

    const result = await response.json();
    if (result && result.success) {
      return { success: true, data: result };
    }

    return {
      success: false,
      error: result.error || "Failed to reactivate subscription",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}
