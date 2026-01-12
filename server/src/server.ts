// Load config.env file FIRST, before any other imports that might need env vars
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load config.env from the server directory (where this file is located)
const configPath = join(__dirname, "..", "config.env");

if (existsSync(configPath)) {
  config({ path: configPath });
  console.log("📄 Loaded environment variables from config.env");
} else if (existsSync("config.env")) {
  // Fallback: try relative path (if running from server directory)
  config({ path: "config.env" });
  console.log("📄 Loaded environment variables from config.env (relative path)");
} else {
  console.log("📄 Using environment variables from system (production mode)");
}

// Now import other modules that might need environment variables
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import connectMongoose from "./db/mongooseConnection.js";
import "./config/firebaseAdmin.js"; // Initialize Firebase Admin
import userRoutes from "./routes/user.js";
import assessmentRoutes from "./routes/assessment.js";
import submissionRoutes from "./routes/submission.js";
import agentToolsRoutes from "./routes/agentTools.js";
import webhookRoutes from "./routes/webhook.js";
import billingRoutes from "./routes/billing.js";

const PORT = process.env.PORT || 5050;
const app = express();

console.log("🔧 Initializing Express server...");

// Check NODE_ENV - warn if not set in production
const nodeEnv = process.env.NODE_ENV || "development";
if (!process.env.NODE_ENV) {
  console.warn("⚠️  NODE_ENV not set, defaulting to 'development'");
  console.warn("   Set NODE_ENV=production in your production environment!");
}

if (nodeEnv === "production") {
  console.log("✅ Running in PRODUCTION mode");
  console.log("   - Rate limiting: ENABLED");
  console.log("   - CORS: Hardened");
} else {
  console.log("🔧 Running in DEVELOPMENT mode");
  console.log("   - Rate limiting: DISABLED (for testing)");
}

console.log(`📋 Environment: ${nodeEnv}`);
console.log(
  `🌐 Frontend URL: ${process.env.FRONTEND_URL || "http://localhost:5173"}`
);

// Middleware
console.log("🔌 Setting up CORS middleware...");

// Hardened CORS configuration - explicitly validate allowed origins
const allowedOrigins = [
  // Production domains (add your actual production domain here)
  process.env.FRONTEND_URL,
  "https://www.bridge-jobs.com",
  "https://bridge-landing-saazms-projects.vercel.app",
  "https://bridge-landing-7dg0wxh94-saazms-projects.vercel.app",
  // Development
  ...(process.env.NODE_ENV === "development"
    ? ["http://localhost:5173", "http://localhost:3000"]
    : []),
].filter(Boolean); // Remove any undefined/null values

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(
          `⚠️ [CORS] Blocked request from unauthorized origin: ${origin}`
        );
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
console.log("✅ CORS configured with origin validation");
console.log(`   Allowed origins: ${allowedOrigins.join(", ")}`);

// Rate limiting configuration
console.log("🛡️ Setting up rate limiting...");

// General API rate limit - 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  // Skip rate limiting in development for easier testing
  skip: (req) => process.env.NODE_ENV === "development",
});

// Stricter rate limit for authentication endpoints - 5 requests per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many login attempts, please try again later.",
  },
  skip: (req) => process.env.NODE_ENV === "development",
});

// Stricter rate limit for webhook endpoints - 50 requests per 15 minutes
// (Webhooks should come from specific services, not random IPs)
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many webhook requests from this IP, please try again later.",
  },
  skip: (req) => process.env.NODE_ENV === "development",
});

console.log("✅ Rate limiting configured");
console.log("   - General API: 100 requests per 15 minutes");
console.log("   - Authentication: 5 requests per 15 minutes");
console.log("   - Webhooks: 50 requests per 15 minutes");
console.log("   - Rate limiting disabled in development mode");

console.log("📦 Setting up body parsing middleware...");

// Raw body parser for webhook signature verification
// This MUST be applied BEFORE express.json() to preserve the raw body stream
// It stores the raw body in req.rawBody for HMAC verification
app.use(
  ["/webhooks", "/api/billing/webhook"],
  express.raw({ type: "*/*", limit: "10mb" }),
  (req, res, next) => {
    // Store raw body for signature verification
    (req as any).rawBody = req.body;
    // Also parse as JSON for convenience
    try {
      const bodyString = req.body.toString("utf-8");
      (req as any).body = JSON.parse(bodyString);
    } catch {
      // If JSON parsing fails, body remains as Buffer
      (req as any).body = {};
    }
    next();
  }
);

// Standard JSON body parser for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log("✅ Body parsing configured");

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  // Force immediate output
  process.stdout.write(`\n${"=".repeat(60)}\n`);
  process.stdout.write(`📨 [${timestamp}] ${req.method} ${req.originalUrl}\n`);
  process.stdout.write(`   IP: ${req.ip || req.connection.remoteAddress}\n`);
  console.log(`📨 [${timestamp}] ${req.method} ${req.originalUrl}`);
  console.log(`   IP: ${req.ip || req.connection.remoteAddress}`);
  if (Object.keys(req.body).length > 0) {
    console.log(
      `   Body:`,
      JSON.stringify(req.body, null, 2).substring(0, 200)
    );
  }
  if (Object.keys(req.query).length > 0) {
    console.log(`   Query:`, req.query);
  }
  if (Object.keys(req.params).length > 0) {
    console.log(`   Params:`, req.params);
  }
  next();
});
console.log("✅ Request logging middleware configured");

// Health check route
app.get("/health", (req, res) => {
  console.log("🏥 Health check requested");
  console.error("TEST ERROR LOG - If you see this, logs are working!");
  process.stdout.write("TEST STDOUT - Direct write to stdout\n");
  res.status(200).json({
    status: "OK",
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// API Routes
console.log("🛣️  Registering API routes...");

// Apply rate limiting to routes (more specific limiters first)
app.use("/api/users/whoami", authLimiter); // Stricter limit for auth endpoint
app.use("/api/users", apiLimiter); // General limit for user routes
app.use("/api/users", userRoutes);
console.log("  ✅ /api/users routes registered");
console.log("     - POST /api/users/create");
console.log("     - GET /api/users/whoami (rate limited: 5/15min)");

app.use("/api/assessments", apiLimiter); // Apply general limit
app.use("/api/assessments", assessmentRoutes);
console.log("  ✅ /api/assessments routes registered");
console.log("     - POST /api/assessments");
console.log("     - GET /api/assessments");
console.log("     - GET /api/assessments/:id");
console.log("     - PATCH /api/assessments/:id");
console.log("     - DELETE /api/assessments/:id");

app.use("/api/submissions", apiLimiter); // Apply general limit
app.use("/api/submissions", submissionRoutes);
console.log("  ✅ /api/submissions routes registered");
console.log("     - POST /api/submissions/generate-link (employer)");
console.log("     - GET /api/submissions/assessments/public/:id");
console.log("     - GET /api/submissions/token/:token");
console.log("     - POST /api/submissions/token/:token/start");
console.log("     - POST /api/submissions/token/:token/submit");
console.log("     - POST /api/submissions/start");
console.log("     - GET /api/submissions/:id");
console.log("     - PATCH /api/submissions/:id");
console.log("     - POST /api/submissions/:id/submit");
console.log(
  "     - GET /api/submissions/assessments/:id/submissions (employer)"
);

app.use("/api/agent-tools", apiLimiter); // Apply general limit
app.use("/api/agent-tools", agentToolsRoutes);
console.log("  ✅ /api/agent-tools routes registered");
console.log("     - POST /api/agent-tools/get-context");

app.use("/webhooks", webhookLimiter); // Apply webhook-specific limit
app.use("/webhooks", webhookRoutes);
console.log("  ✅ /webhooks routes registered");
console.log("     - POST /webhooks/elevenlabs (rate limited: 50/15min)");

app.use("/api/billing", apiLimiter); // Apply general limit
app.use("/api/billing", billingRoutes);
console.log("  ✅ /api/billing routes registered");
console.log("     - POST /api/billing/checkout");
console.log("     - GET /api/billing/status");
console.log("     - POST /api/billing/webhook");

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

// Start server
const startServer = async () => {
  try {
    console.log("\n🔌 Connecting to database...");
    // Connect to MongoDB with Mongoose (for User model)
    console.log("   🔄 Connecting to MongoDB (Mongoose)...");
    await connectMongoose();
    console.log("   ✅ MongoDB (Mongoose) connected");

    // Start Express server
    console.log("\n🚀 Starting Express server...");
    app.listen(PORT, () => {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`✅ Server is running!`);
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌐 Health check: http://localhost:${PORT}/health`);
      console.log(`📡 API base: http://localhost:${PORT}/api`);
      console.log(`${"=".repeat(60)}\n`);
    });
  } catch (error) {
    console.error("\n❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
