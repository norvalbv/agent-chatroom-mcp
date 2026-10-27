/** Evidence-linked next-run triage, not a task verdict or a diagnosis of what caused a room to fail. */
import type { RoomSnapshot, RunResult } from "../result.js";
import type { RunMetrics } from "../run-metrics.js";
import { createHash } from "node:crypto";

export interface FeedbackRecommendation {
  id: string;
  category: "capture" | "setup" | "environment" | "evidence" | "coordination";
  observation: string;
  evidence: { room: string; path: string; sha256?: string }[];
  action: string;
  check: string;
}
export interface RunFeedback {
  schemaVersion: 1;
  /** Consensus, checker prose and activity counts do not establish the task's outcome. */
  taskOutcome: "unassessed";
  source: { run: string; capturedAt: string; sha256: string };
  rooms: { total: number; captured: number; withMetrics: number };
  recommendations: FeedbackRecommendation[];
  /** Ranked, coalesced root actions; complete scoped observations remain in recommendations. */
  next: FeedbackRecommendation[];
  unknowns: string[];
}

const count = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");
const PRIORITY = { capture: 0, environment: 1, setup: 2, evidence: 3, coordination: 4 };

function rootActions(rows: FeedbackRecommendation[]): FeedbackRecommendation[] {
  const grouped = new Map<string, FeedbackRecommendation>();
  for (const r of rows) {
    const previous = grouped.get(r.id);
    if (previous) { previous.observation += ` ${r.observation}`; previous.evidence.push(...r.evidence); }
    else grouped.set(r.id, { ...r, evidence: [...r.evidence] });
  }
  return [...grouped.values()].sort((a, b) => PRIORITY[a.category] - PRIORITY[b.category] || a.id.localeCompare(b.id)).slice(0, 3);
}
function isMetrics(m: any, room: string): m is RunMetrics {
  return !!m && m.room === room && Array.isArray(m.seats) && !!m.minutesTo && typeof m.minutesTo === "object";
}

/** A final snapshot opts in once, never on a poll. Sequential requests bound load; the timeout bounds the launcher
 * wait, but cannot interrupt the serving hub's synchronous git attribution work in /metrics. */
export async function collectRoomMetrics(rooms: RoomSnapshot[], hubUrl: string, opts: { fetch?: typeof fetch } = {}): Promise<void> {
  for (const room of rooms) {
    delete room.metrics;
    delete room.metricsError;
    try {
      const response = await (opts.fetch ?? fetch)(`${hubUrl}/rooms/${encodeURIComponent(room.name)}/metrics`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const metrics = await response.json();
      if (!isMetrics(metrics, room.name)) throw new Error("metrics room/schema mismatch");
      room.metrics = metrics;
    } catch (e) { room.metricsError = String(e); }
  }
}

/** Fresh projection on every read/write: persisted feedback is never trusted as a cache. Each observation names its
 * scope and source. No conclusion text is classified and a listed need is never assumed to remain a blocker. */
export function runFeedback(run: RunResult): RunFeedback {
  const { feedback: _oldFeedback, ...snapshot } = run;
  const feedback: RunFeedback = { schemaVersion: 1, taskOutcome: "unassessed", source: { run: run.run.id, capturedAt: run.run.completedAt, sha256: digest(snapshot) }, rooms: { total: run.rooms.length, captured: 0, withMetrics: 0 }, recommendations: [], next: [], unknowns: [] };
  const add = (r: FeedbackRecommendation) => {
    r.evidence = r.evidence.map(e => {
      const room = run.rooms.find(r => r.name === e.room);
      const p = room?.payload;
      const container: Record<string, any> = { ...p, payload: p, transcript: room?.transcript, metrics: room?.metrics ?? (room?.name === run.leadRoom ? run.metrics : undefined), preflight: run.preflight, collectionErrors: run.collectionErrors };
      const value = e.path.startsWith("board.") ? p?.board?.[e.path.slice(6)]?.text : e.path.startsWith("collectionErrors[") ? run.collectionErrors?.[Number(e.path.match(/\d+/)?.[0])] : e.path.split(".").reduce((value, key) => value?.[key], container);
      return { ...e, sha256: digest(value) };
    });
    feedback.recommendations.push(r);
  };
  const capture: FeedbackRecommendation["evidence"] = [];
  for (const [i, error] of (run.collectionErrors ?? []).entries()) {
    if (error.startsWith("incremental checkpoint:")) continue;
    capture.push({ room: run.leadRoom, path: `collectionErrors[${i}]` });
  }
  for (const room of run.rooms) {
    const p = room.payload;
    if (p) feedback.rooms.captured++;
    else capture.push({ room: room.name, path: "payload" });
    if (room.transcript.error) capture.push({ room: room.name, path: "transcript.error" });
    const m = room.metrics ?? (room.name === run.leadRoom ? run.metrics : undefined);
    if (isMetrics(m, room.name)) {
      feedback.rooms.withMetrics++;
      if (room.metricsError) feedback.unknowns.push(`${room.name}: ${room.metricsError}`);
      const research = m.research;
      if (research && research.tagged === true && count(research.steps?.fetch) && research.steps.fetch > 0 && research.steps.run === 0) {
        add({ id: "exercise-fetched-code", category: "evidence", observation: `${room.name}: tagged ledger records ${research.steps.fetch} code fetch step(s), 0 outside-code run steps.`, evidence: [{ room: room.name, path: "metrics.research.steps" }],
          action: "Review the fetched implementation for applicability; time-box a runnable reference baseline or record why it cannot be exercised.", check: "The next run records a tagged outside-code run and its result, or an evidence-backed setup limitation; fetching alone does not count as reproduction." });
      }
      if (research?.tagged === false) feedback.unknowns.push(`${room.name}: legacy/untagged research targets may omit long commands; outside-code execution completeness is unknown.`);
      const repeated = m.reResearch?.carriedFetches;
      if (count(repeated) && repeated > 0) add({ id: "reuse-carried-evidence", category: "evidence", observation: `${room.name}: ${repeated} fetch(es) named sources the seat had already been told were read.`, evidence: [{ room: room.name, path: "metrics.reResearch.carriedFetches" }],
        action: "Start from the carried source summaries; record the freshness question before fetching a listed source again.", check: "Compare carried-source fetches on the same brief, retaining justified refreshes and checking that necessary evidence was still tested." });
    } else feedback.unknowns.push(`${room.name}: metrics unavailable${room.metricsError ? ` (${room.metricsError})` : ""}; missing activity is not zero activity.`);
    if (!p) continue;
    const open = p.coverage?.open;
    if (Array.isArray(open) && open.length) add({ id: "cover-open-items", category: "setup", observation: `${room.name}: ${open.length} coverage item(s) have no current owner.`, evidence: [{ room: room.name, path: "coverage.open" }],
      action: "Put these owner questions into explicit item entries and assign or deliberately drop each before the next run narrows.", check: "The coverage ledger has no unowned/orphaned required items, and its items match the owner's questions rather than operating rules." });
    if (!p.coverage) feedback.unknowns.push(`${room.name}: no coverage ledger was captured; ownership completeness is unknown.`);
    const needs = Object.entries(p.board ?? {}).filter(([key, entry]) => key.startsWith("needs/") && typeof (entry as any)?.text === "string" && (entry as any).text.trim());
    if (needs.length) add({ id: "review-needs", category: "setup", observation: `${room.name}: ${needs.length} needs/* entry/entries remain listed on the final board.`, evidence: needs.map(([key]) => ({ room: room.name, path: `board.${key}` })),
      action: "Review each listed need against the owner's answer. Confirm whether it remains open, was met, or was declined before reusing the same setup.", check: "Each retained need has a current disposition and the next brief states the scope it limits; do not treat its presence alone as a blocker." });
    const proposals = Array.isArray(p.proposals) ? p.proposals : [];
    const latest = proposals.filter((proposal: any) => proposal.status === "open").at(-1);
    if (!p.conclusion && latest) add({ id: "resume-open-work", category: "coordination", observation: `${room.name}: proposal ${latest.id} remains open.`, evidence: [{ room: room.name, path: "proposals" }],
      action: "Read the open proposal's blocked_by/waiting_on and existing handoffs before restarting research.", check: "The continuation resolves or explicitly retires each recorded blocker and preserves the evidence already collected." });
  }
  if (capture.length) add({ id: "restore-capture", category: "capture", observation: `${capture.length} capture gap(s) are recorded; the postmortem is incomplete.`, evidence: capture,
    action: "Recover the named payload, transcript or collection failure from its recorded room before diagnosing the run.", check: "The same artifact can be replayed with the missing captures restored, or the remaining unknown scope is stated." });
  if (run.preflight && (run.preflight.fails || run.preflight.warns)) add({ id: "validate-environment", category: "environment", observation: `Launch preflight recorded ${run.preflight.fails} FAIL and ${run.preflight.warns} WARN.`, evidence: [{ room: run.leadRoom, path: "preflight" }],
    action: "Decide which checks invalidate the next planned measurement; resolve those prerequisites before repeating that measurement.", check: "A fresh named preflight validates the quantity to be measured; unrelated recorded-data work may continue." });
  if (!run.rooms.length) feedback.unknowns.push("No final room snapshots were captured; this may be an incremental checkpoint.");
  feedback.next = rootActions(feedback.recommendations);
  return feedback;
}

export function renderFeedback(feedback: RunFeedback): string {
  let text = `## Next run\n\nEvidence-linked triage; task attainment is unassessed. These observations do not identify the cause of a failure or prove that the recommendations improve answers. Captured ${feedback.rooms.captured}/${feedback.rooms.total} room(s), metrics for ${feedback.rooms.withMetrics}/${feedback.rooms.total}.\n\n`;
  text += `Snapshot: ${feedback.source.run}, ${feedback.source.capturedAt || "time unknown"}, sha256 ${feedback.source.sha256}. Showing up to 3 ranked actions; ${feedback.recommendations.length} scoped observation(s) and full evidence hashes remain in the JSON artifact.\n\n`;
  for (const r of feedback.next) text += `- **${r.id} (${r.category})**: ${r.observation} ${r.action} Check: ${r.check} Evidence: ${r.evidence.map(e => `${e.room}:${e.path}`).join(", ")}.\n`;
  if (!feedback.recommendations.length) text += "No supported triage recommendation from the captured signals; this is not a task success verdict.\n";
  if (feedback.unknowns.length) text += `\nUnknowns:\n${feedback.unknowns.map(s => `- ${s}`).join("\n")}\n`;
  return text + "\n";
}
