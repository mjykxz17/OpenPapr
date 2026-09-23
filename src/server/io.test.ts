import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { limiter, onceMap, streamToFile, TooLargeError } from "./io";

const body = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); },
});

describe("streamToFile", () => {
  it("writes the stream to disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "io-"));
    const n = await streamToFile(body(["abc", "def"]), join(dir, "f"), 100);
    expect(n).toBe(6);
    expect(readFileSync(join(dir, "f"), "utf8")).toBe("abcdef");
  });
  it("stops past the limit and leaves nothing behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "io-"));
    await expect(streamToFile(body(["abcd", "efgh"]), join(dir, "f"), 5)).rejects.toBeInstanceOf(TooLargeError);
    expect(existsSync(join(dir, "f"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("onceMap", () => {
  it("shares one piece of work between concurrent callers", async () => {
    const once = onceMap<number>();
    let calls = 0;
    const work = () => new Promise<number>((r) => { calls++; setTimeout(() => r(42), 10); });
    expect(await Promise.all([once("k", work), once("k", work), once("j", work)])).toEqual([42, 42, 42]);
    expect(calls).toBe(2);
  });
});

describe("limiter", () => {
  it("never runs more than n at once", async () => {
    const run = limiter(2);
    let active = 0, peak = 0;
    const job = () => run(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; });
    await Promise.all(Array.from({ length: 8 }, job));
    expect(peak).toBe(2);
  });
  it("frees its slot when work throws", async () => {
    const run = limiter(1);
    await expect(run(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await run(async () => 1)).toBe(1);
  });
});
