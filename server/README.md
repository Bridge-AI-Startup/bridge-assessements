# MERN Stack Backend Server

Express.js backend server for the Bridge Assessments application with Firebase Authentication.

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure environment variables:**

   - Copy `config.env.example` to `config.env`
   - Update the MongoDB connection string and other variables
   - **Set up Firebase Admin SDK:**
     - Go to Firebase Console → Project Settings → Service Accounts
     - Generate a new private key
     - Either:
       - Add the JSON content as `FIREBASE_SERVICE_ACCOUNT` environment variable (as a JSON string)
       - Or save the file and set `FIREBASE_SERVICE_ACCOUNT_PATH` to the file path

3. **Start the server:**

   ```bash
   # Development mode (with auto-reload)
   npm run dev

   # Production mode
   npm start
   ```

## API Endpoints

### Health Check

- `GET /health` - Check server status

### Authentication API

- `POST /api/auth/verify` - Verify Firebase token and get user info (requires Bearer token)
- `POST /api/auth/user` - Create or update user in database (requires Bearer token)
- `GET /api/auth/user` - Get current user from database (requires Bearer token)

### User Auth API (Controller-based)

- `POST /api/user-auth/create` - Create a new user in database (requires Bearer token)
- `POST /api/user-auth/login` - Login/Create user using Firebase token (token in body)
- `GET /api/user-auth/me` - Get current user by Firebase token (requires Bearer token)
- `GET /api/user-auth/email/:email` - Get user by email (requires Bearer token)
- `PATCH /api/user-auth/me` - Update current user (requires Bearer token)

### Records API

- `GET /api/records` - Get all records
- `GET /api/records/:id` - Get a single record
- `POST /api/records` - Create a new record
- `PATCH /api/records/:id` - Update a record (partial)
- `PUT /api/records/:id` - Replace a record (full)
- `DELETE /api/records/:id` - Delete a record

### Users API

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get a single user by ID
- `GET /api/users/email/:email` - Get a user by email
- `POST /api/users` - Create a new user (requires: email, name; optional: logo)
- `PATCH /api/users/:id` - Update a user (partial)
- `PUT /api/users/:id` - Replace a user (full update)
- `DELETE /api/users/:id` - Delete a user

## Authentication

The backend uses Firebase Admin SDK to verify Firebase ID tokens. To make authenticated requests:

1. Get the Firebase ID token from the frontend (using `getIdToken()`)
2. Include it in the `Authorization` header: `Bearer <token>`
3. Use the `verifyToken` middleware to protect routes

Example:

```javascript
fetch("/api/auth/user", {
  headers: {
    Authorization: `Bearer ${firebaseToken}`,
  },
});
```

## Project Structure

```
server/
├── src/
│   ├── config/
│   │   └── firebaseAdmin.js    # Firebase Admin initialization
│   ├── controllers/
│   │   └── userController.js   # User controller (create, login)
│   ├── db/
│   │   ├── connection.js        # MongoDB native driver connection
│   │   └── mongooseConnection.js # Mongoose connection
│   ├── models/
│   │   └── User.js             # User Mongoose model
│   ├── middleware/
│   │   ├── authMiddleware.js   # Firebase token verification
│   │   └── errorHandler.js     # Error handling middleware
│   ├── routes/
│   │   ├── auth.js             # Authentication routes
│   │   ├── userAuth.js         # User auth routes (uses controller)
│   │   ├── record.js           # Record routes
│   │   └── user.js             # User routes
│   └── server.js               # Express server setup
├── config.env                  # Environment variables (not in git)
├── config.env.example          # Example environment file
└── package.json                # Dependencies
```

## Environment Variables

- `ATLAS_URI` - MongoDB Atlas connection string
- `DB_NAME` - Database name (default: bridge-assessments)
- `PORT` - Server port (default: 5050)
- `FRONTEND_URL` - Frontend URL for CORS (default: http://localhost:5173)
- `NODE_ENV` - Environment (development/production)
- `FIREBASE_SERVICE_ACCOUNT` - Firebase service account JSON as string (recommended)
- `FIREBASE_SERVICE_ACCOUNT_PATH` - Path to Firebase service account JSON file (alternative)

### AI Provider Configuration (LangChain)

The application uses **LangChain** to support multiple AI providers with per-use-case configuration. You can use different providers for different purposes:

**Use Cases:**
- `assessment_generation` - Generate assessment components from job description
- `assessment_chat` - Chat with assessment AI assistant
- `interview_questions` - Generate interview questions from code
- `interview_summary` - Generate interview summary from transcript

**Configuration Options:**

1. **Global Provider** (applies to all use cases unless overridden):
   ```env
   AI_PROVIDER=openai  # or "anthropic" or "gemini"
   ```

2. **Per-Use-Case Providers** (override global for specific use cases):
   ```env
   AI_PROVIDER_ASSESSMENT_GENERATION=anthropic
   AI_PROVIDER_INTERVIEW_QUESTIONS=gemini
   AI_PROVIDER_ASSESSMENT_CHAT=openai
   AI_PROVIDER_INTERVIEW_SUMMARY=anthropic
   ```

3. **Model Configuration** (per provider, with per-use-case overrides):
   ```env
   # Global models
   OPENAI_MODEL=gpt-4o-mini
   ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
   GEMINI_MODEL=gemini-1.5-pro
   
   # Per-use-case models (optional)
   OPENAI_MODEL_ASSESSMENT_GENERATION=gpt-4o
   ANTHROPIC_MODEL_INTERVIEW_QUESTIONS=claude-3-5-haiku-20241022
   ```

**Supported Providers:**
- **OpenAI**: Requires `OPENAI_API_KEY`
- **Anthropic**: Requires `ANTHROPIC_API_KEY`
- **Gemini**: Requires `GEMINI_API_KEY`

See `config.env.example` for complete configuration options.
