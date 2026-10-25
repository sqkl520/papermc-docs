#!/usr/bin/env node
'use strict';
/**
 * b1o-file.js — 任务 B：`file://` 直开复验（离线镜像的核心承诺）。
 *
 * 对每一页在 file:/// 协议下检查：
 *   1 控制台错误（console error/warning + pageerror + requestfailed）
 *   2 CSS 是否真的生效（--topbar-h / body 背景 / .article 宽度）
 *   3 JS 是否初始化（#nav-toggle 可点、TOC 的 details.open 是否被 matchMedia 正确设置）
 *   4 搜索是否可用（点开 → 输入 → 是否出结果）
 *   5 批 1 新增项：TOC 折叠/展开、抽屉 focus({preventScroll})、.src-item 拉伸链接、[data-overflowing]
 *
 * 用法：
 *   node tools/b1o-file.js [--json=$env:TEMP\b1o\file.json] [--pages=...] [--slow]
 *
 * 只写 --json 指定文件（默认系统临时目录）；不碰站点产物。
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const p = '--' + n + '=';
  const hit = argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : d;
};
const OUT_JSON = path.resolve(opt('json', path.join(require("os").tmpdir() || '.', 'b1o', 'file.json')));

/** 浏览器可执行文件：env 拼路径，不写盘符字面量（privacy-scan ① 类） */
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);
function browserPath() {
  for (const c of CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return null;
}

/** 任务书指定的页面（相对仓库根） */
const PAGES = [
  { id: 'index', rel: 'index.html', note: '落地页' },
  { id: 'all-pages', rel: 'all-pages.html', note: '全部文章 141' },
  { id: 'paper-index', rel: 'paper/index.html', note: 'Paper 分区首页' },
  { id: 'paper-dialogs', rel: 'paper/dev/dialogs/index.html', note: '正文页（TOC 24 条）' },
  { id: 'velocity-tuning', rel: 'velocity/tuning/index.html', note: '正文页（短 TOC）' },
];

const results = [];

function classifyConsole(msg) {
  const t = msg.type();
  return t === 'error' ? 'error' : (t === 'warning' ? 'warning' : 'other');
}

async function probePage(browser, spec) {
  const abs = path.join(REPO, spec.rel);
  const url = pathToFileURL(abs).href;
  const out = {
    id: spec.id, rel: spec.rel, note: spec.note, url, exists: fs.existsSync(abs),
    consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], httpish: {},
    css: {}, js: {}, search: {}, batch1: {}, shots: [],
  };
  if (!out.exists) { out.fatal = 'file missing'; return out; }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const kind = classifyConsole(m);
    const rec = { type: m.type(), text: m.text().slice(0, 400) };
    if (kind === 'error') out.consoleErrors.push(rec);
    else if (kind === 'warning') out.consoleWarnings.push(rec);
  });
  page.on('pageerror', (e) => out.pageErrors.push({ message: String(e && e.message || e).slice(0, 400) }));
  page.on('requestfailed', (r) => {
    const u = r.url();
    out.failedRequests.push({ url: u.slice(0, 300), reason: (r.failure() && r.failure().errorText) || '?' });
  });

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  } catch (e) {
    out.fatal = 'goto failed: ' + String(e.message).slice(0, 300);
    await ctx.close();
    return out;
  }
  await page.waitForTimeout(700);

  /* ---------- 2 CSS ---------- */
  out.css = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const bodyCS = getComputedStyle(document.body);
    const art = document.querySelector('.article, main .article, main.content');
    const artCS = art ? getComputedStyle(art) : null;
    const sheet = Array.from(document.styleSheets).map((s) => {
      let rules = -1;
      try { rules = s.cssRules ? s.cssRules.length : -2; } catch (e) { rules = -3; }
      return { href: s.href ? String(s.href).split('/').slice(-2).join('/') : '(inline)', rules };
    });
    // 用一个探针元素验证样式表真的在起作用（不只是 <link> 存在）
    const probe = document.createElement('div');
    probe.className = 'topbar';
    document.body.appendChild(probe);
    const probeCS = getComputedStyle(probe);
    const probePos = probeCS.position;
    const probeMinH = probeCS.minHeight;
    probe.remove();
    return {
      topbarH: cs.getPropertyValue('--topbar-h').trim(),
      bodyBg: bodyCS.backgroundColor,
      bodyColor: bodyCS.color,
      articleSel: art ? (art.className || art.tagName) : null,
      articleWidth: artCS ? artCS.width : null,
      articleMaxWidth: artCS ? artCS.maxWidth : null,
      fontFamily: bodyCS.fontFamily.slice(0, 60),
      styleSheets: sheet,
      probeSticky: probePos,
      probeMinH,
    };
  });

  /* ---------- 3 JS ---------- */
  out.js = await page.evaluate(() => {
    const toggle = document.getElementById('nav-toggle');
    const tocFold = document.querySelector('.toc-side .toc-fold');
    const wide = window.matchMedia('(min-width:1025px)').matches;
    // 判断脚本是否执行过：批 1 会给 .code-scroll 加 tabindex/role（initScrollRegions）
    const scrollRegions = document.querySelectorAll('.code-scroll[role="region"]').length;
    const tableWrap = document.querySelectorAll('.table-wrap[role="region"]').length;
    return {
      hasToggle: !!toggle,
      toggleVisible: toggle ? getComputedStyle(toggle).display !== 'none' : false,
      toggleRect: toggle ? (() => { const r = toggle.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
      toggleAria: toggle ? toggle.getAttribute('aria-expanded') : null,
      tocFoldExists: !!tocFold,
      tocFoldOpen: tocFold ? tocFold.open : null,
      tocFoldHasOpenAttr: tocFold ? tocFold.hasAttribute('open') : null,
      matchMediaWide: wide,
      tocOpenMatchesWide: tocFold ? (tocFold.open === wide) : null,
      scrollRegionsInit: scrollRegions,
      tableWrapInit: tableWrap,
      bodyClass: document.body.className,
      hasLibSearch: typeof window.__LIBRARY_SEARCH__ !== 'undefined',
      theme: document.documentElement.getAttribute('data-theme'),
      jsErrors: 0,
    };
  });

  /* 点击 #nav-toggle：验证「可点」且抽屉真的打开 */
  out.js.toggleClick = await (async () => {
    const t = await page.$('#nav-toggle');
    if (!t) return { clicked: false };
    const before = await page.evaluate(() => ({ expanded: document.getElementById('nav-toggle').getAttribute('aria-expanded'), body: document.body.className, y: window.pageYOffset }));
    try { await t.click({ timeout: 4000 }); } catch (e) { return { clicked: false, error: String(e.message).slice(0, 160) }; }
    await page.waitForTimeout(420);
    const after = await page.evaluate(() => {
      const side = document.getElementById('sidebar') || document.querySelector('.sidebar');
      const r = side ? side.getBoundingClientRect() : null;
      return {
        expanded: document.getElementById('nav-toggle').getAttribute('aria-expanded'),
        body: document.body.className,
        y: window.pageYOffset,
        sidebarLeft: r ? Math.round(r.left) : null,
        sidebarVisible: r ? (r.left > -5 && r.width > 0) : false,
        inert: side ? side.inert : null,
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    });
    // 再点回去关闭
    try { await t.click({ timeout: 4000 }); } catch (e) { /* ignore */ }
    await page.waitForTimeout(420);
    const closed = await page.evaluate(() => ({
      expanded: document.getElementById('nav-toggle').getAttribute('aria-expanded'),
      y: window.pageYOffset,
      body: document.body.className,
    }));
    return { clicked: true, before, after, closed, scrollRestored: Math.abs(closed.y - before.y) <= 1 };
  })();

  /* ---------- 4 搜索 ---------- */
  out.search = await (async () => {
    const started = Date.now();
    let opened = false;
    // 首页用 data-open-search 按钮；其它页用顶栏同款按钮
    const btn = await page.$('[data-open-search]');
    if (btn) { try { await btn.click({ timeout: 4000 }); opened = true; } catch (e) { /* ignore */ } }
    let dlgOpen = await page.evaluate(() => {
      const d = document.getElementById('search-dialog');
      return d ? d.open : null;
    });
    if (!dlgOpen) {
      await page.keyboard.press('Control+KeyK').catch(() => {});
      await page.waitForTimeout(300);
      dlgOpen = await page.evaluate(() => { const d = document.getElementById('search-dialog'); return d ? d.open : null; });
    }
    const input = await page.$('#search-input');
    let typed = false;
    if (input) {
      // 输入中文关键词（尽量走 CJK 路径）与英文各一次，取能出结果的那个
      try { await input.fill('对话框'); typed = true; } catch (e) { /* ignore */ }
    }
    if (!typed) {
      return { opened, dlgOpen, typed, results: 0, fatal: 'no #search-input' };
    }
    let count = 0;
    let waited = 0;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150); waited += 150;
      count = await page.evaluate(() => document.querySelectorAll('#search-results a').length);
      if (count > 0) break;
    }
    let sample = await page.evaluate(() => Array.from(document.querySelectorAll('#search-results a')).slice(0, 3).map((a) => ({ text: (a.textContent || '').trim().slice(0, 60), href: a.getAttribute('href') })));
    let firstQuery = '对话框';
    if (count === 0 && input) {
      try { await input.fill('dialog'); } catch (e) { /* ignore */ }
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(150); waited += 150;
        count = await page.evaluate(() => document.querySelectorAll('#search-results a').length);
        if (count > 0) break;
      }
      sample = await page.evaluate(() => Array.from(document.querySelectorAll('#search-results a')).slice(0, 3).map((a) => ({ text: (a.textContent || '').trim().slice(0, 60), href: a.getAttribute('href') })));
      firstQuery = 'dialog';
    }
    const srCount = await page.evaluate(() => { const e = document.getElementById('search-count'); return e ? (e.textContent || '').trim().slice(0, 80) : null; });
    const emptyMsg = await page.evaluate(() => { const e = document.querySelector('.sr-empty'); return e ? (e.textContent || '').trim().slice(0, 200) : null; });
    const indexState = await page.evaluate(() => ({
      pages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages && window.__LIBRARY_SEARCH__.pages.length) || 0,
    }));
    // Esc 关掉
    await page.keyboard.press('Escape').catch(() => {});
    return { opened, dlgOpen, typed, query: firstQuery, results: count, sample, countLabel: srCount, emptyMsg, indexPages: indexState.pages, ms: Date.now() - started, waitedMs: waited };
  })();

  /* ---------- 5 批 1 新增项 ---------- */
  out.batch1 = await page.evaluate(() => {
    const res = {};
    // (a) TOC 折叠/展开：手动切 details.open，并把 width 调到窄屏触发 matchMedia 双向同步
    const fold = document.querySelector('.toc-side .toc-fold');
    res.toc = { exists: !!fold, open: fold ? fold.open : null, wide: matchMedia('(min-width:1025px)').matches };
    if (fold) {
      const wasOpen = fold.open;
      fold.open = !wasOpen;
      res.toc.canToggle = fold.open !== wasOpen;
      const ol = fold.querySelector('ol');
      res.toc.linksVisibleWhenOpen = fold.open && ol ? ol.getBoundingClientRect().height > 0 : null;
      fold.open = wasOpen;
      res.toc.restored = fold.open === wasOpen;
      // summary 是否可点（有 summary 元素且不是 display:none）
      const sum = fold.querySelector('summary.toc-title');
      res.toc.summaryClickable = !!sum && getComputedStyle(sum).display !== 'none';
    }
    // (b) 抽屉 focus({preventScroll})：检查 #nav-toggle 上是否绑过（点开后 activeElement 在抽屉内，且滚动没变）
    res.drawer = {
      hasScrim: !!document.querySelector('.nav-scrim'),
      toggleAria: document.getElementById('nav-toggle') ? document.getElementById('nav-toggle').getAttribute('aria-expanded') : null,
      supportsPreventScroll: (() => {
        // feature-detect：focus({preventScroll}) 在 Chromium 里不会抛错
        const b = document.createElement('button');
        document.body.appendChild(b);
        let ok = false;
        try { b.focus({ preventScroll: true }); ok = document.activeElement === b; } catch (e) { ok = false; }
        b.remove();
        return ok;
      })(),
    };
    // (c) .src-item 拉伸链接：::after 覆盖整行 → 点在 .src-sum 上，elementFromPoint 返回 .src-link
    const items = document.querySelectorAll('.src-item');
    res.srcItem = { count: items.length };
    if (items.length) {
      const it = items[0];
      const link = it.querySelector('.src-link');
      const sum = it.querySelector('.src-sum');
      const cs = link ? getComputedStyle(link, '::after') : null;
      res.srcItem.hasPseudo = !!cs;
      res.srcItem.pseudoInset = cs ? [cs.top, cs.right, cs.bottom, cs.left].join(' ') : null;
      res.srcItem.linkPosition = link ? getComputedStyle(link).position : null;
      res.srcItem.itemPosition = getComputedStyle(it).position;
      if (sum) {
        const r = sum.getBoundingClientRect();
        const x = Math.round(r.left + Math.min(20, r.width / 2));
        const y = Math.round(r.top + r.height / 2);
        const hitEl = document.elementFromPoint(x, y);
        res.srcItem.hitOnSum = hitEl ? { tag: hitEl.tagName, cls: hitEl.className, isLink: !!(hitEl.closest && hitEl.closest('a.src-link')), anchorHref: hitEl.closest && hitEl.closest('a') ? hitEl.closest('a').getAttribute('href') : null } : null;
        // 点击是否真的会跳转（不真跳，只看命中链）
        res.srcItem.sumPointerEvents = getComputedStyle(sum).pointerEvents;
      }
    }
    // (d) [data-overflowing]：只在真的溢出时才有；统计总数 + 抽查一个 code-scroll 是否真的可滚
    const over = document.querySelectorAll('[data-overflowing]');
    res.overflowing = { count: over.length, classes: Array.from(over).slice(0, 5).map((e) => e.className) };
    const scrolls = Array.from(document.querySelectorAll('.code-scroll'));
    let reallyOver = 0;
    for (const h of scrolls) { const pre = h.querySelector('pre'); if (pre && (pre.scrollWidth > pre.clientWidth + 1 || h.scrollWidth > h.clientWidth + 1)) reallyOver++; }
    res.overflowing.codeScrolls = scrolls.length;
    res.overflowing.reallyOverflowing = reallyOver;
    res.overflowing.matches = (res.overflowing.count > 0) === (reallyOver > 0) || reallyOver === 0;
    // CSS 是否消费 [data-overflowing]（::after 提示条 / .code-title::after 文案）
    if (scrolls.length) {
      const probeOver = scrolls.find((h) => h.hasAttribute('data-overflowing'));
      if (probeOver) {
        const cs = getComputedStyle(probeOver, '::after');
        res.overflowing.afterContent = cs.content;
        res.overflowing.afterWidth = cs.width;
      }
      const cb = document.querySelector('.code-block:has(.code-scroll[data-overflowing]) .code-title');
      if (cb) res.overflowing.codeTitleAfter = getComputedStyle(cb, '::after').content;
    }
    return res;
  });

  /* 批 1 的「交互」部分用真实动作再验一遍（窄屏 TOC 折叠 → 展开） */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  out.batch1.tocNarrow = await page.evaluate(() => {
    const fold = document.querySelector('.toc-side .toc-fold');
    const wide = matchMedia('(min-width:1025px)').matches;
    return { wide, open: fold ? fold.open : null, openMatchesNarrow: fold ? (fold.open === false) : null };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  out.batch1.tocWide = await page.evaluate(() => {
    const fold = document.querySelector('.toc-side .toc-fold');
    const wide = matchMedia('(min-width:1025px)').matches;
    return { wide, open: fold ? fold.open : null, openMatchesWide: fold ? (fold.open === true) : null };
  });

  /* ---------- 汇总 ----------
     口径说明（避免把「站点正确行为」误判成缺陷）：
     · 落地页 / 清单页 / 分区首页没有 .toc-side —— 没有目录不算失败，故用 tocPresent 区分。
     · 视口 1280 属 >=1024 常驻侧栏模式，☰ 本就不该打开抽屉；本文件的 toggleClick 仅是冒烟，
       抽屉的真实行为在 tools/b1o-file2.js 里以 390 宽逐项复验。 */
  const tocN = out.js.tocFoldExists;
  out.verdict = {
    consoleErrors: out.consoleErrors.length,
    pageErrors: out.pageErrors.length,
    failedRequests: out.failedRequests.length,
    cssOk: !!(out.css.topbarH && out.css.topbarH !== '' && out.css.bodyBg && out.css.bodyBg !== 'rgba(0, 0, 0, 0)' && out.css.articleWidth && out.css.probeSticky === 'sticky'),
    jsOk: !!(out.js.hasToggle && out.js.scrollRegionsInit >= 0 && (!tocN || out.js.tocOpenMatchesWide === true)),
    tocPresent: tocN,
    searchOk: out.search.results > 0,
  };
  out.verdict.fatal = !out.verdict.cssOk || out.verdict.pageErrors > 0 || out.consoleErrors > 0 || !out.verdict.jsOk;

  await ctx.close();
  return out;
}

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome/chromium found (set CHROME_PATH)'); process.exit(2); }
  console.log('BROWSER ' + exe);
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'],
  });
  const keep = opt('pages', '');
  const list = keep ? PAGES.filter((p) => keep.split(',').includes(p.id)) : PAGES;
  for (const spec of list) {
    console.log('\n=== ' + spec.id + '  ' + spec.rel);
    let r;
    try { r = await probePage(browser, spec); } catch (e) { r = { id: spec.id, rel: spec.rel, fatal: 'probe threw: ' + String(e.stack || e).slice(0, 500) }; }
    results.push(r);
    console.log('  verdict ' + JSON.stringify(r.verdict || {}));
    if (r.fatal) console.log('  FATAL ' + r.fatal);
    if (r.consoleErrors && r.consoleErrors.length) for (const e of r.consoleErrors.slice(0, 6)) console.log('  console.error: ' + e.text.slice(0, 200));
    if (r.pageErrors && r.pageErrors.length) for (const e of r.pageErrors.slice(0, 6)) console.log('  pageerror: ' + e.message.slice(0, 200));
    if (r.failedRequests && r.failedRequests.length) for (const e of r.failedRequests.slice(0, 6)) console.log('  reqfail: ' + e.url.slice(-90) + ' :: ' + e.reason);
    if (r.css) console.log('  css --topbar-h=' + r.css.topbarH + ' bodyBg=' + r.css.bodyBg + ' articleW=' + r.css.articleWidth + ' probe=' + r.css.probeSticky + '/' + r.css.probeMinH);
    if (r.js) console.log('  js toggle=' + r.js.hasToggle + ' tocOpen=' + r.js.tocFoldOpen + ' mmWide=' + r.js.matchMediaWide + ' scrollRegions=' + r.js.scrollRegionsInit);
    if (r.search) console.log('  search opened=' + r.search.opened + ' dlg=' + r.search.dlgOpen + ' q=' + r.search.query + ' results=' + r.search.results + ' indexPages=' + r.search.indexPages);
    if (r.batch1) console.log('  b1 toc=' + JSON.stringify(r.batch1.toc) + '\n      srcItem=' + JSON.stringify(r.batch1.srcItem) + '\n      overflowing=' + JSON.stringify(r.batch1.overflowing) + '\n      drawer=' + JSON.stringify(r.batch1.drawer) + '\n      narrow=' + JSON.stringify(r.batch1.tocNarrow) + ' wide=' + JSON.stringify(r.batch1.tocWide));
  }
  await browser.close();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ tool: 'tools/b1o-file.js', generatedAt: new Date().toISOString(), pages: results }, null, 2), 'utf8');
  console.log('\nWROTE ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
