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

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function splitOriginal(original: string): Line[] {
  if (original === '') return [];
  const parts = original.split('\n');
  const lines: Line[] = [];
  if (parts[parts.length - 1] === '') {
    parts.pop();
    for (const t of parts) lines.push({ text: t, noEol: false });
  } else {
    parts.forEach((t, i) => lines.push({ text: t, noEol: i === parts.length - 1 }));
  }
  return lines;
}

function parsePatch(patch: string): Hunk[] {
  const lines = patch.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('@@')) i++;
  const hunks: Hunk[] = [];
  while (i < lines.length) {
    const m = HEADER.exec(lines[i]);
    if (!m) throw new PatchError('bad hunk header');
    i++;
    const A = parseInt(m[1], 10);
    const B = m[2] === undefined ? 1 : parseInt(m[2], 10);
    const D = m[4] === undefined ? 1 : parseInt(m[4], 10);
    if (B === 0 && D === 0) throw new PatchError('empty hunk');
    if (B > 0 && A === 0) throw new PatchError('bad start');
    const old: Line[] = [];
    const neu: Line[] = [];
    // last body line: its copies in old/new, and whether marked
    let last: { o?: Line; n?: Line; marked: boolean } | null = null;
    while (true) {
      const done = old.length === B && neu.length === D;
      if (done && !(i < lines.length && lines[i].startsWith('\\'))) break;
      if (i >= lines.length) throw new PatchError('truncated hunk');
      const l = lines[i++];
      const c = l.charAt(0);
      const text = l.slice(1);
      if (c === '\\') {
        if (!last || last.marked) throw new PatchError('bad marker');
        if (last.o) last.o.noEol = true;
        if (last.n) last.n.noEol = true;
        last.marked = true;
      } else if (c === ' ') {
        if (old.length >= B || neu.length >= D) throw new PatchError('too many lines');
        const o = { text, noEol: false };
        const n = { text, noEol: false };
        old.push(o);
        neu.push(n);
        last = { o, n, marked: false };
      } else if (c === '-') {
        if (old.length >= B) throw new PatchError('too many old lines');
        const o = { text, noEol: false };
        old.push(o);
        last = { o, marked: false };
      } else if (c === '+') {
        if (neu.length >= D) throw new PatchError('too many new lines');
        const n = { text, noEol: false };
        neu.push(n);
        last = { n, marked: false };
      } else {
        throw new PatchError('bad body line');
      }
    }
    for (const seq of [old, neu]) {
      for (let k = 0; k < seq.length - 1; k++) {
        if (seq[k].noEol) throw new PatchError('NO_EOL not last');
      }
    }
    if (i < lines.length && !lines[i].startsWith('@@')) throw new PatchError('garbage after hunk');
    hunks.push({ nominal: B > 0 ? A - 1 : A, old, neu });
  }
  if (hunks.length === 0) throw new PatchError('no hunks');
  return hunks;
}

function matches(orig: Line[], p: number, old: Line[]): boolean {
  for (let k = 0; k < old.length; k++) {
    const a = orig[p + k];
    const b = old[k];
    if (a.text !== b.text || a.noEol !== b.noEol) return false;
  }
  return true;
}

export function applyPatch(original: string, patch: string): string {
  const orig = splitOriginal(original);
  const hunks = parsePatch(patch);
  const n = orig.length;
  const out: Line[] = [];
  let delta = 0;
  let prevEnd = 0;
  let copied = 0; // original lines already emitted
  for (const h of hunks) {
    const L = h.old.length;
    const start = h.nominal + delta;
    const ok = (p: number) =>
      p >= 0 && p <= n - L && p >= prevEnd && matches(orig, p, h.old);
    let placed = -1;
    const maxK = Math.abs(start) + n + 2;
    for (let k = 0; k <= maxK; k++) {
      if (ok(start - k)) { placed = start - k; break; }
      if (k > 0 && ok(start + k)) { placed = start + k; break; }
    }
    if (placed < 0) throw new PatchError('hunk does not apply');
    for (; copied < placed; copied++) out.push(orig[copied]);
    for (const l of h.neu) out.push({ text: l.text, noEol: l.noEol });
    copied = placed + L;
    delta = placed - h.nominal;
    prevEnd = placed + L;
  }
  for (; copied < n; copied++) out.push(orig[copied]);
  let res = '';
  out.forEach((l, i) => {
    res += l.text;
    if (!(i === out.length - 1 && l.noEol)) res += '\n';
  });
  return res;
}
