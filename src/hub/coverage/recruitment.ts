/** Recruitment reserves work before a connection exists; admission completes the normal claim write. */
import type { Hub } from "../../hub.js";
import type { BoardEntry, Participant, Room } from "../types.js";
import { HubError } from "../types.js";
import { claimReleased } from "../board.js";
import { recruitmentClaim } from "./coverage.js";

/** The first recruit owns the claim; additional recruits are its team, never the requester by default. */
export function claimRecruitmentArea(hub: Hub, roomName: string, requester: string, area: string, recruits: string[], brief = ""): void {
  const room = hub.getRoom(roomName), key = `claim/${area}`;
  expireRecruitmentClaims(hub, room);
  const existing = room.board.get(key);
  if (existing && !claimReleased(existing)) {
    throw new HubError(`${key} is owned by ${existing.by}; recruit without area to help them, or have its owner release it first.`, undefined, "ownership");
  }
  if (!recruits.length) throw new HubError("An area needs at least one recruit.", undefined, "invalid-arg");
  const owner = recruits[0];
  const entry = hub.setBoardAs(roomName, owner, key, recruitmentClaim(room, requester, area, recruits, brief), { requestedBy: requester, pending: true });
  recordClaim(hub, room, key, entry, "reserved");
}

/** Runs after admission, when the owner's actual session and worktree can be used. Persisted pending metadata
 * makes this work after restart too; subsequent joins and ordinary edits never reassign the review. */
export function activateRecruitmentClaims(hub: Hub, room: Room, owner: Participant): void {
  if (room.state === "closed" || room.state === "concluded") return;
  expireRecruitmentClaims(hub, room);
  for (const [key, entry] of room.board) {
    if (!key.startsWith("claim/") || entry.by !== owner.name || !entry.recruitment?.pending || claimReleased(entry)) continue;
    try {
      const active = hub.setBoard(room.name, owner.id, key, entry.text);
      if (active) recordClaim(hub, room, key, active, "activated");
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).slice(0, 280);
      recordClaim(hub, room, key, entry, "activation_failed", owner.name, detail);
      hub.announce(room.name, `${key}: ${owner.name} joined, but claim activation failed (${detail}); the reservation remains pending.`);
    }
  }
}

/** No synthetic departed participant: an unjoined reservation becomes a normal system-released claim at the
 * existing stale window, on maintenance or before a claim write. Content and the abandoned owner's name survive. */
export function expireRecruitmentClaims(hub: Hub, room: Room): void {
  if (room.state === "closed" || room.state === "concluded") return;
  const staleMs = (hub.constructor as typeof Hub).STALE_CLAIM_MS;
  for (const [key, entry] of room.board) {
    if (!entry.recruitment?.pending || Date.now() - Date.parse(entry.updatedAt) < staleMs) continue;
    const text = JSON.stringify({ ...JSON.parse(entry.text), status: "released", released_from: entry.by, released_at: new Date().toISOString() });
    const released = hub.setBoardAs(room.name, "system", key, text, { ...entry.recruitment, pending: false });
    recordClaim(hub, room, key, released, "expired", entry.by);
    hub.announce(room.name, `${key}: ${entry.by} did not join within the stale-claim window; the reservation expired and anyone may claim it.`);
  }
}

function recordClaim(hub: Hub, room: Room, key: string, entry: BoardEntry, phase: "reserved" | "activated" | "expired" | "activation_failed", owner = entry.by, error?: string): void {
  const { team } = JSON.parse(entry.text) as { team: string[] };
  hub.persist({ type: "recruit_claim", room: room.name, key, phase, requested_by: entry.recruitment!.requestedBy,
    owner, team, reviewer: entry.reviewer ?? null, ...(error ? { error } : {}), ts: phase === "activation_failed" ? new Date().toISOString() : entry.updatedAt });
}
