export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

interface Line {
  text: string;
  noEol: boolean;
}

interface Hunk {
  nominal: number;
  old: Line[];
  neu: Line[];
}

function splitOriginal(s: string): Line[] {
  if (s === '') return [];
  const parts = s.split('\n');
  const lines: Line[] = [];
  if (parts[parts.length - 1] === '') {
    parts.pop();
    for (const t of parts) lines.push({ text: t, noEol: false });
  } else {
    for (const t of parts) lines.push({ text: t, noEol: false });
    lines[lines.length - 1].noEol = true;
  }
  return lines;
}

function parsePatch(patch: string): Hunk[] {
  const pl = patch.split('\n');
  if (pl[pl.length - 1] === '') pl.pop();
  let i = 0;
  while (i < pl.length && !pl[i].startsWith('@@')) i++;
  const hunks: Hunk[] = [];
  while (i < pl.length) {
    const line = pl[i];
    if (!line.startsWith('@@')) throw new PatchError('expected hunk header');
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) throw new PatchError('malformed hunk header');
    const A = Number(m[1]);
    const B = m[2] === undefined ? 1 : Number(m[2]);
    const D = m[4] === undefined ? 1 : Number(m[4]);
    if (B === 0 && D === 0) throw new PatchError('empty hunk');
    if (B > 0 && A === 0) throw new PatchError('invalid start');
    i++;
    const old: Line[] = [];
    const neu: Line[] = [];
    // last body line: refs to its old/new copies
    let last: { o?: Line; n?: Line; marked: boolean } | null = null;
    while (true) {
      const done = old.length === B && neu.length === D;
      const next = i < pl.length ? pl[i] : undefined;
      if (done && (next === undefined || next[0] !== '\\')) break;
      if (next === undefined) throw new PatchError('truncated hunk');
      i++;
      const c = next[0];
      const text = next.slice(1);
      if (c === '\\') {
        if (!last || last.marked) throw new PatchError('misplaced marker');
        last.marked = true;
        if (last.o) last.o.noEol = true;
        if (last.n) last.n.noEol = true;
      } else if (c === ' ') {
        if (old.length >= B || neu.length >= D) throw new PatchError('hunk overflow');
        const o = { text, noEol: false };
        const n = { text, noEol: false };
        old.push(o);
        neu.push(n);
        last = { o, n, marked: false };
      } else if (c === '-') {
        if (old.length >= B) throw new PatchError('hunk overflow');
        const o = { text, noEol: false };
        old.push(o);
        last = { o, marked: false };
      } else if (c === '+') {
        if (neu.length >= D) throw new PatchError('hunk overflow');
        const n = { text, noEol: false };
        neu.push(n);
        last = { n, marked: false };
      } else {
        throw new PatchError('invalid body line');
      }
    }
    for (const seq of [old, neu]) {
      for (let j = 0; j < seq.length - 1; j++) {
        if (seq[j].noEol) throw new PatchError('NO_EOL line not last');
      }
    }
    hunks.push({ nominal: B > 0 ? A - 1 : A, old, neu });
    if (i < pl.length && !pl[i].startsWith('@@')) {
      throw new PatchError('garbage after hunk');
    }
  }
  if (hunks.length === 0) throw new PatchError('no hunks');
  return hunks;
}

export function applyPatch(original: string, patch: string): string {
  if (typeof original !== 'string' || typeof patch !== 'string') {
    throw new PatchError('arguments must be strings');
  }
  const orig = splitOriginal(original);
  const n = orig.length;
  const hunks = parsePatch(patch);
  const out: Line[] = [];
  let delta = 0;
  let prevEnd = 0;
  let pos = 0; // next original index to copy
  for (const h of hunks) {
    const L = h.old.length;
    const start = h.nominal + delta;
    const lo = prevEnd;
    const hi = n - L;
    if (lo > hi) throw new PatchError('hunk does not fit');
    const matches = (p: number): boolean => {
      if (p < lo || p > hi) return false;
      for (let j = 0; j < L; j++) {
        const a = orig[p + j];
        const b = h.old[j];
        if (a.text !== b.text || a.noEol !== b.noEol) return false;
      }
      return true;
    };
    const maxK = Math.max(Math.abs(start - lo), Math.abs(start - hi));
    let placed = -1;
    for (let k = 0; k <= maxK; k++) {
      if (matches(start - k)) { placed = start - k; break; }
      if (k > 0 && matches(start + k)) { placed = start + k; break; }
    }
    if (placed < 0) throw new PatchError('hunk failed to apply');
    for (let j = pos; j < placed; j++) out.push(orig[j]);
    for (const l of h.neu) out.push(l);
    pos = placed + L;
    delta = placed - h.nominal;
    prevEnd = placed + L;
  }
  for (let j = pos; j < n; j++) out.push(orig[j]);
  let res = '';
  for (let j = 0; j < out.length; j++) {
    res += out[j].text;
    if (!(j === out.length - 1 && out[j].noEol)) res += '\n';
  }
  return res;
}
