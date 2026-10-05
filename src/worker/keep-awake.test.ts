import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepAwake, selfPing } from "./keep-awake";

describe("keepAwake", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("leaves short work alone", async () => {
    const ping = vi.fn(async () => {});
    const done = keepAwake(new Promise((r) => setTimeout(r, 5_000)), { ping });
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ping).not.toHaveBeenCalled();
  });

  it("pings through long work, and stops when it ends", async () => {
    const ping = vi.fn(async () => {});
    const done = keepAwake(new Promise((r) => setTimeout(r, 100_000)), { ping });
    await vi.advanceTimersByTimeAsync(100_000);
    await done;
    expect(ping).toHaveBeenCalledTimes(3);   // at 20s, 50s, 80s
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it("gives up after the cap, so stuck work can't keep the machine up", async () => {
    const ping = vi.fn(async () => {});
    void keepAwake(new Promise(() => {}), { ping, max: 60_000 });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("only pings on Fly", () => {
    expect(selfPing({})).toBeNull();
    expect(selfPing({ FLY_APP_NAME: "openpapr", KEEP_AWAKE: "0" })).toBeNull();
    expect(selfPing({ FLY_APP_NAME: "openpapr" })).not.toBeNull();
  });
});
