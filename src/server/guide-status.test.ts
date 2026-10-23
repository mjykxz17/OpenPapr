import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { files, guidePlans, guideTopics, modules, users } from "../db/schema";
import {
  MAX_TRIES, buildState, deckUnreadable, guideStatus, missingSections, partialHash, readFailure, requestGuideRefresh, retryDue, retryWait, writeFailure,
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
});

describe("deckUnreadable", () => {
  it("tells a scan from a deck that would not download", () => {
    expect(deckUnreadable(JSON.stringify({ failed: true, reason: "empty", at: 1 }))).toBe("scanned");
    expect(deckUnreadable(JSON.stringify({ pages: 30, words: 12, hash: "x" }))).toBe("scanned");
    expect(deckUnreadable(JSON.stringify({ failed: true, reason: "unreadable", at: 1 }))).toBe("unreadable");
    expect(deckUnreadable(JSON.stringify({ pages: 30, words: 900, hash: "x" }))).toBeNull();
    expect(deckUnreadable(null)).toBeNull();
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
      total: 4, ready: 2, queued: 2, incomplete: 2,
      failed: ["retrying"], stuck: [{ title: "stuck", error: "llm 500" }], scanned: ["L5-scan"],
    });
  });

  it("asking again clears the tries and reads failed decks again", () => {
    const db = setup();
    db.insert(guideTopics).values({ moduleId: 1, key: "k", title: "k", ord: 0, inputHash: "h", error: writeFailure(MAX_TRIES, "x"), errorAt: 5 }).run();
    db.insert(files).values({ moduleId: 1, canvasFileId: 1, displayName: "L5.pdf", category: "slides", discoveredAt: 1, textSigJson: JSON.stringify({ failed: true, reason: "empty", at: 1 }) }).run();
    requestGuideRefresh(db, 1, false);
    expect(db.select().from(guideTopics).get()).toMatchObject({ error: null, errorAt: null });
    expect(db.select().from(files).get()!.textSigJson).toBeNull();
  });
});
