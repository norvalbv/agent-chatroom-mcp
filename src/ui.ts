/** Single-file live dashboard served at /ui. Polls the JSON endpoints; no build step. */
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent Chatroom</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg:#f6f7f9; --panel:#ffffff; --panel2:#eef0f4; --line:#e3e6ec; --fg:#1b1f27; --dim:#6b7280; --dim2:#9aa3b2;
    --acc:#3b6df6; --ok:#1f9d55; --warn:#d98a00; --bad:#d64545; --shadow:0 1px 2px rgba(16,24,40,.06);
    --ok-bg:#e9f7ef; --acc-bg:#eaf0ff; --warn-bg:#fff5e1; --bad-bg:#fdecec;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#0e1015; --panel:#151821; --panel2:#1b1f2a; --line:#262b38; --fg:#e7e9ee; --dim:#98a0b3; --dim2:#6b7283;
    --acc:#7aa2ff; --ok:#5ccb8a; --warn:#f0b64a; --bad:#ff7b7b; --shadow:0 1px 2px rgba(0,0,0,.4);
    --ok-bg:#14291d; --acc-bg:#182238; --warn-bg:#2d2411; --bad-bg:#331a1a;
  } }
  :root[data-theme="dark"] {
    --bg:#0e1015; --panel:#151821; --panel2:#1b1f2a; --line:#262b38; --fg:#e7e9ee; --dim:#98a0b3; --dim2:#6b7283;
    --acc:#7aa2ff; --ok:#5ccb8a; --warn:#f0b64a; --bad:#ff7b7b; --shadow:0 1px 2px rgba(0,0,0,.4);
    --ok-bg:#14291d; --acc-bg:#182238; --warn-bg:#2d2411; --bad-bg:#331a1a;
  }
  * { box-sizing:border-box }
  html,body { height:100% }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif; display:grid; grid-template-columns:300px minmax(0,1fr); height:100vh; overflow:hidden }
  code,.mono { font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px }
  button { font:inherit; cursor:pointer }
  a { color:var(--acc) }

  /* ---- sidebar ---- */
  aside { background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; min-height:0 }
  .brand { padding:16px 16px 10px; display:flex; align-items:center; justify-content:space-between }
  .brand h1 { font-size:15px; font-weight:700; margin:0; letter-spacing:-.01em }
  .brand .sub { color:var(--dim); font-size:12px; margin-top:1px }
  .iconbtn { background:transparent; border:1px solid var(--line); color:var(--dim); border-radius:8px; width:30px; height:30px; display:grid; place-items:center }
  .iconbtn:hover { color:var(--fg); background:var(--panel2) }
  .rooms { overflow:auto; padding:6px 10px 16px; flex:1 }
  .group { font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--dim2); padding:12px 8px 6px }
  .room { display:block; width:100%; text-align:left; padding:9px 10px; border-radius:10px; border:1px solid transparent; background:transparent; color:var(--fg); margin-bottom:2px }
  .room:hover { background:var(--panel2) }
  .room.sel { background:var(--acc-bg); border-color:transparent }
  .room .n { display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px; min-width:0 }
  .room .n span.t { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .room .m { color:var(--dim); font-size:12px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .dot { width:8px; height:8px; border-radius:50%; flex:none; background:var(--dim2) }
  .dot.open { background:var(--ok); box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent) }
  .dot.stalled { background:var(--warn) } .dot.concluded { background:var(--acc) }

  /* ---- main ---- */
  main { display:grid; grid-template-rows:auto minmax(0,1fr) auto; min-height:0; background:var(--bg) }
  header { background:var(--panel); border-bottom:1px solid var(--line); padding:14px 22px 12px }
  .title { display:flex; align-items:center; gap:10px; flex-wrap:wrap }
  .title h2 { margin:0; font-size:16px; font-weight:700; letter-spacing:-.01em }
  .chip { font-size:11px; font-weight:600; padding:2px 8px; border-radius:999px; background:var(--panel2); color:var(--dim) }
  .chip.open { background:var(--ok-bg); color:var(--ok) } .chip.concluded { background:var(--acc-bg); color:var(--acc) } .chip.stalled { background:var(--warn-bg); color:var(--warn) }
  .topic { color:var(--dim); margin-top:4px; font-size:13px; max-width:90ch }
  .people { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px }
  .person { display:inline-flex; align-items:center; gap:6px; padding:3px 9px 3px 4px; border-radius:999px; background:var(--panel2); font-size:12px; color:var(--fg) }
  .person.off { opacity:.45 }
  .av { width:20px; height:20px; border-radius:50%; display:grid; place-items:center; font-size:10px; font-weight:700; color:#fff; flex:none }
  .person .role { color:var(--dim2); font-size:11px }
  .tools { display:flex; gap:14px; align-items:center; margin-top:10px; font-size:12px; color:var(--dim) }
  .tools label { display:inline-flex; align-items:center; gap:5px; cursor:pointer }

  .card { border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:var(--panel); box-shadow:var(--shadow); margin-top:10px }
  .card.prop { border-left:3px solid var(--acc) } .card.concl { border-left:3px solid var(--ok); background:var(--ok-bg) }
  .card .lbl { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--acc); display:flex; align-items:center; gap:8px }
  .card.concl .lbl { color:var(--ok) }
  .card .txt { margin-top:6px; white-space:pre-wrap; word-break:break-word }
  .tally { display:flex; align-items:center; gap:10px; margin-top:10px; font-size:12px; color:var(--dim) }
  .bar { flex:1; height:6px; background:var(--panel2); border-radius:999px; overflow:hidden; display:flex }
  .bar i { display:block; height:100% } .bar .a { background:var(--ok) } .bar .d { background:var(--bad) }
  .vbtn { border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:4px 10px; font-size:12px; color:var(--fg) }
  .vbtn:hover { background:var(--panel2) } .vbtn.veto { color:var(--bad) }
  .need { color:var(--warn); font-weight:600 }

  #log { overflow:auto; padding:18px 22px 10px; scroll-behavior:smooth }
  .day { text-align:center; color:var(--dim2); font-size:11px; margin:6px 0 12px }
  .sys { text-align:center; color:var(--dim2); font-size:12px; margin:8px 0; }
  .sys b { color:var(--dim); font-weight:600 }
  .msg { display:grid; grid-template-columns:34px minmax(0,1fr); gap:10px; padding:6px 0 }
  .msg.cont { padding-top:0 } .msg.cont .av { visibility:hidden } .msg.cont .who { display:none }
  .msg .av { width:32px; height:32px; font-size:12px; margin-top:2px }
  .who { display:flex; align-items:baseline; gap:8px; margin-bottom:2px }
  .who b { font-weight:600 } .who .t { color:var(--dim2); font-size:11px } .who .k { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:1px 6px; border-radius:6px }
  .k.proposal { background:var(--acc-bg); color:var(--acc) } .k.challenge { background:var(--warn-bg); color:var(--warn) } .k.vote { background:var(--panel2); color:var(--dim) } .k.conclusion { background:var(--ok-bg); color:var(--ok) } .k.human { background:var(--bad-bg); color:var(--bad) }
  .body { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:9px 12px; white-space:pre-wrap; word-break:break-word; box-shadow:var(--shadow); max-width:100ch }
  .body.proposal { border-left:3px solid var(--acc) } .body.challenge { border-left:3px solid var(--warn) } .body.conclusion { border-left:3px solid var(--ok); background:var(--ok-bg) }
  .body.human { border-left:3px solid var(--bad) }
  .body.vote { padding:6px 12px; color:var(--dim); font-size:13px; background:transparent; box-shadow:none; border-style:dashed }
  .body.clamp { max-height:150px; overflow:hidden; position:relative }
  .body.clamp::after { content:""; position:absolute; inset:auto 0 0 0; height:40px; background:linear-gradient(transparent, var(--panel)) }
  .more { background:none; border:0; color:var(--acc); font-size:12px; padding:2px 0 0 44px }
  .empty { color:var(--dim2); padding:60px; text-align:center }

  form { display:flex; gap:8px; padding:12px 22px 14px; border-top:1px solid var(--line); background:var(--panel); align-items:flex-end }
  input,textarea { background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:10px; padding:9px 11px; font:inherit }
  input:focus,textarea:focus { outline:2px solid color-mix(in srgb, var(--acc) 40%, transparent); border-color:var(--acc) }
  input { width:130px } textarea { flex:1; resize:none; min-height:40px; max-height:160px }
  .send { background:var(--acc); color:#fff; border:0; border-radius:10px; padding:9px 16px; font-weight:600; height:40px }
  .send:disabled { opacity:.5; cursor:default }
  @media (max-width:760px) { body { grid-template-columns:1fr; grid-template-rows:auto 1fr } aside { max-height:38vh } input { display:none } }
</style>
</head>
<body>
<aside>
  <div class="brand"><div><h1>Agent Chatroom</h1><div class="sub" id="sub">connecting…</div></div><button class="iconbtn" id="theme" title="Toggle theme">◐</button></div>
  <div class="rooms" id="rooms"></div>
</aside>
<main>
  <header id="head"><div class="empty">Pick a room</div></header>
  <div id="log"></div>
  <form id="say"><input id="name" placeholder="your name" value="benji" /><textarea id="text" rows="1" placeholder="Say something as a human (Enter to send, Shift+Enter for a new line)"></textarea><button class="send" id="sendbtn">Send</button></form>
</main>
<script>
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  let sel = new URLSearchParams(location.search).get('room') || null, seen = 0, roomsCache = [], lastSender = null, hideSys = store.get('hideSys', false), autoScroll = true;

  // theme
  const theme = store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
  $('#theme').onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next); };
  $('#name').value = store.get('name', 'benji'); $('#name').onchange = () => store.set('name', $('#name').value);

  // stable colour per participant name
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const av = (name, size) => '<span class="av" style="background:hsl(' + hue(name) + ' 55% 48%)">' + esc(name.replace(/^participant\\s+/i,'').slice(0,2).toUpperCase()) + '</span>';
  const fmtT = (ts) => new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const rel = (ts) => { const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000); return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s/60) + 'm ago' : Math.round(s/3600) + 'h ago'; };

  async function rooms() {
    try {
      roomsCache = await (await fetch('/rooms')).json();
      $('#sub').textContent = roomsCache.filter(r => r.state === 'open').length + ' live · ' + roomsCache.length + ' total';
      const sorted = [...roomsCache].sort((a,b) => b.created_at.localeCompare(a.created_at));
      const live = sorted.filter(r => r.state !== 'concluded'), done = sorted.filter(r => r.state === 'concluded');
      const item = (r) => '<button class="room' + (r.name===sel?' sel':'') + '" data-r="' + esc(r.name) + '"><div class="n"><span class="dot ' + r.state + '"></span><span class="t">' + esc(r.name) + '</span></div><div class="m">' + (r.topic ? esc(r.topic) : r.message_count + ' messages') + '</div></button>';
      $('#rooms').innerHTML = (live.length ? '<div class="group">Live</div>' + live.map(item).join('') : '') + (done.length ? '<div class="group">Concluded</div>' + done.map(item).join('') : '') || '<div class="empty">No rooms yet</div>';
      if (!sel && sorted.length) select((live[0] || sorted[0]).name);
      if (sel) head(roomsCache.find(r => r.name===sel));
    } catch { $('#sub').textContent = 'hub unreachable'; }
  }

  function head(r) {
    if (!r) return;
    const open = r.proposals.find(p => p.status === 'open');
    const voters = r.participants.filter(p => p.active && p.agent !== 'human').length || 1;
    const people = r.participants.map(p => '<span class="person' + (p.active?'':' off') + '" title="' + esc(p.agent) + (p.active?'':' · left') + '">' + av(p.name) + esc(p.name) + (p.label ? '<span class="role">' + esc(p.label) + '</span>' : '') + (p.agent==='human' ? '<span class="role">human</span>' : '') + '</span>').join('');
    let cards = '';
    if (open) {
      const a = open.tally.agree, d = open.tally.disagree;
      cards += '<div class="card prop"><div class="lbl">Open proposal <span class="chip">' + esc(open.id) + '</span> <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--dim)">by ' + esc(open.by) + '</span></div><div class="txt">' + esc(open.text) + '</div>'
        + '<div class="tally"><div class="bar"><i class="a" style="width:' + (100*a/voters) + '%"></i><i class="d" style="width:' + (100*d/voters) + '%"></i></div><span>' + a + ' agree · ' + d + ' disagree' + (open.waiting_on.length ? ' · waiting on ' + esc(open.waiting_on.join(', ')) : '') + '</span>'
        + (open.needs_challenge ? '<span class="need">needs a challenge</span>' : '') + '<button class="vbtn" data-p="' + open.id + '" data-v="agree">Agree</button><button class="vbtn veto" data-p="' + open.id + '" data-v="disagree">Veto</button></div>'
        + (open.challenges.length ? '<div class="tally" style="display:block">' + open.challenges.map(c => '<div><b>' + esc(c.by) + '</b> challenged: ' + esc(c.objection.slice(0,240)) + (c.objection.length>240?'…':'') + '</div>').join('') + '</div>' : '') + '</div>';
    }
    if (r.conclusion) cards += '<div class="card concl"><div class="lbl">Conclusion <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--dim)">' + rel(r.conclusion.decidedAt) + '</span></div><div class="txt">' + esc(r.conclusion.text) + '</div></div>';
    $('#head').innerHTML = '<div class="title"><h2>' + esc(r.name) + '</h2><span class="chip ' + r.state + '">' + r.state + '</span><span class="chip">' + r.mode.replace('_',' ') + '</span><span class="chip">' + r.quorum + '</span>' + (r.anonymous ? '<span class="chip">anonymous</span>' : '') + '<span class="chip">' + r.message_count + ' msgs</span></div>'
      + (r.topic ? '<div class="topic">' + esc(r.topic) + '</div>' : '')
      + '<div class="people">' + people + '</div>'
      + '<div class="tools"><label><input type="checkbox" id="hs" ' + (hideSys?'checked':'') + '/> hide system notices</label><label><input type="checkbox" id="as" ' + (autoScroll?'checked':'') + '/> follow new messages</label><a href="/rooms/' + encodeURIComponent(r.name) + '/transcript" target="_blank">transcript</a><a href="/rooms/' + encodeURIComponent(r.name) + '/stats" target="_blank">stats</a></div>'
      + cards;
    $('#hs').onchange = (e) => { hideSys = e.target.checked; store.set('hideSys', hideSys); rerender(); };
    $('#as').onchange = (e) => { autoScroll = e.target.checked; };
    $('#sendbtn').disabled = r.state === 'concluded';
    $('#text').placeholder = r.state === 'concluded' ? 'This room has concluded' : 'Say something as a human (Enter to send, Shift+Enter for a new line)';
  }

  let all = [];
  function select(name) { sel = name; seen = 0; all = []; lastSender = null; $('#log').innerHTML = ''; history.replaceState(null, '', '?room=' + encodeURIComponent(name)); rooms(); poll(); }
  function render(m) {
    const log = $('#log');
    if (m.kind === 'system') { if (hideSys) return; lastSender = null; const d = document.createElement('div'); d.className = 'sys'; d.innerHTML = esc(m.content).replace(/^([^ ]+( [A-Z])?)/, '<b>$1</b>') + ' <span title="' + fmtT(m.ts) + '">· ' + fmtT(m.ts) + '</span>'; log.appendChild(d); return; }
    const human = m.from.agent === 'human';
    const cont = lastSender === m.from.id && m.kind === 'chat';
    lastSender = m.from.id;
    const kind = m.kind === 'chat' ? (human ? 'human' : '') : m.kind;
    const long = m.content.length > 700;
    const d = document.createElement('div');
    d.className = 'msg' + (cont ? ' cont' : '');
    d.innerHTML = av(m.from.name) + '<div><div class="who"><b>' + esc(m.from.name) + '</b>' + (kind ? '<span class="k ' + kind + '">' + kind + '</span>' : '') + '<span class="t" title="#' + m.seq + '">' + fmtT(m.ts) + '</span></div>'
      + '<div class="body ' + kind + (long ? ' clamp' : '') + '">' + esc(m.content) + '</div>' + (long ? '<button class="more">show more</button>' : '') + '</div>';
    log.appendChild(d);
    if (long) d.querySelector('.more').onclick = (e) => { const b = d.querySelector('.body'); b.classList.toggle('clamp'); e.target.textContent = b.classList.contains('clamp') ? 'show more' : 'show less'; };
  }
  function rerender() { $('#log').innerHTML = ''; lastSender = null; for (const m of all) render(m); $('#log').scrollTop = $('#log').scrollHeight; }
  async function poll() {
    if (!sel) return;
    try {
      const msgs = await (await fetch('/rooms/' + encodeURIComponent(sel) + '/messages?since=' + seen)).json();
      if (!Array.isArray(msgs) || !msgs.length) return;
      const log = $('#log'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      if (!all.length) { const d = document.createElement('div'); d.className = 'day'; d.textContent = new Date(msgs[0].ts).toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'long' }); log.appendChild(d); }
      for (const m of msgs) { seen = m.seq; all.push(m); render(m); }
      if (autoScroll || atBottom) log.scrollTop = log.scrollHeight;
    } catch {}
  }
  document.addEventListener('click', async (e) => {
    const r = e.target.closest('.room'); if (r) return select(r.dataset.r);
    const v = e.target.closest('.vbtn'); if (!v || !sel) return;
    const reason = v.dataset.v === 'disagree' ? (window.prompt('Why? This vetoes the proposal.') || '') : '';
    if (v.dataset.v === 'disagree' && !reason) return;
    await fetch('/rooms/' + encodeURIComponent(sel) + '/vote', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: $('#name').value || 'human', proposal_id: v.dataset.p, vote: v.dataset.v, reason }) });
    rooms(); poll();
  });
  $('#say').addEventListener('submit', async (e) => {
    e.preventDefault(); if (!sel) return;
    const content = $('#text').value.trim(); if (!content) return;
    $('#sendbtn').disabled = true;
    await fetch('/rooms/' + encodeURIComponent(sel) + '/messages', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: $('#name').value || 'human', content }) });
    $('#text').value = ''; $('#text').style.height = ''; $('#sendbtn').disabled = false; poll();
  });
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#say').requestSubmit(); } });
  $('#text').addEventListener('input', (e) => { e.target.style.height = ''; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; });
  rooms(); setInterval(rooms, 3000); setInterval(poll, 1500);
</script>
</body>
</html>`;
