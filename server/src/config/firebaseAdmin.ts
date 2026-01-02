import admin from "firebase-admin";
import { readFileSync, existsSync } from "fs";

/**
 * Initialize Firebase Admin SDK
 * 
 * Priority order:
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON (environment variable with JSON string) - REQUIRED for production
 * 2. FIREBASE_SERVICE_ACCOUNT_PATH (local file path) - Optional, for local development only
 * 
 * Production environments (like Render) should use FIREBASE_SERVICE_ACCOUNT_JSON.
 * Local development can use either method.
 */

let firebaseAdmin: typeof admin | undefined;
let auth: admin.auth.Auth;

try {
  // Check if Firebase Admin is already initialized
  if (admin.apps.length === 0) {
    let serviceAccount: admin.ServiceAccount | null = null;
    let initializationMethod: string | null = null;

    // Option 1: Use service account from environment variable (JSON string) - REQUIRED for production
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      try {
        const jsonString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
        if (!jsonString) {
          throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is empty");
        }
        serviceAccount = JSON.parse(jsonString);
        initializationMethod = "FIREBASE_SERVICE_ACCOUNT_JSON (environment variable)";
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : "Unknown error";
        throw new Error(
          `Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${errorMessage}. ` +
          `Please ensure the environment variable contains valid JSON.`
        );
      }
    }
    // Option 2: Use service account file path (local development only)
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH.trim();
      
      if (!filePath) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH is empty");
      }

      if (!existsSync(filePath)) {
        throw new Error(
          `Firebase service account file not found at path: ${filePath}. ` +
          `This method is only supported for local development. ` +
          `For production, use FIREBASE_SERVICE_ACCOUNT_JSON environment variable.`
        );
      }

      try {
        const fileContent = readFileSync(filePath, "utf8");
        serviceAccount = JSON.parse(fileContent);
        initializationMethod = `FIREBASE_SERVICE_ACCOUNT_PATH (${filePath})`;
      } catch (fileError) {
        const errorMessage = fileError instanceof Error ? fileError.message : "Unknown error";
        throw new Error(
          `Failed to read or parse Firebase service account file at ${filePath}: ${errorMessage}`
        );
      }
    }
    // No credentials provided
    else {
      const isProduction = process.env.NODE_ENV === "production";
      
      if (isProduction) {
        throw new Error(
          "Firebase Admin SDK not configured. " +
          "FIREBASE_SERVICE_ACCOUNT_JSON environment variable is required in production. " +
          "Get your service account key from: Firebase Console → Project Settings → Service Accounts"
        );
      } else {
      console.warn(
        "⚠️  Firebase Admin SDK not configured. Backend authentication will not work."
      );
      console.warn(
        "   To fix this, set one of the following in your config.env:"
      );
      console.warn(
          "   1. FIREBASE_SERVICE_ACCOUNT_JSON (JSON string from Firebase Console) - Recommended"
      );
      console.warn(
          "   2. FIREBASE_SERVICE_ACCOUNT_PATH (path to service account JSON file) - Local dev only"
      );
      console.warn(
        "   Get your service account key from: Firebase Console → Project Settings → Service Accounts"
      );
      // Create a mock auth object that will throw helpful errors
      auth = {
        verifyIdToken: async () => {
          throw new Error(
              "Firebase Admin SDK not configured. Please set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH in config.env"
          );
        },
      } as admin.auth.Auth;
    }
    }

    // Initialize Firebase Admin if we have valid credentials
    if (serviceAccount) {
      // Validate required service account fields
      if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
        throw new Error(
          "Invalid service account JSON: missing required fields (project_id, private_key, or client_email)"
        );
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      firebaseAdmin = admin;
      auth = firebaseAdmin.auth();
      console.log(`✅ Firebase Admin initialized successfully using ${initializationMethod}`);
    }
  } else {
    // Already initialized
    firebaseAdmin = admin;
    auth = firebaseAdmin.auth();
  }
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  console.error("❌ Firebase Admin initialization error:", errorMessage);
  
  // In production, throw the error to prevent startup with invalid config
  if (process.env.NODE_ENV === "production") {
    throw new Error(`Firebase Admin initialization failed: ${errorMessage}`);
  }
  
  // In development, create a mock auth object that will throw errors
  auth = {
    verifyIdToken: async () => {
      throw new Error(`Firebase Admin initialization failed: ${errorMessage}`);
    },
  } as admin.auth.Auth;
}

export default firebaseAdmin;
export { auth };
