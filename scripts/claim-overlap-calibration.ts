/**
 * Reproduces the claim-overlap counts cited for the RE-TARGET of self-organising-teams-by-claims-and-recruitment:
 * replays every claim/* creation in the persisted room logs (data/*.jsonl, gitignored, so pass the main checkout's
 * data dir from a worktree) and scores each pair of first-written claims by different seats in the same room with
 * Hub.claimOverlapScore, the rule the hub itself fires on.
 * Run: npx tsx scripts/claim-overlap-calibration.ts [dataDir] [--list]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "data";
const list = process.argv.includes("--list");
let pairs = 0, byJaccard = 0, bySlug = 0, roomsWithClaims = 0;
const firedRooms = new Set<string>();
const fired: string[] = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) {
  const claims = new Map<string, { by: string; t: Set<string>; k: Set<string> }>();
  for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
    if (!line.includes('"claim/')) continue;
    let e: { type?: string; room?: string; key?: string; entry?: { text: string; by: string } | null };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "board" || !e.key?.startsWith("claim/") || !e.entry || e.entry.by === "system" || claims.has(e.key)) continue;
    const t = Hub.claimTerms(e.key, e.entry.text), k = Hub.claimTerms(e.key, "");
    for (const [ok, o] of claims) {
      if (o.by === e.entry.by) continue;
      pairs++;
      const s = Hub.claimOverlapScore(t, k, o.t, o.k);
      if (!s.fires) continue;
      if (s.jac >= 0.4) byJaccard++; else bySlug++;
      firedRooms.add(`${f}:${e.room}`);
      if (list) fired.push(`${s.jac.toFixed(2)} ${s.jac >= 0.4 ? "jac " : "slug"} ${e.room} ${ok} | ${e.key}`);
    }
    claims.set(e.key, { by: e.entry.by, t, k });
  }
  if (claims.size) roomsWithClaims++;
}
if (list) console.log(fired.join("\n"));
console.log(JSON.stringify({ dir, logs_with_claims: roomsWithClaims, cross_seat_pairs: pairs, fired_jaccard_rule: byJaccard, fired_slug_rule: bySlug, logs_with_a_firing: firedRooms.size }));
