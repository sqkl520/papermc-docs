'use strict';
/**
 * cr2lp-d.js — 排版/可读性/触控补充测量（只读）：
 *  - 首页标题大纲（h1/h2/h3 + y）
 *  - <12px 的小字号元素清单（谁在用 9.2px / 10.6px）
 *  - 触控目标 <44px 的链接数（移动端）
 *  - 正文/次要文字对比度（WCAG）
 *  - DOM 节点数、滚动条高度、固定/sticky 元素
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-d.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const URL = 'http://127.0.0.1:8787/';
const VPS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
];

function PROBE() {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const main = document.querySelector('main') || document.body;
  const vh = window.innerHeight;

  // 标题大纲
  const outline = [...main.querySelectorAll('h1,h2,h3,h4')].map((h) => ({
    tag: h.tagName.toLowerCase(), y: R(h).y, size: getComputedStyle(h).fontSize,
    weight: getComputedStyle(h).fontWeight, t: txt(h).slice(0, 70),
  }));

  // 小字号清单
  const small = [];
  const seenSel = new Set();
  for (const el of main.querySelectorAll('*')) {
    const t = txt(el);
    if (!t || el.children.length > 0) continue;
    const fs_ = parseFloat(getComputedStyle(el).fontSize);
    if (fs_ >= 12) continue;
    const key = (el.className || el.tagName) + '|' + fs_;
    if (seenSel.has(key)) continue;
    seenSel.add(key);
    small.push({ cls: el.className || el.tagName, px: fs_, color: getComputedStyle(el).color, t: t.slice(0, 50) });
  }

  // 触控目标
  const taps = [...main.querySelectorAll('a[href], button')].map((a) => {
    const b = R(a);
    return { t: txt(a).slice(0, 40), h: b.h, w: b.w, cls: a.className || '' };
  });
  const tapSmall = taps.filter((t) => t.h < 44);

  // 对比度
  const lum = (c) => {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
    if (!m) return null;
    const f = (v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
  };
  const contrast = (fg, bg) => {
    const a = lum(fg); const b = lum(bg);
    if (a === null || b === null) return null;
    const hi = Math.max(a, b); const lo = Math.min(a, b);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const samples = ['.hero-tag', '.ec-meta', '.stat span', '.qa span', '.ec-kicker', '.side-count', '.src-sum']
    .map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { sel, color: cs.color, size: cs.fontSize, ratio: contrast(cs.color, bodyBg) };
    }).filter(Boolean);

  // 每个数字在页面上出现的「位置」（用于说明重复）
  const numHits = {};
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const s = node.textContent;
    for (const n of ['141', '103', '31', '17']) {
      if (new RegExp('(^|\\D)' + n + '(\\D|$)').test(s)) {
        numHits[n] = numHits[n] || [];
        if (numHits[n].length < 10) {
          const p = node.parentElement;
          numHits[n].push({ cls: p.className || p.tagName, y: R(p).y, t: s.trim().slice(0, 60) });
        }
      }
    }
  }

  return {
    vw: window.innerWidth, vh,
    domNodes: document.getElementsByTagName('*').length,
    outline,
    smallText: small.sort((a, b) => a.px - b.px),
    tapTotal: taps.length,
    tapSmallCount: tapSmall.filter((t) => t.h > 0).length,
    tapSmallSample: tapSmall.filter((t) => t.h > 0).slice(0, 12),
    contrasts: samples,
    bodyBg,
    numHits,
    mainH: main ? R(main).h : null,
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), data: {}, errors: [] };
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(300);
      out.data[vp.name] = await page.evaluate(PROBE);
    } catch (e) { out.errors.push({ vp: vp.name, err: String(e && e.message) }); }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  for (const [k, d] of Object.entries(out.data)) {
    console.log(`[${k}] dom=${d.domNodes} tapTotal=${d.tapTotal} tapSmall=${d.tapSmallCount} outline=${d.outline.length} smallText=${d.smallText.length}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
