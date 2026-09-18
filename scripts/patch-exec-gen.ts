/** patch-exec family generator: node --import tsx scripts/patch-exec-gen.ts TASK_ID SEED NLINES NPATCHES
 * Writes tasks/TASK_ID/{task.json,public/*,oracle/oracle.json}. The answer comes from the reference applyPatch;
 * the generator refuses a seed unless each naive alternative implementation gives a different final text.
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyPatch } from '../tasks/bench-patch-exec/oracle/reference.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const WORDS = ['amber', 'birch', 'cedar', 'delta', 'ember', 'flint', 'grove', 'haze', 'iris', 'jade', 'kilo', 'lotus', 'mesa', 'nova', 'onyx', 'pearl'];

type Op = { kind: 'replace' | 'delete' | 'insert'; at: number; n: number; text: string[] };

export function makePatch(lines: string[], rand: () => number, hunks: number, tag: string) {
  // choose non-overlapping regions on the current text, in ascending order
  const out: string[] = [];
  let cursor = 0;
  let noteCount = 0;
  const step = Math.floor(lines.length / (hunks + 1));
  for (let h = 0; h < hunks; h++) {
    const lo = Math.max(cursor + 3, h * step + 2);
    const at = Math.min(lines.length - 4, lo + Math.floor(rand() * Math.max(1, step - 4)));
    if (at <= cursor + 2 || at + 4 > lines.length) break;
    const kind = (['replace', 'delete', 'insert', 'replace'] as const)[Math.floor(rand() * 4)];
    const ctxBefore = lines.slice(at - 1, at);
    const drift = Math.floor(rand() * 9) - 4; // wrong nominal header position, forces the offset search
    let old: string[] = []; let neu: string[] = []; let body: string[] = [];
    if (kind === 'replace') { old = lines.slice(at, at + 2); neu = [`${tag}${++noteCount}-${WORDS[Math.floor(rand() * 16)]}`, `${tag}${++noteCount}-${WORDS[Math.floor(rand() * 16)]}`]; body = [...old.map(l => '-' + l), ...neu.map(l => '+' + l)]; }
    else if (kind === 'delete') { old = lines.slice(at, at + 2); body = old.map(l => '-' + l); }
    else { neu = [`${tag}${++noteCount}-${WORDS[Math.floor(rand() * 16)]}`]; body = neu.map(l => '+' + l); }
    const ctxAfter = lines.slice(at + old.length, at + old.length + 1);
    const oldCount = ctxBefore.length + old.length + ctxAfter.length;
    const newCount = ctxBefore.length + neu.length + ctxAfter.length;
    const a = Math.max(1, at - 1 + 1 + drift);
    out.push(`@@ -${a},${oldCount} +${a},${newCount} @@`);
    out.push(...ctxBefore.map(l => ' ' + l), ...body, ...ctxAfter.map(l => ' ' + l));
    cursor = at + old.length + 2;
  }
  return out.join('\n') + '\n';
}

// Naive alternatives: each must give a different final text than the reference for the instance to count as a real trap.
export function naiveApply(original: string, patches: string[], variant: 'exact-only' | 'no-carry' | 'forward-first' | 'global-first'): string | null {
  let text = original;
  for (const patch of patches) {
    const lines = text.split('\n'); if (lines[lines.length - 1] === '') lines.pop();
    const hunks: { a: number; old: string[]; neu: string[] }[] = [];
    let cur: { a: number; old: string[]; neu: string[] } | null = null;
    for (const l of patch.split('\n')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(l);
      if (m) { cur = { a: Number(m[1]), old: [], neu: [] }; hunks.push(cur); continue; }
      if (!cur || l === '') continue;
      if (l[0] === ' ') { cur.old.push(l.slice(1)); cur.neu.push(l.slice(1)); } else if (l[0] === '-') cur.old.push(l.slice(1)); else if (l[0] === '+') cur.neu.push(l.slice(1));
    }
    const out: string[] = []; let pos = 0; let delta = 0; let prevEnd = 0;
    for (const h of hunks) {
      const nominal = h.a - 1; const start = nominal + (variant === 'no-carry' ? 0 : delta);
      const ok = (p: number) => p >= prevEnd && p >= 0 && p + h.old.length <= lines.length && h.old.every((s, i) => lines[p + i] === s);
      let placed = -1;
      if (variant === 'exact-only') { if (ok(start)) placed = start; }
      else if (variant === 'global-first') { for (let p = prevEnd; p + h.old.length <= lines.length; p++) if (ok(p)) { placed = p; break; } }
      else {
        for (let k = 0; k <= lines.length && placed < 0; k++) for (const p of variant === 'forward-first' ? (k === 0 ? [start] : [start + k, start - k]) : (k === 0 ? [start] : [start - k, start + k])) if (ok(p)) { placed = p; break; }
      }
      if (placed < 0) return null;
      while (pos < placed) out.push(lines[pos++]);
      out.push(...h.neu); pos = placed + h.old.length; delta = placed - nominal; prevEnd = pos;
    }
    while (pos < lines.length) out.push(lines[pos++]);
    text = out.join('\n') + '\n';
  }
  return text;
}

export function build(seed: number, nLines: number, nPatches: number) {
  const rand = rng(seed);
  // base lines: mostly unique, with a few deliberate duplicates so offset ties are real
  const base: string[] = [];
  for (let i = 1; i <= nLines; i++) base.push(rand() < 0.7 ? `dup-${WORDS[Math.floor(rand() * 4)]}` : `r${String(i).padStart(2, '0')}-${WORDS[Math.floor(rand() * 16)]}`);
  const original = base.join('\n') + '\n';
  const patches: string[] = [];
  let text = original;
  for (let p = 0; p < nPatches; p++) {
    const patch = makePatch(text.split('\n').slice(0, -1), rand, 4 + Math.floor(rand() * 2), String.fromCharCode(97 + p));
    patches.push(patch);
    try { text = applyPatch(text, patch); } catch { return null; }
  }
  return { original, patches, final: text };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [taskId, seedS, nLinesS, nPatchesS] = process.argv.slice(2);
  const seed0 = Number(seedS); const nLines = Number(nLinesS); const nPatches = Number(nPatchesS);
  let inst: NonNullable<ReturnType<typeof build>> | null = null; let seed = seed0;
  for (; seed < seed0 + 500; seed++) {
    const cand = build(seed, nLines, nPatches);
    if (!cand) continue;
    const alts = (['exact-only', 'no-carry', 'forward-first', 'global-first'] as const).map(v => naiveApply(cand.original, cand.patches, v));
    if (alts.every(a => a !== cand.final)) { inst = cand; break; }
  }
  if (!inst) throw new Error('no seed found where every naive variant differs');
  const dir = join(root, 'tasks', taskId);
  mkdirSync(join(dir, 'public'), { recursive: true }); mkdirSync(join(dir, 'oracle'), { recursive: true });
  writeFileSync(join(dir, 'task.json'), JSON.stringify({ task_id: taskId }) + '\n');
  writeFileSync(join(dir, 'public', 'original.txt'), inst.original);
  inst.patches.forEach((p, i) => writeFileSync(join(dir, 'public', `patch${i + 1}.diff`), p));
  if (!existsSync(join(dir, 'public', 'SPEC.md'))) copyFileSync(join(root, 'tasks', 'bench-patch-exec', 'public', 'SPEC.md'), join(dir, 'public', 'SPEC.md'));
  writeFileSync(join(dir, 'public', 'brief.txt'),
`Read SPEC.md. It defines exactly how one patch is applied to a text (applyPatch). Start from original.txt, apply patch1.diff with those rules, then apply patch2.diff to the RESULT, and so on through patch${nPatches}.diff, in order. Each patch is applied on its own: the delta and prevEnd values start again at 0 for every patch, and every patch's line numbers refer to the text produced by the previous patch.

Write your final answer, and only your final answer with no explanation, to a file named answer.txt in your current working directory: the lines of the final text, in order, joined by a single pipe character |, with no trailing pipe (an empty line is two pipes in a row).
`);
  const expected = inst.final.split('\n').slice(0, -1).join('|');
  writeFileSync(join(dir, 'oracle', 'oracle.json'), JSON.stringify({ kind: 'exact-answer', expected }, null, 2) + '\n');
  console.log(JSON.stringify({ taskId, seed, nLines, nPatches, finalLines: inst.final.split('\n').length - 1 }));
}
