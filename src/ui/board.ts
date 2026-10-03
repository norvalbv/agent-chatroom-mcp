export const BOARD_CSS = `
  .btools { display:flex; gap:8px; align-items:center; margin-bottom:10px; flex-wrap:wrap } .btools label { color:var(--dim); font-size:12px } .btools select { flex:1; min-width:0; min-height:44px; border:1px solid var(--control,var(--line)); border-radius:8px; color:var(--fg); background:var(--panel2); padding:7px }
  .bentry button.bh { width:100%; min-height:44px; border:0; border-radius:9px; background:transparent; text-align:left; flex-wrap:wrap } .bentry button.bh:focus-visible { outline:2px solid var(--acc); outline-offset:2px } .bentry .bh .m { flex-basis:100%; text-align:left }
`;

export const BOARD_JS = `
  var boardQuery = '', boardCategory = '';
  function boardCaptureFocus(pane) {
    var active = document.activeElement;
    return tab === 'board' && pane.contains(active) && active.matches('#bsearch,#bcategory,[data-b]')
      ? { id: active.id, key: active.dataset.b, start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
  }
  function boardBindControls(focus) {
    var search = $('#bsearch'), category = $('#bcategory');
    if (search) { search.value = boardQuery; search.oninput = function () { boardQuery = search.value; renderPane(); }; }
    if (category) {
      category.onchange = function () { boardCategory = category.value; renderPane(true); };
      category.onblur = function () { setTimeout(function () { if (tab === 'board') renderPane(); }, 0); };
      category.onkeydown = function (e) { e.stopPropagation(); };
    }
    if (!focus) return;
    var target = focus.key ? $$('[data-b]', $('#pane')).find(function (el) { return el.dataset.b === focus.key; }) : $('#' + focus.id);
    target = target || search;
    if (target) {
      target.focus({ preventScroll: true });
      if (target === search && focus.start != null) target.setSelectionRange(focus.start, focus.end, focus.direction);
    }
  }
  function paneBoard(r) {
    var labels = { hold: 'Holds', inbox: 'Inbox', claim: 'Claims', verify: 'Verification', review: 'Reviews', evidence: 'Evidence', draft: 'Drafts', handoff: 'Handoffs', idea: 'Ideas', note: 'Notes' };
    var pre = function (k) { var prefix = k.split('/')[0]; return k.indexOf('/') > 0 && Object.prototype.hasOwnProperty.call(labels, prefix) ? prefix : 'note'; };
    var all = Object.keys(r.board || {}), counts = {};
    all.forEach(function (k) { var g = pre(k); counts[g] = (counts[g] || 0) + 1; });
    var keys = all.filter(function (k) { return (!boardCategory || pre(k) === boardCategory) && (!boardQuery || (k + ' ' + (r.board[k].text || '')).toLowerCase().indexOf(boardQuery.toLowerCase()) >= 0); });
    var groups = {}; keys.forEach(function (k) { var g = pre(k); (groups[g] = groups[g] || []).push(k); });
    var order = Object.keys(labels).filter(function (g) { return groups[g]; });
    var h = '<input id="bsearch" class="bsearch" aria-label="Search board entries" placeholder="Search the board" /><div class="btools"><label for="bcategory">Category</label><select id="bcategory"><option value="">All entries (' + all.length + ')</option>' + Object.keys(labels).filter(function (g) { return counts[g] || g === boardCategory; }).map(function (g) { return '<option value="' + g + '"' + (boardCategory === g ? ' selected' : '') + '>' + labels[g] + ' (' + (counts[g] || 0) + ')</option>'; }).join('') + '</select></div>';
    if (!keys.length) h += '<div class="empty" style="padding:24px 8px">' + (boardQuery || boardCategory ? 'No entry matches.' : 'The board is empty.') + '</div>';
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
        return '<div class="bentry ' + g + (open ? ' open' : '') + '"><button type="button" class="bh" aria-expanded="' + open + '" data-b="' + esc(k) + '"><span class="pre">' + g + '</span><span class="k" title="' + esc(k) + '">' + esc(g === 'note' ? k : k.slice(g.length + 1)) + '</span><span class="m">' + esc(e.by) + ' · ' + rel(e.updated_at) + ' · ' + e.chars + 'c</span></button>'
          + '<div class="bb">' + (summary ? '<div style="color:var(--dim);margin-bottom:6px">' + esc(summary) + '</div>' : '') + withMentions(esc(e.text || '')) + '</div></div>';
      }).join('') + '</div>';
    });
    return h;
  }
`;
