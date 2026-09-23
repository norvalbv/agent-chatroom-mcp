/** Pool-throughput harness CLI (docs/experiments/2026-09-23-pool-throughput.md).
 *   node --import tsx scripts/pool.ts lock --pool DIR
 *   node --import tsx scripts/pool.ts validate --pool DIR [--hidden PARENT] [--scratch DIR]
 * --hidden is the parent of <pool>/<item-id>/ (default $POOL_HIDDEN_ROOT, else ~/.agent-chatroom-hidden). */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockPool, validatePool } from './pool-format.ts';

export function flags(args: string[]) {
  return (key: string, fallback?: string) => { const n = args.indexOf('--' + key); return n < 0 ? fallback : args[n + 1]; };
}

async function main(argv: string[]) {
  const [command, ...args] = argv;
  const flag = flags(args);
  const need = (key: string) => { const v = flag(key); if (!v) throw new Error(`--${key} required`); return v; };
  switch (command) {
    case 'lock':
      console.log(lockPool(need('pool')));
      return 0;
    case 'validate': {
      const report = validatePool(need('pool'), { hiddenParent: flag('hidden'), scratch: flag('scratch') });
      console.log(JSON.stringify(report, null, 2));
      for (const r of report.items) console.error(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}: fails at base=${r.fails_at_base} passes with reference=${r.passes_with_reference}${r.error ? ' (' + r.error + ')' : ''}`);
      return report.ok ? 0 : 1;
    }
    default:
      console.error('usage: pool.ts lock|validate ... (see header)');
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error(String(e instanceof Error ? e.message : e)); process.exitCode = 2; });
}
