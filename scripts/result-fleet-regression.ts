/** Offline CLI regression: runs the compiled real fleet with a fake swarm executable. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(resolve(tmpdir(), 'fleet-result-'));
const conclusion = 'Exact conclusion\n\n## Embedded heading\n\nretained\n\n### Verifier\n\nliteral conclusion content';
const verdicts = [null, 'VERIFIED\n\n## Raw heading\nunchanged', 'NOT VERIFIED\n\n## Raw heading\nunchanged'];
try {
  mkdirSync(resolve(root, 'dist'));
  writeFileSync(resolve(root, 'package.json'), '{"type":"module"}');
  for (const file of readdirSync('dist').filter(f => f.endsWith('.js'))) copyFileSync(resolve('dist', file), resolve(root, 'dist', file));
  writeFileSync(resolve(root, 'spec.json'), JSON.stringify({preamble:'test',areas: verdicts.map((_,i)=>({id:`area${i}`, title:`Area ${i}`, brief:''}))}));
  writeFileSync(resolve(root,'prior.md'), '## Prior area\n' + 'q'.repeat(65_000) + '\nPRIOR_END');
  writeFileSync(resolve(root, 'dist/swarm.js'), `
import {mkdirSync,writeFileSync} from 'node:fs'; import {dirname,resolve} from 'node:path';
const args=process.argv.slice(2), get=n=>args[args.indexOf(n)+1];
const index=Number(/YOUR AREA: Area (\\d)/.exec(args[0])?.[1]??0);
const id='swarm-000000-'+String(index).padStart(4,'a'); const out=resolve('swarms',id); mkdirSync(out,{recursive:true});
const conclusion=${JSON.stringify(conclusion)}, output=${JSON.stringify(verdicts)}[index];
const reportPath=resolve(out,'report.md');
writeFileSync(reportPath,'## Final answer (concluded)\\n\\n'+conclusion+'\\n\\n## Verifier\\n\\n'+(output??'')+'\\n\\n## Transcript\\n\\nbody');
if(args.includes('--result-path')) { const p=get('--result-path'); mkdirSync(dirname(p),{recursive:true}); writeFileSync(p,JSON.stringify({schemaVersion:1,run:{id,startedAt:'start',completedAt:'end',task:args[0],doneWhen:''},project:{cwd:process.cwd(),canonicalPath:process.cwd(),git:null},leadRoom:id+'-room',rooms:[{name:id+'-room',payload:{state:'concluded',conclusion:{text:conclusion},board:{'evidence/full':{text:'FULL BODY',by:'author',updatedAt:'timestamp'}},proposals:[]},error:null,transcript:{text:'FULL TRANSCRIPT',sourceUrl:'offline',error:null}}],verifier:{name:'verifier',output},reportPath,artifactPath:p})); }
// Intentional boundaries defeat the old per-chunk discovery regex.
process.stdout.write('swarm '+id.slice(0,-2)); setTimeout(()=>{process.stdout.write(id.slice(-2)+': task');},50);
`);
  const result = spawnSync(process.execPath, [resolve(root,'dist/fleet.js'), resolve(root,'spec.json'), '--model','test','--stagger','0','--consolidate','--consolidate-from',resolve(root,'prior.md')], {cwd:root,env:{...process.env,OPENROUTER_API_KEY:'offline-fixture'},encoding:'utf8',timeout:20000});
  const fleetDir=resolve(root,'swarms', readdirSync(resolve(root,'swarms')).find(x=>x.startsWith('fleet-'))!);
  const summary=readFileSync(resolve(fleetDir,'summary.md'),'utf8');
  const digest=readFileSync(resolve(fleetDir,'consolidation-input.md'),'utf8');
  const failures:string[]=[];
  function check(name:string, fn:()=>void) { try {fn(); console.log('PASS '+name);} catch(e) {failures.push(name); console.error('FAIL '+name+': '+(e as Error).message);} }
  check('artifact path independent of chunk framing / all verdicts concluded',()=>assert.match(summary,/3 concluded, 0 did not/));
  check('embedded headings exact',()=>assert.equal(summary.split(conclusion).length-1,3));
  check('raw positive and negative verifier preserved',()=>{for(const v of verdicts.filter(Boolean)) assert.ok(summary.includes(v!));});
  check('complete over-budget consolidation input',()=>{assert.ok(digest.includes('PRIOR_END')); assert.ok(digest.includes(summary)); assert.ok(digest.length>65000);});
  check('consolidation child consumes artifact too',()=>assert.ok(readFileSync(resolve(fleetDir,'consolidated.md'),'utf8').includes(conclusion)));
  check('CLI success',()=>assert.equal(result.status,0,result.stderr));
  assert.equal(failures.length,0,failures.join('; '));
  console.log('RESULT FLEET REGRESSION OK');
} finally { rmSync(root,{recursive:true,force:true}); }
