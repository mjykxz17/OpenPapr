import { existsSync, readFileSync } from "node:fs";
import { limiter, onceMap, touch, writeAtomic } from "./io";
import { optimizePdf } from "./pdf-optimize";
import { renderPdfPage } from "@/lib/pdf-render";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { modules, users } from "@/db/schema";
import { findModuleFileByStem } from "@/db/repo";
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
export const deckCachePath = (
  courseId: number,
  name: string,
  dbPath: string = process.env.DATABASE_PATH ?? "data/openpapr.db",
) => join(dirname(dbPath), "deck-cache", String(courseId), `${deckStem(name)}.pdf`);

// Decks are large — IFS4103's are 22MB — and a single guide page can request
// thirty slide images from one deck. Writing the download to the volume turns
// that into one fetch instead of thirty.
// The cached copy is compressed before it is used (see pdf-optimize), so the
// bytes handed back are the compressed ones when that worked.
async function cacheDeck(path: string, bytes: Uint8Array): Promise<Uint8Array> {
  try {
    writeAtomic(path, bytes);
    const r = await optimizePdf(path);
    if (r.replaced) return new Uint8Array(readFileSync(path));
  } catch {
    // A read-only or full disk must not break serving the deck.
  }
  return bytes;
}

export type DeckResult = { bytes: Uint8Array } | { error: string; status: number };

// Loads a module's slide deck as PDF bytes for the deck/slide routes.
// Resolution order: (1) a locally cached/converted PDF, then (2) the matching
// PDF fetched straight from Canvas. Ownership-checked.
const deckOnce = onceMap<DeckResult>();

export async function loadDeckPdf(db: Db, userId: number, moduleId: number, name: string): Promise<DeckResult> {
  const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
  if (!mod || mod.userId !== userId) return { error: "not found", status: 404 };

  const cached = deckCachePath(mod.canvasCourseId, name);
  if (existsSync(cached)) { touch(cached); return { bytes: new Uint8Array(readFileSync(cached)) }; }
  // A guide page asks for dozens of slides of the same deck at once; they
  // share one download instead of each fetching the whole deck.
  return deckOnce(cached, () => fetchDeck(db, userId, mod, name, cached));
}

async function fetchDeck(db: Db, userId: number, mod: typeof modules.$inferSelect, name: string, cached: string): Promise<DeckResult> {

  const env = loadEnv();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user?.canvasTokenEnc) return { error: "no canvas token", status: 502 };
  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));

  // Harvested files first. Some courses keep their decks out of the Files
  // listing entirely, so the listing below would never find them; the stored
  // id resolves regardless of whether Canvas lists the file.
  const known = findModuleFileByStem(db, mod.id, name);
  if (known) {
    try {
      // Download urls are signed and expire, so the row holds the id and the
      // url is fetched fresh here.
      const fresh = await canvas.getFile(known.canvasFileId);
      return { bytes: await cacheDeck(cached, await canvas.downloadFile(fresh.url)) };
    } catch {
      // Fall through to the listing — the file may have been removed.
    }
  }

  try {
    const listed = await canvas.listCourseFiles(mod.canvasCourseId);
    const file = listed.find((f) => isPdfFile(f) && deckStem(f.display_name).toLowerCase() === deckStem(name).toLowerCase());
    if (!file) return { error: "deck not found", status: 404 };
    return { bytes: await cacheDeck(cached, await canvas.downloadFile(file.url)) };
  } catch {
    return { error: "canvas unavailable", status: 502 };
  }
}

// A rendered page, cached as PNG beside the deck on the volume. Rendering
// means parsing the whole PDF (IFS4103's decks are 22MB), and the slide
// panel asks for the current page plus a strip of thumbnails on every page
// turn, so without this each turn re-parsed the deck half a dozen times.
export const slidePngPath = (courseId: number, name: string, page: number, scale: number, dbPath?: string) =>
  deckCachePath(courseId, name, dbPath).replace(/\.pdf$/, `-pages/${page}@${scale}.png`);

export type SlideResult = { png: Uint8Array } | { error: string; status: number };

// Rendering parses the whole PDF in this process and holds a few hundred MB
// while it does; two at a time keeps a page full of slide images from
// running the web server out of memory, and identical requests share a render.
const renderSlot = limiter(2);
const renderOnce = onceMap<SlideResult>();

export async function renderCachedSlide(db: Db, userId: number, moduleId: number, name: string, page: number, scale: number): Promise<SlideResult> {
  const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
  if (!mod || mod.userId !== userId) return { error: "not found", status: 404 };
  const path = slidePngPath(mod.canvasCourseId, name, page, scale);
  if (existsSync(path)) return { png: new Uint8Array(readFileSync(path)) };

  return renderOnce(path, async () => {
    const deck = await loadDeckPdf(db, userId, moduleId, name);
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
