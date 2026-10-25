'use strict';
/**
 * cr2lp-l2.js — 精确重算统计卡数值（只读 html）。修正上一版正则漏掉 has-title 变体的问题。
 * 输出 tmpdir/cr2lp-l2.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

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

const tot = {
  pages: files.length,
  codeBlockFigures: 0, preTags: 0,
  alerts: 0, tables: 0, contentImg: 0,
  h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, h1: 0,
  tocLinks: 0, contentDetails: 0,
};
const perPage = [];

for (const f of files) {
  const h = fs.readFileSync(f, 'utf8');
  // 正文区域切出来，避免侧栏 details 干扰
  const artStart = h.indexOf('<article');
  const artEnd = h.indexOf('</article>');
  const art = artStart >= 0 && artEnd > artStart ? h.slice(artStart, artEnd) : h;
  const n = (s, re) => (s.match(re) || []).length;
  const cb = n(art, /<figure class="code-block/g);
  const pr = n(art, /<pre[ >]/g);
  const al = n(art, /class="alert alert-/g);
  const tb = n(art, /<div class="table-wrap">/g);
  const im = n(art, /<img[^>]*class="content-img/g);
  const a2 = n(art, /<h2[ >]/g);
  const a3 = n(art, /<h3[ >]/g);
  const a4 = n(art, /<h4[ >]/g);
  const a5 = n(art, /<h5[ >]/g);
  const a6 = n(art, /<h6[ >]/g);
  tot.codeBlockFigures += cb; tot.preTags += pr; tot.alerts += al; tot.tables += tb; tot.contentImg += im;
  tot.h2 += a2; tot.h3 += a3; tot.h4 += a4; tot.h5 += a5; tot.h6 += a6;
  tot.h1 += n(art, /<h1[ >]/g);
  tot.contentDetails += n(art, /<details[ >]/g);
  perPage.push({ f: path.relative(ROOT, f), cb, pr, al, tb, im, h2: a2, h3: a3, h4: a4 });
}

// 本页目录条目：数 .toc-side 内的 a[href^="#"]
for (const f of files) {
  const h = fs.readFileSync(f, 'utf8');
  const i = h.indexOf('class="toc-side"');
  if (i < 0) continue;
  const seg = h.slice(i, h.indexOf('</nav>', i) + 6);
  tot.tocLinks += (seg.match(/<a [^>]*href="#/g) || []).length;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'build-manifest.json'), 'utf8'));
const mc = manifest.counts;

const out = {
  generatedAt: new Date().toISOString(),
  filesScanned: files.length,
  recounted: tot,
  recountedSubsections: tot.h2 + tot.h3 + tot.h4 + tot.h5 + tot.h6,
  manifest: {
    pages: mc.pages, codeBlocks: mc.codeBlocks, alerts: mc.alerts, tables: mc.tables,
    images: mc.images, subsections: mc.subsections, tocEntries: mc.tocEntries,
    sourceNavGroups: mc.sourceNavGroups, categories: mc.categories,
  },
  match: {
    pages: tot.pages === mc.pages,
    codeBlocks: tot.codeBlockFigures === mc.codeBlocks,
    alerts: tot.alerts === mc.alerts,
    tables: tot.tables === mc.tables,
    images: tot.contentImg === mc.images,
    subsections: (tot.h2 + tot.h3 + tot.h4 + tot.h5 + tot.h6) === mc.subsections,
    tocEntries: tot.tocLinks === mc.tocEntries,
  },
  worstPagesByCode: perPage.sort((a, b) => b.cb - a.cb).slice(0, 5),
};
fs.writeFileSync(path.join(os.tmpdir(), 'cr2lp-l2.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ recounted: out.recounted, sub: out.recountedSubsections, manifest: out.manifest, match: out.match }, null, 1));
