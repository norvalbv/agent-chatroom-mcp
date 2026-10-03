export const ROOMS_CSS = `
  .run > .rh.pin-group { width:100%; border:0; background:transparent; text-align:left; color:var(--dim) }
  .room-pin[aria-pressed="true"] { background:var(--acc-bg); color:var(--acc-fg) }
  .room-pin:focus-visible, .pin-group:focus-visible { outline:2px solid var(--acc); outline-offset:2px }
`;

export const ROOMS_STATE = `
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
  var pinnedRooms = store.get('pins.room', []);
  pinnedRooms = Array.isArray(pinnedRooms) ? pinnedRooms.filter(function (name) { return typeof name === 'string'; }) : [];
  var isRoomPinned = function (name) { return pinnedRooms.indexOf(name) >= 0; };
`;

export const ROOMS_JS = `
  // ---------- rooms rail ----------
  function renderRooms() {
    var keepPinGroupFocus = document.activeElement && document.activeElement.classList.contains('pin-group');
    var q = ($('#filter').value || '').toLowerCase();
    var live = rooms.filter(function (r) { return r.state === 'open' || r.state === 'stalled'; }).length;
    var shown = 0;
    var groups = {}, order = [];
    rooms.slice().sort(roomCmp).forEach(function (r) {
      if (stOff[stKey(r)]) return;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && (r.topic || '').toLowerCase().indexOf(q) < 0) return;
      shown++;
      var g = isRoomPinned(r.name) ? '!pinned' : runOf(r.name) || 'other';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(r);
    });
    // a run with a live room floats up; within a run the main/leads room first
    order.sort(function (a, b) {
      if (a === '!pinned' || b === '!pinned') return a === b ? 0 : a === '!pinned' ? -1 : 1;
      var la = groups[a].some(function (r) { return r.state === 'open' || r.state === 'stalled'; }), lb = groups[b].some(function (r) { return r.state === 'open' || r.state === 'stalled'; });
      if (la !== lb) return la ? -1 : 1; return roomCmp(groups[a][0], groups[b][0]);
    });
    $('#sub').className = 'sub'; $('#sub').textContent = live + ' live · ' + shown + ' of ' + rooms.length + ' rooms' + (showArch ? ' incl. archived' : '');
    var html = order.map(function (g) {
      var rs = groups[g].slice().sort(function (a, b) {
        if (g === '!pinned') return roomCmp(a, b);
        var ra = /-(room|leads)$/.test(a.name) ? 0 : 1, rb = /-(room|leads)$/.test(b.name) ? 0 : 1;
        return ra !== rb ? ra - rb : sortBy === 'newest' ? a.created_at.localeCompare(b.created_at) : roomCmp(a, b);
      });
      var liveN = rs.filter(function (r) { return r.state === 'open' || r.state === 'stalled'; }).length;
      var closed = openRuns[g] === false && (g === '!pinned' || !rs.some(function (r) { return r.name === sel; }));
      var items = rs.map(function (r) {
        var unread = Math.max(0, (r.latest_seq || 0) - (lastSeen[r.name] || 0));
        var short = g === 'other' || g === '!pinned' ? r.name : r.name.slice(g.length + 1);
        var meta = (r.state === 'open' || r.state === 'stalled') ? r.active_count + ' active · ' + r.message_count + ' msgs' : r.state + ' · ' + r.message_count + ' msgs';
        return '<button class="room' + (r.name === sel ? ' sel' : '') + '" data-r="' + esc(r.name) + '" title="' + esc(r.topic || r.name) + '">'
          + '<span class="dot ' + r.state + '"></span><span class="n">' + esc(short) + '</span>'
          + (typeof window.crRoomBadge === 'function' ? window.crRoomBadge(r) : '')
          + (unread && r.name !== sel ? '<span class="u' + (r.state === 'open' ? '' : ' q') + '">' + (unread > 99 ? '99+' : unread) + '</span>' : '')
          + '<span class="m">' + esc(meta) + '</span></button>';
      }).join('');
      var title = g === '!pinned' ? 'Pinned' : g === 'other' ? 'Other rooms' : g.replace(/^swarm-/, 'run ');
      var heading = g === '!pinned' ? '<button type="button" class="rh pin-group" aria-expanded="' + !closed + '" aria-controls="pinned-rooms">' : '<div class="rh">';
      return '<div class="run' + (closed ? ' closed' : '') + '" data-g="' + esc(g) + '">' + heading + '<span class="car" aria-hidden="true">▼</span><span class="n">' + esc(title) + '</span><span class="c">' + (liveN ? liveN + ' live' : rs.length) + '</span>' + (g === '!pinned' ? '</button>' : '</div>') + '<div class="rl"' + (g === '!pinned' ? ' id="pinned-rooms"' : '') + '>' + items + '</div></div>';
    }).join('');
    $('#rooms').innerHTML = html || '<div class="empty">No rooms yet.</div>';
    if (keepPinGroupFocus && $('.pin-group')) $('.pin-group').focus();
  }

  function roomPinButton(r) {
    return '<button type="button" class="btn room-pin" id="pinroom" aria-pressed="' + isRoomPinned(r.name) + '" title="Keep this room at the top of your room list in this browser"><span aria-hidden="true">' + (isRoomPinned(r.name) ? '★' : '☆') + '</span> Pin room</button>';
  }
  function bindRoomPin(r, restoreFocus) {
    var button = $('#pinroom');
    button.onclick = function () {
      if (isRoomPinned(r.name)) pinnedRooms = pinnedRooms.filter(function (name) { return name !== r.name; });
      else { pinnedRooms.push(r.name); openRuns['!pinned'] = true; store.set('openRuns', openRuns); }
      store.set('pins.room', pinnedRooms);
      renderRooms(); renderHead(r); $('#pinroom').focus();
    };
    if (restoreFocus) button.focus();
  }
  function select(name) {
    if (sel && seen) { lastSeen[sel] = seen; store.set('lastSeen', lastSeen); }
    sel = name; seen = 0; msgs = []; lastSender = null; unreadPill = 0; stats = null; expanded = {};
    catchupSelect(name);
    photoRoomChanged();
    $('#log').innerHTML = '<div class="empty">Loading…</div>'; $('#newpill').style.display = 'none';
    history.replaceState(null, '', '?room=' + encodeURIComponent(name));
    cur = rooms.filter(function (r) { return r.name === name; })[0] || null;
    if (cur) { renderHead(cur); renderPane(); }
    renderRooms(); poll();
    if (innerWidth <= 720) setView('chat');
  }
`;
