export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

interface Line {
  c: string;
  noEol: boolean;
}

interface BodyLine {
  kind: ' ' | '-' | '+';
  c: string;
  marked: boolean;
}

interface Hunk {
  a: number;
  b: number;
  old: Line[];
  neu: Line[];
}

function splitOriginal(original: string): Line[] {
  if (original === '') return [];
  const parts = original.split('\n');
  const lines: Line[] = [];
  if (parts[parts.length - 1] === '') {
    parts.pop();
    for (const c of parts) lines.push({ c, noEol: false });
  } else {
    parts.forEach((c, i) => lines.push({ c, noEol: i === parts.length - 1 }));
  }
  return lines;
}

function parseHunks(patch: string): Hunk[] {
  const pl = patch.split('\n');
  if (pl[pl.length - 1] === '') pl.pop();
  let i = 0;
  while (i < pl.length && !pl[i].startsWith('@@')) i++;
  const hunks: Hunk[] = [];
  while (i < pl.length) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(pl[i]);
    if (!m) throw new PatchError('bad hunk header');
    i++;
    const a = Number(m[1]);
    const b = m[2] === undefined ? 1 : Number(m[2]);
    const d = m[4] === undefined ? 1 : Number(m[4]);
    if (b === 0 && d === 0) throw new PatchError('empty hunk');
    if (b > 0 && a === 0) throw new PatchError('bad start');
    const body: BodyLine[] = [];
    let oc = 0;
    let nc = 0;
    for (;;) {
      const complete = oc === b && nc === d;
      if (i >= pl.length) {
        if (complete) break;
        throw new PatchError('truncated hunk');
      }
      const line = pl[i];
      if (line.length > 0 && line[0] === '\\') {
        if (body.length === 0 || body[body.length - 1].marked) {
          throw new PatchError('misplaced marker');
        }
        body[body.length - 1].marked = true;
        i++;
        continue;
      }
      if (complete) break;
      const ch = line[0];
      if (line === '' || (ch !== ' ' && ch !== '-' && ch !== '+')) {
        throw new PatchError('bad body line');
      }
      if (ch !== '+') {
        if (oc >= b) throw new PatchError('too many old lines');
        oc++;
      }
      if (ch !== '-') {
        if (nc >= d) throw new PatchError('too many new lines');
        nc++;
      }
      body.push({ kind: ch, c: line.slice(1), marked: false });
      i++;
    }
    if (i < pl.length && !pl[i].startsWith('@@')) {
      throw new PatchError('garbage after hunk');
    }
    const old: Line[] = [];
    const neu: Line[] = [];
    for (const bl of body) {
      if (bl.kind !== '+') old.push({ c: bl.c, noEol: bl.marked });
      if (bl.kind !== '-') neu.push({ c: bl.c, noEol: bl.marked });
    }
    for (const seq of [old, neu]) {
      for (let k = 0; k < seq.length - 1; k++) {
        if (seq[k].noEol) throw new PatchError('no-eol line not last');
      }
    }
    hunks.push({ a, b, old, neu });
  }
  if (hunks.length === 0) throw new PatchError('no hunks');
  return hunks;
}

export function applyPatch(original: string, patch: string): string {
  try {
    const lines = splitOriginal(original);
    const n = lines.length;
    const hunks = parseHunks(patch);
    const out: Line[] = [];
    let delta = 0;
    let prevEnd = 0;
    let pos = 0; // next original line to copy
    for (const h of hunks) {
      const L = h.old.length;
      const nominal = h.b > 0 ? h.a - 1 : h.a;
      const start = nominal + delta;
      const lo = prevEnd;
      const hi = n - L;
      if (lo > hi) throw new PatchError('hunk cannot be placed');
      const matches = (p: number): boolean => {
        if (p < lo || p > hi) return false;
        for (let j = 0; j < L; j++) {
          const x = lines[p + j];
          const y = h.old[j];
          if (x.c !== y.c || x.noEol !== y.noEol) return false;
        }
        return true;
      };
      let k0 = 0;
      if (start > hi) k0 = start - hi;
      else if (start < lo) k0 = lo - start;
      let placed = -1;
      const limit = 2 * (n + 2);
      for (let t = 0; t <= limit; t++) {
        const k = k0 + t;
        if (k === 0) {
          if (matches(start)) {
            placed = start;
            break;
          }
          continue;
        }
        if (matches(start - k)) {
          placed = start - k;
          break;
        }
        if (matches(start + k)) {
          placed = start + k;
          break;
        }
      }
      if (placed < 0) throw new PatchError('hunk does not match');
      for (let j = pos; j < placed; j++) out.push(lines[j]);
      for (const l of h.neu) out.push(l);
      pos = placed + L;
      delta = placed - nominal;
      prevEnd = placed + L;
    }
    for (let j = pos; j < n; j++) out.push(lines[j]);
    let res = '';
    out.forEach((l, idx) => {
      res += l.c;
      if (!(l.noEol && idx === out.length - 1)) res += '\n';
    });
    return res;
  } catch (e) {
    if (e instanceof PatchError) throw e;
    throw new PatchError(String(e));
  }
}
