'use strict';
/**
 * cr2lp-c.js — 补充测量：
 *  - 320x568 改前/改后整页高度与首屏预算（用户称 22267px，需实测并与 8788 对比）
 *  - 「第一个真正的叶子文档页链接」y（区分组首页 tg-home 与叶子 src-link）
 *  - 目录结构树的行高（移动端整页变高的来源）
 *  - 每屏实际刷到的「新信息量」：新出现的唯一链接数（滚动疲劳量化）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-c.json');
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

  // 叶子文档页链接（src-link = 具体文章）
  const leafLinks = [...(art ? art.querySelectorAll('a.src-link') : [])].map((a) => {
    const li = a.closest('li') || a;
    return { href: a.getAttribute('href'), y: R(a).y, rowH: R(li).h, t: txt(a).slice(0, 50) };
  });
  const groupHomeLinks = [...(art ? art.querySelectorAll('a.tg-home') : [])].map((a) => ({
    href: a.getAttribute('href'), y: R(a).y, rowH: R(a.closest('.tg-label') || a).h, t: txt(a).slice(0, 40),
  }));

  // 逐屏「首次可见链接数」（滚动疲劳：每屏有多少新链接进入视口）
  const allA = [...(art ? art.querySelectorAll('a[href]') : [])].map((a) => ({ href: a.getAttribute('href'), y: R(a).y }));
  const screens = [];
  const total = Math.ceil(document.documentElement.scrollHeight / vh);
  const seen = new Set();
  for (let i = 0; i < total; i++) {
    const bot = (i + 1) * vh;
    let fresh = 0;
    for (const a of allA) {
      if (a.y < bot && !seen.has(a.href + '@' + a.y)) { seen.add(a.href + '@' + a.y); fresh++; }
    }
    screens.push({ screen: i + 1, freshLinks: fresh });
  }

  // 目录结构树统计
  const trees = [...(art ? art.querySelectorAll('section.src-tree') : [])].map((s) => {
    const b = R(s);
    const lis = s.querySelectorAll('li');
    return { id: s.id, h: b.h, y: b.y, li: lis.length, avgRow: Math.round(b.h / Math.max(1, lis.length)) };
  });

  // 首屏自述文字高度占比
  const hero = document.querySelector('.hero');
  const heroP = hero ? [...hero.querySelectorAll('p')] : [];
  const selfNarrH = heroP.reduce((n, p) => n + R(p).h, 0);

  return {
    vw: window.innerWidth, vh,
    pageHeight: document.documentElement.scrollHeight,
    screensTotal: total,
    firstLeafLinkY: leafLinks.length ? leafLinks[0].y : null,
    firstLeafLinkText: leafLinks.length ? leafLinks[0].t : null,
    firstGroupHomeY: groupHomeLinks.length ? groupHomeLinks[0].y : null,
    leafAvgRowH: leafLinks.length ? Math.round(leafLinks.reduce((n, l) => n + l.rowH, 0) / leafLinks.length) : null,
    groupHomeAvgRowH: groupHomeLinks.length ? Math.round(groupHomeLinks.reduce((n, l) => n + l.rowH, 0) / groupHomeLinks.length) : null,
    leafCount: leafLinks.length,
    groupHomeCount: groupHomeLinks.length,
    trees,
    screens,
    heroH: hero ? R(hero).h : null,
    heroNarrH: selfNarrH,
    heroNarrPct: Math.round((selfNarrH / vh) * 1000) / 10,
    h1Y: document.querySelector('h1') ? R(document.querySelector('h1')).y : null,
    h2s: [...document.querySelectorAll('.article h2')].map((h) => txt(h)),
    h2Count: document.querySelectorAll('.article h2').length,
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
        await page.waitForTimeout(300);
        out.data[site + '@' + vp.name] = await page.evaluate(PROBE);
      } catch (e) { out.errors.push({ site, vp: vp.name, err: String(e && e.message) }); }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  for (const [k, d] of Object.entries(out.data)) {
    console.log(`[${k}] pageH=${d.pageHeight} screens=${d.screensTotal} h1.y=${d.h1Y} firstGroupHome.y=${d.firstGroupHomeY} firstLeaf.y=${d.firstLeafLinkY} heroNarr=${d.heroNarrH}px(${d.heroNarrPct}%) leafRow=${d.leafAvgRowH} h2count=${d.h2Count}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
