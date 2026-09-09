"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Mounted only while a module has no profile yet. The worker is reading the
// decks in the background; this watches for it to land and refreshes the page
// when it does, so the profile appears where the waiting message was without
// anyone reloading or being told to.
//
// It gives up after a while: a module the worker cannot read must not leave a
// tab polling for the rest of the day.
const POLL_MS = 15_000;
const GIVE_UP_MS = 20 * 60_000;

export function ProfileWatcher({ moduleId }: { moduleId: number }) {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (stopped || Date.now() - startedAt > GIVE_UP_MS) return;
      try {
        const res = await fetch(`/api/modules/${moduleId}/context`);
        if (res.ok && (await res.json()).profile) {
          router.refresh();
          return;
        }
      } catch {
        // A dropped poll is not worth reporting; the next beat picks it up.
      }
      if (!stopped) timer = setTimeout(() => void poll(), POLL_MS);
    };

    timer = setTimeout(() => void poll(), POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [moduleId, router]);

  return null;
}
