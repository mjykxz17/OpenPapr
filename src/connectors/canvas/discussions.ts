import type { CanvasDiscussion, CanvasDiscussionEntry, CanvasDiscussionView } from "./types";
import type { NormalizedDiscussionItem } from "./normalize";

// A discussion is one item; each post by a lecturer or TA inside it is its own
// item too, so it shows up next to announcements, in What's new, and in what
// the task planner reads — which is where forum answers ("the quiz covers up
// to L5") belong. Other students' posts are never stored; only counted.

export type DiscussionMeta = {
  replies: number; unread: number; lastReplyAt: number | null;
  requireInitialPost: boolean; graded: boolean; assignmentId: number | null;
  posted: boolean; locked: boolean; staffReplies: number; seenThread: boolean;
};
export type StaffReplyMeta = { topicSourceId: string; topicTitle: string };

const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

function walk(entries: CanvasDiscussionEntry[], visit: (e: CanvasDiscussionEntry) => void) {
  for (const e of entries) { visit(e); if (e.replies?.length) walk(e.replies, visit); }
}

export function parseDiscussionMeta(json: string | null | undefined): DiscussionMeta | null {
  try { return json ? (JSON.parse(json) as DiscussionMeta) : null; } catch { return null; }
}

// Only threads that changed are re-read: a thread's last reply time moving is
// the signal, plus any thread never read before.
export function needsThread(topic: CanvasDiscussion, prev: DiscussionMeta | null): boolean {
  if (!prev?.seenThread) return true;
  return (ts(topic.last_reply_at) ?? 0) !== (prev.lastReplyAt ?? 0);
}

export function normalizeDiscussion(
  topic: CanvasDiscussion, view: CanvasDiscussionView | null, staffIds: Set<number>, selfId: number | null, prev: DiscussionMeta | null,
): NormalizedDiscussionItem[] {
  let posted = prev?.posted ?? false;
  const staff: CanvasDiscussionEntry[] = [];
  if (view) {
    posted = false;
    walk(view.view ?? [], (e) => {
      if (e.deleted) return;
      if (selfId !== null && e.user_id === selfId) posted = true;
      if (e.user_id !== undefined && staffIds.has(e.user_id) && e.message) staff.push(e);
    });
  }
  const names = new Map((view?.participants ?? []).map((p) => [p.id, p.display_name]));
  const topicSourceId = `discussion:${topic.id}`;
  const meta: DiscussionMeta = {
    replies: topic.discussion_subentry_count ?? 0,
    unread: topic.unread_count ?? 0,
    lastReplyAt: ts(topic.last_reply_at),
    requireInitialPost: Boolean(topic.require_initial_post),
    graded: topic.assignment_id != null,
    assignmentId: topic.assignment_id ?? null,
    posted,
    locked: Boolean(topic.locked_for_user),
    staffReplies: view ? staff.length : prev?.staffReplies ?? 0,
    seenThread: Boolean(view) || Boolean(prev?.seenThread),
  };
  const out: NormalizedDiscussionItem[] = [{
    type: "discussion", sourceId: topicSourceId, title: topic.title, body: topic.message, url: topic.html_url,
    sender: topic.author?.display_name ?? topic.user_name ?? null,
    // A graded discussion takes its due date from its assignment when stored;
    // an ungraded one may carry a to-do date.
    dueAt: ts(topic.todo_date), sourceCreatedAt: ts(topic.posted_at), submitted: posted,
    metaJson: JSON.stringify(meta),
  }];
  for (const e of staff) {
    const m: StaffReplyMeta = { topicSourceId, topicTitle: topic.title };
    out.push({
      type: "staff_reply", sourceId: `${topicSourceId}:entry:${e.id}`, title: `Re: ${topic.title}`, body: e.message ?? null,
      url: `${topic.html_url}#entry-${e.id}`, sender: names.get(e.user_id!) ?? null,
      dueAt: null, sourceCreatedAt: ts(e.created_at), submitted: false, metaJson: JSON.stringify(m),
    });
  }
  return out;
}
