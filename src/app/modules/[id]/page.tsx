import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { requireUserId } from "@/server/session";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { components, items, modules } from "@/db/schema";
import { getStudyGuide, listModuleFiles } from "@/db/repo";
import { AppShell } from "@/components/AppShell";
import { ManualComponentForm } from "@/components/ManualComponentForm";
import { Materials } from "@/components/Materials";
import { parseDiscussionMeta } from "@/connectors/canvas/discussions";
import { htmlToText } from "@/lib/html-text";
import { withShadowFlags } from "@/lib/component-display";
import { SourceChip } from "@/components/SourceChip";
import { WeightBar, weightSegments } from "@/components/WeightBar";
import { dueLabel, relativeDay, shortDate } from "@/lib/format-date";
import { sortMaterials } from "@/lib/materials";
import { getOverview } from "@/server/overview";
import { moduleDisplay } from "@/lib/module-display";
import { loadEnv } from "@/lib/env";
import { moduleProfileView, weeklyPlanView } from "@/server/profiles";
import { canGenerateGuides } from "@/server/llm-access";
import { ModuleProfileCard } from "@/components/profile/ModuleProfileCard";

export const dynamic = "force-dynamic";



// The module overview: what it is graded on, what was announced, what files
// it has. The study guide lives on its own page — it wants the whole viewport
// for reading, and these facts want to be glanceable, and the two fought for
// the same screen when stacked.
export default async function ModulePage({ params }: PageProps<"/modules/[id]">) {
  const { id } = await params;
  const moduleId = Number(id);
  const userId = await requireUserId();
  const db = getDb();

  const mod = Number.isFinite(moduleId) ? db.select().from(modules).where(eq(modules.id, moduleId)).get() : undefined;

  if (!mod || mod.userId !== userId) {
    return (
      <AppShell>
        <p className="text-sm text-ink-3">Module not found.</p>
        <Link href="/" className="mt-2 inline-block text-sm text-accent underline">
          Back home
        </Link>
      </AppShell>
    );
  }

  const rows = withShadowFlags(db.select().from(components).where(eq(components.moduleId, mod.id)).all());
  // One feed of what the course has said: announcements, and discussions with
  // the lecturers' and TAs' replies inside them. A discussion sorts by its
  // latest reply, so a thread the lecturer just answered comes back to the top.
  const moduleItems = db.select().from(items).where(eq(items.moduleId, mod.id)).all();
  const staffReplies = new Map<string, typeof moduleItems>();
  for (const r of moduleItems) if (r.type === "staff_reply") {
    let key = "";
    try { key = (JSON.parse(r.metaJson ?? "{}") as { topicSourceId?: string }).topicSourceId ?? ""; } catch { /* skip */ }
    staffReplies.set(key, [...(staffReplies.get(key) ?? []), r]);
  }
  const activity = (i: (typeof moduleItems)[number]) =>
    i.type === "discussion" ? (parseDiscussionMeta(i.metaJson)?.lastReplyAt ?? i.sourceCreatedAt ?? i.firstSeenAt) : (i.sourceCreatedAt ?? i.firstSeenAt);
  const announcements = moduleItems
    .filter((i) => i.type === "announcement" || i.type === "discussion")
    .sort((a, b) => activity(b) - activity(a));
  const discussionCount = announcements.filter((i) => i.type === "discussion").length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const { title, termCode } = moduleDisplay(mod);
  const now = Date.now();
  const overview = getOverview(db, userId, now, loadEnv().POLL_INTERVAL_MS);
  const dueSoon = overview.todos.filter(
    (t) => t.moduleId === mod.id && t.category !== "routine" && t.dueAt !== null && t.dueAt < now + 30 * 86_400_000,
  ).length;
  const unaccountedPct = overview.modules.find((m) => m.id === mod.id)?.unaccountedPct ?? null;
  // The bar and its legend use the visible (unshadowed) rows only.
  const live = rows.filter((c) => !c.shadowed);
  const segmentColor = new Map(weightSegments(live).map((s) => [s.name, s.color]));
  const guide = getStudyGuide(db, mod.id);
  const files = sortMaterials(listModuleFiles(db, mod.id));
  const profileView = moduleProfileView(db, mod);
  const plan = weeklyPlanView(db, userId, now).plan;
  const focus = plan?.priorities.find((p) => p.module.toUpperCase() === mod.code.toUpperCase() || (profileView.code !== null && p.module.toUpperCase() === profileView.code)) ?? null;

  const announcement = (a: (typeof announcements)[number]) => {
    const text = htmlToText(a.body);
    const posted = activity(a);
    const meta = a.type === "discussion" ? parseDiscussionMeta(a.metaJson) : null;
    const staff = a.type === "discussion" ? (staffReplies.get(a.sourceId) ?? []).sort((x, y) => (y.sourceCreatedAt ?? 0) - (x.sourceCreatedAt ?? 0)) : [];
    const needsPost = meta && !meta.posted && !a.canvasDone && !meta.locked && (meta.graded || meta.requireInitialPost || a.dueAt !== null);
    return (
      <li key={a.id} id={`a-${a.id}`} className="min-w-0 scroll-mt-20 py-3 first:pt-3.5 last:pb-3.5 target:rounded-md target:bg-accent-soft target:px-2">
        <details className="group">
          {/* The first lines of the body show while closed; opening shows all. */}
          <summary className="cursor-pointer select-none list-none">
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 text-[15px] font-medium text-ink [overflow-wrap:anywhere]">
                {meta && <span className="mr-2 rounded bg-line px-1.5 py-px align-[1px] text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-2">Discussion</span>}
                {a.title}
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-ink-3">{relativeDay(posted, now)}</span>
            </div>
            {meta && (
              <p className="mt-1 flex flex-wrap gap-x-2 text-[12px] text-ink-3">
                <span>{meta.replies} {meta.replies === 1 ? "reply" : "replies"}</span>
                {meta.unread > 0 && <span className="text-accent">· {meta.unread} unread</span>}
                {staff.length > 0 && <span className="text-accent">· {staff[0]!.sender ?? "Staff"} replied {relativeDay(staff[0]!.sourceCreatedAt ?? staff[0]!.firstSeenAt, now).toLowerCase()}</span>}
                {meta.graded && <span>· graded</span>}
                {needsPost && <span className="text-warn-ink">· you haven&rsquo;t posted{a.dueAt ? ` · due ${dueLabel(a.dueAt, now)}` : ""}</span>}
                {meta.posted && <span>· you posted</span>}
              </p>
            )}
            {text && !meta && <p className="mt-1 line-clamp-2 text-sm leading-[1.55] text-ink-2 [overflow-wrap:anywhere] group-open:hidden">{text}</p>}
          </summary>
          {text && <p className="mt-2 whitespace-pre-line text-sm leading-[1.65] text-ink-2 [overflow-wrap:anywhere]">{text}</p>}
          {staff.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {staff.slice(0, 6).map((r) => (
                <li key={r.id} className="rounded-md border-l-2 border-accent bg-accent-soft/60 px-3 py-2">
                  <p className="text-[12px] font-medium text-ink-2">{r.sender ?? "Staff"} · {relativeDay(r.sourceCreatedAt ?? r.firstSeenAt, now)}</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm leading-[1.6] text-ink [overflow-wrap:anywhere]">{htmlToText(r.body)}</p>
                </li>
              ))}
            </ul>
          )}
          {meta && a.url && (
            <a href={a.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[13px] text-accent hover:underline">
              {needsPost ? "Post on Canvas →" : "Read the whole thread on Canvas →"}
            </a>
          )}
        </details>
      </li>
    );
  };

  const sectionHeading = "text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2";

  return (
    <AppShell>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <BackLink href="/">Home</BackLink>
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
          <p className="text-sm tabular-nums text-ink-2">
            {mod.code}
            {termCode && <> · Term {termCode}</>}
            {dueSoon > 0 && <> · {dueSoon} due this month</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Link
            href={`/modules/${mod.id}/guide`}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-on-accent no-underline transition-colors hover:bg-accent-strong"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            {guide ? "Open study guide" : "Study guide"}
          </Link>
          <span className="text-[13px] text-ink-3">{guide ? `generated ${shortDate(guide.generatedAt)}` : "not generated yet"}</span>
        </div>
      </header>

      <ModuleProfileCard moduleId={mod.id} {...profileView} focus={focus} hasModel={canGenerateGuides(db, userId)} />

      {/* Two short things share the first row; the long list gets the second
          row at full width. Nothing tall sits beside anything short. */}
      <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(300px,2fr)_minmax(0,3fr)] lg:items-start">
        <section className="flex flex-col gap-3.5">
          <div className="flex items-baseline justify-between">
            <h2 className={sectionHeading}>Assessment</h2>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-3">Weighting not found in Canvas or the syllabus yet — add it below.</p>
          ) : (
            <>
              <WeightBar components={live} height="h-2.5" />
              <table className="w-full border-collapse text-sm tabular-nums">
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={`border-b border-line ${c.shadowed ? "text-ink-3" : ""}`}>
                      <td className="py-2 pr-2 align-top">
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className={`h-2.5 w-2.5 rounded-[2px] ${c.shadowed ? "bg-transparent" : (segmentColor.get(c.name) ?? "bg-ink/[0.06]")}`} />
                          {c.name}
                          {c.shadowed && <span className="text-xs">(replaced)</span>}
                        </span>
                      </td>
                      <td className={`py-2 pr-3 text-right align-top ${c.shadowed ? "" : "font-medium"}`}>{c.weightPct != null ? `${c.weightPct}%` : "—"}</td>
                      <td className="py-2 text-right align-top">
                        <SourceChip source={c.source} evidence={c.evidence} name={c.name} />
                      </td>
                    </tr>
                  ))}
                  {unaccountedPct != null && unaccountedPct > 0 && (
                    <tr className="border-b border-line text-ink-2">
                      <td className="py-2 pr-2">
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-ink/[0.06]" />
                          Unaccounted
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">{unaccountedPct}%</td>
                      <td className="py-2 text-right text-[13px] text-warn-ink">Add below</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {/* Folded away: entering a weightage by hand is a once-a-semester act. */}
          <details className="mt-1">
            <summary className="cursor-pointer select-none text-[13px] font-medium text-accent hover:underline">Add component</summary>
            <div className="mt-3">
              <ManualComponentForm moduleId={mod.id} />
            </div>
          </details>
        </section>

        <section className="flex min-w-0 flex-col gap-3.5">
          <div className="flex items-baseline justify-between">
            <h2 className={sectionHeading}>Updates</h2>
            {announcements.length > 0 && <span className="text-[13px] tabular-nums text-ink-3">{plural(announcements.length - discussionCount, "announcement")}{discussionCount ? ` · ${plural(discussionCount, "discussion")}` : ""}</span>}
          </div>
          {announcements.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing posted yet.</p>
          ) : (
            /* A bounded box that scrolls inside itself: the page keeps its
               shape however many announcements a module has accumulated, and
               the ones that matter — the newest — are the ones in view. */
            <div className="max-h-[32rem] overflow-y-auto overscroll-contain rounded-[10px] border border-line bg-panel px-4 [scrollbar-gutter:stable]">
              <ul className="divide-y divide-line">{announcements.map(announcement)}</ul>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3.5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className={sectionHeading}>Materials</h2>
            {files.length > 0 && <span className="text-[13px] text-ink-3">Opens here</span>}
          </div>
          <Materials files={files} moduleId={mod.id} />
        </section>
      </div>
    </AppShell>
  );
}
