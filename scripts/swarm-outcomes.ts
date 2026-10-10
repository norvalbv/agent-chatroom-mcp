/**
 * Measure past runs from their artifacts: how each ended, who left output, how long before the first proposal.
 * npx tsx scripts/swarm-outcomes.ts [swarms dir] [--rows]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyOutcome, seatScorecard, type RunResult } from '../src/result.js';

const args = process.argv.slice(2);
const dir = resolve(args.find(a => !a.startsWith('--')) ?? 'swarms');
const minutes = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 60_000;
const quartiles = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return [0.25, 0.5, 0.75].map(q => s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1) : '-').join(' / '); };

const kinds = new Map<string, number>();
const endings = new Map<string, number>();
const runMin: number[] = [];
const firstProposalMin: number[] = [];
let runs = 0, unreadable = 0, seats = 0, idle = 0, withRecruit = 0, recruits = 0;
for (const id of readdirSync(dir).sort()) {
  const file = resolve(dir, id, 'result.json');
  if (!existsSync(file)) continue;
  let r: RunResult;
  try { r = JSON.parse(readFileSync(file, 'utf8')) as RunResult; } catch { unreadable++; continue; }
  const lead = r.rooms?.find(room => room.name === r.leadRoom);
  if (!lead) { unreadable++; continue; }
  runs++;
  // the launcher's timeout is not in older artifacts, so the cause is read from the room alone
  const outcome = r.outcome ?? classifyOutcome(lead.payload);
  kinds.set(outcome.kind, (kinds.get(outcome.kind) ?? 0) + 1);
  const total = minutes(r.run.startedAt, r.run.completedAt);
  runMin.push(total);
  const first = lead.payload?.proposals?.[0]?.created_at;
  if (first && lead.payload?.created_at) firstProposalMin.push(minutes(lead.payload.created_at, first));
  const card = (r.scorecard ?? seatScorecard([lead])).filter(s => s.role !== 'verifier');
  const n = card.filter(s => s.role === 'recruit').length;
  if (n) { withRecruit++; recruits += n; }
  for (const s of card) { seats++; if (!s.produced) idle++; endings.set(s.ending, (endings.get(s.ending) ?? 0) + 1); }
  if (args.includes('--rows')) console.log(`${id}\t${total.toFixed(1)} min\t${outcome.kind}\tseats ${card.length}\tno output ${card.filter(s => !s.produced).length}\trecruits ${n}`);
}
const show = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`runs ${runs} (unreadable ${unreadable})`);
console.log(`outcome: ${show(kinds)}`);
console.log(`run minutes (quartiles): ${quartiles(runMin)}; under 10 min: ${runMin.filter(m => m < 10).length}`);
console.log(`minutes to first proposal (${firstProposalMin.length} runs, quartiles): ${quartiles(firstProposalMin)}; under 5 min: ${firstProposalMin.filter(m => m < 5).length}`);
console.log(`worker seats ${seats}; left no output ${idle} (${(100 * idle / Math.max(1, seats)).toFixed(0)}%)`);
console.log(`how seats ended: ${show(endings)}`);
console.log(`runs with a recruit ${withRecruit}; recruits ${recruits}`);
