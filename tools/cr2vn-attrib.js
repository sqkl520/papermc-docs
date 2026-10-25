'use strict';
/*
 * cr2vn-attrib.js — 装饰归因（只读）
 * 回答：5353 个带边框元素到底是"谁"？在什么区域？是不是 inline code 撑起来的？
 * 同时给出：正文相邻块的实际渲染间距（节奏），pill/badge 的可见总数。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = argOf('--base', 'http://127.0.0.1:8787');
const TAG = argOf('--tag', 'after');
const PAGES = [
  { name: 'landing', url: '/' },
  { name: 'section-paper', url: '/paper/' },
  { name: 'content-callout-code', url: '/paper/dev/dialogs/' },
  { name: 'reference-longpage', url: '/paper/reference/world-configuration/' },
  { name: 'content-tuning', url: '/velocity/tuning/' },
  { name: 'index-allpages', url: '/all-pages.html' }
];
const VPS = [
  { label: '1440x900', w: 1440, h: 900 },
  { label: '768x1024', w: 768, h: 1024 },
  { label: '390x844', w: 390, h: 844 }
];

function findChrome() {
  const c = [];
  if (process.env.CHROME_PATH) c.push(process.env.CHROME_PATH);
  const lad = process.env.LOCALAPPDATA;
  if (lad) {
    const m = path.join(lad, 'ms-playwright');
    if (fs.existsSync(m)) for (const d of fs.readdirSync(m)) if (/^chromium/.test(d)) { c.push(path.join(m, d, 'chrome-win64', 'chrome.exe')); c.push(path.join(m, d, 'chrome-win', 'chrome.exe')); }
  }
  c.push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return c.find(x => x && fs.existsSync(x)) || null;
}

function probe(cfg) {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; const cx = cv.getContext('2d');
  function norm(v) { if (v == null) return null; const s = String(v).trim(); if (!s || s === 'none') return 'none';
    if (s === 'transparent') return 'transparent'; const S = '#010203'; cx.fillStyle = S; cx.fillStyle = s;
    let o = String(cx.fillStyle).toLowerCase(); if (o === S) return 'UNPARSED'; if (o === 'rgba(0, 0, 0, 0)') return 'transparent'; return o; }
  function opaque(c) { if (!c || c === 'transparent' || c === 'none') return false; if (/^#[0-9a-f]{6}$/.test(c)) return true;
    const m = /^rgba\(([^)]+)\)$/.exec(c); if (m) { const p = m[1].split(',').map(x => x.trim()); return p.length < 4 || parseFloat(p[3]) > 0.02; } return true; }
  function clsOf(el) { const c = el.className; if (typeof c === 'string') return c.trim(); if (c && typeof c.baseVal === 'string') return c.baseVal.trim(); return ''; }
  function regionOf(el) { if (el.closest('.topbar')) return 'topbar'; if (el.closest('.sidebar')) return 'sidebar';
    if (el.closest('.toc-side')) return 'toc'; if (el.closest('main.content')) return 'content'; return 'other'; }
  function usable(el, cs, r) { if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false; if (r.width <= 0 || r.height <= 0) return false;
    if (r.right <= 0.5 || r.bottom <= 0.5) return false;
    if (el.classList && (el.classList.contains('skip') || el.classList.contains('nav-scrim'))) return false; return true; }

  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const byTag = Object.create(null), byTagRegion = Object.create(null), byRadiusTag = Object.create(null);
  const borderKind = { inlineCode: 0, inlineOther: 0, blockBox: 0, oneSide: 0 };
  let bordered = 0, shadowed = 0, gradient = 0, rounded = 0;
  const radiusOn = Object.create(null);
  const pills = Object.create(null);
  const t0 = performance.now();

  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (!usable(el, cs, r)) continue;
    const reg = regionOf(el);
    let sides = 0;
    for (const S of ['Top', 'Right', 'Bottom', 'Left']) {
      const bw = parseFloat(cs['border' + S + 'Width']) || 0;
      if (bw > 0 && cs['border' + S + 'Style'] !== 'none' && opaque(norm(cs['border' + S + 'Color']))) sides++;
    }
    const rmax = Math.max(parseFloat(cs.borderTopLeftRadius) || 0, parseFloat(cs.borderTopRightRadius) || 0);
    if (rmax > 0) { rounded++; inc(radiusOn, String(Math.round(rmax * 10) / 10) + '|' + el.tagName.toLowerCase()); }
    if (cs.boxShadow && cs.boxShadow !== 'none') shadowed++;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') gradient++;

    if (sides > 0) {
      bordered++;
      const t = el.tagName.toLowerCase();
      inc(byTag, t);
      inc(byTagRegion, t + '|' + reg);
      const inlineish = cs.display === 'inline' || (cs.display === 'inline-block' && r.height <= 32);
      if (inlineish && t === 'code') borderKind.inlineCode++;
      else if (inlineish) borderKind.inlineOther++;
      else if (sides >= 3) borderKind.blockBox++;
      else borderKind.oneSide++;
    }

    if (el.matches('.chip, .tag, .tg-count, .side-home, .tg-home, .code-lang, kbd, .badge, .pill')) inc(pills, el.tagName.toLowerCase() + '.' + (clsOf(el).split(/\s+/)[0] || ''));
  }

  // 正文相邻块渲染间距（节奏）
  const art = document.querySelector('.article') || document.querySelector('main.content');
  const gaps = [];
  if (art) {
    const kids = Array.from(art.children).filter(k => {
      const cs = getComputedStyle(k); const r = k.getBoundingClientRect();
      return cs.display !== 'none' && r.height > 4;
    });
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      const g = Math.round((b.top - a.bottom) * 10) / 10;
      gaps.push({ gap: g, from: kids[i - 1].tagName.toLowerCase() + '.' + (clsOf(kids[i - 1]).split(/\s+/)[0] || ''),
        to: kids[i].tagName.toLowerCase() + '.' + (clsOf(kids[i]).split(/\s+/)[0] || '') });
    }
  }
  const gapHist = Object.create(null);
  for (const g of gaps) inc(gapHist, String(g.gap));

  const TOP = (o, n) => Object.keys(o).sort((a, b) => o[b] - o[a]).slice(0, n).map(k => ({ k: k, v: o[k] }));
  return {
    ok: true, ms: Math.round(performance.now() - t0),
    bordered: bordered, borderKind: borderKind,
    shadowed: shadowed, gradient: gradient, rounded: rounded,
    byTag: TOP(byTag, 14), byTagRegion: byTagRegion,
    radiusOn: TOP(radiusOn, 18),
    pills: Top(pills),
    gapCount: gaps.length, gapHist: gapHist,
    gapList: gaps.slice(0, 60)
  };
  function Top(o) { return Object.keys(o).sort((a, b) => o[b] - o[a]).map(k => ({ k: k, v: o[k] })); }
}

(async () => {
  const exe = findChrome();
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { base: BASE, tag: TAG, results: [] };
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      try {
        await page.goto(BASE.replace(/\/$/, '') + p.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(80);
        const d = await page.evaluate(probe, {});
        out.results.push(Object.assign({ vp: vp.label, page: p.name }, d));
        console.log(vp.label + ' ' + p.name + ' bordered=' + d.bordered + ' kind=' + JSON.stringify(d.borderKind) + ' top=' + d.byTag.slice(0, 4).map(x => x.k + ':' + x.v).join(','));
      } catch (e) { console.log('FAIL ' + vp.label + ' ' + p.name + ' ' + e.message); }
    }
    await ctx.close();
  }
  await browser.close();
  const f = path.join(os.tmpdir(), 'cr2vn-attrib-' + TAG + '.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');
  console.log('WROTE ' + f);
})();
