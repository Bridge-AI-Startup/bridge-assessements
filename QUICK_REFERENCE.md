# Quick Reference - Unified Bridge Platform

## 🚀 Quick Start

```bash
# 1. Install dependencies
cd bridge-assessements/server && npm install
cd ../client && npm install
cd ../../Bridge_Github/backend && npm install
cd ../frontend && npm install

# 2. Configure
cd bridge-assessements/server
cp config.env.example config.env
# Edit config.env with your API keys

# 3. Start backend
npm run dev

# 4. Start frontend (new terminal)
cd ../client
npm run dev

# 5. Open http://localhost:5173
```

## 📁 Project Layout

```
bridge-assessements/     ← Main platform (runs everything)
  ├── client/           ← Frontend
  └── server/           ← Backend

Bridge_Github/          ← Separate project (modify freely)
  ├── frontend/         ← GitHub UI
  └── backend/          ← GitHub API
```

## 🔌 API Routes

| Platform | Routes | Port |
|----------|--------|------|
| **Assessments** | `/api/users`, `/api/assessments`, `/api/submissions`, `/api/billing` | 5050 |
| **GitHub** | `/api/github/auth`, `/api/github/analysis`, `/api/github/profile` | 5050 |

## 🌐 Frontend Routes

| Platform | Routes |
|----------|--------|
| **Assessments** | `/`, `/Home`, `/CreateAssessment`, `/SubmissionsDashboard` |
| **GitHub** | `/github`, `/github/analysis` |

## 🔧 Configuration Files

| File | Purpose |
|------|---------|
| `bridge-assessements/server/config.env` | All backend config (both platforms) |
| `bridge-assessements/client/.env.local` | Frontend config |

## 🔑 Required Environment Variables

### Minimum to Start

```env
# Server
PORT=5050
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Assessments
ATLAS_URI=mongodb+srv://...
OPENAI_API_KEY=sk-...
FIREBASE_SERVICE_ACCOUNT_JSON={...}

# GitHub
MONGODB_URI=mongodb://localhost:27017/github-analyzer
JWT_SECRET=your-secret
GITHUB_API_TOKEN=ghp_...
```

## 🧭 Platform Switcher

**Location:** Click the Bridge logo in top navigation

**Shows:**
- Bridge Assessments (primary)
- Bridge GitHub (secondary)

**Indicates:** Green dot on current platform

## 🛠️ Development Commands

```bash
# Backend
cd bridge-assessements/server
npm run dev              # Start with hot reload
npm start                # Start production mode

# Frontend
cd bridge-assessements/client
npm run dev              # Start with hot reload
npm run build            # Build for production
npm run preview          # Preview production build
```

## 📝 File Locations

### Backend Integration
- **Main server:** `bridge-assessements/server/src/server.ts`
- **Imports from:** `Bridge_Github/backend/src/routes/*.js`

### Frontend Integration
- **Main app:** `bridge-assessements/client/src/App.jsx`
- **Imports from:** `Bridge_Github/frontend/src/pages/*.jsx`

### Platform Switcher
- **Component:** `bridge-assessements/client/src/components/shared/PlatformSwitcher.jsx`
- **Used in:** `Landing.jsx` and `Bridge_Github/frontend/src/pages/Layout.jsx`

## 🔍 Testing Endpoints

```bash
# Health check
curl http://localhost:5050/health

# Assessments API
curl http://localhost:5050/api/health

# GitHub API
curl http://localhost:5050/api/github/analysis-tiers
```

## 🐛 Common Issues

| Problem | Solution |
|---------|----------|
| Port 5050 in use | `lsof -ti:5050 \| xargs kill -9` |
| MongoDB connection failed | Check `ATLAS_URI` or `MONGODB_URI` |
| Module not found | Run `npm install` in all 4 folders |
| Platform switcher missing | Check it exists in `components/shared/` |
| CORS errors | Verify `FRONTEND_URL` in config.env |

## 📦 Dependencies

### Assessments Server
- Express, Mongoose, Firebase Admin
- Stripe, OpenAI, Pinecone
- **+ GitHub deps:** axios, bcryptjs, helmet, jsonwebtoken, morgan

### Assessments Client
- React, Vite, React Router
- TailwindCSS, Shadcn UI
- Framer Motion, Tanstack Query

### GitHub Server
- Express, Mongoose
- OpenAI, JWT

### GitHub Client
- React, Vite
- TailwindCSS, Axios

## 🔐 Authentication

| Platform | Method | Storage |
|----------|--------|---------|
| **Assessments** | Firebase Auth | Firebase token |
| **GitHub** | JWT | localStorage |

**Note:** Separate auth systems, not shared

## 📊 Database Structure

```
MongoDB Instance
├── bridge-assessments     ← Assessments database
│   ├── users
│   ├── assessments
│   └── submissions
│
└── github-analyzer        ← GitHub database
    ├── users
    └── analyses
```

## 🚢 Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Update `FRONTEND_URL` to production domain
- [ ] Set all API keys in environment
- [ ] Build frontend: `npm run build`
- [ ] Deploy backend: `bridge-assessements/server/`
- [ ] Deploy frontend: `bridge-assessements/client/dist/`
- [ ] Verify health endpoint works
- [ ] Test both platforms live

## 📚 Documentation

| File | Content |
|------|---------|
| `README_UNIFIED.md` | Complete architecture guide |
| `SETUP_GUIDE.md` | Step-by-step setup |
| `INTEGRATION_SUMMARY.md` | Technical details |
| `QUICK_REFERENCE.md` | This file |

## 💡 Pro Tips

1. **Keep projects separate** - Don't move files between folders
2. **Use relative imports** - Assessments imports from Bridge_Github
3. **Test both platforms** - After any changes
4. **Update both configs** - When adding environment variables
5. **Deploy together** - Both platforms as one unit

## 🆘 Getting Help

1. Check `SETUP_GUIDE.md` for setup issues
2. Review `README_UNIFIED.md` for architecture
3. See `INTEGRATION_SUMMARY.md` for technical details
4. Check original project READMEs for platform specifics

## ✅ Success Criteria

Working setup should have:
- ✅ Backend starts without errors
- ✅ Frontend starts without errors
- ✅ Health endpoint returns 200
- ✅ Both platforms load in browser
- ✅ Platform switcher visible and working
- ✅ Can navigate between platforms
- ✅ Both APIs responding
- ✅ No console errors

---

**Everything you need on one page! 📄**
