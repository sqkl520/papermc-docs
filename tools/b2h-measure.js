'use strict';
/**
 * b2h-measure.js —— 批 2b（首页 tree-fold → 3 个分区入口）专用测量探针（只读）
 *
 * 口径（前后两次运行必须完全一致）：
 *   mainChars      = <main> 元素 innerHTML 的 .length（与 upz-census 同口径：inner 区间）
 *   mainLinks      = <main> 内 <a href> 总数（不筛可见性）
 *   mainDetails    = <main> 内 <details> 总数
 *   docHeight      = document.documentElement.scrollHeight（页高，含全部折叠块）
 *   firstScreenLinks = <main> 内「可见 且 锚点 top < innerHeight」的 <a> 数
 *   firstScreenDocLinks = 上者中排除导航性目标（分区入口 / all-pages / categories /
 *                     snapshots / 外链 / 锚点 #）后剩下的「具体文档页」链接数
 *   indexBytes     = 磁盘上 index.html 的字节数（fs.statSync，非渲染后长度）
 *
 * 可见（vis）与 tools/verify-mobile.js:179 / tools/b1u-measure.js 一致：
 *   display:none / visibility:hidden / opacity<0.05 / 盒尺寸为 0 → 不可见。
 *   注意 <details> 关闭时其内容 checkVisibility 为 false → tree-fold 的 141 条
 *   链接**不计入** firstScreenLinks，但**计入** mainLinks（DOM 口径）。
 *
 * 用法：
 *   node tools/b2h-measure.js --label=baseline
 *   node tools/b2h-measure.js --label=after --compare=baseline
 *
 * 产物：reports/b2h-measure-<label>.json（reports/ 已 gitignore，不入库）
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const LABEL = arg('label', 'run');
const COMPARE = arg('compare', '');
const PAGE = arg('page', 'index.html');

const VPS = [
  { name: '1440', w: 1440, h: 900 },
  { name: '1024', w: 1024, h: 768 },
  { name: '390', w: 390, h: 844 },
];

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const toUrl = (rel) => 'file:///' + path.join(REPO, rel).replace(/\\/g, '/');

/* ------------------------------------------------------------------ */
/* 浏览器内测量函数（原样注入，前后两次运行完全一致）                    */
/* ------------------------------------------------------------------ */
function MEASURE() {
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const csOf = (el) => getComputedStyle(el);
  const vis = (el) => {
    if (!el) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    const cs = csOf(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clsOf = (el) => (el.className && el.className.toString ? el.className.toString().trim().split(/\s+/).slice(0, 2).join('.') : '');
  const desc = (el) => el.tagName.toLowerCase() + (clsOf(el) ? '.' + clsOf(el) : '');
  const txt = (el, n) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n || 30);

  const main = document.querySelector('main') || document.querySelector('.article');
  if (!main) return { error: 'no <main>' };

  /* 块分解：<main> 的直接子元素，逐个量 innerHTML 长度 + 链接数 */
  const blocks = [];
  for (const el of Array.from(main.children)) {
    blocks.push({
      el: desc(el),
      id: el.id || '',
      chars: el.innerHTML.length,
      links: el.querySelectorAll('a[href]').length,
      visible: vis(el),
      h: Math.round(el.getBoundingClientRect().height),
    });
  }
  const accounted = blocks.reduce((n, b) => n + b.chars, 0);

  const allLinks = qa('a[href]', main);

  /* 首屏：以锚点 top 是否落在视口内判定（与 b1u-measure metric B 一致） */
  const firstScreen = allLinks.filter((a) => {
    if (!vis(a)) return false;
    const b = a.getBoundingClientRect();
    return b.top < window.innerHeight && b.height > 0;
  });
  /* 导航性目标：分区入口卡 / sec-index / all-pages / categories / snapshots / 外链 / 纯锚点。
     ⚠ 刻意**不排除** .host-paths：那 4 张服主卡指向的是**具体文档页**
     （R3-1 的成果：首屏通向具体文档的链接 0 → 4–7），把它们算作「文档链接」才对。 */
  const NAVish = (a) => {
    const h = a.getAttribute('href') || '';
    if (!h || h.startsWith('#') || h.startsWith('http')) return true;
    if (a.closest('.entry-cards, .sec-index, .quickbar, .cat-anchorbar, .info-footer')) return true;
    if (/^(all-pages|snapshots)\.html$/.test(h)) return true;
    if (h.includes('categories/')) return true;
    return false;
  };
  const firstScreenDoc = firstScreen.filter((a) => !NAVish(a));

  const secIndex = qa('.sec-index', main);
  const secItems = secIndex.length ? qa('.sec-item', main) : [];

  return {
    path: location.pathname.split('/').slice(-2).join('/'),
    mainChars: main.innerHTML.length,
    mainOuterChars: main.outerHTML.length,
    mainLinks: allLinks.length,
    mainDetails: qa('details', main).length,
    mainOpenDetails: qa('details[open]', main).length,
    blocks: blocks,
    accounted: accounted,
    pageHeight: document.documentElement.scrollHeight,
    bodyHeight: Math.round(document.body.getBoundingClientRect().height),
    firstScreenLinks: firstScreen.length,
    firstScreenDocLinks: firstScreenDoc.length,
    firstScreenDocHrefs: firstScreenDoc.slice(0, 12).map((a) => (a.getAttribute('href') || '') + ' :: ' + txt(a, 18)),
    secIndexPresent: secIndex.length,
    secItemCount: secItems.length,
    secItems: secItems.map((a) => ({
      href: a.getAttribute('href'),
      text: txt(a, 34),
      visible: vis(a),
      h: Math.round(a.getBoundingClientRect().height),
      w: Math.round(a.getBoundingClientRect().width),
    })),
    treeFoldPresent: qa('.tree-fold', main).length,
    counts: {
      entryCards: qa('.entry-card', main).length,
      hostCards: qa('.host-card', main).length,
      catChips: qa('.cat-anchorbar a', main).length,
      quickbar: qa('.quickbar a', main).length,
    },
    visibleLinks: allLinks.filter(vis).length,
    docHeightMain: Math.round(main.getBoundingClientRect().height),
  };
}

/* ------------------------------------------------------------------ */
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--allow-file-access-from-files'] });
  const out = { at: new Date().toISOString(), label: LABEL, chrome: EXE || 'bundled', page: PAGE, pages: {} };
  const indexFile = path.join(REPO, PAGE);
  out.pages[PAGE] = {};

  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const fails = [];
    page.on('requestfailed', (r) => fails.push(r.url().slice(-60) + ' :: ' + (r.failure() && r.failure().errorText)));
    page.on('pageerror', (e) => fails.push('pageerror: ' + String(e.message).slice(0, 80)));
    await page.goto(toUrl(PAGE), { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const m = await page.evaluate(MEASURE);
    m.vp = vp.name;
    m.vpHeight = vp.h;
    m.requestFailures = fails;
    m.indexBytes = fs.statSync(indexFile).size;
    out.pages[PAGE][vp.name] = m;
    await ctx.close();
  }
  await browser.close();

  const dir = path.join(REPO, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'b2h-measure-' + LABEL + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8');

  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
  const lines = [];
  lines.push('=== ' + PAGE + ' (' + LABEL + ') ===');
  lines.push('  vp   | main字符 | 链接 | details | 页高 | 首屏链接/文档链接 | sec条目 | tree-fold | indexBytes');
  for (const vp of VPS) {
    const m = out.pages[PAGE][vp.name];
    lines.push('  ' + pad(vp.name, 4) + ' | ' + pad(m.mainChars, 8) + ' | ' + pad(m.mainLinks, 4) + ' | '
      + pad(m.mainDetails + '/' + m.mainOpenDetails, 7) + ' | ' + pad(m.pageHeight, 4) + ' | '
      + pad(m.firstScreenLinks + '/' + m.firstScreenDocLinks, 17) + ' | '
      + pad(m.secItemCount, 7) + ' | ' + pad(m.treeFoldPresent, 9) + ' | ' + m.indexBytes);
    if (m.requestFailures.length) lines.push('        !! 请求失败 ' + JSON.stringify(m.requestFailures.slice(0, 4)));
    if (vp.name === '1440') {
      lines.push('        块分解（accounted=' + m.accounted + ' / main=' + m.mainChars + '，差 ' + (m.mainChars - m.accounted) + '）：');
      for (const b of m.blocks) {
        lines.push('          ' + pad(b.el + (b.id ? '#' + b.id : ''), 26) + ' '
          + pad(b.chars, 7) + ' 字符 ' + pad((m.mainChars ? (b.chars / m.mainChars * 100).toFixed(1) : '0') + '%', 7)
          + ' 链接 ' + pad(b.links, 4) + ' 高 ' + pad(b.h, 5) + 'px' + (b.visible ? '' : ' [不可见]'));
      }
      lines.push('        计数 ' + JSON.stringify(m.counts) + '  secItems=' + JSON.stringify(m.secItems.map((s) => s.href + '[' + s.text + ']' + (s.visible ? '' : '!vis'))));
    }
  }
  lines.push('json -> ' + file);

  if (COMPARE) {
    const prevFile = path.join(dir, 'b2h-measure-' + COMPARE + '.json');
    if (fs.existsSync(prevFile)) {
      const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
      lines.push('');
      lines.push('=== 对照 ' + COMPARE + ' → ' + LABEL + ' ===');
      lines.push('  vp   | main字符 | 链接 | 页高 | 首屏链接/文档 | indexBytes');
      for (const vp of VPS) {
        const a = prev.pages[PAGE] && prev.pages[PAGE][vp.name];
        const b = out.pages[PAGE][vp.name];
        if (!a || !b) continue;
        const d = (x, y) => String(x) + '→' + String(y);
        const pct = a.mainChars ? (100 * (b.mainChars - a.mainChars) / a.mainChars).toFixed(1) + '%' : '—';
        lines.push('  ' + pad(vp.name, 4) + ' | ' + pad(d(a.mainChars, b.mainChars) + ' (' + pct + ')', 20) + ' | '
          + pad(d(a.mainLinks, b.mainLinks), 10) + ' | ' + pad(d(a.pageHeight, b.pageHeight), 11) + ' | '
          + pad(d(a.firstScreenLinks, b.firstScreenLinks) + '/' + d(a.firstScreenDocLinks, b.firstScreenDocLinks), 17) + ' | '
          + d(a.indexBytes, b.indexBytes));
      }
      lines.push('  达标核对（目标 main≤5200 / 链接≤40 / 页高@1440≤800 / bytes≤105000）：');
      for (const vp of VPS) {
        const b = out.pages[PAGE][vp.name];
        lines.push('   ' + pad(vp.name, 4) + ' main=' + pad(b.mainChars <= 5200 ? 'PASS' : 'FAIL', 5)
          + ' links=' + pad(b.mainLinks <= 40 ? 'PASS' : 'FAIL', 5)
          + ' height=' + pad(vp.name === '1440' ? (b.pageHeight <= 800 ? 'PASS' : 'FAIL(' + b.pageHeight + ')') : 'n/a', 10)
          + ' bytes=' + (b.indexBytes <= 105000 ? 'PASS' : 'FAIL'));
      }
    } else {
      lines.push('(未找到 ' + prevFile + ')');
    }
  }
  console.log(lines.join('\n'));
})().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack : e)); process.exit(1); });
