'use strict';
/**
 * b1g-shots.js - before/after screenshots for batch-1 visual diff.
 *
 * Produces reports/b1-shots/{before,after}/<vp>-<page>.{full,fold}.png
 * plus a per-pair pixel-diff summary (reports/b1-shots/_shotdiff.json).
 *
 * Usage:
 *   node tools/b1g-shots.js             # 1440 + 390, 3 pages, light
 *   node tools/b1g-shots.js --dark      # same in dark scheme
 *   node tools/b1g-shots.js --all       # all 6 pages
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const DARK = argv.includes('--dark');
const ALL = argv.includes('--all');
const ROOT = path.join('reports', 'b1-shots');
const AFTER = 'http://127.0.0.1:8787';
const BEFORE = 'http://127.0.0.1:8788';

const VPS = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
];

const PAGES = ALL ? [
  { url: '/', name: 'landing' },
  { url: '/paper/', name: 'section-paper' },
  { url: '/paper/dev/dialogs/', name: 'dialogs' },
  { url: '/paper/reference/world-configuration/', name: 'world-config' },
  { url: '/velocity/tuning/', name: 'tuning' },
  { url: '/all-pages.html', name: 'all-pages' },
] : [
  { url: '/paper/dev/dialogs/', name: 'dialogs' },
  { url: '/paper/reference/world-configuration/', name: 'world-config' },
  { url: '/velocity/tuning/', name: 'tuning' },
];

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const tag = DARK ? 'dark' : 'light';
  const manifest = [];

  for (const vp of VPS) {
    for (const pg of PAGES) {
      for (const [side, base] of [['before', BEFORE], ['after', AFTER]]) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
          isMobile: vp.mobile, hasTouch: vp.mobile,
          colorScheme: DARK ? 'dark' : 'light',
          reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        const dir = path.join(ROOT, side);
        fs.mkdirSync(dir, { recursive: true });
        const stem = tag + '-' + vp.name + '-' + pg.name;
        try {
          await page.goto(base + pg.url, { waitUntil: 'load', timeout: 45000 });
          await page.waitForTimeout(700);
          // freeze sticky/animated bits so the pair is comparable
          await page.evaluate(() => { try { window.scrollTo(0, 0); } catch (e) {} });
          await page.waitForTimeout(150);
          await page.screenshot({ path: path.join(dir, stem + '.fold.png'), fullPage: false });
          await page.screenshot({ path: path.join(dir, stem + '.full.png'), fullPage: true });
          const box = await page.evaluate(() => {
            const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
            return {
              h: document.documentElement.scrollHeight,
              article: r('article'),
              firstP: r('article p'),
              firstPre: r('pre'),
              h1: r('article h1') || r('h1'),
              toc: r('.toc-side'),
            };
          });
          manifest.push({ side, vp: vp.name, page: pg.name, url: pg.url, stem, scheme: tag, ...box });
          console.log('  ' + side.padEnd(6) + vp.name.padEnd(5) + pg.name.padEnd(14) + 'H=' + box.h + ' article=' + JSON.stringify(box.article));
        } catch (e) {
          console.log('  ERR ' + side + ' ' + vp.name + ' ' + pg.name + ' ' + e.message.slice(0, 90));
          manifest.push({ side, vp: vp.name, page: pg.name, url: pg.url, stem, scheme: tag, error: e.message.slice(0, 150) });
        }
        await ctx.close();
      }
    }
  }
  await browser.close();

  const file = path.join(ROOT, DARK ? '_shotmanifest-dark.json' : '_shotmanifest.json');
  fs.writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), scheme: tag, shots: manifest }, null, 2), 'utf8');
  console.log('\nwrote ' + file + ' (' + manifest.length + ' shots)');
})();
