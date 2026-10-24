'use strict';
/**
 * b1s-drift.js — 冲突 1 续：钉死「开抽屉位移」的机理与量级
 *
 * b1-verify 报 +27/次（起点 1600）；我此前深滚（55% ≈15889）测到 +326/次。
 * 本探针回答三件事：
 *   1. 位移是否随滚动深度增长（→ 说明是 reflow，不是固定偏移）
 *   2. 开抽屉瞬间 clientWidth / scrollHeight / 各区块 docTop 怎么变
 *   3. 候选因子逐个置空：scrollbar-gutter / body overflow / sidebar position / 遮罩
 * 另附 Escape 关闭行为（8787 vs 8788）与焦点归位。
 * 只读站点；写 <tmp>\b1s\drift.json。用法: node tools/b1s-drift.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(process.env.TEMP || '.', 'b1s');
fs.mkdirSync(TMP, { recursive: true });
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const PAGE = '/paper/dev/particles/index.html';
const log = (o) => console.log(JSON.stringify(o));

const snap = () => {
  const html = document.documentElement;
  const tb = document.getElementById('nav-toggle');
  const side = document.querySelector('.sidebar');
  const art = document.querySelector('article') || document.querySelector('main');
  return {
    y: Math.round(window.scrollY),
    clientW: html.clientWidth, innerW: window.innerWidth,
    scrollH: html.scrollHeight,
    gutterComputed: getComputedStyle(html).scrollbarGutter,
    navLocked: html.classList.contains('nav-locked'),
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyPadR: getComputedStyle(document.body).paddingRight,
    artW: art ? +art.getBoundingClientRect().width.toFixed(2) : null,
    artDocTop: art ? +(art.getBoundingClientRect().top + window.scrollY).toFixed(2) : null,
    sidePos: side ? getComputedStyle(side).position : null,
    sideW: side ? +side.getBoundingClientRect().width.toFixed(2) : null,
    htmlStyleAttr: html.getAttribute('style'),
    bodyStyleAttr: document.body.getAttribute('style'),
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { depth: [], mech: [], escape: [], toggleBox: [] };

  // ---------- 1. 位移 vs 滚动深度（new, 390） ----------
  for (const tag of ['new', 'old']) {
    const base = tag === 'new' ? NEW : OLD;
    for (const frac of [0.02, 0.1, 0.25, 0.5, 0.75, 0.95]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.evaluate((f) => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * f)), frac);
      await page.waitForTimeout(350);
      const y0 = await page.evaluate(() => Math.round(window.scrollY));
      const s0 = await page.evaluate(snap);
      const tb = await page.evaluate(() => { const t = document.getElementById('nav-toggle'); const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await page.mouse.click(tb.x, tb.y);
      await page.waitForTimeout(450);
      const s1 = await page.evaluate(snap);
      await page.mouse.click(tb.x, tb.y);
      await page.waitForTimeout(450);
      const s2 = await page.evaluate(snap);
      const rec = { tag, vp: '390x844', frac, y0, openY: s1.y, closeY: s2.y, dOpen: s1.y - y0, dClose: s2.y - s1.y, net: s2.y - y0, s0, s1, s2 };
      out.depth.push(rec);
      log({ m: 'DEPTH', tag, frac, y0, dOpen: rec.dOpen, dClose: rec.dClose, net: rec.net, cw: [s0.clientW, s1.clientW, s2.clientW], scrollH: [s0.scrollH, s1.scrollH, s2.scrollH], artW: [s0.artW, s1.artW, s2.artW], artTop: [s0.artDocTop, s1.artDocTop, s2.artDocTop], gutter: [s0.gutterComputed, s1.gutterComputed, s2.gutterComputed], sidePos: s1.sidePos });
      await ctx.close();
    }
  }

  // ---------- 2. 候选因子置空（390, deep） ----------
  const variants = [
    ['as-is', null],
    ['no-gutter-on-locked', 'html.nav-locked{scrollbar-gutter:auto !important}'],
    ['gutter-stable-always', 'html{scrollbar-gutter:stable !important}'],
    ['no-body-overflow-hidden', 'html.nav-locked body{overflow:visible !important}'],
    ['sidebar-static', '.sidebar{position:static !important;transform:none !important}'],
    ['no-scrim', '.nav-scrim{display:none !important}'],
    ['no-toc-sticky', '.toc-side{position:static !important}'],
  ];
  for (const [vName, css] of variants) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    if (css) await page.addStyleTag({ content: css });
    await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.5)));
    await page.waitForTimeout(350);
    const y0 = await page.evaluate(() => Math.round(window.scrollY));
    const tb = await page.evaluate(() => { const t = document.getElementById('nav-toggle'); const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    const s0 = await page.evaluate(snap);
    await page.mouse.click(tb.x, tb.y);
    await page.waitForTimeout(450);
    const s1 = await page.evaluate(snap);
    await page.mouse.click(tb.x, tb.y);
    await page.waitForTimeout(450);
    const s2 = await page.evaluate(snap);
    const rec = { variant: vName, y0, dOpen: s1.y - y0, dClose: s2.y - s1.y, net: s2.y - y0, s0, s1, s2 };
    out.mech.push(rec);
    log({ m: 'MECH', variant: vName, dOpen: rec.dOpen, dClose: rec.dClose, net: rec.net, cw: [s0.clientW, s1.clientW, s2.clientW], scrollH: [s0.scrollH, s1.scrollH, s2.scrollH], artW: [s0.artW, s1.artW, s2.artW], bodyOverflow: [s0.bodyOverflow, s1.bodyOverflow] });
    await ctx.close();
  }

  // ---------- 3. Escape 关闭行为 + 焦点归位（8787 vs 8788） ----------
  for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
    for (const vp of [['390x844', 390, 844], ['768x1024', 768, 1024]]) {
      const ctx = await browser.newContext({ viewport: { width: vp[1], height: vp[2] }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.5)));
      await page.waitForTimeout(300);
      const tb = await page.evaluate(() => { const t = document.getElementById('nav-toggle'); const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; });
      const y0 = await page.evaluate(() => Math.round(window.scrollY));
      await page.mouse.click(tb.x, tb.y);
      await page.waitForTimeout(400);
      const opened = await page.evaluate(() => ({ navOpen: document.body.classList.contains('nav-open'), ariaExpanded: (document.getElementById('nav-toggle') || {}).getAttribute ? document.getElementById('nav-toggle').getAttribute('aria-expanded') : null, y: Math.round(window.scrollY) }));
      // 焦点进入抽屉：Tab 一次
      await page.keyboard.press('Tab');
      const focusIn = await page.evaluate(() => ({ tag: document.activeElement && document.activeElement.tagName, cls: document.activeElement && document.activeElement.className, inDrawer: !!(document.activeElement && document.activeElement.closest('.sidebar')) }));
      const yBeforeEsc = await page.evaluate(() => Math.round(window.scrollY));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(450);
      const after = await page.evaluate(() => ({
        navOpen: document.body.classList.contains('nav-open'),
        ariaExpanded: document.getElementById('nav-toggle') ? document.getElementById('nav-toggle').getAttribute('aria-expanded') : null,
        focusTag: document.activeElement && document.activeElement.tagName,
        focusId: document.activeElement && document.activeElement.id,
        focusCls: document.activeElement && document.activeElement.className,
        y: Math.round(window.scrollY),
      }));
      const rec = { tag, vp: vp[0], toggle: tb, y0, opened, focusIn, yBeforeEsc, after, dEsc: after.y - yBeforeEsc };
      out.escape.push(rec);
      log({ m: 'ESC', tag, vp: vp[0], toggle: tb, opened, focusIn, after, dEsc: rec.dEsc });
      await ctx.close();
    }
  }

  // ---------- 4. toggle 命中区/可见性（两树对照，供 P0-3 参考） ----------
  for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(base + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const t = document.getElementById('nav-toggle');
      if (!t) return null;
      const b = t.getBoundingClientRect();
      return { w: +b.width.toFixed(2), h: +b.height.toFixed(2), display: getComputedStyle(t).display, minW: getComputedStyle(t).minWidth, minH: getComputedStyle(t).minHeight };
    });
    out.toggleBox.push({ tag, r });
    log({ m: 'TOGGLE', tag, r });
    await ctx.close();
  }

  fs.writeFileSync(path.join(TMP, 'drift.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE ' + path.join(TMP, 'drift.json'));
  await browser.close();
})();
