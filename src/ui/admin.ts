/**
 * The owner's admin from the dashboard (routes in src/launch/admin-routes.ts), after Grok Bot's new-chat and members
 * panels: a "New room" sheet that starts a run (the launcher with one flat room on this hub) and lists the runs started
 * from here with a Stop; an "Add a seat" sheet that recruits into the open room with the room's budgets shown; a hold on
 * the room's decision; the hub key; the recruit policy button (moved from src/ui.ts). A sheet keeps its draft when a
 * request fails and offers the same button again, so a refused launch loses nothing. Keys: n opens New room.
 *
 * Spliced into UI_HTML (src/ui.ts): ADMIN_CSS at the end of <style>, ADMIN_HTML after the palette, ADMIN_JS inside the
 * dashboard's IIFE, using its scope ($, $$, esc, store, hdrs, TOKEN, myName, sel, cur, rooms, select, refreshRooms, poll).
 * String.raw keeps backslashes as written; neither string may contain a backtick or a dollar-brace.
 */
export const ADMIN_CSS = String.raw`  /* ---------- admin sheets (new room, add a seat, hub key) ---------- */
  #adminpanel { position:fixed; inset:0; z-index:52; display:grid; place-items:start center; padding:6vh 16px 16px; background:rgb(0 0 0 / .32); -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px) }
  #adminpanel[hidden] { display:none }
  .adm { width:min(640px, 100%); padding:0 0 14px }
  .adm form { display:flex; flex-direction:column; gap:10px; padding:4px 20px 0 }
  .adm .fl { font-size:12px; color:var(--dim2); margin:2px 0 -6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .adm .fl b { color:var(--dim); font-weight:500 }
  .adm textarea { min-height:110px; max-height:40vh; resize:vertical; line-height:20px } .adm input, .adm select { height:38px; padding:0 12px; width:100% }
  .adm .two { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px } .adm .two > div { display:flex; flex-direction:column; justify-content:flex-end; gap:10px; min-width:0 }
  .adm .tg { display:flex; gap:10px; align-items:center; font-size:13.5px; cursor:pointer } .adm .tg input { width:16px; height:16px; margin:0; flex:none }
  .adm .note { font-size:12.5px; color:var(--dim2); line-height:18px; background:var(--panel); border-radius:12px; padding:8px 12px }
  .adm .note.warn { color:var(--warn); background:var(--warn-bg) }
  .adm .err { color:var(--bad); font-size:13px; white-space:pre-wrap } .adm .err:empty { display:none }
  .adm .ok { color:var(--ok); font-size:13px } .adm .ok:empty { display:none }
  .adm .foot { display:flex; gap:8px; justify-content:flex-end; align-items:center } .adm .foot .sp { flex:1 }
  .adm .runs { margin:14px 20px 0; border-top:1px solid var(--line); padding-top:10px; display:flex; flex-direction:column; gap:8px; max-height:30vh; overflow:auto }
  .adm .runs:empty { display:none } .adm .runs h3 { margin:0; font-size:12px; color:var(--dim2); font-weight:500 }
  .adm .run1 { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:4px 10px; align-items:center; font-size:13px }
  .adm .run1 .dot { width:8px; height:8px; border-radius:50%; background:var(--dim2) } .adm .run1 .dot.on { background:var(--ok); box-shadow:0 0 0 3px var(--ok-bg) }
  .adm .run1 .tx { overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .adm .run1 .tx b { font-family:var(--mono); font-size:12px; font-weight:500 }
  .adm .run1 .rr { grid-column:2 / -1; display:flex; gap:6px; flex-wrap:wrap }
  @media (max-width:720px) { #adminpanel { padding:0 } .adm { width:100%; height:100%; max-height:100%; border-radius:0; overflow:auto } .adm .two { grid-template-columns:1fr } }
`;

export const ADMIN_HTML = String.raw`<div id="adminpanel" hidden><div class="qsheet adm" role="dialog" aria-modal="true" aria-labelledby="admtitle" tabindex="-1"></div></div>`;

export const ADMIN_JS = String.raw`
  /*admin:start*/
  // Owner admin (src/launch/admin-routes.ts). Starting a run or a seat needs the hub key even on loopback; a 401 opens
  // the key sheet and the request is retried once the key is saved.
  var admSheet = null, admRetry = null, admRunsTimer = null, admWatch = null;
  var admSel = function (s) { return $('#adminpanel ' + s); };
  function admClose() { $('#adminpanel').hidden = true; admSheet = null; admRetry = null; clearInterval(admRunsTimer); admRunsTimer = null; }
  function admShow(kind, html) {
    admSheet = kind; var p = $('#adminpanel'); p.querySelector('.adm').innerHTML = html; p.hidden = false;
    var f = p.querySelector('textarea, input:not([type=checkbox])'); if (f) f.focus();
  }
  var admHead = function (title, sub) { return '<div class="qhead"><h2 id="admtitle">' + esc(title) + '</h2>' + (sub ? '<span class="c">' + esc(sub) + '</span>' : '') + '<span class="sp"></span><button class="btn icon ghost" data-admclose="1" title="Close (Esc)" aria-label="Close"><span class="i i-x"></span></button></div>'; };
  var admOpts = function (list, pick, first) { return (first ? '<option value="">' + esc(first) + '</option>' : '') + list.map(function (m) { return '<option' + (m === pick ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join(''); };
  async function admPost(path, body, retry) {
    var res = await fetch(path, { method: 'POST', headers: hdrs(), body: JSON.stringify(body) });
    if (res.status === 401) { admRetry = retry; admKeySheet('This needs the hub key: the CHATROOM_HUMAN_TOKEN the hub was started with.'); return null; }
    return res;
  }
  function admKeySheet(why) {
    var back = admRetry;
    admShow('key', admHead('Hub key') + '<form id="admkey"><div class="note">' + esc(why || 'Starting rooms, adding seats and the recruit policy need the CHATROOM_HUMAN_TOKEN this hub was started with, even on this machine. It stays in this browser.') + '</div>'
      + '<input id="admtok" aria-label="Hub key" type="password" autocomplete="off" placeholder="hub key" value="' + esc(TOKEN || '') + '" />'
      + '<div class="foot"><button type="button" class="btn ghost" id="admtokclear">Forget key</button><span class="sp"></span><button type="submit" class="btn primary">' + (back ? 'Save and retry' : 'Save') + '</button></div></form>');
    admRetry = back;
    $('#admtokclear').onclick = function () { TOKEN = null; store.set('token', null); admClose(); };
    $('#admkey').onsubmit = function (e) { e.preventDefault(); TOKEN = $('#admtok').value.trim() || null; store.set('token', TOKEN); var r = admRetry; admClose(); if (r) r(); };
  }

  // ---------- New room: the launcher with one flat room on this hub ----------
  async function admNewRoom() {
    var meta = { runs: [], models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], default_cwd: '', max_agents: 12 };
    try { meta = await (await fetch('/runs')).json(); } catch (e) {}
    var d = store.get('runDraft', {});
    admShow('run', admHead('New room', 'one flat room, its seats and a verifier') + '<form id="admrun">'
      + '<textarea id="admtask" aria-label="Brief" placeholder="What should the room do, and what does done look like?">' + esc(d.task || '') + '</textarea>'
      + '<div class="fl"><b>Project folder</b> (seats work here; with editing on, each in its own worktree)</div><input id="admcwd" aria-label="Project folder" placeholder="' + esc(meta.default_cwd) + '" value="' + esc(d.cwd || '') + '" />'
      + '<div class="two"><div><div class="fl"><b>Seats</b> (one is the verifier)</div><input id="admagents" aria-label="Seats" type="number" min="2" max="' + meta.max_agents + '" value="' + esc(d.agents || 4) + '" /></div>'
      + '<div><div class="fl"><b>Minutes</b> before every seat is stopped</div><input id="admmin" aria-label="Minutes" type="number" min="5" max="720" value="' + esc(d.timeout_min || 120) + '" /></div></div>'
      + '<div class="two"><div><div class="fl"><b>Seat model</b></div><select id="admmodel" aria-label="Seat model">' + admOpts(meta.models, d.model || meta.models[0]) + '</select></div>'
      + '<div><div class="fl"><b>Verifier model</b></div><select id="admver" aria-label="Verifier model">' + admOpts(meta.models, d.verifier_model || d.model || meta.models[0]) + '</select></div></div>'
      + '<label class="tg"><input type="checkbox" id="admfull"' + (d.full_access ? ' checked' : '') + ' /> Seats can edit code (each on its own branch)</label>'
      + '<label class="tg"><input type="checkbox" id="admverify"' + (d.require_verification ? ' checked' : '') + ' /> A proposal passes only with a verify/* entry from someone else</label>'
      + '<div class="note" id="admcost"></div><div class="err" id="admerr"></div><div class="ok" id="admok"></div>'
      + '<div class="foot"><span class="sp"></span><button type="button" class="btn ghost" data-admclose="1">Cancel</button><button type="submit" class="btn primary" id="admgo">Start room</button></div></form>'
      + '<div class="runs" id="admruns"></div>');
    var read = function () { return { name: myName(), task: $('#admtask').value, cwd: $('#admcwd').value.trim(), agents: Number($('#admagents').value), timeout_min: Number($('#admmin').value), model: $('#admmodel').value, verifier_model: $('#admver').value, full_access: $('#admfull').checked, require_verification: $('#admverify').checked }; };
    var cost = function () { var b = read(); $('#admcost').textContent = b.agents + ' seats for up to ' + b.timeout_min + ' min. Every seat re-reads its whole context on each turn, so cost grows with seats × minutes; ' + (b.full_access ? 'with editing on, each worker gets a worktree under the project.' : 'read-only: seats investigate and report.'); };
    $('#admrun').oninput = function () { store.set('runDraft', read()); cost(); };
    cost(); admRuns(meta.runs);
    admRunsTimer = setInterval(async function () { try { var m = await (await fetch('/runs')).json(); admRuns(m.runs); } catch (e) {} }, 3000);
    $('#admrun').onsubmit = async function (e) {
      e.preventDefault(); var go = $('#admgo'); go.disabled = true; $('#admerr').textContent = ''; $('#admok').textContent = '';
      var start = function () { admNewRoom().then(function () { $('#admrun').requestSubmit(); }); };
      try {
        var res = await admPost('/runs', read(), start); if (!res) return;
        if (!res.ok) { $('#admerr').textContent = await res.text(); go.textContent = 'Retry'; return; } // the draft stays
        var run = await res.json(); store.set('runDraft', {}); $('#admtask').value = ''; // a second click needs a new brief: never the same run twice
        $('#admok').textContent = 'Started' + (run.run_id ? ' ' + run.run_id : '') + '. Its room opens here when the launcher creates it.';
        admWatch = run.id; go.textContent = 'Start another';
      } catch (err) { $('#admerr').textContent = 'The hub did not answer: ' + err; go.textContent = 'Retry'; }
      finally { go.disabled = false; }
    };
  }
  function admRuns(list) {
    var box = $('#admruns'); if (!box) return;
    box.innerHTML = list && list.length ? '<h3>Started from this dashboard</h3>' + list.slice(0, 8).map(function (r) {
      return '<div class="run1"><span class="dot' + (r.running ? ' on' : '') + '" title="' + (r.running ? 'running' : 'not running') + '"></span><span class="tx" title="' + esc(r.task) + '"><b>' + esc(r.run_id || r.id) + '</b> ' + esc(r.task) + '</span>'
        + (r.running ? '<button class="mini warn" data-admstop="' + esc(r.id) + '" title="Stop the launcher: its seats are stopped and the room is told why">Stop</button>' : '<span class="c" style="font-size:12px;color:var(--dim2)">' + (r.stopped_at ? 'stopped' : 'ended') + '</span>')
        + (r.rooms.length ? '<div class="rr">' + r.rooms.map(function (x) { return '<button class="chip" data-admroom="' + esc(x.name) + '">' + esc(x.name.slice((r.run_id || '').length + 1) || x.name) + ' · ' + esc(x.state) + '</button>'; }).join('') + '</div>' : '') + '</div>';
    }).join('') : '';
    // the run just started: open its room the moment the launcher has created it
    var w = admWatch && (list || []).filter(function (r) { return r.id === admWatch; })[0];
    if (w && w.rooms.length) { admWatch = null; admClose(); select(w.rooms[0].name); refreshRooms(); }
  }

  // ---------- Add a seat: request_agent's spawn with the owner as requester ----------
  async function admRecruit(r) {
    if (!r) return;
    var st = {}; try { st = await (await fetch('/rooms/' + encodeURIComponent(r.name) + '/recruitment')).json(); } catch (e) {}
    var b = st.budgets || {}, pol = st.policy || {};
    var used = function (x) { return x ? x.used + '/' + (x.limit === null ? '∞' : x.limit) : '?'; };
    var d = store.get('seatDraft', {});
    admShow('seat', admHead('Add a seat', r.name) + '<form id="admseat">'
      + (st.enabled === false ? '<div class="note warn">Recruiting is off on this hub (CHATROOM_NO_RECRUIT=1).</div>' : st.held ? '<div class="note warn">This room is on hold: the hub refuses recruits until the hold is released.</div>' : '')
      + '<textarea id="admbrief" aria-label="Brief for the new seat" placeholder="What should the new seat do? It gets the room’s topic, board and recent messages; say what done looks like.">' + esc(d.brief || '') + '</textarea>'
      + '<div class="two"><div><div class="fl"><b>Model</b></div><select id="admsmodel" aria-label="Model">' + admOpts(st.models || [], d.model || '', pol.agent ? 'hub pin: ' + pol.agent + (pol.model ? ' · ' + pol.model : '') : 'as the hub decides') + '</select></div>'
      + '<div><div class="fl"><b>How many</b></div><input id="admcount" aria-label="How many" type="number" min="1" max="3" value="' + esc(d.count || 1) + '" /></div></div>'
      + '<div class="two"><div><div class="fl"><b>Seat name</b> (optional)</div><input id="admsname" aria-label="Seat name" placeholder="claude-recruit-N" /></div><div><div class="fl"><b>Area</b> (optional: claims claim/&lt;area&gt; first)</div><input id="admarea" aria-label="Area" /></div></div>'
      + '<label class="tg"><input type="checkbox" id="admsedit"' + (d.can_edit ? ' checked' : '') + ' /> Can edit code (its own worktree and branch)</label>'
      + '<div class="note">Recruits here: ' + used(b.room_total_recruits) + ' · live in the room: ' + used(b.room_live_recruits) + ' · live on this machine: ' + used(b.machine_live) + '</div>'
      + '<div class="err" id="admserr"></div><div class="foot"><span class="sp"></span><button type="button" class="btn ghost" data-admclose="1">Cancel</button><button type="submit" class="btn primary" id="admsgo">Add seat</button></div></form>');
    var read = function () { return { name: myName(), brief: $('#admbrief').value, model: $('#admsmodel').value, count: Number($('#admcount').value), seat_name: $('#admsname').value.trim(), area: $('#admarea').value.trim(), can_edit: $('#admsedit').checked }; };
    $('#admseat').oninput = function () { var x = read(); store.set('seatDraft', { brief: x.brief, model: x.model, count: x.count, can_edit: x.can_edit }); };
    $('#admseat').onsubmit = async function (e) {
      e.preventDefault(); var go = $('#admsgo'); go.disabled = true; $('#admserr').textContent = '';
      try {
        var res = await admPost('/rooms/' + encodeURIComponent(r.name) + '/recruit', read(), function () { admRecruit(r).then(function () { $('#admseat').requestSubmit(); }); }); if (!res) return;
        if (!res.ok) { $('#admserr').textContent = await res.text(); go.textContent = 'Retry'; return; }
        var out = await res.json(); store.set('seatDraft', {}); admClose();
        $('#hint').textContent = 'Starting ' + out.spawned.join(', ') + ' (' + out.agent + (out.model ? ' · ' + out.model : '') + '). They join within a minute or two.';
        refreshRooms(); poll();
      } catch (err) { $('#admserr').textContent = 'The hub did not answer: ' + err; go.textContent = 'Retry'; }
      finally { go.disabled = false; }
    };
  }

  // ---------- Hold the decision: hold/<room> written as you; agents keep working but nothing concludes ----------
  async function admHold(r) {
    if (!r) return;
    var reason = r.hold ? '' : window.prompt('Hold ' + r.name + '? Agents keep working but nothing concludes until you release it. Why (optional):', '');
    if (reason === null) return;
    var res = await admPost('/rooms/' + encodeURIComponent(r.name) + '/hold', { name: myName(), hold: !r.hold, reason: reason }, function () { admHold(r); });
    if (res && !res.ok) window.alert(await res.text());
    refreshRooms();
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-admclose]') || e.target.id === 'adminpanel') { admClose(); return; }
    var st = e.target.closest('[data-admstop]'); if (st) { if (window.confirm('Stop this run? Its launcher stops every seat and tells the room why.')) admPost('/runs/' + encodeURIComponent(st.dataset.admstop) + '/stop', {}, null).then(function () { if (admSheet === 'run') fetch('/runs').then(function (x) { return x.json(); }).then(function (m) { admRuns(m.runs); }); }); return; }
    var go = e.target.closest('[data-admroom]'); if (go) { admClose(); select(go.dataset.admroom); return; }
    if (e.target.closest('#admnew')) { admNewRoom(); return; }
    if (e.target.closest('[data-addseat]') || e.target.closest('#addseat')) { admRecruit(cur); return; }
    if (e.target.closest('#holdroom')) { admHold(cur); return; }
    if (e.target.closest('#hubkey')) { admRetry = null; admKeySheet(); return; }
  });
  document.addEventListener('keydown', function (e) {
    if (!$('#adminpanel').hidden && e.key === 'Escape') { e.preventDefault(); admClose(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input,textarea,select') || !$('#adminpanel').hidden) return;
    if (e.key === 'n') { e.preventDefault(); admNewRoom(); }
  });
  window.crPalette.add({ group: 'admin', label: 'New room…', hint: 'n', run: function () { admNewRoom(); } });
  window.crPalette.add(function () { return cur && cur.state === 'open' ? [{ group: 'admin', label: 'Add a seat to ' + cur.name + '…', run: function () { admRecruit(cur); } }, { group: 'admin', label: (cur.hold ? 'Release the hold on ' : 'Hold the decision in ') + cur.name, run: function () { admHold(cur); } }] : []; });
  window.crPalette.add({ group: 'admin', label: 'Hub key…', hint: 'for starting rooms and seats', run: function () { admRetry = null; admKeySheet(); } });

  // recruit policy: pinned provider/model for every request_agent, live on the hub
  async function loadPolicy() {
    try { var p = (await (await fetch('/policy')).json()).recruits || {}; $('#policy').innerHTML = 'recruits: <b>' + esc(p.agent ? p.agent + (p.model ? ' · ' + p.model : '') : 'as requested') + '</b>'; } catch (e) {}
  }
  $('#policy').onclick = async function setPolicy() {
    var v = window.prompt('Pin every recruit to a provider and model (e.g. "claude claude-sonnet-5-5"), or "any" to let agents choose:', 'claude claude-sonnet-5-5');
    if (v === null) return;
    var parts = v.trim().split(/\s+/);
    var res = await admPost('/policy', parts[0] === 'any' ? { agent: 'any', model: 'any' } : { agent: parts[0], model: parts[1] || 'any' }, setPolicy);
    if (res && !res.ok) window.alert(await res.text());
    loadPolicy();
  };
  loadPolicy(); setInterval(loadPolicy, 15000);
  /*admin:end*/
`;
