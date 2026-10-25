'use strict';
/**
 * cr2lp-g.js — 收尾量化：
 *  1) 9 张统计卡的逐张几何（行内宽度是否一致 → 「同组件两种宽度」）
 *  2) 改前(8788)/改后(8787) 逐区块高度差，定位 390/320 变高的来源
 *  3) 首屏像素带账本（按行计算，不重复计并列卡片）
 *  4) 首屏内「可点的具体文档页」= 0 的证据
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-g.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const SITES = { new: 'http://127.0.0.1:8787/', old: 'http://127.0.0.1:8788/' };
const VPS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
];

function PROBE() {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const art = document.querySelector('.article') || document.querySelector('main');
  const vh = window.innerHeight;

  // 1) 统计卡逐张几何
  const stats = [...document.querySelectorAll('.stats .stat')].map((el) => {
    const b = R(el);
    return { v: (el.querySelector('b') || {}).textContent, k: (el.querySelector('span') || {}).textContent, x: b.x, y: b.y, w: b.w, h: b.h };
  });
  const statRows = {};
  for (const s of stats) { statRows[s.y] = statRows[s.y] || []; statRows[s.y].push(s.w); }

  // 2) 区块高度（按 article 直接子元素顺序，用 class 归并）
  const bands = [...art.children].map((el) => ({ cls: el.className || el.tagName, y: R(el).y, h: R(el).h }))
    .filter((b) => b.h > 0);

  // 3) 首屏像素带：把 fold 内每个「行」算一次（同一 y 的多列只算一次高度）
  const rows = {};
  for (const el of art.querySelectorAll('*')) {
    const b = R(el);
    if (b.y >= vh || b.h <= 0 || b.w <= 0) continue;
    if (!el.textContent || !el.textContent.trim()) continue;
    const key = b.y;
    rows[key] = Math.max(rows[key] || 0, b.h);
  }
  const rowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
  // 只保留「极大值行」（避免父子叠加）
  const bandsFold = [];
  for (let i = 0; i < rowKeys.length; i++) {
    const y = rowKeys[i];
    const h = rows[y];
    bandsFold.push({ y, h });
  }

  // 4) fold 内文档页链接
  const foldDocLinks = [...art.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), y: R(a).y, cls: a.className || '' }))
    .filter((l) => l.y < vh && /^[a-z]+\/index\.html$/.test(l.href));

  const statBlock = document.querySelector('.stats');
  return {
    vw: window.innerWidth, vh,
    pageHeight: document.documentElement.scrollHeight,
    stats, statRows,
    bands, bandsFold,
    foldDocLinks,
    statsY: statBlock ? R(statBlock).y : null,
    statsH: statBlock ? R(statBlock).h : null,
    topbarH: document.querySelector('.topbar') ? R(document.querySelector('.topbar')).h : 0,
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), data: {}, errors: [] };
  for (const [site, url] of Object.entries(SITES)) {
    for (const vp of VPS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(250);
        out.data[site + '@' + vp.name] = await page.evaluate(PROBE);
      } catch (e) { out.errors.push({ site, vp: vp.name, err: String(e && e.message) }); }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  console.log('errors=' + out.errors.length);
})().catch((e) => { console.error(e); process.exit(1); });
