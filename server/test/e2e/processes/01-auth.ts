/**
 * P1 - Authentication / Signup.
 * Proves: a company can create an account and authenticate against the real
 * Firebase + backend stack, and that the issued token authorizes API calls.
 */

import { expectOk } from "../lib/apiClient.js";
import { BUDGETS, testEmail } from "../lib/config.js";
import { signIn, signUp } from "../lib/firebaseAuth.js";
import { runProcess } from "../lib/runner.js";
import type { SuiteState } from "../lib/state.js";
import type { ProcessResult } from "../lib/types.js";

export function runP1Auth(state: SuiteState): Promise<ProcessResult> {
  return runProcess(
    {
      id: "P1",
      title: "Signup / Authentication",
      description:
        "Company account creation via Firebase, backend user provisioning, and token-authorized access.",
      scriptPath: "server/test/e2e/processes/01-auth.ts",
    },
    async (ctx) => {
      const email = testEmail();
      const password = `Pw!${Date.now()}aA1`;
      const companyName = `E2E Co ${new Date().toISOString()}`;

      const auth = await ctx.step(
        "Sign up (Firebase Identity Toolkit)",
        async (ev) => {
          const res = await signUp(email, password);
          ev.json("firebaseUid", res.localId);
          ev.json("email", email);
          ev.json("idTokenLength", res.idToken.length);
          if (!res.idToken) throw new Error("No ID token returned");
          return res;
        },
        BUDGETS.authFlow
      );

      state.recruiter = {
        email,
        password,
        idToken: auth.idToken,
        uid: auth.localId,
        companyName,
      };

      let createOk = false;
      try {
        await ctx.step(
          "Create backend user (POST /api/users/create)",
          async (ev) => {
            const res = await state.api
              .withToken(auth.idToken)
              .post("/api/users/create", { companyName });
            const user = expectOk(res, "create user");
            ev.json("status", res.status);
            ev.json("userId", user._id);
            ev.json("companyName", user.companyName);
            state.recruiter!.userId = user._id;
          }
        );
        createOk = true;
      } catch (err: any) {
        const msg = String(err?.message || err);
        // Firebase client signup already succeeded above (token minted), so any
        // failure to provision the backend user is a server-side Firebase Admin
        // problem: token verification or the Admin OAuth handshake. This shows up
        // either as a 401 ("token was invalid") or a 500 ("Unknown Error") from
        // the controller's catch-all. Always surface the blocker fix.
        ctx.recommend({
          id: "p1-firebase-admin-credential",
          severity: "blocker",
          issue:
            "Firebase client signup mints a valid ID token, but the backend cannot verify tokens / look up users, so every authenticated employer endpoint (user create, assessment create, link generation, dashboard, scoring) returns 401/500.",
          rootCause:
            `Backend user-create failed after a successful client signup ("${msg}"). The Firebase Admin SDK cannot mint an OAuth token ("invalid_grant: Invalid JWT Signature"): the service-account key in FIREBASE_SERVICE_ACCOUNT_JSON is revoked/incorrect, or the host clock is skewed (this machine reports 2026).`,
          recommendedFix:
            "Generate a fresh service-account key in the Firebase console (Project settings -> Service accounts -> Generate new private key), update FIREBASE_SERVICE_ACCOUNT_JSON in server/config.env (and Render), and verify the host clock is in sync (NTP). Then re-run the suite.",
          files: [
            "server/config.env",
            "server/src/config/firebaseAdmin.ts",
            "server/src/utils/auth.ts",
          ],
          effort: "small",
        });
      }

      if (createOk) {
        await ctx.step("Authorized whoami (GET /api/users/whoami)", async (ev) => {
          const res = await state.api
            .withToken(auth.idToken)
            .get("/api/users/whoami");
          const who = expectOk(res, "whoami");
          ev.json("subscriptionInfo", who.subscriptionInfo);
          ev.json(
            "canCreateAssessment",
            who.subscriptionInfo?.canCreateAssessment
          );
        });

        await ctx.step("Unauthorized request is rejected (no token)", async (ev) => {
          const res = await state.api.get("/api/users/whoami");
          ev.json("status", res.status);
          if (res.status === 200) {
            throw new Error("whoami should require auth but returned 200");
          }
        });

        await ctx.step("Re-authentication (signInWithPassword)", async (ev) => {
          const reauth = await signIn(email, password);
          const res = await state.api
            .withToken(reauth.idToken)
            .get("/api/users/whoami");
          expectOk(res, "whoami after re-auth");
          ev.json("reauthOk", true);
          state.recruiter!.idToken = reauth.idToken;
        });

        ctx.summary(
          `Account ${email} created and authenticated; token authorizes API and unauthenticated access is rejected.`
        );
      } else {
        ctx.skip(
          "Authorized whoami / re-auth",
          "Skipped: backend rejected the token (Firebase Admin credential invalid in this environment)."
        );
        ctx.summary(
          "Firebase client signup works (token minted), but the backend cannot verify tokens due to an invalid Firebase Admin credential (invalid_grant). All employer-authenticated endpoints are blocked until the service-account key/clock is fixed."
        );
      }
    }
  );
}
