# Frontend-Backend Authentication Integration

## 🔄 Complete Authentication Flow

### 1. **User Sign Up Flow**

```
User fills AuthModal (Sign Up)
  ↓
signUp(email, password) → Firebase Auth
  ↓
Firebase creates user account
  ↓
Redirect to GetStarted page
  ↓
User fills company details (name, logo)
  ↓
handleContinue() in GetStarted:
  - If not signed in: signUp() → Firebase
  - updateUserProfile({ displayName: companyName }) → Firebase
  - createUserInBackend({ name, companyLogoUrl }) → Backend API
  ↓
Backend: createUser() controller
  - Verifies Firebase token
  - Creates user in MongoDB
  ↓
Redirect to AssessmentEditor
```

### 2. **User Sign In Flow**

```
User fills AuthModal (Sign In)
  ↓
signIn(email, password) → Firebase Auth
  ↓
Firebase validates credentials
  ↓
loginUserInBackend() → Backend API
  ↓
Backend: loginUser() controller
  - Verifies Firebase token
  - Gets or creates user in MongoDB
  ↓
Redirect to Home
```

---

## 📦 New Backend Integration Functions

### Added to `client/src/auth/service.js`:

1. **`createUserInBackend(userData)`**
   - Creates user in MongoDB after Firebase signup
   - Requires: authenticated user (Firebase token)
   - Endpoint: `POST /api/user-auth/create`

2. **`loginUserInBackend(additionalData)`**
   - Verifies token and gets/creates user in MongoDB
   - Handles both login and signup scenarios
   - Endpoint: `POST /api/user-auth/login`

3. **`getCurrentUserFromBackend()`**
   - Gets current user from MongoDB
   - Endpoint: `GET /api/user-auth/me`

4. **`updateUserInBackend(updateData)`**
   - Updates user in MongoDB
   - Endpoint: `PATCH /api/user-auth/me`

---

## 🔧 Configuration

### API Configuration (`client/src/config/api.js`)
- `API_BASE_URL`: Backend server URL (default: `http://localhost:5050`)
- Can be overridden with `VITE_API_URL` environment variable

---

## 📝 Updated Components

### `AuthModal.jsx`
- **Sign In**: After Firebase sign in, calls `loginUserInBackend()`
- Creates/updates user in backend database automatically

### `GetStarted.jsx`
- **After Firebase signup**: Calls `createUserInBackend()` or `updateUserInBackend()`
- Saves company name and logo to backend database
- Falls back to `loginUserInBackend()` if create fails

---

## 🎯 API Endpoints Used

### User Auth Endpoints:
- `POST /api/user-auth/create` - Create user (requires Bearer token)
- `POST /api/user-auth/login` - Login/Create user (token in body)
- `GET /api/user-auth/me` - Get current user (requires Bearer token)
- `PATCH /api/user-auth/me` - Update current user (requires Bearer token)

---

## 🔐 Security Flow

1. **Frontend**: User authenticates with Firebase
2. **Frontend**: Gets Firebase ID token
3. **Frontend**: Sends token to backend (in Authorization header or body)
4. **Backend**: Verifies token with Firebase Admin SDK
5. **Backend**: Creates/updates user in MongoDB
6. **Backend**: Returns user data

---

## 💡 Usage Examples

### Sign In (Automatic Backend Sync):
```javascript
// In AuthModal.jsx
await signIn(email, password);
await loginUserInBackend(); // Automatically syncs with backend
```

### Sign Up (Create in Backend):
```javascript
// In GetStarted.jsx
await signUp(email, password);
await createUserInBackend({
  name: companyName,
  companyLogoUrl: logoPreview
});
```

### Get Current User from Backend:
```javascript
import { getCurrentUserFromBackend } from "@/auth";

const user = await getCurrentUserFromBackend();
console.log(user); // { _id, firebaseUid, email, name, companyLogoUrl, ... }
```

---

## ✅ Integration Complete

The frontend now automatically:
- ✅ Creates users in MongoDB after Firebase signup
- ✅ Syncs user data on login
- ✅ Updates user profile in backend
- ✅ Handles errors gracefully (continues even if backend fails)

