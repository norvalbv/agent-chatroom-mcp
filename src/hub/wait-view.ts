import { hubTime } from "./clock.js";

/** Per-session receipts for unchanged coordination state; delivery events always travel in full. */
export interface WaitView {
  hint?: string;
  messages: string[];
  remaining: number;
  next_seq: number;
  room_state: string;
  /** round_robin rooms only: in a free room it is always your turn */
  your_turn?: boolean;
  your_role: string;
  leaving_would_block: string | boolean;
  open_proposal: { id: string; version: number; [key: string]: unknown } | null;
  addressed_to_you: unknown[];
  unanswered_human: unknown;
  quiet_activity?: unknown[];
  board_keys?: string[];
  board_delta?: unknown;
  board_reset?: boolean;
  /** seconds_left ticks on every wait, so it is kept out of the unchanged comparison and re-sent as is */
  deadline?: unknown;
  /** the hub's clock (src/hub/clock.ts), added to every wait after the unchanged comparison: seats otherwise guess the time */
  hub_time?: string;
  [key: string]: unknown;
}

/** What a field means when a wait leaves it out: the seat is told only what differs (tool description, wait_for_messages). */
// leaving_would_block stays on every wait: prompts/worker.md, group.md and terse.md tell a seat to leave when it says false
const DEFAULTS: Record<string, unknown> = { remaining: 0, room_state: "open", unanswered_human: null, open_proposal: null, conclusion: null };
/** Constant for most of a seat's life (3.5% of wait bytes in swarm-003938/212507): sent on the first wait and on change. */
const ON_CHANGE = new Set(["your_role", "active_participants"]);
/** A board notice names its key; board_delta naming it again was 1,590 duplicate keys in 1,156 waits. */
const NOTICE_KEY = /^#\d+ [^\n]*?\[BOARD\] [^"\n]*"([^"]+)"/;

/** The view a seat reads: defaults, empty lists, a share that is not over and constants it already has are left out
 * (32% of wait bytes on 3,438 recorded waits). The unchanged comparison runs on the full view, before this. */
export function leanWaitView(view: Record<string, unknown>, sent: Map<string, string>): Record<string, unknown> {
  const messages = Array.isArray(view.messages) ? (view.messages as string[]) : [];
  const named = new Set(messages.map((m) => NOTICE_KEY.exec(m)?.[1]).filter(Boolean));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(view)) {
    if (v === undefined || (k in DEFAULTS && v === DEFAULTS[k])) continue;
    if (Array.isArray(v) && !v.length && k !== "messages" && k !== "board_keys") continue;
    if (k === "your_share" && !(v as { over?: boolean }).over) continue;
    if (ON_CHANGE.has(k)) { const s = JSON.stringify(v); if (sent.get(k) === s) continue; sent.set(k, s); }
    if (k === "board_delta") {
      const d = v as { keys?: string[]; tombstones?: string[] }, keys = (d.keys ?? []).filter((x) => !named.has(x));
      if (keys.length || d.tombstones?.length) out[k] = { ...(keys.length ? { keys } : {}), ...(d.tombstones?.length ? { tombstones: d.tombstones } : {}) };
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function createWaitView() {
  const delivered = new WeakMap<object, string>();
  const constants = new WeakMap<object, Map<string, string>>();
  return (participant: object, view: WaitView): Record<string, unknown> => {
    const { hint, messages, next_seq, remaining, board_keys, board_delta, board_reset, quiet_activity, deadline, ...state } = view;
    const snapshot = JSON.stringify(state);
    const unchanged = delivered.get(participant) === snapshot;
    delivered.set(participant, snapshot);
    const sent = constants.get(participant) ?? constants.set(participant, new Map()).get(participant)!;
    if (!unchanged || messages.length || remaining || board_keys !== undefined || board_delta !== undefined || board_reset ||
        quiet_activity?.length || view.addressed_to_you.length || view.unanswered_human || view.room_state !== 'open') return { ...leanWaitView(view, sent), hub_time: hubTime() };
    // every field the receipt leaves out is in the snapshot it matched, so the seat's last wait still holds it
    return { ...(hint ? { hint } : {}), messages, remaining, next_seq, leaving_would_block: view.leaving_would_block,
      ...(view.open_proposal ? { open_proposal: { id: view.open_proposal.id, version: view.open_proposal.version, unchanged: true } } : {}),
      ...(deadline ? { deadline } : {}), unchanged: true, hub_time: hubTime() };
  };
}

/** Why a wait_for_messages returned, kept on its call_completion and never sent to the seat (wait-cost --by-tool splits on
 * it): empty; message (no hold asked); actionable (addressed, owed, own proposal challenged, owed elsewhere); capped (one
 * page of a backlog); chatter (a message that is not a board notice, after the seat's own budget); timeout (the hold ended
 * with chatter in it); notices (the hold ended with only board notices: news nobody had to act on, evidence/redundant-calls). */
export type WaitWoke = "empty" | "message" | "actionable" | "capped" | "chatter" | "timeout" | "notices";
export type WokeTag = { woke: WaitWoke; board_notices: number };
export const WAIT_WOKE = Symbol("wait_woke");

export function wokeOf(msgs: readonly { kind: string }[], s: { capped: boolean; actionable: boolean; held: boolean; holdOver: boolean }): WokeTag {
  const board_notices = msgs.filter((m) => m.kind === "board").length;
  const woke: WaitWoke = s.capped ? "capped" : s.actionable ? "actionable" : !msgs.length ? "empty" : !s.held ? "message"
    : board_notices === msgs.length ? "notices" : s.holdOver ? "timeout" : "chatter";
  return { woke, board_notices };
}

/** Tags a wait's view with its WokeTag: non-enumerable, so JSON (what the seat reads) and spreads leave it behind. */
export const withWoke = <T extends object>(view: T, tag: WokeTag): T => Object.defineProperty(view, WAIT_WOKE, { value: tag, enumerable: false });
