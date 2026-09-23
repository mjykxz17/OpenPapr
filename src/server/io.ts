import { createWriteStream, mkdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// Small I/O primitives shared by the file and deck caches.

// Written beside the target and renamed into place, so a crash or a second
// writer can never leave a half-written file that later reads as complete.
export function writeAtomic(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.part`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, path);
}

export class TooLargeError extends Error {}

// Streams a response body to disk without holding it in memory — a lecture
// recording can be hundreds of megabytes and the machine has 1GB for
// everything. Stops, and leaves nothing behind, past maxBytes.
export async function streamToFile(body: ReadableStream<Uint8Array>, path: string, maxBytes: number): Promise<number> {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.part`;
  let seen = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      cb(seen > maxBytes ? new TooLargeError(`larger than ${Math.round(maxBytes / 1e6)} MB`) : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), limit, createWriteStream(tmp));
    renameSync(tmp, path);
    return seen;
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Concurrent callers asking for the same key share one piece of work.
export function onceMap<T>() {
  const inflight = new Map<string, Promise<T>>();
  return (key: string, work: () => Promise<T>): Promise<T> => {
    const hit = inflight.get(key);
    if (hit) return hit;
    const p = work().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

// At most `n` of these at once; the rest wait their turn.
export function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T,>(work: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    active++;
    try { return await work(); } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

// Marks a cache file as used, for least-recently-used eviction (volumes are
// often mounted noatime, so reading alone does not).
export function touch(path: string): void {
  try { const t = new Date(); utimesSync(path, t, t); } catch { /* best effort */ }
}
