/**
 * A run's shape from its room logs: how it was launched and which break-outs it opened later, by whom. No record carried
 * it: comparing flat and grouped runs (owner ask 3, swarm-005940-77tu evidence/room-shape) meant inferring the shape from
 * room names and result.json run by run, and who opens break-outs (owner ask 1) meant a hand census. scripts/runs-table.ts
 * --by-run prints it per run.
 */
type Ev = Record<string, any>;

/** launch: "flat" (one <run>-room), "grouped" (groups beside a <run>-leads room, linked to it as parent or fed by a digest
 * seat), "planned" (planner sub-rooms beside a leads room, neither), "single" (anything else). A break-out is a room
 * opened after launch: in a flat run every room but the main one, in a split run a room an opener line names. Its opener
 * is read from the hub's lines in the room it was opened from ("X opened breakout room Y", "X recruited ... into Y"),
 * with the opener's role there; a room no line names has no opener. */
export interface RunShape {
  launch: "flat" | "grouped" | "planned" | "single";
  launchRooms: number;
  breakouts: { room: string; minute: number; by?: string; role?: string }[];
}

export function runShape(logs: readonly (readonly Ev[])[], run = ""): RunShape | undefined {
  const rooms = logs.map((events) => events.find((e) => e.type === "room")).filter((e): e is Ev => !!e?.room)
    .map((e) => ({ name: String(e.room), created: Date.parse(String(e.createdAt ?? "")), parent: e.opts?.parent as string | undefined }))
    .sort((a, b) => (a.created || 0) - (b.created || 0));
  if (!rooms.length) return undefined;
  const names = new Set(rooms.map((r) => r.name));
  // the room an opener line names: the full name, or the new_room as the requester typed it (the hub prefixes the run)
  const resolve = (s: string) => (names.has(s) ? s : rooms.find((r) => r.name.endsWith(`-${s}`))?.name);
  const opened = new Map<string, { by: string; role?: string }>();
  for (const events of logs) {
    const roleOf = new Map<string, string>();
    const chair = events.find((e) => e.type === "room")?.opts?.chair;
    for (const e of events) {
      if (e.type === "join" && e.p?.name) {
        const role = String(e.p.role ?? (e.p.name === chair ? "chair" : "worker"));
        roleOf.set(String(e.p.name), role);
        if (e.p.label) roleOf.set(String(e.p.label), role); // an anonymous room's lines name the label
      }
      if (e.type !== "message" || e.msg?.kind !== "system") continue;
      const text = String(e.msg.content ?? "");
      const m = /^(.+?) opened breakout room ([A-Za-z0-9_-]+)/.exec(text) ?? /^(.+?) recruited .*?\([^)]*?, into ([A-Za-z0-9_-]+)/.exec(text);
      const room = m && resolve(m[2]);
      // an opener with no join line here has no known role (review/8b73d0ed nit 2): shapeText counts it as "unknown"
      const role = roleOf.get(m?.[1] ?? "") ?? (m?.[1] === chair ? "chair" : undefined);
      if (m && room && !opened.has(room)) opened.set(room, { by: m[1], ...(role ? { role } : {}) });
    }
  }
  const main = rooms.find((r) => r.name === `${run}-room`) ?? rooms.find((r) => r.name.endsWith("-room") && !r.parent);
  const leads = rooms.find((r) => r.name === `${run}-leads`) ?? rooms.find((r) => r.name.endsWith("-leads") && !r.parent);
  const head = main ?? leads ?? rooms[0];
  const launched = rooms.filter((r) => r === head || (!main && !opened.has(r.name)));
  const digest = logs.some((events) => events.some((e) => e.type === "join" && /^(digest|consolidator)-\d+$/.test(String(e.p?.name ?? ""))));
  const launch: RunShape["launch"] = main ? "flat"
    : leads && launched.length > 1 ? (launched.some((r) => r.parent === leads.name) || digest ? "grouped" : "planned")
    : "single";
  const t0 = rooms[0].created;
  const breakouts = rooms.filter((r) => !launched.includes(r)).map((r) => ({
    room: r.name, minute: Number.isNaN(t0) || Number.isNaN(r.created) ? 0 : Math.round((r.created - t0) / 60_000),
    ...(opened.get(r.name) ?? {}),
  })).sort((a, b) => a.minute - b.minute);
  return { launch, launchRooms: launched.length, breakouts };
}

/** "flat + 5 break-outs (chair 5)", "grouped (7 rooms)" */
export function shapeText(s?: RunShape): string {
  if (!s) return "-";
  const base = s.launch === "flat" || s.launch === "single" ? s.launch : `${s.launch} (${s.launchRooms} rooms)`;
  if (!s.breakouts.length) return base;
  const by = new Map<string, number>();
  for (const b of s.breakouts) by.set(b.role ?? "unknown", (by.get(b.role ?? "unknown") ?? 0) + 1);
  return `${base} + ${s.breakouts.length} break-out${s.breakouts.length === 1 ? "" : "s"} (${[...by].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(", ")})`;
}

/** One line per run, beside the --by-run totals: the run, its shape, and when each break-out opened and by whom. */
export function renderRunShapes(shapes: { run: string; shape?: RunShape }[]): string {
  let text = "| run | shape | break-outs (minute: opener) |\n|---|---|---|\n";
  for (const { run, shape } of shapes) {
    const list = shape?.breakouts.map((b) => `${b.minute}: ${b.by ?? "?"}${b.role ? ` (${b.role})` : ""}`).join(", ");
    text += `| ${run} | ${shapeText(shape)} | ${list || "-"} |\n`;
  }
  return text;
}


/** Room logs grouped into runs: by the run in the room's name (runOf), except that a room opened from another goes with
 * the room its parent chain starts at. A break-out named without its run's tag (kcj5's swarm-005617-verdict-telemetry,
 * opened from swarm-005617-kcj5-room) otherwise read as a run of its own, and its run missed it (review/8b73d0ed nit 1). */
export function groupRuns<T extends readonly Ev[]>(logs: readonly T[], runOf: (room: string) => string): Map<string, T[]> {
  const roomOf = (events: T) => String(events.find((e) => e.type === "room")?.room ?? "");
  const parent = new Map<string, string>();
  for (const events of logs) {
    const p = events.find((e) => e.type === "room")?.opts?.parent;
    if (p) parent.set(roomOf(events), String(p));
  }
  const root = (room: string) => {
    const seen = new Set<string>();
    while (parent.has(room) && !seen.has(room)) { seen.add(room); room = parent.get(room)!; }
    return room;
  };
  const out = new Map<string, T[]>();
  for (const events of logs) {
    const run = runOf(root(roomOf(events)));
    (out.get(run) ?? out.set(run, []).get(run)!).push(events);
  }
  return out;
}
