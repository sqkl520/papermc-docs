'use strict';
/**
 * cr2cp-first.js — 「进入页面后多久看到正文第一行」+ 首屏导航像素占比 + 顶部元信息条（chips）实测。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2cp');
const NEW = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const M = () => {
  const vh = window.innerHeight;
  const abs = (el) => el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
  const art = document.querySelector('article.article');
  // 第一条真正的正文段落：article 内、且不在 .page-head / .page-meta 里的 p
  let firstBody = null;
  if (art) {
    for (const p of art.querySelectorAll('p')) {
      if (p.closest('.page-head,.page-meta,.page-desc-wrap')) continue;
      firstBody = p; break;
    }
  }
  const h1 = document.querySelector('article h1,.page-head h1');
  const meta = document.querySelector('.page-meta, .page-head .meta, .chips');
  const chips = [...document.querySelectorAll('.chip')].map((c) => ({
    text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 26),
    y: abs(c), h: Math.round(c.getBoundingClientRect().height), w: Math.round(c.getBoundingClientRect().width),
  }));
  const metaBox = meta ? { y: abs(meta), h: Math.round(meta.getBoundingClientRect().height) } : null;

  // 首屏导航像素占比：把所有导航容器的可见矩形与视口求交
  const navSel = ['.topbar', 'nav.crumbs', '.toc-side', 'nav.pager', '.page-meta', '.side-toc'];
  let navArea = 0;
  const parts = [];
  for (const sel of navSel) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const top = Math.max(0, r.top), bot = Math.min(vh, r.bottom);
      const left = Math.max(0, r.left), right = Math.min(window.innerWidth, r.right);
      if (bot <= top || right <= left) continue;
      const a = (bot - top) * (right - left);
      navArea += a;
      parts.push({ sel, h: Math.round(bot - top), area: Math.round(a), y: Math.round(r.top) });
    }
  }
  return {
    vw: window.innerWidth, vh,
    h1Y: abs(h1), descY: abs(document.querySelector('.page-desc')),
    firstBodyY: abs(firstBody), firstBodyText: firstBody ? firstBody.textContent.replace(/\s+/g, ' ').trim().slice(0, 50) : null,
    firstBodyScreens: firstBody ? +(abs(firstBody) / vh).toFixed(2) : null,
    metaBox, chips, chipCount: chips.length,
    chipsBlockH: chips.length ? (Math.max(...chips.map((c) => c.y + c.h)) - Math.min(...chips.map((c) => c.y))) : 0,
    navArea, navPctOfScreen: +(navArea / (window.innerWidth * vh) * 100).toFixed(1),
    parts,
    // 首个 h2 位置
    firstH2Y: abs(document.querySelector('article h2')),
  };
};

async function run() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const vp of [{ w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 768, h: 1024 }, { w: 390, h: 844 }, { w: 320, h: 568 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.w < 500, hasTouch: vp.w < 500 });
    const page = await ctx.newPage();
    for (const p of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/']) {
      await page.goto(NEW + p, { waitUntil: 'load' });
      await page.waitForTimeout(280);
      out[vp.w + 'x' + vp.h] = out[vp.w + 'x' + vp.h] || {};
      out[vp.w + 'x' + vp.h][p] = await page.evaluate(M);
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'first.json'), JSON.stringify(out, null, 1), 'utf8');

  const L = (s) => console.log(s);
  L('vp        page                          h1Y  descY  正文首行Y  屏数   首h2Y  chips  chips块高  导航像素占首屏');
  Object.keys(out).forEach((vp) => {
    Object.keys(out[vp]).forEach((p) => {
      const m = out[vp][p];
      L(vp.padEnd(9) + p.replace('/paper/', '').replace('/velocity/', 'v/').padEnd(30)
        + String(m.h1Y).padStart(5) + String(m.descY).padStart(7) + String(m.firstBodyY).padStart(9)
        + String(m.firstBodyScreens).padStart(7) + String(m.firstH2Y).padStart(7)
        + String(m.chipCount).padStart(6) + String(m.chipsBlockH).padStart(9) + String(m.navPctOfScreen + '%').padStart(14));
    });
  });
  L('\n==== dialogs @390 chips ====');
  (out['390x844']['/paper/dev/dialogs/'].chips || []).forEach((c) => L('  y=' + c.y + ' h=' + c.h + ' w=' + c.w + ' "' + c.text + '"'));
  L('\n==== 首屏导航分块 @390 dialogs ====');
  out['390x844']['/paper/dev/dialogs/'].parts.forEach((x) => L('  ' + x.sel.padEnd(14) + ' y=' + String(x.y).padStart(4) + ' h=' + String(x.h).padStart(4) + ' area=' + x.area));
  L('\n==== 首屏导航分块 @1440 dialogs ====');
  out['1440x900']['/paper/dev/dialogs/'].parts.forEach((x) => L('  ' + x.sel.padEnd(14) + ' y=' + String(x.y).padStart(4) + ' h=' + String(x.h).padStart(4) + ' area=' + x.area));
  L('\nJSON -> ' + path.join(OUT, 'first.json'));
}
run().catch((e) => { console.error('FAIL', e); process.exit(1); });
