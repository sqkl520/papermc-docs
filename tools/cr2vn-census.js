'use strict';
/*
 * cr2vn-census.js — 视觉噪音全站普查（只读）
 *
 * 采集：font-size 全表 / 颜色全表(color,bg,border) / 边框-圆角-阴影计数 /
 *       卡片清单 / 区块间距分布 / 首页 fold 视觉重量 / 内容页顶部元信息带宽
 *
 * 用法：node tools/cr2vn-census.js --base http://127.0.0.1:8787 --tag after
 * 输出：<os.tmpdir()>/cr2vn-census-<tag>.json
 * 不写仓库内任何文件（除本脚本自身）。
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
        for (const sub of ['chrome-win64', 'chrome-win']) {
          cands.push(path.join(msp, d, sub, 'chrome.exe'));
        }
      }
    }
  }
  cands.push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  cands.push(path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  { const b = process.env['PROGRAMFILES(X86)']; if (b) cands.push(require('path').join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')); }
  { const b = process.env.PROGRAMFILES; if (b) cands.push(require('path').join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')); }
  for (const c of cands) { if (c && fs.existsSync(c)) return c; }
  return null;
}

/* ------------------------------------------------------------------ *
 * 页面内采集。必须完全自包含（Playwright 序列化后执行）。
 * ------------------------------------------------------------------ */
function collectInPage(cfg) {
  const normCanvas = document.createElement('canvas');
  normCanvas.width = 1; normCanvas.height = 1;
  const nctx = normCanvas.getContext('2d');

  // 任意 CSS 颜色 -> 规范形式（#rrggbb / rgba(r, g, b, a) / transparent）
  function norm(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s === 'transparent' || s === 'none') return s === 'none' ? 'none' : 'transparent';
    if (s === 'currentcolor') return 'currentcolor';
    const SENT = '#010203';
    nctx.fillStyle = SENT;
    nctx.fillStyle = s;
    let out = String(nctx.fillStyle).toLowerCase();
    if (out === SENT) return 'UNPARSED:' + s;
    if (out === 'rgba(0, 0, 0, 0)') return 'transparent';
    return out;
  }

  function isOpaque(c) {
    if (!c || c === 'transparent' || c === 'none' || c === 'currentcolor') return false;
    if (/^#[0-9a-f]{6}$/.test(c)) return true;
    const m = /^rgba\(([^)]+)\)$/.exec(c);
    if (m) {
      const parts = m[1].split(',').map(x => x.trim());
      return parts.length < 4 || parseFloat(parts[3]) > 0.02;
    }
    return true;
  }

  function clsOf(el) {
    const c = el.className;
    if (typeof c === 'string') return c.trim();
    if (c && typeof c.baseVal === 'string') return c.baseVal.trim();
    return '';
  }

  function sig(el) {
    const cls = clsOf(el);
    const c = cls ? cls.split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (c ? '.' + c : '');
  }

  const root = document.body;
  const all = root ? Array.from(root.querySelectorAll('*')) : [];
  const docW = window.innerWidth;
  const docH = document.documentElement.scrollHeight;

  function visible(el, cs, r) {
    if (!r || r.width <= 0 || r.height <= 0) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    if (r.right <= 0 || r.bottom <= 0) return false;         // 抽屉在画布外
    if (el.classList && (el.classList.contains('skip') || el.classList.contains('nav-scrim'))) return false;
    return true;
  }

  // ---- 1) font-size 全表：只统计**真的渲染文字**的元素 ----
  const fsMap = Object.create(null);
  const textOwners = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let tn = walker.nextNode();
  while (tn) {
    const txt = tn.nodeValue;
    if (txt && txt.trim().length > 0) {
      const el = tn.parentElement;
      if (el && el !== document.documentElement && el !== document.body) textOwners.add(el);
    }
    tn = walker.nextNode();
  }

  let textElementCount = 0;
  for (const el of textOwners) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const inCanvasX = r.right > 0 && r.left < docW + 1;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (!inCanvasX) continue;
    textElementCount++;
    const fs = parseFloat(cs.fontSize) || 0;
    const key = String(Math.round(fs * 100) / 100);
    if (!fsMap[key]) fsMap[key] = { n: 0, weights: Object.create(null), sigs: Object.create(null), tags: Object.create(null) };
    const rec = fsMap[key];
    rec.n++;
    const fw = String(parseInt(cs.fontWeight, 10) || 400);
    rec.weights[fw] = (rec.weights[fw] || 0) + 1;
    rec.tags[el.tagName.toLowerCase()] = (rec.tags[el.tagName.toLowerCase()] || 0) + 1;
    const s = sig(el);
    rec.sigs[s] = (rec.sigs[s] || 0) + 1;
  }

  // ---- 2/3) 颜色 / 边框 / 圆角 / 阴影 ----
  const fg = Object.create(null);
  const bg = Object.create(null);
  const bd = Object.create(null);
  const radius = Object.create(null);
  const radiusN = Object.create(null);

  let elementCount = 0;
  let borderedElements = 0;
  const borderSideHist = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let shadowElements = 0;
  let gradientElements = 0;
  let roundedElements = 0;
  const borderWidthHist = Object.create(null);
  const cardSigs = Object.create(null);
  let cardCount = 0;
  const spacingMb = Object.create(null);
  const spacingMt = Object.create(null);

  const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
  const records = [];

  for (const el of all) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, cs, r)) continue;
    elementCount++;

    const s = sig(el);
    const area = r.width * r.height;

    // border
    let sides = 0;
    const bws = [];
    for (const S of SIDES) {
      const bw = parseFloat(cs['border' + S + 'Width']) || 0;
      const st = cs['border' + S + 'Style'];
      if (bw > 0 && st !== 'none' && st !== 'hidden') {
        const c = norm(cs['border' + S + 'Color']);
        if (isOpaque(c)) {
          sides++;
          bws.push(bw);
          bd[c] = (bd[c] || 0) + 1;
        }
      }
    }
    if (sides > 0) {
      borderedElements++;
      borderSideHist[sides]++;
      const k = String(Math.max.apply(null, bws));
      borderWidthHist[k] = (borderWidthHist[k] || 0) + 1;
    }

    // radius
    const rTop = cs.borderTopLeftRadius, rAll = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
    const rvals = rAll.map(x => String(x).trim());
    const rmax = Math.max.apply(null, rvals.map(x => parseFloat(x) || 0));
    if (rmax > 0) {
      roundedElements++;
      const key = rvals.join(' ');
      radius[key] = (radius[key] || 0) + 1;
      radiusN[String(Math.round(rmax * 10) / 10)] = (radiusN[String(Math.round(rmax * 10) / 10)] || 0) + 1;
    }

    // shadow
    const sh = cs.boxShadow;
    const hasShadow = sh && sh !== 'none';
    if (hasShadow) shadowElements++;

    // background
    const bgc = norm(cs.backgroundColor);
    if (isOpaque(bgc)) bg[bgc] = (bg[bgc] || 0) + 1;
    const bgi = cs.backgroundImage;
    if (bgi && bgi !== 'none') gradientElements++;

    // fg（只对渲染文字的元素计）
    if (textOwners.has(el)) {
      const c = norm(cs.color);
      if (c) fg[c] = (fg[c] || 0) + 1;
    }

    // ---- 卡片检测：可见边框(>=2 边) + 圆角>=8 + 不透明背景 + 面积>=2000 ----
    const isCard = sides >= 2 && rmax >= 8 && isOpaque(bgc) && area >= 2000 && area <= 900000;
    if (isCard) {
      cardCount++;
      if (!cardSigs[s]) cardSigs[s] = { n: 0, h: [], text: '' };
      cardSigs[s].n++;
      if (cardSigs[s].h.length < 12) cardSigs[s].h.push(Math.round(r.height));
      if (!cardSigs[s].text) cardSigs[s].text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    }

    // ---- 间距：正文/内容区里作为“区块”的元素 ----
    const disp = cs.display;
    const isBlock = disp === 'block' || disp === 'flex' || disp === 'grid' || disp === 'list-item';
    if (isBlock && el.parentElement) {
      const pcls = clsOf(el.parentElement);
      const ptag = el.parentElement.tagName.toLowerCase();
      const inContent = /article|content|hero|page-head/.test(pcls) || ptag === 'main' ||
        /article|hero/.test(ptag);
      if (inContent && areasBigEnough(r)) {
        const mb = Math.round((parseFloat(cs.marginBottom) || 0) * 10) / 10;
        const mt = Math.round((parseFloat(cs.marginTop) || 0) * 10) / 10;
        const key = ptag + '.' + (pcls.split(/\s+/)[0] || '') + '>' + s;
        const mk = mb + '|' + key;
        const mk2 = mt + '|' + key;
        spacingMb[mk] = (spacingMb[mk] || 0) + 1;
        spacingMt[mk2] = (spacingMt[mk2] || 0) + 1;
      }
    }

    function areasBigEnough(rr) { return rr.width >= 120 && rr.height >= 24; }

    records.push({ el: el, cs: cs, r: r, s: s, sides: sides, rmax: rmax, hasShadow: hasShadow, bgc: bgc, area: area });
  }

  // ---- 4) 首页 fold 视觉重量 ----
  let fold = null;
  if (cfg.wantFold) {
    const h1 = document.querySelector('.hero h1, .page-head h1, .article h1, h1');
    function weightOf(rec) {
      const fs = parseFloat(rec.cs.fontSize) || 0;
      const fw = parseInt(rec.cs.fontWeight, 10) || 400;
      const type = Math.min(1, (fs / 32) * (fw >= 600 ? 1 : 0.72));
      const surface = Math.min(1,
        (isOpaque(rec.bgc) ? 0.6 : 0) + (rec.sides > 0 ? 0.25 : 0) + (rec.hasShadow ? 0.15 : 0));
      const chrome = Math.min(1,
        (rec.rmax >= 8 ? 0.4 : 0) + (rec.sides / 4 * 0.35) + (rec.hasShadow ? 0.25 : 0));
      const areaF = Math.min(1, rec.area / 20000);
      const parts = { type: type * 0.45, surface: surface * areaF * 0.30, chrome: chrome * 0.25 };
      return {
        w: 100 * (parts.type + parts.surface + parts.chrome),
        parts: { type: +(parts.type * 100).toFixed(1), surface: +(parts.surface * 100).toFixed(1), chrome: +(parts.chrome * 100).toFixed(1) },
        fs: fs, fw: fw
      };
    }
    let h1w = 0; let h1rec = null;
    if (h1) {
      const cs = getComputedStyle(h1); const r = h1.getBoundingClientRect();
      h1rec = { el: h1, cs: cs, r: r, s: sig(h1), sides: 0, rmax: 0, hasShadow: false, bgc: norm(cs.backgroundColor), area: r.width * r.height };
      h1w = weightOf(h1rec).w;
    }
    const inFold = [];
    for (const rec of records) {
      if (rec.r.top >= cfg.foldH) continue;
      if (rec.r.bottom <= 0) continue;
      const w = weightOf(rec);
      if (w.w < 1) continue;
      inFold.push({
        sig: rec.s, tag: rec.el.tagName.toLowerCase(),
        text: (rec.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        w: +w.w.toFixed(1), parts: w.parts, fs: w.fs, fw: w.fw,
        y: Math.round(rec.r.top), h: Math.round(rec.r.height), wd: Math.round(rec.r.width),
        bg: isOpaque(rec.bgc) ? rec.bgc : null, sides: rec.sides,
        radius: rec.rmax, shadow: rec.hasShadow
      });
    }
    inFold.sort((a, b) => b.w - a.w);
    fold = {
      h1: h1rec ? { sig: h1rec.s, w: +h1w.toFixed(1), fs: parseFloat(h1rec.cs.fontSize), fw: parseInt(h1rec.cs.fontWeight, 10) } : null,
      total: inFold.length,
      near: inFold.filter(x => x.w >= h1w * 0.85).length,
      items: inFold.slice(0, 60)
    };
  }

  // ---- 5) 内容页顶部元信息带宽 ----
  let metaBand = null;
  if (cfg.wantMeta) {
    const h1 = document.querySelector('.article h1, .page-head h1, h1');
    if (h1) {
      const hr = h1.getBoundingClientRect();
      const scrollY = window.scrollY;
      const h1Top = hr.top + scrollY, h1Bot = hr.bottom + scrollY;
      const bandTop = h1Top - 200, bandBot = h1Bot + 200;
      const items = [];
      for (const rec of records) {
        const t = rec.r.top + scrollY, b = rec.r.bottom + scrollY;
        if (b < bandTop || t > bandBot) continue;
        const cls = clsOf(rec.el);
        const isMetaish = /chip|badge|pill|kicker|meta|crumbs|crumb|-tag\b|\btag\b|hint|count|home|rel\b|sum\b|eyebrow|label/i.test(cls);
        const isLeafText = rec.el.children.length === 0 && (rec.el.textContent || '').trim().length > 0;
        const isLink = rec.el.tagName.toLowerCase() === 'a';
        if (!(isMetaish || (isLeafText && rec.r.height <= 44) || isLink)) continue;
        items.push({
          sig: rec.s, cls: cls, text: (rec.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28),
          y: Math.round(t), h: Math.round(rec.r.height), wd: Math.round(rec.r.width),
          bg: isOpaque(rec.bgc) ? rec.bgc : null, sides: rec.sides, radius: rec.rmax,
          metaish: isMetaish, link: isLink
        });
      }
      items.sort((a, b) => a.y - b.y || a.wd - b.wd);
      const chipLike = items.filter(x => x.metaish);
      const sumH = chipLike.reduce((s, x) => s + x.h, 0);
      metaBand = {
        h1: { y: Math.round(h1Top), h: Math.round(hr.height), text: (h1.textContent || '').trim().slice(0, 60) },
        band: [Math.round(bandTop), Math.round(bandBot)],
        itemCount: items.length,
        metaishCount: chipLike.length,
        linkCount: items.filter(x => x.link).length,
        sumHeightOfMetaish: sumH,
        items: items.slice(0, 70)
      };
    }
  }

  function topN(obj, n) {
    return Object.keys(obj).sort((a, b) => obj[b] - obj[a]).slice(0, n).map(k => ({ k: k, v: obj[k] }));
  }

  const fsOut = Object.keys(fsMap).map(k => ({
    size: parseFloat(k),
    n: fsMap[k].n,
    weights: fsMap[k].weights,
    tags: topN(fsMap[k].tags, 6),
    sigs: topN(fsMap[k].sigs, 8)
  })).sort((a, b) => b.size - a.size);

  const cardsOut = Object.keys(cardSigs).map(k => ({
    sig: k, n: cardSigs[k].n,
    heights: cardSigs[k].h, sample: cardSigs[k].text
  })).sort((a, b) => b.n - a.n);

  return {
    ok: true,
    title: document.title,
    docHeight: docH,
    elementCount: elementCount,
    textElementCount: textElementCount,
    fontSizes: fsOut,
    colors: { fg: fg, bg: bg, bd: bd },
    borders: {
      borderedElements: borderedElements,
      borderSideHist: borderSideHist,
      borderWidthHist: borderWidthHist,
      roundedElements: roundedElements,
      radiusValues: radius,
      radiusMax: radiusN,
      shadowElements: shadowElements,
      gradientElements: gradientElements
    },
    cards: { cardCount: cardCount, groups: cardsOut },
    spacing: { mb: spacingMb, mt: spacingMt },
    fold: fold,
    metaBand: metaBand
  };
}

async function main() {
  const exe = findChrome();
  if (!exe) { console.error('no chrome/chromium found (set CHROME_PATH)'); process.exit(2); }
  console.error('[census] base=' + BASE + ' tag=' + TAG + ' chrome=' + exe);

  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { base: BASE, tag: TAG, generatedAt: new Date().toISOString(), pages: PAGES, vps: VPS, results: [] };

  for (const vp of VPS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false
    });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      const url = BASE.replace(/\/$/, '') + p.url;
      const rec = { vp: vp.label, page: p.name, url: p.url, ok: false };
      try {
        const resp = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
        rec.status = resp ? resp.status() : 0;
        await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready.then(() => true) : true);
        await page.waitForTimeout(120);
        const data = await page.evaluate(collectInPage, {
          wantFold: p.name === 'landing',
          wantMeta: p.name === 'content-callout-code',
          foldH: vp.h
        });
        Object.assign(rec, data, { ok: true });
        console.error('[census] ' + vp.label + ' ' + p.name + ' elements=' + data.elementCount + ' fs=' + data.fontSizes.length +
          ' fg=' + Object.keys(data.colors.fg).length + ' bg=' + Object.keys(data.colors.bg).length + ' bd=' + Object.keys(data.colors.bd).length +
          ' cards=' + data.cards.cardCount);
      } catch (e) {
        rec.error = String(e && e.message || e);
        console.error('[census] FAIL ' + vp.label + ' ' + p.name + ' :: ' + rec.error);
      }
      out.results.push(rec);
    }
    await ctx.close();
  }

  await browser.close();
  const file = path.join(os.tmpdir(), 'cr2vn-census-' + TAG + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8');
  console.error('[census] wrote ' + file);
  console.log(file);
}

main().catch(e => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
