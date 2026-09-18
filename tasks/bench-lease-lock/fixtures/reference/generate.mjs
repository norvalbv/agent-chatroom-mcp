// Deterministic generator: node generate.mjs <seed> prints events.log text. Search picks a seed where every wrong reading disagrees with the spec.
import { simulate, parseLog } from './lease.mjs';
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function gen(seed, n = 104) {
  const r = rng(seed); const pick = a => a[Math.floor(r() * a.length)];
  const clients = ['C1','C2','C3','C4','C5','C6','C7','C8']; const res = ['R1','R2','R3','R4','R5'];
  const holders = {}; let tick = 0; const lines = [];
  for (let i = 0; i < n; i++) {
    tick += Math.floor(r() * 4);
    const x = r();
    let c, a, rs, lease;
    const held = Object.entries(holders).filter(([, v]) => v);
    if (x < 0.30 && held.length) { const [k, v] = pick(held); c = v; rs = k; a = 'LOCK'; lease = 2 + Math.floor(r() * 9); }
    else if (x < 0.55) { c = pick(clients); rs = pick(res); a = 'LOCK'; lease = 2 + Math.floor(r() * 9); }
    else if (x < 0.72 && held.length) { const [k, v] = pick(held); c = v; rs = k; a = 'UNLOCK'; }
    else if (x < 0.87 && held.length) { const [k, v] = pick(held); c = v; rs = k; a = 'RENEW'; lease = 2 + Math.floor(r() * 9); }
    else { c = pick(clients); rs = pick(res); a = r() < 0.5 ? 'UNLOCK' : 'RENEW'; lease = a === 'RENEW' ? 2 + Math.floor(r() * 9) : undefined; }
    lines.push(`${tick} ${c} ${a} ${rs}${lease !== undefined ? ' ' + lease : ''}`);
    // track approximate holders using the spec simulator on the prefix (exact, so "held" is meaningful)
    const out = simulate(parseLog(lines.join('\n')));
    for (const part of out.split(' ')) { const [k, v] = part.split(':'); holders[k] = v.startsWith('free') ? null : v.split('@')[0]; }
  }
  return lines.join('\n') + '\n';
}
if (process.argv[1]?.endsWith('generate.mjs') && process.argv[2] === 'search') {
  for (let seed = 1; seed < 400; seed++) {
    const text = gen(seed); const ev = parseLog(text);
    const spec = simulate(ev);
    const diffs = ['relock-refreshes', 'requeue-updates', 'eager'].map(v => simulate(ev, v) !== spec);
    const nfree = spec.split(' ').filter(p => p.includes(':free')).length;
    const relockN = ev.filter(e => e.action === 'LOCK').length;
    if (diffs.every(Boolean) && nfree <= 1) console.log(seed, spec, relockN);
  }
}
