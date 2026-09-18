// Independent second implementation: compile to closures, then run.
import { readFileSync } from 'node:fs';
export function runEager(src) {
  const out = [], funcs = new Map(), glob = new Map(), cnt = Array(10).fill(0);
  let depth = 0;
  const tokens = (s) => s.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/);
  function parseForm(t, pos) {
    const x = t[pos.i];
    if (x !== '(') { pos.i++; if (/^-?\d+$/.test(x)) return { k: 'int', v: BigInt(x) }; return { k: 'name', n: x }; }
    pos.i++; const op = t[pos.i++]; const args = [];
    while (t[pos.i] !== ')') args.push(parseForm(t, pos));
    pos.i++; return { k: 'form', op, args };
  }
  const b = (x) => (x ? 1n : 0n);
  function ev(e, env) {
    if (e.k === 'int') return e.v;
    if (e.k === 'name') return env.has(e.n) ? env.get(e.n) : glob.get(e.n);
    const vs = []; for (const a of e.args) vs.push(ev(a, env));
    switch (e.op) {
      case '+': return vs[0] + vs[1]; case '-': return vs[0] - vs[1]; case '*': return vs[0] * vs[1];
      case '<': return b(vs[0] < vs[1]); case '=': return b(vs[0] === vs[1]);
      case 'and': return b(vs[0] !== 0n && vs[1] !== 0n); case 'or': return b(vs[0] !== 0n || vs[1] !== 0n);
      case 'not': return b(vs[0] === 0n); case 'if': return vs[0] !== 0n ? vs[1] : vs[2]; case 'seq': return vs[1];
      case 'out': out.push(vs[0]); return vs[0];
      case 'bump': { const k = Number(vs[0]); cnt[k]++; return BigInt(cnt[k]); }
      case 'peek': return BigInt(cnt[Number(vs[0])]);
    }
    const f = funcs.get(e.op);
    if (depth >= 5) return 0n;
    const local = new Map(f.ps.map((p, i) => [p, vs[i]]));
    depth++; const r = ev(f.body, local); depth--; return r;
  }
  for (const raw of src.split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const sp = line.indexOf(' '); const head = line.slice(0, sp); const rest = line.slice(sp + 1);
    if (head === 'SHOW') out.push(ev(parseForm(tokens(rest), { i: 0 }), new Map()));
    else if (head === 'LET') { const q = rest.indexOf('='); glob.set(rest.slice(0, q).trim(), ev(parseForm(tokens(rest.slice(q + 1)), { i: 0 }), new Map())); }
    else { const q = rest.indexOf('='); const l = rest.slice(0, q).trim().split(/\s+/); funcs.set(l[0], { ps: l.slice(1), body: parseForm(tokens(rest.slice(q + 1)), { i: 0 }) }); }
  }
  return out.map(String);
}
if (process.argv[2]) console.log(runEager(readFileSync(process.argv[2], 'utf8')).join(' '));
