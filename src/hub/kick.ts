/** The Hub's kick vote and removal, as functions over the Hub instance; Hub keeps a one-line delegator for each member called from outside. */
import type { Hub } from "../hub.js";
import { applyBoard, sessionsOf, quorumNeeded } from "./board.js";
import { HubError } from "./types.js";
import type { Participant, KickVote, BoardEntry, Room } from "./types.js";
import { now } from "./internal.js";

/** Who may be a kick target: an active non-human, non-chair participant of this room, by name (or id). */
function kickTarget(hub: Hub, room: Room, target: string): Participant {
  const p = room.participants.get(target) ?? [...room.participants.values()].filter((x) => x.name === target).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))[0];
  if (!p) throw new HubError(`No participant named "${target}" in "${room.name}".`);
  if (p.kicked) throw new HubError(`${hub.shown(room, p)} was already removed from "${room.name}" (${p.kicked.reason}).`, undefined, "state");
  if (!p.active) throw new HubError(`${hub.shown(room, p)} has already left "${room.name}"; there is nothing to remove. To bring in a successor, request_agent(replacing=${JSON.stringify(p.name)}).`, undefined, "state");
  if (p.agent === "human" || p.role === "chair") throw new HubError("Humans and the chair are the room's controllers; they cannot be voted out.", undefined, "auth");
  return p;
}

/** Who decides a kick: the electorate() of every present voter with the target as the hypothetical leaver, minus other
 * identities on the target's connection (identity is the connection, so a sibling name neither ballots nor enlarges the threshold). */
function kickPool(hub: Hub, room: Room, target: Participant): Participant[] {
  return hub.electorate(room, {}, target.id).members.filter((p) => !(target.session && p.session === target.session));
}

/** Ballots needed: the quorum rule over the pool's distinct connections (unanimous = all), never fewer than 2, so no seat is removed on one ballot.
 * In a room of two the second must come from a human, else the vote is refused (the idle sweep handles dead seats). */
export function kickNeeded(hub: Hub, room: Room, target: Participant): number {
  const sessions = sessionsOf(kickPool(hub, room, target));
  return Math.max(room.quorum === "unanimous" ? sessions : quorumNeeded(room.quorum, sessions), 2);
}

/** Ballots that could still arrive: pool connections plus dashboard humans, minus those already voting keep. */
function kickPossible(hub: Hub, room: Room, target: Participant, keep = 0): number {
  const humans = hub.activeParticipants(room).filter((p) => dashboardHuman(p)).length;
  return sessionsOf(kickPool(hub, room, target)) + humans - keep;
}

/**
 * A human whose ballot the hub trusts: one that arrived through the token-gated HTTP routes (session "http:<name>",
 * set by src/index.ts), never a name that merely declared agent="human" on an MCP connection (any seat can do that).
 */
export function dashboardHuman(p: Participant): boolean {
  return p.agent === "human" && !!p.session?.startsWith("http:");
}

/** Start a vote to remove `target` or add a ballot to the open one; the caller's ballot counts either way, one open vote per target,
 * a settled one can be restarted. Dashboard humans use the same entry point; the target cannot vote on its own removal. */
export function kickVote(hub: Hub, roomName: string, pid: string, target: string, vote: "kick" | "keep" = "kick", reason?: string): KickVote {
  const room = hub.getRoom(roomName);
  const by = hub.requireParticipant(room, pid);
  if (room.state === "concluded" || room.state === "closed") throw new HubError(`Room "${roomName}" is ${room.state}; nobody can be removed from it.`, undefined, "state");
  const t = kickTarget(hub, room, target);
  if (t.id === by.id) throw new HubError("You cannot vote to kick yourself: leave_room instead.");
  // everyone, self-declared humans included: a seat that joins a second name as agent="human" on its own
  // connection is still that connection (identity-is-the-connection), so it may not veto its own kick
  if (by.session && t.session && by.session === t.session) throw new HubError("That participant shares your connection; identity is the connection, so this would be a vote on yourself.", undefined, "auth");
  const human = dashboardHuman(by);
  if (!human && !kickPool(hub, room, t).some((p) => p.id === by.id)) {
    throw new HubError(`Only voters on other connections, or a human on the dashboard, may vote on removing ${hub.shown(room, t)}; a name joined as agent="human" over MCP is not a dashboard human.`, undefined, "auth");
  }
  let kv = room.kickVotes.get(t.id);
  if (!kv || kv.status !== "open") {
    const why = reason?.trim() ?? "";
    if (vote !== "kick") throw new HubError(`There is no open vote to kick ${hub.shown(room, t)}; only a "kick" ballot with a reason starts one.`);
    if (why.length < 8) throw new HubError("A kick vote needs a reason (one line): persistent disagreement blocking progress, or evidence the session is dead (liveness/last_seen_at).");
    const needed = hub.kickNeeded(room, t);
    if (kickPossible(hub, room, t) < needed) {
      throw new HubError(`A kick needs ${needed} ballots from distinct connections (never one seat alone) and only ${kickPossible(hub, room, t)} could vote here besides ${hub.shown(room, t)}. A human on the dashboard can supply one; otherwise the idle sweep marks a dead seat left after 10 min, and request_agent(replacing=${JSON.stringify(t.name)}) then needs no vote.`, undefined, "state");
    }
    kv = { target: t.id, targetName: t.name, by: { id: by.id, name: by.name }, reason: why.slice(0, 600), startedAt: now(), ballots: {}, status: "open" };
    room.kickVotes.set(t.id, kv);
    hub.post(room, "system", undefined,
      `${hub.shown(room, by)} started a vote to kick ${hub.shown(room, t)}: ${kv.reason} — needs ${needed} kick ballot(s) from distinct connections (quorum=${room.quorum} over the other voters). ` +
      `Vote with kick_vote(target=${JSON.stringify(hub.shown(room, t))}, vote="kick"|"keep"); the target may not vote. On the threshold the hub removes them, releases their claim/* entries and their next call tells them they were kicked.`);
  }
  kv.ballots[by.id] = { name: by.name, vote, ts: now(), session: by.session, ...(human ? { human: true } : {}) };
  hub.persist({ type: "kick_vote", room: roomName, vote: kv });
  hub.post(room, "system", undefined, `${hub.shown(room, by)} votes ${vote.toUpperCase()} on removing ${hub.shown(room, t)} (${kickTally(hub, room, kv).summary}).`);
  evaluateKick(hub, room, kv);
  return kv;
}

/** Ballots counted per connection over the current pool (a ballot from a seat that has since left no longer counts). */
function kickTally(hub: Hub, room: Room, kv: KickVote) {
  const t = room.participants.get(kv.target)!;
  const pool = kickPool(hub, room, t);
  const eligible = new Set(pool.map((p) => p.id));
  const kickSessions = new Set<string>();
  const keepSessions = new Set<string>();
  let humanKeep = false;
  for (const [id, b] of Object.entries(kv.ballots)) {
    const voter = room.participants.get(id);
    if (!voter?.active) continue;
    const identity = voter.session ?? voter.id;
    if (b.human) {
      if (b.vote === "keep") humanKeep = true;
      else kickSessions.add(identity);
      continue;
    }
    if (!eligible.has(id)) continue;
    (b.vote === "kick" ? kickSessions : keepSessions).add(identity);
  }
  const needed = hub.kickNeeded(room, t);
  const poolSessions = sessionsOf(pool);
  const possible = kickPossible(hub, room, t, keepSessions.size);
  return { kick: kickSessions.size, keep: keepSessions.size, needed, pool: poolSessions, possible, humanKeep, summary: `${kickSessions.size}/${needed} kick, ${keepSessions.size} keep, ${poolSessions} eligible connection(s)` };
}

function evaluateKick(hub: Hub, room: Room, kv: KickVote): void {
  if (kv.status !== "open") return;
  const t = room.participants.get(kv.target);
  if (!t || !t.active) { settleKick(hub, room, kv, "dropped", `${kv.targetName} is no longer in the room`); return; }
  const tally = kickTally(hub, room, kv);
  if (tally.humanKeep) { settleKick(hub, room, kv, "dropped", "a human voted keep (veto)"); return; }
  if (tally.kick >= tally.needed) {
    settleKick(hub, room, kv, "kicked", `${tally.kick} of ${tally.needed} needed kick ballots`);
    hub.removeParticipant(room.name, t.id, `a kick vote started by ${kv.by.name}`, kv.reason);
    return;
  }
  // keep ballots that make the threshold unreachable end the vote early
  if (tally.possible < tally.needed) settleKick(hub, room, kv, "dropped", `${tally.keep} keep ballot(s) leave fewer than ${tally.needed} possible kick ballots`);
}

function settleKick(hub: Hub, room: Room, kv: KickVote, status: "kicked" | "dropped", outcome: string): void {
  kv.status = status;
  kv.endedAt = now();
  kv.outcome = outcome;
  hub.persist({ type: "kick_vote", room: room.name, vote: kv });
  if (status === "dropped") hub.post(room, "system", undefined, `The vote to kick ${kv.targetName} was dropped: ${outcome}.`);
}

/** The single removal primitive (kick vote, replace): mark the target and its same-connection aliases kicked so they cannot call or rejoin,
 * release their claim/* entries for a successor, drop kick votes they started, and re-evaluate open proposals (electorate() skips inactive seats). */
export function removeParticipant(hub: Hub, roomName: string, target: string, by: string, reason: string): Participant {
  const room = hub.getRoom(roomName);
  const p = kickTarget(hub, room, target);
  const why = reason.trim().slice(0, 600) || "removed";
  // identity is the connection: every other active name on the target's connection goes with it, or an alias
  // that can never call again would sit in the electorate and block quorum
  const seats = [p, ...(p.session ? hub.activeParticipants(room).filter((x) => x.id !== p.id && x.session === p.session && x.agent !== "human") : [])];
  const at = now();
  const claims: string[] = [];
  for (const s of seats) {
    s.active = false;
    s.lastActiveAt = at;
    s.kicked = { by, reason: why, at };
    s.leaveReason = `kicked (${by}): ${why}`;
    hub.persist({ type: "leave", room: roomName, p: s });
    for (const [k, e] of room.board.entries()) {
      if (!k.startsWith("claim/") || e.by !== s.name || !e.text.trim()) continue;
      let released: Record<string, unknown> = {};
      try { released = JSON.parse(e.text) as Record<string, unknown>; } catch { released = { note: e.text }; }
      released = { ...released, status: "released", released_from: s.name, released_by: by, released_at: at };
      const entry: BoardEntry = { ...e, text: JSON.stringify(released), by: "system", updatedAt: at };
      applyBoard(room, k, entry);
      hub.persist({ type: "board", room: roomName, key: k, entry });
      claims.push(k);
    }
    for (const kv of room.kickVotes.values()) if (kv.status === "open" && kv.target !== s.id && kv.by.id === s.id && Object.keys(kv.ballots).length <= 1) settleKick(hub, room, kv, "dropped", `${s.name}, who started it, was removed`);
  }
  const aliases = seats.slice(1).map((s) => hub.shown(room, s));
  hub.post(room, "system", undefined,
    `${hub.shown(room, p)} was removed from the room by ${by}: ${why}.` +
    (aliases.length ? ` ${aliases.join(", ")} (same connection) removed with them.` : "") +
    (claims.length ? ` Released ${claims.length} claim/* entr${claims.length === 1 ? "y" : "ies"} (${claims.join(", ")}): status is now "released", content kept, anyone may claim the area.` : "") +
    ` Their next hub call is refused with KICKED; they cannot rejoin.`);
  for (const pr of room.proposals.values()) if (pr.status === "open") hub.evaluate(room, pr);
  hub.latchDrafts(room);
  return p;
}

/** Kick votes as room_status / the dashboard show them. */
export function kickView(hub: Hub, room: Room, kv: KickVote, reveal = false) {
  const t = room.participants.get(kv.target);
  const nm = (p: { id: string; name: string }) => (reveal ? p.name : hub.shown(room, room.participants.get(p.id) ?? p));
  const tally = t && kv.status === "open" ? kickTally(hub, room, kv) : undefined;
  return {
    target: t ? nm(t) : kv.targetName,
    by: nm(kv.by),
    reason: kv.reason,
    started_at: kv.startedAt,
    status: kv.status,
    ...(kv.outcome ? { outcome: kv.outcome } : {}),
    ...(tally ? { kick: tally.kick, keep: tally.keep, needed: tally.needed, eligible_connections: tally.pool } : {}),
    ballots: Object.entries(kv.ballots).map(([id, b]) => ({ name: nm({ id, name: b.name }), vote: b.vote, ts: b.ts, ...(b.human ? { human: true } : {}) })),
  };
}
