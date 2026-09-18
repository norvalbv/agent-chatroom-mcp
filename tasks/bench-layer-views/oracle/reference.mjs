// Reference resolver for LAYERS v1. usage: node reference.mjs program.layers [--sequential]
// --sequential is the imperative distractor (each SET is evaluated at its own line, refs read the value so far).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ARITY = { '+': 2, '-': 2, '*': 2, '/': 2, '%': 2, '<': 2, '=': 2, MIN: 2, MAX: 2, AND: 2, OR: 2, NOT: 1, ABS: 1, IF: 3 };

function takeExpr(t, pos) {
  const tok = t[pos.i++];
  if (tok === undefined) throw new Error('expression ran out of tokens');
  if (tok[0] === '$') return { ref: tok.slice(1) };
  if (/^-?\d+$/.test(tok)) return { num: BigInt(tok) };
  if (!(tok in ARITY)) throw new Error('unknown token ' + tok);
  const args = [];
  for (let k = 0; k < ARITY[tok]; k++) args.push(takeExpr(t, pos));
  return { op: tok, args };
}

export function parseProgram(text) {
  const layers = new Map(); const rules = []; const shows = [];
  let cur = null; let n = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const t = line.split(' ');
    if (t[0] === 'LAYER') {
      if (!layers.has(t[1])) layers.set(t[1], { rank: Number(t[2]), order: layers.size });
      cur = t[1];
    } else if (t[0] === 'SHOW') shows.push(...t.slice(1));
    else if (t[0] === 'SEAL') rules.push({ kind: 'SEAL', key: t[1], layer: cur, n: n++ });
    else if (t[0] === 'UNSET' || t[0] === 'SET') {
      const pos = { i: 2 };
      const r = { kind: t[0], key: t[1], layer: cur, n: n++, expr: null, guard: null };
      if (t[0] === 'SET') r.expr = takeExpr(t, pos);
      if (t[pos.i] === 'WHEN') { pos.i++; r.guard = takeExpr(t, pos); }
      if (pos.i !== t.length) throw new Error('trailing tokens: ' + line);
      rules.push(r);
    } else throw new Error('bad line: ' + line);
  }
  return { layers, rules, shows };
}

const fdiv = (a, b) => { if (b === 0n) return 0n; let q = a / b; if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q -= 1n; return q; };
function apply(op, a) {
  switch (op) {
    case '+': return a[0] + a[1];
    case '-': return a[0] - a[1];
    case '*': return a[0] * a[1];
    case '/': return fdiv(a[0], a[1]);
    case '%': return a[1] === 0n ? 0n : a[0] - fdiv(a[0], a[1]) * a[1];
    case '<': return a[0] < a[1] ? 1n : 0n;
    case '=': return a[0] === a[1] ? 1n : 0n;
    case 'MIN': return a[0] < a[1] ? a[0] : a[1];
    case 'MAX': return a[0] > a[1] ? a[0] : a[1];
    case 'AND': return a[0] !== 0n && a[1] !== 0n ? 1n : 0n;
    case 'OR': return a[0] !== 0n || a[1] !== 0n ? 1n : 0n;
    case 'NOT': return a[0] === 0n ? 1n : 0n;
    case 'ABS': return a[0] < 0n ? -a[0] : a[0];
    case 'IF': return a[0] !== 0n ? a[1] : a[2];
  }
  throw new Error('op ' + op);
}
function evalExpr(e, read) {
  if (e.num !== undefined) return e.num;
  if (e.ref !== undefined) return read(e.ref);
  return apply(e.op, e.args.map((x) => evalExpr(x, read)));
}

export function resolve(program, { sequential = false, variant = '' } = {}) {
  const { layers, rules } = program;
  const strength = (l) => [layers.get(l).rank, layers.get(l).order];
  const stronger = (a, b) => { const x = strength(a), y = strength(b); return x[0] !== y[0] ? x[0] < y[0] : x[1] < y[1]; };
  const top = [...layers.keys()].reduce((a, b) => (stronger(b, a) ? b : a));
  if (sequential) {
    const val = new Map();
    const read = (k) => val.get(k) ?? 0n;
    for (const r of rules) {
      if (r.kind === 'SEAL') continue;
      if (r.guard && evalExpr(r.guard, read) === 0n) continue;
      if (r.kind === 'UNSET') val.set(r.key, 0n); else val.set(r.key, evalExpr(r.expr, read));
    }
    return (k) => read(k);
  }
  // value of key k in the view of layer L (layers stronger than L do not exist). A rule of layer M reads in the view of M.
  // variant 'global': every read uses the whole-program view (the natural memoised resolver). variant 'viewer': a rule reads in the view it is being considered in.
  const memo = new Map(); const stack = new Set();
  const valueIn = (k, L) => {
    const key = k + '@' + L;
    if (memo.has(key)) return memo.get(key);
    if (stack.has(key)) throw new Error('cycle at ' + key);
    stack.add(key);
    const inView = (l) => !stronger(l, L);
    const readFor = (M) => (j) => valueIn(j, variant === 'global' ? top : variant === 'viewer' ? L : M);
    let seal = null;
    for (const r of rules) if (r.kind === 'SEAL' && r.key === k && inView(r.layer) && (seal === null || stronger(r.layer, seal))) seal = r.layer;
    let win = null;
    for (const r of rules) {
      if (r.kind === 'SEAL' || r.key !== k || !inView(r.layer)) continue;
      if (seal !== null && stronger(seal, r.layer)) continue;
      if (r.guard && evalExpr(r.guard, readFor(r.layer)) === 0n) continue;
      if (win === null || stronger(r.layer, win.layer) || (r.layer === win.layer && r.n > win.n)) win = r;
    }
    const v = win === null || win.kind === 'UNSET' ? 0n : evalExpr(win.expr, readFor(win.layer));
    stack.delete(key); memo.set(key, v); return v;
  };
  return (k) => valueIn(k, top);
}

export function run(text, opts) {
  const p = parseProgram(text);
  const read = resolve(p, opts);
  return p.shows.map((k) => read(k).toString()).join(' ');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(run(readFileSync(process.argv[2], 'utf8'), { sequential: process.argv.includes('--sequential'), variant: (process.argv.find((a) => a.startsWith('--variant=')) ?? '').slice(10) }));
}
