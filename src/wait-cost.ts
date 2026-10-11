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

function attribute(logs: readonly (readonly Ev[])[]): { byTrigger: Map<Trigger, { requests: number; cost: number }>; byTool: Map<string, { requests: number; cost: number }> } {
  const seatOf = new Map<string, string>(); // participant id -> seat key hash
  for (const events of logs) for (const e of events) if (e.type === "join" && e.p?.id && e.p.seatKeyHash) seatOf.set(e.p.id, e.p.seatKeyHash);
  const triggers = new Map<string, { t: number; trigger: Trigger; tool: string }[]>();
  const usage = new Map<string, Map<string, { t: number; requests: number; cost: number }>>();
  const note = (seat: string | undefined, ts: unknown, trigger: Trigger, tool: string) => {
    const t = Date.parse(String(ts));
    if (seat && !Number.isNaN(t)) (triggers.get(seat) ?? triggers.set(seat, []).get(seat)!).push({ t, trigger, tool });
  };
  for (const events of logs) for (const e of events) {
    if (e.type === "call_completion") note(seatOf.get(e.participant), e.ts, e.tool !== "wait_for_messages" ? "hub_call" : e.empty ? "wait_empty" : "wait_msg", e.tool !== "wait_for_messages" ? String(e.tool) : e.empty ? "wait_for_messages (empty)" : "wait_for_messages (messages)");
    else if (e.type === "work") note(seatOf.get(e.pid), e.ts, "local_tool", `local ${String(e.tool ?? e.cls ?? "tool")}`);
    else if (e.type === "usage" && e.seat && e.usage) {
      const t = Date.parse(String(e.ts));
      if (!Number.isNaN(t)) (usage.get(e.seat) ?? usage.set(e.seat, new Map()).get(e.seat)!).set(String(e.usage.at ?? e.ts), { t, requests: Number(e.usage.requests ?? 0), cost: Number(e.usage.cost_usd ?? 0) });
    }
  }
  const sum = new Map<Trigger, { requests: number; cost: number }>();
  const byTool = new Map<string, { requests: number; cost: number }>();
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
      let trigger: Trigger = "no_tool_seen", tool = "(no tool seen)";
      for (let i = seen.length - 1; i >= 0; i--) {
        if (seen[i].t > u.t) continue;
        if (seen[i].t >= base.t) { trigger = seen[i].trigger; tool = seen[i].tool; }
        break;
      }
      for (const row of [sum.get(trigger) ?? sum.set(trigger, { requests: 0, cost: 0 }).get(trigger)!, byTool.get(tool) ?? byTool.set(tool, { requests: 0, cost: 0 }).get(tool)!]) {
        row.requests += requests;
        row.cost += u.cost - base.cost;
      }
    }
  }
  return { byTrigger: sum, byTool };
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
