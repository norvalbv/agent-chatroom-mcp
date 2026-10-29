/**
 * Descriptive conclusion alignment and revision/exposure ledger, never a causal influence classifier.
 * npx tsx scripts/winner-provenance.ts <jsonl|dir> [...] [--cohort 20] [--json|--texts|--packet]
 * Optional --vectors text-to-vector.json --cut <fitted cosine> enables alignment; absent vectors stay unknown.
 * --packet retains FULL texts for blind human labels; embeddings use 1200 chars and report that loss.
 * The pure core is src/measurements/winner-provenance.ts (the run report calls it too); this file is the CLI.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, parseLog, provenance, stamp } from "../src/measurements/winner-provenance.js";

export * from "../src/measurements/winner-provenance.js";

function main() {
  const argv = process.argv.slice(2), paths: string[] = [];
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (["--vectors", "--model", "--cut", "--cohort", "--rooms"].includes(a)) { if (!argv[i + 1]) throw new Error(`missing value ${a}`); values.set(a, argv[++i]!); }
    else if (!a.startsWith("--")) paths.push(a);
    else if (!["--json", "--texts", "--packet", "--all-texts", "--all-seats"].includes(a)) throw new Error(`unknown option ${a}`);
  }
  if (!paths.length) throw new Error("usage: winner-provenance <jsonl|dir> [...] [--cohort 20] [--json|--texts|--packet]");
  const files = [...new Set(paths.flatMap(p => statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith(".jsonl")).map(f => join(p, f)) : [p]).map(p => resolve(p)))].sort();
  const vectors = values.has("--vectors") ? new Map<string, number[]>(Object.entries(JSON.parse(readFileSync(values.get("--vectors")!, "utf8")))) : undefined;
  if (vectors && !values.has("--model")) throw new Error("--vectors requires --model to declare the embedding model");
  const cut = values.has("--cut") ? Number(values.get("--cut")) : undefined;
  if (cut !== undefined && (!Number.isFinite(cut) || cut < -1 || cut > 1)) throw new Error("cut must be a fitted cosine in [-1,1]");
  let rows = files.map(file => {
    const { events, malformed } = parseLog(readFileSync(file, "utf8"));
    return { file, malformed, events, row: provenance(events, basename(file, ".jsonl"), { vectors, cut, allSeats: argv.includes("--all-seats") }) };
  }).filter(r => r.events.some(e => e.type === "room"));
  if (values.has("--cohort")) rows = rows.filter(r => r.row.eligible_main)
    .sort((a, b) => hash(a.row.room + "rsi-framing-v1").localeCompare(hash(b.row.room + "rsi-framing-v1"))).slice(0, Number(values.get("--cohort")));
  if (values.has("--rooms")) { const ids = new Set(values.get("--rooms")!.split(",")); rows = rows.filter(r => ids.has(r.row.room)); }
  if (argv.includes("--texts")) {
    const texts = rows.flatMap(({ row }) => [...row.openings, ...row.seeded, ...(row.final ? [row.final] : []), ...(argv.includes("--all-texts") ? row.snapshots : [])]
      .map(s => s.embedded_text).concat(row.brief?.embedded_text ?? ""));
    console.log(JSON.stringify([...new Set(texts.filter(Boolean))])); return;
  }
  if (argv.includes("--packet")) {
    console.log(JSON.stringify(rows.map(({ file, malformed, events, row }) => ({ room: row.room, file, malformed, brief: row.brief?.text,
      openings: [...row.openings].sort((a, b) => hash(a.key).localeCompare(hash(b.key))).map((s, i) => ({ seat: i + 1, event: s.event, text: s.text })),
      seeded: row.seeded.map(s => ({ key: s.key, event: s.event, text: s.text })), conclusion: row.final?.text ?? null,
      conclusion_event: row.final?.event ?? null, reveal_event: events.findIndex(e => e.type === "openings_revealed"),
      timeline: events.flatMap((e, i) => e.type === "message" && /^(chat|proposal|amend)$/.test(e.msg?.kind) ? [{ event: i, ts: stamp(e), source: e.msg.kind, text: e.msg.content }]
        : e.type === "board" && e.entry?.text && !/^(resource|claim|take|review|verify)\//.test(e.key) ? [{ event: i, ts: stamp(e), source: e.key, text: e.entry.text }] : []) })), null, 1)); return;
  }
  const result = { schema: "winner-provenance-v1", model: vectors ? values.get("--model")! : null, cut: cut ?? null,
    note: "Alignment is descriptive. Key mention is citation, not endorsement. Revision is a candidate, not a demonstrated pivot. Missing evidence is unknown.",
    rows: rows.map(({ file, malformed, row }) => ({ file, malformed, ...row })) };
  if (argv.includes("--json")) console.log(JSON.stringify(result, null, 1));
  else for (const { row } of rows) console.log(`${row.room}: ${row.origin}; openings=${row.openings.length}; candidate revisions=${row.revisions.length}; truncated conclusion=${row.truncation.conclusion}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
