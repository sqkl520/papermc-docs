'use strict';
/** cr2ia-last.js — 最后三项：sections 载体、树里不在侧栏的 3 条、精确字节数 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'cr2ia');

const R = {};
const stat = (rel) => fs.statSync(path.join(ROOT, rel)).size;
R.bytes = {
  'index.html': stat('index.html'),
  'all-pages.html': stat('all-pages.html'),
  'snapshots.html': stat('snapshots.html'),
  'assets/site.css': stat('assets/site.css'),
  'assets/site.js': stat('assets/site.js'),
  'assets/search-index.js': stat('assets/search-index.js'),
  'sections/paper.html': stat('sections/paper.html'),
  'paper/dev/dialogs/index.html': stat('paper/dev/dialogs/index.html'),
};

// sections/*.html 的引用载体
const SKIP = new Set(['archive', 'node_modules', 'reports', 'data', '.git', 'tools', 'assets']);
function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (SKIP.has(e.name)) continue; walk(path.join(d, e.name), acc); }
    else if (e.name.endsWith('.html')) acc.push(path.join(d, e.name));
  }
  return acc;
}
const files = walk(ROOT);
R.sectionsCarriers = {};
for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const s = fs.readFileSync(abs, 'utf8');
  const hits = (s.match(/href="[^"]*sections\/[a-z]+\.html"/g) || []);
  if (hits.length) R.sectionsCarriers[rel] = hits;
}

// index.html 主内容树里、侧栏中不存在的链接
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sidebar = idx.match(/<nav class="sidebar"[\s\S]*?<\/nav>/)[0];
const main = idx.match(/<main id="main" class="content">([\s\S]*)<\/main>/)[1];
const tree = main.match(/<section class="src-tree"[\s\S]*$/)[0];
const hrefsOf = (h) => [...h.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1]);
const sideSet = new Set(hrefsOf(sidebar));
const treeHrefs = hrefsOf(tree);
R.treeLinks = treeHrefs.length;
R.treeNotInSidebar = treeHrefs.filter((h) => !sideSet.has(h));
R.treeDupWithin = treeHrefs.length - new Set(treeHrefs).size;

// 侧栏里 141 页的覆盖（用 href 集合，不做路径归一）
const sidePages = hrefsOf(sidebar).filter((h) => /^(paper|velocity|folia)\//.test(h) && !/\/index\.html$/.test(h));
R.sidebarPageLinksNonIndex = sidePages.length;

// all-pages 表格每行链接数
const ap = fs.readFileSync(path.join(ROOT, 'all-pages.html'), 'utf8');
R.allpagesRows = (ap.match(/<tr data-search=/g) || []).length;
R.allpagesAnchors = (ap.match(/<a\b/g) || []).length;
R.allpagesSidebarAnchors = (ap.match(/<nav class="sidebar"[\s\S]*?<\/nav>/)[0].match(/<a\b/g) || []).length;

// 首页 .stats 卡数 / .entry-card / .qa
R.statsCards = (main.match(/<div class="stat">/g) || []).length;
R.entryCards = (main.match(/<div class="entry-card"|<a class="entry-card"/g) || []).length;
R.qa = (main.match(/<a class="qa"/g) || []).length;

fs.writeFileSync(path.join(OUT, 'last.json'), JSON.stringify(R, null, 2), 'utf8');
console.log(JSON.stringify(R, null, 1));
