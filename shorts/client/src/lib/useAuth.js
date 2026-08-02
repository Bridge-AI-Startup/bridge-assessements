import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/firebase/firebase";

/**
 * Firebase auth state for Shorts consumers.
 * `user` is undefined while loading, null when signed out.
 */
export function useAuth() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  return {
    user,
    loading: user === undefined,
    signedIn: Boolean(user),
  };
}
