import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {fwf
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
const analytics = getAnalytics(app);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export { analytics };
export default app;

