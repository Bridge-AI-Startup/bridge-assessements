import mongoose from "mongoose";

const MONGODB_URI = process.env.ATLAS_URI;

if (!MONGODB_URI) {
  throw new Error(
    "ATLAS_URI environment variable is required. " +
      "Set it in config.env (local) or as an environment variable (production)."
  );
}

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongoose: MongooseCache | undefined;
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

/**
 * Connect to MongoDB using Mongoose
 * @returns {Promise<typeof mongoose>}
 */
const connectMongoose = async (): Promise<typeof mongoose> => {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    // Extract database name from URI or use default
    const dbName = process.env.DB_NAME || "bridge-assessments";

    cached.promise = mongoose
      .connect(MONGODB_URI, {
        ...opts,
        dbName,
      })
      .then((mongoose) => {
        console.log("✅ Successfully connected to MongoDB with Mongoose!");
        return mongoose;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
};

export default connectMongoose;
