/** Ownership oracle, not a task-quality or reply-rate measure.
 * npx tsx scripts/recruit-area-owner-measure.ts <room.jsonl> */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Event = Record<string, any>;
export function measureRecruitClaims(events: Event[]) {
  const board = new Map<string, Event>(), participants = new Map<string, Event>();
  const activated = new Set<string>();
  let reserved = 0, ownerMatches = 0, activations = 0, reviewers = 0, independent = 0, ownerUpdates = 0, expired = 0;
  for (const e of events) {
    if (e.type === "join") participants.set(e.p.name, e.p);
    if (e.type === "board" && e.key?.startsWith("claim/")) {
      if (activated.has(e.key) && e.entry?.by === board.get(e.key)?.by) ownerUpdates++;
      if (e.entry) board.set(e.key, e.entry); else board.delete(e.key);
    }
    if (e.type !== "recruit_claim") continue;
    if (e.phase === "expired") { expired++; activated.delete(e.key); }
    if (e.phase === "reserved") {
      reserved++;
      activated.delete(e.key);
      const entry = board.get(e.key);
      let j: Event = {};
      try { j = JSON.parse(entry?.text ?? "{}"); } catch {}
      if (entry?.by === e.owner && j.owner === e.owner && j.requested_by === e.requested_by &&
          Array.isArray(j.team) && j.team.includes(e.owner) && !j.team.includes(e.requested_by)) ownerMatches++;
    }
    if (e.phase === "activated") {
      activations++;
      activated.add(e.key);
      if (e.reviewer) {
        reviewers++;
        const a = participants.get(e.owner), b = participants.get(e.reviewer);
        if (a && b && a.name !== b.name && a.session && b.session && a.session !== b.session) independent++;
      }
    }
  }
  return { coverage: reserved ? "recorded" : "telemetry_absent", reserved_n: reserved, recruit_owner_matches_n: ownerMatches, activated_n: activations,
    reviewer_assigned_n: reviewers, independent_reviewer_n: independent, owner_updates_after_activation_n: ownerUpdates,
    expired_n: expired, pending_n: [...board.values()].filter((e) => e.recruitment?.pending).length,
    confound: "Ownership and connection-independent reviewer oracle only; no downstream task-quality effect measured. No reviewer is valid when no independent voter is present." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: recruit-area-owner-measure <room.jsonl>");
  const events = readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  console.log(JSON.stringify(measureRecruitClaims(events), null, 2));
}
