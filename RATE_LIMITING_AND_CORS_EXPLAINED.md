# Rate Limiting & CORS Hardening Explained

## 🔒 Rate Limiting

### What It Is
Rate limiting restricts how many requests a single client (IP address) can make to your API within a specific time period.

### Why You Need It
**Without rate limiting:**
- Attacker can send 10,000 requests/second → Server crashes 💥
- Someone can spam your API → High costs 💰
- Brute force attacks on login → Security breach 🔓

**With rate limiting:**
- Attacker sends 10,000 requests → Only first 100 accepted, rest blocked ✅
- Legitimate users protected from abuse
- Server stays stable under attack

### How It Works
```typescript
// Example: Allow 100 requests per 15 minutes per IP
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', apiLimiter);
```

### Different Limits for Different Endpoints
```typescript
// Stricter limit for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 login attempts per 15 minutes
  message: 'Too many login attempts, please try again later.'
});

app.use('/api/users/login', authLimiter);

// More lenient for general API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

app.use('/api/', apiLimiter);
```

---

## 🛡️ CORS Hardening

### What CORS Is
CORS (Cross-Origin Resource Sharing) controls which websites can make requests to your API.

**Example:**
- Your frontend: `https://myapp.com`
- Your API: `https://api.myapp.com`
- CORS allows `myapp.com` to call `api.myapp.com`

### Current Problem (Vulnerable)
```typescript
// VULNERABLE - trusts env var blindly
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));
```

**What could go wrong:**
1. If `FRONTEND_URL` is empty → Allows ALL origins (any website can call your API) 🚨
2. If `FRONTEND_URL` is misconfigured → Wrong domain allowed 🚨
3. Attacker creates malicious site → Can steal user data if CORS allows it 🚨

### Hardened Solution (Secure)
```typescript
// SECURE - explicitly validates origins
const allowedOrigins = [
  'https://your-production-domain.com',
  'https://www.your-production-domain.com',
  process.env.FRONTEND_URL, // Only if set correctly
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true); // Allow
    } else {
      console.warn(`Blocked unauthorized origin: ${origin}`);
      callback(new Error('Not allowed by CORS')); // Block
    }
  },
  credentials: true,
}));
```

### What This Does
- ✅ Only explicitly listed domains can call your API
- ✅ Logs unauthorized attempts
- ✅ Blocks malicious sites automatically
- ✅ Still allows development (localhost)

---

## 📋 Implementation Steps

### 1. Install Rate Limiting Package
```bash
cd server
npm install express-rate-limit
```

### 2. Add Rate Limiting to server.ts
```typescript
import rateLimit from 'express-rate-limit';

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
});

// Stricter limit for authentication
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // Only 5 attempts per 15 minutes
  message: {
    error: 'Too many login attempts, please try again later.',
  },
});

// Apply to routes
app.use('/api/users/login', authLimiter);
app.use('/api/', apiLimiter);
```

### 3. CORS Already Hardened ✅
I've already updated the CORS configuration in `server.ts` to validate origins explicitly.

---

## 🎯 Summary

**Rate Limiting:**
- Prevents abuse and DoS attacks
- Protects your server and costs
- Easy to implement with `express-rate-limit`

**CORS Hardening:**
- Prevents unauthorized websites from calling your API
- Already implemented ✅
- Explicitly validates allowed origins

Both are essential security measures for production deployment!

