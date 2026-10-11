/** Did the seats the launcher started reach their rooms? No hub import: the launcher asks over HTTP. */

export interface LaunchedSeat { name: string; room: string }
export interface JoinCheck {
  /** seats with no participant of their name in their room, ever (a seat that joined and left is not missing) */
  missing: LaunchedSeat[];
  /** rooms the hub could not be asked about */
  unknown: string[];
  /** true when no launched seat is in any room: the hub is refusing connections, and every seat is working alone */
  none: boolean;
}

/**
 * In swarm-100737-qx7g the hub answered every MCP initialize with HTTP 400; the launcher still created the room and
 * ran five seats, which worked uncoordinated in one checkout and overwrote each other (bugs.md 2). Nothing compared
 * the seats it started with the seats that arrived. `names` reads a room's participant names, or undefined on failure.
 */
export async function checkJoined(seats: readonly LaunchedSeat[], names: (room: string) => Promise<string[] | undefined>): Promise<JoinCheck> {
  const rooms = [...new Set(seats.map((s) => s.room))];
  const present = new Map<string, Set<string> | undefined>();
  for (const room of rooms) {
    const list = await names(room).catch(() => undefined);
    present.set(room, list ? new Set(list) : undefined);
  }
  const unknown = rooms.filter((r) => !present.get(r));
  const asked = seats.filter((s) => present.get(s.room));
  const missing = asked.filter((s) => !present.get(s.room)!.has(s.name));
  return { missing, unknown, none: asked.length > 0 && missing.length === asked.length };
}

/** The room's participant names from the hub's status endpoint (departed seats included); undefined when the hub cannot be asked. */
export const roomNames = (url: string) => async (room: string): Promise<string[] | undefined> => {
  const r = await fetch(`${url}/rooms/${encodeURIComponent(room)}`, { signal: AbortSignal.timeout(5_000) });
  // a room the hub has never heard of is one nobody joined (flat runs are created by the first seat to arrive)
  if (r.status === 404) return [];
  if (!r.ok) return undefined;
  const body = (await r.json()) as { participants?: { name?: string }[] };
  return (body.participants ?? []).map((p) => String(p.name ?? ""));
};

/** Lines for the launcher's log and the run's collectionErrors; empty when every seat arrived. */
export function joinLines(c: JoinCheck, afterS: number): string[] {
  const out: string[] = [];
  if (c.none) out.push(`NO SEAT JOINED its room within ${afterS} s (${c.missing.map((s) => s.name).join(", ")}): the hub is not accepting their connections, so they are working alone and uncoordinated`);
  else if (c.missing.length) out.push(`${c.missing.length} seat(s) had not joined ${afterS} s after launch: ${c.missing.map((s) => `${s.name} (${s.room})`).join(", ")}`);
  if (c.unknown.length) out.push(`could not ask the hub who is in ${c.unknown.join(", ")}`);
  return out;
}
