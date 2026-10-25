'use strict';
/**
 * cr2lp-j.js — 定位「改后移动端首页变高」的来源（只读）：
 *  对比 8787/8788 在 390x844 下各类行（tg-home / src-item 叶子 / src-group / src-list）的高度总和。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-j.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

function PROBE() {
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const sum = (sel) => {
    const els = [...document.querySelectorAll(sel)];
    const hs = els.map((e) => R(e).h);
    return { count: els.length, total: hs.reduce((a, b) => a + b, 0), avg: hs.length ? Math.round((hs.reduce((a, b) => a + b, 0) / hs.length) * 10) / 10 : 0, min: Math.min(...hs), max: Math.max(...hs) };
  };
  const art = document.querySelector('.article') || document.querySelector('main');
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    pageHeight: document.documentElement.scrollHeight,
    hero: art ? R(art.querySelector('.hero')).h : null,
    tgLabel: sum('.tg-label'),
    tgHome: sum('.tg-home'),
    srcItem: sum('.src-item'),
    srcGroup: sum('.src-group'),
    srcTree: sum('.src-tree'),
    entryCards: sum('.entry-cards'),
    stats: sum('.stats'),
    quickbar: sum('.quickbar'),
    srcSum: sum('.src-sum'),
    srcRel: sum('.src-rel'),
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), data: {}, errors: [] };
  for (const [site, url] of Object.entries({ new: 'http://127.0.0.1:8787/', old: 'http://127.0.0.1:8788/' })) {
    for (const vp of [{ name: '390x844', width: 390, height: 844 }, { name: '320x568', width: 320, height: 568 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(250);
        out.data[site + '@' + vp.name] = await page.evaluate(PROBE);
      } catch (e) { out.errors.push({ site, vp: vp.name, err: String(e && e.message) }); }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  for (const [k, d] of Object.entries(out.data)) {
    console.log(`[${k}] pageH=${d.pageHeight} hero=${d.hero}`);
    for (const key of ['tgLabel', 'tgHome', 'srcItem', 'srcGroup', 'srcTree', 'entryCards', 'stats', 'quickbar', 'srcSum', 'srcRel']) {
      console.log(`   ${key}: n=${d[key].count} total=${d[key].total} avg=${d[key].avg} min=${d[key].min} max=${d[key].max}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
