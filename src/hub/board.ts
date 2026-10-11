/** The Hub's shared board, as functions over the Hub instance; Hub keeps a one-line delegator for each member called from outside. */
import { createHash } from "node:crypto";
import type { Hub } from "../hub.js";
import { HubError, isReviewKey, readVerifyHead, citesCommit, failToPassShortfall } from "./types.js";
import type { Quorum, Participant, BoardExpiryOptions, BoardEntry, Room } from "./types.js";
import { now, codeState, norm, commitsIn, commitKnown } from "./internal.js";
import { announceTake, takeWrite } from "./take.js";

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

/** An acknowledgement that says nothing beyond "seen". */
const BARE_ACK = /^\s*(ack(nowledged)?|ok(ay)?|seen|received|read|noted|done|thanks?)[\s.!]*$/i;

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

/** The version of each entry the hub last showed a seat (board_get of the key, a refusal carrying it, the seat's own
 * write). Not persisted: after a hub restart the first overwrite of another author's entry is refused once, with it. */
const boardSeen = new WeakMap<Participant, Map<string, string>>();
export function noteBoardRead(p: Participant, key: string, entry: { updatedAt: string }): void {
  const seen = boardSeen.get(p) ?? new Map<string, string>();
  boardSeen.set(p, seen);
  seen.set(key, entry.updatedAt);
}

/** Prefixes whose writes carry their own rules (holder, author-only, JSON head, ack hash): an append would bypass them. */
const NO_APPEND = /^(claim|take|verify|review|attack|draft|hold|inbox)\//;

/**
 * board_set(append=true): one block "[HH:MMZ name] text" added to a shared log (ledger, queue, ranked list) by any seat
 * (swarm-180216-182a, decision/board-append). 22 keys in 12 rooms were co-written by 2-5 seats as read-merge-overwrite:
 * 0btz's ledger drew 15 ownership and 5 size refusals and was split by hand into ledger-2..7. An append discards nothing,
 * so it is never refused for ownership or a stale read; the hub stamps its own clock and the author; past the size cap it
 * lands in <key>/2, /3... and the head records continuedAt, so later appends to <key> go straight to the newest one.
 */
function appendBoard(hub: Hub, room: Room, p: Participant, key: string, text: string): BoardEntry {
  if (NO_APPEND.test(key)) throw new HubError(`append is for shared logs; "${key.split("/")[0]}/*" entries have their own write rules. Write it without append.`, undefined, "key-format");
  if (!text.trim()) throw new HubError("append adds a line and an empty one adds nothing; to delete an entry, write empty text without append.", undefined, "state");
  const line = `[${now().slice(11, 16)}Z ${p.name}] ${text.trim()}`;
  // leaves room for a continuation's first line, so an entry never passes the 8000-char cap
  if (line.length > 7800) throw new HubError(`One append is capped at 7800 characters with its stamp (this one is ${line.length}).`, undefined, "size");
  const head = room.board.get(key);
  let landed = head?.continuedAt && room.board.get(head.continuedAt) ? head.continuedAt : key;
  for (let n = landed === key ? 2 : Number(landed.slice(key.length + 1)) + 1; ; n++) {
    const cur = room.board.get(landed);
    if (!cur || cur.text.length + 1 + line.length <= 8000) break;
    landed = `${key}/${n}`;
    if (!BOARD_KEY.test(landed)) throw new HubError(`"${key}" is full and its continuation key "${landed}" would pass the 80-character key limit: start a shorter key.`, undefined, "size");
  }
  const cur = room.board.get(landed);
  // a line another seat adds is not the author's reply to an attack on the entry (attackOpen discounts it)
  const others = cur && cur.by !== p.name ? (cur.othersChars ?? 0) + norm(line).length + 1 : cur?.othersChars;
  const entry: BoardEntry = cur
    ? { ...cur, text: `${cur.text}\n${line}`, updatedAt: now(), ...(others ? { othersChars: others } : {}) }
    : { text: landed === key ? line : `continued from "${key}" (it reached the 8000-char cap; append with key "${key}")\n${line}`, by: p.name, updatedAt: now() };
  applyBoard(room, landed, entry);
  noteBoardRead(p, landed, entry);
  hub.persist({ type: "board", room: room.name, key: landed, entry });
  if (landed !== key && head && head.continuedAt !== landed) {
    // the head's text and updatedAt are unchanged, so a seat's earlier read of it is still current for the stale-read guard
    const pointed = { ...head, continuedAt: landed };
    applyBoard(room, key, pointed);
    hub.persist({ type: "board", room: room.name, key, entry: pointed });
  }
  hub.persist({ type: "board_append", room: room.name, key, landed_key: landed, by: p.name, chars: line.length, ts: entry.updatedAt });
  hub.post(room, "board", p, `appended to "${landed}"${landed !== key ? ` (continuation of "${key}")` : ""}: ${text.trim().slice(0, 120)}`);
  return entry;
}

/**
 * What a reader of a log's head needs once it has rolled over (attack/decision/board-append: the writer was routed to
 * the newest continuation and the reader was not, so a queue's newest line, its current state, went unread): where the
 * log continues and its last lines, in the same board_get.
 */
export function boardContinuation(room: Room, key: string, entry: BoardEntry): { continued_in: string[]; newest_key: string; newest_lines: string[]; hint: string } | undefined {
  const newest = entry.continuedAt ? room.board.get(entry.continuedAt) : undefined;
  if (!entry.continuedAt || !newest) return undefined;
  const last = Number(entry.continuedAt.slice(key.length + 1));
  const continued_in = Array.from({ length: last - 1 }, (_, i) => `${key}/${i + 2}`).filter((k) => room.board.has(k));
  return {
    continued_in, newest_key: entry.continuedAt, newest_lines: newest.text.split("\n").slice(1).slice(-5),
    hint: `This entry is full: it is the OLDEST part of the log. The newest lines are in "${entry.continuedAt}" (its last ${Math.min(5, newest.text.split("\n").length - 1)} are in newest_lines). Append with key "${key}" as before.`,
  };
}

export function setBoard(hub: Hub, roomName: string, pid: string, key: string, text: string, opts: BoardExpiryOptions & { ifAbsent?: boolean; ifByMe?: boolean; overwrite?: boolean; append?: boolean } = {}): BoardEntry | null {
  const room = hub.getRoom(roomName);
  const p = hub.requireParticipant(room, pid);
  // A concluded room keeps taking results for a while (lateWrite): a rerun that lands after the vote is recorded, not lost.
  const late = lateWrite(hub, room, key);
  if (room.state === "closed" || (room.state === "concluded" && !late)) {
    const why = room.state === "closed" || LATE_REFUSED.some((x) => key.startsWith(x))
      ? "there is nothing left to coordinate"
      : `late results were accepted for ${Math.round(hub.lateWriteMs / 60_000)} min after it concluded, and that has passed`;
    throw new HubError(`Room "${roomName}" is ${room.state}: board writes are refused, ${why}. Earlier entries, including verify/* and handoff/*, are still readable with board_get.`, undefined, "state");
  }
  if (!BOARD_KEY.test(key)) throw new HubError("Board keys are short names like 'evidence', 'open questions', 'claim/auth', 'verify/auth'.", undefined, "key-format");
  if (opts.append) return appendBoard(hub, room, p, key, text);
  if (text.length > 8000) throw new HubError("Board entries are capped at 8000 characters.", undefined, "size");
  const expiresAt = boardExpiry(key, opts);
  const previous = room.board.get(key);
  // reserved prefixes (enforced here, the single write site)
  if (key.startsWith("inbox/") && !key.endsWith(".ack")) throw new HubError("inbox/* entries are written by post_to_room from another room. To acknowledge one, write '<key>.ack'.", undefined, "invalid-arg");
  if (key.startsWith("hold/")) {
    if (key !== `hold/${room.name}`) throw new HubError(`A hold for this room is the key "hold/${room.name}".`, undefined, "key-format");
    if (previous && previous.by !== p.name) throw new HubError(`The hold was placed by ${previous.by}; only they (or a human) can clear or change it.`, undefined, "ownership");
  }
  // author-only, and refused without echoing the text: an ownership error that returned the entry would unseal it
  if (key.startsWith("draft/") && previous && previous.by !== p.name) throw new HubError(`"${key}" is ${previous.by}'s draft; draft/* entries are author-only. Write your own, e.g. draft/${p.name}.`, undefined, "ownership");
  const attacked = key.startsWith("attack/") && text.trim() ? checkAttack(room, p, key, text) : undefined;
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
        throw new HubError('claim/* entries are JSON: {"area":..., "owner":..., "team":[names], "status":"open|fixed|verified", "note":...}', undefined, "invalid-arg");
      }
      if (parsed && (parsed.status === "fixed" || parsed.status === "verified")) {
        const team = Array.isArray(parsed.team) ? (parsed.team as unknown[]).map(String) : [];
        const members = hub.activeParticipants(room).filter((x) => team.includes(x.name) && x.agent !== "human");
        if (members.length < 2 || sessionsOf(members) < 2) {
          throw new HubError(`A claim can only be marked ${parsed.status} by a team of 2+ distinct active agents; team=${JSON.stringify(team)} has ${members.length} active on ${sessionsOf(members)} connection(s).`, undefined, "state");
        }
      }
    }
    reviewer = previous ? undefined : assignReviewer(hub, room, p);
  }
  // take/<what>: holder-only, offered with a leading @name; refused before any other rule so overwrite cannot pass it
  const take = key.startsWith("take/") ? takeWrite(hub, room, p, key, text, previous?.text.trim() ? previous : undefined) : undefined;
  if (opts.ifAbsent && previous) throw new HubError(`"${key}" already exists (by ${previous.by}, ${previous.updatedAt}).`, { existing: previous }, "state");
  if (opts.ifByMe && previous && previous.by !== p.name) throw new HubError(`"${key}" was written by ${previous.by}, not you. Use post_to_room or a different key.`, undefined, "ownership");
  // clearing is replacing with nothing: a peer's empty write once deleted any entry without overwrite (idea/board-empty-delete).
  // A verify entry gates a proposal and an attack holds one, so only their author or a human may clear or replace them:
  // with overwrite a peer could swap someone's failing verdict for a passing one under their own name.
  const clearsPeer = !text.trim() && !!previous && previous.by !== p.name && p.agent !== "human";
  // An acknowledgement belongs to the room, not its first writer: 21 of 44 ownership refusals after take/ shipped were a
  // second seat acking the same note (evidence/ack-races: 17 covering, 4 stale). A stale ack is simply replaced; on a
  // current one a bare repeat is a no-op and a reply is appended, so no seat's answer to the note is discarded.
  if (key.startsWith("inbox/") && key.endsWith(".ack") && previous && previous.by !== p.name && text.trim()) {
    const acked = room.board.get(key.slice(0, -4));
    if (acked && previous.acknowledgedTextHash === noteHash(acked.text)) {
      if (BARE_ACK.test(text) || norm(text) === norm(previous.text) || previous.text.includes(`— ${p.name}: ${text.trim()}`)) return previous;
      text = `${previous.text}\n— ${p.name}: ${text.trim()}`;
      if (text.length > 8000) throw new HubError(`"${key}" already holds ${previous.text.length} chars of acknowledgements; yours would pass the 8000 cap. Put your reply in an entry of your own and ack with a short line.`, undefined, "size");
    }
    opts = { ...opts, overwrite: true };
    noteBoardRead(p, key, previous);
  }
  if (previous && previous.by !== p.name && p.agent !== "human" && /^(verify|review|attack)\//.test(key)) throw new HubError(`"${key}" is ${previous.by}'s entry; only its author or a human may ${text.trim() ? "replace" : "clear"} it. Write your own (verify/<area>-<you>), or answer it on the board (for an attack, edit the attacked entry).`, undefined, "ownership");
  if (previous && previous.by !== p.name && !take && !opts.overwrite && (text.trim() || clearsPeer) && !(key.startsWith("claim/") && (claimReleased(previous) || takeover))) {
    noteBoardRead(p, key, previous);
    throw new HubError(
      `"${key}" was written by ${previous.by} at ${previous.updatedAt}; replacing it would discard their text. Merge with the current content below and resend with overwrite=true, or use your own key. To add a line to a shared log or queue, resend with append=true instead: nothing is replaced.`,
      { current: previous },
      "ownership",
    );
  }
  // overwrite=true from a stale read is a lost update (ranked/list, swarm-082539-kns2): refused once, with the version to merge
  if (previous && previous.by !== p.name && !take && opts.overwrite && !key.startsWith("claim/") && boardSeen.get(p)?.get(key) !== previous.updatedAt) {
    const read = boardSeen.get(p)?.has(key);
    noteBoardRead(p, key, previous);
    throw new HubError(
      `"${key}" ${read ? "changed since you last read it" : "is one you have not read"}: ${previous.by} wrote this version at ${previous.updatedAt}. Overwriting it would discard their edit. Merge your change into the current content below and resend with overwrite=true.`,
      { current: previous },
      "ownership",
    );
  }
  if (!text.trim()) {
    applyBoard(room, key, null);
    hub.persist({ type: "board", room: roomName, key, entry: null });
    if (take) { if (previous) announceTake(hub, room, p, key, text, take); return null; }
    hub.post(room, "board", p, `cleared board entry "${key}"${previous && previous.by !== p.name ? ` (${previous.by}'s)` : ""}`);
    if (key === `hold/${room.name}`) for (const pr of room.proposals.values()) if (pr.status === "open") hub.evaluate(room, pr);
    return null;
  }
  hub.surfaceCited(room, text, `cited on the board under ${key}`);
  const note = key.startsWith("inbox/") && key.endsWith(".ack") ? room.board.get(key.slice(0, -4)) : undefined;
  if (key.startsWith("verify/")) p.lastVerifiedAt = now();
  // a draft written or edited after peers' drafts became readable may have copied them: say so wherever it is listed
  const postReveal = key.startsWith("draft/") && (!!previous?.postReveal || !!room.draftsRevealed || hub.draftsDue(room));
  const workspace = key.startsWith("claim/") ? hub.workspaceOf(p) : undefined;
  const read = isReviewKey(key) ? readVerifyHead(text) : undefined;
  const head = read && "head" in read ? read.head : undefined;
  // the writer's own worktree, never the hub's: a shared hub serves rooms on other repos (devkit), whose commits it lacks
  const commitCheck = head ? checkCommits(hub.workspaceOf(p)?.worktree, head) : undefined;
  const entry: BoardEntry = {
    text, by: p.name, updatedAt: now(),
    ...(expiresAt ? { expiresAt } : {}),
    ...(key.startsWith("verify/") ? { codeState: codeState(hub.cwd) } : {}),
    ...(note ? { acknowledgedTextHash: noteHash(note.text) } : {}),
    ...(reviewer ? { reviewer: reviewer.name, reviewerId: reviewer.id }
      : previous?.reviewer ? { reviewer: previous.reviewer, reviewerId: previous.reviewerId } : {}),
    ...(postReveal ? { postReveal: true } : {}),
    ...(attacked ? { attackedChars: norm(room.board.get(attacked.target)!.text).length - (room.board.get(attacked.target)!.othersChars ?? 0) } : {}),
    ...(workspace ? { workspace } : {}),
    ...(commitCheck ? { commitCheck } : {}),
    ...(late ? { late: true } : {}),
    ...(take ? { holder: take.holder.name, ...(take.offeredBy ? { offeredBy: take.offeredBy.name } : {}) } : {}),
  };
  applyBoard(room, key, entry);
  noteBoardRead(p, key, entry);
  hub.persist({ type: "board", room: roomName, key, entry });
  // a sealed draft's notice names neither key nor size (either can carry content); it says who is still owed a draft
  if (key.startsWith("draft/")) hub.openDrafts(room); // before the notice, so the first one already names the deadline
  if (take) { announceTake(hub, room, p, key, text, take); return entry; }
  const sealedDraft = key.startsWith("draft/") && !room.draftsRevealed && !hub.draftsComplete(room) && !hub.draftsDue(room);
  hub.post(room, "board", p, sealedDraft ? `${previous ? "updated" : "wrote"} a sealed draft (${hub.draftProgress(room)})`
    : `${previous ? "updated" : "added"} board entry "${key}" (${text.length} chars; read it with board_get)`
    + (postReveal ? " — post-reveal: written after peers' drafts were readable, so not an independent attempt" : "")
    + (workspace ? ` — ${workspace.branch ? `branch ${workspace.branch} in ` : ""}${workspace.worktree}` : "")
    + (reviewer ? ` — reviewer: ${reviewer.name}` : "")
    + (commitCheck ? missingCommits(commitCheck) : "")
    + (late ? " — late: written after the room concluded; recorded, the conclusion does not change" : ""),
    /^(verify|review|attack)\//.test(key) && commitsIn(text).length ? { covers: commitsIn(text) } : {});
  // a late verdict that fails a commit the conclusion cites contradicts what was decided: said once, not buried in "late"
  const contradicts = late && head?.commit?.trim() && room.conclusion && (head.exit_code !== 0 || failToPassShortfall(head)) && citesCommit(room.conclusion.text, head.commit) ? head.commit.trim() : undefined;
  if (late) hub.persist({ type: "late_write", room: roomName, key, by: p.name, after_s: late.after_s, ...(contradicts ? { contradicts } : {}), ts: entry.updatedAt });
  if (contradicts) hub.post(room, "system", undefined, `${key} by ${p.name} reports exit_code ${head!.exit_code} on ${contradicts}, which the conclusion cites: a verdict after the conclusion contradicts it. The conclusion stands as decided; read ${key} before relying on it.`);
  if (head) {
    hub.persist({
      type: "review", room: roomName, key, by: p.name, proposal: head.proposal, ...commitCheck,
      ...(head.commit !== undefined && !commitCheck?.commit ? { commit: head.commit } : {}),
      exit_code: head.exit_code, ...(head.base_exit_code !== undefined ? { base_exit_code: head.base_exit_code } : {}),
      ...(head.kind ? { kind: head.kind } : {}), unverified_n: head.unverified?.length ?? 0, ...(head.dev_room ? { dev_room: head.dev_room } : {}), ts: entry.updatedAt,
    });
  }
  if (reviewer) {
    // kind "chat", not "system": an owed @-mention is resolved from content, so it still wakes a held wait after hub.wait() advanced lastSeenSeq
    // past this message; a "system" post with mentions arrives too late. "Exercise ... not only rerun" is the OpenHands qa-changes rule.
    hub.post(room, "chat", undefined,
      `@${reviewer.name} you are the reviewer for ${p.name}'s "${key}" (fewest reviews assigned, then least-recently-verifying; picked by the hub). ` +
      `Once ${p.name} proposes work from it, require_verification prefers a verify/* entry from you over anyone else's while you're still active; ` +
      `its JSON head (in the proposal's blocked_by) records one check of yours failing at the parent commit and passing at ${p.name}'s. Exercise the change the way its users would; do not only rerun ${p.name}'s tests.`);
  }
  if (attacked) {
    // chat kind for the same reason as the reviewer notice: the author's held wait must wake on it
    hub.post(room, "chat", undefined,
      `@${attacked.author} ${p.name} attacked your "${attacked.target}" in "${key}", quoting "${attacked.cites.slice(0, 80)}${attacked.cites.length > 80 ? "…" : ""}". ` +
      `Answer it by editing "${attacked.target}": change the quoted clause, or add a line saying why it stands. An unanswered attack is listed to whoever proposes.`);
  }
  if (takeover) {
    hub.post(room, "system", undefined, `${hub.shown(room, p)} took over "${key}" from ${hub.shown(room, takeover.owner)} (${takeover.reason === "successor" ? "registered successor" : `owner gone since ${hub.lastSeen(takeover.owner)}`}).`);
  }
  if (key.startsWith("claim/") && (!previous || claimReleased(previous))) noticeClaimOverlap(hub, room, p, key, text);
  if (key.endsWith(".ack") || key.startsWith("verify/")) for (const pr of room.proposals.values()) if (pr.status === "open") hub.evaluate(room, pr);
  if (key.startsWith("draft/")) hub.latchDrafts(room);
  return entry;
}

/** Coordination keys: with the room concluded nobody can join a team, take a turn, hold a vote or draft blind. attack/ asks
 * its author to answer by editing, an ask nobody can usefully answer once the room is over (review/6a584cdd finding 1). */
const LATE_REFUSED = ["claim/", "take/", "hold/", "draft/", "inbox/", "help/", "join-request/", "idea/", "attack/"];

/** Whether a write to a concluded room is a late result the board still takes, and how long after the conclusion it is.
 * Late results and verdicts were lost in 7 rooms (chat-and-friction issue 10): the seat's rerun or review finished
 * after the vote did. The window is Hub.LATE_WRITE_MS; an entry written in it is marked late and changes nothing decided. */
function lateWrite(hub: Hub, room: Room, key: string): { after_s: number } | undefined {
  if (room.state !== "concluded" || !room.conclusion?.decidedAt || LATE_REFUSED.some((x) => key.startsWith(x))) return undefined;
  const after = Date.now() - Date.parse(room.conclusion.decidedAt);
  return after < hub.lateWriteMs ? { after_s: Math.max(0, Math.round(after / 1000)) } : undefined;
}

/** The commits a verify head names, each resolved in the writer's worktree (commitKnown; unchecked without one); undefined if it names none. */
function checkCommits(cwd: string | undefined, head: { commit?: string; base_commit?: string }): BoardEntry["commitCheck"] {
  const out: NonNullable<BoardEntry["commitCheck"]> = {};
  for (const f of ["commit", "base_commit"] as const) {
    const sha = head[f]?.trim();
    if (!sha) continue;
    out[f] = sha;
    const known = commitKnown(cwd, sha);
    if (known !== undefined) out[f === "commit" ? "commit_known" : "base_known"] = known;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Said in the board notice, not refused: a reviewer may cite a commit in another repo (devkit), and only they know. */
function missingCommits(c: NonNullable<BoardEntry["commitCheck"]>): string {
  const gone = [c.commit_known === false ? `commit ${c.commit}` : "", c.base_known === false ? `base_commit ${c.base_commit}` : ""].filter(Boolean);
  return gone.length ? ` — names ${gone.join(" and ")}, which does not exist in your worktree's repository: check the SHA, or say which repo it is in` : "";
}

/** Coordination state, not findings: there is no claim about the world in these to attack. */
const NOT_A_FINDING = ["claim/", "verify/", "review/", "hold/", "inbox/", "handoff/", "help/", "join-request/", "draft/", "attack/"];
/** An author's answer that leaves the quoted clause standing must add at least this much: a reply, not a re-save. */
export const ATTACK_REPLY_MIN_CHARS = 40;
/** Below this an entry is a note (a todo, a port number), not a finding a proposal could rest on. */
export const FINDING_MIN_CHARS = 200;

const isFinding = (key: string) => !NOT_A_FINDING.some((x) => key.startsWith(x)) && !key.endsWith(".ack") && !key.endsWith(".partial");

/**
 * attack/<key>: scrutiny of a board entry before any proposal exists (challenge needs an open proposal, and in 82 past
 * rooms the first one arrived a median 19.5 min in). Same rules as a blocking challenge: someone other than the author,
 * on another connection, quoting the text objected to.
 */
function checkAttack(room: Room, p: Participant, key: string, text: string): { target: string; author: string; cites: string } {
  const target = key.slice("attack/".length);
  const e = room.board.get(target);
  if (!isFinding(target)) throw new HubError(`"${target}" is coordination state and cannot be attacked; attack/<key> targets a finding, e.g. attack/evidence/x for "evidence/x".`, undefined, "key-format");
  if (!e) throw new HubError(`There is no board entry "${target}" to attack. attack/<key> names an existing entry, e.g. attack/evidence/x for "evidence/x".`, undefined, "state");
  if (e.by === p.name) throw new HubError(`"${target}" is your own entry; someone else must attack it. Edit it instead, or attack another seat's finding.`, undefined, "ownership");
  const author = [...room.participants.values()].find((x) => x.name === e.by);
  if (author?.session && p.session && author.session === p.session) {
    throw new HubError(`You share a connection with ${e.by}, the author of "${target}": an attack must come from a different session (identity-is-the-connection).`, undefined, "ownership");
  }
  const cites = [...text.matchAll(QUOTED)].map((m) => m[1]).filter((q) => norm(e.text).includes(norm(q))).sort((a, b) => b.length - a.length)[0];
  if (!cites) throw new HubError(`An attack must quote the clause of "${target}" it objects to (12+ characters, in double quotes), then say what is wrong with it. Read the entry with board_get and copy the text.`, undefined, "cite-required");
  return { target, author: e.by, cites };
}

/** Open until the author removes every clause the attack quotes, or adds a reply to the attacked entry. */
function attackOpen(attack: BoardEntry, target: BoardEntry): boolean {
  const text = norm(target.text);
  // growth from other seats' appended lines (board_set append) is not a reply by the author
  return [...attack.text.matchAll(QUOTED)].some((m) => text.includes(norm(m[1]))) && text.length - (target.othersChars ?? 0) < (attack.attackedChars ?? 0) + ATTACK_REPLY_MIN_CHARS;
}

/** The system line posted with the one refusal; it is also the receipt, so a replayed room does not refuse again. */
export const SCRUTINY_HELD = "A proposal was held once";

const QUOTED = /["“]([^"”]{12,})["”]/g;

/**
 * What a proposal would rest on unexamined: findings by an agent that no other connection has attacked, quoted or even
 * named (in chat, a challenge or its own board entry), and attacks the author has not answered (answering is removing
 * the quoted clause from the attacked entry, or adding a reply to it). Naming counts because seats mostly check each other in chat: in
 * dev room swarm-002346-crax a finding the verifier had reproduced there was listed as never looked at.
 */
export function scrutiny(room: Room): { unexamined: string[]; open_attacks: string[] } {
  const byName = new Map([...room.participants.values()].map((x) => [x.name, x]));
  const other = (author: Participant, name: string) => {
    const x = byName.get(name);
    return !!x && x.id !== author.id && !(x.session && author.session && x.session === author.session);
  };
  const said: { by: string; text: string }[] = [
    ...room.messages.filter((m) => m.kind !== "system" && m.kind !== "board").map((m) => ({ by: m.from.name, text: m.content })),
    // a review/* is scrutiny, not a finding: nobody owes it an attack, and what it names or quotes has been looked at
    ...[...room.board].filter(([k]) => isFinding(k) || k.startsWith("review/")).map(([, e]) => ({ by: e.by, text: e.text })),
  ];
  const unexamined: string[] = [];
  const open_attacks: string[] = [];
  for (const [key, e] of room.board) {
    if (key.startsWith("attack/")) {
      const target = key.slice("attack/".length);
      const t = room.board.get(target);
      if (t && attackOpen(e, t)) open_attacks.push(key);
      continue;
    }
    const author = byName.get(e.by);
    if (!isFinding(key) || e.text.length < FINDING_MIN_CHARS || !author || author.agent === "human" || room.board.has(`attack/${key}`)) continue;
    const text = norm(e.text);
    const looked = said.some((s) => other(author, s.by) && (s.text.includes(key) || [...s.text.matchAll(QUOTED)].some((m) => text.includes(norm(m[1])))));
    if (!looked) unexamined.push(key);
  }
  return { unexamined, open_attacks };
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
  const top = overlapsFor(hub, room, p, key, text).slice(0, 2);
  if (!top.length) return;
  // kind "chat" so the @-mentions wake a held wait, same reason as the reviewer notice above; an owner in a linked room
  // is named without @ (not a participant here) and the room is named
  hub.post(room, "chat", undefined,
    `@${p.name} your "${key}" overlaps ${top.map((h) => `${h.room ? "" : "@"}${h.by}'s "${h.key}"${h.room ? ` in ${h.room}` : ""} (${h.shared_pct}% shared terms: ${h.shared.join(", ")})`).join(" and ")}. ` +
    `Before both of you build it: merge into one team (claim JSON team:[...]), split it explicitly, or pick another area. Advisory only, the claim stands.`);
}

/** Live claims by other active connections sharing >= 40% of term stems (Jaccard, >= 4 shared) with this claim, best first.
 * Read by the creation notice and by board_set's response, so the claimant sees the collision synchronously too. */
export function claimOverlaps(hub: Hub, roomName: string, pid: string, key: string): { key: string; by: string; room?: string; shared_pct: number; shared: string[] }[] {
  const room = hub.getRoom(roomName);
  const e = room.board.get(key);
  return key.startsWith("claim/") && e ? overlapsFor(hub, room, hub.requireParticipant(room, pid), key, e.text) : [];
}

/**
 * The rooms whose claims are compared with this room's: itself, its parent and its break-outs, one hop. A parent did not
 * see what its break-out had taken (friction/sub-room-work-invisible, swarm-003601-tky5). Two break-outs of one parent are
 * two hops apart and never compared: groups with opposing briefs must not see each other's work.
 */
function linkedRooms(hub: Hub, room: Room): Room[] {
  const parent = room.parent ? hub.rooms.get(room.parent) : undefined;
  return [room, ...(parent ? [parent] : []), ...[...hub.rooms.values()].filter((r) => r.parent === room.name && !r.archived)];
}

function overlapsFor(hub: Hub, room: Room, p: Participant, key: string, text: string) {
  const mine = claimTerms(key, text);
  if (mine.size < 4) return [];
  const myKey = claimTerms(key, "");
  const hits: { key: string; by: string; room?: string; shared_pct: number; shared: string[] }[] = [];
  for (const r of linkedRooms(hub, room)) {
    if (r !== room && (r.state === "concluded" || r.state === "closed")) continue;
    for (const [k, e] of r.board) {
      if ((r === room && (k === key || e.by === p.name)) || !k.startsWith("claim/") || !e.text.trim() || claimReleased(e) || claimKeysSplit(key, k)) continue;
      const owner = [...r.participants.values()].filter((x) => x.name === e.by).at(-1);
      if (!owner?.active || (owner.session && p.session && owner.session === p.session)) continue;
      const s = claimOverlapScore(mine, myKey, claimTerms(k, e.text), claimTerms(k, ""));
      if (s.fires) hits.push({ key: k, by: e.by, ...(r !== room ? { room: r.name } : {}), shared_pct: Math.round(s.jac * 100), shared: s.shared.slice(0, 6) });
    }
  }
  return hits.sort((a, b) => b.shared_pct - a.shared_pct);
}

/** Two claim keys that are the same apart from their numbers, with no number in common (markets-1-200 and
 * markets-201-400, item-6 and item-7): an explicit split, not an overlap. The numbers are the only part that differs and
 * are not terms, so the shared task nouns would otherwise fire (friction/claim-overlap-false-positive, swarm-003601-tky5;
 * 15 of the 315 recorded firings, all item-N pairs in swarm-105802-0s9p-room, each a different item; it removes no other). */
export function claimKeysSplit(a: string, b: string): boolean {
  const nums = (k: string) => new Set(k.match(/\d+/g) ?? []);
  const x = nums(a), y = nums(b);
  return x.size > 0 && y.size > 0 && ![...x].some((n) => y.has(n)) && a.replace(/\d+/g, "#") === b.replace(/\d+/g, "#");
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

/** Reviewer for a new claim/<area>: an active voter other than the owner, a standing seat before a recruit, fewest reviews assigned, then least-recently-verifying, then earliest join.
 * Hub-chosen, never client-supplied, so a claimant cannot pick their own reviewer by writing it into the JSON. */
function assignReviewer(hub: Hub, room: Room, owner: Participant): Participant | undefined {
  // identity-is-the-connection: a second name on the owner's own MCP session is not "someone
  // else" (the same sock-puppet case verifiedBy() already excludes for authorship, hub.ts ~2190).
  const others = hub.voters(room).filter((x) => x.id !== owner.id && !(x.session && owner.session && x.session === owner.session));
  // A recruit came for one brief and leaves when it is done: 11 of 13 recruits the hub assigned never wrote a verify/*
  // (231 of 473 standing seats; scripts/reviewer-recruit-measure.py). Pick one only when nobody else can review.
  // A registered successor (replacementOf, set by the hub at its token join) took over a departed seat and stays: standing.
  const standing = others.filter((x) => x.role !== "recruit" || !!x.replacementOf);
  const candidates = standing.length ? standing : others;
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

/** Notes whose refusal the target room was already told of, until they land (not persisted: a restart may tell once more). */
const inboxRefusedTold = new WeakMap<Room, Set<string>>();

/**
 * The cap refusal reaches the room that can release it, not only the sender (sources/reactive-streams-backpressure:
 * the bound must be known to the receiver). It is logged in the target room as an inbox_refused event (no text), and
 * the room hears once per refused note which notes to acknowledge.
 */
function refuseNote(hub: Hub, to: Room, fromRoom: string, byName: string, full: string, chars: number, open: string[]): never {
  const err = new HubError(`${to.name} already has 10 inbox notes awaiting acknowledgement; wait for them to be acknowledged or cleared. That room has been told your note "${full}" was refused; it was not stored, so send it again once a slot frees.`, undefined, "inbox-cap");
  hub.recordRefusal(to.name, "post_to_room", err);
  hub.persist({ type: "inbox_refused", room: to.name, ts: now(), from_room: fromRoom, by: byName, key: full, chars, open: open.length });
  const told = inboxRefusedTold.get(to) ?? new Set<string>();
  inboxRefusedTold.set(to, told);
  if (!told.has(full)) {
    told.add(full);
    hub.post(to, "system", undefined,
      `A note from ${byName} in ${fromRoom} ("${full}", ${chars} chars) was refused: this room has ${open.length} notes awaiting acknowledgement, the most it holds. ` +
      `Read and acknowledge them (board_set key="<key>.ack") so notes reach you again: ${open.join(", ")}.`);
  }
  throw err;
}

/** Cross-room note: written into the target room's board under inbox/<from>/<key> without joining it. */
export function postToRoom(hub: Hub, fromRoom: string, pid: string, toRoom: string, key: string, text: string, ackRequired = false, opts: BoardExpiryOptions = {}): { key: string; entry: BoardEntry } {
  const from = hub.getRoom(fromRoom);
  const p = hub.requireParticipant(from, pid);
  if (toRoom === fromRoom) throw new HubError("That is your own room; use board_set.", undefined, "invalid-arg");
  const to = hub.getRoom(toRoom);
  if (to.state === "concluded" || to.state === "closed") {
    throw new HubError(`Room "${toRoom}" is ${to.state}: board writes are refused, there is nothing left to coordinate there.`, undefined, "state");
  }
  if (!/^[\w .:-]{1,40}$/.test(key)) throw new HubError("Inbox keys are short names without slashes.", undefined, "key-format");
  if (text.length > 8000) throw new HubError("Notes are capped at 8000 characters.", undefined, "size");
  const full = `inbox/${fromRoom}/${key}`;
  const expiresAt = boardExpiry(full, opts);
  const entry: BoardEntry = { text, by: p.name, updatedAt: now(), ...(expiresAt ? { expiresAt } : {}), ...(ackRequired ? { ackRequired: true } : {}) };
  // Only notes the room is asked to acknowledge hold a slot: optional ones (rulings, FYIs) once filled the cap with
  // nothing telling anyone to ack them, and cut 0btz-build off for 49 min and 1nwp-external for 28.5 (claim/inbox-cap).
  // Replacing an open note consumes no extra slot. A changed text hash invalidates its old ack.
  const otherOpen = unacknowledged(to).filter((k) => k !== full);
  if (ackRequired && inboxOpen(to, full, entry) && otherOpen.length >= 10) refuseNote(hub, to, from.name, p.name, full, text.length, otherOpen);
  inboxRefusedTold.get(to)?.delete(full);
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
