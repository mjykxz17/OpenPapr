import { describe, expect, it, vi } from "vitest";
import { whenControlled } from "./offline-ready";

// A stand-in for navigator.serviceWorker.
function container(controller: object | null = null) {
  const t = new EventTarget();
  const c = {
    controller,
    addEventListener: t.addEventListener.bind(t),
    removeEventListener: t.removeEventListener.bind(t),
    take() { c.controller = {}; t.dispatchEvent(new Event("controllerchange")); },
  };
  return c as unknown as ServiceWorkerContainer & { take(): void };
}

describe("whenControlled", () => {
  it("is ready at once when the page is already controlled", async () => {
    await expect(whenControlled(container({}))).resolves.toBe(true);
  });
  it("waits for a first-visit worker to take the page over", async () => {
    const c = container();
    const p = whenControlled(c, 5000);
    c.take();
    await expect(p).resolves.toBe(true);
  });
  it("gives up after the timeout, and when the browser has no service workers", async () => {
    vi.useFakeTimers();
    const p = whenControlled(container(), 1000);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBe(false);
    vi.useRealTimers();
    await expect(whenControlled(undefined)).resolves.toBe(false);
  });
});
