'use strict';
/**
 * c3-anchor.js — 批 3 的**锚点遮挡**硬判据 + 横向溢出扫描（只读）
 *
 * 为什么必须单测：批 3 把桌面线从 1024/1025 搬到 1200，若只改 CSS 不改 JS，
 * 1025–1199 会出现「TOC 仍是吸顶折叠条、但 syncToc 已强制它 open 成 static 大面板」
 * 或「不计 --toc-offset」的组合 —— 批 1 修好的「点目录跳转 → 标题被盖住」静默复现。
 * 本脚本在改后产物上逐档点目录第 2 项，量标题被顶栏/TOC 覆盖的百分比。
 *
 * 判据：coveredPct（标题矩形被 fixed/sticky 祖先遮挡的比例）= 0。
 *
 * 用法：
 *   node tools/c3-anchor.js                 # 锚点档 1025/1100/1199 + 溢出 8 档 × 6 页
 *   node tools/c3-anchor.js --only=anchor
 *   node tools/c3-anchor.js --only=overflow
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const TMP = path.join(os.tmpdir(), 'c3');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const p = '--' + n + '=';
  const h = argv.find((a) => a.startsWith(p));
  return h ? h.slice(p.length) : d;
};
const ONLY = opt('only', 'all');

const ANCHOR_VPS = [1025, 1100, 1199, 1200, 1440];
const PAGE = '/paper/dev/dialogs/';

/* 6 页 × 8 档（与验收表 #7 一致） */
const OV_PAGES = ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html'];
const OV_VPS = [320, 390, 768, 1024, 1100, 1199, 1200, 1440];

/* 遮挡测量：点目录第 2 项 → 等落定 → 量目标标题被「吸顶元素」覆盖的比例。
   覆盖判定用真实几何交集，逐条与顶栏 / .toc-side 的可见矩形求交。 */
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
  /* 吸顶遮挡物：顶栏 + 处于 sticky/fixed 的 TOC */
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
      const top = Math.max(tr.top, c.r.top);
      const bot = Math.min(tr.bottom, c.r.bottom);
      const left = Math.max(tr.left, c.r.left);
      const right = Math.min(tr.right, c.r.right);
      if (bot > top && right > left) {
        const hh = bot - top;
        coverH = Math.max(coverH, hh);
        detail.push(c.name + '=' + Math.round(hh * 10) / 10);
      }
    }
  }
  const coveredPct = tr && tr.height > 0 ? Math.round((Math.min(coverH, tr.height) / tr.height) * 1000) / 10 : null;
  return {
    hash: h, headingFound: !!target,
    headingTop: tr ? Math.round(tr.top * 10) / 10 : null,
    headingH: tr ? Math.round(tr.height * 10) / 10 : null,
    coveredPct, coverDetail: detail,
    scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
    tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    tocPos: toc ? getComputedStyle(toc).position : null,
    tocOpen: toc ? (toc.classList.contains('toc-open') || !!toc.querySelector('.toc-fold[open]')) : null,
    tocDisplay: toc ? getComputedStyle(toc).display : null,
    tocBox: toc ? (() => { const r = toc.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.x) + ',' + Math.round(r.y); })() : null,
    topbarH: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
  };
};

const OV_MEASURE = () => ({
  hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  innerW: window.innerWidth,
  clientWBody: document.body ? document.body.clientWidth : null,
});

const settle = async (page, n) => {
  await page.evaluate((k) => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= k) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n == null ? 2 : n);
};

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { anchor: [], anchorFail: [], overflow: [], overflowFail: [] };
  try {
    if (ONLY === 'all' || ONLY === 'anchor') {
      for (const w of ANCHOR_VPS) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: 900 }, deviceScaleFactor: 1,
          colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
        });
        const page = await ctx.newPage();
        await page.goto(BASE + PAGE, { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(150);
        await settle(page, 2);
        /* 目录里第 2 项（TOC 序号意义上的第二条链接，排除文档首条 H1 自锚） */
        const pick = await page.evaluate(() => {
          const links = [...document.querySelectorAll('.toc-side a[href^="#"]')]
            .filter((a) => { const cs = getComputedStyle(a); return cs.display !== 'none' && a.getBoundingClientRect().height > 0; });
          if (links.length < 2) return null;
          const a = links[1];
          return { href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 40), total: links.length };
        });
        let rec = { vw: w, picked: pick };
        if (pick) {
          await page.evaluate((href) => {
            const a = [...document.querySelectorAll('.toc-side a[href="' + href + '"]')][0];
            if (a) a.click();
          }, pick.href);
          /* 等平滑滚动 + correctAfterSmooth 落定 */
          await page.waitForTimeout(1400);
          await settle(page, 3);
          rec = Object.assign(rec, await page.evaluate(MEASURE_COVER));
        }
        out.anchor.push(rec);
        if (!pick) out.anchorFail.push(w + ' 无第 2 项目录链接');
        else if (rec.coveredPct !== 0) out.anchorFail.push(w + ' coveredPct=' + rec.coveredPct + ' (' + rec.coverDetail.join(',') + ')');
        await ctx.close();
      }
      console.log('=== 锚点遮挡（点目录第 2 项；coveredPct 必须 = 0）===');
      console.log('vw    hash                        coveredPct  headingTop  scrollPad  --toc-offset  tocPos   tocOpen  tocBox');
      for (const r of out.anchor) {
        console.log(String(r.vw).padEnd(6) + String(r.hash || '-').slice(0, 28).padEnd(28)
          + String(r.coveredPct).padEnd(12) + String(r.headingTop).padEnd(12)
          + String(r.scrollPaddingTop).padEnd(11) + String(r.tocOffset).padEnd(14)
          + String(r.tocPos).padEnd(9) + String(r.tocOpen).padEnd(9) + r.tocBox);
      }
      console.log(out.anchorFail.length ? 'ANCHOR FAIL: ' + out.anchorFail.join(' ; ') : 'ANCHOR: 全部 coveredPct=0');
    }

    if (ONLY === 'all' || ONLY === 'overflow') {
      for (const w of OV_VPS) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: 900 }, deviceScaleFactor: 1,
          colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
        });
        const page = await ctx.newPage();
        for (const p of OV_PAGES) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.goto(BASE + p, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(90);
          await settle(page, 2);
          const m = await page.evaluate(OV_MEASURE);
          out.overflow.push(Object.assign({ vw: w, page: p }, m));
          if (m.hOverflow > 0) out.overflowFail.push(w + ' ' + p + ' hOverflow=' + m.hOverflow);
        }
        await ctx.close();
      }
      console.log('\n=== 横向溢出（8 档 × 6 页，hOverflow 必须 = 0）===');
      const byVp = {};
      for (const r of out.overflow) {
        byVp[r.vw] = byVp[r.vw] || [];
        byVp[r.vw].push(r.hOverflow);
      }
      for (const w of OV_VPS) console.log('  ' + String(w).padEnd(6) + 'max=' + Math.max(...byVp[w]) + '  per-page=[' + byVp[w].join(',') + ']');
      console.log('组合数=' + out.overflow.length + '  非零=' + out.overflowFail.length);
      console.log(out.overflowFail.length ? 'OVERFLOW FAIL: ' + out.overflowFail.join(' ; ') : 'OVERFLOW: 全部 0');
    }
  } finally {
    await browser.close();
  }
  const f = path.join(TMP, 'anchor.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');
  console.log('\nWROTE ' + f);
  process.exit(out.anchorFail.length || out.overflowFail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
