import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  // PW_CHANNEL=chrome runs the smoke tests in the installed Chrome, for a
  // machine where `npx playwright install chromium` was never run.
  use: { baseURL: "http://localhost:3777", channel: process.env.PW_CHANNEL || undefined },
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
