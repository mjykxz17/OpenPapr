import Link from "next/link";
import { requireUserId } from "@/server/session";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { modules } from "@/db/schema";
import { getStudyGuide } from "@/db/repo";
import { AppShell } from "@/components/AppShell";
import { StudyGuide } from "@/components/StudyGuide";
import { GenerateGuideButton } from "@/components/GenerateGuideButton";
import { moduleDisplay } from "@/lib/module-display";
import { shortDate } from "@/lib/format-date";

export const dynamic = "force-dynamic";

// The study guide alone, on the wide shell: chapters on the left, reading
// column in the middle, section outline on the right. Everything else about
// the module is one link back.
export default async function GuidePage({ params }: PageProps<"/modules/[id]/guide">) {
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

  const { title } = moduleDisplay(mod);
  const guide = getStudyGuide(db, mod.id);

  return (
    <AppShell wide>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href={`/modules/${mod.id}`} className="text-[13px] text-ink-2 hover:text-accent">
            ← {mod.code} overview
          </Link>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <h1 className="text-base font-semibold text-ink">
            {title} <span className="font-normal text-ink-2">· Study guide</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {guide && <span className="text-[13px] text-ink-3">generated {shortDate(guide.generatedAt)}</span>}
          <GenerateGuideButton moduleId={mod.id} hasGuide={Boolean(guide)} />
        </div>
      </header>

      {guide ? (
        <section id="study" className="mt-7">
          <StudyGuide markdown={guide.markdown} moduleId={mod.id} />
        </section>
      ) : (
        <section className="mt-10">
          <p className="max-w-prose text-sm text-ink-2">
            No guide yet. One can be written from this module&apos;s own lecture slides — it takes a few minutes per deck.
          </p>
        </section>
      )}
    </AppShell>
  );
}
