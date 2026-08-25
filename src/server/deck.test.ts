import { describe, expect, it } from "vitest";
import { deckCachePath, deckStem } from "./deck";

describe("deckStem", () => {
  it("strips the extension", () => {
    expect(deckStem("U2-background.pptx")).toBe("U2-background");
    expect(deckStem("U2-background.pdf")).toBe("U2-background");
  });
  it("leaves a bare name alone", () => {
    expect(deckStem("U2-background")).toBe("U2-background");
  });
  it("only strips the last extension", () => {
    expect(deckStem("cs4239.week1.pptx")).toBe("cs4239.week1");
  });
});

describe("deckCachePath", () => {
  // The cache has to live beside the database, because on Fly that is the
  // mounted volume (/data) and the app's own cwd (/app) is ephemeral — it is
  // wiped on every deploy and is not where the volume is mounted.
  it("resolves beside the database, not the working directory", () => {
    expect(deckCachePath(12345, "U2-background.pptx", "/data/openpapr.db"))
      .toBe("/data/deck-cache/12345/U2-background.pdf");
  });

  it("keeps the repo-relative layout for local development", () => {
    expect(deckCachePath(12345, "U2-background.pptx", "data/openpapr.db"))
      .toBe("data/deck-cache/12345/U2-background.pdf");
  });

  it("always lands on a .pdf regardless of the source extension", () => {
    expect(deckCachePath(1, "deck.ppt", "/data/x.db")).toBe("/data/deck-cache/1/deck.pdf");
    expect(deckCachePath(1, "deck.pdf", "/data/x.db")).toBe("/data/deck-cache/1/deck.pdf");
  });

  it("defaults to DATABASE_PATH when no path is given", () => {
    const prev = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = "/mnt/vol/app.db";
    try {
      expect(deckCachePath(7, "a.pptx")).toBe("/mnt/vol/deck-cache/7/a.pdf");
    } finally {
      if (prev === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = prev;
    }
  });
});
