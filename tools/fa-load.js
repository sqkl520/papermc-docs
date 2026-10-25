'use strict';
/**
 * fa-load.js — final acceptance, group H: re-measure #5/#7 with images force-loaded.
 *
 * Why: `content-img` are `loading="lazy"`. A tree without `width`/`height` (a19a6c2, pre-C4)
 * lets an undecoded image collapse to ~0px, so raw `scrollHeight` is NOT comparable
 * across trees. The plan's own numbers (dialogs 13805 -> 13050) reproduce under the
 * lazy-native read; this script also produces the force-loaded read so both are on record.
 *
 * loadAllImages(): loading=eager -> decode() each img -> scroll to bottom -> back to top -> 3 frames.
 *
 * Usage: node tools/fa-load.js
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
  { key: 'b0', base: 'http://127.0.0.1:8791', label: 'a19a6c2' },
  { key: 'c1', base: 'http://127.0.0.1:8793', label: '9c82b47 C1' },
  { key: 'head', base: 'http://127.0.0.1:8796', label: '4ce8407 HEAD' },
];
const PAGES = [
  { key: 'dialogs', path: '/paper/dev/dialogs/' },
  { key: 'worldcfg', path: '/paper/reference/world-configuration/' },
  { key: 'particles', path: '/paper/dev/particles/' },
];

const LOAD_ALL = async () => {
  /* runs in page ctx */
  const imgs = [...document.querySelectorAll('img')];
  for (const im of imgs) { im.loading = 'eager'; if (!im.complete) im.src = im.src; }
  await Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
  const de = document.documentElement;
  window.scrollTo(0, de.scrollHeight);
  await new Promise((r) => setTimeout(r, 250));
  window.scrollTo(0, 0);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  await new Promise((r) => setTimeout(r, 200));
  return imgs.filter((i) => i.naturalWidth > 0).length;
};

const M = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const art = document.querySelector('article.article') || document.querySelector('article');
  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = art ? [...art.querySelectorAll('p')].filter(isProse) : [];
  const cv = document.createElement('canvas').getContext('2d');
  let zeroW = null, maxLine = 0;
  for (const p of paras) {
    const st = getComputedStyle(p);
    if (zeroW == null) { cv.font = st.fontSize + ' ' + st.fontFamily; zeroW = cv.measureText('0').width; }
    const rg = document.createRange();
    rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    if (rects.length) maxLine = Math.max(maxLine, ...rects.map((r) => r.width));
  }
  const cimgs = [...document.querySelectorAll('img.content-img')];
  const loaded = cimgs.filter((i) => i.naturalWidth > 0);
  const pres = [...document.querySelectorAll('pre.code-pre')];
  const hosts = pres.map((p) => p.closest('.code-scroll') || p);
  let codeOv = 0;
  hosts.forEach((h, i) => { if (h.scrollWidth > h.clientWidth + 1 || pres[i].scrollWidth > pres[i].clientWidth + 1) codeOv++; });
  const advOf = (el) => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const tops = [...new Set(rects.map((r) => Math.round(r.top * 100) / 100))].sort((a, b) => a - b);
    const d = [];
    for (let i = 1; i < tops.length; i++) d.push(Math.round(tops[i] - tops[i - 1]));
    const s = [...d].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const de = document.documentElement;
  return {
    docH: de.scrollHeight,
    lineW: maxLine || null,
    lineCh: maxLine && zeroW > 0 ? Math.round(maxLine / zeroW) : null,
    codeOv, codeBlocks: pres.length,
    adv: pres.length ? advOf(pres[0].querySelector('code') || pres[0]) : null,
    contentImgs: cimgs.length,
    loadedImgs: loaded.length,
    imgSumH: r2(cimgs.reduce((s, i) => s + i.getBoundingClientRect().height, 0)),
    imgSumH_loaded: r2(loaded.reduce((s, i) => s + i.getBoundingClientRect().height, 0)),
    hOverflow: de.scrollWidth - de.clientWidth,
  };
};

const settle = async (page) => {
  await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true));
  await page.evaluate(() => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= 3) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }));
};

(async () => {
  if (!EXE) throw new Error('no chrome (set CHROME_PATH)');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), cells: {} };
  try {
    for (const t of TREES) {
      for (const pd of PAGES) {
        const ctx = await browser.newContext({
          viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        await page.goto(t.base + pd.path, { waitUntil: 'load', timeout: 60000 });
        await settle(page);
        const lazy = await page.evaluate(M);
        const n = await page.evaluate(LOAD_ALL);
        const loaded = await page.evaluate(M);
        await ctx.close();
        out.cells[t.key + '/' + pd.key] = { lazy, loaded, decoded: n };
        console.log(t.key.padEnd(5) + pd.key.padEnd(10) +
          ' lazy docH=' + String(lazy.docH).padEnd(7) + 'imgs ' + lazy.loadedImgs + '/' + lazy.contentImgs +
          ' sumH=' + String(lazy.imgSumH).padEnd(9) + ' | loaded docH=' + String(loaded.docH).padEnd(7) +
          'imgs ' + loaded.loadedImgs + '/' + loaded.contentImgs + ' sumH=' + String(loaded.imgSumH).padEnd(9) +
          ' lineW=' + loaded.lineW + ' adv=' + loaded.adv + ' ov=' + loaded.codeOv + '/' + loaded.codeBlocks);
      }
    }
    const g = (t, p, m) => out.cells[t + '/' + p][m].docH;
    console.log('\n--- dialogs docH ---');
    console.log('  lazy  : b0=' + g('b0', 'dialogs', 'lazy') + ' c1=' + g('c1', 'dialogs', 'lazy') + ' head=' + g('head', 'dialogs', 'lazy'));
    console.log('  loaded: b0=' + g('b0', 'dialogs', 'loaded') + ' c1=' + g('c1', 'dialogs', 'loaded') + ' head=' + g('head', 'dialogs', 'loaded'));
    console.log('  C1 delta lazy=' + (g('c1', 'dialogs', 'lazy') - g('b0', 'dialogs', 'lazy')) +
      ' loaded=' + (g('c1', 'dialogs', 'loaded') - g('b0', 'dialogs', 'loaded')));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa-load.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa-load.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
