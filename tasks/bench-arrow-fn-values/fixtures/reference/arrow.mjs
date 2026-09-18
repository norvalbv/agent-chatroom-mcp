// Independent second implementation: tree-walking evaluator over an s-expression reader.
import { readFileSync } from 'node:fs';
export function runArrow(src) {
  const lines = src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const out = [];
  const globals = new Map();
  const readTok = (s) => s.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/);
  const sexp = (t) => {
    let i = 0;
    const go = () => {
      const x = t[i++];
      if (x !== '(') return /^-?\d+$/.test(x) ? BigInt(x) : x;
      const l = [];
      while (t[i] !== ')') l.push(go());
      i++;
      return l;
    };
    return go();
  };
  const parseExpr = (s) => sexp(readTok(s));
  function parseBlock(i, stops) {
    const body = [];
    while (i < lines.length && !stops.includes(lines[i].split(' ')[0])) {
      const [st, j] = parseStmt(i);
      body.push(st);
      i = j;
    }
    return [body, i];
  }
  function parseStmt(i) {
    const line = lines[i];
    const sp = line.indexOf(' ');
    const head = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1);
    switch (head) {
      case 'SET': { const q = rest.indexOf(' '); return [{ t: 'SET', n: rest.slice(0, q), e: parseExpr(rest.slice(q + 1)) }, i + 1]; }
      case 'PRINT': return [{ t: 'PRINT', e: parseExpr(rest) }, i + 1];
      case 'RET': return [{ t: 'RET', e: parseExpr(rest) }, i + 1];
      case 'GLOBAL': return [{ t: 'GLOBAL', n: rest }, i + 1];
      case 'IF': { const [a, j] = parseBlock(i + 1, ['ELSE', 'END']); let b = [], k = j; if (lines[j] === 'ELSE') [b, k] = parseBlock(j + 1, ['END']); return [{ t: 'IF', e: parseExpr(rest), a, b }, k + 1]; }
      case 'REPEAT': { const [a, j] = parseBlock(i + 1, ['END']); return [{ t: 'REPEAT', e: parseExpr(rest), a }, j + 1]; }
      case 'DEF': { const w = rest.split(' '); const [a, j] = parseBlock(i + 1, ['END']); return [{ t: 'DEF', n: w[0], ps: w.slice(1), a }, j + 1]; }
    }
    throw new Error('bad line ' + line);
  }
  const [prog] = parseBlock(0, []);
  class Ret { constructor(v) { this.v = v; } }
  const fnv = (ps, body, isProc) => ({ ps, body, isProc });
  function get(n, fr) {
    if (fr && !fr.gl.has(n) && fr.loc.has(n)) return fr.loc.get(n);
    return globals.has(n) ? globals.get(n) : 0n;
  }
  function ev(e, fr) {
    if (typeof e === 'bigint') return e;
    if (typeof e === 'string') return get(e, fr);
    const [h, ...a] = e;
    if (h === 'fn') return fnv(a[0], a[1], false);
    if (h === 'if') return ev(a[0], fr) !== 0n ? ev(a[1], fr) : ev(a[2], fr);
    const v = a.map((x) => ev(x, fr));
    if (h === 'call') {
      const [f, ...args] = v;
      if (typeof f !== 'object') return 0n;
      const nf = { loc: new Map(f.ps.map((p, i) => [p, args[i]])), gl: new Set() };
      if (!f.isProc) return ev(f.body, nf);
      try { run(f.body, nf); } catch (x) { if (x instanceof Ret) return x.v; throw x; }
      return 0n;
    }
    const fl = (x, y) => { let q = x / y; if ((x % y !== 0n) && ((x < 0n) !== (y < 0n))) q -= 1n; return q; };
    switch (h) {
      case '+': return v[0] + v[1]; case '-': return v[0] - v[1]; case '*': return v[0] * v[1];
      case '/': return v[1] === 0n ? 0n : fl(v[0], v[1]);
      case '%': return v[1] === 0n ? 0n : v[0] - fl(v[0], v[1]) * v[1];
      case '<': return v[0] < v[1] ? 1n : 0n; case '=': return v[0] === v[1] ? 1n : 0n;
    }
    throw new Error('op ' + h);
  }
  function assign(n, val, fr) { if (!fr || fr.gl.has(n)) globals.set(n, val); else fr.loc.set(n, val); }
  function run(body, fr) {
    for (const s of body) {
      switch (s.t) {
        case 'SET': assign(s.n, ev(s.e, fr), fr); break;
        case 'PRINT': out.push(ev(s.e, fr)); break;
        case 'RET': throw new Ret(ev(s.e, fr));
        case 'GLOBAL': fr.gl.add(s.n); break;
        case 'IF': run(ev(s.e, fr) !== 0n ? s.a : s.b, fr); break;
        case 'REPEAT': { const n = ev(s.e, fr); for (let i = 0n; i < n; i++) run(s.a, fr); break; }
        case 'DEF': assign(s.n, fnv(s.ps, s.a, true), fr); break;
      }
    }
  }
  run(prog, null);
  return out.map(String);
}
if (process.argv[2]) console.log(runArrow(readFileSync(process.argv[2], 'utf8')).join(' '));
