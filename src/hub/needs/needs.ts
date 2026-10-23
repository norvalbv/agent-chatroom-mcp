/**
 * needs/<name>: a blocker the room cannot fix itself, for the owner to decide (swarm-073112-zcd7,
 * evidence/rules-that-kept-trading). The live-money room swarm-185621-lc0a was told to write needs/* and mention the
 * chair; its board ended with none, although a seat named the laptop as the bottleneck at #235 and trading went on for an
 * hour. Here the hub carries it: the first write @-mentions the chair, every human and the owners of the claims the entry
 * says it blocks ("blocks: claim/a, claim/b"), who then owe an answer (paused, or why it goes on), logs need_filed, and
 * room_status lists what is open.
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
  const deciders = [...new Set([chair, ...humans].filter((q): q is Participant => !!q && q.id !== p.id))];
  const asked = [...new Set(owners.filter((q) => q.id !== p.id && !deciders.includes(q)))];
  const told = [...deciders, ...asked];
  const first = entry.text.trim().split("\n")[0]!.slice(0, 160);
  const who = deciders.length ? deciders.map((q) => `@${hub.shown(room, q)}`).join(" ") + " " : "";
  const decider = chair || humans.length ? "" : " No chair or human is in this room, so the owner sees it only in the run's report.";
  const unclaimed = blocks.filter((k) => !room.board.get(k)?.text.trim());
  const blocked = blocks.length ? ` It blocks ${blocks.join(", ")}: pause that work until it is answered, or say why it goes on.${unclaimed.length ? ` ${unclaimed.join(", ")} ${unclaimed.length === 1 ? "is" : "are"} not on the board: name the claim keys the work is under.` : ""}` : "";
  hub.post(room, "chat", undefined, `${who}${hub.shown(room, p)} filed ${key}, a need only the owner can meet: "${first}".${blocked}${decider} Clear the entry once it is met or refused.`);
  // the owners of the blocked work owe an answer: in lc0a nothing made a latency-bound strategy's owner say whether it
  // stopped (#235 to #612). Tagged "need", it stays their focused ask after delivery until they reply to it or pass.
  for (const q of asked) {
    const mine = blocks.filter((k) => room.board.get(k)?.by === q.name);
    hub.post(room, "chat", undefined, `@${hub.shown(room, q)} ${key} (filed by ${hub.shown(room, p)}) blocks your ${mine.join(", ")}. Reply to this message: paused, or why that work goes on.`, { tag: "need" });
  }
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

/** The question a proposal gets back while the room has no open needs/*, whatever its words (decision/blocker-detection,
 * inputs/owner-3). A word list deciding which messages name a blocker scored 0 of 1 on held-out labels (esc-before-2),
 * and an embedding check did no better; the seats had known their blocker all along (lc0a #235; esc-before-1's final
 * said a host "would be a needs/ decision" and filed none), so the hub asks the seat to judge its own conclusion at the
 * moment it commits to it. Worded so the owner, not the room, decides whether a server is worth paying for: esc-before-2's
 * final rejected a VPS on its own model and lc0a's filed colocation as "an engineering project". Logged as need_asked. */
export function proposalNeedHint(hub: Hub, room: Room, p: Participant): string | undefined {
  if (p.agent === "human" || [...room.board].some(([k, e]) => k.startsWith(NEEDS_PREFIX) && e.text.trim())) return undefined;
  hub.persist({ type: "need_asked", room: room.name, by: p.name, where: "proposal", ts: new Date().toISOString() });
  return "Before this passes: does the conclusion depend on anything outside the room that only the owner can change (the machine, the network path or VPN, " +
    "a region or account rule, data or a feed you cannot get, money)? If so, write needs/<name> (what, cost, what it unblocks, a blocks: claim/... line) " +
    "even if you judge it not worth paying for: the owner decides that, not the room. If nothing outside limits it, ignore this.";
}
