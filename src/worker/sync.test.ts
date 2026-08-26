import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { syncRuns, users } from "../db/schema";
import { BackoffSkipError, computeBackoffMs, createGuard, runUserSync } from "./sync";

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  return db;
};

describe("runUserSync", () => {
  it("records ok sync_runs for each source", async () => {
    const db = setup();
    await runUserSync({ db, now: () => 5, canvasSync: async () => {}, mailSync: async () => {}, enrich: async () => {} }, 1);
    const runs = db.select().from(syncRuns).all();
    expect(runs.map((r) => [r.source, r.ok])).toEqual([["canvas", true], ["graph", true], ["enrich", true]]);
    expect(runs.every((r) => r.finishedAt === 5)).toBe(true);
  });
  it("isolates failures: canvas throwing still runs graph and enrich", async () => {
    const db = setup();
    const mailSync = vi.fn(async () => {});
    await runUserSync({ db, now: () => 1, canvasSync: async () => { throw new Error("canvas down"); }, mailSync, enrich: async () => {} }, 1);
    expect(mailSync).toHaveBeenCalled();
    const canvasRun = db.select().from(syncRuns).all().find((r) => r.source === "canvas")!;
    expect(canvasRun.ok).toBe(false);
    expect(canvasRun.error).toContain("canvas down");
  });
});

describe("computeBackoffMs", () => {
  it("doubles per failure and caps at 1h", () => {
    expect(computeBackoffMs(0, 300_000)).toBe(300_000);
    expect(computeBackoffMs(2, 300_000)).toBe(1_200_000);
    expect(computeBackoffMs(10, 300_000)).toBe(3_600_000);
  });
});

describe("createGuard", () => {
  it("throws BackoffSkipError within the backoff window without invoking fn, and does not invoke fn", async () => {
    let clock = 0;
    const guard = createGuard(300_000, () => clock);
    const fn = vi.fn(async () => { throw new Error("down"); });
    const wrapped = guard("canvas", fn);

    await expect(wrapped(1)).rejects.toThrow("down");
    expect(fn).toHaveBeenCalledTimes(1);

    clock = 100_000; // still within the 300_000ms window after 1 failure
    fn.mockClear();
    await expect(wrapped(1)).rejects.toThrow(BackoffSkipError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("invokes fn again once the backoff window has elapsed", async () => {
    let clock = 0;
    const guard = createGuard(300_000, () => clock);
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("down");
    });
    const wrapped = guard("canvas", fn);

    await expect(wrapped(1)).rejects.toThrow("down");

    // computeBackoffMs(1, 300_000) === 600_000 (baseMs * 2^1)
    clock = 600_001; // past the window
    await expect(wrapped(1)).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("resets the failure count on success so the next call runs immediately", async () => {
    let clock = 0;
    const guard = createGuard(300_000, () => clock);
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("down");
    });
    const wrapped = guard("canvas", fn);

    await expect(wrapped(1)).rejects.toThrow("down");
    clock = 600_001; // past the 600_000ms window for 1 failure
    await expect(wrapped(1)).resolves.toBeUndefined(); // succeeds, resets count to 0

    clock = 600_002; // immediately after, well within what would have been a new window
    fn.mockClear();
    await expect(wrapped(1)).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("carries the last real error's message into the BackoffSkipError so downstream matching still works", async () => {
    let clock = 0;
    const guard = createGuard(300_000, () => clock);
    const fn = vi.fn(async () => { throw new Error("Graph 401: invalid_grant"); });
    const wrapped = guard("graph", fn);

    await expect(wrapped(1)).rejects.toThrow("Graph 401: invalid_grant");

    clock = 100_000; // still within the backoff window
    await expect(wrapped(1)).rejects.toThrow(/401/);
  });

  it("a skip does not increment the failure count or bump lastFailAt (skip is not a new failure)", async () => {
    let clock = 0;
    const guard = createGuard(300_000, () => clock);
    const fn = vi.fn(async () => { throw new Error("down"); });
    const wrapped = guard("canvas", fn);

    await expect(wrapped(1)).rejects.toThrow("down"); // failure #1 at t=0
    clock = 100_000;
    await expect(wrapped(1)).rejects.toThrow(BackoffSkipError); // skip, not counted

    // Backoff window for 1 failure is 600_000 (baseMs*2^1), measured from t=0, not from the skip at t=100_000.
    clock = 600_001;
    fn.mockClear();
    await expect(wrapped(1)).rejects.toThrow("down"); // window elapsed since the real failure -> fn runs again
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("runUserSync + createGuard integration", () => {
  it("records ok:false with a 'backing off' error when the guard skips", async () => {
    const db = setup();
    let clock = 0;
    const guard = createGuard(300_000, () => clock);
    const canvasSync = guard("canvas", async () => { throw new Error("canvas down"); });

    await runUserSync({ db, now: () => 1, canvasSync, mailSync: async () => {}, enrich: async () => {} }, 1);
    let canvasRun = db.select().from(syncRuns).all().find((r) => r.source === "canvas" && r.startedAt === 1)!;
    expect(canvasRun.ok).toBe(false);
    expect(canvasRun.error).toContain("canvas down");

    clock = 100_000; // within the backoff window
    await runUserSync({ db, now: () => 2, canvasSync, mailSync: async () => {}, enrich: async () => {} }, 1);
    canvasRun = db.select().from(syncRuns).all().find((r) => r.source === "canvas" && r.startedAt === 2)!;
    expect(canvasRun.ok).toBe(false);
    expect(canvasRun.error).toContain("backing off");
  });
});

describe("guard.resetUser", () => {
  it("clears a user's backoff so a manual sync is not skipped mid-penalty", async () => {
    let now = 0;
    const guard = createGuard(1000, () => now);
    const failing = guard("canvas", async () => { throw new Error("canvas down"); });

    await expect(failing(1)).rejects.toThrow("canvas down");
    // Still inside the backoff window: a scheduled run would be skipped.
    await expect(failing(1)).rejects.toThrow(BackoffSkipError);

    // A manual sync is an explicit retry — forget the failure history.
    guard.resetUser(1);
    let ran = false;
    const ok = guard("canvas", async () => { ran = true; });
    await ok(1);
    expect(ran).toBe(true);
  });

  it("only resets the user asked for", async () => {
    let now = 0;
    const guard = createGuard(1000, () => now);
    const failing = guard("canvas", async () => { throw new Error("down"); });
    await expect(failing(1)).rejects.toThrow("down");
    await expect(failing(2)).rejects.toThrow("down");
    guard.resetUser(1);
    await expect(failing(2)).rejects.toThrow(BackoffSkipError);
  });
});
