import express from "express";
import cors from "cors";
import connectMongoose from "./db/mongooseConnection.js";
import "./config/firebaseAdmin.js"; // Initialize Firebase Admin
import userRoutes from "./routes/user.js";
import assessmentRoutes from "./routes/assessment.js";
import submissionRoutes from "./routes/submission.js";

const PORT = process.env.PORT || 5050;
const app = express();

console.log("🔧 Initializing Express server...");
console.log(`📋 Environment: ${process.env.NODE_ENV || "development"}`);
console.log(
  `🌐 Frontend URL: ${process.env.FRONTEND_URL || "http://localhost:5173"}`
);

// Middleware
console.log("🔌 Setting up CORS middleware...");
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173", // React dev server
    credentials: true,
  })
);
console.log("✅ CORS configured");

console.log("📦 Setting up body parsing middleware...");
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
app.use("/api/users", userRoutes);
console.log("  ✅ /api/users routes registered");
console.log("     - POST /api/users/create");
console.log("     - GET /api/users/whoami");

app.use("/api/assessments", assessmentRoutes);
console.log("  ✅ /api/assessments routes registered");
console.log("     - POST /api/assessments");
console.log("     - GET /api/assessments");
console.log("     - GET /api/assessments/:id");
console.log("     - PATCH /api/assessments/:id");
console.log("     - DELETE /api/assessments/:id");

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
