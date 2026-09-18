// Hidden reference for GLEAM-8, used only to derive oracle.json.
import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').split('\n').map(l => l.replace(/;.*/, '').trim()).filter(Boolean);
const ins = [], labels = {};
for (let l of lines) {
  let m;
  while ((m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(l))) { labels[m[1]] = ins.length; l = m[2]; }
  if (l) { const [op, arg] = l.split(/\s+/, 2); ins.push({ op, arg }); }
}
const mem = new Array(32).fill(0); let A = 0, X = 0, Z = 0, N = 0, C = 0, pc = 0; const stack = [], out = [];
const addr = a => { const m = /^(\d+)(,X)?$/.exec(a); return (Number(m[1]) + (m[2] ? X : 0)) % 32; };
const val = a => a.startsWith('#') ? Number(a.slice(1)) : mem[addr(a)];
const HABIT = new Set((process.env.GLEAM_HABIT || '').split(',').filter(Boolean));
const flags = r => { C = r < 0 || r > 255 ? 1 : 0; const w = ((r % 256) + 256) % 256; Z = w === 0 ? 1 : 0; N = w >= 128 ? 1 : 0; return w; };
for (let steps = 0; steps < 1e6; steps++) {
  const { op, arg } = ins[pc++]; const c0 = C;
  switch (op) {
    case 'LDA': A = HABIT.has('load') ? (flags(val(arg)), C = c0, A = val(arg)) : flags(val(arg)); break;
    case 'LDX': X = HABIT.has('load') ? (flags(val(arg)), C = c0, val(arg)) : flags(val(arg)); break;
    case 'STA': mem[addr(arg)] = A; break;
    case 'STX': mem[addr(arg)] = X; break;
    case 'ADC': A = flags(A + val(arg) + c0); break;
    case 'SBC': A = flags(A - val(arg) - c0); break;
    case 'CMP': flags(A - val(arg)); break;
    case 'INX': { const r = X + 1; X = flags(r); if (HABIT.has('incdec')) C = c0; break; }
    case 'DEX': { const r = X - 1; X = flags(r); if (HABIT.has('incdec')) C = c0; break; }
    case 'ASL': A = flags(2 * A); break;
    case 'LSR': { const a0 = A; A = flags(Math.floor(A / 2)); if (HABIT.has('shift')) C = a0 & 1; break; }
    case 'ROL': A = flags(2 * A + c0); break;
    case 'ROR': { const a0 = A; A = flags(Math.floor(A / 2) + 128 * c0); if (HABIT.has('shift')) C = a0 & 1; break; }
    case 'SEC': C = 1; break;
    case 'CLC': C = 0; break;
    case 'BEQ': if (Z) pc = labels[arg]; break;
    case 'BNE': if (!Z) pc = labels[arg]; break;
    case 'BCS': if (C) pc = labels[arg]; break;
    case 'BCC': if (!C) pc = labels[arg]; break;
    case 'BMI': if (N) pc = labels[arg]; break;
    case 'BPL': if (!N) pc = labels[arg]; break;
    case 'JMP': pc = labels[arg]; break;
    case 'JSR': stack.push(pc); pc = labels[arg]; break;
    case 'RTS': pc = stack.pop(); break;
    case 'OUT': out.push(A); break;
    case 'OUTX': out.push(X); break;
    case 'HLT': console.log(out.join(' ')); process.exit(0);
    default: throw new Error('bad op ' + op);
  }
}
throw new Error('step limit');
