'use strict';
// 查清 world-configuration 里「第一个长段落」到底是哪个元素、为什么是 15.2px
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8787/paper/reference/world-configuration/', { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const rows = await page.evaluate(() => {
    const art = document.querySelector('.article');
    const out = [];
    let i = 0;
    for (const p of art.querySelectorAll('p')) {
      const t = (p.textContent || '').trim();
      if (t.length < 40) continue;
      const cs = getComputedStyle(p);
      const range = document.createRange();
      range.selectNodeContents(p);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1);
      const maxLine = rects.length ? Math.max(...rects.map((r) => r.width)) : 0;
      const r = p.getBoundingClientRect();
      out.push({
        i: i++,
        cls: p.className || '(none)',
        parent: p.parentElement.tagName.toLowerCase() + (p.parentElement.className ? '.' + String(p.parentElement.className).split(/\s+/)[0] : ''),
        directChild: p.parentElement === art,
        fs: parseFloat(cs.fontSize),
        lh: parseFloat(cs.lineHeight),
        boxW: Math.round(r.width),
        maxLineW: Math.round(maxLine),
        nLines: rects.length,
        text: t.slice(0, 70),
      });
    }
    return out;
  });
  console.log('total long prose p=' + rows.length);
  for (const r of rows.slice(0, 12)) console.log(JSON.stringify(r));
  console.log('--- 字号分布 ---');
  const byFs = {};
  for (const r of rows) byFs[r.fs] = (byFs[r.fs] || 0) + 1;
  console.log(JSON.stringify(byFs));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
