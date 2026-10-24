'use strict';
/**
 * b1r-attrib.js — 归因探针：pageHeight 变化来源（P1-5 字重 / scrollbar-gutter / sticky 额外高度）、
 *                 768 档吸顶 TOC 是否覆盖正文、锚点跳转后标题是否被吸顶 TOC 遮挡
 * 用法: node tools/b1r-attrib.js   （结果写 reports/.b1r-attrib.json，过程写 reports/.b1r-attrib.log）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const PAGES = [
  '/paper/reference/world-configuration/',
  '/paper/dev/dialogs/',
  '/paper/dev/particles/',
  '/paper/reference/system-properties/',
];

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { determinism: [], overlay768: [], anchor: [], scrollbarGutter: [] };

  // ---------- 1) pageHeight 归因 ----------
  for (const vp of [{ w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 1025, h: 800 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of PAGES) {
      const rec = { vp: vp.w + 'x' + vp.h, page: u };
      const h = () => page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      await page.goto(NEW + u, { waitUntil: 'load' }); await page.waitForTimeout(350);
      rec.new1 = await h();
      rec.new2 = await h();
      await page.addStyleTag({ content: '.alert-title,.tg-home{font-weight:650 !important}' });
      await page.waitForTimeout(150);
      rec.new_with650 = await h();
      await page.goto(OLD + u, { waitUntil: 'load' }); await page.waitForTimeout(350);
      rec.old1 = await h();
      await page.addStyleTag({ content: '.alert-title,.tg-home{font-weight:650 !important}' });
      await page.waitForTimeout(150);
      rec.old_with650 = await h();
      rec.delta = rec.new1 - rec.old1;
      rec.delta_if_650_only = rec.new_with650 - rec.old_with650;
      // 布局列宽差（1025 档改了 grid 280->290 / 250）
      rec.cols = await page.evaluate(() => getComputedStyle(document.querySelector('.layout')).gridTemplateColumns);
      out.determinism.push(rec);
      log('ATTRIB ' + JSON.stringify(rec));
      await page.goto(NEW + u, { waitUntil: 'load' }); await page.waitForTimeout(200);
      out.determinism[out.determinism.length - 1].newCols = await page.evaluate(() => getComputedStyle(document.querySelector('.layout')).gridTemplateColumns);
    }
    await ctx.close();
  }

  // ---------- 2) scrollbar-gutter / 滚动条宽度对高度的影响 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    out.scrollbarGutter = await page.evaluate(() => ({
      innerW: window.innerWidth, clientW: document.documentElement.clientWidth,
      scrollbarPx: window.innerWidth - document.documentElement.clientWidth,
      htmlScrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter,
      tocClientW: document.querySelector('.toc-side').clientWidth,
      tocOffsetW: document.querySelector('.toc-side').offsetWidth,
    }));
    log('GUTTER ' + JSON.stringify(out.scrollbarGutter));
    await ctx.close();
  }

  // ---------- 3) 768 档：展开的吸顶 TOC 覆盖正文 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.querySelector('.toc-side details').open = true; });
    await page.waitForTimeout(250);
    for (const y of [0, 300, 900, 3000, 9000]) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(140);
      const rec = await page.evaluate(() => {
        const t = document.querySelector('.toc-side');
        const tb = t.getBoundingClientRect();
        const blocks = Array.from(document.querySelectorAll('.article p, .article h2, .article h3, .article li'));
        let covered = 0; const sample = [];
        for (const el of blocks) {
          const b = el.getBoundingClientRect();
          if (b.bottom > tb.top && b.top < tb.bottom && b.width > 0) {
            covered++;
            if (sample.length < 3) sample.push({ tag: el.tagName, top: Math.round(b.top), text: (el.textContent || '').trim().slice(0, 28) });
          }
        }
        return {
          scrollY: Math.round(window.scrollY),
          tocTop: Math.round(tb.top), tocBottom: Math.round(tb.bottom), tocH: Math.round(tb.height),
          tocPctOfViewport: +(100 * tb.height / window.innerHeight).toFixed(1),
          coveredBlocks: covered, sample,
          tocOwnScroll: t.scrollHeight > t.clientHeight + 1,
          tocBg: getComputedStyle(t).backgroundColor,
          tocPos: getComputedStyle(t).position, z: getComputedStyle(t).zIndex,
        };
      });
      out.overlay768.push(rec);
      log('OVERLAY768 ' + JSON.stringify(rec));
    }
    await ctx.close();
  }

  // ---------- 4) 锚点跳转：标题是否被吸顶 TOC 盖住 ----------
  for (const vp of [{ n: '768x1024', w: 768, h: 1024 }, { n: '390x844', w: 390, h: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.waitForTimeout(200);
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('.article h2[id], .article h3[id]')).slice(1, 4).map((e) => e.id));
    for (const id of ids) {
      await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.waitForTimeout(150);
      await page.evaluate((hh) => { location.hash = '#' + hh; }, id);
      await page.waitForTimeout(450);
      const rec = await page.evaluate((hh) => {
        const el = document.getElementById(hh);
        const b = el.getBoundingClientRect();
        const t = document.querySelector('.toc-side').getBoundingClientRect();
        return {
          id: hh,
          headingTopInViewport: Math.round(b.top),
          tocBottomPinned: Math.round(t.bottom),
          hiddenBehindToc: b.top < t.bottom,
          scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
          topbarH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
        };
      }, id);
      rec.vp = vp.n;
      out.anchor.push(rec);
      log('ANCHOR ' + JSON.stringify(rec));
    }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-attrib.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-attrib.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE');
})();
