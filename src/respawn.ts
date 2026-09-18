/**
 * Whether the launcher should replace a seat that exited while its room is still open.
 *
 * The first respawning launcher replaced every exiting seat, so a seat that had finished its slice, handed over and
 * left (as the brief allows once leaving_would_block is false) was replaced by one that read the board, found nothing
 * to inherit, and left too: 70 respawns across two 20-seat runs in 30 minutes, each costing a board read under a
 * 100 req/min account cap (docs/board-electorate-swarm-200859.md, evidence/launcher-respawn-churn). The ranked remaining
 * item asked for an explicit completed / error / orphaned-work distinction, a floor the room must keep, the verifier
 * preserved, and bounded retries. This module is that decision; the launcher supplies the room summary it already polls.
 */
export interface RespawnRoom {
  state: string;
  quorum?: string | null;
  expected_participants?: number | null;
  participants: { name: string; agent: string; role?: string | null; active: boolean }[];
  board: Record<string, { by: string }>;
  /** From the room summary; the quorum floor binds only while one is open. */
  proposals?: { status: string }[];
}

export interface RespawnInput {
  name: string;
  /** Child exit code; null when killed by a signal. Anything but 0 is a failure, not completion. */
  exitCode: number | null;
  /** 1 for the first replacement. */
  attempt: number;
  room: RespawnRoom | null;
  maxAttempts?: number;
}

export interface RespawnDecision { respawn: boolean; reason: string }

/** The smallest room that can still conclude under scrutiny: a proposer, a challenger and a verifier. */
export const MIN_FLOOR = 3;

/**
 * The floor the room must keep. Between proposals a lobby may thin to its analysis and build seats without being
 * refilled: replacements that arrive then read the board, find no claim and leave (lobby swarm-214936 was held at its
 * quorum floor of 16 this way). Once a proposal is open the electorate matters, and the quorum floor binds.
 */
export function floorFor(room: RespawnRoom): number {
  const open = (room.proposals ?? []).some((p) => p.status === "open");
  if (!open) return MIN_FLOOR;
  const expected = room.expected_participants ?? 0;
  if (room.quorum === "unanimous") return Math.max(MIN_FLOOR, expected);
  if (room.quorum === "supermajority") return Math.max(MIN_FLOOR, Math.ceil(expected * 0.75));
  return Math.max(MIN_FLOOR, Math.ceil(expected / 2));
}

export function respawnDecision(i: RespawnInput): RespawnDecision {
  const max = i.maxAttempts ?? 3;
  if (!i.room) return { respawn: false, reason: "room missing" };
  if (i.room.state !== "open" && i.room.state !== "stalled") return { respawn: false, reason: `room is ${i.room.state}` };
  if (i.attempt > max) return { respawn: false, reason: `retry cap (${max}) reached` };
  const me = i.room.participants.find((p) => p.name === i.name);
  if (i.name === "verifier" || me?.role === "verifier") return { respawn: true, reason: "the verifier seat is required" };
  // 143 is SIGTERM: an operator (or the launcher itself) stopped the seat on purpose; bench-3 was killed by hand and
  // relaunched three times before this line existed.
  if (i.exitCode === 143 || i.exitCode === null) return { respawn: false, reason: "stopped by signal, not a crash" };
  if (i.exitCode !== 0) return { respawn: true, reason: `exit code ${i.exitCode} is a failure, not completion` };
  const claims = Object.entries(i.room.board).filter(([k, v]) => k.startsWith("claim/") && v.by === i.name).map(([k]) => k);
  const handoffs = new Set(Object.entries(i.room.board).filter(([k, v]) => k.startsWith("handoff/") && v.by === i.name).map(([k]) => k.slice("handoff/".length)));
  const orphaned = claims.filter((k) => !handoffs.has(k.slice("claim/".length)));
  if (orphaned.length && handoffs.size === 0) return { respawn: true, reason: `unfinished ${orphaned[0]} with no handoff/* by ${i.name}` };
  const active = i.room.participants.filter((p) => p.active && p.agent !== "human").length;
  const floor = floorFor(i.room);
  if (active < floor) return { respawn: true, reason: `${active} active seats is below the floor of ${floor}` };
  return { respawn: false, reason: `completed: ${active} active seats (floor ${floor}), ${claims.length ? "claims handed over" : "no claim left behind"}` };
}

/**
 * Launcher-side registration: the launcher (which knows the process exited) calls the hub's
 * POST /rooms/:room/replacements before launching the successor, and passes the returned
 * one-use join proof to the successor in its brief. The launcher credential itself never
 * reaches the successor: it is excluded from seat environments (src/env.ts).
 */
export async function registerRespawn(
  url: string, room: string, previousName: string, name: string,
  token: string | undefined, request: typeof fetch = fetch, reason = "",
): Promise<string> {
  if (!token) throw new Error('Respawn requires CHATROOM_LAUNCHER_TOKEN; refusing to launch an unregistered replacement.');
  const response = await request(`${url}/rooms/${encodeURIComponent(room)}/replacements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-chatroom-launcher-token': token },
    body: JSON.stringify({ replacement_of: previousName, name }),
  });
  if (!response.ok) throw new Error(`Replacement registration failed (${response.status}); refusing to launch an unregistered replacement.`);
  const result = await response.json() as { replacementToken?: unknown };
  if (typeof result.replacementToken !== "string" || !result.replacementToken) throw new Error("Replacement registration returned no join proof.");
  return `\n\nYou replace ${previousName}, who dropped out of this room${reason ? ` (${reason})` : ""}. The launcher has registered this replacement with the hub. On your first join_room call use name=${JSON.stringify(name)} and replacement_token=${JSON.stringify(result.replacementToken)}. This one-use join proof is only for this reserved seat: do not post it to chat or board. Before anything else read the board (board_get) and the recent messages (read_messages since_seq=0 is too much: read the last 40), take over any unfinished claim/* entry of theirs, and say in one line that you have.`;
}
