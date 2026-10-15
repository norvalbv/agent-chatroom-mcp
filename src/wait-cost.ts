/**
 * What each kind of turn cost, read from the hub's own room logs: every model request a seat made is attributed to the
 * tool result that triggered it. Built for one question the records could not answer (telemetry gap G9): what do empty
 * waits cost? A wait_for_messages that returns nothing still wakes the model, which re-reads its whole context.
 *
 * How: a seat process reports its cumulative usage after each request (`usage` events, keyed by seat-key hash, written to
 * every room the seat sits in, so they are merged and counted once). The trigger of the requests between two samples is
 * the last thing that seat's tools did in that interval: a hub call (`call_completion`: an empty wait, a wait with
 * messages, any other hub tool) or a local tool call (`work`).
 *
 * Limits, all of which undercount waits and none of which invent them: a usage sample covering several requests is
 * attributed whole to the last trigger; the work ledger records a local call only on a new target, so a request after a
 * repeated command (the same sleep again) falls to the hub call before it or to no_tool_seen; a seat with no seat key
 * (not launched by this hub's launcher) reports no usage at all.
 */
type Ev = Record<string, any>;

export type Trigger = "wait_empty" | "wait_msg" | "hub_call" | "local_tool" | "no_tool_seen";
export interface WaitCostRow { trigger: Trigger; requests: number; cost_usd: number; share: number }

export interface ToolCostRow { tool: string; requests: number; cost_usd: number; share: number }

/** The board area a keyed hub call touched: the key's first segment, with inbox notes and their acknowledgements apart
 * (inbox/* vs inbox/*.ack), so the cost of cross-room notes can be read on its own. */
export function keyClass(key: unknown): string | undefined {
  const k = typeof key === "string" ? key : "";
  if (!k) return undefined;
  if (k.startsWith("inbox/")) return k.endsWith(".ack") ? "inbox/*.ack" : "inbox/*";
  const slash = k.indexOf("/");
  return slash > 0 ? `${k.slice(0, slash)}/*` : k.length > 24 ? "(other key)" : k;
}

function attribute(logs: readonly (readonly Ev[])[]): { byTrigger: Map<Trigger, { requests: number; cost: number }>; byTool: Map<string, { requests: number; cost: number }>; byKey: Map<string, { requests: number; cost: number }> } {
  const seatOf = new Map<string, string>(); // participant id -> seat key hash
  for (const events of logs) for (const e of events) if (e.type === "join" && e.p?.id && e.p.seatKeyHash) seatOf.set(e.p.id, e.p.seatKeyHash);
  const triggers = new Map<string, { t: number; trigger: Trigger; tool: string; key?: string }[]>();
  const usage = new Map<string, Map<string, { t: number; requests: number; cost: number }>>();
  const note = (seat: string | undefined, ts: unknown, trigger: Trigger, tool: string, key?: string) => {
    const t = Date.parse(String(ts));
    if (seat && !Number.isNaN(t)) (triggers.get(seat) ?? triggers.set(seat, []).get(seat)!).push({ t, trigger, tool, ...(key ? { key } : {}) });
  };
  for (const events of logs) for (const e of events) {
    if (e.type === "call_completion") note(seatOf.get(e.participant), e.ts, e.tool !== "wait_for_messages" ? "hub_call" : e.empty ? "wait_empty" : "wait_msg", e.tool !== "wait_for_messages" ? String(e.tool) : e.empty ? "wait_for_messages (empty)" : "wait_for_messages (messages)", e.tool !== "wait_for_messages" ? keyClass(e.key) : undefined);
    else if (e.type === "work") note(seatOf.get(e.pid), e.ts, "local_tool", `local ${String(e.tool ?? e.cls ?? "tool")}`);
    else if (e.type === "usage" && e.seat && e.usage) {
      const t = Date.parse(String(e.ts));
      if (!Number.isNaN(t)) (usage.get(e.seat) ?? usage.set(e.seat, new Map()).get(e.seat)!).set(String(e.usage.at ?? e.ts), { t, requests: Number(e.usage.requests ?? 0), cost: Number(e.usage.cost_usd ?? 0) });
    }
  }
  const sum = new Map<Trigger, { requests: number; cost: number }>();
  const byTool = new Map<string, { requests: number; cost: number }>();
  const byKey = new Map<string, { requests: number; cost: number }>();
  for (const [seat, samples] of usage) {
    const seen = (triggers.get(seat) ?? []).sort((a, b) => a.t - b.t);
    let prev: { t: number; requests: number; cost: number } | undefined;
    for (const u of [...samples.values()].sort((a, b) => a.t - b.t)) {
      const before = prev;
      prev = u;
      // the first sample has nothing to difference against; a counter that went down is a new process (respawn)
      if (!before) continue;
      const base = u.requests >= before.requests ? before : { t: before.t, requests: 0, cost: 0 };
      const requests = u.requests - base.requests;
      if (requests <= 0) continue;
      let trigger: Trigger = "no_tool_seen", tool = "(no tool seen)", key: string | undefined;
      for (let i = seen.length - 1; i >= 0; i--) {
        if (seen[i].t > u.t) continue;
        if (seen[i].t >= base.t) { trigger = seen[i].trigger; tool = seen[i].tool; key = seen[i].key; }
        break;
      }
      const rows = [sum.get(trigger) ?? sum.set(trigger, { requests: 0, cost: 0 }).get(trigger)!, byTool.get(tool) ?? byTool.set(tool, { requests: 0, cost: 0 }).get(tool)!];
      if (key) rows.push(byKey.get(`${tool} ${key}`) ?? byKey.set(`${tool} ${key}`, { requests: 0, cost: 0 }).get(`${tool} ${key}`)!);
      for (const row of rows) {
        row.requests += requests;
        row.cost += u.cost - base.cost;
      }
    }
  }
  return { byTrigger: sum, byTool, byKey };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function waitCost(logs: readonly (readonly Ev[])[]): WaitCostRow[] {
  const sum = attribute(logs).byTrigger;
  const total = [...sum.values()].reduce((n, r) => n + r.cost, 0);
  return [...sum].map(([trigger, r]) => ({ trigger, requests: r.requests, cost_usd: round(r.cost, 2), share: total > 0 ? round(r.cost / total, 3) : 0 })).sort((a, b) => b.cost_usd - a.cost_usd);
}

/** The same requests by the tool whose result woke the model: which hub tools and which local tools the turns went on. */
export function costByTool(logs: readonly (readonly Ev[])[]): ToolCostRow[] {
  const by = attribute(logs).byTool;
  const total = [...by.values()].reduce((n, r) => n + r.cost, 0);
  return [...by].map(([tool, r]) => ({ tool, requests: r.requests, cost_usd: round(r.cost, 2), share: total > 0 ? round(r.cost / total, 3) : 0 })).sort((a, b) => b.cost_usd - a.cost_usd);
}

/** Keyed hub calls (board_get, board_set) by the tool and the board area they touched, e.g. "board_set inbox/*.ack":
 * what reading and acknowledging cross-room notes cost next to the rest of the board traffic. */
export function costByKey(logs: readonly (readonly Ev[])[]): ToolCostRow[] {
  const { byKey, byTool } = attribute(logs);
  const total = [...byTool.values()].reduce((n, r) => n + r.cost, 0);
  return [...byKey].map(([tool, r]) => ({ tool, requests: r.requests, cost_usd: round(r.cost, 2), share: total > 0 ? round(r.cost / total, 3) : 0 })).sort((a, b) => b.cost_usd - a.cost_usd);
}

export interface TrafficRow { tool: string; calls: number; result_chars: number; args_chars: number; share: number }

/** What the hub put into seats' contexts, by tool: the summed size of every call's result (call_completion result_chars,
 * recorded by hub builds from swarm-092526-89rn on; older logs have none and return no rows). A result stays in the seat's context and
 * is re-read on every later request until compaction, so this is the room's share of what seats carry. */
export function roomTraffic(logs: readonly (readonly Ev[])[]): TrafficRow[] {
  const by = new Map<string, { calls: number; result: number; args: number }>();
  for (const events of logs) for (const e of events) {
    if (e.type !== "call_completion" || typeof e.result_chars !== "number" || !e.participant) continue;
    const tool = e.tool === "wait_for_messages" ? (e.empty ? "wait_for_messages (empty)" : "wait_for_messages (messages)") : String(e.tool);
    const row = by.get(tool) ?? by.set(tool, { calls: 0, result: 0, args: 0 }).get(tool)!;
    row.calls++; row.result += e.result_chars; row.args += Number(e.args_chars ?? 0);
  }
  const total = [...by.values()].reduce((n, r) => n + r.result, 0);
  return [...by].map(([tool, r]) => ({ tool, calls: r.calls, result_chars: r.result, args_chars: r.args, share: total > 0 ? round(r.result / total, 3) : 0 })).sort((a, b) => b.result_chars - a.result_chars);
}

/** Room traffic against everything written into seats' contexts: hub result tokens (chars / 4, an estimate) over the
 * cache-write and uncached input tokens the seats' usage reports (each new token enters the context once as one of
 * those). The rest is the seat's own work: its prompt, its local tool results, its own output. A respawned seat process
 * (counter going down) starts a new sum. */
export function trafficShare(logs: readonly (readonly Ev[])[]): { hub_tokens_est: number; context_written_tokens: number; share?: number } {
  const hubChars = roomTraffic(logs).reduce((n, r) => n + r.result_chars, 0);
  const last = new Map<string, Map<string, number>>(); // seat -> sample at -> written so far
  for (const events of logs) for (const e of events) if (e.type === "usage" && e.seat && e.usage) {
    const w = Number(e.usage.cache_creation_input_tokens ?? 0) + Number(e.usage.input_tokens ?? 0);
    (last.get(e.seat) ?? last.set(e.seat, new Map()).get(e.seat)!).set(String(e.usage.at ?? e.ts), w);
  }
  let written = 0;
  for (const samples of last.values()) {
    let prev = 0;
    for (const w of samples.values()) { written += w >= prev ? w - prev : w; prev = w; }
  }
  const hub = Math.round(hubChars / 4);
  return { hub_tokens_est: hub, context_written_tokens: written, ...(written > 0 && hubChars > 0 ? { share: round(hub / written, 3) } : {}) };
}

/** How long empty waits were held before returning nothing: a seat on a held connection (?hold=, src/env.ts) shows
 * minutes here, any other seat about 55 s. Read from call_completion events (ms, empty). */
export function emptyWaits(logs: readonly (readonly Ev[])[]): { waits: number; empty: number; median_empty_s?: number; empty_seat_minutes: number } {
  const all = logs.flatMap((events) => events.filter((e) => e.type === "call_completion" && e.tool === "wait_for_messages" && e.participant));
  const held = all.filter((e) => e.empty === true).map((e) => Number(e.ms ?? 0) / 1000).sort((a, b) => a - b);
  return { waits: all.length, empty: held.length, ...(held.length ? { median_empty_s: Math.round(held[Math.floor(held.length / 2)]) } : {}), empty_seat_minutes: Math.round(held.reduce((n, x) => n + x, 0) / 60) };
}

export function renderWaitCost(rows: readonly WaitCostRow[]): string {
  const total = rows.reduce((n, r) => n + r.cost_usd, 0), requests = rows.reduce((n, r) => n + r.requests, 0);
  let text = `${requests} model requests, $${total.toFixed(2)}, by what triggered each (the tool result the model woke on).\n\n| trigger | requests | cost | share | $ per request |\n|---|---|---|---|---|\n`;
  for (const r of rows) text += `| ${r.trigger} | ${r.requests} | $${r.cost_usd.toFixed(2)} | ${Math.round(r.share * 100)}% | $${(r.requests ? r.cost_usd / r.requests : 0).toFixed(3)} |\n`;
  return text;
}
