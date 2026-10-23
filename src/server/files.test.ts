import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDb } from "@/db/client";
import { files, modules, users } from "@/db/schema";
import { deckCachePath } from "./deck";
import { ensurePdf, originalCachePath, ownedFile, streamFile } from "./files";
import { processLock } from "./process-lock";

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "files-test-"));
  const path = join(dir, "f.bin");
  writeFileSync(path, Buffer.from("0123456789"));
  const s = statSync(path);
  return { path, size: s.size, mtimeMs: s.mtimeMs };
};
const req = (headers: Record<string, string> = {}) => new Request("http://x/f", { headers });

describe("streamFile", () => {
  it("serves the whole file with a length and an etag", async () => {
    const res = streamFile(fixture(), req(), { "Content-Type": "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(await res.text()).toBe("0123456789");
  });
  it("serves a byte range", async () => {
    const res = streamFile(fixture(), req({ Range: "bytes=2-4" }), {});
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await res.text()).toBe("234");
  });
  it("serves an open-ended and a suffix range", async () => {
    expect(await streamFile(fixture(), req({ Range: "bytes=7-" }), {}).text()).toBe("789");
    expect(await streamFile(fixture(), req({ Range: "bytes=-2" }), {}).text()).toBe("89");
  });
  it("clamps a range past the end and refuses one that starts past it", async () => {
    expect(await streamFile(fixture(), req({ Range: "bytes=8-99" }), {}).text()).toBe("89");
    expect(streamFile(fixture(), req({ Range: "bytes=20-30" }), {}).status).toBe(416);
  });
  it("answers 304 to a matching etag", () => {
    const f = fixture();
    const etag = streamFile(f, req(), {}).headers.get("etag")!;
    expect(streamFile(f, req({ "If-None-Match": etag }), {}).status).toBe(304);
  });
});

describe("ownedFile", () => {
  it("finds a file only through the owner's module", () => {
    const db = createDb(":memory:");
    db.insert(users).values([{ name: "a" }, { name: "b" }]).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS1", name: "x", active: true }).run();
    db.insert(files).values({ moduleId: 1, canvasFileId: 99, displayName: "L1.pdf", discoveredAt: 0 }).run();
    expect(ownedFile(db, 1, 1, 1)?.file.displayName).toBe("L1.pdf");
    expect(ownedFile(db, 2, 1, 1)).toBeNull();
    expect(ownedFile(db, 1, 2, 1)).toBeNull();
  });
});

describe("ensurePdf conversion", () => {
  const saved = { db: process.env.DATABASE_PATH, bin: process.env.SOFFICE_BIN };
  afterEach(() => {
    process.env.DATABASE_PATH = saved.db;
    process.env.SOFFICE_BIN = saved.bin;
  });

  // A data dir with one PowerPoint deck already downloaded, and a stand-in
  // LibreOffice that counts its runs.
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "convert-test-"));
    process.env.DATABASE_PATH = join(dir, "openpapr.db");
    const calls = join(dir, "soffice-calls");
    const bin = join(dir, "soffice");
    writeFileSync(bin, `#!/bin/sh\necho run >> "${calls}"\neval last=\\\${$#}\nprintf '%%PDF-1.4 fake' > "$(dirname "$last")/input.pdf"\n`);
    chmodSync(bin, 0o755);
    process.env.SOFFICE_BIN = bin;
    const db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS1", name: "x", active: true }).run();
    db.insert(files).values({ moduleId: 1, canvasFileId: 99, displayName: "L1.pptx", discoveredAt: 0 }).run();
    const original = originalCachePath(7, 99);
    mkdirSync(dirname(original), { recursive: true });
    writeFileSync(original, "pptx bytes");
    const target = deckCachePath(7, "L1.pptx");
    // Marked as compressed already, so no Ghostscript runs here.
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.opt`, "");
    const runs = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0);
    return { db, row: ownedFile(db, 1, 1, 1)!, target, runs, other: processLock(join(dir, "convert.lock")) };
  }

  it("converts an office file when the converter is free", async () => {
    const { db, row, target, runs, other } = setup();
    expect(await ensurePdf(db, 1, row)).toMatchObject({ path: target });
    expect(runs()).toBe(1);
    other.close();
  });

  it("does not convert again a deck the other process converted while it waited", async () => {
    const { db, row, target, runs, other } = setup();
    let pending: ReturnType<typeof ensurePdf> | null = null;
    await other.run(async () => {
      pending = ensurePdf(db, 1, row);
      await new Promise((r) => setTimeout(r, 100));
      // The other process's conversion lands before it lets go.
      writeFileSync(target, "%PDF-1.4 theirs");
      writeFileSync(`${target}.src`, "99");
    });
    expect(await pending!).toMatchObject({ path: target });
    expect(readFileSync(target, "utf8")).toBe("%PDF-1.4 theirs");
    expect(runs()).toBe(0);
    other.close();
  });

  it("answers busy, not unreadable, when the wait runs out", async () => {
    const { db, row, runs, other } = setup();
    let release: () => void = () => {};
    const held = other.run(() => new Promise<void>((r) => { release = r; }));
    await new Promise((r) => setTimeout(r, 20));
    expect(await ensurePdf(db, 1, row, { convertWaitMs: 100 })).toMatchObject({ status: 503 });
    release();
    await held;
    expect(runs()).toBe(0);
    other.close();
  });
});
