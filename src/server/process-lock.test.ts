import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LockTimeoutError, processLock } from "./process-lock";

const lockPath = () => join(mkdtempSync(join(tmpdir(), "lock-test-")), "convert.lock");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Another process that takes the lock, says "held", and keeps it until killed.
// The lock is kept on globalThis: awaiting a promise nothing can settle leaves
// the connection unreachable, and the garbage collector closing it would let
// the lock go before the kill.
function holdInChild(path: string) {
  const script = join(mkdtempSync(join(tmpdir(), "lock-child-")), "child.ts");
  writeFileSync(script, [
    `import { processLock } from ${JSON.stringify(resolve(__dirname, "process-lock.ts"))};`,
    `const lock = processLock(process.argv[2]!);`,
    `(globalThis as { held?: unknown }).held = lock;`,
    `void lock.run(async () => { console.log("held"); await new Promise(() => {}); });`,
    `setInterval(() => {}, 1000);`,
  ].join("\n"));
  // node itself with tsx's loader, not the tsx wrapper: the wrapper runs the
  // script in a second process, which would survive the kill below.
  const child = spawn(process.execPath, ["--import", "tsx", script, path], { cwd: process.cwd() });
  const held = new Promise<void>((r, j) => {
    child.stdout.on("data", (b) => { if (String(b).includes("held")) r(); });
    child.on("close", () => j(new Error("child exited before taking the lock")));
  });
  const exited = new Promise<void>((r) => child.on("close", () => r()));
  return { child, held, exited };
}

describe("processLock", () => {
  it("lets one holder in at a time, across separate connections", async () => {
    const path = lockPath();
    const a = processLock(path);
    const b = processLock(path);   // a second connection, as the other process would have
    const order: string[] = [];
    let releaseA: () => void = () => {};
    const first = a.run(async () => { order.push("a in"); await new Promise<void>((r) => { releaseA = r; }); order.push("a out"); });
    await sleep(20);
    const second = b.run(async () => { order.push("b in"); }, { pollMs: 10 });
    await sleep(100);
    expect(order).toEqual(["a in"]);   // b is waiting
    releaseA();
    await Promise.all([first, second]);
    expect(order).toEqual(["a in", "a out", "b in"]);
    a.close(); b.close();
  });

  it("gives up after the longest wait it was given", async () => {
    const path = lockPath();
    const a = processLock(path);
    const b = processLock(path);
    let release: () => void = () => {};
    const held = a.run(() => new Promise<void>((r) => { release = r; }));
    await sleep(20);
    await expect(b.run(async () => "ran", { maxWaitMs: 80, pollMs: 10 })).rejects.toBeInstanceOf(LockTimeoutError);
    release();
    await held;
    await expect(b.run(async () => "ran", { pollMs: 10 })).resolves.toBe("ran");
    a.close(); b.close();
  });

  it("queues callers in one process and frees the lock when work throws", async () => {
    const lock = processLock(lockPath());
    const order: number[] = [];
    const runs = [1, 2, 3].map((n) => lock.run(async () => { order.push(n); if (n === 2) throw new Error("boom"); }));
    await expect(runs[1]).rejects.toThrow("boom");
    await Promise.all([runs[0], runs[2]]);
    expect(order).toEqual([1, 2, 3]);
    lock.close();
  });

  it("takes turns: a backlog in one process does not starve a waiter in another", async () => {
    const path = lockPath();
    const a = processLock(path);
    const b = processLock(path);
    const order: string[] = [];
    // The worker with a guide's worth of decks to convert, 100ms each.
    const backlog = Array.from({ length: 8 }, (_, i) => a.run(async () => { order.push(`a${i}`); await sleep(100); }, { pollMs: 50 }));
    await sleep(20);
    // A viewer arriving meanwhile, polling more slowly than a holder hands over.
    const viewer = b.run(async () => { order.push("b"); }, { pollMs: 50, maxWaitMs: 600 });
    await expect(viewer).resolves.toBeUndefined();
    await Promise.all(backlog);
    expect(order.indexOf("b")).toBeLessThanOrEqual(2);
    a.close(); b.close();
  });

  it("does not stand back for a waiter that has gone", async () => {
    const path = lockPath();
    const a = processLock(path);
    await a.run(async () => {});
    // A marker left by a process that died waiting, long untouched.
    const stale = `${path}.wait-999-dead`;
    writeFileSync(stale, "");
    const old = new Date(Date.now() - 30_000);
    utimesSync(stale, old, old);
    const t = Date.now();
    await a.run(async () => {}, { pollMs: 200 });
    expect(Date.now() - t).toBeLessThan(150);
    a.close();
  });

  it("is released when the process holding it is killed", async () => {
    const path = lockPath();
    const { child, held, exited } = holdInChild(path);
    await held;
    const mine = processLock(path);
    await expect(mine.run(async () => "ran", { maxWaitMs: 150, pollMs: 20 })).rejects.toBeInstanceOf(LockTimeoutError);
    child.kill("SIGKILL");   // no clean-up runs: the OS drops the lock
    await exited;
    await expect(mine.run(async () => "ran", { maxWaitMs: 2_000, pollMs: 20 })).resolves.toBe("ran");
    mine.close();
  }, 30_000);
});
