'use strict';
/*
 * cr2vn-census2.js — 视觉噪音全站普查 v2（只读）
 *
 * v1 的问题（已修正）：
 *  - 折叠权重把布局容器（main.content / div.layout）当成了"视觉重量单位"，必须排除 H1 祖先与巨型容器
 *  - 未做**区域归属**（侧栏 / 顶栏 / TOC / 正文），导致导航装饰与正文装饰混算
 *  - "卡片"判定把 inline code（4 边边框+5px 圆角）、表格行、图片误判为卡片
 *  - 边框色按"边"计数，与"元素"计数混用；现分开记录
 *
 * 用法：node tools/cr2vn-census2.js --base http://127.0.0.1:8787 --tag after
 * 输出：<os.tmpdir()>/cr2vn2-<tag>.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
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
  { label: '1280x800', w: 1280, h: 800 },
  { label: '768x1024', w: 768, h: 1024 },
  { label: '390x844', w: 390, h: 844 },
  { label: '320x568', w: 320, h: 568 }
];

function findChrome() {
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);
  const lad = process.env.LOCALAPPDATA;
  if (lad) {
    const msp = path.join(lad, 'ms-playwright');
    if (fs.existsSync(msp)) {
      let dirs = [];
      try { dirs = fs.readdirSync(msp); } catch (e) { dirs = []; }
      for (const d of dirs) {
        if (!/^chromium/.test(d)) continue;
        cands.push(path.join(msp, d, 'chrome-win64', 'chrome.exe'));
        cands.push(path.join(msp, d, 'chrome-win', 'chrome.exe'));
      }
    }
  }
  cands.push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  cands.push(path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  { const b = process.env['PROGRAMFILES(X86)']; if (b) cands.push(require('path').join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')); }
  for (const c of cands) { if (c && fs.existsSync(c)) return c; }
  return null;
}

function collectInPage(cfg) {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d');
  function norm(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return 'transparent';
    if (s === 'transparent') return 'transparent';
    if (s === 'none') return 'none';
    const SENT = '#010203';
    cx.fillStyle = SENT; cx.fillStyle = s;
    let o = String(cx.fillStyle).toLowerCase();
    if (o === SENT) return 'UNPARSED:' + s;
    if (o === 'rgba(0, 0, 0, 0)') return 'transparent';
    return o;
  }
  function opaque(c) {
    if (!c || c === 'transparent' || c === 'none') return false;
    if (/^#[0-9a-f]{6}$/.test(c)) return true;
    const m = /^rgba\(([^)]+)\)$/.exec(c);
    if (m) { const p = m[1].split(',').map(x => x.trim()); return p.length < 4 || parseFloat(p[3]) > 0.02; }
    return true;
  }
  function clsOf(el) {
    const c = el.className;
    if (typeof c === 'string') return c.trim();
    if (c && typeof c.baseVal === 'string') return c.baseVal.trim();
    return '';
  }
  function sig(el) {
    const c = clsOf(el);
    return el.tagName.toLowerCase() + (c ? '.' + c.split(/\s+/).slice(0, 2).join('.') : '');
  }
  const inc = (o, k, n) => { o[k] = (o[k] || 0) + (n == null ? 1 : n); };

  const body = document.body;
  const all = Array.from(body.querySelectorAll('*'));
  const vw = window.innerWidth;

  // ---------- 区域归属 ----------
  function regionOf(el) {
    if (el.closest('.topbar')) return 'topbar';
    if (el.closest('.sidebar')) return 'sidebar';
    if (el.closest('.toc-side')) return 'toc';
    if (el.closest('main.content')) return 'content';
    if (el.closest('footer.page-footer')) return 'footer';
    return 'other';
  }

  function usable(el, cs, r) {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.right <= 0.5 || r.bottom <= 0.5) return false;   // 抽屉 / 屏外
    if (r.left > vw - 0.5) return false;
    if (el.classList && (el.classList.contains('skip') || el.classList.contains('nav-scrim'))) return false;
    return true;
  }

  // ---------- 文字归属 ----------
  const textOwners = new Set();
  const tw = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
  let t = tw.nextNode();
  while (t) {
    if (t.nodeValue && t.nodeValue.trim()) {
      const p = t.parentElement;
      if (p && p !== body && p !== document.documentElement) textOwners.add(p);
    }
    t = tw.nextNode();
  }

  const fsMap = Object.create(null);          // size -> {n, region:{}, tags:{}, sigs:{}, weights:{}}
  const fg = Object.create(null), bg = Object.create(null), bdEl = Object.create(null), bdSide = Object.create(null);
  const radiusMap = Object.create(null), shadowVals = Object.create(null);
  const sideHist = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const bwHist = Object.create(null);

  let elTotal = 0, bordered = 0, boxed4 = 0, rounded = 0, shadowed = 0, gradient = 0, bgOpaque = 0;
  const cardGroups = Object.create(null); let cardTotal = 0;
  const mbBy = Object.create(null), mtBy = Object.create(null);
  const recs = [];

  for (const el of all) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!usable(el, cs, r)) continue;
    elTotal++;
    const region = regionOf(el);
    const s = sig(el);
    const area = r.width * r.height;

    // 边框
    let sides = 0, maxBw = 0, firstBd = null;
    for (const S of ['Top', 'Right', 'Bottom', 'Left']) {
      const bw = parseFloat(cs['border' + S + 'Width']) || 0;
      const st = cs['border' + S + 'Style'];
      if (bw > 0 && st !== 'none' && st !== 'hidden') {
        const c = norm(cs['border' + S + 'Color']);
        if (opaque(c)) { sides++; inc(bdSide, c); if (!firstBd) firstBd = c; if (bw > maxBw) maxBw = bw; }
      }
    }
    if (sides > 0) { bordered++; sideHist[sides]++; if (sides === 4) boxed4++; inc(bwHist, String(maxBw)); inc(bdEl, firstBd); }

    // 圆角
    const rv = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(x => String(x).trim());
    const rmax = Math.max.apply(null, rv.map(x => parseFloat(x) || 0));
    if (rmax > 0) { rounded++; inc(radiusMap, String(Math.round(rmax * 10) / 10)); }

    // 阴影
    const sh = cs.boxShadow;
    const hasShadow = !!sh && sh !== 'none';
    if (hasShadow) { shadowed++; inc(shadowVals, sh.slice(0, 60)); }

    // 背景
    const bgc = norm(cs.backgroundColor);
    const bgOn = opaque(bgc);
    if (bgOn) { bgOpaque++; inc(bg, bgc); }
    if (cs.backgroundImage && cs.backgroundImage !== 'none') gradient++;

    // 前景色（仅渲染文字的元素）
    if (textOwners.has(el)) {
      const c = norm(cs.color);
      if (c && opaque(c)) { inc(fg, c); const fsv = Math.round((parseFloat(cs.fontSize) || 0) * 100) / 100; }
    }

    recs.push({ el: el, cs: cs, r: r, s: s, region: region, sides: sides, rmax: rmax,
      hasShadow: hasShadow, bgc: bgc, bgOn: bgOn, area: area, textOwner: textOwners.has(el) });

    // 卡片：4 边或 ≥3 边 + 圆角≥8 + 不透明底 + 面积 3000..400000 + 非 inline 文本容器
    const isA = r.width >= 140 && r.height >= 56 && area >= 6000 && area <= 500000;
    const boxy = sides >= 3 && rmax >= 8 && bgOn;
    const inlineish = cs.display === 'inline';
    if (isA && boxy && !inlineish) {
      cardTotal++;
      if (!cardGroups[s]) cardGroups[s] = { n: 0, region: Object.create(null), h: [], text: '', area: 0 };
      cardGroups[s].n++;
      inc(cardGroups[s].region, region);
      if (cardGroups[s].h.length < 12) cardGroups[s].h.push(Math.round(r.height));
      cardGroups[s].area += area;
      if (!cardGroups[s].text) cardGroups[s].text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 56);
    }

    // 间距（正文区内作为块级子元素）
    const disp = cs.display;
    const isBlock = disp === 'block' || disp === 'flex' || disp === 'grid' || disp === 'list-item';
    if (isBlock && r.width >= 160 && r.height >= 20) {
      const p = el.parentElement;
      if (p) {
        const pcls = clsOf(p).split(/\s+/)[0] || '';
        const ptag = p.tagName.toLowerCase();
        if (ptag === 'main' || /article/.test(clsOf(p)) || /content/.test(clsOf(p)) || /hero/.test(ptag)) {
          const k = ptag + (pcls ? '.' + pcls : '') + '>' + s;
          inc(mbBy, Math.round((parseFloat(cs.marginBottom) || 0) * 10) / 10 + '|' + k);
          inc(mtBy, Math.round((parseFloat(cs.marginTop) || 0) * 10) / 10 + '|' + k);
        }
      }
    }
  }

  // ---------- 字号表（分区） ----------
  for (const rc of recs) {
    if (!rc.textOwner) continue;
    const fs = Math.round((parseFloat(rc.cs.fontSize) || 0) * 100) / 100;
    const k = String(fs);
    if (!fsMap[k]) fsMap[k] = { n: 0, region: Object.create(null), tags: Object.create(null), sigs: Object.create(null), weights: Object.create(null) };
    const R = fsMap[k];
    R.n++; inc(R.region, rc.region);
    const fw = String(parseInt(rc.cs.fontWeight, 10) || 400);
    inc(R.weights, fw); inc(R.tags, rc.el.tagName.toLowerCase()); inc(R.sigs, rc.s);
  }

  // ---------- 首页 fold 视觉重量 ----------
  let fold = null;
  if (cfg.wantFold) {
    const h1 = document.querySelector('.hero h1, .page-head h1, .article h1, h1');
    const h1Ancestors = new Set();
    if (h1) { let n = h1; while (n) { h1Ancestors.add(n); n = n.parentElement; } }
    const BIG = viewportBig();
    function viewportBig() { return window.innerHeight * vw * 0.6; }

    function mass(R) {
      const fs = parseFloat(R.cs.fontSize) || 0;
      const fw = parseInt(R.cs.fontWeight, 10) || 400;
      const typeScore = R.textOwner ? Math.min(1.15, (fs / 32) * (fw >= 600 ? 1 : 0.75)) : 0;
      const surfaceScore = (R.bgOn ? 0.45 : 0) + (R.sides >= 4 ? 0.3 : R.sides > 0 ? 0.15 : 0) + (R.hasShadow ? 0.2 : 0);
      const areaF = Math.min(1, R.area / 30000);
      const chromeScore = (R.rmax >= 8 ? 0.4 : 0) + (R.bgOn ? 0.3 : 0) + (R.sides > 0 ? 0.3 : 0);
      const type = 0.55 * typeScore;
      const surface = 0.30 * surfaceScore * areaF;
      const chrome = 0.15 * chromeScore;
      return { v: 100 * (type + surface + chrome), type: 100 * type, surface: 100 * surface, chrome: 100 * chrome, fs: fs, fw: fw };
    }

    let h1m = 0, h1info = null;
    if (h1) {
      const R = recs.find(x => x.el === h1);
      if (R) { const m = mass(R); h1m = m.v; h1info = { sig: R.s, fs: m.fs, fw: m.fw, mass: +m.v.toFixed(1), parts: { type: +m.type.toFixed(1), surface: +m.surface.toFixed(1), chrome: +m.chrome.toFixed(1) } }; }
    }
    const inFold = [];
    for (const R of recs) {
      if (R.r.top >= cfg.foldH || R.r.bottom <= 0) continue;
      if (h1Ancestors.has(R.el)) continue;         // 排除 H1 自身与其祖先容器
      if (R.area > BIG) continue;                  // 排除巨型布局容器
      if (!R.textOwner && R.sides === 0 && !R.bgOn && !R.hasShadow && R.rmax === 0) continue;
      const m = mass(R);
      if (m.v < 2) continue;
      inFold.push({ sig: R.s, region: R.region, mass: +m.v.toFixed(1),
        parts: { type: +m.type.toFixed(1), surface: +m.surface.toFixed(1), chrome: +m.chrome.toFixed(1) },
        fs: m.fs, fw: m.fw, y: Math.round(R.r.top), h: Math.round(R.r.height), w: Math.round(R.r.width),
        bg: R.bgOn ? R.bgc : null, sides: R.sides, radius: R.rmax, shadow: R.hasShadow,
        text: (R.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
    }
    inFold.sort((a, b) => b.mass - a.mass);

    // 独立的、更硬的指标
    const boxedInFold = recs.filter(R => R.r.top < cfg.foldH && R.r.bottom > 0 && R.area <= BIG &&
      R.sides >= 3 && R.bgOn && R.rmax >= 8 && R.r.width >= 140 && R.r.height >= 56 && !h1Ancestors.has(R.el));
    const bigTypeInFold = recs.filter(R => R.r.top < cfg.foldH && R.r.bottom > 0 && R.textOwner &&
      (parseFloat(R.cs.fontSize) || 0) >= (h1info ? h1info.fs * 0.9 : 29) && !h1Ancestors.has(R.el));

    fold = {
      h1: h1info,
      threshold70: h1m * 0.7,
      nearH1_70: inFold.filter(x => x.mass >= h1m * 0.7).length,
      nearH1_85: inFold.filter(x => x.mass >= h1m * 0.85).length,
      itemsTotal: inFold.length,
      boxedSurfaces: { n: boxedInFold.length, items: boxedInFold.map(R => ({ sig: R.s, region: R.region, h: Math.round(R.r.height), w: Math.round(R.r.width),
        text: (R.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) })) },
      bigType: { n: bigTypeInFold.length, items: bigTypeInFold.map(R => ({ sig: R.s, fs: parseFloat(R.cs.fontSize), text: (R.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) })) },
      items: inFold.slice(0, 50)
    };
  }

  // ---------- 内容页顶部元信息带 ----------
  let metaBand = null;
  if (cfg.wantMeta) {
    const h1 = document.querySelector('.article h1, .page-head h1, h1');
    const firstH2 = document.querySelector('.article h2, .page-head h2, h2');
    if (h1) {
      const sy = window.scrollY;
      const hb = h1.getBoundingClientRect();
      const h1Bot = hb.bottom + sy;
      const h2Top = firstH2 ? firstH2.getBoundingClientRect().top + sy : h1Bot + 260;
      const band = [h1Bot, Math.min(h2Top, h1Bot + 400)];
      const chipSel = '.chip, .page-meta > *, .page-meta a, .crumbs a, .crumbs .sep, .tag, .kicker, .badge, .pill, .code-lang, .tg-home, .tg-count, .side-count, [class*="chip"], [class*="badge"], [class*="pill"]';
      const chips = [];
      for (const el of Array.from(document.querySelectorAll(chipSel))) {
        const cs2 = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs2.display === 'none' || r.width <= 0 || r.height <= 0) continue;
        const top = r.top + sy, bot = r.bottom + sy;
        if (bot < h1Bot - 60 || top > band[1]) continue;
        chips.push({ sig: sig(el), cls: clsOf(el), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26),
          top: Math.round(top), h: Math.round(r.height), w: Math.round(r.width),
          bg: opaque(norm(cs2.backgroundColor)), bd: opaque(norm(cs2.borderTopColor)) && parseFloat(cs2.borderTopWidth) > 0,
          radius: parseFloat(cs2.borderTopLeftRadius) || 0, fontSize: parseFloat(cs2.fontSize) });
      }
      const linksInBand = recs.filter(R => R.el.tagName.toLowerCase() === 'a' && R.r.top + sy >= h1Bot - 60 && R.r.top + sy <= band[1]).length;
      metaBand = {
        h1: { text: (h1.textContent || '').trim().slice(0, 60), bottom: Math.round(h1Bot), fontSize: parseFloat(getComputedStyle(h1).fontSize) },
        firstH2Top: firstH2 ? Math.round(firstH2.getBoundingClientRect().top + sy) : null,
        bandHeight: Math.round(band[1] - band[0]),
        chipCount: chips.length,
        chipBoxCount: chips.filter(c => c.bg || c.bd).length,
        chipSumHeight: chips.reduce((a, c) => a + c.h, 0),
        linkCount: linksInBand,
        chips: chips
      };
    }
  }

  // ---------- 类名清单（可被红队复核的硬计数） ----------
  const SELECTORS = [
    '.entry-card', '.qa', '.stat', '.task-card', '.cat-links a', '.tax-list li', '.card',
    'aside.alert', 'figure.code-block', '.details-block', '.table-wrap',
    'span.chip', 'a.chip', '.tag', '.tg-count', '.tg-home', '.side-count', '.side-home',
    '.code-lang', '.code-copy', '.page-meta > *', '.crumbs a', '.separator',
    '.heading-anchor', '.code-title', '.pager a', '.page-footer > *',
    '.src-item', '.src-group', '.tg-label', '.side-sec', '.side-cat', '.side-group',
    '.filter-bar', 'img.content-img', '.banner', 'kbd'
  ];
  const selCounts = [];
  for (const sel of SELECTORS) {
    let n = 0, vis = 0, boxedN = 0, wsum = 0;
    let nl;
    try { nl = document.querySelectorAll(sel); } catch (e) { continue; }
    for (const el of Array.from(nl)) {
      n++;
      const cs2 = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!usable(el, cs2, r)) continue;
      vis++;
      const bd2 = parseFloat(cs2.borderTopWidth) > 0 && cs2.borderTopStyle !== 'none';
      if (bd2 && opaque(norm(cs2.backgroundColor))) boxedN++;
      wsum += r.width * r.height;
    }
    selCounts.push({ sel: sel, html: n, visible: vis, boxed: boxedN, areaSum: Math.round(wsum) });
  }

  // ---------- 输出 ----------
  const TOP = (o, n) => Object.keys(o).sort((a, b) => o[b] - o[a]).slice(0, n).map(k => ({ k: k, v: o[k] }));
  const fontSizes = Object.keys(fsMap).map(k => ({
    size: parseFloat(k), n: fsMap[k].n, region: fsMap[k].region, weights: fsMap[k].weights,
    tags: TOP(fsMap[k].tags, 6), sigs: TOP(fsMap[k].sigs, 8)
  })).sort((a, b) => b.size - a.size);

  const cards = Object.keys(cardGroups).map(k => ({
    sig: k, n: cardGroups[k].n, region: cardGroups[k].region, heights: cardGroups[k].h,
    areaSum: Math.round(cardGroups[k].area), sample: cardGroups[k].text
  })).sort((a, b) => b.n - a.n);

  return {
    ok: true, title: document.title, docHeight: document.documentElement.scrollHeight,
    vw: vw, vh: window.innerHeight,
    elTotal: elTotal, textOwners: textOwners.size,
    fontSizes: fontSizes,
    colors: { fg: fg, bg: bg, borderByElement: bdEl, borderBySide: bdSide },
    deco: { bordered: bordered, boxed4: boxed4, sideHist: sideHist, bwHist: bwHist,
      rounded: rounded, radius: radiusMap, shadowed: shadowed, shadowVals: TOP(shadowVals, 5),
      gradient: gradient, bgOpaque: bgOpaque },
    cards: { total: cardTotal, groups: cards },
    spacing: { mb: mbBy, mt: mtBy },
    selectors: selCounts,
    fold: fold, metaBand: metaBand
  };
}

async function main() {
  const exe = findChrome();
  if (!exe) { console.error('no chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { base: BASE, tag: TAG, at: new Date().toISOString(), pages: PAGES, results: [] };
  const log = [];
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      const rec = { vp: vp.label, page: p.name, ok: false };
      try {
        const resp = await page.goto(BASE.replace(/\/$/, '') + p.url, { waitUntil: 'load', timeout: 45000 });
        rec.status = resp ? resp.status() : 0;
        await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready.then(() => 1) : 1);
        await page.waitForTimeout(100);
        const d = await page.evaluate(collectInPage, {
          wantFold: p.name === 'landing',
          wantMeta: p.name === 'content-callout-code',
          foldH: vp.h
        });
        Object.assign(rec, d, { ok: true });
        log.push(vp.label + ' ' + p.name + ' el=' + d.elTotal + ' fs=' + d.fontSizes.length +
          ' fg=' + Object.keys(d.colors.fg).length + ' bg=' + Object.keys(d.colors.bg).length +
          ' bdE=' + Object.keys(d.colors.borderByElement).length +
          ' boxed=' + d.deco.boxed4 + ' cards=' + d.cards.total + ' shadow=' + d.deco.shadowed);
      } catch (e) { rec.error = String(e && e.message || e); log.push('FAIL ' + vp.label + ' ' + p.name + ' ' + rec.error); }
      out.results.push(rec);
    }
    await ctx.close();
  }
  await browser.close();
  out.log = log;
  const file = path.join(os.tmpdir(), 'cr2vn2-' + TAG + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8');
  console.log(log.join('\n'));
  console.log('WROTE ' + file);
}
main().catch(e => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
