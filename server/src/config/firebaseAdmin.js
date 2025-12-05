import admin from "firebase-admin";
import { readFileSync } from "fs";

// Initialize Firebase Admin SDK
// Option 1: Using service account (recommended for production)
// You can download the service account key from Firebase Console
// and store it securely (e.g., environment variable or file)

let firebaseAdmin;
let auth;

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
      try {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      } catch (defaultError) {
        console.warn(
          "⚠️  Firebase Admin not configured. Authentication will not work."
        );
        console.warn(
          "   Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH in config.env"
        );
        // Create a mock auth object that will throw errors
        auth = {
          verifyIdToken: async () => {
            throw new Error("Firebase Admin not configured");
          },
        };
      }
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
  };
}

export default firebaseAdmin;
export { auth };
