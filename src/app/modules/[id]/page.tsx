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
import { ModuleTabs } from "@/components/module/ModuleTabs";
import { AskButton } from "@/components/module/AskButton";
import { tasksView } from "@/server/tasks";
import { guideStatus } from "@/server/guide-status";
import { syncedLabel } from "@/lib/format-date";

export const dynamic = "force-dynamic";



// The module page opens on what matters now: four glance tiles (next due,
// weighting, the guide, what's new), then tabs. Overview holds what is coming
// up, the latest update and the weighting; Updates, Materials and About (the
// module profile) wait behind their tabs. The guide has its own page.
// A Canvas course says so, with its sync time and a link back; a module the
// student made themselves is marked as theirs and has no Canvas updates.
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
      <li key={a.id} id={`a-${a.id}`} className="min-w-0 scroll-mt-20 py-3 first:pt-3.5 last:pb-3.5 target:rounded-md target:bg-sunken target:px-2">
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
                {meta.unread > 0 && <span className="text-ink-2">· {meta.unread} unread</span>}
                {staff.length > 0 && <span className="text-ink-2">· {staff[0]!.sender ?? "Staff"} replied {relativeDay(staff[0]!.sourceCreatedAt ?? staff[0]!.firstSeenAt, now).toLowerCase()}</span>}
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
                <li key={r.id} className="border-l-2 border-line-2 py-0.5 pl-3">
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

  const env = loadEnv();
  const isCanvas = mod.canvasCourseId > 0;
  const lastSync = overview.syncStatus.find((x) => x.source === "canvas")?.lastOkAt ?? null;
  const tv = tasksView(db, userId, now);
  const upcoming = [...tv.soon, ...tv.later].filter((t) => t.moduleId === mod.id)
    .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER));
  const next = upcoming.find((t) => t.dueAt !== null && t.dueAt >= now) ?? null;
  const gs = guideStatus(db, mod.id);
  const weekAgo = now - 7 * 86_400_000;
  const newThisWeek = announcements.filter((a) => activity(a) >= weekAgo).length;
  const days = (ms: number) => Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);

  const tile = "flex min-h-[112px] flex-col rounded-[10px] border border-line bg-panel px-4 py-3.5 no-underline transition-colors hover:border-line-2";
  const tileLabel = "text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-2";
  const big = "mt-1.5 text-[24px] font-semibold leading-tight tracking-[-0.01em] tabular-nums text-ink";
  const small = "mt-auto truncate pt-1 text-[13px] text-ink-2";

  const tiles = (
    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      <Link href={next ? `/tasks#task-${next.id}` : "/tasks"} className={tile}>
        <span className={tileLabel}>Next due</span>
        {next ? (
          <>
            <span className={big}>{days(next.dueAt!) <= 0 ? "Today" : days(next.dueAt!) === 1 ? "Tomorrow" : `${days(next.dueAt!)} days`}</span>
            <span className={small} title={next.title}>{next.title}{next.weightPct != null ? ` · ${next.weightPct}%` : ""}</span>
          </>
        ) : <span className={`${small} mt-2`}>Nothing dated coming up</span>}
      </Link>
      <a href="#assessment" className={tile}>
        <span className={tileLabel}>Graded on</span>
        {live.length ? (
          <>
            <div className="mt-3"><WeightBar components={live} height="h-2" /></div>
            <span className={small} title={live.map((c) => `${c.name} ${c.weightPct ?? "?"}%`).join(" · ")}>{live.map((c) => `${c.name} ${c.weightPct ?? "?"}`).join(" · ")}</span>
          </>
        ) : <span className={`${small} mt-2`}>Not found yet · add it</span>}
      </a>
      <Link href={`/modules/${mod.id}/guide`} className={tile}>
        <span className={tileLabel}>Study guide</span>
        {gs.total > 0 ? (
          <>
            <span className={big}>{gs.ready}<span className="text-[15px] font-normal text-ink-3"> / {gs.total}</span></span>
            <span className={small}>{gs.writing ? `Writing “${gs.writing.title}”` : guide ? `chapters · updated ${shortDate(guide.generatedAt)}` : "chapters"}</span>
          </>
        ) : guide ? (
          <><span className={big}>Ready</span><span className={small}>updated {shortDate(guide.generatedAt)}</span></>
        ) : <span className={`${small} mt-2`}>Writes itself as slides arrive</span>}
      </Link>
      {isCanvas ? (
        <a href="#updates" className={tile}>
          <span className={tileLabel}>Updates</span>
          <span className={big}>{newThisWeek}</span>
          <span className={small}>new this week{announcements[0] ? ` · latest ${relativeDay(activity(announcements[0]), now)}` : ""}</span>
        </a>
      ) : (
        <a href="#materials" className={tile}>
          <span className={tileLabel}>Material</span>
          <span className={big}>{files.length}</span>
          <span className={small}>{files.length === 1 ? "file" : "files"}</span>
        </a>
      )}
    </div>
  );

  const comingUp = (
    <section className="rounded-[10px] border border-line bg-panel px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className={sectionHeading}>Coming up</h2>
        <Link href="/tasks" className="text-[13px] text-ink-3 hover:text-accent">All tasks →</Link>
      </div>
      {upcoming.length === 0 ? (
        <p className="pt-3 text-sm text-ink-3">Nothing planned for this module yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {upcoming.slice(0, 5).map((t) => (
            <li key={t.id}>
              <Link href={`/tasks#task-${t.id}`} className="flex items-baseline justify-between gap-4 py-2.5 no-underline">
                <span className="min-w-0 truncate text-[14px] text-ink">
                  {t.title}
                  {t.weightPct != null && <span className="text-ink-3"> · {t.weightPct}%</span>}
                  {t.anticipated && <span className="text-ink-3"> (expected)</span>}
                </span>
                <span className={`shrink-0 text-[13px] tabular-nums ${t.overdue ? "text-danger" : "text-ink-2"}`}>{t.dueText}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const latest = isCanvas && (
    <section className="rounded-[10px] border border-line bg-panel px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className={sectionHeading}>Latest updates</h2>
        {announcements.length > 2 && <a href="#updates" className="text-[13px] text-ink-3 hover:text-accent">All {announcements.length} →</a>}
      </div>
      {announcements.length === 0 ? <p className="pt-3 text-sm text-ink-3">Nothing posted yet.</p> : (
        <ul className="mt-1 divide-y divide-line">
          {announcements.slice(0, 2).map((a) => (
            <li key={a.id} className="py-2.5">
              <a href={`#a-${a.id}`} className="block no-underline">
                <span className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 truncate text-[14px] font-medium text-ink">{a.title}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-ink-3">{relativeDay(activity(a), now)}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 text-[13px] leading-[1.5] text-ink-2">{htmlToText(a.body)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const assessment = (
    <section id="assessment" className="scroll-mt-20 rounded-[10px] border border-line bg-panel px-4 py-3.5">
      <h2 className={sectionHeading}>Assessment</h2>
      <div className="mt-3 flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-3">{isCanvas ? "Weighting not found in Canvas or the syllabus yet. Add it below." : "Add how this module is graded, if it is."}</p>
        ) : (
          <>
            <WeightBar components={live} height="h-2.5" />
            <table className="w-full border-collapse text-sm tabular-nums">
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={`border-b border-line last:border-0 ${c.shadowed ? "text-ink-3" : ""}`}>
                    <td className="py-2 pr-2 align-top">
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className={`h-2.5 w-2.5 rounded-[2px] ${c.shadowed ? "bg-transparent" : (segmentColor.get(c.name) ?? "bg-ink/[0.06]")}`} />
                        {c.name}
                        {c.shadowed && <span className="text-xs">(replaced)</span>}
                      </span>
                    </td>
                    <td className={`w-px whitespace-nowrap py-2 pr-3 text-right align-top ${c.shadowed ? "" : "font-medium"}`}>{c.weightPct != null ? `${c.weightPct}%` : "—"}</td>
                    <td className="w-px whitespace-nowrap py-2 text-right align-top">
                      <SourceChip source={c.source} evidence={c.evidence} name={c.name} />
                    </td>
                  </tr>
                ))}
                {unaccountedPct != null && unaccountedPct > 0 && (
                  <tr className="text-ink-2">
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
        {/* Folded away: entering a weighting by hand is a once-a-semester act. */}
        <details>
          <summary className="cursor-pointer select-none text-[13px] font-medium text-accent hover:underline">Add component</summary>
          <div className="mt-3"><ManualComponentForm moduleId={mod.id} /></div>
        </details>
      </div>
    </section>
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    ...(isCanvas ? [{ id: "updates", label: "Updates", count: announcements.length }] : []),
    { id: "materials", label: "Materials", count: files.length },
    { id: "about", label: "About" },
  ];
  const panels = {
    overview: (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">{comingUp}{latest}</div>
        {assessment}
      </div>
    ),
    updates: (
      <section className="flex min-w-0 flex-col gap-3">
        <p className="text-[13px] tabular-nums text-ink-3">{plural(announcements.length - discussionCount, "announcement")}{discussionCount ? ` · ${plural(discussionCount, "discussion")}` : ""} · newest first</p>
        {announcements.length === 0 ? <p className="text-sm text-ink-3">Nothing posted yet.</p> : (
          <div className="rounded-[10px] border border-line bg-panel px-4">
            <ul className="divide-y divide-line">{announcements.map(announcement)}</ul>
          </div>
        )}
      </section>
    ),
    materials: <Materials files={files} moduleId={mod.id} />,
    about: <ModuleProfileCard moduleId={mod.id} {...profileView} focus={focus} hasModel={canGenerateGuides(db, userId)} />,
  };

  return (
    <AppShell>
      <header className="flex flex-col gap-3">
        <BackLink href="/">Home</BackLink>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] tabular-nums text-ink-2">
              <span className="font-semibold text-ink">{mod.code}</span>
              {termCode && <span>· Term {termCode}</span>}
              {isCanvas ? (
                <>
                  <span className="rounded-full bg-[color-mix(in_oklab,#c0392b_10%,transparent)] px-2 py-px text-[11.5px] font-semibold text-[#b03a2e] dark:text-[#f19a8f]">Canvas</span>
                  {lastSync && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />synced {syncedLabel(lastSync, now)}</span>}
                  <a href={`${env.CANVAS_BASE_URL.replace(/\/$/, "")}/courses/${mod.canvasCourseId}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open in Canvas ↗</a>
                </>
              ) : (
                <span className="rounded-full border border-dashed border-accent/50 bg-accent-soft px-2 py-px text-[11.5px] font-semibold text-accent">Your module</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AskButton />
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
          </div>
        </div>
      </header>

      {tiles}
      <ModuleTabs tabs={tabs} panels={panels} />
    </AppShell>
  );
}
