# Authentication Architecture & Flow

## 📁 Organization Structure

### Frontend (`client/src/auth/`)
```
auth/
├── firebase.js      # Firebase client SDK initialization
├── service.js       # Core auth functions (signUp, signIn, logOut, etc.)
├── utils.js         # Helper functions (error messages, validation)
└── index.js         # Central export point
```

### Backend (`server/src/`)
```
server/src/
├── config/
│   └── firebaseAdmin.js    # Firebase Admin SDK initialization
├── middleware/
│   └── authMiddleware.js   # Token verification middleware
└── routes/
    └── auth.js             # Auth API endpoints
```

---

## 🔄 Authentication Flow

### 1. **Sign Up Flow**

```
User → AuthModal (Sign Up Tab)
  ↓
Enter email & password
  ↓
validatePassword() checks password strength
  ↓
signUp(email, password) → Firebase Auth
  ↓
Firebase creates user account
  ↓
Redirect to GetStarted page
  ↓
User fills company details (name, logo)
  ↓
handleContinue() → signUp() if not already signed in
  ↓
updateUserProfile({ displayName: companyName })
  ↓
Redirect to AssessmentEditor
```

**Code Path:**
- `AuthModal.jsx` → `signUp()` → `GetStarted.jsx` → `updateUserProfile()`

---

### 2. **Sign In Flow**

```
User → AuthModal (Sign In Tab)
  ↓
Enter email & password
  ↓
signIn(email, password) → Firebase Auth
  ↓
Firebase validates credentials
  ↓
On success: Redirect to Home
On error: Show error message
```

**Code Path:**
- `AuthModal.jsx` → `signIn()` → Redirect to `Home.jsx`

---

### 3. **Authenticated API Request Flow**

```
Frontend Component
  ↓
authenticatedFetch(url, options)
  ↓
getIdToken() → Gets Firebase ID token
  ↓
Add to headers: Authorization: Bearer <token>
  ↓
Send request to backend
  ↓
Backend: verifyToken middleware
  ↓
Extract token from Authorization header
  ↓
auth.verifyIdToken(token) → Firebase Admin SDK
  ↓
Token valid? → Add user info to req.user
  ↓
Continue to route handler
```

**Code Path:**
- `apiClient.js` → `getIdToken()` → Backend `authMiddleware.js` → Route handler

---

## 📦 Frontend Auth Module (`client/src/auth/`)

### `firebase.js`
- **Purpose**: Initialize Firebase client SDK
- **Exports**: `auth`, `analytics`, `firebaseApp`
- **Used by**: All auth service functions

### `service.js`
- **Functions**:
  - `signUp(email, password)` - Create new user account
  - `signIn(email, password)` - Sign in existing user
  - `logOut()` - Sign out current user
  - `getIdToken()` - Get Firebase ID token for API calls
  - `getCurrentUser()` - Get current authenticated user
  - `onAuthStateChange(callback)` - Listen to auth state changes
  - `updateUserProfile(profileData)` - Update user profile

### `utils.js`
- **Functions**:
  - `getAuthErrorMessage(error)` - Convert Firebase errors to user-friendly messages
  - `validatePassword(password)` - Validate password strength (min 6 chars)
  - `validateEmail(email)` - Validate email format

### `index.js`
- **Purpose**: Central export point
- **Usage**: `import { signUp, signIn, ... } from "@/auth"`

---

## 🔒 Backend Auth Module (`server/src/`)

### `config/firebaseAdmin.js`
- **Purpose**: Initialize Firebase Admin SDK
- **Configuration Options**:
  1. `FIREBASE_SERVICE_ACCOUNT` - JSON string in env var
  2. `FIREBASE_SERVICE_ACCOUNT_PATH` - Path to JSON file
  3. Default credentials (Google Cloud environments)
- **Exports**: `auth` (Firebase Admin auth instance)

### `middleware/authMiddleware.js`
- **`verifyToken`**: Required authentication middleware
  - Extracts token from `Authorization: Bearer <token>` header
  - Verifies token with Firebase Admin
  - Adds `req.user` with `{ uid, email, emailVerified, name }`
  - Returns 401 if token is missing/invalid/expired

- **`optionalAuth`**: Optional authentication middleware
  - Same as `verifyToken` but doesn't fail if no token
  - Useful for routes that work with or without auth

### `routes/auth.js`
- **Endpoints**:
  - `POST /api/auth/verify` - Verify token, get user info
  - `POST /api/auth/user` - Create/update user in MongoDB
  - `GET /api/auth/user` - Get current user from MongoDB

---

## 🔐 Security Flow

### Token-Based Authentication

1. **Frontend**:
   ```javascript
   // User signs in
   await signIn(email, password);
   
   // Get token for API calls
   const token = await getIdToken();
   
   // Include in requests
   fetch('/api/protected', {
     headers: {
       'Authorization': `Bearer ${token}`
     }
   });
   ```

2. **Backend**:
   ```javascript
   // Protect route
   router.get('/protected', verifyToken, (req, res) => {
     // req.user is available here
     res.json({ user: req.user });
   });
   ```

---

## 📊 Data Flow Diagram

```
┌─────────────┐
│   Frontend  │
│  (React)    │
└──────┬──────┘
       │
       │ 1. signUp/signIn
       ↓
┌──────────────────┐
│  Firebase Auth   │
│  (Client SDK)     │
└──────┬───────────┘
       │
       │ 2. Returns User + ID Token
       ↓
┌─────────────┐
│   Frontend  │
│  (React)    │
└──────┬──────┘
       │
       │ 3. API Request with Token
       ↓
┌──────────────────┐
│   Backend API    │
│  (Express)       │
└──────┬───────────┘
       │
       │ 4. verifyToken middleware
       ↓
┌──────────────────┐
│ Firebase Admin   │
│ (Server SDK)     │
└──────┬───────────┘
       │
       │ 5. Token verified
       ↓
┌──────────────────┐
│  Route Handler   │
│  (req.user)      │
└──────────────────┘
```

---

## 🎯 Key Components

### Frontend Components Using Auth:
- **`AuthModal.jsx`**: Sign in/Sign up modal
- **`GetStarted.jsx`**: User onboarding after signup
- **`apiClient.js`**: Helper for authenticated API calls

### Backend Routes Using Auth:
- **`/api/auth/*`**: Authentication endpoints
- **Protected routes**: Use `verifyToken` middleware

---

## 🔄 State Management

### Frontend Auth State:
- Managed by Firebase Auth SDK (`auth.currentUser`)
- Listen to changes: `onAuthStateChange(callback)`
- No global state management needed (Firebase handles it)

### Backend Auth State:
- Stateless (JWT tokens)
- Each request verified independently
- User info added to `req.user` per request

---

## 🛡️ Security Features

1. **Token Verification**: Every protected route verifies Firebase ID token
2. **Token Expiration**: Tokens expire automatically (Firebase handles refresh)
3. **Error Handling**: User-friendly error messages
4. **Password Validation**: Minimum 6 characters enforced
5. **Email Validation**: Format validation on frontend

---

## 📝 Usage Examples

### Frontend - Sign Up:
```javascript
import { signUp, getAuthErrorMessage } from "@/auth";

try {
  await signUp(email, password);
  // User created successfully
} catch (error) {
  const message = getAuthErrorMessage(error);
  // Show error to user
}
```

### Frontend - Authenticated API Call:
```javascript
import { authenticatedGet } from "@/utils/apiClient";

const response = await authenticatedGet("http://localhost:5050/api/auth/user");
const data = await response.json();
```

### Backend - Protect Route:
```javascript
import { verifyToken } from "./middleware/authMiddleware.js";

router.get("/protected", verifyToken, (req, res) => {
  // req.user.uid, req.user.email available
  res.json({ message: "Protected data", user: req.user });
});
```

---

## 🔧 Configuration

### Frontend:
- Firebase config in `auth/firebase.js`
- No additional setup needed

### Backend:
- Set `FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_SERVICE_ACCOUNT_PATH` in `config.env`
- Get service account key from Firebase Console → Project Settings → Service Accounts

