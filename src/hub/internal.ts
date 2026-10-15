/** Hub-private helpers shared by hub.ts and its section modules; not re-exported from hub.ts. */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { RoomState, Participant, KickVote, Message, CodeState, BoardEntry, Challenge, Proposal, RoomOptions, Room, CallOutcome, WorkClass, DevReceipt } from "./types.js";
import type { SeatUsage } from "./usage.js";
import type { SeatMemory } from "./memory.js";
import type { DevRun } from "./dev-runs.js";

export type Opts = Required<Omit<RoomOptions, "chair" | "chairNamed" | "parent">> & { chair?: string; chairNamed?: boolean; parent?: string };

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
  /** by/drafted/drafters/seconds are telemetry (replay reads only the type): how the round ended and how many had drafted */
  | { type: "drafts_revealed"; room: string; by?: "all" | "deadline"; drafted?: number; drafters?: number; seconds?: number }
  | { type: "drafts_opened"; room: string; at: string; by?: string; key?: string }
  /** the round's only draft was withdrawn before the reveal (Hub.cancelDraftsIfEmpty) */
  | { type: "drafts_cancelled"; room: string; by: string; seconds: number; ts: string }
  | { type: "deadline"; room: string; at: string; setAt: string }
  | { type: "deadline_announced"; room: string }
  | { type: "archive"; room: string; archived: boolean; by: string; ts: string }
  | { type: "board_manifest"; room: string; bytes: number; kind: "full" | "delta" | "empty" }
  /** telemetry: asks a seat's hook or loop put into its model's context mid-turn, outside any hub call (wait-cost --traffic) */
  | { type: "steer_injected"; room: string; participant: string; asks: number; chars: number; ts: string }
  | { type: "board"; room: string; key: string; entry: BoardEntry | null }
  /** telemetry: a review/* with a verify head was first written and the hub @-named the commit's author */
  | { type: "review_notice"; room: string; key: string; commit: string; author: string; by: string; passes: boolean; ts: string }
  /** telemetry only (replay rebuilds the entry from the "board" record): one board_set(append=true) line and where it landed */
  | { type: "board_append"; room: string; key: string; landed_key: string; by: string; chars: number; ts: string }
  | { type: "dev_receipt"; room: string; key: string; updatedAt: string; receipt: DevReceipt }
  /** A dev run this hub started (src/hub/dev-runs.ts), written at each state change; replay keeps the last. */
  | { type: "dev_run"; room: string; run: DevRun }
  | { type: "amend"; room: string; proposalId: string; text: string; version: number; updatedAt?: string; votes: Proposal["votes"]; challenges?: Challenge[] }
  | { type: "refusal"; room: string; tool: string; reason: string; ts?: string; participant?: string | null }
  /** Telemetry only (replay ignores it; src/hub/board.ts refuseNote): a post_to_room refused by this room's inbox cap. Never the text. */
  | { type: "inbox_refused"; room: string; ts: string; from_room: string; by: string; key: string; chars: number; open: number }
  /** Telemetry only: a seat process ended (the launcher's or spawner's exit receipt), with the cause as a closed set. */
  | { type: "seat_exit"; room: string; seat: string; exit_code: number | null; signal?: string; cause: import("../respawn.js").SeatExitCause; resets_utc?: string; stopped_by?: import("../respawn.js").StoppedBy; detail: string; ts: string }
  /** Telemetry only: a seat heartbeating from local tools with no MCP session at the hub (said once per episode), and its return. */
  | { type: "seat_unconnected"; room: string; seat: string; tool: string; ts: string }
  | { type: "seat_reconnected"; room: string; seat: string; away_s: number; ts: string }
  /** Telemetry only: the owner's verdict on the room's conclusion (proposal_id null: the room had none). The latest stands. */
  | { type: "owner_verdict"; room: string; verdict: "adopted" | "rejected" | "partial"; by: string; proposal_id: string | null; note?: string; ts: string }
  /** Telemetry only: the run that owns this room ended, as its launcher saw it. One per room: the first stands. */
  | { type: "run_end"; room: string; cause: import("../respawn.js").RunEndCause; detail?: string; ts: string }
  // what happened to an MCP session that held a seat (bugs.md 3: nothing recorded a session moving, closing or being reaped).
  // seat_kept: the seat is still served by another session after this. Never a session key (identity-is-the-connection).
  | { type: "session"; room: string; event: "moved" | "closed"; participant: string; name: string; reason: string; seat_kept: boolean; ts: string }
  /** Telemetry only: the hub told two seats a claim or take overlaps another seat's (rule claim-terms: shared stems; same-work: equal key words across take/ and claim/). */
  | { type: "overlap_notice"; room: string; key: string; other: string; by: string; other_by: string; rule: "claim-terms" | "same-work"; shared_pct?: number; other_room?: string; ts: string }
  | { type: "outside_read"; room: string; by: { room: string; pid: string } | null; via: "http" | "http_pattern" | "file"; tool: string; ts: string }
  /** ms: how long the call took; empty: a wait that returned no new message (run-metrics splits idle polling on it); outsider: the caller's seats elsewhere (name@room) when it holds none in this room; key: the entry a board_get read */
  | { type: "call_completion"; room: string; tool: string; outcome: CallOutcome; ts: string; participant: string | null; ms?: number; empty?: boolean; outsider?: string; key?: string; key_rejected?: string }
  /** key: what the ledger dedupes on when it is not the target itself (a long target is shortened for display) */
  | { type: "work"; room: string; pid: string; cls: WorkClass; tool: string; target: string; key?: string; ts: string }
  /** a seat process's cumulative model usage (src/hub/usage.ts); seat is the seat key's sha256, never the key */
  | { type: "usage"; room: string; seat: string; usage: SeatUsage; ts: string }
  /** Telemetry only (replay ignores it; src/hub/memory.ts): a sample of what a seat's processes hold, or a warning/stop. */
  | { type: "memory"; room: string; seat: string; ts: string; memory?: SeatMemory; event?: "warn" | "over" | "ended" | "stop" | "high"; mb?: number; budget_mb?: number; mark_mb?: number; top?: SeatMemory["top"]; signal?: string }
  /** Telemetry only (replay ignores it; src/hub/take.ts): one step of a take/<what> entry. by and holder are seat names. */
  /** reason and commit only on action "refused": held (the same key), same-commit (another key naming the commit), assigned-reviewer */
  | { type: "take"; room: string; key: string; action: string; by: string; holder: string; ts: string; reason?: "held" | "same-commit" | "assigned-reviewer" | "already-reviewed" | "same-work"; commit?: string }
  /** Telemetry only (replay ignores it; src/hub/board.ts): a verify/* or review/* entry with a head, the commit it reviewed and whether the hub's repo has it. */
  | { type: "review"; room: string; key: string; by: string; proposal: string; commit?: string; commit_known?: boolean; base_commit?: string; base_known?: boolean; exit_code: number; base_exit_code?: number; kind?: string; unverified_n: number; dev_room?: string; ts: string }
  /** Telemetry only (replay ignores it): a board entry accepted after the room concluded, how long after, and the cited commit a failing late verdict contradicts. */
  | { type: "late_write"; room: string; key: string; by: string; after_s: number; contradicts?: string; ts: string }
  /** Telemetry only (replay ignores it; src/hub/clock.ts): a seat stated a present-tense time more than five minutes off the hub's clock. where: "message" or "board:<key>"; delta_min > 0 is a time in the future. */
  | { type: "time_claim"; room: string; by: string; where: string; stated: string; delta_min: number; ts: string }
  /** Telemetry only (replay ignores it): a second seat's verify/, review/ or attack/ entry was kept under its own key instead of refused. */
  | { type: "second_scrutiny"; room: string; asked: string; key: string; by: string; held_by: string; ts: string }
  /** the owner named this room's chair through the human route (Hub.nameChair) */
  | { type: "chair_named"; room: string; name: string; by: string; ts: string }
  /** Telemetry only (replay ignores it; src/hub/checks.ts): a checking entry and the entries by other seats it checks. how: key | segment | text, the rule that found the first. */
  | { type: "check"; room: string; key: string; by: string; of: string[]; how: string; verdict?: "holds" | "fails" | "partial"; ts: string }
  | { type: "kick_vote"; room: string; vote: KickVote }
  /** Telemetry only (replay ignores it; Hub.noteUsed, gap G7): a seat of this room named a note it was sent, or acked it with a reply */
  | { type: "note_used"; room: string; note: string; by: string; via: string; after_s: number; ts: string }
  /** Telemetry only (replay ignores it; the board event carries the text): an entry edited in place with amend. sent_chars is what the seat sent, entry_chars what a whole board_set would have. */
  | { type: "board_edit"; room: string; key: string; by: string; sent_chars: number; entry_chars: number; ts: string }
  /** A proposal had the votes while these electorate members had not voted on its version, or these takes were held (replayed: Hub.armLastCall). */
  | { type: "last_call"; room: string; proposalId: string; version: number; startedAt: string; until: string; waiting_on: string[]; takes_held?: string[]; children_open?: string[] }
  /** Telemetry only (replay ignores it): this breakout was still open when its parent concluded (Hub.tellOpenBreakouts). */
  | { type: "parent_concluded"; room: string; parent: string; proposalId: string; version: number; ts: string }
  /** A room-wide stall the hub told the room of, with the numbers it quoted, and its end (src/hub/idle.ts). */
  | { type: "hub_restart"; room: string; ts: string; down_s: number; down_upper_bound?: boolean; previous?: string }
  | { type: "room_idle"; room: string; ts: string; idle: import("./idle.js").RoomIdle; steps: number; seats: number; window_min: number; seconds_left?: number }
  | { type: "room_active"; room: string; ts: string; idle_min: number }
  /** Telemetry only: a process the hub had counted as a seat's job (src/hub/memory.ts jobsOf) is gone, after ran_s seconds. told: the seat was waiting on the hub and got a line. */
  | { type: "job_wake"; room: string; seat: string; pid: number; key: string; successor: string | null; ts: string }
  | { type: "job_end"; room: string; seat: string; pid: number; command: string; ran_s: number; others?: number; told: boolean; departed?: true; ts: string }
  /** A quiet room excused by a seat's running job (start, with the jobs), and how that ended: work resumed (active), the
   * job ended with nobody picking up (idle), or the wait outlasted ROOM_JOB_WAIT_MS and the room was told (told). */
  | { type: "room_waiting"; room: string; ts: string; state: "start"; steps: number; seats: number; jobs: (import("./memory.js").Job & { seat: string })[] }
  | { type: "room_waiting"; room: string; ts: string; state: "end"; waited_min: number; then: "active" | "idle" | "told" }
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
  // --no-optional-locks: plain `git status` rewrites the index under index.lock, and a hub serving from a seat's
  // worktree then races that seat's own `git add` / `git commit` ("index.lock: File exists", friction/git-index-lock)
  const st = spawnSync("git", ["--no-optional-locks", "-C", cwd, "status", "--porcelain"], { encoding: "utf8" });
  return { head: head.stdout.trim(), dirty: st.stdout.trim().length > 0, at: now() };
}

/** Whether `sha` names a commit in the repo at cwd; undefined when there is no repo to ask or the token is not hex. */
export function commitKnown(cwd: string | undefined, sha: string | undefined): boolean | undefined {
  const t = sha?.trim();
  if (!cwd || !t || !/^[0-9a-fA-F]{4,64}$/.test(t)) return undefined;
  if (spawnSync("git", ["-C", cwd, "rev-parse", "--git-dir"], { encoding: "utf8" }).status !== 0) return undefined;
  return spawnSync("git", ["-C", cwd, "cat-file", "-e", `${t}^{commit}`], { encoding: "utf8" }).status === 0;
}

/** How many of a room's latest refusals it keeps for room_status refusals=true (Hub.recentRefusals). */
export const RECENT_REFUSALS = 20;
/** Keep one refusal on the room, live and on replay alike: the actor id stays internal, the code is closed-enum. */
export function keepRefusal(room: Room, r: NonNullable<Room["recentRefusals"]>[number]) {
  room.recentRefusals = [...(room.recentRefusals ?? []), r].slice(-RECENT_REFUSALS);
}
