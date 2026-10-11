/**
 * A departed owner's claim is "finished", and so not offered as a takeover, when its owner posted a result naming it
 * (src/hub/open-work.ts). The claim was looked for in the result's text as a substring, so a result that named
 * claim/abc also finished claim/ab: the shorter claim's unfinished work was never offered to anyone (merge-review
 * backlog B9b, docs/self-improvement-swarm-003601-tky5.md). The key must be named whole.
 * Run: npx tsx scripts/finished-claim-key-regression.ts
 */
import assert from "node:assert/strict";
import { Hub } from "../src/hub.js";
import { openWork } from "../src/hub/open-work.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

Hub.STALE_CLAIM_MS = 0; // a departed owner's claim is open to anyone at once
let serial = 0;
/** alice claims each area, posts the results given, and leaves; what bob is then offered as a takeover. */
function offered(claims: string[], results: Record<string, string>, extra: Record<string, string> = {}): string[] {
  const h = new Hub();
  const name = `finished-${++serial}`;
  const [a, b] = ["alice", "bob"].map((n) => h.join(name, n, "test", {}, undefined, `sess-${n}`).participant);
  for (const area of claims) h.setBoard(name, a.id, `claim/${area}`, JSON.stringify({ area, owner: "alice", status: "open" }));
  for (const [key, text] of Object.entries({ ...results, ...extra })) h.setBoard(name, a.id, key, text);
  h.leave(name, a.id, "done here, nothing left undone");
  return openWork(h, h.getRoom(name), b).filter((w) => w.kind === "claim_orphaned").map((w) => w.key).sort();
}

test("a result that names claim/abc does not finish claim/ab", () => {
  assert.deepEqual(offered(["ab", "abc"], { "result/packing": "RESULT for claim/abc: packing built at 5678def." }), ["claim/ab"]);
});

test("nor does one that names a claim under it, or with a longer last word", () => {
  assert.deepEqual(offered(["ab"], { "result/one": "Built claim/ab/part-2 only." }), ["claim/ab"]);
  assert.deepEqual(offered(["ab"], { "result/one": "Built claim/ab-extra and claim/ab.v2 and claim/ab:b only." }), ["claim/ab"]);
  assert.deepEqual(offered(["ab"], { "result/one": "See reclaim/ab for the rest." }), ["claim/ab"]);
});

test("a result that names the claim whole still finishes it, wherever it stands in the sentence", () => {
  for (const text of ["claim/ab", "RESULT for claim/ab: built.", "Done (claim/ab).", "Built claim/ab.", "claim/ab, claim/abc: both built", 'finished "claim/ab"', "built:\nclaim/ab\n"]) {
    assert.deepEqual(offered(["ab"], { "result/one": text }), [], text);
  }
});

test("result/<area> and result/<area>-<part> still finish it by their key, and a handoff still says something is left", () => {
  assert.deepEqual(offered(["ab"], { "result/ab": "built" }), []);
  assert.deepEqual(offered(["ab"], { "result/ab-tests": "built" }), []);
  assert.deepEqual(offered(["ab"], { "result/ab": "built" }, { "handoff/ab": "the migration is left" }), ["claim/ab"]);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nFINISHED CLAIM KEY OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
