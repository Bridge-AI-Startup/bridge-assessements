# Troubleshooting: Signup Works Locally But Not in Production

## Common Causes

### 1. **CORS Issues** (Most Common)

**Symptoms:**
- Browser console shows: `CORS policy: No 'Access-Control-Allow-Origin' header`
- Network tab shows preflight request failing
- Signup fails silently

**Solution:**
1. **Check your frontend URL in CORS configuration**:
   - Go to `server/src/server.ts`
   - Verify your production frontend URL is in the `allowedOrigins` array
   - Current allowed origins:
     - `process.env.FRONTEND_URL` (from environment variable)
     - `https://www.bridge-jobs.com`
     - `https://bridge-landing-saazms-projects.vercel.app`
     - `https://bridge-landing-7dg0wxh94-saazms-projects.vercel.app`

2. **Add your frontend URL to Render environment variables**:
   - Go to Render Dashboard → Your Backend Service → Environment
   - Set `FRONTEND_URL` to your actual production frontend URL (e.g., `https://your-frontend.vercel.app`)
   - Save and redeploy

3. **Verify the frontend URL matches exactly**:
   - Check the URL in your browser's address bar
   - Make sure it matches exactly (including `https://`, no trailing slash)
   - Add it to the `allowedOrigins` array if it's not there

### 2. **API URL Not Configured**

**Symptoms:**
- Network requests fail with "Failed to fetch"
- Console shows requests going to `localhost:5050` instead of production URL

**Solution:**
1. **Check Vercel environment variables**:
   - Go to Vercel Dashboard → Your Frontend Project → Settings → Environment Variables
   - Verify `VITE_API_URL` is set to: `https://bridge-assessements.onrender.com`
   - If not set, add it and redeploy

2. **Verify the API URL in browser console**:
   - Open browser DevTools → Console
   - Check what URL is being used for API calls
   - Should be: `https://bridge-assessements.onrender.com/api/...`

### 3. **Firebase Admin SDK Not Initialized**

**Symptoms:**
- Backend logs show: `Firebase Admin initialization failed`
- Error: `Invalid JWT Signature` or `Credential implementation failed`

**Solution:**
1. **Check Firebase service account in Render**:
   - Go to Render Dashboard → Your Backend Service → Environment
   - Verify `FIREBASE_SERVICE_ACCOUNT_JSON` is set correctly
   - See `FIX_FIREBASE_INVALID_JWT.md` for detailed instructions

2. **Verify Firebase Admin is initialized**:
   - Check Render logs for: `✅ Firebase Admin initialized successfully`
   - If you see errors, regenerate the service account key

### 4. **Network/Firewall Issues**

**Symptoms:**
- Requests timeout
- "NetworkError" or "Failed to fetch" errors

**Solution:**
1. **Check Render service status**:
   - Verify your backend service is running on Render
   - Check if it's in "Live" status, not "Suspended"

2. **Test backend endpoint directly**:
   ```bash
   curl https://bridge-assessements.onrender.com/api/users/whoami
   ```
   - Should return an error (401), not a connection error
   - If connection fails, the backend might be down

### 5. **Firebase Auth Domain Configuration**

**Symptoms:**
- Firebase auth works but backend calls fail
- "auth/unauthorized-domain" errors

**Solution:**
1. **Add your production domain to Firebase**:
   - Go to [Firebase Console](https://console.firebase.google.com)
   - Select your project → Authentication → Settings → Authorized domains
   - Add your production frontend domain (e.g., `your-app.vercel.app`)
   - Remove `localhost` if you don't need it in production

## Step-by-Step Debugging

### Step 1: Check Browser Console

1. Open your production website
2. Open DevTools (F12) → Console tab
3. Try to sign up
4. Look for errors:
   - Red error messages
   - Network errors
   - CORS errors

### Step 2: Check Network Tab

1. Open DevTools → Network tab
2. Try to sign up
3. Look for the API request to `/api/users/create`
4. Check:
   - **Status**: Should be 200 or 201 (not 401, 403, 500)
   - **Request URL**: Should be `https://bridge-assessements.onrender.com/api/users/create`
   - **Response**: Check the response body for error messages
   - **Headers**: Check if CORS headers are present

### Step 3: Check Backend Logs

1. Go to Render Dashboard → Your Backend Service → Logs
2. Try to sign up
3. Look for:
   - `✅ Firebase Admin initialized successfully`
   - `🔄 [createUser] Creating user...`
   - Any error messages

### Step 4: Verify Environment Variables

**Frontend (Vercel):**
- `VITE_API_URL` = `https://bridge-assessements.onrender.com`

**Backend (Render):**
- `FRONTEND_URL` = Your production frontend URL
- `FIREBASE_SERVICE_ACCOUNT_JSON` = Valid Firebase service account JSON
- `NODE_ENV` = `production`
- `ATLAS_URI` = MongoDB connection string

## Quick Fix Checklist

- [ ] Frontend URL is in CORS `allowedOrigins` in `server/src/server.ts`
- [ ] `FRONTEND_URL` environment variable is set in Render
- [ ] `VITE_API_URL` environment variable is set in Vercel
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` is set correctly in Render
- [ ] Firebase Admin SDK initializes successfully (check Render logs)
- [ ] Production domain is in Firebase Authorized domains
- [ ] Backend service is running on Render (status: Live)
- [ ] Network requests are going to the correct API URL

## Testing

After making changes:

1. **Redeploy both frontend and backend**
2. **Clear browser cache** (Ctrl+Shift+Delete or Cmd+Shift+Delete)
3. **Test signup flow**:
   - Try creating a new account
   - Check browser console for errors
   - Check network tab for failed requests
   - Check Render logs for backend errors

## Still Not Working?

1. **Check the exact error message** in browser console
2. **Check the network request** details (status, headers, response)
3. **Check Render logs** for backend errors
4. **Compare local vs production**:
   - What's different between local and production?
   - Are environment variables set correctly?
   - Is the frontend URL different?

## Common Error Messages

### "Failed to fetch"
- **Cause**: Network error, CORS issue, or backend down
- **Fix**: Check CORS configuration, verify backend is running

### "CORS policy: No 'Access-Control-Allow-Origin' header"
- **Cause**: Frontend URL not in allowed origins
- **Fix**: Add frontend URL to `allowedOrigins` in `server/src/server.ts`

### "Invalid JWT Signature"
- **Cause**: Firebase Admin SDK not configured correctly
- **Fix**: Regenerate Firebase service account key (see `FIX_FIREBASE_INVALID_JWT.md`)

### "401 Unauthorized"
- **Cause**: Firebase token not being sent or invalid
- **Fix**: Check if user is authenticated, verify token is being sent in headers

### "500 Internal Server Error"
- **Cause**: Backend error (check Render logs)
- **Fix**: Check Render logs for specific error message

