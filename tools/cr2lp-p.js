'use strict';
/**
 * cr2lp-p.js — 核对 measure.json 里 landing 的 typography.measure 到底量的是哪个 <p>。
 * 复用 ui-shots.js 的 isProse 判据，列出落地页上「被判为正文」的段落。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);

  const res = await page.evaluate(() => {
    const art = document.querySelector('.article') || document.querySelector('main');
    const isProse = (el) => {
      if (!el) return false;
      if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item')) return false;
      if (el.className && /page-meta|page-desc|hero-tag/.test(el.className)) return false;
      return (el.textContent || '').trim().length >= 40;
    };
    const all = [...art.querySelectorAll('p')];
    const prose = all.filter(isProse);
    // 测真实行宽（Range）
    const lineW = (el) => {
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!tn) return null;
      const r = document.createRange();
      r.selectNodeContents(tn);
      const rects = [...r.getClientRects()];
      return rects.length ? Math.round(Math.max(...rects.map((x) => x.width))) : null;
    };
    return {
      allP: all.map((p) => ({ cls: p.className, len: (p.textContent || '').trim().length, prose: isProse(p), w: Math.round(p.getBoundingClientRect().width), lineW: lineW(p), head: (p.textContent || '').trim().slice(0, 70) })),
      proseCount: prose.length,
      firstProse: prose[0] ? { cls: prose[0].className, head: (prose[0].textContent || '').trim().slice(0, 80), lineW: lineW(prose[0]) } : null,
      maxWidthVar: getComputedStyle(document.documentElement).getPropertyValue('--prose-max') || null,
    };
  });

  fs.writeFileSync(path.join(os.tmpdir(), 'cr2lp-p.json'), JSON.stringify(res, null, 2), 'utf8');
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
