/** Pool-throughput harness CLI (docs/experiments/2026-09-23-pool-throughput.md).
 *   node --import tsx scripts/pool.ts lock --pool DIR
 *   node --import tsx scripts/pool.ts validate --pool DIR [--hidden PARENT] [--scratch DIR] [--repeats N (default 3)] [--suite]
 *        [--suite-view] [--suite-view-cmd CMD]   (secondary, not pre-registered: suite_cmd at base, per command, into DIR/suite-base.json;
 *                                                 --suite implies it; CMD may write a vitest --reporter=json report to "$SUITE_REPORT")
 *        [--mutation] [--mutation-concurrency N (default 1)] [--mutation-timeout-min N (default 30)]   (StrykerJS on the lines
 *                                                 reference.patch changes; surviving mutants are flags for a human, never rejections)
 *   node --import tsx scripts/pool.ts run --pool DIR --arm solo|split|room3|room15 --rep N [--scratch DIR] [--switch-log FILE] [--port N]
 *        [--fake-solutions FILE] [--deadline-ms N]   (fake seats and a shortened deadline are for dry runs only; prints the run dir)
 *   node --import tsx scripts/pool.ts finalize --run R
 *   node --import tsx scripts/pool.ts score --run R [--hidden PARENT]   (also runs the audit)
 *   node --import tsx scripts/pool.ts audit --run R [--hidden PARENT]   (exit 1 when the run is void)
 * --hidden is the parent of <pool>/<item-id>/ (default $POOL_HIDDEN_ROOT, else ~/.agent-chatroom-hidden). */
import { mkdtempSync, realpathSync, writeSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hiddenRoot, Interrupted, letSignalsIn, loadHiddenItem, loadPool, lockPool, validatePool, type ValidateItem } from './pool-format.ts';
import { MUTATION_NOTE, mutationCheckItem, type MutationResult } from './pool-mutation.ts';
import { recordSuiteBase, SECONDARY_NOTE, SUITE_BASE_FILE } from './pool-suite-view.ts';
import { auditRun, finalizeRun, scoreRun } from './pool-score.ts';
import { ARMS, runArm, type Arm } from './pool-run.ts';

export function flags(args: string[]) {
  return (key: string, fallback?: string) => { const n = args.indexOf('--' + key); return n < 0 ? fallback : args[n + 1]; };
}

export type ValidateOptions = { hiddenParent?: string; scratch?: string; repeats?: number; suite?: boolean; suiteView?: boolean; suiteViewCmd?: string;
  mutation?: { concurrency?: number; timeoutMs?: number } };
type ItemMutation = MutationResult | { flag_only: true; flagged: false; skipped?: string; error?: string };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** validatePool, then the optional extras. Neither extra changes an item's ok or the report's ok: the suite view is a secondary,
 * not pre-registered record, and mutation survivors are flags for a human (todo/pass-to-pass-score-view.md, todo/mutation-check-hidden-tests.md).
 * Between its synchronous steps it lets pending signals in (letSignalsIn), so a Ctrl-C or SIGTERM that came during one ends
 * validate before the next starts; StrykerJS runs are awaited, so one ends validate at once. An Interrupted (a step's child
 * killed by a stop signal) ends it too. */
export async function validateAll(poolDir: string, o: ValidateOptions = {}) {
  const scratch = o.scratch ? resolve(o.scratch) : mkdtempSync(join(realpathSync(tmpdir()), 'pool-validate-'));
  const report = validatePool(poolDir, { hiddenParent: o.hiddenParent, scratch, repeats: o.repeats, suite: o.suite });
  await letSignalsIn();
  let suite_base;
  if (o.suite || o.suiteView || o.suiteViewCmd) {
    try {
      const rec = await recordSuiteBase(poolDir, { scratch, viewCmd: o.suiteViewCmd }), c = rec.view.commands;
      suite_base = { note: SECONDARY_NOTE, file: SUITE_BASE_FILE, view_cmd: rec.view_cmd, format: rec.view.format, complete: rec.view.complete, exit_code: rec.view.exit_code,
        commands: c ? Object.keys(c).length : null, not_passing: c ? Object.keys(c).filter(n => c[n] !== 'passed').sort() : null };
    } catch (e) {
      if (e instanceof Interrupted) throw e; // suite-base.json was left as it was
      suite_base = { note: SECONDARY_NOTE, file: SUITE_BASE_FILE, error: message(e) };
    }
  }
  const { pool } = loadPool(poolDir), hidden = hiddenRoot(pool.name, o.hiddenParent);
  const mutationFor = async (r: ValidateItem, opts: NonNullable<ValidateOptions['mutation']>): Promise<ItemMutation> => {
    if (r.passes_with_reference !== true) return { flag_only: true, flagged: false, skipped: 'not run: the reference fix does not pass the hidden test' };
    try { return await mutationCheckItem({ repo: pool.repo, baseCommit: pool.base_commit, item: loadHiddenItem(hidden, r.id), scratch, ...opts }); }
    catch (e) {
      if (e instanceof Interrupted) throw e; // validate is being stopped: do not start StrykerJS on the next item
      return { flag_only: true, flagged: false, error: message(e) };
    }
  };
  let items: (ValidateItem & { mutation?: ItemMutation })[] = report.items;
  if (o.mutation) {
    items = [];
    for (const r of report.items) {
      await letSignalsIn();
      items.push({ ...r, mutation: await mutationFor(r, o.mutation) });
    }
  }
  const mutation = o.mutation && { note: MUTATION_NOTE, flagged: items.filter(r => r.mutation?.flagged).map(r => r.id) };
  await letSignalsIn();
  return { ...report, items, ...(suite_base ? { suite_base } : {}), ...(mutation ? { mutation } : {}) };
}

type SuiteBaseSummary = NonNullable<Awaited<ReturnType<typeof validateAll>>['suite_base']>;
/** validate's one-line summary of the base record; a run cut short (the suite hit its time limit) is marked incomplete. */
export function suiteBaseLine(sb: SuiteBaseSummary): string {
  if ('error' in sb) return `suite at base (secondary, not pre-registered): not recorded: ${sb.error}`;
  return `suite at base (secondary, not pre-registered): ${sb.format}, ${sb.commands ?? 'no per-command'} results${sb.complete ? '' : ' (incomplete: the run was cut short)'}, ` +
    `not passing: ${sb.not_passing?.join(', ') || 'none'}; written to ${sb.file}`;
}

/** validate's stop: SIGINT or SIGTERM ends it with 128 + the signal number as soon as its event loop runs, and process.exit
 * runs the 'exit' hooks that kill a StrykerJS group and remove its copy. Prepended, so it runs before bench-build-runtime.ts's
 * listeners for the same signals (which pool-format.ts imports). */
function exitOnStopSignals() {
  for (const s of ['SIGINT', 'SIGTERM'] as const) {
    process.prependListener(s, () => { try { writeSync(2, `validate stopped by ${s}\n`); } catch {} process.exit(128 + constants.signals[s]); });
  }
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
      exitOnStopSignals();
      const report = await validateAll(need('pool'), { hiddenParent: flag('hidden'), scratch: flag('scratch'), repeats: flag('repeats') ? Number(flag('repeats')) : undefined,
        suite: args.includes('--suite'), suiteView: args.includes('--suite-view'), suiteViewCmd: flag('suite-view-cmd'),
        mutation: args.includes('--mutation') ? { concurrency: flag('mutation-concurrency') ? Number(flag('mutation-concurrency')) : undefined,
          timeoutMs: flag('mutation-timeout-min') ? Number(flag('mutation-timeout-min')) * 60_000 : undefined } : undefined });
      console.log(JSON.stringify(report, null, 2));
      for (const r of report.items) {
        const m = r.mutation;
        const flagNote = !m ? '' : m.error ? ` mutation check failed: ${m.error}` : !('mutants' in m) ? '' : m.flagged ? ` FLAG: ${m.survived} of ${m.mutants} mutants survived the hidden test (look, do not auto-reject)`
          : m.mutants ? ` mutation: ${m.mutants} mutants, none survived` : ` mutation: ${m.note}`;
        console.error(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}: fails at base=${r.fails_at_base} passes with reference=${r.passes_with_reference}${r.names_in_repo.length || r.names_in_briefs.length ? ` hidden names already visible: ${[...r.names_in_repo, ...r.names_in_briefs].join(', ')}` : ''}${r.error ? ' (' + r.error + ')' : ''}${flagNote}`);
      }
      if (report.suite_base) console.error(suiteBaseLine(report.suite_base));
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
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = e instanceof Interrupted ? 128 + (constants.signals[e.signal as NodeJS.Signals] ?? 0) : 2;
  });
}
