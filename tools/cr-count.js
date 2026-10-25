'use strict';
/**
 * cr-count.js — 静态审计目标改动「声称的数字」是否与源码/产物一致
 * 只读：不写任何源码/产物，只打印 JSON 到 stdout
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SKIP = /(^|[\\/])(node_modules|\.git|reports|archive|tools|assets[\\/]img)([\\/]|$)/;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.test(p)) walk(p, out); }
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const pages = walk(ROOT, []);
let contentImg = 0, pagesWithImg = 0, missing = 0, externalImg = 0;
let imgWithW = 0, imgWithH = 0, imgWithBoth = 0;
let lightboxEls = 0, lightboxAttr = 0, imgTotal = 0, lazyImg = 0;
const imgSrcs = new Set();
const dimSamples = [];
for (const p of pages) {
  const s = fs.readFileSync(p, 'utf8');
  const ci = s.match(/class="content-img/g);
  if (ci) { contentImg += ci.length; pagesWithImg++; }
  missing += (s.match(/class="content-img img-missing"/g) || []).length;
  externalImg += (s.match(/class="(?:content-img )?external-img/g) || []).length;
  lightboxEls += (s.match(/class="lightbox|id="lightbox/g) || []).length;
  lightboxAttr += (s.match(/data-lightbox=/g) || []).length;
  imgTotal += (s.match(/<img\b/g) || []).length;
  lazyImg += (s.match(/<img[^>]*\bloading="lazy"/g) || []).length;
  // 逐个 img 标签解析 width/height
  const tagRe = /<img\b[^>]*>/g;
  let m;
  while ((m = tagRe.exec(s))) {
    const t = m[0];
    const w = /\bwidth="(\d+)"/.exec(t);
    const h = /\bheight="(\d+)"/.exec(t);
    if (w) imgWithW++;
    if (h) imgWithH++;
    if (w && h) imgWithBoth++;
    const src = /\bsrc="([^"]*)"/.exec(t);
    if (src) imgSrcs.add(src[1]);
  }
}

// build-site.js 是否真的写 width/height
const bs = fs.readFileSync(path.join(ROOT, 'tools', 'build-site.js'), 'utf8');
const layout = fs.readFileSync(path.join(ROOT, 'tools', 'site', 'render.js'), 'utf8');
const assetsSrc = fs.readFileSync(path.join(ROOT, 'tools', 'site', 'assets.js'), 'utf8');

function has(src, re) { return re.test(src); }

const out = {
  pages: pages.length,
  contentImg, pagesWithImg, missing, externalImg,
  imgTotal, imgWithW, imgWithH, imgWithBoth, lazyImg,
  lightboxEls, lightboxAttr, uniqueImgSrcs: imgSrcs.size,
  src: {
    buildSiteWritesWidth: has(bs, /width="'\s*\+|width='"?\s*\+|naturalWidth|image-size|probeImage/),
    renderEmitsWH: has(layout, /\bwidth="\d+"[^>]*\bheight="\d+"/),
    cssHasCodePreFontSize: has(assetsSrc, /\.code-pre\{[^}]*font-size/),
    cssHasH5_17: has(assetsSrc, /\.article h5[^{]*\{[^}]*font-size:\s*1\.0625rem|\.article h5[^{]*\{[^}]*font-size:\s*17px/),
    cssHasTdBreakWord: has(assetsSrc, /\.table-wrap td[^{]*\{[^}]*overflow-wrap/),
    cssHasP40rem: has(assetsSrc, /max-width:\s*40rem/),
    cssHasToc1200: has(assetsSrc, /@media \(min-width:1200px\)/),
    media1025: (assetsSrc.match(/@media \(min-width:1025px\)/g) || []).length,
    media1200: (assetsSrc.match(/@media \(min-width:1200px\)/g) || []).length,
    media1280: (assetsSrc.match(/@media \(min-width:1280px\)/g) || []).length,
    media1024: (assetsSrc.match(/@media \(min-width:1024px\)/g) || []).length,
  },
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
