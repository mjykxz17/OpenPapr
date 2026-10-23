import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { modules } from "@/db/schema";
import { getUser, listStudyGuides } from "@/db/repo";
import { AppShell } from "@/components/AppShell";
import { shortModuleName } from "@/lib/module-name";
import { shortDate } from "@/lib/format-date";
import { guideStatus } from "@/server/guide-status";
import { canGenerateGuides } from "@/server/llm-access";
import { studyRows } from "./rows";

export const dynamic = "force-dynamic";

// Every module and its guide: the ones with a guide open it; the rest say
// where theirs stands (being written, waiting for slides, needs AI).
export default async function StudyIndex() {
  const userId = await requireUserId();
  const db = getDb();
  const guides = listStudyGuides(db, userId);
  // A past term's module (inactive) counts as hidden: listed only if it has a guide.
  const mods = db.select().from(modules).where(eq(modules.userId, userId)).all()
    .map((m) => ({ id: m.id, code: m.code, name: m.name, hidden: m.hidden || !m.active, position: m.position }));
  const rows = studyRows(mods, guides, (id) => {
    const s = guideStatus(db, id);
    return { writing: s.writing?.title ?? null, ready: s.ready, total: s.total };
  }, canGenerateGuides(db, userId), Boolean(getUser(db, userId)?.isDemo));

  return (
    <AppShell>
      <header className="mb-8 border-b border-line pb-4">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink">Study guides</h1>
        <p className="mt-1 text-sm text-ink-2">Written from each module&rsquo;s newest lecture slides, and kept up to date on their own.</p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">No modules yet. Once Canvas is linked, each module&rsquo;s guide shows up here.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const g = r.guide;
            const note = g ? (g.sourceNote?.startsWith("auto") ? `${g.sourceNote.replace(/^auto · /, "")} · updated ${shortDate(g.generatedAt)}` : (g.sourceNote ?? "")) : r.note;
            return (
              <li key={r.moduleId}>
                <Link
                  href={g ? `/modules/${r.moduleId}/guide` : `/modules/${r.moduleId}`}
                  className="group flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4"
                >
                  <span className={`text-[15px] font-medium group-hover:text-accent ${g ? "text-ink" : "text-ink-2"}`}>
                    {r.title ?? shortModuleName(r.code, r.name)} <span className="font-normal text-ink-2">· {r.code}</span>
                  </span>
                  <span className="text-[13px] text-ink-3">{note}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
