import { describe, expect, it } from "vitest";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@/db/client";
import { files, modules, users } from "@/db/schema";
import { ownedFile, streamFile } from "./files";

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
