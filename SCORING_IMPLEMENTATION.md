# Scoring Implementation - Completeness Score

## ✅ What Was Implemented

### 1. Database Schema (`server/src/models/submission.ts`)
Added `scores` field to Submission model with:
- `overall` - Overall score (0-100)
- `completeness` - Completeness score with breakdown
  - `score` - Percentage (0-100)
  - `breakdown` - Detailed requirement matching
    - `requirementsMet` - Count of met requirements
    - `totalRequirements` - Total requirements
    - `details` - Array of requirement checks with evidence
- `quality` - Placeholder for future quality score
- `calculatedAt` - Timestamp
- `calculationVersion` - Version tracking

### 2. Scoring Service (`server/src/services/scoring.ts`)
Created scoring service with:

**`extractRequirements(description)`**
- Extracts requirements from assessment description
- Looks for "## Requirements" section in markdown
- Falls back to "Acceptance Criteria" section
- Extracts list items (-, *, numbered lists)

**`calculateCompletenessScore(submissionId)`**
- Extracts requirements from assessment
- For each requirement:
  - Searches Pinecone using semantic search
  - Checks if similarity score > 0.7 (threshold)
  - Records evidence (file path) if found
- Calculates score: `(requirementsMet / totalRequirements) * 100`
- Returns detailed breakdown

**`calculateAndSaveScores(submissionId)`**
- Calculates completeness score
- Saves to submission model
- Returns scores object

### 3. API Endpoint (`server/src/controllers/submission.ts`)
**`POST /api/submissions/:submissionId/calculate-scores`**
- **Auth**: Required (employer only)
- **Validation**: 
  - User must own the assessment
  - Submission must be "submitted"
  - Repository must be indexed (status: "ready")
- **Response**: Updated submission with scores

### 4. Route (`server/src/routes/submission.ts`)
Added route: `POST /api/submissions/:submissionId/calculate-scores`

---

## How It Works

### Flow:
1. **Candidate submits** GitHub repository
2. **Repository is indexed** into Pinecone (background job)
3. **Employer triggers scoring** via API endpoint
4. **Scoring service**:
   - Extracts requirements from assessment description
   - For each requirement, searches Pinecone for relevant code
   - If similarity > 0.7, marks requirement as "met"
   - Calculates percentage score
   - Saves to submission
5. **Scores are returned** in API response

### Example:
```
Assessment has 8 requirements:
- Requirement 1: "User authentication" → Found in src/auth.js (score: 0.85) ✅
- Requirement 2: "Database models" → Found in src/models/ (score: 0.92) ✅
- Requirement 3: "API endpoints" → Found in src/routes/ (score: 0.78) ✅
- Requirement 4: "Error handling" → Not found (score: 0.45) ❌
- ... (4 more requirements)

Result: 3/8 met = 37.5% → Rounded to 38%
```

---

## API Usage

### Calculate Scores
```bash
POST /api/submissions/:submissionId/calculate-scores
Authorization: Bearer <firebase-token>
```

**Response:**
```json
{
  "submission": {
    "_id": "...",
    "scores": {
      "overall": 75,
      "completeness": {
        "score": 75,
        "breakdown": {
          "requirementsMet": 6,
          "totalRequirements": 8,
          "details": [
            {
              "requirement": "User authentication with JWT",
              "met": true,
              "evidence": "src/auth/jwt.js",
              "similarityScore": 0.85
            },
            {
              "requirement": "Database models for users",
              "met": true,
              "evidence": "src/models/user.js",
              "similarityScore": 0.92
            },
            // ... more requirements
          ]
        },
        "calculatedAt": "2024-01-15T10:30:00Z"
      }
    }
  },
  "scores": {
    "overall": 75,
    "completeness": {
      "score": 75,
      "breakdown": {
        "requirementsMet": 6,
        "totalRequirements": 8,
        "details": [...]
      }
    }
  }
}
```

### Error Responses

**409 Conflict** - Repository not indexed:
```json
{
  "error": "Repository not indexed yet. Please wait for indexing to complete before calculating scores."
}
```

**400 Bad Request** - No requirements found:
```json
{
  "error": "No requirements found in assessment description. Cannot calculate completeness score."
}
```

**400 Bad Request** - Not submitted:
```json
{
  "error": "Can only calculate scores for submitted assessments"
}
```

---

## Testing

### Prerequisites:
1. Submission must be in "submitted" status
2. Repository must be indexed (check via `/api/submissions/:id/repo-index/status`)
3. Assessment description must have requirements section

### Test Steps:
1. **Submit a repository** (if not already done)
2. **Wait for indexing** to complete
3. **Call calculate-scores endpoint**:
   ```bash
   curl -X POST \
     http://localhost:5050/api/submissions/{submissionId}/calculate-scores \
     -H "Authorization: Bearer {token}"
   ```
4. **Check response** for scores
5. **Verify in database** that scores were saved

---

## Next Steps

### Phase 2: Quality Score
- Implement `calculateQualityScore()` function
- Analyze code structure, organization, error handling, documentation
- Use AI to evaluate code quality patterns
- Update overall score calculation (weighted: 60% completeness, 40% quality)

### Phase 3: UI Display
- Add score columns to SubmissionsDashboard
- Display completeness score with progress bar
- Show requirement breakdown in detail view
- Add "Calculate Scores" button

### Phase 4: Auto-calculation
- Trigger scoring automatically after indexing completes
- Add background job for score calculation
- Update UI to show "Calculating..." status

---

## Configuration

### Similarity Threshold
Currently set to **0.7** (70% similarity) in `scoring.ts`:
```typescript
const met = chunks.chunks.length > 0 && bestMatch.score > 0.7;
```

**Adjust if needed:**
- Lower (0.6) = More lenient, more requirements marked as met
- Higher (0.8) = Stricter, fewer requirements marked as met

### Score Calculation
Currently: `overall = completeness.score`

**When quality score is added:**
```typescript
const overall = Math.round(
  completeness.score * 0.6 +  // 60% completeness
  quality.score * 0.4          // 40% quality
);
```

---

## Files Modified/Created

1. ✅ `server/src/models/submission.ts` - Added scores schema
2. ✅ `server/src/services/scoring.ts` - New scoring service
3. ✅ `server/src/controllers/submission.ts` - Added calculateScores controller
4. ✅ `server/src/routes/submission.ts` - Added calculate-scores route

---

## Notes

- **Requirement Extraction**: Currently extracts from markdown "Requirements" section. Falls back to "Acceptance Criteria" or first sentences if not found.
- **Semantic Search**: Uses Pinecone's semantic search to find code related to each requirement. This is more flexible than exact keyword matching.
- **Evidence Tracking**: Stores file paths where requirements were found, useful for showing candidates what they implemented.
- **Version Tracking**: `calculationVersion` field allows tracking scoring algorithm changes over time.
