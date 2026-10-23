// On a first visit the service worker installs while the page is open; it
// takes the page over a moment later (sw.js calls skipWaiting and
// clients.claim). Saving offline only works once it has, so wait for that
// instead of asking the student to reload.

type Container = Pick<ServiceWorkerContainer, "controller" | "addEventListener" | "removeEventListener">;

export function whenControlled(sw: Container | undefined, timeoutMs = 8000): Promise<boolean> {
  if (!sw) return Promise.resolve(false);
  if (sw.controller) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => { clearTimeout(timer); sw.removeEventListener("controllerchange", onChange); resolve(ok); };
    const onChange = () => { if (sw.controller) done(true); };
    const timer = setTimeout(() => done(Boolean(sw.controller)), timeoutMs);
    sw.addEventListener("controllerchange", onChange);
  });
}
