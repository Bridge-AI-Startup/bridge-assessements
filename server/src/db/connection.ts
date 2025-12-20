import { MongoClient, ServerApiVersion, Db } from "mongodb";

const URI = process.env.ATLAS_URI;

if (!URI) {
  throw new Error(
    "Please define the ATLAS_URI environment variable inside config.env"
  );
}

const client = new MongoClient(URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db: Db | undefined;

// Connect to MongoDB
const connectDB = async (): Promise<Db> => {
  try {
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB!");

    // Set the database
    db = client.db(process.env.DB_NAME || "bridge-assessments");
    return db;
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
};

// Get database instance
const getDB = (): Db => {
  if (!db) {
    throw new Error("Database not initialized. Call connectDB() first.");
  }
  return db;
};

// Close database connection
const closeDB = async (): Promise<void> => {
  try {
    await client.close();
    console.log("MongoDB connection closed");
  } catch (err) {
    console.error("Error closing MongoDB connection:", err);
  }
};

export { connectDB, getDB, closeDB };
export default { connectDB, getDB, closeDB };
