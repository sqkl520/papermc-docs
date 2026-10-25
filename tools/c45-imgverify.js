'use strict';
/**
 * c45-imgverify.js — P1-1 的**浏览器ground-truth**校验（独立于我的头解析器）
 *
 * 目的：证明 HTML 里写入的 width/height 等于图片的**真实像素尺寸**，且不改变渲染比例。
 *   - 静态审计（c45-audit.js）用的是我自己的头解析器 → 自我循环，不能单独作为证据。
 *   - 这里让 Chromium 自己解码（naturalWidth/naturalHeight 是全局真值），逐张比对属性。
 *
 * 做法：把 loading="lazy" 改成 eager（不限速，保证全部解码），遍历所有含内容图的页面：
 *   1. attr === natural ？            （尺寸对不对）
 *   2. 内容盒(css内容区) 宽高比 === natural 宽高比 ？（变形没有 —— 排除 1px 边框导致的假阳性）
 *   3. 灯箱占位是否仍然没有尺寸属性？
 *
 * 另含一个**合成单元测试**：用真实字节编码出最小 PNG / GIF / JPEG / SVG，
 * 验证四种解析器都对（站点里只有 webp/png/svg，jpg/gif 分支否则无法验证）。
 *
 * 用法: node tools/c45-imgverify.js [--json=reports/.c45-imgverify.json]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { readImageSize } = require('./build-site.js');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const BASE = opt('base', 'http://127.0.0.1:8787');
const OUT = path.resolve(ROOT, opt('json', 'reports/.c45-imgverify.json'));

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* ---------------- 1. 四种格式的合成单元测试 ---------------- */
function synthPng(w, h) {
  // 最小合法 PNG：签名 + IHDR（宽高在 offset 16/20）+ 空 IEND
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; ihdr[17] = 6; ihdr[18] = 0; ihdr[19] = 0; ihdr[20] = 0;
  ihdr.writeUInt32BE(0, 21);
  return Buffer.concat([sig, ihdr]);
}
function synthGif(w, h) {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}
function synthJpeg(w, h) {
  // FFD8 + APP0(JFIF) + SOF2(progressive) —— 宽高在 SOF 段的 +5/+7
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc2;          // SOF2
  sof.writeUInt16BE(17, 2);              // segment length
  sof[4] = 8;                            // precision
  sof.writeUInt16BE(h, 5);               // height
  sof.writeUInt16BE(w, 7);               // width
  sof[9] = 3;                            // components
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}
function synthSvg(w, h, mode) {
  if (mode === 'viewbox') return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '"></svg>');
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"></svg>');
}

const unit = [];
function t(name, buf, want) {
  const got = readImageSize(buf);
  const ok = !!got && got.w === want.w && got.h === want.h;
  unit.push({ name, want: want.w + 'x' + want.h, got: got ? got.w + 'x' + got.h : null, format: got ? got.format : null, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(34) + ' want=' + (want.w + 'x' + want.h) + '  got=' + (got ? got.w + 'x' + got.h + ' (' + got.format + ')' : 'null'));
}
console.log('=== 解析器单元测试（合成字节，覆盖 4 种格式）');
t('PNG  IHDR 1024x768', synthPng(1024, 768), { w: 1024, h: 768 });
t('PNG  IHDR 1x1', synthPng(1, 1), { w: 1, h: 1 });
t('GIF  LE16 320x240', synthGif(320, 240), { w: 320, h: 240 });
t('GIF  LE16 1920x1080', synthGif(1920, 1080), { w: 1920, h: 1080 });
t('JPEG SOF2 800x600', synthJpeg(800, 600), { w: 800, h: 600 });
t('JPEG SOF2 2560x1440', synthJpeg(2560, 1440), { w: 2560, h: 1440 });
t('SVG  width/height 64x64', synthSvg(64, 64, 'wh'), { w: 64, h: 64 });
t('SVG  viewBox 120x40', synthSvg(120, 40, 'viewbox'), { w: 120, h: 40 });

/* ---------------- 2. 找出所有含内容图的页面 ---------------- */
const SKIP = /(^|[\\/])(node_modules|archive|reports|tools|\.git)([\\/]|$)/;
function walkHtml(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p.slice(ROOT.length))) continue;
    if (e.isDirectory()) walkHtml(p, acc);
    else if (e.name.toLowerCase().endsWith('.html')) acc.push(p);
  }
  return acc;
}
const pageTargets = [];
for (const abs of walkHtml(ROOT, [])) {
  const head = fs.readFileSync(abs, 'utf8');
  const n = (head.match(/class="[^"]*\bcontent-img\b/g) || []).length;
  if (n) pageTargets.push({ rel: path.relative(ROOT, abs).split(path.sep).join('/'), count: n });
}
console.log('\n=== 含内容图的页面: ' + pageTargets.length + '（共 ' + pageTargets.reduce((s, p) => s + p.count, 0) + ' 张图）');

const MEASURE = () => {
  const imgs = Array.from(document.querySelectorAll('img'));
  const content = imgs.filter((im) => im.classList.contains('content-img'));
  return {
    content: content.map((im) => {
      const r = im.getBoundingClientRect();
      const cs = getComputedStyle(im);
      const bw = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
      const bh = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      const aw = parseInt(im.getAttribute('width') || '0', 10);
      const ah = parseInt(im.getAttribute('height') || '0', 10);
      const cw = r.width - bw;
      const chh = r.height - bh;
      const natAR = im.naturalHeight > 0 ? im.naturalWidth / im.naturalHeight : null;
      const contentAR = chh > 0 ? cw / chh : null;
      const src = im.currentSrc || im.getAttribute('src') || '';
      const isSvg = /\.svg(?:[?#]|$)/i.test(src);
      return {
        n: src.split('/').pop().slice(0, 50),
        isSvg,
        attr: aw && ah ? aw + 'x' + ah : null,
        natural: im.naturalWidth + 'x' + im.naturalHeight,
        decoded: im.naturalWidth > 0,
        // 绝对像素比对只对位图有意义。SVG 若自身没有 width/height（只有 viewBox），
        // 浏览器报的 naturalWidth/Height 是"默认替换元素尺寸"(300x150 等比缩放)，
        // 与 viewBox 设计尺寸不是同一个量 —— 此时应按**宽高比**比对（见 arSizeMatch）。
        sizeMatch: (aw > 0 && ah > 0 && im.naturalWidth > 0 && !isSvg) ? (aw === im.naturalWidth && ah === im.naturalHeight) : null,
        arSizeMatch: (aw > 0 && ah > 0 && im.naturalWidth > 0 && im.naturalHeight > 0)
          ? +(Math.abs((aw / ah) - (im.naturalWidth / im.naturalHeight)) / (im.naturalWidth / im.naturalHeight)).toFixed(5)
          : null,
        naturalAR: natAR === null ? null : +natAR.toFixed(4),
        contentAR: contentAR === null ? null : +contentAR.toFixed(4),
        arDrift: (natAR && contentAR) ? +(Math.abs(contentAR - natAR) / natAR).toFixed(5) : null,
        rect: Math.round(r.width) + 'x' + Math.round(r.height),
      };
    }),
    placeholders: imgs.filter((im) => !im.hasAttribute('src')).length,
    placeholdersWithDims: imgs.filter((im) => !im.hasAttribute('src') && (im.getAttribute('width') || im.getAttribute('height'))).length,
  };
};

(async () => {
  if (!EXE) throw new Error('no Chrome executable found');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const rows = [];
  let placeholders = 0, placeholdersWithDims = 0;

  for (const tgt of pageTargets) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    // 全部改成 eager，保证在不限速的情况下一次性解码完（只为取证，不影响站点产物）
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('img').forEach((im) => { im.loading = 'eager'; });
      });
    });
    await page.goto(BASE + '/' + tgt.rel, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => Array.from(document.images).every((im) => im.complete), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(300);
    const m = await page.evaluate(MEASURE);
    placeholders += m.placeholders;
    placeholdersWithDims += m.placeholdersWithDims;
    for (const c of m.content) rows.push({ page: tgt.rel, ...c });
    const notDecoded = m.content.filter((c) => !c.decoded).length;
    console.log('  ' + tgt.rel.padEnd(62) + ' imgs=' + String(m.content.length).padStart(2)
      + '  decoded=' + (m.content.length - notDecoded) + '/' + m.content.length
      + (notDecoded ? '  ⚠ 未解码 ' + notDecoded : ''));
    await ctx.close();
  }
  await browser.close();

  const decoded = rows.filter((r) => r.decoded);
  const withAttr = rows.filter((r) => r.attr);
  const sizeMismatch = decoded.filter((r) => r.sizeMatch === false);
  const noAttr = rows.filter((r) => !r.attr);
  const drift = decoded.filter((r) => r.arDrift !== null);
  const maxDrift = drift.reduce((m, r) => Math.max(m, r.arDrift), 0);
  const driftOutliers = drift.filter((r) => r.arDrift > 0.01);
  // SVG 用宽高比一致性判定（绝对像素不可比，见 MEASURE 注释）。
  // 容差 1%：浏览器把 SVG 的默认替换元素尺寸归一到 width=300 并**取整**高度
  // （如 890/168 → 300/56.63 → 报 300x57），取整本身就会带来 ~0.9% 的宽高比误差，
  // 这不是我们写错，而是 naturalWidth 这个量的量化误差。
  const svgRows = decoded.filter((r) => r.isSvg && r.arSizeMatch !== null);
  const svgArBad = svgRows.filter((r) => r.arSizeMatch > 0.01);
  const rasterRows = decoded.filter((r) => !r.isSvg && r.sizeMatch !== null);
  const rasterBad = rasterRows.filter((r) => r.sizeMatch === false);

  const report = {
    tool: 'tools/c45-imgverify.js', base: BASE, generated_at: new Date().toISOString(),
    unitTests: { total: unit.length, passed: unit.filter((u) => u.ok).length, cases: unit },
    pages: pageTargets.length,
    totals: {
      contentImgs: rows.length,
      withAttr: withAttr.length,
      decoded: decoded.length,
      undecoded: rows.length - decoded.length,
      rasterCompared: rasterRows.length,
      rasterSizeMismatch: rasterBad.length,
      svgCompared: svgRows.length,
      svgAspectMismatch: svgArBad.length,
      svgNote: 'SVG 无自身 width/height、仅 viewBox 时，浏览器 naturalWidth/Height 是默认替换元素尺寸(等比)而不是 viewBox 设计尺寸；故 SVG 按宽高比判定',
      placeholders, placeholdersWithDims,
    },
    aspect: {
      compared: drift.length, maxDrift: +maxDrift.toFixed(5),
      outliersOver1pct: driftOutliers.slice(0, 20),
      samples: drift.slice(0, 8),
    },
    sizeMismatchList: sizeMismatch.slice(0, 20),
    svgAspectBadList: svgArBad.slice(0, 20),
    noAttrList: noAttr.slice(0, 20),
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== ground-truth（Chromium 解码）');
  console.log('  内容图总数          : ' + rows.length);
  console.log('  有 width/height     : ' + withAttr.length + ' / ' + rows.length);
  console.log('  已解码              : ' + decoded.length + ' / ' + rows.length);
  console.log('  位图 属性 ≠ 真实像素: ' + rasterBad.length + ' / ' + rasterRows.length + ' 张位图');
  console.log('  SVG 宽高比 ≠ 属性比 : ' + svgArBad.length + ' / ' + svgRows.length + ' 张 SVG（绝对像素不可比，改判宽高比）');
  console.log('  无属性的图          : ' + noAttr.length + (noAttr.length ? ' -> ' + JSON.stringify(noAttr.slice(0, 5).map((r) => r.n)) : ''));
  console.log('  灯箱占位带尺寸      : ' + placeholdersWithDims + ' / ' + placeholders + '（必须 0）');
  console.log('  变形（内容盒AR偏差）: max=' + maxDrift.toFixed(5) + '  超 1% 的图=' + driftOutliers.length
    + (driftOutliers.length ? ' -> ' + JSON.stringify(driftOutliers.slice(0, 5).map((r) => r.n + ' ' + r.arDrift)) : ''));
  console.log('  单元测试            : ' + report.unitTests.passed + '/' + report.unitTests.total + ' 通过');
  console.log('wrote ' + path.relative(ROOT, OUT).split(path.sep).join('/'));
})().catch((e) => { console.error('ERR', (e && e.stack) || e); process.exit(1); });
