# Fix: Firebase "Invalid JWT Signature" Error

## Error Message
```
Error: Credential implementation provided to initializeApp() via the "credential" property failed to fetch a valid Google OAuth2 access token with the following error: "invalid_grant: Invalid JWT Signature."
```

## What This Means

This error indicates that the Firebase service account key in your `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable is either:
1. **Revoked or deleted** in Firebase Console
2. **Corrupted or incorrectly formatted** (especially the `private_key` field)
3. **Server time is not synced** (less common)

## Solution: Regenerate Service Account Key

### Step 1: Generate New Service Account Key

1. **Go to Firebase Console**: [https://console.firebase.google.com](https://console.firebase.google.com)
2. **Select your project**
3. **Navigate to Project Settings**:
   - Click the gear icon ⚙️ next to "Project Overview"
   - Select **Project Settings**
4. **Go to Service Accounts tab**:
   - Click on **Service Accounts** tab
5. **Generate New Private Key**:
   - Click **Generate New Private Key** button
   - Confirm the dialog (click **Generate Key**)
   - A JSON file will download to your computer

### Step 2: Extract the JSON Content

1. **Open the downloaded JSON file** in a text editor
2. **Copy the entire contents** (it should look like this):
   ```json
   {
     "type": "service_account",
     "project_id": "your-project-id",
     "private_key_id": "...",
     "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
     "client_email": "...",
     "client_id": "...",
     "auth_uri": "...",
     "token_uri": "...",
     "auth_provider_x509_cert_url": "...",
     "client_x509_cert_url": "..."
   }
   ```

### Step 3: Update Environment Variable in Render

1. **Go to Render Dashboard**: [https://dashboard.render.com](https://dashboard.render.com)
2. **Select your backend service**
3. **Open Environment settings**:
   - Click **Environment** in the left sidebar
4. **Update FIREBASE_SERVICE_ACCOUNT_JSON**:
   - Find `FIREBASE_SERVICE_ACCOUNT_JSON` in the environment variables list
   - Click to edit it
   - **Paste the entire JSON content** (all on one line, or with `\n` for newlines)
   - ⚠️ **Important**: 
     - If pasting as a single line, make sure newlines in `private_key` are preserved as `\n`
     - Render will automatically handle escaping, but you can also paste it as-is
     - **Do NOT add extra quotes** around the JSON
5. **Save Changes**:
   - Click **Save Changes**
   - Render will automatically redeploy your service

### Step 4: Verify It Works

1. **Check deployment logs** in Render:
   - Go to your service → **Logs**
   - Look for: `✅ Firebase Admin initialized successfully using FIREBASE_SERVICE_ACCOUNT_JSON (environment variable)`
2. **Test the API**:
   - Try creating a user or any endpoint that uses Firebase Admin
   - The error should be gone

## Common Mistakes to Avoid

### ❌ Don't Do This:
- **Adding extra quotes**: `FIREBASE_SERVICE_ACCOUNT_JSON="{\"type\":...}"` (the quotes are added automatically)
- **Removing newlines from private_key**: The `private_key` must include `\n` characters
- **Using an old/revoked key**: Always generate a fresh key

### ✅ Do This:
- **Paste the JSON directly**: `FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}`
- **Keep newlines in private_key**: `"private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"`
- **Use a fresh key**: Generate a new one if you're unsure

## Alternative: Format the JSON Properly

If you're having trouble with the JSON format, you can format it like this:

```bash
# The private_key should have \n for newlines:
"private_key": "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\\n-----END PRIVATE KEY-----\\n"
```

Or as a single-line string (Render will handle escaping):
```bash
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",...}
```

## Still Having Issues?

1. **Check Render logs** for the exact error message
2. **Verify the key exists** in Firebase Console → IAM & Admin → Service Accounts
3. **Check server time sync** (unlikely but possible)
4. **Try generating a new key** if the current one is old

## Security Note

⚠️ **Important**: After generating a new key, the old key is automatically revoked. If you have multiple deployments using the same key, you'll need to update all of them.

