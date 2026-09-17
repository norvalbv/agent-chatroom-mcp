/** Compatibility semantics and stream framing without launching a hub. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { consumeResult, lineFramer } from '../src/fleet-result.js';
const root=mkdtempSync(resolve(tmpdir(),'fleet-compat-'));
try {
  const id='swarm-000000-abcd', dir=resolve(root,'swarms',id), resultPath=resolve(root,'result.json');
  mkdirSync(dir,{recursive:true});
  writeFileSync(resolve(dir,'report.md'),'## Final answer (concluded)\n\nlegacy\n\n## Verifier\n\nraw\n\n## Transcript\n\ntext');
  const lines:string[]=[];const out=lineFramer(s=>lines.push(s)), err=lineFramer(s=>lines.push('err:'+s));
  out.push('swarm swarm-000000-ab');err.push('warning');out.push('cd: task');out.flush();err.flush();out.flush();
  assert.deepEqual(lines,['swarm swarm-000000-abcd: task','err:warning']);
  const fallback=consumeResult(resultPath,root,id);
  assert.equal(fallback.conclusion,'legacy');assert.equal(fallback.source,'legacy report (best-effort fallback)');
  for(const invalid of ['{',JSON.stringify({schemaVersion:999})]) {
    writeFileSync(resultPath,invalid);const handoff=consumeResult(resultPath,root,id);
    assert.equal(handoff.source,'artifact-error');assert.equal(handoff.conclusion,'');assert.ok(handoff.error);
  }
  console.log('RESULT FLEET COMPAT OK');
} finally {rmSync(root,{recursive:true,force:true});}
