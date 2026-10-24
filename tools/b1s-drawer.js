'use strict';
/**
 * b1s-drawer.js — 冲突 1：P0-2「开合丢阅读位置」到底存不存在？P0-2 修了什么？+27 根因？
 *
 * 三种点击方式 × 两个构建（8787 new / 8788 old），都从"阅读中段"起测：
 *   A. page.mouse.click(x,y)              真实鼠标事件（真实用路径）
 *   B. locator.click()                     Playwright 会先 scrollIntoViewIfNeeded
 *   C. page.mouse + 先 scrollTo 到中段     针对 critique-mobile 原报告的复刻
 *       原报告用 scrollTo(0,12000) + DOM el.click()（无合成鼠标事件）
 *
 * 判定口径：
 *   - 若 A（真实鼠标）在两棵树都 ≈0，则"改前每次 −428"是自动化伪影，P0-2 修的缺陷不存在；
 *   - 只测"阅读位置" = 抽屉覆盖的正文里，某个固定段落的视口 y 变化（比 scrollY 更贴近用户损失）。
 * 另测 390 档 +27 的根因：scrollbar-gutter / 滚动锚定 / 焦点。
 * 只读站点；写 <tmp>\b1s\drawer.json。用法: node tools/b1s-drawer.js
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

// 找一个"阅读中段"的稳定锚点：取正文 55% 处最靠近视口中线的段落
async function anchorAtMid(page) {
  return page.evaluate(() => {
    const h = document.documentElement.scrollHeight;
    const target = Math.round(h * 0.55);
    window.scrollTo({ top: target, behavior: 'instant' });
    const paras = Array.from(document.querySelectorAll('article p, article h2, article h3'));
    let best = null;
    for (const p of paras) {
      const b = p.getBoundingClientRect();
      if (b.top > 40 && b.top < window.innerHeight - 40) { best = p; break; }
    }
    if (best) { best.setAttribute('data-b1s-anchor', '1'); }
    return { scrollY: window.scrollY, hasAnchor: !!best, anchorTop: best ? +best.getBoundingClientRect().top.toFixed(2) : null };
  });
}
async function state(page) {
  return page.evaluate(() => {
    const a = document.querySelector('[data-b1s-anchor]');
    const tog = document.getElementById('nav-toggle') || document.querySelector('.sidebar-toggle');
    const html = document.documentElement;
    return {
      scrollY: Math.round(window.scrollY),
      anchorTop: a ? +a.getBoundingClientRect().top.toFixed(2) : null,
      anchorText: a ? (a.textContent || '').trim().slice(0, 28) : null,
      navOpen: document.body.classList.contains('nav-open'),
      ariaExpanded: tog ? tog.getAttribute('aria-expanded') : null,
      gutter: getComputedStyle(html).scrollbarGutter,
      navLocked: html.classList.contains('nav-locked'),
      docScrollW: html.scrollWidth,
      docClientW: html.clientWidth,
      vw: window.innerWidth,
      bodyOverflow: getComputedStyle(document.body).overflow,
    };
  });
}

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { mouse: [], locator: [], domClick: [], gutter: [], focus: [] };

  const VPS = [['390x844', 390, 844], ['320x568', 320, 568], ['768x1024', 768, 1024]];

  // ============ A. 真实鼠标点击 ============
  for (const [vpName, w, h] of VPS) {
    for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: false });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(350);
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      const a = await anchorAtMid(page);
      await page.waitForTimeout(250);

      // 找到 toggle 的真实屏幕坐标（不做 scrollIntoView，直接取其 rect）
      const tb = await page.evaluate(() => {
        const t = document.getElementById('nav-toggle') || document.querySelector('.sidebar-toggle');
        if (!t) return null;
        const b = t.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height, visible: b.width > 0 && b.height > 0 };
      });
      const seq = [];
      let prev = await state(page);
      seq.push({ step: 'start', ...prev });
      if (tb && tb.visible) {
        for (let i = 0; i < 3; i++) {
          await page.mouse.click(tb.x, tb.y);
          await page.waitForTimeout(450);
          const open = await page.evaluate(() => ({ scrollY: Math.round(window.scrollY), a: document.querySelector('[data-b1s-anchor]') ? +document.querySelector('[data-b1s-anchor]').getBoundingClientRect().top.toFixed(2) : null }));
          seq.push({ step: 'open' + i, ...(await state(page)), dScroll: open.scrollY - prev.scrollY, dAnchor: open.a !== null && prev.anchorTop !== null ? +(open.a - prev.anchorTop).toFixed(2) : null });
          prev = await state(page);

          await page.mouse.click(tb.x, tb.y);
          await page.waitForTimeout(450);
          const close = await page.evaluate(() => ({ scrollY: Math.round(window.scrollY), a: document.querySelector('[data-b1s-anchor]') ? +document.querySelector('[data-b1s-anchor]').getBoundingClientRect().top.toFixed(2) : null }));
          seq.push({ step: 'close' + i, ...(await state(page)), dScroll: close.scrollY - prev.scrollY, dAnchor: close.a !== null && prev.anchorTop !== null ? +(close.a - prev.anchorTop).toFixed(2) : null });
          prev = await state(page);
        }
      }
      const rec = { vp: vpName, tag, method: 'mouse', anchor: a, toggle: tb, seq, netScroll: seq[seq.length - 1].scrollY - seq[0].scrollY, netAnchor: seq[seq.length - 1].anchorTop - seq[0].anchorTop };
      out.mouse.push(rec);
      log({ m: 'MOUSE', vp: vpName, tag, netScroll: rec.netScroll, netAnchor: rec.netAnchor, steps: seq.map((s) => s.step + ':' + (s.dScroll === undefined ? '-' : s.dScroll) + '/' + (s.dAnchor === undefined ? '-' : s.dAnchor)).join(' ') });
      await ctx.close();
    }
  }

  // ============ B. locator.click()（对照，证明伪影） ============
  for (const [vpName, w, h] of VPS.slice(0, 1)) {
    for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(350);
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await anchorAtMid(page);
      await page.waitForTimeout(250);
      const loc = page.locator('#nav-toggle, .sidebar-toggle').first();
      const seq = [];
      let prevY = await page.evaluate(() => Math.round(window.scrollY));
      seq.push(prevY);
      for (let i = 0; i < 3; i++) {
        await loc.click();
        await page.waitForTimeout(450);
        const y1 = await page.evaluate(() => Math.round(window.scrollY)); seq.push(y1);
        await loc.click();
        await page.waitForTimeout(450);
        const y2 = await page.evaluate(() => Math.round(window.scrollY)); seq.push(y2);
      }
      out.locator.push({ vp: vpName, tag, seq, net: seq[seq.length - 1] - seq[0] });
      log({ m: 'LOCATOR', vp: vpName, tag, seq, net: seq[seq.length - 1] - seq[0] });
      await ctx.close();
    }
  }

  // ============ C. 复刻 critique-mobile 原报告：scrollTo(0,12000) + DOM el.click() ============
  for (const [vpName, w, h] of VPS.slice(0, 2)) {
    for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(350);
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      // 关键是：scrollTo(0,12000) 把"原点"设在阅读中段，然后 el.click() 不产生鼠标事件
      await page.evaluate(() => window.scrollTo(0, 12000));
      await page.waitForTimeout(400);
      const y0 = await page.evaluate(() => Math.round(window.scrollY));
      const res = [];
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => { const t = document.getElementById('nav-toggle') || document.querySelector('.sidebar-toggle'); t.click(); });
        await page.waitForTimeout(400);
        res.push(await page.evaluate(() => Math.round(window.scrollY)));
        await page.evaluate(() => { const t = document.getElementById('nav-toggle') || document.querySelector('.sidebar-toggle'); t.click(); });
        await page.waitForTimeout(400);
        res.push(await page.evaluate(() => Math.round(window.scrollY)));
      }
      const rec = { vp: vpName, tag, y0, seq: res, net: res[res.length - 1] - y0, firstOpenDelta: res[0] - y0 };
      out.domClick.push(rec);
      log({ m: 'DOMCLICK', vp: vpName, tag, y0, seq: res, net: rec.net, firstOpen: rec.firstOpenDelta });
      await ctx.close();
    }
  }

  // ============ D. +27 根因：scrollbar-gutter 归零实验（new, 390, 真实鼠标） ============
  {
    const variants = [
      ['as-is', null],
      ['gutter-auto', 'html.nav-locked{scrollbar-gutter:auto !important}'],
      ['gutter-stable-always', 'html{scrollbar-gutter:stable !important}'],
      ['overflow-scroll-always', 'html{overflow-y:scroll !important}'],
    ];
    for (const [vName, css] of variants) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(350);
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      if (css) await page.addStyleTag({ content: css });
      await anchorAtMid(page);
      await page.waitForTimeout(250);
      const tb = await page.evaluate(() => { const t = document.getElementById('nav-toggle'); const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      const d = [];
      let prevY = await page.evaluate(() => Math.round(window.scrollY));
      for (let i = 0; i < 3; i++) {
        await page.mouse.click(tb.x, tb.y); await page.waitForTimeout(420);
        let y = await page.evaluate(() => Math.round(window.scrollY)); d.push(y - prevY); prevY = y;
        await page.mouse.click(tb.x, tb.y); await page.waitForTimeout(420);
        y = await page.evaluate(() => Math.round(window.scrollY)); d.push(y - prevY); prevY = y;
      }
      const diag = await page.evaluate(() => ({ gutter: getComputedStyle(document.documentElement).scrollbarGutter, clientW: document.documentElement.clientWidth, innerW: window.innerWidth, hasGutter: window.innerWidth - document.documentElement.clientWidth }));
      out.gutter.push({ variant: vName, deltas: d, net: d.reduce((a, b) => a + b, 0), diag });
      log({ m: 'GUTTER', variant: vName, deltas: d, net: d.reduce((a, b) => a + b, 0), diag });
      await ctx.close();
    }
  }

  // ============ E. 焦点路径：open/close 时 scrollY 的即时轨迹（定位 +27 发生时刻） ============
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await anchorAtMid(page);
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      window.__trace = [];
      const t0 = performance.now();
      const push = (k) => window.__trace.push({ k, y: Math.round(window.scrollY), t: Math.round(performance.now() - t0), gutter: getComputedStyle(document.documentElement).scrollbarGutter, locked: document.documentElement.classList.contains('nav-locked') });
      window.addEventListener('scroll', () => push('scroll'), { passive: true });
      const t = document.getElementById('nav-toggle');
      t.addEventListener('click', () => push('click'), true);
      const obs = new MutationObserver(() => push('mut'));
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    });
    const tb = await page.evaluate(() => { const t = document.getElementById('nav-toggle'); const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(tb.x, tb.y);
    await page.waitForTimeout(500);
    const trace = await page.evaluate(() => window.__trace);
    out.focus.push({ vp: '390x844', trace });
    log({ m: 'TRACE', trace: trace.slice(0, 25) });
    await ctx.close();
  }

  fs.writeFileSync(path.join(TMP, 'drawer.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE ' + path.join(TMP, 'drawer.json'));
  await browser.close();
})();
