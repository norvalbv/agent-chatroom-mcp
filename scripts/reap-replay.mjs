/**
 * Which idle reaps took a seat that was still alive. The hub closes an MCP session after 30 minutes with no request
 * (src/index.ts liveness sweep) and the seat leaves its rooms. A seat waiting on a long job makes no MCP request but its
 * tool hook still heartbeats (a `work` event per local tool call), and a seat that comes back after the reap (a later
 * work, call or join on the same pid) was alive too. For each reap that took the seat (seat_kept false):
 *   working_before  a work event from that pid in the idle window before the reap: alive and running tools locally
 *   back_after      any later event from that pid (work, call_completion, message, join, session moved, seat_unconnected)
 *   after_end       neither, and the room had already concluded: the seat was done
 *   dead            neither, in a room still open: the process looks gone, which is what the reap is for
 * would_spare: what src/hub/liveness.ts reapIdle would have kept from the record alone: "heartbeat" (working_before) and "process" (a
 * job_end of that seat's job that was running at the reap). Its third signal, the client's open stream, is not in old
 * records. Rooms run since then carry reap_check events (spared / reaped / chair_kept, alive_by), counted under checks,
 * with spared_then_acted: spared seats that made a call, message or tool call after the check (the spare was right).
 *   node scripts/reap-replay.mjs <room.jsonl>... [--window-min 30] [--json]
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const json = args.includes('--json');
const wi = args.indexOf('--window-min');
const windowMs = (wi >= 0 ? Number(args[wi + 1]) : 30) * 60_000;
const files = args.filter((a, i) => a.endsWith('.jsonl') && !(wi >= 0 && i === wi + 1));
if (!files.length) {
  console.error('usage: node scripts/reap-replay.mjs <room.jsonl>... [--window-min 30] [--json]');
  process.exit(2);
}

/** pid -> sorted timestamps of the seat's own activity, by kind */
const reaps = [];
const rows = [];
const checks = [];
for (const file of files) {
  const work = new Map(); // pid -> [ts]
  const other = new Map(); // pid -> [ts] (calls, messages, joins, moves, unconnected)
  const names = new Map();
  const roomReaps = [];
  const jobs = new Map(); // seat name -> [{ from, to }]
  const roomChecks = [];
  let endedAt = Infinity;
  const push = (m, pid, ts) => { if (!pid || !ts) return; (m.get(pid) ?? m.set(pid, []).get(pid)).push(Date.parse(ts)); };
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (!/"type":"(work|call_completion|message|join|session|seat_unconnected|seat_reconnected|state|run_end|job_end|reap_check)"/.test(line)) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    switch (e.type) {
      case 'work': push(work, e.pid, e.ts); break;
      case 'call_completion': push(other, e.participant, e.ts); break;
      case 'message': if (e.msg?.from?.id?.startsWith('p_')) push(other, e.msg.from.id, e.msg.ts); break;
      case 'join': push(other, e.p?.id, e.ts ?? e.p?.joinedAt); if (e.p?.id) names.set(e.p.id, e.p.name); break;
      case 'seat_unconnected': case 'seat_reconnected': push(other, e.pid ?? e.participant, e.ts); break;
      case 'state': if (e.state === 'concluded' && e.conclusion?.decidedAt) endedAt = Math.min(endedAt, Date.parse(e.conclusion.decidedAt)); break;
      case 'run_end': endedAt = Math.min(endedAt, Date.parse(e.ts)); break;
      case 'job_end': push(jobs, e.seat, e.ts); jobs.get(e.seat).push(Date.parse(e.ts) - 1000 * (e.ran_s ?? 0)); break;
      case 'reap_check': roomChecks.push({ pid: e.participant, name: e.name, ts: Date.parse(e.ts), outcome: e.outcome, alive_by: e.alive_by ?? [], idle_min: e.idle_min }); break;
      case 'session':
        if (e.event === 'moved') push(other, e.participant, e.ts);
        if (e.event === 'closed' && /reaped/.test(e.reason ?? '')) roomReaps.push({ pid: e.participant, name: e.name, ts: Date.parse(e.ts), kept: e.seat_kept === true });
        break;
    }
  }
  for (const r of roomReaps) {
    if (r.kept) { reaps.push({ ...r, room: e2room(file), verdict: 'seat_kept' }); continue; }
    const w = work.get(r.pid) ?? [];
    const o = other.get(r.pid) ?? [];
    const workingBefore = w.filter((t) => t <= r.ts && t > r.ts - windowMs);
    const after = [...w, ...o].filter((t) => t > r.ts + 1_000).sort((a, b) => a - b);
    const lastBefore = Math.max(-Infinity, ...[...w, ...o].filter((t) => t <= r.ts));
    const verdict = workingBefore.length ? 'working_before' : after.length ? 'back_after' : r.ts >= endedAt ? 'after_end' : 'dead';
    // job_end pushed [end, start] pairs: a job of this seat running across the reap
    const j = jobs.get(r.name) ?? [];
    const jobRunning = j.some((t, i) => i % 2 === 0 && j[i + 1] <= r.ts && r.ts <= t);
    const would_spare = [...(workingBefore.length ? ['heartbeat'] : []), ...(jobRunning ? ['process'] : [])];
    reaps.push({ ...r, room: e2room(file), verdict, would_spare, work_in_window: workingBefore.length,
      last_activity_min_before: Number.isFinite(lastBefore) ? Math.round((r.ts - lastBefore) / 6_000) / 10 : null,
      back_after_min: after.length ? Math.round((after[0] - r.ts) / 6_000) / 10 : null });
  }
  for (const c of roomChecks) {
    const acted = [...(work.get(c.pid) ?? []), ...(other.get(c.pid) ?? [])].some((t) => t > c.ts + 1_000);
    checks.push({ ...c, room: e2room(file), acted_after: acted });
  }
}
function e2room(file) { return file.split('/').pop().replace(/\.jsonl$/, ''); }

const count = (v) => reaps.filter((r) => r.verdict === v).length;
const summary = { files: files.length, reaps: reaps.length, seat_kept: count('seat_kept'), took_seat: reaps.length - count('seat_kept'),
  working_before: count('working_before'), back_after: count('back_after'), after_end: count('after_end'), dead: count('dead'), window_min: windowMs / 60_000,
  would_spare_from_record: reaps.filter((r) => r.would_spare?.length).length,
  checks: { spared: checks.filter((c) => c.outcome === 'spared').length, reaped: checks.filter((c) => c.outcome === 'reaped').length,
    chair_kept: checks.filter((c) => c.outcome === 'chair_kept').length, spared_then_acted: checks.filter((c) => c.outcome === 'spared' && c.acted_after).length,
    spared_by: Object.fromEntries(['stream', 'heartbeat', 'process'].map((k) => [k, checks.filter((c) => c.outcome === 'spared' && c.alive_by.includes(k)).length])) } };
if (json) console.log(JSON.stringify({ summary, reaps, checks }, null, 1));
else {
  console.log(JSON.stringify(summary));
  for (const r of reaps.filter((x) => x.verdict !== 'seat_kept')) {
    rows.push(`${r.room}\t${r.name}\t${new Date(r.ts).toISOString().slice(0, 16)}\t${r.verdict}\twould_spare=${r.would_spare.join('+') || '-'}\twork_in_window=${r.work_in_window}\tlast_before_min=${r.last_activity_min_before}\tback_after_min=${r.back_after_min}`);
  }
  console.log(rows.join('\n'));
}
