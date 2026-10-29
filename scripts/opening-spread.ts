/**
 * How alike a room's sealed openings are at the reveal (item/opening-spread; the owner's question 1, "are we looking at
 * the right thing", read as framing width, not retrieval width). Per room: the openings sealed before openings_revealed
 * (workers, leads and early recruits; verifier, chair and humans excluded unless --all-roles), each embedded once
 * (scripts/embed-cache.ts, Ollama embeddinggemma), then mean and minimum pairwise cosine, the effective rank of the
 * L2-normalised opening matrix (Roy & Vetterli 2007: exp of the entropy of the normalised singular values; n means every
 * opening points its own way, 1 means one direction), and the number of framings at a cut: connected components of the
 * graph joining openings whose cosine is at or above it (single linkage, so a chain of near-copies counts as one).
 * The cut is never a literature number (cosines do not transfer across models): --labels fits it on hand-labelled pairs
 * (same / different / mixed / unknown) by Youden's J and prints the AUROC, and --sample-pairs writes the blind sheet.
 * Seat targets confound spread: since e195b571 (2026-10-10) a flat swarm seat opens on its own item, so rooms are split
 * by target source: item (a flat swarm room with item/* on the board before the reveal), numbered (a flat swarm room after that commit whose
 * brief has a numbered list), none (a swarm room without either) and adhoc (not launched by the swarm script).
 *   npx tsx scripts/opening-spread.ts <room.jsonl | data dir> [...] [--cut 0.8] [--json] [--all-roles] [--min-seats 3]
 *   npx tsx scripts/opening-spread.ts <dirs> --sample-pairs 20 [--seed 7] > sheet.json     (blind: no cosines)
 *   npx tsx scripts/opening-spread.ts <dirs> --labels labelled.json                       (fits the cut, prints AUROC)
 * The pure core is src/measurements/opening-spread.ts (the run report calls it too); this file is the CLI.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { embedTexts } from "../src/measurements/embed.js";
import { cosine, fitCut, type Label, openingsOf, r3, type RoomOpenings, samplePairs, type Spread, spreadOf, summarise } from "../src/measurements/opening-spread.js";

export * from "../src/measurements/opening-spread.js";

function loadRooms(paths: string[], allRoles: boolean, minSeats: number): RoomOpenings[] {
  const files = paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".jsonl")).map((f) => join(p, f)) : [p]));
  return files.flatMap((file) => {
    const events = readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    if (!events.some((e) => e.type === "room") || !events.some((e) => e.type === "openings_revealed")) return [];
    const r = openingsOf(events, basename(file, ".jsonl"), allRoles);
    return r.openings.length >= minSeats ? [r] : [];
  });
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const valued = new Set(["--cut", "--min-seats", "--sample-pairs", "--seed", "--labels", "--model"]);
  const paths = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
  if (!paths.length) { console.error("usage: opening-spread <room.jsonl | data dir> [...] [--cut c] [--json] [--all-roles] [--min-seats 3] [--sample-pairs k --seed s] [--labels file]"); process.exit(2); }
  const model = opt("--model") ?? "embeddinggemma";
  const rooms = loadRooms(paths, args.includes("--all-roles"), Number(opt("--min-seats") ?? 3));
  if (opt("--sample-pairs")) { console.log(JSON.stringify(samplePairs(rooms, Number(opt("--sample-pairs")), Number(opt("--seed") ?? 7)), null, 1)); return; }
  if (opt("--labels")) {
    const labels = JSON.parse(readFileSync(opt("--labels")!, "utf8")) as (Label & { text_a?: string; text_b?: string })[];
    const byRoom = new Map(rooms.map((r) => [r.room, r]));
    const scored = [];
    for (const l of labels) {
      const r = byRoom.get(l.room), a = r?.openings.find((o) => o.pid === l.a), b = r?.openings.find((o) => o.pid === l.b);
      if (!a || !b) { console.error(`no openings for ${l.room} ${l.a} ${l.b}`); continue; }
      const [va, vb] = await embedTexts([a.text, b.text], { model });
      scored.push({ room: l.room, a: l.a, b: l.b, label: l.label, cos: r3(cosine(va!, vb!)) });
    }
    console.log(JSON.stringify({ model, pairs: scored, fit: fitCut(scored) }, null, 1));
    return;
  }
  const cut = opt("--cut") === undefined ? undefined : Number(opt("--cut"));
  const rows: Spread[] = [];
  for (const r of rooms) rows.push(spreadOf(r, await embedTexts(r.openings.map((o) => o.text), { model }), cut));
  const summary = summarise(rows);
  if (args.includes("--json")) { console.log(JSON.stringify({ model, cut: cut ?? null, rooms: rows, summary }, null, 1)); return; }
  console.log(`opening-spread: ${rows.length} rooms with >= ${opt("--min-seats") ?? 3} sealed openings, model ${model}, cut ${cut ?? "none"}`);
  for (const s of summary) console.log(`  ${s.group.padEnd(28)} n=${String(s.n).padStart(3)}  median mean cos ${s.median_mean_cos}  median eff rank/n ${s.median_eff_rank_frac}` + (s.one_framing === null ? "" : `  median framings/n ${s.median_framings_frac}  one framing ${s.one_framing}/${s.n}`) + (s.median_same_minus_cross === null ? "" : `  same-minus-cross-provider cos ${s.median_same_minus_cross}`));
}

if (process.argv[1] && /^opening-spread\.[cm]?[jt]s$/.test(basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
