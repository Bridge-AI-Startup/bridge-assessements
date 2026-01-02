# Paywall Enforcement Guide

## Current Enforcement Strategy

We use a **hybrid approach** combining:
1. **Limit-based enforcement** (for free tier with quotas)
2. **Subscription-required middleware** (for premium-only features)

---

## 1. Limit-Based Enforcement (Free Tier Quotas)

### How It Works
Free tier users get limited access:
- **1 assessment** maximum
- **3 submissions** total across all assessments

When limits are reached, users get a `403 SUBSCRIPTION_LIMIT_REACHED` error with an upgrade message.

### Where It's Applied

#### Assessment Creation (`POST /api/assessments`)
**File:** `server/src/controllers/assessment.ts`

```typescript
// Check subscription limits
const isSubscribed = subscriptionStatus === "active";

if (!isSubscribed) {
  const assessmentCount = await AssessmentModel.countDocuments({ userId });
  
  if (assessmentCount >= 1) {
    return res.status(403).json({
      error: "SUBSCRIPTION_LIMIT_REACHED",
      message: "You've reached the free tier limit of 1 assessment. Upgrade to create unlimited assessments.",
      limit: 1,
      current: assessmentCount,
    });
  }
}
```

#### Submission Creation (`POST /api/submissions/start`)
**File:** `server/src/controllers/submission.ts`

```typescript
// Check subscription limits
const isSubscribed = subscriptionStatus === "active";

if (!isSubscribed) {
  const submissionCount = await SubmissionModel.countDocuments({
    assessmentId: { $in: assessmentIds },
  });
  
  if (submissionCount >= 3) {
    return res.status(403).json({
      error: "SUBSCRIPTION_LIMIT_REACHED",
      message: "You've reached the free tier limit of 3 candidate submissions. Upgrade to continue.",
      limit: 3,
      current: submissionCount,
    });
  }
}
```

---

## 2. Subscription-Required Middleware (Premium-Only Features)

### How It Works
The `requireSubscription` middleware completely blocks access for non-subscribed users, returning `402 Payment Required`.

### Middleware Location
**File:** `server/src/middleware/requireSubscription.ts`

```typescript
export const requireSubscription: RequestHandler = async (req, res, next) => {
  // Checks if user.subscriptionStatus === "active"
  // Returns 402 if not subscribed
  // Allows request to proceed if subscribed
};
```

### How to Apply It

Add `requireSubscription` to any route that should be **completely blocked** for free users:

```typescript
import { requireSubscription } from "../middleware/requireSubscription.js";

// Example: Premium-only feature
router.post(
  "/premium-feature",
  [verifyAuthToken, requireSubscription], // Add here
  Controller.premiumFeature
);
```

---

## 3. Current Protection Status

### ✅ Protected (Limit-Based)
- **Assessment Creation** - Free: 1 max, Paid: Unlimited
- **Submission Creation** - Free: 3 max, Paid: Unlimited

### 🔓 Not Protected (Consider Adding)
- **Assessment Updates** - Currently unlimited for free users
- **Assessment Deletion** - Currently unlimited for free users
- **Assessment Chat** - Currently unlimited for free users
- **Repository Indexing** - Currently unlimited for free users
- **Interview Question Generation** - Currently unlimited for free users

---

## 4. Recommended Enforcement Strategy

### Option A: Keep Current Approach (Recommended)
- Keep limit-based enforcement for assessments/submissions
- This allows free users to try the product with limits
- Good for conversion

### Option B: Add Premium-Only Features
If you want some features to be completely premium-only:

```typescript
// Example: Make repository indexing premium-only
router.post(
  "/:submissionId/index-repo",
  [verifyAuthToken, requireSubscription], // Add this
  SubmissionController.indexSubmissionRepository
);
```

---

## 5. Frontend Handling

The frontend should handle these errors:

```typescript
// Handle subscription limit errors
if (error === "SUBSCRIPTION_LIMIT_REACHED") {
  // Show upgrade prompt
  // Redirect to subscription page
}

// Handle subscription required errors
if (status === 402) {
  // Show "Upgrade Required" message
  // Redirect to subscription page
}
```

---

## 6. Testing Paywall Enforcement

### Test Free Tier Limits
1. Create account (free tier)
2. Create 1 assessment ✅
3. Try to create 2nd assessment ❌ (should get `SUBSCRIPTION_LIMIT_REACHED`)
4. Create 3 submissions ✅
5. Try to create 4th submission ❌ (should get `SUBSCRIPTION_LIMIT_REACHED`)

### Test Subscription Required
1. Create account (free tier)
2. Try to access premium-only route ❌ (should get `402 Payment Required`)

### Test Paid Tier
1. Subscribe to paid plan
2. Create unlimited assessments ✅
3. Create unlimited submissions ✅
4. Access all premium features ✅

---

## Summary

**Current State:**
- ✅ Assessment creation: Limited (1 for free)
- ✅ Submission creation: Limited (3 for free)
- ✅ Subscription status checked via `subscriptionStatus === "active"`

**To Add More Protection:**
1. Import `requireSubscription` middleware
2. Add it to route middleware array
3. Frontend will receive `402` status for non-subscribed users

