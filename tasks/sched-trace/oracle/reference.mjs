// Hidden reference simulator used only to derive oracle.json's expected value.
import { readFileSync } from 'node:fs';
const jobs = readFileSync(process.argv[2], 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
  const [id, arrival, burst, prio, flag] = l.split(/\s+/);
  return { id, arrival: +arrival, remaining: +burst, prio: +prio, blocks: flag === 'B', wait: 0, sinceBlock: 0, run: 0, switching: false };
});
const verbose = process.argv[3] === '-v';
let R = [], J = null, last = null; const sleeping = []; const done = new Map();
for (let t = 0; done.size < jobs.length; t++) {
  const joined = new Set();
  for (const s of sleeping.filter(s => s.wake === t)) { s.job.wait = 0; s.job.prio = Math.max(0, s.job.prio - 1); R.push(s.job); joined.add(s.job); }
  for (let i = sleeping.length - 1; i >= 0; i--) if (sleeping[i].wake === t) sleeping.splice(i, 1);
  for (const j of jobs) if (j.arrival === t) { j.wait = 0; R.push(j); joined.add(j); }
  for (const j of R) if (!joined.has(j)) { j.wait++; if (j.wait === (j.blocks ? 4 : 5)) { j.prio = Math.max(0, j.prio - 1); j.wait = 0; } }
  if (J && !J.switching && R.some(k => k.prio < J.prio || (J.run >= 3 && k.prio <= J.prio))) { J.wait = 0; R.push(J); J = null; }
  if (!J && R.length) {
    R.sort((a, b) => a.prio - b.prio || a.arrival - b.arrival || (a.id < b.id ? -1 : 1));
    J = R.shift(); J.wait = 0; J.run = 0;
    J.switching = last !== null && last !== J;
  }
  let what = 'idle';
  if (J) {
    if (J.switching) { J.switching = false; what = `switch->${J.id}`; }
    else {
      J.remaining--; J.sinceBlock++; J.run++; last = J; what = J.id;
      if (J.remaining === 0) { done.set(J.id, t + 1); J = null; }
      else if (J.blocks && J.sinceBlock === 2) { J.sinceBlock = 0; sleeping.push({ wake: t + 4, job: J }); J = null; }
    }
  }
  if (verbose) console.log(t, what.padEnd(10), 'R=[' + R.map(j => `${j.id}:p${j.prio}`).join(' ') + ']');
  if (t > 500) throw new Error('runaway');
}
console.log(jobs.map(j => `${j.id}:${done.get(j.id)}`).join(' '));
