import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const good = {
  SECRET_KEY: "a".repeat(64),
  APP_PASSWORD: "hunter2hunter2",
};

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv(good as never);
    expect(env.CANVAS_BASE_URL).toBe("https://canvas.nus.edu.sg");
    expect(env.ANTHROPIC_MODEL).toBe("claude-haiku-4-5");
    expect(env.POLL_INTERVAL_MS).toBe(300000);
    expect(env.DATABASE_PATH).toBe("data/one-ring.db");
  });
  it("rejects a short SECRET_KEY", () => {
    expect(() => loadEnv({ ...good, SECRET_KEY: "abc" } as never)).toThrow();
  });
  it("coerces POLL_INTERVAL_MS from string", () => {
    expect(loadEnv({ ...good, POLL_INTERVAL_MS: "60000" } as never).POLL_INTERVAL_MS).toBe(60000);
  });
});
