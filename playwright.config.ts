import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:3777" },
  webServer: {
    command: "npx tsx scripts/seed-demo.ts && npm run build && npx next start -p 3777",
    port: 3777,
    env: {
      DATABASE_PATH: "data/demo.db",
      SECRET_KEY: "ab".repeat(32),
      APP_PASSWORD: "test-password",
    },
    timeout: 180_000,
  },
});
