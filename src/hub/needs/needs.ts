/**
 * needs/<name>: a blocker the room cannot fix itself, for the owner to decide (swarm-073112-zcd7,
 * evidence/rules-that-kept-trading). The live-money room swarm-185621-lc0a was told to write needs/* and mention the
 * chair; its board ended with none, although a seat named the laptop as the bottleneck at #235 and trading went on for an
 * hour. Here the hub carries it: the first write @-mentions the chair, every human and the owners of the claims the entry
 * says it blocks ("blocks: claim/a, claim/b"), logs need_filed, and room_status lists what is open.
 */
import type { Hub } from "../../hub.js";
import type { BoardEntry, Participant, Room } from "../types.js";

export const NEEDS_PREFIX = "needs/";
const BLOCKS = /^\s*blocks:\s*(.+)$/im;
/** room/key -> when the need was first filed (an edit keeps it); in memory only, so after a hub restart age counts from the last edit */
const filedAt = new Map<string, string>();

/** claim keys named on a "blocks:" line, in the order written */
export function needBlocks(text: string): string[] {
  const line = BLOCKS.exec(text)?.[1] ?? "";
  return [...new Set(line.split(/[\s,]+/).map((k) => k.replace(/[.;]+$/, "")).filter((k) => k.startsWith("claim/")))];
}

const minutesSince = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 6_000) / 10;

/** First write of a needs/* entry (absent or cleared before): one chat line to whoever can act, and a need_filed event. */
export function noticeNeed(hub: Hub, room: Room, p: Participant, key: string, entry: BoardEntry): void {
  filedAt.set(`${room.name}/${key}`, entry.updatedAt);
  const blocks = needBlocks(entry.text);
  const active = [...room.participants.values()].filter((q) => q.active);
  const chair = room.chair ? active.find((q) => q.name === room.chair) : undefined;
  const humans = active.filter((q) => q.agent === "human" && q.name !== room.chair);
  const owners = blocks.map((k) => room.board.get(k)).filter((e): e is BoardEntry => !!e?.text.trim())
    .map((e) => active.find((q) => q.name === e.by)).filter((q): q is Participant => !!q && q.agent !== "human");
  const told = [...new Set([chair, ...humans, ...owners].filter((q): q is Participant => !!q && q.id !== p.id))];
  const first = entry.text.trim().split("\n")[0]!.slice(0, 160);
  const who = told.length ? told.map((q) => `@${hub.shown(room, q)}`).join(" ") + " " : "";
  const decider = chair || humans.length ? "" : " No chair or human is in this room, so the owner sees it only in the run's report.";
  const unclaimed = blocks.filter((k) => !room.board.get(k)?.text.trim());
  const blocked = blocks.length ? ` It blocks ${blocks.join(", ")}: pause that work until it is answered, or say why it goes on.${unclaimed.length ? ` ${unclaimed.join(", ")} ${unclaimed.length === 1 ? "is" : "are"} not on the board: name the claim keys the work is under.` : ""}` : "";
  hub.post(room, "chat", undefined, `${who}${hub.shown(room, p)} filed ${key}, a need only the owner can meet: "${first}".${blocked}${decider} Clear the entry once it is met or refused.`);
  hub.persist({
    type: "need_filed", room: room.name, key, by: p.name, minutes_since_open: minutesSince(room.createdAt, entry.updatedAt),
    blocks, told: told.map((q) => q.name), ts: entry.updatedAt,
  });
}

export function noticeNeedCleared(hub: Hub, room: Room, p: Participant, key: string, previous: BoardEntry): void {
  const at = new Date().toISOString();
  hub.persist({ type: "need_cleared", room: room.name, key, by: p.name, filed_by: previous.by, open_minutes: minutesSince(filedAt.get(`${room.name}/${key}`) ?? previous.updatedAt, at), ts: at });
  filedAt.delete(`${room.name}/${key}`);
}

/** Open needs for room_status, oldest first; undefined when none is open. */
export function openNeeds(room: Room): { key: string; by: string; age_minutes: number; blocks?: string[] }[] | undefined {
  const at = new Date().toISOString();
  const open = [...room.board].filter(([k, e]) => k.startsWith(NEEDS_PREFIX) && e.text.trim())
    .map(([key, e]) => ({ key, by: e.by, age_minutes: minutesSince(filedAt.get(`${room.name}/${key}`) ?? e.updatedAt, at), ...(needBlocks(e.text).length ? { blocks: needBlocks(e.text) } : {}) }))
    .sort((x, y) => y.age_minutes - x.age_minutes);
  return open.length ? open : undefined;
}

/** Something outside the room, named in chat: the machine, the network path, a region rule. "server" only when it is not
 * a server timestamp or clock (the false hits of the scan over the Polymarket room logs). */
const OUTSIDE = /\b(laptop|this machine|our machine|the machine|vpn|nordvpn|colocat\w*|co-locat\w*|vps|server(?![-\s]?(?:ts|timestamps?|time|clock|stamps?|side)\b)(?!'s)|latency|rtt|load average|geoblock\w*|restricted region|region rule|feed lag|slow consumer|rate[- ]?limit\w*)\b/i;
/** ...said in words that it stops the work, not that a step was hard. */
const BLOCKING = /\b(bottleneck|too slow|can'?t|cannot|only (?:worth|works|possible)|territory|need(?:s|ed)? (?:a|an) (?:server|vps|colocat\w*|host|box|feed)|blocks|blocked|blocking|invalidat\w*|out of reach|not a laptop|unfixable|nothing we can|(?:is|was) the (?:cause|problem|bottleneck|limit)|the cause is|caused by)\b/i;

/** A message about another room or a commit review: a post-mortem talks about blockers it is not under (this room's
 * own log had 6 flags, 0 true, all citing lc0a, a #seq or a review/; review/0d659f43-claude-opus-5-5-3). */
const CITES_ELSEWHERE = /\bswarm-\d{6}-[a-z0-9]{4}\b|\blc0a\b|\bmrw4\b|\breview\/|(?<![\w/])#\d{2,4}\b/i;

/** The outside term a message names in blocking words, or undefined. */
export function blockerTerm(content: string): string | undefined {
  const outside = OUTSIDE.exec(content);
  return outside && BLOCKING.test(content) && !CITES_ELSEWHERE.test(content) ? outside[0] : undefined;
}

const blockerNudgedAt = new WeakMap<Participant, string>();

/** The line a proposal gets back when it names a blocker outside the room and the room has filed no needs/*: the
 * last place the infrastructure ask would otherwise stay in prose (dev rooms swarm-074424-34mn, swarm-074902-bz3m). */
export function proposalNeedHint(hub: Hub, room: Room, p: Participant, text: string): string | undefined {
  const term = blockerTerm(text);
  if (!term || [...room.board].some(([k, e]) => k.startsWith(NEEDS_PREFIX) && e.text.trim())) return undefined;
  hub.persist({ type: "blocker_nudged", room: room.name, by: p.name, term, seq: -1, where: "proposal", ts: new Date().toISOString() });
  return `This proposal names "${term}" as what stops the work, and the room has filed no needs/*. If only the owner can fix it, write needs/<name> ` +
    "(what, cost, what it unblocks, how a room would measure it worked) so it reaches the chair and the owner as an install item, not a line in prose.";
}

/** The line a seat's chat message gets back when it names a blocker outside the room (inputs/owner-1: a room notices a
 * blocker by itself). Once, then not again until the seat has filed a needs/* entry since; logged as blocker_nudged. */
export function blockerHint(hub: Hub, room: Room, p: Participant, content: string, quiet: boolean, seq: number): string | undefined {
  const term = quiet || p.agent === "human" || room.state !== "open" ? undefined : blockerTerm(content);
  if (!term) return undefined;
  const last = blockerNudgedAt.get(p);
  if (last && ![...room.board].some(([k, e]) => k.startsWith(NEEDS_PREFIX) && e.by === p.name && e.updatedAt > last)) return undefined;
  const at = new Date().toISOString();
  blockerNudgedAt.set(p, at);
  hub.persist({ type: "blocker_nudged", room: room.name, by: p.name, term, seq, ts: at });
  return `You named "${term}" as something that stops the work. If it blocks or invalidates what the room is testing, stop that work and write ` +
    "needs/<name> (what, cost, what it unblocks, and a blocks: claim/... line): the hub tells the chair and the owner. If it blocks nothing, ignore this.";
}
