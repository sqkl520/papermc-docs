'use strict';
// b1v-pick.js — 独立验证用：扫描本地 HTML，统计各特性出现次数，挑出探针页面。
// 只读，不写站点产物。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '_pre-mobile', '.git', 'archive']);

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
    } else if (ent.isFile() && ent.name.endsWith('.html')) {
      out.push(path.join(dir, ent.name));
    }
  }
}

const files = [];
walk(ROOT, files);

const rows = [];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const count = (re) => (s.match(re) || []).length;
  const row = {
    rel: path.relative(ROOT, f).replace(/\\/g, '/'),
    srcItem: count(/class="src-item"/g),
    alertTitle: count(/class="alert-title"/g),
    codeBlock: count(/class="code-block"/g),
    codeScroll: count(/class="code-scroll"/g),
    hljsSpan: count(/<span class="hljs-/g),
    h1: count(/<h1[\s>]/g),
    tocLi: count(/<li class="lvl-\d">/g),
    detail: count(/<details[\s>]/g),
    bytes: s.length,
  };
  rows.push(row);
}

rows.sort((a, b) => (b.srcItem + b.hljsSpan + b.alertTitle) - (a.srcItem + a.hljsSpan + a.alertTitle));

const pick = (key) => rows.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 5)
  .map((r) => ({ rel: r.rel, n: r[key], tocLi: r.tocLi, h1: r.h1 }));

const summary = {
  totalHtml: rows.length,
  maxSrcItem: pick('srcItem'),
  maxHljs: pick('hljsSpan'),
  maxAlert: pick('alertTitle'),
  maxCodeScroll: pick('codeScroll'),
  maxTocLi: rows.slice().sort((a, b) => b.tocLi - a.tocLi).slice(0, 6)
    .map((r) => ({ rel: r.rel, tocLi: r.tocLi, h1: r.h1, bytes: r.bytes })),
  totals: rows.reduce((acc, r) => {
    for (const k of ['srcItem', 'alertTitle', 'codeBlock', 'codeScroll', 'hljsSpan']) acc[k] = (acc[k] || 0) + r[k];
    return acc;
  }, {}),
};

console.log(JSON.stringify(summary, null, 2));
