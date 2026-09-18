// Generates public/program.layers. usage: node gen.mjs [seed] [N keys] [reference window] > program.layers  (checked in output is what seats see)
const seed0 = Number(process.argv[2] ?? 7);
let s = seed0 >>> 0;
const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const N = Number(process.argv[3] ?? 44);
const WINDOW = Number(process.argv[4] ?? 12);
const name = (i) => 'k' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
const layerDefs = process.argv[3] ? [['base', 50], ['team', 30], ['site', 30], ['region', 20], ['user', 20], ['override', 10]] : [['base', 50], ['team', 30], ['site', 30], ['user', 20], ['override', 10]];

function expr(i, depth) {
  const refs = i === 0 ? [] : Array.from({ length: Math.min(i, 6) }, () => name(int(Math.max(0, i - WINDOW), i - 1)));
  const leaf = () => (refs.length && rnd() < 0.7 ? '$' + pick(refs) : String(int(-9, 40)));
  if (depth === 0) return leaf();
  const r = rnd();
  const a = () => expr(i, depth - 1);
  if (r < 0.28) return `+ ${a()} ${a()}`;
  if (r < 0.42) return `- ${a()} ${a()}`;
  if (r < 0.52) return `* ${a()} ${String(int(2, 4))}`;
  if (r < 0.62) return `MAX ${a()} ${a()}`;
  if (r < 0.72) return `MIN ${a()} ${a()}`;
  if (r < 0.80) return `% ${a()} ${String(int(3, 11))}`;
  if (r < 0.88) return `/ ${a()} ${String(int(2, 5))}`;
  return `IF < ${a()} ${a()} ${a()} ${a()}`;
}
const guard = (i) => {
  if (i === 0) return null;
  const r = rnd();
  const k = () => '$' + name(int(Math.max(0, i - WINDOW), i - 1));
  if (r < 0.5) return `< ${k()} ${int(-2, 30)}`;
  if (r < 0.8) return `= % ${k()} ${int(2, 4)} ${int(0, 1)}`;
  return `NOT < ${k()} ${int(0, 20)}`;
};

// per-layer rule lists: rules[layer] = array of {i, text}; order inside a layer follows key order + shuffle
const rules = Object.fromEntries(layerDefs.map(([l]) => [l, []]));
for (let i = 0; i < N; i++) {
  rules.base.push({ i, text: `SET ${name(i)} ${expr(i, int(1, 3))}` });
  for (const [l] of layerDefs.slice(1)) {
    const p = l === 'override' ? 0.18 : l === 'user' ? 0.3 : 0.4;
    if (rnd() > p) continue;
    const g = rnd() < 0.5 ? guard(i) : null;
    const kind = rnd();
    if (kind < 0.12) rules[l].push({ i, text: `UNSET ${name(i)}${g ? ' WHEN ' + g : ''}` });
    else if (kind < 0.2 && l !== 'base') rules[l].push({ i, text: `SEAL ${name(i)}` });
    else rules[l].push({ i, text: `SET ${name(i)} ${expr(i, int(1, 3))}${g ? ' WHEN ' + g : ''}` });
    // sometimes a second rule for the same key in the same layer (later line must win)
    if (rnd() < 0.2) rules[l].push({ i, text: `SET ${name(i)} ${expr(i, int(0, 2))}` });
  }
  if (rnd() < 0.1) rules.base.push({ i, text: `SET ${name(i)} ${expr(i, 1)}` });
}

// split each layer into 1-3 blocks; emit blocks in a shuffled order but each layer's first block first-opened by declaration order
const blocks = [];
for (const [l, rank] of layerDefs) {
  const list = rules[l];
  const parts = l === 'base' ? 3 : int(1, 2);
  const size = Math.ceil(list.length / parts);
  for (let b = 0; b < parts; b++) blocks.push({ layer: l, rank, first: b === 0, items: list.slice(b * size, (b + 1) * size) });
}
const firsts = blocks.filter((b) => b.first);
const rest = blocks.filter((b) => !b.first);
for (let k = rest.length - 1; k > 0; k--) { const j = int(0, k); [rest[k], rest[j]] = [rest[j], rest[k]]; }
const out = ['# layered configuration'];
// open every layer once in declaration order (so "opened first" ties are decided by declaration), then the reopened blocks
for (const b of firsts) { out.push(`LAYER ${b.layer} ${b.rank}`); for (const it of b.items) out.push(it.text); }
for (const b of rest) { out.push(`LAYER ${b.layer} ${b.layer === 'site' ? 5 : b.rank}`); for (const it of b.items) out.push(it.text); }
out.push('SHOW ' + Array.from({ length: N }, (_, i) => name(i)).join(' '));
console.log(out.join('\n'));
