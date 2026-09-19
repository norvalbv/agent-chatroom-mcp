/** Five-arm confirmatory report. Only 501–520; pilot and historical rows never enter inference.
 * node --import tsx scripts/paper-rq1-confirmatory.ts RESULTS_DIR [--out PREFIX]
 * Fixed regime: A output <4000 and finite observed thinking = calibrated; >=4000 = long-thinking.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fisherExactTest, holmBonferroni } from './rq1-stats.js';

export const TASKS = ['stamp-interpreter', 'bench-printf-format'] as const;
export const ARMS = ['A', 'AH', 'B', 'K', 'C'] as const;
export const PAIRS = [['B','C'],['AH','C'],['K','C'],['AH','A'],['B','A'],['K','A'],['C','A']] as const;
const SEEDS = Array.from({length:20},(_,i)=>501+i);
type Regime = 'calibrated' | 'long-thinking' | 'unknown';
export interface ConfirmatoryRun {
  task_id: string; arm: string; seed: number; outcome: string;
  cost_usd: number|null; thinking_tokens: number|null; output_tokens: number|null;
  wall_ms: number|null; exit_codes: (number|null)[];
}
interface Cell {
  task:string; arm:string; regime:Regime; n:number; denominator:number; passes:number;
  pass_rate:number|null; wilson:[number,number]|null; outcome_counts:Record<string,number>;
  total_cost_usd:number|null; cost_per_correct:number|'unknown'|'undefined'; unknown_cost_runs:number;
  thinking_tokens_mean:number|null; thinking_known_runs:number; output_tokens_mean:number|null;
}
interface Comparison {
  task:string; left:string; right:string; left_pass:number; left_n:number; right_pass:number; right_n:number;
  test:'fisher'; p_raw:number|null; p_holm:number|null;
}
interface Sentinel {task:string;seed:number;thinking_tokens:number|null;output_tokens:number|null;regime:Regime}
export interface ConfirmatoryTable {cells:Cell[];comparisons:Comparison[];sentinels:Sentinel[];missing:string[];runs:ConfirmatoryRun[]}
const numeric = (v:unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const sumKnown = (vs:(number|null)[]):number|null => vs.length && vs.every(numeric) ? (vs as number[]).reduce((a,b)=>a+b,0) : null;
const meanKnown = (vs:(number|null)[]):number|null => {const s=sumKnown(vs);return s === null ? null : s/vs.length;};

function seatThinking(seat:any):number|null {
  const models=seat.model_usage && typeof seat.model_usage === 'object' ? Object.values(seat.model_usage) as any[] : [];
  return sumKnown(models.map(m=>numeric(m?.thinkingTokens) ? m.thinkingTokens : null));
}
function metrics(raw:any): {thinking:number|null; output:number|null; exits:(number|null)[]} {
  const seats=Array.isArray(raw.seats) ? raw.seats : [];
  return {thinking:sumKnown(seats.map(seatThinking)), output:raw.usage?.coverage === 'complete' && numeric(raw.usage?.output_tokens) ? raw.usage.output_tokens : null,
    exits:seats.map((s:any)=>Number.isInteger(s.exit_code) ? s.exit_code : null)};
}

/** Reads top-level cells and, for K, all original attempt results. Never follows stored absolute paths. */
export function loadConfirmatoryRuns(dir:string):{runs:ConfirmatoryRun[];warnings:string[]} {
  const runs:ConfirmatoryRun[]=[], warnings:string[]=[];
  if (!existsSync(dir)) return {runs,warnings:[`Results directory missing: ${dir}`]};
  for (const name of readdirSync(dir).sort()) {
    const path=join(dir,name,'result.json'); if (!existsSync(path)) continue;
    try {
      const r=JSON.parse(readFileSync(path,'utf8'));
      if (!TASKS.includes(r.task_id) || !ARMS.includes(r.arm) || !SEEDS.includes(r.seed)) {warnings.push(`Outside confirmatory design: ${name}`);continue;}
      if (name !== `${r.task_id}-${r.arm}-seed${r.seed}` || typeof r.outcome !== 'string') throw Error('cell identity/outcome mismatch');
      let m=metrics(r);
      let cost=numeric(r.usage?.cost_usd) && r.usage?.coverage === 'complete' ? r.usage.cost_usd : null;
      if (r.arm === 'K') {
        if (!Number.isInteger(r.k) || r.k < 2 || !Array.isArray(r.attempts) || r.attempts.length !== r.k) throw Error('invalid K attempt count');
        const attempts=Array.from({length:r.k},(_,i)=>{
          const ap=join(dir,name,`attempt-${i+1}`,'result.json');
          try {return metrics(JSON.parse(readFileSync(ap,'utf8')));} catch {warnings.push(`Missing/unreadable K provenance: ${name}/attempt-${i+1}`);return {thinking:null,output:null,exits:[null]};}
        });
        m={thinking:sumKnown(attempts.map(a=>a.thinking)),output:sumKnown(attempts.map(a=>a.output)),exits:attempts.flatMap(a=>a.exits)};
        cost=numeric(r.usage?.cost_usd) && (r.usage.coverage === undefined || r.usage.coverage === 'complete') && r.attempts.every((a:any)=>numeric(a.cost_usd)) ? r.usage.cost_usd : null;
      }
      runs.push({task_id:r.task_id,arm:r.arm,seed:r.seed,outcome:r.outcome,cost_usd:cost,thinking_tokens:m.thinking,output_tokens:m.output,wall_ms:numeric(r.wall_clock?.duration_ms)?r.wall_clock.duration_ms:null,exit_codes:m.exits});
    } catch(e) {warnings.push(`Unreadable cell ${name}: ${String(e)}`);}
  }
  return {runs,warnings};
}

function regime(a:ConfirmatoryRun|undefined):Regime {
  if (!a || !numeric(a.thinking_tokens) || !numeric(a.output_tokens)) return 'unknown';
  return a.output_tokens < 4000 ? 'calibrated':'long-thinking';
}
function wilson(passes:number,n:number):[number,number]|null {
  if (!n) return null;
  const z=1.959963984540054, p=passes/n, d=1+z*z/n, center=(p+z*z/(2*n))/d;
  const half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [Math.max(0,center-half),Math.min(1,center+half)];
}

export function buildConfirmatoryTable(input:ConfirmatoryRun[]):ConfirmatoryTable {
  const runs=input.filter(r=>TASKS.includes(r.task_id as any)&&ARMS.includes(r.arm as any)&&SEEDS.includes(r.seed));
  const by=new Map<string,ConfirmatoryRun>();
  for(const r of runs) {const k=`${r.task_id}-${r.arm}-seed${r.seed}`;if(by.has(k))throw Error(`Duplicate observation ${k}`);by.set(k,r);}
  const sentinels:Sentinel[]=[],missing:string[]=[],cells:Cell[]=[],comparisons:Comparison[]=[];
  for(const task of TASKS) {
    for(const seed of SEEDS) {
      const a=by.get(`${task}-A-seed${seed}`);
      sentinels.push({task,seed,regime:regime(a),thinking_tokens:a?.thinking_tokens??null,output_tokens:a?.output_tokens??null});
      for(const arm of ARMS) if(!by.has(`${task}-${arm}-seed${seed}`))missing.push(`${task}-${arm}-seed${seed}`);
    }
    for(const stratum of ['calibrated','long-thinking','unknown'] as const) for(const arm of ARMS) {
      const rs=runs.filter(r=>r.task_id===task&&r.arm===arm&&regime(by.get(`${task}-A-seed${r.seed}`))===stratum);
      const outcome_counts:Record<string,number>={};for(const r of rs)outcome_counts[r.outcome]=(outcome_counts[r.outcome]??0)+1;
      const passes=outcome_counts.task_pass??0;
      // Confirmatory prereg overrides protocol §4: every recorded launched cell stays in the denominator.
      const denominator=rs.length;
      const total_cost_usd=sumKnown(rs.map(r=>r.cost_usd));
      const unknown_cost_runs=rs.filter(r=>r.cost_usd===null).length;
      cells.push({task,arm,regime:stratum,n:rs.length,denominator,passes,pass_rate:denominator?passes/denominator:null,wilson:wilson(passes,denominator),outcome_counts,total_cost_usd,
        cost_per_correct:unknown_cost_runs?'unknown':passes&&total_cost_usd!==null?total_cost_usd/passes:'undefined',unknown_cost_runs,
        thinking_tokens_mean:meanKnown(rs.map(r=>r.thinking_tokens)),thinking_known_runs:rs.filter(r=>r.thinking_tokens!==null).length,output_tokens_mean:meanKnown(rs.map(r=>r.output_tokens))});
    }
    for(const [left,right] of PAIRS) {
      const a=cells.find(c=>c.task===task&&c.regime==='calibrated'&&c.arm===left)!;
      const b=cells.find(c=>c.task===task&&c.regime==='calibrated'&&c.arm===right)!;
      comparisons.push({task,left,right,left_pass:a.passes,left_n:a.denominator,right_pass:b.passes,right_n:b.denominator,test:'fisher',p_raw:a.denominator&&b.denominator?fisherExactTest(a.passes,a.denominator-a.passes,b.passes,b.denominator-b.passes).p_value:null,p_holm:null});
    }
  }
  const adjusted=holmBonferroni(comparisons.map(c=>c.p_raw??1));
  comparisons.forEach((c,i)=>{if(c.p_raw!==null)c.p_holm=adjusted[i];});
  return {cells,comparisons,sentinels,missing,runs};
}

/** Independent Bernoulli enumeration, not simulation; alpha=.05/14 is a conservative Holm rank-one bound. */
export function exactPower(n:number,p:number,q:number,alpha:number):number {
  function binomial(k:number,prob:number) {let choose=1;for(let i=1;i<=k;i++)choose*=(n-i+1)/i;return choose*prob**k*(1-prob)**(n-k);}
  let power=0;
  for(let a=0;a<=n;a++)for(let b=0;b<=n;b++)if((fisherExactTest(a,n-a,b,n-b).p_value??1)<alpha)power+=binomial(a,p)*binomial(b,q);
  return power;
}
const fmt=(n:number|null,d=4)=>n===null?'unknown':n.toFixed(d);
export function renderConfirmatoryMarkdown(t:ConfirmatoryTable):string {
  const lines=['# Confirmatory five-arm report','',
    'Seeds 501–520 only. Two task families are analyzed separately. Primary comparisons use calibrated A-sentinel seeds only; long-thinking and unknown seeds are retained below, never pooled. An A sentinel cannot rule out a regime change later within its seed.',
    '', 'Two-sided Fisher exact, Holm family m=14 (two families × seven fixed comparisons), including unobserved comparisons as p=1 for adjustment. Equal seed labels do not make observations statistically paired. Missing cells and operational outcomes remain explicit.',
    '', '| family | regime | arm | observed | pass/denominator | pass rate | Wilson 95% | total USD | USD/correct | thinking/run | thinking known | output/run | outcomes |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for(const c of t.cells)lines.push(`| ${c.task} | ${c.regime} | ${c.arm} | ${c.n} | ${c.passes}/${c.denominator} | ${fmt(c.pass_rate)} | ${c.wilson?c.wilson.map(x=>x.toFixed(4)).join('–'):'undefined'} | ${fmt(c.total_cost_usd)} | ${typeof c.cost_per_correct==='number'?fmt(c.cost_per_correct):c.cost_per_correct} | ${fmt(c.thinking_tokens_mean,1)} | ${c.thinking_known_runs}/${c.n} | ${fmt(c.output_tokens_mean,1)} | ${JSON.stringify(c.outcome_counts)} |`);
  lines.push('', 'Every recorded launched cell enters the denominator; all non-task_pass outcomes count as failures and remain listed (confirmatory prereg overrides protocol §4). Every finished K group, including no-submission groups, stays in the denominator. Unknown cost or thinking usage is never zero-filled; cost/correct includes all observed runs of the cell.', '', '| family | comparison | left pass/n | right pass/n | Fisher raw p | Holm p |', '|---|---|---|---|---|---|');
  for(const c of t.comparisons)lines.push(`| ${c.task} | ${c.left} vs ${c.right} | ${c.left_pass}/${c.left_n} | ${c.right_pass}/${c.right_n} | ${fmt(c.p_raw,6)} | ${fmt(c.p_holm,6)} |`);
  lines.push('', 'At n=20 per arm, nonsignificance is inconclusive and never evidence of equality. These independent-Bernoulli prospective powers assume constant success probabilities; regime splitting reduces n further. The .05/14 column is a conservative rank-one threshold, not joint Holm power.', '', '| p | q | n/arm | Fisher power .05 | Fisher power .05/14 |','|---|---|---|---|---|');
  for(const [p,q] of [[.9,1],[.8,1],[.7,.9],[.5,.8]])lines.push(`| ${p} | ${q} | 20 | ${exactPower(20,p,q,.05).toFixed(4)} | ${exactPower(20,p,q,.05/14).toFixed(4)} |`);
  lines.push('', '| family | seed | regime | A thinking | A output |', '|---|---|---|---|---|');
  for(const s of t.sentinels)lines.push(`| ${s.task} | ${s.seed} | ${s.regime} | ${s.thinking_tokens??'unknown'} | ${s.output_tokens??'unknown'} |`);
  lines.push('', '| family | seed | arm | outcome | USD | thinking | output | wall ms | exit codes |','|---|---|---|---|---|---|---|---|---|');
  for(const r of t.runs)lines.push(`| ${r.task_id} | ${r.seed} | ${r.arm} | ${r.outcome} | ${fmt(r.cost_usd)} | ${r.thinking_tokens??'unknown'} | ${r.output_tokens??'unknown'} | ${r.wall_ms??'unknown'} | ${JSON.stringify(r.exit_codes)} |`);
  lines.push('',`Missing cells (${t.missing.length}): ${t.missing.join(', ')||'none'}.`,'');
  return lines.join('\n');
}
function main() {
  const args=process.argv.slice(2),dir=args.shift();let out:string|undefined;
  while(args.length){const flag=args.shift();if(flag==='--out')out=args.shift();else throw Error(`Unknown option ${flag}`);}
  if(!dir)throw Error('Usage: paper-rq1-confirmatory.ts RESULTS_DIR [--out PREFIX]');
  const {runs,warnings}=loadConfirmatoryRuns(resolve(dir));
  const table=buildConfirmatoryTable(runs);
  const md=renderConfirmatoryMarkdown(table)+warnings.map(w=>`\nWarning: ${w}`).join('');
  if(out){const prefix=resolve(out);mkdirSync(dirname(prefix),{recursive:true});writeFileSync(`${prefix}.md`,md);writeFileSync(`${prefix}.json`,JSON.stringify({...table,warnings},null,2)+'\n');}
  console.log(md);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
