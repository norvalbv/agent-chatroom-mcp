/**
 * A group cannot be called "leads" (merge-review backlog B9c, from docs/self-improvement-swarm-003601-tky5.md). A
 * group's id names its room, <swarm>-<id>, and a grouped run's consolidation room is <swarm>-leads: a --groups file
 * with a group "leads" passed the id check, so that group's seats, the verifier and the consolidator would all have
 * been sent to one room, with the group's brief on top of the leads room's settings. The file is refused at load,
 * before anything is launched, and the refusal says why.
 * Run: npx tsx scripts/groups-reserved-id-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGroups } from "../src/groups.js";

const cases: [string, () => void][] = [];
const test = (name: string, run: () => void) => cases.push([name, run]);

const dir = mkdtempSync(join(tmpdir(), "groups-reserved-"));
let serial = 0;
function file(ids: string[]) {
  const path = join(dir, `groups-${++serial}.json`);
  writeFileSync(path, JSON.stringify({ groups: ids.map((id) => ({ id, workers: 2, brief: `the brief of ${id}` })) }));
  return path;
}
const refused = (ids: string[], re: RegExp) => assert.throws(() => loadGroups(file(ids)), (e: Error) => re.test(e.message) || assert.fail(`unexpected message: ${e.message}`));

test('a group called "leads" is refused, and the reason names the room it would take', () => {
  refused(["build", "leads"], /id "leads" is reserved.*-leads/);
});

test("it is refused wherever it sits in the file, and alone", () => {
  refused(["leads", "build"], /id "leads" is reserved/);
  refused(["leads"], /id "leads" is reserved/);
});

test("ids that only contain the word still name rooms of their own", () => {
  const g = loadGroups(file(["leads-2", "team-leads", "lead"]));
  assert.deepEqual(g.groups.map((x) => x.id), ["leads-2", "team-leads", "lead"]);
});

test("the checks that were there still refuse what they refused", () => {
  refused(["Build"], /needs an id of lower-case letters/);
  refused(["a", "a"], /id "a" is used twice/);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nGROUPS RESERVED ID OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
