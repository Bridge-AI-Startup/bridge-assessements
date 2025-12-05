import express from "express";
import cors from "cors";
import { connectDB } from "./db/connection.js";
import connectMongoose from "./db/mongooseConnection.js";
import "./config/firebaseAdmin.js"; // Initialize Firebase Admin
import records from "./routes/record.js";
import users from "./routes/user.js";
import auth from "./routes/auth.js";
import userAuth from "./routes/userAuth.js";
import errorHandler from "./middleware/errorHandler.js";

const PORT = process.env.PORT || 5050;
const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173", // React dev server
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/auth", auth);
app.use("/api/user-auth", userAuth);
app.use("/api/records", records);
app.use("/api/users", users);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB (native driver for existing routes)
    await connectDB();

    // Connect to MongoDB with Mongoose (for User model)
    await connectMongoose();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 Server listening on port ${PORT}`);
      console.log(`📍 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
