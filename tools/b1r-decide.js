'use strict';
/**
 * b1r-decide.js — 判定性实验：
 *   1. 展开 TOC 后点目录项：目标标题是否被 80.8% 高的吸顶面板盖住（auto 滚动，排除假象）
 *   2. .src-item 整行命中覆盖率扫描（P0-4 声称"死区归零"）
 *   3. 8788 基线：开抽屉是否也丢滚动位置（判定 P0-2 是"修好了"还是"只修了一半"）
 *   4. 打印媒体下 hljs token 颜色
 * 用法: node tools/b1r-decide.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'reports', 'b1r-shots');
const LOGP = path.join(ROOT, 'reports', '.b1r-decide.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';

function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { tocClick: [], coverage: {}, drawer: [], print: {} };

  // ============ 1. 展开 TOC → 点目录项 → 目标是否被面板盖住 ============
  for (const vp of [{ n: '768x1024', w: 768, h: 1024 }, { n: '390x844', w: 390, h: 844 }, { n: '812x375', w: 812, h: 375 }]) {
    for (const state of ['collapsed', 'expanded']) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.waitForTimeout(250);
      if (state === 'expanded') {
        await page.evaluate(() => { document.querySelector('.toc-side details').open = true; });
        await page.waitForTimeout(200);
      }
      const id = await page.evaluate(() => {
        const a = document.querySelectorAll('.toc-side ol li a');
        return a.length > 2 ? a[2].getAttribute('href').slice(1) : null;
      });
      if (state === 'expanded') {
        // 真实点击（目录项可见）：走浏览器锚点滚动 + scroll-padding-top
        await page.locator('.toc-side ol li a').nth(2).click();
      } else {
        // 折叠态（面板高 61px，目录项不可见）：只能用 hash 跳转
        await page.evaluate((h) => { location.hash = '#' + h; }, id);
      }
      await page.waitForTimeout(650);
      const r = await page.evaluate((hid) => {
        const el = document.getElementById(hid);
        const b = el.getBoundingClientRect();
        const t = document.querySelector('.toc-side').getBoundingClientRect();
        const hit = document.elementFromPoint(Math.min(b.left + 24, b.right - 1), b.top + Math.min(10, b.height / 2));
        return {
          id: hid,
          headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom),
          tocTop: Math.round(t.top), tocBottom: Math.round(t.bottom), tocH: Math.round(t.height),
          pctVhOccupiedByToc: +(100 * t.height / window.innerHeight).toFixed(1),
          tocAutoCollapsedAfterClick: !document.querySelector('.toc-side details').open,
          headingCoveredByToc: b.top < t.bottom && b.bottom > t.top,
          headingVisiblePx: Math.max(0, Math.min(b.bottom, t.top, window.innerHeight) - Math.max(b.top, t.top === 56 ? 56 : t.bottom)),
          hitElementAtHeadingTop: hit ? hit.tagName + '.' + String(hit.className || '') : null,
          hitIsToc: !!(hit && hit.closest && hit.closest('.toc-side')),
        };
      }, id);
      r.vp = vp.n; r.state = state;
      out.tocClick.push(r);
      log('TOC_CLICK ' + JSON.stringify(r));
      if (state === 'expanded') await page.screenshot({ path: path.join(SHOTS, 'tocclick-expanded-' + vp.n + '.png') });
      await ctx.close();
    }
  }

  // ============ 2. .src-item 整行命中覆盖扫描 ============
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/index.html', { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.waitForTimeout(500);
    out.coverage = await page.evaluate(() => {
      const item = document.querySelectorAll('.src-item')[0];
      item.scrollIntoView({ block: 'center' });
      const ib = item.getBoundingClientRect();
      const midY = Math.round(ib.top + ib.height / 2);
      const N = 40;
      const cells = [];
      for (let i = 0; i <= N; i++) {
        const x = Math.round(ib.left + (ib.width * i) / N);
        const el = document.elementFromPoint(Math.min(x, ib.right - 2), midY);
        const a = el && el.closest ? el.closest('a') : null;
        cells.push({ x, pct: Math.round((100 * i) / N), tag: el ? el.tagName : null, cls: el ? String(el.className || '') : null, link: !!a });
      }
      const linkCells = cells.filter((c) => c.link).length;
      // 逐个子元素的可点性
      const parts = ['src-link', 'src-sum', 'src-rel'].map((k) => {
        const e = item.querySelector('.' + k);
        if (!e) return { k, present: false };
        const b = e.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(b.left + Math.min(15, b.width / 2)), Math.round(b.top + b.height / 2));
        const a = el && el.closest ? el.closest('a') : null;
        return { k, present: true, w: Math.round(b.width), hit: el ? el.tagName + '.' + String(el.className || '') : null, link: !!a, pe: getComputedStyle(e).pointerEvents };
      });
      return {
        itemBox: { w: Math.round(ib.width), h: Math.round(ib.height) },
        linkCoveragePct: Math.round((100 * linkCells) / cells.length),
        deadPct: 100 - Math.round((100 * linkCells) / cells.length),
        cells, parts,
      };
    });
    log('COVERAGE ' + JSON.stringify({ itemBox: out.coverage.itemBox, linkCoveragePct: out.coverage.linkCoveragePct, deadPct: out.coverage.deadPct, parts: out.coverage.parts }));
    log('COVERAGE_CELLS ' + JSON.stringify(out.coverage.cells.map((c) => c.pct + ':' + (c.link ? 'L' : c.cls || c.tag)).join(' ')));
    await ctx.close();
  }

  // ============ 3. 8788 基线：开抽屉掉多少滚动位置 ============
  {
    for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
      for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '320x568', w: 320, h: 568 }]) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await page.goto(base + '/paper/adding-plugins/', { waitUntil: 'load' });
        await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
        await page.waitForTimeout(400);
        await page.evaluate(() => window.scrollTo(0, 6000));
        await page.waitForTimeout(400);
        const y0 = await page.evaluate(() => Math.round(window.scrollY));
        await page.click('#nav-toggle');
        await page.waitForTimeout(450);
        const yOpen = await page.evaluate(() => Math.round(window.scrollY));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(450);
        const yClose = await page.evaluate(() => Math.round(window.scrollY));
        const rec = { tag, vp: vp.n, y0, yOpen, yClose, lossOnOpen: yOpen - y0, netLossPerCycle: yClose - y0 };
        out.drawer.push(rec);
        log('DRAWER ' + JSON.stringify(rec));
        await ctx.close();
      }
    }
  }

  // ============ 4. 打印媒体下的 hljs token 颜色 ============
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const read = async () => page.evaluate(() => {
      const pick = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).color : null; };
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
        keyword: pick('.hljs-keyword'), string: pick('.hljs-string'), title: pick('.hljs-title'),
        before: pick('.code-pre'),
      };
    });
    out.print.screen = await read();
    log('PRINT screen ' + JSON.stringify(out.print.screen));
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);
    out.print.print = await read();
    log('PRINT print ' + JSON.stringify(out.print.print));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-decide.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE');
})();
