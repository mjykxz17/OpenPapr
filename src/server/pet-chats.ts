import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { petChats } from "@/db/schema";

export type PetMsg = { role: "user" | "assistant"; content: string; at: number };
export type PetChatSummary = { id: number; title: string; updatedAt: number; count: number; preview: string };

const MAX_CHATS = 50;
const MAX_MESSAGES = 200;

const parse = (json: string): PetMsg[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; } };
const titleFrom = (q: string) => { const t = q.replace(/\s+/g, " ").trim(); return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t || "New chat"; };

export function listChats(db: Db, userId: number): PetChatSummary[] {
  return db.select().from(petChats).where(eq(petChats.userId, userId)).orderBy(desc(petChats.updatedAt)).limit(MAX_CHATS).all().map((c) => {
    const m = parse(c.messagesJson);
    const last = m[m.length - 1];
    return { id: c.id, title: c.title, updatedAt: c.updatedAt, count: m.length, preview: last ? last.content.replace(/\s+/g, " ").slice(0, 90) : "" };
  });
}

export function getChat(db: Db, userId: number, id: number): { id: number; title: string; messages: PetMsg[] } | null {
  const c = db.select().from(petChats).where(and(eq(petChats.id, id), eq(petChats.userId, userId))).get();
  return c ? { id: c.id, title: c.title, messages: parse(c.messagesJson) } : null;
}

// Adds a question and its answer, creating the conversation on its first
// question. Old conversations beyond the cap are dropped, oldest first.
export function appendToChat(db: Db, userId: number, id: number | null, question: string, answer: string, now: number): { id: number; title: string } {
  const existing = id !== null ? getChat(db, userId, id) : null;
  const add: PetMsg[] = [{ role: "user", content: question, at: now }, { role: "assistant", content: answer, at: now }];
  if (existing) {
    const messages = [...existing.messages, ...add].slice(-MAX_MESSAGES);
    db.update(petChats).set({ messagesJson: JSON.stringify(messages), updatedAt: now }).where(eq(petChats.id, existing.id)).run();
    return { id: existing.id, title: existing.title };
  }
  const row = db.insert(petChats).values({ userId, title: titleFrom(question), messagesJson: JSON.stringify(add), createdAt: now, updatedAt: now }).returning().get();
  const keep = db.select({ id: petChats.id, updatedAt: petChats.updatedAt }).from(petChats).where(eq(petChats.userId, userId)).orderBy(desc(petChats.updatedAt)).all();
  if (keep.length > MAX_CHATS) {
    const drop = keep.slice(MAX_CHATS).map((k) => k.id);
    db.delete(petChats).where(and(eq(petChats.userId, userId), inArray(petChats.id, drop))).run();
  }
  return { id: row.id, title: row.title };
}

export function deleteChat(db: Db, userId: number, id: number): boolean {
  const r = db.delete(petChats).where(and(eq(petChats.id, id), eq(petChats.userId, userId))).run();
  return r.changes > 0;
}
