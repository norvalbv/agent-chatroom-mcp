/** Hub-private helpers shared by hub.ts and its section modules; not re-exported from hub.ts. */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { RoomState, Participant, KickVote, Message, CodeState, BoardEntry, Challenge, Proposal, RoomOptions, Room, CallOutcome, WorkClass, DevReceipt } from "./types.js";
import type { SeatUsage } from "./usage.js";
import type { DevRun } from "./dev-runs.js";

export type Opts = Required<Omit<RoomOptions, "chair" | "parent">> & { chair?: string; parent?: string };

export type Event =
  | { type: "room"; room: string; opts: Opts; createdAt: string; telemetryVersion?: 1 }
  | { type: "message"; msg: Message }
  | { type: "attention"; room: string; pid: string; lastSeenSeq: number; withheld: number[]; quietReceipts: number[]; focusedAsk?: string; declinedAsks: string[]; declinedAt?: Record<string, number> }
  | { type: "join" | "leave"; room: string; p: Participant }
  | { type: "proposal"; proposal: Proposal }
  | { type: "vote"; room: string; proposalId: string; pid: string; entry: Proposal["votes"][string] }
  | { type: "challenge"; room: string; proposalId: string; challenge: Challenge; votes?: Proposal["votes"] }
  | { type: "challenge_status"; room: string; proposalId: string; challengeId?: string; status: NonNullable<Challenge["status"]> }
  | { type: "state"; room: string; state: RoomState; conclusion?: Room["conclusion"] }
  | { type: "opening"; room: string; pid: string; content: string }
  | { type: "openings_revealed"; room: string }
  | { type: "drafts_revealed"; room: string }
  | { type: "drafts_opened"; room: string; at: string }
  | { type: "deadline"; room: string; at: string; setAt: string }
  | { type: "deadline_announced"; room: string }
  | { type: "archive"; room: string; archived: boolean; by: string; ts: string }
  | { type: "board_manifest"; room: string; bytes: number; kind: "full" | "delta" | "empty" }
  | { type: "board"; room: string; key: string; entry: BoardEntry | null }
  | { type: "dev_receipt"; room: string; key: string; updatedAt: string; receipt: DevReceipt }
  /** A dev run this hub started (src/hub/dev-runs.ts), written at each state change; replay keeps the last. */
  | { type: "dev_run"; room: string; run: DevRun }
  | { type: "amend"; room: string; proposalId: string; text: string; version: number; updatedAt?: string; votes: Proposal["votes"]; challenges?: Challenge[] }
  | { type: "refusal"; room: string; tool: string; reason: string; ts?: string; participant?: string | null }
  | { type: "outside_read"; room: string; by: { room: string; pid: string } | null; via: "http" | "http_pattern" | "file"; tool: string; ts: string }
  /** ms: how long the call took; empty: a wait that returned no new message (run-metrics splits idle polling on it) */
  | { type: "call_completion"; room: string; tool: string; outcome: CallOutcome; ts: string; participant: string | null; ms?: number; empty?: boolean }
  /** key: what the ledger dedupes on when it is not the target itself (a long target is shortened for display) */
  | { type: "work"; room: string; pid: string; cls: WorkClass; tool: string; target: string; key?: string; ts: string }
  /** a seat process's cumulative model usage (src/hub/usage.ts); seat is the seat key's sha256, never the key */
  | { type: "usage"; room: string; seat: string; usage: SeatUsage; ts: string }
  | { type: "kick_vote"; room: string; vote: KickVote }
  /** Telemetry only (replay ignores it): the open work an idle wait named to a seat, written when that list changes. */
  | { type: "open_work"; room: string; pid: string; ts: string; items: string[] };

export const now = () => new Date().toISOString();
/** commit-like tokens (7-40 hex with a letter and a digit) in a text */
export const commitsIn = (text: string) => [...new Set((text.match(/\b[0-9a-f]{7,40}\b/g) ?? []).filter((t) => /[a-f]/.test(t) && /\d/.test(t)))];
export const shortId = (prefix: string) => `${prefix}_${randomBytes(4).toString("hex")}`;
export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

export interface BoardManifestCounters {
  waits_observed: number;
  full_baseline_manifest_bytes: number;
  shipped_manifest_bytes: number;
  keys_shipped: number;
  deleted_tombstones_shipped: number;
}
export const emptyBoardManifestCounters = (): BoardManifestCounters => ({
  waits_observed: 0, full_baseline_manifest_bytes: 0, shipped_manifest_bytes: 0,
  keys_shipped: 0, deleted_tombstones_shipped: 0,
});
export const manifestBytes = (payload: unknown) => Buffer.byteLength(JSON.stringify(payload), "utf8");

/** git HEAD and whether the working tree is dirty, so a citation or a verification names the tree it was read against. */
export function codeState(cwd?: string): CodeState | undefined {
  if (!cwd) return undefined;
  const head = spawnSync("git", ["-C", cwd, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0) return undefined;
  const st = spawnSync("git", ["-C", cwd, "status", "--porcelain"], { encoding: "utf8" });
  return { head: head.stdout.trim(), dirty: st.stdout.trim().length > 0, at: now() };
}

/** How many of a room's latest refusals it keeps for room_status refusals=true (Hub.recentRefusals). */
export const RECENT_REFUSALS = 20;
/** Keep one refusal on the room, live and on replay alike: the actor id stays internal, the code is closed-enum. */
export function keepRefusal(room: Room, r: NonNullable<Room["recentRefusals"]>[number]) {
  room.recentRefusals = [...(room.recentRefusals ?? []), r].slice(-RECENT_REFUSALS);
}
