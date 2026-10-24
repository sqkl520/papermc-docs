'use strict';
/* critique-typo-v.js -- correct boundary-grey derivation + final per-viewport width table.
   For a light background: the LIGHTEST grey still reaching 3:1.
   For a dark background: the DARKEST grey still reaching 3:1. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const hex = (h) => { const m = String(h).match(/^#([0-9a-f]{6})$/i); return m ? { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) } : null; };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const cr = (a, b) => { const A = hex(a), B = hex(b); if (!A || !B) return null; const L1 = lum(A), L2 = lum(B); return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100; };
const g = (v) => '#' + [v, v, v].map((x) => x.toString(16).padStart(2, '0')).join('');

console.log('=== minimal grey that reaches 3:1 (WCAG 1.4.11) ===');
const targets = [
  ['light bg', '#ffffff', 'light'],
  ['light bg-soft', '#f7f8fa', 'light'],
  ['light bg-elev', '#f2f3f7', 'light'],
  ['code bg', '#fbfbfd', 'light'],
  ['dark bg', '#14161a', 'dark'],
  ['dark bg-soft', '#191c21', 'dark'],
  ['dark bg-elev', '#20242b', 'dark'],
  ['dark code bg', '#171a1f', 'dark'],
];
let darkMin = null, lightMin = null;
for (const [name, bg, kind] of targets) {
  let found = null;
  if (kind === 'light') { for (let v = 0xff; v >= 0; v--) { if (cr(g(v), bg) >= 3) { found = g(v); break; } } }
  else { for (let v = 0x00; v <= 0xff; v++) { if (cr(g(v), bg) >= 3) { found = g(v); break; } } }
  console.log('  ' + name.padEnd(15) + bg + ' -> ' + found + '  cr ' + String(cr(found, bg)).padStart(5));
  if (kind === 'light') { if (!lightMin || parseInt(found.slice(1, 3), 16) < parseInt(lightMin.slice(1, 3), 16)) lightMin = found; }
  else { if (!darkMin || parseInt(found.slice(1, 3), 16) > parseInt(darkMin.slice(1, 3), 16)) darkMin = found; }
}
console.log('  => one token that works for all light surfaces: ' + lightMin + ' ; all dark surfaces: ' + darkMin);

/* also 4.5:1 "text-like" stronger border for focus/active affordances */
console.log('\n=== minimal grey reaching 4.5:1 (for text-adjacent strokes) ===');
[['#ffffff', 'light'], ['#14161a', 'dark']].forEach(([bg, kind]) => {
  let found = null;
  if (kind === 'light') { for (let v = 0xff; v >= 0; v--) { if (cr(g(v), bg) >= 4.5) { found = g(v); break; } } }
  else { for (let v = 0; v <= 0xff; v++) { if (cr(g(v), bg) >= 4.5) { found = g(v); break; } } }
  console.log('  ' + bg + ' -> ' + found + ' cr ' + cr(found, bg));
});

console.log('\n=== final width table (what the report will claim) ===');
const PX_PER_CHAR = 7.38;
const rows = [
  ['1440x900', '/paper/dev/dialogs/', 900, 848.81, 115, 126, true],
  ['1440x900', '/paper/reference/world-configuration/', 1000, 948.81, 117, 135, false],
  ['1440x900', '/velocity/tuning/', 900, 848.81, 117, 125, true],
  ['1440x900', '/all-pages.html', 1000, 1000, null, null, false],
  ['1280x800', '/paper/dev/dialogs/', 740, 688.81, 92, 100, true],
  ['1280x800', '/paper/reference/world-configuration/', 990, 938.81, 116, 130, false],
  ['1025x900', '/paper/dev/dialogs/', 485, 433.81, 57, 64, true],
  ['1025x900', '/paper/reference/world-configuration/', 735, 683.81, 82, 92, false],
  ['1024x900', '/paper/dev/dialogs/', 744, 692.81, 92, 103, false],
  ['768x1024', '/paper/dev/dialogs/', 768, 716.81, 96, 103, true],
  ['390x844', '/paper/dev/dialogs/', 390, 358, 47, 53, true],
  ['320x568', '/paper/dev/dialogs/', 320, 288, 38, 42, true],
];
console.log('vp        page                                  area  article  fill%  med  max  em(16px)');
for (const [vp, page, area, art, med, max, toc] of rows) {
  console.log([vp.padEnd(9), page.padEnd(38), String(area).padStart(5), String(art).padStart(8),
    String(Math.round(art / area * 100)).padStart(5), String(med === null ? '-' : med).padStart(5),
    String(max === null ? '-' : max).padStart(4), (art / 16).toFixed(1).padStart(8) + 'em' + (toc ? '  [toc]' : '')].join(' '));
}

console.log('\n=== proposed: measure tokens per breakpoint ===');
const PROP = [
  ['< 640px', '100%', '39-47ch @ 288-358px', 'unchanged (already 38-47ch)'],
  ['640-1023px', '100%', '87-96ch', 'cannot fix without gutters; 96ch at 768 is the worst tablet case'],
  ['1024-1199px', 'min(42rem, 74ch)', '91ch max', 'TOC hidden here anyway'],
  ['>= 1200px + TOC', 'min(42rem, 74ch)', '91ch max', 'grid 290/1fr/250 leaves 660px at 1200 -> fits'],
  ['>= 1200px no TOC', 'min(42rem, 74ch)', '91ch max', 'centred, 330px slack at 1440'],
];
for (const r of PROP) console.log('  ' + r[0].padEnd(18) + r[1].padEnd(20) + r[2].padEnd(26) + r[3]);
