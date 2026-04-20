/**
 * Subscription utility functions
 * Helper functions for checking subscription status
 */

import UserModel from "../models/user.js";

/**
 * Checks if a user is subscribed (has active subscription)
 * @param user - User document or user object
 * @returns true if subscriptionStatus is "active", false otherwise
 */
export function isSubscribed(user: any): boolean {
  // Check top-level subscriptionStatus first (new implementation)
  if (user.subscriptionStatus === "active") {
    return true;
  }

  // Fallback to nested subscription.subscriptionStatus for backwards compatibility
  if (user.subscription?.subscriptionStatus === "active") {
    return true;
  }

  return false;
}

/**
 * Gets the subscription status from a user object
 * @param user - User document or user object
 * @returns subscription status string or null
 */
export function getSubscriptionStatus(user: any): string | null {
  return (
    user.subscriptionStatus || user.subscription?.subscriptionStatus || null
  );
}

/**
 * Free tier is capped at 1 assessment in production. In development, that cap
 * is disabled so local testing is not blocked.
 */
export function shouldEnforceFreeTierAssessmentLimit(): boolean {
  return process.env.NODE_ENV === "production";
}
