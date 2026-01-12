# BridgeAI - Onboarding Guide

Welcome to BridgeAI! This guide will help you understand the project structure, architecture, and how to get started.

## 🎯 What is BridgeAI?

BridgeAI is a **full-stack technical hiring assessment platform** that helps employers:
- Generate custom coding assessments from job descriptions using AI
- Collect candidate code submissions via GitHub
- Conduct automated voice interviews using ElevenLabs
- Manage subscriptions and track candidate performance

## 🏗️ Project Architecture

### High-Level Overview

```
┌─────────────────┐         ┌─────────────────┐
│   Frontend      │         │    Backend      │
│   (React/Vite)  │◄────────►│  (Express/TS)   │
└─────────────────┘         └─────────────────┘
         │                           │
         │                           │
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│  Firebase Auth  │         │   MongoDB       │
│  (Client SDK)   │         │   (Mongoose)    │
└─────────────────┘         └─────────────────┘
                                     │
                                     ▼
                            ┌─────────────────┐
                            │   External APIs │
                            │  - OpenAI      │
                            │  - Anthropic   │
                            │  - Gemini      │
                            │  - Pinecone    │
                            │  - ElevenLabs  │
                            │  - Stripe      │
                            └─────────────────┘
```

### Tech Stack

**Frontend:**
- React 18 with TypeScript/JavaScript
- Vite (build tool)
- React Router (routing)
- TanStack Query (data fetching)
- Shadcn UI (component library)
- Tailwind CSS (styling)
- Firebase Auth (authentication)

**Backend:**
- Node.js with Express
- TypeScript
- MongoDB with Mongoose
- Firebase Admin SDK (token verification)
- LangChain (multi-provider AI abstraction)

**External Services:**
- **Firebase**: User authentication
- **MongoDB Atlas**: Database
- **OpenAI/Anthropic/Gemini**: AI model providers
- **Pinecone**: Vector database for code indexing
- **ElevenLabs**: Voice interview platform
- **Stripe**: Subscription payments

## 📁 Project Structure

```
bridge-assessements/
├── client/                 # Frontend React application
│   ├── src/
│   │   ├── api/           # API client functions
│   │   ├── components/    # React components
│   │   │   ├── assessment/ # Assessment-related components
│   │   │   ├── auth/      # Authentication components
│   │   │   └── ui/        # Shadcn UI components
│   │   ├── pages/         # Page components (routes)
│   │   ├── firebase/      # Firebase client config
│   │   ├── hooks/         # Custom React hooks
│   │   └── utils/         # Utility functions
│   └── package.json
│
├── server/                 # Backend Express application
│   ├── src/
│   │   ├── config/        # Configuration (Firebase Admin)
│   │   ├── controllers/   # Route handlers
│   │   ├── db/            # Database connections
│   │   ├── errors/        # Error handling
│   │   ├── middleware/    # Express middleware
│   │   ├── models/        # Mongoose models
│   │   ├── routes/        # API route definitions
│   │   ├── services/      # Business logic
│   │   ├── util/          # Utility functions
│   │   └── validators/    # Input validation
│   ├── config.env         # Environment variables (not in git)
│   └── package.json
│
└── [Documentation files]   # Various .md files
```

## 🔑 Key Concepts

### 1. **Authentication Flow**

The app uses **Firebase Authentication** with a two-tier system:

1. **Frontend**: Users sign in/up via Firebase Client SDK
2. **Backend**: Firebase Admin SDK verifies tokens on each API request

**Flow:**
```
User → Firebase Auth → Get ID Token → Send to Backend → Verify Token → Access Granted
```

See `AUTH_FLOW.md` for detailed documentation.

### 2. **Assessment Lifecycle**

1. **Employer creates assessment**:
   - Provides job description
   - AI generates assessment components (title, description, time limit, etc.)
   - Employer can customize and save

2. **Employer shares assessment**:
   - Generates a unique shareable link with token
   - Sends link to candidate

3. **Candidate takes assessment**:
   - Accesses link (no account needed)
   - Views assessment details
   - Starts assessment (status: "in-progress")
   - Submits GitHub repository link
   - Code is automatically indexed into Pinecone

4. **Interview generation**:
   - After submission, employer can generate interview questions
   - Questions are based on the submitted code
   - Candidate can take voice interview via ElevenLabs

### 3. **Subscription System**

- Uses **Stripe** for payments
- Webhook-based status updates (single source of truth)
- Subscription status stored in User model
- `requireSubscription` middleware protects premium routes
- Status values: `active`, `canceled`, `past_due`, `trialing`, etc.

See `README.md` for Stripe setup instructions.

### 4. **AI Provider System**

The app supports multiple AI providers (OpenAI, Anthropic, Gemini) via LangChain:

- **Per-use-case configuration**: Different providers/models for different tasks
- **Configuration priority**:
  1. Code (`prompts/index.ts`) - highest priority
  2. Environment variables per use case
  3. Environment variables per provider
  4. Default models

**Use cases:**
- `assessment_generation`: Generate assessment from job description
- `assessment_chat`: Chat with assessment AI assistant
- `interview_questions`: Generate questions from code
- `interview_summary`: Summarize interview transcript

See `AI_MODEL_CONFIGURATION.md` for details.

### 5. **Code Indexing**

- Candidates submit GitHub repository links
- Backend downloads and indexes code into **Pinecone** (vector database)
- Code is chunked and embedded for semantic search
- Used for generating interview questions based on submitted code

## 🚀 Getting Started

### Prerequisites Checklist

You'll need accounts for:
- [ ] MongoDB Atlas (or local MongoDB)
- [ ] Firebase (with Authentication enabled)
- [ ] Stripe (for payments)
- [ ] Pinecone (for code indexing)
- [ ] OpenAI/Anthropic/Gemini (at least one AI provider)
- [ ] ElevenLabs (for voice interviews)

### Setup Steps

1. **Clone and install dependencies**:
   ```bash
   # Backend
   cd server
   npm install
   
   # Frontend
   cd ../client
   npm install
   ```

2. **Configure backend** (`server/config.env`):
   - Copy `config.env.example` to `config.env`
   - Fill in all required environment variables:
     - `ATLAS_URI`: MongoDB connection string
     - `DB_NAME`: Database name (default: `bridge-assessments`)
     - `PORT`: Server port (default: `5050`)
     - `FRONTEND_URL`: Frontend URL for CORS (default: `http://localhost:5173`)
     - `NODE_ENV`: Environment (`development` or `production`)
     - `FIREBASE_SERVICE_ACCOUNT_JSON`: Firebase service account JSON (required for production)
     - `PINECONE_API_KEY`: Pinecone API key
     - `PINECONE_INDEX_NAME`: Pinecone index name
     - `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`: At least one AI provider key
     - `STRIPE_SECRET_KEY`: Stripe secret key
     - `STRIPE_WEBHOOK_SECRET`: Stripe webhook secret (for local: use Stripe CLI)
     - `STRIPE_PRICE_ID`: Stripe price ID for subscription
     - `APP_URL`: Frontend URL for Stripe redirects
     - `AGENT_SECRET`: (Optional) Secret for ElevenLabs agent tools
     - `ELEVENLABS_WEBHOOK_SECRET`: (Optional) Secret for ElevenLabs webhooks
   - See `server/config.env.example` for all options

3. **Configure frontend** (`client/.env`):
   - Create `.env` file (optional - defaults work for local dev)
   - Optional variables:
     - `VITE_API_BASE_URL`: Backend API URL (defaults to `http://localhost:5050/api` in dev)
     - `VITE_FIREBASE_API_KEY`: Firebase API key (currently hardcoded in `firebase.js`)
     - `VITE_FIREBASE_AUTH_DOMAIN`: Firebase auth domain
     - `VITE_FIREBASE_PROJECT_ID`: Firebase project ID
     - `VITE_ELEVENLABS_AGENT_ID`: ElevenLabs agent ID

4. **Start development servers**:
   ```bash
   # Terminal 1: Backend
   cd server
   npm run dev
   
   # Terminal 2: Frontend
   cd client
   npm run dev
   ```

5. **Access the app**:
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:5050
   - Health check: http://localhost:5050/health

### Quick Setup Checklist

- [ ] Backend dependencies installed (`cd server && npm install`)
- [ ] Frontend dependencies installed (`cd client && npm install`)
- [ ] Backend `config.env` file created and configured
- [ ] MongoDB connection string added to `config.env`
- [ ] Firebase service account JSON added to `config.env` (or path set for local dev)
- [ ] At least one AI provider API key configured
- [ ] Pinecone API key and index name configured
- [ ] Stripe keys configured (or skip if not testing payments)
- [ ] Backend server starts successfully (`npm run dev` in `server/`)
- [ ] Frontend server starts successfully (`npm run dev` in `client/`)
- [ ] Can access frontend at http://localhost:5173
- [ ] Can access backend health check at http://localhost:5050/health

## 📚 Key Documentation Files

- **`README.md`**: Main project overview and Stripe setup
- **`AUTH_FLOW.md`**: Detailed authentication architecture
- **`FRONTEND_BACKEND_INTEGRATION.md`**: How frontend and backend connect
- **`ROUTE_ACCESS.md`**: Complete list of API routes and access control
- **`AI_MODEL_CONFIGURATION.md`**: How to configure AI models
- **`server/README.md`**: Backend-specific documentation

## 🔍 Important Files to Understand

### Frontend

- **`client/src/App.jsx`**: Main app component, routing setup
- **`client/src/pages.config.js`**: Page routing configuration
- **`client/src/utils/apiClient.js`**: API client with auth token handling
- **`client/src/firebase/firebase.js`**: Firebase client initialization
- **`client/src/api/*.ts`**: API client functions for each resource

### Backend

- **`server/src/server.ts`**: Express server setup, middleware, routes
- **`server/src/models/*.ts`**: Database models (User, Assessment, Submission)
- **`server/src/routes/*.ts`**: API route definitions
- **`server/src/controllers/*.ts`**: Route handlers (business logic)
- **`server/src/services/*.ts`**: Service layer (AI, indexing, etc.)
- **`server/src/util/auth.ts`**: Authentication utilities

## 🛣️ API Routes Overview

### User Routes (`/api/users`)
- `POST /api/users/create` - Create user (employer)
- `GET /api/users/whoami` - Get current user

### Assessment Routes (`/api/assessments`)
- `POST /api/assessments/generate` - Generate assessment from job description
- `POST /api/assessments` - Create assessment
- `GET /api/assessments` - List user's assessments
- `GET /api/assessments/:id` - Get assessment
- `PATCH /api/assessments/:id` - Update assessment
- `DELETE /api/assessments/:id` - Delete assessment
- `POST /api/assessments/:id/chat` - Chat with AI assistant

### Submission Routes (`/api/submissions`)
- **Employer routes**: Generate links, view submissions, generate interviews
- **Candidate routes**: Start assessment, submit code (token-based access)
- See `ROUTE_ACCESS.md` for complete list

### Billing Routes (`/api/billing`)
- `POST /api/billing/checkout` - Create Stripe checkout session
- `GET /api/billing/status` - Get subscription status
- `POST /api/billing/webhook` - Stripe webhook handler

## 🔐 Security & Access Control

### Authentication Types

1. **Employer Auth**: Firebase Bearer token in `Authorization` header
2. **Candidate Token**: Token in URL path (e.g., `/api/submissions/token/abc123...`)
3. **Hybrid**: Either employer auth OR candidate token
4. **Agent Secret**: `X-Agent-Secret` header for ElevenLabs agent calls
5. **HMAC Signature**: For webhook endpoints

### Rate Limiting

- **General API**: 100 requests per 15 minutes
- **Authentication**: 5 requests per 15 minutes
- **Webhooks**: 50 requests per 15 minutes
- **Disabled in development mode**

### CORS

- Hardened CORS configuration
- Only allows specific origins
- Development: `http://localhost:5173`, `http://localhost:3000`
- Production: Configured production domains

## 🧪 Development Tips

1. **Environment Variables**: 
   - Backend uses `config.env` file (not in git)
   - Frontend uses `.env` file (not in git)
   - See example files for required variables

2. **Database Models**:
   - User: Stores employer information, subscription status
   - Assessment: Stores assessment details
   - Submission: Stores candidate submissions

3. **Testing Webhooks Locally**:
   - Use Stripe CLI: `stripe listen --forward-to localhost:5050/api/billing/webhook`
   - See `TESTING_WEBHOOK.md` for details

4. **AI Provider Switching**:
   - Configure in `server/src/prompts/index.ts` or via environment variables
   - Server logs show which provider/model is used for each use case

5. **Debugging**:
   - Backend logs all requests with timestamps
   - Check server console for detailed request/response info
   - Frontend uses React Query DevTools (if installed)

## 🐛 Common Issues

1. **Firebase JWT errors**: See `FIX_FIREBASE_INVALID_JWT.md`
2. **Webhook signature verification fails**: Check `STRIPE_WEBHOOK_SECRET` matches
3. **CORS errors**: Verify `FRONTEND_URL` in backend config matches frontend URL
4. **Subscription status not updating**: Check webhook delivery in Stripe Dashboard

## 📖 Next Steps

1. Read through the main documentation files listed above
2. Set up your development environment
3. Explore the codebase starting with:
   - `server/src/server.ts` (backend entry point)
   - `client/src/App.jsx` (frontend entry point)
   - `client/src/pages/Home.jsx` (main page)
4. Try creating an assessment and understanding the flow
5. Review the API routes in `ROUTE_ACCESS.md`

## 💡 Key Takeaways

- **Two-tier auth**: Firebase on frontend, Admin SDK on backend
- **Token-based candidate access**: Candidates don't need accounts
- **Webhook-driven subscriptions**: Stripe webhooks are the source of truth
- **Multi-provider AI**: Flexible AI provider configuration per use case
- **Vector search**: Code is indexed in Pinecone for semantic search
- **Voice interviews**: ElevenLabs integration for automated interviews

Welcome to the team! 🎉
