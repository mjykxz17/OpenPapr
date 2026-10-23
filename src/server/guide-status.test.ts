import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { files, guidePlans, guideTopics, modules, users } from "../db/schema";
import {
  MAX_TRIES, buildState, deckUnreadable, gapText, gapWorse, guideStatus, missingParts, missingSections, partialHash, readFailure, requestGuideRefresh,
  retryDue, retryWait, scannedDecks, writeFailure,
} from "./guide-status";

const H = 3_600_000;

describe("retries", () => {
  it("keeps the count of tries with the error", () => {
    expect(readFailure(writeFailure(3, "llm 500: overloaded"))).toEqual({ tries: 3, on: null, message: "llm 500: overloaded" });
    expect(readFailure(writeFailure(1, "no plan", "abc123"))).toEqual({ tries: 1, on: "abc123", message: "no plan" });
    expect(readFailure("an error from before counts were kept")).toEqual({ tries: 0, on: null, message: "an error from before counts were kept" });
  });

  it("waits longer after each failure, then stops", () => {
    expect([1, 2, 3, 4].map(retryWait)).toEqual([0.5 * H, H, 2 * H, 4 * H]);
    const at = 1_000_000;
    expect(retryDue(writeFailure(1, "x"), at, at + 0.4 * H)).toBe(false);
    expect(retryDue(writeFailure(1, "x"), at, at + 0.5 * H)).toBe(true);
    expect(retryDue(writeFailure(3, "x"), at, at + 1.5 * H)).toBe(false);
    expect(retryDue(writeFailure(MAX_TRIES, "x"), at, at + 1000 * H)).toBe(false);
    expect(retryDue(null, null, at)).toBe(true);
  });
});

describe("buildState", () => {
  const t = (builtHash: string | null, body: string | null = "### 1.1 x") => ({ inputHash: "h1", builtHash, body });
  it("tells a finished chapter from one missing sections and one behind its slides", () => {
    expect(buildState(t("h1"))).toBe("fresh");
    expect(buildState(t(partialHash("h1", 2)))).toBe("partial");
    expect(missingSections(t(partialHash("h1", 2)))).toBe(2);
    expect(buildState(t(partialHash("h0", 2)))).toBe("stale");
    expect(buildState(t(null, null))).toBe("none");
  });

  it("counts a deck that could not be planned apart from sections", () => {
    const h = partialHash("h1", { sections: 1, decks: 1 });
    expect(buildState(t(h))).toBe("partial");
    expect(missingParts(t(h))).toEqual({ sections: 1, decks: 1 });
    expect(missingParts(t(partialHash("h1", 3)))).toEqual({ sections: 3, decks: 0 });
    expect(gapText({ sections: 1, decks: 1 })).toBe("1 section and 1 lecture deck");
    expect(gapText({ sections: 0, decks: 2 })).toBe("2 lecture decks");
    expect(gapWorse({ sections: 0, decks: 1 }, { sections: 5, decks: 0 })).toBe(true);
    expect(gapWorse({ sections: 1, decks: 0 }, { sections: 2, decks: 0 })).toBe(false);
  });
});

describe("deckUnreadable", () => {
  it("tells a scan from a deck that would not download", () => {
    expect(deckUnreadable(JSON.stringify({ failed: true, reason: "empty", at: 1 }))).toBe("scanned");
    expect(deckUnreadable(JSON.stringify({ pages: 30, words: 12, hash: "x" }))).toBe("scanned");
    expect(deckUnreadable(JSON.stringify({ failed: true, reason: "unreadable", at: 1 }))).toBe("unreadable");
    expect(deckUnreadable(JSON.stringify({ pages: 30, words: 900, hash: "x" }))).toBeNull();
    expect(deckUnreadable(null)).toBeNull();
  });

  it("does not call a short handout with real text a scan", () => {
    expect(deckUnreadable(JSON.stringify({ pages: 3, words: 40, hash: "x" }))).toBeNull();
  });
});

describe("guideStatus", () => {
  function setup() {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "A" }).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 9, code: "CS1", name: "CS1 Intro", active: true }).run();
    db.insert(guidePlans).values({ moduleId: 1, title: "T", inputHash: "x", plannedAt: 1 }).run();
    return db;
  }

  it("says how many sections are still missing, which chapters gave up, and which decks are scans", () => {
    const db = setup();
    const topic = (key: string, extra: Partial<typeof guideTopics.$inferInsert>) =>
      db.insert(guideTopics).values({ moduleId: 1, key, title: key, ord: 0, inputHash: "h", ...extra }).run();
    topic("whole", { body: "b", builtHash: "h" });
    topic("partial", { body: "b", builtHash: partialHash("h", 2), error: writeFailure(1, "2 sections couldn't be written"), errorAt: 5 });
    topic("stuck", { error: writeFailure(MAX_TRIES, "llm 500"), errorAt: 5 });
    topic("retrying", { error: writeFailure(1, "llm 500"), errorAt: 5 });
    db.insert(files).values([
      { moduleId: 1, canvasFileId: 1, displayName: "L5-scan.pdf", category: "slides", discoveredAt: 1, textSigJson: JSON.stringify({ failed: true, reason: "empty", at: 1 }) },
      { moduleId: 1, canvasFileId: 2, displayName: "L6.pdf", category: "slides", discoveredAt: 1, textSigJson: JSON.stringify({ failed: true, reason: "unreadable", at: 1 }) },
    ]).run();
    expect(guideStatus(db, 1)).toMatchObject({
      total: 4, ready: 2, queued: 2, incomplete: 2, incompleteText: "2 sections",
      failed: ["retrying"], stuck: [{ title: "stuck", error: "llm 500" }], scanned: ["L5-scan"],
    });
    // The reasons, for the menu.
    expect(guideStatus(db, 1).problems.map((p) => p.title).sort()).toEqual(["partial", "retrying", "stuck"]);
  });

  it("does not name a scan whose deck is in the guide through a readable copy", () => {
    const db = setup();
    const sig = (v: object) => JSON.stringify(v);
    db.insert(files).values([
      { moduleId: 1, canvasFileId: 1, displayName: "U3-memerr1.pdf", category: "slides", discoveredAt: 1, textSigJson: sig({ pages: 40, words: 3000, hash: "a" }) },
      { moduleId: 1, canvasFileId: 2, displayName: "U3-memerr1-BW.pdf", category: "slides", discoveredAt: 1, textSigJson: sig({ failed: true, reason: "empty", at: 1 }) },
      { moduleId: 1, canvasFileId: 3, displayName: "Lab2-scan.pdf", category: "tutorial", discoveredAt: 1, textSigJson: sig({ pages: 4, words: 3, hash: "b" }) },
      { moduleId: 1, canvasFileId: 4, displayName: "photo.png", category: "slides", discoveredAt: 1, textSigJson: sig({ failed: true, reason: "empty", at: 1 }) },
    ]).run();
    expect(scannedDecks(db, 1)).toEqual(["Lab2-scan"]);
    expect(guideStatus(db, 1).scanned).toEqual(["Lab2-scan"]);
  });

  it("asking again clears the tries and reads failed decks again", () => {
    const db = setup();
    db.insert(guideTopics).values({ moduleId: 1, key: "k", title: "k", ord: 0, inputHash: "h", error: writeFailure(MAX_TRIES, "x"), errorAt: 5 }).run();
    db.insert(files).values([
      { moduleId: 1, canvasFileId: 1, displayName: "L5.pdf", category: "slides", discoveredAt: 1, textSigJson: JSON.stringify({ failed: true, reason: "empty", at: 1 }) },
      { moduleId: 1, canvasFileId: 2, displayName: "L6.pdf", category: "slides", discoveredAt: 1, textSigJson: JSON.stringify({ pages: 30, words: 4, hash: "x", ocr: true, ocrTries: 3 }) },
      { moduleId: 1, canvasFileId: 3, displayName: "L7.pdf", category: "slides", discoveredAt: 1, textSigJson: JSON.stringify({ pages: 30, words: 900, hash: "y" }) },
    ]).run();
    requestGuideRefresh(db, 1, false);
    expect(db.select().from(guideTopics).get()).toMatchObject({ error: null, errorAt: null });
    expect(db.select().from(files).all().map((f) => f.textSigJson === null)).toEqual([true, true, false]);
  });
});
