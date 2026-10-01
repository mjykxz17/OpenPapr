import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { requireUserId } from "@/server/session";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { modules } from "@/db/schema";
import { getStudyGuide, listModuleFiles } from "@/db/repo";
import { AppShell } from "@/components/AppShell";
import { StudyGuide } from "@/components/StudyGuide";
import { GuideStatus } from "@/components/GuideStatus";
import { guideStatus } from "@/server/guide-status";
import { moduleDisplay } from "@/lib/module-display";
import { canGenerateGuides } from "@/server/llm-access";
import { deckStem } from "@/server/deck";

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
  // Every PDF the module has, as deck stems: the panel's "open another" list.
  const decks = [...new Set(listModuleFiles(db, mod.id).filter((f) => /\.pdf$/i.test(f.displayName)).map((f) => deckStem(f.displayName)))].sort();

  return (
    <AppShell wide>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <BackLink href={`/modules/${mod.id}`}>{mod.code} overview</BackLink>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <h1 className="text-base font-semibold text-ink">
            {title} <span className="font-normal text-ink-2">· Study guide</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <GuideStatus moduleId={mod.id} initial={guideStatus(db, mod.id)} canGenerate={canGenerateGuides(db, userId)} />
        </div>
      </header>

      {guide ? (
        <section id="study" className="mt-7">
          <StudyGuide markdown={guide.markdown} moduleId={mod.id} decks={decks} />
        </section>
      ) : (
        <section className="mt-10">
          <p className="max-w-prose text-sm text-ink-2">
            No guide yet. It writes itself from this module&apos;s lecture slides: each topic appears here as soon as it is written, newest slides first.
          </p>
        </section>
      )}
    </AppShell>
  );
}
