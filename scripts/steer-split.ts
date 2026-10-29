/**
 * Purpose of chair/owner steers. Manual labels are semantic observations; text cues are diagnostic proxies only.
 * npx tsx scripts/steer-split.ts <log.jsonl|data-dir>... --json [--sample 30] [--labels labels.json --audit audit.json]
 * Sample order: SHA256(room + ':' + (msg.seq ?? event index) + ':' + original content). No model calls or writes.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoomLog } from "../src/run-metrics.js";
import { steerCount } from "../src/telemetry/steer-count.js";

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
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
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
function counts(labels: Iterable<Purpose>) {
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
function loadPaths(paths: string[]) {
  const files = new Set<string>();
  for (const path of paths) {
    const stat = statSync(path);
    if (stat.isDirectory()) for (const f of readdirSync(path).sort()) { if (f.endsWith(".jsonl") && statSync(join(path, f)).isFile()) files.add(realpathSync(join(path, f))); }
    else if (stat.isFile()) files.add(realpathSync(path));
    else throw new Error(`not a log file: ${path}`);
  }
  if (!files.size) throw new Error("no log files");
  return [...files].sort().map(file => { const text = readFileSync(file, "utf8"); return { file, sha256: hash(text), events: parseRoomLog(text) }; });
}
function main(argv: string[]) {
  const paths: string[] = [];
  let sample: number | undefined, labelsPath: string | undefined, auditPath: string | undefined, json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (["--sample", "--labels", "--audit"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      if (arg === "--sample") { sample = Number(value); if (!Number.isSafeInteger(sample) || sample < 0) throw new Error("sample must be a nonnegative integer"); }
      else if (arg === "--labels") labelsPath = value; else auditPath = value;
    } else if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}`);
    else paths.push(arg);
  }
  if (!paths.length) throw new Error("usage: steer-split <log.jsonl|data-dir>... [--json] [--sample N] [--labels path --audit path]");
  if (auditPath && !labelsPath) throw new Error("--audit requires --labels");
  const logs = loadPaths(paths), rows = collectSteers(logs);
  const labels: Label[] = labelsPath ? JSON.parse(readFileSync(labelsPath, "utf8")) : [];
  const audit: Label[] = auditPath ? JSON.parse(readFileSync(auditPath, "utf8")) : [];
  const manual = summarizeLabels(rows, labels);
  const proxyAuthor = rows.filter(r => labels.some(l => l.id === r.id)).map(r => ({ id: r.id, label: r.proxy }));
  const out = {
    schema: "steer-split-v1", population: "steer-count: human/chair chats and inbox notes; all input logs; injections excluded",
    warning: "Whole-corpus purpose cues are lexical proxies, not semantic counts or evidence of improved quality. Manual sample can be clustered by run.",
    inputs: logs.map(({ file, sha256, events }) => ({ file, sha256, events: events.length })),
    totals: { logs: logs.length, rooms_with_steers: new Set(rows.map(r => r.room)).size, steers: rows.length, human: rows.filter(r => r.role === "human").length, chair: rows.filter(r => r.role === "chair").length, notes: rows.filter(r => r.kind === "note").length, corrections: rows.filter(r => r.kind === "correction").length },
    proxy: counts(rows.map(r => r.proxy)), manual,
    proxy_vs_manual: labelAgreement(labels, proxyAuthor),
    ...(auditPath ? { audit: labelAgreement(labels, audit), audit_counts: summarizeLabels(rows, audit) } : {}),
    by_room: logs.map(l => { const rr = rows.filter(r => r.file === l.file); return { file: l.file, room: rr[0]?.room ?? l.events.find(e => e.room)?.room ?? "?", proxy: counts(rr.map(r => r.proxy)) }; }),
    ...(sample !== undefined ? { sample: sampleSteers(rows, sample) } : {}),
  };
  console.log(json ? JSON.stringify(out, null, 2) : `${out.totals.steers} steers in ${out.totals.logs} logs (${out.totals.rooms_with_steers} with steers).\nLexical proxies: ${JSON.stringify(out.proxy)}\nManual labels: ${JSON.stringify(manual)}\n${out.warning}${auditPath ? `\nBlind agreement: ${out.audit!.exact}/${out.audit!.n}` : ""}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`steer-split: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
