import type { RuntimeConfig, RuntimeEnvVar } from "./schema.js";

const SECRET_PLACEHOLDER = "";

/**
 * A blanked secret is otherwise indistinguishable from one that was never
 * filled in, so the redacted row carries whether a value is stored.
 */
export type PublicRuntimeEnvVar = RuntimeEnvVar & { hasValue: boolean };
export type PublicRuntimeConfig = Omit<RuntimeConfig, "envVars"> & {
  envVars: PublicRuntimeEnvVar[];
};

/** Never return secret values on GET/status. Write-only rows keep `secret: true`. */
export function publicRuntimeConfig(
  config: RuntimeConfig | null | undefined
): PublicRuntimeConfig | null {
  if (!config) return null;
  return {
    ...config,
    envVars: (config.envVars || []).map((row) =>
      row.secret
        ? {
            key: row.key,
            value: SECRET_PLACEHOLDER,
            secret: true,
            hasValue: Boolean(row.value),
          }
        : {
            key: row.key,
            value: row.value ?? "",
            secret: false,
            hasValue: Boolean(row.value),
          }
    ),
  };
}

/**
 * Merge a PUT payload onto the stored config. Empty secret values keep the
 * previously stored secret so the form can be write-only.
 */
export function mergeRuntimeConfig(
  previous: RuntimeConfig | null | undefined,
  incoming: RuntimeConfig
): RuntimeConfig {
  const prevByKey = new Map(
    (previous?.envVars || []).map((row) => [row.key, row])
  );
  const envVars: RuntimeEnvVar[] = incoming.envVars.map((row) => {
    if (!row.secret) return { ...row, secret: false };
    if (row.value && row.value.length > 0) {
      return { ...row, secret: true };
    }
    const prev = prevByKey.get(row.key);
    if (prev?.secret && prev.value) {
      return { key: row.key, value: prev.value, secret: true };
    }
    return { key: row.key, value: "", secret: true };
  });
  return { ...incoming, envVars };
}

/** Values worth scrubbing from log output. Very short values would match noise. */
export function secretValuesFromEnvVars(
  envVars: RuntimeEnvVar[] | null | undefined
): string[] {
  return (envVars || [])
    .filter((row) => row.secret && row.value)
    .map((row) => row.value)
    .filter((v) => v.length >= 4);
}

export function secretValues(config: RuntimeConfig | null | undefined): string[] {
  if (!config) return [];
  return secretValuesFromEnvVars(config.envVars);
}

/** Scrub secret values (and common token-looking assignments) from log text. */
export function redactSecrets(text: string, secrets: string[]): string {
  if (!text) return text;
  let out = text;
  const unique = Array.from(new Set(secrets)).sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    if (!secret) continue;
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY))\s*=\s*\S+/gi,
    "$1=[redacted]"
  );
  return out;
}
