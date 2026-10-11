/**
 * Which guard refused which tool, and whether the seat got through afterwards. A refusal is "recovered" when the same
 * participant completed the same tool successfully within RECOVERY_MS of it; one that is not is work the seat dropped
 * (evidence pack item 3: refused messages that were never re-sent). Read from the hub's own room log: `refusal` events
 * carry the closed-enum code (src/hub/types.ts REFUSAL_CODES), `call_completion` events the later success.
 * LH-Bench (arXiv:2603.22744, sources/2603.22744) found recovery depends on the kind of feedback, not how often it fires,
 * which is why this counts recovery per code and not only refusals per tool.
 */
type Ev = Record<string, any>;

export const RECOVERY_MS = 5 * 60_000;

export interface RefusalRow { tool: string; reason: string; refused: number; recovered: number; median_recovery_s?: number }

export function refusalTable(events: readonly Ev[], recoveryMs = RECOVERY_MS): RefusalRow[] {
  const ok = new Map<string, number[]>(); // participant|tool -> success times
  for (const e of events) {
    if (e.type !== "call_completion" || e.outcome !== "success" || !e.participant || !e.ts) continue;
    const k = `${e.participant}|${e.tool}`;
    (ok.get(k) ?? ok.set(k, []).get(k)!).push(Date.parse(e.ts as string));
  }
  const rows = new Map<string, RefusalRow & { waits: number[] }>();
  for (const e of events) {
    if (e.type !== "refusal") continue;
    const tool = String(e.tool), reason = String(e.reason ?? "hub_guard");
    const row = rows.get(`${tool}|${reason}`) ?? rows.set(`${tool}|${reason}`, { tool, reason, refused: 0, recovered: 0, waits: [] }).get(`${tool}|${reason}`)!;
    row.refused++;
    const t = e.ts ? Date.parse(e.ts as string) : NaN;
    if (!e.participant || Number.isNaN(t)) continue;
    const next = (ok.get(`${e.participant}|${tool}`) ?? []).find((s) => s >= t && s - t <= recoveryMs);
    if (next !== undefined) { row.recovered++; row.waits.push((next - t) / 1000); }
  }
  return [...rows.values()].sort((a, b) => b.refused - a.refused).map(({ waits, ...r }) => {
    const w = waits.sort((a, b) => a - b);
    return w.length ? { ...r, median_recovery_s: Math.round(w[Math.floor(w.length / 2)]) } : r;
  });
}

export function renderRefusalTable(rows: readonly RefusalRow[]): string {
  const total = rows.reduce((n, r) => n + r.refused, 0);
  const untyped = rows.filter((r) => r.reason === "hub_guard").reduce((n, r) => n + r.refused, 0);
  let text = `${total} refusals, ${untyped} untyped (hub_guard). Recovered: the same seat completed the same tool within ${RECOVERY_MS / 60_000} min.\n\n` +
    "| tool | code | refused | recovered | median s to recover |\n|---|---|---|---|---|\n";
  for (const r of rows) text += `| ${r.tool} | ${r.reason} | ${r.refused} | ${r.recovered} | ${r.median_recovery_s ?? "-"} |\n`;
  return text;
}
