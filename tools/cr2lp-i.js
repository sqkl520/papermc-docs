'use strict';
/**
 * cr2lp-i.js — 收尾核对（只读）：
 *  1) 390/320 下侧栏是否为 off-canvas（x<0），首页目录树与侧栏抽屉的重复在移动端意味着什么
 *  2) /paper/index.html 是否又是同一棵树（三次重复：侧栏 → 首页 → 分区页）
 *  3) 首页 fold 内是否有任何「具体教程标题」（如 Adding plugins）可见
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-i.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

function R(el) { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }

function PROBE_HOME() {
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const side = document.querySelector('.sidebar');
  const vh = window.innerHeight;
  const sb = side ? R(side) : null;
  const treeLeaves = [...document.querySelectorAll('a.src-link')].map((a) => txt(a));
  return {
    vw: window.innerWidth, vh,
    sidebar: sb,
    sidebarOffCanvas: sb ? (sb.x + sb.w <= 0 || sb.x < 0) : null,
    treeLeafTitles: treeLeaves.slice(0, 12),
    // fold 内可见的 src-link 标题
    foldLeafTitles: [...document.querySelectorAll('a.src-link')].filter((a) => R(a).y < vh).map((a) => txt(a)),
  };
}

function PROBE_SECTION() {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  return {
    url: location.href,
    title: document.title,
    srcLinks: document.querySelectorAll('a.src-link').length,
    tgHome: document.querySelectorAll('a.tg-home').length,
    h2s: [...document.querySelectorAll('.article h2')].map((h) => txt(h)),
    pageHeight: document.documentElement.scrollHeight,
    links: document.querySelectorAll('.article a[href]').length,
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), home: {}, section: {}, errors: [] };

  for (const vp of [{ name: '1440x900', width: 1440, height: 900 }, { name: '390x844', width: 390, height: 844 }, { name: '320x568', width: 320, height: 568 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.goto('http://127.0.0.1:8787/', { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(250);
      out.home[vp.name] = await page.evaluate(PROBE_HOME);
    } catch (e) { out.errors.push({ vp: vp.name, err: String(e && e.message) }); }
    await ctx.close();
  }

  // 分区页复用同一棵树？
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.goto('http://127.0.0.1:8787/paper/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(250);
    out.section.paper = await page.evaluate(PROBE_SECTION);
    await page.goto('http://127.0.0.1:8787/all-pages.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(250);
    out.section.allpages = await page.evaluate(PROBE_SECTION);
  } catch (e) { out.errors.push({ section: true, err: String(e && e.message) }); }
  await ctx.close();

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  for (const [k, v] of Object.entries(out.home)) {
    console.log(`[home ${k}] sidebar=${JSON.stringify(v.sidebar)} offCanvas=${v.sidebarOffCanvas} foldLeafTitles=${JSON.stringify(v.foldLeafTitles)}`);
  }
  console.log('[paper/index.html] ' + JSON.stringify(out.section.paper));
  console.log('[all-pages.html] ' + JSON.stringify(out.section.allpages));
})().catch((e) => { console.error(e); process.exit(1); });
