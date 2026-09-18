// Hidden reference interpreter used only to derive oracle.json's expected value.
import { readFileSync } from 'node:fs';
const classes = new Map(); let cur = null; const out = [];
const lines = readFileSync(process.argv[2], 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
function lookup(k, m) { const c = classes.get(k); if (c.methods.has(m)) return { cls: k, body: c.methods.get(m) }; for (const p of c.parents) { const r = lookup(p, m); if (r) return r; } return null; }
function run(found, m, obj) {
  return found.body.map(p => {
    if (p.t === 'lit') return p.v;
    if (p.t === 'HERE') return found.cls;
    if (p.t === 'OBJ') return obj;
    if (p.t === 'SELF') { const f = lookup(obj, p.n); return f ? run(f, p.n, obj) : '?' + p.n; }
    if (p.t === 'SUPER') { for (const par of classes.get(found.cls).parents) { const f = lookup(par, m); if (f) return run(f, m, obj); } return '?super'; }
  }).join('');
}
for (const l of lines) {
  let m;
  if ((m = l.match(/^CLASS (\w+)(?: : (.*))?$/))) { cur = m[1]; classes.set(cur, { parents: m[2] ? m[2].split(' ') : [], methods: new Map() }); }
  else if ((m = l.match(/^DEF (\w+) = (.*)$/))) {
    const parts = m[2].split(' + ').map(s => s.startsWith('"') ? { t: 'lit', v: s.slice(1, -1) } : s.startsWith('SELF ') ? { t: 'SELF', n: s.slice(5) } : { t: s });
    classes.get(cur).methods.set(m[1], parts);
  } else if ((m = l.match(/^PRINT (\w+) (\w+)$/))) { const f = lookup(m[1], m[2]); out.push(f ? run(f, m[2], m[1]) : '?' + m[2]); }
  else throw new Error('bad line ' + l);
}
console.log(out.join(' '));
