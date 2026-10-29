/** Body handoff audit. Attention settlement is earlier than a held or filtered MCP result. */
import type { Hub } from "../../hub.js";
import type { Message, Participant, Room } from "../types.js";

export type DeliveryVia = "wait" | "read" | "join" | "refusal" | "steer" | "carry";
export interface DeliveryReceipt {
  type: "delivery_receipt"; room: string; participant: string; seat: string;
  via: DeliveryVia; boundary: "hub_handoff" | "consumer_ack";
  seq_ranges: [number, number][]; count: number; ts: string;
}
const MAX_RANGES = 64;
interface Pending { room: Room; p: Participant; msgs: Message[]; via: DeliveryVia }
// Metadata stays out of the serialized response and cannot keep finished results alive.
const pending = new WeakMap<object, Pending>();

/** Exact closed ranges; sort/deduplicate without spanning a withheld gap. */
export function sequenceRanges(seqs: readonly number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const seq of [...new Set(seqs)].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && seq === last[1] + 1) last[1] = seq;
    else ranges.push([seq, seq]);
  }
  return ranges;
}

export function recordDelivery(hub: Hub, room: Room, p: Participant, msgs: readonly Message[], via: DeliveryVia): void {
  const ranges = sequenceRanges(msgs.map(m => m.seq)), ts = new Date().toISOString();
  for (let i = 0; i < ranges.length; i += MAX_RANGES) {
    const seq_ranges = ranges.slice(i, i + MAX_RANGES);
    hub.persist({ type: "delivery_receipt", room: room.name, participant: p.id, seat: hub.shown(room, p), via,
      boundary: via === "steer" ? "consumer_ack" : "hub_handoff", seq_ranges,
      count: seq_ranges.reduce((n, [lo, hi]) => n + hi - lo + 1, 0), ts });
  }
}

/** Stage only full bodies. A wait's steered messages render as stubs; explicit read still renders their bodies. */
export function deliveryResult<T extends object>(data: T, room: Room, p: Participant, msgs: Message[], via: DeliveryVia): T {
  pending.set(data, { room, p, msgs: via === "wait" ? msgs.filter(m => !p.steered?.includes(m.id)) : msgs, via });
  return data;
}

/** Called only after the guard constructed a returnable, serialized payload. Not a transport/client ACK. */
export function flushDelivery(hub: Hub, data: unknown): void {
  if (!data || typeof data !== "object") return;
  const plan = pending.get(data);
  if (!plan) return;
  pending.delete(data);
  recordDelivery(hub, plan.room, plan.p, plan.msgs, plan.via);
}

/** A refused send returns full unread bodies too. Authentication failures never acquire an actor. */
export function refusalDelivery(hub: Hub, room: string | undefined, participant: string | null, data: unknown): void {
  const r = room ? hub.rooms.get(room) : undefined, p = participant ? r?.participants.get(participant) : undefined;
  const unread = (data as { unread?: unknown })?.unread;
  if (!r || !p || !Array.isArray(unread)) return;
  const bodies = new Set(unread.filter((line): line is string => typeof line === "string"));
  recordDelivery(hub, r, p, r.messages.filter(m => bodies.has(hub.fmt(r, m))), "refusal");
}

/** Explicit reads have one rendering/receipt boundary, including quiet-log reads and capped pages. */
export function readMessages(hub: Hub, r: Room, p: Participant | undefined, viewer: string | undefined, since: number | undefined, limit: number): string[] {
  const msgs = p ? hub.readAs(r, p, since, limit) : hub.read(r.name, since ?? 0, limit, viewer);
  const hint = p ? hub.attentionHint(r, p) : undefined;
  const lines = msgs.map((m, i) => hub.fmt(r, m) + (hint && i === 0 ? `\n[HINT] ${hint}` : ""));
  const remaining = p ? hub.deliveryRemaining(p) : 0;
  if (remaining) {
    const last = Math.max(0, ...msgs.filter(m => m.id !== hub.attentionFocus(r, p!)?.id).map(m => m.seq));
    lines.push(`[MORE] ${remaining} more message(s) remain (this page was capped); call read_messages again with since_seq=${last}.`);
  }
  return p ? deliveryResult(lines, r, p, msgs, "read") : lines;
}
