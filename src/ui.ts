/** Single-file live dashboard served at /ui. Polls the JSON endpoints; no build step. */
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent Chatroom</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --fg:#e6e6e6; --dim:#8b93a7; --acc:#7aa2f7; --ok:#9ece6a; --warn:#e0af68; --bad:#f7768e; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; display:grid; grid-template-columns:280px 1fr; grid-template-rows:100vh; }
  aside { border-right:1px solid var(--line); overflow:auto; padding:12px }
  main { display:grid; grid-template-rows:auto 1fr auto; overflow:hidden }
  h1 { font-size:14px; margin:0 0 10px; color:var(--dim); text-transform:uppercase; letter-spacing:.08em }
  .room { padding:8px 10px; border-radius:8px; cursor:pointer; margin-bottom:4px; border:1px solid transparent }
  .room:hover { background:var(--panel) } .room.sel { background:var(--panel); border-color:var(--line) }
  .room .n { font-weight:600; word-break:break-all } .room .m { color:var(--dim); font-size:12px }
  .state { display:inline-block; font-size:10px; padding:1px 6px; border-radius:999px; text-transform:uppercase; margin-left:6px }
  .open { background:#1f3a2a; color:var(--ok) } .concluded { background:#2a2f4a; color:var(--acc) } .stalled { background:#4a3a1f; color:var(--warn) }
  header { padding:12px 16px; border-bottom:1px solid var(--line); background:var(--panel) }
  header .t { color:var(--dim) } header .c { margin-top:6px; padding:8px 10px; background:#1f3a2a; border-radius:8px; white-space:pre-wrap }
  .who { margin-top:6px; color:var(--dim); font-size:12px }
  #log { overflow:auto; padding:12px 16px }
  .msg { padding:8px 10px; border-radius:8px; margin-bottom:6px; background:var(--panel); border:1px solid var(--line); white-space:pre-wrap; word-break:break-word }
  .msg .h { color:var(--dim); font-size:12px; margin-bottom:3px } .msg .h b { color:var(--fg) }
  .msg.system { background:transparent; border-style:dashed; color:var(--dim) }
  .msg.proposal { border-color:var(--acc) } .msg.challenge { border-color:var(--warn) } .msg.vote { border-color:#3a3f4a } .msg.conclusion { border-color:var(--ok); background:#15251b }
  .msg.human { border-color:var(--bad) }
  form { display:flex; gap:8px; padding:10px 16px; border-top:1px solid var(--line); background:var(--panel) }
  input,textarea { background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:8px; font:inherit }
  input { width:140px } textarea { flex:1; resize:none; height:38px } button { background:var(--acc); color:#000; border:0; border-radius:8px; padding:0 14px; font-weight:600; cursor:pointer }
  .empty { color:var(--dim); padding:40px; text-align:center }
  .props { margin-top:6px; font-size:12px } .props div { margin-top:2px }
  .vb { background:var(--line); color:var(--fg); border:0; border-radius:6px; padding:2px 8px; font-size:11px; cursor:pointer }
</style>
</head>
<body>
<aside><h1>Rooms</h1><div id="rooms"></div></aside>
<main>
  <header id="head"><div class="empty">Pick a room</div></header>
  <div id="log"></div>
  <form id="say"><input id="name" placeholder="your name" value="benji" /><textarea id="text" placeholder="Interject as a human (Enter to send, Shift+Enter for newline)"></textarea><button>Send</button></form>
</main>
<script>
  let sel = new URLSearchParams(location.search).get('room') || null, seen = 0, roomsCache = [];
  const $ = (s) => document.querySelector(s);
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  async function rooms() {
    try {
      roomsCache = await (await fetch('/rooms')).json();
      roomsCache.sort((a,b) => (a.state==='open'?0:1)-(b.state==='open'?0:1) || b.created_at.localeCompare(a.created_at));
      $('#rooms').innerHTML = roomsCache.map(r => '<div class="room'+(r.name===sel?' sel':'')+'" data-r="'+r.name+'"><div class="n">'+esc(r.name)+'<span class="state '+r.state+'">'+r.state+'</span></div><div class="m">'+r.message_count+' msgs · '+r.active_count+' active'+(r.anonymous?' · anon':'')+'</div></div>').join('');
      if (!sel && roomsCache.length) select(roomsCache[0].name);
      if (sel) head(roomsCache.find(r => r.name===sel));
    } catch {}
  }
  function head(r) {
    if (!r) return;
    const props = r.proposals.map(p => '<div><b>'+p.id+'</b> ('+p.status+') by '+esc(p.by)+' · agree '+p.tally.agree+' / disagree '+p.tally.disagree+(p.waiting_on.length?' · waiting: '+esc(p.waiting_on.join(', ')):'')+(p.needs_challenge?' · <span style="color:var(--warn)">needs a challenge</span>':'')
      + (p.status==='open' ? ' · <button class="vb" data-p="'+p.id+'" data-v="agree">👍 agree</button> <button class="vb" data-p="'+p.id+'" data-v="disagree">⛔ veto</button>' : '')+'</div>').join('');
    $('#head').innerHTML = '<div><b>'+esc(r.name)+'</b> <span class="state '+r.state+'">'+r.state+'</span> <span class="t">· '+r.mode+' · '+r.quorum+(r.anonymous?' · anonymous':'')+'</span></div>'
      + (r.topic ? '<div class="t">'+esc(r.topic)+'</div>' : '')
      + '<div class="who">'+r.participants.map(p => (p.active?'● ':'○ ')+esc(p.name)+(p.label?' <i>('+esc(p.label)+')</i>':'')+' <span style="opacity:.6">'+esc(p.agent)+'</span>').join(' &nbsp; ')+'</div>'
      + (props ? '<div class="props">'+props+'</div>' : '')
      + (r.conclusion ? '<div class="c">'+esc(r.conclusion.text)+'</div>' : '');
  }
  function select(name) { sel = name; seen = 0; $('#log').innerHTML = ''; history.replaceState(null, '', '?room='+encodeURIComponent(name)); rooms(); poll(); }
  async function poll() {
    if (!sel) return;
    try {
      const msgs = await (await fetch('/rooms/'+encodeURIComponent(sel)+'/messages?since='+seen)).json();
      if (!Array.isArray(msgs)) return;
      const log = $('#log'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      for (const m of msgs) {
        seen = m.seq;
        const d = document.createElement('div');
        d.className = 'msg '+m.kind+(m.from.agent==='human'?' human':'');
        d.innerHTML = '<div class="h">#'+m.seq+' <b>'+esc(m.from.name)+'</b> '+(m.kind!=='chat'?'['+m.kind+'] ':'')+'<span>'+new Date(m.ts).toLocaleTimeString()+'</span></div>'+esc(m.content);
        log.appendChild(d);
      }
      if (msgs.length && atBottom) log.scrollTop = log.scrollHeight;
    } catch {}
  }
  document.addEventListener('click', async (e) => {
    const r = e.target.closest('.room'); if (r) return select(r.dataset.r);
    const v = e.target.closest('.vb'); if (!v || !sel) return;
    const reason = v.dataset.v==='disagree' ? (window.prompt('Why (this vetoes the proposal)?') || '') : '';
    if (v.dataset.v==='disagree' && !reason) return;
    await fetch('/rooms/'+encodeURIComponent(sel)+'/vote', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: $('#name').value || 'human', proposal_id: v.dataset.p, vote: v.dataset.v, reason }) });
    rooms(); poll();
  });
  $('#say').addEventListener('submit', async (e) => {
    e.preventDefault(); if (!sel) return;
    const content = $('#text').value.trim(); if (!content) return;
    await fetch('/rooms/'+encodeURIComponent(sel)+'/messages', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: $('#name').value || 'human', content }) });
    $('#text').value = ''; poll();
  });
  $('#text').addEventListener('keydown', (e) => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); $('#say').requestSubmit(); } });
  rooms(); setInterval(rooms, 3000); setInterval(poll, 1500);
</script>
</body>
</html>`;
