import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSyCjMiRlX0HERCvA4qv0o1MO7fM5mzkdkCo",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "bridge-assessments.firebaseapp.com",
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID || "bridge-assessments",
  storageBucket: "bridge-assessments.firebasestorage.app",
  messagingSenderId: "558749763922",
  appId: "1:558749763922:web:678d119fd722d9f4a1128b",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export default app;
