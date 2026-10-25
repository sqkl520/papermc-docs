#!/usr/bin/env node
'use strict';
/**
 * b1o-file2.js — 任务 B 补充：`file://` 下的**窄屏**交互复验（第一版探针在 1280 宽下测抽屉，
 * 而站点在 >=1024 时是常驻侧栏、☰ 本就不该打开抽屉 —— 这是探针口径错误，不是站点缺陷）。
 *
 * 覆盖：
 *   A 390x844 下 #nav-toggle 点击 → 抽屉打开（aria-expanded / 侧栏入视口 / body.nav-open / inert 解除）
 *   B 抽屉打开时焦点落在抽屉内，且关闭后页面滚动位置不变（focus({preventScroll}) 行为）
 *   C TOC 折叠/展开：窄屏 details 关闭、>=1025 强制 open（matchMedia 双向同步），并真点 summary
 *   D .src-item 拉伸链接：点在 .src-sum 文本上，命中链应回到 a.src-link（首页 src-tree）
 *   E [data-overflowing]：真溢出才有标记，且 CSS 提示「↔ 可横向滚动」可读
 *
 * 用法：node tools/b1o-file2.js [--json=$env:TEMP\b1o\file2.json]
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT_JSON = path.resolve(opt('json', path.join(require("os").tmpdir() || '.', 'b1o', 'file2.json')));

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

const PAGES = ['index.html', 'paper/dev/dialogs/index.html', 'velocity/tuning/index.html'];
const out = { tool: 'tools/b1o-file2.js', generatedAt: new Date().toISOString(), pages: [] };

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome found'); process.exit(2); }
  console.log('BROWSER ' + exe);
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });

  for (const rel of PAGES) {
    const url = pathToFileURL(path.join(REPO, rel)).href;
    const rec = { rel, url, checks: {} };
    console.log('\n=== ' + rel);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(600);

    /* A 抽屉打开 */
    rec.checks.drawer = await (async () => {
      const pre = await page.evaluate(() => ({ expanded: document.getElementById('nav-toggle').getAttribute('aria-expanded'), body: document.body.className, y: window.pageYOffset }));
      const t = await page.$('#nav-toggle');
      let clicked = false;
      try { await t.click({ timeout: 5000 }); clicked = true; } catch (e) { return { clicked: false, error: String(e.message).slice(0, 140) }; }
      await page.waitForTimeout(450);
      const post = await page.evaluate(() => {
        const side = document.getElementById('sidebar') || document.querySelector('.sidebar');
        const r = side ? side.getBoundingClientRect() : null;
        const css = side ? getComputedStyle(side) : null;
        return {
          expanded: document.getElementById('nav-toggle').getAttribute('aria-expanded'),
          body: document.body.className,
          drawerLeft: r ? Math.round(r.left) : null,
          drawerWidth: r ? Math.round(r.width) : null,
          inert: side ? side.inert : null,
          transform: css ? css.transform : null,
          bodyOverflow: getComputedStyle(document.body).overflow,
          scrollY: window.pageYOffset,
          overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          scrimVisible: (() => { const s = document.querySelector('.nav-scrim'); if (!s) return null; const cs = getComputedStyle(s); return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05; })(),
          focusInDrawer: (() => { const a = document.activeElement; return !!(a && side && side.contains(a)); })(),
          activeTag: document.activeElement ? document.activeElement.tagName + '.' + (document.activeElement.className || '') : null,
        };
      });
      // 关闭：再点 ☰
      try { await t.click({ timeout: 5000 }); } catch (e) { /* */ }
      await page.waitForTimeout(450);
      const closed = await page.evaluate(() => ({
        expanded: document.getElementById('nav-toggle').getAttribute('aria-expanded'),
        y: window.pageYOffset,
        body: document.body.className,
        focusOnToggle: document.activeElement === document.getElementById('nav-toggle'),
      }));
      return {
        clicked, before: pre, open: post, closed,
        ok: {
          opened: post.expanded === 'true',
          drawerInViewport: post.drawerLeft !== null && post.drawerLeft >= -2,
          inertCleared: post.inert === false,
          scrollLocked: ['hidden', 'clip'].includes(post.bodyOverflow),
          scrim: post.scrimVisible === true,
          focusInDrawer: post.focusInDrawer === true,
          noHScroll: post.overflow === 0,
          focusBackToToggle: closed.focusOnToggle === true,
          scrollRestored: Math.abs(closed.y - pre.y) <= 1,
        },
      };
    })();

    /* C TOC 折叠/展开（窄屏 + 宽屏两向） */
    rec.checks.toc = await (async () => {
      const narrow = await page.evaluate(() => {
        const f = document.querySelector('.toc-side .toc-fold');
        if (!f) return { exists: false };
        return {
          exists: true, wide: matchMedia('(min-width:1025px)').matches, open: f.open,
          hasOpenAttr: f.hasAttribute('open'), summaryVisible: (() => { const s = f.querySelector('summary'); return !!s && getComputedStyle(s).display !== 'none'; })(),
          olHeightClosed: (() => { const ol = f.querySelector('ol'); return ol ? Math.round(ol.getBoundingClientRect().height) : null; })(),
        };
      });
      // 真点 summary 展开
      let clickResult = null;
      const sum = await page.$('.toc-side .toc-fold > summary');
      if (sum) {
        try { await sum.click({ timeout: 4000 }); await page.waitForTimeout(320); } catch (e) { /* */ }
        clickResult = await page.evaluate(() => {
          const f = document.querySelector('.toc-side .toc-fold');
          const ol = f ? f.querySelector('ol') : null;
          return { open: f ? f.open : null, olHeightOpen: ol ? Math.round(ol.getBoundingClientRect().height) : null, links: ol ? ol.querySelectorAll('a').length : 0 };
        });
      }
      // 加宽到 1280 → matchMedia 应强制 open
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(500);
      const wide = await page.evaluate(() => {
        const f = document.querySelector('.toc-side .toc-fold');
        if (!f) return { exists: false };
        const ol = f.querySelector('ol');
        return { exists: true, wide: matchMedia('(min-width:1025px)').matches, open: f.open, olHeight: ol ? Math.round(ol.getBoundingClientRect().height) : null, pos: getComputedStyle(document.querySelector('.toc-side')).position };
      });
      // 缩回 390 → 应关闭
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      const back = await page.evaluate(() => {
        const f = document.querySelector('.toc-side .toc-fold');
        return f ? { wide: matchMedia('(min-width:1025px)').matches, open: f.open } : { exists: false };
      });
      return {
        narrow, clickResult, wide, back,
        ok: {
          narrowClosed: !narrow.exists || narrow.open === false,
          toggleWorks: !clickResult || clickResult.open === true,
          wideForceOpen: !wide.exists || wide.open === true,
          backToNarrowClosed: !back.exists || back.open === false,
        },
      };
    })();

    /* D .src-item 拉伸链接（只在首页有 src-tree） */
    rec.checks.srcItem = await (async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(400);
      return page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.src-item'));
        if (!items.length) return { count: 0, skip: true };
        const probe = [];
        // 取前 5 个有 .src-sum 的条目，逐一点在摘要文字上，看命中链是否回到 a.src-link
        for (const it of items.slice(0, 5)) {
          const link = it.querySelector('a.src-link') || it.querySelector('a');
          const sum = it.querySelector('.src-sum');
          const rel2 = it.querySelector('.src-rel');
          if (!link) continue;
          const itemR = it.getBoundingClientRect();
          const targets = [];
          for (const [name, el] of [['sum', sum], ['rel', rel2]]) {
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) { targets.push({ name, skipped: 'zero-size' }); continue; }
            const x = Math.round(r.left + Math.min(24, r.width / 2));
            const y = Math.round(r.top + r.height / 2);
            const hit = document.elementFromPoint(x, y);
            const a = hit && hit.closest ? hit.closest('a') : null;
            targets.push({
              name, x, y,
              hitTag: hit ? hit.tagName : null, hitClass: hit ? String(hit.className).slice(0, 40) : null,
              resolvesToLink: !!(a && a === link),
              href: a ? a.getAttribute('href') : null,
              expectedHref: link.getAttribute('href'),
            });
          }
          const cs = getComputedStyle(link, '::after');
          probe.push({
            itemW: Math.round(itemR.width), itemH: Math.round(itemR.height),
            itemPos: getComputedStyle(it).position,
            linkPos: getComputedStyle(link).position,
            afterInset: [cs.top, cs.right, cs.bottom, cs.left].join(' '),
            afterW: cs.width, afterH: cs.height,
            targets,
          });
        }
        return { count: items.length, probes: probe };
      });
    })();

    /* E [data-overflowing] 契约 */
    rec.checks.overflowing = await page.evaluate(() => {
      const hosts = Array.from(document.querySelectorAll('.code-scroll'));
      const wraps = Array.from(document.querySelectorAll('.table-wrap'));
      const real = (el) => {
        const pre = el.querySelector('pre');
        return pre ? (pre.scrollWidth > pre.clientWidth + 1 || el.scrollWidth > el.clientWidth + 1) : (el.scrollWidth > el.clientWidth + 1);
      };
      const marked = hosts.concat(wraps).filter((e) => e.hasAttribute('data-overflowing'));
      const really = hosts.concat(wraps).filter(real);
      const falsePos = marked.filter((e) => !real(e)).length;
      const falseNeg = really.filter((e) => !e.hasAttribute('data-overflowing')).length;
      const title = document.querySelector('.code-block:has(.code-scroll[data-overflowing]) .code-title');
      return {
        hosts: hosts.length, wraps: wraps.length, marked: marked.length, really: really.length,
        falsePos, falseNeg,
        titleAfter: title ? getComputedStyle(title, '::after').content : null,
        afterShadeW: marked.length ? getComputedStyle(marked[0], '::after').width : null,
        tabindexOk: hosts.concat(wraps).every((e) => e.getAttribute('tabindex') === '0'),
        roleOk: hosts.concat(wraps).every((e) => e.getAttribute('role') === 'region'),
        ariaLabels: hosts.concat(wraps).filter((e) => (e.getAttribute('aria-label') || '').length > 3).length,
      };
    });

    rec.errors = errs.slice(0, 5);
    console.log('  drawer ' + JSON.stringify(rec.checks.drawer.ok) + '  scrollRestored=' + rec.checks.drawer.closed.y + '/' + rec.checks.drawer.before.y);
    console.log('  toc    ' + JSON.stringify(rec.checks.toc.ok) + '  narrow=' + JSON.stringify(rec.checks.toc.narrow) + ' click=' + JSON.stringify(rec.checks.toc.clickResult) + ' wide=' + JSON.stringify(rec.checks.toc.wide) + ' back=' + JSON.stringify(rec.checks.toc.back));
    console.log('  srcItem count=' + rec.checks.srcItem.count + ' probes=' + JSON.stringify((rec.checks.srcItem.probes || []).map((p) => ({ h: p.itemH, after: p.afterInset, t: (p.targets || []).map((t) => t.name + ':' + t.resolvesToLink) }))));
    console.log('  overflow ' + JSON.stringify(rec.checks.overflowing));
    if (errs.length) console.log('  ERRORS ' + JSON.stringify(errs));
    out.pages.push(rec);
    await ctx.close();
  }

  await browser.close();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  console.log('\nWROTE ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
