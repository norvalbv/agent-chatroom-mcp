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
}
/** Per-seat usage exactly as the seat persisted it in its <name>.usage.json sidecar (cost in USD). */
export interface SeatUsageRollup {
  steps: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
}
export type UsageCoverage = "complete" | "partial" | "none";
/**
 * Rolled-up usage for a run artifact. Unknown seats are never zero-filled: a seat that reported no
 * usage is counted in `seats` but not `seats_with_usage`, contributes nothing to the sums, and is
 * reflected by coverage "partial" (or "none" when no seat reported anything). A "none"/"partial"
 * rollup's sums must not be read as "the run cost nothing".
 */
export interface UsageRollup {
  steps: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  seats: number;
  seats_with_usage: number;
  coverage: UsageCoverage;
}
/** Roll the launcher's per-seat outcomes into artifact.usage; undefined when there are no runs at all. */
export function rollupUsage(runs: readonly ({ usage?: SeatUsageRollup | null } | undefined)[]): UsageRollup | undefined {
  if (!runs.length) return undefined;
  const seats = runs.length;
  const have = runs.filter((r) => r && r.usage != null);
  const sum = (k: keyof SeatUsageRollup) => have.reduce((a, r) => a + (r!.usage![k] ?? 0), 0);
  if (!have.length) return { steps: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, seats, seats_with_usage: 0, coverage: "none" };
  return {
    steps: sum("steps"),
    prompt_tokens: sum("prompt_tokens"),
    completion_tokens: sum("completion_tokens"),
    cost_usd: sum("cost"),
    seats,
    seats_with_usage: have.length,
    coverage: have.length === seats ? "complete" : "partial",
  };
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
/** Human view only; consumers must read JSON, never parse this Markdown. */
export function renderRunReport(r: RunResult): string {
  const lead = r.rooms.find(room => room.name === r.leadRoom)?.payload;
  let text = `# ${r.run.id}\n\n**Task:** ${r.run.task}\n\n**Done when:** ${r.run.doneWhen}\n\n## Final answer (${lead?.state ?? 'missing'})\n\n${lead?.conclusion?.text ?? '_no consensus reached_'}\n\n## Verifier\n\n${r.verifier.output ?? '(none)'}\n\n## Groups\n\n`;
  for (const room of r.rooms.filter(room => room.name !== r.leadRoom)) text += `### ${room.name} (${room.payload?.state ?? 'missing'})\n\n${room.payload?.conclusion?.text ?? '_no consensus_'}\n\n`;
  text += `## Result artifact\n\nAuthoritative full room snapshots, board evidence and raw transcripts: ${r.artifactPath}\n\n`;
  if (r.usage) text += `## Usage\n\n${r.usage.steps} steps, ${r.usage.prompt_tokens} prompt + ${r.usage.completion_tokens} completion tokens, $${r.usage.cost_usd.toFixed(4)} across ${r.usage.seats} seat(s); ${r.usage.seats_with_usage}/${r.usage.seats} reported usage (coverage: ${r.usage.coverage})\n\n`;
  if (r.collectionErrors?.length) text += `Collection errors (partial snapshot):\n${r.collectionErrors.map(e => `- ${e}`).join('\n')}\n\n`;
  text += '## Transcripts\n\n';
  for (const room of r.rooms) text += '```\n' + (room.transcript.text ?? `(missing: ${room.transcript.error})`).replace(/\n#/g, '\n\\#') + '```\n\n';
  return text;
}
