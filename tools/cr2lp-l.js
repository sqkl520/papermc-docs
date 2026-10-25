'use strict';
/**
 * cr2lp-l.js — 「统计卡能否从页面内容推出」的静态核对（只读 html/copy）。
 * 对 141 个内容页做一次字符串计数，验证 441 / 982 / 936 / 221 / 30 / 89 是否是
 * 「用户能在页面上自行数出来」的量，还是只能读 data/build-manifest.json。
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SECS = ['paper', 'velocity', 'folia'];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'index.html') out.push(p);
  }
  return out;
}

const files = [];
for (const s of SECS) walk(path.join(ROOT, s), files);

let codeBlock = 0; let alertBlock = 0; let tableWrap = 0; let contentImg = 0;
let h2 = 0; let h3 = 0; let h4 = 0; let h5 = 0; let h6 = 0;
let tocLi = 0; let details = 0; let h1 = 0;

for (const f of files) {
  const h = fs.readFileSync(f, 'utf8');
  const n = (re) => (h.match(re) || []).length;
  codeBlock += n(/class="code-block"/g);
  alertBlock += n(/class="alert alert-/g);
  tableWrap += n(/<div class="table-wrap">/g);
  contentImg += n(/class="content-img/g);
  h2 += n(/<h2[ >]/g);
  h3 += n(/<h3[ >]/g);
  h4 += n(/<h4[ >]/g);
  h5 += n(/<h5[ >]/g);
  h6 += n(/<h6[ >]/g);
  tocLi += n(/class="toc-side"[\s\S]*?<\/nav>/g) ? 0 : 0; // 占位，下面单独算
  details += n(/<details[ >]/g);
  h1 += n(/<h1[ >]/g);
}

// 本页目录条目用 DOM 数更可靠，这里改为统计 toc 链接
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'build-manifest.json'), 'utf8'));

const derived = {
  pages: files.length,
  codeBlocks: codeBlock,
  alerts: alertBlock,
  tables: tableWrap,
  images: contentImg,
  subsections_h2_h6: h2 + h3 + h4 + h5 + h6,
  h1,
  details,
};
const manifestCounts = manifest.counts;

const cmp = {};
for (const k of ['pages', 'codeBlocks', 'alerts', 'tables', 'images', 'subsections', 'tocEntries']) {
  cmp[k] = { manifest: manifestCounts[k], recounted: derived[k] === undefined ? null : derived[k] };
}

const out = {
  generatedAt: new Date().toISOString(),
  filesScanned: files.length,
  derived,
  manifestCounts: {
    pages: manifestCounts.pages, codeBlocks: manifestCounts.codeBlocks, alerts: manifestCounts.alerts,
    tables: manifestCounts.tables, images: manifestCounts.images, subsections: manifestCounts.subsections,
    tocEntries: manifestCounts.tocEntries, sourceNavGroups: manifestCounts.sourceNavGroups,
    categories: manifestCounts.categories,
  },
  cmp,
};
fs.writeFileSync(path.join(require('os').tmpdir(), 'cr2lp-l.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 1));
