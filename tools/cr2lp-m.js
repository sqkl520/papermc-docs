'use strict';
/**
 * cr2lp-m.js — 视觉层级量化（只读）：
 *  对比「统计卡数字 / 入口卡标题 / H2 区块标题 / 正文」的实际计算字号与字重，
 *  证明 9 个虚荣指标在视觉上比「Paper 服务端文档」更响。
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

  const data = await page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const c = getComputedStyle(el);
      return { sel, font: c.fontSize, weight: c.fontWeight, color: c.color, lh: c.lineHeight, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
    };
    return [
      g('h1'),
      g('.stat b'),
      g('.ec-title'),
      g('.section-head h2'),
      g('.article h2'),
      g('.ec-kicker'),
      g('.stat span'),
      g('.ec-meta'),
      g('.qa b'),
      g('.qa span'),
      g('.hero-tag'),
      g('.hero p:not(.hero-tag)'),
      g('.src-item .src-link'),
      g('.tg-home'),
    ].filter(Boolean);
  });

  // 每个元素的「视觉响度」近似：字号 × 字重系数，并统计 fold 内有多少元素 ≥ 21px
  const foldBig = await page.evaluate(() => {
    const vh = window.innerHeight;
    const out = [];
    for (const el of document.querySelectorAll('.article *')) {
      if (el.children.length) continue;
      const t = (el.innerText || '').trim();
      if (!t) continue;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.top > vh) continue;
      const fs_ = parseFloat(getComputedStyle(el).fontSize);
      if (fs_ >= 20) out.push({ t: t.slice(0, 30), font: fs_, cls: el.className || el.tagName, y: Math.round(r.top + window.scrollY) });
    }
    return out;
  });

  console.log(JSON.stringify({ data, foldBig }, null, 1));
  fs.writeFileSync(path.join(os.tmpdir(), 'cr2lp-m.json'), JSON.stringify({ data, foldBig }, null, 2), 'utf8');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
