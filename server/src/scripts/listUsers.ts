/**
 * List all users in the database.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/listUsers.ts
 *
 * Env: Ensure config.env (or ATLAS_URI) is loaded.
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import UserModel from "../models/user.js";
import connectMongoose from "../db/mongooseConnection.js";

async function main() {
  try {
    await connectMongoose();

    const users = await UserModel.find({})
      .sort({ createdAt: -1 })
      .lean()
      .select("_id email companyName firebaseUid subscriptionStatus currentPeriodEnd createdAt");

    if (users.length === 0) {
      console.log("No users in the database.");
      await mongoose.disconnect();
      process.exit(0);
      return;
    }

    console.log(`Users (${users.length}):\n`);
    for (const u of users as any[]) {
      const id = u._id.toString();
      const email = u.email ?? "-";
      const company = u.companyName ?? "-";
      const sub = u.subscriptionStatus ?? "free/none";
      const period = u.currentPeriodEnd ? new Date(u.currentPeriodEnd).toISOString().slice(0, 10) : "-";
      console.log(`  ${id}`);
      console.log(`    email: ${email}`);
      console.log(`    company: ${company}`);
      console.log(`    subscription: ${sub}  periodEnd: ${period}`);
      console.log("");
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
