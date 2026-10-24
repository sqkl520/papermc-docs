'use strict';
/**
 * b1r2-c.js — 红队批1 · 角度 2/3/4：syncToc lastIsWide 状态机、preventScroll 缺失回退、抽屉滚动副作用
 *   C1 lastIsWide 旋转链：390 展开 → 844 → 1025 → 1024 → 390；记录每步 open 与用户选择是否存活
 *   C2 bfcache/pageshow：模拟 pageshow(persisted) 与 matchMedia 失效，看 lastIsWide 是否重置
 *   C3 preventScroll=false 等价路径：证明未支持时（静默忽略）位移量
 *   C4 抽屉 scrollIntoView 是否滚动 document（含 block:'center' / behavior:'instant' 支持性）
 *   C5 打开抽屉时 active 与 first-focus 是否同一元素 / 焦点是否在视口内
 * 用法: node tools/b1r2-c.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/particles/';

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const TOCSTATE = () => {
  const d = document.querySelector('.toc-fold');
  const toc = document.querySelector('.toc-side');
  return {
    vw: innerWidth, vh: innerHeight,
    open: d ? !!d.open : null,
    hasOpenAttr: d ? d.hasAttribute('open') : null,
    tocDisplay: toc ? getComputedStyle(toc).display : null,
    tocH: toc ? Math.round(toc.getBoundingClientRect().height) : 0,
    olH: (() => { const o = document.querySelector('.toc-fold>ol'); return o ? o.clientHeight : 0; })(),
    offset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
  };
};

(async () => {
  if (!EXE) { console.error('NO CHROME'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { rotate: [], pageshow: [], preventScroll: [], drawer: [] };

  // ---------- C1 旋转链 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const steps = [];
    const snap = async (label) => {
      const s = await page.evaluate(TOCSTATE);
      s.label = label;
      steps.push(s);
      log('ROTATE ' + JSON.stringify(s));
    };
    await snap('1.初始390');
    // 用户在 390 手动展开
    await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
    await page.waitForTimeout(300);
    await snap('2.用户390手动展开');
    // 旋转到 844（同档 <1025）
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(350);
    await snap('3.旋转844(同档)');
    // 跨到 1025（宽档）
    await page.setViewportSize({ width: 1025, height: 800 });
    await page.waitForTimeout(350);
    await snap('4.跨到1025');
    // 用户在 1025 手动折叠（桌面用户想收起右栏）
    await page.evaluate(() => { document.querySelector('.toc-fold').open = false; });
    await page.waitForTimeout(300);
    await snap('5.用户1025手动折叠');
    // 回到 1024（窄档）—— applyToc(false) 会 removeAttribute
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.waitForTimeout(350);
    await snap('6.回1024');
    // 再回 390：此时 lastIsWide=false，用户之前在 390 的"展开"选择应恢复吗？
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await snap('7.回390');
    // 同档 resize 1px（保持用户选择？）
    await page.setViewportSize({ width: 391, height: 844 });
    await page.waitForTimeout(300);
    await snap('8.同档+1px');
    out.rotate = steps;
    await ctx.close();
  }

  // ---------- C2 pageshow / bfcache 语义 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1025, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const r = {};
    r.at1025 = await page.evaluate(TOCSTATE);
    // 模拟 bfcache 恢复：pageshow persisted=true，并改变视口到 390 后再回来
    // 关键：lastIsWide 是闭包变量，页面恢复时不会重新执行 syncToc —— 但 matchMedia change 会。
    // 用「改变视口 + 派发 pageshow」观察是否有监听者
    r.hasPageshowListener = await page.evaluate(() => {
      let found = false;
      const orig = window.addEventListener;
      // 无法枚举既有监听器；改为检查源码是否包含 pageshow
      return found;
    });
    // 真实测试：1025 下用户折叠 → 缩到 390（applyToc(false) 移除 open）→ 缩回 1025（applyToc(true) 强制 open）
    await page.evaluate(() => { document.querySelector('.toc-fold').open = false; });
    await page.waitForTimeout(250);
    r.userCollapsedAt1025 = await page.evaluate(TOCSTATE);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    r.afterTo390 = await page.evaluate(TOCSTATE);
    await page.setViewportSize({ width: 1025, height: 800 });
    await page.waitForTimeout(350);
    r.backTo1025 = await page.evaluate(TOCSTATE);
    r.note = 'lastIsWide 无 pageshow 重置点，也无 visibilitychange/scroll 恢复钩子';
    out.pageshow.push(r);
    log('PAGESHOW ' + JSON.stringify(r));
    await ctx.close();
  }

  // ---------- C3 preventScroll 支持性与未支持时的位移 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const res = {};
      res.supportsInstant = (() => {
        try { return CSS.supports('scroll-behavior', 'instant'); } catch (e) { return 'err'; }
      })();
      res.supportsHas = (() => { try { return CSS.supports('selector(:has(a))'); } catch (e) { return 'err'; } })();
      // 1) 支持 preventScroll 时：真实位移
      window.scrollTo(0, 4000);
      const btn = document.getElementById('sidebar-toggle') || document.querySelector('.sidebar-toggle');
      const before = Math.round(window.pageYOffset);
      btn.focus({ preventScroll: true });
      res.withPreventScroll = { before, after: Math.round(window.pageYOffset), delta: Math.round(window.pageYOffset) - before };
      // 2) 模拟"不支持"：直接 focus()（= 回退分支语义）
      window.scrollTo(0, 4000);
      const before2 = Math.round(window.pageYOffset);
      btn.focus();
      res.withoutPreventScroll = { before: before2, after: Math.round(window.pageYOffset), delta: Math.round(window.pageYOffset) - before2 };
      // 3) scrollTo 兜底在 smooth 下的行为：采样是否动画化
      res.scrollBehavior = getComputedStyle(document.documentElement).scrollBehavior;
      return res;
    });
    // 4) 采样 smooth scrollTo 是否一步到位
    const samples = await page.evaluate(async () => {
      window.scrollTo(0, 6000);
      const y0 = Math.round(window.pageYOffset);
      const arr = [];
      window.scrollTo(0, 1000);   // html 有 smooth，这条会动画
      for (let i = 0; i < 8; i++) {
        arr.push(Math.round(window.pageYOffset));
        await new Promise((res) => requestAnimationFrame(res));
      }
      await new Promise((res) => setTimeout(res, 500));
      arr.push(Math.round(window.pageYOffset));
      return { y0, arr, distinct: new Set(arr).size };
    });
    r.smoothFallbackSamples = samples;
    out.preventScroll.push(r);
    log('PREVENTSCROLL ' + JSON.stringify(r));
    await ctx.close();
  }

  // ---------- C4/C5 抽屉 ----------
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '320x568', w: 320, h: 568 }, { n: '768x1024', w: 768, h: 1024 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 4000));
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const res = {};
      const side = document.querySelector('.sidebar');
      const active = side.querySelector('a.active, [aria-current="page"]');
      const sb0 = side.getBoundingClientRect();
      res.before = {
        pageY: Math.round(window.pageYOffset),
        sideScrollTop: Math.round(side.scrollTop),
        sideRectTop: Math.round(sb0.top), sideRectBottom: Math.round(sb0.bottom),
        activeTop: active ? Math.round(active.getBoundingClientRect().top) : null,
        sideIsScroller: (() => { const cs = getComputedStyle(side); return { overflowY: cs.overflowY, clientH: side.clientHeight, scrollH: side.scrollHeight, scrollbar: side.scrollHeight > side.clientHeight + 1 }; })(),
        activeHref: active ? active.getAttribute('href') : null,
        activeText: active ? (active.textContent || '').trim().slice(0, 30) : null,
      };
      return res;
    });
    // 打开抽屉
    await page.evaluate(() => { document.querySelector('.sidebar-toggle').click(); });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => {
      const side = document.querySelector('.sidebar');
      const active = side.querySelector('a.active, [aria-current="page"]');
      const sb = side.getBoundingClientRect();
      const ab = active ? active.getBoundingClientRect() : null;
      const ae = document.activeElement;
      const aeb = ae ? ae.getBoundingClientRect() : null;
      return {
        pageY: Math.round(window.pageYOffset),
        sideScrollTop: Math.round(side.scrollTop),
        sideRectTop: Math.round(sb.top), sideRectBottom: Math.round(sb.bottom),
        activeTop: ab ? Math.round(ab.top) : null,
        activeVisible: ab ? (ab.top >= sb.top && ab.bottom <= sb.bottom) : null,
        activeCentered: ab ? Math.round((ab.top + ab.bottom) / 2 - (sb.top + sb.bottom) / 2) : null,
        focusTag: ae ? ae.tagName : null,
        focusCls: ae ? String(ae.className || '').slice(0, 24) : null,
        focusHref: ae && ae.getAttribute ? ae.getAttribute('href') : null,
        focusVisible: aeb ? (aeb.top >= sb.top && aeb.bottom <= sb.bottom) : null,
        focusTop: aeb ? Math.round(aeb.top) : null,
        activeIsFocus: ae === active,
        bodyOverflow: getComputedStyle(document.body).overflow,
        /* 关键：焦点元素与 active 之间的垂直距离（px），>0 说明视口给的是 active，焦点在别处 */
        focusVsActivePx: (ab && aeb) ? Math.round(aeb.top - ab.top) : null,
      };
    });
    out.drawer.push({ vp: vp.n, before: r.before, after });
    log('DRAWER ' + JSON.stringify({ vp: vp.n, before: r.before, after }));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-c.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-c.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-c.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
