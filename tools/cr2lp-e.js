'use strict';
/**
 * cr2lp-e.js — 重复导航核对 + 首屏「有用内容」逐像素账本（只读）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-e.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const URL = 'http://127.0.0.1:8787/';
const VPS = [{ name: '1440x900', width: 1440, height: 900 }, { name: '390x844', width: 390, height: 844 }];

function PROBE() {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const art = document.querySelector('.article') || document.querySelector('main');
  const side = document.querySelector('.sidebar');
  const vh = window.innerHeight;
  const sideSet = new Set([...(side ? side.querySelectorAll('a[href]') : [])].map((a) => a.getAttribute('href')));

  // 关键 href 是否已在侧栏出现
  const watch = ['paper/index.html', 'velocity/index.html', 'folia/index.html', 'all-pages.html', 'snapshots.html', '#tax'];
  const watchRes = watch.map((h) => ({ href: h, inSidebar: sideSet.has(h) }));

  // 前 3 个 src-link（叶子页）
  const leaves = [...art.querySelectorAll('a.src-link')].slice(0, 3).map((a) => ({ href: a.getAttribute('href'), y: R(a).y, t: txt(a) }));
  const ghs = [...art.querySelectorAll('a.tg-home')].slice(0, 3).map((a) => ({ href: a.getAttribute('href'), y: R(a).y, t: txt(a) }));

  // 区块高度账本
  const h = (sel) => { const e = document.querySelector(sel); return e ? R(e).h : 0; };
  const ledger = {
    hero: h('.hero'),
    entryCards: h('.entry-cards'),
    quickbar: h('.quickbar'),
    stats: h('.stats'),
    treeBlock: [...document.querySelectorAll('.src-tree')].reduce((n, e) => n + R(e).h, 0),
    taxBlock: h('.cat-anchorbar') + h('#tax'),
    aboutBlock: h('.page-desc') + h('.page-meta') + h('.info-footer'),
  };
  const pageH = document.documentElement.scrollHeight;

  // 「关于本站 / 生成于 / SHA」这类开发者元信息的高度
  const dev = [...document.querySelectorAll('.page-meta, .page-footer, .section-head p')].map((e) => ({ cls: e.className, y: R(e).y, h: R(e).h, t: txt(e).slice(0, 90) }));

  // 首屏内文字量（article，不含侧栏）
  const foldText = [];
  for (const el of art.querySelectorAll('*')) {
    if (el.children.length) continue;
    const b = R(el); const t = txt(el);
    if (!t || b.y >= vh) continue;
    foldText.push({ cls: el.className || el.tagName, y: b.y, h: b.h, len: t.length, t: t.slice(0, 70) });
  }

  return {
    vw: window.innerWidth, vh, pageHeight: pageH,
    watchRes, leaves, ghs, ledger,
    ledgerPct: Object.fromEntries(Object.entries(ledger).map(([k, v]) => [k, Math.round((v / pageH) * 1000) / 10])),
    dev,
    foldChars: foldText.reduce((n, e) => n + e.len, 0),
    foldText,
    sidebarVisible: !!side && getComputedStyle(side).display !== 'none' && R(side).w > 0,
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), data: {}, errors: [] };
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(300);
      out.data[vp.name] = await page.evaluate(PROBE);
    } catch (e) { out.errors.push({ vp: vp.name, err: String(e && e.message) }); }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  for (const [k, d] of Object.entries(out.data)) {
    console.log(`[${k}] pageH=${d.pageHeight} sidebarVisible=${d.sidebarVisible} ledger=${JSON.stringify(d.ledger)} pct=${JSON.stringify(d.ledgerPct)}`);
    console.log('  watch=' + JSON.stringify(d.watchRes));
    console.log('  leaves=' + JSON.stringify(d.leaves));
    console.log('  foldChars=' + d.foldChars);
  }
})().catch((e) => { console.error(e); process.exit(1); });
