'use strict';
/* critique-typo-l.js -- contrast computation from the live design tokens (WCAG 2.2 formulas).
   Output: tables/contrast.md-free JSON used by the report. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const hex = (h) => {
  const m = String(h).trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
};
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const cr = (a, b) => {
  const A = hex(a), B = hex(b);
  if (!A || !B) return null;
  const L1 = lum(A), L2 = lum(B);
  return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
};

const T = {
  light: { bg: '#ffffff', bgSoft: '#f7f8fa', bgElev: '#f2f3f7', codeBg: '#fbfbfd', fg: '#1c1f26', fgMuted: '#5c6470', border: '#e2e5ea', borderStrong: '#cdd2da', accent: '#1d4ed8', accentSoft: '#e3ebfd' },
  dark: { bg: '#14161a', bgSoft: '#191c21', bgElev: '#20242b', codeBg: '#171a1f', fg: '#e6e8ec', fgMuted: '#9aa3af', border: '#2a2f38', borderStrong: '#3a414d', accent: '#7aa2ff', accentSoft: '#1d2634' },
};

const rows = [];
for (const mode of ['light', 'dark']) {
  const t = T[mode];
  const defs = [
    ['正文 fg / bg', t.fg, t.bg, 4.5],
    ['正文 fg / bg-soft（侧栏）', t.fg, t.bgSoft, 4.5],
    ['次要 fg-muted / bg', t.fgMuted, t.bg, 4.5],
    ['次要 fg-muted / bg-soft', t.fgMuted, t.bgSoft, 4.5],
    ['次要 fg-muted / bg-elev', t.fgMuted, t.bgElev, 4.5],
    ['链接 accent / bg', t.accent, t.bg, 4.5],
    ['链接 accent / bg-soft', t.accent, t.bgSoft, 4.5],
    ['行内码 fg / bg-elev', t.fg, t.bgElev, 4.5],
    ['代码 fg / code-bg', t.fg, t.codeBg, 4.5],
    ['边框 border / bg', t.border, t.bg, 3.0],
    ['边框 border / bg-soft', t.border, t.bgSoft, 3.0],
    ['强边框 border-strong / bg', t.borderStrong, t.bg, 3.0],
    ['accent-soft 底 / bg', t.accentSoft, t.bg, 1.0],
  ];
  for (const [what, a, b, need] of defs) rows.push({ mode, what, a, b, need, cr: cr(a, b), pass: cr(a, b) >= need });
}

/* highlight.js tokens, measured live earlier (light/dark/auto-dark) */
const HLJS = {
  light: { type: ['#3b6fd4', 4.61], variable: ['#c2410c', 5.01], string: ['#3f8f4f', 3.87], meta: ['#b06f00', 3.97], keyword: ['#a626a4', 5.92], title: ['#3b6fd4', 4.61], comment: ['#6b7280', 4.68], number: ['#986801', 4.71], literal: ['#a626a4', 5.92], built_in: ['#b06f00', 3.97] },
  dark: { type: ['#79c0ff', 8.97], variable: ['#ffa657', 9.01], string: ['#7ee787', 11.35], meta: ['#ffa657', 9.01], keyword: ['#d2a8ff', 8.96], title: ['#79c0ff', 8.97], comment: ['#8b95a5', 5.76], number: ['#ffab70', 9.39], literal: ['#d2a8ff', 8.96], built_in: ['#ffa657', 9.01] },
  autoDark: { type: ['#3b6fd4', 3.66], variable: ['#c2410c', 3.37], string: ['#3f8f4f', 4.36], meta: ['#b06f00', 4.25], keyword: ['#a626a4', 2.85], title: ['#3b6fd4', 3.66], comment: ['#6b7280', 3.61], number: ['#986801', 3.58], literal: ['#a626a4', 2.85], built_in: ['#b06f00', 4.25] },
};

/* verify the auto-dark numbers by recomputing token-on-#171a1f */
const autoRows = Object.keys(HLJS.light).map((k) => {
  const fg = HLJS.light[k][0];
  return { token: k, fg, bg: '#171a1f', cr: cr(fg, '#171a1f'), pass: cr(fg, '#171a1f') >= 4.5 };
});

/* suggested replacement tokens that reach AA on #171a1f */
const SUGGEST = {
  keyword: '#e9a0e9', string: '#8fd694', title: '#8ab4f8', built_in: '#e0a24b', variable: '#f08a5d', comment: '#9aa3af', number: '#d9a441',
};
const sugRows = Object.keys(SUGGEST).map((k) => ({ token: k, fg: SUGGEST[k], bg: '#171a1f', cr: cr(SUGGEST[k], '#171a1f') }));

const out = { rows, hljs: HLJS, autoDarkRecomputed: autoRows, suggestions: sugRows };
fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'l-contrast.json'), JSON.stringify(out, null, 1), 'utf8');

for (const r of rows) console.log([r.mode.padEnd(5), r.what.padEnd(28), String(r.cr).padStart(6), r.need, r.pass ? 'PASS' : 'FAIL'].join(' '));
console.log('\nauto-dark recomputed:');
for (const r of autoRows) console.log('  ', r.token.padEnd(10), r.fg, String(r.cr).padStart(6), r.pass ? 'PASS' : 'FAIL');
console.log('\nsuggested AA tokens on #171a1f:');
for (const r of sugRows) console.log('  ', r.token.padEnd(10), r.fg, String(r.cr).padStart(6), r.cr >= 4.5 ? 'PASS' : 'still FAIL');
