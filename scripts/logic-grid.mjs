/** Logic-grid task family: solver, renderer, seeded generator and task writer (hidden data lives in each task's oracle/puzzle.json).
 * node scripts/logic-grid.mjs TASK_DIR SEED N NCATS  -> writes TASK_DIR/{task.json,public/brief.txt,oracle/puzzle.json,oracle/oracle.json}
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Clue kinds over items [category, value]: same next left1 before not (pos exists in the solver but the generator does not emit it).
export const CATS = {
  person: ['Ada', 'Ben', 'Cyd', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy'],
  color: ['red', 'blue', 'green', 'yellow', 'white', 'black', 'orange', 'purple', 'brown'],
  pet: ['cat', 'dog', 'fish', 'bird', 'snake', 'horse', 'rabbit', 'turtle', 'goat'],
  drink: ['tea', 'coffee', 'milk', 'juice', 'water', 'cider', 'soda', 'cocoa', 'lemonade'],
  hobby: ['chess', 'golf', 'sailing', 'painting', 'running', 'cooking', 'knitting', 'archery', 'pottery'],
};
export const CAT_NAMES = Object.keys(CATS);
const noun = { person: (v) => v, color: (v) => `the ${v} house`, pet: (v) => `the ${v} owner`, drink: (v) => `the ${v} drinker`, hobby: (v) => `the ${v} fan` };
const key = (it) => `${it[0]}:${it[1]}`;
export function render(c, N) {
  const [a, b] = [c.a && noun[c.a[0]](c.a[1]), c.b && noun[c.b[0]](c.b[1])];
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  switch (c.k) {
    case 'same': return `${cap(a)} and ${b} are the same household.`;
    case 'pos': return `${cap(a)} is in house ${c.n}.`;
    case 'next': return `${cap(a)} and ${b} live in neighbouring houses (house numbers differ by exactly 1).`;
    case 'left1': return `${cap(a)} is in the house immediately to the left of ${b} (house number exactly 1 lower).`;
    case 'before': return `${cap(a)} is in a lower-numbered house than ${b} (not necessarily adjacent).`;
    case 'not': return `${cap(a)} and ${b} are NOT the same household.`;
  }
}
// Solve: returns { count (capped at 2), solution } where solution[itemKey] = house number.
export function solve(clues, N, cats) {
  const vars = []; for (const c of cats) for (const v of CATS[c].slice(0, N)) vars.push([c, v]);
  const idx = new Map(vars.map((v, i) => [key(v), i]));
  const full = (1 << N) - 1; // domain bit (h-1)
  const dom = vars.map(() => full);
  const binary = vars.map(() => []); // per var: clues touching it
  const ok = (c, pa, pb) => c.k === 'same' ? pa === pb : c.k === 'next' ? Math.abs(pa - pb) === 1 : c.k === 'left1' ? pb === pa + 1 : c.k === 'before' ? pa < pb : pa !== pb;
  for (const c of clues) {
    const ia = idx.get(key(c.a));
    if (c.k === 'pos') { dom[ia] &= 1 << (c.n - 1); continue; }
    const ib = idx.get(key(c.b)); binary[ia].push([c, ia, ib]); binary[ib].push([c, ia, ib]);
  }
  const pop = (m) => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };
  let count = 0, first = null;
  const rec = (d, assigned) => {
    if (count >= 2) return;
    let best = -1, bs = 99;
    for (let i = 0; i < vars.length; i++) if (!assigned[i]) { const s = pop(d[i]); if (s === 0) return; if (s < bs) { bs = s; best = i; } }
    if (best < 0) { count++; if (!first) first = Object.fromEntries(vars.map((v, i) => [key(v), Math.log2(d[i]) + 1])); return; }
    for (let h = 1; h <= N; h++) {
      if (!(d[best] & (1 << (h - 1)))) continue;
      const nd = d.slice(), na = assigned.slice(); nd[best] = 1 << (h - 1); na[best] = true;
      let alive = true;
      for (let j = 0; j < vars.length && alive; j++) if (j !== best && vars[j][0] === vars[best][0]) { nd[j] &= ~(1 << (h - 1)); if (!nd[j]) alive = false; }
      // arc-filter every unassigned var through clues touching any assigned var, to a fixpoint
      for (let pass = 0; pass < 3 && alive; pass++) for (const list of binary) for (const [c, ia, ib] of list) {
        if (!alive) break;
        for (const [x, y, swap] of [[ia, ib, false], [ib, ia, true]]) {
          let m = 0;
          for (let py = 1; py <= N; py++) if (nd[y] & (1 << (py - 1))) {
            let sup = false;
            for (let px = 1; px <= N && !sup; px++) if (nd[x] & (1 << (px - 1))) sup = swap ? ok(c, py, px) : ok(c, px, py);
            if (sup) m |= 1 << (py - 1);
          }
          if (m !== nd[y]) { nd[y] = m; if (!m) { alive = false; break; } }
        }
      }
      if (alive) rec(nd, na);
    }
  };
  // initial domains must also respect all-different singletons from pos clues
  rec(dom, vars.map(() => false));
  return { count, solution: first };
}

export function generate(seed, N, ncats) {
  const cats = CAT_NAMES.slice(0, ncats);
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const truth = {}; for (const c of cats) shuffle([...Array(N).keys()].map((i) => i + 1)).forEach((h, i) => { truth[`${c}:${CATS[c][i]}`] = h; });
  const items = Object.keys(truth).map((k) => k.split(':'));
  const pick = () => items[Math.floor(rnd() * items.length)];
  const mk = () => {
    const r = rnd(), a = pick(); let b = pick(); while (b[0] === a[0]) b = pick();
    const pa = truth[a.join(':')], pb = truth[b.join(':')];
    if (r < 0.25) return pa === pb ? { k: 'same', a, b } : null;
    if (r < 0.50) return Math.abs(pa - pb) === 1 ? { k: 'next', a, b } : null;
    if (r < 0.65) return pb === pa + 1 ? { k: 'left1', a, b } : null;
    if (r < 0.85) return pa < pb ? { k: 'before', a, b } : null;
    return pa !== pb ? { k: 'not', a, b } : null;
  };
  let clues = [];
  for (let guard = 0; guard < 50000; guard++) { const c = mk(); if (!c) continue; clues.push(c); if (solve(clues, N, cats).count === 1) break; }
  for (let i = clues.length - 1; i >= 0; i--) { const t = clues.filter((_, j) => j !== i); if (solve(t, N, cats).count === 1) clues = t; }
  const sol = solve(clues, N, cats).solution;
  for (const [k, v] of Object.entries(truth)) if (sol[k] !== v) throw new Error('solver disagrees with construction');
  const qCat = 'drink';
  const answer = [...Array(N).keys()].map((h) => CATS[qCat].slice(0, N).find((v) => truth[`${qCat}:${v}`] === h + 1)).join(', ');
  return { seed, N, cats, clues, answer, qCat };
}
export function briefText(p) {
  const lines = [];
  lines.push(`${p.N} houses stand in a row, numbered 1 (leftmost) to ${p.N} (rightmost). Each house has exactly one household. Every household is described by ${['', 'one', 'two', 'three', 'four', 'five'][p.cats.length]} attributes, and within each attribute all ${p.N} values are used exactly once (no two houses share a value):`);
  for (const c of p.cats) lines.push(`- ${c}: ${CATS[c].slice(0, p.N).join(', ')}`);
  lines.push('');
  lines.push('"The X" always means the household with that attribute value (for example "the tea drinker" is the household whose drink is tea). Every statement below is true, and together they determine the arrangement uniquely:');
  lines.push('');
  p.clues.forEach((c, i) => lines.push(`${i + 1}. ${render(c, p.N)}`));
  lines.push('');
  lines.push(`Question: which drink does each household have, from house 1 to house ${p.N}? Answer with only the ${p.N} drinks in house order, separated by a comma and a single space (for example: ${CATS.drink.slice(0, p.N).join(', ')}), nothing else.`);
  return lines.join('\n') + '\n';
}
export function writeTask(dir, id, p) {
  mkdirSync(join(dir, 'public'), { recursive: true }); mkdirSync(join(dir, 'oracle'), { recursive: true });
  writeFileSync(join(dir, 'task.json'), JSON.stringify({ task_id: id }) + '\n');
  writeFileSync(join(dir, 'public', 'brief.txt'), briefText(p));
  writeFileSync(join(dir, 'oracle', 'puzzle.json'), JSON.stringify(p, null, 1) + '\n');
  writeFileSync(join(dir, 'oracle', 'oracle.json'), JSON.stringify({ kind: 'exact-answer', expected: p.answer, distractors: [CATS.drink.slice(0, p.N).join(', ')] }, null, 2) + '\n');
}
if (process.argv[1] && process.argv[1].endsWith('logic-grid.mjs')) {
  const [dir, seed, N, nc] = process.argv.slice(2);
  const p = generate(+seed, +N, +nc);
  writeTask(dir, dir.split('/').filter(Boolean).at(-1), p);
  console.log(p.clues.length, 'clues;', p.answer);
}
