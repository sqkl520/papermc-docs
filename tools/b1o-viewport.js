#!/usr/bin/env node
'use strict';
/**
 * b1o-viewport.js — 任务 C：极端视口与缩放。
 *
 * 视口：320x568 / 1920x1080 / 812x375 / 1080x810
 * 缩放：deviceScaleFactor 1|2|3；浏览器页面缩放 50% / 200%（两种模拟口径都跑：
 *       (A) CSS 视口等效缩放 —— 页面缩放在布局上等价于 CSS 视口变小/变大；
 *       (B) CDP Emulation.setPageScaleFactor —— 捏合式缩放，验「放大后是否仍不横向溢出」。
 *
 * 每种组合检查：横向溢出 = 0（documentElement.scrollWidth <= clientWidth）、
 *               TOC 是否遮挡正文、sticky 是否错位。
 *
 * 用法：node tools/b1o-viewport.js [--json=$env:TEMP\b1o\viewport.json] [--url=http://127.0.0.1:8787]
 * 只写 --json 指定文件（默认系统临时目录）。
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT_JSON = path.resolve(opt('json', path.join(require("os").tmpdir() || '.', 'b1o', 'viewport.json')));
const BASE = opt('url', '');
const USE_FILE = !BASE;

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);
function browserPath() { for (const c of CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* */ } } return null; }

const VIEWPORTS = [
  { id: '320x568', w: 320, h: 568, note: '最小手机' },
  { id: '1920x1080', w: 1920, h: 1080, note: '大屏' },
  { id: '812x375', w: 812, h: 375, note: 'iPhone 横屏' },
  { id: '1080x810', w: 1080, h: 810, note: '平板横屏' },
];
const DSFS = [1, 2, 3];
const ZOOMS = [50, 200];

const PAGES = [
  { id: 'index', rel: 'index.html' },
  { id: 'paper-dialogs', rel: 'paper/dev/dialogs/index.html' },
  { id: 'velocity-tuning', rel: 'velocity/tuning/index.html' },
];

function urlFor(rel) { return USE_FILE ? pathToFileURL(path.join(REPO, rel)).href : BASE.replace(/\/+$/, '') + '/' + rel; }

/** 在页面里量：横向溢出 / TOC 遮挡 / sticky 位置 */
async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const overflow = Math.max(0, de.scrollWidth - de.clientWidth);
    const topbarH = parseFloat(getComputedStyle(de).getPropertyValue('--topbar-h')) || 0;
    const topbar = document.querySelector('.topbar');
    const toc = document.querySelector('.toc-side');
    const content = document.querySelector('.article') || document.querySelector('main.content') || document.querySelector('main');
    const sidebar = document.querySelector('.sidebar');
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const tocR = rect(toc);
    const contentR = rect(content);
    const tocVisible = visible(toc);
    // TOC 遮挡：TOC 可见且其矩形与正文矩形相交（横向 + 纵向都要重叠才算遮挡）
    let tocOverlapPx = 0;
    if (tocVisible && tocR && contentR) {
      const ox = Math.min(tocR.right, contentR.right) - Math.max(tocR.x, contentR.x);
      const oy = Math.min(tocR.bottom, contentR.bottom) - Math.max(tocR.y, contentR.y);
      if (ox > 1 && oy > 1) tocOverlapPx = Math.round(ox);
    }
    const toggle = document.getElementById('nav-toggle');
    const toggleRect = rect(toggle);
    const toggleVisible = visible(toggle);
    // sticky 判定：topbar 应为 sticky 且 top=0；侧栏/TOC 在宽屏为 sticky，top 应 ≈ --topbar-h
    const csTop = topbar ? getComputedStyle(topbar).position : null;
    const csToc = toc ? getComputedStyle(toc).position : null;
    const csSide = sidebar ? getComputedStyle(sidebar).position : null;
    return {
      overflow, topbarH,
      topbarPos: csTop, topbarRect: rect(topbar),
      tocPos: csToc, tocRect: tocR, tocVisible, tocDisplay: toc ? getComputedStyle(toc).display : null,
      contentRect: contentR,
      tocOverlapPx,
      sidebarPos: csSide, sidebarRect: rect(sidebar), sidebarVisible: visible(sidebar),
      toggleVisible, toggleRect,
      // 最小可点尺寸（44x44 是移动端常识门槛；只报数字不判红，320 宽下的真实值）
      innerW: window.innerWidth, innerH: window.innerHeight,
      dpr: window.devicePixelRatio,
      vv: window.visualViewport ? { w: Math.round(window.visualViewport.width), h: Math.round(window.visualViewport.height), scale: window.visualViewport.scale } : null,
    };
  });
}

/** 滚到中部再量 sticky（sticky 只有在滚动后才暴露错位） */
async function measureScrolled(page) {
  await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.45)));
  await page.waitForTimeout(320);
  const r = await page.evaluate(() => {
    const de = document.documentElement;
    const topbar = document.querySelector('.topbar');
    const toc = document.querySelector('.toc-side');
    const side = document.querySelector('.sidebar');
    const g = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
    return {
      scrollY: Math.round(window.pageYOffset),
      overflow: Math.max(0, de.scrollWidth - de.clientWidth),
      topbarTop: g(topbar),
      tocTop: g(toc),
      sidebarTop: g(side),
      topbarH: parseFloat(getComputedStyle(de).getPropertyValue('--topbar-h')) || 0,
      tocPos: toc ? getComputedStyle(toc).position : null,
      sidebarPos: side ? getComputedStyle(side).position : null,
    };
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(160);
  return r;
}

const rows = [];

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome found'); process.exit(2); }
  console.log('BROWSER ' + exe + (USE_FILE ? '  [file://]' : '  [' + BASE + ']'));

  for (const vp of VIEWPORTS) {
    for (const dsf of DSFS) {
      const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });
      for (const pg of PAGES) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: dsf, isMobile: vp.w <= 820, hasTouch: vp.w <= 820 });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
        page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
        try {
          await page.goto(urlFor(pg.rel), { waitUntil: 'load', timeout: 45000 });
          await page.waitForTimeout(500);
          const m = await measure(page);
          const s = await measureScrolled(page);
          const row = {
            mode: 'dsf', viewport: vp.id, vpW: vp.w, vpH: vp.h, dsf, zoom: 100, page: pg.id,
            overflow: m.overflow, overflowScrolled: s.overflow,
            tocVisible: m.tocVisible, tocPos: m.tocPos, tocOverlapPx: m.tocOverlapPx,
            topbarPos: m.topbarPos, topbarTopScrolled: s.topbarTop, tocTopScrolled: s.tocTop,
            sidebarPos: m.sidebarPos, sidebarTopScrolled: s.sidebarTop,
            toggleVisible: m.toggleVisible, toggleRect: m.toggleRect,
            innerW: m.innerW, dpr: m.dpr, vv: m.vv, errors: errs.slice(0, 4),
            topbarRect: m.topbarRect, contentRect: m.contentRect, tocRect: m.tocRect,
          };
          row.ok = {
            noHScroll: row.overflow === 0 && row.overflowScrolled === 0,
            noTocOcclusion: row.tocOverlapPx === 0,
            stickyOk: row.topbarTopScrolled === 0 && (row.tocPos !== 'sticky' || row.tocTopScrolled === null || Math.abs(row.tocTopScrolled - (m.topbarH || 0)) <= 2) && (row.sidebarPos !== 'sticky' || row.sidebarTopScrolled === null || Math.abs(row.sidebarTopScrolled - (m.topbarH || 0)) <= 2),
            noErrors: errs.length === 0,
          };
          row.okAll = row.ok.noHScroll && row.ok.noTocOcclusion && row.ok.stickyOk && row.ok.noErrors;
          rows.push(row);
          console.log('[' + (row.okAll ? 'PASS' : 'FAIL') + '] ' + vp.id + ' dsf=' + dsf + ' ' + pg.id +
            '  ovf=' + row.overflow + '/' + row.overflowScrolled + ' tocOvl=' + row.tocOverlapPx +
            ' topbarTop=' + row.topbarTopScrolled + ' tocTop=' + row.tocTopScrolled + ' sidePos=' + row.sidebarPos + '/' + row.sidebarTopScrolled +
            (errs.length ? '  ERR=' + errs[0] : ''));
        } catch (e) {
          rows.push({ mode: 'dsf', viewport: vp.id, dsf, page: pg.id, fatal: String(e.message).slice(0, 300) });
          console.log('[THROW] ' + vp.id + ' dsf=' + dsf + ' ' + pg.id + ' :: ' + String(e.message).slice(0, 200));
        }
        await ctx.close();
      }
      await browser.close();
    }
  }

  /* ---- 页面缩放 50% / 200% ---- */
  for (const vp of VIEWPORTS) {
    for (const z of ZOOMS) {
      const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });
      for (const pg of PAGES) {
        // (A) CSS 视口等效缩放
        const effW = Math.round(vp.w * 100 / z);
        const effH = Math.round(vp.h * 100 / z);
        const ctx = await browser.newContext({ viewport: { width: effW, height: effH }, deviceScaleFactor: Math.max(1, Math.round(z / 100)), isMobile: effW <= 820, hasTouch: effW <= 820 });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
        page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
        try {
          await page.goto(urlFor(pg.rel), { waitUntil: 'load', timeout: 45000 });
          await page.waitForTimeout(500);
          const m = await measure(page);
          const s = await measureScrolled(page);
          // (B) 同页再叠一次 CDP 捏合缩放
          const cdp = await ctx.newCDPSession(page);
          let pinch = null;
          try {
            await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: z / 100 });
            await page.waitForTimeout(350);
            pinch = await page.evaluate(() => ({
              overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
              vvScale: window.visualViewport ? window.visualViewport.scale : null,
              vvW: window.visualViewport ? Math.round(window.visualViewport.width) : null,
            }));
          } catch (e) { pinch = { error: String(e.message).slice(0, 160) }; }
          const row = {
            mode: 'pzoom', viewport: vp.id, vpW: vp.w, vpH: vp.h, zoom: z, effW, effH, page: pg.id,
            overflow: m.overflow, overflowScrolled: s.overflow,
            tocVisible: m.tocVisible, tocPos: m.tocPos, tocOverlapPx: m.tocOverlapPx,
            topbarPos: m.topbarPos, topbarTopScrolled: s.topbarTop, tocTopScrolled: s.tocTop,
            sidebarPos: m.sidebarPos, sidebarTopScrolled: s.sidebarTop,
            toggleVisible: m.toggleVisible, toggleRect: m.toggleRect, innerW: m.innerW, dpr: m.dpr, vv: m.vv,
            pinch, errors: errs.slice(0, 4), topbarH: m.topbarH,
          };
          row.ok = {
            noHScroll: row.overflow === 0 && row.overflowScrolled === 0,
            noTocOcclusion: row.tocOverlapPx === 0,
            stickyOk: row.topbarTopScrolled === 0 && (row.tocPos !== 'sticky' || row.tocTopScrolled === null || Math.abs(row.tocTopScrolled - (m.topbarH || 0)) <= 2),
            noErrors: errs.length === 0,
            pinchNoHScroll: !pinch || pinch.error || pinch.overflow === 0,
          };
          row.okAll = row.ok.noHScroll && row.ok.noTocOcclusion && row.ok.stickyOk && row.ok.noErrors;
          rows.push(row);
          console.log('[' + (row.okAll ? 'PASS' : 'FAIL') + '] zoom' + z + '% ' + vp.id + ' -> cssViewport ' + effW + 'x' + effH + ' ' + pg.id +
            '  ovf=' + row.overflow + '/' + row.overflowScrolled + ' tocOvl=' + row.tocOverlapPx +
            ' topbarTop=' + row.topbarTopScrolled + ' tocTop=' + row.tocTopScrolled +
            ' pinch=' + JSON.stringify(pinch) + (errs.length ? '  ERR=' + errs[0] : ''));
        } catch (e) {
          rows.push({ mode: 'pzoom', viewport: vp.id, zoom: z, page: pg.id, fatal: String(e.message).slice(0, 300) });
          console.log('[THROW] zoom' + z + '% ' + vp.id + ' ' + pg.id + ' :: ' + String(e.message).slice(0, 200));
        }
        await ctx.close();
      }
      await browser.close();
    }
  }

  /* ---- --force-device-scale-factor=2 启动参数（第三种口径，验 OS 级缩放） ---- */
  {
    const browser = await chromium.launch({
      executablePath: exe,
      args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security', '--force-device-scale-factor=2'],
    });
    for (const pg of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
      try {
        await page.goto(urlFor(pg.rel), { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(450);
        const m = await measure(page);
        const s = await measureScrolled(page);
        const row = {
          mode: 'force-dsf2', viewport: '1280x800', dsf: m.dpr, zoom: 100, page: pg.id,
          overflow: m.overflow, overflowScrolled: s.overflow, tocOverlapPx: m.tocOverlapPx,
          topbarTopScrolled: s.topbarTop, tocTopScrolled: s.tocTop, tocPos: m.tocPos,
          innerW: m.innerW, dpr: m.dpr, vv: m.vv, errors: errs.slice(0, 3), topbarH: m.topbarH,
          ok: { noHScroll: m.overflow === 0 && s.overflow === 0, noTocOcclusion: m.tocOverlapPx === 0, stickyOk: s.topbarTop === 0, noErrors: errs.length === 0 },
        };
        row.okAll = row.ok.noHScroll && row.ok.noTocOcclusion && row.ok.stickyOk && row.ok.noErrors;
        rows.push(row);
        console.log('[' + (row.okAll ? 'PASS' : 'FAIL') + '] force-dsf2 1280x800 ' + pg.id + '  dpr=' + row.dpr + ' ovf=' + row.overflow + '/' + row.overflowScrolled + ' tocOvl=' + row.tocOverlapPx + ' topbarTop=' + row.topbarTopScrolled);
      } catch (e) {
        rows.push({ mode: 'force-dsf2', page: pg.id, fatal: String(e.message).slice(0, 300) });
      }
      await ctx.close();
    }
    await browser.close();
  }

  const fail = rows.filter((r) => !r.okAll);
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({
    tool: 'tools/b1o-viewport.js', generatedAt: new Date().toISOString(),
    target: USE_FILE ? 'file://' : BASE, rows, summary: { total: rows.length, pass: rows.length - fail.length, fail: fail.length },
  }, null, 2), 'utf8');
  console.log('\n==== ' + (rows.length - fail.length) + '/' + rows.length + ' PASS  -> ' + OUT_JSON);
  for (const f of fail.slice(0, 25)) console.log('  FAIL ' + f.mode + ' ' + (f.viewport || '') + ' dsf=' + (f.dsf || '') + ' zoom=' + (f.zoom || '') + ' ' + f.page + ' :: ' + JSON.stringify(f.ok || f.fatal));
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
