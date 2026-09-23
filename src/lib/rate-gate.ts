// A per-provider queue that keeps calls under a requests-per-minute cap.
//
// Every model call in the worker goes through the gate for its provider
// (keyed on base URL + key, so two students sharing a key share its budget).
// A call past the cap waits, first come first served, until the oldest call
// in the last minute ages out — the provider never sees more than it allows,
// and nothing fails with 429 merely because a study guide fires twenty
// sections at once.

type Listener = () => void;
let onWait: Listener | null = null;

// The worker's watchdog treats "waiting in the queue" as progress, not a hang.
export function setWaitListener(fn: Listener | null): void { onWait = fn; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RateGate {
  private times: number[] = [];
  private chain: Promise<void> = Promise.resolve();
  waiting = 0;

  constructor(public rpm: number | null, private windowMs = 60_000, private now: () => number = Date.now) {}

  acquire(): Promise<void> {
    this.waiting++;
    const turn = this.chain.then(() => this.take()).finally(() => { this.waiting--; });
    this.chain = turn.catch(() => undefined);
    return turn;
  }

  private async take(): Promise<void> {
    for (;;) {
      if (!this.rpm || this.rpm <= 0) return;
      const t = this.now();
      while (this.times.length && this.times[0]! <= t - this.windowMs) this.times.shift();
      if (this.times.length < this.rpm) { this.times.push(t); return; }
      const wait = this.times[0]! + this.windowMs - t + 5;
      onWait?.();
      await sleep(Math.min(wait, 15_000));
    }
  }
}

const gates = new Map<string, RateGate>();

export function gateFor(key: string, rpm: number | null | undefined): RateGate {
  let g = gates.get(key);
  if (!g) { g = new RateGate(rpm ?? null); gates.set(key, g); }
  g.rpm = rpm ?? null; // a changed setting applies to the next call
  return g;
}

export function queueDepth(): number {
  let n = 0;
  for (const g of gates.values()) n += g.waiting;
  return n;
}
