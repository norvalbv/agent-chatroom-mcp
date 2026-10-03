/**
 * "Questions for you": the dashboard's inbox of agents' unanswered asks to the human, across rooms (GET /questions,
 * src/questions.ts), with an inline threaded reply, a toast for new asks, per-room and tab-title counts, an
 * "Answer" marker on pending asks in the transcript, and keys (i opens; j/k, r, o, d, m, Esc inside).
 *
 * Both strings are spliced into UI_HTML (src/ui.ts): the CSS at the end of <style>, the JS inside the dashboard's
 * IIFE, so it uses that scope's helpers ($, esc, store, av, rel, withMentions, select, poll, renderRooms, ...).
 * String.raw keeps regex backslashes as written; neither string may contain a backtick or a dollar-brace.
 */
export const INBOX_CSS = String.raw`  /* ---------- questions for you (inbox) ---------- */
  .qbar { margin:0 12px 10px; display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:10px; border:1px solid var(--line); background:var(--panel2); text-align:left; font-size:12.5px }
  .qbar .ql { font-weight:600 } .qbar .qs { flex:1; color:var(--dim); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .qbar .qc:empty { display:none } .qbar .qc { background:var(--hum); color:#fff; font-size:11px; font-weight:700; border-radius:999px; padding:1px 8px }
  .qbar.has { background:var(--hum-bg); border-color:color-mix(in srgb, var(--hum) 35%, transparent) } .qbar.has .ql { color:var(--hum) }
  .room .qr { grid-column:3; grid-row:1; justify-self:end; background:var(--hum); color:#fff; font-size:10.5px; font-weight:700; border-radius:999px; padding:1px 7px }
  .room .qr ~ .u { grid-row:2 }
  .room .m .qr { display:inline-block; margin-right:6px; padding:0 6px; font-size:10px; vertical-align:1px }
  #qpanel { position:fixed; inset:0; z-index:50; display:grid; place-items:start center; padding:6vh 16px 16px; background:rgba(10,12,16,.32) }
  #qpanel[hidden] { display:none }
  .qsheet { width:min(760px, 100%); max-height:86vh; display:flex; flex-direction:column; border-radius:18px; border:1px solid var(--line); background:var(--panel); box-shadow:0 24px 60px rgba(0,0,0,.28); outline:none; overflow:hidden }
  @supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))) {
    #qpanel { -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px) }
    .qsheet { background:color-mix(in srgb, var(--panel) 86%, transparent); -webkit-backdrop-filter:blur(24px) saturate(1.4); backdrop-filter:blur(24px) saturate(1.4) }
  }
  @media (prefers-reduced-transparency: reduce) { #qpanel { -webkit-backdrop-filter:none; backdrop-filter:none; background:rgba(10,12,16,.5) } .qsheet, #qtoast .qt { background:var(--panel) !important; -webkit-backdrop-filter:none !important; backdrop-filter:none !important } }
  .qhead { display:flex; align-items:center; gap:10px; padding:14px 16px 8px } .qhead h2 { margin:0; font-size:15px; font-weight:700; letter-spacing:-.01em } .qhead .c { color:var(--dim); font-size:12px } .qhead .sp { flex:1 }
  .qhead label { font-size:12px; color:var(--dim); display:flex; gap:5px; align-items:center; cursor:pointer }
  .qkeys { padding:0 16px 10px; font-size:11.5px; color:var(--dim); border-bottom:1px solid var(--line2) } .qkeys kbd { font:600 10.5px "JetBrains Mono",monospace; border:1px solid var(--line); border-bottom-width:2px; border-radius:5px; padding:0 4px; background:var(--panel2); color:var(--fg) }
  .qlist { overflow:auto; padding:10px 12px 14px; display:flex; flex-direction:column; gap:8px }
  .qitem { border:1px solid var(--line); border-radius:14px; padding:10px 12px; background:var(--panel2); --clampbg:var(--panel2) }
  .qitem.sel { border-color:var(--hum); box-shadow:0 0 0 3px color-mix(in srgb, var(--hum) 18%, transparent) }
  .qitem .qm { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:12px; color:var(--dim); margin-bottom:6px } .qitem .qm b { color:var(--fg); font-size:13px }
  .qitem .qm .room-l { font-family:"JetBrains Mono",monospace; font-size:11px; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:0 6px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer }
  .qitem .qask { font-weight:600; font-size:13.5px; margin-bottom:6px; padding:6px 10px; border-radius:10px; background:var(--hum-bg); white-space:pre-wrap; word-break:break-word }
  .qitem .qtx { white-space:pre-wrap; word-break:break-word; font-size:13.5px }
  .qitem .qre { font-size:11.5px; color:var(--dim); margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .qitem .qrow { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px; margin-top:8px; align-items:end }
  .qitem textarea { resize:vertical; min-height:36px; max-height:200px; font-size:13px; line-height:1.4; background:var(--panel) }
  .qitem .qacts { display:flex; gap:6px; flex-wrap:wrap; grid-column:1 / -1 } .qitem .qerr { color:var(--bad); font-size:12px; grid-column:1 / -1 } .qitem .qerr:empty { display:none }
  .qempty { color:var(--dim); text-align:center; padding:36px 16px; font-size:13px }
  .msg.q4u .body { border:1px solid color-mix(in srgb, var(--hum) 45%, transparent) }
  .q4ub { display:block; width:fit-content; margin:4px 0 0; border:1px solid color-mix(in srgb, var(--hum) 40%, transparent); background:var(--hum-bg); color:var(--hum); border-radius:999px; padding:1px 10px; font-size:11.5px; font-weight:600 }
  #qtoast { position:fixed; right:16px; bottom:16px; z-index:60; display:flex; flex-direction:column; gap:8px; max-width:min(380px, calc(100vw - 32px)) }
  #qtoast .qt { border:1px solid color-mix(in srgb, var(--hum) 35%, var(--line)); border-radius:14px; padding:10px 12px; background:var(--panel); box-shadow:0 12px 32px rgba(0,0,0,.22); font-size:12.5px; animation:qin .2s ease-out }
  @supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))) { #qtoast .qt { background:color-mix(in srgb, var(--panel) 84%, transparent); -webkit-backdrop-filter:blur(20px) saturate(1.4); backdrop-filter:blur(20px) saturate(1.4) } }
  #qtoast .qt b { color:var(--hum) } #qtoast .qt .x { color:var(--dim); margin:4px 0 8px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden } #qtoast .qt .a { display:flex; gap:6px }
  @keyframes qin { from { opacity:0; transform:translateY(8px) } }
  @media (prefers-reduced-motion: reduce) { #qtoast .qt { animation:none } }
  @media (max-width:720px) { #qpanel { padding:0 } .qsheet { width:100%; max-height:100%; height:100%; border-radius:0 } #qtoast { bottom:76px } }
`;

export const INBOX_JS = String.raw`
  /*inbox:start*/
  // Questions for you: agents' asks addressed to the human (GET /questions, src/questions.ts), across every room,
  // each with an inline reply that posts reply_to the ask. Viewing an ask never settles it; a reply or Dismiss does.
  var qs = [], qSelId = null, qKnown = null, qSig = '', qShowMen = store.get('qMen', false);
  var qDismissed = store.get('qDismissed', {}), qDrafts = store.get('qDrafts', {});
  var qVisible = function () { return qs.filter(function (q) { return !qDismissed[q.id] && (qShowMen || q.kind === 'question'); }); };
  var qAsks = function () { return qs.filter(function (q) { return !qDismissed[q.id] && q.kind === 'question'; }); };
  var qOpen = function () { return !$('#qpanel').hidden; };
  // "abcd/room" for swarm-170000-abcd-room: the run's short id keeps two runs' "room"s apart
  var qShort = function (room) { var g = runOf(room); return g ? g.slice(-4) + '/' + (room.slice(g.length + 1) || room) : room; };
  // A long message hides its ask under the clamp; lift the sentences that ask something (outside code) above it
  var qAskLine = function (text) {
    var prose = text.replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, ' ').replace(/\x60[^\x60\n]*\x60/g, ' ').replace(/https?:\/\/\S+/g, ' ');
    var parts = prose.split(/(?<=[.!?])\s+|\n+/).map(function (x) { return x.trim(); }).filter(function (x) { return /\?/.test(x); });
    return parts.slice(-2).join(' ').slice(0, 400);
  };
  function qBadge(room) {
    var n = qAsks().filter(function (q) { return q.room === room; }).length;
    return n ? '<span class="qr" title="' + n + ' question' + (n === 1 ? '' : 's') + ' for you">' + n + '?</span>' : '';
  }
  async function fetchQuestions() {
    try {
      var res = await fetch('/questions?names=' + encodeURIComponent(myName()));
      if (!res.ok) return;
      var list = await res.json(); if (!Array.isArray(list)) return;
      var live = {}; list.forEach(function (q) { live[q.id] = 1; });
      var pruned = false; Object.keys(qDismissed).forEach(function (id) { if (!live[id]) { delete qDismissed[id]; pruned = true; } });
      Object.keys(qDrafts).forEach(function (id) { if (!live[id]) { delete qDrafts[id]; pruned = true; } });
      if (pruned) { store.set('qDismissed', qDismissed); store.set('qDrafts', qDrafts); }
      var fresh = qKnown ? list.filter(function (q) { return !qKnown[q.id] && q.kind === 'question' && !qDismissed[q.id]; }) : [];
      var first = !qKnown;
      qKnown = live; qs = list;
      renderQ();
      if (first && qAsks().length) qToast(null, qAsks().length);
      else if (fresh.length) qToast(fresh[0], fresh.length);
    } catch (e) {}
  }
  function renderQ() {
    var n = qAsks().length, men = qs.filter(function (q) { return !qDismissed[q.id] && q.kind === 'mention'; }).length;
    var rooms_ = {}; qAsks().forEach(function (q) { rooms_[q.room] = 1; });
    $('#qbar').classList.toggle('has', n > 0);
    $('#qbarn').textContent = n ? String(n) : '';
    $('#qbars').textContent = n ? 'in ' + Object.keys(rooms_).length + ' room' + (Object.keys(rooms_).length === 1 ? '' : 's') + ' · press i' : men ? men + ' mention' + (men === 1 ? '' : 's') + ', no questions' : 'nothing waiting';
    if (!n) $('#qtoast').innerHTML = '';
    document.title = (n ? '(' + n + ') ' : '') + document.title.replace(/^\(\d+\) /, '');
    renderRooms();
    markTranscript();
    if (qOpen()) renderQPanel(false);
  }
  function qItem(q) {
    var open = !!expanded['q:' + q.id], long = q.text.length > 600;
    return '<div class="qitem' + (q.id === qSelId ? ' sel' : '') + '" data-qid="' + esc(q.id) + '">'
      + '<div class="qm">' + av(q.from, q.agent) + '<b>' + esc(q.from) + '</b><span class="room-l" data-qopen="' + esc(q.id) + '" title="Open ' + esc(q.room) + ' at #' + q.seq + '">' + esc(qShort(q.room)) + ' #' + q.seq + '</span>'
      + (q.kind === 'mention' ? '<span class="chip">mention</span>' : '<span class="chip hum">question</span>') + (q.room_state !== 'open' ? '<span class="chip ' + esc(q.room_state) + '">' + esc(q.room_state) + '</span>' : '')
      + '<span title="' + esc(q.ts) + '">' + rel(q.ts) + '</span></div>'
      + (q.reply_to ? '<div class="qre">↩ #' + q.reply_to.seq + ' ' + esc(q.reply_to.from) + ': ' + esc(q.reply_to.text.slice(0, 120)) + '</div>' : '')
      + (q.kind === 'question' && q.text.length > 300 && qAskLine(q.text) ? '<div class="qask">' + withMentions(esc(qAskLine(q.text))) + '</div>' : '')
      + '<div class="qtx' + (long && !open ? ' clamp' : '') + '">' + withMentions(esc(q.text)) + '</div>' + (long ? '<button class="more" data-x="q:' + esc(q.id) + '">' + (open ? 'Show less' : 'Show all ' + q.text.length + ' chars') + '</button>' : '')
      + '<div class="qrow"><textarea rows="1" data-qta="' + esc(q.id) + '" aria-label="Reply to ' + esc(q.from) + '" placeholder="Reply to ' + esc(q.from) + ' (Enter sends, Shift+Enter for a new line)">' + esc(qDrafts[q.id] || '') + '</textarea><button class="btn primary" data-qsend="' + esc(q.id) + '">Reply</button>'
      + '<div class="qacts"><button class="mini" data-qopen="' + esc(q.id) + '">Open in room</button><button class="mini" data-qdis="' + esc(q.id) + '" title="Hide it here without answering">Dismiss</button></div><div class="qerr"></div></div></div>';
  }
  function renderQPanel(force) {
    var list = qVisible();
    if (list.length && !list.some(function (q) { return q.id === qSelId; })) qSelId = list[0].id;
    var sig = qShowMen + '|' + qSelId + '|' + list.map(function (q) { return q.id; }).join(',') + '|' + Object.keys(expanded).filter(function (k) { return k.indexOf('q:') === 0 && expanded[k]; }).join(',');
    // a re-render would drop what is being typed; only rebuild when the list itself changed
    if (!force && sig === qSig) return; qSig = sig;
    var act = document.activeElement, focusId = act && act.dataset ? act.dataset.qta : null, caret = focusId ? act.selectionStart : 0;
    var n = qAsks().length;
    $('#qpanel .qsheet').innerHTML = '<div class="qhead"><h2 id="qtitle">Questions for you</h2><span class="c">' + n + ' unanswered' + (qShowMen ? ' · with mentions' : '') + '</span><span class="sp"></span>'
      + ('Notification' in window && Notification.permission === 'default' ? '<button class="mini" id="qnotify">Notify me</button>' : '')
      + '<label><input type="checkbox" id="qmen"' + (qShowMen ? ' checked' : '') + '> mentions</label><button class="btn icon" id="qclose" title="Close (Esc)" aria-label="Close">✕</button></div>'
      + '<div class="qkeys"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>r</kbd> reply · <kbd>o</kbd> open in room · <kbd>d</kbd> dismiss · <kbd>m</kbd> mentions · <kbd>Esc</kbd> close. A reply posts in that room, threaded to the question and addressed to its asker.</div>'
      + '<div class="qlist">' + (list.length ? list.map(qItem).join('') : '<div class="qempty">Nothing is waiting on you. Agents’ questions that @-name you (' + esc(myName()) + ', human, owner or a room chair) appear here until you reply.</div>') + '</div>';
    if (focusId) { var ta = $('#qpanel [data-qta="' + focusId + '"]'); if (ta) { ta.focus(); ta.setSelectionRange(caret, caret); } }
  }
  function qShow(id) {
    if (id) qSelId = id;
    $('#qtoast').innerHTML = '';
    $('#qpanel').hidden = false; renderQPanel(true);
    var it = $('#qpanel .qitem.sel'); if (it) it.scrollIntoView({ block: 'nearest' });
    if (!document.activeElement || !document.activeElement.closest('#qpanel')) $('#qpanel .qsheet').focus();
  }
  function qHide() { $('#qpanel').hidden = true; }
  function qMove(d) {
    var list = qVisible(); if (!list.length) return;
    var i = Math.max(0, list.map(function (q) { return q.id; }).indexOf(qSelId));
    qSelId = list[Math.min(list.length - 1, Math.max(0, i + d))].id; renderQPanel(true);
    var it = $('#qpanel .qitem.sel'); if (it) it.scrollIntoView({ block: 'nearest' });
  }
  var qById = function (id) { return qs.filter(function (q) { return q.id === id; })[0]; };
  async function qSend(id) {
    var q = qById(id), ta = $('#qpanel [data-qta="' + id + '"]'); if (!q || !ta) return;
    var text = ta.value.trim(); if (!text) { ta.focus(); return; }
    // addressing the asker makes the hub nominate them to answer the follow-up
    var content = /^@[\w-]+/.test(text) ? text : '@' + q.from + ' ' + text;
    var btn = $('#qpanel [data-qsend="' + id + '"]'), err = ta.parentElement.querySelector('.qerr');
    btn.disabled = true;
    try {
      var res = await fetch('/rooms/' + encodeURIComponent(q.room) + '/messages', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: myName(), content: content, reply_to: q.id }) });
      if (!res.ok) { err.textContent = await res.text(); btn.disabled = false; return; }
      delete qDrafts[id]; store.set('qDrafts', qDrafts);
      var list = qVisible(), i = list.map(function (x) { return x.id; }).indexOf(id), next = list[i + 1] || list[i - 1];
      qs = qs.filter(function (x) { return x.id !== id; }); qSelId = next ? next.id : null;
      renderQ(); renderQPanel(true);
      var nta = qSelId && $('#qpanel [data-qta="' + qSelId + '"]'); if (nta) nta.focus(); else $('#qpanel .qsheet').focus();
      if (q.room === sel) poll();
      fetchQuestions();
    } catch (e) { err.textContent = 'Could not reach the hub.'; btn.disabled = false; }
  }
  function qDismiss(id) {
    var list = qVisible(), i = list.map(function (x) { return x.id; }).indexOf(id), next = list[i + 1] || list[i - 1];
    qDismissed[id] = 1; store.set('qDismissed', qDismissed); qSelId = next ? next.id : null; renderQ(); renderQPanel(true);
  }
  // Jump to the ask in its room: select it, wait for the transcript to load it, then scroll and flash it
  function qJump(id) {
    var q = qById(id); if (!q) return; qHide();
    if (sel !== q.room) select(q.room);
    if (innerWidth <= 720) setView('chat');
    var tries = 0;
    (function look() {
      var el = sel === q.room && $('#log [data-seq="' + q.seq + '"]');
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.remove('hl'); void el.offsetWidth; el.classList.add('hl'); return; }
      if (++tries < 40 && sel === q.room) setTimeout(look, 250);
    })();
  }
  // Pending asks in the open room carry a marker and an Answer button in the transcript itself
  function markTranscript() {
    if (!sel) return;
    var ids = {}; qAsks().forEach(function (q) { if (q.room === sel) ids[q.seq] = q.id; });
    $$('#log .msg.q4u').forEach(function (el) { if (!ids[el.dataset.seq]) { el.classList.remove('q4u'); var b = el.querySelector('.q4ub'); if (b) b.remove(); } });
    Object.keys(ids).forEach(function (seq) {
      var el = $('#log [data-seq="' + seq + '"]'); if (!el || el.classList.contains('q4u')) return;
      el.classList.add('q4u');
      var host = el.lastElementChild; if (!host) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'q4ub'; b.dataset.qans = ids[seq]; b.textContent = 'Answer this question'; host.appendChild(b);
    });
  }
  new MutationObserver(function () { markTranscript(); }).observe($('#log'), { childList: true });
  var qToastTimer = null;
  function qToast(q, n) {
    var box = $('#qtoast');
    var body = q ? '<b>' + esc(q.from) + '</b> asked you in ' + esc(qShort(q.room)) + (n > 1 ? ' (+' + (n - 1) + ' more)' : '') + '<div class="x">' + esc(q.text.slice(0, 240)) + '</div>'
      : '<b>' + n + ' question' + (n === 1 ? '' : 's') + '</b> waiting for you<div class="x">Agents asked you and nobody has replied yet.</div>';
    box.innerHTML = '<div class="qt">' + body + '<div class="a"><button class="btn primary" data-qtoast="' + esc(q ? q.id : '') + '">Answer</button><button class="btn" data-qtoastx="1">Later</button></div></div>';
    clearTimeout(qToastTimer); qToastTimer = setTimeout(function () { box.innerHTML = ''; }, 15000);
    if (q && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { var nt = new Notification(q.from + ' asked you (' + qShort(q.room) + ')', { body: q.text.slice(0, 180), tag: q.id }); nt.onclick = function () { window.focus(); qShow(q.id); nt.close(); }; } catch (e) {}
    }
  }
  $('#qbar').onclick = function () { qOpen() ? qHide() : qShow(); };
  $('#qpanel').addEventListener('mousedown', function (e) { if (e.target.id === 'qpanel') qHide(); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-qsend],[data-qopen],[data-qdis],[data-qans],[data-qtoast],[data-qtoastx],#qclose,#qnotify,.qitem,#qmen');
    if (!t) return;
    if (e.target.closest('#qpanel .more')) return renderQPanel(true); // the shared .more handler already toggled expanded
    if (t.id === 'qclose') return qHide();
    if (t.id === 'qmen') { qShowMen = t.checked; store.set('qMen', qShowMen); return renderQPanel(true); }
    if (t.id === 'qnotify') { Notification.requestPermission().then(function () { renderQPanel(true); }); return; }
    if (t.dataset.qsend) return qSend(t.dataset.qsend);
    if (t.dataset.qopen) return qJump(t.dataset.qopen);
    if (t.dataset.qdis) return qDismiss(t.dataset.qdis);
    if (t.dataset.qans) { qShow(t.dataset.qans); var a = $('#qpanel [data-qta="' + t.dataset.qans + '"]'); if (a) a.focus(); return; }
    if (t.dataset.qtoastx) { $('#qtoast').innerHTML = ''; return; }
    if (t.dataset.qtoast !== undefined) { $('#qtoast').innerHTML = ''; qShow(t.dataset.qtoast || null); return; }
    if (t.classList.contains('qitem') && t.dataset.qid !== qSelId && !e.target.closest('button,textarea,a')) { qSelId = t.dataset.qid; renderQPanel(true); }
  });
  $('#qpanel').addEventListener('input', function (e) {
    var id = e.target.dataset && e.target.dataset.qta; if (!id) return;
    qDrafts[id] = e.target.value; store.set('qDrafts', qDrafts);
    e.target.style.height = ''; e.target.style.height = Math.min(200, e.target.scrollHeight) + 'px';
  });
  $('#qpanel').addEventListener('focusin', function (e) { var id = e.target.dataset && e.target.dataset.qta; if (id && id !== qSelId) { qSelId = id; $$('#qpanel .qitem').forEach(function (el) { el.classList.toggle('sel', el.dataset.qid === id); }); } });
  document.addEventListener('keydown', function (e) {
    var inQ = e.target.closest && e.target.closest('#qpanel');
    if (e.target.matches('textarea') && inQ) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); qSend(e.target.dataset.qta); }
      else if (e.key === 'Escape') { e.preventDefault(); $('#qpanel .qsheet').focus(); }
      return;
    }
    if (e.target.matches('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!qOpen()) { if (e.key === 'i') { e.preventDefault(); qShow(); } return; }
    var k = e.key;
    if (k === 'Escape' || k === 'i') { e.preventDefault(); qHide(); }
    else if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); qMove(1); }
    else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); qMove(-1); }
    else if ((k === 'r' || k === 'Enter') && qSelId) { e.preventDefault(); var ta = $('#qpanel [data-qta="' + qSelId + '"]'); if (ta) ta.focus(); }
    else if (k === 'o' && qSelId) { e.preventDefault(); qJump(qSelId); }
    else if (k === 'd' && qSelId) { e.preventDefault(); qDismiss(qSelId); }
    else if (k === 'm') { e.preventDefault(); qShowMen = !qShowMen; store.set('qMen', qShowMen); renderQPanel(true); }
  }, true);
  // other sections read the inbox instead of re-deriving it: the rooms rail (src/ui/rooms.ts) asks for a per-room badge,
  // the catch-up strip for the pending asks (the hub's GET /questions list, minus local dismissals)
  window.crRoomBadge = function (r) { return qBadge(r.name); };
  window.crQuestions = function () { return qAsks().slice(); };
  // the command palette (src/ui/palette.ts), when merged, lists the inbox and every pending ask
  setTimeout(function () {
    if (!window.crPalette) return;
    window.crPalette.add({ group: 'Inbox', label: 'Questions for you', hint: 'i', run: function () { qShow(); } });
    window.crPalette.add(function () { return qAsks().map(function (q) { return { group: 'Inbox', label: 'Answer ' + q.from + ': ' + q.text.replace(/\s+/g, ' ').slice(0, 80), hint: qShort(q.room), run: function () { qShow(q.id); var a = $('#qpanel [data-qta="' + q.id + '"]'); if (a) a.focus(); } }; }); });
  }, 0);
  fetchQuestions(); setInterval(function () { if (!document.hidden || !qKnown) fetchQuestions(); }, 4000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) fetchQuestions(); });
  /*inbox:end*/
`;
