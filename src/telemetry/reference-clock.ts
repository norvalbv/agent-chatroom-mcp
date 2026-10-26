/**
 * The machine watch's reference clock: an idle worker thread that does nothing but time itself (jHiccup's "control"
 * process, sources/jhiccup-readme). A late tick on the hub's own thread is the machine only if this clock was late
 * too: spawnSync, a synchronous read or a long loop blocks the thread that runs it and no other, so the reference keeps
 * time while the hub waits on its own work (evidence/machine-load: `git worktree add` run with spawnSync held the hub
 * 1.8-3.8 s per breakout on research-swarm while an independent timer measured here stayed within 17 ms).
 * - The worker writes, for each second of the last SLOTS, the worst drift of its own REF_MS timer, and the time of its
 *   last tick, into shared memory; the hub reads them without a message round trip, so a blocked hub can still ask.
 * - A starved machine stops this thread too, and it may not have ticked yet when the hub's late tick asks: the gap since
 *   its last tick counts as its drift, so a reference that has not run is late, never on time.
 */
import { Worker } from "node:worker_threads";

export const REF_MS = 100;
/** one slot per second: ten minutes of history, longer than any episode's single late tick */
const SLOTS = 600;

const WORKER = `
const { workerData } = require("node:worker_threads");
const a = new BigInt64Array(workerData.sab);
const { ms, slots } = workerData;
let due = Date.now() + ms;
const tick = () => {
  const now = Date.now();
  const drift = BigInt(Math.max(0, now - due));
  const sec = Math.floor(now / 1000);
  const i = sec % slots;
  if (Atomics.load(a, 1 + 2 * i) !== BigInt(sec)) { Atomics.store(a, 2 + 2 * i, 0n); Atomics.store(a, 1 + 2 * i, BigInt(sec)); }
  if (drift > Atomics.load(a, 2 + 2 * i)) Atomics.store(a, 2 + 2 * i, drift);
  Atomics.store(a, 0, BigInt(now));
  due = now + ms;
  setTimeout(tick, ms);
};
setTimeout(tick, ms);
`;

export interface ReferenceClock {
  /** the reference's worst lateness over [fromMs, toMs], counting the time since its last tick if it has not run since */
  worst(fromMs: number, toMs: number): number;
  stop(): void;
}

/** Start the reference thread; undefined when a worker cannot start (the watch then attributes as it did without one). */
export function startReferenceClock(ms = REF_MS): ReferenceClock | undefined {
  try {
    // [0] last tick (epoch ms); then per slot [second, worst drift ms in that second]
    const sab = new SharedArrayBuffer(8 * (1 + 2 * SLOTS));
    const a = new BigInt64Array(sab);
    Atomics.store(a, 0, BigInt(Date.now()));
    const worker = new Worker(WORKER, { eval: true, workerData: { sab, ms, slots: SLOTS } });
    worker.unref();
    worker.on("error", () => {});
    return {
      worst(fromMs, toMs) {
        let worst = Math.max(0, toMs - Number(Atomics.load(a, 0)) - ms);
        const last = Math.floor(toMs / 1000);
        for (let sec = Math.max(Math.floor(fromMs / 1000), last - SLOTS + 1); sec <= last; sec++) {
          const i = ((sec % SLOTS) + SLOTS) % SLOTS;
          if (Atomics.load(a, 1 + 2 * i) === BigInt(sec)) worst = Math.max(worst, Number(Atomics.load(a, 2 + 2 * i)));
        }
        return worst;
      },
      stop() { void worker.terminate(); },
    };
  } catch {
    return undefined;
  }
}
