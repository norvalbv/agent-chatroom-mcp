/**
 * Find a finished run's DECISION RECORD the way the launcher now does (src/launch/decision-record.ts) and, with --write, file one
 * proposed decision per Target. For a run whose launcher predates that (it filed only the first `Slug:` of the verifier's
 * last turn), or to recheck one: the verifier's final text, its session transcripts (scorecard[].transcript) and its chat
 * messages in the lead room's transcript are all read from result.json.
 *   npx tsx scripts/decision-record.ts swarms/<id>/result.json [--json] [--write <dir>]
 *   npx tsx scripts/decision-record.ts --replay swarms/*\/result.json     old launcher rule against this one, per run
 * Without --write nothing is written; --json prints result.json's `decisionRecord` shape.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileDecisionRecord, findDecisionRecord, isVerifierSeat, renderDecisionRecord, verifierCandidates, type DecisionRecordSearch } from "../src/launch/decision-record.js";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("usage: npx tsx scripts/decision-record.ts <result.json> [--json] [--write <dir>]\n       npx tsx scripts/decision-record.ts --replay <result.json>...");
  process.exit(args.length ? 0 : 2);
}
const isVerifier = isVerifierSeat;
function search(r: any): DecisionRecordSearch {
  const lead = (r.rooms ?? []).find((room: any) => room?.name === r.leadRoom);
  const transcripts = ((r.scorecard ?? []) as { name?: string; transcript?: string }[]).filter((s) => s.name && isVerifier(s.name) && s.transcript).map((s) => s.transcript!);
  return findDecisionRecord(verifierCandidates({ finalText: r.verifier?.output, transcripts, roomTranscript: lead?.transcript?.text, isVerifier }));
}
/** What src/swarm.ts filed before src/launch/decision-record.ts: the first slug of the CLI's last turn, or nothing. */
function oldRule(r: any): string | null {
  const rec = /DECISION RECORD[\s\S]*$/.exec(r.verifier?.output ?? "")?.[0];
  return /slug\**:\**\s*`?([a-z0-9-]{3,80})/i.exec(rec ?? "")?.[1] ?? null;
}

if (args.includes("--replay")) {
  const files = args.filter((a) => !a.startsWith("--"));
  let runs = 0, withRecord = 0, oldFiled = 0, newFiled = 0, oldRuns = 0, newRuns = 0;
  console.log("run\told\tnew\tsource\tmissing");
  for (const f of files) {
    let r: any;
    try { r = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    if (!r?.verifier) continue;
    runs++;
    const old = oldRule(r);
    const s = search(r);
    const n = s.found?.targets.length ?? 0;
    if (s.found || s.unnamed) withRecord++;
    if (old) { oldFiled++; oldRuns++; }
    if (n) { newFiled += n; newRuns++; }
    if (old || n || s.unnamed) console.log(`${r.run?.id ?? f}\t${old ?? "-"}\t${n}\t${s.found?.source ?? s.unnamed?.source ?? "-"}\t${s.found ? "" : s.missing ?? ""}`);
  }
  console.log(`\n${runs} run(s) with a verifier; ${withRecord} wrote a DECISION RECORD somewhere. Old rule: ${oldFiled} proposed decision(s) from ${oldRuns} run(s). Now: ${newFiled} from ${newRuns} run(s).`);
  process.exit(0);
}

const path = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--write")!;
const writeAt = args.indexOf("--write");
const dir = writeAt >= 0 ? resolve(args[writeAt + 1] ?? ".") : null;
const r = JSON.parse(readFileSync(path, "utf8"));
const lead = (r.rooms ?? []).find((room: any) => room?.name === r.leadRoom);
const found = search(r);
const summary = dir
  ? fileDecisionRecord(found, { runId: r.run?.id ?? "run", state: lead?.payload?.state ?? "unknown", outDir: dir, dir })
  : { source: found.found?.source ?? null, ...(found.found?.at ? { at: found.found.at } : {}), slugs: found.found?.targets.map((t) => t.slug) ?? [], files: [], ...(found.missing ? { missing: found.missing } : {}), searched: found.searched };
if (args.includes("--json")) console.log(JSON.stringify(summary, null, 2));
else {
  process.stdout.write(renderDecisionRecord(summary));
  for (const t of found.found?.targets ?? []) console.log(`- ${t.slug} (${t.slugFrom}): ${t.text.split("\n")[0].slice(0, 120)}`);
}
process.exit(found.found ? 0 : 1);
