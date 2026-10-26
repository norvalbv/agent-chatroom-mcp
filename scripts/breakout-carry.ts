/**
 * Did a breakout's verification reach its parent? Read from room logs (decision/breakout-verification, chair note 4).
 * For each note the hub carried to a parent (board key inbox/<breakout>/conclusion, by system), it prints what the
 * breakout's own conclusion recorded as verified (from the breakout's log, when given) and what the parent's note
 * said: "verified", "partial", "not required", or "nothing". "lost" is a verified breakout whose note said nothing
 * about it, which is every verified breakout before the carry (9f66: five of five).
 *   npx tsx scripts/breakout-carry.ts <data/*.jsonl>... [--json]
 * Pass the parent's and the breakouts' logs together. Reads each file as a stream.
 */
import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";

export interface CarryRow { parent: string; breakout: string; breakout_verified: string; note_says: "verified" | "partial" | "not required" | "nothing"; lost: boolean }
type Verification = { by?: string; kind?: string; base_commit?: string; commit?: string };

export async function carryRows(files: string[]): Promise<CarryRow[]> {
  const verified = new Map<string, Verification | null>();
  const notes = new Map<string, { parent: string; breakout: string; text: string }>();
  for (const file of files) {
    const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"type":"state"') && !line.includes("/conclusion")) continue;
      let e: Record<string, any>;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "state" && e.state === "concluded" && e.conclusion) verified.set(e.room, e.conclusion.verification ?? null);
      const m = e.type === "board" && e.entry?.by === "system" && typeof e.key === "string" ? /^inbox\/(.+)\/conclusion$/.exec(e.key) : null;
      if (m && e.entry.text) notes.set(`${e.room}\0${m[1]}`, { parent: e.room, breakout: m[1], text: e.entry.text });
    }
  }
  return [...notes.values()].map(({ parent, breakout, text }) => {
    const v = verified.get(breakout);
    // read the hub's head only (line 1 the pointer, line 2 the verification, line 3 a partial), never the breakout's text
    const [first = "", second = "", third = ""] = text.split("\n");
    const head = first.startsWith(`Breakout ${breakout} concluded on `);
    const note_says = !head ? "nothing" : second.startsWith("Verified by ") ? (third.startsWith("Verified PARTIAL") ? "partial" : "verified") : second.startsWith("Not verified by the hub") ? "not required" : "nothing";
    const breakout_verified = v === undefined ? "unknown (no breakout log)" : v === null ? "none" : `${v.by}, ${v.kind ?? "no kind"}, ${v.base_commit}->${v.commit}`;
    return { parent, breakout, breakout_verified, note_says, lost: !!v && note_says === "nothing" };
  });
}

const isMain = process.argv[1] && /breakout-carry\.ts$/.test(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  const files = argv.filter((a) => !a.startsWith("--"));
  const bad = files.filter((f) => !statSync(f, { throwIfNoEntry: false })?.isFile());
  if (!files.length || bad.length || argv.includes("--help")) {
    console.error(bad.length ? `breakout-carry: not a room log file: ${bad.join(", ")}` : "usage: breakout-carry <room.jsonl>... [--json]");
    process.exit(argv.includes("--help") ? 0 : 2);
  }
  const rows = await carryRows(files);
  if (argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log("| parent | breakout | verified in the breakout | parent's note says | lost |\n|---|---|---|---|---|");
    for (const r of rows) console.log(`| ${r.parent} | ${r.breakout} | ${r.breakout_verified} | ${r.note_says} | ${r.lost ? "yes" : ""} |`);
    const known = rows.filter((r) => !r.breakout_verified.startsWith("unknown"));
    console.log(`\n${rows.length} carried notes; ${known.length} with the breakout's log; ${known.filter((r) => r.breakout_verified !== "none").length} breakouts verified; ${rows.filter((r) => r.lost).length} lost their verification on the way to the parent.`);
  }
}
