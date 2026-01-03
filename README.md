# BridgeAI - Technical Hiring Assessment Platform

A full-stack TypeScript application for creating and managing technical coding assessments with AI-powered interviews.

## Features

- **AI-Powered Assessment Generation**: Generate custom take-home coding projects from job descriptions
- **Code Submission & Indexing**: Candidates submit code via GitHub links, automatically indexed with Pinecone
- **AI Voice Interviews**: Conduct automated technical interviews using ElevenLabs Agents Platform
- **Subscription Management**: Stripe-powered subscription system with webhook-based status updates
- **Analytics Dashboard**: Track candidate submissions, interview results, and drop-off reasons

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Framer Motion, Shadcn UI
- **Backend**: Node.js, Express, TypeScript, MongoDB (Mongoose)
- **AI/ML**: OpenAI (GPT-4), Pinecone (vector database), ElevenLabs (voice interviews)
- **Authentication**: Firebase Auth
- **Payments**: Stripe Checkout & Webhooks

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- MongoDB Atlas account (or local MongoDB)
- Firebase project with Authentication enabled
- Stripe account
- Pinecone account
- OpenAI API key
- ElevenLabs account (for voice interviews)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd bridge-assessements
   ```

2. **Install dependencies**
   ```bash
   # Backend
   cd server
   npm install
   # Note: This will install the Stripe package (stripe@^17.3.1) required for billing
   
   # Frontend
   cd ../client
   npm install
   ```

3. **Configure environment variables**

   **Backend** (`server/config.env`):
   ```env
   # MongoDB
   ATLAS_URI=your_mongodb_connection_string
   DB_NAME=bridge-assessments
   
   # Server
   PORT=5050
   FRONTEND_URL=http://localhost:5173
   NODE_ENV=development
   
   # Firebase Admin (REQUIRED for production)
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
   
   # Stripe
   STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
   STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
   STRIPE_PRICE_ID=price_your_price_id
   APP_URL=http://localhost:5173
   
   # Pinecone
   PINECONE_API_KEY=your_pinecone_api_key
   PINECONE_INDEX_NAME=your_index_name
   
   # OpenAI
   OPENAI_API_KEY=your_openai_api_key
   
   # ElevenLabs
   ELEVENLABS_WEBHOOK_SECRET=your_elevenlabs_webhook_secret
   AGENT_SECRET=your_agent_secret
   ```

   **Frontend** (`client/.env`):
   ```env
   VITE_API_BASE_URL=http://localhost:5050/api
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_ELEVENLABS_AGENT_ID=your_agent_id
   ```

4. **Start the development servers**
   ```bash
   # Backend (from server directory)
   npm run dev
   
   # Frontend (from client directory)
   npm run dev
   ```

## Stripe Subscription Setup

### 1. Create a Stripe Product and Price

1. Log in to your [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Products** → **Add product**
3. Create a product (e.g., "BridgeAI Early Access")
4. Add a recurring price (e.g., $49/month)
5. Copy the **Price ID** (starts with `price_`)
6. Add it to `STRIPE_PRICE_ID` in your backend `.env`

### 2. Set Up Webhook Endpoint

#### For Local Development:

1. **Install Stripe CLI**:
   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe
   
   # Or download from https://stripe.com/docs/stripe-cli
   ```

2. **Login to Stripe CLI**:
   ```bash
   stripe login
   ```

3. **Forward webhooks to local server**:
   ```bash
   stripe listen --forward-to localhost:5050/api/billing/webhook
   ```

4. **Copy the webhook signing secret**:
   The CLI will output a webhook secret starting with `whsec_`. Copy this and add it to `STRIPE_WEBHOOK_SECRET` in your backend `.env`.

5. **Test webhook events**:
   ```bash
   # Trigger a test checkout.session.completed event
   stripe trigger checkout.session.completed
   ```

#### For Production:

1. **Log in to Stripe Dashboard**: Go to [https://dashboard.stripe.com](https://dashboard.stripe.com)
2. **Navigate to Webhooks**: Go to **Developers** → **Webhooks**
3. **Add endpoint**: Click **Add endpoint** button
4. **Enter production URL**: 
   ```
   https://bridge-assessements.onrender.com/api/billing/webhook
   ```
   ⚠️ **Important**: Use your actual production backend URL if different
5. **Select events to listen for**:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
6. **Copy the Signing secret**:
   - After creating the endpoint, click on it to view details
   - Under **Signing secret**, click **Reveal** or **Click to reveal**
   - Copy the secret (starts with `whsec_`)
7. **Add to production environment variables**:
   - In Render (or your hosting platform), go to your service's **Environment** settings
   - Add or update `STRIPE_WEBHOOK_SECRET` with the copied secret
   - Save and redeploy if needed
8. **Verify webhook is working**:
   - In Stripe Dashboard → **Developers** → **Webhooks** → Your endpoint
   - Check **Recent events** to see if webhooks are being delivered successfully
   - Green checkmarks indicate successful deliveries

### 3. Verify Subscription Status Updates

1. **Create a test checkout session**:
   - Log in to your app
   - Navigate to the Subscription page
   - Click "Upgrade Now"
   - Complete the checkout in Stripe test mode

2. **Check webhook delivery**:
   - In Stripe Dashboard → **Developers** → **Webhooks** → **Event deliveries**
   - Verify that events are being received and processed successfully

3. **Verify user subscription status**:
   - After completing checkout, check your database
   - The user's `subscriptionStatus` should be set to `"active"`
   - `stripeCustomerId` and `stripeSubscriptionId` should be populated

4. **Test subscription cancellation**:
   - In Stripe Dashboard → **Customers** → Select a customer → **Subscriptions** → **Cancel subscription**
   - Verify that `subscriptionStatus` updates to `"canceled"` via webhook

### 4. Testing Subscription Limits

The subscription system uses webhooks as the single source of truth. To test:

1. **Upgrade a user**:
   - Complete checkout flow
   - Wait for `checkout.session.completed` webhook
   - Verify `subscriptionStatus === "active"` in database

2. **Test subscription-required routes**:
   - Routes protected by `requireSubscription` middleware will return `402 Payment Required` if `subscriptionStatus !== "active"`

3. **Cancel subscription**:
   - Cancel via Stripe Dashboard
   - Wait for `customer.subscription.deleted` webhook
   - Verify `subscriptionStatus === "canceled"` in database

## API Endpoints

### Billing

- `POST /api/billing/checkout` - Create Stripe Checkout session (requires auth)
- `GET /api/billing/status` - Get current billing status (requires auth)
- `POST /api/billing/webhook` - Stripe webhook endpoint (signature verified)

### Authentication

All billing endpoints (except webhook) require Firebase authentication via `Authorization: Bearer <token>` header.

## Subscription Status Logic

- **Subscribed**: `user.subscriptionStatus === "active"` (only status that grants access)
- **Not Subscribed**: Any other status (`null`, `"canceled"`, `"past_due"`, etc.)

The `isSubscribed()` helper function checks this condition and is used by `requireSubscription` middleware.

## Database Schema

The User model includes the following Stripe-related fields:

```typescript
{
  stripeCustomerId: string | null,
  stripeSubscriptionId: string | null,
  subscriptionStatus: "active" | "canceled" | "past_due" | "trialing" | "incomplete" | "incomplete_expired" | "unpaid" | null,
  currentPeriodEnd: Date | null,
  cancelAtPeriodEnd: boolean
}
```

## Troubleshooting

### Webhook signature verification fails

- Ensure `STRIPE_WEBHOOK_SECRET` matches the secret from Stripe Dashboard or CLI
- Verify raw body parsing is configured correctly in `server.ts`
- Check that the webhook endpoint uses `express.raw()` middleware

### Subscription status not updating

- Check Stripe Dashboard → **Developers** → **Webhooks** → **Event deliveries** for failed deliveries
- Verify webhook endpoint is accessible (use `stripe listen` for local testing)
- Check server logs for webhook processing errors
- Ensure webhook events are being sent to the correct endpoint URL

### Checkout session creation fails

- Verify `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` are set correctly
- Check that `APP_URL` matches your frontend URL
- Ensure user is authenticated before calling checkout endpoint

## References

- [Stripe Checkout Documentation](https://docs.stripe.com/checkout/subscriptions)
- [Stripe Webhooks Documentation](https://docs.stripe.com/webhooks)
- [Stripe Node.js SDK](https://github.com/stripe/stripe-node)

