/**
 * Purpose of chair/owner steers (moved unchanged from scripts/steer-split.ts so the run report can call it; the CLI stays
 * there). Manual labels are semantic observations; text cues are diagnostic proxies only.
 */
import { createHash } from "node:crypto";
import { steerCount } from "../telemetry/steer-count.js";

type Ev = Record<string, any>;
export type Purpose = "reframe" | "unblock" | "both" | "other" | "uncertain";
const PURPOSES: Purpose[] = ["reframe", "unblock", "both", "other", "uncertain"];
export interface Label { id: string; label: string; rationale?: string }
export interface Log { file: string; events: Ev[] }
export interface Steer {
  id: string; room: string; file: string; index: number; seq: number;
  kind: "chat" | "note" | "correction"; role: "human" | "chair" | "note";
  by: string; text: string; proxy: Purpose; redacted: boolean;
  context: { from: string; text: string; truncated: boolean }[];
}
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const redact = (text: string) => text.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_API_TOKEN]");
const CORRECTION = /correction|supersed|withdrawn|retract/i;
// Presence of these phrases is not a semantic label. Quote/negation/scope and domain accounting can fool them.
export const REFRAME_CUES = [
  /\brefram(?:e|ing)\b/i,
  /\b(?:wrong|right) (?:question|problem|thing|hypothesis|framing|target)\b/i,
  /\b(?:hypothes(?:is|es)|competing (?:explanations?|framings?)|alternative (?:explanations?|hypotheses|hypothesis|framings?))\b/i,
  /\b(?:not|doesn't|does not) (?:prove|reproduce|explain|mean)\b/i,
  /\b(?:rather than|instead of)\b/i,
  /\b(?:may|could|might) (?:be|come|reflect)\b/i,
  /\b(?:assum(?:e|ption|ing)|reconsider|rethink)\b/i,
];
export const UNBLOCK_CUES = [
  /\b(?:recruit|assign|approve|approval|permission|unblock|blocked|retry|restart|relaunch|deploy|merge|merged|review|reviewer|verify|verifier|deadline|stop|pause|resume|port|pid|fix|patch|tool|token|key)\b/i,
  /\b(?:run|post|write|read|check|build|test|publish|wait|hold|confirm|schedule|continue)\b/i,
];
export function purposeCue(text: string): Purpose {
  if (!text.trim()) return "uncertain";
  const reframe = REFRAME_CUES.some(r => r.test(text)), unblock = UNBLOCK_CUES.some(r => r.test(text));
  return reframe ? unblock ? "both" : "reframe" : unblock ? "unblock" : "other";
}

/** Mirrors the steer-count eligibility, then reconciles every input log with that authoritative counter. */
export function collectSteers(logs: readonly Log[]): Steer[] {
  const steerers = new Set<string>();
  for (const { events } of logs) for (const e of events) if (e.type === "join" && e.p?.name && (e.p.agent === "human" || e.p.role === "chair")) steerers.add(e.p.name);
  const expected = steerCount(logs.map(l => l.events));
  const rows: Steer[] = [];
  logs.forEach(({ file, events }, logIndex) => {
    const room = expected[logIndex].room, noteKeys = new Set<string>();
    const before = rows.length;
    events.forEach((e, index) => {
      let text: string, by: string, seq = index, kind: Steer["kind"], role: Steer["role"];
      if (e.type === "message" && e.msg?.kind === "chat" && steerers.has(e.msg.from?.name)) {
        by = e.msg.from.name; text = String(e.msg.content ?? ""); seq = e.msg.seq ?? index;
        kind = "chat"; role = e.msg.from.agent === "human" ? "human" : "chair";
      } else if (e.type === "board" && typeof e.key === "string" && e.key.startsWith("inbox/") && !e.key.endsWith(".ack") && steerers.has(e.entry?.by)) {
        by = e.entry.by; text = String(e.entry.text ?? ""); role = "note";
        kind = noteKeys.has(e.key) || CORRECTION.test(e.key) || CORRECTION.test(text.slice(0, 300)) ? "correction" : "note";
        noteKeys.add(e.key);
      } else return;
      const clean = redact(text);
      const context = events.slice(Math.max(0, index - 40), index).filter(v => v.type === "message" && v.msg?.kind === "chat").slice(-3).map(v => ({ from: String(v.msg.from?.name ?? "?"), text: redact(String(v.msg.content ?? "").slice(0, 1600)), truncated: String(v.msg.content ?? "").length > 1600 }));
      rows.push({ id: hash(`${room}:${seq}:${text}`), room, file, index, seq, kind, role, by, text: clean, redacted: clean !== text, proxy: purposeCue(text), context });
    });
    if (rows.length - before !== expected[logIndex].steers) throw new Error(`population drift from steer-count in ${file}`);
  });
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("duplicate steer identity; supply each log once and inspect repeated room/seq/content");
  return rows;
}
export function sampleSteers(rows: readonly Steer[], n: number): Steer[] {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("sample must be a nonnegative integer");
  return [...rows].sort((a, b) => a.id.localeCompare(b.id)).slice(0, n);
}
function labelMap(labels: readonly Label[]): Map<string, Purpose> {
  if (!Array.isArray(labels)) throw new Error("labels must be a JSON array");
  const out = new Map<string, Purpose>();
  for (const row of labels) {
    if (!row || typeof row.id !== "string" || !PURPOSES.includes(row.label as Purpose)) throw new Error("invalid label (id plus reframe|unblock|both|other|uncertain required)");
    if (out.has(row.id)) throw new Error(`duplicate label ${row.id}`);
    out.set(row.id, row.label as Purpose);
  }
  return out;
}
export function counts(labels: Iterable<Purpose>) {
  const result = { n: 0, reframe: 0, unblock: 0, both: 0, other: 0, uncertain: 0 };
  for (const label of labels) { result.n++; result[label]++; }
  return result;
}
export function summarizeLabels(rows: readonly Steer[], labels: readonly Label[]) {
  const known = new Set(rows.map(r => r.id)), map = labelMap(labels);
  for (const id of map.keys()) if (!known.has(id)) throw new Error(`label id not in input logs: ${id}`);
  return counts(map.values());
}
export function labelAgreement(author: readonly Label[], audit: readonly Label[]) {
  const a = labelMap(author), b = labelMap(audit);
  let exact = 0;
  const disagreements: { id: string; author: Purpose; audit: Purpose }[] = [];
  for (const [id, label] of b) {
    const original = a.get(id);
    if (!original) throw new Error(`audit id has no author label: ${id}`);
    if (original === label) exact++; else disagreements.push({ id, author: original, audit: label });
  }
  return { n: b.size, exact, rate: b.size ? exact / b.size : null, disagreements };
}
