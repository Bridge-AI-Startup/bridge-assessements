# Testing ElevenLabs Webhook Endpoint

## Overview

This guide covers testing the `/webhooks/elevenlabs` endpoint that receives post-call transcription events from ElevenLabs and persists them to Submission documents.

## Prerequisites

1. ✅ `ELEVENLABS_WEBHOOK_SECRET` is set in `server/config.env`
2. Server is running on port 5050
3. MongoDB connection is working
4. You have a valid `submissionId` in your database

## Method 1: Local Testing with Mock Webhook (Recommended First Step)

### Step 1: Get a Valid Submission ID

First, find a submission ID from your database:

```bash
# Option 1: Use MongoDB Compass or mongo shell
# Option 2: Check your server logs when a submission is created
# Option 3: Use the API to get a submission
curl http://localhost:5050/api/submissions/token/YOUR_TOKEN
```

### Step 2: Generate HMAC Signature

The webhook requires a valid HMAC signature. Use the test script:

```bash
cd server
node test-webhook-signature.js
```

Or manually generate it:

```bash
# Install crypto if needed
node -e "
const crypto = require('crypto');
const secret = 'wsec_70bd91c26c45db8ac82e140fedb1bca710da107c7544ec0cf8acb1fd2ef76469';
const timestamp = Math.floor(Date.now() / 1000);
const payload = JSON.stringify({
  type: 'post_call_transcription',
  data: {
    conversation_id: 'test-conv-123',
    metadata: {
      dynamic_variables: {
        submissionId: 'YOUR_SUBMISSION_ID_HERE'
      }
    },
    transcript: [
      { role: 'agent', text: 'Hello, how are you?', start_ms: 0, end_ms: 2000 },
      { role: 'user', text: 'I am doing well, thank you!', start_ms: 2500, end_ms: 5000 }
    ],
    analysis: {
      transcript_summary: 'A brief conversation about well-being'
    }
  }
});
const message = timestamp + '.' + payload;
const digest = 'v0=' + crypto.createHmac('sha256', secret).update(message).digest('hex');
console.log('Timestamp:', timestamp);
console.log('Signature:', 't=' + timestamp + ',v0=' + digest);
"
```

### Step 3: Test with curl

Use the generated signature to test the endpoint:

```bash
# Replace YOUR_SUBMISSION_ID_HERE with an actual submission ID
# Replace the signature with the one generated above

curl -X POST http://localhost:5050/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -H "ElevenLabs-Signature: t=1234567890,v0=abc123..." \
  -d '{
    "type": "post_call_transcription",
    "data": {
      "conversation_id": "test-conv-123",
      "metadata": {
        "dynamic_variables": {
          "submissionId": "YOUR_SUBMISSION_ID_HERE"
        }
      },
      "transcript": [
        {
          "role": "agent",
          "text": "Hello, how are you?",
          "start_ms": 0,
          "end_ms": 2000
        },
        {
          "role": "user",
          "text": "I am doing well, thank you!",
          "start_ms": 2500,
          "end_ms": 5000
        }
      ],
      "analysis": {
        "transcript_summary": "A brief conversation about well-being"
      }
    }
  }'
```

### Expected Response (Success):

```json
{
  "status": "success",
  "submissionId": "YOUR_SUBMISSION_ID",
  "conversationId": "test-conv-123",
  "turnsCount": 2,
  "hasSummary": true
}
```

### Test Cases:

1. **Missing signature** → Should return `401`
2. **Invalid signature** → Should return `401`
3. **Expired timestamp** → Should return `401`
4. **Missing submissionId** → Should return `200` with `status: "ignored"`
5. **Invalid submissionId** → Should return `404`
6. **Non-transcription event** → Should return `200` with `status: "ignored"`
7. **Valid transcription** → Should return `200` with success data

## Method 2: Testing with ngrok (Real Webhook from ElevenLabs)

### Step 1: Install ngrok

```bash
# Mac (using Homebrew)
brew install ngrok

# Or download from https://ngrok.com/download
```

### Step 2: Start Your Server

```bash
cd server
npm run dev
```

### Step 3: Start ngrok Tunnel

In a new terminal:

```bash
ngrok http 5050
```

You'll see output like:

```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:5050
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

### Step 4: Configure Webhook in ElevenLabs

1. Go to [ElevenLabs Agents Platform Settings](https://elevenlabs.io/app/agents/settings)
2. Navigate to "Post-call webhooks" section
3. Add webhook URL: `https://abc123.ngrok-free.app/webhooks/elevenlabs`
4. Copy the webhook secret and ensure it matches `ELEVENLABS_WEBHOOK_SECRET` in your `config.env`
5. Enable "Post-call transcription" webhook
6. Save settings

### Step 5: Test with Real Interview

1. Start an interview on your website with a submission that has `submissionId`
2. Complete the interview
3. Wait for the webhook to be called (usually within a few seconds after call ends)
4. Check your server logs for:
   ```
   ✅ [webhook] ElevenLabs transcription stored: submissionId=..., conversationId=..., turnsCount=..., hasSummary=...
   ```

### Step 6: Verify Data in Database

Check that the submission was updated:

```bash
# Using MongoDB Compass or mongo shell
db.submissions.findOne({ _id: ObjectId("YOUR_SUBMISSION_ID") })

# Or use the API
curl http://localhost:5050/api/submissions/token/YOUR_TOKEN
```

You should see:

```json
{
  "interview": {
    "provider": "elevenlabs",
    "status": "completed",
    "conversationId": "...",
    "transcript": {
      "turns": [
        { "role": "agent", "text": "...", "startMs": 0, "endMs": 2000 },
        { "role": "candidate", "text": "...", "startMs": 2500, "endMs": 5000 }
      ]
    },
    "summary": "...",
    "completedAt": "2024-...",
    "updatedAt": "2024-..."
  }
}
```

## Method 3: Using the Test Script

A helper script is provided to generate valid signatures and test the endpoint:

```bash
cd server
node test-webhook.js YOUR_SUBMISSION_ID
```

## Troubleshooting

### Webhook Not Receiving Calls

1. **Check ngrok is running**: Make sure the tunnel is active
2. **Check webhook URL**: Verify it's exactly `https://your-ngrok-url.ngrok-free.app/webhooks/elevenlabs`
3. **Check ElevenLabs logs**: Go to Agents Platform → Settings → Webhooks to see delivery status
4. **Check server logs**: Look for incoming requests to `/webhooks/elevenlabs`

### Signature Verification Failing

1. **Verify secret matches**: `ELEVENLABS_WEBHOOK_SECRET` must match the one in ElevenLabs
2. **Check raw body**: The signature is computed on the raw JSON string, not parsed body
3. **Check timestamp**: Make sure server time is synchronized (within 30 minutes)

### Missing submissionId

1. **Verify dynamic variable**: When starting the interview, ensure `submissionId` is passed in `dynamicVariables`
2. **Check webhook payload**: Log the full payload to see where `submissionId` is located
3. **Check ElevenLabs docs**: The location of dynamic variables may vary by API version

### Data Not Persisting

1. **Check MongoDB connection**: Verify database is connected
2. **Check submission exists**: Ensure the `submissionId` is valid
3. **Check server logs**: Look for errors during save operation
4. **Verify schema**: Ensure the interview field structure matches the schema

## Monitoring

Watch server logs in real-time:

```bash
# In server directory
npm run dev

# Look for these log messages:
# ✅ [webhook] ElevenLabs transcription stored: ...
# ⚠️ [webhook] Missing submissionId in webhook payload: ...
# ❌ [webhook] Signature verification failed
# ❌ [webhook] Submission not found: ...
```

## Next Steps

After successful testing:

1. Deploy to production
2. Update ngrok URL to your production domain
3. Configure production webhook in ElevenLabs
4. Set up monitoring/alerts for webhook failures
5. Consider adding retry logic for failed webhook deliveries
