/**
 * How often an amend made a seat say its objection again, read from room logs (decision/verifier-hold, chair note 3).
 * Before the disagree carry, every amend dropped every disagree; a seat whose objection still stood had to re-cast it on
 * the next version (9f66's verifier did so five times while it waited on three breakout slots). After it, a disagree that
 * quotes a clause the amend kept is carried, and the amend event lists it in carried_disagrees. Per room:
 *   amends; disagrees an amend dropped; how many of those the same seat re-cast as a disagree on a later version (the
 *   repeat the carry removes when the seat quoted), agreed, or never voted again; disagrees carried; hold/* writes; and,
 *   for the verifier, wait_for_messages returns while its own disagree stood on the current text (median ms), the wakes
 *   a held wait should not have had.
 *   npx tsx scripts/vote-recast.ts <data/room.jsonl>... [--json]
 * Reads each file as a stream; a room with no amend prints nothing unless --all.
 */
import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";

type Entry = { vote: string; quote?: string; version?: number; name?: string };
export interface RecastRow {
  room: string; amends: number; dropped: number; recast: number; agreed: number; silent: number;
  carried: number; holds: number; verifier_waits_while_disagreeing: number; verifier_wait_median_ms: number | null;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export async function recastRow(file: string): Promise<RecastRow> {
  const votes = new Map<string, Record<string, Entry>>();
  const pending: { pid: string; prop: string; next?: string }[] = [];
  const row: RecastRow = { room: file.split("/").pop()!.replace(/\.jsonl$/, ""), amends: 0, dropped: 0, recast: 0, agreed: 0, silent: 0, carried: 0, holds: 0, verifier_waits_while_disagreeing: 0, verifier_wait_median_ms: null };
  const verifiers = new Set<string>();
  const waits: number[] = [];
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!/"type":"(vote|amend|proposal|join|board|call_completion)"/.test(line)) continue;
    let e: Record<string, any>;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "join" && e.p?.role === "verifier") verifiers.add(e.p.id);
    else if (e.type === "proposal" && e.proposal?.id) votes.set(e.proposal.id, { ...(e.proposal.votes ?? {}) });
    else if (e.type === "vote") {
      const vs = votes.get(e.proposalId) ?? {};
      for (const d of pending) if (d.pid === e.pid && d.prop === e.proposalId && d.next === undefined) d.next = e.entry?.vote;
      vs[e.pid] = e.entry;
      votes.set(e.proposalId, vs);
    } else if (e.type === "amend") {
      row.amends++;
      const before = votes.get(e.proposalId) ?? {};
      const kept: Record<string, Entry> = e.votes ?? {};
      for (const [pid, v] of Object.entries(before)) {
        if (v.vote !== "disagree") continue;
        if (kept[pid]?.vote === "disagree") { row.carried++; continue; }
        row.dropped++;
        pending.push({ pid, prop: e.proposalId });
      }
      votes.set(e.proposalId, { ...kept });
    } else if (e.type === "board" && typeof e.key === "string" && e.key.startsWith("hold/") && e.entry?.text?.trim()) row.holds++;
    else if (e.type === "call_completion" && e.tool === "wait_for_messages" && verifiers.has(e.participant)) {
      // its own disagree on the open proposal's current text: stands per the amend events above
      const standing = [...votes.values()].some((vs) => vs[e.participant]?.vote === "disagree");
      if (standing && typeof e.ms === "number") waits.push(e.ms);
    }
  }
  for (const d of pending) {
    if (d.next === "disagree") row.recast++;
    else if (d.next === "agree") row.agreed++;
    else if (d.next === undefined) row.silent++;
  }
  row.verifier_waits_while_disagreeing = waits.length;
  row.verifier_wait_median_ms = median(waits);
  return row;
}

const isMain = process.argv[1] && /vote-recast\.ts$/.test(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  const files = argv.filter((a) => !a.startsWith("--"));
  const bad = files.filter((f) => !statSync(f, { throwIfNoEntry: false })?.isFile());
  if (!files.length || bad.length || argv.includes("--help")) {
    console.error(bad.length ? `vote-recast: not a room log file: ${bad.join(", ")}` : "usage: vote-recast <room.jsonl>... [--json] [--all]");
    process.exit(argv.includes("--help") ? 0 : 2);
  }
  const rows: RecastRow[] = [];
  for (const f of files) rows.push(await recastRow(f));
  const shown = argv.includes("--all") ? rows : rows.filter((r) => r.amends > 0);
  const sum = (k: keyof RecastRow) => rows.reduce((n, r) => n + (r[k] as number), 0);
  const total = { rooms: rows.length, amends: sum("amends"), dropped: sum("dropped"), recast: sum("recast"), agreed: sum("agreed"), silent: sum("silent"), carried: sum("carried"), holds: sum("holds") };
  if (argv.includes("--json")) console.log(JSON.stringify({ total, rows: shown }, null, 2));
  else {
    console.log("| room | amends | disagrees dropped | re-cast | then agreed | never re-voted | carried | hold/* writes | verifier waits while disagreeing (median ms) |\n|---|---|---|---|---|---|---|---|---|");
    for (const r of shown) console.log(`| ${r.room} | ${r.amends} | ${r.dropped} | ${r.recast} | ${r.agreed} | ${r.silent} | ${r.carried} | ${r.holds} | ${r.verifier_waits_while_disagreeing}${r.verifier_wait_median_ms === null ? "" : ` (${r.verifier_wait_median_ms})`} |`);
    console.log(`\n${total.rooms} room logs: ${total.amends} amends dropped ${total.dropped} disagrees; the same seat re-cast ${total.recast} of them, agreed after ${total.agreed}, never voted again on ${total.silent}. ${total.carried} disagrees carried by an amend. ${total.holds} hold/* writes.`);
  }
}
