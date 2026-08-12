import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { components, items, modules } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { ManualComponentForm } from "@/components/ManualComponentForm";
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
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Evidence</h2>
          <ul className="space-y-3">
            {evidenceRows.map((c) => (
              <li key={c.id} className="border border-line p-3 text-sm">
                <div className="mb-1 font-medium text-ink">{c.name}</div>
                <blockquote className="text-ink-2">&ldquo;{c.evidence}&rdquo;</blockquote>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Announcements</h2>
        {announcements.length === 0 ? (
          <p className="text-sm text-ink-3">No announcements yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {announcements.map((a) => (
              <li key={a.id} className="py-3">
                <div className="text-sm text-ink">{a.title}</div>
                {a.body && <p className="mt-1 text-xs text-ink-3">{a.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-3">Add manual component</h2>
        <ManualComponentForm moduleId={mod.id} />
      </section>
    </AppShell>
  );
}
