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
  a: number;
  b: number;
  old: Line[];
  neu: Line[];
}

function splitLines(s: string): Line[] {
  if (s === '') return [];
  const parts = s.split('\n');
  const endsWithNewline = parts[parts.length - 1] === '';
  if (endsWithNewline) parts.pop();
  return parts.map((text, i) => ({ text, noEol: !endsWithNewline && i === parts.length - 1 }));
}

function parse(patch: string): Hunk[] {
  const lines = patch.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('@@')) i++;
  while (i < lines.length) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
    if (!lines[i].startsWith('@@') || !m) throw new PatchError('bad hunk header');
    const a = Number(m[1]);
    const b = m[2] === undefined ? 1 : Number(m[2]);
    const d = m[4] === undefined ? 1 : Number(m[4]);
    if (b === 0 && d === 0) throw new PatchError('empty hunk');
    if (b > 0 && a < 1) throw new PatchError('bad start');
    i++;
    const old: Line[] = [];
    const neu: Line[] = [];
    let last: { o?: Line; n?: Line; marked: boolean } | null = null;
    for (;;) {
      const ln = i < lines.length ? lines[i] : undefined;
      if (ln !== undefined && ln[0] === '\\') {
        if (!last || last.marked) throw new PatchError('bad marker');
        if (last.o) last.o.noEol = true;
        if (last.n) last.n.noEol = true;
        last.marked = true;
        i++;
        continue;
      }
      if (old.length === b && neu.length === d) break;
      if (ln === undefined) throw new PatchError('truncated hunk');
      const ch = ln[0];
      const text = ln.slice(1);
      if (ch === ' ') {
        if (old.length >= b || neu.length >= d) throw new PatchError('too many lines');
        const o = { text, noEol: false };
        const n = { text, noEol: false };
        old.push(o);
        neu.push(n);
        last = { o, n, marked: false };
      } else if (ch === '-') {
        if (old.length >= b) throw new PatchError('too many lines');
        const o = { text, noEol: false };
        old.push(o);
        last = { o, marked: false };
      } else if (ch === '+') {
        if (neu.length >= d) throw new PatchError('too many lines');
        const n = { text, noEol: false };
        neu.push(n);
        last = { n, marked: false };
      } else {
        throw new PatchError('malformed body line');
      }
      i++;
    }
    if (old.some((l, idx) => l.noEol && idx !== old.length - 1)) throw new PatchError('misplaced marker');
    if (neu.some((l, idx) => l.noEol && idx !== neu.length - 1)) throw new PatchError('misplaced marker');
    hunks.push({ a, b, old, neu });
  }
  return hunks;
}

function matches(file: Line[], p: number, old: Line[]): boolean {
  for (let k = 0; k < old.length; k++) {
    if (file[p + k].text !== old[k].text || file[p + k].noEol !== old[k].noEol) return false;
  }
  return true;
}

export function applyPatch(original: string, patch: string): string {
  const file = splitLines(original);
  const hunks = parse(patch);
  if (hunks.length === 0) throw new PatchError('no hunks');
  const n = file.length;
  let delta = 0;
  let prevEnd = 0;
  let cursor = 0;
  const out: Line[] = [];
  for (const h of hunks) {
    const L = h.old.length;
    const nominal = h.b > 0 ? h.a - 1 : h.a;
    const start = nominal + delta;
    const maxK = n + Math.abs(start) + 1;
    let placed = -1;
    for (let k = 0; k <= maxK && placed < 0; k++) {
      for (const p of k === 0 ? [start] : [start - k, start + k]) {
        if (p < 0 || p > n - L || p < prevEnd) continue;
        if (matches(file, p, h.old)) {
          placed = p;
          break;
        }
      }
    }
    if (placed < 0) throw new PatchError('hunk does not apply');
    for (; cursor < placed; cursor++) out.push(file[cursor]);
    for (const l of h.neu) out.push({ ...l });
    cursor = placed + L;
    delta = placed - nominal;
    prevEnd = placed + L;
  }
  for (; cursor < n; cursor++) out.push(file[cursor]);
  return out.map((l, i) => l.text + (i === out.length - 1 && l.noEol ? '' : '\n')).join('');
}
