"use client";

import { useEffect, useRef, useState } from "react";
import { useSlidePanel } from "@/components/slide-panel-context";

type Q = { q: string; options: string[]; answer: number; why: string; slide: { deck: string; page: number } | null };
type Saved = { question: number; chosen: number; correct: boolean };
type QuizSet = { questions: Q[]; set: string; answers: Saved[] };

// "Test yourself" at the end of a chapter: a handful of multiple-choice
// questions written from this chapter, each with why and the slide it is on.
// Answers are saved as they are given, so coming back shows them and the
// score; the ones missed last time come first. `start` changes when the
// toolbar's Quiz button is pressed.
export function ChapterQuiz({ moduleId, chapter, label, start }: { moduleId: number; chapter: number; label: string; start: number }) {
  const [qs, setQs] = useState<Q[] | null>(null);
  const [set, setSet] = useState("");
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [order, setOrder] = useState<number[]>([]);           // missed-last-time first
  const [missedBefore, setMissedBefore] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLElement | null>(null);
  const panel = useSlidePanel();

  function show(d: QuizSet) {
    const missed = d.answers.filter((a) => !a.correct && a.question < d.questions.length).map((a) => a.question);
    const rest = d.questions.map((_, i) => i).filter((i) => !missed.includes(i));
    setQs(d.questions);
    setSet(d.set);
    setPicked(Object.fromEntries(d.answers.filter((a) => a.question < d.questions.length).map((a) => [a.question, a.chosen])));
    setMissedBefore(missed);
    setOrder([...missed, ...rest]);
  }

  // Coming back to a chapter: its saved questions, if the student answered
  // any. Never makes new ones.
  useEffect(() => {
    let live = true;
    fetch(`/api/modules/${moduleId}/guide/quiz?chapter=${chapter}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<QuizSet> | null) => { if (live && d?.questions && d.set && d.answers?.length) show(d as QuizSet); })
      .catch(() => {});
    return () => { live = false; };
  }, [moduleId, chapter]);

  async function load(fresh = false) {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/modules/${moduleId}/guide/quiz`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chapter, fresh }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => null)) as (Partial<QuizSet> & { error?: string }) | null;
    if (r?.ok && d?.questions && d.set) show({ questions: d.questions, set: d.set, answers: d.answers ?? [] });
    else setError(d?.error ?? "Couldn't make questions just now. Try again.");
    setBusy(false);
  }

  function choose(i: number, j: number) {
    setPicked((p) => ({ ...p, [i]: j }));
    void fetch(`/api/modules/${moduleId}/guide/quiz/answer`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chapter, set, question: i, chosen: j }),
    }).then(async (r) => {
      if (r.ok) return;
      const d = (await r.json().catch(() => null)) as { error?: string } | null;
      setError(d?.error ?? "Couldn't save that answer.");
    }).catch(() => setError("Couldn't save that answer — you seem to be offline."));
  }

  // Only a press made while this chapter is showing starts it.
  const seen = useRef(start);
  useEffect(() => {
    if (start === seen.current) return;
    seen.current = start;
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!qs && !busy) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const answered = qs ? Object.keys(picked).length : 0;
  const right = qs ? qs.filter((q, i) => picked[i] === q.answer).length : 0;
  const wrong = qs ? qs.map((_, i) => i).filter((i) => picked[i] !== undefined && picked[i] !== qs[i]!.answer) : [];

  function retryMissed() {
    setPicked((p) => Object.fromEntries(Object.entries(p).filter(([i]) => !wrong.includes(Number(i)))));
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section ref={box} id="chapter-quiz" aria-label="Test yourself" className="guide mt-12 scroll-mt-20 rounded-[10px] border border-line bg-panel px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[17px] font-semibold text-ink">Test yourself</h3>
        {qs && <span className="text-[13px] tabular-nums text-ink-2">{answered === qs.length ? `${right} of ${qs.length} right` : `${answered} of ${qs.length} answered`}</span>}
      </div>
      {!qs ? (
        <div className="mt-2 flex flex-col items-start gap-3">
          <p className="text-[14px] leading-relaxed text-ink-2">A few practice questions on “{label.replace(/^\d+\.\s*/, "")}”, written from this chapter, each with the slide it comes from.</p>
          <button type="button" onClick={() => load()} disabled={busy}
            className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-strong disabled:opacity-60">
            {busy ? "Writing questions…" : "Quiz me on this chapter"}
          </button>
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        </div>
      ) : (
        <>
          <ol className="mt-4 flex flex-col gap-6">
            {order.map((i, n) => {
              const q = qs[i]!;
              const chosen = picked[i];
              const done = chosen !== undefined;
              return (
                <li key={i} className="flex flex-col gap-2">
                  {missedBefore.includes(i) && (
                    <span className="self-start rounded bg-danger/[0.08] px-1.5 py-px text-[11.5px] font-medium text-danger">Missed last time</span>
                  )}
                  <p className="text-[15px] font-medium leading-snug text-ink"><span className="mr-1.5 tabular-nums text-ink-3">{n + 1}.</span>{q.q}</p>
                  <div className="flex flex-col gap-1.5" role="group" aria-label={`Question ${n + 1} options`}>
                    {q.options.map((o, j) => {
                      const isRight = j === q.answer;
                      const tone = !done ? "border-line-2 hover:border-accent" : isRight ? "border-ok bg-ok/[0.08] text-ink" : j === chosen ? "border-danger bg-danger/[0.06] text-ink" : "border-line text-ink-3";
                      return (
                        <button key={j} type="button" disabled={done} onClick={() => choose(i, j)}
                          className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-left text-[14px] leading-snug transition-colors disabled:cursor-default ${tone}`}>
                          <span className="shrink-0 font-mono text-[12px] text-ink-3">{"ABCD"[j]}</span>
                          <span>{o}</span>
                          {done && isRight && <span className="ml-auto shrink-0 text-[12px] font-medium text-ok">Correct</span>}
                        </button>
                      );
                    })}
                  </div>
                  {done && (
                    <p className="text-[13px] leading-relaxed text-ink-2">
                      {chosen === q.answer ? "Right. " : `The answer is ${"ABCD"[q.answer]}. `}{q.why}
                      {q.slide && (
                        <button type="button" onClick={() => panel?.show(q.slide!)} className="ml-1.5 rounded bg-accent-soft px-1.5 py-px text-[12px] font-medium text-accent hover:bg-accent hover:text-on-accent">
                          {q.slide.deck} · slide {q.slide.page}
                        </button>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="mt-6 flex flex-wrap gap-2">
            {wrong.length > 0 && (
              <button type="button" onClick={retryMissed} className="h-9 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-strong">
                Try the ones I missed again
              </button>
            )}
            <button type="button" onClick={() => setPicked({})} className="h-9 rounded-md border border-line-2 px-3 text-[13px] text-ink hover:border-ink-3">Start over</button>
            <button type="button" onClick={() => load(true)} disabled={busy} className="h-9 rounded-md border border-line-2 px-3 text-[13px] text-ink hover:border-ink-3 disabled:opacity-60">
              {busy ? "Writing…" : "New questions"}
            </button>
          </div>
          {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
        </>
      )}
    </section>
  );
}
