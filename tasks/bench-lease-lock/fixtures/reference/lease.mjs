// Reference simulator for the LEASE spec. `variant` selects a deliberately wrong reading (skip-holder, dedupe, eager), used only to prove the log discriminates.
export function parseLog(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const p = l.split(/\s+/);
    return { tick: Number(p[0]), client: p[1], action: p[2], res: p[3], lease: p[4] === undefined ? undefined : Number(p[4]) };
  });
}

export function simulate(events, variant = 'spec') {
  const R = {};
  for (let i = 1; i <= 5; i++) R['R' + i] = { holder: null, deadline: 0, queue: [] };
  const handOver = (r, tick) => {
    r.holder = null;
    if (r.queue.length) { const e = r.queue.shift(); r.holder = e.client; r.deadline = tick + e.lease; }
  };
  const expire = (r, tick) => { if (r.holder !== null && r.deadline <= tick) handOver(r, tick); };
  for (const ev of events) {
    if (variant === 'eager') for (const k of Object.keys(R)) expire(R[k], ev.tick);
    const r = R[ev.res];
    if (variant !== 'eager') expire(r, ev.tick);
    if (ev.action === 'LOCK') {
      if (r.holder === null) { r.holder = ev.client; r.deadline = ev.tick + ev.lease; }
      else if (variant === 'skip-holder' && r.holder === ev.client) { /* wrong: holder cannot queue behind itself */ }
      else if (variant === 'dedupe' && (r.holder === ev.client || r.queue.some(e => e.client === ev.client))) { /* wrong: one request per client */ }
      else r.queue.push({ client: ev.client, lease: ev.lease });
    } else if (ev.action === 'UNLOCK') {
      if (r.holder === ev.client) handOver(r, ev.tick);
    } else if (ev.action === 'RENEW') {
      if (r.holder === ev.client) r.deadline = ev.tick + ev.lease;
    }
  }
  return Object.keys(R).map(k => { const r = R[k]; return `${k}:${r.holder === null ? 'free' : r.holder + '@' + r.deadline}[${r.queue.map(e => e.client).join(',')}]`; }).join(' ');
}
