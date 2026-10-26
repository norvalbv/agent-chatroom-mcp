/**
 * What a room's verifier did, read from its log: the conduct prompts/verifier.md asks for (owner ask 5,
 * evidence/seat-verifier-guidance E), so a replay can compare rooms by result.json `prompts` digest. Per room:
 *   its disagrees, and re-casts (a disagree on a proposal it had already disagreed with); its chat messages, their median
 *   words and how many ran over 100; the ones sent while its own disagree stood on the proposal's current text (an amend
 *   that does not carry the disagree ends it); hold/* writes; the review/ and verify/ entries it wrote; its Bash commands.
 * Before 6e6c5e67, over 149 rooms with a verifier: 74 had a verifier review/verify, 13 of 26 with a disagree had a re-cast
 * (21 in all), 11 had chat while it stood (39 messages, 9f66's "Verifier, still holding (this isn't silence)" among
 * them), 0 hold/* writes. Re-casts also fell with dd4195b8's disagree carry, so they credit the hub, not the prompt.
 *   npx tsx scripts/verifier-conduct.ts <data/room.jsonl>... [--json]
 * Reads each file as a stream; a room with no verifier has no row.
 */
import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";

export interface ConductRow {
  room: string; verifier: string; disagrees: number; recast: number; chat: number; chat_median_words: number | null;
  chat_over_100: number; chat_while_disagreeing: { seq: number; words: number; text: string }[]; hold_writes: number;
  reviews: string[]; bash: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function conductRow(file: string): Promise<ConductRow | null> {
  let vid: string | undefined, vname = "";
  const latest = new Map<string, string | undefined>(); // proposal -> the verifier's vote standing on its current text
  const disagreed = new Set<string>();
  const words: number[] = [], reviews = new Set<string>();
  const row = { disagrees: 0, recast: 0, hold_writes: 0, bash: 0, chat_while_disagreeing: [] as ConductRow["chat_while_disagreeing"] };
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!/"type":\s*"(join|vote|amend|message|board|work)"/.test(line)) continue;
    let e: Record<string, any>;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "join" && e.p?.role === "verifier") { vid = e.p.id; vname = e.p.name; }
    else if (!vid) continue;
    else if (e.type === "vote" && e.pid === vid) {
      const v = e.entry?.vote;
      latest.set(e.proposalId, v);
      if (v === "disagree") { row.disagrees++; if (disagreed.has(e.proposalId)) row.recast++; disagreed.add(e.proposalId); }
    } else if (e.type === "amend") latest.set(e.proposalId, e.votes?.[vid]?.vote);
    else if (e.type === "message" && e.msg?.kind === "chat" && e.msg.from?.id === vid) {
      const text = String(e.msg.content ?? ""), n = text.split(/\s+/).filter(Boolean).length;
      words.push(n);
      if ([...latest.values()].includes("disagree")) row.chat_while_disagreeing.push({ seq: e.msg.seq, words: n, text: text.slice(0, 90) });
    } else if (e.type === "board" && typeof e.key === "string") {
      if (e.key.startsWith("hold/") && e.entry?.text?.trim()) row.hold_writes++;
      if (e.entry?.by === vname && /^(review|verify)\//.test(e.key)) reviews.add(e.key);
    } else if (e.type === "work" && e.pid === vid && e.tool === "Bash") row.bash++;
  }
  if (!vid) return null;
  return {
    room: file.split("/").pop()!.replace(/\.jsonl$/, ""), verifier: vname, disagrees: row.disagrees, recast: row.recast,
    chat: words.length, chat_median_words: median(words), chat_over_100: words.filter((n) => n > 100).length,
    chat_while_disagreeing: row.chat_while_disagreeing, hold_writes: row.hold_writes, reviews: [...reviews].sort(), bash: row.bash,
  };
}

const isMain = process.argv[1] && /verifier-conduct\.ts$/.test(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  const files = argv.filter((a) => !a.startsWith("--"));
  const bad = files.filter((f) => !statSync(f, { throwIfNoEntry: false })?.isFile());
  if (!files.length || bad.length || argv.includes("--help")) {
    console.error(bad.length ? `verifier-conduct: not a room log file: ${bad.join(", ")}` : "usage: verifier-conduct <room.jsonl>... [--json]");
    process.exit(argv.includes("--help") ? 0 : 2);
  }
  const rows: ConductRow[] = [];
  for (const f of files) { const r = await conductRow(f); if (r) rows.push(r); }
  if (argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log("| room | disagrees | re-cast | chat (median words, >100) | chat while its disagree stood | hold/* writes | its review/verify | Bash |\n|---|---|---|---|---|---|---|---|");
    for (const r of rows) console.log(`| ${r.room} | ${r.disagrees} | ${r.recast} | ${r.chat} (${r.chat_median_words ?? "-"}, ${r.chat_over_100}) | ${r.chat_while_disagreeing.map((m) => `#${m.seq}`).join(" ") || 0} | ${r.hold_writes} | ${r.reviews.length} | ${r.bash} |`);
    const withDis = rows.filter((r) => r.disagrees);
    console.log(`\n${rows.length} rooms with a verifier: ${rows.filter((r) => r.reviews.length).length} with its review/verify; ${withDis.length} with its disagree, ${withDis.filter((r) => r.recast).length} re-cast; ${rows.filter((r) => r.chat_while_disagreeing.length).length} chatted while it stood; ${rows.reduce((n, r) => n + r.hold_writes, 0)} hold/* writes.`);
  }
}
