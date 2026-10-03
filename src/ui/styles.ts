export const UI_CSS = `
  /* Frink's stock palette and glass material (frink-oss globals.css, palette/glass.ts at the Standard step):
     neutral greys, violet primary, one glass fill at 70% with an 8px blur, a lit 1px rim and a top-left sheen,
     over the chat atmosphere (a violet glow and a green floor glow). */
  :root {
    --bg:#f4f4f5; --panel:#ffffff; --panel2:#f4f4f5; --line:#e4e4e7; --line2:#ededf0; --fg:#0a0a0a; --dim:#3f3f46; --dim2:#62626b; --control:#8e8e96; --on-acc:#ffffff; color-scheme:light;
    --shell:250 250 250; --glass:rgb(var(--shell) / .70); --glass-filter:blur(8px) saturate(1.6); --glass-rim:.65; --glass-sheen:.24; --glass-tint:.08;
    --atm-primary:.028; --atm-floor:101 217 146; --atm-depth:.012; --atm-wash:.035; --edge:rgb(255 255 255 / .65);
    --acc:#7c3aed; --acc-rgb:124 58 237; --acc-bg:#f1ebfe; --acc-fg:#6d28d9;
    --prop:#0e7490; --prop-bg:#e3f6fa; --chal:#b45309; --chal-bg:#fdf1e3; --ok:#15803d; --ok-bg:#e7f5ea; --bad:#c81e1e; --bad-bg:#fdecec; --hum:#be185d; --hum-bg:#fce7f1; --warn:#96520a; --warn-bg:#fdf6dc;
    --shadow:0 1px 2px rgba(10,10,10,.04), 0 0 0 1px rgba(10,10,10,.06); --shell-shadow:0 10px 30px rgba(10,10,10,.06);
    --radius:12px;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#050505; --panel:#141414; --panel2:#1f1f1f; --line:#2e2e2e; --line2:#232323; --fg:#e8e8e8; --dim:#b8b8b8; --dim2:#8c8c8c; --control:#616161; --on-acc:#0a0a0a; color-scheme:dark;
    --shell:10 10 10; --glass:rgb(var(--shell) / .70); --glass-rim:.19; --glass-sheen:.05; --glass-tint:.13;
    --atm-primary:.06; --atm-floor:125 240 168; --atm-depth:.03; --atm-wash:.04; --edge:rgb(255 255 255 / .19);
    --acc:#a78bfa; --acc-rgb:167 139 250; --acc-bg:#1e1a2e; --acc-fg:#c4b5fd;
    --prop:#67e8f9; --prop-bg:#0f2329; --chal:#f0b060; --chal-bg:#2a1f10; --ok:#86efac; --ok-bg:#122119; --bad:#fca5a5; --bad-bg:#2b1616; --hum:#f9a8d4; --hum-bg:#2b1622; --warn:#fde68a; --warn-bg:#29240f;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06); --shell-shadow:0 12px 32px rgba(0,0,0,.35);
  } }
  :root[data-theme="dark"] {
    --bg:#050505; --panel:#141414; --panel2:#1f1f1f; --line:#2e2e2e; --line2:#232323; --fg:#e8e8e8; --dim:#b8b8b8; --dim2:#8c8c8c; --control:#616161; --on-acc:#0a0a0a; color-scheme:dark;
    --shell:10 10 10; --glass:rgb(var(--shell) / .70); --glass-rim:.19; --glass-sheen:.05; --glass-tint:.13;
    --atm-primary:.06; --atm-floor:125 240 168; --atm-depth:.03; --atm-wash:.04; --edge:rgb(255 255 255 / .19);
    --acc:#a78bfa; --acc-rgb:167 139 250; --acc-bg:#1e1a2e; --acc-fg:#c4b5fd;
    --prop:#67e8f9; --prop-bg:#0f2329; --chal:#f0b060; --chal-bg:#2a1f10; --ok:#86efac; --ok-bg:#122119; --bad:#fca5a5; --bad-bg:#2b1616; --hum:#f9a8d4; --hum-bg:#2b1622; --warn:#fde68a; --warn-bg:#29240f;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06); --shell-shadow:0 12px 32px rgba(0,0,0,.35);
  }
  * { box-sizing:border-box }
  html,body { height:100%; margin:0; overflow:hidden }
  body { background-color:var(--bg); background-image:radial-gradient(120% 95% at 92% 92%, rgb(var(--acc-rgb) / var(--atm-primary)) 0%, transparent 52%), radial-gradient(140% 60% at 50% 108%, rgb(var(--atm-floor) / var(--atm-depth)) 0%, transparent 45%), radial-gradient(90% 75% at 6% 10%, rgb(255 255 255 / .045) 0%, transparent 46%), radial-gradient(64% 52% at 80% 4%, rgb(255 255 255 / .035) 0%, transparent 50%), linear-gradient(180deg, rgb(255 255 255 / var(--atm-wash)) 0%, transparent 24%); background-attachment:fixed; padding:10px; gap:10px; color:var(--fg); font:14px/1.5 -apple-system,BlinkMacSystemFont,Inter,ui-sans-serif,system-ui,sans-serif; display:grid; grid-template-columns:280px minmax(0,1fr) 360px; grid-template-rows:100%; overflow:hidden; -webkit-font-smoothing:antialiased }
  body.noinspect { grid-template-columns:280px minmax(0,1fr) }
  body.noinspect #inspect { display:none }
  .mono { font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px }
  button { font:inherit; cursor:pointer; color:inherit }
  a { color:var(--acc-fg); text-decoration:none } a:hover { text-decoration:underline }
  input,textarea,select { font:inherit; color:var(--fg); background:var(--panel); border:1px solid var(--control); border-radius:10px; padding:8px 11px }
  input:focus,textarea:focus,select:focus { outline:2px solid var(--acc); outline-offset:2px; border-color:var(--acc) } :focus-visible { outline:2px solid var(--acc); outline-offset:3px } input::placeholder,textarea::placeholder { color:var(--dim2); opacity:1 }
  ::-webkit-scrollbar { width:10px; height:10px } ::-webkit-scrollbar-thumb { background:var(--line); border-radius:8px; border:3px solid var(--panel) }
  .btn { box-sizing:border-box; min-height:32px; border:1px solid var(--control); background:var(--panel); color:var(--fg); border-radius:10px; padding:0 12px; font-size:12.5px; font-weight:500; line-height:1; display:inline-flex; align-items:center; justify-content:center; gap:6px; white-space:nowrap; text-decoration:none }
  a.btn, a.btn:hover { color:var(--fg); text-decoration:none } /* a link styled as a button reads as a button, not a link */
  @media (pointer:coarse) { .btn { min-height:44px } .btn.icon { width:44px; height:44px } } /* one touch-target size for every button, not per feature */
  /* one control height per row: toolbar rows (rail controls, transcript filters) are 28px; the composer row is 38px */
  .rctl .chip.tog, .rctl select, .rctl .btn, .lf .chip.tog, .lf select, .lf input { box-sizing:border-box; height:28px; min-height:28px; padding-top:0; padding-bottom:0; line-height:1 }
  .rctl .btn { padding:0 10px; font-size:12px }
  .chip.tog { padding-left:10px; padding-right:10px }
  #compose #name, #compose textarea, #compose #sendbtn { box-sizing:border-box; min-height:38px }
  #compose #name { height:38px } #compose #sendbtn { height:38px; padding:0 16px }
  @media (pointer:coarse) { .rctl .chip.tog, .rctl select, .rctl .btn, .lf .chip.tog, .lf select, .lf input, #compose #name, #compose textarea, #compose #sendbtn { min-height:44px; height:auto } #compose #name, #compose #sendbtn { height:44px } }
  .btn:hover { background:var(--panel2) } .btn.primary { background:var(--acc); border-color:var(--acc); color:var(--on-acc) } .btn.primary:hover { filter:brightness(1.08) }
  .btn.danger { color:var(--bad) } .btn:disabled { opacity:.45; cursor:default }
  .icon { width:32px; height:32px; min-height:0; padding:0; justify-content:center; border-radius:10px }
  .chip { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; padding:2px 8px; border-radius:999px; background:var(--panel2); color:var(--dim); white-space:nowrap; line-height:1.6 }
  .chip.open { background:var(--ok-bg); color:var(--ok) } .chip.concluded { background:var(--acc-bg); color:var(--acc-fg) } .chip.stalled { background:var(--warn-bg); color:var(--warn) } .chip.closed { background:var(--panel2); color:var(--dim2) }
  .chip.prop { background:var(--prop-bg); color:var(--prop) } .chip.chal { background:var(--chal-bg); color:var(--chal) } .chip.hum { background:var(--hum-bg); color:var(--hum) } .chip.bad { background:var(--bad-bg); color:var(--bad) } .chip.ok { background:var(--ok-bg); color:var(--ok) }
  .tag { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:1px 6px; border-radius:5px; background:var(--panel2); color:var(--dim) }
  .tag.verifier { background:var(--acc-bg); color:var(--acc-fg) } .tag.chair { background:var(--hum-bg); color:var(--hum) } .tag.lead { background:var(--prop-bg); color:var(--prop) } .tag.recruit { background:var(--warn-bg); color:var(--warn) } .tag.human { background:var(--hum-bg); color:var(--hum) }
  .av { width:28px; height:28px; border-radius:8px; display:grid; place-items:center; font-size:11px; font-weight:700; color:#fff; flex:none; background-image:linear-gradient(rgba(0,0,0,.48),rgba(0,0,0,.48)) !important; letter-spacing:.02em }
  .dot { width:8px; height:8px; border-radius:50%; flex:none; background:var(--dim2) }
  .dot.open { background:var(--ok); box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent) } .dot.stalled { background:var(--warn) } .dot.concluded { background:var(--acc) }
  .empty { color:var(--dim2); text-align:center; padding:48px 24px; font-size:13px }
  .clamp { max-height:10.5em; overflow:hidden; position:relative }
  .clamp::after { content:""; position:absolute; inset:auto 0 0 0; height:3em; background:linear-gradient(transparent, var(--clampbg, var(--panel))) }
  .more { background:none; border:0; color:var(--acc-fg); font-size:12px; font-weight:500; padding:4px 0 0 }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:12.5px } .kv b { color:var(--dim); font-weight:500 }

  /* ---------- rooms rail ---------- */
  #rail { background:var(--panel); border:1px solid var(--line); border-radius:20px; box-shadow:var(--shell-shadow); display:flex; flex-direction:column; min-height:0; min-width:0 }
  .brand { padding:14px 14px 10px; display:flex; align-items:center; gap:10px }
  .brand .mark { width:30px; height:30px; border-radius:9px; background:var(--acc); color:var(--on-acc); display:grid; place-items:center; font-weight:700; font-size:14px }
  .brand h1 { font-size:14px; font-weight:700; margin:0; letter-spacing:-.01em; line-height:1.2 }
  .brand .sub { color:var(--dim); font-size:12px } .brand .sub.bad { color:var(--bad) }
  .brand .sp { flex:1 }
  .person { cursor:pointer } .person.sel { background:var(--panel2) } .act { position:relative; grid-column:1 / -1; font-size:11.5px; font-family:ui-monospace,Menlo,monospace; padding:6px 10px 10px 46px; color:var(--dim); max-height:260px; overflow:auto; white-space:pre-wrap; word-break:break-word } .act .st { color:var(--dim2) } .act .tl { color:var(--fg); font-weight:600 }
  .act .now { color:var(--fg); margin:0 0 6px; padding:5px 8px; border-radius:6px; background:var(--panel2); border-left:3px solid var(--line) } .act .now.live { border-left-color:var(--ok); background:var(--ok-bg) } .act .now.off { font-style:italic }
  .act .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--ok); margin-right:6px; vertical-align:1px; animation:actpulse 1.4s ease-in-out infinite } @keyframes actpulse { 50% { opacity:.25 } } @media (prefers-reduced-motion: reduce) { .act .dot { animation:none } }
  .act .hdr { color:var(--dim2); margin:2px 0 3px; font-family:inherit } .act .latest { color:var(--fg) }
  .rctl { display:flex; flex-wrap:wrap; gap:4px 5px; padding:0 12px 10px; align-items:center } .rctl select, .lf select, .lf input { font-size:12px; padding:4px 6px; background:var(--panel2); color:inherit; border:1px solid var(--control); border-radius:8px } .lf { display:flex; flex-wrap:wrap; gap:6px; padding:6px 16px; align-items:center; background:var(--panel); border-bottom:1px solid var(--line) } .lf input { flex:1 1 140px } .chip.tog { cursor:pointer; opacity:1; border:1px solid var(--line); background:transparent; color:var(--dim2) } .chip.tog.on { background:var(--panel2); color:var(--fg); border-color:var(--control) } .rctl .btn { margin-left:auto }
  .filter { padding:0 12px 10px } .filter input { width:100%; font-size:13px; padding:7px 10px; background:var(--panel2) }
  .policy { margin:0 12px 6px; font-size:11.5px; color:var(--dim); background:var(--acc-bg); border-radius:8px; padding:4px 9px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .policy b { color:var(--acc-fg); font-weight:600 }
  #rooms { overflow:auto; flex:1; padding:0 8px 24px }
  .run { margin-top:10px }
  .run > .rh { display:flex; align-items:center; gap:8px; padding:6px 8px 4px; font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--dim2); cursor:pointer; user-select:none }
  .run > .rh .n { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .run > .rh .c { font-weight:500; letter-spacing:0; text-transform:none }
  .run > .rh .car { transition:transform .15s; font-size:9px } .run.closed > .rh .car { transform:rotate(-90deg) } .run.closed > .rl { display:none }
  .room { display:grid; grid-template-columns:auto minmax(0,1fr) auto; grid-template-rows:auto auto; column-gap:9px; align-items:center; width:100%; text-align:left; padding:9px 10px; border:0; border-radius:12px; background:transparent; margin:1px 0 }
  .room .dot { grid-column:1; grid-row:1 }
  .room:hover { background:var(--panel2) } .room.sel { background:var(--acc-bg) } .room.sel .n { color:var(--acc-fg) }
  .room .n { grid-column:2; grid-row:1; font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .room .m { grid-column:2; grid-row:2; color:var(--dim); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .room .u { grid-column:3; grid-row:1 / span 2; background:var(--acc); color:var(--on-acc); font-size:10.5px; font-weight:700; border-radius:999px; padding:1px 7px; min-width:20px; text-align:center }
  .room .u.q { background:var(--panel2); color:var(--dim2) }

  /* ---------- transcript ---------- */
  #main { display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:auto auto minmax(0,1fr) auto; min-height:0; min-width:0; background:var(--bg); position:relative; border:1px solid var(--line); border-radius:20px; overflow:hidden; box-shadow:var(--shell-shadow) }
  #main > * { min-width:0 } .lf > * { min-width:0 } .lf select { max-width:45% }
  #head { background:var(--panel); border-bottom:1px solid var(--line); padding:10px 16px; display:grid; grid-template-columns:minmax(0,1fr) auto; row-gap:4px; align-items:center }
  #head .t1 { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap }
  #head .t1 .chip { display:inline-block; max-width:100%; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap } /* a long openings chip stays in its column, not under the buttons */
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
  #newpill { position:absolute; left:50%; transform:translateX(-50%); bottom:96px; background:var(--acc); color:var(--on-acc); border:0; border-radius:999px; padding:6px 14px; font-size:12px; font-weight:600; box-shadow:0 4px 14px rgba(0,0,0,.2); display:none }
  #compose { background:var(--panel); border-top:1px solid var(--line); padding:10px 16px 12px; display:grid; grid-template-columns:120px minmax(0,1fr) auto; gap:8px; align-items:end }
  #compose .quick { grid-column:1 / -1; display:flex; gap:6px; flex-wrap:wrap; align-items:center; min-height:0 }
  #compose .quick button { border:1px solid var(--line); background:var(--panel2); border-radius:999px; padding:1px 9px; font-size:11.5px; color:var(--dim) }
  #compose .quick button:hover { color:var(--fg); border-color:var(--dim2) }
  #compose textarea { resize:none; min-height:38px; max-height:180px; line-height:1.4 }
  #compose .hint { grid-column:1 / -1; font-size:11.5px; color:var(--dim2) } #compose .hint.bad { color:var(--bad) }

  /* ---------- inspector ---------- */
  #inspect { background:var(--panel); border:1px solid var(--line); border-radius:20px; box-shadow:var(--shell-shadow); display:flex; flex-direction:column; min-height:0; min-width:0 }
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
  .person:last-child { border:0 } .person.off .av { filter:grayscale(1) }
  .person.hasacts { grid-template-columns:28px minmax(0,1fr) auto auto } .pacts { display:flex; gap:4px; align-items:center }
  .mini { border:1px solid var(--line); background:var(--panel2); color:var(--dim); border-radius:6px; padding:2px 8px; font-size:11.5px; line-height:1.4; font-weight:500; white-space:nowrap }
  .mini:hover { color:var(--fg); border-color:var(--dim2) } .mini.warn:hover { color:var(--bad); border-color:var(--bad) }
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

  /* Frink Glass: one material on every shell surface. Panels sit on the static atmosphere, so they take no blur;
     the header and composer have the transcript scrolling under them, so they blur. */
  #rail,#main,#inspect { background-color:var(--glass); border:1px solid rgb(var(--shell) / .35); background-image:radial-gradient(130% 90% at 0% 0%, rgb(255 255 255 / var(--glass-sheen)), transparent 56%); box-shadow:inset 1px 1px 0 0 rgb(255 255 255 / var(--glass-rim)), inset -1px -1px 0 0 rgb(var(--acc-rgb) / var(--glass-tint)), var(--shell-shadow) }
  #main { border-color:rgb(255 255 255 / .06) } #rail,#inspect { border-color:rgb(255 255 255 / .06) }
  :root:not([data-theme="dark"]) #rail, :root:not([data-theme="dark"]) #main, :root:not([data-theme="dark"]) #inspect { border-color:var(--line) }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) #rail, :root:not([data-theme="light"]) #main, :root:not([data-theme="light"]) #inspect { border-color:rgb(255 255 255 / .06) } }
  #head,#compose,.lf { background-color:transparent }
  @supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))) { #head,#compose { background-color:var(--glass); -webkit-backdrop-filter:var(--glass-filter, blur(8px) saturate(1.6)); backdrop-filter:var(--glass-filter, blur(8px) saturate(1.6)) } }
  @media (prefers-reduced-transparency:reduce), (prefers-contrast:more) { #rail,#main,#inspect,#head,#compose { background:rgb(var(--shell)); background-image:none; -webkit-backdrop-filter:none; backdrop-filter:none } body { background:var(--bg) } }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; scroll-behavior:auto !important } }
  @media (forced-colors:active) { #rail,#main,#inspect,#head,#compose { background:Canvas; box-shadow:none; -webkit-backdrop-filter:none; backdrop-filter:none } .room.sel,.chip.tog.on { outline:2px solid Highlight; outline-offset:-2px } }
  /* ---------- phone ---------- */
  #tabbar { display:none }
  @media (max-width:1100px) {
    body,body.noinspect { grid-template-columns:260px minmax(0,1fr) }
    #inspect { position:fixed; top:10px; right:10px; bottom:10px; width:min(420px, 92vw); z-index:20; box-shadow:-8px 0 30px rgba(0,0,0,.25); transform:translateX(calc(100% + 20px)); visibility:hidden; transition:transform .18s ease-out; display:flex !important }
    body.inspect-open #inspect { transform:none; visibility:visible }
  }
  @media (max-width:720px) {
    body,body.noinspect { padding:0; gap:0; grid-template-columns:100%; grid-template-rows:minmax(0,1fr) auto } #rail,#main,#inspect { border:0; border-radius:0; box-shadow:none }
    #rail,#main { grid-row:1; grid-column:1; display:none } body[data-view="rooms"] #rail { display:flex } body[data-view="chat"] #main { display:grid }
    #inspect { position:static; width:auto; transform:none; box-shadow:none; display:none !important; grid-row:1; grid-column:1 } body[data-view="inspect"] #inspect { display:flex !important; visibility:visible }
    #tabbar { display:grid; grid-template-columns:repeat(3,1fr); grid-row:2; border-top:1px solid var(--line); background:var(--panel); padding-bottom:env(safe-area-inset-bottom) }
    #tabbar button { border:0; background:transparent; padding:10px 0 9px; font-size:12px; font-weight:600; color:var(--dim); display:flex; flex-direction:column; align-items:center; gap:2px }
    #tabbar button.on { color:var(--acc-fg) } #tabbar button .n { font-size:10px; background:var(--acc); color:var(--on-acc); border-radius:999px; padding:0 6px }
    #compose { grid-template-columns:minmax(0,1fr) auto } #compose #name { display:none }
    .lf { padding:6px 12px } .lf input { flex:1 1 100% }
    #head { padding:8px 12px; display:flex; flex-wrap:wrap; gap:6px } #head .t1 { flex:1 1 100% } #head .acts { flex:1 1 100%; justify-content:flex-end } #head .topic { flex:1 1 100% } #log { padding:10px 12px } .body,.card,.row { max-width:100% }
    #tabbar { grid-column:1 }
    #newpill { bottom:130px }
    #head .acts .hidephone { display:none }
  }
`;
