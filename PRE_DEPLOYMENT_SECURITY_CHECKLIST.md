# Pre-Deployment Security & Bug Checklist

## 🔴 CRITICAL SECURITY ISSUES

### 1. Environment Variable Validation
**Status:** ⚠️ **NEEDS ATTENTION**

**Issues:**
- Some critical env vars are checked, but not all
- `AGENT_SECRET` allows access without auth if not set (development only - OK for dev, but MUST be set in production)
- `ELEVENLABS_WEBHOOK_SECRET` must be set or webhooks will fail
- `STRIPE_WEBHOOK_SECRET` must be set or billing webhooks will fail

**Action Required:**
```typescript
// Add startup validation in server.ts
const requiredEnvVars = [
  'ATLAS_URI',
  'FIREBASE_SERVICE_ACCOUNT',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID',
  'APP_URL',
  'AGENT_SECRET', // MUST be set in production
  'ELEVENLABS_WEBHOOK_SECRET',
  'PINECONE_API_KEY',
  'PINECONE_INDEX_NAME',
  'OPENAI_API_KEY',
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ CRITICAL: ${varName} is not set!`);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
});
```

### 2. CORS Configuration
**Status:** ⚠️ **NEEDS HARDENING**

**Current:** Allows any origin from `FRONTEND_URL` env var
**Risk:** If env var is misconfigured, could allow unauthorized origins

**Action Required:**
```typescript
// In server.ts - Add explicit origin validation
const allowedOrigins = [
  process.env.FRONTEND_URL,
  // Add production domain explicitly
  'https://your-production-domain.com'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
```

### 3. Console.log in Production
**Status:** ⚠️ **PERFORMANCE/SECURITY CONCERN**

**Found:** 327+ console.log statements
**Risk:** 
- Performance impact in production
- Potential information leakage (sensitive data in logs)
- Log noise makes debugging harder

**Action Required:**
- Use a proper logging library (winston, pino)
- Remove or gate debug logs behind `NODE_ENV !== 'production'`
- Never log:
  - API keys
  - User tokens
  - Full request bodies with sensitive data
  - Database connection strings

### 4. Error Messages Expose Internal Details
**Status:** ⚠️ **INFORMATION DISCLOSURE**

**Found in:** Error handlers may expose stack traces in production

**Action Required:**
```typescript
// In error handler - ensure production doesn't expose stack traces
if (process.env.NODE_ENV === 'production') {
  // Don't send stack traces to client
  res.status(500).json({ error: 'Internal server error' });
} else {
  // Development can show full error
  res.status(500).json({ error: err.message, stack: err.stack });
}
```

### 5. Webhook Signature Verification
**Status:** ✅ **GOOD** (but verify)

**Current:** Both ElevenLabs and Stripe webhooks verify signatures
**Action:** Double-check that webhook secrets are set in production

### 6. Authentication Bypass Risk
**Status:** ⚠️ **REVIEW NEEDED**

**Found:** `AGENT_SECRET` check allows access if not set:
```typescript
if (!agentSecret) {
  console.warn("⚠️ [agentTools] AGENT_SECRET not configured. Allowing access without auth.");
  return next();
}
```

**Action:** This is OK for development, but MUST ensure `AGENT_SECRET` is set in production

---

## 🟡 MEDIUM PRIORITY ISSUES

### 7. Input Validation
**Status:** ✅ **GOOD** (using express-validator)

**Action:** Verify all user inputs are validated:
- ✅ Assessment creation/updates
- ✅ Submission creation/updates
- ✅ User creation
- ⚠️ Review: GitHub URL validation for injection attacks

### 8. Database Injection Protection
**Status:** ✅ **GOOD** (using Mongoose ODM)

**Action:** Mongoose provides protection, but verify:
- No raw MongoDB queries with user input
- All queries use parameterized inputs

### 9. Rate Limiting
**Status:** ❌ **MISSING**

**Risk:** API endpoints vulnerable to abuse/DoS

**Action Required:**
```bash
npm install express-rate-limit
```

```typescript
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', apiLimiter);
```

### 10. Request Size Limits
**Status:** ⚠️ **PARTIAL**

**Current:** 10mb limit on webhooks, but no limit on other routes
**Action:** Add body size limits to prevent DoS

```typescript
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
```

### 11. HTTPS Enforcement
**Status:** ⚠️ **DEPENDS ON DEPLOYMENT**

**Action:** Ensure:
- Production uses HTTPS only
- HSTS headers set
- Redirect HTTP → HTTPS

### 12. Security Headers
**Status:** ❌ **MISSING**

**Action Required:**
```bash
npm install helmet
```

```typescript
import helmet from 'helmet';
app.use(helmet());
```

---

## 🟢 LOW PRIORITY / BEST PRACTICES

### 13. Database Indexes
**Status:** ✅ **GOOD** (sparse indexes on conversationId)

**Action:** Verify indexes are created in production

### 14. Error Logging
**Status:** ⚠️ **BASIC**

**Action:** Consider proper error tracking:
- Sentry
- LogRocket
- CloudWatch (if on AWS)

### 15. Health Check Endpoint
**Status:** ✅ **EXISTS** (`/health`)

**Action:** Consider adding database connectivity check

### 16. Graceful Shutdown
**Status:** ⚠️ **BASIC**

**Action:** Add graceful shutdown handlers:
```typescript
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await mongoose.connection.close();
  process.exit(0);
});
```

---

## 🐛 POTENTIAL BUGS

### 1. Syntax Error in submissionAuth.ts
**Status:** 🔴 **CRITICAL BUG**

**Found:** Line 72-77 in `server/src/validators/submissionAuth.ts`:
```typescript
if (candidateToken &&
  // Verify token matches this submission
  if (submission.token === candidateToken) {
    return next();
  }
}
```

**Issue:** Nested `if` statement without proper braces - this will cause a syntax error!

**Fix Required:**
```typescript
if (candidateToken) {
  // Verify token matches this submission
  if (submission.token === candidateToken) {
    return next();
  }
}
```

### 2. Missing Error Handling
**Status:** ⚠️ **REVIEW NEEDED**

**Action:** Review all async operations have try/catch:
- ✅ Most controllers have error handling
- ⚠️ Background tasks (repo indexing) may need better error handling

### 3. Race Conditions
**Status:** ⚠️ **POTENTIAL**

**Areas to review:**
- Subscription limit checks (assessment/submission creation)
- Webhook processing (idempotency is good, but verify)

---

## 📋 DEPLOYMENT CHECKLIST

### Environment Variables
- [ ] All required env vars set in production
- [ ] `NODE_ENV=production`
- [ ] `FRONTEND_URL` set to production domain
- [ ] `APP_URL` set to production domain
- [ ] All API keys rotated from dev values
- [ ] `AGENT_SECRET` is strong random value
- [ ] Stripe keys are production keys (not test)

### Security
- [ ] CORS configured for production domain only
- [ ] Rate limiting enabled
- [ ] Security headers (helmet) enabled
- [ ] HTTPS enforced
- [ ] Webhook secrets verified
- [ ] Console.logs removed/gated for production

### Database
- [ ] Production MongoDB cluster configured
- [ ] Connection string uses production credentials
- [ ] Backups enabled
- [ ] Indexes created

### Monitoring
- [ ] Error tracking configured (Sentry, etc.)
- [ ] Logging configured
- [ ] Health checks working
- [ ] Alerts set up for critical errors

### Testing
- [ ] All critical paths tested
- [ ] Webhook endpoints tested
- [ ] Subscription flow tested end-to-end
- [ ] Authentication flow tested

---

## 🚨 IMMEDIATE ACTIONS BEFORE DEPLOY

1. **Fix syntax error in `submissionAuth.ts`** (CRITICAL)
2. **Add environment variable validation** (CRITICAL)
3. **Set `AGENT_SECRET` in production** (CRITICAL)
4. **Harden CORS configuration** (HIGH)
5. **Add rate limiting** (HIGH)
6. **Add security headers (helmet)** (HIGH)
7. **Gate console.logs for production** (MEDIUM)
8. **Add proper error handling** (MEDIUM)

---

## 📝 NOTES

- Most security practices are in place
- Main concerns are configuration validation and production hardening
- The syntax error in `submissionAuth.ts` MUST be fixed before deploy
- Consider adding monitoring/alerting before going live

