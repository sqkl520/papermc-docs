'use strict';
/*
 * cr2vn-head.js — 精确测量：文章头部元信息带 / 首页 fold 字号竞赛 / 大写+字距滥用 / 字重分布
 * 只读。输出 <os.tmpdir()>/cr2vn-head-<tag>.json
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
const VPS = [{ label: '1440x900', w: 1440, h: 900 }, { label: '390x844', w: 390, h: 844 }];

function findChrome() {
  const c = [];
  if (process.env.CHROME_PATH) c.push(process.env.CHROME_PATH);
  const lad = process.env.LOCALAPPDATA;
  if (lad) { const m = path.join(lad, 'ms-playwright');
    if (fs.existsSync(m)) for (const d of fs.readdirSync(m)) if (/^chromium/.test(d)) { c.push(path.join(m, d, 'chrome-win64', 'chrome.exe')); c.push(path.join(m, d, 'chrome-win', 'chrome.exe')); } }
  c.push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return c.find(x => x && fs.existsSync(x)) || null;
}

function probe() {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; const cx = cv.getContext('2d');
  function norm(v) { if (v == null) return null; const s = String(v).trim(); if (!s || s === 'none') return 'none';
    if (s === 'transparent') return 'transparent'; const S = '#010203'; cx.fillStyle = S; cx.fillStyle = s;
    let o = String(cx.fillStyle).toLowerCase(); if (o === S) return 'UNPARSED'; if (o === 'rgba(0, 0, 0, 0)') return 'transparent'; return o; }
  function opaque(c) { if (!c || c === 'transparent' || c === 'none') return false; if (/^#[0-9a-f]{6}$/.test(c)) return true;
    const m = /^rgba\(([^)]+)\)$/.exec(c); if (m) { const p = m[1].split(',').map(x => x.trim()); return p.length < 4 || parseFloat(p[3]) > 0.02; } return true; }
  function clsOf(el) { const c = el.className; if (typeof c === 'string') return c.trim(); if (c && typeof c.baseVal === 'string') return c.baseVal.trim(); return ''; }
  function sig(el) { const c = clsOf(el); return el.tagName.toLowerCase() + (c ? '.' + c.split(/\s+/)[0] : ''); }
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const main = document.querySelector('main.content');
  const sy = window.scrollY;
  const out = { ok: true };

  // ---- A. 文章头部：从 crumbs 顶 到 首个 h2 顶 ----
  const h1 = document.querySelector('.article h1, .page-head h1, h1');
  const firstH2 = document.querySelector('.article h2, .page-head h2, h2');
  if (h1 && main) {
    const hb = h1.getBoundingClientRect();
    const h1Top = hb.top + sy, h1Bot = hb.bottom + sy;
    const h2Top = firstH2 ? firstH2.getBoundingClientRect().top + sy : h1Bot + 300;
    const bandTop = h1Top - 90;
    const items = [];
    for (const el of Array.from(main.querySelectorAll('*'))) {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (cs.display === 'none' || r.width <= 0 || r.height <= 0) continue;
      const top = r.top + sy, bot = r.bottom + sy;
      if (top < bandTop || bot > h2Top) continue;
      if (el === h1) continue;
      // 只要"叶子"（不再包含其它可见元素）才算一个视觉单元
      const kids = Array.from(el.children).filter(k => { const kr = k.getBoundingClientRect(); return kr.width > 0 && kr.height > 0; });
      if (kids.length > 0) continue;
      const txt = (el.textContent || '').trim();
      items.push({ sig: sig(el), cls: clsOf(el), text: txt.slice(0, 24),
        top: Math.round(top), h: Math.round(r.height), w: Math.round(r.width),
        bg: opaque(norm(cs.backgroundColor)), bd: parseFloat(cs.borderTopWidth) > 0 && opaque(norm(cs.borderTopColor)),
        radius: parseFloat(cs.borderTopLeftRadius) || 0, fs: Math.round((parseFloat(cs.fontSize) || 0) * 100) / 100,
        fw: parseInt(cs.fontWeight, 10) || 400, region: 'content' });
    }
    items.sort((a, b) => a.top - b.top || b.w - a.w);
    const boxed = items.filter(x => x.bg || x.bd);
    // 只有"真正的元信息单元"：有盒面 or 在 .page-meta/.crumbs 内
    const metaish = items.filter(x => x.bg || x.bd || /chip|tag|kicker|meta|crumb|badge|pill/.test(x.cls));
    out.head = {
      h1Text: (h1.textContent || '').trim(), h1Top: Math.round(h1Top), h1Bot: Math.round(h1Bot),
      h1Fs: parseFloat(getComputedStyle(h1).fontSize), h2Top: Math.round(h2Top),
      headBandHeight: Math.round(h2Top - bandTop),
      itemCount: items.length, boxedCount: boxed.length, metaishCount: metaish.length,
      metaishSumH: metaish.reduce((a, x) => a + x.h, 0),
      items: items.slice(0, 40)
    };
  }

  // ---- B. 首页 fold 字号竞赛 ----
  const hero = document.querySelector('.hero, .page-head') || main;
  if (hero) {
    const bySize = Object.create(null);
    for (const el of Array.from(hero.querySelectorAll('*'))) {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (cs.display === 'none' || r.width <= 0 || r.height <= 0) continue;
      const kids = Array.from(el.children).filter(k => { const kr = k.getBoundingClientRect(); return kr.width > 0 && kr.height > 0; });
      if (kids.length > 0) continue;
      const fs = Math.round((parseFloat(cs.fontSize) || 0) * 100) / 100;
      if (fs < 18) continue;
      const k = fs + '|' + (parseInt(cs.fontWeight, 10) || 400);
      if (!bySize[k]) bySize[k] = { n: 0, sigs: Object.create(null), sample: '' };
      bySize[k].n++; inc(bySize[k].sigs, sig(el));
      if (!bySize[k].sample) bySize[k].sample = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    }
    out.bigTypeInHero = Object.keys(bySize).map(k => ({ fs: parseFloat(k.split('|')[0]), fw: parseInt(k.split('|')[1], 10),
      n: bySize[k].n, sigs: Object.keys(bySize[k].sigs), sample: bySize[k].sample })).sort((a, b) => b.fs - a.fs);
  }

  // ---- C. 排版"喊叫"指标 ----
  let upper = 0, spaced = 0, upperSigs = Object.create(null), spacedSigs = Object.create(null);
  const fwHist = Object.create(null), fwByRegion = Object.create(null);
  const lsHist = Object.create(null);
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.display === 'none' || r.width <= 0 || r.height <= 0) continue;
    if (r.right <= 0.5) continue;
    const txt = (el.textContent || '').trim();
    const leaf = Array.from(el.children).filter(k => { const kr = k.getBoundingClientRect(); return kr.width > 0 && kr.height > 0; }).length === 0;
    if (leaf && txt) {
      const fw = parseInt(cs.fontWeight, 10) || 400;
      inc(fwHist, String(fw));
      const reg = el.closest('.sidebar') ? 'sidebar' : el.closest('.topbar') ? 'topbar' : el.closest('.toc-side') ? 'toc' : el.closest('main.content') ? 'content' : 'other';
      inc(fwByRegion, String(fw) + '|' + reg);
      if (cs.textTransform === 'uppercase') { upper++; inc(upperSigs, sig(el)); }
      const ls = parseFloat(cs.letterSpacing);
      if (!isNaN(ls) && ls !== 0) { spaced++; inc(spacedSigs, sig(el)); inc(lsHist, ls + 'px'); }
    }
  }
  const T = o => Object.keys(o).sort((a, b) => o[b] - o[a]).map(k => ({ k: k, v: o[k] }));
  out.typography = {
    uppercaseLeaves: upper, uppercaseSigs: T(upperSigs),
    letterSpacedLeaves: spaced, letterSpacedSigs: T(spacedSigs), letterSpacingVals: T(lsHist),
    fontWeightHist: T(fwHist), fontWeightByRegion: fwByRegion
  };

  // ---- D. 首页统计卡 vs 小节标题 的字号对照 ----
  const statB = Array.from(document.querySelectorAll('.stat b, .entry-card .ec-title, .section-head h2, .hero h1'))
    .slice(0, 40).map(el => ({ sig: sig(el), fs: parseFloat(getComputedStyle(el).fontSize), fw: parseInt(getComputedStyle(el).fontWeight, 10) || 400,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20) }));
  out.headlinePeers = statB;
  return out;
}

(async () => {
  const exe = findChrome();
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const all = { base: BASE, tag: TAG, results: [] };
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      try {
        await page.goto(BASE.replace(/\/$/, '') + p.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(80);
        const d = await page.evaluate(probe, {});
        all.results.push(Object.assign({ vp: vp.label, page: p.name }, d));
        console.log(vp.label + ' ' + p.name + ' head=' + (d.head ? d.head.metaishCount + ' metaish/' + d.head.headBandHeight + 'px' : '-') +
          ' upper=' + d.typography.uppercaseLeaves + ' ls=' + d.typography.letterSpacedLeaves);
      } catch (e) { console.log('FAIL ' + vp.label + ' ' + p.name + ' ' + e.message); }
    }
    await ctx.close();
  }
  await browser.close();
  const f = path.join(os.tmpdir(), 'cr2vn-head-' + TAG + '.json');
  fs.writeFileSync(f, JSON.stringify(all, null, 1), 'utf8');
  console.log('WROTE ' + f);
})();
