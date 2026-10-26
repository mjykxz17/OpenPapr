import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { items, mailAttachments, users } from "../db/schema";
import { fetchMailAttachments } from "./mail-attachments";

const now = Date.parse("2026-10-20T00:00:00Z");
const saved = process.env.DATABASE_PATH;
beforeAll(() => { process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "op-mail-")), "openpapr.db"); });
afterAll(() => { process.env.DATABASE_PATH = saved; });

function graph(calls: string[]) {
  return (async (url: string) => {
    calls.push(url);
    if (url.includes("/attachments?")) {
      return new Response(JSON.stringify({ value: [
        { "@odata.type": "#microsoft.graph.fileAttachment", id: "A1", name: "Lab 3.pdf", contentType: "application/pdf", size: 9 },
        { "@odata.type": "#microsoft.graph.fileAttachment", id: "LOGO", name: "logo.png", size: 5, isInline: true },
        { "@odata.type": "#microsoft.graph.itemAttachment", id: "FWD", name: "forwarded", size: 5 },
        { "@odata.type": "#microsoft.graph.fileAttachment", id: "BIG", name: "video.mp4", size: 90_000_000 },
      ] }));
    }
    return new Response("%PDF-1.4");
  }) as unknown as typeof fetch;
}

describe("email attachments", () => {
  it("keeps real attached files of recent emails, once", async () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    db.insert(items).values([
      { userId: 1, source: "graph", type: "email", sourceId: "mail:m1", title: "Lab 3", firstSeenAt: now },
      { userId: 1, source: "graph", type: "email", sourceId: "mail:old", title: "Old", firstSeenAt: now },
    ]).run();
    const calls: string[] = [];
    const msgs = [
      { id: "m1", subject: "Lab 3", bodyPreview: null, webLink: null, receivedDateTime: "2026-10-19T00:00:00Z", hasAttachments: true },
      { id: "old", subject: "Old", bodyPreview: null, webLink: null, receivedDateTime: "2026-01-01T00:00:00Z", hasAttachments: true },
    ];
    expect(await fetchMailAttachments(db, "tok", 1, msgs, now, graph(calls))).toBe(1);
    const rows = db.select().from(mailAttachments).all();
    expect(rows.map((r) => [r.name, r.path !== null])).toEqual([["Lab 3.pdf", true], ["video.mp4", false]]);
    expect(readFileSync(rows[0]!.path!, "utf8")).toBe("%PDF-1.4");
    expect(calls.some((u) => u.includes("old"))).toBe(false);

    calls.length = 0;
    await fetchMailAttachments(db, "tok", 1, msgs, now, graph(calls));
    expect(calls.filter((u) => u.endsWith("$value"))).toEqual([]);
  });
});
