// Hidden reference interpreter for lathe-fn. `variant` is a deliberately wrong reading (tests only).
import { readFileSync } from 'node:fs';
export function run(text, variant = '') {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(' '));
  let pc = 0;
  function block(stops) {
    const body = [];
    while (pc < lines.length && !stops.includes(lines[pc][0])) {
      const t = lines[pc++];
      if (t[0] === 'WHILE' || t[0] === 'IF') {
        const node = { k: t[0], cond: t.slice(1), body: block(['END', 'ELSE']), other: null };
        if (lines[pc][0] === 'ELSE') { pc++; node.other = block(['END']); }
        pc++; body.push(node);
      } else if (t[0] === 'FN') { const node = { k: 'FN', name: t[1], param: t[2], body: block(['END']) }; pc++; body.push(node); }
      else body.push({ k: t[0], t });
    }
    return body;
  }
  const prog = block([]);
  const out = [];
  const isFn = v => typeof v === 'object' && v !== null;
  const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; };
  const G = { vars: new Map(), parent: null, globalsDeclared: new Set() };
  let callerFrame = null;
  const lookup = (fr, name) => {
    if (fr.globalsDeclared.has(name)) return G.vars.has(name) ? G.vars.get(name) : 0n;
    if (fr.vars.has(name)) return fr.vars.get(name);
    if (variant === 'closureRead' || variant === 'closureWrite') { for (let p = fr.parent; p && p !== G; p = p.parent) if (p.vars.has(name)) return p.vars.get(name); }
    if (variant === 'callerVisible') { for (let p = fr.caller; p; p = p.caller) if (p !== G && p.vars.has(name)) return p.vars.get(name); }
    return G.vars.has(name) ? G.vars.get(name) : 0n;
  };
  const assign = (fr, name, v) => {
    if (fr.globalsDeclared.has(name)) { G.vars.set(name, v); return; }
    if (variant === 'closureWrite' && !fr.vars.has(name)) { for (let p = fr.parent; p && p !== G; p = p.parent) if (p.vars.has(name)) { p.vars.set(name, v); return; } }
    if (fr === G) { G.vars.set(name, v); return; }
    fr.vars.set(name, v);
  };
  function ev(tokens, fr, pos = { i: 0 }) {
    const tk = tokens[pos.i++];
    if (/^-?\d+$/.test(tk)) return BigInt(tk);
    if (['+', '-', '*', '/', '%', '<', '='].includes(tk)) {
      const a = ev(tokens, fr, pos), b = ev(tokens, fr, pos);
      if (tk === '+') return a + b; if (tk === '-') return a - b; if (tk === '*') return a * b;
      if (tk === '<') return a < b ? 1n : 0n; if (tk === '=') return a === b ? 1n : 0n;
      if (b === 0n) return 0n; const q = floorDiv(a, b); return tk === '/' ? q : a - q * b;
    }
    if (tk === 'CALL') {
      const f = ev(tokens, fr, pos); const a = ev(tokens, fr, pos);
      if (!isFn(f)) return 0n;
      const nf = { vars: new Map([[f.param, a]]), parent: f.def, globalsDeclared: new Set(), caller: fr };
      try { exec(f.body, nf); } catch (e) { if (e && e.ret !== undefined) return e.ret; throw e; }
      return 0n;
    }
    return lookup(fr, tk);
  }
  function exec(body, fr) {
    for (const s of body) {
      if (s.k === 'WHILE') { while (ev(s.cond, fr) !== 0n) exec(s.body, fr); }
      else if (s.k === 'IF') { if (ev(s.cond, fr) !== 0n) exec(s.body, fr); else if (s.other) exec(s.other, fr); }
      else if (s.k === 'FN') assign(fr, s.name, { param: s.param, body: s.body, def: fr });
      else if (s.t[0] === 'SET') assign(fr, s.t[1], ev(s.t.slice(2), fr));
      else if (s.t[0] === 'PRINT') out.push(String(ev(s.t.slice(1), fr)));
      else if (s.t[0] === 'DO') ev(s.t.slice(1), fr);
      else if (s.t[0] === 'GLOBAL') fr.globalsDeclared.add(s.t[1]);
      else if (s.t[0] === 'RET') throw { ret: ev(s.t.slice(1), fr) };
      else throw new Error('bad statement ' + s.t.join(' '));
    }
  }
  exec(prog, G);
  return out.join(' ');
}
if (process.argv[1] && process.argv[1].endsWith('reference.mjs') && process.argv[2]) process.stdout.write(run(readFileSync(process.argv[2], 'utf8'), process.argv[3] ?? '') + '\n');
