/**
 * Purpose of chair/owner steers. Manual labels are semantic observations; text cues are diagnostic proxies only.
 * npx tsx scripts/steer-split.ts <log.jsonl|data-dir>... --json [--sample 30] [--labels labels.json --audit audit.json]
 * Sample order: SHA256(room + ':' + (msg.seq ?? event index) + ':' + original content). No model calls or writes.
 * The pure core is src/measurements/steer-split.ts (the run report calls it too); this file is the CLI.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoomLog } from "../src/run-metrics.js";
import { collectSteers, counts, hash, type Label, labelAgreement, sampleSteers, summarizeLabels } from "../src/measurements/steer-split.js";

export * from "../src/measurements/steer-split.js";

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
