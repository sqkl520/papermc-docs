'use strict';
/* critique-typo-u.js -- final numbers for the report: width ladder in measured chars,
   empty-space arithmetic, link colour candidates, boundary greys, heading ladder.
   Pure computation on measured constants (px/char from t-measure + s-schemes). */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* measured px per character (incl. spaces), full lines, per page @1440 */
const PX_PER_CHAR = 7.38;   /* dialogs 848.81/115, longpage 948.81/117 -> 8.11, tuning 848.81/117 -> 7.25; use dialogs which is the median */
const PX_PER_CHAR_LO = 7.02; /* synthetic probe calibration (s-schemes: 603.75px -> 86 chars) */

const hex = (h) => { const m = String(h).match(/^#([0-9a-f]{6})$/i); return m ? { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) } : null; };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const cr = (a, b) => { const A = hex(a), B = hex(b); if (!A || !B) return null; const L1 = lum(A), L2 = lum(B); return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100; };
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

console.log('=== 1. width ladder (measured chars/line) ===');
console.log('rem   px    chars@7.38  chars@7.02   slack@1440+TOC(900)  slack@1440 noTOC(1000)  codeScrollCost');
[30, 32, 34, 36, 38, 40, 42, 44, 46, 48].forEach((rem) => {
  const px = rem * 16;
  console.log([
    String(rem).padStart(3),
    String(px).padStart(4),
    String(Math.round(px / PX_PER_CHAR)).padStart(10),
    String(Math.round(px / PX_PER_CHAR_LO)).padStart(11),
    (px + 'px (' + Math.round((900 - px) / 900 * 100) + '% empty)').padStart(21),
    (px + 'px (' + Math.round((1000 - px) / 1000 * 100) + '% empty)').padStart(23),
  ].join('  '));
});

console.log('\n=== 2. current measured (chars/line, full lines) ===');
const CUR = [
  ['1440 + TOC', 848.81, 115, 126, 900],
  ['1440 no TOC', 948.81, 117, 135, 1000],
  ['1280 + TOC', 688.81, 92, 100, 740],
  ['1280 no TOC', 938.81, 116, 130, 990],
  ['1200 + TOC', 608.81, 86, null, 660],
  ['1025 + TOC', 433.81, 57, 64, 485],
  ['1024 no TOC', 692.81, 92, 103, 744],
  ['768', 716.81, 96, 103, 768],
  ['390', 358, 47, 53, 390],
  ['320', 288, 38, 42, 320],
];
for (const [label, w, med, max, area] of CUR) {
  console.log('  ' + label.padEnd(14) + String(w).padStart(8) + 'px  median ' + String(med).padStart(4) + 'ch  max ' + String(max).padStart(4) + 'ch  of ' + String(area).padStart(5) + 'px area = ' + String(Math.round(w / area * 100)).padStart(3) + '% filled');
}
console.log('  cliff 1024->1025: 692.81 -> 433.81 px = ' + Math.round((433.81 / 692.81 - 1) * 100) + '% ; chars 92 -> 57 = ' + Math.round((57 / 92 - 1) * 100) + '%');

console.log('\n=== 3. TOC breakpoint arithmetic ===');
[1025, 1100, 1160, 1200, 1280].forEach((vw) => {
  const area = vw - 290 - 250;
  const art = area - 51.2;
  console.log('  vw ' + String(vw).padStart(4) + ' with TOC: grid ' + String(area).padStart(4) + 'px, article ' + art.toFixed(1).padStart(6) + 'px -> ' + String(Math.round(art / PX_PER_CHAR)).padStart(3) + 'ch  ' + (art >= 576 ? '(>= 36rem OK)' : '(BELOW 36rem: squeezed)'));
});

console.log('\n=== 4. link colour band (WCAG 1.4.1 need >=3 vs #1c1f26, and >=4.5 vs #ffffff) ===');
const cands = ['#1d4ed8', '#1a44c2', '#1e40af', '#2b4fc7', '#3355c8', '#3b5bdb', '#2563eb', '#1f4bb8'];
for (const c of cands) console.log('  ' + c + '  vs text #1c1f26 = ' + String(cr(c, '#1c1f26')).padStart(5) + '  vs #ffffff = ' + String(cr(c, '#ffffff')).padStart(5) + '  ' + (cr(c, '#1c1f26') >= 3 && cr(c, '#ffffff') >= 4.5 ? 'BOTH OK' : 'fails one'));

console.log('\n=== 5. lightest boundary grey with >=3:1 ===');
[['#ffffff', 'light bg'], ['#f7f8fa', 'light bg-soft'], ['#fbfbfd', 'code bg'], ['#14161a', 'dark bg'], ['#191c21', 'dark bg-soft']].forEach(([bg, name]) => {
  let found = null;
  for (let v = 0x30; v <= 0xff; v++) { const c = toHex(v, v, v); if (cr(c, bg) >= 3) { found = c; break; } }
  /* for dark backgrounds we need a light grey: scan downwards from white */
  if (name.indexOf('dark') === 0) {
    for (let v = 0xff; v >= 0; v--) { const c = toHex(v, v, v); if (cr(c, bg) >= 3) { found = c; break; } }
  }
  console.log('  ' + name.padEnd(14) + bg + ' -> ' + found + ' (cr ' + cr(found, bg) + ')');
});

console.log('\n=== 6. heading ladder (current vs proposed) ===');
const CURH = { h1: 28.8, h2: 22.4, h3: 18.56, h4: 16.32, h5: 15.2, h6: 15.2, body: 16 };
const PROPH = { h1: 32, h2: 24, h3: 20, h4: 17, h5: 16, h6: 14, body: 16 };
console.log('  level  current  ratio   proposed  ratio');
const lv = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body'];
for (let i = 1; i < lv.length; i++) {
  const c = CURH[lv[i - 1]] / CURH[lv[i]];
  const p = PROPH[lv[i - 1]] / PROPH[lv[i]];
  console.log('  ' + lv[i].padEnd(6) + String(CURH[lv[i]]).padStart(6) + 'px' + c.toFixed(3).padStart(8) + String(PROPH[lv[i]]).padStart(8) + 'px' + p.toFixed(3).padStart(7));
}
console.log('  h1/body current ' + (CURH.h1 / 16).toFixed(2) + '  proposed ' + (PROPH.h1 / 16).toFixed(2));
console.log('  h4 - body = ' + (CURH.h4 - 16).toFixed(2) + 'px (current) ; h5 - body = ' + (CURH.h5 - 16).toFixed(2) + 'px ; h5 == h6: ' + (CURH.h5 === CURH.h6));

console.log('\n=== 7. line heights ===');
console.log('  body 1.70 (16 -> 27.2px) ; h1 1.25 ; h2-h6 1.35 ; code 1.55 (13.6 -> 21.08px) ; toc link 1.45');
console.log('  baseline grid: 27.2px body line; 576px column at 80 chars');
console.log('  headings on 27.2 grid? h2 line 30.24px = 1.111 lines ; h3 25.06 = 0.921 lines');
