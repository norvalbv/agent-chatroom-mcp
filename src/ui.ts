import { UI_CSS } from "./ui/styles.js";

/**
 * Live dashboard served at /ui. No browser bundler: it polls the JSON endpoints
 * (/rooms, /rooms/:room/messages, /rooms/:room/stats) and posts as a human through
 * /rooms/:room/messages, /rooms/:room/vote and /rooms/:room/close.
 *
 * Built for one reader: a human watching up to a dozen agents across a run's rooms. Three
 * panes on a desktop (rooms, transcript, inspector), a bottom tab bar on a phone. Every
 * message kind the hub produces has its own rendering, and the inspector shows the
 * decision as the hub sees it: version, tally, who it waits on, what blocks it.
 */
import { PALETTE_CSS, PALETTE_HTML, PALETTE_JS } from "./ui/palette.js";
import { INBOX_CSS, INBOX_JS } from "./ui/inbox.js";
import { CATCHUP_CSS, CATCHUP_JS } from "./ui/catchup.js";

export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Agent Chatroom</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>${UI_CSS}
${PALETTE_CSS}
${INBOX_CSS}
${CATCHUP_CSS}</style>
</head>
<body data-view="chat">
<aside id="rail">
  <div class="brand"><div class="mark">✻</div><div><h1>Agent Chatroom</h1><div class="sub" id="sub">connecting…</div></div><div class="sp"></div><button class="btn icon" id="palbtn" title="Command palette (⌘K / Ctrl K)" aria-label="Open command palette">⌘</button><button class="btn icon" id="theme" title="Toggle theme">◐</button></div>
  <button class="qbar" id="qbar" title="Questions agents asked you that nobody has answered (i)"><span class="ql">For you</span><span class="qs" id="qbars">checking…</span><span class="qc" id="qbarn"></span></button>
  <div class="filter"><input id="filter" placeholder="Filter rooms" /></div>
  <div class="rctl" id="rctl"><select id="sort" title="Sort rooms"><option value="newest">Newest</option><option value="active">Most active</option><option value="msgs">Most messages</option><option value="name">Name</option></select><button class="chip tog on" data-st="live" title="Show open and stalled rooms">live</button><button class="chip tog on" data-st="concluded">concluded</button><button class="chip tog on" data-st="closed">closed</button><button class="chip tog" id="showarch" title="Include archived rooms">archived</button><button class="btn" id="archdead" title="Hide every room nobody is in. Transcripts are kept; they reappear under 'archived'.">Archive dead</button></div>
  <div class="policy" id="policy" title="Which provider and model every request_agent launches as. Click to change.">recruits: …</div>
  <div id="rooms"></div>
</aside>
<main id="main">
  <div id="head"><div class="t1"><h2>Pick a room</h2></div></div>
  <div class="lf" id="lf"><button class="chip tog on" data-k="chat">chat</button><button class="chip tog on" data-k="cards">proposals</button><button class="chip tog on" data-k="vote">votes</button><button class="chip tog on" data-k="board">board</button><button class="chip tog on" data-k="system">system</button><select id="whof" title="Only messages from, or addressed to, one participant"><option value="">everyone</option></select><input id="msgq" placeholder="Search messages" /></div>
  <div id="log"><div class="empty">Pick a room on the left.</div></div>
  <button id="newpill">↓ new messages</button>
  <form id="compose">
    <div class="quick" id="quick"></div>
    <input id="name" placeholder="your name" />
    <textarea id="text" rows="1" placeholder="Say something. Start with @name or @all to choose who answers."></textarea>
    <button class="btn primary" id="sendbtn" type="submit">Send</button>
    <div class="hint" id="hint">Humans bypass budgets and the stale-send guard; one agent answers unless you address @all.</div>
  </form>
</main>
<section id="inspect">
  <div class="tabs" id="tabs">
    <button data-tab="decision" class="on">Decision</button>
    <button data-tab="people">People <span class="n" id="n-people"></span></button>
    <button data-tab="board">Board <span class="n" id="n-board"></span></button>
    <button data-tab="stats">Stats</button>
    <div class="sp" style="flex:1"></div>
    <button id="closeinspect" title="Hide inspector" style="align-self:center">✕</button>
  </div>
  <div id="pane"><div class="empty">Nothing selected.</div></div>
</section>
${PALETTE_HTML}
<nav id="tabbar">
  <button data-view="rooms">Rooms</button>
  <button data-view="chat" class="on">Chat <span class="n" id="n-unread" style="display:none"></span></button>
  <button data-view="inspect">Inspect</button>
</nav>
<div id="qpanel" hidden><div class="qsheet" role="dialog" aria-modal="true" aria-labelledby="qtitle" tabindex="-1"></div></div>
<div id="qtoast" role="status" aria-live="polite"></div>
<script>
(function () {
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('cr.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('cr.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var TOKEN = null;
  var hdrs = function () { var h = { 'content-type': 'application/json' }; if (TOKEN) h['x-chatroom-token'] = TOKEN; return h; };
  fetch('/config').then(function (r) { return r.json(); }).then(function (c) {
    if (c.human_token_required) { TOKEN = store.get('token', null) || window.prompt('This hub needs a human token (CHATROOM_HUMAN_TOKEN):'); if (TOKEN) store.set('token', TOKEN); }
  }).catch(function () {});

  // ---------- state ----------
  var sel = new URLSearchParams(location.search).get('room') || null;
  var rooms = [];          // summaries from /rooms
  var cur = null;          // summary of the selected room
  var msgs = [];           // messages of the selected room
  var seen = 0;            // last seq fetched
  var lastSender = null;
  var tab = store.get('tab', 'decision');
  var showNotices = store.get('notices', false);
  // People tab: click a person to see their recent steps (heartbeats with the command, path or pattern)
  var personOpen = null, activity = {}, actFor = null;
  async function fetchActivity(name) { try { var res = await fetch('/rooms/' + encodeURIComponent(sel) + '/participants/' + encodeURIComponent(name) + '/activity'); if (res.ok) { activity[name] = await res.json(); if (tab === 'people') renderPane(); } } catch (e) {} }
  document.addEventListener('click', function (e) { var row = e.target.closest && e.target.closest('.person'); if (!row || e.target.closest('.act, .pacts')) return; var n = row.dataset.person; personOpen = personOpen === n ? null : n; if (personOpen) fetchActivity(personOpen); renderPane(); });
  setInterval(function () { if (personOpen && tab === 'people' && !document.hidden) fetchActivity(personOpen); }, 3000);
  /*act:start*/
  // The open person's steps, newest first, under one line saying what the seat is doing right now.
  function actPanel(p, list, esc, rel) {
    if (!list) return 'Loading…';
    var busy = p.active && p.working && (!p.last_active_at || p.working.at > p.last_active_at);
    var now = !p.active ? '<div class="now off">Left the room' + (p.left_reason ? ': ' + esc(p.left_reason) : '') + '</div>'
      : busy ? '<div class="now live"><span class="dot"></span>Now: <span class="tl">' + esc(p.working.tool) + '</span> ' + esc(p.working.detail || '') + ' <span class="st">· started ' + rel(p.working.at) + '</span></div>'
      : '<div class="now">Not running a tool · last active in the room ' + rel(p.last_active_at || p.last_seen_at) + '</div>';
    if (!list.length) return now + '<div class="st">No heartbeats yet (only seats started after 2026-09-18 send them).</div>';
    return now + '<div class="hdr">Recent steps, newest first</div>' + list.slice().reverse().map(function (a, i) {
      return '<div data-k="' + esc(a.step + '@' + a.at) + '"' + (i === 0 ? ' class="latest"' : '') + '><span class="st">#' + a.step + ' ' + rel(a.at) + '</span> <span class="tl">' + esc(a.tool) + '</span> ' + esc(a.detail || '') + '</div>';
    }).join('');
  }
  // Re-rendering replaces the panel, so keep the reader's place: at the top they follow the newest step; scrolled down,
  // the first row they could see stays where it was (new steps arrive above it and the oldest drop off below).
  function actAnchor(scrollTop, rows) {
    if (scrollTop <= 2) return { top: true };
    for (var i = 0; i < rows.length; i++) if (rows[i].top + rows[i].height > scrollTop) return { k: rows[i].k, off: rows[i].top - scrollTop, scrollTop: scrollTop };
    return { scrollTop: scrollTop };
  }
  function actRestore(anchor, rows) {
    if (!anchor || anchor.top) return 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].k === anchor.k) return Math.max(0, rows[i].top - anchor.off);
    return anchor.scrollTop || 0;
  }
  /*act:end*/
  var actRows = function (el) { return Array.prototype.filter.call(el.children, function (c) { return c.dataset && c.dataset.k; }).map(function (c) { return { k: c.dataset.k, top: c.offsetTop, height: c.offsetHeight }; }); };
  // rooms rail: sort, state filter, archived toggle
  var sortBy = store.get('sort', 'newest'), stOff = store.get('stOff', {}), showArch = /[?&]archived=1/.test(location.search) || store.get('showArch', false);
  var stKey = function (r) { return (r.state === 'open' || r.state === 'stalled') ? 'live' : r.state; };
  var roomCmp = function (a, b) {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'active') return (b.active_count || 0) - (a.active_count || 0) || b.created_at.localeCompare(a.created_at);
    if (sortBy === 'msgs') return (b.message_count || 0) - (a.message_count || 0) || b.created_at.localeCompare(a.created_at);
    return b.created_at.localeCompare(a.created_at);
  };
  $('#sort').value = sortBy;
  $('#sort').onchange = function () { sortBy = $('#sort').value; store.set('sort', sortBy); renderRooms(); };
  $$('#rctl .tog[data-st]').forEach(function (b) {
    b.classList.toggle('on', !stOff[b.dataset.st]);
    b.onclick = function () { stOff[b.dataset.st] = !stOff[b.dataset.st]; store.set('stOff', stOff); b.classList.toggle('on', !stOff[b.dataset.st]); renderRooms(); };
  });
  $('#showarch').classList.toggle('on', showArch);
  $('#showarch').onclick = function () { showArch = !showArch; store.set('showArch', showArch); $('#showarch').classList.toggle('on', showArch); refreshRooms(); };
  $('#archdead').onclick = async function () {
    if (!window.confirm('Archive every room nobody is in? Nothing is deleted: transcripts stay on disk and the rooms reappear under "archived".')) return;
    var res = await fetch('/rooms/archive-dead', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: myName() }) });
    var out = res.ok ? await res.json() : { archived: [] };
    $('#sub').textContent = 'archived ' + out.archived.length + ' rooms';
    refreshRooms();
  };
  // transcript filter: kinds, one participant, text
  var kindOff = {}, msgQuery = '', whoF = '';
  var kindGroup = function (m) { return m.kind === 'chat' ? 'chat' : (m.kind === 'proposal' || m.kind === 'amend' || m.kind === 'challenge' || m.kind === 'conclusion') ? 'cards' : m.kind === 'vote' ? 'vote' : m.kind === 'board' ? 'board' : m.kind === 'system' ? 'system' : 'other'; };
  var visible = function (m) {
    if (kindOff[kindGroup(m)]) return false;
    if (whoF && m.from.name !== whoF && m.content.indexOf('@' + whoF) < 0) return false;
    if (msgQuery && (m.content + ' ' + m.from.name).toLowerCase().indexOf(msgQuery) < 0) return false;
    return true;
  };
  $$('#lf .tog[data-k]').forEach(function (b) { b.onclick = function () { kindOff[b.dataset.k] = !kindOff[b.dataset.k]; b.classList.toggle('on', !kindOff[b.dataset.k]); rerender(); toBottom(); }; });
  var qTimer = null;
  $('#msgq').oninput = function () { clearTimeout(qTimer); qTimer = setTimeout(function () { msgQuery = $('#msgq').value.trim().toLowerCase(); rerender(); }, 150); };
  $('#whof').onchange = function () { whoF = $('#whof').value; rerender(); };
  var expanded = {};
  var lastSeen = store.get('lastSeen', {});   // room -> latest seq the human has looked at
  var openRuns = store.get('openRuns', {});
  var stats = null, statsAt = 0;
  var boardQuery = '';
  var unreadPill = 0;
  var myName = function () { return ($('#name').value || 'benji').trim() || 'benji'; };

  var theme = new URLSearchParams(location.search).get('theme') || store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
  $('#theme').onclick = function () {
    var cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next);
  };
  $('#name').value = store.get('name', 'benji'); $('#name').onchange = function () { store.set('name', $('#name').value); };
  if (store.get('noinspect', false)) document.body.classList.add('noinspect');
  $('#closeinspect').onclick = function () {
    if (innerWidth <= 720) { setView('chat'); return; }
    if (innerWidth <= 1100) { document.body.classList.remove('inspect-open'); return; }
    document.body.classList.add('noinspect'); store.set('noinspect', true);
  };

  // ---------- helpers ----------
  var hue = function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
  var initials = function (name) { var n = name.replace(/^participant\\s+/i, ''); var parts = n.split(/[-_\\s]+/).filter(Boolean); return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : n.slice(0, 2)).toUpperCase(); };
  var av = function (name, agent) { return '<span class="av" style="background:hsl(' + hue(name) + ' 45% ' + (agent === 'human' ? 42 : 50) + '%)" title="' + esc(name) + '">' + esc(initials(name)) + '</span>'; };
  var fmtT = function (ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  var fmtTs = function (ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  var rel = function (ts) { if (!ts) return ''; var s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000); return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  var dur = function (ms) { if (ms == null) return '—'; var m = Math.round(ms / 60000); return m < 1 ? Math.round(ms / 1000) + 's' : m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
  var runOf = function (name) { var m = /^(swarm-[0-9]{6}(?:-[a-z0-9]{4})?)-/.exec(name); return m ? m[1] : null; };
  var roleTag = function (p) { var r = p.agent === 'human' ? 'human' : (p.role && p.role !== 'worker' ? p.role : ''); return r ? '<span class="tag ' + r + '">' + esc(r) + '</span>' : ''; };
  var pmap = function () { var m = {}; if (cur) cur.participants.forEach(function (p) { m[p.name] = p; }); return m; };
  var openProposal = function (r) { return r && r.proposals ? r.proposals.filter(function (p) { return p.status === 'open'; })[0] : null; };
  var voters = function (r) { return r.participants.filter(function (p) { return p.active && p.agent !== 'human' && p.role !== 'chair'; }).length; };
  var withMentions = function (html) {
    var me = myName().toLowerCase();
    return html.replace(/(^|[\\s(])@([\\w-]+)/g, function (all, pre, n) { return pre + '<span class="mention' + (n.toLowerCase() === me || n === 'all' ? ' me' : '') + '">@' + n + '</span>'; });
  };
  var clampable = function (key, text, limit, cls) {
    var long = text.length > (limit || 700), open = !!expanded[key];
    return '<div class="' + (cls || '') + (long && !open ? ' clamp' : '') + '">' + withMentions(esc(text)) + '</div>' + (long ? '<button class="more" data-x="' + esc(key) + '">' + (open ? 'Show less' : 'Show all ' + text.length + ' chars') + '</button>' : '');
  };
  var areasOf = function (r, name) {
    var out = [];
    Object.keys(r.board || {}).forEach(function (k) {
      if (k.indexOf('claim/') !== 0) return;
      var e = r.board[k]; var c = null; try { c = JSON.parse(e.text); } catch (x) {}
      var owner = c ? c.owner : e.by, team = c && c.team ? c.team : [];
      if (owner === name || team.indexOf(name) >= 0) out.push(k.slice(6));
    });
    return out;
  };
  var reviewingOf = function (r, name) {
    var out = [];
    Object.keys(r.board || {}).forEach(function (k) {
      if (k.indexOf('claim/') !== 0) return;
      if (r.board[k].reviewer === name) out.push(k.slice(6));
    });
    return out;
  };

  // ---------- rooms rail ----------
  function renderRooms() {
    var q = ($('#filter').value || '').toLowerCase();
    var live = rooms.filter(function (r) { return r.state === 'open' || r.state === 'stalled'; }).length;
    var shown = 0;
    var groups = {}, order = [];
    rooms.slice().sort(roomCmp).forEach(function (r) {
      if (stOff[stKey(r)]) return;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && (r.topic || '').toLowerCase().indexOf(q) < 0) return;
      shown++;
      var g = runOf(r.name) || 'other';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(r);
    });
    // a run with a live room floats up; within a run the main/leads room first
    order.sort(function (a, b) {
      var la = groups[a].some(function (r) { return r.state === 'open' || r.state === 'stalled'; }), lb = groups[b].some(function (r) { return r.state === 'open' || r.state === 'stalled'; });
      if (la !== lb) return la ? -1 : 1; return roomCmp(groups[a][0], groups[b][0]);
    });
    $('#sub').className = 'sub'; $('#sub').textContent = live + ' live · ' + shown + ' of ' + rooms.length + ' rooms' + (showArch ? ' incl. archived' : '');
    var html = order.map(function (g) {
      var rs = groups[g].slice().sort(function (a, b) {
        var ra = /-(room|leads)$/.test(a.name) ? 0 : 1, rb = /-(room|leads)$/.test(b.name) ? 0 : 1;
        return ra !== rb ? ra - rb : sortBy === 'newest' ? a.created_at.localeCompare(b.created_at) : roomCmp(a, b);
      });
      var liveN = rs.filter(function (r) { return r.state === 'open' || r.state === 'stalled'; }).length;
      var closed = openRuns[g] === false && !rs.some(function (r) { return r.name === sel; });
      var items = rs.map(function (r) {
        var unread = Math.max(0, (r.latest_seq || 0) - (lastSeen[r.name] || 0));
        var short = g === 'other' ? r.name : r.name.slice(g.length + 1);
        var meta = (r.state === 'open' || r.state === 'stalled') ? r.active_count + ' active · ' + r.message_count + ' msgs' : r.state + ' · ' + r.message_count + ' msgs';
        return '<button class="room' + (r.name === sel ? ' sel' : '') + '" data-r="' + esc(r.name) + '" title="' + esc(r.topic || r.name) + '">'
          + '<span class="dot ' + r.state + '"></span><span class="n">' + esc(short) + '</span>'
          + qBadge(r.name)
          + (unread && r.name !== sel ? '<span class="u' + (r.state === 'open' ? '' : ' q') + '">' + (unread > 99 ? '99+' : unread) + '</span>' : '')
          + '<span class="m">' + esc(meta) + '</span></button>';
      }).join('');
      var title = g === 'other' ? 'Other rooms' : g.replace(/^swarm-/, 'run ');
      return '<div class="run' + (closed ? ' closed' : '') + '" data-g="' + esc(g) + '"><div class="rh"><span class="car">▼</span><span class="n">' + esc(title) + '</span><span class="c">' + (liveN ? liveN + ' live' : rs.length) + '</span></div><div class="rl">' + items + '</div></div>';
    }).join('');
    $('#rooms').innerHTML = html || '<div class="empty">No rooms yet.</div>';
  }

  // ---------- header ----------
  function renderHead(r) {
    var open = openProposal(r);
    var chips = '<span class="chip ' + r.state + '">' + r.state + '</span>';
    if (open) chips += '<span class="chip prop">' + esc(open.id) + ' v' + open.version + ' · ' + open.tally.agree + '/' + voters(r) + ' agree' + (open.needs_challenge ? ' · needs challenge' : '') + '</span>';
    if (r.conclusion) chips += '<span class="chip ok">concluded ' + rel(r.conclusion.decidedAt) + '</span>';
    if (r.hold) chips += '<span class="chip bad">on hold by ' + esc(r.hold.by) + '</span>';
    if (r.unanswered_human) chips += '<span class="chip hum">waiting on a reply to ' + esc(r.unanswered_human.name) + '</span>';
    if (r.openings && r.openings !== 'revealed' && (r.state === 'open')) chips += '<span class="chip" title="openings: ' + esc(r.openings) + '">openings: ' + esc(r.openings.replace(/, waiting for nobody$/, '')) + '</span>';
    var act = '<a class="btn hidephone" href="/rooms/' + encodeURIComponent(r.name) + '/transcript" target="_blank" title="Plain-text transcript">Transcript</a>'
      + ((r.state === 'open' || r.state === 'stalled') ? '<button class="btn danger" id="closeroom" title="Close this room without a conclusion">Close room</button>' : '')
      + '<button class="btn" id="archroom" title="' + (r.archived ? 'Show this room in listings again' : 'Hide this room from listings; the transcript is kept') + '">' + (r.archived ? 'Unarchive' : 'Archive') + '</button>'
      + '<button class="btn icon" id="toginspect" title="Inspector">☰</button>';
    var topicOpen = !!expanded['topic'];
    $('#head').innerHTML = '<div class="t1"><h2>' + esc(r.name) + '</h2>' + chips + '</div><div class="acts">' + act + '</div>'
      + '<div class="topic' + (topicOpen ? ' open' : '') + '" id="topic" title="Click to expand">' + esc(r.topic || '(no topic)') + '</div><div id="pinstrip"></div>';
    renderPins();
    $('#topic').onclick = function () { expanded['topic'] = !expanded['topic']; renderHead(r); };
    var cb = $('#closeroom'); if (cb) cb.onclick = function () { closeRoom(r); };
    var ab = $('#archroom'); if (ab) ab.onclick = function () { archiveRoom(r); };
    var wf = $('#whof'), keep = wf.value;
    wf.innerHTML = '<option value="">everyone</option>' + r.participants.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) { return '<option value="' + esc(p.name) + '">' + esc(p.name) + (p.active ? '' : ' (left)') + '</option>'; }).join('');
    wf.value = keep; if (wf.value !== keep) { whoF = ''; }
    $('#toginspect').onclick = function () {
      if (innerWidth <= 720) { setView('inspect'); return; }
      if (innerWidth <= 1100) { document.body.classList.toggle('inspect-open'); return; }
      document.body.classList.toggle('noinspect'); store.set('noinspect', document.body.classList.contains('noinspect'));
    };
    $('#sendbtn').disabled = r.state === 'closed';
    $('#hint').className = 'hint' + (r.state === 'closed' ? ' bad' : '');
    $('#hint').textContent = r.state === 'closed' ? 'This room was closed; nobody is listening.' : r.state === 'concluded' ? 'The room has concluded; agents still present will answer a question.' : 'Humans bypass budgets and the stale-send guard; one agent answers unless you address @all.';
    var quick = r.participants.filter(function (p) { return p.active && p.agent !== 'human'; }).map(function (p) { return '<button type="button" data-at="' + esc(p.name) + '">@' + esc(p.name) + '</button>'; });
    $('#quick').innerHTML = quick.length ? '<button type="button" data-at="all">@all</button>' + quick.join('') : '';
  }

  // ---------- transcript ----------
  function seqLink(m) {
    if (!m.replyTo) return '';
    var t = null; for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].id === m.replyTo) { t = msgs[i]; break; }
    return t ? '<span class="re" data-seq="' + t.seq + '"><i>↩</i> #' + t.seq + ' ' + esc(t.from.name) + ': ' + esc(t.content.slice(0, 70)) + (t.content.length > 70 ? '…' : '') + '</span><br>' : '';
  }
  function quietBadge(m) {
    if (!m.audience) return '';
    // the audience is participant ids, which the summary does not expose; the @-names in the text say who it was for
    var n = m.audience.filter(function (id) { return id !== m.from.id; }).length;
    return '<span class="qb">' + (m.quiet ? 'quiet' : 'was quiet') + ' → ' + n + ' agent' + (n === 1 ? '' : 's') + '</span>';
  }
  function who(m, extra) {
    var p = pmap()[m.from.name] || {};
    return '<div class="who"><b>' + esc(m.from.name) + '</b>' + roleTag({ agent: m.from.agent, role: p.role }) + (m.from.agent && m.from.agent !== 'human' ? '<span class="agent">' + esc(m.from.agent) + '</span>' : '') + (extra || '') + quietBadge(m) + pinBtn(m) + '<span class="seq">#' + m.seq + '</span><span class="t" title="' + esc(m.ts) + '">' + fmtTs(m.ts) + '</span></div>';
  }
  function renderMsg(m) {
    if (!visible(m)) return;
    var log = $('#log');
    var d = document.createElement('div');
    d.dataset.seq = m.seq;
    if (m.kind === 'system') {
      var routine = /joined the room|left the room\\.$|rejoined|passes\\.$/.test(m.content); // a leave with a reason is never routine
      if (routine && !showNotices) return;
      lastSender = null;
      var concl = /^CONSENSUS REACHED/.test(m.content);
      d.className = 'sys' + (concl ? ' concl' : (/min of silence|deadline|cannot pass|clamped|Cap hit|was marked as left|went quiet/.test(m.content) ? ' notice' : ''));
      d.innerHTML = '<span title="' + fmtTs(m.ts) + '">' + esc(m.content) + '</span>';
      log.appendChild(d); return;
    }
    var human = m.from.agent === 'human';
    var cont = lastSender === m.from.id && m.kind === 'chat' && !m.replyTo;
    lastSender = (m.kind === 'chat') ? m.from.id : null;
    var key = 'm' + m.seq;
    var inner;
    if (m.kind === 'chat') {
      inner = seqLink(m) + clampable(key, m.content, 900, 'body' + (human ? ' human' : '') + (m.tag === 'opening' ? ' opening' : ''));
      d.className = 'msg' + (cont ? ' cont' : '');
      d.innerHTML = '<div>' + (cont ? '' : av(m.from.name, m.from.agent)) + '</div><div>' + (cont ? '' : who(m, m.tag === 'opening' ? '<span class="chip">opening</span>' : '')) + inner + '</div>';
    } else if (m.kind === 'proposal' || m.kind === 'amend' || m.kind === 'challenge' || m.kind === 'conclusion') {
      var label = m.kind === 'proposal' ? 'Proposal' : m.kind === 'amend' ? 'Amendment' : m.kind === 'challenge' ? 'Challenge' : 'Conclusion';
      var head = '<div class="ch"><span>' + label + '</span>' + (m.proposalId ? '<span class="mono">' + esc(m.proposalId) + '</span>' : '') + '<span class="sp"></span><span class="mono">#' + m.seq + ' · ' + fmtTs(m.ts) + '</span></div>';
      var text = m.content.replace(/^(PROPOSAL|AMENDED|CHALLENGE)\\s+\\S+:?\\s*/, '');
      d.className = 'msg';
      d.innerHTML = '<div>' + av(m.from.name, m.from.agent) + '</div><div>' + who(m) + '<div class="card ' + m.kind + '">' + head + '<div class="cb">' + clampable(key, text, m.kind === 'conclusion' ? 1200 : 700, '') + '</div></div></div>';
    } else if (m.kind === 'vote') {
      var mv = /votes (AGREE|DISAGREE|ABSTAIN) on (\\S+?)(?::\\s*(.*))?$/s.exec(m.content) || [];
      var v = (mv[1] || '').toLowerCase();
      d.className = 'msg'; lastSender = null;
      d.innerHTML = '<div></div><div class="row"><span class="v ' + v + '">' + (v === 'agree' ? '✓' : v === 'disagree' ? '✗' : '○') + '</span><b>' + esc(m.from.name) + '</b><span>' + (v || 'voted') + (mv[2] ? ' on <span class="k">' + esc(mv[2]) + '</span>' : '') + '</span><span class="t" style="color:var(--dim2);font-size:11px">#' + m.seq + ' ' + fmtTs(m.ts) + '</span>' + (mv[3] ? '<span class="why">' + withMentions(esc(mv[3])) + '</span>' : (!mv[1] ? '<span class="why">' + esc(m.content) + '</span>' : '')) + '</div>';
    } else if (m.kind === 'board') {
      d.className = 'msg'; lastSender = null;
      d.innerHTML = '<div></div><div class="row"><span class="chip">board</span><b>' + esc(m.from.name) + '</b><span>' + esc(m.content.replace(/\\s*\\(\\d+ chars; read it with board_get\\)/, '')) + '</span><span style="color:var(--dim2);font-size:11px">#' + m.seq + ' ' + fmtTs(m.ts) + '</span></div>';
    } else {
      d.className = 'msg'; lastSender = null;
      d.innerHTML = '<div></div><div class="row"><span class="chip">' + esc(m.kind) + '</span><b>' + esc(m.from.name) + '</b><span>' + esc(m.content.slice(0, 400)) + '</span></div>';
    }
    log.appendChild(d);
  }
  function rerender() {
    var log = $('#log'); log.innerHTML = ''; lastSender = null;
    if (!msgs.length) { log.innerHTML = '<div class="empty">Nothing said yet.</div>'; return; }
    var lastDay = '';
    msgs.forEach(function (m) {
      var day = new Date(m.ts).toDateString();
      if (day !== lastDay) { lastDay = day; lastSender = null; var dd = document.createElement('div'); dd.className = 'day'; dd.textContent = new Date(m.ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); log.appendChild(dd); }
      renderMsg(m);
    });
    catchupAfter();
  }
  var atBottom = function () { var l = $('#log'); return l.scrollHeight - l.scrollTop - l.clientHeight < 60; };
  var toBottom = function () { var l = $('#log'); l.scrollTop = l.scrollHeight; unreadPill = 0; $('#newpill').style.display = 'none'; $('#n-unread').style.display = 'none'; if (sel) { lastSeen[sel] = seen; store.set('lastSeen', lastSeen); } };
  $('#newpill').onclick = toBottom;
  $('#log').addEventListener('scroll', function () { if (atBottom() && unreadPill) toBottom(); });

  async function poll() {
    if (!sel) return;
    var room = sel;
    try {
      var res = await fetch('/rooms/' + encodeURIComponent(room) + '/messages?since=' + seen);
      if (!res.ok || room !== sel) return;
      var fresh = await res.json();
      if (!Array.isArray(fresh) || !fresh.length) return;
      var stick = atBottom() || !msgs.length;
      var first = !msgs.length;
      if (first) $('#log').innerHTML = '';
      fresh.forEach(function (m) {
        var day = new Date(m.ts).toDateString(), prev = msgs.length ? new Date(msgs[msgs.length - 1].ts).toDateString() : '';
        if (day !== prev) { lastSender = null; var dd = document.createElement('div'); dd.className = 'day'; dd.textContent = new Date(m.ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); $('#log').appendChild(dd); }
        seen = m.seq; msgs.push(m); renderMsg(m);
      });
      if (first) renderPins();
      catchupAfter();
      if (stick) { toBottom(); }
      else { unreadPill += fresh.length; $('#newpill').textContent = '↓ ' + unreadPill + ' new'; $('#newpill').style.display = 'block'; if (document.body.dataset.view !== 'chat') { $('#n-unread').textContent = unreadPill; $('#n-unread').style.display = ''; } }
      if (cur && tab === 'people') renderPane(); // last-active columns
    } catch (e) {}
  }

  // ---------- inspector ----------
  function renderPane() {
    var r = cur; if (!r) { $('#pane').innerHTML = '<div class="empty">Nothing selected.</div>'; return; }
    $$('#tabs button[data-tab]').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    $('#n-people').textContent = r.participants.filter(function (p) { return p.active; }).length;
    $('#n-board').textContent = Object.keys(r.board || {}).length || '';
    var h = '';
    if (tab === 'decision') h = paneDecision(r);
    else if (tab === 'people') h = panePeople(r);
    else if (tab === 'board') h = paneBoard(r);
    else h = paneStats(r);
    var pane = $('#pane'), paneTop = pane.scrollTop, oldAct = $('#act'), anchor = oldAct && actFor === personOpen ? actAnchor(oldAct.scrollTop, actRows(oldAct)) : null;
    pane.innerHTML = h;
    pane.scrollTop = paneTop;
    var newAct = $('#act'); if (newAct && anchor) newAct.scrollTop = actRestore(anchor, actRows(newAct));
    actFor = newAct ? personOpen : null;
    var bs = $('#bsearch'); if (bs) { bs.value = boardQuery; bs.oninput = function () { boardQuery = bs.value; renderPane(); var e = $('#bsearch'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); }; }
    var sn = $('#shownotices'); if (sn) sn.onchange = function () { showNotices = sn.checked; store.set('notices', showNotices); rerender(); toBottom(); };
  }
  function paneDecision(r) {
    var h = '';
    var open = openProposal(r), n = voters(r);
    if (r.conclusion) {
      var c = r.conclusion;
      h += '<div class="sec"><h3>Conclusion <span class="sp"></span><span class="c">' + esc(c.proposalId) + (c.version ? ' v' + c.version : '') + ' · ' + rel(c.decidedAt) + '</span></h3><div class="pcard concl">'
        + (c.tally ? '<div class="meta"><span class="chip ok">' + c.tally.agree + ' agree</span>' + (c.tally.disagree ? '<span class="chip bad">' + c.tally.disagree + ' disagree</span>' : '') + (c.tally.abstain ? '<span class="chip">' + c.tally.abstain + ' abstain</span>' : '') + '</div>' : '')
        + clampable('concl', c.text, 1200, 'txt')
        + (c.unresolved_objections && c.unresolved_objections.length ? '<div class="blk"><b>Overruled objections</b>' + c.unresolved_objections.map(function (o) { return '<div><span class="chip chal">' + esc(o.by) + '</span><span>' + esc(o.objection.slice(0, 240)) + '</span></div>'; }).join('') + '</div>' : '')
        + '</div></div>';
    }
    if (open) {
      var t = open.tally, a = t.agree, dd = t.disagree, ab = t.abstain, w = Math.max(0, n - a - dd - ab);
      var pct = function (x) { return n ? (100 * x / n) + '%' : '0%'; };
      h += '<div class="sec"><h3>Open proposal <span class="sp"></span><span class="c">v' + open.version + ' · ' + open.chars + ' chars · ' + rel(open.created_at) + '</span></h3><div class="pcard">'
        + '<div class="meta"><span class="mono">' + esc(open.id) + '</span><span>by <b>' + esc(open.by) + '</b></span>' + (open.needs_challenge ? '<span class="chip chal">needs a challenge</span>' : '') + '</div>'
        + (open.text ? clampable('prop', open.text, 600, 'txt') : '<div class="txt" style="color:var(--dim)">(text not sent)</div>')
        + '<div class="tally"><div class="bar"><i class="a" style="width:' + pct(a) + '"></i><i class="d" style="width:' + pct(dd) + '"></i><i class="ab" style="width:' + pct(ab) + '"></i></div>'
        + '<div class="leg"><span><b>' + a + '</b> agree</span><span><b>' + dd + '</b> disagree</span><span><b>' + ab + '</b> abstain</span><span><b>' + w + '</b> waiting</span><span style="margin-left:auto">' + n + ' voters · ' + esc(r.quorum) + '</span></div></div>'
        + (open.waiting_on && open.waiting_on.length ? '<div class="blk"><div><span class="chip">waiting on</span><span>' + esc(open.waiting_on.join(', ')) + '</span></div></div>' : '')
        + (open.blocked_by && open.blocked_by.length ? '<div class="blk">' + open.blocked_by.map(function (b) { return '<div><span class="chip bad">blocked</span><span>' + esc(b) + '</span></div>'; }).join('') + '</div>' : '')
        + (open.challenges && open.challenges.length ? '<div class="blk"><b>Challenges</b>' + open.challenges.map(function (c) { return '<div class="cl"><div class="h">' + esc(c.by) + '<span class="chip ' + (c.status === 'open' ? 'chal' : c.status === 'conceded' || c.status === 'answered' ? 'ok' : '') + '">' + esc(c.status) + (c.blocking === false ? ' · non-blocking' : '') + '</span>' + (c.version ? '<span class="chip">v' + c.version + '</span>' : '') + '</div><div class="o">' + esc(c.objection) + '</div></div>'; }).join('') + '</div>' : '')
        + (open.votes && open.votes.length ? '<div class="vl"><b>Votes</b>' + open.votes.map(function (v) { return '<div><span class="who">' + esc(v.name) + '</span><span class="chip ' + (v.vote === 'agree' ? 'ok' : v.vote === 'disagree' ? 'bad' : '') + '">' + v.vote + (v.version ? ' · v' + v.version : '') + (v.confidence != null ? ' · ' + Math.round(v.confidence * 100) + '%' : '') + '</span>' + (v.quote ? '<span class="r">“' + esc(v.quote) + '”</span>' : '') + (v.reason ? '<span class="r">' + esc(v.reason) + '</span>' : '') + '</div>'; }).join('') + '</div>' : '')
        + '<div class="vote-row"><button class="btn" data-p="' + esc(open.id) + '" data-v="agree">Agree (advisory)</button><button class="btn danger" data-p="' + esc(open.id) + '" data-v="disagree">Veto</button></div>'
        + '</div></div>';
    } else if (!r.conclusion) {
      h += '<div class="sec"><h3>Decision</h3><div class="empty" style="padding:24px 8px">No proposal yet.' + (r.state === 'open' ? ' The room is still discussing.' : '') + '</div></div>';
    }
    var past = (r.proposals || []).filter(function (p) { return p.status !== 'open' && p.status !== 'accepted'; });
    if (past.length) h += '<div class="sec"><h3>Earlier proposals</h3>' + past.map(function (p) { return '<div class="blk"><div><span class="chip">' + esc(p.status) + '</span><span class="mono">' + esc(p.id) + '</span><span style="color:var(--dim)">v' + p.version + ' by ' + esc(p.by) + '</span></div></div>'; }).join('') + '</div>';
    h += '<div class="sec"><h3>Room</h3><div class="kv">'
      + '<b>Mode</b><span>' + esc(r.mode.replace('_', ' ')) + ' · ' + esc(r.quorum) + (r.anonymous ? ' · anonymous to agents' : '') + '</span>'
      + '<b>Expected</b><span>' + (r.expected_participants || '—') + ' · cap ' + r.max_live_agents + '</span>'
      + '<b>Openings</b><span>' + esc(r.openings) + '</span>'
      + '<b>Challenge</b><span>' + (r.require_challenge ? 'required before passing' : 'not required') + (r.require_verification ? ' · verification required' : '') + '</span>'
      + (r.chair ? '<b>Chair</b><span>' + esc(r.chair) + '</span>' : '')
      + (r.code_state ? '<b>Code</b><span class="mono">' + esc(r.code_state.head) + (r.code_state.dirty ? ' (dirty)' : '') + '</span>' : '')
      + '<b>Created</b><span>' + rel(r.created_at) + '</span></div>'
      + '<div class="toolbar"><label><input type="checkbox" id="shownotices"' + (showNotices ? ' checked' : '') + '> show join/leave notices</label></div></div>';
    return h;
  }
  function panePeople(r) {
    var kv = (r.kick_votes || []), openKv = {};
    kv.forEach(function (v) { if (v.status === 'open') openKv[v.target] = v; });
    var canAct = function (p) { return p.active && p.agent !== 'human' && p.role !== 'chair' && !openKv[p.name]; };
    var rows = function (list) { return list.map(function (p) {
      var areas = areasOf(r, p.name), reviewing = reviewingOf(r, p.name);
      var aline = esc(areas.join(', ')) + (reviewing.length ? (areas.length ? ' · ' : '') + 'reviewing: ' + esc(reviewing.join(', ')) : '') + (p.left_reason ? (areas.length || reviewing.length ? ' · ' : '') + 'left: ' + esc(p.left_reason) : '');
      return '<div class="person' + (p.active ? '' : ' off') + (canAct(p) ? ' hasacts' : '') + (personOpen === p.name ? ' sel' : '') + '" data-person="' + esc(p.name) + '">' + av(p.name, p.agent) + '<div><div class="n">' + esc(p.name) + roleTag(p) + '<span class="agent">' + esc(p.agent) + '</span></div><div class="a">' + aline + '</div></div><div class="s">' + p.messages + ' msg' + (p.messages === 1 ? '' : 's') + '<br>' + (p.active ? (p.working && p.working.at > (p.last_active_at || '') ? 'working: ' + esc(p.working.tool) + ' · ' + rel(p.working.at) : rel(p.last_seen_at || p.last_active_at)) : 'left') + '</div>' + (canAct(p) ? '<div class="pacts"><button class="mini warn" data-kick="' + esc(p.name) + '" data-kv="start" title="Start a vote to remove ' + esc(p.name) + '">Kick</button><button class="mini" data-replace="' + esc(p.name) + '" title="Remove ' + esc(p.name) + ' now and recruit a successor">Replace</button></div>' : '') + (personOpen === p.name ? '<div class="act" id="act">' + actPanel(p, activity[p.name], esc, rel) + '</div>' : '') + '</div>';
    }).join(''); };
    var active = r.participants.filter(function (p) { return p.active; }), gone = r.participants.filter(function (p) { return !p.active; });
    // kick votes: open ones with a kick/keep button pair, settled ones as one line; a kick button per active agent starts one
    var kickSec = '';
    if (kv.length) kickSec = '<div class="sec"><h3>Kick votes <span class="sp"></span><span class="c">' + kv.length + '</span></h3>' + kv.slice().reverse().map(function (v) {
      var line = '<b>' + esc(v.target) + '</b> · by ' + esc(v.by) + ' · ' + rel(v.started_at) + ' · ' + esc(v.reason);
      if (v.status === 'open') line += '<br><span class="mono">' + v.kick + '/' + v.needed + ' kick, ' + v.keep + ' keep</span> ' + (v.ballots || []).map(function (b) { return esc(b.name) + ':' + b.vote; }).join(' ') + ' <button class="mini" data-kick="' + esc(v.target) + '" data-kv="kick">kick</button> <button class="mini" data-kick="' + esc(v.target) + '" data-kv="keep">keep</button>';
      else line += '<br><span style="color:var(--dim)">' + esc(v.status) + (v.outcome ? ': ' + esc(v.outcome) : '') + '</span>';
      return '<div style="padding:6px 0;border-bottom:1px solid var(--line)">' + line + '</div>';
    }).join('') + '</div>';
    var anyActs = active.some(canAct);
    return '<div class="sec"><h3>In the room <span class="sp"></span><span class="c">' + active.length + '</span></h3>' + (rows(active) || '<div class="empty" style="padding:16px">Nobody here.</div>') + '</div>'
      + (anyActs ? '<div class="sec" style="font-size:11.5px;color:var(--dim2);padding-top:0">Kick starts a vote to remove a seat. Replace removes it at once and recruits a successor, for a dead seat.</div>' : '') + kickSec
      + (gone.length ? '<div class="sec"><h3>Left <span class="sp"></span><span class="c">' + gone.length + '</span></h3>' + rows(gone) + '</div>' : '')
      + '<div class="sec" style="font-size:12px;color:var(--dim2)">Areas come from claim/* board entries; reviewing is the hub-assigned reviewer for that claim; the role tag is what the agent joined with.</div>';
  }
  function paneBoard(r) {
    var keys = Object.keys(r.board || {}).filter(function (k) { return !boardQuery || k.toLowerCase().indexOf(boardQuery.toLowerCase()) >= 0 || (r.board[k].text || '').toLowerCase().indexOf(boardQuery.toLowerCase()) >= 0; });
    var pre = function (k) { var m = /^(claim|verify|hold|inbox)\\//.exec(k); return m ? m[1] : 'note'; };
    var groups = {}; keys.forEach(function (k) { var g = pre(k); (groups[g] = groups[g] || []).push(k); });
    var order = ['hold', 'inbox', 'claim', 'verify', 'note'].filter(function (g) { return groups[g]; });
    var h = '<input id="bsearch" class="bsearch" placeholder="Search the board" />';
    if (!keys.length) h += '<div class="empty" style="padding:24px 8px">' + (boardQuery ? 'No entry matches.' : 'The board is empty.') + '</div>';
    order.forEach(function (g) {
      h += '<div class="bgroup">' + groups[g].sort(function (a, b) { return (r.board[b].updated_at || '').localeCompare(r.board[a].updated_at || ''); }).map(function (k) {
        var e = r.board[k], open = !!expanded['b:' + k];
        var summary = '';
        if (g === 'claim') { try { var c = JSON.parse(e.text); summary = (c.owner ? 'owner ' + c.owner : '') + (c.status ? ' · ' + c.status : '') + (c.team && c.team.length ? ' · team ' + c.team.join(', ') : ''); } catch (x) {} summary += e.reviewer ? ' · reviewer ' + e.reviewer : ''; }
        if (g === 'verify') {
          try {
            var head = JSON.parse((e.text || '').split('\\n')[0]);
            summary = (head && typeof head.exit_code === 'number' && head.proposal)
              ? (head.exit_code === 0 ? 'exit 0 (pass)' : 'exit ' + head.exit_code + ' (does not satisfy the gate)') + ' · verifies ' + head.proposal + (head.command ? ' · ' + head.command : '')
              : 'no parseable JSON head — does not satisfy require_verification';
          } catch (x) { summary = 'no parseable JSON head — does not satisfy require_verification'; }
        }
        return '<div class="bentry ' + g + (open ? ' open' : '') + '"><div class="bh" data-b="' + esc(k) + '"><span class="pre">' + g + '</span><span class="k" title="' + esc(k) + '">' + esc(k.replace(/^(claim|verify|hold|inbox)\\//, '')) + '</span><span class="m">' + esc(e.by) + ' · ' + rel(e.updated_at) + ' · ' + e.chars + 'c</span></div>'
          + '<div class="bb">' + (summary ? '<div style="color:var(--dim);margin-bottom:6px">' + esc(summary) + '</div>' : '') + withMentions(esc(e.text || '')) + '</div></div>';
      }).join('') + '</div>';
    });
    return h;
  }
  function paneStats(r) {
    var s = stats;
    if (!s || s.room !== r.name) { fetchStats(true); return '<div class="empty">Loading…</div>'; }
    var kinds = Object.keys(s.messages_by_kind || {}).sort(function (a, b) { return s.messages_by_kind[b] - s.messages_by_kind[a]; });
    var maxK = Math.max.apply(null, kinds.map(function (k) { return s.messages_by_kind[k]; }).concat([1]));
    var refusals = Object.keys(s.refusals || {}).map(function (k) { return { k: k, n: s.refusals[k] }; }).sort(function (a, b) { return b.n - a.n; });
    var totalRef = refusals.reduce(function (x, y) { return x + y.n; }, 0);
    var h = '<div class="stat"><div><b>' + dur(s.duration_ms) + '</b><span>elapsed</span></div><div><b>' + (s.time_to_conclusion_ms != null ? dur(s.time_to_conclusion_ms) : '—') + '</b><span>to conclusion</span></div>'
      + '<div><b>' + (s.proposals || 0) + ' / ' + (s.amendments || 0) + '</b><span>proposals / amendments</span></div><div><b>' + (s.challenges || 0) + '</b><span>challenges</span></div>'
      + '<div><b>' + totalRef + '</b><span>refused calls</span></div><div><b>' + (s.near_simultaneous_replies || 0) + '</b><span>near-simultaneous replies</span></div></div>';
    h += '<div class="sec"><h3>Messages by kind</h3>' + kinds.map(function (k) { return '<div class="hbar"><span class="l">' + esc(k) + '</span><i style="width:' + (100 * s.messages_by_kind[k] / maxK) + '%"></i><span class="v">' + s.messages_by_kind[k] + '</span></div>'; }).join('') + '</div>';
    var pp = (s.per_participant || []).slice().sort(function (a, b) { return b.chat_messages - a.chat_messages; });
    h += '<div class="sec"><h3>Who talked</h3><table class="t">' + pp.map(function (p) { return '<tr><td><b>' + esc(p.name) + '</b> <span style="color:var(--dim2);font-size:11px">' + esc(p.agent) + '</span></td><td>' + p.chat_messages + ' msgs · ' + Math.round(p.chars / 100) / 10 + 'k chars' + (p.passes ? ' · ' + p.passes + ' pass' : '') + '</td></tr>'; }).join('') + '</table></div>';
    if (refusals.length) h += '<div class="sec"><h3>Refusals <span class="sp"></span><span class="c">the hub said no, and why</span></h3><table class="t">' + refusals.slice(0, 12).map(function (x) { var i = x.k.indexOf(': '); return '<tr><td><b>' + esc(x.k.slice(0, i)) + '</b><br><span class="r">' + esc(x.k.slice(i + 2)) + '</span></td><td>' + x.n + '</td></tr>'; }).join('') + '</table></div>';
    if (s.unanswered_human_messages) h += '<div class="sec"><span class="chip hum">' + s.unanswered_human_messages + ' human message(s) unanswered</span></div>';
    return h;
  }
  async function fetchStats(force) {
    if (!sel) return;
    if (!force && Date.now() - statsAt < 5000) return;
    statsAt = Date.now();
    try { var s = await (await fetch('/rooms/' + encodeURIComponent(sel) + '/stats')).json(); if (s.room === sel) { stats = s; if (tab === 'stats') renderPane(); } } catch (e) {}
  }

  // ---------- actions ----------
  async function closeRoom(r) {
    if (!window.confirm('Close ' + r.name + '? No conclusion will be recorded and agents still in it will be told to leave.')) return;
    await fetch('/rooms/' + encodeURIComponent(r.name) + '/close', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: myName(), reason: 'closed from dashboard' }) });
    refreshRooms();
  }
  async function archiveRoom(r) {
    var res = await fetch('/rooms/' + encodeURIComponent(r.name) + '/archive', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: myName(), archived: !r.archived }) });
    if (!res.ok) { $('#sub').className = 'sub bad'; $('#sub').textContent = await res.text(); return; }
    refreshRooms();
  }
  function select(name) {
    if (sel && seen) { lastSeen[sel] = seen; store.set('lastSeen', lastSeen); }
    sel = name; seen = 0; msgs = []; lastSender = null; unreadPill = 0; stats = null; expanded = {};
    catchupSelect(name);
    $('#log').innerHTML = '<div class="empty">Loading…</div>'; $('#newpill').style.display = 'none';
    history.replaceState(null, '', '?room=' + encodeURIComponent(name));
    cur = rooms.filter(function (r) { return r.name === name; })[0] || null;
    if (cur) { renderHead(cur); renderPane(); }
    renderRooms(); poll();
    if (innerWidth <= 720) setView('chat');
  }
  function setView(v) { document.body.dataset.view = v; $$('#tabbar button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); }); if (v === 'chat') toBottom(); }
  $$('#tabbar button').forEach(function (b) { b.onclick = function () { setView(b.dataset.view); }; });
  $$('#tabs button[data-tab]').forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; store.set('tab', tab); renderPane(); if (tab === 'stats') fetchStats(true); }; });
  $('#filter').oninput = renderRooms;
  // recruit policy: pinned provider/model for every request_agent, live on the hub
  async function loadPolicy() {
    try { var p = (await (await fetch('/policy')).json()).recruits || {}; $('#policy').innerHTML = 'recruits: <b>' + esc(p.agent ? p.agent + (p.model ? ' · ' + p.model : '') : 'as requested') + '</b>'; } catch (e) {}
  }
  $('#policy').onclick = async function () {
    var v = window.prompt('Pin every recruit to a provider and model (e.g. "openrouter deepseek/deepseek-v4-flash-0731"), or "any" to let agents choose:', 'openrouter deepseek/deepseek-v4-flash-0731');
    if (v === null) return;
    var parts = v.trim().split(/\\s+/);
    var body = parts[0] === 'any' ? { agent: 'any', model: 'any' } : { agent: parts[0], model: parts[1] || 'any' };
    var send = function () { return fetch('/policy', { method: 'POST', headers: hdrs(), body: JSON.stringify(body) }); };
    var res = await send();
    // agent controls need the human token even on loopback (hub requireAgentControl); ask once on 401 and retry
    if (res.status === 401) {
      var t = window.prompt('Changing the recruit policy needs the human token set on this hub (CHATROOM_HUMAN_TOKEN):');
      if (t) { TOKEN = t; store.set('token', t); res = await send(); }
    }
    if (!res.ok) window.alert(await res.text());
    loadPolicy();
  };
  loadPolicy(); setInterval(loadPolicy, 15000);

  document.addEventListener('click', async function (e) {
    var rb = e.target.closest('.room'); if (rb) return select(rb.dataset.r);
    var rh = e.target.closest('.run > .rh'); if (rh) { var g = rh.parentElement.dataset.g; openRuns[g] = rh.parentElement.classList.contains('closed'); store.set('openRuns', openRuns); renderRooms(); return; }
    var more = e.target.closest('.more'); if (more) { var k = more.dataset.x; expanded[k] = !expanded[k]; if (/^m\\d+$/.test(k)) { var l = $('#log'), keep = l.scrollTop; rerender(); l.scrollTop = keep; } else if (k === 'topic') renderHead(cur); else renderPane(); return; }
    var re = e.target.closest('.re'); if (re) { var t = $('#log [data-seq="' + re.dataset.seq + '"]'); if (t) { t.scrollIntoView({ block: 'center' }); t.classList.remove('hl'); void t.offsetWidth; t.classList.add('hl'); } return; }
    var bh = e.target.closest('.bh'); if (bh) { expanded['b:' + bh.dataset.b] = !expanded['b:' + bh.dataset.b]; renderPane(); return; }
    var kb = e.target.closest('[data-kick]'); if (kb && sel) {
      var kreason = '';
      if (kb.dataset.kv === 'start') { kreason = window.prompt('Why remove ' + kb.dataset.kick + '? (blocking progress, or dead: cite last seen)') || ''; if (!kreason) return; }
      var kres = await fetch('/rooms/' + encodeURIComponent(sel) + '/kick', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: myName(), target: kb.dataset.kick, vote: kb.dataset.kv === 'keep' ? 'keep' : 'kick', reason: kreason }) });
      if (!kres.ok) window.alert(await kres.text());
      refreshRooms(); poll(); return;
    }
    var rp = e.target.closest('[data-replace]'); if (rp && sel) {
      var rreason = window.prompt('Why replace ' + rp.dataset.replace + '? This removes them immediately (no vote) and recruits a successor.') || '';
      if (!rreason) return;
      var rres = await fetch('/rooms/' + encodeURIComponent(sel) + '/replace', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: myName(), target: rp.dataset.replace, reason: rreason }) });
      if (!rres.ok) window.alert(await rres.text());
      refreshRooms(); poll(); return;
    }
    var at = e.target.closest('#quick button'); if (at) { var ta = $('#text'); ta.value = '@' + at.dataset.at + ' ' + ta.value.replace(/^@[\\w-]+\\s*/, ''); ta.focus(); return; }
    var v = e.target.closest('[data-v]'); if (v && sel) {
      var reason = v.dataset.v === 'disagree' ? (window.prompt('Why? A veto keeps the proposal open for amendment; say what must change.') || '') : '';
      if (v.dataset.v === 'disagree' && !reason) return;
      var res = await fetch('/rooms/' + encodeURIComponent(sel) + '/vote', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: myName(), proposal_id: v.dataset.p, vote: v.dataset.v, reason: reason }) });
      if (!res.ok) window.alert(await res.text());
      refreshRooms(); poll(); return;
    }
  });
  $('#compose').addEventListener('submit', async function (e) {
    e.preventDefault(); if (!sel) return;
    var content = $('#text').value.trim(); if (!content) return;
    $('#sendbtn').disabled = true;
    try {
      var res = await fetch('/rooms/' + encodeURIComponent(sel) + '/messages', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: myName(), content: content }) });
      if (!res.ok) { $('#hint').className = 'hint bad'; $('#hint').textContent = await res.text(); }
      else { $('#text').value = ''; $('#text').style.height = ''; }
    } finally { $('#sendbtn').disabled = false; }
    poll();
  });
  $('#text').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#compose').requestSubmit(); } });
  $('#text').addEventListener('input', function (e) { e.target.style.height = ''; e.target.style.height = Math.min(180, e.target.scrollHeight) + 'px'; });
  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input,textarea')) return;
    if (e.key === '/') { e.preventDefault(); $('#filter').focus(); }
    if (e.key === 'Escape') { document.body.classList.remove('inspect-open'); }
  });

${PALETTE_JS}
${INBOX_JS}
${CATCHUP_JS}

  // ---------- polling ----------
  async function refreshRooms() {
    try {
      var res = await fetch('/rooms' + (showArch ? '?archived=1' : '')); if (!res.ok) throw new Error();
      rooms = await res.json();
      if (!sel && rooms.length) {
        var live = rooms.filter(function (r) { return r.state === 'open'; }).sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });
        var pick = live[0] || rooms.slice().sort(function (a, b) { return b.created_at.localeCompare(a.created_at); })[0];
        return select(pick.name);
      }
      renderRooms();
      if (sel) {
        var next = rooms.filter(function (r) { return r.name === sel; })[0] || null;
        var changed = !cur || JSON.stringify(next) !== JSON.stringify(cur);
        cur = next;
        if (cur && changed) { renderHead(cur); if (tab !== 'stats') renderPane(); }
        if (cur && tab === 'stats') fetchStats(false);
      }
    } catch (e) { $('#sub').className = 'sub bad'; $('#sub').textContent = 'hub unreachable'; }
  }
  refreshRooms(); setInterval(refreshRooms, 3000); setInterval(poll, 1500);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshRooms(); poll(); } });
})();
</script>
</body>
</html>`;
