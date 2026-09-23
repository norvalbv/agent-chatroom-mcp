/** Pool-throughput harness CLI (docs/experiments/2026-09-23-pool-throughput.md).
 *   node --import tsx scripts/pool.ts lock --pool DIR
 *   node --import tsx scripts/pool.ts validate --pool DIR [--hidden PARENT] [--scratch DIR] [--repeats N (default 3)] [--suite]
 *        [--suite-view] [--suite-view-cmd CMD]   (secondary, not pre-registered: suite_cmd at base, per command, into DIR/suite-base.json;
 *                                                 --suite implies it; CMD may write a vitest --reporter=json report to "$SUITE_REPORT")
 *   node --import tsx scripts/pool.ts run --pool DIR --arm solo|split|room3|room15 --rep N [--scratch DIR] [--switch-log FILE] [--port N]
 *        [--fake-solutions FILE] [--deadline-ms N]   (fake seats and a shortened deadline are for dry runs only; prints the run dir)
 *   node --import tsx scripts/pool.ts finalize --run R
 *   node --import tsx scripts/pool.ts score --run R [--hidden PARENT]   (also runs the audit)
 *   node --import tsx scripts/pool.ts audit --run R [--hidden PARENT]   (exit 1 when the run is void)
 * --hidden is the parent of <pool>/<item-id>/ (default $POOL_HIDDEN_ROOT, else ~/.agent-chatroom-hidden). */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockPool, validatePool } from './pool-format.ts';
import { recordSuiteBase, SECONDARY_NOTE, SUITE_BASE_FILE } from './pool-suite-view.ts';
import { auditRun, finalizeRun, scoreRun } from './pool-score.ts';
import { ARMS, runArm, type Arm } from './pool-run.ts';

export function flags(args: string[]) {
  return (key: string, fallback?: string) => { const n = args.indexOf('--' + key); return n < 0 ? fallback : args[n + 1]; };
}

export type ValidateOptions = { hiddenParent?: string; scratch?: string; repeats?: number; suite?: boolean; suiteView?: boolean; suiteViewCmd?: string };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** validatePool, then the optional suite record at base. It never changes an item's ok or the report's ok: it is a secondary,
 * not pre-registered record (todo/pass-to-pass-score-view.md). */
export function validateAll(poolDir: string, o: ValidateOptions = {}) {
  const scratch = o.scratch ? resolve(o.scratch) : mkdtempSync(join(realpathSync(tmpdir()), 'pool-validate-'));
  const report = validatePool(poolDir, { hiddenParent: o.hiddenParent, scratch, repeats: o.repeats, suite: o.suite });
  let suite_base;
  if (o.suite || o.suiteView || o.suiteViewCmd) {
    try {
      const rec = recordSuiteBase(poolDir, { scratch, viewCmd: o.suiteViewCmd }), c = rec.view.commands;
      suite_base = { note: SECONDARY_NOTE, file: SUITE_BASE_FILE, view_cmd: rec.view_cmd, format: rec.view.format, complete: rec.view.complete, exit_code: rec.view.exit_code,
        commands: c ? Object.keys(c).length : null, not_passing: c ? Object.keys(c).filter(n => c[n] !== 'passed').sort() : null };
    } catch (e) { suite_base = { note: SECONDARY_NOTE, file: SUITE_BASE_FILE, error: message(e) }; }
  }
  return { ...report, ...(suite_base ? { suite_base } : {}) };
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
      const report = validateAll(need('pool'), { hiddenParent: flag('hidden'), scratch: flag('scratch'), repeats: flag('repeats') ? Number(flag('repeats')) : undefined,
        suite: args.includes('--suite'), suiteView: args.includes('--suite-view'), suiteViewCmd: flag('suite-view-cmd') });
      console.log(JSON.stringify(report, null, 2));
      for (const r of report.items) console.error(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}: fails at base=${r.fails_at_base} passes with reference=${r.passes_with_reference}${r.names_in_repo.length || r.names_in_briefs.length ? ` hidden names already visible: ${[...r.names_in_repo, ...r.names_in_briefs].join(', ')}` : ''}${r.error ? ' (' + r.error + ')' : ''}`);
      const sb = report.suite_base;
      if (sb) console.error('error' in sb ? `suite at base (secondary, not pre-registered): not recorded: ${sb.error}`
        : `suite at base (secondary, not pre-registered): ${sb.format}, ${sb.commands ?? 'no per-command'} results, not passing: ${sb.not_passing?.join(', ') || 'none'}; written to ${sb.file}`);
      return report.ok ? 0 : 1;
    }
    case 'run': {
      const arm = need('arm') as Arm, rep = Number(need('rep'));
      if (!ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join('|')}`);
      const fake = flag('fake-solutions');
      console.log(await runArm({ poolDir: resolve(need('pool')), arm, rep, scratch: resolve(flag('scratch', join(realpathSync(tmpdir()), 'pool-runs'))!),
        switchLog: flag('switch-log'), port: flag('port') ? Number(flag('port')) : undefined,
        deadlineMs: flag('deadline-ms') ? Number(flag('deadline-ms')) : undefined, fake: fake ? { solutions: resolve(fake) } : undefined }));
      return 0;
    }
    case 'finalize':
      console.log(JSON.stringify(finalizeRun(need('run')), null, 2));
      return 0;
    case 'score':
      console.log(JSON.stringify(scoreRun(need('run'), { hiddenParent: flag('hidden') }), null, 2));
      return 0;
    case 'audit': {
      const audit = auditRun(need('run'), { hiddenParent: flag('hidden') });
      console.log(JSON.stringify(audit, null, 2));
      return audit.void ? 1 : 0;
    }
    default:
      console.error('usage: pool.ts lock|validate|run|finalize|score|audit ... (see header)');
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error(String(e instanceof Error ? e.message : e)); process.exitCode = 2; });
}
