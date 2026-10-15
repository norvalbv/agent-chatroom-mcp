/**
 * How often the hub said a job had ended while it was still running: a job_end record for a (room, pid) that already
 * had one, with a longer ran_s, means the first was false (the pid was seen running after it). Before src/hub/memory.ts
 * confirmed an end by signal 0, hub 7717 had 7 of 895 job keys so (swarm-092526-89rn: pid 87064 at 369, 556 and 742 s).
 *   node scripts/job-end-repeats.mjs <room.jsonl>...      prints keys, false reports, and the first few
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const byKey = new Map();
for (const file of process.argv.slice(2)) {
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (!line.includes('"type":"job_end"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const key = `${e.room}|${e.pid}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)).push(e.ran_s);
  }
}
let falseReports = 0;
let keys = 0;
const examples = [];
for (const [key, ran] of byKey) {
  const grown = ran.filter((r, i) => i > 0 && r > ran[i - 1]).length;
  if (!grown) continue;
  falseReports += grown;
  keys++;
  if (examples.length < 5) examples.push(`${key} ran_s=${ran.join(',')}`);
}
console.log(JSON.stringify({ job_keys: byKey.size, false_reports: falseReports, keys_with_false_reports: keys }));
for (const ex of examples) console.log(ex);
