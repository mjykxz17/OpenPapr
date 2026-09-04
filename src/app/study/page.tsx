import Link from "next/link";
import { requireUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { listStudyGuides } from "@/db/repo";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function StudyIndex() {
  const userId = await requireUserId();
  const guides = listStudyGuides(getDb(), userId);

  return (
    <AppShell>
      <header className="mb-8 border-b border-line pb-4">
        <h1 className="text-lg font-medium text-ink">Study guides</h1>
        <p className="mt-1 text-xs text-ink-3">Pre-study notes generated from each module&rsquo;s Canvas slides.</p>
      </header>

      {guides.length === 0 ? (
        <p className="text-sm text-ink-3">No study guides yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {guides.map((g) => (
            <li key={g.moduleId}>
              <Link
                href={`/modules/${g.moduleId}/guide`}
                className="group flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4"
              >
                <span className="text-sm font-medium text-ink group-hover:text-accent">
                  {g.code} <span className="font-normal text-ink-2">{g.name}</span>
                </span>
                <span className="text-xs text-ink-3">{g.sourceNote ?? ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
