/**
 * Catch-up for the dashboard transcript (spliced into UI_HTML by src/ui.ts).
 *
 * A "since you last looked" digest pinned to the top of the transcript (questions for the human, proposals,
 * challenges, votes, board changes, joins/leaves, who talked), and a "Signal only" mode that folds runs of 3+
 * plain agent chatter rows into one expandable line. Runs inside the dashboard IIFE, so it uses its helpers
 * ($, esc, store, msgs, sel, seen, lastSeen, cur, myName, atBottom, rerender, toBottom). Hooks in ui.ts:
 * catchupSelect(name) in select(), catchupAfter() after rerender() and after poll() appends.
 * Escaping: this is a template literal, so regex backslashes are doubled as in ui.ts.
 */
export const CATCHUP_CSS = `/* ---------- catch-up digest + signal-only folds (catchup) ---------- */
  #catchup { position:sticky; top:-12px; z-index:3; margin:-12px -18px 10px; padding:8px 18px; border-bottom:1px solid var(--line);
    background:color-mix(in srgb, var(--bg) 78%, transparent); -webkit-backdrop-filter:blur(18px) saturate(1.5); backdrop-filter:blur(18px) saturate(1.5) }
  #catchup .cu-h { display:flex; align-items:center; gap:8px }
  #catchup .cu-tog { flex:1; min-width:0; display:flex; align-items:center; gap:6px; border:0; background:none; padding:2px 0; color:var(--fg); font:inherit; font-size:12.5px; font-weight:600; text-align:left; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  #catchup .car, .fold .car { color:var(--dim2); width:10px; display:inline-block; font-size:10px }
  #catchup .cu-s { font-weight:500; color:var(--dim) } #catchup .cu-ask { color:var(--hum) }
  #catchup .cu-done { border:1px solid var(--line); background:var(--panel); color:var(--dim); border-radius:999px; padding:2px 10px; font:inherit; font-size:11.5px; cursor:pointer }
  #catchup .cu-done:hover { color:var(--fg) }
  #catchup .cu-b { display:grid; gap:4px; padding:6px 0 2px 16px; max-height:34vh; overflow:auto }
  .cu-l { display:grid; grid-template-columns:82px minmax(0,1fr); gap:8px; align-items:baseline; font-size:12.5px }
  .cu-k { color:var(--dim2); font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase }
  .cu-l.hum .cu-k { color:var(--hum) } .cu-l.prop .cu-k { color:var(--prop) } .cu-l.chal .cu-k { color:var(--chal) } .cu-l.ok .cu-k { color:var(--ok) }
  .cu-v { display:flex; flex-wrap:nowrap; gap:6px; min-width:0; overflow:hidden } .cu-v > * { flex:0 1 auto; min-width:0 } .cu-t { color:var(--dim); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .cu-t b { color:var(--fg); font-weight:600 }
  .cu-j { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; padding:1px 8px; font:inherit; font-size:12px; cursor:pointer; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left }
  .cu-j:hover { border-color:var(--acc); } .cu-l.hum .cu-j { background:var(--hum-bg); border-color:color-mix(in srgb, var(--hum) 30%, transparent) }
  .cu-more { color:var(--dim2); font-size:11.5px; align-self:center }
  .fold { margin:4px 0 4px 38px; max-width:88ch }
  .fold-h { display:flex; align-items:center; gap:6px; width:100%; border:1px dashed var(--line); background:transparent; color:var(--dim); border-radius:10px; padding:4px 10px; font:inherit; font-size:12px; cursor:pointer; text-align:left }
  .fold-h:hover { color:var(--fg); border-style:solid } .fold-h b { font-weight:600; color:var(--fg) }
  .fold-b { display:none } .fold.open .fold-b { display:block; margin-left:-38px } .fold.open > .fold-h { margin-bottom:2px }
  #catchup button:focus-visible, .fold-h:focus-visible { outline:2px solid var(--acc); outline-offset:2px }
  @media (prefers-reduced-transparency: reduce) { #catchup { background:var(--bg); -webkit-backdrop-filter:none; backdrop-filter:none } }
  @media (max-width:720px) { #catchup { margin:-10px -12px 10px; padding:8px 12px; top:-10px } .cu-l { grid-template-columns:64px minmax(0,1fr) } .fold { margin-left:0 } .fold.open .fold-b { margin-left:0 } }`;

export const CATCHUP_JS = `/*catchup:start*/
  // Catch-up: a "since you last looked" digest pinned to the top of the transcript, and a "Signal only" mode that
  // folds runs of plain agent chatter into one line, so a 200-message room reads as its decisions, questions and asks.
  /*catchup-pure:start*/
  // Classifiers over one room's messages. humanNames: lower-case names that count as "the human" in an @-mention.
  function cuHelpers(all, humanNames) {
    var byId = function (id) { for (var i = all.length - 1; i >= 0; i--) if (all[i].id === id) return all[i]; return null; };
    var mentionsHuman = function (text) {
      var re = /@([\\w-]+)/g, x;
      while ((x = re.exec(text))) if (humanNames.indexOf(x[1].toLowerCase()) >= 0) return true;
      return false;
    };
    var answersHuman = function (m) { var t = m.replyTo && byId(m.replyTo); return !!(t && t.from.agent === 'human'); };
    // An agent asking the human something: names the human, asks a question, and is not itself an answer to the human
    // ("@benji agreed, running it now" is not a question).
    var isAsk = function (m) {
      return m.kind === 'chat' && m.from.agent !== 'human' && m.from.id !== 'system' && m.content.indexOf('?') >= 0 && mentionsHuman(m.content) && !answersHuman(m);
    };
    // Answered only by a human reply_to it (the inbox's rule): opening the room, an unrelated human post or a later
    // "@asker" line do not settle it, since one @asker would otherwise clear every ask that agent made.
    var answered = function (m) { return all.some(function (x) { return x.seq > m.seq && x.from.agent === 'human' && x.replyTo === m.id; }); };
    // Signal: what a returning reader must not miss. Everything else is chatter and may fold.
    var isSignal = function (m) {
      if (m.kind === 'proposal' || m.kind === 'amend' || m.kind === 'challenge' || m.kind === 'conclusion' || m.kind === 'vote') return true;
      if (m.from.agent === 'human') return true;
      if (m.kind === 'system') return /^CONSENSUS REACHED|min of silence|deadline|cannot pass|clamped|Cap hit|was marked as left|went quiet|left the room: /.test(m.content);
      if (m.kind !== 'chat' || m.from.id === 'system') return false;
      return m.tag === 'opening' || mentionsHuman(m.content) || answersHuman(m); // anything said to the human stays visible
    };
    return { byId: byId, mentionsHuman: mentionsHuman, isAsk: isAsk, answered: answered, isSignal: isSignal };
  }
  // The digest for messages after seq \`since\`: a one-line summary and one line per category, each item a jump button.
  // pending: the inbox's own list of pending asks for this room, when it provides one (so both count the same).
  function cuDigest(all, since, live, h, esc, pending) {
    var fresh = all.filter(function (m) { return m.seq > since; });
    var asks = !live ? [] : pending ? all.filter(function (m) { return pending.indexOf(m.id) >= 0; }) : all.filter(function (m) { return h.isAsk(m) && !h.answered(m); });
    if (!fresh.length && !asks.length) return null;
    var jump = function (m, label) { return '<button type="button" class="cu-j" data-jump="' + m.seq + '">' + label + '</button>'; };
    var snip = function (s, n) { s = s.replace(/\\s+/g, ' ').trim(); return esc(s.length > n ? s.slice(0, n - 1) + '…' : s); };
    var of = function (pred) { return fresh.filter(pred); };
    var props = of(function (m) { return m.kind === 'proposal' || m.kind === 'amend'; });
    var pids = []; props.forEach(function (m) { if (pids.indexOf(m.proposalId) < 0) pids.push(m.proposalId); });
    var chals = of(function (m) { return m.kind === 'challenge'; });
    var concl = of(function (m) { return m.kind === 'conclusion' || (m.kind === 'system' && /^CONSENSUS REACHED/.test(m.content)); });
    var votes = of(function (m) { return m.kind === 'vote'; });
    var board = of(function (m) { return m.kind === 'board'; });
    var joins = [], lefts = [], talk = {};
    fresh.forEach(function (m) {
      if (m.kind === 'chat' && m.from.id !== 'system') talk[m.from.name] = (talk[m.from.name] || 0) + 1;
      if (m.kind !== 'system') return;
      var j = /^\\[SYSTEM\\] (\\S+) .*joined the room/.exec(m.content); if (j) joins.push(j[1]);
      var l = /^\\[SYSTEM\\] (\\S+) .*left the room/.exec(m.content); if (l) lefts.push(l[1]);
    });
    var talkers = Object.keys(talk).sort(function (a, b) { return talk[b] - talk[a]; });
    var line = function (cls, key, body) { return '<div class="cu-l' + (cls ? ' ' + cls : '') + '"><span class="cu-k">' + key + '</span><span class="cu-v">' + body + '</span></div>'; };
    var lines = [];
    if (asks.length) lines.push(line('hum', 'For you', asks.slice(-4).map(function (m) { return jump(m, '<b>' + esc(m.from.name) + '</b> ' + snip(m.content, 70)); }).join('') + (asks.length > 4 ? '<span class="cu-more">+' + (asks.length - 4) + ' older</span>' : '')));
    if (concl.length) { var c = concl[concl.length - 1]; lines.push(line('ok', 'Concluded', jump(c, snip(c.content.replace(/^CONSENSUS REACHED on /, ''), 110)))); }
    if (pids.length) lines.push(line('prop', 'Proposals', pids.slice(-3).map(function (id) {
      var mine = props.filter(function (m) { return m.proposalId === id; }), last = mine[mine.length - 1];
      return jump(last, esc(id || 'proposal') + (mine.length > 1 ? ' · ' + mine.length + ' edits' : '') + ' · last by <b>' + esc(last.from.name) + '</b>');
    }).join('')));
    if (chals.length) lines.push(line('chal', 'Challenges', chals.slice(-2).map(function (m) { return jump(m, '<b>' + esc(m.from.name) + '</b> ' + snip(m.content.replace(/^CHALLENGE\\s+\\S+:?\\s*/, ''), 60)); }).join('')));
    if (votes.length) {
      var t = { agree: 0, disagree: 0, abstain: 0 };
      votes.forEach(function (m) { var v = /votes (AGREE|DISAGREE|ABSTAIN)/.exec(m.content); if (v) t[v[1].toLowerCase()]++; });
      lines.push(line('', 'Votes', jump(votes[votes.length - 1], t.agree + ' agree · ' + t.disagree + ' disagree' + (t.abstain ? ' · ' + t.abstain + ' abstain' : ''))));
    }
    if (board.length) {
      var pre = {}; board.forEach(function (m) { var k = /board entry "([^"/]+)\\//.exec(m.content); var p = k ? k[1] : 'other'; pre[p] = (pre[p] || 0) + 1; });
      lines.push(line('', 'Board', jump(board[board.length - 1], board.length + ' change' + (board.length === 1 ? '' : 's') + ': ' + Object.keys(pre).map(function (p) { return esc(p) + ' ×' + pre[p]; }).join(', '))));
    }
    if (joins.length || lefts.length) lines.push(line('', 'People', '<span class="cu-t">' + (joins.length ? 'joined ' + esc(joins.join(', ')) : '') + (joins.length && lefts.length ? ' · ' : '') + (lefts.length ? 'left ' + esc(lefts.join(', ')) : '') + '</span>'));
    if (talkers.length) lines.push(line('', 'Talk', '<span class="cu-t">' + talkers.slice(0, 8).map(function (n) { return esc(n) + ' <b>' + talk[n] + '</b>'; }).join(' · ') + '</span>'));
    var summary = fresh.length + ' new' + (asks.length ? ' · <b class="cu-ask">' + asks.length + ' for you</b>' : '')
      + (pids.length ? ' · ' + pids.length + ' proposal' + (pids.length === 1 ? '' : 's') + (props.length > pids.length ? ' (' + (props.length - pids.length) + ' amendments)' : '') : '')
      + (concl.length ? ' · concluded' : '');
    return { fresh: fresh.length, asks: asks, summary: summary, lines: lines };
  }
  /*catchup-pure:end*/
  var catchSince = sel ? (lastSeen[sel] || 0) : 0, catchOpen = store.get('catchOpen', true), signalOnly = store.get('signalOnly', false), foldOpen = {};
  var humanNames = function () {
    var names = ['human', 'user', 'owner', 'benji', myName().toLowerCase()];
    (cur ? cur.participants : []).forEach(function (p) { if (p.agent === 'human') names.push(p.name.toLowerCase()); });
    return names;
  };
  var msgBySeq = function (seq) { for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].seq === seq) return msgs[i]; return null; };
  function catchupSelect(name) { catchSince = lastSeen[name] || 0; foldOpen = {}; }
  // Jump to a message, opening the fold that hides it. Other sections (inbox, palette) may call window.crJump(seq).
  function catchupJump(seq) {
    var t = $('#log [data-seq="' + seq + '"]'); if (!t) return false;
    var f = t.closest('.fold'); if (f && !f.classList.contains('open')) { foldOpen[f.dataset.k] = true; f.classList.add('open'); foldLabel(f); }
    t.scrollIntoView({ block: 'center' }); t.classList.remove('hl'); void t.offsetWidth; t.classList.add('hl');
    return true;
  }
  window.crJump = catchupJump;
  function foldLabel(f) {
    var n = +f.dataset.n, names = f.dataset.names.split(',');
    var who = names.slice(0, 3).join(', ') + (names.length > 3 ? ' +' + (names.length - 3) : '');
    f.firstChild.innerHTML = '<span class="car">' + (f.classList.contains('open') ? '▾' : '▸') + '</span>' + n + ' message' + (n === 1 ? '' : 's') + ' of discussion · <b>' + esc(who) + '</b>';
    f.firstChild.setAttribute('aria-expanded', f.classList.contains('open') ? 'true' : 'false');
  }
  // Wrap each run of 3+ consecutive chatter rows in a fold; a fold already in the log absorbs chatter appended after it.
  function catchupFold() {
    if (!signalOnly) return;
    var log = $('#log'), kids = Array.prototype.slice.call(log.children), run = [], into = null, h = cuHelpers(msgs, humanNames());
    var flush = function () {
      if (into) { run.forEach(function (n) { into.lastChild.appendChild(n); }); }
      else if (run.length >= 3) {
        var f = document.createElement('div'); f.className = 'fold'; f.dataset.k = run[0].dataset.seq;
        f.innerHTML = '<button type="button" class="fold-h"></button><div class="fold-b"></div>';
        log.insertBefore(f, run[0]); run.forEach(function (n) { f.lastChild.appendChild(n); }); into = f;
        if (foldOpen[f.dataset.k]) f.classList.add('open');
      }
      if (into) {
        var names = [], rows = into.lastChild.querySelectorAll('[data-seq]');
        Array.prototype.forEach.call(rows, function (n) { var m = msgBySeq(+n.dataset.seq); if (m && names.indexOf(m.from.name) < 0) names.push(m.from.name); });
        into.dataset.n = rows.length; into.dataset.names = names.join(','); foldLabel(into);
      }
      run = []; into = null;
    };
    kids.forEach(function (n) {
      if (n.classList.contains('fold')) { flush(); into = n; return; }
      var m = n.dataset && n.dataset.seq ? msgBySeq(+n.dataset.seq) : null;
      if (m && !h.isSignal(m)) { run.push(n); return; }
      if (n.id === 'catchup') return;
      flush();
    });
    flush();
  }
  // The digest: what changed since the reader last looked, each line jumping to the message.
  // With the inbox (src/ui/inbox.ts) present, its pending asks (minus Dismissed) are the "For you" line, so both agree.
  var pendingIds = function () {
    if (typeof qAsks === 'function') return qAsks().filter(function (q) { return q.room === sel; }).map(function (q) { return q.id; });
    var p = typeof window.crPendingAsks === 'function' ? window.crPendingAsks(sel) : null;
    return Array.isArray(p) ? p : null;
  };
  function catchupDigest() {
    var old = $('#catchup');
    var live = !!cur && (cur.state === 'open' || cur.state === 'stalled');
    var g = sel && msgs.length ? cuDigest(msgs, catchSince, live, cuHelpers(msgs, humanNames()), esc, pendingIds()) : null;
    if (!g) { if (old) old.remove(); return; }
    var html = '<div class="cu-h"><button type="button" class="cu-tog" aria-expanded="' + catchOpen + '"><span class="car">' + (catchOpen ? '▾' : '▸') + '</span>' + (catchSince ? 'Since you last looked' : 'Room so far') + ' <span class="cu-s">' + g.summary + '</span></button>'
      + '<button type="button" class="cu-done" title="Mark everything up to now as read (key: .)">Caught up</button></div>'
      + (catchOpen ? '<div class="cu-b">' + g.lines.join('') + '</div>' : '');
    if (old && old.parentNode === $('#log') && old === $('#log').firstChild) { if (old.innerHTML !== html) old.innerHTML = html; return; }
    if (old) old.remove();
    var d = document.createElement('div'); d.id = 'catchup';
    d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Catch-up digest');
    d.innerHTML = html;
    $('#log').insertBefore(d, $('#log').firstChild);
  }
  setInterval(function () { if (!document.hidden) catchupDigest(); }, 4000); // the inbox's list and room state change without new messages
  function catchupAfter() { catchupFold(); catchupDigest(); }
  function setSignal(on) {
    signalOnly = on; store.set('signalOnly', on); foldOpen = {};
    var b = $('#sigonly'); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    var l = $('#log'), keep = l.scrollTop, bottom = atBottom(); rerender(); if (bottom) toBottom(); else l.scrollTop = keep;
  }
  (function () {
    var b = document.createElement('button'); b.type = 'button'; b.id = 'sigonly'; b.className = 'chip tog' + (signalOnly ? ' on' : '');
    b.textContent = 'signal only'; b.title = 'Fold runs of plain agent chatter; keep proposals, votes, human messages and questions for you (key: s)';
    b.setAttribute('aria-pressed', signalOnly ? 'true' : 'false');
    b.onclick = function () { setSignal(!signalOnly); };
    $('#lf').insertBefore(b, $('#whof'));
  })();
  // capture phase, so the existing reply-link handler finds its target already unfolded
  document.addEventListener('click', function (e) {
    var fh = e.target.closest && e.target.closest('.fold-h');
    if (fh) { var f = fh.parentElement; f.classList.toggle('open'); foldOpen[f.dataset.k] = f.classList.contains('open'); foldLabel(f); return; }
    var j = e.target.closest && e.target.closest('[data-jump]'); if (j) { e.stopPropagation(); catchupJump(+j.dataset.jump); return; }
    if (e.target.closest && e.target.closest('.cu-tog')) { catchOpen = !catchOpen; store.set('catchOpen', catchOpen); catchupDigest(); return; }
    if (e.target.closest && e.target.closest('.cu-done')) { catchSince = seen; if (sel) { lastSeen[sel] = seen; store.set('lastSeen', lastSeen); } catchupDigest(); return; }
    var re = e.target.closest && e.target.closest('.re');
    if (re) { var t = $('#log [data-seq="' + re.dataset.seq + '"]'), f2 = t && t.closest('.fold'); if (f2 && !f2.classList.contains('open')) { f2.classList.add('open'); foldOpen[f2.dataset.k] = true; foldLabel(f2); } }
  }, true);
  setTimeout(function () { // after every section has run, whichever order they were spliced in
    if (!window.crPalette) return;
    window.crPalette.add({ group: 'View', label: 'Signal only (fold chatter)', hint: 's', run: function () { setSignal(!signalOnly); } });
    window.crPalette.add({ group: 'View', label: 'Mark room caught up', hint: '.', run: function () { var b = $('#catchup .cu-done'); if (b) b.click(); } });
  }, 0);
  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 's') { e.preventDefault(); setSignal(!signalOnly); }
    else if (e.key === '.') { var b = $('#catchup .cu-done'); if (b) { e.preventDefault(); b.click(); } }
  });
  /*catchup:end*/`;
