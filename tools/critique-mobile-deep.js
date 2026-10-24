'use strict';
/**
 * critique-mobile-deep.js —— 移动端锐评第二批深测（只读；不改站点）
 * 逐项验证：
 *   A 抽屉开合对文档滚动位置的影响 + 抽屉内是否有关闭按钮 + 遮罩残余可点宽度
 *   B 流内「本页目录」滚动后是否还在视口内（scroll-spy 在移动端是否可感知）
 *   C 目录锚点跳转落点（scroll-padding 是否让它停在顶栏下方）
 *   D 图片无 width/height + lazy 造成的累计布局位移（CLS，单位 px）
 *   E 落地页目录树条目高度 / 第一条真实页面链接的 Y
 *   F 代码块内 <code> 的真实字号
 *   G 落地页大搜索框 placeholder 是否被硬裁
 *   H all-pages 过滤：计数与行的更新时序（FLUSH_MS）
 * 用法: node tools/critique-mobile-deep.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const ROUND = (n) => Math.round(n * 10) / 10;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '320x568', w: 320, h: 568 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const o = {};

    /* ---------- A/B/C：长页面上的抽屉与目录 ---------- */
    await page.goto(BASE + '/paper/reference/world-configuration/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 12000));
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({ y: Math.round(window.scrollY), h: Math.round(document.documentElement.scrollHeight) }));
    await page.click('#nav-toggle');
    await page.waitForTimeout(400);
    const opened = await page.evaluate(() => {
      const side = document.querySelector('#sidebar');
      const scrim = document.querySelector('#nav-scrim');
      const r = side.getBoundingClientRect();
      return {
        y: Math.round(window.scrollY), h: Math.round(document.documentElement.scrollHeight),
        bodyOverflow: getComputedStyle(document.body).overflow,
        drawerW: Math.round(r.width),
        scrimLeftoverW: Math.round(window.innerWidth - r.width),
        closeBtns: document.querySelectorAll('#sidebar button').length,
        closeBtnLabels: Array.from(document.querySelectorAll('#sidebar button')).map((b) => (b.getAttribute('aria-label') || b.textContent || '').slice(0, 14)),
        scrollHeight: side.scrollHeight,
      };
    });
    await page.click('#nav-toggle');
    await page.waitForTimeout(400);
    const closed = await page.evaluate(() => ({ y: Math.round(window.scrollY), h: Math.round(document.documentElement.scrollHeight) }));
    o.drawerScroll = { before, opened, closed, deltaOpen: ROUND(opened.y - before.y), deltaClose: ROUND(closed.y - opened.y) };

    /* B：流内目录在滚动中是否还在视口内 + active 项 */
    await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const tocAtTop = await page.evaluate(() => {
      const ROUND = (n) => Math.round(n * 10) / 10;
      const t = document.querySelector('.toc-side');
      const r = t.getBoundingClientRect();
      return { vTop: ROUND(r.top), vBottom: ROUND(r.bottom), inViewport: r.bottom > 0 && r.top < window.innerHeight };
    });
    await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.3)));
    await page.waitForTimeout(500);
    const tocMid = await page.evaluate(() => {
      const ROUND = (n) => Math.round(n * 10) / 10;
      const t = document.querySelector('.toc-side');
      const r = t.getBoundingClientRect();
      const act = document.querySelector('.toc-side a.active');
      return {
        vTop: ROUND(r.top), vBottom: ROUND(r.bottom), inViewport: r.bottom > 0 && r.top < window.innerHeight,
        activeCount: document.querySelectorAll('.toc-side a.active').length,
        activeText: act ? act.textContent : null,
        activeInViewport: act ? (act.getBoundingClientRect().top > 0 && act.getBoundingClientRect().bottom < window.innerHeight) : null,
      };
    });
    o.tocInFlow = { tocAtTop, tocMid };

    /* C：目录锚点跳转落点 */
    await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const jump = await page.evaluate(async () => {
      const ROUND = (n) => Math.round(n * 10) / 10;
      const links = document.querySelectorAll('.toc-side a[href^="#"]');
      const link = links[4];
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      link.click();
      await new Promise((r) => setTimeout(r, 900));
      const h = document.getElementById(id);
      const r = h.getBoundingClientRect();
      return { clicked: link.textContent, id, headingViewportTop: ROUND(r.top), scrollY: Math.round(window.scrollY), hiddenUnderTopbar: r.top < 56 };
    });
    o.tocJump = jump;

    /* D：图片 lazy + 无 width/height 的累计位移 */
    await page.goto(BASE + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const clsBefore = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('.content-img'));
      return {
        count: imgs.length,
        boxes: imgs.map((i) => Math.round(i.getBoundingClientRect().height)),
        total: Math.round(imgs.reduce((a, i) => a + i.getBoundingClientRect().height, 0)),
        docH: Math.round(document.documentElement.scrollHeight),
      };
    });
    await page.evaluate(() => { document.querySelectorAll('.content-img').forEach((i) => { i.loading = 'eager'; i.decoding = 'sync'; }); });
    await page.evaluate(async () => {
      const step = 700;
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(2500);
    const clsAfter = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('.content-img'));
      return {
        count: imgs.length,
        boxes: imgs.map((i) => Math.round(i.getBoundingClientRect().height)),
        total: Math.round(imgs.reduce((a, i) => a + i.getBoundingClientRect().height, 0)),
        docH: Math.round(document.documentElement.scrollHeight),
      };
    });
    o.imageShift = {
      before: clsBefore, after: clsAfter,
      cumulativeGainPx: clsAfter.total - clsBefore.total,
      docHeightGainPx: clsAfter.docH - clsBefore.docH,
    };

    /* E/F/G：落地页 */
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const land = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.src-item'));
      const links = Array.from(document.querySelectorAll('.src-link'));
      const stats = document.querySelector('.stats');
      const head = document.querySelector('.section-head');
      const hero = document.querySelector('#hero-search');
      const desc = document.querySelector('.hero p:not(.hero-tag)');
      const codeBlocks = Array.from(document.querySelectorAll('.code-block code')).map((c) => getComputedStyle(c).fontSize);
      const articleCode = Array.from(document.querySelectorAll('.article code')).map((c) => getComputedStyle(c).fontSize);
      const pre = document.querySelector('.code-pre code');
      return {
        srcItemCount: items.length,
        srcItemH: items.length ? Math.round(items[0].getBoundingClientRect().height) : null,
        srcLinkH: links.length ? Math.round(links[0].getBoundingClientRect().height) : null,
        firstSrcLinkY: links.length ? Math.round(links[0].getBoundingClientRect().top + window.scrollY) : null,
        statsY: stats ? Math.round(stats.getBoundingClientRect().top + window.scrollY) : null,
        firstSectionHeadY: head ? Math.round(head.getBoundingClientRect().top + window.scrollY) : null,
        heroClientW: hero ? hero.clientWidth : null,
        heroScrollW: hero ? hero.scrollWidth : null,
        heroPlaceholder: hero ? hero.placeholder : null,
        heroPlaceholderPx: hero ? (() => { const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(hero).fontSize + ' ' + getComputedStyle(hero).fontFamily; return Math.round(c.measureText(hero.placeholder).width); })() : null,
        heroPlaceholderOverflowPx: hero ? (() => { const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(hero).fontSize + ' ' + getComputedStyle(hero).fontFamily; return Math.round(c.measureText(hero.placeholder).width - (hero.clientWidth - 26)); })() : null,
        descText: desc ? desc.textContent.slice(0, 30) : null,
        topbarChildren: Array.from(document.querySelectorAll('.topbar > *')).map((e) => ({
          tag: e.tagName, cls: e.className, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height),
          text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16), display: getComputedStyle(e).display,
        })),
      };
    });
    o.landing = land;

    /* 代码块内 code 字号（内容页） */
    await page.goto(BASE + '/velocity/tuning/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    o.codeFont = await page.evaluate(() => {
      const code = document.querySelector('.code-block code');
      const pre = document.querySelector('.code-block pre');
      const inline = document.querySelector('.article p code, .article li code');
      return {
        codeInBlock: code ? getComputedStyle(code).fontSize : null,
        preInBlock: pre ? getComputedStyle(pre).fontSize : null,
        inlineCode: inline ? getComputedStyle(inline).fontSize : null,
        codeBlockW: pre ? Math.round(pre.closest('.code-block').getBoundingClientRect().width) : null,
      };
    });

    /* H：all-pages 过滤时序 */
    await page.goto(BASE + '/all-pages.html', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const filt = await page.evaluate(async () => {
      const inp = document.querySelector('#allpages-filter');
      const count = document.querySelector('#allpages-count');
      const rows = document.querySelectorAll('table.allpages tbody tr');
      const visible = () => Array.from(rows).filter((r) => !r.hidden && r.style.display !== 'none').length;
      inp.focus();
      inp.value = 'permissions';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const immediate = { count: count.textContent, visibleRows: visible(), t: performance.now() };
      await new Promise((r) => setTimeout(r, 120));
      const at120 = { count: count.textContent, visibleRows: visible() };
      await new Promise((r) => setTimeout(r, 350));
      const at470 = { count: count.textContent, visibleRows: visible() };
      return { immediate, at120, at470 };
    });
    o.allPagesFilter = filt;

    out[vp.n] = o;
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(require('os').tmpdir(), 'critique-mobile-deep.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 1));
})();
