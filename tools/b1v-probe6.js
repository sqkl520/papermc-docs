'use strict';
/* b1v-probe6.js — 收尾三问：
 *  1) +27 漂移是否来自 P1-2 的 active.scrollIntoView（正确顺序：先打补丁再点击）
 *  2) P0-3 的 code-copy 28px 是否抬高 pageHeight（只回滚 code-copy）
 *  3) P1-3 的渐隐渐变是否随主题变色（浅/深各测一次）
 * 用法: node tools/b1v-probe6.js <port> <outPath>
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const PORT = process.argv[2] || '8787';
const OUT = process.argv[3];
const BASE = 'http://127.0.0.1:' + PORT;
const PAGE = '/paper/dev/particles/index.html';
const CODE = '/paper/anti-xray/index.html';

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

// 1) scrollIntoView 归因（先打补丁，后点击，且不再包装）
async function sivAttribution(page) {
  const once = async (label, killSiv) => {
    await page.goto(BASE + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }));
    await page.waitForTimeout(400);
    if (killSiv) await page.evaluate(() => { Element.prototype.scrollIntoView = function () {}; });
    const before = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => { document.getElementById('nav-toggle').click(); });
    await page.waitForTimeout(500);
    const openY = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => { document.getElementById('nav-toggle').click(); });
    await page.waitForTimeout(500);
    const closeY = await page.evaluate(() => window.scrollY);
    return { label, before: +before.toFixed(1), openY: +openY.toFixed(1), openD: +(openY - before).toFixed(1), closeY: +closeY.toFixed(1), closeD: +(closeY - openY).toFixed(1) };
  };
  await page.setViewportSize({ width: 390, height: 844 });
  const withSiv = await once('siv-active', false);
  const noSiv = await once('siv-noop', true);
  return { withSiv, noSiv };
}

// 2) pageHeight 归因：分别回滚 code-copy / side-home
async function heightAttribution(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(BASE + PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const m = async (label) => page.evaluate((l) => ({
    label: l,
    pageHeight: document.documentElement.scrollHeight,
    codeCopyH: (() => { const c = document.querySelector('.code-copy'); return c ? +c.getBoundingClientRect().height.toFixed(1) : null; })(),
    codeCopyN: document.querySelectorAll('.code-copy').length,
    codeTitleH: (() => { const t = document.querySelector('.code-title'); return t ? +t.getBoundingClientRect().height.toFixed(1) : null; })(),
    sideHomeH: (() => { const s = document.querySelector('.side-group-title a.side-home'); return s ? +s.getBoundingClientRect().height.toFixed(1) : null; })(),
    articleW: (() => { const a = document.querySelector('article'); return a ? +a.getBoundingClientRect().width.toFixed(2) : null; })(),
  }), label);
  const out = { width, baseline: await m('as-built') };
  for (const [name, css] of [
    ['revert-codecopy-only', '.code-copy{min-height:0!important;min-width:0!important}'],
    ['revert-sidehome-only', '.side-group-title a.side-home{min-height:0!important}'],
    ['both', '.code-copy{min-height:0!important;min-width:0!important} .side-group-title a.side-home{min-height:0!important}'],
  ]) {
    const h = await page.addStyleTag({ content: css });
    await page.waitForTimeout(250);
    out[name] = await m(name);
    await h.evaluate((el) => el.remove());
    await page.waitForTimeout(120);
  }
  return out;
}

// 3) 渐隐渐变是否随主题
async function fadeTheme(browser) {
  const res = {};
  for (const [key, scheme, theme] of [['light', 'light', null], ['dark', 'dark', null], ['dark-forced', 'light', 'dark']]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(BASE + CODE, { waitUntil: 'load' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(500);
    res[key] = await page.evaluate(() => {
      const s = document.querySelector('.code-scroll[data-overflowing]');
      const block = s ? s.closest('.code-block') : null;
      const bg = block ? getComputedStyle(block).backgroundColor : null;
      return {
        scrollBg: s ? getComputedStyle(s).backgroundColor : null,
        blockBg: bg,
        afterBgImg: s ? getComputedStyle(s, '::after').backgroundImage : null,
        themeAttr: document.documentElement.getAttribute('data-theme'),
      };
    });
    await ctx.close();
  }
  return res;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { port: PORT };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    out.siv = await sivAttribution(page);
    out.height1024 = await heightAttribution(page, 1024);
    out.height1280 = await heightAttribution(page, 1280);
    await ctx.close();
    out.fade = await fadeTheme(browser);
  } catch (e) { out.error = String((e && e.stack) || e); }
  finally { await browser.close(); }
  const j = JSON.stringify(out, null, 1);
  if (OUT) { fs.writeFileSync(OUT, j, 'utf8'); console.log('wrote ' + OUT); } else console.log(j);
})();
