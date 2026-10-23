import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { files, modules, users } from "@/db/schema";
import { DEMO_DECKS } from "@/demo/semester";
import { deckStem, loadDeckPdf } from "./deck";
import { resetDemo } from "./demo";

describe("the demo's decks", () => {
  // The demo has no Canvas token, so its decks have to count as its own
  // uploads straight from the copies resetDemo installs.
  it("load from the installed copies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck-demo-"));
    const prev = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = join(dir, "x.db");
    try {
      const db = createDb(":memory:");
      db.insert(users).values({ name: "owner" }).run();
      const id = await resetDemo(db, Date.parse("2026-10-02T09:00:00+08:00"));
      let loaded = 0;
      for (const mod of db.select().from(modules).where(eq(modules.userId, id)).all()) {
        for (const f of db.select().from(files).where(eq(files.moduleId, mod.id)).all()) {
          if (!DEMO_DECKS.includes(deckStem(f.displayName))) continue;
          expect(await loadDeckPdf(db, id, mod.id, deckStem(f.displayName)), f.displayName).toMatchObject({ onDisk: true });
          loaded++;
        }
      }
      expect(loaded).toBe(DEMO_DECKS.length);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = prev;
    }
  });
});
