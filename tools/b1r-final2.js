'use strict';
/**
 * b1r-final2.js — 基线恢复后的收尾测量：
 *   A. P0-3 命中区 new vs old（1440 / 1025 / 1024）
 *   B. P0-4 整行命中率 + 摘要/路径可选性 + 右键目标 new（基线 8788 是纯表格，无法对拍）
 *   C. 打印媒体下 hljs token 颜色（深色 auto 主题）
 *   D. 8788 基线：抽屉开关是否也丢位置（P0-2 是"已修"还是"未修"）
 *   E. 8787/8788 pageHeight 对照（当前构建）
 * 用法: node tools/b1r-final2.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const LOGP = path.join(ROOT, 'reports', '.b1r-final2.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const sha = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16); } catch (e) { return null; } };
function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }

(async () => {
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { build: { css: sha(path.join(ROOT, 'assets/site.css')), js: sha(path.join(ROOT, 'assets/site.js')), cssBytes: fs.statSync(path.join(ROOT, 'assets/site.css')).size }, hit: [], stretch: {}, print: {}, drawer: [], heights: [] };
  log('BUILD ' + JSON.stringify(out.build));

  // ---------- A. P0-3 ----------
  for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1025x800', w: 1025, h: 800 }, { n: '1024x800', w: 1024, h: 800 }, { n: '390x844', w: 390, h: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
      await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load' });
      await page.waitForTimeout(350);
      const r = await page.evaluate(() => {
        const mn = (els) => els.length ? els.reduce((m, e) => { const b = e.getBoundingClientRect(); return { w: Math.min(m.w, +b.width.toFixed(1)), h: Math.min(m.h, +b.height.toFixed(1)) }; }, { w: 1e9, h: 1e9 }) : null;
        const homes = Array.from(document.querySelectorAll('a.side-home'));
        const copies = Array.from(document.querySelectorAll('.code-copy'));
        let gap = null;
        for (let i = 1; i < homes.length; i++) { const g = Math.abs(homes[i].getBoundingClientRect().top - homes[i - 1].getBoundingClientRect().bottom); if (gap === null || g < gap) gap = +g.toFixed(1); }
        return { homeCount: homes.length, homeMin: mn(homes), copyCount: copies.length, copyMin: mn(copies), homeVerticalGapPx: gap };
      });
      r.vp = vp.n; r.tag = tag;
      out.hit.push(r); log('HIT ' + JSON.stringify(r));
    }
    await ctx.close();
  }

  // ---------- B. P0-4 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/index.html', { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.waitForTimeout(700);
    out.stretch = await page.evaluate(() => {
      const item = document.querySelectorAll('.src-item')[0];
      item.scrollIntoView({ block: 'center' });
      const ib = item.getBoundingClientRect();
      const midY = Math.round(ib.top + ib.height / 2);
      let link = 0; const dead = [];
      for (let i = 0; i <= 40; i++) {
        const x = Math.min(Math.round(ib.left + (ib.width * i) / 40), ib.right - 2);
        const el = document.elementFromPoint(x, midY);
        const a = el && el.closest ? el.closest('a') : null;
        if (a) link++; else dead.push(Math.round((100 * i) / 40) + '%:' + (el ? String(el.className || el.tagName) : 'null'));
      }
      const sum = item.querySelector('.src-sum');
      let rangeChars = null, dragChars = null;
      if (sum) {
        const rng = document.createRange(); rng.selectNodeContents(sum);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
        rangeChars = (sel.toString() || '').length; sel.removeAllRanges();
      }
      const parts = ['src-link', 'src-sum', 'src-rel'].map((k) => {
        const e = item.querySelector('.' + k);
        if (!e) return { k, present: false };
        const b = e.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(b.left + Math.min(15, b.width / 2)), Math.round(b.top + b.height / 2));
        const a = el && el.closest ? el.closest('a') : null;
        return { k, w: Math.round(b.width), hit: el ? String(el.className || el.tagName) : null, isLink: !!a, pe: getComputedStyle(e).pointerEvents, us: getComputedStyle(e).userSelect };
      });
      return { itemBox: { w: Math.round(ib.width), h: Math.round(ib.height) }, linkCoveragePct: Math.round((100 * link) / 41), deadMarks: dead, parts, summaryRangeSelectableChars: rangeChars };
    });
    // 真实鼠标拖选摘要
    const sumBox = await page.evaluate(() => { const s = document.querySelectorAll('.src-item')[0].querySelector('.src-sum'); const b = s.getBoundingClientRect(); return { x: Math.round(b.left + 6), y: Math.round(b.top + b.height / 2), w: Math.round(b.width) }; });
    await page.mouse.move(sumBox.x, sumBox.y);
    await page.mouse.down();
    await page.mouse.move(sumBox.x + Math.min(240, sumBox.w - 10), sumBox.y, { steps: 10 });
    await page.mouse.up();
    out.stretch.realDragSelectedChars = await page.evaluate(() => (window.getSelection() || { toString: () => '' }).toString().length);
    log('STRETCH ' + JSON.stringify(out.stretch));
    await ctx.close();
  }

  // ---------- C. 打印媒体 hljs 颜色 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const read = () => page.evaluate(() => {
      const p = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; };
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        bodyBg: getComputedStyle(document.body).backgroundColor, bodyColor: getComputedStyle(document.body).color,
        keyword: p('.hljs-keyword'), string: p('.hljs-string'), title: p('.hljs-title'), comment: p('.hljs-comment'),
        codeBg: p('.code-block') ? getComputedStyle(document.querySelector('.code-block')).backgroundColor : null,
        hlKeywordVar: getComputedStyle(document.documentElement).getPropertyValue('--hl-keyword').trim(),
      };
    });
    out.print.screenDark = await read();
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);
    out.print.printDark = await read();
    log('PRINT ' + JSON.stringify(out.print));
    await ctx.close();
  }

  // ---------- D. 抽屉位置丢失：8788 基线也有？ ----------
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
      await page.waitForTimeout(500);
      const yOpen = await page.evaluate(() => Math.round(window.scrollY));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const yClose = await page.evaluate(() => Math.round(window.scrollY));
      const rec = { tag, vp: vp.n, y0, yOpen, yClose, lossOnOpen: yOpen - y0, netLossPerCycle: yClose - y0 };
      out.drawer.push(rec); log('DRAWER ' + JSON.stringify(rec));
      await ctx.close();
    }
  }

  // ---------- E. pageHeight 对照 ----------
  {
    for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1025x800', w: 1025, h: 800 }, { n: '768x1024', w: 768, h: 1024 }, { n: '390x844', w: 390, h: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      for (const u of ['/paper/dev/particles/', '/paper/reference/world-configuration/', '/paper/dev/dialogs/', '/paper/reference/system-properties/']) {
        const row = { vp: vp.n, page: u };
        await page.goto(NEW + u, { waitUntil: 'load' }); await page.waitForTimeout(400);
        row.new = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
        await page.goto(OLD + u, { waitUntil: 'load' }); await page.waitForTimeout(400);
        row.old = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
        row.delta = row.new - row.old;
        out.heights.push(row); log('HEIGHT ' + JSON.stringify(row));
      }
      await ctx.close();
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-final2.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE');
})();
