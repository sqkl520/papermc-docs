'use strict';
/**
 * cr2ia-census.js — 全站链接普查（只读现有 HTML，不构建）
 * 统计：指向 3 个目标页的链接实例总数 / 承载页面数 / 机制数
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'cr2ia');
fs.mkdirSync(OUT, { recursive: true });
const SKIP = new Set(['archive', 'node_modules', 'reports', 'data', '.git', 'tools', 'assets', '_docsy_probe']);

const TARGETS = ['paper/dev/dialogs/', 'paper/reference/world-configuration/', 'velocity/tuning/'];

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else if (e.name.endsWith('.html')) acc.push(path.join(dir, e.name));
  }
  return acc;
}

const files = walk(ROOT);
const R = { files: files.length, targets: {}, pages: {} };

for (const t of TARGETS) R.targets[t] = { instances: 0, carrierPages: [], byPage: {} };

let totalAnchors = 0, totalHrefs = 0;
const uniqSite = new Set();

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const s = fs.readFileSync(abs, 'utf8');
  const hrefs = [...s.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1]);
  totalAnchors += hrefs.length;
  totalHrefs += new Set(hrefs).size;

  // 该页面的目录深度（用于计算相对路径）
  const dir = path.dirname(rel);
  const depth = dir === '.' ? 0 : dir.split('/').length;

  let hitsForPage = 0;
  for (const h of hrefs) {
    if (/^(https?:|mailto:|#)/.test(h)) continue;
    // 解析成站点相对路径
    const raw = h.replace(/#.*$/, '');
    if (!raw) continue;
    let resolved;
    if (raw.startsWith('/')) resolved = raw.slice(1);
    else resolved = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, raw));
    resolved = resolved.replace(/^\.\//, '');
    if (resolved.endsWith('index.html')) resolved = resolved.slice(0, -'index.html'.length);
    uniqSite.add(resolved);
    for (const t of TARGETS) {
      if (resolved === t) {
        R.targets[t].instances++;
        R.targets[t].byPage[rel] = (R.targets[t].byPage[rel] || 0) + 1;
        if (!R.targets[t].carrierPages.includes(rel)) R.targets[t].carrierPages.push(rel);
        hitsForPage++;
      }
    }
  }
  R.pages[rel] = { anchors: hrefs.length, uniqHref: new Set(hrefs).size, bytes: Buffer.byteLength(s, 'utf8'), targetHits: hitsForPage };
}

R.totals = { htmlFiles: files.length, anchors: totalAnchors, uniqHrefSum: totalHrefs, uniqSiteTargets: uniqSite.size };
for (const t of TARGETS) {
  R.targets[t].carrierCount = R.targets[t].carrierPages.length;
  // 机制数：按载体页面归类
  R.targets[t].mechanisms = Object.keys(R.targets[t].byPage).length;
}

fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify(R, null, 2), 'utf8');

const L = [];
L.push('== SITE CENSUS ==');
L.push(JSON.stringify(R.totals));
L.push('');
for (const t of TARGETS) {
  const x = R.targets[t];
  L.push('### ' + t);
  L.push('  链接实例 = ' + x.instances + '   承载页面数 = ' + x.carrierCount);
  const byPage = Object.entries(x.byPage).sort((a, b) => b[1] - a[1]);
  for (const [p, n] of byPage) L.push('    ' + String(n).padStart(2) + '  ' + p);
}
L.push('');
L.push('== PER-PAGE ANCHOR COUNT (top 20) ==');
const sorted = Object.entries(R.pages).sort((a, b) => b[1].anchors - a[1].anchors).slice(0, 20);
for (const [p, v] of sorted) L.push('  ' + String(v.anchors).padStart(4) + ' a / ' + String(v.uniqHref).padStart(4) + ' uniq / ' + Math.round(v.bytes / 1024) + 'KB  ' + p);
const txt = L.join('\n');
fs.writeFileSync(path.join(OUT, 'census.txt'), txt, 'utf8');
console.log(txt);
