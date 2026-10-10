/** Versioned, self-contained transport. Room payloads are deliberately not projected. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface RoomSnapshot {
  name: string;
  payload: Record<string, any> | null;
  error: string | null;
  transcript: { text: string | null; sourceUrl: string; error: string | null };
}
export interface RunResult {
  schemaVersion: 1;
  run: { id: string; startedAt: string; completedAt: string; task: string; doneWhen: string };
  project: { cwd: string; canonicalPath: string; git: { root: string; commonDir: string; revision: string; branch: string; dirty: boolean } | null };
  leadRoom: string;
  rooms: RoomSnapshot[];
  verifier: { name: 'verifier'; output: string | null };
  reportPath: string;
  artifactPath: string;
  /** R4 usage telemetry: present only when runs carried usage; absent on pre-telemetry artifacts. */
  usage?: UsageRollup;
  collectionErrors?: string[];
  /** Why the lead room ended as it did; absent on artifacts written before the scorecard. */
  outcome?: RunOutcome;
  /** One row per agent seat across every room of the run; absent on older artifacts. */
  scorecard?: SeatScore[];
  /** What the hub saw live (participants[].usage, src/hub/usage.ts), recruits included; absent when no seat reported. */
  hubUsage?: HubUsageRollup;
}
/**
 * Usage as the hub recorded it while the run went on, from the room snapshots alone: a launcher that crashed, or a
 * recruit the hub spawned (which no launcher receipt covers), is still counted. One figure per seat process: a seat in
 * several rooms shows the same cumulative usage in each, so the largest is taken, never the sum.
 */
export interface HubUsageRollup {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  seats: number;
  recruits: { seats: number; cost_usd: number };
}
export function hubUsageRollup(rooms: readonly RoomSnapshot[]): HubUsageRollup | undefined {
  const bySeat = new Map<string, { role: string; u: Record<string, number> }>();
  for (const room of rooms) for (const p of (room.payload?.participants ?? []) as Record<string, any>[]) {
    const u = p.usage;
    if (!u || typeof u.requests !== 'number' || typeof u.cost_usd !== 'number') continue;
    const seen = bySeat.get(p.name);
    if (!seen || u.requests > seen.u.requests) bySeat.set(p.name, { role: p.role ?? 'worker', u });
  }
  if (!bySeat.size) return undefined;
  const all = [...bySeat.values()];
  const sum = (k: string, of = all) => of.reduce((n, s) => n + (Number(s.u[k]) || 0), 0);
  const recruits = all.filter(s => s.role === 'recruit');
  return { requests: sum('requests'), input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'), cache_read_input_tokens: sum('cache_read_input_tokens'),
    cache_creation_input_tokens: sum('cache_creation_input_tokens'), cost_usd: sum('cost_usd'), seats: all.length, recruits: { seats: recruits.length, cost_usd: sum('cost_usd', recruits) } };
}
export type SeatEnding = 'left' | 'exited_without_leaving' | 'kicked' | 'killed_at_timeout' | 'gone_no_reason' | 'still_active';
/**
 * What one seat left behind, read from the room snapshot plus the launcher's own receipt for that seat.
 * `produced` is deliberately coarse: a board entry other than a claim, a commit, a proposal or a challenge (for a
 * verifier, a vote; for a recruit, a report in chat and a reasoned leave, since that is its whole brief). A claim is a
 * promise and chat is talk: neither counts, and the report says which it was.
 * It separates a seat that left nothing from one that did something; it does not rank the ones that did.
 */
export interface SeatScore {
  name: string;
  /** Every room of the run the seat sat in (a lead sits in its group room and the leads room); counts are summed across them. */
  rooms: string[];
  role: string;
  agent: string;
  messages: number;
  board: { claim: number; verify: number; other: number };
  proposals: number;
  challenges: number;
  votes: number;
  ending: SeatEnding;
  produced: boolean;
  leftReason?: string;
  /** Absent when the seat reported no usage: unknown, never zero. */
  cost?: number;
  /** "hub" when the cost is the hub's live figure because the launcher has none (a recruit, a crashed launcher). */
  costSource?: 'launcher' | 'hub';
  /** Model calls the hub counted for this seat (participants[].usage.requests); absent when it reported none. */
  requests?: number;
  exitCode?: number | null;
  /** Commits on the seat's own branch since the run's base; absent when the seat had no branch. */
  commits?: number;
}
/** What only the launcher knows about a seat it spawned. A recruit spawned by the hub has no receipt. */
export interface SeatReceipt { exitCode?: number | null; cost?: number; killedAtTimeout?: boolean; commits?: number }
export interface RunOutcome {
  kind: 'concluded' | 'proposal_open' | 'no_proposal' | 'room_missing';
  timedOut: boolean;
  detail: string;
}
const EXITED_WITHOUT_LEAVING = /^seat process exited|^MCP session closed without leave_room/;
const seatEnding = (p: Record<string, any>, receipt?: SeatReceipt): SeatEnding => {
  const reason = typeof p.left_reason === 'string' ? p.left_reason : '';
  if (reason.startsWith('kicked')) return 'kicked';
  if (EXITED_WITHOUT_LEAVING.test(reason)) return receipt?.killedAtTimeout ? 'killed_at_timeout' : 'exited_without_leaving';
  if (reason) return 'left';
  if (receipt?.killedAtTimeout) return 'killed_at_timeout';
  return p.active ? 'still_active' : 'gone_no_reason';
};
export function seatScorecard(rooms: readonly RoomSnapshot[], receipts: Readonly<Record<string, SeatReceipt>> = {}): SeatScore[] {
  const card: SeatScore[] = [];
  for (const room of rooms) {
    const payload = room.payload;
    if (!payload) continue;
    const entries = Object.entries((payload.board ?? {}) as Record<string, { by?: string }>);
    const proposals = (payload.proposals ?? []) as { by?: string; challenges?: { by?: string }[]; votes?: { name?: string }[] }[];
    for (const p of (payload.participants ?? []) as Record<string, any>[]) {
      if (p.agent === 'human') continue;
      const mine = entries.filter(([, e]) => e?.by === p.name).map(([key]) => key);
      const board = { claim: mine.filter(k => k.startsWith('claim/')).length, verify: mine.filter(k => k.startsWith('verify/')).length, other: 0 };
      board.other = mine.length - board.claim - board.verify;
      const receipt = receipts[p.name];
      const score: SeatScore = {
        name: p.name, rooms: [room.name], role: p.role ?? 'worker', agent: p.agent ?? 'unknown', messages: p.messages ?? 0, board,
        proposals: proposals.filter(x => x.by === p.name).length,
        challenges: proposals.reduce((n, x) => n + (x.challenges ?? []).filter(c => c.by === p.name).length, 0),
        votes: proposals.reduce((n, x) => n + (x.votes ?? []).filter(v => v.name === p.name).length, 0),
        ending: seatEnding(p, receipt),
        produced: false,
      };
      if (typeof p.left_reason === 'string' && p.left_reason) score.leftReason = p.left_reason;
      if (typeof receipt?.cost === 'number') Object.assign(score, { cost: receipt.cost, costSource: 'launcher' });
      else if (typeof p.usage?.cost_usd === 'number') Object.assign(score, { cost: p.usage.cost_usd, costSource: 'hub' });
      if (typeof p.usage?.requests === 'number') score.requests = p.usage.requests;
      if (receipt && 'exitCode' in receipt) score.exitCode = receipt.exitCode ?? null;
      if (typeof receipt?.commits === 'number') score.commits = receipt.commits;
      // one process, one row: the first room listed (the lead room) says how the seat ended
      const seen = card.find(s => s.name === score.name);
      if (!seen) { card.push(score); continue; }
      seen.rooms.push(room.name);
      seen.messages += score.messages;
      for (const k of ['claim', 'verify', 'other'] as const) seen.board[k] += score.board[k];
      seen.proposals += score.proposals;
      seen.challenges += score.challenges;
      seen.votes += score.votes;
      // usage is per process: the same cumulative figure in every room, so keep the largest
      if (score.requests !== undefined && score.requests > (seen.requests ?? -1)) {
        seen.requests = score.requests;
        if (seen.costSource !== 'launcher' && score.cost !== undefined) Object.assign(seen, { cost: score.cost, costSource: score.costSource });
      }
    }
  }
  // a verifier's output is its verdict: a vote, a challenge or a verify entry
  for (const s of card) s.produced = s.board.verify + s.board.other > 0 || (s.commits ?? 0) > 0 || s.proposals > 0 || s.challenges > 0 || (s.role === 'verifier' && s.votes > 0) || (s.role === 'recruit' && s.messages > 0 && s.ending === 'left');
  return card;
}
/** Name the cause of a non-conclusion from the lead room's own payload, so the report never has to say only "no consensus". */
/**
 * `atTimeout`: the lead room as the launcher read it just before its timeout killed the seats. The final snapshot is
 * taken after the kill, when every seat has left, so an open proposal's blockers there read "0 voter(s) left".
 */
export function classifyOutcome(lead: Record<string, any> | null | undefined, opts: { timedOut?: boolean; atTimeout?: Record<string, any> | null } = {}): RunOutcome {
  const timedOut = opts.timedOut === true;
  const how = timedOut ? 'The run timed out' : 'The run ended because every seat exited';
  if (!lead || lead.state === 'missing') return { kind: 'room_missing', timedOut, detail: `${how} and the lead room could not be read from the hub.` };
  if (lead.conclusion) return { kind: 'concluded', timedOut, detail: 'The lead room concluded.' };
  const open = (((opts.atTimeout ?? lead).proposals ?? []) as Record<string, any>[]).filter(p => p.status === 'open').pop();
  if (!open) return { kind: 'no_proposal', timedOut, detail: `${how}; nobody proposed a conclusion.` };
  const blocked = (open.blocked_by ?? []).length ? ` Blocked by: ${(open.blocked_by as string[]).join('; ')}.` : '';
  const waiting = (open.waiting_on ?? []).length ? ` Waiting on: ${(open.waiting_on as string[]).join(', ')}.` : '';
  return { kind: 'proposal_open', timedOut, detail: `${how} with ${open.id} v${open.version} by ${open.by} still open.${blocked}${waiting}` };
}
const ENDING_TEXT: Record<SeatEnding, string> = { left: 'left', exited_without_leaving: 'exited without leaving', kicked: 'kicked', killed_at_timeout: 'killed at timeout', gone_no_reason: 'gone, no reason recorded', still_active: 'still active' };
const seatNote = (s: SeatScore) => s.produced ? '' : s.board.claim ? 'claimed, delivered nothing' : s.messages > 2 ? 'talk only' : 'no output';
function renderScorecard(card: readonly SeatScore[]): string {
  const idle = card.filter(s => !s.produced && s.role !== 'verifier');
  let text = `## Seats\n\n${card.length} seat(s); ${idle.length} delivered nothing${idle.length ? ` (${idle.map(s => s.name).join(', ')})` : ''}.\n\n| seat | role | msgs | board (claim/verify/other) | commits | proposals | challenges | votes | cost | ended | note |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const s of card) {
    const exit = s.exitCode === undefined || s.exitCode === 0 ? '' : ` (exit ${s.exitCode ?? 'signal'})`;
    text += `| ${s.name} | ${s.role} | ${s.messages} | ${s.board.claim}/${s.board.verify}/${s.board.other} | ${s.commits ?? '-'} | ${s.proposals} | ${s.challenges} | ${s.votes} | ${s.cost === undefined ? '?' : `$${s.cost.toFixed(2)}${s.costSource === 'hub' ? ' (hub)' : ''}`} | ${ENDING_TEXT[s.ending]}${exit} | ${seatNote(s)} |\n`;
  }
  return `${text}\n`;
}
/**
 * Per-seat usage as the seat reported it (cost in USD). `steps`/`prompt_tokens`/`completion_tokens` come
 * from the openrouter/codex `<name>.usage.json` sidecar; a claude seat (single `claude -p --output-format
 * json` call, no step loop) instead reports `input_tokens`/`cache_read_input_tokens`/
 * `cache_creation_input_tokens`/`output_tokens`. A field a seat's provider does not produce is simply
 * absent (undefined), not 0: only `cost` is common to every provider and always required.
 */
export interface SeatUsageRollup {
  steps?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  cost: number;
}
/** Present only on claude seats; included in a rollup only when a reporting seat actually has them. */
const CLAUDE_ONLY_USAGE_FIELDS = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"] as const satisfies readonly (keyof SeatUsageRollup)[];
export type UsageCoverage = "complete" | "partial" | "none";
/**
 * Rolled-up usage for a run artifact. Unknown seats are never zero-filled: a seat that reported no
 * usage is counted in `seats` but not `seats_with_usage`, contributes nothing to the sums, and is
 * reflected by coverage "partial" (or "none" when no seat reported anything). A "none"/"partial"
 * rollup's sums must not be read as "the run cost nothing". The claude-only fields are included only
 * when at least one reporting seat has them, so an all-openrouter/codex run's rollup shape is unchanged.
 */
export interface UsageRollup {
  steps: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  seats: number;
  seats_with_usage: number;
  coverage: UsageCoverage;
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
}
/** Roll the launcher's per-seat outcomes into artifact.usage; undefined when there are no runs at all. */
export function rollupUsage(runs: readonly ({ usage?: SeatUsageRollup | null } | undefined)[]): UsageRollup | undefined {
  if (!runs.length) return undefined;
  const seats = runs.length;
  const have = runs.filter((r) => r && r.usage != null);
  const sum = (k: keyof SeatUsageRollup) => have.reduce((a, r) => a + (r!.usage![k] ?? 0), 0);
  if (!have.length) return { steps: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, seats, seats_with_usage: 0, coverage: "none" };
  const out: UsageRollup = {
    steps: sum("steps"),
    prompt_tokens: sum("prompt_tokens"),
    completion_tokens: sum("completion_tokens"),
    cost_usd: sum("cost"),
    seats,
    seats_with_usage: have.length,
    coverage: have.length === seats ? "complete" : "partial",
  };
  for (const k of CLAUDE_ONLY_USAGE_FIELDS) if (have.some((r) => typeof r!.usage![k] === "number")) out[k] = sum(k);
  return out;
}
/**
 * Parse a `claude -p --output-format json` stdout blob into the seat's final text (exactly what
 * `--output-format text` would have produced) plus its usage. Usage is `null` (unknown, not zero) when
 * the blob is not the expected JSON shape or carries no cost figure — a claude CLI version without
 * `total_cost_usd` must not be reported as a free run.
 *
 * `numTurns`/`durationMs`/`durationApiMs` come from the same envelope (confirmed live against a real
 * `claude -p --output-format json` call, RQ1 harness board key `evidence/claude-json-envelope`) and are
 * `undefined`, never 0-filled, when the field is absent or non-numeric — a claude seat has no step loop
 * so `num_turns` is the only real turn count available, and an old CLI without it must not read as
 * "zero turns".
 */
export function parseClaudeCliOutput(raw: string): { text: string; usage: SeatUsageRollup | null; numTurns?: number; durationMs?: number; durationApiMs?: number } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { text: raw, usage: null };
  }
  const text = typeof parsed?.result === "string" ? parsed.result : raw;
  const extra: { numTurns?: number; durationMs?: number; durationApiMs?: number } = {};
  if (typeof parsed?.num_turns === "number") extra.numTurns = parsed.num_turns;
  if (typeof parsed?.duration_ms === "number") extra.durationMs = parsed.duration_ms;
  if (typeof parsed?.duration_api_ms === "number") extra.durationApiMs = parsed.duration_api_ms;
  const cost = parsed?.total_cost_usd ?? parsed?.cost_usd;
  if (typeof cost !== "number") return { text, usage: null, ...extra };
  const u = parsed?.usage ?? {};
  const usage: SeatUsageRollup = { cost };
  for (const k of CLAUDE_ONLY_USAGE_FIELDS) if (typeof u[k] === "number") usage[k] = u[k];
  return { text, usage, ...extra };
}
/**
 * Where a run's proposed decision record goes. In the main checkout it is docs/decisions/proposed, where a human
 * promotes it. A run launched from a linked worktree or a swarm/* seat branch is a dev room testing that branch:
 * writing into its tracked docs/ puts the file one `git add -A` away from the branch under review, so the record
 * goes next to the report instead. Null when the project keeps no decision log.
 */
export function proposedDecisionDir(project: RunResult['project'], outDir: string, hasDecisionLog: boolean): string | null {
  if (!hasDecisionLog) return null;
  const git = project.git;
  const devRoom = git !== null && (git.branch.startsWith('swarm/') || resolve(git.commonDir) !== resolve(git.root, '.git'));
  return devRoom ? outDir : resolve(project.cwd, 'docs', 'decisions', 'proposed');
}
/** Fetch the existing full room endpoint; no board/body projection or text slicing. */
export async function collectRoomSnapshot(baseUrl: string, name: string): Promise<RoomSnapshot> {
  const base = `${baseUrl}/rooms/${encodeURIComponent(name)}`;
  const snapshot: RoomSnapshot = { name, payload: null, error: null, transcript: { text: null, sourceUrl: `${base}/transcript`, error: null } };
  const get = async (url: string) => { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`); return response; };
  try { snapshot.payload = await (await get(base)).json() as Record<string, any>; }
  catch (e) { snapshot.error = String(e); }
  try { snapshot.transcript.text = await (await get(`${base}/transcript`)).text(); }
  catch (e) { snapshot.transcript.error = String(e); }
  return snapshot;
}
export function readRunResult(path: string): RunResult {
  const r = JSON.parse(readFileSync(path, 'utf8'));
  const bad = (why: string): never => { throw new Error(`Invalid or unsupported run result (${why}): ${path}`); };
  if (r?.schemaVersion !== 1 || typeof r.run?.id !== 'string' || typeof r.leadRoom !== 'string' || !Array.isArray(r.rooms) || !r.verifier || !(r.verifier.output === null || typeof r.verifier.output === 'string') || r.rooms.some((room: any) => typeof room?.name !== 'string' || !(room.payload === null || (typeof room.payload === 'object' && !Array.isArray(room.payload))))) bad('structure');
  if (r.usage !== undefined && (typeof r.usage !== 'object' || r.usage === null || Array.isArray(r.usage) || typeof r.usage.steps !== 'number' || !['complete', 'partial', 'none'].includes(r.usage.coverage))) bad('usage');
  // The lead room must exist, and a present conclusion must be a string: an artifact that
  // names a room we never captured, or a typed conclusion field, is corrupt, not empty.
  const lead = r.rooms.find((room: any) => room.name === r.leadRoom);
  if (!lead) bad(`lead room ${r.leadRoom} not captured`);
  if (lead.payload !== null && lead.payload.conclusion !== undefined && lead.payload.conclusion !== null && typeof lead.payload.conclusion.text !== 'string' && typeof lead.payload.conclusion.text !== 'undefined') bad('lead conclusion.text is not a string');
  return r as RunResult;
}
export function writeRunResult(path: string, artifact: RunResult): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(artifact, null, 2) + '\n');
  renameSync(temp, path);
}
const NOT_FINDINGS = /^(claim|draft|hold|inbox|handoff)\//;
/**
 * What a run that did not conclude still wrote down. Handoffs are printed whole, since they are addressed to
 * whoever continues; other findings are only named, the artifact has their text.
 */
function renderLeftOnBoard(lead: Record<string, any>): string {
  const entries = Object.entries((lead.board ?? {}) as Record<string, { by?: string; text?: string }>);
  const handoffs = entries.filter(([key]) => key.startsWith('handoff/'));
  const others = entries.filter(([key]) => !NOT_FINDINGS.test(key));
  let text = '## Left on the board\n\n';
  if (!handoffs.length && !others.length) return `${text}No handoff/* entry and no findings: nothing recoverable was written down.\n\n`;
  for (const [key, e] of handoffs) text += `### ${key} (${e.by ?? 'unknown'})\n\n${(e.text ?? '').replace(/^#/gm, '\\#')}\n\n`;
  if (!handoffs.length) text += 'No handoff/* entry.\n\n';
  if (others.length) text += `Other entries: ${others.map(([key, e]) => `${key} (${e.by ?? 'unknown'})`).join(', ')}\n\n`;
  return text;
}
/** Human view only; consumers must read JSON, never parse this Markdown. */
export function renderRunReport(r: RunResult): string {
  const lead = r.rooms.find(room => room.name === r.leadRoom)?.payload;
  let text = `# ${r.run.id}\n\n**Task:** ${r.run.task}\n\n**Done when:** ${r.run.doneWhen}\n\n## Final answer (${lead?.state ?? 'missing'})\n\n${lead?.conclusion?.text ?? (r.outcome ? `_no consensus reached_: ${r.outcome.detail}` : '_no consensus reached_')}\n\n${lead && !lead.conclusion ? renderLeftOnBoard(lead) : ''}## Verifier\n\n${r.verifier.output ?? '(none)'}\n\n## Groups\n\n`;
  for (const room of r.rooms.filter(room => room.name !== r.leadRoom)) text += `### ${room.name} (${room.payload?.state ?? 'missing'})\n\n${room.payload?.conclusion?.text ?? '_no consensus_'}\n\n`;
  text += `## Result artifact\n\nAuthoritative full room snapshots, board evidence and raw transcripts: ${r.artifactPath}\n\n`;
  if (r.usage) {
    // claude seats have no steps/prompt_tokens/completion_tokens; without this, a claude-only run's real
    // cost and tokens would print as "0 steps, 0 prompt + 0 completion tokens" and read as a free run.
    const claudeBits = [
      r.usage.input_tokens !== undefined ? `${r.usage.input_tokens} input` : null,
      r.usage.cache_read_input_tokens !== undefined ? `${r.usage.cache_read_input_tokens} cache-read` : null,
      r.usage.cache_creation_input_tokens !== undefined ? `${r.usage.cache_creation_input_tokens} cache-creation` : null,
      r.usage.output_tokens !== undefined ? `${r.usage.output_tokens} output` : null,
    ].filter((s): s is string => s !== null);
    const claudeSuffix = claudeBits.length ? ` (claude: ${claudeBits.join(', ')} tokens)` : '';
    text += `## Usage\n\n${r.usage.steps} steps, ${r.usage.prompt_tokens} prompt + ${r.usage.completion_tokens} completion tokens${claudeSuffix}, $${r.usage.cost_usd.toFixed(4)} across ${r.usage.seats} seat(s); ${r.usage.seats_with_usage}/${r.usage.seats} reported usage (coverage: ${r.usage.coverage})\n\n`;
  }
  if (r.hubUsage) {
    const h = r.hubUsage;
    text += `${r.usage ? '' : '## Usage\n\n'}Hub-observed (live, every seat incl. recruits): $${h.cost_usd.toFixed(4)} over ${h.requests} model calls by ${h.seats} seat(s)${h.recruits.seats ? `, of which ${h.recruits.seats} recruit(s) $${h.recruits.cost_usd.toFixed(4)}` : ''}; ${h.input_tokens} input, ${h.cache_read_input_tokens} cache-read, ${h.cache_creation_input_tokens} cache-creation, ${h.output_tokens} output tokens.\n\n`;
  }
  if (r.scorecard?.length) text += renderScorecard(r.scorecard);
  if (r.collectionErrors?.length) text += `Collection errors (partial snapshot):\n${r.collectionErrors.map(e => `- ${e}`).join('\n')}\n\n`;
  text += '## Transcripts\n\n';
  for (const room of r.rooms) text += '```\n' + (room.transcript.text ?? `(missing: ${room.transcript.error})`).replace(/\n#/g, '\n\\#') + '```\n\n';
  return text;
}
