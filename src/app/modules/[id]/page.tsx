import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { components, items, modules } from "@/db/schema";
import { getStudyGuide } from "@/db/repo";
import { AppShell } from "@/components/AppShell";
import { ManualComponentForm } from "@/components/ManualComponentForm";
import { StudyGuide } from "@/components/StudyGuide";
import { htmlToText } from "@/lib/html-text";
import { withShadowFlags, SOURCE_LABEL } from "@/lib/component-display";

export const dynamic = "force-dynamic";

export default async function ModulePage({ params }: PageProps<"/modules/[id]">) {
  const { id } = await params;
  const moduleId = Number(id);
  const userId = 1;
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
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  const evidenceRows = rows.filter((c) => c.source === "llm_syllabus" && c.evidence);
  const guide = getStudyGuide(db, mod.id);

  return (
    <AppShell>
      <h1 className="text-lg font-medium text-ink">
        {mod.code} <span className="font-normal text-ink-2">— {mod.name}</span>
      </h1>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Components (all sources)</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-3">weightage unknown — add manually</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm tabular-nums">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                  <th className="py-2 pr-2 font-medium">Component</th>
                  <th className="py-2 pr-2 font-medium">Weight</th>
                  <th className="py-2 pr-2 font-medium">Score</th>
                  <th className="py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={`border-b border-line ${c.shadowed ? "opacity-40" : ""}`}>
                    <td className="py-2 pr-2 text-ink">
                      {c.name}
                      {c.shadowed && <span className="ml-2 text-xs normal-case text-ink-3">(shadowed)</span>}
                    </td>
                    <td className="py-2 pr-2">{c.weightPct != null ? `${c.weightPct}%` : "—"}</td>
                    <td className="py-2 pr-2">{c.scorePct != null ? `${c.scorePct}%` : "—"}</td>
                    <td
                      className={c.source === "llm_syllabus" ? "py-2 text-warn" : "py-2 text-ink-3"}
                      title={c.source === "llm_syllabus" ? (c.evidence ?? undefined) : undefined}
                    >
                      {SOURCE_LABEL[c.source]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {evidenceRows.length > 0 && (
        <details className="mt-8">
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

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Announcements</h2>
        {announcements.length === 0 ? (
          <p className="text-sm text-ink-3">No announcements yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {announcements.map((a) => {
              const text = htmlToText(a.body);
              const posted = a.sourceCreatedAt ?? a.firstSeenAt;
              return (
                <li key={a.id} className="py-3">
                  <details className="group">
                    <summary className="flex cursor-pointer select-none items-baseline justify-between gap-3">
                      <span className="text-sm text-ink group-open:font-medium">{a.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-3">
                        {new Date(posted).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    </summary>
                    {text && <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-ink-2">{text}</p>}
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {guide && (
        <section id="study" className="mt-12 scroll-mt-6 border-t border-line pt-8">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-3">Study guide</h2>
            <span className="text-xs text-ink-3">
              {guide.sourceNote ? `${guide.sourceNote} · ` : ""}
              generated {new Date(guide.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          </div>
          <StudyGuide markdown={guide.markdown} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Add manual component</h2>
        <ManualComponentForm moduleId={mod.id} />
      </section>
    </AppShell>
  );
}
