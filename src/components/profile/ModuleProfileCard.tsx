import type { ModuleProfile, WeeklyPlan } from "@/enrich/profiles";
import type { Status } from "@/server/profiles";
import { RebuildButton } from "./RebuildButton";
import { LecturerPage } from "./LecturerPage";

type Props = {
  moduleId: number;
  code: string | null;
  profile: ModuleProfile | null;
  lecturers: { name: string; staffUrl: string | null; hasPage: boolean }[];
  reviewCount: number;
  onNusmods: boolean;
  status: Status;
  focus: WeeklyPlan["priorities"][number] | null;
  hasModel: boolean;
};

const label = "text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3";

function Bullets({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-1 flex flex-col gap-1 text-[14px] leading-[1.5] text-ink-2">
      {items.map((t, i) => <li key={i} className="flex gap-2"><span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-ink-3" />{t}</li>)}
    </ul>
  );
}

// What OpenPapr knows about this module for this student: what it is, what it
// builds on and where their gaps are, what the lecturers stress, what past
// students say on NUSMods, and this week's focus from the plan.
export function ModuleProfileCard(p: Props) {
  const prof = p.profile;
  return (
    <section aria-labelledby="mod-profile" className="mt-8 rounded-[10px] border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-3.5">
        <h2 id="mod-profile" className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">Module profile</h2>
        {p.hasModel
          ? <RebuildButton scope="module" moduleId={p.moduleId} status={p.status} noun="module profile" />
          : <a href="/account" className="text-[12px] text-accent hover:underline">Add an AI key to build profiles</a>}
      </div>

      {!prof ? (
        <p className="px-5 py-5 text-sm text-ink-2">
          {p.hasModel
            ? "Not built yet. It is assembled from NUSMods, past students' reviews, the lecturers, the course's announcements and your own course history."
            : "Profiles are written by your AI provider from NUSMods, past students' reviews, the lecturers and your course history."}
        </p>
      ) : (
        <div className="px-5 py-5">
          <p className="max-w-3xl text-[16px] leading-[1.5] text-ink">{prof.oneLine}</p>
          {p.focus && (
            <p className="mt-3 max-w-3xl rounded-md border border-line bg-panel px-3 py-2 text-[14px] leading-[1.5] text-ink">
              <span className="font-semibold">This week:</span> {p.focus.focus} <span className="text-ink-2">— {p.focus.why}</span>
            </p>
          )}

          <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <h3 className={label}>For you</h3>
              {prof.fit.relevance && <p className="mt-1 text-[14px] leading-[1.5] text-ink-2">{prof.fit.relevance}</p>}
              {prof.fit.buildsOn.length > 0 && <><p className="mt-2 text-[13px] font-medium text-ink">Builds on</p><Bullets items={prof.fit.buildsOn} /></>}
              {prof.fit.gaps.length > 0 && <><p className="mt-2 text-[13px] font-medium text-ink">Worth brushing up</p><Bullets items={prof.fit.gaps} /></>}
            </div>

            <div>
              <h3 className={label}>Lecturers</h3>
              {p.lecturers.length === 0 && <p className="mt-1 text-[14px] text-ink-3">Canvas does not list them for this course.</p>}
              <ul className="mt-1 flex flex-col gap-3">
                {p.lecturers.map((l) => {
                  const said = prof.lecturers.find((x) => x.name.toLowerCase() === l.name.toLowerCase());
                  return (
                    <li key={l.name}>
                      <p className="text-[14px] font-medium text-ink">{l.name}</p>
                      {said?.background && <p className="text-[13px] leading-[1.5] text-ink-2">{said.background}</p>}
                      {said?.emphasis.length ? <p className="mt-0.5 text-[13px] leading-[1.5] text-ink-2">Stresses: {said.emphasis.join("; ")}</p> : null}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
                        {l.staffUrl && <a href={l.staffUrl} target="_blank" rel="noreferrer" className="hover:text-accent">Staff page ↗</a>}
                        {l.staffUrl && !l.hasPage && <span>(read on next rebuild)</span>}
                        <LecturerPage moduleId={p.moduleId} name={l.name} staffUrl={l.staffUrl} />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2"><LecturerPage moduleId={p.moduleId} name={null} staffUrl={null} /></div>
            </div>

            <div>
              <h3 className={label}>Students say</h3>
              {prof.studentsSay && p.reviewCount > 0 ? (
                <>
                  <p className="mt-1 text-[14px] leading-[1.5] text-ink-2">
                    {[prof.studentsSay.workload && `Workload: ${prof.studentsSay.workload}`, prof.studentsSay.difficulty && `Difficulty: ${prof.studentsSay.difficulty}`].filter(Boolean).join(" · ")}
                  </p>
                  {prof.studentsSay.tips.length > 0 && <><p className="mt-2 text-[13px] font-medium text-ink">Tips</p><Bullets items={prof.studentsSay.tips} /></>}
                  {prof.studentsSay.pitfalls.length > 0 && <><p className="mt-2 text-[13px] font-medium text-ink">Pitfalls</p><Bullets items={prof.studentsSay.pitfalls} /></>}
                </>
              ) : (
                <p className="mt-1 text-[14px] text-ink-3">No NUSMods reviews to draw on.</p>
              )}
              {p.code && p.reviewCount > 0 && (
                <p className="mt-2 text-[12px] text-ink-3">
                  From {p.reviewCount} review{p.reviewCount === 1 ? "" : "s"} on{" "}
                  <a href={`https://nusmods.com/courses/${p.code}/reviews`} target="_blank" rel="noreferrer" className="hover:text-accent">NUSMods ↗</a>
                </p>
              )}
            </div>
          </div>

          {prof.howToStudy.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <h3 className={label}>How to study it</h3>
              <Bullets items={prof.howToStudy} />
            </div>
          )}
          <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
            Written by your AI provider from {p.onNusmods ? "NUSMods" : "the course"}{p.reviewCount ? ", past students' reviews" : ""}, the lecturers{p.lecturers.some((l) => l.hasPage) ? " and their staff pages" : ""}, announcements and your course history. Check anything that matters against the course itself.
          </p>
        </div>
      )}
    </section>
  );
}
