import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCjMiRlX0HERCvA4qv0o1MO7fM5mzkdkCo",
  authDomain: "bridge-assessments.firebaseapp.com",
  projectId: "bridge-assessments",
  storageBucket: "bridge-assessments.firebasestorage.app",
  messagingSenderId: "558749763922",
  appId: "1:558749763922:web:678d119fd722d9f4a1128b",
  measurementId: "G-QY8DBN3LVF",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Analytics (only in browser environment)
let analytics = null;
try {
  if (typeof window !== "undefined") {
    analytics = getAnalytics(app);
  }
} catch (error) {
  console.warn("Firebase Analytics initialization failed:", error);
  // Analytics is optional, so we continue without it
}

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export { analytics };
export default app;
