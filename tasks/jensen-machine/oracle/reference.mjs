// Hidden reference interpreter for jensen-machine. Optional 2nd arg: a deliberately wrong reading (tests only).
import { readFileSync } from 'node:fs';
const BIN = new Set(['+', '-', '*', '<', '=', 'AND', 'OR', 'MIN', 'MAX']);
function parseExpr(t, i) {
  const k = t[i];
  if (/^-?\d+$/.test(k)) return [{ k: 'num', v: Number(k) }, i + 1];
  if (BIN.has(k)) { const [a, j] = parseExpr(t, i + 1); const [b, l] = parseExpr(t, j); return [{ k: 'bin', op: k, a, b }, l]; }
  if (k === 'NOT') { const [a, j] = parseExpr(t, i + 1); return [{ k: 'not', a }, j]; }
  if (k === 'NEXT') return [{ k: 'next', name: t[i + 1] }, i + 2];
  if (k === 'CALL') {
    let j = i + 2; const args = []; const n = PARAMS.get(t[i + 1]);
    if (n === undefined) throw new Error('call before def ' + t[i + 1]);
    for (let q = 0; q < n; q++) { const [a, l] = parseExpr(t, j); args.push(a); j = l; }
    return [{ k: 'call', f: t[i + 1], args }, j];
  }
  return [{ k: 'var', name: k }, i + 1];
}
const PARAMS = new Map();
export function run(text, variant = '') {
  const raw = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(' '));
  for (const t of raw) if (t[0] === 'DEF') PARAMS.set(t[1], t.length - 2);
  // parse statements
  const parseBlock = (i) => {
    const body = [];
    while (i < raw.length) {
      const t = raw[i];
      if (t[0] === 'END' || t[0] === 'ELSE') return [body, i];
      if (t[0] === 'SET') { const [e] = parseExpr(t, 2); body.push({ s: 'set', name: t[1], e }); i++; }
      else if (t[0] === 'PRINT') { const [e] = parseExpr(t, 1); body.push({ s: 'print', e }); i++; }
      else if (t[0] === 'CALL') { const [e] = parseExpr(t, 0); body.push({ s: 'expr', e }); i++; }
      else if (t[0] === 'RET') { const [e] = parseExpr(t, 1); body.push({ s: 'ret', e }); i++; }
      else if (t[0] === 'IF' || t[0] === 'WHILE') {
        const [c] = parseExpr(t, 1); const [b1, j] = parseBlock(i + 1); let b2 = []; let k = j;
        if (raw[k][0] === 'ELSE') { [b2, k] = parseBlock(k + 1); }
        body.push({ s: t[0].toLowerCase(), c, b1, b2 }); i = k + 1;
      } else if (t[0] === 'REPEAT') { const [b, j] = parseBlock(i + 1); body.push({ s: 'repeat', n: Number(t[1]), b }); i = j + 1; }
      else if (t[0] === 'DEF') { const [b, j] = parseBlock(i + 1); body.push({ s: 'def', f: t[1], ps: t.slice(2), b }); i = j + 1; }
      else throw new Error('bad ' + t.join(' '));
    }
    return [body, i];
  };
  const [prog] = parseBlock(0);
  const globals = new Map(); const procs = new Map(); const out = [];
  class Ret { constructor(v) { this.v = v; } }
  const GLOBAL = { locals: globals, params: new Map(), isGlobal: true };
  function read(fr, name, at) {
    if (fr.params.has(name)) {
      const th = fr.params.get(name);
      if (variant === 'cached') { if (!('val' in th)) th.val = ev(th.e, th.fr); return th.val; }
      if (variant === 'dynamicThunk') return ev(th.e, at ?? fr);
      if (variant === 'globalThunk') return ev(th.e, GLOBAL);
      return ev(th.e, th.fr);
    }
    return fr.locals.get(name) ?? (fr.isGlobal ? 0 : (globals.get(name) ?? 0));
  }
  function write(fr, name, v) {
    if (fr.params.has(name)) {
      if (variant === 'noAssignThrough') return;
      if (variant === 'assignLocal') { fr.params.delete(name); fr.locals.set(name, v); return; }
      const th = fr.params.get(name);
      if (th.e.k === 'var') write(th.fr, th.e.name, v);
      return;
    }
    if (variant === 'setGlobal' && !fr.isGlobal) globals.set(name, v); else fr.locals.set(name, v);
  }
  function ev(e, fr) {
    switch (e.k) {
      case 'num': return e.v;
      case 'var': return read(fr, e.name, fr);
      case 'not': return ev(e.a, fr) === 0 ? 1 : 0;
      case 'bin': {
        const a = ev(e.a, fr), b = ev(e.b, fr);
        switch (e.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '<': return a < b ? 1 : 0; case '=': return a === b ? 1 : 0;
          case 'AND': return a !== 0 && b !== 0 ? 1 : 0; case 'OR': return a !== 0 || b !== 0 ? 1 : 0; case 'MIN': return Math.min(a, b); case 'MAX': return Math.max(a, b); }
        throw new Error('op');
      }
      case 'next': { const v = read(fr, e.name, fr) + 1; write(fr, e.name, v); return read(fr, e.name, fr); }
      case 'call': {
        const d = procs.get(e.f); if (!d) return 0;
        const fr2 = { locals: new Map(), params: new Map(), isGlobal: false };
        d.ps.forEach((p, i) => {
          if (variant === 'byValue') fr2.locals.set(p, ev(e.args[i], fr));
          else fr2.params.set(p, { e: e.args[i], fr });
        });
        try { execBlock(d.b, fr2); } catch (x) { if (x instanceof Ret) return x.v; throw x; }
        return 0;
      }
    }
  }
  function execBlock(b, fr) {
    for (const s of b) {
      if (s.s === 'set') write(fr, s.name, ev(s.e, fr));
      else if (s.s === 'expr') ev(s.e, fr);
      else if (s.s === 'print') out.push(ev(s.e, fr));
      else if (s.s === 'ret') throw new Ret(ev(s.e, fr));
      else if (s.s === 'if') { if (ev(s.c, fr) !== 0) execBlock(s.b1, fr); else execBlock(s.b2, fr); }
      else if (s.s === 'while') { while (ev(s.c, fr) !== 0) execBlock(s.b1, fr); }
      else if (s.s === 'repeat') { for (let i = 0; i < s.n; i++) execBlock(s.b, fr); }
      else if (s.s === 'def') procs.set(s.f, s);
    }
  }
  execBlock(prog, GLOBAL);
  return out.join(' ');
}
if (process.argv[1] && process.argv[1].endsWith('reference.mjs') && process.argv[2]) process.stdout.write(run(readFileSync(process.argv[2], 'utf8'), process.argv[3] ?? '') + '\n');
