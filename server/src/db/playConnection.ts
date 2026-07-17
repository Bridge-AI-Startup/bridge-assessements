import mongoose, { type Connection } from "mongoose";

const MONGODB_URI = process.env.ATLAS_URI;

if (!MONGODB_URI) {
  throw new Error(
    "ATLAS_URI environment variable is required. " +
      "Set it in config.env (local) or as an environment variable (production).",
  );
}

interface PlayConnectionCache {
  conn: Connection | null;
  promise: Promise<Connection> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var playMongoose: PlayConnectionCache | undefined;
}

let cached = global.playMongoose;

if (!cached) {
  cached = global.playMongoose = { conn: null, promise: null };
}

const playDbName = () => process.env.PLAY_DB_NAME || "bridge-play";

/**
 * Connect to the Play product MongoDB database (separate from assessments).
 */
export const connectPlayMongoose = async (): Promise<Connection> => {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const dbName = playDbName();
    cached.promise = mongoose
      .createConnection(MONGODB_URI, {
        bufferCommands: false,
        dbName,
      })
      .asPromise()
      .then((conn) => {
        console.log(
          `✅ Successfully connected to MongoDB Play database (${dbName})!`,
        );
        return conn;
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

/**
 * Returns the Play database connection. Throws if not connected yet.
 */
export const getPlayConnection = (): Connection => {
  if (!cached.conn) {
    throw new Error(
      "Play MongoDB connection not initialized. Call connectPlayMongoose() first.",
    );
  }
  return cached.conn;
};

export default connectPlayMongoose;
