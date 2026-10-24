'use strict';
/* b1v-probe3.js — P0-2 专项：完全绕过 Playwright 的 scroll-into-view，
 * 用 DOM .click() 触发 ☰，并记录每次 scroll 事件的相位与来源。
 * 用法: node tools/b1v-probe3.js <port> <outPath>
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const PORT = process.argv[2] || '8787';
const OUT = process.argv[3];
const BASE = 'http://127.0.0.1:' + PORT;
const PAGE = '/paper/dev/particles/index.html';

function chromePath() {
  const c = [];
  if (process.env.CHROME_PATH) c.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) {
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe');
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win\\chrome.exe');
  }
  if (process.env.PROGRAMFILES) c.push(process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe');
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  throw new Error('no chrome');
}

async function run(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(BASE + PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  // 装钩子：记录 scroll 事件 + 打补丁 scrollTo/scrollIntoView/focus
  await page.evaluate(() => {
    window.__log = [];
    window.__phase = 'init';
    const push = (o) => window.__log.push(Object.assign({ t: Math.round(performance.now()), phase: window.__phase, y: Math.round(window.scrollY) }, o));
    window.addEventListener('scroll', () => push({ ev: 'scroll' }), { passive: true });
    const origScrollTo = window.scrollTo.bind(window);
    window.scrollTo = function (...a) { push({ ev: 'scrollTo', args: JSON.stringify(a).slice(0, 60) }); return origScrollTo(...a); };
    const origSIV = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...a) {
      push({ ev: 'scrollIntoView', on: this.tagName + '.' + String(this.className).slice(0, 24) });
      return origSIV.apply(this, a);
    };
    const origFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...a) {
      push({ ev: 'focus', on: this.tagName + '.' + String(this.className).slice(0, 24), opt: JSON.stringify(a) });
      return origFocus.apply(this, a);
    };
    push({ ev: 'ready' });
  });

  // 复位并滚到 1600
  await page.evaluate(() => { window.__phase = 'prescroll'; window.scrollTo({ top: 1600, behavior: 'instant' }); });
  await page.waitForTimeout(400);

  const startY = await page.evaluate(() => window.scrollY);
  const cycles = [];

  for (let i = 0; i < 3; i++) {
    const openRes = await page.evaluate(() => {
      window.__phase = 'open' + (window.__c || 0);
      window.__c = (window.__c || 0) + 1;
      const before = window.scrollY;
      const t = document.getElementById('nav-toggle');
      t.click();
      return { before: Math.round(before), clickable: !!t };
    });
    await page.waitForTimeout(500);
    const afterOpen = await page.evaluate(() => ({ y: Math.round(window.scrollY), open: document.body.classList.contains('nav-open') }));

    const closeRes = await page.evaluate(() => {
      window.__phase = 'close' + (window.__c || 0);
      const before = window.scrollY;
      document.getElementById('nav-toggle').click();
      return { before: Math.round(before) };
    });
    await page.waitForTimeout(600);
    const afterClose = await page.evaluate(() => ({ y: Math.round(window.scrollY), open: document.body.classList.contains('nav-open') }));

    cycles.push({
      i,
      openBefore: openRes.before, openAfter: afterOpen.y, openDelta: afterOpen.y - openRes.before, openState: afterOpen.open,
      closeBefore: closeRes.before, closeAfter: afterClose.y, closeDelta: afterClose.y - closeRes.before, closeState: afterClose.open,
    });
  }

  const endY = await page.evaluate(() => window.scrollY);
  const log = await page.evaluate(() => window.__log.slice(-80));

  // 记录到 scroll 事件级别的归因
  return { width, startY: Math.round(startY), endY: Math.round(endY), net: Math.round(endY - startY), cycles, log };
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { port: PORT };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    out.w390 = await run(page, 390, 844);
    out.w320 = await run(page, 320, 700);
    // 只测"关"这一步：打开后用 JS 关，看关的动作净位移
    await ctx.close();
  } catch (e) { out.error = String((e && e.stack) || e); }
  finally { await browser.close(); }
  const j = JSON.stringify(out, null, 1);
  if (OUT) { fs.writeFileSync(OUT, j, 'utf8'); console.log('wrote ' + OUT); } else console.log(j);
})();
