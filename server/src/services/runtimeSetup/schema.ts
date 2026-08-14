import { z } from "zod";
import { runbookExecutionProfileSchema } from "../behavioralGrading/schema.js";

export const RUNTIME_IDS = ["auto", "node20", "python312"] as const;
export type RuntimeId = (typeof RUNTIME_IDS)[number];

const envVarKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Invalid environment variable name");

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
    "Invalid domain"
  );

export const runtimeEnvVarSchema = z.object({
  key: envVarKeySchema,
  value: z.string().max(8_000).default(""),
  secret: z.boolean().optional().default(false),
});

export const runtimeConfigSchema = z.object({
  rootDir: z
    .string()
    .trim()
    .max(256)
    .default(".")
    .transform((v) => {
      const t = v.replace(/\\/g, "/").replace(/^\/+/, "") || ".";
      if (t.includes("..") || t.startsWith("/")) return ".";
      return t;
    }),
  /**
   * Stored but never read at execution time — the sandbox image decides which
   * runtimes exist, and the start command decides which one is used. Kept so
   * existing documents still parse; not surfaced in either UI.
   */
  runtime: z.enum(RUNTIME_IDS).default("auto"),
  installCommand: z.string().trim().max(2_000).default(""),
  buildCommand: z
    .string()
    .trim()
    .max(2_000)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  startCommand: z.string().trim().max(2_000).default(""),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .nullable()
    .optional()
    .default(null),
  healthPath: z
    .string()
    .trim()
    .max(256)
    .nullable()
    .optional()
    .transform((v) => {
      if (!v) return null;
      return v.startsWith("/") ? v : `/${v}`;
    }),
  executionProfile: runbookExecutionProfileSchema.default("unclear"),
  envVars: z.array(runtimeEnvVarSchema).max(64).default([]),
  declaredEgressDomains: z.array(domainSchema).max(32).default([]),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type RuntimeEnvVar = z.infer<typeof runtimeEnvVarSchema>;

export const emptyRuntimeConfig = (): RuntimeConfig =>
  runtimeConfigSchema.parse({});

export function snapshotShaFromSubmission(submission: {
  codeSource?: string;
  codeUpload?: { sha256?: string | null };
  githubRepo?: { pinnedCommitSha?: string | null };
}): string | null {
  if (submission.codeSource === "upload") {
    return submission.codeUpload?.sha256?.trim() || null;
  }
  return submission.githubRepo?.pinnedCommitSha?.trim() || null;
}
