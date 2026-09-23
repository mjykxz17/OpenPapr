"use client";

import { useEffect } from "react";

// A page that throws (the database busy for longer than its timeout, Canvas
// data in a shape nobody expected) shows this instead of a blank error
// screen, with a way to try again that does not lose the session.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-svh items-center justify-center bg-surface px-6 text-ink">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page could not load</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Something went wrong on our side. Trying again usually works; if it keeps happening, go back home.
        </p>
        {error.digest && <p className="mt-2 font-mono text-[12px] text-ink-3">ref {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-strong">Try again</button>
          <a href="/" className="inline-flex h-10 items-center rounded-md border border-line-2 px-4 text-sm text-ink hover:bg-ink/[0.05]">Home</a>
        </div>
      </div>
    </div>
  );
}
