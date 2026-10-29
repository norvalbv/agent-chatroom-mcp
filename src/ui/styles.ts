/**
 * The dashboard's look: Grok Bot's surfaces under a Liquid Glass control layer.
 *
 * Surfaces and type are Grok Bot 0.75.8's (/Applications/Grok Bot.app, renderer assets/index-CFSAhbDS.css, the :root sand
 * tokens): one ink at alpha steps in light (#1c1c1c over #fff, #f5f5f5 sidebar), a 14px/20px body, a 10-12px row radius,
 * an 18px transcript bubble with 7px block padding and a 22px line, and a filled user bubble. The dark values are not in
 * that stylesheet (the app sets them at run time) and were sampled from its window: #0e0e0e sidebar, #121212 pane, #1f1f1f
 * for every raised surface, #272727 nested, a #e0e0e0 user bubble and a white primary pill.
 *
 * Content stays solid. Only what floats over the transcript is glass (header, composer, menus, palette, inspector, inbox,
 * toasts, the phone tab bar): a translucent fill with blur and saturation, a top sheen, and a lit rim that is brightest at
 * the top-left, so the transcript visibly scrolls beneath it. Reduced transparency, more contrast and forced colours get
 * opaque surfaces.
 */
const svg = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}")`;
const ICONS: Record<string, string> = {
  more: '<circle cx="5" cy="12" r="1.5" fill="#000"/><circle cx="12" cy="12" r="1.5" fill="#000"/><circle cx="19" cy="12" r="1.5" fill="#000"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3.5"/><path d="M15 4v16"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  cmd: '<path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H17.5A2.5 2.5 0 1 0 15 6.5v11a2.5 2.5 0 1 0 2.5-2.5h-11A2.5 2.5 0 1 0 9 17.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  seat: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M3 20h18"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5.2"/>',
  close: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5z" fill="#000"/>',
  inbox: '<path d="M4 13.5 6.2 6a2 2 0 0 1 1.9-1.5h7.8A2 2 0 0 1 17.8 6l2.2 7.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20"/>',
};
const ICON_CSS = Object.entries(ICONS).map(([k, v]) => `.i-${k}, [data-ic="${k}"] { --m:${svg(v)} }`).join("\n  ");

/** Everything that floats over the transcript, and the subset large enough to carry the lit rim (it needs a positioned box). */
const GLASS = "#top, #compose .cbar, #compose .quick button, #compose .hint, #newpill, .pop, #inspect, #tabbar, .mact, #pal .box, .qsheet, #qtoast .qt";
const RIM = "#top, #compose .cbar, .pop, #inspect, #tabbar, #pal .box, .qsheet, #qtoast .qt";

const DARK = `
    color-scheme:dark;
    --bg:#121212; --rail:#0e0e0e; --panel:#1f1f1f; --panel2:#272727; --elev:#1f1f1f; --seg:#3a3a3a;
    --line:rgb(255 255 255 / .08); --line2:rgb(255 255 255 / .05); --hover:rgb(255 255 255 / .05); --active:rgb(255 255 255 / .08);
    --fg:#ededed; --dim:#b3b3b3; --dim2:#8f8f8f; --control:rgb(255 255 255 / .14);
    --cta:#f5f5f5; --on-cta:#121212; --mine:#e0e0e0; --on-mine:#121212; --hu:#303030;
    --acc:#3d8bfd; --acc-rgb:61 139 253; --acc-fg:#86b8ff; --on-acc:#ffffff;
    --prop:#45cdb9; --chal:#ff9a52; --ok:#4fd88a; --bad:#ff6b76; --hum:#f57cc0; --warn:#f2b54a;
    --g-fill:rgb(42 42 42 / .52); --g-solid:rgb(30 30 30 / .84); --g-spec:rgb(255 255 255 / .07); --g-rim:rgb(255 255 255 / .22); --g-rim2:rgb(255 255 255 / .05); --g-hair:rgb(255 255 255 / .07);
    --g-shadow:0 14px 40px rgb(0 0 0 / .45), 0 2px 8px rgb(0 0 0 / .3);
    --aura1:rgb(61 139 253 / .11); --aura2:rgb(255 140 60 / .05);`;

export const UI_CSS = `
  :root {
    color-scheme:light;
    --bg:#ffffff; --rail:#f5f5f5; --panel:#f2f2f2; --panel2:#e8e8e8; --elev:#ffffff; --seg:#ffffff;
    --line:rgb(28 28 28 / .09); --line2:rgb(28 28 28 / .06); --hover:rgb(28 28 28 / .05); --active:rgb(28 28 28 / .08);
    --fg:#1c1c1c; --dim:#4d4d4d; --dim2:#6b6b6b; --control:rgb(28 28 28 / .16);
    --cta:#1c1c1c; --on-cta:#ffffff; --mine:#1c1c1c; --on-mine:#ffffff; --hu:#e3e3e3;
    --acc:#1680f3; --acc-rgb:22 128 243; --acc-fg:#0b6dd3; --on-acc:#ffffff;
    --prop:#0b8577; --chal:#c8520a; --ok:#0c8a4e; --bad:#d42a37; --hum:#c2266f; --warn:#a8620a;
    --g-fill:rgb(255 255 255 / .58); --g-solid:rgb(255 255 255 / .86); --g-spec:rgb(255 255 255 / .55); --g-rim:rgb(255 255 255 / .95); --g-rim2:rgb(255 255 255 / .3); --g-hair:rgb(28 28 28 / .08);
    --g-shadow:0 12px 34px rgb(28 28 28 / .11), 0 1px 3px rgb(28 28 28 / .06);
    --aura1:rgb(22 128 243 / .07); --aura2:rgb(238 98 13 / .045);
    --g-blur:blur(24px) saturate(1.8);
    --acc-bg:color-mix(in srgb, var(--acc) 14%, var(--bg)); --prop-bg:color-mix(in srgb, var(--prop) 13%, var(--bg)); --chal-bg:color-mix(in srgb, var(--chal) 13%, var(--bg));
    --ok-bg:color-mix(in srgb, var(--ok) 13%, var(--bg)); --bad-bg:color-mix(in srgb, var(--bad) 13%, var(--bg)); --hum-bg:color-mix(in srgb, var(--hum) 13%, var(--bg)); --warn-bg:color-mix(in srgb, var(--warn) 14%, var(--bg));
    --shadow:none; --radius:18px; --colw:760px;
    --font:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, ui-sans-serif, system-ui, sans-serif;
    --mono:ui-monospace, "SF Mono", SFMono-Regular, Menlo, "JetBrains Mono", monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK}
  } }
  :root[data-theme="dark"] {${DARK}
  }
  * { box-sizing:border-box }
  html,body { height:100%; margin:0; overflow:hidden }
  body { --insp:0px; background:var(--rail); color:var(--fg); font:14px/20px var(--font); -webkit-font-smoothing:antialiased; display:grid; grid-template-columns:300px minmax(0,1fr); grid-template-rows:100% }
  .mono { font-family:var(--mono); font-size:12px }
  button { font:inherit; cursor:pointer; color:inherit }
  a { color:var(--acc-fg); text-decoration:none } a:hover { text-decoration:underline }
  input,textarea,select { font:inherit; color:var(--fg); background:var(--hover); border:1px solid var(--line); border-radius:12px; padding:8px 12px }
  input:focus,textarea:focus,select:focus { outline:2px solid var(--acc); outline-offset:1px } :focus-visible { outline:2px solid var(--acc); outline-offset:2px }
  input::placeholder,textarea::placeholder { color:var(--dim2); opacity:1 }
  ::-webkit-scrollbar { width:10px; height:10px } ::-webkit-scrollbar-track { background:transparent } ::-webkit-scrollbar-thumb { background:var(--active); border-radius:8px; border:3px solid transparent; background-clip:content-box }
  .i { display:inline-block; width:18px; height:18px; flex:none; background:currentColor; -webkit-mask:var(--m) center / contain no-repeat; mask:var(--m) center / contain no-repeat }
  ${ICON_CSS}

  /* ---------- controls ---------- */
  .btn { box-sizing:border-box; min-height:32px; border:0; background:var(--panel); color:var(--fg); border-radius:999px; padding:0 14px; font-size:13px; font-weight:500; line-height:1; display:inline-flex; align-items:center; justify-content:center; gap:7px; white-space:nowrap; text-decoration:none; transition:background-color .12s, color .12s }
  a.btn, a.btn:hover { color:var(--fg); text-decoration:none } /* a link styled as a button reads as a button, not a link */
  .btn:hover { background:var(--panel2) } .btn.primary { background:var(--cta); color:var(--on-cta) } .btn.primary:hover { filter:brightness(.9) }
  .btn.danger { color:var(--bad) } .btn:disabled { opacity:.4; cursor:default }
  .btn.ghost { background:transparent; color:var(--dim) } .btn.ghost:hover { background:var(--hover); color:var(--fg) }
  .btn.ghost.on { position:relative; color:var(--fg) } .btn.ghost.on::after { content:""; position:absolute; top:6px; right:6px; width:7px; height:7px; border-radius:50%; background:var(--acc) }
  .btn.pill { min-height:30px; padding:0 14px; background:var(--panel2) } .btn.pill:hover { background:var(--active) }
  .icon { width:34px; height:34px; min-height:0; padding:0; justify-content:center; border-radius:999px }
  @media (pointer:coarse) { .btn { min-height:44px } .icon { width:44px; height:44px } } /* one touch-target size for every button, not per feature */
  .chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:500; line-height:22px; padding:0 9px; border:0; border-radius:999px; background:var(--hover); color:var(--dim); white-space:nowrap }
  button.chip { cursor:pointer } button.chip:hover { filter:brightness(1.08) }
  .chip.open::before, .chip.stalled::before, .chip.concluded::before, .chip.closed::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor }
  .chip.open { background:var(--ok-bg); color:var(--ok) } .chip.concluded { background:var(--acc-bg); color:var(--acc-fg) } .chip.stalled { background:var(--warn-bg); color:var(--warn) } .chip.closed { color:var(--dim2) }
  .chip.prop { background:var(--prop-bg); color:var(--prop) } .chip.chal { background:var(--chal-bg); color:var(--chal) } .chip.hum { background:var(--hum-bg); color:var(--hum) } .chip.bad { background:var(--bad-bg); color:var(--bad) } .chip.ok { background:var(--ok-bg); color:var(--ok) }
  .chip.tog { line-height:28px; padding:0 12px; background:transparent; box-shadow:inset 0 0 0 1px var(--line); color:var(--dim2) } .chip.tog.on { background:var(--panel2); box-shadow:none; color:var(--fg) }
  .tag { font-size:11px; font-weight:500; line-height:18px; padding:0 7px; border-radius:999px; background:var(--hover); color:var(--dim) }
  .tag.verifier { background:var(--acc-bg); color:var(--acc-fg) } .tag.chair { background:var(--hum-bg); color:var(--hum) } .tag.lead { background:var(--prop-bg); color:var(--prop) } .tag.recruit { background:var(--warn-bg); color:var(--warn) } .tag.human { background:var(--hum-bg); color:var(--hum) }
  .av { width:28px; height:28px; border-radius:50%; display:grid; place-items:center; flex:none; font-size:11px; font-weight:600; letter-spacing:.02em; color:var(--fg) }
  .av svg { width:100%; height:100%; display:block; overflow:visible } .av.hu { background:var(--hu) }
  .dot { width:8px; height:8px; border-radius:50%; flex:none; background:var(--dim2) }
  .empty { color:var(--dim2); text-align:center; padding:48px 24px; font-size:13px }
  .clamp { max-height:10.5em; overflow:hidden; position:relative }
  .clamp::after { content:""; position:absolute; inset:auto 0 0 0; height:3em; background:linear-gradient(transparent, var(--clampbg, var(--panel))) }
  .more { background:none; border:0; color:var(--acc-fg); font-size:12.5px; font-weight:500; padding:4px 6px 0 }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:5px 14px; font-size:13px } .kv b { color:var(--dim2); font-weight:400 }

  /* ---------- glass: what floats above the transcript ---------- */
  ${GLASS} { background:linear-gradient(180deg, var(--g-spec), transparent 46%), var(--g-fill); -webkit-backdrop-filter:var(--g-blur); backdrop-filter:var(--g-blur); box-shadow:0 0 0 1px var(--g-hair), var(--g-shadow) }
  .pop, #inspect, #pal .box, .qsheet, #qtoast .qt, #compose .hint { background:linear-gradient(180deg, var(--g-spec), transparent 46%), var(--g-solid) } /* menus and sheets hold text: a denser fill */
  ${RIM} { isolation:isolate }
  ${RIM.split(", ").map((s) => `${s}::before`).join(", ")} { content:""; position:absolute; inset:0; z-index:-1; border-radius:inherit; padding:1px; pointer-events:none; background:linear-gradient(155deg, var(--g-rim), var(--g-rim2) 32%, transparent 58%, var(--g-rim2) 88%, var(--g-rim)); -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude }
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))) { ${GLASS} { background:var(--elev) } }

  /* ---------- rooms rail (Grok Bot's sidebar: avatar rows, a search pill, you at the bottom) ---------- */
  #rail { display:flex; flex-direction:column; min-height:0; min-width:0; padding:10px 10px 0 }
  .rhead { display:flex; align-items:center; gap:4px; padding:4px 2px 12px 6px }
  .brand { display:flex; align-items:center; gap:10px; min-width:0; flex:1 }
  .brand .mark { width:32px; height:32px; border-radius:50%; background:var(--cta); color:var(--on-cta); display:grid; place-items:center; font-size:16px; flex:none }
  .brand .bt { min-width:0 }
  .brand h1 { font-size:14px; font-weight:600; margin:0; line-height:18px; white-space:nowrap }
  .brand .sub { color:var(--dim2); font-size:12px; line-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .brand .sub.bad { color:var(--bad) }
  .filter { position:relative; padding:0 2px 8px } .filter::before { content:""; position:absolute; left:15px; top:10px; width:16px; height:16px; background:var(--dim2); -webkit-mask:var(--m) center / contain no-repeat; mask:var(--m) center / contain no-repeat; --m:${svg(ICONS.search)} }
  .filter input { width:100%; height:36px; border-radius:999px; border-color:transparent; padding:0 14px 0 36px; font-size:13.5px }
  #rooms { overflow:auto; flex:1; margin:0 -4px; padding:2px 4px 16px }
  .run { margin-top:6px }
  .run > .rh { display:flex; align-items:center; gap:7px; padding:10px 10px 4px; font-size:12px; font-weight:500; color:var(--dim2); cursor:pointer; user-select:none }
  .run > .rh .n { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .run > .rh .c { font-weight:400 }
  .run > .rh .car { transition:transform .15s; font-size:8px; opacity:.8 } .run.closed > .rh .car { transform:rotate(-90deg) } .run.closed > .rl { display:none }
  .room { display:grid; grid-template-columns:40px minmax(0,1fr) auto; grid-template-rows:auto auto; column-gap:11px; row-gap:1px; align-items:center; width:100%; text-align:left; padding:8px 10px; border:0; border-radius:12px; background:transparent; margin:1px 0; color:var(--fg) }
  .room:hover { background:var(--hover) } .room.sel { background:var(--active) }
  .room .rav { grid-column:1; grid-row:1 / span 2; position:relative; width:40px; height:40px }
  .room .rav svg { width:40px; height:40px; display:block; overflow:visible }
  .room .st { position:absolute; right:-2px; bottom:-2px; width:13px; height:13px; border-radius:50%; border:2.5px solid var(--rail); background:var(--dim2) }
  .room .st.open { background:var(--ok) } .room .st.stalled { background:var(--warn) } .room .st.concluded { background:var(--acc) } .room .st.closed { display:none }
  .room .n { grid-column:2; grid-row:1; font-weight:500; font-size:14px; line-height:19px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .room .m { grid-column:2; grid-row:2; color:var(--dim2); font-size:13px; line-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .room .u { grid-column:3; grid-row:1 / span 2; background:var(--cta); color:var(--on-cta); font-size:11px; font-weight:600; border-radius:999px; padding:0 6px; min-width:18px; line-height:18px; text-align:center }
  .room .u.q { background:var(--active); color:var(--dim) }
  .rfoot { display:flex; align-items:center; gap:8px; padding:10px 2px 12px; border-top:1px solid var(--line2) }
  .btn.me { width:36px; height:36px; min-height:0; padding:0; border-radius:50%; background:var(--hu); font-size:12px; font-weight:600 }
  .policy { flex:1; min-width:0; height:36px; border:0; border-radius:999px; background:var(--panel); color:var(--fg); font-size:13px; padding:0 14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer } .policy:hover { background:var(--panel2) } .policy b { font-weight:600 }

  /* ---------- popovers (a Liquid Glass menu: icon rows, hairline separators, the destructive row last) ---------- */
  .pop { position:fixed; z-index:45; min-width:230px; max-width:min(340px, calc(100vw - 16px)); max-height:calc(100vh - 16px); overflow:auto; border-radius:18px; padding:6px }
  .pop[hidden] { display:none !important }
  .pop .pl { font-size:12px; color:var(--dim2); padding:6px 10px 4px; width:100% }
  .pop .sep { height:1px; background:var(--line); margin:6px 6px; width:calc(100% - 12px) }
  .pop .mi, #morepop .btn { display:flex; width:100%; justify-content:flex-start; gap:11px; min-height:36px; padding:0 10px; border-radius:11px; background:transparent; color:var(--fg); font-size:14px; font-weight:400; text-align:left }
  .pop .mi:hover, #morepop .btn:hover { background:var(--hover) } #morepop .btn.danger { color:var(--bad) }
  .pop [data-ic]::before { content:""; width:18px; height:18px; flex:none; background:currentColor; opacity:.85; -webkit-mask:var(--m) center / contain no-repeat; mask:var(--m) center / contain no-repeat }
  .pop input, .pop select { width:100%; height:36px; padding:0 12px; font-size:13.5px; margin:0 0 4px }
  #rctl, #lf { display:flex; flex-wrap:wrap; gap:6px; align-items:center }
  #rctl .pl, #lf .pl { padding:6px 4px 0 }
  #lf { width:330px; padding:10px }
  #mepop { width:260px; padding:10px } #mepop .mi { margin-top:2px }

  /* ---------- transcript: a centred column under a floating header and composer ---------- */
  #main { position:relative; min-height:0; min-width:0; overflow:hidden; margin:8px 8px 8px 0; border-radius:20px; box-shadow:0 0 0 1px var(--line2); background:radial-gradient(70% 55% at 88% -8%, var(--aura1), transparent 70%), radial-gradient(60% 45% at 6% 108%, var(--aura2), transparent 70%), var(--bg) }
  /* the room header and its catch-up digest are one floating glass panel */
  #top { position:absolute; z-index:5; top:12px; left:16px; right:calc(16px + var(--insp)); max-width:880px; margin-inline:auto; border-radius:22px }
  #head { padding:9px 8px 9px 10px; display:grid; grid-template-columns:auto minmax(0,1fr) auto; column-gap:10px; row-gap:1px; align-items:center }
  #head .hav { grid-column:1; grid-row:1 / span 2; width:36px; height:36px } #head .hav svg { width:36px; height:36px; display:block; overflow:visible }
  #head .t1 { grid-column:2; grid-row:1; display:flex; align-items:center; gap:6px; min-width:0; flex-wrap:wrap }
  #head .t1 .chip { max-width:100%; min-width:0; overflow:hidden; text-overflow:ellipsis } /* a long openings chip stays in its column, not under the buttons */
  #head h2 { margin:0 4px 0 0; font-size:15px; font-weight:600; line-height:22px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100% }
  #head .acts { grid-column:3; grid-row:1; display:flex; gap:2px; align-items:center }
  #head .topic { grid-column:2 / -1; color:var(--dim); font-size:13px; line-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; padding-right:6px }
  #head .topic.open { white-space:pre-wrap; max-height:40vh; overflow:auto }
  #log { position:absolute; inset:0; overflow:auto; overscroll-behavior:contain; scroll-behavior:auto;
    padding:calc(var(--headh, 64px) + 24px) calc(max(20px, (100% - var(--insp) - var(--colw)) / 2) + var(--insp)) calc(var(--comph, 64px) + 36px) max(20px, calc((100% - var(--insp) - var(--colw)) / 2)) }
  .day { text-align:center; color:var(--dim2); font-size:12px; line-height:16px; margin:22px 0 8px }
  .sys { display:flex; justify-content:center; padding:5px 0 }
  .sys span { font-size:12px; line-height:17px; color:var(--dim2); max-width:90%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .sys.notice span { color:var(--warn); white-space:normal; text-align:center }
  .sys.concl span { color:var(--ok); background:var(--ok-bg); border-radius:999px; padding:5px 14px; white-space:normal; text-align:center; font-weight:500 }
  .msg { position:relative; display:grid; grid-template-columns:28px minmax(0,1fr); column-gap:10px; padding-top:14px; border-radius:14px; scroll-margin:calc(var(--headh, 64px) + 24px) 0 calc(var(--comph, 64px) + 24px) }
  .msg.cont { padding-top:4px }
  .msg > .gut { grid-column:1; padding-top:1px } .msg > .mb { grid-column:2; min-width:0 }
  .msg.hl { animation:hl 1.6s ease-out } @keyframes hl { from { background:var(--acc-bg) } to { background:transparent } }
  .who { display:flex; align-items:baseline; gap:6px; margin:0 0 4px 3px; flex-wrap:wrap; font-size:13px; line-height:18px; min-height:18px; padding-right:112px }
  .who b { font-weight:600 } .who .t, .who .agent { color:var(--dim2); font-size:12px; font-variant-numeric:tabular-nums }
  .re { display:block; width:fit-content; max-width:100%; font-size:12.5px; line-height:17px; color:var(--dim2); margin:0 0 5px 4px; padding-left:9px; border-left:2px solid var(--line); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer }
  .re:hover { color:var(--fg) } .re i { font-style:normal }
  .body { width:fit-content; max-width:100%; background:var(--panel); border-radius:var(--radius); padding:7px 14px; white-space:pre-wrap; word-break:break-word; font-size:14.5px; line-height:22px; --clampbg:var(--panel) }
  .body.human { background:var(--hum-bg); --clampbg:var(--hum-bg) }
  .body.opening { box-shadow:inset 0 0 0 1px var(--line) }
  .mention { color:var(--acc-fg); font-weight:500 } .mention.me { background:var(--acc-bg); border-radius:5px; padding:0 3px }
  .msg.mine { grid-template-columns:minmax(0,1fr) } .msg.mine > .gut { display:none } .msg.mine > .mb { grid-column:1; display:flex; flex-direction:column; align-items:flex-end }
  .msg.mine .body { max-width:82%; background:var(--mine); color:var(--on-mine); --clampbg:var(--mine) } .msg.mine .mention { color:inherit; text-decoration:underline; text-underline-offset:2px } .msg.mine .mention.me { background:transparent }
  .msg.mine .re { margin-right:4px } .msg.mine .more { color:var(--dim) }
  .mact { position:absolute; z-index:2; top:6px; right:0; display:flex; align-items:center; gap:2px; height:26px; padding:0 3px 0 9px; border-radius:999px; font-size:11.5px; color:var(--dim2); opacity:0; transition:opacity .12s; pointer-events:none }
  .msg:hover > .mact, .msg:focus-within > .mact, .mact:has(.pinb.on) { opacity:1; pointer-events:auto }
  .msg.mine > .mact { right:auto; left:0 } .msg.cont > .mact { top:-2px }
  .mact .seq { font-family:var(--mono); font-size:11px; font-variant-numeric:tabular-nums; white-space:nowrap }
  .card { width:100%; max-width:640px; background:var(--panel); border-radius:20px; overflow:hidden; --clampbg:var(--panel) }
  .card .ch { display:flex; align-items:center; gap:11px; padding:12px 12px 0 12px }
  .card .cic { width:38px; height:38px; border-radius:12px; background:var(--panel2); display:grid; place-items:center; flex:none; color:var(--prop) }
  .card .ct { display:flex; flex-direction:column; min-width:0 } .card .ct b { font-size:14px; line-height:19px; font-weight:600 } .card .ct span { color:var(--dim2); font-size:12.5px; line-height:17px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .card .sp { flex:1 }
  .card .cb { padding:10px 16px 14px; white-space:pre-wrap; word-break:break-word; font-size:14px; line-height:21px }
  .card.challenge .cic { color:var(--chal) } .card.conclusion .cic { color:var(--ok) }
  .card.amend .cb { color:var(--dim); font-size:13.5px }
  .card.conclusion { background:var(--ok-bg); --clampbg:var(--ok-bg) } .card.conclusion .cic { background:color-mix(in srgb, var(--ok) 20%, var(--bg)) }
  .row { display:flex; align-items:center; gap:7px; font-size:13px; line-height:18px; color:var(--dim); padding:3px 0 3px 3px; flex-wrap:wrap; padding-right:112px }
  .row b { color:var(--fg); font-weight:500 }
  .row .v { width:20px; height:20px; border-radius:50%; display:grid; place-items:center; font-size:11px; font-weight:700; flex:none } .row .v.agree { background:var(--ok-bg); color:var(--ok) } .row .v.disagree { background:var(--bad-bg); color:var(--bad) } .row .v.abstain { background:var(--hover); color:var(--dim) }
  .row q { color:var(--fg); font-style:italic } .row q::before,.row q::after { content:'"' }
  .row .k { font-family:var(--mono); font-size:12px; color:var(--fg) } .row .t { color:var(--dim2); font-size:12px }
  .row .why { flex-basis:100%; color:var(--dim); font-size:13px; padding-left:27px }
  .qb { font-size:11px; font-weight:500; color:var(--dim); background:var(--hover); border-radius:999px; padding:0 7px }
  #newpill { position:absolute; z-index:6; left:calc((100% - var(--insp)) / 2); transform:translateX(-50%); bottom:calc(var(--comph, 64px) + 26px); border:0; border-radius:999px; padding:8px 15px; font-size:12.5px; font-weight:500; color:var(--fg); display:none }
  #compose { position:absolute; z-index:5; left:16px; right:calc(16px + var(--insp)); bottom:14px; max-width:var(--colw); margin-inline:auto; display:flex; flex-direction:column; gap:7px }
  #compose .quick { display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; padding:2px } #compose .quick::-webkit-scrollbar { display:none } #compose .quick:empty { display:none }
  #compose .quick button { flex:none; border:0; border-radius:999px; padding:0 12px; height:28px; font-size:12.5px; color:var(--dim) }
  #compose .quick button:hover { color:var(--fg) }
  #compose .cbar { position:relative; display:flex; align-items:flex-end; gap:4px; padding:6px; border-radius:26px }
  #compose .cbar:focus-within { box-shadow:0 0 0 1px var(--g-hair), 0 0 0 3px color-mix(in srgb, var(--acc) 40%, transparent), var(--g-shadow) }
  #compose textarea { flex:1; min-width:0; resize:none; min-height:40px; max-height:180px; border:0; background:transparent; padding:10px 6px; font-size:14.5px; line-height:20px }
  #compose textarea:focus { outline:none }
  #compose .btn.icon { width:40px; height:40px }
  .btn.send { width:40px; height:40px; min-height:0; padding:0; border-radius:50%; background:var(--cta); color:var(--on-cta) } .btn.send:hover { background:var(--cta); filter:brightness(.88) }
  #compose .hint { align-self:center; max-width:100%; font-size:12.5px; line-height:17px; color:var(--dim); text-align:center; padding:5px 14px; border-radius:999px } #compose .hint:empty { display:none } #compose .hint.bad { color:var(--bad) }

  /* ---------- inspector: a glass sheet with a segmented control ---------- */
  #inspect { position:fixed; z-index:20; top:12px; right:12px; bottom:12px; width:380px; border-radius:24px; display:flex; flex-direction:column; min-height:0; min-width:0; overflow:hidden }
  body.noinspect #inspect { display:none }
  @media (min-width:1101px) { body:not(.noinspect) { --insp:392px } }
  .ihead { display:flex; align-items:center; gap:6px; padding:10px 10px 8px 12px }
  .tabs { flex:1; display:flex; gap:2px; padding:3px; border-radius:13px; background:var(--hover) }
  .tabs button { flex:1; border:0; background:transparent; border-radius:10px; padding:6px 4px; font-size:13px; font-weight:500; color:var(--dim); display:flex; gap:5px; align-items:center; justify-content:center }
  .tabs button.on { background:var(--seg); color:var(--fg); box-shadow:0 1px 3px rgb(0 0 0 / .14) } .tabs button .n { font-size:11px; color:var(--dim2) } .tabs button .n:empty { display:none }
  #pane { overflow:auto; flex:1; padding:6px 14px 28px }
  .sec { margin-bottom:20px } .sec h3 { margin:0 0 8px; font-size:13px; font-weight:600; color:var(--fg); display:flex; align-items:center; gap:8px } .sec h3 .sp { flex:1 } .sec h3 .c { font-weight:400; font-size:12px; color:var(--dim2) }
  .pcard { border-radius:18px; background:var(--panel); padding:12px 14px; --clampbg:var(--panel) }
  .pcard.concl { background:var(--ok-bg); --clampbg:var(--ok-bg) }
  .pcard .meta { display:flex; gap:6px; flex-wrap:wrap; align-items:center; font-size:12.5px; color:var(--dim); margin-bottom:8px }
  .pcard .txt { white-space:pre-wrap; word-break:break-word; font-size:13.5px; line-height:20px }
  .tally { margin-top:12px } .tally .bar { display:flex; height:6px; border-radius:999px; overflow:hidden; background:var(--active) }
  .tally .bar i { display:block; height:100% } .tally .bar .a { background:var(--ok) } .tally .bar .d { background:var(--bad) } .tally .bar .ab { background:var(--dim2) }
  .tally .leg { display:flex; gap:12px; font-size:12px; color:var(--dim); margin-top:6px; flex-wrap:wrap } .tally .leg b { color:var(--fg); font-weight:600 }
  .blk { margin-top:10px; font-size:13px } .blk div { display:flex; gap:8px; padding:3px 0; align-items:baseline } .blk .chip { flex:none }
  .cl { border-left:2px solid var(--chal); padding:4px 0 4px 10px; margin-top:8px; font-size:13px } .cl .h { display:flex; gap:6px; align-items:center; margin-bottom:2px; font-weight:600 } .cl .o { color:var(--dim); white-space:pre-wrap }
  .vl { margin-top:10px; font-size:13px } .vl div { display:flex; gap:6px; align-items:baseline; padding:3px 0; flex-wrap:wrap } .vl .who { margin:0; padding:0; font-weight:600; font-size:13px; min-height:0 } .vl .r { flex-basis:100%; color:var(--dim); font-size:12.5px }
  .vote-row { display:flex; gap:8px; margin-top:14px } .vote-row .btn { flex:1; background:var(--panel2) } .vote-row .btn:hover { background:var(--active) }
  .person { display:grid; grid-template-columns:32px minmax(0,1fr) auto; gap:10px; align-items:center; padding:8px; margin:0 -8px; border-radius:12px; cursor:pointer }
  .person:hover { background:var(--hover) } .person.sel { background:var(--active) } .person.off { opacity:.7 } .person.off .av { filter:grayscale(1) }
  .person .av { width:32px; height:32px }
  .pacts { display:flex; flex-direction:column; gap:4px; align-self:start }
  .mini { border:0; background:var(--panel2); color:var(--dim); border-radius:999px; padding:3px 10px; font-size:12px; line-height:1.4; font-weight:500; white-space:nowrap }
  .mini:hover { color:var(--fg); background:var(--active) } .mini.warn:hover { color:var(--bad) }
  .person .pm { min-width:0 } .person .n { font-weight:600; font-size:13.5px; display:flex; gap:6px; align-items:baseline; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .person .n .agent { font-weight:400; color:var(--dim2); font-size:12px }
  .person .a { color:var(--acc-fg); font-size:12px; overflow:hidden; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical } .person .a:empty::before { content:"no claimed area"; color:var(--dim2) }
  .person .s { font-size:12px; color:var(--dim2); font-variant-numeric:tabular-nums; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .person .s .tl { color:var(--fg); font-weight:600 }
  .act { position:relative; grid-column:1 / -1; font-size:12px; font-family:var(--mono); padding:6px 4px 6px 42px; color:var(--dim); max-height:260px; overflow:auto; white-space:pre-wrap; word-break:break-word; cursor:auto } .act .st { color:var(--dim2) } .act .tl { color:var(--fg); font-weight:600 }
  .act .now { color:var(--fg); margin:0 0 6px; padding:6px 10px; border-radius:10px; background:var(--panel) } .act .now.live { background:var(--ok-bg) } .act .now.off { font-style:italic }
  .act .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--ok); margin-right:6px; vertical-align:1px; animation:actpulse 1.4s ease-in-out infinite } @keyframes actpulse { 50% { opacity:.25 } }
  .act .hdr { color:var(--dim2); margin:2px 0 3px; font-family:inherit } .act .latest { color:var(--fg) }
  .bsearch { width:100%; margin-bottom:10px; font-size:13.5px; height:36px; padding:0 14px; border-radius:999px }
  .bgroup { margin-bottom:14px }
  .bentry { border-radius:14px; margin-bottom:6px; background:var(--panel); --clampbg:var(--panel) }
  .bentry .bh { display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:pointer; font-size:13px } .bentry .bh .k { font-family:var(--mono); font-weight:600; font-size:12px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .bentry .bh .m { color:var(--dim2); font-size:12px; white-space:nowrap }
  .bentry .bb { display:none; padding:8px 12px 10px; font-size:13px; white-space:pre-wrap; word-break:break-word; border-top:1px solid var(--line2) }
  .bentry.open .bb { display:block }
  .bentry .bh .pre { font-size:11px; font-weight:500; padding:0 7px; line-height:18px; border-radius:999px; background:var(--panel2); color:var(--dim) }
  .bentry.claim .pre { color:var(--acc-fg) } .bentry.verify .pre { color:var(--ok) } .bentry.hold .pre { color:var(--bad) } .bentry.inbox .pre { color:var(--warn) }
  .stat { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px }
  .stat div { background:var(--panel); border-radius:16px; padding:10px 12px } .stat b { display:block; font-size:19px; font-weight:600; line-height:24px } .stat span { font-size:12px; color:var(--dim2) }
  .hbar { display:grid; grid-template-columns:110px 1fr auto; gap:8px; align-items:center; font-size:12.5px; padding:3px 0 } .hbar i { display:block; height:6px; background:var(--acc); border-radius:999px; opacity:.85 } .hbar .l { color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap } .hbar .v { font-variant-numeric:tabular-nums; color:var(--dim) }
  table.t { width:100%; border-collapse:collapse; font-size:12.5px } table.t td { padding:5px 0; border-bottom:1px solid var(--line2); vertical-align:top } table.t td:last-child { text-align:right; font-variant-numeric:tabular-nums; color:var(--dim); white-space:nowrap } table.t td.r { color:var(--dim); font-size:12px }
  .toolbar { display:flex; gap:10px; font-size:12.5px; color:var(--dim); margin-top:12px; flex-wrap:wrap } .toolbar label { display:flex; align-items:center; gap:6px; cursor:pointer }

  /* ---------- accessibility ---------- */
  @media (prefers-reduced-transparency:reduce), (prefers-contrast:more) {
    ${GLASS} { background:var(--elev) !important; -webkit-backdrop-filter:none !important; backdrop-filter:none !important }
    #pal, #qpanel { -webkit-backdrop-filter:none !important; backdrop-filter:none !important }
  }
  @media (prefers-contrast:more) { ${GLASS} { box-shadow:0 0 0 1px var(--fg) !important } }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; scroll-behavior:auto !important } }
  @media (forced-colors:active) {
    ${GLASS} { background:Canvas !important; box-shadow:none !important; border:1px solid CanvasText; -webkit-backdrop-filter:none; backdrop-filter:none }
    ${RIM.split(", ").map((s) => `${s}::before`).join(", ")} { display:none }
    .room.sel, .chip.tog.on, .tabs button.on, .person.sel { outline:2px solid Highlight; outline-offset:-2px }
  }

  /* ---------- tablet: the inspector slides over the transcript ---------- */
  #tabbar { display:none }
  @media (max-width:1100px) {
    body { grid-template-columns:272px minmax(0,1fr) }
    #inspect { width:min(400px, calc(100vw - 24px)); transform:translateX(calc(100% + 24px)); visibility:hidden; transition:transform .2s ease-out, visibility .2s; display:flex !important }
    body.inspect-open #inspect { transform:none; visibility:visible }
  }
  /* ---------- phone: one view at a time and a floating glass tab bar ---------- */
  @media (max-width:720px) {
    body { grid-template-columns:100% }
    #rail, #main { grid-row:1; grid-column:1; display:none } body[data-view="rooms"] #rail { display:flex } body[data-view="chat"] #main { display:block }
    #rail { padding-bottom:84px } #main { margin:0; border-radius:0; box-shadow:none }
    #inspect { inset:0; width:auto; border-radius:0; transform:none; transition:none; display:none !important; padding-bottom:84px } body[data-view="inspect"] #inspect { display:flex !important; visibility:visible }
    #tabbar { position:fixed; z-index:30; left:12px; right:12px; bottom:calc(10px + env(safe-area-inset-bottom)); height:58px; border-radius:29px; display:grid; grid-template-columns:repeat(3,1fr); padding:5px }
    #tabbar button { border:0; background:transparent; border-radius:24px; font-size:12.5px; font-weight:500; color:var(--dim); display:flex; align-items:center; justify-content:center; gap:6px }
    #tabbar button.on { background:var(--active); color:var(--fg) } #tabbar button .n { font-size:11px; background:var(--cta); color:var(--on-cta); border-radius:999px; padding:0 6px; line-height:17px }
    #top { top:8px; left:8px; right:8px; border-radius:20px } #head { grid-template-columns:minmax(0,1fr) auto; padding-left:14px } #head .acts .hidephone { display:none }
    #head .hav { display:none } #head .t1 { grid-column:1 } #head .acts { grid-column:2 } #head .topic, #main #pinstrip { grid-column:1 / -1 }
    #compose { left:8px; right:8px; bottom:calc(80px + env(safe-area-inset-bottom)) }
    #log { padding-left:12px; padding-right:12px }
    .who, .row { padding-right:0 } .msg.mine .body { max-width:90% }
  }
`;
