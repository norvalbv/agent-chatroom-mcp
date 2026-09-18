// Hidden reference interpreter for lode-values. `variant` is a deliberately wrong reading, used only by tests
// to prove every value-semantics corner changes the answer.
import { readFileSync } from 'node:fs';

export function run(text, variant = '') {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(' '));
  const arity = new Map();
  for (const t of lines) if (t[0] === 'DEF') arity.set(t[1], t.length - 2);
  const isList = v => Array.isArray(v);
  const clone = v => (isList(v) ? v.map(clone) : v);
  const cp = (v, kind) => (variant === 'alias' + kind ? v : clone(v));
  const eq = (a, b) => (isList(a) && isList(b) ? (variant === 'eqIdentity' ? a === b : a.length === b.length && a.every((x, i) => eq(x, b[i]))) : !isList(a) && !isList(b) && a === b);
  const procs = new Map();
  const out = [];
  const fmt = v => (isList(v) ? '[' + v.map(fmt).join(' ') + ']' : String(v));
  const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; };

  // parse blocks into a tree
  let pc = 0;
  function block(stops) {
    const body = [];
    while (pc < lines.length && !stops.includes(lines[pc][0])) {
      const t = lines[pc++];
      if (t[0] === 'WHILE' || t[0] === 'IF') {
        const node = { k: t[0], cond: t.slice(1), body: block(['END', 'ELSE']), other: null };
        if (lines[pc][0] === 'ELSE') { pc++; node.other = block(['END']); }
        pc++; body.push(node);
      } else if (t[0] === 'DEF') { const node = { k: 'DEF', name: t[1], params: t.slice(2), body: block(['END']) }; pc++; body.push(node); }
      else body.push({ k: t[0], t });
    }
    return body;
  }
  const prog = block([]);

  function evalExpr(tokens, env, pos = { i: 0 }) {
    const tk = tokens[pos.i++];
    if (/^-?\d+$/.test(tk)) return BigInt(tk);
    if (['+', '-', '*', '/', '%', '<', '='].includes(tk)) {
      const a = evalExpr(tokens, env, pos), b = evalExpr(tokens, env, pos);
      if (tk === '=') return eq(a, b) ? 1n : 0n;
      if (isList(a) || isList(b)) return 0n;
      if (tk === '+') return a + b; if (tk === '-') return a - b; if (tk === '*') return a * b;
      if (tk === '<') return a < b ? 1n : 0n;
      if (b === 0n) return 0n;
      const q = floorDiv(a, b);
      return tk === '/' ? q : a - q * b;
    }
    if (tk === 'LEN') { const a = evalExpr(tokens, env, pos); return isList(a) ? BigInt(a.length) : 0n; }
    if (tk === 'AT') {
      const a = evalExpr(tokens, env, pos), i = evalExpr(tokens, env, pos);
      if (!isList(a) || isList(i) || i < 0n || i >= BigInt(a.length)) return 0n;
      return variant === 'aliasAt' ? a[Number(i)] : clone(a[Number(i)]);
    }
    if (tk === 'CALL') {
      const name = tokens[pos.i++]; const p = procs.get(name);
      const n = arity.get(name) ?? 0;
      const args = []; for (let k = 0; k < n; k++) args.push(evalExpr(tokens, env, pos));
      if (!p) return 0n;
      const local = new Map(); p.params.forEach((nm, k) => local.set(nm, cp(args[k], 'Call')));
      try { execBlock(p.body, local, true); } catch (e) { if (e && e.ret !== undefined) return e.ret; throw e; }
      return 0n;
    }
    // variable
    if (env.has(tk)) return env.get(tk);
    if (variant === 'globalsVisible' && globals.has(tk)) return globals.get(tk);
    return 0n;
  }
  const globals = new Map();

  function execBlock(body, env, inProc) {
    for (const s of body) {
      if (s.k === 'WHILE') { while (evalExpr(s.cond, env) !== 0n) execBlock(s.body, env, inProc); }
      else if (s.k === 'IF') { if (evalExpr(s.cond, env) !== 0n) execBlock(s.body, env, inProc); else if (s.other) execBlock(s.other, env, inProc); }
      else if (s.k === 'DEF') procs.set(s.name, s);
      else {
        const t = s.t;
        if (t[0] === 'SET') env.set(t[1], cp(evalExpr(t.slice(2), env), 'Set'));
        else if (t[0] === 'LIST') env.set(t[1], []);
        else if (t[0] === 'PUSH') { const v = evalExpr(t.slice(2), env); const l = env.get(t[1]); if (isList(l)) l.push(cp(v, 'Push')); }
        else if (t[0] === 'SETAT') { const pos = { i: 0 }; const toks = t.slice(2); const i = evalExpr(toks, env, pos); const v = evalExpr(toks, env, pos); const l = env.get(t[1]); if (isList(l) && i >= 0n && i < BigInt(l.length)) l[Number(i)] = cp(v, 'Setat'); }
        else if (t[0] === 'POPTO') { const l = env.get(t[1]); if (isList(l) && l.length) env.set(t[2], l.pop()); }
        else if (t[0] === 'PRINT') out.push(fmt(evalExpr(t.slice(1), env)));
        else if (t[0] === 'RET') throw { ret: cp(evalExpr(t.slice(1), env), 'Ret') };
        else throw new Error('bad statement ' + t.join(' '));
      }
    }
  }
  execBlock(prog, globals, false);
  return out.join(' ');
}
if (process.argv[1] && process.argv[1].endsWith('reference.mjs') && process.argv[2]) process.stdout.write(run(readFileSync(process.argv[2], 'utf8'), process.argv[3] ?? '') + '\n');
