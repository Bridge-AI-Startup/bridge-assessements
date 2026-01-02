# Backend Route Access Control Documentation

This document lists all backend routes and their access requirements.

## Health Check

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| GET | `/health` | **Public** | Health check endpoint (no authentication) |

---

## User Routes (`/api/users`)

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| POST | `/api/users/create` | **Employer (Auth Token)** | Create a new user account |
| GET | `/api/users/whoami` | **Employer (Auth Token)** | Get current user information |

**Access Control:** All routes require `verifyAuthToken` middleware (Firebase Bearer token)

---

## Assessment Routes (`/api/assessments`)

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| POST | `/api/assessments/generate` | **Employer (Auth Token)** | Generate assessment data from description using AI |
| POST | `/api/assessments` | **Employer (Auth Token)** | Create a new assessment |
| GET | `/api/assessments` | **Employer (Auth Token)** | Get all assessments for the current user |
| GET | `/api/assessments/:id` | **Employer (Auth Token)** | Get a single assessment by ID (must own it) |
| PATCH | `/api/assessments/:id` | **Employer (Auth Token)** | Update an assessment (must own it) |
| DELETE | `/api/assessments/:id` | **Employer (Auth Token)** | Delete an assessment (must own it) |
| POST | `/api/assessments/:id/chat` | **Employer (Auth Token)** | Chat with assessment AI assistant |

**Access Control:** All routes require `verifyAuthToken` middleware (Firebase Bearer token). Users can only access/modify their own assessments.

---

## Submission Routes (`/api/submissions`)

### Employer-Only Routes (Auth Token Required)

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| POST | `/api/submissions/generate-link` | **Employer (Auth Token)** | Generate a shareable link for a candidate |
| GET | `/api/submissions/assessments/:id/submissions` | **Employer (Auth Token)** | Get all submissions for an assessment |
| DELETE | `/api/submissions/:submissionId` | **Employer (Auth Token)** | Delete a submission |
| POST | `/api/submissions/:submissionId/generate-interview` | **Employer (Auth Token)** | Generate interview questions for a submission |
| POST | `/api/submissions/:submissionId/index-repo` | **Employer (Auth Token)** | Index repository into Pinecone |
| GET | `/api/submissions/:submissionId/repo-index/status` | **Employer (Auth Token)** | Get repository index status |
| POST | `/api/submissions/:submissionId/search-code` | **Employer (Auth Token)** | Search code chunks (debug/admin endpoint) |

### Hybrid Routes (Auth Token OR Candidate Token)

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| GET | `/api/submissions/:submissionId/interview-agent-prompt` | **Employer (Auth) OR Candidate (Token)** | Get interview agent prompt for a submission |
| PATCH | `/api/submissions/:submissionId/interview-conversation-id` | **Employer (Auth) OR Candidate (Token)** | Update interview conversationId when interview starts |

**Access Control:** 
- `verifySubmissionAccess` middleware allows access if:
  - User is authenticated (employer) AND owns the assessment, OR
  - A valid token is provided in query/body/params that matches the submission

### Public Candidate Routes (Token in URL)

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| GET | `/api/submissions/assessments/public/:id` | **Public** | Get assessment details (for candidate to view before starting) |
| GET | `/api/submissions/token/:token` | **Public (Token in URL)** | Get submission by token (candidate access) |
| POST | `/api/submissions/token/:token/start` | **Public (Token in URL)** | Start assessment (update status to "in-progress") |
| POST | `/api/submissions/token/:token/submit` | **Public (Token in URL)** | Submit assessment by token |
| POST | `/api/submissions/token/:token/generate-interview` | **Public (Token in URL)** | Generate interview questions by token |
| POST | `/api/submissions/token/:token/opt-out` | **Public (Token in URL)** | Opt out of assessment by token |
| POST | `/api/submissions/start` | **Public** | Start a new submission (deprecated) |
| POST | `/api/submissions/:id/submit` | **Public** | Final submission by ID |
| PATCH | `/api/submissions/:id` | **Public** | Update a submission (auto-save) |
| GET | `/api/submissions/:id` | **Public** | Get a submission by ID (for candidate to resume) |

**Access Control:** These routes are intentionally public. They rely on:
- Token-based access (token in URL path or query params)
- Submission ID validation
- No authentication required (candidates don't have accounts)

---

## Agent Tools Routes (`/api/agent-tools`)

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| POST | `/api/agent-tools/get-context` | **Agent Secret (X-Agent-Secret Header)** | Get context for ElevenLabs agent tool calls |

**Access Control:** 
- `verifyAgentAuth` middleware requires `X-Agent-Secret` header matching `AGENT_SECRET` env var
- If `AGENT_SECRET` is not configured, access is allowed (development mode)

---

## Webhook Routes (`/webhooks`)

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| POST | `/webhooks/elevenlabs` | **HMAC Signature Verification** | ElevenLabs post-call transcription webhook |

**Access Control:**
- HMAC signature verification using `ELEVENLABS_WEBHOOK_SECRET`
- Signature is verified from `ElevenLabs-Signature` header
- Raw body is required for signature verification

---

## Access Control Types Summary

### 1. **Employer (Auth Token)**
- Requires: Firebase Bearer token in `Authorization` header
- Middleware: `verifyAuthToken`
- Used for: All employer/admin operations
- Example: `Authorization: Bearer <firebase-token>`

### 2. **Candidate (Token)**
- Requires: Submission token in URL path, query params, or body
- Middleware: None (public routes) or `verifySubmissionAccess` (hybrid routes)
- Used for: Candidate access to their submissions
- Example: `/api/submissions/token/abc123...` or `?token=abc123...`

### 3. **Hybrid (Auth OR Token)**
- Requires: Either employer auth token OR candidate token
- Middleware: `verifySubmissionAccess`
- Used for: Routes accessible by both employers and candidates
- Example: Interview-related endpoints

### 4. **Agent Secret**
- Requires: `X-Agent-Secret` header matching `AGENT_SECRET` env var
- Middleware: `verifyAgentAuth`
- Used for: ElevenLabs agent tool calls

### 5. **HMAC Signature**
- Requires: Valid HMAC signature in `ElevenLabs-Signature` header
- Middleware: Custom signature verification in controller
- Used for: External webhook endpoints

### 6. **Public**
- Requires: No authentication
- Middleware: None
- Used for: Health checks, public candidate endpoints (protected by token in URL)

---

## Security Notes

1. **Token-based candidate access**: While candidate routes are "public", they require a valid submission token in the URL, which acts as authentication. Tokens are cryptographically random 64-character hex strings.

2. **Employer access control**: All employer routes verify that the user owns the resource they're accessing (e.g., can only access their own assessments).

3. **Hybrid routes**: Routes like `interview-agent-prompt` and `interview-conversation-id` can be accessed by either:
   - Employers (with auth token) who own the assessment
   - Candidates (with submission token) who own the submission

4. **Webhook security**: ElevenLabs webhooks use HMAC signature verification to ensure requests are authentic.

5. **Agent tools**: ElevenLabs agent calls use a shared secret (`AGENT_SECRET`) for authentication.

