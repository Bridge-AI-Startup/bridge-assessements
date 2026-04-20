import mongoose from "mongoose";

export async function connectDb(uri: string, dbName: string): Promise<void> {
  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 8_000,
  });
}
