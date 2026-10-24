'use strict';
/* critique-typo-o.js -- derives the recommended numbers from measured constants.
   Constants come from measurement (see a..n JSON): 
     avgCharsPerPx  -- characters (incl. spaces) per px of column width
     hanPerPx       -- Han glyphs per px (1em = 16px => 1/16)
   Nothing here touches the site. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* measured: dialogs 848.81px -> 124 chars ; longpage 915.03px -> 132 chars */
const AVG = ((848.81 / 124) + (915.03 / 132)) / 2;   // px per character
const GLYPH_RATIO = 106 / 124;                        // glyphs / all chars
const EM = 16;

const hex = (h) => { const m = String(h).match(/^#([0-9a-f]{6})$/i); return m ? { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) } : null; };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const cr = (a, b) => { const A = hex(a), B = hex(b); if (!A || !B) return null; const L1 = lum(A), L2 = lum(B); return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100; };

const cands = [34, 36, 38, 40, 42, 44, 46, 48, 50, 53];
const rows = cands.map((rem) => {
  const px = rem * 16;
  const chars = px / AVG;
  return {
    rem: rem, px: px,
    chUnits: Math.round((px / 8.63) * 10) / 10,
    charsPerLine: Math.round(chars),
    glyphsPerLine: Math.round(chars * GLYPH_RATIO),
    hanPerLine: Math.round(px / EM),
    whitespace1440Toc: Math.round((900 - px) / 2),
    whitespace1440NoToc: Math.round((948.81 - px) / 2),
    cutVsCurrentToc: Math.round((1 - px / 848.81) * 100),
  };
});

console.log('px/char =', AVG.toFixed(3), ' glyph ratio =', GLYPH_RATIO.toFixed(3));
console.log('\nrem  px    ch    chars  glyphs  han  ws@1440toc  ws@1440noToc  cut%');
for (const r of rows) console.log([String(r.rem).padStart(3), String(r.px).padStart(4), String(r.chUnits).padStart(6), String(r.charsPerLine).padStart(6), String(r.glyphsPerLine).padStart(7), String(r.hanPerLine).padStart(4), String(r.whitespace1440Toc).padStart(11), String(r.whitespace1440NoToc).padStart(13), String(r.cutVsCurrentToc).padStart(5)].join(' '));

/* current state table */
console.log('\ncurrent (measured):');
console.log('  1440 + TOC   article 848.81 -> 124 chars / 53 Han');
console.log('  1440 no TOC  article 948.81 -> 138 chars / 59 Han');
console.log('  1280 + TOC   article 688.81 -> 100 chars / 43 Han');
console.log('  1025 + TOC   article 433.81 ->  63 chars / 27 Han');

/* light-mode code token replacements that reach 4.5:1 on #fbfbfd */
const BG = '#fbfbfd';
const LIGHT_FIX = {
  'hljs-string': ['#3f8f4f', '#2f7a3f'],
  'hljs-built_in': ['#b06f00', '#8a5600'],
  'hljs-meta': ['#b06f00', '#8a5600'],
  'hljs-number': ['#986801', '#7d5500'],
  'hljs-comment': ['#6b7280', '#5b6270'],
  'hljs-type': ['#3b6fd4', '#2f5fb8'],
};
console.log('\nlight code tokens on ' + BG + ':');
for (const k of Object.keys(LIGHT_FIX)) {
  const [oldC, newC] = LIGHT_FIX[k];
  console.log('  ', k.padEnd(14), oldC, String(cr(oldC, BG)).padStart(5), '->', newC, String(cr(newC, BG)).padStart(5));
}

/* dark-mode auto fix: reuse the existing dark palette values */
const DARKBG = '#171a1f';
const DARK = { 'hljs-keyword': '#d2a8ff', 'hljs-string': '#7ee787', 'hljs-title': '#79c0ff', 'hljs-built_in': '#ffa657', 'hljs-variable': '#ffa657', 'hljs-comment': '#8b95a5', 'hljs-number': '#ffab70' };
console.log('\ndark tokens on ' + DARKBG + ' (already in site.css, only reachable via data-theme="dark"):');
for (const k of Object.keys(DARK)) console.log('  ', k.padEnd(14), DARK[k], String(cr(DARK[k], DARKBG)).padStart(5));

/* UI boundary suggestion: 3:1 against #ffffff and #14161a */
const pick = (bg, target) => {
  for (let v = 0x33; v <= 0xff; v++) {
    const c = '#' + [v, v, v].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (cr(c, bg) >= target) return c;
  }
  return null;
};
console.log('\n3:1 boundary greys: on #ffffff ->', pick('#ffffff', 3), '(cr', cr(pick('#ffffff', 3), '#ffffff'), ') on #f7f8fa ->', pick('#f7f8fa', 3), '(cr', cr(pick('#f7f8fa', 3), '#f7f8fa'), ')');
console.log('  (dark) on #14161a ->', pick('#14161a', 3), '(cr', cr(pick('#14161a', 3), '#14161a'), ') on #191c21 ->', pick('#191c21', 3), '(cr', cr(pick('#191c21', 3), '#191c21'), ')');

/* link vs body text: needs 3:1 if underline is absent */
const linkRows = [
  { mode: 'light', link: '#1d4ed8', text: '#1c1f26' },
  { mode: 'dark', link: '#7aa2ff', text: '#e6e8ec' },
  { mode: 'light-fix', link: '#1a44c2', text: '#1c1f26' },
  { mode: 'dark-fix', link: '#5b8df0', text: '#e6e8ec' },
];
console.log('\nlink colour vs body text (WCAG 1.4.1: >=3 if no underline):');
for (const r of linkRows) console.log('  ', r.mode.padEnd(10), r.link, 'vs', r.text, String(cr(r.link, r.text)).padStart(5), cr(r.link, r.text) >= 3 ? 'PASS' : 'FAIL', '| link on bg', String(cr(r.link, r.mode.indexOf('dark') >= 0 ? '#14161a' : '#ffffff')).padStart(5));

fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'o-derived.json'), JSON.stringify({ avgCharsPerPx: AVG, glyphRatio: GLYPH_RATIO, rows, lightFix: LIGHT_FIX, dark: DARK, linkRows }, null, 1), 'utf8');
