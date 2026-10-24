'use strict';
/** critique-red-probe6.js — 代码块滚动容器 / 代码块样式归属元素 / content max-width / 上游 h2 结构 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = process.cwd();
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  const pages = ['/paper/dev/dialogs/', '/velocity/tuning/', '/paper/reference/world-configuration/', '/paper/dev/'];
  for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '390x844', w: 390, h: 844 }, { n: '320x568', w: 320, h: 568 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: 'light' });
    const page = await ctx.newPage();
    for (const p of pages) {
      await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(250);
      const d = await page.evaluate(() => {
        const qa = (s) => [...document.querySelectorAll(s)];
        const blocks = qa('.code-block').map((b) => {
          const sc = b.querySelector('.code-scroll');
          const pre = b.querySelector('pre');
          const cs = (el, k) => (el ? getComputedStyle(el)[k] : null);
          return {
            scW: sc ? sc.clientWidth : null, scSW: sc ? sc.scrollWidth : null,
            scOverflowX: cs(sc, 'overflowX'), scScrollable: sc ? sc.scrollWidth > sc.clientWidth + 1 : null,
            preOverflowX: cs(pre, 'overflowX'), preSW: pre ? pre.scrollWidth : null, preCW: pre ? pre.clientWidth : null,
            preRadius: cs(pre, 'borderRadius'), preBg: cs(pre, 'backgroundColor'),
            blockRadius: cs(b, 'borderRadius'), blockBg: cs(b, 'backgroundColor'),
            lines: pre ? (pre.textContent || '').split('\n').length : null,
          };
        });
        const first = blocks[0] || null;
        const scrollable = blocks.filter((b) => b.scScrollable).length;
        return {
          blocks: blocks.length, scrollableBlocks: scrollable, first,
          maxPreSW: Math.max(0, ...blocks.map((b) => b.preSW || 0)),
          maxScCW: Math.max(0, ...blocks.map((b) => b.scW || 0)),
          docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
          contentMaxW: (() => { const c = document.querySelector('.content'); return c ? getComputedStyle(c).maxWidth : null; })(),
          articleMaxW: (() => { const a = document.querySelector('.article'); return a ? getComputedStyle(a).maxWidth : null; })(),
          longestLineChars: (() => { let m = 0, t = null; for (const b of blocks) { const pre = document.querySelectorAll('.code-block pre'); } return m; })(),
        };
      });
      out[vp.n + ' ' + p] = d;
      console.log(vp.n.padEnd(9) + p.padEnd(42) + 'blocks=' + d.blocks + ' 可滚=' + d.scrollableBlocks + ' preSWmax=' + d.maxPreSW + ' scCW=' + d.maxScCW + ' docOvf=' + (d.docScrollW - d.docClientW) + ' contentMaxW=' + d.contentMaxW + ' articleMaxW=' + d.articleMaxW);
      if (d.first) console.log('      first: preSW=' + d.first.preSW + ' preCW=' + d.first.preCW + ' preOverflowX=' + d.first.preOverflowX + ' scW=' + d.first.scW + ' scSW=' + d.first.scSW + ' scOverflowX=' + d.first.scOverflowX + ' preRadius=' + d.first.preRadius + ' preBg=' + d.first.preBg + ' blockRadius=' + d.first.blockRadius + ' blockBg=' + d.first.blockBg);
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe6.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('写出 reports/critique-red-probe6.json');
})();
