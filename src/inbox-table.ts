/**
 * What a room's log says about the notes other rooms sent it: how many, how fast they were acknowledged, whether the
 * acknowledgement said anything, and how long the room could not be sent a note at all. Offline: reads events, no hub.
 *
 * Why: a full inbox cut 0btz-build off for 49 minutes and 1nwp-external for 28.5 and nothing in the record said so
 * (evidence-pack item 2; telemetry gap "whether a note was used"). An acknowledgement shows receipt, not use; the
 * nearest thing the log holds is whether the ack was a bare "ack" or a reply, and how long it took.
 */
type Ev = Record<string, any>;

export interface InboxRow {
  room: string;
  /** note writes that reached the board (a rewrite of the same key is a new note: it reopens) */
  notes: number;
  required: number;
  optional: number;
  /** notes acknowledged before they were replaced or the log ended */
  acked: number;
  /** ack-required notes never acknowledged (replaced unacknowledged, or still open at the end) */
  requiredUnacked: number;
  /** minutes from a note landing to its first acknowledgement */
  ackMedianMin?: number;
  ackP90Min?: number;
  /** first acknowledgements that only say "ack" and ones that say more (a reply: the nearest record of use) */
  bareAcks: number;
  replyAcks: number;
  /** post_to_room refused by this room's cap, logged here (inbox_refused; hubs from 81d4f9c2 on) */
  refused: number;
  /** acknowledgement writes the hub refused (two seats acknowledging one note) */
  ackRefusals: number;
  /** minutes with 10 or more notes open counting every note (the rule before 81d4f9c2) and counting only ack-required ones (the rule since): what the same traffic costs under each */
  fullMinAllNotes: number;
  fullMinRequiredOnly: number;
}

const CAP = 10;
const BARE = /^\s*(ack(nowledged)?|ok(ay)?|seen|received|read|noted|done|thanks?)[\s.!]*$/i;
const round1 = (x: number) => Math.round(x * 10) / 10;
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const stamp = (e: Ev): number => Date.parse(e.entry?.updatedAt ?? e.ts ?? e.msg?.ts ?? e.createdAt ?? "");

export function inboxRow(events: readonly Ev[]): InboxRow {
  const row: InboxRow = { room: "", notes: 0, required: 0, optional: 0, acked: 0, requiredUnacked: 0, bareAcks: 0, replyAcks: 0, refused: 0, ackRefusals: 0, fullMinAllNotes: 0, fullMinRequiredOnly: 0 };
  const open = new Map<string, { at: number; required: boolean }>();
  const latencies: number[] = [];
  let last = NaN, fullAllSince: number | undefined, fullReqSince: number | undefined, end = NaN;
  const tick = (t: number) => {
    if (Number.isNaN(t)) return;
    const all = open.size, req = [...open.values()].filter((n) => n.required).length;
    if (all >= CAP) fullAllSince ??= t; else if (fullAllSince !== undefined) { row.fullMinAllNotes += (t - fullAllSince) / 60_000; fullAllSince = undefined; }
    if (req >= CAP) fullReqSince ??= t; else if (fullReqSince !== undefined) { row.fullMinRequiredOnly += (t - fullReqSince) / 60_000; fullReqSince = undefined; }
  };
  for (const e of events) {
    if (e.type === "room") row.room ||= String(e.room ?? "");
    const t = stamp(e);
    if (!Number.isNaN(t)) last = t;
    // once the room concludes it can be sent nothing anyway: the cap clock stops there
    if (e.type === "state" && (e.state === "concluded" || e.state === "closed") && Number.isNaN(end)) end = Number.isNaN(t) ? last : t;
    if (e.type === "inbox_refused") row.refused++;
    if (e.type === "call_completion" && e.tool === "board_set" && e.outcome === "hub_refusal" && /^inbox\/.*\.ack$/.test(String(e.key ?? ""))) row.ackRefusals++;
    if (e.type !== "board" || !String(e.key ?? "").startsWith("inbox/")) continue;
    const key = String(e.key);
    if (key.endsWith(".ack")) {
      const note = open.get(key.slice(0, -4));
      if (e.entry && note) {
        open.delete(key.slice(0, -4));
        row.acked++;
        latencies.push((t - note.at) / 60_000);
        // an appended reply ("ack\n— name: ...") is a reply; so is anything beyond a bare word
        if (BARE.test(String(e.entry.text ?? ""))) row.bareAcks++; else row.replyAcks++;
      }
      tick(t);
      continue;
    }
    const prev = open.get(key);
    if (prev?.required) row.requiredUnacked++;
    if (!e.entry) { open.delete(key); tick(t); continue; }
    row.notes++;
    if (e.entry.ackRequired) row.required++; else row.optional++;
    open.set(key, { at: t, required: !!e.entry.ackRequired });
    tick(t);
  }
  const stop = Number.isNaN(end) ? last : end;
  if (fullAllSince !== undefined && stop > fullAllSince) row.fullMinAllNotes += (stop - fullAllSince) / 60_000;
  if (fullReqSince !== undefined && stop > fullReqSince) row.fullMinRequiredOnly += (stop - fullReqSince) / 60_000;
  row.requiredUnacked += [...open.values()].filter((n) => n.required).length;
  row.fullMinAllNotes = round1(row.fullMinAllNotes);
  row.fullMinRequiredOnly = round1(row.fullMinRequiredOnly);
  if (latencies.length) { row.ackMedianMin = round1(quantile(latencies, 0.5)); row.ackP90Min = round1(quantile(latencies, 0.9)); }
  return row;
}

export function renderInboxTable(rows: InboxRow[]): string {
  const v = (x: number | undefined) => (x === undefined ? "-" : String(x));
  let text = "| room | notes (ack-required / optional) | acked | ack-required never acked | ack median / p90 (min) | bare / reply acks | refused at the cap | refused ack writes | min full, every note counted | min full, ack-required only |\n|---|---|---|---|---|---|---|---|---|---|\n";
  for (const r of rows) text += `| ${r.room} | ${r.notes} (${r.required} / ${r.optional}) | ${r.acked} | ${r.requiredUnacked} | ${v(r.ackMedianMin)} / ${v(r.ackP90Min)} | ${r.bareAcks} / ${r.replyAcks} | ${r.refused} | ${r.ackRefusals} | ${r.fullMinAllNotes} | ${r.fullMinRequiredOnly} |\n`;
  return text;
}
