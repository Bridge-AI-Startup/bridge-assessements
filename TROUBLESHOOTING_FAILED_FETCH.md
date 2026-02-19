# Troubleshooting "Failed to Fetch" Errors

## Error Symptoms
- `ERR_CONNECTION_REFUSED` in browser console
- `TypeError: Failed to fetch` errors
- Frontend cannot connect to backend at `http://localhost:5050`

## Common Causes & Solutions

### 1. Backend Server Not Running
**Check:** Is the backend server running?

**Solution:**
```bash
cd server
npm run dev
# or
npm run start
```

**Expected Output:**
```
✅ Server is running!
📍 Port: 5050
🌐 Health check: http://localhost:5050/health
```

### 2. Backend Server Crashed on Startup
**Check:** Look for error messages in the terminal where you started the server.

**Common Causes:**
- Missing dependencies (e.g., `multer` not installed)
- TypeScript compilation errors
- Environment variables not loaded
- MongoDB connection failed

**Solution:**
1. Check terminal output for specific errors
2. Install missing dependencies: `cd server && npm install`
3. Verify `config.env` file exists and has correct values
4. Check MongoDB connection string in `config.env`

### 3. Port Already in Use
**Check:** Another process might be using port 5050.

**Solution:**
```bash
# Find process using port 5050
lsof -ti:5050

# Kill the process (replace PID with actual process ID)
kill -9 <PID>

# Or change PORT in config.env
PORT=5051
```

### 4. Environment Variables Not Loading
**Check:** Verify `config.env` is being loaded.

**Solution:**
- Ensure `config.env` exists in `server/` directory
- Check that `server/src/server.ts` loads env vars first
- Verify `npm run start` uses `--env-file=config.env` flag

### 5. CORS Issues (Different Error)
**Note:** `ERR_CONNECTION_REFUSED` is different from CORS errors. CORS errors show "Access-Control-Allow-Origin" messages.

**If you see CORS errors:**
- Check `server/src/server.ts` CORS configuration
- Verify frontend URL matches allowed origins

### 6. Frontend API Configuration Mismatch
**Check:** Verify frontend is pointing to correct backend URL.

**Solution:**
- Check `client/src/config/api.js`
- Ensure it points to `http://localhost:5050/api`
- Verify `VITE_API_URL` environment variable if set

## Quick Diagnostic Steps

1. **Check if server is running:**
   ```bash
   curl http://localhost:5050/health
   ```
   Should return: `{"status":"OK","message":"Server is running",...}`

2. **Check server logs:**
   Look at the terminal where `npm run dev` is running for errors

3. **Verify dependencies:**
   ```bash
   cd server
   npm install
   ```

4. **Check TypeScript compilation:**
   ```bash
   cd server
   npx tsc --noEmit
   ```

5. **Test MongoDB connection:**
   Verify `ATLAS_URI` in `config.env` is correct

## Recent Changes That Might Affect This

If you just implemented the LLM workflow evaluation system:

1. **Multer dependency:** Ensure `multer` is installed:
   ```bash
   cd server && npm install multer
   ```

2. **New routes:** Verify all new route imports are correct:
   - `server/src/routes/submission.ts` imports `uploadLLMTrace`
   - `server/src/routes/submission.ts` imports `TaskRunnerController`
   - `server/src/server.ts` imports `llmProxyRoutes`

3. **TypeScript types:** Install multer types:
   ```bash
   cd server && npm install --save-dev @types/multer
   ```

## Still Having Issues?

1. Check the full error stack trace in browser console
2. Check server terminal for startup errors
3. Verify all environment variables are set correctly
4. Try restarting both frontend and backend servers
