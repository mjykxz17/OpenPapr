import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { limiter, onceMap, touch, writeAtomic } from "./io";
import { markerPath, optimizePdf } from "./pdf-optimize";
import { ensurePdf } from "./files";
import { renderPdfPage } from "@/lib/pdf-render";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { files, modules, users } from "@/db/schema";
import { fileKind } from "@/lib/file-kind";
import { loadEnv } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { createCanvasClient, isPdfFile } from "@/connectors/canvas/client";

export const deckStem = (name: string) => name.replace(/\.[^.]+$/, "");

// Where a locally-converted deck PDF lives (e.g. a PowerPoint deck turned to
// PDF by scripts/cache-decks.ts). Keyed by Canvas course id + filename stem.
//
// Anchored to the database's directory, not process.cwd(): in production the
// database sits on the mounted Fly volume (/data) while cwd is the image's
// /app, which is read-only-ish, excluded from the image by .dockerignore, and
// wiped on every deploy. Keying off cwd meant the cache never hit and every
// deck was re-downloaded from Canvas on every request.
//
// A Canvas file name is one path segment here: a slash or backslash in it
// would otherwise reach another course's folder, so they become "_".
export function deckCachePath(
  courseId: number,
  name: string,
  dbPath: string = process.env.DATABASE_PATH ?? "data/openpapr.db",
): string {
  const dir = join(dirname(dbPath), "deck-cache", String(courseId));
  const path = join(dir, `${deckStem(name).replace(/[/\\\0]/g, "_")}.pdf`);
  // Cannot happen after the line above; kept so a later change cannot
  // quietly undo it.
  if (dirname(path) !== dir) throw new Error("deck name is not a plain file name");
  return path;
}

// A deck name arrives in a query string. It names a file, never a path.
// Dots are fine ("Recap...pdf"): the name is only ever matched against the
// module's own files, and the path is built from the stored one.
export const safeDeckName = (name: string) =>
  name.length > 0 && name.length <= 300 && !/[/\\\0]/.test(name);

type Module = typeof modules.$inferSelect;
type FileRow = typeof files.$inferSelect;
export type DeckRef = { mod: Module; file: FileRow; path: string };
type Failure = { error: string; status: number };

// Turns the name a page asked for into one of the caller's own files. The
// cache is shared by everyone in a course and filed by name, so it is only
// read for a deck this student's own module lists, and at the path built
// from that file's stored name rather than from what the request said.
export function resolveDeck(db: Db, userId: number, moduleId: number, name: string): DeckRef | Failure {
  if (!safeDeckName(name)) return { error: "bad deck name", status: 400 };
  const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
  if (!mod || mod.userId !== userId) return { error: "not found", status: 404 };
  const want = deckStem(name).toLowerCase();
  const rows = db.select().from(files).where(eq(files.moduleId, mod.id)).all()
    .filter((r) => deckStem(r.displayName).toLowerCase() === want);
  // A PDF beats a PowerPoint of the same name (the cache holds the PDF, or
  // the PowerPoint's converted copy when there is no PDF); then a listed file
  // beats a hidden one, and a re-upload beats the original.
  const rank = (r: FileRow) => (fileKind(r.displayName) === "pdf" ? 0 : 2) + (r.hidden ? 1 : 0);
  rows.sort((a, b) => rank(a) - rank(b) || b.discoveredAt - a.discoveredAt || b.id - a.id);
  const file = rows[0];
  if (!file) return { error: "deck not found", status: 404 };
  return { mod, file, path: deckCachePath(mod.canvasCourseId, file.displayName) };
}

// The cache is filed by name, but two students' files can share a name and
// not their slides (a section's own "Tutorial 1", or a deck re-uploaded
// since). A "<pdf>.src" sidecar, the same one files.ts keeps, says which
// Canvas upload a cached copy came from, and a copy is only used for that
// upload. One with no sidecar was cached before uploads were tracked, by
// whoever asked first, so it is fetched again with the caller's own token.
const sourceOf = (path: string) => {
  try { return readFileSync(`${path}.src`, "utf8").trim(); } catch { return null; }
};
export const cachedCopyIsOf = (path: string, file: Pick<FileRow, "canvasFileId">) =>
  existsSync(path) && sourceOf(path) === String(file.canvasFileId);

// Decks are large — IFS4103's are 22MB — and a single guide page can request
// thirty slide images from one deck. Writing the download to the volume turns
// that into one fetch instead of thirty.
// The cached copy is compressed before it is used (see pdf-optimize), so the
// bytes handed back are the compressed ones when that worked.
async function cacheDeck(path: string, file: FileRow, bytes: Uint8Array): Promise<Uint8Array> {
  try {
    // The sidecar goes first and comes back last, so the new bytes are never
    // taken for the old upload's.
    rmSync(`${path}.src`, { force: true });
    rmSync(markerPath(path), { force: true });
    writeAtomic(path, bytes);
    writeFileSync(`${path}.src`, String(file.canvasFileId));
    const r = await optimizePdf(path);
    if (r.replaced) return new Uint8Array(readFileSync(path));
  } catch {
    // A read-only or full disk must not break serving the deck.
  }
  return bytes;
}

// `onDisk` says the copy at deck.path is these bytes, so it can be streamed.
export type DeckResult = { bytes: Uint8Array; deck: DeckRef; onDisk: boolean } | Failure;

// Loads a module's slide deck as PDF bytes for the deck/slide routes.
// Resolution order: (1) a locally cached/converted PDF, then (2) the matching
// PDF fetched straight from Canvas. Ownership-checked.
const deckOnce = onceMap<{ bytes: Uint8Array } | Failure>();

export async function loadDeckPdf(db: Db, userId: number, moduleId: number, name: string): Promise<DeckResult> {
  const deck = resolveDeck(db, userId, moduleId, name);
  if ("error" in deck) return deck;
  return loadResolved(db, userId, deck);
}

async function loadResolved(db: Db, userId: number, deck: DeckRef): Promise<DeckResult> {
  if (cachedCopyIsOf(deck.path, deck.file)) {
    const bytes = new Uint8Array(readFileSync(deck.path));
    // Asked again after reading: a classmate's download may have replaced
    // the file in between (cacheDeck drops the sidecar before it writes).
    if (sourceOf(deck.path) === String(deck.file.canvasFileId)) {
      touch(deck.path);
      return { bytes, deck, onDisk: true };
    }
  }
  // A PowerPoint's PDF is its converted copy, which files.ts makes and keeps
  // current (converting again only when it has to).
  if (fileKind(deck.file.displayName) !== "pdf") {
    const pdf = await ensurePdf(db, userId, { mod: deck.mod, file: deck.file });
    if ("error" in pdf) return pdf;
    return { bytes: new Uint8Array(readFileSync(pdf.path)), deck, onDisk: pdf.path === deck.path };
  }
  // A guide page asks for dozens of slides of the same deck at once; they
  // share one download instead of each fetching the whole deck.
  const res = await deckOnce(`${deck.path}#${deck.file.canvasFileId}`, () => fetchDeck(db, userId, deck));
  return "error" in res ? res : { bytes: res.bytes, deck, onDisk: cachedCopyIsOf(deck.path, deck.file) };
}

async function fetchDeck(db: Db, userId: number, { mod, file, path: cached }: DeckRef): Promise<{ bytes: Uint8Array } | Failure> {
  const env = loadEnv();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user?.canvasTokenEnc) return { error: "no canvas token", status: 502 };
  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));

  // The harvested file first. Some courses keep their decks out of the Files
  // listing entirely, so the listing below would never find them; the stored
  // id resolves regardless of whether Canvas lists the file.
  try {
    // Download urls are signed and expire, so the row holds the id and the
    // url is fetched fresh here.
    const fresh = await canvas.getFile(file.canvasFileId);
    return { bytes: await cacheDeck(cached, file, await canvas.downloadFile(fresh.url)) };
  } catch {
    // Fall through to the listing — the file may have been removed.
  }

  try {
    const want = deckStem(file.displayName).toLowerCase();
    const listed = await canvas.listCourseFiles(mod.canvasCourseId);
    const found = listed.find((f) => isPdfFile(f) && deckStem(f.display_name).toLowerCase() === want);
    if (!found) return { error: "deck not found", status: 404 };
    return { bytes: await cacheDeck(cached, file, await canvas.downloadFile(found.url)) };
  } catch {
    return { error: "canvas unavailable", status: 502 };
  }
}

// A rendered page, cached as PNG beside the deck on the volume. Rendering
// means parsing the whole PDF (IFS4103's decks are 22MB), and the slide
// panel asks for the current page plus a strip of thumbnails on every page
// turn, so without this each turn re-parsed the deck half a dozen times.
// Each image is named by the Canvas upload it was drawn from, so a
// classmate's same-named deck, or the copy a re-upload replaced, is never
// served for this one. Images from before that (no id in the name) were also
// drawn in a serif fallback font, and are left for eviction.
export const slidePngPath = (deck: Pick<DeckRef, "path" | "file">, page: number, scale: number) =>
  deck.path.replace(/\.pdf$/, `-pages/${page}@${scale}-${deck.file.canvasFileId}.png`);

export type SlideResult = { png: Uint8Array } | Failure;

// Rendering parses the whole PDF in this process and holds a few hundred MB
// while it does; two at a time keeps a page full of slide images from
// running the web server out of memory, and identical requests share a render.
const renderSlot = limiter(2);
const renderOnce = onceMap<SlideResult>();

export async function renderCachedSlide(db: Db, userId: number, moduleId: number, name: string, page: number, scale: number): Promise<SlideResult> {
  const ref = resolveDeck(db, userId, moduleId, name);
  if ("error" in ref) return ref;
  const path = slidePngPath(ref, page, scale);
  if (existsSync(path)) return { png: new Uint8Array(readFileSync(path)) };

  return renderOnce(path, async () => {
    const deck = await loadResolved(db, userId, ref);
    if ("error" in deck) return deck;
    const png = await renderSlot(() => renderPdfPage(deck.bytes, page, scale));
    if (!png) return { error: "that slide could not be drawn", status: 404 };
    try {
      writeAtomic(path, png);
    } catch {
      // Serving the page matters more than caching it.
    }
    return { png };
  });
}
