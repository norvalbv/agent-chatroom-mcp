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
  [key: string]: unknown;
}

export function createWaitView() {
  const delivered = new WeakMap<object, string>();
  return (participant: object, view: WaitView): WaitView | Record<string, unknown> => {
    const { hint, messages, next_seq, remaining, board_keys, board_delta, board_reset, quiet_activity, ...state } = view;
    const snapshot = JSON.stringify(state);
    const unchanged = delivered.get(participant) === snapshot;
    delivered.set(participant, snapshot);
    if (!unchanged || messages.length || remaining || board_keys !== undefined || board_delta !== undefined || board_reset ||
        quiet_activity?.length || view.addressed_to_you.length || view.unanswered_human || view.room_state !== 'open') return view;
    return { hint, messages, remaining, next_seq, room_state: view.room_state, your_turn: view.your_turn,
      your_role: view.your_role, leaving_would_block: view.leaving_would_block,
      open_proposal: view.open_proposal ? { id: view.open_proposal.id, version: view.open_proposal.version, unchanged: true } : null,
      addressed_to_you: [], unchanged: true };
  };
}
