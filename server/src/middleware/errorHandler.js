// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error("Error:", err);

  // MongoDB duplicate key error
  if (err.code === 11000) {
    return res.status(400).json({
      error: "Duplicate entry",
      message: "A record with this information already exists",
    });
  }

  // MongoDB validation error
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "Validation Error",
      message: err.message,
    });
  }

  // MongoDB cast error (invalid ObjectId)
  if (err.name === "CastError") {
    return res.status(400).json({
      error: "Invalid ID format",
      message: "The provided ID is not valid",
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

export default errorHandler;
