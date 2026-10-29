/**
 * item/report-wiring's measurement: do the numbers the run report prints (src/measurements/room.ts) equal what the four
 * standalone scripts print with --json on the same log? Field by field, per room; exit 1 on any mismatch. Needs the
 * embedder (CHATROOM_EMBED_URL, Ollama embeddinggemma): both sides read the same on-disk cache (src/measurements/embed.ts).
 *   CHATROOM_EMBED_URL=http://127.0.0.1:11434/api/embed npx tsx scripts/measurements-parity.ts <room.jsonl>... \
 *     [--width-labels labels/width-hand.json] [--provenance-labels docs/measurements/winner-provenance-2026-10-29-labels.json] [--json]
 * Parity shows wiring, not validity: the scripts' own n and agreement (RSI-7) carry over unchanged.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { embedTexts } from "../src/measurements/embed.js";
import { embedderFromEnv, LABEL_FLAGS, measureRoom, readLabelOptions } from "../src/measurements/room.js";
import { parseRoomLog } from "../src/run-metrics.js";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const files = argv.filter((a, i) => !a.startsWith("--") && !LABEL_FLAGS.includes(argv[i - 1] ?? ""));
const embedder = embedderFromEnv();
if (!files.length || !embedder) { console.error("usage: CHATROOM_EMBED_URL=... measurements-parity <room.jsonl>... [--width-labels f] [--provenance-labels f] [--json]"); process.exit(2); }
const labels = readLabelOptions(argv, (p) => readFileSync(p, "utf8"));
const run = (script: string, args: string[]) => {
  const out = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}`, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (out.status !== 0) throw new Error(`${script} ${args.join(" ")}: exit ${out.status}: ${out.stderr.slice(0, 500)}`);
  return JSON.parse(out.stdout);
};
const r3 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);
const tmp = mkdtempSync(join(tmpdir(), "measurements-parity-"));
type Check = { room: string; measurement: string; field: string; report: unknown; script: unknown; equal: boolean };
const checks: Check[] = [];
try {
  for (const file of files) {
    const events = parseRoomLog(readFileSync(file, "utf8"));
    const room = String(events.find((e) => e.type === "room")?.room ?? basename(file, ".jsonl"));
    const m = await measureRoom(events, room, { embedder, ...labels });
    const add = (measurement: string, field: string, report: unknown, script: unknown) =>
      checks.push({ room, measurement, field, report, script, equal: JSON.stringify(report) === JSON.stringify(script) });

    const sp = run("opening-spread.ts", [file, "--json", "--cut", "0.599", "--min-seats", "2"]).rooms[0] ?? null;
    for (const k of ["seats", "mix", "targets", "mean_cos", "min_cos", "eff_rank", "eff_rank_frac", "framings", "one_framing", "same_provider_cos", "cross_provider_cos"])
      add("opening_spread", k, m.opening_spread.value?.[k] ?? null, sp?.[k] ?? null);

    const wl = labels.widthLabels?.[room];
    if (wl) { writeFileSync(join(tmp, "w.json"), JSON.stringify({ [room]: wl })); }
    const fw = run("framing-width.ts", [file, "--json", ...(wl ? ["--labels", join(tmp, "w.json")] : ["--cut", "0.5"])])[0] ?? null;
    for (const k of ["statements", "seats", "first_evidence_min", "first_evidence_ref", "first_invocation_min"]) add("framing_width", k, m.framing_width.value?.[k] ?? null, fw?.[k] ?? null);
    if (wl) for (const k of ["held_at_reveal", "board_at_reveal", "max_held", "minutes_to_one", "collapse_before_evidence"]) add("framing_width", k, m.framing_width.value?.[k] ?? null, fw?.[k] ?? null);

    const texts: string[] = run("winner-provenance.ts", [file, "--texts"]);
    const vecs = await embedTexts(texts, { model: embedder.model, url: process.env.CHATROOM_EMBED_URL });
    writeFileSync(join(tmp, "v.json"), JSON.stringify(Object.fromEntries(texts.map((t, i) => [t, vecs[i]]))));
    const wp = run("winner-provenance.ts", [file, "--json", "--vectors", join(tmp, "v.json"), "--model", embedder.model]).rows[0] ?? null;
    const near = wp?.opening_matches?.[0];
    const pv = m.winner_provenance.value;
    add("winner_provenance", "origin", pv?.origin ?? null, wp?.origin ?? null);
    add("winner_provenance", "nearest_opening", pv?.nearest_opening ?? null, near && near.similarity !== null ? { author: near.author, similarity: r3(near.similarity) } : null);
    add("winner_provenance", "brief_similarity", pv?.brief_similarity ?? null, r3(wp?.brief_similarity));
    add("winner_provenance", "named_ideas", pv?.named_ideas ?? null, wp?.named_ideas ?? null);
    add("winner_provenance", "candidate_revisions", pv?.candidate_revisions ?? null, wp?.revisions?.length ?? null);
    add("winner_provenance", "revisions_with_receipt", pv?.revisions_with_receipt ?? null, wp?.revisions?.filter((r: any) => r.exposure_coverage === "receipt_present").length ?? null);
    const hand = labels.provenanceLabels?.find((l) => l.room === room);
    if (hand) add("winner_provenance", "label", pv?.label ?? null, hand.adjudicated_origin ?? hand.origin);

    const st = run("steer-split.ts", [file, "--json"]);
    const sv = m.steer_split.value;
    for (const k of ["steers", "human", "chair", "notes", "corrections"]) add("steer_split", k, sv?.[k] ?? null, st.totals[k]);
    add("steer_split", "proxy", sv?.proxy ?? null, st.proxy);
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

const bad = checks.filter((c) => !c.equal);
if (argv.includes("--json")) console.log(JSON.stringify({ rooms: files.length, fields: checks.length, mismatches: bad.length, checks }, null, 1));
else {
  for (const room of [...new Set(checks.map((c) => c.room))]) {
    const cs = checks.filter((c) => c.room === room);
    const by = (k: string) => { const x = cs.filter((c) => c.measurement === k); return `${k} ${x.filter((c) => c.equal).length}/${x.length}`; };
    console.log(`${room}: ${["opening_spread", "framing_width", "winner_provenance", "steer_split"].map(by).join(", ")}`);
  }
  for (const c of bad) console.log(`  MISMATCH ${c.room} ${c.measurement}.${c.field}: report ${JSON.stringify(c.report)} vs script ${JSON.stringify(c.script)}`);
  console.log(`parity: ${files.length} room(s), ${checks.length - bad.length}/${checks.length} fields equal`);
}
process.exit(bad.length ? 1 : 0);
