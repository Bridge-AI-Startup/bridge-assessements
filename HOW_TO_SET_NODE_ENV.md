# How to Set NODE_ENV for Production

## 📍 Where to Set NODE_ENV

The location depends on **where you're deploying**. Here are instructions for common platforms:

---

## Option 1: In Your `config.env` File (Local/Server)

**File:** `server/config.env`

```env
NODE_ENV=production
```

**Note:** Your server loads this file automatically via `--env-file=config.env` in package.json

---

## Option 2: Platform-Specific Instructions

### 🚀 Vercel

1. Go to your Vercel project dashboard
2. Click **Settings** → **Environment Variables**
3. Click **Add New**
4. Add:
   - **Key:** `NODE_ENV`
   - **Value:** `production`
   - **Environment:** Production (and optionally Preview/Development)
5. Click **Save**

**Or via CLI:**
```bash
vercel env add NODE_ENV production
```

---

### 🚂 Railway

1. Go to your Railway project
2. Click on your service
3. Go to **Variables** tab
4. Click **+ New Variable**
5. Add:
   - **Key:** `NODE_ENV`
   - **Value:** `production`
6. Click **Add**

**Or via CLI:**
```bash
railway variables set NODE_ENV=production
```

---

### 🐳 Render

1. Go to your Render dashboard
2. Select your service
3. Go to **Environment** tab
4. Click **Add Environment Variable**
5. Add:
   - **Key:** `NODE_ENV`
   - **Value:** `production`
6. Click **Save Changes**

---

### 🟣 Heroku

1. Go to your Heroku app dashboard
2. Click **Settings** → **Config Vars**
3. Click **Reveal Config Vars**
4. Click **Add**
5. Add:
   - **Key:** `NODE_ENV`
   - **Value:** `production`
6. Click **Add**

**Or via CLI:**
```bash
heroku config:set NODE_ENV=production
```

---

### 🐳 Docker

**In Dockerfile:**
```dockerfile
ENV NODE_ENV=production
```

**In docker-compose.yml:**
```yaml
services:
  server:
    environment:
      - NODE_ENV=production
```

**Or pass at runtime:**
```bash
docker run -e NODE_ENV=production your-image
```

---

### ☁️ AWS (EC2/ECS/Lambda)

**EC2/ECS:**
- Set in your task definition or launch configuration
- Or export in your startup script:
  ```bash
  export NODE_ENV=production
  ```

**Lambda:**
- Set in Lambda function configuration → Environment variables

---

### 🖥️ Manual Server Deployment

**Option A: Export in shell:**
```bash
export NODE_ENV=production
npm start
```

**Option B: Add to your startup script:**
```bash
#!/bin/bash
export NODE_ENV=production
cd /path/to/server
npm start
```

**Option C: Use PM2:**
```bash
pm2 start server/src/server.ts --name "bridge-api" --env production
```

Or in `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'bridge-api',
    script: 'server/src/server.ts',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
```

---

## ✅ How to Verify It's Set

After setting `NODE_ENV=production`, check your server logs on startup. You should see:

```
✅ Running in PRODUCTION mode
   - Rate limiting: ENABLED
   - CORS: Hardened
📋 Environment: production
```

If you see:
```
⚠️  NODE_ENV not set, defaulting to 'development'
🔧 Running in DEVELOPMENT mode
   - Rate limiting: DISABLED (for testing)
```

Then `NODE_ENV` is **not set correctly** in production.

---

## 🎯 Quick Checklist

- [ ] Set `NODE_ENV=production` in your deployment platform's environment variables
- [ ] Verify in server startup logs that it shows "PRODUCTION mode"
- [ ] Confirm rate limiting is enabled (check logs)
- [ ] Test that unauthorized CORS origins are blocked

---

## 📝 Important Notes

1. **Never commit `config.env` with real secrets** - use `.gitignore`
2. **Each platform has its own way** - check your platform's docs
3. **Set it for the right environment** - Production vs Preview/Staging
4. **Restart your server** after setting environment variables

---

## 🔍 Current Setup

Your server uses `--env-file=config.env` in package.json, which means:
- **Local development:** Set `NODE_ENV=development` in `server/config.env`
- **Production:** Set `NODE_ENV=production` in your deployment platform's environment variables (NOT in config.env that gets committed)

