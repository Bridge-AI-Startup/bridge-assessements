# Scoring System Design for Project Submissions

## Current State

### ✅ What Already Exists

1. **GitHub Repository Integration**
   - ✅ GitHub URLs are parsed and validated
   - ✅ Commits are pinned (prevents changes after submission)
   - ✅ Repository information stored in `submission.githubRepo`

2. **Pinecone Integration**
   - ✅ Code is indexed into Pinecone (chunked by 200 lines with 40-line overlap)
   - ✅ Code chunks are embedded and stored as vectors
   - ✅ `RepoIndex` model tracks indexing status and stats:
     - `fileCount` - Number of files indexed
     - `chunkCount` - Number of code chunks created
     - `totalChars` - Total characters indexed
     - `filesSkipped` - Files that were skipped (too large, etc.)
   - ✅ Code retrieval from Pinecone works (used for interview questions)

3. **Submission Model**
   - ✅ Stores: `timeSpent`, `githubLink`, `githubRepo`, `status`
   - ✅ Tracks interview data and transcript

4. **UI Display**
   - ✅ SubmissionsDashboard shows: candidate name, status, interview status, time spent
   - ❌ **No scoring metrics displayed yet**

### ❌ What's Missing

1. **Scoring/Analysis Service** - No code analysis or scoring logic
2. **Score Storage** - No database fields for scores
3. **Score Display** - No UI components for displaying scores
4. **Score Calculation** - No metrics calculation from Pinecone data

---

## Scoring System Overview

### Phase 1: Initial Key Metrics (Start Here)

#### 1. **Code Completeness Score** (0-100)
   - **What it measures**: How much of the assessment requirements were implemented
   - **How to calculate**:
     - Use Pinecone to search for code related to each requirement
     - Check if key features/patterns exist in the codebase
     - Calculate percentage of requirements met
   - **Data sources**:
     - Assessment requirements (from `assessment.description`)
     - Code chunks from Pinecone
     - Semantic search for requirement keywords
   - **Display**: Progress bar or percentage (e.g., "85% Complete")

#### 2. **Code Quality Score** (0-100)
   - **What it measures**: Code structure, organization, and best practices
   - **How to calculate**:
     - Analyze code patterns from Pinecone chunks:
       - File organization (separation of concerns)
       - Code structure (functions, classes, modules)
       - Error handling presence
       - Documentation/comments
     - Use AI to analyze code quality patterns
   - **Data sources**:
     - All code chunks from Pinecone
     - File structure analysis
     - AI analysis of code patterns
   - **Display**: Score with breakdown (e.g., "72/100 - Good structure, missing error handling")

### Phase 2: Additional Metrics (Future)

3. **Test Coverage** (if tests exist)
4. **Performance Metrics** (if applicable)
5. **Security Best Practices**
6. **Code Complexity Analysis**

---

## Implementation Plan

### Step 1: Database Schema Updates

Add scoring fields to `Submission` model:

```typescript
// Add to server/src/models/submission.ts
scores: {
  // Overall score (weighted average)
  overall: {
    type: Number,
    default: null,
    min: 0,
    max: 100,
  },
  
  // Individual metric scores
  completeness: {
    score: { type: Number, default: null, min: 0, max: 100 },
    breakdown: {
      requirementsMet: { type: Number, default: 0 },
      totalRequirements: { type: Number, default: 0 },
      details: [{
        requirement: String,
        met: Boolean,
        evidence: String, // Code snippet or file path
      }],
    },
    calculatedAt: Date,
  },
  
  quality: {
    score: { type: Number, default: null, min: 0, max: 100 },
    breakdown: {
      structure: { type: Number, default: null },
      organization: { type: Number, default: null },
      errorHandling: { type: Number, default: null },
      documentation: { type: Number, default: null },
    },
    calculatedAt: Date,
  },
  
  // Metadata
  calculatedAt: Date,
  calculationVersion: String, // Track scoring algorithm version
}
```

### Step 2: Create Scoring Service

**File**: `server/src/services/scoring.ts`

```typescript
/**
 * Scoring Service
 * 
 * Analyzes code submissions using Pinecone and calculates scores
 */

import SubmissionModel from "../models/submission.js";
import AssessmentModel from "../models/assessment.js";
import RepoIndexModel from "../models/repoIndex.js";
import { searchCodeChunks } from "./repoRetrieval.js";
import { createChatCompletion } from "./langchainAI.js";

/**
 * Calculate completeness score
 * - Searches Pinecone for evidence of each requirement
 * - Uses semantic search to find relevant code
 */
export async function calculateCompletenessScore(
  submissionId: string
): Promise<{
  score: number;
  breakdown: {
    requirementsMet: number;
    totalRequirements: number;
    details: Array<{
      requirement: string;
      met: boolean;
      evidence?: string;
    }>;
  };
}> {
  // 1. Get submission and assessment
  const submission = await SubmissionModel.findById(submissionId)
    .populate('assessmentId');
  
  if (!submission || !submission.assessmentId) {
    throw new Error('Submission or assessment not found');
  }
  
  const assessment = submission.assessmentId;
  
  // 2. Extract requirements from assessment description
  const requirements = extractRequirements(assessment.description);
  
  // 3. For each requirement, search Pinecone for evidence
  const requirementChecks = await Promise.all(
    requirements.map(async (req) => {
      const chunks = await searchCodeChunks(
        submissionId,
        req.text,
        { topK: 3, maxChunks: 3 }
      );
      
      return {
        requirement: req.text,
        met: chunks.chunks.length > 0 && chunks.chunks[0].score > 0.7,
        evidence: chunks.chunks[0]?.path,
      };
    })
  );
  
  // 4. Calculate score
  const met = requirementChecks.filter(r => r.met).length;
  const score = Math.round((met / requirements.length) * 100);
  
  return {
    score,
    breakdown: {
      requirementsMet: met,
      totalRequirements: requirements.length,
      details: requirementChecks,
    },
  };
}

/**
 * Calculate code quality score
 * - Analyzes code structure, organization, patterns
 * - Uses AI to evaluate code quality
 */
export async function calculateQualityScore(
  submissionId: string
): Promise<{
  score: number;
  breakdown: {
    structure: number;
    organization: number;
    errorHandling: number;
    documentation: number;
  };
}> {
  // 1. Get repo index stats
  const repoIndex = await RepoIndexModel.findOne({ submissionId });
  
  if (!repoIndex || repoIndex.status !== 'ready') {
    throw new Error('Repo not indexed yet');
  }
  
  // 2. Retrieve sample code chunks for analysis
  const sampleChunks = await searchCodeChunks(
    submissionId,
    'main application code structure',
    { topK: 10, maxChunks: 10 }
  );
  
  // 3. Use AI to analyze code quality
  const qualityAnalysis = await analyzeCodeQualityWithAI(
    sampleChunks.chunks,
    repoIndex.stats
  );
  
  // 4. Calculate weighted score
  const score = Math.round(
    qualityAnalysis.structure * 0.3 +
    qualityAnalysis.organization * 0.3 +
    qualityAnalysis.errorHandling * 0.25 +
    qualityAnalysis.documentation * 0.15
  );
  
  return {
    score,
    breakdown: qualityAnalysis,
  };
}

/**
 * Calculate overall score and save to submission
 */
export async function calculateAndSaveScores(
  submissionId: string
): Promise<void> {
  const completeness = await calculateCompletenessScore(submissionId);
  const quality = await calculateQualityScore(submissionId);
  
  // Weighted overall score (adjust weights as needed)
  const overall = Math.round(
    completeness.score * 0.6 + // 60% completeness
    quality.score * 0.4         // 40% quality
  );
  
  // Update submission
  await SubmissionModel.findByIdAndUpdate(submissionId, {
    'scores.overall': overall,
    'scores.completeness': completeness,
    'scores.quality': quality,
    'scores.calculatedAt': new Date(),
    'scores.calculationVersion': '1.0.0',
  });
}
```

### Step 3: API Endpoint

**File**: `server/src/controllers/submission.ts`

```typescript
/**
 * Calculate scores for a submission
 * POST /api/submissions/:id/calculate-scores
 */
export const calculateScores: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Verify user owns the assessment
    const submission = await SubmissionModel.findById(id)
      .populate('assessmentId');
    
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    
    // Check auth and ownership
    // ... (existing auth logic)
    
    // Calculate scores
    await calculateAndSaveScores(id);
    
    // Return updated submission
    const updated = await SubmissionModel.findById(id);
    res.json(updated);
  } catch (error) {
    next(error);
  }
};
```

### Step 4: UI Display

**File**: `client/src/pages/SubmissionsDashboard.jsx`

Add score columns to the table:

```jsx
<th>Completeness</th>
<th>Quality</th>
<th>Overall</th>

// In table row:
<td>
  {submission.scores?.completeness ? (
    <div>
      <div className="flex items-center gap-2">
        <Progress 
          value={submission.scores.completeness.score} 
          className="w-20"
        />
        <span className="text-sm font-medium">
          {submission.scores.completeness.score}%
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {submission.scores.completeness.breakdown.requirementsMet}/
        {submission.scores.completeness.breakdown.totalRequirements} requirements
      </p>
    </div>
  ) : (
    <Button onClick={() => calculateScores(submission._id)}>
      Calculate
    </Button>
  )}
</td>
```

---

## How It Works with GitHub Submissions

### Current Flow:
1. Candidate submits GitHub URL
2. Backend parses URL, pins commit
3. Repo is indexed into Pinecone (background job)
4. Code chunks stored as vectors

### New Scoring Flow:
1. After indexing completes, trigger scoring (or manual trigger)
2. Scoring service:
   - Retrieves assessment requirements
   - Searches Pinecone for each requirement
   - Analyzes code quality using AI
   - Calculates scores
   - Saves to submission
3. UI displays scores in dashboard

---

## Key Metrics Breakdown

### 1. Completeness Score (0-100)

**Calculation:**
```
For each requirement in assessment:
  1. Create semantic search query from requirement text
  2. Search Pinecone for relevant code chunks
  3. If similarity score > 0.7, mark as "met"
  4. Count: requirementsMet / totalRequirements * 100
```

**Example:**
- Assessment has 8 requirements
- 6 requirements have code evidence in Pinecone
- Score: 6/8 * 100 = 75%

**Evidence:**
- Store file paths and code snippets that match each requirement
- Show in UI: "Requirement X: ✅ Found in `src/api/users.js`"

### 2. Quality Score (0-100)

**Sub-metrics:**
- **Structure (30%)**: Code organization, separation of concerns
- **Organization (30%)**: File structure, module organization
- **Error Handling (25%)**: Try-catch, validation, edge cases
- **Documentation (15%)**: Comments, README, code clarity

**Calculation:**
```
1. Retrieve representative code chunks from Pinecone
2. Use AI to analyze each sub-metric
3. Weighted average: structure*0.3 + organization*0.3 + errorHandling*0.25 + documentation*0.15
```

**AI Analysis Prompt:**
```
Analyze this code submission for quality:
- Structure: How well is code organized? (0-100)
- Organization: File/module structure? (0-100)
- Error Handling: Presence of error handling? (0-100)
- Documentation: Comments and clarity? (0-100)

Code chunks: [chunks from Pinecone]
Stats: [fileCount, chunkCount, totalChars]
```

---

## Display Design

### Dashboard Table Columns:
1. Candidate (existing)
2. Status (existing)
3. **Completeness** - Progress bar + percentage
4. **Quality** - Score + breakdown tooltip
5. **Overall** - Large score badge (color-coded)
6. Interview (existing)
7. Time Spent (existing)
8. Actions (existing)

### Score Card (Detail View):
- Overall score (large, prominent)
- Completeness breakdown (list of requirements with ✅/❌)
- Quality breakdown (sub-scores with explanations)
- Evidence links (click to see code)

---

## Next Steps

1. **Start with Completeness Score** - Easier to implement, clear value
2. **Add Quality Score** - More complex, requires AI analysis
3. **Build UI Components** - Score displays, progress bars
4. **Add Auto-calculation** - Trigger after indexing completes
5. **Iterate on Metrics** - Refine based on feedback

---

## Questions to Consider

1. **When to calculate scores?**
   - Auto after indexing? (recommended)
   - Manual trigger? (for testing)
   - Both?

2. **Score weighting?**
   - 60% completeness / 40% quality? (adjustable)
   - Equal weight?
   - Configurable per assessment?

3. **Score updates?**
   - Recalculate if code changes? (shouldn't happen - commit is pinned)
   - Version scoring algorithm? (yes - track `calculationVersion`)

4. **Display priority?**
   - Show scores in list view? (yes - key metrics)
   - Detailed breakdown in detail view? (yes)
