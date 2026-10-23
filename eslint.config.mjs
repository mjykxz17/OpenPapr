import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next.js's recommended rules (React, hooks, Core Web Vitals) and its
// TypeScript set, as the Next docs set them up.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // eslint-config-next's own defaults, which this list replaces
    ".next/**", "out/**", "build/**", "next-env.d.ts",
    // built or copied, not written here
    "dist/**", "public/pdfjs/**", "drizzle/**",
    // app data, test output, and other agents' worktrees
    "data/**", "coverage/**", "test-results/**", "playwright-report/**", "blob-report/**", ".claude/**", ".superpowers/**", "pre-study/**",
  ]),
]);
