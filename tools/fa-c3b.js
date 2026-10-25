'use strict';
/**
 * fa-c3b.js — final acceptance, group E2: the C3 cliff on the tree the plan measured
 *             (f3ebbfc = batch-1 close, two-step cliff) vs HEAD, plus the anchor
 *             occlusion check on that same baseline.
 *
 * The plan's "2 -> 1 steps" claim is a statement about the batch-1 tree, not about
 * a19a6c2 (which shipped a single 1200 step already). fa-c3.js measured a19a6c2;
 * this script measures f3ebbfc so the claim can be judged on its own terms.
 *
 * Usage: node tools/fa-c3b.js
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
  { key: 'b1', label: 'f3ebbfc batch-1 (2-step)', base: 'http://127.0.0.1:8795' },
  { key: 'head', label: '4ce8407 HEAD (1-step)', base: 'http://127.0.0.1:8792' },
];
const PAGES = ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/'];
const BASEH = 'http://127.0.0.1:8792';

const SCAN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = q('article.article') || q('article');
  const toc = q('.toc-side');
  const layout = q('.layout');
  const ab = art ? art.getBoundingClientRect() : null;
  const tb = toc ? toc.getBoundingClientRect() : null;
  const tocVis = !!(toc && cs(toc, 'display') !== 'none' && tb.width > 0 && tb.height > 0);
  let mode = 'hidden';
  if (tocVis) {
    const isRail = tb.width < 400 && tb.width < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.width - 2;
    mode = isRail ? 'rail' : 'top-block';
  }
  return {
    vw: window.innerWidth,
    artW: ab ? r2(ab.width) : null,
    artX: ab ? r2(ab.x) : null,
    tocMode: mode,
    tocW: tb ? r2(tb.width) : null,
    cols: cs(layout, 'gridTemplateColumns'),
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

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
    if (pos === 'sticky' || pos === 'fixed') covers.push({ name: 'toc(' + pos + ')', r: toc.getBoundingClientRect() });
  }
  let coverH = 0;
  const detail = [];
  if (tr) {
    for (const c of covers) {
      const top = Math.max(tr.top, c.r.top);
      const bot = Math.min(tr.bottom, c.r.bottom);
      const left = Math.max(tr.left, c.r.left);
      const right = Math.min(tr.right, c.r.right);
      if (bot > top && right > left) { coverH = Math.max(coverH, bot - top); detail.push(c.name + '=' + Math.round((bot - top) * 10) / 10); }
    }
  }
  return {
    hash: h, found: !!target,
    headingTop: tr ? Math.round(tr.top * 10) / 10 : null,
    headingH: tr ? Math.round(tr.height * 10) / 10 : null,
    coveredPct: tr && tr.height > 0 ? Math.round((Math.min(coverH, tr.height) / tr.height) * 1000) / 10 : null,
    detail,
    tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    scrollPad: getComputedStyle(document.documentElement).scrollPaddingTop,
    tocPos: toc ? getComputedStyle(toc).position : null,
    topbarH: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
    anchorCount: [...document.querySelectorAll('.toc-side a[href^="#"]')].filter((a) => getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().height > 0).length,
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
  const out = { generated_at: new Date().toISOString(), cliff: {}, anchor: [], mobile: {} };
  try {
    /* ---------- cliff: all three pages, 1021..1300 step 1 ---------- */
    for (const t of TREES) {
      out.cliff[t.key] = {};
      for (const pg of PAGES) {
        const ctx = await browser.newContext({
          viewport: { width: 1300, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        await page.goto(t.base + pg, { waitUntil: 'load', timeout: 60000 });
        await settle(page, 3);
        const rows = [];
        for (let w = 1021; w <= 1300; w++) {
          await page.setViewportSize({ width: w, height: 900 });
          await settle(page, 1);
          rows.push(await page.evaluate(SCAN));
        }
        const steps = [];
        for (let i = 1; i < rows.length; i++) {
          const d = rows[i].artW - rows[i - 1].artW;
          if (Math.abs(d) >= 20) steps.push({ from: rows[i - 1].vw, to: rows[i].vw, delta: Math.round(d * 100) / 100, toc_after: rows[i].tocMode });
        }
        out.cliff[t.key][pg] = { steps, rows };
        const key = (k) => rows.find((r) => r.vw === k);
        console.log('\n' + t.key + ' ' + pg + '  steps=' + steps.length + ' ' + JSON.stringify(steps.map((s) => s.from + '->' + s.to + ':' + s.delta)));
        console.log('   1023=' + key(1023).artW + ' 1024=' + key(1024).artW + ' 1025=' + key(1025).artW +
          ' 1199=' + key(1199).artW + ' 1200=' + key(1200).artW +
          ' | toc@1024=' + key(1024).tocMode + ' toc@1025=' + key(1025).tocMode);
        await ctx.close();
      }
    }

    /* ---------- anchor occlusion at the risky widths ---------- */
    console.log('\n=== anchor occlusion ===');
    for (const w of [1024, 1025, 1100, 1199, 1200, 1280, 1440]) {
      for (const t of TREES) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        await page.goto(t.base + PAGES[0], { waitUntil: 'load', timeout: 60000 });
        await settle(page, 3);
        const pick = await page.evaluate(() => {
          const links = [...document.querySelectorAll('.toc-side a[href^="#"]')]
            .filter((a) => getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().height > 0);
          if (links.length < 2) return null;
          return { href: links[1].getAttribute('href'), total: links.length };
        });
        let rec = { vw: w, tree: t.key, pick };
        if (pick) {
          await page.evaluate((href) => {
            const a = [...document.querySelectorAll('.toc-side a[href="' + href + '"]')][0];
            if (a) a.click();
          }, pick.href);
          await page.waitForTimeout(800);
          await settle(page, 3);
          rec = { ...rec, ...(await page.evaluate(COVER)) };
        }
        out.anchor.push(rec);
        console.log('  ' + t.key.padEnd(5) + ' vw=' + String(w).padEnd(5) + ' tocLinks=' + String(rec.anchorCount).padEnd(4) +
          ' tocPos=' + String(rec.tocPos).padEnd(8) + ' offset=' + String(rec.tocOffset).padEnd(5) +
          ' topbarH=' + String(rec.topbarH).padEnd(4) + ' headTop=' + String(rec.headingTop).padEnd(7) +
          ' covered=' + String(rec.coveredPct).padEnd(5) + JSON.stringify(rec.detail || []));
        await ctx.close();
      }
    }

    /* ---------- mobile 320/390/768 sanity: overflow + drawer + toc ---------- */
    console.log('\n=== mobile (head) ===');
    for (const w of [320, 390, 768]) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: w === 320 ? 568 : w === 390 ? 844 : 1024 },
        deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', hasTouch: true, isMobile: true,
      });
      const page = await ctx.newPage();
      for (const pg of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/', '/all-pages.html']) {
        await page.goto(BASEH + pg, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
        await settle(page, 3);
        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const btn = document.querySelector('#nav-toggle, .sidebar-toggle, #menu-btn, .menu-toggle');
          const bt = btn ? btn.getBoundingClientRect() : null;
          const toc = document.querySelector('.toc-side');
          const tr = toc ? toc.getBoundingClientRect() : null;
          return {
            hOverflow: de.scrollWidth - de.clientWidth,
            menuBtn: btn ? !!(getComputedStyle(btn).display !== 'none' && bt.width > 0 && bt.height > 0) : null,
            menuBtnSize: bt ? Math.round(bt.width) + 'x' + Math.round(bt.height) : null,
            tocVisible: !!(toc && getComputedStyle(toc).display !== 'none' && tr.width > 0 && tr.height > 0),
            tocH: tr ? Math.round(tr.height) : null,
            docH: de.scrollHeight,
          };
        });
        (out.mobile[w] = out.mobile[w] || {})[pg] = m;
        console.log('  ' + String(w).padEnd(4) + ' ' + pg.padEnd(40) + ' hOv=' + String(m.hOverflow).padEnd(4) +
          ' menuBtn=' + String(m.menuBtn).padEnd(5) + ' ' + String(m.menuBtnSize).padEnd(8) + ' tocVis=' + String(m.tocVisible).padEnd(5) + ' tocH=' + m.tocH);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa-c3b.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa-c3b.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
