# Testing Agent Tools Endpoint

## Step 1: Set Environment Variable

Add `AGENT_SECRET` to your `server/config.env` file:

```bash
AGENT_SECRET=your-secret-token-here-make-it-long-and-random
```

Generate a secure random token:
```bash
# On Mac/Linux:
openssl rand -hex 32

# Or use Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 2: Restart Server

Make sure your server is running with the new environment variable:

```bash
cd server
npm run dev  # or npm start
```

## Step 3: Test the Endpoint Locally

### Prerequisites for Testing:
- A submission with `submissionId` that exists in your database
- That submission must have a `RepoIndex` with `status: "ready"`

### Test with Postman:

1. **Create a new POST request:**
   - Method: `POST`
   - URL: `http://localhost:5050/api/agent-tools/get-context`

2. **Set Headers:**
   - `Content-Type`: `application/json`
   - `X-Agent-Secret`: `your-secret-token-here` (only if AGENT_SECRET is set)

3. **Set Body (raw JSON):**
   ```json
   {
     "submissionId": "YOUR_SUBMISSION_ID",
     "currentQuestion": "How did you implement authentication?",
     "candidateAnswer": "I used JWT tokens with a middleware."
   }
   ```

4. **Click Send** and check the response

### Test with curl:

```bash
# Test without auth (should fail if AGENT_SECRET is set):
curl -X POST http://localhost:5050/api/agent-tools/get-context \
  -H "Content-Type: application/json" \
  -d '{
    "submissionId": "YOUR_SUBMISSION_ID",
    "currentQuestion": "How did you implement authentication?",
    "candidateAnswer": "I used JWT tokens with a middleware."
  }'

# Test with correct auth:
curl -X POST http://localhost:5050/api/agent-tools/get-context \
  -H "Content-Type: application/json" \
  -H "X-Agent-Secret: your-secret-token-here-make-it-long-and-random" \
  -d '{
    "submissionId": "YOUR_SUBMISSION_ID",
    "currentQuestion": "How did you implement authentication?",
    "candidateAnswer": "I used JWT tokens with a middleware."
  }'
```

### Expected Successful Response:
```json
{
  "contextChunks": [
    {
      "path": "src/auth/middleware.js",
      "startLine": 45,
      "endLine": 67,
      "content": "...",
      "score": 0.92
    }
  ],
  "stats": {
    "chunksReturned": 6,
    "totalCharsReturned": 12345
  }
}
```

### Test Cases to Verify:

1. **Missing auth header** → Should return `401`
2. **Wrong secret** → Should return `403`
3. **Invalid submissionId** → Should return `404`
4. **Repo not indexed** → Should return `409`
5. **Valid request** → Should return `200` with context chunks

## Step 4: Configure ElevenLabs Agent

In your ElevenLabs agent configuration, you'll need to:

1. **Add the endpoint as a tool:**
   - Tool name: `get_context` (or similar)
   - Endpoint URL: `https://your-server.com/api/agent-tools/get-context`
   - Method: `POST`
   - Headers:
     ```
     X-Agent-Secret: your-secret-token-here-make-it-long-and-random
     Content-Type: application/json
     ```

2. **Define the tool schema** (ElevenLabs function calling format):
   ```json
   {
     "type": "function",
     "function": {
       "name": "get_context",
       "description": "Retrieve relevant code snippets from the candidate's submission based on the current interview question and their answer. Use this to verify their answer and ask precise follow-up questions.",
       "parameters": {
         "type": "object",
         "properties": {
           "submissionId": {
             "type": "string",
             "description": "The ID of the submission to query"
           },
           "currentQuestion": {
             "type": "string",
             "description": "The current interview question being asked"
           },
           "candidateAnswer": {
             "type": "string",
             "description": "The candidate's answer to the current question"
           }
         },
         "required": ["submissionId", "currentQuestion", "candidateAnswer"]
       }
     }
   }
   ```

3. **Agent will call the tool when needed:**
   - The agent decides when to call this tool (Pattern B from requirements)
   - It will pass the submissionId, currentQuestion, and candidateAnswer
   - Use the returned code snippets to ask follow-up questions

## Step 5: Verify Logs

Check your server logs when the agent calls the endpoint. You should see:

```
🔍 [agentTools/getContext] submissionId=..., questionLength=..., answerLength=..., topK=10 (used=10), chunksReturned=..., totalCharsReturned=...
```

## Troubleshooting

### "401 Unauthorized"
- Check that `X-Agent-Secret` header is being sent
- Verify the secret matches your `AGENT_SECRET` environment variable

### "409 Conflict - Repository not indexed"
- The submission's repo hasn't finished indexing
- Check RepoIndex status: `GET /api/submissions/:submissionId/repo-index/status`
- Wait for status to be `"ready"`

### "404 Not Found"
- Verify the `submissionId` exists in your database
- Check the ID format (should be MongoDB ObjectId)

### Empty or no chunks returned
- The query might not match any code in Pinecone
- Try a more specific question/answer combination
- Check that the repo was successfully indexed with code

