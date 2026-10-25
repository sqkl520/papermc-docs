'use strict';
/** cr2ia-tail.js — 收尾精确计数：141 的重复次数、全站侧栏锚点占比 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');

const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1) 首页上 "141" 的出现次数（去标签后的可见文本 + 属性）
const textOnly = idx.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
const R = {};
R.count141_text = (textOnly.match(/141/g) || []).length;
R.count141_placeholder = (idx.match(/placeholder="[^"]*141[^"]*"/g) || []).length;
R.count141_all = (textOnly.match(/141/g) || []).length + R.count141_placeholder;
R.samples141 = (textOnly.match(/.{18}141.{18}/g) || []).slice(0, 8).map((s) => s.replace(/\s+/g, ' ').trim());

// 2) 全站侧栏锚点占比
const SKIP = new Set(['archive', 'node_modules', 'reports', 'data', '.git', 'tools', 'assets']);
function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (SKIP.has(e.name)) continue; walk(path.join(d, e.name), acc); }
    else if (e.name.endsWith('.html')) acc.push(path.join(d, e.name));
  }
  return acc;
}
const files = walk(ROOT);
let totalAnchors = 0, sideAnchors = 0, pagesWithSidebar = 0, sideBytes = 0, totalBytes = 0;
const perPage = [];
for (const abs of files) {
  const s = fs.readFileSync(abs, 'utf8');
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const a = (s.match(/<a\b/g) || []).length;
  const m = s.match(/<nav class="sidebar"[\s\S]*?<\/nav>/);
  const sa = m ? (m[0].match(/<a\b/g) || []).length : 0;
  totalAnchors += a; sideAnchors += sa; totalBytes += Buffer.byteLength(s, 'utf8');
  if (m) { pagesWithSidebar++; sideBytes += Buffer.byteLength(m[0], 'utf8'); }
  perPage.push({ rel, a, sa, bytes: Buffer.byteLength(s, 'utf8') });
}
R.site = {
  htmlFiles: files.length, pagesWithSidebar, totalAnchors, sideAnchors,
  sideSharePct: Math.round((sideAnchors / totalAnchors) * 1000) / 10,
  sideKB: Math.round(sideBytes / 1024), totalKB: Math.round(totalBytes / 1024),
  sideByteSharePct: Math.round((sideBytes / totalBytes) * 1000) / 10,
  avgSideAnchors: Math.round((sideAnchors / pagesWithSidebar) * 10) / 10,
  avgSideKB: Math.round(sideBytes / pagesWithSidebar / 1024 * 10) / 10,
};
perPage.sort((x, y) => y.sa - x.sa);
R.perPageTop = perPage.slice(0, 5);

// 3) 首页首屏（0-900）内的链接目标分类
const main = idx.match(/<main id="main" class="content">([\s\S]*)<\/main>/)[1];
R.heroAnchors = (idx.match(/<div class="hero">[\s\S]*?<\/div><div class="entry-cards">/) || [''])[0];
R.firstScreenHrefs = [...main.matchAll(/<a\b[^>]*href="([^"]*)"/g)].slice(0, 8).map((m) => m[1]);

fs.writeFileSync(path.join(os.tmpdir(), 'cr2ia', 'tail.json'), JSON.stringify(R, null, 2), 'utf8');
console.log(JSON.stringify(R, null, 1));
