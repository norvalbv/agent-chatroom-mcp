type V = number | V[];
type Scope = Map<string, V>;
type Proc = { params: string[]; body: string[] };

function tokenize(s: string): string[] {
  return s.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean);
}
function copyDeep(v: V): V {
  return Array.isArray(v) ? v.map(copyDeep) : v;
}
function show(v: V): string {
  return Array.isArray(v) ? `[${v.map(show).join(',')}]` : String(v);
}

export function runShelf(source: string): string[] {
  const lines = source.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  const out: string[] = [];
  const globals: Scope = new Map();
  const procs = new Map<string, Proc>();

  function parseExpr(t: string[], pos: { i: number }, scope: Scope): V {
    const tok = t[pos.i++];
    if (tok !== '(') {
      if (/^-?\d+$/.test(tok)) return Number(tok);
      return lookup(tok, scope);
    }
    const op = t[pos.i++];
    const args: V[] = [];
    while (t[pos.i] !== ')') args.push(parseExpr(t, pos, scope));
    pos.i++;
    switch (op) {
      case '+': {
        const [a, b] = args;
        if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
        return (a as number) + (b as number);
      }
      case '-': return (args[0] as number) - (args[1] as number);
      case '*': return (args[0] as number) * (args[1] as number);
      case '<': return (args[0] as number) < (args[1] as number) ? 1 : 0;
      case '=': return args[0] === args[1] ? 1 : 0;
      case 'list': return [...args];
      case 'idx': return (args[0] as V[])[args[1] as number];
      case 'len': return (args[0] as V[]).length;
      default: throw new Error(`bad op ${op}`);
    }
  }
  function lookup(name: string, scope: Scope): V {
    if (scope.has(name)) return scope.get(name)!;
    if (globals.has(name)) return globals.get(name)!;
    throw new Error(`unbound ${name}`);
  }
  function blockEnd(from: number): { elseAt: number; endAt: number } {
    let depth = 0, elseAt = -1;
    for (let i = from; i < lines.length; i++) {
      const head = lines[i].split(/\s+/)[0];
      if (['IF', 'REPEAT', 'FOR', 'DEF'].includes(head)) depth++;
      else if (head === 'ELSE' && depth === 1) elseAt = i;
      else if (head === 'END') { depth--; if (depth === 0) return { elseAt, endAt: i }; }
    }
    throw new Error('unterminated block');
  }
  function exec(body: string[], scope: Scope) {
    const saved = lines.slice();
    void saved;
    runLines(body, scope);
  }
  function runLines(ls: string[], scope: Scope) {
    for (let i = 0; i < ls.length; i++) {
      const line = ls[i];
      const t = tokenize(line);
      const head = t[0];
      const evalAt = (start: number) => { const pos = { i: start }; const v = parseExpr(t, pos, scope); return { v, next: pos.i }; };
      const blockOf = (): { inner: string[]; elseInner: string[] | null; endIdx: number } => {
        let depth = 0, elseIdx = -1, endIdx = -1;
        for (let j = i; j < ls.length; j++) {
          const h = ls[j].split(/\s+/)[0];
          if (['IF', 'REPEAT', 'FOR', 'DEF'].includes(h)) depth++;
          else if (h === 'ELSE' && depth === 1) elseIdx = j;
          else if (h === 'END') { depth--; if (depth === 0) { endIdx = j; break; } }
        }
        const inner = ls.slice(i + 1, elseIdx >= 0 ? elseIdx : endIdx);
        const elseInner = elseIdx >= 0 ? ls.slice(elseIdx + 1, endIdx) : null;
        return { inner, elseInner, endIdx };
      };
      switch (head) {
        case 'LET': { const { v } = evalAt(2); scope.set(t[1], copyDeep(v)); break; }
        case 'PUSH': { const { v } = evalAt(2); (lookup(t[1], scope) as V[]).push(v); break; }
        case 'SET': { const a = evalAt(2); const b = (() => { const pos = { i: a.next }; return parseExpr(t, pos, scope); })(); (lookup(t[1], scope) as V[])[a.v as number] = b; break; }
        case 'PRINT': { out.push(show(evalAt(1).v)); break; }
        case 'IF': { const { v } = evalAt(1); const b = blockOf(); if (v !== 0) runLines(b.inner, scope); else if (b.elseInner) runLines(b.elseInner, scope); i = b.endIdx; break; }
        case 'REPEAT': { const { v } = evalAt(1); const b = blockOf(); for (let n = 0; n < (v as number); n++) runLines(b.inner, scope); i = b.endIdx; break; }
        case 'FOR': { const { v } = evalAt(2); const b = blockOf(); const snap = [...(v as V[])]; for (const el of snap) { scope.set(t[1], el); runLines(b.inner, scope); } i = b.endIdx; break; }
        case 'DEF': { const b = blockOf(); procs.set(t[1], { params: t.slice(2), body: b.inner }); i = b.endIdx; break; }
        case 'RUN': {
          const pos = { i: 2 }; const args: V[] = [];
          while (pos.i < t.length) args.push(parseExpr(t, pos, scope));
          const proc = procs.get(t[1])!;
          const local: Scope = new Map();
          proc.params.forEach((p, k) => local.set(p, args[k]));
          runLines(proc.body, local);
          break;
        }
        default: throw new Error(`bad statement ${line}`);
      }
    }
  }
  void blockEnd; void exec;
  runLines(lines, globals);
  return out;
}
