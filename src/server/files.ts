import { execFile } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { files, modules, users } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { createCanvasClient } from "@/connectors/canvas/client";
import { fileKind } from "@/lib/file-kind";
import { deckCachePath } from "./deck";
import { onceMap, TooLargeError, touch, writeAtomic } from "./io";
import { optimizePdf } from "./pdf-optimize";

// Every file a student opens is fetched from Canvas once and then served from
// the volume. PDFs share the deck cache the study guide already uses, so a
// deck opened in either place is downloaded only once; PowerPoint and Word
// files are converted to PDF there too, which also lets the guide cite them.

const dbPath = () => process.env.DATABASE_PATH ?? "data/openpapr.db";
export const originalCachePath = (courseId: number, canvasFileId: number) =>
  join(dirname(dbPath()), "file-cache", String(courseId), String(canvasFileId));

export function ownedFile(db: Db, userId: number, moduleId: number, fileId: number) {
  const row = db.select({ file: files, mod: modules }).from(files)
    .innerJoin(modules, eq(files.moduleId, modules.id))
    .where(and(eq(files.id, fileId), eq(files.moduleId, moduleId), eq(modules.userId, userId))).get();
  return row ?? null;
}

type Row = NonNullable<ReturnType<typeof ownedFile>>;
export type Served = { path: string; size: number; mtimeMs: number } | { error: string; status: number };

const stat = (path: string): Served => {
  const s = statSync(path);
  return { path, size: s.size, mtimeMs: s.mtimeMs };
};

// Two tabs opening the same deck share one download rather than racing.
const once = onceMap<Served>();

// Past this the file is not proxied: a lecture recording that size is better
// streamed by Canvas itself, and would crowd the cache.
const MAX_PROXY_BYTES = 500_000_000;

async function download(db: Db, userId: number, row: Row, target: string): Promise<Served> {
  const env = loadEnv();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user?.canvasTokenEnc) return { error: "no canvas token", status: 502 };
  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));
  try {
    // Download urls are signed and expire, so a fresh one is asked for each time.
    const fresh = await canvas.getFile(row.file.canvasFileId);
    await canvas.downloadToFile(fresh.url, target, MAX_PROXY_BYTES);
    // A PDF is compressed once, before anyone is served it (see pdf-optimize).
    if (fileKind(row.file.displayName) === "pdf") await optimizePdf(target);
    return stat(target);
  } catch (err) {
    if (err instanceof TooLargeError) return { error: "this file is too large to open here — use the Canvas link", status: 413 };
    const msg = String(err);
    if (/Canvas 40[13]/.test(msg)) return { error: "Canvas no longer lets this account open that file", status: 403 };
    if (/Canvas 404/.test(msg)) return { error: "that file has been removed from Canvas", status: 404 };
    return { error: "Canvas is not answering right now", status: 502 };
  }
}

// The file exactly as uploaded.
export function ensureOriginal(db: Db, userId: number, row: Row): Promise<Served> {
  const target = fileKind(row.file.displayName) === "pdf"
    ? deckCachePath(row.mod.canvasCourseId, row.file.displayName, dbPath())
    : originalCachePath(row.mod.canvasCourseId, row.file.canvasFileId);
  if (existsSync(target)) { touch(target); return Promise.resolve(stat(target)); }
  if ((row.file.sizeBytes ?? 0) > MAX_PROXY_BYTES) {
    return Promise.resolve({ error: "this file is too large to open here — use the Canvas link", status: 413 });
  }
  return once(target, () => download(db, userId, row, target));
}

// --- office → PDF ---------------------------------------------------------

export function sofficeBin(): string | null {
  const candidates = [
    process.env.SOFFICE_BIN,
    "/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/lib/libreoffice/program/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// One conversion at a time: LibreOffice takes a few hundred MB, and the
// machine also runs the web server and the worker.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

async function runSoffice(bin: string, srcPath: string, ext: string): Promise<Uint8Array | null> {
  const work = mkdtempSync(join(tmpdir(), "op-convert-"));
  try {
    const input = join(work, `input.${ext}`);
    copyFileSync(srcPath, input);
    await new Promise<void>((resolve, reject) => {
      execFile(bin, [
        `-env:UserInstallation=file://${join(work, "profile")}`,
        "--headless", "--norestore", "--convert-to", "pdf", "--outdir", work, input,
      ], { timeout: 180_000, maxBuffer: 1 << 20 }, (err) => (err ? reject(err) : resolve()));
    });
    const out = readdirSync(work).find((f) => f.endsWith(".pdf"));
    return out ? new Uint8Array(readFileSync(join(work, out))) : null;
  } catch {
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// The file as a PDF: itself for a PDF, a converted copy for an office file.
export function ensurePdf(db: Db, userId: number, row: Row): Promise<Served> {
  const kind = fileKind(row.file.displayName);
  if (kind === "pdf") return ensureOriginal(db, userId, row);
  if (kind !== "office") return Promise.resolve({ error: "no PDF form for this file", status: 415 });

  const target = deckCachePath(row.mod.canvasCourseId, row.file.displayName, dbPath());
  if (existsSync(target)) { touch(target); return Promise.resolve(stat(target)); }
  const bin = sofficeBin();
  if (!bin) return Promise.resolve({ error: "previews for this file type are not available on this server", status: 501 });

  return once(`pdf:${target}`, async () => {
    const original = await ensureOriginal(db, userId, row);
    if ("error" in original) return original;
    const ext = row.file.displayName.split(".").pop()!.toLowerCase();
    const pdf = await serial(() => runSoffice(bin, original.path, ext));
    if (!pdf || pdf.length === 0) return { error: "this file could not be converted for preview", status: 422 };
    writeAtomic(target, pdf);
    await optimizePdf(target);
    return stat(target);
  });
}

// Streams part or all of a cached file. PDF.js asks for byte ranges, which is
// what lets the first page of a 20MB deck appear before the rest arrives.
export function streamFile(
  served: { path: string; size: number; mtimeMs: number },
  request: Request,
  headers: Record<string, string>,
): Response {
  const etag = `"${served.size.toString(36)}-${Math.floor(served.mtimeMs).toString(36)}"`;
  const base: Record<string, string> = {
    ...headers,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    // Nothing served from here may run script, whatever it claims to be.
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });

  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : served.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : served.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, served.size - 1);
    if (start > end || start >= served.size) {
      return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${served.size}` } });
    }
    const body = Readable.toWeb(createReadStream(served.path, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${served.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(served.path)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...base, "Content-Length": String(served.size) } });
}
