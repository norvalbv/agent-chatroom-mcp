// Hidden reference interpreter used only to derive oracle.json's expected value.
import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(' '));
const globals = new Map(); const lists = new Map(); const procs = new Map(); const out = [];
const fdiv = (a, b) => { if (b === 0n) return 0n; let q = a / b; if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q -= 1n; return q; };
class Break {} class Continue {} class Ret { constructor(v) { this.v = v; } }
const BIN = new Set(['+','-','*','/','%','<','=','AND','OR','MIN','MAX','POW']);
function lookup(fr, v) { if (fr && fr.locals.has(v) && !fr.globalNames.has(v)) return fr.locals.get(v); return globals.get(v) ?? 0n; }
function assign(fr, v, x) { if (!fr || fr.globalNames.has(v)) globals.set(v, x); else fr.locals.set(v, x); }
function ev(t, i, fr) {
  const tok = t[i];
  if (/^-?\d+$/.test(tok)) return [BigInt(tok), i + 1];
  if (tok === 'NEXT') { const v = t[i + 1]; assign(fr, v, lookup(fr, v) + 1n); return [lookup(fr, v), i + 2]; }
  if (tok === 'LEN') return [BigInt((lists.get(t[i + 1]) ?? []).length), i + 2];
  if (tok === 'AT') { const [ix, j] = ev(t, i + 2, fr); const L = lists.get(t[i + 1]) ?? []; let k = Number(ix); if (k < 0) k += L.length; return [k >= 0 && k < L.length ? L[k] : 0n, j]; }
  if (tok === 'NOT') { const [a, j] = ev(t, i + 1, fr); return [a === 0n ? 1n : 0n, j]; }
  if (tok === 'ABS') { const [a, j] = ev(t, i + 1, fr); return [a < 0n ? -a : a, j]; }
  if (tok === 'CALL') {
    const name = t[i + 1]; const def = procs.get(name);
    if (!def) return [0n, i + 2];
    let j = i + 2; const args = [];
    for (let n = 0; n < def.params.length; n++) { const [a, k] = ev(t, j, fr); args.push(a); j = k; }
    const frame = { locals: new Map(), globalNames: new Set() };
    def.params.forEach((p, n) => frame.locals.set(p, args[n]));
    let result = 0n;
    try { exec(def.start, def.end, frame); } catch (x) { if (x instanceof Ret) result = x.v; else throw x; }
    return [result, j];
  }
  if (BIN.has(tok)) {
    const [a, j] = ev(t, i + 1, fr); const [b, k] = ev(t, j, fr);
    let r;
    switch (tok) {
      case '+': r = a + b; break; case '-': r = a - b; break; case '*': r = a * b; break;
      case '/': r = fdiv(a, b); break; case '%': r = b === 0n ? 0n : a - fdiv(a, b) * b; break;
      case '<': r = a < b ? 1n : 0n; break; case '=': r = a === b ? 1n : 0n; break;
      case 'AND': r = a !== 0n && b !== 0n ? 1n : 0n; break; case 'OR': r = a !== 0n || b !== 0n ? 1n : 0n; break;
      case 'MIN': r = a < b ? a : b; break; case 'MAX': r = a > b ? a : b; break;
      case 'POW': r = b < 0n ? 0n : a ** b; break;
    }
    return [r, k];
  }
  return [lookup(fr, tok), i + 1];
}
function block(p) {
  let depth = 0, elseIdx = null;
  for (let q = p; q < lines.length; q++) {
    const h = lines[q][0];
    if (h === 'REPEAT' || h === 'IF' || h === 'WHILE' || h === 'DEF') depth++;
    else if (h === 'END') { if (depth === 0) return [p, elseIdx, q]; depth--; }
    else if (h === 'ELSE' && depth === 0) elseIdx = q;
  }
  throw new Error('no END');
}
function loop(cond, s, e, fr) {
  for (;;) {
    if (!cond()) return;
    try { exec(s, e, fr); } catch (x) { if (x instanceof Break) return; if (!(x instanceof Continue)) throw x; }
  }
}
function exec(from, to, fr) {
  for (let p = from; p < to; p++) {
    const t = lines[p]; const h = t[0];
    if (h === 'SET') assign(fr, t[1], ev(t, 2, fr)[0]);
    else if (h === 'SETS') { const [e, j] = ev(t, 3, fr); const [f] = ev(t, j, fr); assign(fr, t[1], e); assign(fr, t[2], f); }
    else if (h === 'PRINT') out.push(ev(t, 1, fr)[0].toString());
    else if (h === 'PUSH') { const v = ev(t, 2, fr)[0]; if (!lists.has(t[1])) lists.set(t[1], []); lists.get(t[1]).push(v); }
    else if (h === 'GLOBAL') fr.globalNames.add(t[1]);
    else if (h === 'BREAK') throw new Break();
    else if (h === 'CONTINUE') throw new Continue();
    else if (h === 'RET') throw new Ret(ev(t, 1, fr)[0]);
    else if (h === 'DEF') { const [s, , e] = block(p + 1); procs.set(t[1], { params: t.slice(2), start: s, end: e }); p = e; }
    else if (h === 'REPEAT') { const n = ev(t, 1, fr)[0]; const [s, , e] = block(p + 1); let c = 0n; loop(() => c++ < n, s, e, fr); p = e; }
    else if (h === 'WHILE') { const [s, , e] = block(p + 1); loop(() => ev(t, 1, fr)[0] !== 0n, s, e, fr); p = e; }
    else if (h === 'IF') { const c = ev(t, 1, fr)[0]; const [s, el, e] = block(p + 1); if (c !== 0n) exec(s, el ?? e, fr); else if (el !== null) exec(el + 1, e, fr); p = e; }
  }
}
exec(0, lines.length, null);
console.log(out.join(' '));
