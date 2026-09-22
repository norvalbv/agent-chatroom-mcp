/**
 * Single-file live dashboard served at /ui. No build step: it polls the JSON endpoints
 * (/rooms, /rooms/:room/messages, /rooms/:room/stats) and posts as a human through
 * /rooms/:room/messages, /rooms/:room/vote and /rooms/:room/close.
 *
 * Built for one reader: a human watching up to a dozen agents across a run's rooms. Three
 * panes on a desktop (rooms, transcript, inspector), a bottom tab bar on a phone. Every
 * message kind the hub produces has its own rendering, and the inspector shows the
 * decision as the hub sees it: version, tally, who it waits on, what blocks it.
 */
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Agent Chatroom</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg:#f3f3f1; --panel:#ffffff; --panel2:#f7f7f5; --line:#e4e3df; --line2:#efeeea; --fg:#18191b; --dim:#66696f; --dim2:#9a9ea5;
    --acc:#0f766e; --acc-bg:#e6f4f2; --acc-fg:#0b5d57;
    --prop:#4f46e5; --prop-bg:#eeedfc; --chal:#b45309; --chal-bg:#fdf1e3; --ok:#15803d; --ok-bg:#e7f5ea; --bad:#b91c1c; --bad-bg:#fbe9e9; --hum:#be185d; --hum-bg:#fce7f1; --warn:#a16207; --warn-bg:#fdf6dc;
    --shadow:0 1px 2px rgba(20,20,20,.05), 0 0 0 1px rgba(20,20,20,.03);
    --radius:12px;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#0f1113; --panel:#16181b; --panel2:#1c1f23; --line:#272b31; --line2:#20242a; --fg:#e7e8ea; --dim:#9aa0a8; --dim2:#6a7079;
    --acc:#2dd4bf; --acc-bg:#0f2a27; --acc-fg:#7ee8dc;
    --prop:#a5b4fc; --prop-bg:#1e1f3a; --chal:#fbbf24; --chal-bg:#2e2410; --ok:#4ade80; --ok-bg:#122a1a; --bad:#f87171; --bad-bg:#331a1a; --hum:#f472b6; --hum-bg:#33182a; --warn:#fcd34d; --warn-bg:#2e2710;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.03);
  } }
  :root[data-theme="dark"] {
    --bg:#0f1113; --panel:#16181b; --panel2:#1c1f23; --line:#272b31; --line2:#20242a; --fg:#e7e8ea; --dim:#9aa0a8; --dim2:#6a7079;
    --acc:#2dd4bf; --acc-bg:#0f2a27; --acc-fg:#7ee8dc;
    --prop:#a5b4fc; --prop-bg:#1e1f3a; --chal:#fbbf24; --chal-bg:#2e2410; --ok:#4ade80; --ok-bg:#122a1a; --bad:#f87171; --bad-bg:#331a1a; --hum:#f472b6; --hum-bg:#33182a; --warn:#fcd34d; --warn-bg:#2e2710;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.03);
  }
  * { box-sizing:border-box }
  html,body { height:100%; margin:0; overflow:hidden }
  body { background:var(--bg); color:var(--fg); font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif; display:grid; grid-template-columns:280px minmax(0,1fr) 380px; grid-template-rows:100%; overflow:hidden; -webkit-font-smoothing:antialiased }
  body.noinspect { grid-template-columns:280px minmax(0,1fr) 0 }
  body.noinspect #inspect { display:none }
  .mono { font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px }
  button { font:inherit; cursor:pointer; color:inherit }
  a { color:var(--acc-fg); text-decoration:none } a:hover { text-decoration:underline }
  input,textarea { font:inherit; color:var(--fg); background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:8px 11px }
  input:focus,textarea:focus { outline:2px solid color-mix(in srgb, var(--acc) 35%, transparent); border-color:var(--acc) }
  ::-webkit-scrollbar { width:10px; height:10px } ::-webkit-scrollbar-thumb { background:var(--line); border-radius:8px; border:3px solid var(--panel) }
  .btn { border:1px solid var(--line); background:var(--panel); border-radius:9px; padding:6px 11px; font-size:12.5px; font-weight:500; display:inline-flex; align-items:center; gap:6px; white-space:nowrap }
  .btn:hover { background:var(--panel2) } .btn.primary { background:var(--acc); border-color:var(--acc); color:#fff } .btn.primary:hover { filter:brightness(1.08) }
  .btn.danger { color:var(--bad) } .btn:disabled { opacity:.45; cursor:default }
  .icon { width:32px; height:32px; padding:0; justify-content:center; border-radius:9px }
  .chip { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; padding:2px 8px; border-radius:999px; background:var(--panel2); color:var(--dim); white-space:nowrap; line-height:1.6 }
  .chip.open { background:var(--ok-bg); color:var(--ok) } .chip.concluded { background:var(--acc-bg); color:var(--acc-fg) } .chip.stalled { background:var(--warn-bg); color:var(--warn) } .chip.closed { background:var(--panel2); color:var(--dim2) }
  .chip.prop { background:var(--prop-bg); color:var(--prop) } .chip.chal { background:var(--chal-bg); color:var(--chal) } .chip.hum { background:var(--hum-bg); color:var(--hum) } .chip.bad { background:var(--bad-bg); color:var(--bad) } .chip.ok { background:var(--ok-bg); color:var(--ok) }
  .tag { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:1px 6px; border-radius:5px; background:var(--panel2); color:var(--dim) }
  .tag.verifier { background:var(--acc-bg); color:var(--acc-fg) } .tag.chair { background:var(--hum-bg); color:var(--hum) } .tag.lead { background:var(--prop-bg); color:var(--prop) } .tag.recruit { background:var(--warn-bg); color:var(--warn) } .tag.human { background:var(--hum-bg); color:var(--hum) }
  .av { width:28px; height:28px; border-radius:8px; display:grid; place-items:center; font-size:11px; font-weight:700; color:#fff; flex:none; letter-spacing:.02em }
  .dot { width:8px; height:8px; border-radius:50%; flex:none; background:var(--dim2) }
  .dot.open { background:var(--ok); box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent) } .dot.stalled { background:var(--warn) } .dot.concluded { background:var(--acc) }
  .empty { color:var(--dim2); text-align:center; padding:48px 24px; font-size:13px }
  .clamp { max-height:10.5em; overflow:hidden; position:relative }
  .clamp::after { content:""; position:absolute; inset:auto 0 0 0; height:3em; background:linear-gradient(transparent, var(--clampbg, var(--panel))) }
  .more { background:none; border:0; color:var(--acc-fg); font-size:12px; font-weight:500; padding:4px 0 0 }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:12.5px } .kv b { color:var(--dim); font-weight:500 }

  /* ---------- rooms rail ---------- */
  #rail { background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; min-height:0; min-width:0 }
  .brand { padding:14px 14px 10px; display:flex; align-items:center; gap:10px }
  .brand .mark { width:30px; height:30px; border-radius:9px; background:var(--acc); color:#fff; display:grid; place-items:center; font-weight:700; font-size:14px }
  .brand h1 { font-size:14px; font-weight:700; margin:0; letter-spacing:-.01em; line-height:1.2 }
  .brand .sub { color:var(--dim); font-size:12px } .brand .sub.bad { color:var(--bad) }
  .brand .sp { flex:1 }
  .person { cursor:pointer } .person.sel { background:var(--panel2) } .act { grid-column:1 / -1; font-size:11.5px; font-family:ui-monospace,Menlo,monospace; padding:6px 10px 10px 46px; color:var(--dim); max-height:260px; overflow:auto; white-space:pre-wrap; word-break:break-word } .act .st { color:var(--dim2) } .act .tl { color:var(--fg); font-weight:600 }
  .rctl { display:flex; flex-wrap:wrap; gap:4px 5px; padding:0 12px 10px; align-items:center } .rctl select, .lf select, .lf input { font-size:12px; padding:4px 6px; background:var(--panel2); color:inherit; border:1px solid var(--panel2); border-radius:6px } .lf { display:flex; flex-wrap:wrap; gap:6px; padding:6px 16px; align-items:center; background:var(--panel); border-bottom:1px solid var(--line) } .lf input { flex:1 1 140px } .chip.tog { cursor:pointer; opacity:.45; border:0 } .chip.tog.on { opacity:1 } .rctl .btn { margin-left:auto }
  .filter { padding:0 12px 10px } .filter input { width:100%; font-size:13px; padding:7px 10px; background:var(--panel2) }
  .policy { margin:0 12px 6px; font-size:11.5px; color:var(--dim); background:var(--acc-bg); border-radius:8px; padding:4px 9px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .policy b { color:var(--acc-fg); font-weight:600 }
  #rooms { overflow:auto; flex:1; padding:0 8px 24px }
  .run { margin-top:10px }
  .run > .rh { display:flex; align-items:center; gap:8px; padding:6px 8px 4px; font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--dim2); cursor:pointer; user-select:none }
  .run > .rh .n { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .run > .rh .c { font-weight:500; letter-spacing:0; text-transform:none }
  .run > .rh .car { transition:transform .15s; font-size:9px } .run.closed > .rh .car { transform:rotate(-90deg) } .run.closed > .rl { display:none }
  .room { display:grid; grid-template-columns:auto minmax(0,1fr) auto; grid-template-rows:auto auto; column-gap:9px; align-items:center; width:100%; text-align:left; padding:7px 9px; border:0; border-radius:10px; background:transparent; margin:1px 0 }
  .room .dot { grid-column:1; grid-row:1 }
  .room:hover { background:var(--panel2) } .room.sel { background:var(--acc-bg) } .room.sel .n { color:var(--acc-fg) }
  .room .n { grid-column:2; grid-row:1; font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .room .m { grid-column:2; grid-row:2; color:var(--dim); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .room .u { grid-column:3; grid-row:1 / span 2; background:var(--acc); color:#fff; font-size:10.5px; font-weight:700; border-radius:999px; padding:1px 7px; min-width:20px; text-align:center }
  .room .u.q { background:var(--panel2); color:var(--dim2) }

  /* ---------- transcript ---------- */
  #main { display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:auto auto minmax(0,1fr) auto; min-height:0; min-width:0; background:var(--bg); position:relative }
  #main > * { min-width:0 } .lf > * { min-width:0 } .lf select { max-width:45% }
  #head { background:var(--panel); border-bottom:1px solid var(--line); padding:10px 16px; display:grid; grid-template-columns:minmax(0,1fr) auto; row-gap:4px; align-items:center }
  #head .t1 { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap }
  #head h2 { margin:0; font-size:15px; font-weight:700; letter-spacing:-.01em; white-space:nowrap }
  #head .acts { display:flex; gap:6px; align-items:center }
  #head .topic { grid-column:1 / -1; color:var(--dim); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer }
  #head .topic.open { white-space:pre-wrap; max-height:40vh; overflow:auto }
  #log { overflow:auto; padding:12px 18px 12px; scroll-behavior:auto }
  .day { display:flex; align-items:center; gap:12px; color:var(--dim2); font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; margin:10px 0 }
  .day::before,.day::after { content:""; flex:1; height:1px; background:var(--line) }
  .sys { display:flex; justify-content:center; padding:3px 0 }
  .sys span { font-size:12px; color:var(--dim); background:var(--panel2); border-radius:999px; padding:2px 10px; max-width:90%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .sys.notice span { color:var(--warn); background:var(--warn-bg); white-space:normal; text-align:center }
  .sys.concl span { color:var(--ok); background:var(--ok-bg); white-space:normal; text-align:center; font-weight:600 }
  .msg { display:grid; grid-template-columns:28px minmax(0,1fr); gap:10px; padding:6px 0 2px; scroll-margin-top:12px }
  .msg > div { min-width:0 }
  .msg.cont { padding-top:0 } .msg.cont .av { visibility:hidden } .msg.cont .who { display:none }
  .msg.hl { animation:hl 1.6s ease-out } @keyframes hl { from { background:var(--acc-bg) } to { background:transparent } }
  .who { display:flex; align-items:center; gap:7px; margin-bottom:3px; flex-wrap:wrap; min-height:20px }
  .who b { font-weight:600; font-size:13px } .who .t { color:var(--dim2); font-size:11px; font-variant-numeric:tabular-nums } .who .agent { color:var(--dim2); font-size:11px }
  .who .seq { color:var(--dim2); font-size:11px; font-family:"JetBrains Mono",monospace }
  .re { font-size:11.5px; color:var(--dim); margin-bottom:3px; display:block; width:fit-content; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; padding:1px 6px; border-radius:6px; background:var(--panel2) }
  .re:hover { color:var(--fg) } .re i { font-style:normal; color:var(--dim2) }
  .body { background:var(--panel); border-radius:var(--radius); padding:8px 12px; white-space:pre-wrap; word-break:break-word; box-shadow:var(--shadow); max-width:88ch; font-size:13.5px; --clampbg:var(--panel) }
  .body.human { background:var(--hum-bg); box-shadow:none; border:1px solid color-mix(in srgb, var(--hum) 30%, transparent); --clampbg:var(--hum-bg) }
  .body.opening { border-left:3px solid var(--dim2) }
  .mention { color:var(--acc-fg); font-weight:600 } .mention.me { background:var(--acc-bg); border-radius:4px; padding:0 3px }
  .card { background:var(--panel); border-radius:var(--radius); box-shadow:var(--shadow); max-width:88ch; overflow:hidden; --clampbg:var(--panel) }
  .card .ch { display:flex; align-items:center; gap:8px; padding:7px 12px; font-size:12px; font-weight:600; border-bottom:1px solid var(--line2) }
  .card .ch .sp { flex:1 } .card .ch .mono { font-weight:500; color:var(--dim) }
  .card .cb { padding:8px 12px; white-space:pre-wrap; word-break:break-word; font-size:13.5px }
  .card.proposal { border-left:3px solid var(--prop) } .card.proposal .ch { color:var(--prop) }
  .card.amend { border-left:3px solid var(--prop) } .card.amend .ch { color:var(--prop) } .card.amend .cb { color:var(--dim); font-size:13px }
  .card.challenge { border-left:3px solid var(--chal) } .card.challenge .ch { color:var(--chal) }
  .card.conclusion { border-left:3px solid var(--ok); background:var(--ok-bg); --clampbg:var(--ok-bg) } .card.conclusion .ch { color:var(--ok); border-color:color-mix(in srgb, var(--ok) 20%, transparent) }
  .row { display:flex; align-items:baseline; gap:8px; font-size:12.5px; color:var(--dim); padding:2px 0; flex-wrap:wrap; max-width:88ch }
  .row .v { font-weight:700 } .row .v.agree { color:var(--ok) } .row .v.disagree { color:var(--bad) } .row .v.abstain { color:var(--dim) }
  .row q { color:var(--fg); font-style:italic } .row q::before,.row q::after { content:'"' }
  .row .k { font-family:"JetBrains Mono",monospace; font-size:11.5px; color:var(--fg) }
  .row .why { flex-basis:100%; color:var(--dim); font-size:12px; padding-left:4px }
  .qb { font-size:10.5px; font-weight:600; color:var(--dim); background:var(--panel2); border-radius:5px; padding:1px 6px }
  #newpill { position:absolute; left:50%; transform:translateX(-50%); bottom:96px; background:var(--acc); color:#fff; border:0; border-radius:999px; padding:6px 14px; font-size:12px; font-weight:600; box-shadow:0 4px 14px rgba(0,0,0,.2); display:none }
  #compose { background:var(--panel); border-top:1px solid var(--line); padding:10px 16px 12px; display:grid; grid-template-columns:120px minmax(0,1fr) auto; gap:8px; align-items:end }
  #compose .quick { grid-column:1 / -1; display:flex; gap:6px; flex-wrap:wrap; align-items:center; min-height:0 }
  #compose .quick button { border:1px solid var(--line); background:var(--panel2); border-radius:999px; padding:1px 9px; font-size:11.5px; color:var(--dim) }
  #compose .quick button:hover { color:var(--fg); border-color:var(--dim2) }
  #compose textarea { resize:none; min-height:38px; max-height:180px; line-height:1.4 }
  #compose .hint { grid-column:1 / -1; font-size:11.5px; color:var(--dim2) } #compose .hint.bad { color:var(--bad) }

  /* ---------- inspector ---------- */
  #inspect { background:var(--panel); border-left:1px solid var(--line); display:flex; flex-direction:column; min-height:0; min-width:0 }
  .tabs { display:flex; padding:10px 12px 0; gap:2px; border-bottom:1px solid var(--line) }
  .tabs button { border:0; background:transparent; padding:7px 10px 9px; font-size:12.5px; font-weight:600; color:var(--dim); border-bottom:2px solid transparent; margin-bottom:-1px; display:flex; gap:6px; align-items:center }
  .tabs button.on { color:var(--fg); border-color:var(--acc) } .tabs button .n { font-size:10.5px; background:var(--panel2); border-radius:999px; padding:0 6px; color:var(--dim) }
  #pane { overflow:auto; flex:1; padding:14px 14px 28px }
  .sec { margin-bottom:18px } .sec h3 { margin:0 0 8px; font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--dim2); display:flex; align-items:center; gap:8px } .sec h3 .sp { flex:1 } .sec h3 .c { font-weight:500; letter-spacing:0; text-transform:none }
  .pcard { border:1px solid var(--line); border-radius:var(--radius); background:var(--panel2); padding:11px 12px; --clampbg:var(--panel2) }
  .pcard.concl { border-color:color-mix(in srgb, var(--ok) 35%, transparent); background:var(--ok-bg); --clampbg:var(--ok-bg) }
  .pcard .meta { display:flex; gap:6px; flex-wrap:wrap; align-items:center; font-size:12px; color:var(--dim); margin-bottom:8px }
  .pcard .txt { white-space:pre-wrap; word-break:break-word; font-size:13px }
  .tally { margin-top:10px } .tally .bar { display:flex; height:8px; border-radius:999px; overflow:hidden; background:var(--line) }
  .tally .bar i { display:block; height:100% } .tally .bar .a { background:var(--ok) } .tally .bar .d { background:var(--bad) } .tally .bar .ab { background:var(--dim2) }
  .tally .leg { display:flex; gap:12px; font-size:11.5px; color:var(--dim); margin-top:5px; flex-wrap:wrap } .tally .leg b { color:var(--fg) }
  .blk { margin-top:10px; font-size:12.5px } .blk div { display:flex; gap:8px; padding:3px 0; align-items:baseline } .blk .chip { flex:none }
  .cl { border-left:2px solid var(--chal); padding:4px 0 4px 10px; margin-top:8px; font-size:12.5px } .cl .h { display:flex; gap:6px; align-items:center; margin-bottom:2px; font-weight:600 } .cl .o { color:var(--dim); white-space:pre-wrap }
  .vl { margin-top:8px; font-size:12.5px } .vl div { display:flex; gap:6px; align-items:baseline; padding:3px 0; flex-wrap:wrap } .vl .who { margin:0; font-weight:600; font-size:12.5px } .vl .r { flex-basis:100%; color:var(--dim); font-size:12px }
  .vote-row { display:flex; gap:8px; margin-top:12px }
  .vote-row .btn { flex:1; justify-content:center }
  .person { display:grid; grid-template-columns:28px minmax(0,1fr) auto; gap:9px; align-items:center; padding:6px 0; border-bottom:1px solid var(--line2) }
  .person:last-child { border:0 } .person.off { opacity:.5 }
  .person .n { font-weight:600; font-size:13px; display:flex; gap:6px; align-items:center; flex-wrap:wrap } .person .n .agent { font-weight:400; color:var(--dim2); font-size:11px }
  .person .a { color:var(--acc-fg); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .person .a:empty::before { content:"no claimed area"; color:var(--dim2) }
  .person .s { text-align:right; font-size:11px; color:var(--dim2); font-variant-numeric:tabular-nums; line-height:1.3 }
  .bsearch { width:100%; margin-bottom:10px; font-size:13px; padding:7px 10px; background:var(--panel2) }
  .bgroup { margin-bottom:14px }
  .bentry { border:1px solid var(--line); border-radius:10px; margin-bottom:6px; background:var(--panel2); --clampbg:var(--panel2) }
  .bentry .bh { display:flex; align-items:center; gap:8px; padding:7px 10px; cursor:pointer; font-size:12.5px } .bentry .bh .k { font-family:"JetBrains Mono",monospace; font-weight:600; font-size:12px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .bentry .bh .m { color:var(--dim2); font-size:11px; white-space:nowrap }
  .bentry .bb { display:none; padding:0 10px 9px; font-size:12.5px; white-space:pre-wrap; word-break:break-word; border-top:1px solid var(--line2); padding-top:8px }
  .bentry.open .bb { display:block }
  .bentry .bh .pre { font-size:10px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; padding:1px 5px; border-radius:4px; background:var(--panel); color:var(--dim) }
  .bentry.claim .pre { color:var(--acc-fg) } .bentry.verify .pre { color:var(--ok) } .bentry.hold .pre { color:var(--bad) } .bentry.inbox .pre { color:var(--warn) }
  .stat { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px }
  .stat div { background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:8px 10px } .stat b { display:block; font-size:18px; font-weight:700; letter-spacing:-.01em } .stat span { font-size:11px; color:var(--dim) }
  .hbar { display:grid; grid-template-columns:110px 1fr auto; gap:8px; align-items:center; font-size:12px; padding:3px 0 } .hbar i { display:block; height:8px; background:var(--acc); border-radius:4px; opacity:.8 } .hbar .l { color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .hbar .v { font-variant-numeric:tabular-nums; color:var(--dim) }
  table.t { width:100%; border-collapse:collapse; font-size:12px } table.t td { padding:4px 0; border-bottom:1px solid var(--line2); vertical-align:top } table.t td:last-child { text-align:right; font-variant-numeric:tabular-nums; color:var(--dim); white-space:nowrap } table.t td.r { color:var(--dim); font-size:11.5px }
  .toolbar { display:flex; gap:10px; font-size:12px; color:var(--dim); margin-top:12px; flex-wrap:wrap } .toolbar label { display:flex; align-items:center; gap:5px; cursor:pointer }

  /* ---------- phone ---------- */
  #tabbar { display:none }
  @media (max-width:1100px) {
    body,body.noinspect { grid-template-columns:260px minmax(0,1fr) 0 }
    #inspect { position:fixed; top:0; right:0; bottom:0; width:min(420px, 92vw); z-index:20; box-shadow:-8px 0 30px rgba(0,0,0,.25); transform:translateX(100%); transition:transform .18s ease-out; display:flex !important }
    body.inspect-open #inspect { transform:none }
  }
  @media (max-width:720px) {
    body,body.noinspect { grid-template-columns:100%; grid-template-rows:minmax(0,1fr) auto }
    #rail,#main { grid-row:1; grid-column:1; display:none } body[data-view="rooms"] #rail { display:flex } body[data-view="chat"] #main { display:grid }
    #inspect { position:static; width:auto; transform:none; box-shadow:none; display:none !important; grid-row:1; grid-column:1 } body[data-view="inspect"] #inspect { display:flex !important }
    #tabbar { display:grid; grid-template-columns:repeat(3,1fr); grid-row:2; border-top:1px solid var(--line); background:var(--panel); padding-bottom:env(safe-area-inset-bottom) }
    #tabbar button { border:0; background:transparent; padding:10px 0 9px; font-size:12px; font-weight:600; color:var(--dim); display:flex; flex-direction:column; align-items:center; gap:2px }
    #tabbar button.on { color:var(--acc-fg) } #tabbar button .n { font-size:10px; background:var(--acc); color:#fff; border-radius:999px; padding:0 6px }
    #compose { grid-template-columns:minmax(0,1fr) auto } #compose #name { display:none }
    .lf { padding:6px 12px } .lf input { flex:1 1 100% }
    #head { padding:8px 12px; display:flex; flex-wrap:wrap; gap:6px } #head .t1 { flex:1 1 100% } #head .acts { flex:1 1 100%; justify-content:flex-end } #head .topic { flex:1 1 100% } #log { padding:10px 12px } .body,.card,.row { max-width:100% }
    #tabbar { grid-column:1 }
    #newpill { bottom:130px }
    #head .acts .hidephone { display:none }
  }
</style>
</head>
<body data-view="chat">
<aside id="rail">
  <div class="brand"><div class="mark">✻</div><div><h1>Agent Chatroom</h1><div class="sub" id="sub">connecting…</div></div><div class="sp"></div><button class="btn icon" id="theme" title="Toggle theme">◐</button></div>
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
<nav id="tabbar">
  <button data-view="rooms">Rooms</button>
  <button data-view="chat" class="on">Chat <span class="n" id="n-unread" style="display:none"></span></button>
  <button data-view="inspect">Inspect</button>
</nav>
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
  var personOpen = null, activity = {};
  async function fetchActivity(name) { try { var res = await fetch('/rooms/' + encodeURIComponent(sel) + '/participants/' + encodeURIComponent(name) + '/activity'); if (res.ok) { activity[name] = await res.json(); if (tab === 'people') renderPane(); } } catch (e) {} }
  document.addEventListener('click', function (e) { var row = e.target.closest && e.target.closest('.person'); if (!row || e.target.closest('.act')) return; var n = row.dataset.person; personOpen = personOpen === n ? null : n; if (personOpen) fetchActivity(personOpen); renderPane(); });
  setInterval(function () { if (personOpen && tab === 'people' && !document.hidden) fetchActivity(personOpen); }, 3000);
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
    if (r.openings && r.openings !== 'revealed' && (r.state === 'open')) chips += '<span class="chip">openings: ' + esc(r.openings.replace(/, waiting for nobody$/, '')) + '</span>';
    var act = '<a class="btn hidephone" href="/rooms/' + encodeURIComponent(r.name) + '/transcript" target="_blank" title="Plain-text transcript">Transcript</a>'
      + ((r.state === 'open' || r.state === 'stalled') ? '<button class="btn danger" id="closeroom" title="Close this room without a conclusion">Close room</button>' : '')
      + '<button class="btn" id="archroom" title="' + (r.archived ? 'Show this room in listings again' : 'Hide this room from listings; the transcript is kept') + '">' + (r.archived ? 'Unarchive' : 'Archive') + '</button>'
      + '<button class="btn icon" id="toginspect" title="Inspector">☰</button>';
    var topicOpen = !!expanded['topic'];
    $('#head').innerHTML = '<div class="t1"><h2>' + esc(r.name) + '</h2>' + chips + '</div><div class="acts">' + act + '</div>'
      + '<div class="topic' + (topicOpen ? ' open' : '') + '" id="topic" title="Click to expand">' + esc(r.topic || '(no topic)') + '</div>';
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
    return '<div class="who"><b>' + esc(m.from.name) + '</b>' + roleTag({ agent: m.from.agent, role: p.role }) + (m.from.agent && m.from.agent !== 'human' ? '<span class="agent">' + esc(m.from.agent) + '</span>' : '') + (extra || '') + quietBadge(m) + '<span class="seq">#' + m.seq + '</span><span class="t" title="' + esc(m.ts) + '">' + fmtTs(m.ts) + '</span></div>';
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
    $('#pane').innerHTML = h;
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
    var rows = function (list) { return list.map(function (p) {
      var areas = areasOf(r, p.name), reviewing = reviewingOf(r, p.name);
      var aline = esc(areas.join(', ')) + (reviewing.length ? (areas.length ? ' · ' : '') + 'reviewing: ' + esc(reviewing.join(', ')) : '') + (p.left_reason ? (areas.length || reviewing.length ? ' · ' : '') + 'left: ' + esc(p.left_reason) : '');
      return '<div class="person' + (p.active ? '' : ' off') + (personOpen === p.name ? ' sel' : '') + '" data-person="' + esc(p.name) + '">' + av(p.name, p.agent) + '<div><div class="n">' + esc(p.name) + roleTag(p) + '<span class="agent">' + esc(p.agent) + '</span></div><div class="a">' + aline + '</div></div><div class="s">' + p.messages + ' msg' + (p.messages === 1 ? '' : 's') + '<br>' + (p.active ? (p.working && p.working.at > (p.last_active_at || '') ? 'working: ' + esc(p.working.tool) + ' · ' + rel(p.working.at) : rel(p.last_seen_at || p.last_active_at)) : 'left') + '</div>' + (personOpen === p.name ? '<div class="act" id="act">' + (activity[p.name] ? (activity[p.name].length ? activity[p.name].map(function (a) { return '<div><span class="st">#' + a.step + ' ' + rel(a.at) + '</span> <span class="tl">' + esc(a.tool) + '</span> ' + esc(a.detail || '') + '</div>'; }).join('') : 'No heartbeats yet (only seats started after 2026-09-18 send them).') : 'Loading…') + '</div>' : '') + '</div>';
    }).join(''); };
    var active = r.participants.filter(function (p) { return p.active; }), gone = r.participants.filter(function (p) { return !p.active; });
    // kick votes: open ones with a kick/keep button pair, settled ones as one line; a kick button per active agent starts one
    var kv = (r.kick_votes || []), openKv = {};
    kv.forEach(function (v) { if (v.status === 'open') openKv[v.target] = v; });
    var kickSec = '';
    if (kv.length) kickSec = '<div class="sec"><h3>Kick votes <span class="sp"></span><span class="c">' + kv.length + '</span></h3>' + kv.slice().reverse().map(function (v) {
      var line = '<b>' + esc(v.target) + '</b> · by ' + esc(v.by) + ' · ' + rel(v.started_at) + ' · ' + esc(v.reason);
      if (v.status === 'open') line += '<br><span class="mono">' + v.kick + '/' + v.needed + ' kick, ' + v.keep + ' keep</span> ' + (v.ballots || []).map(function (b) { return esc(b.name) + ':' + b.vote; }).join(' ') + ' <button class="mini" data-kick="' + esc(v.target) + '" data-kv="kick">kick</button> <button class="mini" data-kick="' + esc(v.target) + '" data-kv="keep">keep</button>';
      else line += '<br><span style="color:var(--dim)">' + esc(v.status) + (v.outcome ? ': ' + esc(v.outcome) : '') + '</span>';
      return '<div style="padding:6px 0;border-bottom:1px solid var(--line)">' + line + '</div>';
    }).join('') + '</div>';
    var kickBtns = active.filter(function (p) { return p.agent !== 'human' && p.role !== 'chair' && !openKv[p.name]; }).map(function (p) { return '<button class="mini" data-kick="' + esc(p.name) + '" data-kv="start">kick ' + esc(p.name) + '</button> <button class="mini" data-replace="' + esc(p.name) + '">replace ' + esc(p.name) + '</button> '; }).join('');
    return '<div class="sec"><h3>In the room <span class="sp"></span><span class="c">' + active.length + '</span></h3>' + (rows(active) || '<div class="empty" style="padding:16px">Nobody here.</div>') + '</div>'
      + kickSec + (kickBtns ? '<div class="sec" style="font-size:12px"><span style="color:var(--dim2)">Kick starts a vote; replace removes them immediately and recruits a successor (for a dead seat): </span>' + kickBtns + '</div>' : '')
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
    var parts = v.trim().split(/\s+/);
    var body = parts[0] === 'any' ? { agent: 'any', model: 'any' } : { agent: parts[0], model: parts[1] || 'any' };
    var res = await fetch('/policy', { method: 'POST', headers: hdrs(), body: JSON.stringify(body) });
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
