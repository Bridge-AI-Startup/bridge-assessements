import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { useAuth } from "@/lib/useAuth";
import AccountModal from "@/components/AccountModal";

const NAV = [
  { id: "browse", label: "Browse", to: "/Gallery" },
  { id: "vote", label: "Vote", to: "/Vote" },
  { id: "leaderboard", label: "Leaderboard", to: "/Leaderboard" },
];

/**
 * Shared Shorts nav — matches bridge-jobs.com mono uppercase labels + pill CTA.
 * @param {{ active?: "browse"|"vote"|"leaderboard"|"mybuilds"|null, cta?: { label: string, to: string }|null, children?: import("react").ReactNode }} props
 */
export default function ShortsHeader({ active = null, cta = null, children = null }) {
  const { user, loading, signedIn } = useAuth();
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef(null);

  // Dismiss the account menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function onPointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut(auth);
      setMenuOpen(false);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex min-w-0 items-center gap-8">
          <Link
            to="/"
            className="shrink-0 text-[15px] font-semibold tracking-tight"
          >
            <span className="text-ink">Bridge</span>{" "}
            <span className="text-fog-light">Shorts</span>
          </Link>
          <nav className="hidden items-center gap-5 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.id}
                to={item.to}
                className={`label-mono hover:text-ink ${
                  active === item.id ? "text-ink" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
            {signedIn && (
              <Link
                to="/MySubmissions"
                className={`label-mono hover:text-ink ${
                  active === "mybuilds" ? "text-ink" : ""
                }`}
              >
                My builds
              </Link>
            )}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {children}
          {!loading &&
            (signedIn ? (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="label-mono max-w-[160px] truncate hover:text-ink"
                  title={user?.email || "Account"}
                >
                  {user?.email || "Account"}
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-2 w-48 rounded-xl border border-line bg-paper py-1 shadow-card"
                  >
                    <p className="truncate px-3 py-2 text-xs text-fog-light">
                      {user?.email}
                    </p>
                    <div className="my-1 border-t border-line" />
                    <Link
                      to="/MySubmissions"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block px-3 py-2 text-sm text-ink hover:bg-mist"
                    >
                      My builds
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      disabled={signingOut}
                      className="block w-full px-3 py-2 text-left text-sm text-fog hover:bg-mist disabled:opacity-60"
                    >
                      {signingOut ? "Signing out…" : "Sign out"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAccountModal(true)}
                className="label-mono hover:text-ink"
              >
                Sign in
              </button>
            ))}
          {cta ? (
            <Link to={cta.to} className="btn-pill">
              {cta.label}
            </Link>
          ) : null}
        </div>
      </div>
      {showAccountModal && (
        <AccountModal onClose={() => setShowAccountModal(false)} />
      )}
    </header>
  );
}
