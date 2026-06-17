import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { defineConfig } from "vitest/config";

/**
 * The codebase is authored as ESM TypeScript that imports siblings using
 * explicit `.js` specifiers (NodeNext style), e.g. `import x from "./foo.js"`
 * even though only `foo.ts` exists on disk. Vite's resolver honours the literal
 * `.js`, so we rewrite relative `.js` specifiers to the matching `.ts`/`.tsx`
 * file when one exists. This lets Vitest import production modules unchanged.
 */
function rewriteJsToTs() {
  return {
    name: "rewrite-js-to-ts",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) {
        return null;
      }
      const base = source.replace(/\.js$/, "");
      for (const ext of [".ts", ".tsx"]) {
        const candidate = resolve(dirname(importer), base + ext);
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [rewriteJsToTs()],
  test: {
    globals: true,
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
    // Deterministic env for unit tests (production modules read these at import).
    env: {
      OPENAI_MAX_CONCURRENT: "2",
      OPENAI_API_KEY: "test-key-not-used",
    },
    // Unit tests are deterministic and fully mocked; no live services.
    hookTimeout: 20_000,
    testTimeout: 20_000,
    reporters: ["default", "json"],
    outputFile: {
      json: "test/results/unit-results.json",
    },
  },
});
