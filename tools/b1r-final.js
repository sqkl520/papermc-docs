'use strict';
/**
 * b1r-final.js — 收尾取证：
 *   A. 逐条"撤销批 1 改动"看 pageHeight 是否变化 → 判定"不改几何"是否成立
 *   B. P1-3 渐隐条：scrollLeft=0 与滚到最右时，渐隐是否盖住末尾字符（截图 + 几何）
 *   C. P0-2：preventScroll 关闭时 scrollTo 是否变成平滑动画（时间采样）
 *   D. P0-4：行内摘要 hit-test / 长按行为代理
 * 用法: node tools/b1r-final.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'reports', 'b1r-shots');
const LOGP = path.join(ROOT, 'reports', '.b1r-final.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';

function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { undo: {}, fade: {}, guard: {}, stretch: {} };

  // ================= A. 撤销矩阵 =================
  const UNDOS = {
    'undoP0-3_codecopy28': '.code-copy{min-height:44px !important;min-width:44px !important}',
    'undoP0-3_sidehome24': '.side-group-title a.side-home{min-height:21px !important}',
    'undoP1-5_650': '.alert-title{font-weight:650 !important}',
    'undoP0-4_stretch': '.src-item .src-link::after{content:none !important}',
    'undoP0-1_tocmaxh': '.toc-fold[open]>ol{max-height:none !important;overflow-y:visible !important}',
    'undoP0-1_sticky': '.toc-side{position:static !important;z-index:auto !important}',
  };
  for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1280x800', w: 1280, h: 800 }, { n: '1025x800', w: 1025, h: 800 }, { n: '768x1024', w: 768, h: 1024 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of ['/paper/dev/particles/', '/paper/reference/world-configuration/', '/paper/dev/dialogs/']) {
      await page.goto(NEW + u, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const base = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      const row = { page: u, base };
      for (const [k, css] of Object.entries(UNDOS)) {
        const tag = await page.addStyleTag({ content: css });
        await page.waitForTimeout(140);
        row[k] = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
        await page.evaluate((el) => el.remove(), tag);
        await page.waitForTimeout(80);
      }
      await page.goto(OLD + u, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      row.oldBuild = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      row.deltaVsOld = row.base - row.oldBuild;
      out.undo[vp.n + '|' + u] = row;
      log('UNDO ' + vp.n + ' ' + u + ' ' + JSON.stringify(row));
    }
    await ctx.close();
  }

  // ================= B. P1-3 渐隐：位置取决于内容右边缘还是视口右边缘 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    // 找最长的溢出代码块
    const pick = await page.evaluate(() => {
      const arr = Array.from(document.querySelectorAll('.code-scroll[data-overflowing]'));
      if (!arr.length) return null;
      let best = arr[0], bi = 0;
      arr.forEach((e, i) => { if (e.scrollWidth / e.clientWidth > best.scrollWidth / best.clientWidth) { best = e; bi = i; } });
      best.scrollIntoView({ block: 'center', behavior: 'instant' });
      window.__pick = bi;
      window.__res = [];
      arr.forEach((e) => window.__res.push({ sw: e.scrollWidth, cw: e.clientWidth }));
      return { idx: bi, ratio: +(best.scrollWidth / best.clientWidth).toFixed(2), sw: best.scrollWidth, cw: best.clientWidth, total: arr.length };
    });
    await page.waitForTimeout(300);
    out.fade.meta = pick;
    log('FADE meta ' + JSON.stringify(pick));

    const readGeom = () => page.evaluate(() => {
      const e = document.querySelectorAll('.code-scroll')[window.__pick];
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e, '::after');
      const codeEl = e.querySelector('code');
      const cb = codeEl.getBoundingClientRect();
      // 末尾字符（code 内容最右端）
      return {
        scrollLeft: Math.round(e.scrollLeft), maxScroll: Math.round(e.scrollWidth - e.clientWidth),
        boxLeft: Math.round(b.left), boxRight: Math.round(b.right),
        afterPos: cs.position, afterWidth: cs.width, afterRight: cs.right, afterLeft: cs.left,
        afterTop: cs.top, afterBottom: cs.bottom, afterBg: (cs.backgroundImage || '').slice(0, 48),
        codeContentRight: Math.round(cb.right),
        // ::after 绝对定位在滚动容器内：用其左右 offset 判断是否随内容滚动
        afterInsetLeft: cs.insetLeft || cs.left, afterInsetRight: cs.insetRight || cs.right,
      };
    });
    out.fade.atLeft = await readGeom();
    log('FADE atLeft ' + JSON.stringify(out.fade.atLeft));

    // 滚到最右
    await page.evaluate(() => { const e = document.querySelectorAll('.code-scroll')[window.__pick]; e.scrollLeft = e.scrollWidth; });
    await page.waitForTimeout(300);
    out.fade.atRight = await readGeom();
    log('FADE atRight ' + JSON.stringify(out.fade.atRight));

    // 截图：左端与右端，右边缘 60px 放大
    const clipOf = async () => page.evaluate(() => {
      const e = document.querySelectorAll('.code-scroll')[window.__pick];
      const b = e.getBoundingClientRect();
      return { x: Math.max(0, b.right - 70), y: Math.max(0, b.top), width: 70, height: Math.min(120, b.height) };
    });
    await page.evaluate(() => { const e = document.querySelectorAll('.code-scroll')[window.__pick]; e.scrollLeft = 0; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, 'fade-scrollLeft0.png'), clip: await clipOf() });
    await page.evaluate(() => { const e = document.querySelectorAll('.code-scroll')[window.__pick]; e.scrollLeft = e.scrollWidth; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, 'fade-scrollMax.png'), clip: await clipOf() });
    await ctx.close();
  }

  // ================= C. P0-2：关闭抽屉时 scrollTo 是否平滑（时间采样） =================
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/adding-plugins/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    // 保留页面自带的 smooth（不注入 auto），测真实行为
    await page.evaluate(() => window.scrollTo(0, 6000));
    await page.waitForTimeout(1200);
    const y0 = await page.evaluate(() => Math.round(window.scrollY));
    await page.click('#nav-toggle');
    await page.waitForTimeout(500);
    const yOpen = await page.evaluate(() => Math.round(window.scrollY));
    // 关闭并高频采样 scrollY
    await page.evaluate(() => {
      window.__samples = [];
      const t0 = performance.now();
      window.__t0 = t0;
      const tick = () => {
        window.__samples.push([Math.round(performance.now() - t0), Math.round(window.scrollY)]);
        if (performance.now() - t0 < 700) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    const samples = await page.evaluate(() => window.__samples);
    const ys = samples.map((s) => s[1]);
    const distinct = Array.from(new Set(ys));
    out.guard = {
      yBeforeOpen: y0, yWhenOpen: yOpen,
      smoothSetting: await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
      sampleCount: samples.length,
      first: samples.slice(0, 6), last: samples.slice(-3),
      minY: Math.min(...ys), maxY: Math.max(...ys),
      distinctYCount: distinct.length,
      distinctYs: distinct.slice(0, 14),
      finalDelta: ys[ys.length - 1] - y0,
      animated: distinct.length > 3,
    };
    log('GUARD ' + JSON.stringify(out.guard));
    await ctx.close();
  }

  // ================= D. P0-4：行内文字长按/右键目标 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    // 关掉平滑滚动，保证 scrollIntoView 立即生效
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    const pt = await page.evaluate(() => {
      const item = document.querySelector('.src-item');
      item.scrollIntoView({ block: 'center' });
      const q = (s) => { const b = item.querySelector(s).getBoundingClientRect(); return { x: Math.round(b.left + Math.min(30, b.width / 2)), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) }; };
      const ib = item.getBoundingClientRect();
      return { sum: q('.src-sum'), rel: q('.src-rel'), link: q('.src-link'), blank: { x: Math.round(ib.right - 20), y: Math.round(ib.top + ib.height / 2) }, itemBox: { w: Math.round(ib.width), h: Math.round(ib.height) } };
    });
    await page.waitForTimeout(250);
    const res = {};
    for (const [k, p] of Object.entries(pt)) {
      if (!p || typeof p.x !== 'number') continue;
      res[k] = await page.evaluate((pp) => {
        const el = document.elementFromPoint(pp.x, pp.y);
        if (!el) return { hit: null, reason: 'outside viewport' };
        const a = el.closest ? el.closest('a') : null;
        return { hitTag: el.tagName, hitClass: String(el.className || ''), insideAnchor: !!a, anchorHref: a ? a.getAttribute('href') : null };
      }, p);
    }
    out.stretch = { points: pt, hits: res };
    log('STRETCH ' + JSON.stringify(out.stretch));
    await page.screenshot({ path: path.join(SHOTS, 'srcitem-row.png'), clip: await page.evaluate(() => { const b = document.querySelector('.src-item').getBoundingClientRect(); return { x: Math.max(0, Math.round(b.left) - 6), y: Math.max(0, Math.round(b.top) - 6), width: Math.min(1420, Math.round(b.width) + 12), height: Math.round(b.height) + 12 }; }) });
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-final.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE');
})();
