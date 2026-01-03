# Switching from Stripe CLI to Production Webhooks

This guide explains how to switch from using Stripe CLI (for local development) to production webhooks (for live deployments).

## Overview

- **Stripe CLI**: Used for local development, forwards webhooks to `localhost`
- **Production Webhooks**: Stripe sends webhooks directly to your production server

## Prerequisites

- Your backend is deployed and accessible (e.g., `https://bridge-assessements.onrender.com`)
- You have access to your Stripe Dashboard
- You have access to your production environment variables (e.g., Render dashboard)

## Step-by-Step Instructions

### 1. Get Your Production Backend URL

Your webhook endpoint will be:
```
https://bridge-assessements.onrender.com/api/billing/webhook
```

⚠️ **Note**: Replace with your actual production backend URL if different.

### 2. Create Webhook Endpoint in Stripe Dashboard

1. **Log in to Stripe Dashboard**: [https://dashboard.stripe.com](https://dashboard.stripe.com)
2. **Navigate to Webhooks**:
   - Click **Developers** in the left sidebar
   - Click **Webhooks**
3. **Add New Endpoint**:
   - Click the **Add endpoint** button (top right)
4. **Configure Endpoint**:
   - **Endpoint URL**: Enter your production webhook URL:
     ```
     https://bridge-assessements.onrender.com/api/billing/webhook
     ```
   - **Description** (optional): "BridgeAI Production Webhooks"
5. **Select Events**:
   Check the following events:
   - ✅ `checkout.session.completed`
   - ✅ `customer.subscription.created`
   - ✅ `customer.subscription.updated`
   - ✅ `customer.subscription.deleted`
6. **Create Endpoint**:
   - Click **Add endpoint**

### 3. Get the Webhook Signing Secret

1. **View Endpoint Details**:
   - Click on the webhook endpoint you just created
2. **Reveal Signing Secret**:
   - Under **Signing secret**, click **Reveal** or **Click to reveal**
   - Copy the secret (it starts with `whsec_`)
   - ⚠️ **Important**: Keep this secret secure and never commit it to git

### 4. Update Production Environment Variables

#### For Render:

1. **Navigate to Your Service**:
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Select your backend service
2. **Open Environment Settings**:
   - Click **Environment** in the left sidebar
3. **Add/Update Variable**:
   - Find `STRIPE_WEBHOOK_SECRET` (or add it if it doesn't exist)
   - Paste the webhook signing secret you copied
   - Click **Save Changes**
4. **Redeploy** (if needed):
   - Render will automatically redeploy when you save environment variables
   - Or manually trigger a redeploy from the **Manual Deploy** section

#### For Other Platforms:

- **Heroku**: Settings → Config Vars → Add `STRIPE_WEBHOOK_SECRET`
- **AWS/ECS**: Update your task definition or parameter store
- **Docker**: Update your `.env` file or environment configuration
- **Kubernetes**: Update your ConfigMap or Secret

### 5. Verify Webhook is Working

#### In Stripe Dashboard:

1. **Check Recent Events**:
   - Go to **Developers** → **Webhooks** → Your endpoint
   - Click on the endpoint to view details
   - Scroll to **Recent events** section
   - You should see webhook deliveries with status indicators:
     - ✅ Green checkmark = Success
     - ❌ Red X = Failed
     - ⏳ Clock = Pending

2. **Test with a Real Event**:
   - Create a test checkout session in your app
   - Complete the checkout flow
   - Check the webhook events - you should see `checkout.session.completed` event delivered successfully

#### In Your Backend Logs:

Check your production server logs for webhook processing:
- Look for: `✅ [billing] Updated user from checkout session`
- Look for: `✅ [billing] Subscription status updated`
- Errors will show: `❌ [billing] Webhook signature verification failed`

### 6. Stop Using Stripe CLI (Optional)

Once production webhooks are working, you can stop using Stripe CLI for local development:

1. **Stop the CLI listener**:
   ```bash
   # Press Ctrl+C in the terminal running:
   stripe listen --forward-to localhost:5050/api/billing/webhook
   ```

2. **For Local Development**:
   - You can still use Stripe CLI for testing
   - Or create a separate test webhook endpoint in Stripe Dashboard pointing to `localhost` (requires ngrok or similar)

## Troubleshooting

### Webhook Signature Verification Failed

**Error**: `❌ [billing] Webhook signature verification failed`

**Solutions**:
1. Verify `STRIPE_WEBHOOK_SECRET` matches the signing secret from Stripe Dashboard
2. Ensure the secret starts with `whsec_`
3. Check for extra spaces or newlines in the environment variable
4. Verify you're using the correct secret for the correct endpoint (test vs live mode)

### Webhook Not Receiving Events

**Symptoms**: No events appear in Stripe Dashboard → Webhooks → Recent events

**Solutions**:
1. Verify your backend URL is accessible:
   ```bash
   curl https://bridge-assessements.onrender.com/api/billing/webhook
   ```
   (Should return an error, but confirms the endpoint exists)

2. Check CORS settings - webhooks don't need CORS, but ensure your server is running

3. Verify the endpoint URL in Stripe Dashboard matches exactly (no trailing slashes)

4. Check your server logs for incoming requests

### Events Received But Not Processed

**Symptoms**: Events show as delivered (✅) but user subscription status doesn't update

**Solutions**:
1. Check backend logs for processing errors
2. Verify database connection is working
3. Check that user records exist in the database
4. Verify `userId` is being passed correctly in checkout session metadata

## Testing Production Webhooks Locally

If you want to test production webhooks locally (without Stripe CLI):

1. **Use ngrok** to expose your local server:
   ```bash
   ngrok http 5050
   ```

2. **Create a test webhook endpoint** in Stripe Dashboard pointing to your ngrok URL:
   ```
   https://your-ngrok-url.ngrok.io/api/billing/webhook
   ```

3. **Use the test webhook secret** in your local `config.env`:
   ```env
   STRIPE_WEBHOOK_SECRET=whsec_test_secret_from_stripe
   ```

## Security Best Practices

1. **Never commit webhook secrets** to git
2. **Use different secrets** for test mode and live mode
3. **Rotate secrets** if they're ever exposed
4. **Monitor webhook deliveries** regularly in Stripe Dashboard
5. **Set up alerts** for failed webhook deliveries

## Additional Resources

- [Stripe Webhooks Documentation](https://stripe.com/docs/webhooks)
- [Stripe Webhook Testing Guide](https://stripe.com/docs/webhooks/test)
- [Stripe CLI Documentation](https://stripe.com/docs/stripe-cli)

