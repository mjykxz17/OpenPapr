import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { petChats, users } from "@/db/schema";
import { appendToChat, deleteChat, getChat, listChats } from "./pet-chats";

describe("pet conversations", () => {
  it("starts a conversation on the first question, appends to it, lists newest first, and stays private", () => {
    const db = createDb(":memory:");
    db.insert(users).values([{ name: "A" }, { name: "B" }]).run();
    const a = appendToChat(db, 1, null, "When is the next quiz for 4238?", "Wed 30 Sep.", 1000);
    appendToChat(db, 1, a.id, "And after that?", "Wed 14 Oct.", 2000);
    const b = appendToChat(db, 1, null, "Anything missing?", "Nothing.", 3000);
    expect(a.title).toBe("When is the next quiz for 4238?");
    expect(getChat(db, 1, a.id)!.messages.map((m) => m.content)).toEqual(["When is the next quiz for 4238?", "Wed 30 Sep.", "And after that?", "Wed 14 Oct."]);
    expect(listChats(db, 1).map((c) => [c.id, c.count])).toEqual([[b.id, 2], [a.id, 4]]);
    expect(getChat(db, 2, a.id)).toBeNull();
    expect(deleteChat(db, 2, a.id)).toBe(false);
    expect(deleteChat(db, 1, a.id)).toBe(true);
    expect(listChats(db, 1)).toHaveLength(1);
  });

  it("keeps whether each answer was grounded in the material", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "A" }).run();
    const a = appendToChat(db, 1, null, "What is a canary?", "A guard on the stack.", 1000, [], false);
    appendToChat(db, 1, a.id, "Quiz date?", "Wed.", 2000);
    const m = getChat(db, 1, a.id)!.messages;
    expect(m[1]!.grounded).toBe(false);
    // Saved without the flag and citing nothing (a date answer): not flagged.
    expect(m[3]!.grounded).toBeUndefined();
  });

  it("fills in grounded and source labels on answers saved before they existed", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "A" }).run();
    const legacy = [
      { role: "user", content: "What is a canary?", at: 1 },
      { role: "assistant", content: "A guard [1].", at: 1, sources: [{ n: 1, kind: "guide", title: "Study guide: Stacks", code: "CS4238", moduleId: 1, href: "/modules/1/guide", slide: null }] },
    ];
    const row = db.insert(petChats).values({ userId: 1, title: "t", messagesJson: JSON.stringify(legacy), createdAt: 1, updatedAt: 1 }).returning().get();
    const m = getChat(db, 1, row.id)!.messages;
    expect(m[0]!.grounded).toBeUndefined();
    expect(m[1]!.grounded).toBe(true);
    expect(m[1]!.sources![0]!.label).toBe("study guide");
  });
});
