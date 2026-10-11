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
  /** what the reviewer did NOT exercise, in its own words; carried on the open proposal and the conclusion */
  unverified?: string[];
  /** the dev room where the reviewer watched agents use the change: http://127.0.0.1:<port>/rooms/<room> on a hub
   * that is still running when the entry is written; the hub fetches it itself (DevReceipt) */
  dev_room?: string;
}

/** Board keys whose verify head is a review of the commit it names: verify/* (the gate) and review/<sha> (coverage only,
 * written while builds are reviewed per commit; evidence-pack item 4). A .partial never counts. */
export const isReviewKey = (key: string) => /^(verify|review)\//.test(key) && !key.endsWith(".partial");

/** Canonical wording for what a verify/* entry must contain, quoted verbatim by refusals and prompts. */
export const VERIFY_HEAD_EXAMPLE = '{"proposal":"<PROPOSAL_ID>","command":"<the check you ran>","cwd":"<working dir>","base_commit":"<parent commit, before the change>","base_exit_code":1,"commit":"<the proposal\'s commit>","exit_code":0,"output_tail":"<last lines of real output at commit>"}';
/** The rest of the rule, said once after VERIFY_HEAD_EXAMPLE wherever it is quoted. */
export const VERIFY_HEAD_RULE = 'base_exit_code is the same check at base_commit and must be nonzero (it failed before the change); a refactor with no behaviour change instead passes at both and adds "refactor":true; optional "kind": existing_tests, own_check or exercised; optional "unverified":["what you did not exercise"] and "dev_room":"http://127.0.0.1:<port>/rooms/<room>" (a running dev room where you watched agents use it; the hub reads it itself), and without them the conclusion says what was not shown; exit_code must be 0 for the entry to count';

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
  if (o.unverified !== undefined && !(Array.isArray(o.unverified) && o.unverified.every((x) => typeof x === "string"))) return { error: '"unverified" must be a list of strings' };
  if (o.dev_room !== undefined && typeof o.dev_room !== "string") return { error: '"dev_room" must be a string' };
  return { head: o as unknown as VerifyHead };
}

/** Abbreviated and full hex SHAs of one commit compare equal; anything else (a branch, a tag) compares exactly. */
function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
  if (/^[0-9a-f]{4,64}$/.test(x) && /^[0-9a-f]{4,64}$/.test(y)) return x.startsWith(y) || y.startsWith(x);
  return x === y;
}

/** Whether a proposal text cites a commit: a whole hex token of 7+ characters there that is the same commit as `commit`
 * (abbreviated or full). A verify entry stays bound to the text for as long as the text cites the commit it checked. */
export function citesCommit(text: string, commit: string | undefined): boolean {
  const c = commit?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{7,64}$/.test(c)) return false;
  return hexTokens(text).some((t) => sameCommit(t, c));
}

/** Every whole lowercase hex token of 7 to 40 characters, as git prints a sha. Deliberately wide: an all-digit sha is
 * one (3.7% of 7-character abbreviations have no letter), so a count or a date is too. Used where a false positive is
 * the safe side (one more check); an upper-case example such as 'ABCDEF1' is not a sha anyone pasted and is not one. */
export function hexTokens(text: string): string[] {
  return [...new Set(text.match(/\b[0-9a-f]{7,40}\b/g) ?? [])];
}

/** The commits a text cites, as far as a hub can tell without a repository: hex tokens with both a digit and a letter
 * (a date or a count is not listed). Narrower than hexTokens because this list is only shown, never enforced. */
export function citedCommits(text: string): string[] {
  return hexTokens(text).filter((t) => /\d/.test(t) && /[a-f]/.test(t));
}

/** Hex tokens in `next` that `prev` did not have and that none of `heads` checked as its commit or base_commit: what
 * an amend added that nobody has looked at. Any of these makes a verify entry written against `prev` stale. */
export function addedUnchecked(prev: string[], next: string, heads: VerifyHead[]): string[] {
  const covered = [...prev, ...heads.flatMap((h) => [h.commit, h.base_commit]).filter((c): c is string => !!c?.trim())];
  return hexTokens(next).filter((t) => !covered.some((c) => sameCommit(c, t)));
}

/** Cited commits that no given verify head covers as its commit or its base_commit. */
export function uncoveredCommits(text: string, heads: VerifyHead[]): string[] {
  const covered = heads.flatMap((h) => [h.commit, h.base_commit]).filter((c): c is string => !!c?.trim());
  return citedCommits(text).filter((t) => !covered.some((c) => sameCommit(c, t)));
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
  /** when this seat was first sent each proposal/amend message, by message id (in memory only; Hub.seenTiming) */
  versionSeenAt?: Record<string, string>;
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
  /** Set when a hub restart restored this seat inactive while it was still in the room; cleared on rejoin. Ephemeral. */
  restoredAt?: string;
  /** last heartbeat from the seat process: local work makes no hub calls, so this is how the room knows it is alive. Ephemeral. */
  working?: { tool: string; step: number; at: string; detail?: string };
  /** the last 60 heartbeats: what the seat ran, step by step (dashboard: click a person). Ephemeral. */
  activity?: { tool: string; step: number; at: string; detail: string }[];
  /** distinct local targets (files, patterns, commands, web pages and searches) this seat's process reported, by class, since it joined (src/hub/work.ts). Kept in the room log. */
  work?: WorkCounts;
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
  /** what the hub knew of the target when the vote opened (kick.targetLiveness): a live seat voted on as dead is countable */
  targetLiveness?: TargetLiveness;
}

/** working: a tool step within the last minute, or a job of its own running; idle: a step or call within SUSPECTED_DEAD_MS; silent: neither. */
export interface TargetLiveness { status: "working" | "idle" | "silent"; last_call_age_s: number; step_age_s?: number; tool?: string; detail?: string; job?: { pid: number; command: string; elapsed_s: number } }

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
  /** the sender left quiet unset and the hub delivered it quiet as a two-seat working exchange (Hub.autoQuietAudience) */
  autoQuiet?: boolean;
  /** a two-seat working exchange the hub would have delivered quiet, kept public because it names an entry on the room's board (Hub.namesBoardKey) */
  keptPublic?: "board-key";
  /** a board notice for a verify/* or attack/* entry: the commits its text covered when written (settles asks naming them) */
  covers?: string[];
  /** The channel the sender came through, stamped when the message was posted. human-token: the hub's human route with
   * the human token. human-loopback: that route with no token, under CHATROOM_INSECURE_LOCAL, from a loopback process
   * that carries no seat key; on a machine running several hubs that is not proof of the owner (attack by
   * claude-opus-5-5-1 on decision/speaker-identity). mcp: an MCP connection, which may call itself anything. Absent on
   * system lines and in logs from before this was recorded. */
  via?: "human-token" | "human-loopback" | "mcp";
  /** a human-route caller's own label for a script posting on the owner's behalf ("orchestrator") */
  source?: string;
  /** a chair's message: whether the chair had been named by the room's creator or the owner ("named") or had taken the role by joining first */
  chair?: "named" | "self-claimed";
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
  /** verify/* entries naming a dev_room: what the hub itself read from that room when the entry was written. */
  devReceipt?: DevReceipt;
  /** verify/* and review/* entries with a head: whether the commits it names exist in the writer's bound worktree, resolved by the hub at write time
   * (2 of 22 SHAs named in verify heads across runs did not exist; evidence-pack item 4). A *_known field is absent when the writer has no bound worktree (not checked, not missing). */
  commitCheck?: { commit?: string; commit_known?: boolean; base_commit?: string; base_known?: boolean };
  /** the entries by other seats this entry checks (rerun/, audit/, review/, valid/, critique/, check/, attack/), resolved by
   * the hub when it was written (src/hub/checks.ts); absent when it is not a check or names nothing */
  checks?: string[];
  /** what that check found, as its writer declared it on the first line (src/hub/checks.ts verdictOf); absent: not declared */
  verdict?: "holds" | "fails" | "partial";
  /** written after the room concluded, inside Hub.LATE_WRITE_MS (src/hub/board.ts lateWrite): on the record, not part of what was decided */
  late?: boolean;
  /** claim/* entries only: the reviewer the hub assigned at creation (name/id), never client-supplied. */
  reviewer?: string;
  reviewerId?: string;
  /** claim/* entries only: the claimant's branch and worktree, read by the hub from the seat at each write, never client-supplied. */
  workspace?: { branch?: string; worktree: string };
  /** draft/* only: written or edited once peers' drafts were readable, so it is not an independent attempt (sticky). */
  postReveal?: boolean;
  /** take/* only (src/hub/take.ts): the seat that holds it, or is offered it while offeredBy is set; never client-supplied. */
  holder?: string;
  /** take/* only: the seat that offered it to `holder`, until that seat accepts by writing the key. */
  offeredBy?: string;
  /** attack/* only: normalised length of the attacked entry when the attack was written, to tell a reply from a re-save. */
  attackedChars?: number;
  /** an entry written with append=true that reached the size cap: the continuation (<key>/2, /3...) later appends land in. */
  continuedAt?: string;
  /** normalised chars that seats other than `by` added with append=true since the author last wrote it whole: not the author's reply to an attack. */
  othersChars?: number;
  /** review/* only: the commit's author, told by the hub when this review was first written (review_notice). */
  toldAuthor?: string;
}

export interface Challenge {
  id?: string;
  by: { id: string; name: string };
  objection: string;
  ts: string;
  /** proposal version the objection was written against */
  version?: number;
  /** seconds from the hub first sending the challenger this version to the challenge (absent: never sent), and since the version was written (Hub.seenTiming, gap G13) */
  seen_s?: number;
  /** the version was made before this hub process started, so whether it was sent is not known */
  seen_unknown?: true;
  since_text_s?: number;
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
  /** commits the concluded text cites that no counting verify entry checked, as its commit or its base_commit */
  unverified_commits?: string[];
}

export type WorkClass = "read" | "search" | "web" | "run" | "edit";
export type WorkCounts = Partial<Record<WorkClass, number>>;

export interface Proposal {
  id: string;
  room: string;
  by: { id: string; name: string };
  text: string;
  createdAt: string;
  /** seen_s / since_text_s: Hub.seenTiming (telemetry gap G13) */
  votes: Record<string, { vote: Vote; reason?: string; quote?: string; confidence?: number; name: string; ts: string; version?: number; seen_s?: number; seen_unknown?: true; since_text_s?: number }>;
  challenges: Challenge[];
  status: "open" | "accepted" | "rejected" | "superseded";
  /** bumped by every amend; the text in `text` is always the current version */
  version: number;
  /** when the current text was written; absent means legacy freshness is unknown */
  updatedAt?: string;
  /** voters present when the proposal was made; unanimity is taken over these (late joiners are not waited on) */
  snapshot?: string[];
  /** what the hub had counted behind this proposal when it was made (src/hub/work.ts); absent when no seat reports local work */
  evidence?: string;
  /** set once the "needs a challenge" nudge has been posted */
  nudged?: boolean;
  /** version for which the "did not pass, amend it" notice was posted */
  notPassedVersion?: number;
  /** last "stuck because" notice, so it is posted once per state change */
  stuckNotice?: string;
  /** a hub-recruited fresh challenger the conclusion waits for: until it challenges, leaves, or `until` passes. In memory only: a restart stops waiting. */
  awaiting?: { name: string; until: string };
  /** the hex tokens (hexTokens) of each version of the text and when it took effect, oldest first: what a verify
   * entry written at a given time had in front of it. Absent on proposals made before this was recorded. */
  cited?: { at: string; tokens: string[] }[];
  /** the text one version back, who amended it away and when (in memory only): lets a stale find be told what changed */
  prev?: { text: string; version: number; by: string; at: string };
  /** the last call this proposal is in or had (Hub.lastCallHolds): the version it was called on, when it closes, and who
   * in the electorate had not voted on that version when it opened. Replayed from its last_call event, so a restart keeps its deadline. */
  lastCall?: { version: number; startedAt: string; until: string; waitingOn: string[] };
}

/** How a room closed (telemetry gap "votes outstanding at conclusion", evidence-pack item 1): time from the proposal and
 * from its last text change, the last call if there was one, and who in the electorate had not voted on the final version. */
export interface ConclusionClosing {
  /** the room's verifier seat at the close, when it had one (Hub.verifierHolds): agreed is its agree on the final version;
   * agreed false means the room concluded without it because the seat had been silent for silent_minutes */
  verifier?: { name: string; agreed: boolean; vote?: Vote; version?: number; silent_minutes?: number };
  seconds_from_proposal: number;
  seconds_from_last_text: number;
  /** absent when everyone had voted on the final version before it had the votes, so no last call was needed */
  last_call_seconds?: number;
  /** window: the last call ran out; all_voted: everyone voted on the final version and no take/* was held before it did;
   * none: no last call (off, or nothing to wait for) */
  ended: "window" | "all_voted" | "none";
  /** take/* entries still held by an active seat when the room concluded, as "key (holder)": work the conclusion cut off */
  takes_held?: string[];
  /** agrees on the final version by seats the hub never sent that version (Hub.seenTiming, gap G13) */
  agreed_unsent?: string[];
  /** breakouts of the room still open when it concluded: work its answer was fixed before */
  children_open?: string[];
  /** voted_version: the version their standing vote was cast on, when they had one */
  not_voted_on_final: { name: string; role?: string; voted_version?: number }[];
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
  /** The chair above was named by someone the hub checked: the launcher (its token) or the owner (the human token). Only
   * the hub's own create route sets it; a seat creating a room over MCP can bind a chair's name but not this. */
  chairNamed?: boolean;
  /** Breakout: the room this one was opened from. Set at creation by an active member of that room; its conclusion is carried back there. */
  parent?: string;
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
  /** the chair was named by the launcher (--chair, under its token) or by the owner with the human token (Hub.nameChair), not taken by the first seat to ask */
  chairNamed?: boolean;
  /** Breakout link: the room this one was opened from (its conclusion lands on that room's board as inbox/<this>/conclusion). */
  parent?: string;
  createdAt: string;
  state: RoomState;
  /** When each counted local tool call of the last windows happened, and the stall the room has been told of, if any (src/hub/idle.ts). */
  workAt?: number[];
  idle?: import("./idle.js").RoomIdle;
  /** quiet, but a seat has a job running: recorded as waiting instead of told it has stalled (src/hub/idle.ts). Ephemeral. */
  waiting?: import("./idle.js").RoomWaiting;
  /** Hidden from listings (dashboard, list_rooms) but fully kept on disk; set by a human or the archive-dead sweep. */
  archived?: boolean;
  conclusion?: { text: string; proposalId: string; decidedAt: string; version?: number; tally?: { agree: number; disagree: number; abstain: number }; electorate?: ElectorateSummary; unresolved_objections?: { by: string; objection: string }[]; agreed_without_output?: string[]; undelivered_claims?: { key: string; by: string }[]; verification?: ConclusionVerification; verification_gaps?: { key: string; by: string; gaps: string[] }[]; evidence?: string; closing?: ConclusionClosing };
  /** identical silence nudges are posted at most twice */
  lastNudge?: { text: string; count: number };
  /** Lifetime refusal counts keyed by tool and bounded reason class (no bodies, no ids). */
  refusals?: Record<string, number>;
  /** Local commands of launched seats with no seat here that read this room (its address or its log), counted per reader: "<its room>\n<its participant id>", or
   * "" for a connection with no seat anywhere (Hub.recordOutsideRead). */
  outsideReads?: Record<string, number>;
  /** the latest refusals, oldest first, capped at Hub.RECENT_REFUSALS: actor id (internal), tool, closed-enum code, time */
  recentRefusals?: { pid: string | null; tool: string; reason: string; ts: string }[];
  /** Only versioned rooms have a complete guarded-call observation epoch. */
  telemetryVersion?: 1;
  /** board wait receipts: count + serialized manifest bytes (telemetryVersion rooms only) */

  callOutcomes?: Record<string, CallOutcomes>;
  /** calls made by connections with no seat in this room, keyed "<their seats elsewhere>: <tool>" */
  outsideCalls?: Record<string, number>;
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
  /** when the run that owns this room stops (its launcher kills the seats); announced once, late in the run (Hub.setDeadline) */
  deadline?: { at: string; setAt: string; announced?: boolean };
  deadlineTimer?: NodeJS.Timeout;
  /** shared blackboard: named entries agents update in place instead of re-posting */
  board: Map<string, BoardEntry>;
  /** draft/* entries are sealed (author-only) until every drafter has one; latched once true and persisted */
  draftsRevealed?: boolean;
  /** when the first draft/* was written: starts the reveal deadline (persisted, so the deadline survives a restart) */
  draftsOpenedAt?: string;
  /** updatedAt of the abandoned hold the room was told about (Hub.evaluate), so it is said once; in memory only */
  holdLapsedNoted?: string;
  /** whose write opened the running round (in memory only): Hub.draftSeal tells that writer it did */
  draftsOpenedBy?: { name: string; key: string; entryAt: string };
  draftsTimer?: NodeJS.Timeout;
  /** Reconstructed from every board event, including deletes and system writes. */
  boardVersion: number;
  boardVersions: Map<string, number>;
  /** Version at the latest board event, so gaps without events still count as waits. */
  lastBoardEventVersion?: number;
  /** human message ids the propose-gate has already warned about (once each) */
  humanWarned: Set<string>;
  /** the one "claims without findings" refusal has been given (propose). Ephemeral. */
  barrenWarned?: boolean;
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
  | "inbox-cap"      // the target room already holds the maximum of unacknowledged inbox notes
  // One code per guard family, so a room log says which rule refused a call (telemetry gap G6: 357 of 489 refusals in
  // 21 logs were hub_guard). scripts/refusal-codes-typed-regression.ts fails on any HubError thrown without a code.
  | "not-found"      // no such room, proposal, participant or board entry
  | "invalid-arg"    // a required argument is empty, malformed or out of range
  | "budget"         // a room, run, message or recruitment cap is used up
  | "leave-warning"  // leave_room refused once, with what to do first
  | "departed-mention" // a message @-names a seat that has left
  | "human-ask"      // replying to a human the hub has given to someone else, or past their register
  | "turn"           // round_robin: not this seat's turn
  | "unread"         // stale send: messages arrived while composing
  | "reply-owed"     // stale send: an ask already shown is still owed a reply
  | "fair-share"     // the sender is over its share of recent messages
  | "amend-find"     // amend's find is absent, ambiguous or too short, or the edit changes nothing
  | "amend-stale"    // amend's find was in the previous version: another amend changed that text since the caller read it
  | "proposal-open"  // propose while another proposal is open
  | "room-of-one"    // propose with fewer than two connections present
  | "needs-verify"   // propose in a verified room with no verify/* entry
  | "unacked-notes"  // propose with inbox notes unacknowledged
  | "human-unanswered" // propose while a human's message is unanswered
  | "scrutiny-held"  // propose held once for unexamined findings, barren or unsourced claims
  | "self-target"    // challenging one's own proposal, kicking or replacing oneself
  | "same-session"   // a blocking challenge from the proposer's own connection
  | "cite-required"  // a blocking challenge or attack that quotes no clause of its target
  | "duplicate"      // a blocking challenge on a clause an open challenge already holds
  | "vote-form"      // a vote without its required quote or reason, or a quote not in the text
  | "hub_guard";     // unknown or unclassifiable (legacy catch-all)

export const REFUSAL_CODES: readonly RefusalCode[] =
  ["expiry-prefix", "ownership", "auth", "key-format", "size", "state", "inbox-cap",
    "not-found", "invalid-arg", "budget", "leave-warning", "departed-mention", "human-ask", "turn", "unread", "reply-owed",
    "fair-share", "amend-find", "amend-stale", "proposal-open", "room-of-one", "needs-verify", "unacked-notes", "human-unanswered",
    "scrutiny-held", "self-target", "same-session", "cite-required", "duplicate", "vote-form", "hub_guard"];

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

/** What the hub read, at the time a verify entry was written, from the dev room its head names: fetched over HTTP
 * from whatever answers on that loopback port, stamped with this hub's clock and kept in this hub's log. It makes an
 * honest gap visible and a careless claim cost something; it does not prove agents were watched: a static file served
 * on that port reads exactly like a real dev room (review/verify-gaps, claude-opus-5-5-1). */
export interface DevReceipt {
  url: string;
  fetched_at: string;
  error?: string;
  room?: string;
  state?: string;
  /** git HEAD of the project the dev hub served when that room was created */
  code_head?: string;
  code_dirty?: boolean;
  /** non-human seats that joined, and how many of them posted at least one message */
  agent_seats?: number;
  speaking_seats?: number;
  messages?: number;
  /** set only when this hub started the dev run itself (start_dev_run): code_head is then the commit it built, not the dev hub's word */
  launched?: { run: string; requested_by: string; commit: string; entry_sha256?: Record<string, string>; tampered?: string };
}

/** Only a loopback dev hub's room summary: the hub never fetches anything else on a seat's say-so. */
export function devRoomUrl(s: string | undefined): URL | undefined {
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname) && /^\/rooms\/[^/]+$/.test(u.pathname) ? u : undefined;
  } catch {
    return undefined;
  }
}

/** Reduce a dev hub's GET /rooms/<room> body to a receipt. */
export function devReceiptFrom(url: string, body: unknown): DevReceipt {
  const b = (body ?? {}) as { name?: string; state?: string; code_state?: { head?: string; dirty?: boolean } | null; message_count?: number; participants?: { agent?: string; messages?: number; output?: Record<string, number> }[] };
  const agents = (b.participants ?? []).filter((x) => x.agent !== "human");
  return {
    url, fetched_at: new Date().toISOString(), room: b.name, state: b.state,
    ...(b.code_state?.head ? { code_head: b.code_state.head, code_dirty: !!b.code_state.dirty } : {}),
    agent_seats: agents.length, speaking_seats: agents.filter((x) => (x.messages ?? 0) > 0 || ["claims", "evidence", "verifies", "proposals", "challenges"].some((k) => (x.output?.[k] ?? 0) > 0)).length, messages: b.message_count ?? 0,
  };
}

/** What a passing verify head did not show: the reviewer's own list, then what the hub can tell about its dev room. */
export function verifyGaps(h: VerifyHead, receipt?: DevReceipt): string[] {
  const out = [...(h.unverified ?? [])].map((x) => x.trim()).filter(Boolean);
  // A missing room is a gap only where the head claims it: "kind":"exercised" says the change was used as its users would
  if (!h.dev_room) { if (h.kind === "exercised") out.push('"kind":"exercised" but no dev_room: the hub has no room where it can see agents used it'); }
  else if (!devRoomUrl(h.dev_room)) out.push(`dev_room "${h.dev_room.slice(0, 80)}" is not http://127.0.0.1:<port>/rooms/<room>`);
  else if (!receipt || receipt.url !== h.dev_room) out.push("dev_room was not read by the hub");
  else if (receipt.error) out.push(`dev_room could not be read when the entry was written (${receipt.error})`);
  else {
    if (!receipt.code_head) out.push("dev_room's hub reported no git commit");
    else if (!h.commit || !sameCommit(receipt.code_head, h.commit)) out.push(`dev_room ran ${receipt.code_head}, not ${h.commit ?? "the verified commit"}`);
    else if (receipt.code_dirty) out.push(`dev_room ran ${receipt.code_head} with uncommitted changes`);
    if ((receipt.speaking_seats ?? 0) < 2) out.push(`dev_room had ${receipt.speaking_seats ?? 0} agent seat(s) that spoke or wrote anything`);
    // SLSA L1 vs L2 (sources/slsa-build-levels): a hub some seat started reports its own commit and seats, and a static file can too
    if (receipt.launched?.tampered) out.push(`dev run ${receipt.launched.run} was tampered with: ${receipt.launched.tampered}`);
    if (!receipt.launched) out.push("dev_room was not started by this hub (scripts/dev-run.ts), so its commit and seats are the dev hub's own word");
  }
  return out;
}
