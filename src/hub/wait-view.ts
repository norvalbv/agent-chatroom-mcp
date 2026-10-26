import { hubTime } from "./clock.js";

/** Per-session receipts for unchanged coordination state; delivery events always travel in full. */
export interface WaitView {
  hint?: string;
  messages: string[];
  remaining: number;
  next_seq: number;
  room_state: string;
  your_turn: boolean;
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

export function createWaitView() {
  const delivered = new WeakMap<object, string>();
  return (participant: object, view: WaitView): WaitView | Record<string, unknown> => {
    const { hint, messages, next_seq, remaining, board_keys, board_delta, board_reset, quiet_activity, deadline, ...state } = view;
    const snapshot = JSON.stringify(state);
    const unchanged = delivered.get(participant) === snapshot;
    delivered.set(participant, snapshot);
    if (!unchanged || messages.length || remaining || board_keys !== undefined || board_delta !== undefined || board_reset ||
        quiet_activity?.length || view.addressed_to_you.length || view.unanswered_human || view.room_state !== 'open') return { ...view, hub_time: hubTime() };
    return { hint, messages, remaining, next_seq, room_state: view.room_state, your_turn: view.your_turn,
      your_role: view.your_role, leaving_would_block: view.leaving_would_block,
      open_proposal: view.open_proposal ? { id: view.open_proposal.id, version: view.open_proposal.version, unchanged: true } : null,
      addressed_to_you: [], ...(deadline ? { deadline } : {}), unchanged: true, hub_time: hubTime() };
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
