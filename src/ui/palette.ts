/**
 * Dashboard command palette (Cmd/Ctrl-K) and per-room pinned messages, spliced into UI_HTML by src/ui.ts.
 * The JS runs inside the dashboard's IIFE, so it uses that scope's helpers and state ($, esc, store, rooms, sel,
 * msgs, kindOff, select, rerender, ...). The strings are template literals like UI_HTML: regex backslashes are doubled.
 * Other sections add commands with window.crPalette.add({ group, label, hint, run }).
 */
export const PALETTE_CSS = `
  /* ---------- palette + pins (claim/palette-filter) ---------- */
  #pal { position:fixed; inset:0; z-index:60; display:none; align-items:flex-start; justify-content:center; padding:12vh 16px 16px; background:color-mix(in srgb, var(--bg) 45%, transparent); -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px) }
  #pal.on { display:flex }
  #pal .box { width:min(620px, 100%); max-height:70vh; display:flex; flex-direction:column; background:color-mix(in srgb, var(--panel) 82%, transparent); -webkit-backdrop-filter:blur(24px) saturate(1.4); backdrop-filter:blur(24px) saturate(1.4); border:1px solid color-mix(in srgb, var(--line) 80%, transparent); border-radius:16px; box-shadow:0 24px 60px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.12); overflow:hidden }
  #pal input { border:0; border-bottom:1px solid var(--line); border-radius:0; background:transparent; font-size:15px; padding:14px 16px; outline:none }
  #pal input:focus { outline:none; border-color:var(--line) }
  #pal ul { list-style:none; margin:0; padding:6px; overflow:auto }
  #pal li { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:10px; cursor:pointer; font-size:13.5px }
  #pal li .g { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--dim); min-width:58px }
  #pal li .l { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  #pal li .h { color:var(--dim); font-size:11.5px; white-space:nowrap }
  #pal li.on { background:var(--acc-bg); color:var(--acc-fg) } #pal li.on .g, #pal li.on .h { color:var(--acc-fg) }
  #pal li b { color:var(--acc-fg) }
  #pal .foot { border-top:1px solid var(--line); padding:7px 14px; font-size:11.5px; color:var(--dim); display:flex; gap:14px; flex-wrap:wrap }
  #pal kbd, .kbd { font-family:"JetBrains Mono",monospace; font-size:10.5px; border:1px solid var(--line); border-bottom-width:2px; border-radius:5px; padding:0 5px; background:var(--panel2); color:var(--fg) }
  #palbtn { font-size:11.5px; color:var(--dim) }
  .pinb { border:0; background:transparent; color:var(--dim); font-size:11px; padding:0 4px; border-radius:5px; opacity:0; transition:opacity .12s }
  .msg:hover .pinb, .msg:focus-within .pinb, .pinb.on { opacity:1 } .pinb.on { color:var(--warn) } .pinb:hover { color:var(--fg); background:var(--panel2) }
  #pinstrip { grid-column:1 / -1; display:flex; gap:6px; flex-wrap:wrap; align-items:center } #pinstrip:empty { display:none }
  #pinstrip .pin { border:1px solid color-mix(in srgb, var(--warn) 35%, transparent); background:var(--warn-bg); color:var(--fg); border-radius:999px; padding:1px 4px 1px 9px; font-size:11.5px; max-width:280px; display:inline-flex; align-items:center; gap:4px; cursor:pointer }
  #pinstrip .pin span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap } #pinstrip .pin i { font-style:normal; color:var(--dim); padding:0 4px; border-radius:999px } #pinstrip .pin i:hover { color:var(--bad) }
  @media (prefers-reduced-transparency: reduce) { #pal, #pal .box { -webkit-backdrop-filter:none; backdrop-filter:none } #pal { background:rgba(0,0,0,.35) } #pal .box { background:var(--panel) } }
  @media (prefers-reduced-motion: reduce) { .pinb { transition:none } }
  @media (hover: none) { .pinb { opacity:.6 } }
`;

export const PALETTE_HTML = `<div id="pal" role="dialog" aria-modal="true" aria-label="Command palette"><div class="box"><input id="palq" placeholder="Jump to a room, tab, pinned message, #seq or command…" autocomplete="off" spellcheck="false" aria-controls="pall" /><ul id="pall" role="listbox"></ul><div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>↵</kbd> run</span><span><kbd>esc</kbd> close</span><span><kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> open</span></div></div></div>`;

export const PALETTE_JS = `
  /*palette:start*/
  // Pins: per room, the seqs the human wants to keep in view; kept in localStorage, shown as a strip under the header.
  var pins = store.get('pins.msg', {});
  var pinned = function (seq) { return !!(sel && pins[sel] && pins[sel].indexOf(seq) >= 0); };
  function pinBtn(m) { var on = pinned(m.seq); return '<button class="pinb' + (on ? ' on' : '') + '" data-pin="' + m.seq + '" title="' + (on ? 'Unpin' : 'Pin to the top of this room') + '" aria-label="' + (on ? 'Unpin' : 'Pin') + ' message ' + m.seq + '" aria-pressed="' + on + '">' + (on ? '★' : '☆') + '</button>'; }
  function togglePin(seq) {
    if (!sel) return;
    var list = (pins[sel] || []).slice(), i = list.indexOf(seq);
    if (i >= 0) list.splice(i, 1); else list.push(seq);
    if (list.length) pins[sel] = list.sort(function (a, b) { return a - b; }); else delete pins[sel];
    store.set('pins.msg', pins);
    $$('.pinb[data-pin="' + seq + '"]').forEach(function (b) { var on = pinned(seq); b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; b.setAttribute('aria-pressed', String(on)); });
    renderPins();
  }
  var msgBySeq = function (seq) { for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].seq === seq) return msgs[i]; return null; };
  function renderPins() {
    var el = $('#pinstrip'); if (!el) return;
    el.innerHTML = (sel && pins[sel] || []).map(function (seq) {
      var m = msgBySeq(seq), txt = m ? m.from.name + ': ' + m.content.replace(/\\s+/g, ' ').slice(0, 80) : 'message #' + seq;
      return '<span class="pin" data-goto="' + seq + '" title="' + esc(m ? m.content.slice(0, 400) : '') + '" role="button" tabindex="0">★ <span>#' + seq + ' ' + esc(txt) + '</span><i data-unpin="' + seq + '" title="Unpin" role="button" aria-label="Unpin ' + seq + '">✕</i></span>';
    }).join('');
  }
  // Jump to a message even when the transcript filters hide it: clear the filters first, then scroll and flash it.
  function gotoSeq(seq) {
    var t = $('#log [data-seq="' + seq + '"]');
    if (!t && msgBySeq(seq)) {
      kindOff = {}; msgQuery = ''; whoF = ''; $('#msgq').value = ''; $('#whof').value = '';
      $$('#lf .tog[data-k]').forEach(function (b) { b.classList.add('on'); });
      if (!showNotices) { showNotices = true; store.set('notices', true); }
      rerender(); t = $('#log [data-seq="' + seq + '"]');
    }
    if (!t) return false;
    if (innerWidth <= 720) setView('chat');
    t.scrollIntoView({ block: 'center' }); t.classList.remove('hl'); void t.offsetWidth; t.classList.add('hl');
    return true;
  }
  document.addEventListener('click', function (e) {
    var un = e.target.closest('[data-unpin]'); if (un) { e.stopPropagation(); togglePin(Number(un.dataset.unpin)); return; }
    var pb = e.target.closest('[data-pin]'); if (pb) { togglePin(Number(pb.dataset.pin)); return; }
    var go = e.target.closest('[data-goto]'); if (go) gotoSeq(Number(go.dataset.goto));
  });
  document.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('#pinstrip .pin')) { e.preventDefault(); gotoSeq(Number(e.target.dataset.goto)); } });

  // Command palette (Cmd/Ctrl-K): one fuzzy list over rooms, inspector tabs, transcript filters, pins and actions.
  // Other sections add commands with window.crPalette.add({ group, label, hint, run }) or a provider function returning such a list.
  var palExtra = [];
  window.crPalette = { add: function (c) { palExtra.push(c); }, open: function (q) { palOpen(q); } };
  var setKinds = function (off) { kindOff = off; $$('#lf .tog[data-k]').forEach(function (b) { b.classList.toggle('on', !kindOff[b.dataset.k]); }); rerender(); toBottom(); };
  var setTab = function (t) { tab = t; store.set('tab', t); if (document.body.classList.contains('noinspect')) { document.body.classList.remove('noinspect'); store.set('noinspect', false); } if (innerWidth <= 720) setView('inspect'); else if (innerWidth <= 1100) document.body.classList.add('inspect-open'); renderPane(); if (t === 'stats') fetchStats(true); };
  function palCommands(q) {
    var out = [];
    var hm = /^#?(\\d+)$/.exec(q.trim());
    if (hm && sel) out.push({ group: 'message', label: 'Jump to message #' + hm[1] + ' in ' + sel, run: function () { gotoSeq(Number(hm[1])); }, always: true });
    (sel && pins[sel] || []).forEach(function (seq) { var m = msgBySeq(seq); out.push({ group: 'pinned', label: '#' + seq + ' ' + (m ? m.from.name + ': ' + m.content.replace(/\\s+/g, ' ').slice(0, 90) : ''), run: function () { gotoSeq(seq); } }); });
    rooms.slice().sort(function (a, b) { var la = a.state === 'open' || a.state === 'stalled', lb = b.state === 'open' || b.state === 'stalled'; return la !== lb ? (la ? -1 : 1) : b.created_at.localeCompare(a.created_at); }).forEach(function (r) {
      var unread = Math.max(0, (r.latest_seq || 0) - (lastSeen[r.name] || 0));
      out.push({ group: 'room', label: r.name, hint: r.state + (unread && r.name !== sel ? ' · ' + unread + ' new' : '') + (r.unanswered_human ? ' · human msg unanswered' : ''), run: function () { select(r.name); } });
    });
    [['decision', 'Decision'], ['people', 'People'], ['board', 'Board'], ['stats', 'Stats']].forEach(function (t) { out.push({ group: 'tab', label: 'Show ' + t[1] + ' tab', run: function () { setTab(t[0]); } }); });
    if (cur) {
      out.push({ group: 'view', label: 'Decisions only (proposals, votes, board)', hint: 'hide chat and system', run: function () { setKinds({ chat: true, system: true }); } });
      out.push({ group: 'view', label: 'Chat only', run: function () { setKinds({ cards: true, vote: true, board: true, system: true }); } });
      out.push({ group: 'view', label: 'Show everything', hint: 'clear transcript filters', run: function () { kindOff = {}; msgQuery = ''; whoF = ''; $('#msgq').value = ''; $('#whof').value = ''; setKinds({}); } });
      out.push({ group: 'view', label: 'Search messages in this room', hint: 'focus search', run: function () { if (innerWidth <= 720) setView('chat'); $('#msgq').focus(); } });
      out.push({ group: 'view', label: 'Jump to latest message', run: function () { if (innerWidth <= 720) setView('chat'); toBottom(); } });
      cur.participants.forEach(function (p) { out.push({ group: 'person', label: 'Only messages from or to ' + p.name, hint: p.agent + (p.active ? '' : ' · left'), run: function () { whoF = p.name; $('#whof').value = p.name; rerender(); toBottom(); } }); });
      var op = openProposal(cur); if (op) out.push({ group: 'action', label: 'Open proposal ' + op.id + ' v' + op.version, hint: op.tally.agree + '/' + voters(cur) + ' agree', run: function () { setTab('decision'); } });
      out.push({ group: 'action', label: 'Reply in ' + cur.name, hint: 'focus the composer', run: function () { if (innerWidth <= 720) setView('chat'); $('#text').focus(); } });
      out.push({ group: 'action', label: 'Open plain-text transcript', run: function () { window.open('/rooms/' + encodeURIComponent(cur.name) + '/transcript', '_blank'); } });
    }
    out.push({ group: 'action', label: 'Toggle light / dark theme', run: function () { $('#theme').click(); } });
    out.push({ group: 'action', label: 'Toggle inspector', run: function () { var b = $('#toginspect'); if (b) b.click(); } });
    out.push({ group: 'action', label: (showNotices ? 'Hide' : 'Show') + ' join/leave notices', run: function () { showNotices = !showNotices; store.set('notices', showNotices); rerender(); toBottom(); if (tab === 'decision') renderPane(); } });
    out.push({ group: 'action', label: (showArch ? 'Hide' : 'Show') + ' archived rooms', run: function () { $('#showarch').click(); } });
    out.push({ group: 'action', label: 'Filter the room list', run: function () { if (innerWidth <= 720) setView('rooms'); $('#filter').focus(); } });
    palExtra.forEach(function (c) { var list = typeof c === 'function' ? c(q) : [c]; (list || []).forEach(function (x) { if (x && x.label && x.run) out.push(x); }); });
    return out;
  }
  // Fuzzy score: every query character in order; contiguous runs, word starts and an early first hit score higher.
  function palScore(q, s) {
    if (!q) return { score: 0, at: [] };
    var ls = s.toLowerCase(), at = [], score = 0, j = 0, prev = -2;
    for (var i = 0; i < q.length; i++) {
      var c = q[i]; if (c === ' ') continue;
      var k = ls.indexOf(c, j); if (k < 0) return null;
      at.push(k); score += (k === prev + 1 ? 6 : 1) + (k === 0 || /[\\s\\-_/·:#]/.test(ls[k - 1]) ? 4 : 0);
      prev = k; j = k + 1;
    }
    var whole = ls.indexOf(q); if (whole >= 0) score += 20 - Math.min(whole, 15);
    return { score: score - at[0] * 0.05, at: at };
  }
  var palItems = [], palIdx = 0, palPrevFocus = null;
  var hlLabel = function (s, at) { var set = {}; at.forEach(function (i) { set[i] = 1; }); var o = ''; for (var i = 0; i < s.length; i++) o += set[i] ? '<b>' + esc(s[i]) + '</b>' : esc(s[i]); return o; };
  function palRender() {
    var q = $('#palq').value.trim().toLowerCase();
    var scored = [];
    palCommands(q).forEach(function (c, i) {
      if (c.always) { scored.push({ c: c, s: 1e6, at: [], i: i }); return; }
      var r = palScore(q, c.label + (c.hint ? ' ' + c.hint : '')) || (q ? palScore(q, c.group + ' ' + c.label) : null);
      if (r) scored.push({ c: c, s: r.score, at: r.at.filter(function (x) { return x < c.label.length; }), i: i });
    });
    if (q) scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    palItems = scored.slice(0, 60); palIdx = Math.min(palIdx, Math.max(0, palItems.length - 1));
    $('#pall').innerHTML = palItems.length ? palItems.map(function (x, i) {
      return '<li role="option" id="pal' + i + '" data-i="' + i + '" aria-selected="' + (i === palIdx) + '"' + (i === palIdx ? ' class="on"' : '') + '><span class="g">' + esc(x.c.group || '') + '</span><span class="l">' + hlLabel(x.c.label, x.at) + '</span>' + (x.c.hint ? '<span class="h">' + esc(x.c.hint) + '</span>' : '') + '</li>';
    }).join('') : '<li style="cursor:default;color:var(--dim)">No match</li>';
    $('#palq').setAttribute('aria-activedescendant', palItems.length ? 'pal' + palIdx : '');
    var on = $('#pall li.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function palOpen(q) { palPrevFocus = document.activeElement; $('#pal').classList.add('on'); $('#palq').value = q || ''; palIdx = 0; palRender(); $('#palq').focus(); }
  function palClose(restore) { $('#pal').classList.remove('on'); if (restore && palPrevFocus && palPrevFocus.focus) palPrevFocus.focus(); }
  function palRun(i) { var x = palItems[i]; if (!x) return; palClose(false); try { x.c.run(); } catch (err) {} }
  $('#palq').addEventListener('input', function () { palIdx = 0; palRender(); });
  $('#palq').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); palIdx = Math.min(palItems.length - 1, palIdx + 1); palRender(); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); palIdx = Math.max(0, palIdx - 1); palRender(); }
    else if (e.key === 'Enter') { e.preventDefault(); palRun(palIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); palClose(true); }
    else if (e.key === 'Tab') { e.preventDefault(); }
  });
  $('#pall').addEventListener('mousemove', function (e) { var li = e.target.closest('li[data-i]'); if (li && Number(li.dataset.i) !== palIdx) { palIdx = Number(li.dataset.i); $$('#pall li').forEach(function (x) { var on = Number(x.dataset.i) === palIdx; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }); } });
  $('#pall').addEventListener('click', function (e) { var li = e.target.closest('li[data-i]'); if (li) palRun(Number(li.dataset.i)); });
  $('#pal').addEventListener('mousedown', function (e) { if (e.target.id === 'pal') palClose(true); });
  $('#palbtn').onclick = function () { palOpen(''); };
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if ($('#pal').classList.contains('on')) palClose(true); else palOpen(''); }
  });
  /*palette:end*/
`;
