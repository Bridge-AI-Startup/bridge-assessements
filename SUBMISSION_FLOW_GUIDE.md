# Submission Flow Guide - Current State & Adding LLM Log Submission

## 📋 Current Submission Flow

### 👤 APPLICANT SIDE (Candidate Experience)

#### 1. **Access Assessment** (`CandidateAssessment.jsx`)
- **URL**: `/candidate-assessment?token={token}`
- **What they see**:
  - Assessment title and description (markdown rendered)
  - Time limit countdown
  - "Start Assessment" button

#### 2. **Start Assessment**
- **Action**: Clicks "Start Assessment"
- **API Call**: `POST /api/submissions/token/:token/start`
- **Backend**: Updates `submission.status` to `"in-progress"`, sets `startedAt`
- **Frontend**: Shows submission form

#### 3. **Submit Code** (`CandidateAssessment.jsx` lines 632-670)
- **What they see**:
  ```jsx
  <div>
    <label>GitHub Repository URL *</label>
    <Input 
      value={githubUrl}
      placeholder="https://github.com/username/repository"
    />
  </div>
  ```
- **Current Fields**:
  - ✅ **GitHub Repository URL** (required)
  - ❌ **LLM Conversation Log** (NOT YET IMPLEMENTED)

#### 4. **Submit Action** (`handleSubmit` function)
- **API Call**: `POST /api/submissions/token/:token/submit`
- **Payload**:
  ```json
  {
    "githubLink": "https://github.com/username/repo"
  }
  ```
- **Backend Processing** (`server/src/controllers/submission.ts`):
  1. Validates GitHub URL
  2. Parses and pins commit SHA
  3. Stores `githubLink` and `githubRepo` object
  4. Sets `status = "submitted"`, `submittedAt = now()`
  5. Triggers background indexing to Pinecone

#### 5. **After Submission** (`CandidateSubmitted.jsx`)
- **Redirect**: `/candidate-submitted?token={token}`
- **What they see**: Confirmation page

---

### 🏢 COMPANY SIDE (Employer Experience)

#### 1. **View Submissions** (`SubmissionsDashboard.jsx`)
- **URL**: `/submissions-dashboard?assessmentId={id}`
- **What they see**: Table with columns:
  - Candidate (name, email)
  - Status (pending, in-progress, submitted, expired)
  - Interview status
  - Time Spent
  - Actions (copy link, view GitHub, delete)

#### 2. **View Submission Details**
- **Current Display** (`SubmissionsDashboard.jsx` lines 888-905):
  ```jsx
  {submission.status === "submitted" && submission.githubLink && (
    <a href={submission.githubLink} target="_blank">
      <Button>View GitHub</Button>
    </a>
  )}
  ```
- **What they can see**:
  - ✅ GitHub link (opens in new tab)
  - ✅ Time spent
  - ✅ Interview status
  - ❌ **LLM Conversation Log** (NOT YET IMPLEMENTED)
  - ❌ **AI Use Score** (NOT YET IMPLEMENTED)

#### 3. **Submission Data Structure** (Current)
```typescript
{
  _id: string,
  token: string,
  assessmentId: ObjectId,
  candidateName: string,
  candidateEmail: string,
  status: "pending" | "in-progress" | "submitted" | "expired",
  githubLink: string,  // ✅ EXISTS
  githubRepo: {
    owner: string,
    repo: string,
    pinnedCommitSha: string
  },
  timeSpent: number,
  submittedAt: Date,
  scores: {  // ✅ EXISTS (from completeness scoring)
    overall: number,
    completeness: {...}
  }
  // ❌ llmConversationLog: NOT YET
  // ❌ aiUseScore: NOT YET
}
```

---

## 🆕 Adding LLM Conversation Log Submission

See implementation details in the next sections...
