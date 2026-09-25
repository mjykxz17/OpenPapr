import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { users } from "@/db/schema";
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
});
