import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  components, courseHistory, fileHints, files, guidePlans, guideQuizzes, guideRuns, guideTopics, items, llmUsage,
  moduleProfiles, moduleRoadmaps, modules, passages, petChats, slideNotes, studyGuides, syncRuns, taskFeedback, taskPlans, tasks, users, weeklyPlans,
} from "@/db/schema";

// The student's data, theirs to take or to remove. Export leaves out every
// secret (tokens, keys, the password hash, the calendar link); delete removes
// every row that belongs to them, children before parents.

const SECRET = new Set(["canvasTokenEnc", "msRefreshTokenEnc", "msDeltaLink", "llmKeyEnc", "llmFallbackKeyEnc", "passwordHash", "calendarToken"]);

export function exportAccount(db: Db, userId: number) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return null;
  const mods = db.select().from(modules).where(eq(modules.userId, userId)).all();
  const ids = mods.map((m) => m.id);
  const inMods = ids.length ? ids : [-1];
  return {
    exportedAt: new Date().toISOString(),
    user: Object.fromEntries(Object.entries(user).filter(([k]) => !SECRET.has(k))),
    modules: mods,
    components: db.select().from(components).where(inArray(components.moduleId, inMods)).all(),
    files: db.select().from(files).where(inArray(files.moduleId, inMods)).all(),
    items: db.select().from(items).where(eq(items.userId, userId)).all(),
    tasks: db.select().from(tasks).where(eq(tasks.userId, userId)).all(),
    taskFeedback: db.select().from(taskFeedback).where(eq(taskFeedback.userId, userId)).all(),
    studyGuides: db.select().from(studyGuides).where(inArray(studyGuides.moduleId, inMods)).all(),
    guideTopics: db.select().from(guideTopics).where(inArray(guideTopics.moduleId, inMods)).all(),
    slideNotes: db.select().from(slideNotes).where(eq(slideNotes.userId, userId)).all(),
    moduleProfiles: db.select().from(moduleProfiles).where(inArray(moduleProfiles.moduleId, inMods)).all(),
    weeklyPlans: db.select().from(weeklyPlans).where(eq(weeklyPlans.userId, userId)).all(),
    courseHistory: db.select().from(courseHistory).where(eq(courseHistory.userId, userId)).all(),
    papiChats: db.select().from(petChats).where(eq(petChats.userId, userId)).all(),
    aiUsage: db.select().from(llmUsage).where(eq(llmUsage.userId, userId)).all(),
  };
}

// Every row that belongs to the student, children before parents. The user
// row itself stays unless `andUser`; the demo reset keeps it.
export function wipeUserData(db: Db, userId: number, andUser = false): void {
  db.transaction((tx) => {
    const ids = tx.select({ id: modules.id }).from(modules).where(eq(modules.userId, userId)).all().map((m) => m.id);
    if (ids.length) {
      const fileIds = tx.select({ id: files.id }).from(files).where(inArray(files.moduleId, ids)).all().map((f) => f.id);
      if (fileIds.length) tx.delete(fileHints).where(inArray(fileHints.fileId, fileIds)).run();
      for (const t of [guideQuizzes, guideTopics, guidePlans, studyGuides, taskPlans, moduleRoadmaps, moduleProfiles, components] as const) {
        tx.delete(t).where(inArray(t.moduleId, ids)).run();
      }
      tx.delete(files).where(inArray(files.moduleId, ids)).run();
    }
    for (const t of [passages, taskFeedback, tasks, items, guideRuns, slideNotes, weeklyPlans, courseHistory, petChats, llmUsage, syncRuns] as const) {
      tx.delete(t).where(eq(t.userId, userId)).run();
    }
    if (ids.length) tx.delete(modules).where(inArray(modules.id, ids)).run();
    if (andUser) tx.delete(users).where(eq(users.id, userId)).run();
  });
}

export function deleteAccount(db: Db, userId: number): void {
  wipeUserData(db, userId, true);
}
