'use strict';
/**
 * cr2cp-batch.js — 核对批 1/2/3 对内容页阅读的实际效果 + 断点无死区验证。
 * 只读，不写站点产物。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2cp');
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const GEO = () => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const art = document.querySelector('article.article');
  const h1 = document.querySelector('article h1, .page-head h1');
  const toc = document.querySelector('.toc-side');
  const side = document.querySelector('.sidebar');
  const tocTitle = toc ? toc.querySelector('.toc-title') : null;
  const tocLink = toc ? toc.querySelector('a[href^="#"]') : null;
  const sideLink = side ? side.querySelector('a[href]') : null;
  const crumbA = document.querySelector('nav.crumbs a');
  const pagerA = document.querySelector('nav.pager a');
  const codeEl = document.querySelector('.code-block pre, .code-block code, pre code');

  // 正文实际文本宽度（量一段 p 的宽度）
  const pEl = art ? art.querySelector('p') : null;
  const pRect = R(pEl);

  // 代码行推进：若有多行代码块，量两行基线差
  let codeLineAdvance = null; let codeFontSize = null; let codeLH = null;
  if (codeEl) {
    const cs = getComputedStyle(codeEl);
    codeFontSize = cs.fontSize; codeLH = cs.lineHeight;
    const lh = parseFloat(cs.lineHeight);
    if (!isNaN(lh)) codeLineAdvance = +lh.toFixed(1);
    else if (cs.lineHeight === 'normal') codeLineAdvance = +(parseFloat(cs.fontSize) * 1.2).toFixed(1);
  }

  return {
    vw: window.innerWidth,
    sidebarVisible: vis(side), sidebarRect: R(side),
    tocVisible: vis(toc), tocRect: R(toc),
    tocOpen: toc ? (() => { const f = toc.querySelector('.toc-fold'); return f ? f.hasAttribute('open') : null; })() : null,
    tocTitleRect: R(tocTitle), tocTitleHs: tocTitle ? Math.round(tocTitle.getBoundingClientRect().height) : null,
    tocLinkH: tocLink ? Math.round(tocLink.getBoundingClientRect().height) : null,
    sideLinkH: sideLink ? Math.round(sideLink.getBoundingClientRect().height) : null,
    crumbLinkH: crumbA ? Math.round(crumbA.getBoundingClientRect().height) : null,
    pagerLinkH: pagerA ? Math.round(pagerA.getBoundingClientRect().height) : null,
    h1Y: h1 ? Math.round(h1.getBoundingClientRect().top + window.scrollY) : null,
    articleW: pRect ? pRect.w : null,
    // 正文列：以 p 文本宽度为准，并算 ch
    chPx: (() => { if (!pEl) return null; const cs = getComputedStyle(pEl); const sp = document.createElement('span'); sp.textContent = '0'.repeat(50); sp.style.font = cs.font; sp.style.position = 'absolute'; sp.style.visibility = 'hidden'; document.body.appendChild(sp); const w = sp.getBoundingClientRect().width / 50; document.body.removeChild(sp); return +w.toFixed(2); })(),
    codeFontSize, codeLH, codeLineAdvance,
    mainW: R(document.querySelector('#main')) ? R(document.querySelector('#main')).w : null,
  };
};

async function run() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const res = { breakpoints: [], batch: {}, batch2: {}, batch3: {} };

  // ---- 断点扫描（1200 前后是否有死区）----
  for (const w of [1024, 1100, 1199, 1200, 1201, 1280, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const g = await page.evaluate(GEO);
    res.breakpoints.push({ w, sidebar: g.sidebarVisible, toc: g.tocVisible, tocOpen: g.tocOpen, tocW: g.tocRect ? g.tocRect.w : 0, sideW: g.sidebarRect ? g.sidebarRect.w : 0, articleW: g.articleW, mainW: g.mainW, h1Y: g.h1Y, tocTitleH: g.tocTitleHs, tocLinkH: g.tocLinkH });
    await ctx.close();
  }

  // ---- 批 1：移动端 TOC 折叠 + 吸顶 ----
  for (const vp of [{ w: 390, h: 844 }, { w: 768, h: 1024 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.w < 500, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const scrollProbe = async (y) => {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(350);
      return page.evaluate(() => {
        const toc = document.querySelector('.toc-side');
        if (!toc) return null;
        const r = toc.getBoundingClientRect();
        const cs = getComputedStyle(toc);
        const t = toc.querySelector('.toc-title');
        return { scrollY: Math.round(window.scrollY), top: Math.round(r.top), h: Math.round(r.height), position: cs.position, stickyTop: cs.top, titleH: t ? Math.round(t.getBoundingClientRect().height) : null, open: toc.querySelector('.toc-fold') ? toc.querySelector('.toc-fold').hasAttribute('open') : null };
      });
    };
    const key = vp.w + 'x' + vp.h;
    res.batch[key] = { at0: await scrollProbe(0), at600: await scrollProbe(600), at3000: await scrollProbe(3000) };
    // 折叠条整行可点？（点标题右侧空白是否也能开）
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    res.batch[key].rowClickable = await page.evaluate(() => {
      const t = document.querySelector('.toc-side .toc-title');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(r.right - 6), Math.round(r.top + r.height / 2));
      return { hitTag: el ? el.tagName.toLowerCase() : null, hitInSummary: !!(el && el.closest('.toc-title')), width: Math.round(r.width) };
    });
    await ctx.close();
  }

  // ---- 批 2：代码 strut（改前 vs 改后）----
  for (const [label, base] of [['pre', OLD], ['post', NEW]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    res.batch2[label] = await page.evaluate(() => {
      // 找行数 >=8 的代码块，量首末行的 y 差
      const blocks = [...document.querySelectorAll('.code-block pre, pre')].map((pre) => {
        const lines = [...pre.querySelectorAll('.line, span[class*="line"]')];
        const txt = pre.textContent || '';
        const n = txt.split('\n').length;
        const r = pre.getBoundingClientRect();
        const cs = getComputedStyle(pre);
        return { n, h: Math.round(r.height), lh: cs.lineHeight, fs: cs.fontSize, advance: n > 2 ? +((r.height) / n).toFixed(2) : null, wrapped: lines.length };
      }).filter((b) => b.n >= 6).sort((a, b) => b.n - a.n).slice(0, 3);
      return { blocks, codeBlockCount: document.querySelectorAll('.code-block').length };
    });
    await ctx.close();
  }

  // ---- 批 3：列宽 / ch ----
  for (const [label, base] of [['pre', OLD], ['post', NEW]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const g = await page.evaluate(GEO);
    res.batch3[label] = { articleW: g.articleW, mainW: g.mainW, chPx: g.chPx, ch: g.chPx ? Math.round(g.articleW / g.chPx) : null };
    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, 'batch.json'), JSON.stringify(res, null, 1), 'utf8');
  const L = (s) => console.log(s);
  L('==== 断点扫描 (dialogs) ====');
  L('  w      sidebar  toc   tocOpen  tocW  sideW  mainW  artW  tocTitleH tocLinkH');
  res.breakpoints.forEach((b) => L('  ' + String(b.w).padEnd(6) + ' ' + String(b.sidebar).padEnd(8) + ' ' + String(b.toc).padEnd(5) + ' ' + String(b.tocOpen).padEnd(8) + ' ' + String(b.tocW).padEnd(5) + ' ' + String(b.sideW).padEnd(6) + ' ' + String(b.mainW).padEnd(6) + ' ' + String(b.articleW).padEnd(5) + ' ' + String(b.tocTitleH).padEnd(9) + ' ' + b.tocLinkH));
  L('\n==== 批1 移动端 TOC ====');
  L(JSON.stringify(res.batch, null, 1));
  L('\n==== 批2 代码 strut ====');
  L(JSON.stringify(res.batch2, null, 1));
  L('\n==== 批3 列宽 ====');
  L(JSON.stringify(res.batch3, null, 1));
  L('\nJSON -> ' + path.join(OUT, 'batch.json'));
}
run().catch((e) => { console.error('FAIL', e); process.exit(1); });
