// Hidden reference interpreter for quill-editor. Optional 2nd arg: a deliberately wrong reading (used only by tests to prove each corner is exercised).
import { readFileSync } from 'node:fs';
const VARIANT = process.argv[3] ?? '';
export function run(text, variant = VARIANT) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(' '));
  // structure: build tree of REPEAT blocks
  const root = []; const stack = [root];
  for (const t of lines) {
    if (t[0] === 'REPEAT') { const b = { n: Number(t[1]), body: [] }; stack.at(-1).push(b); stack.push(b.body); }
    else if (t[0] === 'END') stack.pop();
    else stack.at(-1).push(t);
  }
  let buf = []; let cur = -1; let clip = []; const hist = []; const out = [];
  const snap = () => ({ buf: buf.map(l => ({ w: l.w, names: new Set(l.names) })), cur, clip: [...clip] });
  const restore = s => { buf = s.buf.map(l => ({ w: l.w, names: new Set(l.names) })); cur = s.cur; };
  const same = (a, b) => a.cur === b.cur && a.buf.length === b.buf.length && a.buf.every((l, i) => l.w === b.buf[i].w && l.names.size === b.buf[i].names.size);
  const clamp = () => { if (!buf.length) cur = -1; };
  function step(t) {
    const c = t[0];
    const before = snap();
    let changes = false;
    const commit = () => { if (variant === 'undoCountsNoops' || !same(before, snap())) hist.push(before); };
    if (c === 'ADD' || c === 'INS') {
      const line = { w: t[1], names: new Set() };
      if (!buf.length) { buf.push(line); cur = 0; }
      else if (c === 'ADD') { buf.splice(cur + 1, 0, line); cur = cur + 1; }
      else { buf.splice(cur, 0, line); }
      if (c === 'INS' && buf.length > 1) cur = cur; // cursor onto the new line (same index)
      commit();
    } else if (c === 'DEL') {
      if (buf.length) { buf.splice(cur, 1); if (variant === 'delCursorPrev') cur = Math.max(0, cur - 1); else if (cur >= buf.length) cur = buf.length - 1; clamp(); commit(); }
    } else if (c === 'UP') { if (buf.length) cur = Math.max(0, cur - Number(t[1])); }
    else if (c === 'DN') { if (buf.length) cur = Math.min(buf.length - 1, cur + Number(t[1])); }
    else if (c === 'FIRST') { if (buf.length) cur = 0; }
    else if (c === 'LAST') { if (buf.length) cur = buf.length - 1; }
    else if (c === 'MARK') {
      if (buf.length) { if (variant !== 'markKeepsBoth') for (const l of buf) l.names.delete(t[1]); buf[cur].names.add(t[1]); }
    } else if (c === 'GO') { const i = buf.findIndex(l => l.names.has(t[1])); if (i >= 0) cur = i; }
    else if (c === 'SWAP') {
      if (buf.length && cur < buf.length - 1) {
        const a = buf[cur], b = buf[cur + 1];
        if (variant === 'swapNamesStay') { const na = a.names; a.names = b.names; b.names = na; }
        buf[cur] = b; buf[cur + 1] = a;
        if (variant !== 'swapCursorPos') cur = cur + 1;
        commit();
      }
    } else if (c === 'YANK') { if (buf.length) clip = buf.slice(cur, cur + Number(t[1])).map(l => l.w); }
    else if (c === 'CUT') {
      if (buf.length) {
        const n = Number(t[1]); const removed = buf.slice(cur, cur + n);
        clip = removed.map(l => l.w);
        if (removed.length) {
          buf.splice(cur, removed.length);
          if (variant === 'cutCursorPrev') cur = Math.max(0, cur - 1); else if (cur >= buf.length) cur = buf.length - 1;
          clamp(); commit();
        }
      }
    } else if (c === 'PASTE') {
      if (clip.length) {
        const nl = clip.map(w => ({ w, names: new Set() }));
        if (!buf.length) { buf = nl; cur = variant === 'pasteCursorFirst' ? 0 : nl.length - 1; }
        else { buf.splice(cur + 1, 0, ...nl); cur = variant === 'pasteCursorFirst' ? cur + 1 : cur + nl.length; }
        commit();
      }
    } else if (c === 'UNDO') {
      if (hist.length) {
        const s = hist.pop();
        const cl = clip;
        if (variant === 'undoUndoable') hist.push(snap());
        if (variant === 'undoKeepsNames') {
          const idx = new Map(); buf.forEach((l, i) => l.names.forEach(n => idx.set(n, i)));
          restore(s); for (const l of buf) l.names.clear();
          for (const [n, i] of idx) if (i < buf.length) buf[i].names.add(n);
        } else restore(s);
        clip = variant === 'undoRestoresClipboard' ? s.clip : cl;
      }
    } else if (c === 'SHOW') { if (buf.length) out.push(buf[cur].w); }
    else if (c === 'DUMP') out.push(buf.length ? buf.map(l => l.w).join(',') : '-');
    else throw new Error('bad command ' + c);
  }
  function exec(items) { for (const it of items) { if (Array.isArray(it)) step(it); else for (let i = 0; i < it.n; i++) exec(it.body); } }
  exec(root);
  return out.join(' ');
}
if (process.argv[1] && process.argv[1].endsWith('reference.mjs') && process.argv[2]) process.stdout.write(run(readFileSync(process.argv[2], 'utf8')) + '\n');
