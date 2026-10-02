"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type SetupStep = { id: string; label: string; hint: string; href: string; done: boolean };

const DISMISSED = "setup-dismissed";
const INSTALLED = "setup-installed";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

// The first days: what is left to set up, ticked off as it gets done. Goes
// away by itself once everything is done, or when the student closes it.
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setDismissed(get(DISMISSED) === "1");
    setInstalled(get(INSTALLED) === "1" || window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
    setReady(true);
  }, []);

  const all: SetupStep[] = [...steps, { id: "install", label: "Put OpenPapr on your phone", hint: "Opens like an app, and guides work offline", href: "", done: installed }];
  const left = all.filter((s) => !s.done).length;
  if (!ready || dismissed || left === 0) return null;
  const close = () => { set(DISMISSED, "1"); setDismissed(true); };
  const nextStep = all.find((x) => !x.done) ?? null;

  return (
    <section aria-labelledby="setup" className="mb-6 rounded-[10px] border border-line bg-panel px-4 py-3">
      {/* Folded to one line: the next thing to do. The full list opens on request. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="setup" className="text-[14px] font-semibold text-ink">Finish setting up</h2>
        <div className="flex items-center gap-2" aria-hidden>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${((all.length - left) / all.length) * 100}%` }} /></div>
          <span className="text-[12px] tabular-nums text-ink-3">{all.length - left} of {all.length}</span>
        </div>
        {!open && nextStep && (
          nextStep.id === "install"
            ? <button type="button" onClick={() => { setOpen(true); setHowTo(true); }} className="text-[13px] font-medium text-accent hover:underline">Next: {nextStep.label} →</button>
            : <Link href={nextStep.href} className="text-[13px] font-medium text-accent no-underline hover:underline">Next: {nextStep.label} →</Link>
        )}
        <div className="ml-auto flex items-center gap-3 text-[13px]">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-ink-2 hover:text-ink">{open ? "Less" : "All steps"}</button>
          <button type="button" onClick={close} className="text-ink-3 hover:text-ink">Hide</button>
        </div>
      </div>
      {open && <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {all.map((s) => {
          const mark = (
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${s.done ? "border-accent bg-accent text-on-accent" : "border-line-2"}`} aria-hidden>
              {s.done && <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m3.5 8.5 3 3 6-7" /></svg>}
            </span>
          );
          const text = (
            <span className="min-w-0">
              <span className={`block text-[14px] ${s.done ? "text-ink-3 line-through" : "font-medium text-ink"}`}>{s.label}</span>
              {!s.done && <span className="block text-[12px] text-ink-3">{s.hint}</span>}
            </span>
          );
          const cls = "flex items-start gap-2.5 rounded-md px-2 py-2 text-left";
          if (s.id === "install") {
            return (
              <li key={s.id}>
                <button type="button" onClick={() => setHowTo((h) => !h)} aria-expanded={howTo} disabled={s.done} className={`${cls} w-full hover:bg-ink/[0.04] disabled:hover:bg-transparent`}>{mark}{text}</button>
                {howTo && !s.done && (
                  <div className="mb-2 ml-9 flex flex-col gap-2 text-[13px] leading-relaxed text-ink-2">
                    <p><b className="font-medium text-ink">iPhone:</b> open this page in Safari, tap Share, then “Add to Home Screen”.<br /><b className="font-medium text-ink">Android:</b> in Chrome, tap ⋮ then “Install app”.</p>
                    <button type="button" onClick={() => { set(INSTALLED, "1"); setInstalled(true); }} className="self-start text-accent hover:underline">I&apos;ve done it</button>
                  </div>
                )}
              </li>
            );
          }
          return (
            <li key={s.id}>
              {s.done ? <div className={cls}>{mark}{text}</div> : <Link href={s.href} className={`${cls} no-underline hover:bg-ink/[0.04]`}>{mark}{text}</Link>}
            </li>
          );
        })}
      </ul>}
    </section>
  );
}
