'use strict';
// b1v-inspect.js — 只读：对比两份 CSS 的关键断点规则与 markup 细节
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PRE = path.resolve(ROOT, '..', '_pre-mobile');

function greps(file, pats) {
  const s = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out = {};
  for (const p of pats) {
    const re = new RegExp(p);
    out[p] = s.map((l, i) => (re.test(l) ? (i + 1) + ': ' + l.trim() : null)).filter(Boolean).slice(0, 8);
  }
  return out;
}

const pats = [
  'sidebar-toggle',
  '\\.sidebar\\{',
  'nav-open',
  'topbar\\{',
  '\\.content\\{',
  'scroll-padding',
  'toc-side',
  'code-copy\\{',
  'alert-title\\{',
  'src-link::after',
  'data-overflowing',
  'hl-keyword',
];

const after = greps(path.join(ROOT, 'assets', 'site.css'), pats);
const before = greps(path.join(PRE, 'assets', 'site.css'), pats);

console.log('########## AFTER 8787 ##########');
for (const k of pats) { console.log('-- ' + k); (after[k] || []).forEach((l) => console.log('   ' + l)); }
console.log('\n########## BEFORE 8788 ##########');
for (const k of pats) { console.log('-- ' + k); (before[k] || []).forEach((l) => console.log('   ' + l)); }

// markup: src-item 结构
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const i = html.indexOf('src-item');
console.log('\n########## src-item markup (after) ##########');
console.log(html.slice(Math.max(0, i - 80), i + 400));
const preHtml = fs.readFileSync(path.join(PRE, 'index.html'), 'utf8');
const j = preHtml.indexOf('src-item');
console.log('\n########## src-item markup (before) ##########');
console.log(preHtml.slice(Math.max(0, j - 80), j + 400));
