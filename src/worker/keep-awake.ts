// The machine sleeps when nobody is using it: Fly's proxy stops it after a
// few minutes without requests and starts it again on the next one. The
// worker's own work (a sync, a study guide being written) is not a request,
// so without help the machine could be stopped halfway through. While real
// work is under way the worker calls its own public address now and then,
// which counts as traffic and keeps the machine up until the work is done.
//
// Short jobs never ping: only work still running after `after` ms does, so
// the quick checks the worker makes every minute don't keep it awake forever.

export type KeepAwakeOpts = { ping: () => Promise<unknown>; after?: number; every?: number; max?: number };

export function keepAwake<T>(work: Promise<T>, opts: KeepAwakeOpts | null): Promise<T> {
  if (!opts) return work;
  const { ping, after = 20_000, every = 30_000, max = 30 * 60_000 } = opts;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const beat = () => {
    if (Date.now() - started > max) return;   // something stuck must not pin the machine up
    void ping().catch(() => {});
    timer = setTimeout(beat, every);
    timer.unref?.();
  };
  timer = setTimeout(beat, after);
  timer.unref?.();
  return work.finally(() => { if (timer) clearTimeout(timer); });
}

// On Fly the app's public address; nowhere else (local runs, tests) is
// there anything to keep awake.
export function selfPing(env: Record<string, string | undefined> = process.env): KeepAwakeOpts | null {
  const app = env.FLY_APP_NAME;
  if (!app || env.KEEP_AWAKE === "0") return null;
  const url = `https://${app}.fly.dev/api/health`;
  return { ping: () => fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "openpapr-worker-keepawake" } }) };
}
