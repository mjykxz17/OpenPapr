import Link from "next/link";
import { requireUserId } from "@/server/session";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { components, items, modules } from "@/db/schema";
import { getStudyGuide, listModuleFiles } from "@/db/repo";
import { AppShell } from "@/components/AppShell";
import { ManualComponentForm } from "@/components/ManualComponentForm";
import { StudyGuide } from "@/components/StudyGuide";
import { GenerateGuideButton } from "@/components/GenerateGuideButton";
import { htmlToText } from "@/lib/html-text";
import { withShadowFlags, SOURCE_LABEL } from "@/lib/component-display";
import { groupMaterials } from "@/lib/materials";
import { loadEnv } from "@/lib/env";
import { Materials } from "@/components/Materials";

export const dynamic = "force-dynamic";

export default async function ModulePage({ params }: PageProps<"/modules/[id]">) {
  const { id } = await params;
  const moduleId = Number(id);
  const userId = await requireUserId();
  const db = getDb();

  const mod = Number.isFinite(moduleId) ? db.select().from(modules).where(eq(modules.id, moduleId)).get() : undefined;

  if (!mod || mod.userId !== userId) {
    return (
      <AppShell wide>
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
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  const evidenceRows = rows.filter((c) => c.source === "llm_syllabus" && c.evidence);
  // Canvas names courses "CS4238 Computer Security Practice [2610]" — the code
  // and the term code are already shown separately, so strip both rather than
  // printing the module code twice in one line.
  const termCode = mod.name.match(/\[(\d+)\]\s*$/)?.[1] ?? null;
  const displayName = mod.name
    .replace(new RegExp(`^${mod.code}\\b[\\s:—-]*`), "")
    .replace(/\s*\[\d+\]\s*$/, "")
    .trim() || mod.name;
  const guide = getStudyGuide(db, mod.id);
  const materials = groupMaterials(listModuleFiles(db, mod.id));

  return (
    <AppShell wide>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-medium text-ink">{mod.code}</h1>
        <p className="text-lg font-normal text-ink-2">{displayName}</p>
        {termCode && (
          <span className="rounded border border-line px-1.5 py-0.5 text-[11px] tabular-nums text-ink-3">{termCode}</span>
        )}
      </header>

      {/* Capped independently of the page: the guide below wants the whole
          screen, but these two columns are a pair and stretching them across
          1800px flings each announcement's date a thousand pixels from its
          title. */}
      <div className="mt-8 grid max-w-[1180px] grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(320px,400px)_1fr] lg:items-start">
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Components (all sources)</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-ink-3">weightage unknown — add manually</p>
            ) : (
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                    <th className="py-1.5 pr-2 font-medium">Component</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Weight</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Score</th>
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
                      <td className="py-1.5 pr-2 text-right">{c.scorePct != null ? `${c.scorePct}%` : "—"}</td>
                      <td
                        className={`py-1.5 text-right ${c.source === "llm_syllabus" ? "text-warn" : "text-ink-3"}`}
                        title={c.source === "llm_syllabus" ? (c.evidence ?? undefined) : undefined}
                      >
                        {SOURCE_LABEL[c.source]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

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

          {/* Folded away: entering a weightage by hand is a once-a-semester
              act, and an always-open form of three inputs sat between the data
              and the reading. */}
          <details>
            <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-ink-3 hover:text-ink-2">
              Add component
            </summary>
            <div className="mt-3">
              <ManualComponentForm moduleId={mod.id} />
            </div>
          </details>

          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Materials</h2>
            <Materials groups={materials} canvasBaseUrl={loadEnv().CANVAS_BASE_URL} canvasCourseId={mod.canvasCourseId} />
          </section>
        </div>

        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Announcements</h2>
          {announcements.length === 0 ? (
            <p className="text-sm text-ink-3">No announcements yet.</p>
          ) : (
            <ul className="max-h-[560px] divide-y divide-line overflow-y-auto pr-2">
              {announcements.map((a) => {
                const text = htmlToText(a.body);
                const posted = a.sourceCreatedAt ?? a.firstSeenAt;
                return (
                  <li key={a.id} className="py-3">
                    <details className="group">
                      {/* Date leads in a fixed column rather than being pushed
                          to the far edge: justify-between put 575px between a
                          short title and its date, so the two stopped reading
                          as one row. Leading dates also align down the list. */}
                      <summary className="flex cursor-pointer select-none items-baseline gap-3">
                        <span className="w-[52px] shrink-0 text-xs tabular-nums text-ink-3">
                          {new Date(posted).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                        <span className="text-sm text-ink group-open:font-medium">{a.title}</span>
                      </summary>
                      {text && <p className="mt-2 pl-[64px] whitespace-pre-line text-sm leading-[1.7] text-ink-2">{text}</p>}
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {!guide && (
        <section className="mt-14 border-t border-line pt-10">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Study guide</h2>
          <p className="mb-4 max-w-prose text-sm text-ink-3">
            No guide yet. One can be written from this module&apos;s own lecture slides — it takes a few minutes per deck.
          </p>
          <GenerateGuideButton moduleId={mod.id} hasGuide={false} />
        </section>
      )}

      {guide && (
        <section id="study" className="mt-14 scroll-mt-6 border-t border-line pt-10">
          {/* sourceNote is dropped here on purpose: it repeats the guide's own
              opening paragraph almost word for word, and the two sat a
              thousand pixels apart on the same line. */}
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-3">
              Study guide
              <span className="ml-2 font-normal normal-case tracking-normal text-ink-3/70">
                generated {new Date(guide.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </span>
            </h2>
            <GenerateGuideButton moduleId={mod.id} hasGuide />
          </div>
          <StudyGuide markdown={guide.markdown} moduleId={mod.id} />
        </section>
      )}
    </AppShell>
  );
}
