import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirror the "@/*" -> "./src/*" alias from tsconfig.json so tests can import
// modules that use it. Without this, any test that pulls in a file importing
// "@/..." fails to resolve rather than failing an assertion.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
