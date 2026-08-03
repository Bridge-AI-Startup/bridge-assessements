import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { createPageUrl } from "@/utils";

export default function AppIndex() {
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        navigate(createPageUrl("Home"), { replace: true });
      } else {
        navigate(createPageUrl("Login"), { replace: true });
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF9F2]">
      <div className="w-8 h-8 border-2 border-[#21201C]/30 border-t-[#21201C] rounded-full animate-spin" />
    </div>
  );
}
