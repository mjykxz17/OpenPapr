import { describe, expect, it } from "vitest";
import { needsThread, normalizeDiscussion, parseDiscussionMeta } from "./discussions";
import type { CanvasDiscussion, CanvasDiscussionView } from "./types";

const topic: CanvasDiscussion = {
  id: 7, title: "Quiz 2 questions", message: "<p>Ask here</p>", html_url: "https://c/courses/1/discussion_topics/7",
  posted_at: "2026-09-20T02:00:00Z", last_reply_at: "2026-09-24T02:00:00Z", discussion_subentry_count: 3, unread_count: 1,
  require_initial_post: false, assignment_id: null,
};
const view: CanvasDiscussionView = {
  participants: [{ id: 1, display_name: "Dr Tan" }, { id: 2, display_name: "Classmate" }, { id: 9, display_name: "Me" }],
  view: [
    { id: 100, user_id: 2, created_at: "2026-09-21T02:00:00Z", message: "Does it cover L6?", replies: [
      { id: 101, user_id: 1, created_at: "2026-09-22T02:00:00Z", message: "<p>Only up to L5.</p>" },
    ] },
    { id: 102, user_id: 9, created_at: "2026-09-23T02:00:00Z", message: "Thanks" },
    { id: 103, user_id: 1, created_at: "2026-09-24T02:00:00Z", deleted: true },
  ],
};

describe("normalizeDiscussion", () => {
  it("keeps the topic and staff posts, never classmates' text, and knows you posted", () => {
    const rows = normalizeDiscussion(topic, view, new Set([1]), 9, null);
    expect(rows.map((r) => [r.type, r.sourceId, r.sender])).toEqual([
      ["discussion", "discussion:7", null],
      ["staff_reply", "discussion:7:entry:101", "Dr Tan"],
    ]);
    expect(rows.some((r) => r.body?.includes("L6"))).toBe(false);
    const meta = parseDiscussionMeta(rows[0]!.metaJson)!;
    expect(meta).toMatchObject({ posted: true, replies: 3, staffReplies: 1, seenThread: true, graded: false });
    expect(rows[0]!.submitted).toBe(true);
  });

  it("without a fresh thread, keeps what it knew", () => {
    const first = parseDiscussionMeta(normalizeDiscussion(topic, view, new Set([1]), 9, null)[0]!.metaJson);
    const again = normalizeDiscussion({ ...topic, discussion_subentry_count: 4 }, null, new Set(), 9, first);
    expect(again).toHaveLength(1);
    expect(parseDiscussionMeta(again[0]!.metaJson)).toMatchObject({ posted: true, replies: 4, staffReplies: 1 });
  });

  it("re-reads a thread only when its last reply moved", () => {
    const meta = parseDiscussionMeta(normalizeDiscussion(topic, view, new Set([1]), 9, null)[0]!.metaJson);
    expect(needsThread(topic, null)).toBe(true);
    expect(needsThread(topic, meta)).toBe(false);
    expect(needsThread({ ...topic, last_reply_at: "2026-09-25T02:00:00Z" }, meta)).toBe(true);
  });
});
