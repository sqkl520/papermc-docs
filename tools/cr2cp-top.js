'use strict';
/**
 * cr2cp-top.js — 生成「内容页顶部 400px 元素清单」（去嵌套、按 y 归并）+ 确认 1024–1199 侧栏是否真在屏外。
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

const BAND = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const rows = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (['html', 'body', 'script', 'style'].includes(tag)) continue;
    const r = el.getBoundingClientRect();
    const top = Math.round(r.top + window.scrollY);
    if (top >= 400) continue;
    // 只保留「叶子级」可见元素：跳过只用来包住的容器（内部还有同类的可见子元素）
    const hasVisChild = [...el.children].some((c) => vis(c) && c.getBoundingClientRect().width > 0);
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const isUnit = /^(a|button|input|summary|h1|h2|h3|h4|h5|h6|img|kbd|nav|aside|header|main|details|p)$/.test(tag);
    if (hasVisChild && !/^(nav|aside|header|main|details)$/.test(tag)) continue;
    if (!ownText && !isUnit) continue;
    const key = top + '|' + Math.round(r.height) + '|' + tag + '|' + (el.getAttribute('class') || '');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      y: top, h: Math.round(r.height), w: Math.round(r.width), tag,
      cls: (el.getAttribute('class') || '').split(/\s+/).slice(0, 2).join(' '),
      zone: el.closest('nav.crumbs') ? '面包屑' : el.closest('.topbar') ? '顶栏' : el.closest('.toc-side') ? '右栏TOC'
        : el.closest('.sidebar') ? '侧栏' : el.closest('article') ? '正文' : '其他',
      text: (ownText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    });
  }
  rows.sort((a, b) => a.y - b.y);
  return { rows, count: rows.length };
};

const SIDE = () => {
  const sb = document.querySelector('.sidebar');
  const t = document.querySelector('#nav-toggle');
  const r = sb ? sb.getBoundingClientRect() : null;
  const cs = sb ? getComputedStyle(sb) : null;
  return {
    vw: window.innerWidth,
    sidebar: r ? { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width), pos: cs.position, transform: cs.transform, visibleOnScreen: r.x < window.innerWidth - 1 && r.right > 1 } : null,
    navToggleVisible: t ? t.getBoundingClientRect().width > 0 : false,
    tocTop: (() => { const e = document.querySelector('.toc-side'); return e ? Math.round(e.getBoundingClientRect().top + window.scrollY) : null; })(),
    tocW: (() => { const e = document.querySelector('.toc-side'); return e ? Math.round(e.getBoundingClientRect().width) : null; })(),
    mainW: (() => { const e = document.querySelector('#main'); return e ? Math.round(e.getBoundingClientRect().width) : null; })(),
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

async function run() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { band: {}, sidebar: {} };

  for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.w < 500, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    out.band[vp.w] = await page.evaluate(BAND);
    await ctx.close();
  }

  for (const w of [1024, 1100, 1199, 1200]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    out.sidebar[w] = await page.evaluate(SIDE);
    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, 'top.json'), JSON.stringify(out, null, 1), 'utf8');

  const L = (s) => console.log(s);
  L('==== 1024–1200 侧栏真实位置 ====');
  Object.keys(out.sidebar).forEach((w) => {
    const s = out.sidebar[w];
    L('  w=' + w + ' sidebar=' + JSON.stringify(s.sidebar) + ' toggle=' + s.navToggleVisible + ' tocTop=' + s.tocTop + ' tocW=' + s.tocW + ' mainW=' + s.mainW + ' hScroll=' + s.hScroll);
  });

  [1440, 390].forEach((vp) => {
    const b = out.band[vp];
    L('\n==== 顶部 400px 元素清单 @ ' + vp + ' (n=' + b.count + ') ====');
    L('  ' + 'y'.padStart(4) + ' ' + 'h'.padStart(4) + ' ' + 'w'.padStart(5) + '  ' + 'zone'.padEnd(9) + ' ' + 'tag.cls'.padEnd(34) + ' text');
    b.rows.forEach((r) => L('  ' + String(r.y).padStart(4) + ' ' + String(r.h).padStart(4) + ' ' + String(r.w).padStart(5) + '  ' + r.zone.padEnd(9) + ' ' + (r.tag + '.' + r.cls).slice(0, 34).padEnd(34) + ' ' + r.text));
  });
  L('\nJSON -> ' + path.join(OUT, 'top.json'));
}
run().catch((e) => { console.error('FAIL', e); process.exit(1); });
