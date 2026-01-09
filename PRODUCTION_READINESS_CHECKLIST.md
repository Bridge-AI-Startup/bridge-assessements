# Production Readiness Checklist

## ✅ Already Configured

Based on recent changes, these are already set up:
- ✅ CORS configured with production frontend URLs
- ✅ Firebase Admin SDK using environment variable
- ✅ Webhook endpoints configured
- ✅ Agent tools endpoint configured
- ✅ Stripe webhook endpoint configured

## 🔴 Critical: Must Set in Production

### Backend Environment Variables (Render)

Go to Render Dashboard → Your Backend Service → Environment:

1. **`NODE_ENV`** = `production` ⚠️ **CRITICAL**
   - Enables rate limiting
   - Hardens CORS
   - Disables development-only features

2. **`FRONTEND_URL`** = Your production frontend URL
   - Example: `https://your-app.vercel.app` or `https://www.bridge-jobs.com`
   - Used for CORS validation

3. **`FIREBASE_SERVICE_ACCOUNT_JSON`** = Full Firebase service account JSON string
   - Get from Firebase Console → Project Settings → Service Accounts
   - Paste entire JSON as single-line string

4. **`AGENT_SECRET`** = Strong random secret (for ElevenLabs agent tools)
   - Generate: `openssl rand -hex 32`
   - Must match the secret in ElevenLabs agent tool configuration

5. **`ELEVENLABS_WEBHOOK_SECRET`** = Webhook secret from ElevenLabs
   - Get from ElevenLabs → Agents → Settings → Webhooks
   - Must match the secret in ElevenLabs dashboard

6. **`STRIPE_WEBHOOK_SECRET`** = Stripe webhook signing secret
   - Get from Stripe Dashboard → Developers → Webhooks → Your endpoint
   - Must match the secret from Stripe

7. **`STRIPE_SECRET_KEY`** = Production Stripe secret key (starts with `sk_live_`)
   - ⚠️ Make sure it's LIVE key, not test key

8. **`STRIPE_PRICE_ID`** = Your Stripe price ID (starts with `price_`)

9. **`ATLAS_URI`** = Production MongoDB connection string

10. **`DB_NAME`** = Production database name

11. **`PINECONE_API_KEY`** = Production Pinecone API key

12. **`PINECONE_INDEX_NAME`** = Production Pinecone index name

13. **`OPENAI_API_KEY`** = Production OpenAI API key

14. **`APP_URL`** = Production frontend URL (for Stripe redirects)
    - Example: `https://your-app.vercel.app`

### Frontend Environment Variables (Vercel)

Go to Vercel Dashboard → Your Project → Settings → Environment Variables:

1. **`VITE_API_URL`** = `https://bridge-assessements.onrender.com`
   - ⚠️ **CRITICAL** - Without this, frontend will try to connect to localhost

2. **`VITE_ELEVENLABS_AGENT_ID`** = Your ElevenLabs agent ID
   - Get from ElevenLabs → Agents → Your Agent → Settings

3. **Firebase Config** (if not hardcoded):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - etc.

## 🔧 Third-Party Service Configuration

### ElevenLabs Agent Configuration

1. **Agent Tool URL:**
   - Update from ngrok URL to: `https://bridge-assessements.onrender.com/api/agent-tools/get-context`
   - Header: `X-Agent-Secret: <your-agent-secret>`

2. **Post-Call Webhook URL:**
   - Set to: `https://bridge-assessements.onrender.com/webhooks/elevenlabs`
   - Webhook secret must match `ELEVENLABS_WEBHOOK_SECRET` in Render

### Stripe Dashboard

1. **Webhook Endpoint:**
   - URL: `https://bridge-assessements.onrender.com/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Signing secret must match `STRIPE_WEBHOOK_SECRET` in Render

2. **API Keys:**
   - Make sure you're using **LIVE** keys (not test keys) in production

### Firebase Console

1. **Authorized Domains:**
   - Add your production frontend domain
   - Remove `localhost` if you don't need it

2. **Service Account:**
   - Generate new key if needed
   - Copy full JSON to `FIREBASE_SERVICE_ACCOUNT_JSON` in Render

## ✅ Verification Steps

### 1. Check Server Logs on Startup

After deploying, check Render logs. You should see:
```
✅ Running in PRODUCTION mode
   - Rate limiting: ENABLED
   - CORS: Hardened
📋 Environment: production
✅ Firebase Admin initialized successfully using FIREBASE_SERVICE_ACCOUNT_JSON (environment variable)
```

If you see "DEVELOPMENT mode", `NODE_ENV` is not set correctly.

### 2. Test API Endpoints

```bash
# Health check
curl https://bridge-assessements.onrender.com/health

# Should return: {"status":"ok","timestamp":"..."}
```

### 3. Test Frontend → Backend Connection

1. Open your production frontend
2. Open browser DevTools → Network tab
3. Try to sign up or make an API call
4. Verify requests go to `https://bridge-assessements.onrender.com/api/...`
5. Check for CORS errors

### 4. Test Webhooks

**Stripe:**
- Create a test checkout in production
- Check Stripe Dashboard → Webhooks → Recent events
- Should show successful delivery

**ElevenLabs:**
- Complete an interview in production
- Check Render logs for webhook receipt
- Should see: `✅ [webhook] ElevenLabs transcription stored`

## 🚨 Common Issues to Watch For

### Issue: "Token invalid" errors
- **Cause:** Firebase Admin SDK not initialized
- **Fix:** Verify `FIREBASE_SERVICE_ACCOUNT_JSON` is set correctly in Render

### Issue: CORS errors
- **Cause:** `FRONTEND_URL` not set or doesn't match actual frontend URL
- **Fix:** Set `FRONTEND_URL` in Render to exact frontend URL (including `https://`)

### Issue: API calls go to localhost
- **Cause:** `VITE_API_URL` not set in Vercel
- **Fix:** Set `VITE_API_URL=https://bridge-assessements.onrender.com` in Vercel

### Issue: Webhooks not working
- **Cause:** Webhook secrets don't match
- **Fix:** Verify secrets in Render match the ones in Stripe/ElevenLabs dashboards

## 📋 Quick Pre-Launch Checklist

- [ ] `NODE_ENV=production` set in Render
- [ ] `FRONTEND_URL` set to production frontend URL in Render
- [ ] `VITE_API_URL` set to `https://bridge-assessements.onrender.com` in Vercel
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` set in Render (valid JSON)
- [ ] `AGENT_SECRET` set in Render and matches ElevenLabs
- [ ] `ELEVENLABS_WEBHOOK_SECRET` set in Render and matches ElevenLabs
- [ ] `STRIPE_WEBHOOK_SECRET` set in Render and matches Stripe
- [ ] `STRIPE_SECRET_KEY` is LIVE key (not test)
- [ ] ElevenLabs agent tool URL updated to production
- [ ] ElevenLabs webhook URL updated to production
- [ ] Stripe webhook URL updated to production
- [ ] All API keys are production keys (not test/dev)
- [ ] Server logs show "PRODUCTION mode" on startup
- [ ] Test signup flow works end-to-end
- [ ] Test webhook delivery (Stripe and ElevenLabs)

## 🎯 Most Critical Items

If you only do 3 things, make sure:

1. ✅ **`NODE_ENV=production`** in Render (enables security features)
2. ✅ **`VITE_API_URL`** in Vercel (frontend can connect to backend)
3. ✅ **`FRONTEND_URL`** in Render (CORS works correctly)

Everything else can be configured incrementally, but these 3 are essential for basic functionality.



