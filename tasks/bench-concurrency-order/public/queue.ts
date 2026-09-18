export type UpdateEvent = { seq: number; op: 'set' | 'delete'; key: string; value?: string };

/**
 * Apply a batch of update events to produce the final key-value state.
 * Events arrive over an unreliable network and the array order is the
 * arrival order, which is not necessarily the order the events happened in.
 */
export function applyUpdates(events: UpdateEvent[]): Record<string, string> {
  const state: Record<string, string> = {};
  for (const ev of events) {
    if (ev.op === 'set') {
      state[ev.key] = ev.value ?? '';
    } else {
      delete state[ev.key];
    }
  }
  return state;
}
