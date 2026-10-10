/**
 * Unsourced claims join the one hold (swarm-000525-jcz8, idea/sourcer-seat as revised after attacks by -4, -6 and -2).
 * At the first proposal of 154 past rooms, 278 of 372 claim owners with findings (74%) had put no outside source
 * anywhere (URL to a non-local host, arXiv id, DOI), and only 10 of them added one later in the room
 * (scripts/unsourced-claims-measure.py). In this room, asking each owner for a source made 6 of 7 source their own
 * item within ~20 min. So the first propose's single refusal also names claims whose owner has findings, made no web
 * call (work ledger) and cites no outside source, and asks them for one. Still one refusal per room in total; seats
 * that do not report local work are unknown and never named; the second propose goes through.
 * Run: npx tsx scripts/unsourced-claims-regression.ts
 */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";

let n = 0;
function room(seats: string[]) {
  const hub = new Hub({});
  const name = `unsourced-${++n}`;
  const ps = seats.map((s, i) => {
    const { participant } = hub.join(name, s, "claude", i === 0 ? { nudgeAfterMs: 0 } : {}, undefined, `s${i}`);
    participant.seatKeyHash = `hash-${n}-${i}`; // a launched claude seat: its tool hook reports local work
    return participant;
  });
  return { hub, name, ps, said: () => hub.getRoom(name).messages.filter((m) => m.kind === "system").map((m) => m.content).join("\n") };
}
const tryPropose = (hub: Hub, r: string, pid: string) => {
  try {
    hub.propose(r, pid, "Conclusion: adopt it.");
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

// 1. An owner with findings, no web call and no outside source is named and asked; the proposer's own area counts too.
{
  const { hub, name, ps: [a, b], said } = room(["A", "B"]);
  hub.setBoard(name, b.id, "claim/x", '{"area":"x"}');
  hub.setBoard(name, b.id, "findings/x", "read src/hub.ts; the refusal order looks fine to me after an hour of reading");
  hub.setBoard(name, a.id, "claim/y", '{"area":"y"}');
  hub.setBoard(name, a.id, "findings/y", "measured 154 rooms with a local script, 24% fire");
  hub.heartbeat(name, b.id, { tool: "Read", detail: "src/hub.ts" });
  const err = tryPropose(hub, name, a.id);
  assert.match(err, /CLAIMS WITHOUT SOURCES: claim\/x \(B\), claim\/y \(A\)|CLAIMS WITHOUT SOURCES: claim\/y \(A\), claim\/x \(B\)/);
  assert.match(err, /once per room/);
  assert.match(said(), /@B/);
  assert.match(said(), /sources\/<id>/);
  assert.match(said(), /agrees with, contradicts or duplicates/);
  assert.equal(tryPropose(hub, name, a.id), "", "the second propose goes through");
}

// 2. What counts as sourced: a web call, an outside URL / arXiv id / DOI in any entry or chat line, a sources/* entry.
for (const [why, act] of [
  ["a web call", (hub: Hub, r: string, pid: string) => hub.heartbeat(r, pid, { tool: "WebFetch", detail: "https://arxiv.org/abs/2510.06135" })],
  ["an outside URL in a finding", (hub: Hub, r: string, pid: string) => hub.setBoard(r, pid, "evidence/z", "per https://docs.example.org/x the limit is 4")],
  ["an arXiv id in chat", (hub: Hub, r: string, pid: string) => hub.send(r, pid, "this matches arXiv:2606.03032")],
  ["a DOI", (hub: Hub, r: string, pid: string) => hub.setBoard(r, pid, "evidence/z", "see 10.1145/2363.2433")],
  ["a sources/* entry", (hub: Hub, r: string, pid: string) => hub.setBoard(r, pid, "sources/thing", "a paper says so")],
] as const) {
  const { hub, name, ps: [a, b] } = room(["A", "B"]);
  hub.setBoard(name, b.id, "claim/x", '{"area":"x"}');
  hub.setBoard(name, b.id, "findings/x", "read the code for an hour, all fine");
  act(hub, name, b.id);
  assert.doesNotMatch(tryPropose(hub, name, a.id), /CLAIMS WITHOUT SOURCES/, `sourced by ${why}`);
}
// a loopback URL is not an outside source
{
  const { hub, name, ps: [a, b] } = room(["A", "B"]);
  hub.setBoard(name, b.id, "claim/x", '{"area":"x"}');
  hub.setBoard(name, b.id, "findings/x", "curl http://127.0.0.1:7717/rooms shows 12 rooms");
  assert.match(tryPropose(hub, name, a.id), /CLAIMS WITHOUT SOURCES: claim\/x \(B\)/, "loopback is not outside");
}

// 3. Unknown is never named: a seat with no heartbeat key reports no local work.
{
  const hub = new Hub({});
  const { participant: a } = hub.join("plain", "A", "claude", { nudgeAfterMs: 0 }, undefined, "p1");
  const { participant: b } = hub.join("plain", "B", "claude", {}, undefined, "p2");
  hub.setBoard("plain", b.id, "claim/x", '{"area":"x"}');
  hub.setBoard("plain", b.id, "findings/x", "read the code, all fine");
  assert.equal(tryPropose(hub, "plain", a.id), "", "no key, no claim about its sources");
}

// 4. Still one hold in total: a bare claim and an unsourced one are named in the same single refusal.
{
  const { hub, name, ps: [a, b, c] } = room(["A", "B", "C"]);
  hub.setBoard(name, b.id, "claim/bare", '{"area":"bare"}');
  hub.setBoard(name, c.id, "claim/x", '{"area":"x"}');
  hub.setBoard(name, c.id, "findings/x", "short local note");
  const err = tryPropose(hub, name, a.id);
  assert.match(err, /CLAIMS WITHOUT FINDINGS: claim\/bare \(B\)/);
  assert.match(err, /CLAIMS WITHOUT SOURCES: claim\/x \(C\)/);
  assert.doesNotMatch(err, /claim\/bare \(B\)[^]*CLAIMS WITHOUT SOURCES[^]*claim\/bare/, "a bare claim is not also called unsourced");
  assert.equal(tryPropose(hub, name, a.id), "", "held once in total");
}

console.log("UNSOURCED CLAIMS OK");
