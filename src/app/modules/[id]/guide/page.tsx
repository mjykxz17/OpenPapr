import Link from "next/link";
import { requireUserId } from "@/server/session";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { modules } from "@/db/schema";
import { getStudyGuide, listModuleFiles } from "@/db/repo";
import { deckStem } from "@/server/deck";
import { AppShell } from "@/components/AppShell";
import { StudyGuide } from "@/components/StudyGuide";
import { GenerateGuideButton, type GuideCandidate } from "@/components/GenerateGuideButton";
import { selectGuideDecks } from "@/enrich/study-guide";
import { splitChapters } from "@/lib/guide-chapters";
import { fileExt, fileKind } from "@/lib/file-kind";
import { categoryLabel, sortMaterials } from "@/lib/materials";
import { dedupeMaterials } from "@/components/Materials";
import { moduleDisplay } from "@/lib/module-display";
import { shortDate } from "@/lib/format-date";
import { canGenerateGuides } from "@/server/llm-access";

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
  // What the guide can be written from: every PDF and office file, lecture
  // decks ticked, and a mark on those that already have a chapter.
  const moduleFiles = listModuleFiles(db, mod.id);
  // Lecture decks as the automatic pick chooses them, plus PowerPoint decks
  // that have no PDF twin — those are converted when the guide is written.
  const suggested = new Set(selectGuideDecks(moduleFiles).map((f) => f.id));
  const pdfStems = new Set(moduleFiles.filter((f) => fileKind(f.displayName) === "pdf").map((f) => deckStem(f.displayName).toLowerCase()));
  for (const f of moduleFiles) {
    if (f.category === "slides" && fileKind(f.displayName) === "office" && !pdfStems.has(deckStem(f.displayName).toLowerCase())) suggested.add(f.id);
  }
  const chaptered = new Set(guide ? splitChapters(guide.markdown).chapters.map((c) => c.deck?.toLowerCase()) : []);
  const mb = (b: number | null) => (b == null ? "" : b >= 1_000_000 ? `${(b / 1_000_000).toFixed(b >= 10_000_000 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);
  const candidates: GuideCandidate[] = sortMaterials(dedupeMaterials(moduleFiles))
    .filter((f) => ["pdf", "office"].includes(fileKind(f.displayName)))
    .map((f) => ({
      id: f.id, name: f.displayName, group: categoryLabel(f.category),
      meta: [fileExt(f.displayName).toUpperCase(), mb(f.sizeBytes)].filter(Boolean).join(" · "),
      suggested: suggested.has(f.id),
      inGuide: chaptered.has(deckStem(f.displayName).toLowerCase()),
    }));
  // Every PDF the module has, as deck stems: the panel's "open another" list.
  const decks = [...new Set(listModuleFiles(db, mod.id).filter((f) => /\.pdf$/i.test(f.displayName)).map((f) => deckStem(f.displayName)))].sort();

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
          <GenerateGuideButton moduleId={mod.id} hasGuide={Boolean(guide)} canGenerate={canGenerateGuides(db, userId)} candidates={candidates} />
        </div>
      </header>

      {guide ? (
        <section id="study" className="mt-7">
          <StudyGuide markdown={guide.markdown} moduleId={mod.id} decks={decks} />
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
