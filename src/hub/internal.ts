/** Hub-private helpers shared by hub.ts and its section modules; not re-exported from hub.ts. */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { RoomState, Participant, KickVote, Message, CodeState, BoardEntry, Challenge, Proposal, RoomOptions, Room, CallOutcome } from "./types.js";

export type Opts = Required<Omit<RoomOptions, "chair">> & { chair?: string };

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
  | { type: "archive"; room: string; archived: boolean; by: string; ts: string }
  | { type: "board_manifest"; room: string; bytes: number; kind: "full" | "delta" | "empty" }
  | { type: "board"; room: string; key: string; entry: BoardEntry | null }
  | { type: "amend"; room: string; proposalId: string; text: string; version: number; updatedAt?: string; votes: Proposal["votes"]; challenges?: Challenge[] }
  | { type: "refusal"; room: string; tool: string; reason: string; ts?: string; participant?: string | null }
  | { type: "call_completion"; room: string; tool: string; outcome: CallOutcome; ts: string; participant: string | null }
  | { type: "kick_vote"; room: string; vote: KickVote };

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
