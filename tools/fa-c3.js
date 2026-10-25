'use strict';
/**
 * fa-c3.js — final acceptance, group E: C3 breakpoint cliff, artW at 1024, anchor occlusion,
 *            and the 8-viewport x 6-page horizontal-overflow sweep.
 *
 * Trees: b0 = a19a6c2 (:8791, two-step cliff 1024 / 1025)   head = 4ce8407 (:8792, single step 1200)
 *
 * Usage: node tools/fa-c3.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const OUT = path.join(os.tmpdir(), 'fa');
fs.mkdirSync(OUT, { recursive: true });

const TREES = [
  { key: 'b0', base: 'http://127.0.0.1:8791' },
  { key: 'head', base: 'http://127.0.0.1:8792' },
];
const CLIFF_PAGE = '/paper/dev/dialogs/';

const OV_PAGES = [
  { key: 'landing', path: '/' },
  { key: 'paper', path: '/paper/' },
  { key: 'dialogs', path: '/paper/dev/dialogs/' },
  { key: 'worldcfg', path: '/paper/reference/world-configuration/' },
  { key: 'tuning', path: '/velocity/tuning/' },
  { key: 'allpages', path: '/all-pages.html' },
];
const OV_VPS = [320, 390, 768, 1024, 1100, 1199, 1200, 1440];

const SCAN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = q('article.article') || q('article');
  const toc = q('.toc-side');
  const side = q('#sidebar') || q('.sidebar');
  const layout = q('.layout');
  const ab = art ? art.getBoundingClientRect() : null;
  const tb = toc ? toc.getBoundingClientRect() : null;
  const tocVis = !!(toc && cs(toc, 'display') !== 'none' && tb.width > 0 && tb.height > 0);
  let mode = 'hidden';
  if (tocVis) {
    const isRail = tb.width < 400 && tb.width < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.width - 2;
    mode = isRail ? 'rail' : 'top-block';
  }
  const de = document.documentElement;
  return {
    vw: window.innerWidth,
    artW: ab ? r2(ab.width) : null,
    artX: ab ? r2(ab.x) : null,
    contentW: (() => { const c = q('.content'); return c ? r2(c.getBoundingClientRect().width) : null; })(),
    tocMode: mode,
    tocW: tb ? r2(tb.width) : null,
    tocPos: cs(toc, 'position'),
    cols: cs(layout, 'gridTemplateColumns'),
    sideW: side ? r2(side.getBoundingClientRect().width) : null,
    sidePos: cs(side, 'position'),
    hOverflow: de.scrollWidth - de.clientWidth,
    menuBtn: (() => {
      const b = q('#nav-toggle, .sidebar-toggle, #menu-btn, .menu-toggle');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return !!(cs(b, 'display') !== 'none' && r.width > 0 && r.height > 0);
    })(),
  };
};

const OV = () => {
  const de = document.documentElement;
  return {
    hOverflow: de.scrollWidth - de.clientWidth,
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    innerW: window.innerWidth,
    docH: de.scrollHeight,
  };
};

/* anchor occlusion: click the 2nd TOC link, then intersect the landed heading with
   every visible sticky/fixed bar (topbar + toc-side). coveredPct must be 0. */
const COVER = () => {
  const q = (s) => document.querySelector(s);
  const vis = (el) => {
    if (!el) return false;
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const h = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
  const target = h ? document.getElementById(h) : null;
  const tr = target ? target.getBoundingClientRect() : null;
  const covers = [];
  const topbar = q('.topbar');
  if (vis(topbar)) covers.push({ name: 'topbar', r: topbar.getBoundingClientRect() });
  const toc = q('.toc-side');
  if (vis(toc)) {
    const pos = getComputedStyle(toc).position;
    if (pos === 'sticky' || pos === 'fixed') covers.push({ name: 'toc-side(' + pos + ')', r: toc.getBoundingClientRect() });
  }
  let coverH = 0;
  const detail = [];
  if (tr) {
    for (const c of covers) {
      const top = Math.max(tr.top, c.r.top);
      const bot = Math.min(tr.bottom, c.r.bottom);
      const left = Math.max(tr.left, c.r.left);
      const right = Math.min(tr.right, c.r.right);
      if (bot > top && right > left) {
        coverH = Math.max(coverH, bot - top);
        detail.push(c.name + '=' + Math.round((bot - top) * 10) / 10);
      }
    }
  }
  return {
    hash: h,
    found: !!target,
    headingTop: tr ? Math.round(tr.top * 10) / 10 : null,
    headingH: tr ? Math.round(tr.height * 10) / 10 : null,
    coveredPct: tr && tr.height > 0 ? Math.round((Math.min(coverH, tr.height) / tr.height) * 1000) / 10 : null,
    detail,
    tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
    tocPos: toc ? getComputedStyle(toc).position : null,
    topbarH: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
  };
};

const settle = async (page, n) => {
  await page.evaluate((k) => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= k) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n == null ? 2 : n);
};

(async () => {
  if (!EXE) throw new Error('no chrome (set CHROME_PATH)');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), cliff: {}, anchor: [], overflow: {}, oldOverflow: {} };
  try {
    /* ---------- 1. cliff scan 1021..1300 step 1 ---------- */
    for (const t of TREES) {
      const ctx = await browser.newContext({
        viewport: { width: 1300, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
      });
      const page = await ctx.newPage();
      await page.goto(t.base + CLIFF_PAGE, { waitUntil: 'load', timeout: 60000 });
      await settle(page, 3);
      const rows = [];
      for (let w = 1021; w <= 1300; w++) {
        await page.setViewportSize({ width: w, height: 900 });
        await settle(page, 1);
        rows.push(await page.evaluate(SCAN));
      }
      /* detect steps: |Δ artW| >= 20px between adjacent widths */
      const steps = [];
      for (let i = 1; i < rows.length; i++) {
        const d = rows[i].artW - rows[i - 1].artW;
        if (Math.abs(d) >= 20) {
          steps.push({
            from: rows[i - 1].vw, to: rows[i].vw, delta: Math.round(d * 100) / 100,
            artW_before: rows[i - 1].artW, artW_after: rows[i].artW,
            toc_before: rows[i - 1].tocMode, toc_after: rows[i].tocMode,
          });
        }
      }
      out.cliff[t.key] = { steps, rows, key: {} };
      for (const k of [1021, 1023, 1024, 1025, 1199, 1200, 1279, 1280, 1300]) {
        const r = rows.find((x) => x.vw === k);
        if (r) out.cliff[t.key].key[k] = r;
      }
      console.log('\n=== cliff ' + t.key + ' (dialogs, 1021..1300 step 1) ===');
      console.log('  steps(>=20px): ' + JSON.stringify(steps));
      for (const k of [1021, 1023, 1024, 1025, 1199, 1200, 1279, 1280, 1300]) {
        const r = out.cliff[t.key].key[k];
        if (r) console.log('  ' + String(k).padEnd(5) + ' artW=' + String(r.artW).padEnd(8) + ' artX=' + String(r.artX).padEnd(7) +
          ' toc=' + r.tocMode.padEnd(10) + ' tocPos=' + String(r.tocPos).padEnd(8) + ' menuBtn=' + r.menuBtn +
          ' cols=' + String(r.cols).slice(0, 34));
      }
      await ctx.close();
    }

    /* ---------- 2. anchor occlusion at the new boundary ---------- */
    console.log('\n=== anchor occlusion (head) ===');
    for (const w of [1025, 1100, 1199, 1200, 1440]) {
      for (const t of TREES) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        await page.goto(t.base + CLIFF_PAGE, { waitUntil: 'load', timeout: 60000 });
        await settle(page, 3);
        const pick = await page.evaluate(() => {
          const links = [...document.querySelectorAll('.toc-side a[href^="#"]')]
            .filter((a) => getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().height > 0);
          if (links.length < 2) return null;
          return { href: links[1].getAttribute('href'), text: (links[1].textContent || '').trim().slice(0, 40), total: links.length };
        });
        let rec = { vw: w, tree: t.key, picked: pick };
        if (pick) {
          await page.evaluate((href) => {
            const a = [...document.querySelectorAll('.toc-side a[href="' + href + '"]')][0];
            if (a) a.click();
          }, pick.href);
          await page.waitForTimeout(700);
          await settle(page, 3);
          rec = { ...rec, ...(await page.evaluate(COVER)) };
        }
        out.anchor.push(rec);
        console.log('  ' + t.key.padEnd(5) + ' vw=' + String(w).padEnd(6) + ' tocPos=' + String(rec.tocPos).padEnd(9) +
          ' --toc-offset=' + String(rec.tocOffset).padEnd(5) + ' headingTop=' + String(rec.headingTop).padEnd(7) +
          ' covered=' + String(rec.coveredPct).padEnd(6) + ' ' + JSON.stringify(rec.detail || []));
        await ctx.close();
      }
    }

    /* ---------- 3. overflow sweep: 8 vps x 6 pages ---------- */
    for (const t of TREES) {
      const acc = {};
      for (const vw of OV_VPS) {
        const ctx = await browser.newContext({
          viewport: { width: vw, height: vw <= 390 ? 844 : 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        for (const pd of OV_PAGES) {
          await page.goto(t.base + pd.path, { waitUntil: 'load', timeout: 60000 });
          await settle(page, 3);
          const m = await page.evaluate(OV);
          acc[vw + '/' + pd.key] = m;
        }
        await ctx.close();
      }
      out[t.key === 'head' ? 'overflow' : 'oldOverflow'] = acc;
      const bad = Object.entries(acc).filter(([, v]) => v.hOverflow > 1);
      const total = Object.keys(acc).length;
      console.log('\n=== overflow ' + t.key + ': ' + (total - bad.length) + '/' + total + ' cells with hOverflow<=1 ===');
      if (bad.length) console.log('  BAD: ' + bad.map(([k, v]) => k + '=' + v.hOverflow).join(', '));
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa-c3.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa-c3.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
