/**
 * The floating layer over the transcript (src/ui/styles.ts makes it glass), spliced into UI_HTML by src/ui.ts:
 * - CHROME_HTML: the glass menus (room options, you, message filters, room actions), outside the header so a header
 *   re-render keeps an open menu open;
 * - HEAD_JS: the room header (renderHead) and the dot on the filter button;
 * - POPOVER_JS: one menu open at a time, and the header/composer heights the transcript pads itself by.
 * The JS runs inside the dashboard's IIFE and uses its helpers and state ($, esc, rel, store, cur, kindOff, select, ...).
 * The strings are template literals like UI_HTML: a regex backslash would need doubling (there are none here).
 */
export const CHROME_HTML = `<div class="pop" id="rctlpop" role="dialog" aria-label="Sort and filter rooms" hidden><div class="rctl" id="rctl"><div class="pl">Sort rooms</div><select id="sort" title="Sort rooms" aria-label="Sort rooms"><option value="newest">Newest first</option><option value="active">Most active</option><option value="msgs">Most messages</option><option value="name">Name</option></select><div class="pl">Show</div><button class="chip tog on" data-st="live" title="Show open and stalled rooms">Live</button><button class="chip tog on" data-st="concluded">Concluded</button><button class="chip tog on" data-st="closed">Closed</button><button class="chip tog" id="showarch" title="Include archived rooms">Archived</button><div class="sep"></div><button class="btn mi" id="archdead" data-ic="archive" title="Hide every room nobody is in. Transcripts are kept; they reappear under 'archived'.">Archive dead rooms</button></div></div>
<div class="pop" id="mepop" role="dialog" aria-label="You" hidden><label class="pl" for="name">Your name in rooms</label><input id="name" placeholder="your name" autocomplete="off" /><div class="sep"></div><button class="btn mi" id="theme" type="button" data-ic="theme">Light / dark theme</button></div>
<div class="pop" id="lf" role="dialog" aria-label="Filter and search messages" hidden><input id="msgq" placeholder="Search messages" aria-label="Search messages" autocomplete="off" /><div class="pl">Show</div><button class="chip tog on" data-k="chat">Chat</button><button class="chip tog on" data-k="cards">Proposals</button><button class="chip tog on" data-k="vote">Votes</button><button class="chip tog on" data-k="board">Board</button><button class="chip tog on" data-k="system">System</button><select id="whof" title="Only messages from, or addressed to, one participant" aria-label="Only messages from or to"><option value="">From everyone</option></select></div>
<div class="pop" id="morepop" role="menu" aria-label="Room actions" hidden></div>`;

export const HEAD_JS = `
  // ---------- header ----------
  // the message filter button carries a dot while anything is filtered out, since its panel is closed most of the time
  var lfActive = function () { return Object.keys(kindOff).some(function (k) { return kindOff[k]; }) || !!whoF || !!msgQuery || (typeof signalOnly !== 'undefined' && !!signalOnly); };
  function renderHead(r) {
    var open = openProposal(r), pinFocus = document.activeElement && document.activeElement.id === 'pinroom';
    // one state chip; a concluded room's says when, and opens the conclusion
    var chips = r.conclusion ? '<button type="button" class="chip ' + r.state + '" data-tab-open="decision" title="Open the conclusion">' + (r.state === 'concluded' ? '' : r.state + ' · ') + 'concluded ' + rel(r.conclusion.decidedAt) + '</button>' : '<span class="chip ' + r.state + '">' + r.state + '</span>';
    if (open) chips += '<button type="button" class="chip prop" data-tab-open="decision" title="Open the decision">' + esc(open.id) + ' v' + open.version + ' · ' + open.tally.agree + '/' + voters(r) + ' agree' + (open.needs_challenge ? ' · needs challenge' : '') + '</button>';
    if (r.hold) chips += '<span class="chip bad">on hold by ' + esc(r.hold.by) + '</span>';
    if (r.unanswered_human) chips += '<span class="chip hum">waiting on a reply to ' + esc(r.unanswered_human.name) + '</span>';
    if (r.openings && r.openings !== 'revealed' && (r.state === 'open')) chips += '<span class="chip" title="openings: ' + esc(r.openings) + '">openings: ' + esc(r.openings.replace(/, waiting for nobody$/, '')) + '</span>';
    // room actions live in a glass menu (#morepop, outside the header so a re-render keeps it open)
    var menu = '<a class="btn hidephone" role="menuitem" data-ic="doc" href="/rooms/' + encodeURIComponent(r.name) + '/transcript" target="_blank" title="Plain-text transcript">Transcript</a>'
      + '<a class="btn hidephone" role="menuitem" data-ic="chart" href="/rooms/' + encodeURIComponent(r.name) + '/metrics?format=md" target="_blank" title="Per-seat cost, context and waits; the run in half-hour steps; when it went quiet">Metrics</a>'
      + roomPinButton(r)
      + '<button class="btn" id="archroom" role="menuitem" data-ic="archive" title="' + (r.archived ? 'Show this room in listings again' : 'Hide this room from listings; the transcript is kept') + '">' + (r.archived ? 'Unarchive' : 'Archive') + '</button>'
      + ((r.state === 'concluded' || r.state === 'closed') ? '<button class="btn hidephone" id="verdictroom" role="menuitem" data-ic="check" title="Record whether the answer of this room was used: adopted, rejected or partial (owner_verdict in its log; the runs table shows it)">Verdict</button>' : '')
      + ((r.breakouts || []).length ? '<div class="sep" role="separator"></div><div class="pl">Breakouts</div>' + fateChips({ breakouts: r.breakouts }, esc) : '')
      + ((r.state === 'open' || r.state === 'stalled') ? '<div class="sep" role="separator"></div><button class="btn danger" id="closeroom" role="menuitem" data-ic="close" title="Close this room without a conclusion">Close room</button>' : '');
    var act = '<button class="btn icon ghost' + (lfActive() ? ' on' : '') + '" id="lfbtn" data-pop="lf" aria-haspopup="true" aria-expanded="' + popIs('lf') + '" title="Filter and search messages" aria-label="Filter and search messages"><span class="i i-filter"></span></button>'
      + '<button class="btn icon ghost" id="toginspect" title="Decision, people, board and stats" aria-label="Toggle the inspector"><span class="i i-panel"></span></button>'
      + '<button class="btn icon ghost" id="morebtn" data-pop="morepop" aria-haspopup="true" aria-expanded="' + popIs('morepop') + '" title="Room actions" aria-label="Room actions"><span class="i i-more"></span></button>';
    var topicOpen = !!expanded['topic'];
    $('#head').innerHTML = '<span class="hav">' + creature(r.name) + '</span><div class="t1"><h2>' + esc(r.name) + '</h2>' + chips + fateChips(r, esc) + '</div><div class="acts">' + act + '</div>'
      + '<div class="topic' + (topicOpen ? ' open' : '') + '" id="topic" title="Click to expand">' + esc(r.topic || '(no topic)') + '</div>' + fateLine(r, esc) + '<div id="pinstrip"></div>';
    $('#morepop').innerHTML = menu;
    if (popOpen) { var nb = $('#head [data-pop="' + popOpen.pop.id + '"]'); if (nb) popOpen.btn = nb; }
    renderPins();
    bindRoomPin(r, pinFocus);
    $('#topic').onclick = function () { expanded['topic'] = !expanded['topic']; renderHead(r); };
    var cb = $('#closeroom'); if (cb) cb.onclick = function () { closeRoom(r); };
    var ab = $('#archroom'); if (ab) ab.onclick = function () { archiveRoom(r); };
    var vb = $('#verdictroom'); if (vb) vb.onclick = function () { verdictRoom(r); };
    var wf = $('#whof'), keep = wf.value;
    wf.innerHTML = '<option value="">From everyone</option>' + r.participants.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) { return '<option value="' + esc(p.name) + '">' + esc(p.name) + (p.active ? '' : ' (left)') + '</option>'; }).join('');
    wf.value = keep; if (wf.value !== keep) { whoF = ''; }
    $('#toginspect').onclick = function () {
      if (innerWidth <= 720) { setView('inspect'); return; }
      if (innerWidth <= 1100) { document.body.classList.toggle('inspect-open'); return; }
      document.body.classList.toggle('noinspect'); store.set('noinspect', document.body.classList.contains('noinspect'));
    };
    $('#sendbtn').disabled = r.state === 'closed';
    var g = runOf(r.name);
    $('#text').placeholder = r.state === 'closed' ? 'This room is closed' : r.state === 'concluded' ? 'Ask the agents still here' : 'Message ' + (g ? r.name.slice(g.length + 1) : r.name);
    $('#text').title = 'Enter sends, Shift+Enter starts a new line. Humans bypass budgets and the stale-send guard; one agent answers unless you address @all.';
    $('#hint').className = 'hint'; $('#hint').textContent = ''; // send errors only (src/ui/photos.ts)
    var quick = r.participants.filter(function (p) { return p.active && p.agent !== 'human'; }).map(function (p) { return '<button type="button" data-at="' + esc(p.name) + '">@' + esc(p.name) + '</button>'; });
    $('#quick').innerHTML = quick.length ? '<button type="button" data-at="all">@all</button>' + quick.join('') : '';
  }
`;

export const POPOVER_JS = `
  // ---------- popovers ----------
  // One glass menu open at a time (room options, you, message filters, room actions), fixed under the button that opened
  // it and flipped above it near the bottom edge. A click outside, Esc or a resize closes it; so does picking a menu row.
  var popOpen = null;
  var popIs = function (id) { return !!(popOpen && popOpen.pop.id === id); };
  function closePop(refocus) {
    if (!popOpen) return;
    var p = popOpen; popOpen = null; p.pop.hidden = true;
    if (p.btn) p.btn.setAttribute('aria-expanded', 'false');
    if (refocus && p.btn && document.contains(p.btn)) p.btn.focus();
  }
  function openPop(id, btn) {
    var p = $('#' + id); if (!p || !btn) return;
    if (popIs(id)) { closePop(); return; }
    closePop(); p.hidden = false;
    var r = btn.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
    var left = r.left < innerWidth / 2 ? r.left : r.right - w;
    var top = r.bottom + 8 + h <= innerHeight - 8 ? r.bottom + 8 : r.top - h - 8;
    p.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + 'px'; p.style.top = Math.max(8, top) + 'px';
    btn.setAttribute('aria-expanded', 'true'); popOpen = { pop: p, btn: btn };
    var first = p.querySelector('input'); if (first && id === 'lf') first.focus();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-pop]');
    if (b) { openPop(b.dataset.pop, b); return; }
    if (!popOpen) return;
    if (!popOpen.pop.contains(e.target)) closePop();
    else if (e.target.closest('.mi, #morepop .btn')) setTimeout(function () { closePop(); }, 0);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && popOpen) { e.stopImmediatePropagation(); closePop(true); } }, true);
  addEventListener('resize', function () { closePop(); });
  // the header and composer float over the transcript: its padding follows their height, so nothing hides beneath them,
  // and a reader at the bottom stays at the bottom when they grow (a room's chips and @-chips arrive after its first draw)
  var layoutVars = function () {
    var m = $('#main'), l = $('#log'), stick = l.scrollHeight - l.scrollTop - l.clientHeight < 60;
    m.style.setProperty('--headh', $('#top').offsetHeight + 'px'); m.style.setProperty('--comph', $('#compose').offsetHeight + 'px');
    if (stick) l.scrollTop = l.scrollHeight;
  };
  if (window.ResizeObserver) { var ro = new ResizeObserver(layoutVars); ro.observe($('#top')); ro.observe($('#compose')); } else addEventListener('resize', layoutVars);
  layoutVars();
`;
