'use strict';
/**
 * b1r-recheck.js — 对【当前构建】逐条复核：
 *   A. syncToc 是否仍无条件覆盖用户折叠（原实现）/ 现在是否已加 lastIsWide 守卫
 *   B. 展开 TOC 吸顶面板覆盖正文（CSS 未变，应仍复现）
 *   C. 锚点偏移 --toc-offset 是否真的生效
 *   D. :has() 降级后文字提示消失
 *   E. P0-3 命中区 / P0-4 整行命中与文本可选
 * 用法: node tools/b1r-recheck.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'reports', 'b1r-shots');
const LOGP = path.join(ROOT, 'reports', '.b1r-recheck.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';

function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }
const sha = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16); } catch (e) { return null; } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const build = {
    css: { size: fs.statSync(path.join(ROOT, 'assets/site.css')).size, mtime: fs.statSync(path.join(ROOT, 'assets/site.css')).mtime.toISOString(), sha: sha(path.join(ROOT, 'assets/site.css')) },
    js: { size: fs.statSync(path.join(ROOT, 'assets/site.js')).size, mtime: fs.statSync(path.join(ROOT, 'assets/site.js')).mtime.toISOString(), sha: sha(path.join(ROOT, 'assets/site.js')) },
    srcAssets: { size: fs.statSync(path.join(ROOT, 'tools/site/assets.js')).size, mtime: fs.statSync(path.join(ROOT, 'tools/site/assets.js')).mtime.toISOString(), sha: sha(path.join(ROOT, 'tools/site/assets.js')) },
    srcLayout: { size: fs.statSync(path.join(ROOT, 'tools/site/layout.js')).size, sha: sha(path.join(ROOT, 'tools/site/layout.js')) },
  };
  log('BUILD ' + JSON.stringify(build));

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { build };

  // ---------- A. 用户折叠 vs syncToc ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const st = () => page.evaluate(() => {
      const d = document.querySelector('.toc-side details');
      const t = document.querySelector('.toc-side');
      return { open: d.open, tocH: Math.round(t.getBoundingClientRect().height), vw: window.innerWidth };
    });
    out.tocSync = { initial: await st() };
    await page.click('.toc-side .toc-title');           // 用户点击折叠
    await page.waitForTimeout(250);
    out.tocSync.afterUserCollapse = await st();
    await page.setViewportSize({ width: 1441, height: 900 });  // 同档 resize（不是跨断点）
    await page.waitForTimeout(300);
    out.tocSync.afterSameTierResize = await st();
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.waitForTimeout(300);
    out.tocSync.afterSameTierResize2 = await st();
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(350);
    out.tocSync.afterCrossDown = await st();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(350);
    out.tocSync.afterCrossUp = await st();
    log('TOCSYNC ' + JSON.stringify(out.tocSync));
    await ctx.close();
  }

  // ---------- B. 展开 TOC 覆盖正文（当前 CSS） ----------
  {
    out.overlay = [];
    for (const vp of [{ n: '768x1024', w: 768, h: 1024 }, { n: '390x844', w: 390, h: 844 }, { n: '812x375', w: 812, h: 375 }]) {
      for (const mode of ['as-is', 'stickyOff']) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
        await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
        if (mode === 'stickyOff') await page.addStyleTag({ content: '.toc-side{position:static !important;z-index:auto !important}' });
        await page.waitForTimeout(250);
        await page.evaluate(() => { document.querySelector('.toc-side details').open = true; });
        await page.waitForTimeout(250);
        await page.evaluate(() => window.scrollTo(0, 1200));
        await page.waitForTimeout(200);
        const r = await page.evaluate(() => {
          const t = document.querySelector('.toc-side');
          const tb = t.getBoundingClientRect();
          const blocks = Array.from(document.querySelectorAll('.article p, .article h2, .article h3, .article li, .article pre'));
          let cov = 0;
          for (const el of blocks) {
            const b = el.getBoundingClientRect();
            if (b.width <= 0 || b.height <= 0) continue;
            if (b.bottom > tb.top && b.top < tb.bottom && b.left < tb.right && b.right > tb.left) cov++;
          }
          return {
            pos: getComputedStyle(t).position, tocTop: Math.round(tb.top), tocBottom: Math.round(tb.bottom),
            tocH: Math.round(tb.height), pctVh: +(100 * tb.height / window.innerHeight).toFixed(1),
            contentVisiblePx: Math.round(window.innerHeight - tb.bottom),
            contentVisiblePct: +(100 * Math.max(0, window.innerHeight - tb.bottom) / window.innerHeight).toFixed(1),
            coveredBlocks: cov,
          };
        });
        r.vp = vp.n; r.mode = mode;
        out.overlay.push(r);
        log('OVERLAY ' + JSON.stringify(r));
        if (mode === 'as-is') await page.screenshot({ path: path.join(SHOTS, 'overlay-' + vp.n + '.png') });
        await ctx.close();
      }
    }
  }

  // ---------- C. 锚点偏移 ----------
  {
    out.anchor = [];
    for (const vp of [{ n: '768x1024', w: 768, h: 1024 }, { n: '390x844', w: 390, h: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.waitForTimeout(300);
      const id = await page.evaluate(() => {
        const a = document.querySelectorAll('.toc-side ol li a');
        return a.length > 4 ? a[4].getAttribute('href').slice(1) : null;
      });
      await page.evaluate((h) => { location.hash = '#' + h; }, id);
      await page.waitForTimeout(600);
      const r = await page.evaluate((h) => {
        const el = document.getElementById(h);
        const b = el.getBoundingClientRect();
        const t = document.querySelector('.toc-side').getBoundingClientRect();
        const cx = Math.min(b.left + 20, b.right - 1);
        const cy = b.top + Math.min(6, b.height / 2);
        const hit = (cy > 0 && cy < window.innerHeight) ? document.elementFromPoint(cx, cy) : null;
        return {
          id: h, headingTop: Math.round(b.top), tocBottom: Math.round(t.bottom), tocH: Math.round(t.height),
          scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
          tocOffsetVar: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
          headingCovered: b.top < t.bottom && b.bottom > t.top,
          hitAtHeading: hit ? hit.tagName + '.' + String(hit.className || '') : null,
          hitIsToc: !!(hit && hit.closest && hit.closest('.toc-side')),
        };
      }, id);
      r.vp = vp.n;
      out.anchor.push(r);
      log('ANCHOR ' + JSON.stringify(r));
      await ctx.close();
    }
  }

  // ---------- D. :has() 降级 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const base = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.code-block .code-title'));
      const hint = t.filter((x) => { const c = getComputedStyle(x, '::after'); return c.content && c.content !== 'none' && c.content !== 'normal'; }).length;
      return { titles: t.length, withHint: hint, hasSupport: CSS.supports('selector(:has(a))') };
    });
    await page.addStyleTag({ content: '.code-block .code-title::after{content:none !important}' });
    await page.waitForTimeout(200);
    const dropped = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('.code-block .code-title'));
      return { withHint: t.filter((x) => { const c = getComputedStyle(x, '::after'); return c.content && c.content !== 'none' && c.content !== 'normal'; }).length };
    });
    out.hasFallback = { base, hintAfterSimulatedNoHas: dropped.withHint, fadeStillWorks: await page.evaluate(() => { const s = document.querySelector('.code-scroll[data-overflowing]'); if (!s) return null; const c = getComputedStyle(s, '::after'); return { bg: c.backgroundImage.slice(0, 40), pe: c.pointerEvents }; }) };
    log('HASFALLBACK ' + JSON.stringify(out.hasFallback));
    await ctx.close();
  }

  // ---------- E. P0-3 / P0-4 ----------
  {
    out.hit = [];
    for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1025x800', w: 1025, h: 800 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
        await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load' });
        await page.waitForTimeout(300);
        const r = await page.evaluate(() => {
          const mn = (els) => els.length ? els.reduce((m, e) => { const b = e.getBoundingClientRect(); return { w: Math.min(m.w, +b.width.toFixed(1)), h: Math.min(m.h, +b.height.toFixed(1)) }; }, { w: 1e9, h: 1e9 }) : null;
          const homes = Array.from(document.querySelectorAll('a.side-home'));
          const copies = Array.from(document.querySelectorAll('.code-copy'));
          let gap = null;
          for (let i = 1; i < homes.length; i++) { const g = Math.abs(homes[i].getBoundingClientRect().top - homes[i - 1].getBoundingClientRect().bottom); if (gap === null || g < gap) gap = +g.toFixed(1); }
          return { homeCount: homes.length, homeMin: mn(homes), copyCount: copies.length, copyMin: mn(copies), homeVerticalGapPx: gap };
        });
        r.vp = vp.n; r.tag = tag;
        out.hit.push(r);
        log('HIT ' + JSON.stringify(r));
      }
      await ctx.close();
    }
    // P0-4 整行命中 + 摘要可选性
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/index.html', { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.waitForTimeout(600);
    out.stretch = await page.evaluate(() => {
      const item = document.querySelectorAll('.src-item')[0];
      item.scrollIntoView({ block: 'center' });
      const ib = item.getBoundingClientRect();
      const midY = Math.round(ib.top + ib.height / 2);
      let link = 0; const marks = [];
      for (let i = 0; i <= 40; i++) {
        const x = Math.min(Math.round(ib.left + (ib.width * i) / 40), ib.right - 2);
        const el = document.elementFromPoint(x, midY);
        const a = el && el.closest ? el.closest('a') : null;
        if (a) link++; else marks.push(Math.round((100 * i) / 40) + '%:' + (el ? el.className || el.tagName : 'null'));
      }
      const sum = item.querySelector('.src-sum');
      let dragText = null;
      if (sum) {
        const b = sum.getBoundingClientRect();
        const rng = document.createRange(); rng.selectNodeContents(sum);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
        dragText = (sel.toString() || '').length; sel.removeAllRanges();
      }
      const parts = ['src-link', 'src-sum', 'src-rel'].map((k) => {
        const e = item.querySelector('.' + k);
        if (!e) return { k, present: false };
        const b = e.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(b.left + Math.min(15, b.width / 2)), Math.round(b.top + b.height / 2));
        const a = el && el.closest ? el.closest('a') : null;
        return { k, w: Math.round(b.width), hitCls: el ? String(el.className || el.tagName) : null, isLink: !!a, pe: getComputedStyle(e).pointerEvents, userSelect: getComputedStyle(e).userSelect };
      });
      return { itemBox: { w: Math.round(ib.width), h: Math.round(ib.height) }, linkCoveragePct: Math.round((100 * link) / 41), deadMarks: marks, parts, summaryRangeSelectableChars: dragText };
    });
    log('STRETCH ' + JSON.stringify(out.stretch));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-recheck.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE');
})();
