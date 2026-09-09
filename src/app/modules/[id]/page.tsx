import Link from "next/link";
import { requireUserId } from "@/server/session";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { components, items, modules } from "@/db/schema";
import { getStudyGuide, listModuleFiles } from "@/db/repo";
import { AppShell } from "@/components/AppShell";
import { ManualComponentForm } from "@/components/ManualComponentForm";
import { Materials } from "@/components/Materials";
import { ModuleContext } from "@/components/ModuleContext";
import { loadModuleContext } from "@/enrich/module-context";
import { htmlToText } from "@/lib/html-text";
import { withShadowFlags, SOURCE_LABEL } from "@/lib/component-display";
import { sortMaterials } from "@/lib/materials";
import { moduleDisplay } from "@/lib/module-display";
import { loadEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const RECENT_ANNOUNCEMENTS = 6;

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

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
  const recent = announcements.slice(0, RECENT_ANNOUNCEMENTS);
  const older = announcements.slice(RECENT_ANNOUNCEMENTS);
  const evidenceRows = rows.filter((c) => c.source === "llm_syllabus" && c.evidence);
  const { title, termCode } = moduleDisplay(mod);
  const guide = getStudyGuide(db, mod.id);
  const files = sortMaterials(listModuleFiles(db, mod.id));
  const context = loadModuleContext(db, mod.id)!;

  const announcement = (a: (typeof announcements)[number]) => {
    const text = htmlToText(a.body);
    const posted = a.sourceCreatedAt ?? a.firstSeenAt;
    return (
      <li key={a.id} className="py-3">
        <details className="group">
          {/* Date leads in a fixed column so titles align down the list. The
              first lines of the body show while closed; opening shows all. */}
          <summary className="cursor-pointer select-none list-none">
            <div className="flex items-baseline gap-3">
              <span className="w-[52px] shrink-0 text-xs tabular-nums text-ink-3">{shortDate(posted)}</span>
              <span className="text-sm text-ink group-open:font-medium">{a.title}</span>
            </div>
            {text && <p className="mt-1 line-clamp-2 pl-[64px] text-sm leading-[1.6] text-ink-3 group-open:hidden">{text}</p>}
          </summary>
          {text && <p className="mt-2 whitespace-pre-line pl-[64px] text-sm leading-[1.7] text-ink-2">{text}</p>}
        </details>
      </li>
    );
  };

  return (
    <AppShell>
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-medium text-ink">{mod.code}</h1>
          <p className="text-lg font-normal text-ink-2">{title}</p>
          {termCode && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[11px] tabular-nums text-ink-3">{termCode}</span>
          )}
        </div>
        <Link href={`/modules/${mod.id}/guide`} className="group text-sm text-ink hover:text-accent">
          Study guide{" "}
          <span className="ml-2 text-xs text-ink-3">{guide ? `generated ${shortDate(guide.generatedAt)}` : "not generated yet"}</span>{" "}
          <span className="ml-1 text-ink-3 transition-transform group-hover:translate-x-0.5">→</span>
        </Link>
      </header>

      {/* Two short things share the first row; the long list gets the second
          row at full width. Nothing tall sits beside anything short. */}
      <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(300px,2fr)_3fr] lg:items-start">
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Assessment</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-3">weightage unknown — add manually</p>
          ) : (
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                  <th className="py-1.5 pr-2 font-medium">Component</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Weight</th>
                  <th className="py-1.5 text-right font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={`border-b border-line ${c.shadowed ? "opacity-40" : ""}`}>
                    <td className="py-1.5 pr-2 text-ink">
                      {c.name}
                      {c.shadowed && <span className="ml-1 text-xs normal-case text-ink-3">(shadowed)</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{c.weightPct != null ? `${c.weightPct}%` : "—"}</td>
                    <td
                      className={`py-1.5 text-right text-xs ${c.source === "llm_syllabus" ? "text-warn" : "text-ink-3"}`}
                      title={c.source === "llm_syllabus" ? (c.evidence ?? undefined) : undefined}
                    >
                      {SOURCE_LABEL[c.source]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-4 space-y-3">
            {evidenceRows.length > 0 && (
              <details>
                <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-ink-3 hover:text-ink-2">
                  Evidence ({evidenceRows.length})
                </summary>
                <ul className="mt-3 space-y-3">
                  {evidenceRows.map((c) => (
                    <li key={c.id} className="border border-line p-3 text-sm">
                      <div className="mb-1 font-medium text-ink">{c.name}</div>
                      <blockquote className="text-ink-2">&ldquo;{c.evidence}&rdquo;</blockquote>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {/* Folded away: entering a weightage by hand is a once-a-semester act. */}
            <details>
              <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-ink-3 hover:text-ink-2">
                Add component
              </summary>
              <div className="mt-3">
                <ManualComponentForm moduleId={mod.id} />
              </div>
            </details>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Announcements</h2>
          {announcements.length === 0 ? (
            <p className="text-sm text-ink-3">No announcements yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-line">{recent.map(announcement)}</ul>
              {older.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-ink-3 hover:text-ink-2">
                    Older announcements ({older.length})
                  </summary>
                  <ul className="mt-1 divide-y divide-line">{older.map(announcement)}</ul>
                </details>
              )}
            </>
          )}
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Materials</h2>
          <Materials files={files} canvasBaseUrl={loadEnv().CANVAS_BASE_URL} canvasCourseId={mod.canvasCourseId} />
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Module context</h2>
          <ModuleContext
            moduleId={mod.id}
            hasDecks={context.input.decks.length > 0}
            context={context.context}
            profile={context.input.profile}
            profiledAt={context.profiledAt}
            profileSource={context.profileSource}
            notes={context.input.notes}
            notesUpdatedAt={context.notesUpdatedAt}
          />
        </section>
      </div>
    </AppShell>
  );
}
