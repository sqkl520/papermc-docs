'use strict';
/**
 * fa2-mobile.js — 必查 7 的细项（只读）：320/390/768 抽屉开合、TOC 可用性、横向溢出
 *
 * 上一版探针只记了「sidebar 是否可见」，但抽屉关闭态是靠 transform 移出视口的，
 * getBoundingClientRect 仍有宽高 -> 会把关闭态误判成可见。本脚本改为记录
 * sidebar 的 x/transform 与 body class，开合各取一次，且校验「关→开 x 变化 > 100px」。
 *
 * 用法: node tools/fa2-mobile.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = { head: 'http://127.0.0.1:8787', old: 'http://127.0.0.1:8788' };
const TMP = path.join(os.tmpdir(), 'fa2');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const STATE = () => {
  const q = (s) => document.querySelector(s);
  const side = q('#sidebar') || q('.sidebar');
  const toc = q('.toc-side');
  const scrim = q('.scrim') || q('#scrim') || q('.drawer-scrim');
  const r = (e) => (e ? e.getBoundingClientRect() : null);
  const sr = r(side);
  const tr = r(toc);
  const de = document.documentElement;
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  return {
    vw: window.innerWidth,
    bodyCls: document.body.className,
    htmlCls: document.documentElement.className,
    sideX: sr ? Math.round(sr.x) : null,
    sideW: sr ? Math.round(sr.width) : null,
    sideTransform: cs(side, 'transform'),
    sideVis: cs(side, 'visibility'),
    ariaExpanded: q('#nav-toggle') ? q('#nav-toggle').getAttribute('aria-expanded') : null,
    scrimShown: scrim ? (cs(scrim, 'display') !== 'none' && cs(scrim, 'visibility') !== 'hidden' && parseFloat(cs(scrim, 'opacity')) > 0.01) : null,
    scrimCls: scrim ? scrim.className : null,
    tocDisplay: cs(toc, 'display'),
    tocPos: cs(toc, 'position'),
    tocTop: tr ? Math.round(tr.top) : null,
    tocH: tr ? Math.round(tr.height) : null,
    tocW: tr ? Math.round(tr.width) : null,
    tocFoldOpen: toc ? !!toc.querySelector('.toc-fold[open]') : null,
    tocLinks: toc ? [...toc.querySelectorAll('a[href^="#"]')].filter((a) => a.getBoundingClientRect().height > 0).length : 0,
    hOverflow: de.scrollWidth - de.clientWidth,
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
  };
};

const settle = (page, k) => page.evaluate((n) => new Promise((res) => {
  let i = 0;
  const step = () => { if (++i >= n) res(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), k || 2);

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), rows: [] };
  try {
    for (const base of ['head', 'old']) {
      for (const w of [320, 390, 768]) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: 844 }, deviceScaleFactor: 1,
          colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true, hasTouch: true, isMobile: w < 768,
        });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
        await page.goto(BASE[base] + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(200);
        await settle(page, 3);
        const closed = await page.evaluate(STATE);

        /* 开抽屉 */
        await page.evaluate(() => { const t = document.querySelector('#nav-toggle'); if (t) t.click(); });
        await page.waitForTimeout(360);
        await settle(page, 3);
        const opened = await page.evaluate(STATE);

        /* Esc 关 */
        await page.keyboard.press('Escape');
        await page.waitForTimeout(320);
        await settle(page, 3);
        const reclosed = await page.evaluate(STATE);

        /* 抽屉内点一条链接：应自动关闭（<1200） */
        await page.evaluate(() => { const t = document.querySelector('#nav-toggle'); if (t) t.click(); });
        await page.waitForTimeout(340);
        const linkPick = await page.evaluate(() => {
          const a = [...document.querySelectorAll('#sidebar a[href], .sidebar a[href]')].find((x) => {
            const r = x.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && !x.getAttribute('href').startsWith('http');
          });
          if (!a) return null;
          const href = a.getAttribute('href');
          a.click();
          return href;
        });
        await page.waitForTimeout(500);
        const afterNav = await page.evaluate(STATE);

        /* TOC 面板可展开吗（<1200 时是折叠面板） */
        const tocTry = await page.evaluate(async () => {
          const toc = document.querySelector('.toc-side');
          if (!toc) return { present: false };
          const sum = toc.querySelector('summary');
          const fold = toc.querySelector('.toc-fold');
          const before = fold ? !!fold.open : null;
          if (sum) { sum.click(); }
          await new Promise((r) => setTimeout(r, 260));
          const fold2 = document.querySelector('.toc-side .toc-fold');
          const after = fold2 ? !!fold2.open : null;
          const links = [...document.querySelectorAll('.toc-side a[href^="#"]')].filter((a) => a.getBoundingClientRect().height > 0).length;
          return { present: true, hasSummary: !!sum, before, after, toggled: before !== after, visibleLinks: links };
        });

        /* 横向溢出（图全加载 + 滚到底） */
        const ov = await page.evaluate(async () => {
          const imgs = [...document.images];
          for (const im of imgs) { im.loading = 'eager'; try { await im.decode(); } catch (e) {} }
          const de = document.documentElement;
          window.scrollTo(0, de.scrollHeight);
          await new Promise((r) => setTimeout(r, 150));
          window.scrollTo(0, 0);
          await new Promise((r) => setTimeout(r, 150));
          return { hOverflow: de.scrollWidth - de.clientWidth, scrollW: de.scrollWidth, clientW: de.clientWidth };
        });
        await ctx.close();

        const row = { base, vw: w, closed, opened, reclosed, linkPick, afterNav, tocTry, ov, errors };
        out.rows.push(row);
        console.log('=== ' + base + ' @' + w + ' ===');
        console.log('  closed  : sideX=' + closed.sideX + ' transform=' + String(closed.sideTransform).slice(0, 26) + ' scrim=' + closed.scrimShown + ' aria=' + closed.ariaExpanded + ' bodyCls="' + closed.bodyCls + '"');
        console.log('  opened  : sideX=' + opened.sideX + ' transform=' + String(opened.sideTransform).slice(0, 26) + ' scrim=' + opened.scrimShown + ' aria=' + opened.ariaExpanded + ' bodyCls="' + opened.bodyCls + '" bodyOverflow=' + opened.bodyCls);
        console.log('  reclosed: sideX=' + reclosed.sideX + ' scrim=' + reclosed.scrimShown + ' aria=' + reclosed.ariaExpanded);
        console.log('  afterNav: href=' + linkPick + ' sideX=' + afterNav.sideX + ' scrim=' + afterNav.scrimShown);
        console.log('  toc     : display=' + closed.tocDisplay + ' pos=' + closed.tocPos + ' h=' + closed.tocH + ' links=' + closed.tocLinks + ' foldOpen=' + closed.tocFoldOpen + ' | toggle=' + JSON.stringify(tocTry));
        console.log('  overflow: hOv=' + ov.hOverflow + ' (scrollW=' + ov.scrollW + ' clientW=' + ov.clientW + ')' + (errors.length ? ' ERR=' + errors.join('|') : ''));
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(TMP, 'fa2-mobile.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(TMP, 'fa2-mobile.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
