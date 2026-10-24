'use strict';
/**
 * critique-typo-p11.js — 改前对照（http://127.0.0.1:8788）与改后（8787）的排版差异
 * 只做只读度量，便于在报告里给「本轮改动实际影响」而不是凭印象。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PROBE = () => {
  const art = document.querySelector('.article');
  const p = art ? art.querySelector('p:not(.page-desc):not(.page-meta)') : document.querySelector('.hero p');
  if (!p) return { error: 'no prose' };
  const cs = getComputedStyle(p);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = cs.fontSize + ' ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;
  const fsPx = parseFloat(cs.fontSize);
  const pr = p.getBoundingClientRect();
  const h2 = art ? art.querySelector('h2') : null;
  return {
    bodyFs: fsPx,
    bodyLh: Math.round(parseFloat(cs.lineHeight) * 10) / 10,
    bodyLhRatio: Math.round((parseFloat(cs.lineHeight) / fsPx) * 100) / 100,
    proseW: Math.round(pr.width),
    ch: Math.round((pr.width / zeroW) * 10) / 10,
    cjk: Math.round(pr.width / fsPx),
    h1Fs: art && art.querySelector('h1') ? parseFloat(getComputedStyle(art.querySelector('h1')).fontSize) : null,
    h2Fs: h2 ? parseFloat(getComputedStyle(h2).fontSize) : null,
    h2MarginTop: h2 ? Math.round(parseFloat(getComputedStyle(h2).marginTop) * 10) / 10 : null,
    pageH: Math.round(document.documentElement.scrollHeight),
    hasArticle: !!art,
    contentMaxW: getComputedStyle(document.querySelector('.content')).maxWidth,
  };
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const out = {};
  for (const base of ['http://127.0.0.1:8788', 'http://127.0.0.1:8787']) {
    out[base] = {};
    for (const url of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
      try {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
        const page = await ctx.newPage();
        const r = await page.goto(base + url, { waitUntil: 'load', timeout: 15000 });
        if (!r || r.status() >= 400) { out[base][url] = { status: r ? r.status() : 'noresp' }; await ctx.close(); continue; }
        await page.waitForTimeout(200);
        out[base][url] = await page.evaluate(PROBE);
        await ctx.close();
      } catch (e) {
        out[base][url] = { error: String(e && e.message || e).slice(0, 120) };
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p11.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
