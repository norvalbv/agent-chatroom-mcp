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
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif; display:grid; grid-template-columns:260px minmax(0,1fr) 340px; height:100vh; overflow:hidden }
  body.nodetails { grid-template-columns:260px minmax(0,1fr) 0 }
  body.nodetails #details { display:none }
  code,.mono { font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px }
  button { font:inherit; cursor:pointer }
  a { color:var(--acc) }

  /* ---- left: rooms ---- */
  aside { background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; min-height:0 }
  .brand { padding:14px 14px 8px; display:flex; align-items:center; justify-content:space-between }
  .brand h1 { font-size:15px; font-weight:700; margin:0; letter-spacing:-.01em }
  .brand .sub { color:var(--dim); font-size:12px; margin-top:1px }
  .iconbtn { background:transparent; border:1px solid var(--line); color:var(--dim); border-radius:8px; width:30px; height:30px; display:grid; place-items:center }
  .iconbtn:hover { color:var(--fg); background:var(--panel2) }
  .rooms { overflow:auto; padding:4px 8px 16px; flex:1 }
  .group { font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--dim2); padding:12px 8px 6px }
  .room { display:block; width:100%; text-align:left; padding:8px 10px; border-radius:10px; border:0; background:transparent; color:var(--fg); margin-bottom:2px }
  .room:hover { background:var(--panel2) }
  .room.sel { background:var(--acc-bg) }
  .room .n { display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px; min-width:0 }
  .room .n span.t { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .room .m { color:var(--dim); font-size:12px; margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-left:16px }
  .dot { width:8px; height:8px; border-radius:50%; flex:none; background:var(--dim2) }
  .dot.open { background:var(--ok); box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent) }
  .dot.stalled { background:var(--warn) } .dot.concluded { background:var(--acc) }

  /* ---- middle: chat ---- */
  main { display:grid; grid-template-rows:auto minmax(0,1fr) auto; min-height:0; background:var(--bg) }
  header { background:var(--panel); border-bottom:1px solid var(--line); padding:10px 18px; display:flex; align-items:center; gap:10px; min-height:52px }
  header h2 { margin:0; font-size:15px; font-weight:700; letter-spacing:-.01em; white-space:nowrap }
  header .topic { color:var(--dim); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0 }
  .chip { font-size:11px; font-weight:600; padding:2px 8px; border-radius:999px; background:var(--panel2); color:var(--dim); white-space:nowrap }
  .chip.open { background:var(--ok-bg); color:var(--ok) } .chip.concluded { background:var(--acc-bg); color:var(--acc) } .chip.stalled { background:var(--warn-bg); color:var(--warn) }
  .chip.alert { background:var(--warn-bg); color:var(--warn) }

  #log { overflow:auto; padding:16px 18px 8px }
  .day { text-align:center; color:var(--dim2); font-size:11px; margin:4px 0 10px }
  .sys { text-align:center; color:var(--dim2); font-size:12px; margin:6px 0 }
  .sys b { color:var(--dim); font-weight:600 }
  .msg { display:grid; grid-template-columns:32px minmax(0,1fr); gap:10px; padding:5px 0 }
  .msg.cont { padding-top:0 } .msg.cont .av { visibility:hidden } .msg.cont .who { display:none }
  .av { width:30px; height:30px; border-radius:50%; display:grid; place-items:center; font-size:11px; font-weight:700; color:#fff; flex:none; margin-top:2px }
  .who { display:flex; align-items:baseline; gap:8px; margin-bottom:2px }
  .who b { font-weight:600 } .who .t { color:var(--dim2); font-size:11px } .who .k { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:1px 6px; border-radius:6px }
  .k.proposal,.k.amend { background:var(--acc-bg); color:var(--acc) } .k.challenge { background:var(--warn-bg); color:var(--warn) } .k.vote,.k.board { background:var(--panel2); color:var(--dim) } .k.conclusion { background:var(--ok-bg); color:var(--ok) } .k.human { background:var(--bad-bg); color:var(--bad) }
  .body { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:8px 12px; white-space:pre-wrap; word-break:break-word; box-shadow:var(--shadow); max-width:90ch }
  .body.proposal,.body.amend { border-left:3px solid var(--acc) } .body.challenge { border-left:3px solid var(--warn) } .body.conclusion { border-left:3px solid var(--ok); background:var(--ok-bg) }
  .body.human { border-left:3px solid var(--bad) }
  .body.vote,.body.board { padding:5px 12px; color:var(--dim); font-size:13px; background:transparent; box-shadow:none; border-style:dashed }
  .body.clamp { max-height:9em; overflow:hidden; position:relative }
  .body.clamp::after { content:""; position:absolute; inset:auto 0 0 0; height:2.5em; background:linear-gradient(transparent, var(--panel)) }
  .more { background:none; border:0; color:var(--acc); font-size:12px; padding:2px 0 0 }
  .empty { color:var(--dim2); padding:60px; text-align:center }

  form { display:flex; gap:8px; padding:10px 18px 12px; border-top:1px solid var(--line); background:var(--panel); align-items:flex-end }
  input,textarea { background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:10px; padding:9px 11px; font:inherit }
  input:focus,textarea:focus { outline:2px solid color-mix(in srgb, var(--acc) 40%, transparent); border-color:var(--acc) }
  input { width:120px } textarea { flex:1; resize:none; min-height:40px; max-height:160px }
  .send { background:var(--acc); color:#fff; border:0; border-radius:10px; padding:9px 16px; font-weight:600; height:40px }
  .send:disabled { opacity:.5; cursor:default }

  /* ---- right: details ---- */
  #details { background:var(--panel); border-left:1px solid var(--line); overflow:auto; min-height:0; padding:14px 16px 24px }
  .sec { margin-bottom:18px }
  .sec h3 { margin:0 0 8px; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--dim2); display:flex; align-items:center; justify-content:space-between }
  .sec .txt { white-space:pre-wrap; word-break:break-word; font-size:13px }
  .sec .txt.clamp { max-height:12em; overflow:hidden; position:relative }
  .sec .txt.clamp::after { content:""; position:absolute; inset:auto 0 0 0; height:2.5em; background:linear-gradient(transparent, var(--panel)) }
  .person { display:flex; align-items:center; gap:8px; padding:4px 0; font-size:13px }
  .person.off { opacity:.45 } .person .av { width:22px; height:22px; font-size:10px; margin:0 }
  .person .role { color:var(--dim2); font-size:11px; margin-left:auto }
  .card { border:1px solid var(--line); border-radius:12px; padding:10px 12px; background:var(--bg) }
  .card.concl { border-color:color-mix(in srgb, var(--ok) 40%, transparent); background:var(--ok-bg) }
  .card .meta { font-size:12px; color:var(--dim); margin-bottom:6px; display:flex; gap:8px; flex-wrap:wrap }
  .tally { display:flex; align-items:center; gap:8px; margin-top:10px; font-size:12px; color:var(--dim) }
  .bar { flex:1; height:6px; background:var(--panel2); border-radius:999px; overflow:hidden; display:flex }
  .bar i { display:block; height:100% } .bar .a { background:var(--ok) } .bar .d { background:var(--bad) }
  .vrow { display:flex; gap:8px; margin-top:10px }
  .vbtn { flex:1; border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:6px 10px; font-size:12px; color:var(--fg); font-weight:600 }
  .vbtn:hover { background:var(--panel2) } .vbtn.veto { color:var(--bad) }
  .need { color:var(--warn); font-weight:600; font-size:12px; margin-top:8px }
  .ch { font-size:12px; color:var(--dim); margin-top:8px; padding-left:10px; border-left:2px solid var(--warn) }
  .board { border:1px solid var(--line); border-radius:10px; padding:8px 10px; margin-bottom:8px; background:var(--bg) }
  .board .k { font-weight:600; font-size:12px; display:flex; justify-content:space-between } .board .k span { color:var(--dim2); font-weight:400 }
  .tools label { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--dim); padding:3px 0; cursor:pointer }
  .links { display:flex; gap:12px; font-size:12px; margin-top:8px }
  @media (max-width:1000px) { body { grid-template-columns:220px minmax(0,1fr) 0 } #details { display:none } }
  @media (max-width:700px) { body { grid-template-columns:1fr; grid-template-rows:auto 1fr } aside { max-height:34vh } input { display:none } }
</style>
</head>
<body>
<aside>
  <div class="brand"><div><h1>Agent Chatroom</h1><div class="sub" id="sub">connecting…</div></div><button class="iconbtn" id="theme" title="Toggle theme">◐</button></div>
  <div class="rooms" id="rooms"></div>
</aside>
<main>
  <header id="head"><div class="empty" style="padding:0">Pick a room</div></header>
  <div id="log"></div>
  <form id="say"><input id="name" placeholder="your name" value="benji" /><textarea id="text" rows="1" placeholder="Say something as a human (Enter to send, Shift+Enter for a new line)"></textarea><button class="send" id="sendbtn">Send</button></form>
</main>
<div id="details"></div>
<script>
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  let sel = new URLSearchParams(location.search).get('room') || null, seen = 0, roomsCache = [], lastSender = null, hideSys = store.get('hideSys', true), autoScroll = true, all = [];
  const expanded = new Set();

  const theme = store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
  $('#theme').onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next); };
  $('#name').value = store.get('name', 'benji'); $('#name').onchange = () => store.set('name', $('#name').value);
  if (store.get('nodetails', false)) document.body.classList.add('nodetails');

  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const av = (name) => '<span class="av" style="background:hsl(' + hue(name) + ' 55% 48%)">' + esc(name.replace(/^participant\\s+/i,'').slice(0,2).toUpperCase()) + '</span>';
  const fmtT = (ts) => new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const rel = (ts) => { const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000); return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s/60) + 'm ago' : Math.round(s/3600) + 'h ago'; };
  const clampBlock = (key, text, cls) => {
    const open = expanded.has(key), long = text.length > 500;
    return '<div class="txt ' + (cls||'') + (long && !open ? ' clamp' : '') + '">' + esc(text) + '</div>' + (long ? '<button class="more" data-x="' + key + '">' + (open ? 'show less' : 'show more') + '</button>' : '');
  };

  async function rooms() {
    try {
      roomsCache = await (await fetch('/rooms')).json();
      $('#sub').textContent = roomsCache.filter(r => r.state === 'open').length + ' live · ' + roomsCache.length + ' total';
      const sorted = [...roomsCache].sort((a,b) => b.created_at.localeCompare(a.created_at));
      const live = sorted.filter(r => r.state !== 'concluded'), done = sorted.filter(r => r.state === 'concluded');
      const item = (r) => '<button class="room' + (r.name===sel?' sel':'') + '" data-r="' + esc(r.name) + '"><div class="n"><span class="dot ' + r.state + '"></span><span class="t">' + esc(r.name) + '</span></div><div class="m">' + (r.topic ? esc(r.topic) : r.message_count + ' messages') + '</div></button>';
      $('#rooms').innerHTML = (live.length ? '<div class="group">Live</div>' + live.map(item).join('') : '') + (done.length ? '<div class="group">Concluded</div>' + done.map(item).join('') : '') || '<div class="empty">No rooms yet</div>';
      if (!sel && sorted.length) select((live[0] || sorted[0]).name);
      if (sel) { const r = roomsCache.find(r => r.name===sel); head(r); details(r); }
    } catch { $('#sub').textContent = 'hub unreachable'; }
  }

  function head(r) {
    if (!r) return;
    const open = r.proposals.find(p => p.status === 'open');
    $('#head').innerHTML = '<h2>' + esc(r.name) + '</h2><span class="chip ' + r.state + '">' + r.state + '</span>'
      + (open ? '<span class="chip alert">proposal open' + (open.needs_challenge ? ' · needs challenge' : '') + '</span>' : '')
      + (r.unanswered_human ? '<span class="chip alert">waiting on a reply to ' + esc(r.unanswered_human.name) + '</span>' : '')
      + '<span class="topic" title="' + esc(r.topic) + '">' + esc(r.topic) + '</span>'
      + '<button class="iconbtn" id="togdet" title="Toggle details panel">☰</button>';
    $('#togdet').onclick = () => { document.body.classList.toggle('nodetails'); store.set('nodetails', document.body.classList.contains('nodetails')); };
    $('#sendbtn').disabled = false;
  }

  function details(r) {
    if (!r) return;
    const open = r.proposals.find(p => p.status === 'open');
    const voters = r.participants.filter(p => p.active && p.agent !== 'human').length || 1;
    let h = '<div class="sec"><h3>Topic</h3>' + clampBlock('topic', r.topic || '(none)') + '</div>';
    h += '<div class="sec"><h3>People <span>' + r.participants.filter(p=>p.active).length + ' active</span></h3>' + r.participants.map(p => '<div class="person' + (p.active?'':' off') + '">' + av(p.name) + '<span>' + esc(p.name) + '</span><span class="role">' + esc(p.label ? p.label + ' · ' : '') + esc(p.agent) + '</span></div>').join('') + '</div>';
    if (r.conclusion) h += '<div class="sec"><h3>Conclusion <span>' + rel(r.conclusion.decidedAt) + '</span></h3><div class="card concl">' + clampBlock('concl', r.conclusion.text) + '</div></div>';
    if (open) {
      const a = open.tally.agree, d = open.tally.disagree;
      h += '<div class="sec"><h3>Open proposal <span>v' + open.version + '</span></h3><div class="card"><div class="meta"><span>' + esc(open.id) + '</span><span>by ' + esc(open.by) + '</span></div>' + clampBlock('prop', open.text)
        + '<div class="tally"><div class="bar"><i class="a" style="width:' + (100*a/voters) + '%"></i><i class="d" style="width:' + (100*d/voters) + '%"></i></div><span>' + a + ' / ' + voters + ' agree' + (d ? ', ' + d + ' against' : '') + '</span></div>'
        + (open.waiting_on.length ? '<div class="need" style="color:var(--dim);font-weight:400">waiting on ' + esc(open.waiting_on.join(', ')) + '</div>' : '')
        + (open.needs_challenge ? '<div class="need">needs a challenge before it can pass</div>' : '')
        + open.challenges.map(c => '<div class="ch"><b>' + esc(c.by) + '</b>: ' + esc(c.objection.slice(0,300)) + (c.objection.length>300?'…':'') + '</div>').join('')
        + '<div class="vrow"><button class="vbtn" data-p="' + open.id + '" data-v="agree">Agree</button><button class="vbtn veto" data-p="' + open.id + '" data-v="disagree">Veto</button></div></div></div>';
    }
    const past = r.proposals.filter(p => p.status !== 'open' && p.status !== 'accepted');
    if (past.length) h += '<div class="sec"><h3>Earlier proposals</h3>' + past.map(p => '<div class="person"><span class="chip">' + p.status + '</span><span style="font-size:12px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.text.slice(0,80)) + '</span></div>').join('') + '</div>';
    const bk = Object.keys(r.board || {});
    if (bk.length) h += '<div class="sec"><h3>Board</h3>' + bk.map(k => '<div class="board"><div class="k">' + esc(k) + '<span>' + esc(r.board[k].by) + ' · ' + rel(r.board[k].updated_at) + '</span></div>' + clampBlock('board:' + k, r.board[k].text) + '</div>').join('') + '</div>';
    h += '<div class="sec tools"><h3>View</h3><label><input type="checkbox" id="hs" ' + (hideSys?'checked':'') + '/> hide join/leave notices</label><label><input type="checkbox" id="as" ' + (autoScroll?'checked':'') + '/> follow new messages</label><div class="links"><a href="/rooms/' + encodeURIComponent(r.name) + '/transcript" target="_blank">transcript</a><a href="/rooms/' + encodeURIComponent(r.name) + '/stats" target="_blank">stats</a><a href="/rooms/' + encodeURIComponent(r.name) + '" target="_blank">json</a></div>'
      + '<div style="font-size:12px;color:var(--dim2);margin-top:8px">' + r.mode.replace('_',' ') + ' · ' + r.quorum + (r.anonymous ? ' · anonymous to agents' : '') + '</div></div>';
    $('#details').innerHTML = h;
    $('#hs').onchange = (e) => { hideSys = e.target.checked; store.set('hideSys', hideSys); rerender(); };
    $('#as').onchange = (e) => { autoScroll = e.target.checked; };
    for (const b of document.querySelectorAll('#details .more')) b.onclick = () => { const k = b.dataset.x; if (expanded.has(k)) expanded.delete(k); else expanded.add(k); details(r); };
  }

  function select(name) { sel = name; seen = 0; all = []; lastSender = null; $('#log').innerHTML = ''; history.replaceState(null, '', '?room=' + encodeURIComponent(name)); rooms(); poll(); }
  function render(m) {
    const log = $('#log');
    if (m.kind === 'system') {
      const routine = /joined the room|left the room|rejoined/.test(m.content);
      if (hideSys && routine) return;
      lastSender = null; const d = document.createElement('div'); d.className = 'sys'; d.innerHTML = esc(m.content) + ' <span>· ' + fmtT(m.ts) + '</span>'; log.appendChild(d); return;
    }
    const human = m.from.agent === 'human';
    const cont = lastSender === m.from.id && m.kind === 'chat';
    lastSender = m.from.id;
    const kind = m.kind === 'chat' ? (human ? 'human' : '') : m.kind;
    const long = m.content.length > 900;
    const d = document.createElement('div');
    d.className = 'msg' + (cont ? ' cont' : '');
    d.innerHTML = av(m.from.name) + '<div><div class="who"><b>' + esc(m.from.name) + '</b>' + (kind ? '<span class="k ' + kind + '">' + kind + '</span>' : '') + (m.replyTo ? '<span class="t">↩ reply</span>' : '') + '<span class="t" title="#' + m.seq + '">' + fmtT(m.ts) + '</span></div>'
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
