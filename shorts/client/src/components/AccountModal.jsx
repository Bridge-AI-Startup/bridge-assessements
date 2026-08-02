import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { linkCurrentAnonymousId } from "@/api/account";
import { AppleIcon, GoogleIcon } from "@/components/ProviderIcons";
import {
  ANY_SOCIAL_AUTH_ENABLED,
  APPLE_AUTH_ENABLED,
  GOOGLE_AUTH_ENABLED,
} from "@/config/auth";
import {
  APPLE_PROVIDER_ID,
  GOOGLE_PROVIDER_ID,
  credentialFromError,
  existingSignInMethods,
  linkPendingCredential,
  providerLabel,
  signInWithProvider,
  socialAuthErrorMessage,
} from "@/lib/socialAuth";

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) {
    return "Wrong email or password.";
  }
  if (code.includes("user-not-found")) {
    return "No account with that email — try creating one.";
  }
  if (code.includes("email-already-in-use")) {
    return "That email already has an account — try signing in.";
  }
  if (code.includes("weak-password")) {
    return "Password must be at least 6 characters.";
  }
  if (code.includes("invalid-email")) {
    return "That doesn't look like a valid email.";
  }
  return err?.message || "Something went wrong. Try again.";
}

/**
 * Sign in / create account for Bridge Shorts. On success, claims this
 * browser's anonymousId for the account so past + future builds follow it.
 *
 * @param {{ onClose: () => void, onSignedIn?: (user: import("firebase/auth").User) => void, title?: string, subtitle?: string }} props
 */
export default function AccountModal({
  onClose,
  onSignedIn = null,
  title = "Bridge Shorts account",
  subtitle = "Keep your builds across devices and see all your past submissions.",
}) {
  const [mode, setMode] = useState("signin"); // "signin" | "create"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /** Set when a social sign-in collided with an existing account on the same
   *  email. Held until the user signs in the original way, then linked. */
  const [pending, setPending] = useState(null);

  /** Shared tail for every successful sign-in path. */
  async function completeSignIn(user) {
    // Attach a credential left over from a provider collision, if any.
    if (pending?.credential) {
      try {
        await linkPendingCredential(pending.credential);
        setPending(null);
      } catch {
        /* the account still works; the extra provider just isn't attached */
      }
    }

    // Claim this browser's identity for the account. Non-fatal: sign-in
    // still succeeded; the next sign-in or submit will link again.
    try {
      await linkCurrentAnonymousId();
    } catch {
      /* ignore */
    }

    if (onSignedIn) onSignedIn(user);
    onClose();
  }

  async function handleSocial(providerId) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await signInWithProvider(providerId);
      await completeSignIn(user);
    } catch (err) {
      if (err?.code === "auth/account-exists-with-different-credential") {
        const collidedEmail = err?.customData?.email || "";
        const methods = await existingSignInMethods(collidedEmail);
        setPending({
          credential: credentialFromError(providerId, err),
          email: collidedEmail,
          methods,
        });
        if (collidedEmail) setEmail(collidedEmail);
        setMode("signin");
        setError(null);
      } else {
        // null means the user simply closed the popup — nothing to report.
        const message = socialAuthErrorMessage(providerId, err);
        if (message) setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const credential =
        mode === "create"
          ? await createUserWithEmailAndPassword(
              auth,
              email.trim(),
              password,
            )
          : await signInWithEmailAndPassword(auth, email.trim(), password);

      await completeSignIn(credential.user);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-line bg-paper p-6 shadow-card"
      >
        <h2 className="text-lg font-medium tracking-tight text-ink">
          {title}
        </h2>
        <p className="mt-1 text-sm text-fog-light">{subtitle}</p>

        {ANY_SOCIAL_AUTH_ENABLED && (
          <>
            <div className="mt-4 grid gap-2">
              {GOOGLE_AUTH_ENABLED && (
                <button
                  type="button"
                  onClick={() => handleSocial(GOOGLE_PROVIDER_ID)}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-medium text-ink hover:border-fog-light disabled:opacity-60"
                >
                  <GoogleIcon />
                  Continue with Google
                </button>
              )}
              {APPLE_AUTH_ENABLED && (
                <button
                  type="button"
                  onClick={() => handleSocial(APPLE_PROVIDER_ID)}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-ink px-3 py-2.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60"
                >
                  <AppleIcon />
                  Continue with Apple
                </button>
              )}
            </div>

            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="label-mono">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}
        {!ANY_SOCIAL_AUTH_ENABLED && <div className="mt-4" />}

        {pending && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
            <p className="font-medium">This email already has an account</p>
            <p className="mt-0.5 text-amber-900/90">
              {pending.methods.length > 0 ? (
                <>
                  Sign in with {pending.methods.map(providerLabel).join(" or ")}{" "}
                  below, and we&apos;ll attach this new sign-in method to the
                  same account.
                </>
              ) : (
                <>
                  Sign in the way you originally created it, and we&apos;ll
                  attach this new sign-in method to the same account.
                </>
              )}
            </p>
          </div>
        )}

        <div className="flex rounded-xl border border-line p-1">
          {[
            { id: "signin", label: "Sign in" },
            { id: "create", label: "Create account" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMode(tab.id);
                setError(null);
              }}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm ${
                mode === tab.id
                  ? "bg-mist font-medium text-ink"
                  : "text-fog-light hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm font-medium text-fog">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            required
            className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-fog-light focus:border-ink focus:outline-none"
            placeholder="you@example.com"
            disabled={busy}
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-fog">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            required
            minLength={6}
            className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-fog-light focus:border-ink focus:outline-none"
            placeholder={mode === "create" ? "At least 6 characters" : "Your password"}
            disabled={busy}
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-pill-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="btn-pill"
          >
            {busy
              ? "Working…"
              : mode === "create"
                ? "Create account"
                : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
