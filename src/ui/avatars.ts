/**
 * Agent and room avatars, spliced into the dashboard's IIFE by src/ui.ts (it uses that scope's hsh and esc).
 * Grok Bot draws each agent as a body shape with an eye mask in one colour (its renderer's avatar SVG builder, Grok Bot
 * 0.75.8); these are the same idea in our own shapes: one of nine bodies and one of ten colours, both picked from the name,
 * so a seat reads the same in every room and in the rail, and a room's avatar is stable as seats come and go.
 */
export const AVATAR_JS = `
  // Avatars as Grok Bot draws its agents: a body shape and two eyes, the shape and colour picked from the name, so a seat
  // (or a room, in the rail) looks the same everywhere. A human is their initials on a grey disc.
  var CR_SHAPES = [
    ['<path d="M16 3c7.5 0 13 5.6 13 13.2C29 23.6 23.4 29 16 29S3 23.6 3 16.2C3 8.6 8.5 3 16 3z"/>', 12.4, 19.6, 14.6],
    ['<path d="M16 3c6.2 0 11 8.2 11 15.6C27 25 22.2 29 16 29S5 25 5 18.6C5 11.2 9.8 3 16 3z"/>', 12.8, 19.2, 16.5],
    ['<path d="M5 15.5C5 8.6 9.9 3 16 3s11 5.6 11 12.5v12.1c0 .9-1 1.3-1.6.7L23 26.2l-2.4 2.1a1 1 0 0 1-1.3 0L16 25.6l-3.3 2.7a1 1 0 0 1-1.3 0L9 26.2l-2.4 2.1c-.6.6-1.6.2-1.6-.7z"/>', 12.3, 19.7, 14.5],
    ['<path stroke-width="3.5" stroke-linejoin="round" d="M16 5l3.7 6.9 7.7 1.4-5.4 5.6 1.1 7.8-7.1-3.4-7.1 3.4 1.1-7.8-5.4-5.6 7.7-1.4z"/>', 13.6, 18.4, 16.5],
    ['<path d="M16 3.5s10.5 9.8 10.5 16.5a10.5 10.5 0 0 1-21 0C5.5 13.3 16 3.5 16 3.5z"/>', 12.6, 19.4, 19.5],
    ['<path d="M16 4c9.4 0 12 2.6 12 12s-2.6 12-12 12S4 25.4 4 16 6.6 4 16 4z"/>', 12.4, 19.6, 15],
    ['<circle cx="16" cy="16" r="9"/><circle cx="16" cy="7.5" r="5"/><circle cx="24" cy="13" r="5"/><circle cx="21" cy="23" r="5"/><circle cx="11" cy="23" r="5"/><circle cx="8" cy="13" r="5"/>', 13, 19, 16],
    ['<circle cx="11" cy="18.5" r="6.5"/><circle cx="18.5" cy="13.5" r="8"/><circle cx="23.5" cy="20" r="5.5"/><rect x="5" y="19" width="22.5" height="7.5" rx="3.75"/>', 14.6, 20.4, 17],
    ['<path d="M9.5 6.5c4.6-4 12.3-2.6 15.5 2.6 3.4 5.6 2.6 13.8-3.2 17.3-5.4 3.2-13.6 2.6-16.4-3.6-1.8-4.1.5-6.5 1.6-9.5.8-2.3.1-4.6 2.5-6.8z"/>', 13.5, 19.5, 14.5]
  ];
  var CR_FILL = ['#f2f2f2', '#f26b5b', '#d29257', '#7cb7f5', '#6fd3a2', '#b9a1f7', '#f5d36b', '#f59ac4', '#5ccfc4', '#f59a4f'];
  function creature(name) {
    var h = hsh(String(name)), s = CR_SHAPES[h % CR_SHAPES.length], f = CR_FILL[Math.floor(h / CR_SHAPES.length) % CR_FILL.length];
    var eye = function (x) { return '<ellipse cx="' + x + '" cy="' + s[3] + '" rx="1.5" ry="2.2"/>'; };
    return '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g fill="' + f + '" stroke="' + f + '" stroke-width="0">' + s[0] + '</g><g fill="#1c1c1c">' + eye(s[1]) + eye(s[2]) + '</g></svg>';
  }
`;
