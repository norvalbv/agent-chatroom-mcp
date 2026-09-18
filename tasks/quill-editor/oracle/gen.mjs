// Hidden generator: node gen.mjs SEED -> program on stdout. Biased toward states where the wrong readings differ.
import { run } from './reference.mjs';
const seed = Number(process.argv[2] ?? 1);
let x = seed >>> 0 || 1; const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; };
const pick = a => a[Math.floor(rnd() * a.length)];
const W = ['ant','bee','cat','dog','eel','fox','gnu','hen','ibis','jay','kiwi','lark','mole','newt','owl'];
const N = ['p','q','r','s','t'];
const cmds = () => {
  const r = rnd();
  if (r < .14) return `ADD ${pick(W)}`; if (r < .22) return `INS ${pick(W)}`;
  if (r < .29) return 'DEL'; if (r < .35) return `UP ${1 + Math.floor(rnd() * 3)}`; if (r < .41) return `DN ${1 + Math.floor(rnd() * 3)}`;
  if (r < .43) return 'FIRST'; if (r < .45) return 'LAST';
  if (r < .53) return `MARK ${pick(N)}`; if (r < .60) return `GO ${pick(N)}`;
  if (r < .68) return 'SWAP'; if (r < .72) return `YANK ${1 + Math.floor(rnd() * 3)}`; if (r < .77) return `CUT ${1 + Math.floor(rnd() * 3)}`;
  if (r < .82) return 'PASTE'; if (r < .90) return 'UNDO'; if (r < .95) return 'SHOW'; return 'DUMP';
};
const out = [];
const total = Number(process.argv[3] ?? 150);
while (out.length < total) {
  if (rnd() < .06) { const n = 2 + Math.floor(rnd() * 3); out.push(`REPEAT ${n}`); const k = 2 + Math.floor(rnd() * 4); for (let i = 0; i < k; i++) out.push('  ' + cmds()); out.push('END'); }
  else out.push(cmds());
  if (out.length % 12 === 0) out.push('DUMP');
}
out.push('DUMP'); out.push('SHOW');
process.stdout.write(out.join('\n') + '\n');
