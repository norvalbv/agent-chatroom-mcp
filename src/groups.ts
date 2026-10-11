/** --groups <file.json>: the groups of a run as the operator wrote them, in place of the planner's. Each group gets its
 * own room and its own brief, so two groups can hold opposing briefs (one builds a case, one tries to break it) and talk
 * only among themselves; what crosses between them is what someone posts with post_to_room.
 *
 *   { "done_when": "...", "verifier_directive": "...",
 *     "groups": [ { "id": "build", "title": "Build the case", "workers": 2, "brief": "..." }, ... ] }
 */
import { readFileSync } from "node:fs";

export interface GroupsFile {
  done_when?: string;
  verifier_directive?: string;
  groups: { id: string; title: string; workers: number; directive: string }[];
}

/** Reads and checks a groups file. Throws with the reason a run from it could not work: a room of one cannot conclude,
 * and a group's id names its room. */
export function loadGroups(file: string): GroupsFile {
  let raw: { done_when?: unknown; verifier_directive?: unknown; groups?: unknown };
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`--groups ${file}: ${(e as NodeJS.ErrnoException).code === "ENOENT" ? "no such file" : `not valid JSON (${e instanceof Error ? e.message : String(e)})`}`);
  }
  if (!Array.isArray(raw.groups) || !raw.groups.length) throw new Error(`--groups ${file}: needs a non-empty "groups" array`);
  const seen = new Set<string>();
  const groups = (raw.groups as Record<string, unknown>[]).map((g, i) => {
    const id = String(g.id ?? "");
    if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(id)) throw new Error(`--groups ${file}: group ${i + 1} needs an id of lower-case letters, digits and hyphens (it names the group's room)`);
    if (seen.has(id)) throw new Error(`--groups ${file}: id "${id}" is used twice`);
    seen.add(id);
    const brief = typeof g.brief === "string" ? g.brief.trim() : "";
    if (!brief) throw new Error(`--groups ${file}: group "${id}" needs a brief`);
    const workers = Number(g.workers ?? 2);
    if (!Number.isInteger(workers) || workers < 2) throw new Error(`--groups ${file}: group "${id}" needs at least 2 workers (a room of one cannot conclude)`);
    return { id, title: typeof g.title === "string" && g.title.trim() ? g.title.trim() : id, workers, directive: brief };
  });
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { done_when: text(raw.done_when), verifier_directive: text(raw.verifier_directive), groups };
}

/** One consolidation pass as the run's result records it: what the launcher saw (when, cost) and what the pass left on
 * the consolidation room's board as the JSON first line of digest/<n> (null when the seat never wrote one). */
export interface DigestRecord {
  pass: number;
  name: string;
  started_at: string;
  finished_at: string | null;
  cost_usd: number | null;
  /** digest/<n> exists on the consolidation room's board */
  written: boolean;
  sent: string[];
  no_position: string[];
  unacknowledged: string[];
}
/** A group's latest digest note at the end of the run: when it was sent and how long the group took to acknowledge it. */
export interface DigestAck { room: string; sent_at: string | null; acked_at: string | null; ack_seconds: number | null }

interface BoardView { [key: string]: { text?: string; updated_at?: string } }
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Joins the launcher's own record of each pass with the head line the pass wrote. A head that is not JSON counts as
 * written with nothing reported, never as a pass that sent to nobody. */
export function digestRecords(passes: readonly { pass: number; name: string; startedAt: string; finishedAt?: string; cost?: number | null }[], leadsBoard: BoardView | undefined): DigestRecord[] {
  return passes.map((p) => {
    const entry = leadsBoard?.[`digest/${p.pass}`];
    let head: Record<string, unknown> = {};
    try { head = JSON.parse((entry?.text ?? "").split("\n")[0]) as Record<string, unknown>; } catch {}
    return { pass: p.pass, name: p.name, started_at: p.startedAt, finished_at: p.finishedAt ?? null, cost_usd: p.cost ?? null, written: !!entry?.text?.trim(), sent: names(head.sent), no_position: names(head.no_position), unacknowledged: names(head.unacknowledged) };
  });
}

/** The state of each group's inbox/<leads>/digest note. An ack older than the note belongs to an earlier pass. */
export function digestAcks(leadsRoom: string, groupBoards: Readonly<Record<string, BoardView | undefined>>): DigestAck[] {
  return Object.entries(groupBoards).map(([room, board]) => {
    const note = board?.[`inbox/${leadsRoom}/digest`], ack = board?.[`inbox/${leadsRoom}/digest.ack`];
    const sent = note?.updated_at ?? null;
    const acked = sent && ack?.updated_at && ack.updated_at >= sent ? ack.updated_at : null;
    return { room, sent_at: sent, acked_at: acked, ack_seconds: sent && acked ? Math.round((Date.parse(acked) - Date.parse(sent)) / 1000) : null };
  });
}

export function renderDigests(digests: readonly DigestRecord[], acks: readonly DigestAck[]): string {
  if (!digests.length) return "";
  const rows = digests.map((d) => `| ${d.pass} | ${d.name} | ${d.started_at.slice(11, 19)} | ${d.finished_at ? d.finished_at.slice(11, 19) : "killed"} | ${d.cost_usd == null ? "?" : `$${d.cost_usd.toFixed(2)}`} | ${d.written ? (d.sent.join(", ") || "nobody") : "no digest written"} | ${d.no_position.join(", ") || "-"} | ${d.unacknowledged.join(", ") || "-"} |`);
  const last = acks.filter((a) => a.sent_at).map((a) => `${a.room}: ${a.acked_at ? `acknowledged after ${a.ack_seconds}s` : "not acknowledged"}`);
  return `## Consolidation passes\n\n| pass | seat | started | finished | cost | sent to | no position | unacknowledged from before |\n|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n\n${last.length ? `Latest note at the end of the run: ${last.join("; ")}.\n\n` : ""}`;
}
