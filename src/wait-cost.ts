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
    // a wait that says why it returned (call_completion.woke, hub builds from claim/redundant-calls on) is split by it:
    // "wait_for_messages (notices)" is a held wait that ended with only board notices, a wake nobody had to act on
    if (e.type === "call_completion") note(seatOf.get(e.participant), e.ts, e.tool !== "wait_for_messages" ? "hub_call" : e.empty ? "wait_empty" : "wait_msg", e.tool !== "wait_for_messages" ? String(e.tool) : e.empty ? "wait_for_messages (empty)" : `wait_for_messages (${typeof e.woke === "string" && e.woke !== "empty" ? e.woke : "messages"})`, e.tool !== "wait_for_messages" ? keyClass(e.key) : undefined);
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
  for (const events of logs) for (let e of events) {
    if (e.type === "steer_injected") e = { tool: "(asks injected mid-turn by the seat's hook)", result_chars: Number(e.chars ?? 0), participant: e.participant, type: "call_completion" };
    if (e.type !== "call_completion" || typeof e.result_chars !== "number" || !e.participant) continue;
    const tool = e.tool === "wait_for_messages" ? (e.empty ? "wait_for_messages (empty)" : "wait_for_messages (messages)") : String(e.tool);
    const row = by.get(tool) ?? by.set(tool, { calls: 0, result: 0, args: 0 }).get(tool)!;
    row.calls++; row.result += e.result_chars; row.args += Number(e.args_chars ?? 0);
  }
  const total = [...by.values()].reduce((n, r) => n + r.result, 0);
  return [...by].map(([tool, r]) => ({ tool, calls: r.calls, result_chars: r.result, args_chars: r.args, share: total > 0 ? round(r.result / total, 3) : 0 })).sort((a, b) => b.result_chars - a.result_chars);
}

/** Room traffic against the new content written into seats' contexts: hub result tokens (chars / 4, an estimate and a
 * lower bound for JSON) over the uncached input and cache-write tokens the seats' usage reports. A sample interval whose
 * writes are most of the context it sent (over half of it, and over 20k tokens a request) is a rewrite of context
 * already there, after an account switch, a cache expiry or a compaction, not new content: it is left out of the
 * denominator and reported as rewritten_tokens. Samples are keyed by their own stamp, so a seat whose usage is logged in
 * two rooms is counted once, and put in time order; a counter that goes down is a new seat process. */
export function trafficShare(logs: readonly (readonly Ev[])[]): { hub_tokens_est: number; context_written_tokens: number; rewritten_tokens: number; share?: number } {
  const hubChars = roomTraffic(logs).reduce((n, r) => n + r.result_chars, 0);
  const bySeat = new Map<string, Map<string, { t: number; requests: number; write: number; sent: number }>>();
  for (const events of logs) for (const e of events) if (e.type === "usage" && e.seat && e.usage) {
    const u = e.usage, n = (k: string) => Number(u[k] ?? 0), at = String(u.at ?? e.ts);
    const write = n("cache_creation_input_tokens") + n("input_tokens");
    (bySeat.get(e.seat) ?? bySeat.set(e.seat, new Map()).get(e.seat)!).set(at, { t: Date.parse(String(e.ts ?? at)), requests: n("requests"), write, sent: write + n("cache_read_input_tokens") });
  }
  let written = 0, rewritten = 0;
  for (const samples of bySeat.values()) {
    let prev = { requests: 0, write: 0, sent: 0 };
    for (const u of [...samples.values()].sort((a, b) => a.t - b.t)) {
      const base = u.requests >= prev.requests ? prev : { requests: 0, write: 0, sent: 0 };
      const write = u.write - base.write, sent = u.sent - base.sent, requests = Math.max(1, u.requests - base.requests);
      // a process start (base zero) writes its prompt and tool-schema prefix: new content, never a rewrite
      if (base.requests > 0 && write > sent / 2 && write / requests > 20_000) rewritten += write; else written += write;
      prev = u;
    }
  }
  const hub = Math.round(hubChars / 4);
  return { hub_tokens_est: hub, context_written_tokens: written, rewritten_tokens: rewritten, ...(written > 0 && hubChars > 0 ? { share: round(hub / written, 3) } : {}) };
}

/** What the share above costs: a hub result is re-read by every later request of the same seat process, so its tokens
 * times those requests, over all the cache-read tokens the seats paid for. Compaction is not modelled (a result is
 * counted as re-read until its process ends), so this is an upper bound where trafficShare is a lower one. */
export function trafficReread(logs: readonly (readonly Ev[])[]): { hub_reread_tokens_est: number; cache_read_tokens: number; share?: number } {
  const seatOf = new Map<string, string>();
  for (const events of logs) for (const e of events) if (e.type === "join" && e.p?.id && e.p.seatKeyHash) seatOf.set(e.p.id, e.p.seatKeyHash);
  const samples = new Map<string, Map<string, { t: number; requests: number; read: number }>>();
  const results = new Map<string, { t: number; chars: number }[]>();
  for (const events of logs) for (const e of events) {
    if (e.type === "usage" && e.seat && e.usage) (samples.get(e.seat) ?? samples.set(e.seat, new Map()).get(e.seat)!).set(String(e.usage.at ?? e.ts), { t: Date.parse(String(e.ts)), requests: Number(e.usage.requests ?? 0), read: Number(e.usage.cache_read_input_tokens ?? 0) });
    const chars = e.type === "call_completion" ? e.result_chars : e.type === "steer_injected" ? e.chars : undefined;
    const seat = seatOf.get(e.participant);
    if (typeof chars === "number" && seat) (results.get(seat) ?? results.set(seat, []).get(seat)!).push({ t: Date.parse(String(e.ts)), chars });
  }
  let reread = 0, read = 0;
  for (const [seat, byAt] of samples) {
    // split into processes (a counter going down starts one), each with its requests over time
    const procs: { t: number; requests: number }[][] = [];
    let prev: { requests: number; read: number } | undefined;
    for (const u of [...byAt.values()].sort((a, b) => a.t - b.t)) {
      if (!prev || u.requests < prev.requests) { procs.push([]); prev = { requests: 0, read: 0 }; }
      read += u.read - prev.read;
      procs[procs.length - 1].push(u);
      prev = u;
    }
    for (const r of results.get(seat) ?? []) {
      // before the first sample it is the first process's; between two processes it is unknown and dropped
      const proc = procs.find((p) => p.length && p[0].t <= r.t && r.t <= p[p.length - 1].t) ?? (procs[0]?.length && r.t < procs[0][0].t ? procs[0] : undefined);
      if (!proc) continue;
      const at = [...proc].reverse().find((u) => u.t <= r.t)?.requests ?? 0;
      reread += (r.chars / 4) * Math.max(0, proc[proc.length - 1].requests - at);
    }
  }
  return { hub_reread_tokens_est: Math.round(reread), cache_read_tokens: read, ...(read > 0 && reread > 0 ? { share: round(reread / read, 3) } : {}) };
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
