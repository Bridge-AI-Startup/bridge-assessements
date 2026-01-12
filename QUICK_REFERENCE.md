# BridgeAI - Quick Reference Guide

A quick reference for common tasks and information.

## 🚀 Quick Start Commands

```bash
# Backend
cd server
npm install
npm run dev          # Start dev server (port 5050)

# Frontend
cd client
npm install
npm run dev          # Start dev server (port 5173)
```

## 📍 Important URLs

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5050/api
- **Health Check**: http://localhost:5050/health
- **Production Backend**: https://bridge-assessements.onrender.com

## 🔑 Key Environment Variables

### Backend (`server/config.env`)

**Required:**
- `ATLAS_URI` - MongoDB connection string
- `FIREBASE_SERVICE_ACCOUNT_JSON` - Firebase Admin SDK JSON (production)
- `PINECONE_API_KEY` - Pinecone API key
- `PINECONE_INDEX_NAME` - Pinecone index name
- At least one: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`

**Optional:**
- `STRIPE_SECRET_KEY` - For payments
- `AGENT_SECRET` - For ElevenLabs agent tools
- `ELEVENLABS_WEBHOOK_SECRET` - For ElevenLabs webhooks

### Frontend (`client/.env`)

**Optional (has defaults):**
- `VITE_API_BASE_URL` - Backend API URL (defaults to localhost:5050 in dev)

## 🗂️ Project Structure

```
client/src/
├── api/          # API client functions
├── components/   # React components
├── pages/        # Page components (routes)
└── utils/        # Utilities

server/src/
├── controllers/  # Route handlers
├── models/       # Database models
├── routes/       # API routes
├── services/     # Business logic
└── util/         # Utilities
```

## 🔐 Authentication

**Frontend**: Firebase Client SDK
- Users sign in/up via Firebase
- Get ID token: `await getIdToken()`
- Include in requests: `Authorization: Bearer <token>`

**Backend**: Firebase Admin SDK
- Verifies tokens on each request
- Adds `req.user` with user info

## 📊 Database Models

### User
- `firebaseUid` - Firebase user ID
- `email` - User email
- `companyName` - Company name
- `subscriptionStatus` - Stripe subscription status
- `stripeCustomerId` - Stripe customer ID

### Assessment
- `userId` - Owner user ID
- `title` - Assessment title
- `description` - Assessment description
- `timeLimit` - Time limit in minutes
- `numInterviewQuestions` - Number of interview questions

### Submission
- `assessmentId` - Assessment reference
- `token` - Unique access token
- `status` - `pending`, `in-progress`, `submitted`
- `githubRepoUrl` - Submitted GitHub repository
- `interviewConversationId` - ElevenLabs conversation ID

## 🛣️ Key API Routes

### User
- `POST /api/users/create` - Create user (auth required)
- `GET /api/users/whoami` - Get current user (auth required)

### Assessment
- `POST /api/assessments/generate` - Generate from job description (auth)
- `POST /api/assessments` - Create assessment (auth)
- `GET /api/assessments` - List assessments (auth)
- `GET /api/assessments/:id` - Get assessment (auth)
- `POST /api/assessments/:id/chat` - Chat with AI (auth)

### Submission
- `POST /api/submissions/generate-link` - Generate shareable link (auth)
- `GET /api/submissions/token/:token` - Get submission by token (public)
- `POST /api/submissions/token/:token/start` - Start assessment (public)
- `POST /api/submissions/token/:token/submit` - Submit assessment (public)

### Billing
- `POST /api/billing/checkout` - Create Stripe checkout (auth)
- `GET /api/billing/status` - Get subscription status (auth)
- `POST /api/billing/webhook` - Stripe webhook (signature verified)

## 🤖 AI Provider Configuration

**Priority order:**
1. Code (`prompts/index.ts`) - highest
2. Env var per use case (`OPENAI_MODEL_ASSESSMENT_GENERATION`)
3. Env var per provider (`OPENAI_MODEL`)
4. Default models

**Use cases:**
- `assessment_generation` - Generate assessment from job description
- `assessment_chat` - Chat with assessment AI
- `interview_questions` - Generate questions from code
- `interview_summary` - Summarize interview transcript

**Providers:**
- `openai` - Requires `OPENAI_API_KEY`
- `anthropic` - Requires `ANTHROPIC_API_KEY`
- `gemini` - Requires `GEMINI_API_KEY`

## 🔄 Common Workflows

### Create Assessment
1. Employer provides job description
2. `POST /api/assessments/generate` → AI generates assessment
3. Employer customizes and saves
4. `POST /api/submissions/generate-link` → Get shareable link

### Candidate Takes Assessment
1. Candidate opens shareable link
2. `GET /api/submissions/token/:token` → View assessment
3. `POST /api/submissions/token/:token/start` → Start assessment
4. Candidate submits GitHub repo link
5. Code is automatically indexed into Pinecone

### Generate Interview
1. After submission, employer generates interview
2. `POST /api/submissions/:id/generate-interview` → Generate questions
3. Questions based on submitted code (retrieved from Pinecone)
4. Candidate takes voice interview via ElevenLabs

## 🛡️ Security

**Rate Limiting:**
- General API: 100 requests / 15 min
- Authentication: 5 requests / 15 min
- Webhooks: 50 requests / 15 min
- Disabled in development

**CORS:**
- Hardened configuration
- Only allows specific origins
- Development: localhost:5173, localhost:3000

**Access Control:**
- Employer routes: Firebase Bearer token required
- Candidate routes: Token in URL (public but token-protected)
- Webhooks: HMAC signature verification

## 🧪 Testing

### Test Stripe Webhooks Locally
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks
stripe listen --forward-to localhost:5050/api/billing/webhook

# Copy webhook secret to config.env
# STRIPE_WEBHOOK_SECRET=whsec_...
```

### Test Health Check
```bash
curl http://localhost:5050/health
```

## 🐛 Troubleshooting

**Firebase JWT errors:**
- Check `FIREBASE_SERVICE_ACCOUNT_JSON` is set correctly
- See `FIX_FIREBASE_INVALID_JWT.md`

**CORS errors:**
- Verify `FRONTEND_URL` in backend config matches frontend URL
- Check allowed origins in `server.ts`

**Subscription not updating:**
- Check webhook delivery in Stripe Dashboard
- Verify `STRIPE_WEBHOOK_SECRET` matches
- Check server logs for webhook processing

**AI not working:**
- Verify at least one AI provider key is set
- Check server logs for provider/model configuration
- See `AI_MODEL_CONFIGURATION.md`

## 📚 Documentation Files

- `ONBOARDING_GUIDE.md` - Complete onboarding guide
- `README.md` - Main project overview
- `AUTH_FLOW.md` - Authentication architecture
- `ROUTE_ACCESS.md` - Complete API route documentation
- `AI_MODEL_CONFIGURATION.md` - AI provider configuration
- `FRONTEND_BACKEND_INTEGRATION.md` - Integration details

## 💡 Tips

1. **Development mode**: Rate limiting is disabled, CORS is relaxed
2. **Environment variables**: Backend uses `config.env`, frontend uses `.env`
3. **Database**: Uses Mongoose for User model, native MongoDB driver for others
4. **Logging**: Backend logs all requests with timestamps
5. **AI providers**: Can use different providers/models per use case
