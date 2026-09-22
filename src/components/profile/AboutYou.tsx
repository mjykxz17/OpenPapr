"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { UserProfile, WritingStyle } from "@/enrich/profiles";
import { RebuildButton } from "./RebuildButton";

type Props = {
  major: string | null;
  studyYear: number | null;
  styleLearning: boolean;
  profile: UserProfile | null;
  style: WritingStyle | null;
  historyCount: number;
  status: { builtAt: number | null; pending: boolean; error: string | null };
  hasModel: boolean;
};

const MAJORS = [
  "Computer Science", "Information Security", "Information Systems", "Business Analytics", "Computer Engineering",
  "Data Science and Analytics", "Business Administration", "Accountancy", "Economics", "Mathematics", "Statistics",
  "Physics", "Chemistry", "Life Sciences", "Electrical Engineering", "Mechanical Engineering", "Psychology", "Law", "Medicine",
];

const field = "h-10 w-full rounded-md border border-line-2 bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent-soft";
const label = "flex flex-col gap-1.5 text-[13px] text-ink-2";
const h3 = "text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3";

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-1 text-[14px] leading-[1.5] text-ink-2">
      {items.map((t, i) => <li key={i} className="flex gap-2"><span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-ink-3" />{t}</li>)}
    </ul>
  );
}

// What the student tells OpenPapr, and — right beside it — what OpenPapr has
// concluded from it, so nothing about them is kept out of their sight.
export function AboutYou(p: Props) {
  const router = useRouter();
  const [major, setMajor] = useState(p.major ?? "");
  const [year, setYear] = useState(p.studyYear ? String(p.studyYear) : "");
  const [styleLearning, setStyleLearning] = useState(p.styleLearning);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await fetch("/api/account/about", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ major, studyYear: year || null, styleLearning }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) { const b = await res?.json().catch(() => null); setMsg({ ok: false, text: b?.error ?? "could not save" }); return; }
    setMsg({ ok: true, text: p.hasModel ? "Saved. Your profile is being rebuilt." : "Saved." });
    router.refresh();
  }

  return (
    <section aria-labelledby="acct-about" className="rounded-[10px] border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-6 py-4">
        <h2 id="acct-about" className="text-[15px] font-semibold text-ink">About you</h2>
        {p.hasModel && <RebuildButton scope="me" status={p.status} />}
      </div>
      <div className="px-6 py-5">
        <p className="max-w-2xl text-[14px] leading-relaxed text-ink-2">
          Study guides, module profiles and your weekly plan are pitched to you from this, {p.historyCount ? `the ${p.historyCount} course${p.historyCount === 1 ? "" : "s"} you have taken on Canvas` : "the courses you have taken on Canvas"} and, if you allow it, how you write your notes.
        </p>

        <form onSubmit={save} className="mt-5 grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
          <label className={label}>
            Major
            <input list="nus-majors" value={major} onChange={(e) => setMajor(e.target.value)} placeholder="e.g. Information Security" className={field} />
            <datalist id="nus-majors">{MAJORS.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <label className={label}>
            Year
            <select value={year} onChange={(e) => setYear(e.target.value)} className={field}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-2.5 text-[14px] text-ink sm:col-span-2">
            <input type="checkbox" checked={styleLearning} onChange={(e) => setStyleLearning(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
            <span>
              Learn from how I write my slide notes
              <span className="block text-[12px] leading-relaxed text-ink-3">Your notes are described (never quoted) so guides read the way you think. Turning this off forgets the description.</span>
            </span>
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="submit" disabled={saving} className="h-10 whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-strong disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[13px] ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</span>}
          </div>
        </form>

        {(p.profile || p.style) && (
          <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-5 border-t border-line pt-5 md:grid-cols-2">
            {p.profile && (
              <>
                <div className="md:col-span-2">
                  <h3 className={h3}>How OpenPapr sees you</h3>
                  <p className="mt-1 text-[15px] leading-[1.5] text-ink">{p.profile.headline}</p>
                  <p className="mt-1 text-[14px] leading-[1.5] text-ink-2">{p.profile.thisSemester}</p>
                </div>
                {p.profile.background.length > 0 && <div><h3 className={h3}>Already know</h3><Bullets items={p.profile.background} /></div>}
                {p.profile.watchOuts.length > 0 && <div><h3 className={h3}>Watch out for</h3><Bullets items={p.profile.watchOuts} /></div>}
                <div className="md:col-span-2">
                  <h3 className={h3}>How guides are written for you</h3>
                  <p className="mt-1 text-[14px] leading-[1.5] text-ink-2">{p.profile.guideVoice}</p>
                </div>
              </>
            )}
            {p.style && p.styleLearning && (
              <div className="md:col-span-2">
                <h3 className={h3}>How you write</h3>
                <p className="mt-1 text-[14px] leading-[1.5] text-ink-2">{p.style.summary}</p>
                <p className="mt-1 text-[12px] text-ink-3">{[p.style.languages, p.style.tone, p.style.format].join(" · ")}</p>
              </div>
            )}
          </div>
        )}
        {!p.hasModel && <p className="mt-4 text-[13px] text-ink-3">Add an AI key below and OpenPapr will build your profile.</p>}
      </div>
    </section>
  );
}
