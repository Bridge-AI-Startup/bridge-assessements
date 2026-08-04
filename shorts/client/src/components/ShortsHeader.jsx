import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { useAuth } from "@/lib/useAuth";
import AccountModal from "@/components/AccountModal";
import bridgeLogo from "@/assets/bridge-logo.svg";

const NAV = [
  { id: "browse", label: "Browse", to: "/Gallery" },
  { id: "vote", label: "Vote", to: "/Vote" },
];

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * Shared Shorts nav — matches bridge-jobs.com mono uppercase labels + pill CTA.
 *
 * Above `sm` the sections sit inline with an account dropdown on the right.
 * Below it there is no room for either, so both collapse into one hamburger
 * dropdown holding the same links plus the account actions.
 *
 * @param {{ active?: "browse"|"vote"|"mybuilds"|null, cta?: { label: string, to: string }|null, children?: import("react").ReactNode }} props
 */
export default function ShortsHeader({ active = null, cta = null, children = null }) {
  const { user, loading, signedIn } = useAuth();
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef(null);
  const navRef = useRef(null);

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

  // Same dismissal rules for the mobile nav dropdown.
  useEffect(() => {
    if (!navOpen) return undefined;
    function onPointerDown(e) {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setNavOpen(false);
      }
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setNavOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut(auth);
      setMenuOpen(false);
      setNavOpen(false);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4">
        <div className="mr-auto flex min-w-0 items-center gap-8">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight"
          >
            <img
              src={bridgeLogo}
              alt="Bridge"
              className="h-7 w-7 object-contain"
              width={28}
              height={28}
            />
            <span>
              <span className="text-ink">Bridge</span>{" "}
              <span className="text-fog-light">Shorts</span>
            </span>
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

        {children ? (
          <div className="order-last flex w-full items-center sm:order-none sm:w-auto">
            {children}
          </div>
        ) : null}

        <div className="flex shrink-0 items-center gap-3">
          {!loading &&
            (signedIn ? (
              <div className="relative hidden sm:block" ref={menuRef}>
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
                className="label-mono hidden hover:text-ink sm:inline"
              >
                Sign in
              </button>
            ))}
          {cta ? (
            <Link to={cta.to} className="btn-pill">
              {cta.label}
            </Link>
          ) : null}

          <div className="relative sm:hidden" ref={navRef}>
            <button
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={navOpen}
              aria-label={navOpen ? "Close menu" : "Open menu"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paper text-ink active:bg-mist"
            >
              {navOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
            {navOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-line bg-paper py-1 shadow-card"
              >
                {NAV.map((item) => (
                  <Link
                    key={item.id}
                    to={item.to}
                    role="menuitem"
                    onClick={() => setNavOpen(false)}
                    className={`block px-4 py-2.5 text-sm hover:bg-mist ${
                      active === item.id
                        ? "bg-mist font-medium text-ink"
                        : "text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  to="/Build"
                  role="menuitem"
                  onClick={() => setNavOpen(false)}
                  className="block px-4 py-2.5 text-sm text-ink hover:bg-mist"
                >
                  Build
                </Link>

                <div className="my-1 border-t border-line" />

                {loading ? null : signedIn ? (
                  <>
                    <p className="truncate px-4 py-2 text-xs text-fog-light">
                      {user?.email}
                    </p>
                    <Link
                      to="/MySubmissions"
                      role="menuitem"
                      onClick={() => setNavOpen(false)}
                      className={`block px-4 py-2.5 text-sm hover:bg-mist ${
                        active === "mybuilds"
                          ? "bg-mist font-medium text-ink"
                          : "text-ink"
                      }`}
                    >
                      My builds
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      disabled={signingOut}
                      className="block w-full px-4 py-2.5 text-left text-sm text-fog hover:bg-mist disabled:opacity-60"
                    >
                      {signingOut ? "Signing out…" : "Sign out"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setNavOpen(false);
                      setShowAccountModal(true);
                    }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-mist"
                  >
                    Sign in
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {showAccountModal && (
        <AccountModal onClose={() => setShowAccountModal(false)} />
      )}
    </header>
  );
}
