import type { Sandbox } from "e2b";
import { denyEgressAtRuntime } from "./config.js";

type NetworkUpdate = {
  allowInternetAccess?: boolean;
  allowOut?: string[];
  denyOut?: string[];
};

let warnedMissingUpdateNetwork = false;

/**
 * Two-phase egress: install/build needs the public internet (registries);
 * once the app starts we deny all egress except domains the candidate declared.
 *
 * Requires E2B SDK updateNetwork (≈2.28+). On older SDKs this is a no-op with
 * a one-time warning — sandboxes still isolate compute, but cannot lock egress.
 */
export async function applySandboxNetwork(
  sandbox: Sandbox,
  phase: "install" | "runtime",
  declaredEgressDomains: string[] = []
): Promise<{ applied: boolean; reason?: string }> {
  const update =
    typeof (sandbox as { updateNetwork?: (n: NetworkUpdate) => Promise<void> })
      .updateNetwork === "function"
      ? (sandbox as { updateNetwork: (n: NetworkUpdate) => Promise<void> })
          .updateNetwork.bind(sandbox)
      : null;

  if (!update) {
    if (!warnedMissingUpdateNetwork) {
      warnedMissingUpdateNetwork = true;
      console.warn(
        "[runtime-setup] sandbox.updateNetwork is unavailable; upgrade the e2b package to lock runtime egress. Isolation still applies (Firecracker), but outbound traffic is not filtered."
      );
    }
    return { applied: false, reason: "sdk_missing_updateNetwork" };
  }

  try {
    if (phase === "install") {
      await update({ allowInternetAccess: true });
      return { applied: true };
    }

    if (!denyEgressAtRuntime()) {
      await update({ allowInternetAccess: true });
      return { applied: true };
    }

    const allowOut = declaredEgressDomains
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    if (allowOut.length > 0) {
      await update({
        allowInternetAccess: true,
        denyOut: ["0.0.0.0/0"],
        allowOut,
      });
    } else {
      await update({ allowInternetAccess: false });
    }
    return { applied: true };
  } catch (err) {
    console.warn(
      "[runtime-setup] updateNetwork failed:",
      err instanceof Error ? err.message : err
    );
    return {
      applied: false,
      reason: err instanceof Error ? err.message : "updateNetwork_failed",
    };
  }
}
