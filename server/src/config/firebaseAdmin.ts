import admin from "firebase-admin";
import { readFileSync } from "fs";

// Initialize Firebase Admin SDK
// Option 1: Using service account (recommended for production)
// You can download the service account key from Firebase Console
// and store it securely (e.g., environment variable or file)

let firebaseAdmin: typeof admin | undefined;
let auth: admin.auth.Auth;

try {
  // Check if Firebase Admin is already initialized
  if (admin.apps.length === 0) {
    // Option 1: Use service account from environment variable (JSON string)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    // Option 2: Use service account file path
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const serviceAccount = JSON.parse(
        readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    // Option 3: Use default credentials (for Google Cloud environments)
    else {
      console.warn(
        "⚠️  Firebase Admin SDK not configured. Backend authentication will not work."
      );
      console.warn(
        "   To fix this, set one of the following in your config.env:"
      );
      console.warn(
        "   1. FIREBASE_SERVICE_ACCOUNT (JSON string from Firebase Console)"
      );
      console.warn(
        "   2. FIREBASE_SERVICE_ACCOUNT_PATH (path to service account JSON file)"
      );
      console.warn(
        "   Get your service account key from: Firebase Console → Project Settings → Service Accounts"
      );
      // Create a mock auth object that will throw helpful errors
      auth = {
        verifyIdToken: async () => {
          throw new Error(
            "Firebase Admin SDK not configured. Please set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH in config.env"
          );
        },
      } as admin.auth.Auth;
    }

    if (!auth) {
      firebaseAdmin = admin;
      auth = firebaseAdmin.auth();
      console.log("✅ Firebase Admin initialized successfully");
    }
  } else {
    firebaseAdmin = admin;
    auth = firebaseAdmin.auth();
  }
} catch (error) {
  console.error("❌ Firebase Admin initialization error:", error);
  // Create a mock auth object that will throw errors
  auth = {
    verifyIdToken: async () => {
      throw new Error("Firebase Admin initialization failed");
    },
  } as admin.auth.Auth;
}

export default firebaseAdmin;
export { auth };
