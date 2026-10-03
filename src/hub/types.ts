/** The Hub's public data model (re-exported from hub.ts): rooms, participants, messages, proposals, board entries, verify heads. */
export type MessageKind = "chat" | "system" | "proposal" | "amend" | "challenge" | "vote" | "conclusion" | "board";
export type Vote = "agree" | "disagree" | "abstain";
export type Quorum = "unanimous" | "majority" | "supermajority";
export type RoomMode = "free" | "round_robin";
export type RoomState = "open" | "concluded" | "stalled" | "closed";

/** What a reviewer's check was, self-declared (optional): existing_tests (the repo's tests or smoke), own_check (a probe the reviewer wrote),
 * exercised (the changed build driven the way its users drive it). Same classes as scripts/paper-verify-practice.ts. */
export type VerifyKind = "existing_tests" | "own_check" | "exercised";
export const VERIFY_KINDS: readonly VerifyKind[] = ["existing_tests", "own_check", "exercised"];

/** The machine-readable head a verify/* entry must lead with (docs/swarm-protocol-spec.md:26, section C.3). */
export interface VerifyHead {
  proposal: string;
  command: string;
  cwd: string;
  exit_code: number;
  output_tail: string;
  /** the proposal's commit, where `command` exited `exit_code` */
  commit?: string;
  /** the parent commit, before the change, where the same `command` ran */
  base_commit?: string;
  /** that run's exit code: nonzero is fail-to-pass; 0 counts only on the refactor path */
  base_exit_code?: number;
  /** the refactor path: the proposal claims no behaviour change, so the check passes at both commits */
  refactor?: boolean;
  kind?: VerifyKind;
}

/** Canonical wording for what a verify/* entry must contain, quoted verbatim by refusals and prompts. */
export const VERIFY_HEAD_EXAMPLE = '{"proposal":"<PROPOSAL_ID>","command":"<the check you ran>","cwd":"<working dir>","base_commit":"<parent commit, before the change>","base_exit_code":1,"commit":"<the proposal\'s commit>","exit_code":0,"output_tail":"<last lines of real output at commit>"}';
/** The rest of the rule, said once after VERIFY_HEAD_EXAMPLE wherever it is quoted. */
export const VERIFY_HEAD_RULE = 'base_exit_code is the same check at base_commit and must be nonzero (it failed before the change); a refactor with no behaviour change instead passes at both and adds "refactor":true; optional "kind": existing_tests, own_check or exercised; exit_code must be 0 for the entry to count';

/** A verify/* entry must lead with one line of JSON matching VerifyHead; prose may follow. Shape-checking only: it proves an attributable,
 * re-runnable claim, not that the command ran. Optional fields are type-checked; existing census heads must keep parsing as before. */
export function parseVerifyHead(text: string): VerifyHead | undefined {
  const r = readVerifyHead(text);
  return "head" in r ? r.head : undefined;
}

/** parseVerifyHead with the reason it failed, in words a refusal can quote. */
export function readVerifyHead(text: string): { head: VerifyHead } | { error: string } {
  const nl = text.indexOf("\n");
  const line = (nl === -1 ? text : text.slice(0, nl)).trim();
  if (!line.startsWith("{")) return { error: "its first line is not a JSON verify head" };
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return { error: "its first line is not valid JSON (one line, no line breaks inside it)" };
  }
  if (typeof obj !== "object" || obj === null) return { error: "its first line is not a JSON object" };
  const o = obj as Record<string, unknown>;
  for (const k of ["proposal", "command", "cwd"] as const) if (typeof o[k] !== "string") return { error: `"${k}" must be a string` };
  if (typeof o.exit_code !== "number") return { error: '"exit_code" must be a number' };
  if (typeof o.output_tail !== "string") return { error: '"output_tail" must be a string' };
  for (const k of ["commit", "base_commit"] as const) if (o[k] !== undefined && typeof o[k] !== "string") return { error: `"${k}" must be a string` };
  if (o.base_exit_code !== undefined && typeof o.base_exit_code !== "number") return { error: '"base_exit_code" must be a number' };
  if (o.refactor !== undefined && typeof o.refactor !== "boolean") return { error: '"refactor" must be true or false' };
  if (o.kind !== undefined && !VERIFY_KINDS.includes(o.kind as VerifyKind)) return { error: `"kind" must be one of ${VERIFY_KINDS.join(", ")}` };
  return { head: o as unknown as VerifyHead };
}

/** Abbreviated and full hex SHAs of one commit compare equal; anything else (a branch, a tag) compares exactly. */
function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
  if (/^[0-9a-f]{4,64}$/.test(x) && /^[0-9a-f]{4,64}$/.test(y)) return x.startsWith(y) || y.startsWith(x);
  return x === y;
}

/** Fail-to-pass evidence (SWE-bench FAIL_TO_PASS): the head names the proposal's commit and its parent, with the same check failing at the parent;
 * a no-behaviour refactor instead sets "refactor":true with base_exit_code 0. Self-reported, the hub runs nothing. Returns what to fix, or undefined. */
export function failToPassShortfall(h: VerifyHead): string | undefined {
  if (!h.commit?.trim()) return 'it names no "commit", the proposal\'s commit where the check passed';
  if (!h.base_commit?.trim()) return 'it names no "base_commit", the parent commit before the change where you ran the same check';
  if (sameCommit(h.base_commit, h.commit)) return '"base_commit" and "commit" are the same commit: run the check at the parent commit and again at the proposal\'s';
  if (h.base_exit_code === undefined) return 'it has no "base_exit_code", the exit code of the same check at base_commit';
  if (h.refactor === true) return h.base_exit_code === 0 ? undefined : '"refactor":true says no behaviour changed, but the check failed at base_commit: drop "refactor"';
  if (h.base_exit_code === 0) return '"base_exit_code" is 0, so the check passed before the change too and shows nothing the change did: use a check that fails at base_commit, or add "refactor":true if the proposal changes no behaviour';
  return undefined;
}
/** Role is a display tag plus one quorum rule (chair is never waited on but may veto). It is never a persona. */
export type Role = "worker" | "chair" | "lead" | "verifier" | "recruit";
export const ROLES: Role[] = ["worker", "chair", "lead", "verifier", "recruit"];

export interface Participant {
  id: string;
  name: string;
  /** Stable pseudonym ("Participant B") used for display in anonymous rooms. */
  label: string;
  agent: string; // e.g. "claude", "codex", "human"
  joinedAt: string;
  lastActiveAt: string;
  lastSeenSeq: number;
  active: boolean;
  messageCount: number;
  /** identity of the connection/process that joined; distinct sessions are what the team floor and verify gate count */
  session?: string;
  /** seqs of messages withheld from this participant (human messages awaiting their nominated reply) */
  withheld?: number[];
  /** Sparse receipts for delivered quiet bodies, retained only until their thread is surfaced. */
  quietReceipts?: number[];
  /** explicit "nothing to add" turns */
  passes?: number;
  role?: Role;
  /** proposal id -> version of its text this participant was last sent (wait_for_messages ships text only when it changes) */
  seenProposal?: Record<string, number>;
  /** challenge id -> status its objection text was last sent at (wait_for_messages ships objections only when new or changed) */
  seenChallenges?: Record<string, string>;
  /** Ephemeral delivery receipts. A reconnect/rejoin starts with a full board manifest. */
  lastBoardSeen?: number;
  boardFollow?: string[];
  seenBoardKeys?: string[];
  /** the conclusion text has been sent to this participant once */
  seenConclusion?: boolean;
  /** proposal id a blocking leave_room was already refused for (the second call proceeds) */
  leaveWarned?: string;
  /** a leave that abandons a claim or an unanswered ask was already refused once (the next call proceeds) */
  leaveWarnedExit?: boolean;
  /** why this participant left, as given to leave_room; shown in the room notice and the dashboard */
  leaveReason?: string;
  /** Timestamp of this participant's most recent non-empty verify/* board write, room-scoped. Best-effort like working/activity below: read live, not replayed across a process restart. Used to pick the least-recently-verifying reviewer at claim time. */
  lastVerifiedAt?: string;
  /** sha256 of the launcher seat key its connection carried at join. Persisted, so after a hub restart (seats restored inactive,
   * seat-key bindings lost) a heartbeat from the still-running process can be matched to this seat: it is away, not dead. */
  seatKeyHash?: string;
  /** last heartbeat from the seat process: local work makes no hub calls, so this is how the room knows it is alive. Ephemeral. */
  working?: { tool: string; step: number; at: string; detail?: string };
  /** the last 60 heartbeats: what the seat ran, step by step (dashboard: click a person). Ephemeral. */
  activity?: { tool: string; step: number; at: string; detail: string }[];
  /** id of the addressed message this participant was last shown by wait_for_messages (the next wait without an answer is refused once) */
  addressWarned?: string;
  /** messages the last capped wait/read left undelivered (0 = it carried everything). Ephemeral. */
  deliveryRemaining?: number;
  /** id of the addressed message a wait_for_messages was already refused for (the call after that proceeds) */
  addressRefused?: string;
  /** mentions at or below this seq are answered (a pass covers everything before it) */
  answeredSeq?: number;
  /** Last ask actually delivered; bare pass declines only this id. */
  focusedAsk?: string;
  declinedAsks?: string[];
  declinedAt?: Record<string, number>;
  /** Explicit registration: the departed seat this successor took over (trusted launcher/recruit control, never name inference). */
  replacementOf?: string;
  /** Outstanding nonhuman directed asks offered at explicit registration. */
  inheritedAskIds?: string[];
  /** asks injected into this seat's context mid-turn (src/hub/steer.ts): never peeked again; wait sends a stub. Ephemeral. */
  steered?: string[];
  pendingReplacementAskIds?: string[];
  /** Explicit registration: pid of the registered successor of this departed seat. */
  replacedBy?: string;
  /** One-use join proof: reserved successor name awaiting a join with the matching token. */
  pendingReplacementName?: string;
  /** sha256 of the one-use token handed to the launcher for that successor name. */
  pendingReplacementTokenHash?: string;
  /** Removed by the room (kick vote or replace): the seat may not rejoin, and its next hub call says so. Persisted with the leave event. */
  kicked?: { by: string; reason: string; at: string };
}

/** A vote to remove one participant, keyed by target pid, one open vote per target. Ballots count per connection, the target never votes, the threshold is
 * the quorum rule over the voters minus the target (>= 2 connections when available); a human ballot counts like an agent's and a human "keep" vetoes. */
export interface KickVote {
  target: string;
  targetName: string;
  by: { id: string; name: string };
  reason: string;
  startedAt: string;
  ballots: Record<string, { name: string; vote: "kick" | "keep"; ts: string; session?: string; human?: boolean }>;
  status: "open" | "kicked" | "dropped";
  endedAt?: string;
  outcome?: string;
}

export interface Message {
  seq: number;
  id: string;
  room: string;
  kind: MessageKind;
  from: { id: string; name: string; agent: string };
  content: string;
  ts: string;
  replyTo?: string;
  proposalId?: string;
  /** "opening" marks a blind opening revealed in a batch */
  tag?: "opening";
  /** participant ids named with @ in the content */
  mentions?: string[];
  /** quiet: pushed only to `audience` (sender + mentions); still in the log for everyone */
  quiet?: boolean;
  audience?: string[];
}

export interface CodeState {
  head: string;
  dirty: boolean;
  at: string;
}

export interface BoardExpiryOptions { ttlSeconds?: number; expiresAt?: string }
export interface BoardManifestStats { version: 1; waits: number; bytes: number; full: number; delta: number; empty: number }

export interface BoardEntry {
  /** Logical archive time: body remains explicitly retrievable. */
  expiresAt?: string;
  text: string;
  by: string;
  updatedAt: string;
  /** verify/* entries: the tree the verification ran against */
  codeState?: CodeState;
  /** set on inbox/* entries posted with ack_required */
  ackRequired?: boolean;
  /** inbox/*.ack entries cover only the note text hashed when acknowledged. */
  acknowledgedTextHash?: string;
  /** claim/* entries only: the reviewer the hub assigned at creation (name/id), never client-supplied. */
  reviewer?: string;
  reviewerId?: string;
  /** claim/* entries only: the claimant's branch and worktree, read by the hub from the seat at each write, never client-supplied. */
  workspace?: { branch?: string; worktree: string };
  /** draft/* only: written or edited once peers' drafts were readable, so it is not an independent attempt (sticky). */
  postReveal?: boolean;
}

export interface Challenge {
  id?: string;
  by: { id: string; name: string };
  objection: string;
  ts: string;
  /** proposal version the objection was written against */
  version?: number;
  /** open: unanswered. answered: the cited text was amended away. conceded: the challenger re-voted agree. overruled: the room concluded over it. */
  status?: "open" | "answered" | "conceded" | "overruled";
  /** the span of the proposal the objection quotes, if it quotes one (used to decide when an amend answers it) */
  cites?: string;
  /** false: recorded dissent that does not hold the proposal or satisfy the challenge gate */
  blocking?: boolean;
  /** An executable counterexample: a command that fails against the proposal. Only a later verify/* entry from someone other than the proposer,
   *  rerunning this exact command with exit 0 against the current text, answers it (or the challenger concedes); rewording cannot. */
  command?: string;
}

export interface ElectorateSummary {
  electorate: number;
  agree: number;
  disagree: number;
  abstain: number;
  excluded_leavers: number;
  distinct_sessions: number;
  denominator: "electorate";
}

/** Which verify/* entry passed a require_verification conclusion, and on which path, so a refactor-path pass is visible. */
export interface ConclusionVerification {
  key: string;
  by: string;
  path: "fail_to_pass" | "refactor";
  base_commit: string;
  commit: string;
  kind?: VerifyKind;
}

export interface Proposal {
  id: string;
  room: string;
  by: { id: string; name: string };
  text: string;
  createdAt: string;
  votes: Record<string, { vote: Vote; reason?: string; quote?: string; confidence?: number; name: string; ts: string; version?: number }>;
  challenges: Challenge[];
  status: "open" | "accepted" | "rejected" | "superseded";
  /** bumped by every amend; the text in `text` is always the current version */
  version: number;
  /** when the current text was written; absent means legacy freshness is unknown */
  updatedAt?: string;
  /** voters present when the proposal was made; unanimity is taken over these (late joiners are not waited on) */
  snapshot?: string[];
  /** set once the "needs a challenge" nudge has been posted */
  nudged?: boolean;
  /** version for which the "did not pass, amend it" notice was posted */
  notPassedVersion?: number;
  /** last "stuck because" notice, so it is posted once per state change */
  stuckNotice?: string;
}

export interface RoomOptions {
  topic?: string;
  mode?: RoomMode;
  quorum?: Quorum;
  maxRounds?: number;
  /** Blind openings are revealed, and proposals can be accepted, only once this many participants have joined. */
  expectedParticipants?: number;
  /** Show participants to each other as "Participant A/B/C" instead of their names. */
  anonymous?: boolean;
  /** Max chat messages each participant may send (0 = unlimited). Votes/proposals/challenges do not count. */
  maxMessagesPerParticipant?: number;
  /** Max characters per message. */
  maxMessageChars?: number;
  /** Require at least one challenge from a non-proposer before a proposal can pass. "auto" = when 3+ active. */
  requireChallenge?: boolean | "auto";
  /** Post a nudge after this much silence in an open room (0 = never). */
  nudgeAfterMs?: number;
  /** Swarm mode: a proposal needs a verify/* board entry by someone else (bound to the proposal) before it can pass. */
  requireVerification?: boolean;
  /** Name of the participant honoured as chair (exempt from quorum, may veto). Set at creation, or by the first joiner to claim role=chair. */
  chair?: string;
}

/** Join-time options: room policy plus the one-use launcher replacement proof (never a room-level option). */
export interface JoinOptions extends RoomOptions {
  /** One-use token issued by registerReplacement; required to join under a reserved successor name. */
  replacementToken?: string;
}

export interface Room {
  name: string;
  topic: string;
  mode: RoomMode;
  quorum: Quorum;
  maxRounds: number; // 0 = unlimited
  expectedParticipants: number;
  anonymous: boolean;
  maxMessagesPerParticipant: number;
  maxMessageChars: number;
  requireChallenge: boolean | "auto";
  nudgeAfterMs: number;
  requireVerification: boolean;
  chair?: string;
  createdAt: string;
  state: RoomState;
  /** Hidden from listings (dashboard, list_rooms) but fully kept on disk; set by a human or the archive-dead sweep. */
  archived?: boolean;
  conclusion?: { text: string; proposalId: string; decidedAt: string; version?: number; tally?: { agree: number; disagree: number; abstain: number }; electorate?: ElectorateSummary; unresolved_objections?: { by: string; objection: string }[]; verification?: ConclusionVerification };
  /** identical silence nudges are posted at most twice */
  lastNudge?: { text: string; count: number };
  /** Lifetime refusal counts keyed by tool and bounded reason class (no bodies, no ids). */
  refusals?: Record<string, number>;
  /** Only versioned rooms have a complete guarded-call observation epoch. */
  telemetryVersion?: 1;
  /** board wait receipts: count + serialized manifest bytes (telemetryVersion rooms only) */

  callOutcomes?: Record<string, CallOutcomes>;
  boardManifests?: BoardManifestStats;
  /** git HEAD and dirty state of the project when the room was created */
  codeState?: CodeState;
  participants: Map<string, Participant>;
  messages: Message[];
  proposals: Map<string, Proposal>;
  /** round_robin bookkeeping */
  turnIndex: number;
  turnPid?: string;
  round: number;
  /** long-poll waiters */
  waiters: Set<() => void>;
  /** blind opening statements held back until everyone has submitted */
  openings: Map<string, string>;
  openingsRevealed: boolean;
  nudgeTimer?: NodeJS.Timeout;
  /** absolute deadline for the opening reveal, armed at creation and re-armed by the first opening; not reset by chat */
  openingsTimer?: NodeJS.Timeout;
  openingsWarned?: boolean;
  /** shared blackboard: named entries agents update in place instead of re-posting */
  board: Map<string, BoardEntry>;
  /** draft/* entries are sealed (author-only) until every drafter has one; latched once true and persisted */
  draftsRevealed?: boolean;
  /** when the first draft/* was written: starts the reveal deadline (persisted, so the deadline survives a restart) */
  draftsOpenedAt?: string;
  draftsTimer?: NodeJS.Timeout;
  /** Reconstructed from every board event, including deletes and system writes. */
  boardVersion: number;
  boardVersions: Map<string, number>;
  /** Version at the latest board event, so gaps without events still count as waits. */
  lastBoardEventVersion?: number;
  /** human message ids the propose-gate has already warned about (once each) */
  humanWarned: Set<string>;
  /** who has been asked to answer each human message, so three agents do not all say hello */
  responders: Map<string, { pid: string; at: number }>;
  /** open and settled votes to remove a participant, keyed by target pid */
  kickVotes: Map<string, KickVote>;
}

export type CallOutcome = "success" | "hub_refusal" | "error";
export type CallOutcomes = Record<CallOutcome, number>;

/** Closed set of privacy-safe refusal reason codes persisted in trial artifacts: never raw error text, argument values or secrets.
 * hub_guard is the legacy and unclassifiable fallback; extend only with evidence of a distinct, benign, reproducible failure class. */
export type RefusalCode =
  | "expiry-prefix"  // expiry options given for a key whose prefix cannot expire
  | "ownership"      // overwriting another author's board entry, claim or hold
  | "auth"           // unknown, inactive or unauthenticated actor
  | "key-format"     // malformed board or inbox key
  | "size"           // content above the size cap
  | "state"          // valid actor and args, refused by room or entry state
  | "hub_guard";     // unknown or unclassifiable (legacy catch-all)

export const REFUSAL_CODES: readonly RefusalCode[] =
  ["expiry-prefix", "ownership", "auth", "key-format", "size", "state", "hub_guard"];

export class HubError extends Error {
  constructor(
    message: string,
    public data?: unknown,
    public code?: RefusalCode,
  ) {
    super(message);
  }
}

/** Exact manifest-only envelope shipped by a wait. Delta implementations may call
 * observeBoardManifest after cursor advancement; this observer never reads cursors. */
export interface BoardManifestObservation {
  board_keys?: string[];
  board_delta?: { keys: string[]; tombstones: string[] };
}
