import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { users } from "./schema";
import { clearLlmProvider, getUser, recordCanvasTokenCheck, replaceCanvasToken, setLlmProvider } from "./repo";
import { decrypt } from "../lib/crypto";

const KEY = "0".repeat(64);

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "Ann", canvasUserId: 42 }).run();
  return db;
};

describe("replaceCanvasToken", () => {
  it("stores a new token for the same Canvas account and clears a failure", () => {
    const db = setup();
    recordCanvasTokenCheck(db, 1, false, 50);
    expect(replaceCanvasToken(db, 1, { id: 42, name: "Ann Lee" }, "tok-2", KEY, 100)).toBe("ok");
    const u = getUser(db, 1)!;
    expect(decrypt(u.canvasTokenEnc!, KEY)).toBe("tok-2");
    expect(u.name).toBe("Ann Lee");
    expect(u.canvasVerifiedAt).toBe(100);
    expect(u.canvasTokenFailedAt).toBeNull();
  });

  it("refuses a token that belongs to someone else", () => {
    const db = setup();
    expect(replaceCanvasToken(db, 1, { id: 99, name: "Mallory" }, "tok-x", KEY, 100)).toBe("different-account");
    expect(getUser(db, 1)!.canvasTokenEnc).toBeNull();
  });
});

describe("recordCanvasTokenCheck", () => {
  it("records a refusal, then a success clears it", () => {
    const db = setup();
    recordCanvasTokenCheck(db, 1, false, 10);
    expect(getUser(db, 1)!.canvasTokenFailedAt).toBe(10);
    recordCanvasTokenCheck(db, 1, true, 20);
    expect(getUser(db, 1)).toMatchObject({ canvasTokenFailedAt: null, canvasVerifiedAt: 20 });
  });
});

describe("LLM provider", () => {
  it("encrypts the key and clears all three columns on removal", () => {
    const db = setup();
    setLlmProvider(db, 1, { baseUrl: "https://api.openai.com/v1", model: "m", apiKey: "sk-secret" }, KEY);
    const u = getUser(db, 1)!;
    expect(u.llmKeyEnc).not.toContain("sk-secret");
    expect(decrypt(u.llmKeyEnc!, KEY)).toBe("sk-secret");
    clearLlmProvider(db, 1);
    expect(getUser(db, 1)).toMatchObject({ llmBaseUrl: null, llmModel: null, llmKeyEnc: null });
  });
});
