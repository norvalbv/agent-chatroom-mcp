/**
 * The brief's problems against who holds them (inputs/owner-3 (a), decision/coverage-tracking). The brief's numbered list
 * was read only to give flat seats a starting line, and nothing afterwards said which problems had an owner: the chair
 * read the brief and the board by hand to find six unowned asks (this room's inputs/owner-3), and recruited one area
 * twice. A claim alone does not answer it either: of 1,289 claims in 220 rooms, 87% were still "held" when their owner
 * left and 9-11% ever said done (evidence/claims-census). A task ledger kept up to date is what Magentic-One's
 * orchestrator re-reads every step (2411.04468: 31% worse on GAIA without it); here the hub computes one from the board.
 *
 * item/<slug> names one problem. The chair writes one per problem the brief and the owner name; a launcher may seed them
 * through the resources route. Not parsed from the brief: its first numbered list is often its rules (this room's seed
 * seats opened on "rule 2" from seat-targets.ts). An item is covered by claim/<slug> or by any claim naming item/<slug>:
 *   unowned   no claim covers it
 *   owned     a live owner holds it and nobody else has reviewed it yet
 *   reviewed  a non-owner's passing review/* or verify/* covers the claim, and the owner has not said done
 *   built     the owner says done (claim status done/fixed/...), and nobody else has reviewed it
 *   done      the owner says done, a non-owner has reviewed it, and no attack on it is open; or "done: <key>" on the item
 *   orphaned  every owner has left and nobody reviewed it
 *   dropped   "dropped: <why>" on the item's first line
 * The owner's own word is never "done" on its own (attack/decision/coverage-tracking: two commits in this room needed
 * rework after review). States are not monotone: a review that identifies only the seat stops counting once that seat
 * holds a second claim, so done can go back to built. That is the safe direction (review/eacedc5b nit 1).
 */
import type { Hub } from "../../hub.js";
import type { Event } from "../internal.js";
import type { BoardEntry, Room } from "../types.js";
import { attackOpen, attackTarget, claimReleased } from "../board.js";
import { namesKey, settled } from "../open-work.js";
import { isReviewKey, parseVerifyHead } from "../types.js";

export const ITEM_PREFIX = "item/";
export type ItemState = "unowned" | "owned" | "reviewed" | "built" | "done" | "orphaned" | "dropped";
const STATES: readonly ItemState[] = ["unowned", "owned", "reviewed", "built", "done", "orphaned", "dropped"];
/** States that still need someone, listed as `open`. Unowned ones are offered to free seats (open_work item_unowned) and,
 * with no free seat, put to someone who can add one (hands.ts). */
const OPEN: readonly ItemState[] = ["unowned", "orphaned"];

export interface ItemRow {
  key: string;
  state: ItemState;
  /** seats that hold a claim covering it, active or not */
  owners: string[];
  claims: string[];
  /** when it entered this state's evidence: the item's write while unowned, else its first covering claim's */
  since: string;
}

export interface Coverage {
  items: number;
  by_state: Record<ItemState, number>;
  /** unowned and orphaned items: the ones nobody is on */
  open: string[];
  rows: ItemRow[];
  /** active seats holding two or more live claims (inputs/owner-3 (b): one seat per problem is the default) */
  multi_claim_seats?: Record<string, number>;
}

const SETTLED_ITEM = /^\s*(dropped|done)\s*:/i;

const slugOf = (key: string) => key.slice(key.indexOf("/") + 1);

/** Who a claim belongs to: its writer and its JSON team. A claim the hub wrote at recruitment (src/index.ts claimArea)
 * names the requester as writer; the recruits on its team hold it, not the chair that asked (#254 in this room). */
export function claimOwners(e: BoardEntry): string[] {
  let team: string[] = [];
  let atRecruitment = false;
  try {
    const j = JSON.parse(e.text) as { team?: unknown; note?: unknown };
    if (Array.isArray(j.team)) team = j.team.map(String);
    atRecruitment = j.note === "claimed at recruitment";
  } catch {}
  const all = [...new Set([e.by, ...team])];
  return atRecruitment && all.length > 1 ? all.filter((n) => n !== e.by) : all;
}

const live = (e: BoardEntry) => !!e.text.trim() && !claimReleased(e);

/** The claim or item slug a review/verify key is about: the longest one the key's area equals or starts with plus "-",
 * so verify/breakout-fate-dev is about breakout-fate, not breakout. */
function keyedSlug(area: string, slugs: string[]): string | undefined {
  return slugs.filter((s) => area === s || area.startsWith(`${s}-`)).sort((a, b) => b.length - a.length)[0];
}

/** A non-owner's review/* or verify/* that passes and is about this claim: keyed by its slug, or naming the claim or the
 * item. When the owners hold this claim alone, also one naming their branch or told to an owner as a commit's author
 * (review_notice): those identify the seat, not the claim, so for a seat holding two claims they would credit both
 * (review/4ddcfe6d). No git: this runs on every claim, review and attack write, and open-work's onBranch is a
 * spawnSync per review commit (review/4ddcfe6d's unverified cost; decision/machine-load found the hub blocking on git). Stricter than open-work's reviewedClaim, which also counts any
 * chat line or board entry naming the area: there, asking for a review that exists is the cost; here, calling
 * unreviewed work done would be the overstatement this replaces. */
type Review = { key: string; e: BoardEntry; area: string };
/** The board's passing review/* and verify/* entries, read once per ledger rather than once per item. */
function passingReviews(room: Room, slugs: string[]): Review[] {
  const out: Review[] = [];
  for (const [k, e] of room.board) {
    if (!isReviewKey(k) || k.endsWith(".partial") || !e.text.trim()) continue;
    const head = parseVerifyHead(e.text);
    if ((head && head.exit_code !== 0) || e.verdict === "fails") continue;
    out.push({ key: k, e, area: keyedSlug(slugOf(k), slugs) ?? "" });
  }
  return out;
}
function reviewed(reviews: Review[], claimKey: string, claim: BoardEntry, itemKey: string, owners: string[], sole: boolean): boolean {
  const slug = slugOf(claimKey), branch = claim.workspace?.branch;
  for (const { e, area } of reviews) {
    if (owners.includes(e.by)) continue;
    if (area === slug || namesKey(e.text, claimKey) || namesKey(e.text, itemKey)) return true;
    if (!sole) continue;
    if ((!!branch && e.text.includes(branch)) || (e.toldAuthor && owners.includes(e.toldAuthor))) return true;
  }
  return false;
}

/** An attack on one of these keys, or on an entry keyed by the item's slug, that its target's author has not answered. */
function attacked(room: Room, slug: string, keys: string[]): boolean {
  for (const [k, e] of room.board) {
    if (!k.startsWith("attack/") || !e.text.trim()) continue;
    const target = attackTarget(room, k, e.by);
    const t = room.board.get(target);
    if (t && (keys.includes(target) || slugOf(target) === slug) && attackOpen(e, t)) return true;
  }
  return false;
}

/** The ledger, or undefined when the room has no item/* entry. Pure: reads the board and who is active. */
export function coverage(room: Room): Coverage | undefined {
  const items = [...room.board.entries()].filter(([k, e]) => k.startsWith(ITEM_PREFIX) && e.text.trim());
  if (!items.length) return undefined;
  const active = new Set([...room.participants.values()].filter((p) => p.active).map((p) => p.name));
  const claims = [...room.board.entries()].filter(([k, e]) => k.startsWith("claim/") && live(e));
  const slugs = [...new Set([...claims, ...items].map(([k]) => slugOf(k)))];
  const held = new Map<string, number>();
  for (const [, e] of claims) for (const n of claimOwners(e)) held.set(n, (held.get(n) ?? 0) + 1);
  const reviews = passingReviews(room, slugs);
  const rows: ItemRow[] = items.map(([key, item]) => {
    const slug = slugOf(key);
    const covering = claims.filter(([k, e]) => k === `claim/${slug}` || namesKey(e.text, key));
    const owners = [...new Set(covering.flatMap(([, e]) => claimOwners(e)))];
    const since = covering.length ? covering.map(([, e]) => e.updatedAt).sort()[0] : item.updatedAt;
    const row = (state: ItemState): ItemRow => ({ key, state, owners, claims: covering.map(([k]) => k), since });
    const head = SETTLED_ITEM.exec(item.text);
    if (head) return row(head[1].toLowerCase() === "dropped" ? "dropped" : "done");
    if (!covering.length) return row("unowned");
    const checked = covering.some(([k, e]) => reviewed(reviews, k, e, key, owners, claimOwners(e).every((n) => held.get(n) === 1)));
    const saysDone = covering.some(([, e]) => settled(e));
    if (saysDone && checked) return row(attacked(room, slug, [key, ...covering.map(([k]) => k)]) ? "reviewed" : "done");
    if (saysDone) return row("built");
    if (checked) return row("reviewed");
    return row(owners.some((n) => active.has(n)) ? "owned" : "orphaned");
  });
  const by_state = Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => r.state === s).length])) as Record<ItemState, number>;
  const perSeat = new Map<string, number>();
  for (const [, e] of claims) if (!settled(e)) for (const n of claimOwners(e)) if (active.has(n)) perSeat.set(n, (perSeat.get(n) ?? 0) + 1);
  const multi = Object.fromEntries([...perSeat].filter(([, n]) => n >= 2));
  return { items: rows.length, by_state, open: rows.filter((r) => OPEN.includes(r.state)).map((r) => r.key), rows, ...(Object.keys(multi).length ? { multi_claim_seats: multi } : {}) };
}

/** Unowned items, oldest first, for whoever asks for a hand (open_work item_unowned; src/hub/asks/hands.ts). */
export function unownedItems(room: Room): { key: string; author: string; since: string }[] {
  const c = coverage(room);
  if (!c) return [];
  return c.rows.filter((r) => r.state === "unowned").map((r) => ({ key: r.key, author: room.board.get(r.key)!.by, since: r.since })).sort((a, b) => a.since.localeCompare(b.since));
}

/** One line for a report or a notice: counts by state, then the open items. */
export function coverageLine(c: Coverage): string {
  const counts = STATES.filter((s) => c.by_state[s]).map((s) => `${c.by_state[s]} ${s}`).join(", ");
  return `${c.items} item(s): ${counts}${c.open.length ? `; nobody on ${c.open.join(", ")}` : ""}.`;
}

const lastLogged = new WeakMap<Room, string>();
/** Events after which the ledger can have changed: an item, claim, review or attack written, or a seat joining or leaving. */
const MOVES = /^(item|claim|review|verify|attack)\//;

/** Telemetry: a `coverage` event whenever any item's state or owners change, so a replay shows how long each item waited
 * for an owner, who held it, and how it ended (scripts/coverage-replay.ts). Called by persistence for every event. */
export function noteCoverage(hub: Hub, ev: Event): void {
  if (!(ev.type === "board" && MOVES.test(ev.key)) && ev.type !== "join" && ev.type !== "leave") return;
  const room = hub.rooms.get(ev.room);
  if (!room) return;
  const c = coverage(room);
  const states = Object.fromEntries(c?.rows.map((r) => [r.key, r.state]) ?? []);
  const owners = Object.fromEntries(c?.rows.map((r) => [r.key, r.owners]) ?? []);
  const sig = c ? JSON.stringify([states, owners]) : "";
  if ((lastLogged.get(room) ?? "") === sig) return;
  lastLogged.set(room, sig);
  if (!c) return;
  hub.persist({ type: "coverage", room: room.name, items: c.items, ...c.by_state, open: c.open, states, owners, ts: new Date().toISOString() });
}
