/** Which agent chat messages in room logs blockerTerm would flag (src/hub/needs/needs.ts): the measurement behind the
 * blocker hint's precision. npx tsx scripts/blocker-scan.ts <room.jsonl>... */
import { readFileSync } from "node:fs";
import { blockerTerm } from "../src/hub/needs/needs.js";

for (const path of process.argv.slice(2)) {
  let chat = 0;
  const hits: string[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    let e: { type?: string; msg?: { seq: number; ts: string; kind: string; content: string; from: { name: string; agent?: string } } };
    try { e = JSON.parse(line); } catch { continue; }
    const m = e.msg;
    if (e.type !== "message" || !m || m.kind !== "chat" || m.from.name === "system" || m.from.agent === "human") continue;
    chat++;
    const term = blockerTerm(m.content);
    if (term) hits.push(`  #${m.seq} ${m.ts.slice(11, 19)} ${m.from.name} [${term}] ${m.content.replace(/\s+/g, " ").slice(0, 150)}`);
  }
  console.log(`${path.split("/").pop()}: ${chat} agent chat, ${hits.length} flagged`);
  for (const h of hits) console.log(h);
}
