'use strict';
/**
 * c45-audit.js — P1-1 静态验收（全站逐页扫描已构建 HTML）
 *
 * 只读、不写盘（除 --json 指定的报告文件）。回答 4 个问题：
 *   1. 所有 `img.content-img`（有 src 的内容图）是否都写了 intrinsic width/height？
 *   2. 灯箱占位 `<img alt="">`（无 src）是否仍然**没有**尺寸属性（不得被误伤）？
 *   3. 写入的 W/H 是否与磁盘上图片文件的真实像素尺寸一致（独立复算，不信任构建期缓存）？
 *   4. 哪些图没写、为什么（缺文件 / 头不可读 / 外链 / data:URI）——如实列出，不猜。
 *
 * 复用 tools/build-site.js 导出的 readImageSize（同一实现，但此处独立重算并与属性比对）。
 *
 * 用法: node tools/c45-audit.js [--json=reports/.c45-audit.json]
 */
const fs = require('fs');
const path = require('path');
const { readImageSize } = require('./build-site.js');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT = opt('json', path.join(ROOT, 'reports', '.c45-audit.json'));

const SKIP = /(^|[\\/])(node_modules|archive|reports|tools|\.git)([\\/]|$)/;

/** collect every built .html page (site root = repo root) */
function walkHtml(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p.slice(ROOT.length))) continue;
    if (e.isDirectory()) walkHtml(p, acc);
    else if (e.name.toLowerCase().endsWith('.html')) acc.push(p);
  }
  return acc;
}

const SIZE_CACHE = new Map();
function realSize(abs) {
  if (SIZE_CACHE.has(abs)) return SIZE_CACHE.get(abs);
  let size = null;
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const st = fs.statSync(abs);
      const fd = fs.openSync(abs, 'r');
      try {
        const buf = Buffer.alloc(Math.min(st.size, 65536));
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        size = readImageSize(n === buf.length ? buf : buf.subarray(0, n));
      } finally { fs.closeSync(fd); }
    }
  } catch (e) { size = null; }
  SIZE_CACHE.set(abs, size);
  return size;
}

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");

const pages = walkHtml(ROOT, []);
const rows = [];       // one row per content <img>
const placeholders = []; // one row per <img> without src
const pageSummary = [];

for (const absHtml of pages) {
  const html = fs.readFileSync(absHtml, 'utf8');
  const rel = path.relative(ROOT, absHtml).split(path.sep).join('/');
  const dir = path.dirname(absHtml);
  let contentImgs = 0, contentWithDims = 0, contentSrcNoDims = 0;

  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    const cls = (tag.match(/\sclass="([^"]*)"/) || [])[1] || '';
    const src = (tag.match(/\ssrc="([^"]*)"/) || [])[1];
    const w = (tag.match(/\swidth="(\d+)"/) || [])[1];
    const h = (tag.match(/\sheight="(\d+)"/) || [])[1];

    // lightbox placeholders: no src at all
    if (src === undefined) {
      placeholders.push({ page: rel, tag: tag.slice(0, 160), width: w || null, height: h || null, hasDims: !!(w || h), cls });
      continue;
    }

    const isContent = /\bcontent-img\b/.test(cls);
    if (!isContent) {
      rows.push({ page: rel, src: decode(src).slice(0, 120), cls, kind: 'non-content', hasDims: !!(w && h), width: w || null, height: h || null, match: null });
      continue;
    }

    contentImgs += 1;
    const raw = decode(src);
    let kind = 'local', declared = null, reason = null;
    if (/^data:/i.test(raw)) {
      kind = 'data-uri';
      const dm = raw.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/i);
      if (dm) {
        try {
          const buf = dm[2] ? Buffer.from(dm[3], 'base64') : Buffer.from(decodeURIComponent(dm[3]), 'latin1');
          declared = readImageSize(buf);
        } catch (e) { declared = null; }
      }
      if (!declared) reason = 'data-uri-unreadable';
    } else if (/^(?:https?:)?\/\//i.test(raw)) {
      kind = 'external';
      reason = 'external';
    } else {
      const clean = raw.split('#')[0].split('?')[0];
      let abs = path.resolve(dir, clean);
      if (!fs.existsSync(abs)) {
        try { const dec = path.resolve(dir, decodeURIComponent(clean)); if (fs.existsSync(dec)) abs = dec; } catch (e) {}
      }
      declared = fs.existsSync(abs) ? realSize(abs) : null;
      if (!fs.existsSync(abs)) reason = 'file-missing';
      else if (!declared) reason = 'header-unreadable';
    }

    const hasDims = !!(w && h);
    if (hasDims) contentWithDims += 1; else contentSrcNoDims += 1;

    rows.push({
      page: rel, src: raw.slice(-72), cls, kind, hasDims,
      width: w || null, height: h || null,
      real: declared ? declared.w + 'x' + declared.h : null,
      realFormat: declared ? declared.format : null,
      match: declared ? (String(declared.w) === String(w) && String(declared.h) === String(h)) : null,
      reason,
    });
  }

  pageSummary.push({ page: rel, contentImgs, contentWithDims, contentSrcNoDims, placeholders: placeholders.filter((p) => p.page === rel).length });
}

const content = rows.filter((r) => r.kind !== 'non-content');
const withDims = content.filter((r) => r.hasDims);
const mismatched = content.filter((r) => r.hasDims && r.match === false);
const noReal = content.filter((r) => r.hasDims && !r.real);
const skipped = content.filter((r) => !r.hasDims);
const placeholderWithDims = placeholders.filter((p) => p.hasDims);

const byFormat = {};
for (const r of content) { const k = r.realFormat || r.reason || 'unknown'; byFormat[k] = (byFormat[k] || 0) + 1; }

const report = {
  tool: 'tools/c45-audit.js',
  generated_at: new Date().toISOString(),
  pages: pages.length,
  totals: {
    imgTags: rows.length + placeholders.length,
    imgWithSrc: rows.length,
    contentImgs: content.length,
    contentWithDims: withDims.length,
    contentSrcNoDims: skipped.length,
    nonContentWithSrc: rows.length - content.length,
    placeholders: placeholders.length,
    placeholdersWithDims: placeholderWithDims.length,
  },
  byFormat,
  mismatched: mismatched.slice(0, 40),
  sizedButNoRealFile: noReal.slice(0, 40),
  skipped: skipped.slice(0, 60),
  placeholderViolations: placeholderWithDims.slice(0, 20),
  placeholderSample: placeholders.slice(0, 5),
  pagesWithDimsGaps: pageSummary.filter((p) => p.contentImgs !== p.contentWithDims),
  aspectSamples: (() => {
    // 3 张纵横比明显不同的图，供浏览器端几何核对
    const uniq = [];
    const seen = new Set();
    for (const r of withDims) {
      if (!r.real) continue;
      const [rw, rh] = r.real.split('x').map(Number);
      const ar = (rw / rh).toFixed(2);
      if (seen.has(ar)) continue;
      seen.add(ar);
      uniq.push({ page: r.page, src: r.src, w: rw, h: rh, ar: +ar });
    }
    uniq.sort((a, b) => a.ar - b.ar);
    return [uniq[0], uniq[Math.floor(uniq.length / 2)], uniq[uniq.length - 1]].filter(Boolean);
  })(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

console.log('pages scanned      : ' + report.pages);
console.log('img tags total     : ' + report.totals.imgTags + '  (= ' + report.totals.imgWithSrc + ' with src + ' + report.totals.placeholders + ' lightbox placeholders)');
console.log('content-img        : ' + report.totals.contentWithDims + ' / ' + report.totals.contentImgs + ' with width+height');
console.log('non-content w/ src : ' + report.totals.nonContentWithSrc + ' (external / misc)');
console.log('placeholders w/dims: ' + report.totals.placeholdersWithDims + ' / ' + report.totals.placeholders + ' (must be 0)');
console.log('real-size mismatch : ' + mismatched.length + ' (attr vs disk header)');
console.log('sized but no file  : ' + noReal.length);
console.log('not sized          : ' + skipped.length + (skipped.length ? ' -> ' + JSON.stringify(skipped.slice(0, 8).map((r) => ({ p: r.page, s: r.src, why: r.reason }))) : ''));
console.log('by real format     : ' + JSON.stringify(byFormat));
console.log('aspect samples     : ' + JSON.stringify(report.aspectSamples));
console.log('wrote ' + path.relative(ROOT, OUT).split(path.sep).join('/'));
