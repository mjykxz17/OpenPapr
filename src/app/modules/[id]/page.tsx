import Link from "next/link";
import { requireUserId } from "@/server/session";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { components, items, modules } from "@/db/schema";
import { getStudyGuide, listModuleFiles } from "@/db/repo";
import { AppShell } from "@/components/AppShell";
import { ManualComponentForm } from "@/components/ManualComponentForm";
import { Materials } from "@/components/Materials";
import { htmlToText } from "@/lib/html-text";
import { withShadowFlags } from "@/lib/component-display";
import { SourceChip } from "@/components/SourceChip";
import { WeightBar, weightSegments } from "@/components/WeightBar";
import { relativeDay, shortDate } from "@/lib/format-date";
import { sortMaterials } from "@/lib/materials";
import { getOverview } from "@/server/overview";
import { moduleDisplay } from "@/lib/module-display";
import { loadEnv } from "@/lib/env";

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
  const announcements = db
    .select()
    .from(items)
    .where(eq(items.moduleId, mod.id))
    .all()
    .filter((i) => i.type === "announcement")
    .sort((a, b) => (b.sourceCreatedAt ?? b.firstSeenAt) - (a.sourceCreatedAt ?? a.firstSeenAt));
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

  const announcement = (a: (typeof announcements)[number]) => {
    const text = htmlToText(a.body);
    const posted = a.sourceCreatedAt ?? a.firstSeenAt;
    return (
      <li key={a.id} className="min-w-0 py-3 first:pt-3.5 last:pb-3.5">
        <details className="group">
          {/* The first lines of the body show while closed; opening shows all. */}
          <summary className="cursor-pointer select-none list-none">
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 text-[15px] font-medium text-ink [overflow-wrap:anywhere]">{a.title}</span>
              <span className="shrink-0 text-[13px] tabular-nums text-ink-3">{relativeDay(posted, now)}</span>
            </div>
            {text && <p className="mt-1 line-clamp-2 text-sm leading-[1.55] text-ink-2 [overflow-wrap:anywhere] group-open:hidden">{text}</p>}
          </summary>
          {text && <p className="mt-2 whitespace-pre-line text-sm leading-[1.65] text-ink-2 [overflow-wrap:anywhere]">{text}</p>}
        </details>
      </li>
    );
  };

  const sectionHeading = "text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2";

  return (
    <AppShell>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <Link href="/" className="text-[13px] text-ink-2 hover:text-accent">
            ← Home
          </Link>
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
            <h2 className={sectionHeading}>Announcements</h2>
            {announcements.length > 0 && <span className="text-[13px] tabular-nums text-ink-3">{announcements.length} total</span>}
          </div>
          {announcements.length === 0 ? (
            <p className="text-sm text-ink-3">No announcements yet.</p>
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
            {files.length > 0 && <span className="text-[13px] text-ink-3">Opens on Canvas</span>}
          </div>
          <Materials files={files} canvasBaseUrl={loadEnv().CANVAS_BASE_URL} canvasCourseId={mod.canvasCourseId} />
        </section>
      </div>
    </AppShell>
  );
}
