import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { modules, users } from "@/db/schema";
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

export type DeckResult = { bytes: Uint8Array } | { error: string; status: number };

// Loads a module's slide deck as PDF bytes for the deck/slide routes.
// Resolution order: (1) a locally cached/converted PDF, then (2) the matching
// PDF fetched straight from Canvas. Ownership-checked.
export async function loadDeckPdf(db: Db, userId: number, moduleId: number, name: string): Promise<DeckResult> {
  const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
  if (!mod || mod.userId !== userId) return { error: "not found", status: 404 };

  const cached = deckCachePath(mod.canvasCourseId, name);
  if (existsSync(cached)) return { bytes: new Uint8Array(readFileSync(cached)) };

  const env = loadEnv();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user?.canvasTokenEnc) return { error: "no canvas token", status: 502 };
  const canvas = createCanvasClient(env.CANVAS_BASE_URL, decrypt(user.canvasTokenEnc, env.SECRET_KEY));
  try {
    const files = await canvas.listCourseFiles(mod.canvasCourseId);
    const file = files.find((f) => isPdfFile(f) && deckStem(f.display_name).toLowerCase() === deckStem(name).toLowerCase());
    if (!file) return { error: "deck not found", status: 404 };
    return { bytes: await canvas.downloadFile(file.url) };
  } catch {
    return { error: "canvas unavailable", status: 502 };
  }
}
