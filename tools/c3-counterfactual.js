'use strict';
/**
 * c3-counterfactual.js — 证明「JS 阈值必须与 CSS 同源」（只读，内存改写 site.js）
 *
 * 变体（CSS 一律用改后产物，只改 JS 响应体）：
 *   jsnew   无改写（改后 JS：1200）                      → 期望 coveredPct = 0
 *   js1025  把 syncToc 的 matchMedia 与 syncTocOffset 的 innerWidth 退回 1025
 *           （= 只改 CSS 不改 JS 的「半改」状态）          → 期望 coveredPct > 0
 *
 * 判定口径与 c3-anchor.js 完全一致：点目录第 2 项 → 900ms 落定 → 量标题被吸顶元素覆盖比例。
 *
 * 用法：node tools/c3-counterfactual.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/dialogs/';
const TMP = path.join(os.tmpdir(), 'c3');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* 把改后 JS 的 1200 退回 1025（只动 TOC 相关两处；drawer 的 1200 保留，避免整站行为错乱） */
function revertTocTo1025(src) {
  return src
    .replace("matchMedia('(min-width:1200px)') : null", "matchMedia('(min-width:1025px)') : null")
    .replace('window.innerWidth >= 1200', 'window.innerWidth >= 1025')
    .replace('window.innerWidth < 1200', 'window.innerWidth < 1025');
}

/* 精准反事实：**只**把 syncTocOffset 的 innerWidth 判定退回 1025，
   syncToc（强制展开）与 CSS 全部保持改后的 1200。
   → 1025–1199 的 TOC 是折叠的 61px 吸顶条（tocOpen=false），但不计 --toc-offset
     → scroll-padding-top 只剩顶栏 68px，落点 68 < 吸顶条底 117 → 标题被盖。 */
function onlyOffsetBackTo1025(src) {
  return src.replace('window.innerWidth < 1200', 'window.innerWidth < 1025');
}

/* 对照：只把 syncToc 退回 1025（offset 保持 1200）→ 展开成 static 面板 */
function onlySyncTocBackTo1025(src) {
  return src
    .replace("matchMedia('(min-width:1200px)') : null", "matchMedia('(min-width:1025px)') : null")
    .replace('window.innerWidth >= 1200', 'window.innerWidth >= 1025');
}

const MEASURE_COVER = () => {
  const q = (s) => document.querySelector(s);
  const vis = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
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
      const top = Math.max(tr.top, c.r.top), bot = Math.min(tr.bottom, c.r.bottom);
      const left = Math.max(tr.left, c.r.left), right = Math.min(tr.right, c.r.right);
      if (bot > top && right > left) {
        const hh = bot - top;
        coverH = Math.max(coverH, hh);
        detail.push(c.name + '=' + Math.round(hh * 10) / 10);
      }
    }
  }
  return {
    coveredPct: tr && tr.height > 0 ? Math.round((Math.min(coverH, tr.height) / tr.height) * 1000) / 10 : null,
    headingTop: tr ? Math.round(tr.top * 10) / 10 : null,
    tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    tocPos: toc ? getComputedStyle(toc).position : null,
    tocOpen: toc ? !!(toc.classList.contains('toc-open') || toc.querySelector('.toc-fold[open]')) : null,
    tocBox: toc ? (() => { const r = toc.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.x) + ',' + Math.round(r.y); })() : null,
    coverDetail: detail,
  };
};

const settle = async (page, n) => {
  await page.evaluate((k) => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= k) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n);
};

async function run(browser, name, jsFn, widths) {
  const res = [];
  for (const w of widths) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: 900 }, deviceScaleFactor: 1,
      colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
    });
    if (jsFn) {
      await ctx.route('**/assets/site.js', async (route) => {
        const r = await route.fetch();
        return route.fulfill({ status: r.status(), headers: r.headers(), body: jsFn(await r.text()) });
      });
    }
    const page = await ctx.newPage();
    await page.goto(BASE + PAGE, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(150);
    await settle(page, 2);
    const pick = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.toc-side a[href^="#"]')]
        .filter((a) => getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().height > 0);
      if (links.length < 2) return null;
      return { href: links[1].getAttribute('href') };
    });
    let rec = { vw: w, href: pick && pick.href };
    if (pick) {
      await page.evaluate((href) => {
        const a = [...document.querySelectorAll('.toc-side a[href="' + href + '"]')][0];
        if (a) a.click();
      }, pick.href);
      await page.waitForTimeout(1400);
      await settle(page, 3);
      rec = Object.assign(rec, await page.evaluate(MEASURE_COVER));
    }
    res.push(rec);
    await ctx.close();
  }
  return { variant: name, rows: res };
}

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  let out = [];
  try {
    const WS = [1025, 1100, 1199];
    out.push(await run(browser, 'jsnew(1200)', null, WS));
    out.push(await run(browser, '仅syncToc回1025', onlySyncTocBackTo1025, WS));
    out.push(await run(browser, '仅offset回1025', onlyOffsetBackTo1025, WS));
    out.push(await run(browser, '两处都回1025', revertTocTo1025, WS));
  } finally {
    await browser.close();
  }
  console.log('=== 反事实：CSS 已改 1200，JS 退回 1025（"只改 CSS 不改 JS"）===');
  console.log('variant        vw     coveredPct  headingTop  --toc-offset  tocPos   tocOpen  tocBox');
  for (const v of out) {
    for (const r of v.rows) {
      console.log(v.variant.padEnd(15) + String(r.vw).padEnd(7) + String(r.coveredPct).padEnd(12)
        + String(r.headingTop).padEnd(12) + String(r.tocOffset).padEnd(14)
        + String(r.tocPos).padEnd(9) + String(r.tocOpen).padEnd(9) + String(r.tocBox));
    }
  }
  const f = path.join(TMP, 'counterfactual.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');
  console.log('\nWROTE ' + f);
})().catch((e) => { console.error(e); process.exit(1); });
