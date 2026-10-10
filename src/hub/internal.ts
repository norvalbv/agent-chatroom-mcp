/** Hub-private helpers shared by hub.ts and its section modules; not re-exported from hub.ts. */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { RoomState, Participant, KickVote, Message, CodeState, BoardEntry, Challenge, Proposal, RoomOptions, Room, CallOutcome, WorkClass, DevReceipt } from "./types.js";
import type { SeatUsage } from "./usage.js";

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
  | { type: "amend"; room: string; proposalId: string; text: string; version: number; updatedAt?: string; votes: Proposal["votes"]; challenges?: Challenge[] }
  | { type: "refusal"; room: string; tool: string; reason: string; ts?: string; participant?: string | null }
  | { type: "call_completion"; room: string; tool: string; outcome: CallOutcome; ts: string; participant: string | null }
  | { type: "work"; room: string; pid: string; cls: WorkClass; tool: string; target: string; ts: string }
  /** a seat process's cumulative model usage (src/hub/usage.ts); seat is the seat key's sha256, never the key */
  | { type: "usage"; room: string; seat: string; usage: SeatUsage; ts: string }
  | { type: "kick_vote"; room: string; vote: KickVote }
  /** Telemetry only (replay ignores it): the open work an idle wait named to a seat, written when that list changes. */
  | { type: "open_work"; room: string; pid: string; ts: string; items: string[] };

export const now = () => new Date().toISOString();
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
