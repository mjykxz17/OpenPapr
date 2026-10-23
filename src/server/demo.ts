import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { files, guideProgress, modules, quizAttempts, users } from "@/db/schema";
import { DEMO_DECKS, seedSemester } from "@/demo/semester";
import { deckSignature } from "@/lib/deck-versions";
import { extractPdfText } from "@/lib/pdf-text";
import { deckCachePath } from "./deck";
import { wipeUserData } from "./account-data";

// The public demo account. Anyone can open it from the sign-in page without
// signing up. It holds a made-up semester, borrows the owner's AI key with a
// daily cap (see llm-config), cannot change its settings, and is wiped and
// re-seeded every night at midnight Singapore time, so whatever visitors do
// to it lasts one day at most.

const H = 3_600_000;
const D = 24 * H;
// Made-up Canvas course ids, far from real ones: cached decks are filed by course id.
export const DEMO_COURSE_BASE = 9_900_000;

export { demoEnabled } from "@/lib/env";

// The most recent midnight in Singapore, as a timestamp.
export function lastMidnightSgt(now: number): number {
  return Math.floor((now + 8 * H) / D) * D - 8 * H;
}

export function findDemoUser(db: Db) {
  return db.select().from(users).where(eq(users.isDemo, true)).get() ?? null;
}

export function demoDue(user: { demoResetAt: number | null } | null, now: number): boolean {
  return !user || user.demoResetAt === null || user.demoResetAt < lastMidnightSgt(now);
}

const deckDir = () => join(process.cwd(), "src", "demo", "decks");

// Puts the shipped decks where the slide viewer and guide look for them, and
// fingerprints them so they count as the module's lecture decks. Pages drawn
// from an older copy of a deck are thrown away with it.
async function installDecks(db: Db, moduleIds: number[], dbPath?: string): Promise<number> {
  let installed = 0;
  for (const moduleId of moduleIds) {
    const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
    if (!mod) continue;
    for (const f of db.select().from(files).where(eq(files.moduleId, moduleId)).all()) {
      const stem = f.displayName.replace(/\.[^.]+$/, "");
      if (!DEMO_DECKS.includes(stem)) continue;
      const src = join(deckDir(), `${stem}.pdf`);
      if (!existsSync(src)) continue;
      const target = deckCachePath(mod.canvasCourseId, f.displayName, dbPath);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(src, target);
      rmSync(target.replace(/\.pdf$/, "-pages"), { recursive: true, force: true });
      writeFileSync(`${target}.src`, String(f.canvasFileId));
      const text = await extractPdfText(new Uint8Array(readFileSync(src)));
      if (text.trim()) db.update(files).set({ textSigJson: JSON.stringify(deckSignature(text)), sizeBytes: readFileSync(src).length, contentType: "application/pdf" }).where(eq(files.id, f.id)).run();
      installed++;
    }
  }
  return installed;
}

// Makes the demo account exist and look like a fresh copy of the semester.
let running: Promise<number> | null = null;
export function resetDemo(db: Db, now: number, dbPath?: string): Promise<number> {
  running ??= (async () => {
    try {
      let user = findDemoUser(db);
      if (!user) {
        user = db.insert(users).values({
          name: "Alex Tan", isDemo: true, createdAt: now, onboardedAt: now, lastSeenAt: now - D,
          major: "Computer Science", studyYear: 2,
        }).returning().get();
      } else {
        // Yesterday's visitors' answers and ticked-off chapters go too.
        db.delete(quizAttempts).where(eq(quizAttempts.userId, user.id)).run();
        db.delete(guideProgress).where(eq(guideProgress.userId, user.id)).run();
        wipeUserData(db, user.id);
      }
      db.update(users).set({
        homeLayoutJson: null, calendarToken: null, lastSeenAt: now - D, onboardedAt: now, demoResetAt: now,
        major: "Computer Science", studyYear: 2, tasksRequestedAt: null, profileRequestedAt: null, syncRequestedAt: null,
      }).where(eq(users.id, user.id)).run();
      // The semester also stamps the account's last Canvas sync and profile.
      const { moduleIds } = seedSemester(db, user.id, now, DEMO_COURSE_BASE);
      await installDecks(db, moduleIds, dbPath);
      return user.id;
    } finally {
      running = null;
    }
  })();
  return running;
}

// The demo account, reset first if it has not been since midnight.
export async function demoUserId(db: Db, now: number): Promise<number> {
  const user = findDemoUser(db);
  if (user && !demoDue(user, now)) return user.id;
  return resetDemo(db, now);
}

export { installDecks as installDemoDecks };
