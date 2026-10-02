/** The Hub's shared board, as functions over the Hub instance; Hub keeps a one-line delegator for each member called from outside. */
import { createHash } from "node:crypto";
import type { Hub } from "../hub.js";
import { HubError } from "./types.js";
import type { Quorum, Participant, BoardExpiryOptions, BoardEntry, Room } from "./types.js";
import { now, codeState } from "./internal.js";

function boardExpiry(key: string, opts: BoardExpiryOptions): string | undefined {
  if (opts.ttlSeconds === undefined && opts.expiresAt === undefined) return undefined;
  if (!key.startsWith("handoff/") && !key.startsWith("inbox/")) throw new HubError("Expiry is supported only for handoff/ and inbox/ entries.", undefined, "expiry-prefix");
  if (opts.ttlSeconds !== undefined && opts.expiresAt !== undefined) throw new HubError("Use ttl_seconds or expires_at, not both.", undefined, "expiry-prefix");
  if (opts.ttlSeconds !== undefined && (!Number.isFinite(opts.ttlSeconds) || opts.ttlSeconds <= 0)) throw new HubError("ttl_seconds must be finite and positive.", undefined, "expiry-prefix");
  const at = opts.ttlSeconds !== undefined ? Date.now() + opts.ttlSeconds * 1000 : Date.parse(opts.expiresAt!);
  if (!Number.isFinite(at) || Math.abs(at) > 8.64e15) throw new HubError("Invalid expires_at or ttl_seconds.", undefined, "expiry-prefix");
  return new Date(at).toISOString();
}

/** Expiry archives visibility only. Required inbox notes remain visible until current-text ack. */
export function boardEntryExpired(room: Room, key: string, entry: BoardEntry, at = Date.now()): boolean {
  if (!entry.expiresAt || at < Date.parse(entry.expiresAt)) return false;
  if (entry.ackRequired && inboxOpen(room, key, entry)) return false;
  return true;
}

export function recordBoardManifest(hub: Hub, roomName: string, envelope: { board_keys?: string[]; board_delta?: { keys: string[]; tombstones: string[] } }): void {
  const room = hub.getRoom(roomName);
  const kind = envelope.board_keys !== undefined ? "full" : envelope.board_delta !== undefined ? "delta" : "empty";
  // Standalone manifest envelope in MCP text encoding; no embedded fields means zero bytes.
  const bytes = manifestBytes(envelope);
  applyBoardManifest(room, bytes, kind);
  hub.persist({ type: "board_manifest", room: roomName, bytes, kind });
}

export function applyBoardManifest(room: Room, bytes: number, kind: "full" | "delta" | "empty"): void {
  const stats = room.boardManifests ??= { version: 1, waits: 0, bytes: 0, full: 0, delta: 0, empty: 0 };
  stats.waits++; stats.bytes += bytes; stats[kind]++;
}

export const BOARD_KEY = /^[\w .:/-]{1,80}$/;

export function hold(room: Room): BoardEntry | undefined {
  return room.board.get(`hold/${room.name}`);
}

function noteHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Shared coverage check; legacy acks without coverage are conservative. */
function inboxOpen(room: Room, key: string, entry: BoardEntry): boolean {
  return key.startsWith("inbox/") && !key.endsWith(".ack") &&
    room.board.get(`${key}.ack`)?.acknowledgedTextHash !== noteHash(entry.text);
}

/** inbox/* entries still requiring acknowledgement of their current text. */
export function unacknowledged(room: Room): string[] {
  return [...room.board.entries()].filter(([k, e]) => e.ackRequired && inboxOpen(room, k, e)).map(([k]) => k);
}

/** Distinct connections among a set of participants (two names on one connection are one agent). */
export function sessionsOf(ps: Participant[]): number {
  return new Set(ps.map((p) => p.session ?? `nosession:${p.id}`)).size;
}

/** Agrees needed to pass a non-unanimous quorum: bare majority, or a 75% supermajority (ceil, never below a bare majority). */
export function quorumNeeded(quorum: Quorum, electorateSize: number): number {
  if (quorum === "supermajority") return Math.max(Math.ceil(electorateSize * 0.75), Math.floor(electorateSize / 2) + 1);
  return Math.floor(electorateSize / 2) + 1;
}

/** UTF-8 bytes of standalone pretty-JSON board fields, not HTTP/MCP framing. */
export function manifestBytes(envelope: Record<string, unknown>): number {
  return Object.keys(envelope).length ? Buffer.byteLength(JSON.stringify(envelope, null, 2)) : 0;
}

export function boardManifestTelemetry(room: Room): { waits: number; board_bytes_total: number; board_bytes_mean: number } {
  const t = room.boardManifests;
  const waits = t?.waits ?? 0;
  return { waits, board_bytes_total: t?.bytes ?? 0, board_bytes_mean: waits ? Math.round((t!.bytes / waits) * 10) / 10 : 0 };
}

/** One seat's board discovery, built synchronously after the poll wake: an at-most-once receipt (rejoin/restart resets to a full manifest), not a network ack.
 * follow: omitted keeps it, [] = mandatory keys only, [""] = all; any change resets. Not authorization: verify/, claim/, pending inbox and hold keys always show. */
export function boardManifest(hub: Hub, roomName: string, pid: string, follow?: string[], forceFull = false): {
  board_keys?: string[]; board_delta?: { keys: string[]; tombstones: string[] }; board_reset?: boolean;
} {
  const room = hub.getRoom(roomName);
  const p = hub.requireParticipant(room, pid);
  const nextFollow = follow === undefined ? undefined : [...new Set(follow)];
  const changed = nextFollow !== undefined && !forceFull &&
    (p.boardFollow === undefined || p.boardFollow.length !== nextFollow.length ||
      p.boardFollow.some((x, i) => x !== nextFollow[i]));
  if (nextFollow !== undefined) p.boardFollow = nextFollow;
  const prefixes = forceFull ? undefined : p.boardFollow;
  const pending = new Set(hub.unacknowledged(room));
  const visible = [...room.board].filter(([key, entry]) => {
    if (hub.boardEntryExpired(room, key, entry) || hub.draftSealed(room, key, entry, p.name)) return false;
    return prefixes === undefined || prefixes.some((prefix) => key.startsWith(prefix)) ||
      key.startsWith("verify/") || key.startsWith("claim/") || pending.has(key) || key === `hold/${room.name}`;
  }).map(([key]) => key);
  const previous = new Set(p.seenBoardKeys ?? []);
  const current = new Set(visible);
  const first = p.lastBoardSeen === undefined || forceFull;
  const prevSeen = p.lastBoardSeen;
  p.lastBoardSeen = room.boardVersion;
  p.seenBoardKeys = visible;
  if (first || changed) {
    const envelope = { board_keys: visible, board_reset: true };
    hub.recordBoardManifest(roomName, envelope);
    return envelope;
  }
  const keys = visible.filter((key) => !previous.has(key) || (room.boardVersions.get(key) ?? 0) > (prevSeen ?? 0));
  // Also covers subscription contraction and clock-driven expiry with no new board event.
  const tombstones = [...previous].filter((key) => !current.has(key));
  if (keys.length || tombstones.length) {
    const envelope = { board_delta: { keys, tombstones } };
    hub.recordBoardManifest(roomName, envelope);
    return envelope;
  }
  hub.recordBoardManifest(roomName, {});
  return {};
}

/** Single reducer for live and replay board mutations; deletes retain a version tombstone. */
export function applyBoard(room: Room, key: string, entry: BoardEntry | null) {
  room.boardVersion++;
  room.boardVersions.set(key, room.boardVersion);
  if (entry) room.board.set(key, entry);
  else room.board.delete(key);
}

export function setBoard(hub: Hub, roomName: string, pid: string, key: string, text: string, opts: BoardExpiryOptions & { ifAbsent?: boolean; ifByMe?: boolean; overwrite?: boolean } = {}): BoardEntry | null {
  const room = hub.getRoom(roomName);
  const p = hub.requireParticipant(room, pid);
  if (room.state === "concluded" || room.state === "closed") {
    throw new HubError(`Room "${roomName}" is ${room.state}: board writes are refused, there is nothing left to coordinate. Earlier entries, including verify/* and handoff/*, are still readable with board_get.`, undefined, "state");
  }
  if (!BOARD_KEY.test(key)) throw new HubError("Board keys are short names like 'evidence', 'open questions', 'claim/auth', 'verify/auth'.", undefined, "key-format");
  if (text.length > 8000) throw new HubError("Board entries are capped at 8000 characters.", undefined, "size");
  const expiresAt = boardExpiry(key, opts);
  const previous = room.board.get(key);
  // reserved prefixes (enforced here, the single write site)
  if (key.startsWith("inbox/") && !key.endsWith(".ack")) throw new HubError("inbox/* entries are written by post_to_room from another room. To acknowledge one, write '<key>.ack'.");
  if (key.startsWith("hold/")) {
    if (key !== `hold/${room.name}`) throw new HubError(`A hold for this room is the key "hold/${room.name}".`, undefined, "key-format");
    if (previous && previous.by !== p.name) throw new HubError(`The hold was placed by ${previous.by}; only they (or a human) can clear or change it.`, undefined, "ownership");
  }
  // author-only, and refused without echoing the text: an ownership error that returned the entry would unseal it
  if (key.startsWith("draft/") && previous && previous.by !== p.name) throw new HubError(`"${key}" is ${previous.by}'s draft; draft/* entries are author-only. Write your own, e.g. draft/${p.name}.`, undefined, "ownership");
  // Assigned once, at creation only: later edits (status updates, notes) keep the same reviewer.
  let reviewer: Participant | undefined;
  const takeover = key.startsWith("claim/") && previous && previous.by !== p.name && !claimReleased(previous) ? hub.claimTakeover(room, previous, p) : null;
  if (key.startsWith("claim/")) {
    // a claim released by removeParticipant (status "released", rewritten by the hub) is open to anyone; a departed
    // owner's claim is open to its registered successor, and to anyone after Hub.STALE_CLAIM_MS (claimTakeover)
    if (previous && previous.by !== p.name && !claimReleased(previous) && !takeover) throw new HubError(`claim "${key}" is owned by ${previous.by} (since ${previous.updatedAt}). Join their team via help/ or join-request/, or pick another area.`, undefined, "ownership");
    if (text.trim()) {
      let parsed: { status?: string; team?: unknown } | undefined;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new HubError('claim/* entries are JSON: {"area":..., "owner":..., "team":[names], "status":"open|fixed|verified", "note":...}');
      }
      if (parsed && (parsed.status === "fixed" || parsed.status === "verified")) {
        const team = Array.isArray(parsed.team) ? (parsed.team as unknown[]).map(String) : [];
        const members = hub.activeParticipants(room).filter((x) => team.includes(x.name) && x.agent !== "human");
        if (members.length < 2 || sessionsOf(members) < 2) {
          throw new HubError(`A claim can only be marked ${parsed.status} by a team of 2+ distinct active agents; team=${JSON.stringify(team)} has ${members.length} active on ${sessionsOf(members)} connection(s).`);
        }
      }
    }
    reviewer = previous ? undefined : assignReviewer(hub, room, p);
  }
  if (opts.ifAbsent && previous) throw new HubError(`"${key}" already exists (by ${previous.by}, ${previous.updatedAt}).`, { existing: previous }, "state");
  if (opts.ifByMe && previous && previous.by !== p.name) throw new HubError(`"${key}" was written by ${previous.by}, not you. Use post_to_room or a different key.`, undefined, "ownership");
  if (previous && previous.by !== p.name && !opts.overwrite && text.trim() && !(key.startsWith("claim/") && (claimReleased(previous) || takeover))) {
    throw new HubError(
      `"${key}" was written by ${previous.by} at ${previous.updatedAt}; replacing it would discard their text. Merge with the current content below and resend with overwrite=true, or use your own key.`,
      { current: previous },
      "ownership",
    );
  }
  if (!text.trim()) {
    applyBoard(room, key, null);
    hub.persist({ type: "board", room: roomName, key, entry: null });
    hub.post(room, "board", p, `cleared board entry "${key}"`);
    if (key === `hold/${room.name}`) for (const pr of room.proposals.values()) if (pr.status === "open") hub.evaluate(room, pr);
    return null;
  }
  hub.surfaceCited(room, text, `cited on the board under ${key}`);
  const note = key.startsWith("inbox/") && key.endsWith(".ack") ? room.board.get(key.slice(0, -4)) : undefined;
  if (key.startsWith("verify/")) p.lastVerifiedAt = now();
  // a draft written or edited after peers' drafts became readable may have copied them: say so wherever it is listed
  const postReveal = key.startsWith("draft/") && (!!previous?.postReveal || !!room.draftsRevealed || hub.draftsDue(room));
  const workspace = key.startsWith("claim/") ? hub.workspaceOf(p) : undefined;
  const entry: BoardEntry = {
    text, by: p.name, updatedAt: now(),
    ...(expiresAt ? { expiresAt } : {}),
    ...(key.startsWith("verify/") ? { codeState: codeState(hub.cwd) } : {}),
    ...(note ? { acknowledgedTextHash: noteHash(note.text) } : {}),
    ...(reviewer ? { reviewer: reviewer.name, reviewerId: reviewer.id }
      : previous?.reviewer ? { reviewer: previous.reviewer, reviewerId: previous.reviewerId } : {}),
    ...(postReveal ? { postReveal: true } : {}),
    ...(workspace ? { workspace } : {}),
  };
  applyBoard(room, key, entry);
  hub.persist({ type: "board", room: roomName, key, entry });
  // a sealed draft's notice names neither key nor size (either can carry content); it says who is still owed a draft
  if (key.startsWith("draft/")) hub.openDrafts(room); // before the notice, so the first one already names the deadline
  const sealedDraft = key.startsWith("draft/") && !room.draftsRevealed && !hub.draftsComplete(room) && !hub.draftsDue(room);
  hub.post(room, "board", p, sealedDraft ? `${previous ? "updated" : "wrote"} a sealed draft (${hub.draftProgress(room)})`
    : `${previous ? "updated" : "added"} board entry "${key}" (${text.length} chars; read it with board_get)`
    + (postReveal ? " — post-reveal: written after peers' drafts were readable, so not an independent attempt" : "")
    + (workspace ? ` — ${workspace.branch ? `branch ${workspace.branch} in ` : ""}${workspace.worktree}` : "")
    + (reviewer ? ` — reviewer: ${reviewer.name}` : ""));
  if (reviewer) {
    // kind "chat", not "system": an owed @-mention is resolved from content, so it still wakes a held wait after hub.wait() advanced lastSeenSeq
    // past this message; a "system" post with mentions arrives too late. "Exercise ... not only rerun" is the OpenHands qa-changes rule.
    hub.post(room, "chat", undefined,
      `@${reviewer.name} you are the reviewer for ${p.name}'s "${key}" (fewest reviews assigned, then least-recently-verifying; picked by the hub). ` +
      `Once ${p.name} proposes work from it, require_verification prefers a verify/* entry from you over anyone else's while you're still active; ` +
      `its JSON head (in the proposal's blocked_by) records one check of yours failing at the parent commit and passing at ${p.name}'s. Exercise the change the way its users would; do not only rerun ${p.name}'s tests.`);
  }
  if (takeover) {
    hub.post(room, "system", undefined, `${hub.shown(room, p)} took over "${key}" from ${hub.shown(room, takeover.owner)} (${takeover.reason === "successor" ? "registered successor" : `owner gone since ${hub.lastSeen(takeover.owner)}`}).`);
  }
  if (key.startsWith("claim/") && (!previous || claimReleased(previous))) noticeClaimOverlap(hub, room, p, key, text);
  if (key.endsWith(".ack") || key.startsWith("verify/")) for (const pr of room.proposals.values()) if (pr.status === "open") hub.evaluate(room, pr);
  if (key.startsWith("draft/")) hub.latchDrafts(room);
  return entry;
}

const CLAIM_STOP = new Set(("the a an and or of to in on for by with from is are be it this that as at not no into via per its all any " +
  "one each my i we our me you your will then than so if when only but also can new use using take own owns claim area note status open team owner").split(" "));

/** Content-word stems (first 6 chars) of a claim's key and its JSON area+note, for overlap scoring. */
export function claimTerms(key: string, text: string): Set<string> {
  let body = text;
  // every free-text field, not just area/note: seats write what/plan/scope too (swarm-083203-kooz claim-overlap-echo used "what")
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    body = Object.entries(j).filter(([k, v]) => typeof v === "string" && !["owner", "status", "worktree"].includes(k)).map(([, v]) => v).join(" ");
  } catch { /* plain text */ }
  const words = `${key.slice("claim/".length).replace(/[-_/]/g, " ")} ${body}`.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
  return new Set(words.filter((w) => !CLAIM_STOP.has(w)).map((w) => w.slice(0, 6)));
}

/** Seats herd onto overlapping claims; advisory, never a refusal: one line @-naming the new claimant and the existing owner(s),
 * so the duplicate is caught when it is claimed, not at review. */
function noticeClaimOverlap(hub: Hub, room: Room, p: Participant, key: string, text: string) {
  const top = overlapsFor(room, p, key, text).slice(0, 2);
  if (!top.length) return;
  // kind "chat" so the @-mentions wake a held wait, same reason as the reviewer notice above
  hub.post(room, "chat", undefined,
    `@${p.name} your "${key}" overlaps ${top.map((h) => `@${h.by}'s "${h.key}" (${h.shared_pct}% shared terms: ${h.shared.join(", ")})`).join(" and ")}. ` +
    `Before both of you build it: merge into one team (claim JSON team:[...]), split it explicitly, or pick another area. Advisory only, the claim stands.`);
}

/** Live claims by other active connections sharing >= 40% of term stems (Jaccard, >= 4 shared) with this claim, best first.
 * Read by the creation notice and by board_set's response, so the claimant sees the collision synchronously too. */
export function claimOverlaps(hub: Hub, roomName: string, pid: string, key: string): { key: string; by: string; shared_pct: number; shared: string[] }[] {
  const room = hub.getRoom(roomName);
  const e = room.board.get(key);
  return key.startsWith("claim/") && e ? overlapsFor(room, hub.requireParticipant(room, pid), key, e.text) : [];
}

function overlapsFor(room: Room, p: Participant, key: string, text: string) {
  const mine = claimTerms(key, text);
  if (mine.size < 4) return [];
  const myKey = claimTerms(key, "");
  const hits: { key: string; by: string; shared_pct: number; shared: string[] }[] = [];
  for (const [k, e] of room.board) {
    if (k === key || !k.startsWith("claim/") || e.by === p.name || !e.text.trim() || claimReleased(e)) continue;
    const owner = [...room.participants.values()].find((x) => x.name === e.by);
    if (!owner?.active || (owner.session && p.session && owner.session === p.session)) continue;
    const s = claimOverlapScore(mine, myKey, claimTerms(k, e.text), claimTerms(k, ""));
    if (s.fires) hits.push({ key: k, by: e.by, shared_pct: Math.round(s.jac * 100), shared: s.shared.slice(0, 6) });
  }
  return hits.sort((a, b) => b.shared_pct - a.shared_pct);
}

/** The one overlap rule, also read by scripts/claim-overlap-calibration.ts: >= 4 shared stems and Jaccard >= 0.4, or >= 0.2
 * when the key slugs share half the shorter slug's stems (long notes dilute Jaccard, hence the slug rule). */
export function claimOverlapScore(a: Set<string>, aKey: Set<string>, b: Set<string>, bKey: Set<string>) {
  const shared = [...a].filter((w) => b.has(w));
  const jac = shared.length / (a.size + b.size - shared.length || 1);
  const shorter = Math.min(aKey.size, bKey.size);
  const slugsMatch = shorter > 0 && [...aKey].filter((w) => bKey.has(w)).length / shorter >= 0.5;
  return { shared, jac, slugsMatch, fires: a.size >= 4 && shared.length >= 4 && (jac >= 0.4 || (slugsMatch && jac >= 0.2)) };
}

/** Reviewer for a new claim/<area>: an active voter other than the owner, fewest reviews assigned, then least-recently-verifying, then earliest join.
 * Hub-chosen, never client-supplied, so a claimant cannot pick their own reviewer by writing it into the JSON. */
function assignReviewer(hub: Hub, room: Room, owner: Participant): Participant | undefined {
  // identity-is-the-connection: a second name on the owner's own MCP session is not "someone
  // else" (the same sock-puppet case verifiedBy() already excludes for authorship, hub.ts ~2190).
  const candidates = hub.voters(room).filter((x) => x.id !== owner.id && !(x.session && owner.session && x.session === owner.session));
  if (!candidates.length) return undefined;
  // Assigned reviews count as load before verify history: claims arrive in a burst when every candidate ties, and
  // without this the earliest joiner became the sole accepted verifier for nearly every claim.
  const assigned = new Map<string, number>();
  for (const [k, e] of room.board) if (k.startsWith("claim/") && e.reviewerId) assigned.set(e.reviewerId, (assigned.get(e.reviewerId) ?? 0) + 1);
  return candidates.slice().sort((a, b) =>
    (assigned.get(a.id) ?? 0) - (assigned.get(b.id) ?? 0) ||
    (a.lastVerifiedAt ?? "").localeCompare(b.lastVerifiedAt ?? "") || a.joinedAt.localeCompare(b.joinedAt))[0];
}

/** The active reviewer of the most recently created claim/* `authorName` authored that still has one; falls back
 * across claims so a stale or handed-off claim does not shadow a live one. */
export function activeReviewerFor(room: Room, authorName: string): Participant | undefined {
  const claims = [...room.board.entries()]
    .filter(([k, e]) => k.startsWith("claim/") && e.by === authorName && e.reviewerId)
    .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt));
  for (const [, e] of claims) {
    const rev = room.participants.get(e.reviewerId!);
    if (rev?.active) return rev;
  }
  return undefined;
}

/** System-initiated board write on someone's behalf (e.g. a claim made at recruitment); no membership needed. */
export function setBoardAs(hub: Hub, roomName: string, byName: string, key: string, text: string): BoardEntry {
  const room = hub.getRoom(roomName);
  if (!BOARD_KEY.test(key)) throw new HubError("Invalid board key.", undefined, "key-format");
  const entry: BoardEntry = { text, by: byName, updatedAt: now() };
  applyBoard(room, key, entry);
  hub.persist({ type: "board", room: roomName, key, entry });
  hub.post(room, "board", undefined, `${byName} added board entry "${key}" (${text.length} chars; read it with board_get)`);
  return entry;
}

/** Cross-room note: written into the target room's board under inbox/<from>/<key> without joining it. */
export function postToRoom(hub: Hub, fromRoom: string, pid: string, toRoom: string, key: string, text: string, ackRequired = false, opts: BoardExpiryOptions = {}): { key: string; entry: BoardEntry } {
  const from = hub.getRoom(fromRoom);
  const p = hub.requireParticipant(from, pid);
  if (toRoom === fromRoom) throw new HubError("That is your own room; use board_set.");
  const to = hub.getRoom(toRoom);
  if (to.state === "concluded" || to.state === "closed") {
    throw new HubError(`Room "${toRoom}" is ${to.state}: board writes are refused, there is nothing left to coordinate there.`, undefined, "state");
  }
  if (!/^[\w .:-]{1,40}$/.test(key)) throw new HubError("Inbox keys are short names without slashes.", undefined, "key-format");
  if (text.length > 8000) throw new HubError("Notes are capped at 8000 characters.", undefined, "size");
  const full = `inbox/${fromRoom}/${key}`;
  const expiresAt = boardExpiry(full, opts);
  const entry: BoardEntry = { text, by: p.name, updatedAt: now(), ...(expiresAt ? { expiresAt } : {}), ...(ackRequired ? { ackRequired: true } : {}) };
  // Replacing an open note consumes no extra slot. A changed text hash invalidates its old ack.
  const otherOpen = [...to.board.entries()].filter(([k, e]) => k !== full && inboxOpen(to, k, e)).length;
  if (inboxOpen(to, full, entry) && otherOpen >= 10) throw new HubError(`${toRoom} already has 10 inbox notes awaiting acknowledgement; wait for them to be acknowledged or cleared.`);
  applyBoard(to, full, entry);
  hub.persist({ type: "board", room: toRoom, key: full, entry });
  hub.post(to, "system", undefined, `Note from ${p.name} in ${fromRoom} on the board as "${full}"${ackRequired ? ` (acknowledge by writing "${full}.ack")` : ""}: ${text.slice(0, 160)}${text.length > 160 ? "…" : ""}`);
  return { key: full, entry };
}

/** A claim/* rewritten by removeParticipant: owner gone, area open to anyone. */
export function claimReleased(e: BoardEntry): boolean {
  if (e.by !== "system") return false;
  try { return (JSON.parse(e.text) as { status?: string }).status === "released"; } catch { return false; }
}
