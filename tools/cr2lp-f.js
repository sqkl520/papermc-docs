'use strict';
/**
 * cr2lp-f.js — 卡片视觉等权核对 + 侧栏折叠态核对（只读）。
 *  - 15 张卡的 border/radius/background/shadow/字号 是否同构
 *  - 侧栏里「可见 vs DOM 中」的链接数（说明首页目录树 = 侧栏展开版）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-f.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

function PROBE() {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cs = (el, p) => getComputedStyle(el)[p];

  const styleOf = (el) => {
    const s = getComputedStyle(el);
    return {
      border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor,
      radius: s.borderTopLeftRadius,
      bg: s.backgroundColor,
      shadow: s.boxShadow === 'none' ? 'none' : s.boxShadow,
      pad: s.padding,
    };
  };

  const cards = [];
  for (const sel of ['.entry-card', '.quickbar .qa', '.stats .stat']) {
    for (const el of document.querySelectorAll(sel)) {
      const b = R(el);
      cards.push({
        sel, h: b.h, w: b.w, y: b.y,
        css: styleOf(el),
        titleSize: el.querySelector('b, .ec-title, strong') ? cs(el.querySelector('b, .ec-title, strong'), 'fontSize') : null,
        titleWeight: el.querySelector('b, .ec-title, strong') ? cs(el.querySelector('b, .ec-title, strong'), 'fontWeight') : null,
      });
    }
  }
  // 签名分组
  const sig = (c) => c.css.radius + '|' + c.css.bg + '|' + c.css.border.replace(/rgb\([^)]*\)/, 'C') + '|' + c.css.shadow;
  const sigCount = {};
  for (const c of cards) sigCount[sig(c)] = (sigCount[sig(c)] || 0) + 1;

  // 侧栏
  const side = document.querySelector('.sidebar');
  const sideLinks = side ? [...side.querySelectorAll('a[href]')] : [];
  const isShown = (el) => {
    let n = el;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
      if (n.tagName === 'DETAILS' && !n.open) return false;
      n = n.parentElement;
    }
    return true;
  };
  const sideVisible = sideLinks.filter(isShown).length;
  const sideDetails = side ? [...side.querySelectorAll('details')].map((d) => ({ open: d.open, sum: txt(d.querySelector('summary')).slice(0, 40), links: d.querySelectorAll('a[href]').length })) : [];

  // 首页目录树 <li> 与侧栏链接的重合（按 href 唯一值）
  const leafSet = new Set([...document.querySelectorAll('.src-link')].map((a) => a.getAttribute('href')));
  const sideSet = new Set(sideLinks.map((a) => a.getAttribute('href')));
  const dup = [...leafSet].filter((h) => sideSet.has(h)).length;

  return {
    vw: window.innerWidth, vh: window.innerHeight,
    cards, sigCount, sigTotal: Object.keys(sigCount).length,
    sideTotalLinks: sideLinks.length,
    sideVisibleLinks: sideVisible,
    sideDetails,
    treeLeafUnique: leafSet.size,
    treeLeafAlsoInSidebar: dup,
    treeLeafDupPct: Math.round((dup / leafSet.size) * 1000) / 10,
    h1Size: document.querySelector('h1') ? cs(document.querySelector('h1'), 'fontSize') : null,
    h2Size: document.querySelector('.article h2') ? cs(document.querySelector('.article h2'), 'fontSize') : null,
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), data: {}, errors: [] };
  for (const vp of [{ name: '1440x900', width: 1440, height: 900 }, { name: '390x844', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.goto('http://127.0.0.1:8787/', { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(300);
      out.data[vp.name] = await page.evaluate(PROBE);
    } catch (e) { out.errors.push({ vp: vp.name, err: String(e && e.message) }); }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  for (const [k, d] of Object.entries(out.data)) {
    console.log(`[${k}] cards=${d.cards.length} distinctCssSignatures=${d.sigTotal} h1=${d.h1Size} h2=${d.h2Size}`);
    console.log(`  sideLinks total=${d.sideTotalLinks} visible=${d.sideVisibleLinks} details=${JSON.stringify(d.sideDetails)}`);
    console.log(`  treeLeaf unique=${d.treeLeafUnique} alsoInSidebar=${d.treeLeafAlsoInSidebar} (${d.treeLeafDupPct}%)`);
    console.log('  sigCount=' + JSON.stringify(d.sigCount, null, 1));
  }
})().catch((e) => { console.error(e); process.exit(1); });
