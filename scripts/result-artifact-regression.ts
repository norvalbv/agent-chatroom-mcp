import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const { collectRoomSnapshot, writeRunResult, readRunResult, renderRunReport } = await import('../src/result.js');
const dir = mkdtempSync(resolve(tmpdir(), 'result-roundtrip-'));
try {
  for (const output of [null, 'VERIFIED\n\n## detail\nraw', 'NOT VERIFIED\n\n## detail\nraw']) {
    const payload = { name: 'room', state: 'concluded', conclusion: { text: 'exact\n\n## embedded\n\nkeep me  \n' }, proposals: [{ id: 'p1', text: 'whole proposal', challenges: [{ objection: 'keep me', blocking: true }] }], board: { 'evidence/one': { text: 'body\n\n## nested\n' + 'x'.repeat(70000), by: 'someone', updatedAt: '2026-01-01T00:00:00Z' } }, unknownFutureField: { retained: true } };
    // A real HTTP endpoint supplies the full payload. Stop it before reading the artifact.
    const server = createServer((req, res) => {
      if (req.url?.endsWith('/transcript')) res.end('# raw\ntranscript\n');
      else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); }
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    const snapshot = await collectRoomSnapshot(`http://127.0.0.1:${port}`, 'room');
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    assert.deepEqual(snapshot.payload, payload);
    const artifact = { schemaVersion: 1 as const, run: { id: 'swarm-test', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z', task: 'test', doneWhen: 'done' }, project: { cwd: dir, canonicalPath: dir, git: null }, leadRoom: 'room', rooms: [snapshot], verifier: { name: 'verifier' as const, output }, reportPath: resolve(dir, 'report.md'), artifactPath: resolve(dir, 'result.json') };
    writeRunResult(artifact.artifactPath, artifact);
    assert.deepEqual(readRunResult(artifact.artifactPath), artifact);
    const loaded = JSON.parse(readFileSync(artifact.artifactPath, 'utf8'));
    assert.deepEqual(loaded.rooms[0].payload, payload);
    assert.equal(loaded.verifier.output, output);
    assert.ok(renderRunReport(loaded).includes(payload.conclusion.text));
    assert.equal(loaded.rooms[0].transcript.text, '# raw\ntranscript\n');
  }
  // Present-but-invalid artifacts must throw (lead room missing; typed conclusion). A captured
  // payload of null with a recorded collection error stays valid (offline, not corrupt).
  const base: any = { schemaVersion: 1, run: { id: 's', startedAt: 'x', completedAt: 'x', task: 't', doneWhen: 'd' }, project: { cwd: dir, canonicalPath: dir, git: null }, leadRoom: 'lead', verifier: { name: 'verifier', output: null }, reportPath: 'r', artifactPath: 'a' };
  const room = (name: string, payload: any) => ({ name, payload, error: null, transcript: { text: null, sourceUrl: 'u', error: null } });
  for (const [name, artifact] of [['missing lead room', { ...base, rooms: [room('other', { state: 'concluded', conclusion: { text: 'x' } })] }] as const, ['numeric conclusion', { ...base, rooms: [room('lead', { state: 'concluded', conclusion: { text: 42 } })] }] as const]) {
    const p = resolve(dir, `${name.replace(/ /g, '-')}.json`);
    writeRunResult(p, artifact as any);
    assert.throws(() => readRunResult(p), Error, `${name} must be rejected`);
  }
  const offline = { ...base, rooms: [room('lead', null)], collectionErrors: ['lead payload: hub down'] } as any;
  const pOffline = resolve(dir, 'offline.json');
  writeRunResult(pOffline, offline);
  assert.equal(readRunResult(pOffline).rooms[0].payload, null);
  console.log('RESULT ARTIFACT REGRESSION OK');
} finally { rmSync(dir, { recursive: true, force: true }); }
