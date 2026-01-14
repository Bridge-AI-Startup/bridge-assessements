# Bridge Unified Platform

This setup integrates **Bridge Assessments** (primary platform) and **Bridge GitHub** (secondary platform) to run on the same servers while keeping both codebases separate and easily modifiable.

## 🏗️ Architecture

### How It Works
- **Bridge Assessments** (`bridge-assessements/`) is the main platform that runs everything
- **Bridge GitHub** (`Bridge_Github/`) remains in its own folder for easy modification
- Bridge Assessments imports and serves Bridge GitHub's routes and pages
- Both platforms accessible through one server with seamless switching

### What Runs Where

**Backend** (Port 5050):
- Bridge Assessments routes: `/api/users`, `/api/assessments`, `/api/submissions`, etc.
- Bridge GitHub routes: `/api/github/auth`, `/api/github/analysis`, `/api/github/profile`

**Frontend** (Port 5173):
- Bridge Assessments pages: `/`, `/Home`, `/CreateAssessment`, etc.
- Bridge GitHub pages: `/github`, `/github/analysis`

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd bridge-assessements/server
npm install

cd ../client
npm install

cd ../../Bridge_Github/backend
npm install

cd ../frontend
npm install
```

### 2. Configure Environment

Copy and edit the config file:
```bash
cd bridge-assessements/server
cp config.env.example config.env
```

**Minimum Required Configuration:**

```env
# Server
PORT=5050
FRONTEND_URL=http://localhost:5173
NODE_ENV=development

# For Assessments
ATLAS_URI=mongodb+srv://your-connection-string
OPENAI_API_KEY=sk-your-key
FIREBASE_SERVICE_ACCOUNT_JSON=your-firebase-json

# For GitHub
MONGODB_URI=mongodb://localhost:27017/github-analyzer
JWT_SECRET=any-random-string-here
GITHUB_API_TOKEN=ghp_your-token
```

### 3. Start Development Servers

**Start Backend:**
```bash
cd bridge-assessements/server
npm run dev
```

**Start Frontend (in new terminal):**
```bash
cd bridge-assessements/client
npm run dev
```

### 4. Access the Platform

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5050/api
- **Health Check**: http://localhost:5050/health

## 🔄 Platform Switching

Click the **Bridge logo** in the navigation to see a dropdown with both platforms:
- **Bridge Assessments** - AI-Powered Technical Hiring
- **Bridge GitHub** - GitHub Profile Analysis

The dropdown shows which platform you're currently on with a green indicator.

## 📁 Project Structure

```
Merged_Bridge/
├── bridge-assessements/          # Main platform (runs everything)
│   ├── client/                   # Frontend
│   │   ├── src/
│   │   │   ├── pages/           # Assessments pages
│   │   │   ├── components/
│   │   │   │   └── shared/
│   │   │   │       └── PlatformSwitcher.jsx  # Logo dropdown
│   │   │   └── App.jsx          # Routes for both platforms
│   │   └── package.json
│   │
│   └── server/                   # Backend
│       ├── src/
│       │   ├── routes/          # Assessments routes
│       │   └── server.ts        # Imports GitHub routes
│       ├── config.env.example
│       └── package.json
│
└── Bridge_Github/                # Separate project (you can modify this)
    ├── frontend/
    │   └── src/
    │       ├── pages/           # GitHub pages
    │       └── api/             # GitHub API clients
    │
    └── backend/
        └── src/
            ├── routes/          # GitHub routes
            └── config/          # GitHub DB config
```

## 🛠️ Development Workflow

### Working on Bridge Assessments
1. Navigate to `bridge-assessements/`
2. Edit files in `client/src/` or `server/src/`
3. Changes hot-reload automatically

### Working on Bridge GitHub
1. Navigate to `Bridge_Github/`
2. Edit files in `frontend/src/` or `backend/src/`
3. Changes hot-reload automatically (since Assessments imports them)

### Both projects remain **completely separate** - modify them independently!

## 🔌 API Endpoints

### Bridge Assessments Routes
```
POST   /api/users/create
GET    /api/users/whoami
POST   /api/assessments
GET    /api/assessments
POST   /api/submissions
POST   /api/billing/checkout
POST   /webhooks/elevenlabs
```

### Bridge GitHub Routes
```
POST   /api/github/auth/register
POST   /api/github/auth/login
GET    /api/github/auth/me
POST   /api/github/analyze-user
GET    /api/github/analysis-tiers
GET    /api/github/profile/:username
```

## 🔧 Configuration Details

### Backend Configuration

All environment variables are in `bridge-assessements/server/config.env`:

**Bridge Assessments needs:**
- MongoDB Atlas URI
- Firebase service account
- OpenAI API key
- Pinecone API key (for code indexing)
- Stripe keys (for billing)
- ElevenLabs webhook secret (for interviews)

**Bridge GitHub needs:**
- MongoDB URI (can be local or Atlas)
- JWT secret for authentication
- GitHub API token
- OpenAI API key (shared with Assessments)

### Frontend Configuration

Create `bridge-assessements/client/.env.local`:

```env
# API Base URL
VITE_API_URL=http://localhost:5050

# Firebase (for Assessments)
VITE_FIREBASE_API_KEY=your_key
VITE_FIREBASE_AUTH_DOMAIN=your_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# ElevenLabs (for Assessments)
VITE_ELEVENLABS_AGENT_ID=your_agent_id
```

## 📦 How Integration Works

### Backend Integration

The Assessments server ([bridge-assessements/server/src/server.ts](server/src/server.ts)) imports GitHub routes:

```typescript
// Import GitHub routes from separate project
import githubAuthRoutes from "../../../Bridge_Github/backend/src/routes/auth.routes.js";
import githubUserRoutes from "../../../Bridge_Github/backend/src/routes/user.routes.js";
// ... etc

// Register GitHub routes under /api/github namespace
app.use("/api/github/auth", githubAuthRoutes);
app.use("/api/github/users", githubUserRoutes);
// ... etc
```

### Frontend Integration

The Assessments App.jsx ([bridge-assessements/client/src/App.jsx](client/src/App.jsx)) imports GitHub pages:

```jsx
// Import GitHub pages from separate project
import GitHubLayout from "../../../Bridge_Github/frontend/src/pages/Layout";
import GitHubAnalysis from "../../../Bridge_Github/frontend/src/pages/GitHubAnalysis";
// ... etc

// Add GitHub routes
<Route path="/github" element={<GitHubLayout><GitHubAnalysis /></GitHubLayout>} />
```

## ✅ Testing Checklist

### Backend
- [ ] Server starts without errors (`npm run dev` in server/)
- [ ] Health check works (http://localhost:5050/health)
- [ ] Both Assessments and GitHub routes registered
- [ ] MongoDB connections successful (both databases)

### Frontend
- [ ] Client starts without errors (`npm run dev` in client/)
- [ ] Landing page loads
- [ ] Platform switcher visible in navbar
- [ ] Can switch to GitHub platform
- [ ] Can switch back to Assessments

### API Testing
- [ ] Assessments API calls work
- [ ] GitHub API calls work
- [ ] CORS allows frontend requests
- [ ] Authentication works for both platforms

## 🚢 Deployment

### Deploy to Production

1. **Deploy Backend** (Render, Railway, etc.):
   - Deploy `bridge-assessements/server/`
   - Set all environment variables
   - Ensure `NODE_ENV=production`

2. **Deploy Frontend** (Vercel, Netlify, etc.):
   - Build: `npm run build` in `bridge-assessements/client/`
   - Deploy `dist/` folder
   - Set `VITE_API_URL` to production backend URL

3. **Both platforms will be live** at your production URL!

## 🔍 Troubleshooting

### Backend won't start
- Check MongoDB connection strings in config.env
- Ensure all required API keys are set
- Check port 5050 is not in use

### Frontend won't start
- Run `npm install` in both client folders
- Check Vite config has correct path aliases
- Ensure port 5173 is available

### Platform switcher not showing
- Check that PlatformSwitcher component exists in `bridge-assessements/client/src/components/shared/`
- Verify it's imported in Landing.jsx and GitHub Layout.jsx
- Check console for import errors

### GitHub routes not working
- Verify server.ts imports GitHub routes correctly
- Check relative paths (../../../Bridge_Github/...)
- Ensure GitHub backend dependencies installed

## 📚 Key Benefits

✅ **Easy to Modify**: Each project in its own folder
✅ **Single Deployment**: One server, one frontend
✅ **Seamless Switching**: Logo dropdown navigation
✅ **Independent Codebases**: No coupling between platforms
✅ **Shared Infrastructure**: Common dependencies and config
✅ **Cost Efficient**: One hosting cost instead of two

## 💡 Tips

- **Keep projects separate**: Don't move files between folders unnecessarily
- **Test both platforms**: After changes to either project
- **Use relative imports**: When importing from Bridge_Github to bridge-assessements
- **Update both configs**: When adding new environment variables
- **Deploy together**: Both platforms should be deployed as one unit

## 📖 Additional Documentation

- Original Assessments docs: `bridge-assessements/README.md`
- Original GitHub docs: `Bridge_Github/README.md`
- Deployment guides in each project folder

---

**Questions?** Check the original project READMEs or configuration examples.
