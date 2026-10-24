'use strict';
/**
 * b1s-a11y.js — 冲突 5：批 1 之后的 a11y 补丁是否真的修好了 F-1 / F-2 / F-6，且没引入新问题
 *
 * 逐条按 b1-a11y 报告的原始复现步骤重跑：
 *   F-1  SC 3.2.5 : 1440 手动折叠 TOC → 视口 1440→1439 → 是否被强行改回 open
 *                   390 展开 → 高 844→780 → 是否被强行折叠
 *                   + 新增怀疑：同档多次 resize 是否累积漂移；跨断点是否仍正确
 *   F-2  SC 2.4.11: 390 折叠态 location.hash='#recommended-memory' → 标题是否被 sticky 条盖住
 *                   + 新增怀疑：--toc-offset 在展开态是否更新；展开后锚点是否仍被盖
 *   F-6  SC 4.1.2 : summary 的 AX 名是否还含 "▸"
 *   + 回归：lastIsWide 在 bfcache 恢复（pageshow persisted）时是否错乱
 * 只读站点；写 <tmp>\b1s\a11y.json。用法: node tools/b1s-a11y.js
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
const P = '/paper/aikars-flags/index.html';
const log = (o) => console.log(JSON.stringify(o));

const tocState = () => {
  const f = document.querySelector('.toc-side .toc-fold');
  const t = document.querySelector('.toc-side');
  const b = t ? t.getBoundingClientRect() : null;
  return {
    open: f ? f.open : null,
    tocH: b ? +b.height.toFixed(2) : null,
    tocTop: b ? +b.top.toFixed(2) : null,
    tocBottom: b ? +b.bottom.toFixed(2) : null,
    vw: window.innerWidth, vh: window.innerHeight,
    tocOffsetVar: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { f1: [], f2: [], f6: [], bfcache: [], reduceMotion: [] };

  // ============ F-1 用户控制 ============
  // 1a. 1440 手动折叠 → 同档 1px resize
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + P, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const initial = await page.evaluate(tocState);
    // 真实鼠标点 summary
    const sm = await page.evaluate(() => { const s = document.querySelector('.toc-side .toc-title'); const b = s.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(sm.x, sm.y);
    await page.waitForTimeout(300);
    const collapsed = await page.evaluate(tocState);
    await page.setViewportSize({ width: 1439, height: 900 });
    await page.waitForTimeout(350);
    const after1px = await page.evaluate(tocState);
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.waitForTimeout(350);
    const after1300 = await page.evaluate(tocState);
    // 跨断点向下再向上，检查是否恢复正确
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(350);
    const crossDown = await page.evaluate(tocState);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(350);
    const crossUp = await page.evaluate(tocState);
    // 跨断点回来后再同档 resize：此时 lastIsWide=true，用户再折叠，再 resize
    await page.mouse.click(sm.x, sm.y);
    await page.waitForTimeout(250);
    const userCollapse2 = await page.evaluate(tocState);
    await page.setViewportSize({ width: 1439, height: 900 });
    await page.waitForTimeout(350);
    const after1px_2 = await page.evaluate(tocState);
    const rec = { case: 'f1-1440', initial, collapsed, after1px, after1300, crossDown, crossUp, userCollapse2, after1px_2 };
    out.f1.push(rec);
    log({ m: 'F1-1440', initialOpen: initial.open, collapsed: collapsed.open, after1px: after1px.open, after1300: after1300.open, crossDown: crossDown.open, crossUp: crossUp.open, userCollapse2: userCollapse2.open, after1px_2: after1px_2.open });
    await ctx.close();
  }
  // 1b. 390 展开 → 高度变化（地址栏收放）
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + P, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const initial = await page.evaluate(tocState);
    const sm = await page.evaluate(() => { const s = document.querySelector('.toc-side .toc-title'); const b = s.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(sm.x, sm.y);
    await page.waitForTimeout(350);
    const expanded = await page.evaluate(tocState);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForTimeout(400);
    const afterHeightChange = await page.evaluate(tocState);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const back = await page.evaluate(tocState);
    const rec = { case: 'f1-390', initial, expanded, afterHeightChange, back };
    out.f1.push(rec);
    log({ m: 'F1-390', initialOpen: initial.open, expanded: expanded.open, afterHeightChange: afterHeightChange.open, back: back.open, expandedTocH: expanded.tocH });
    await ctx.close();
  }

  // ============ F-2 锚点遮挡（折叠态 + 展开态） ============
  for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
    for (const vp of [['390x844', 390, 844], ['768x1024', 768, 1024], ['1440x900', 1440, 900]]) {
      const ctx = await browser.newContext({ viewport: { width: vp[1], height: vp[2] }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + P, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      // 先滚到中段，再设 hash，模拟真实"从目录点链接"
      const probe = async (label) => page.evaluate((lb) => {
        const h = document.getElementById('recommended-memory');
        if (!h) return { label: lb, missing: true };
        const b = h.getBoundingClientRect();
        const cx = b.x + Math.min(b.width / 2, 40);
        const cy = Math.max(b.top + 4, 1);
        const hit = document.elementFromPoint(cx, cy);
        const toc = document.querySelector('.toc-side');
        const tb = toc ? toc.getBoundingClientRect() : null;
        return {
          label: lb,
          headingTop: +b.top.toFixed(2), headingBottom: +b.bottom.toFixed(2),
          tocBottom: tb ? +tb.bottom.toFixed(2) : null,
          coveredPx: tb ? +Math.max(0, Math.min(b.bottom, tb.bottom) - Math.max(b.top, tb.top)).toFixed(2) : 0,
          coveredPct: tb && b.height > 0 ? +((Math.max(0, Math.min(b.bottom, tb.bottom) - Math.max(b.top, tb.top)) / b.height) * 100).toFixed(1) : 0,
          hitTag: hit ? hit.tagName : null, hitCls: hit ? String(hit.className).slice(0, 40) : null,
          hitIsToc: !!(hit && hit.closest('.toc-side')),
          scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
          tocOffsetVar: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
          tocH: tb ? +tb.height.toFixed(2) : null,
          tocOpen: (() => { const f = document.querySelector('.toc-side .toc-fold'); return f ? f.open : null; })(),
        };
      }, label);
      await page.evaluate(() => window.scrollTo({ top: Math.round(document.documentElement.scrollHeight * 0.3), behavior: 'instant' }));
      await page.waitForTimeout(250);
      await page.evaluate(() => { location.hash = '#recommended-memory'; });
      await page.waitForTimeout(700);
      const collapsed = await probe('collapsed');
      // 展开后再设一次 hash
      const sm = await page.evaluate(() => { const s = document.querySelector('.toc-side .toc-title'); if (!s) return null; const b = s.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height }; });
      let expanded = null;
      if (sm && sm.h > 0) {
        await page.mouse.click(sm.x, sm.y);
        await page.waitForTimeout(450);
        await page.evaluate(() => { location.hash = ''; window.scrollTo(0, 0); });
        await page.waitForTimeout(200);
        await page.evaluate(() => { location.hash = '#recommended-memory'; });
        await page.waitForTimeout(700);
        expanded = await probe('expanded');
      }
      const rec = { tag, vp: vp[0], collapsed, expanded };
      out.f2.push(rec);
      log({ m: 'F2', tag, vp: vp[0], c: { top: collapsed.headingTop, cov: collapsed.coveredPct, hit: collapsed.hitCls, isToc: collapsed.hitIsToc, pad: collapsed.scrollPadTop, off: collapsed.tocOffsetVar, tocH: collapsed.tocH, open: collapsed.tocOpen }, e: expanded ? { top: expanded.headingTop, cov: expanded.coveredPct, hit: expanded.hitCls, isToc: expanded.hitIsToc, pad: expanded.scrollPadTop, off: expanded.tocOffsetVar, tocH: expanded.tocH, open: expanded.tocOpen } : null });
      await ctx.close();
    }
  }

  // ============ F-6 可访问名是否还含 ▸ ============
  for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(base + P, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const pick = (role) => nodes.filter((n) => n.role && n.role.value === role).map((n) => ({ name: n.name ? n.name.value : null, expanded: (n.properties || []).find((p) => p.name === 'expanded') ? (n.properties.find((p) => p.name === 'expanded').value.value) : undefined }));
    const discl = pick('DisclosureTriangle');
    const sums = await page.evaluate(() => Array.from(document.querySelectorAll('summary')).map((s) => {
      const cs = getComputedStyle(s, '::before');
      return { cls: s.className, text: (s.textContent || '').trim().slice(0, 24), beforeContent: cs.content, beforeW: cs.width, beforeBorderLeft: cs.borderLeftWidth };
    }));
    const rec = { tag, disclosureTriangles: discl, summaries: sums };
    out.f6.push(rec);
    log({ m: 'F6', tag, names: discl.map((d) => d.name), summaries: sums.map((s) => s.cls + '|content=' + s.beforeContent + '|bl=' + s.beforeBorderLeft) });
    await ctx.close();
  }

  // ============ bfcache / pageshow：lastIsWide 是否错乱 ============
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + P, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const a = await page.evaluate(tocState);
    // 展开（<1025 应保持用户选择）
    const sm = await page.evaluate(() => { const s = document.querySelector('.toc-side .toc-title'); const b = s.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(sm.x, sm.y);
    await page.waitForTimeout(300);
    const bExpanded = await page.evaluate(tocState);
    // 导航走再回来（模拟 bfcache 往返）
    await page.goto(NEW + '/paper/anti-xray/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.goBack({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    const afterBack = await page.evaluate(tocState);
    // 再来一次真实 resize（跨回 1440 再回 390），看是否残留错误状态
    await page.setViewportSize({ width: 1440, height: 844 });
    await page.waitForTimeout(350);
    const toWide = await page.evaluate(tocState);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    const backToNarrow = await page.evaluate(tocState);
    const rec = { a, bExpanded, afterBack, toWide, backToNarrow };
    out.bfcache.push(rec);
    log({ m: 'BFCACHE', initial: a.open, userExpanded: bExpanded.open, afterBack: afterBack.open, toWide: toWide.open, backToNarrow: backToNarrow.open });
    await ctx.close();
  }

  // ============ reduce-motion ============
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(NEW + P, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const s = document.querySelector('.toc-side .toc-title');
      const cs = s ? getComputedStyle(s, '::before') : null;
      return {
        beforeTransition: cs ? cs.transitionDuration : null,
        beforeProperty: cs ? cs.transitionProperty : null,
        htmlScrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        beforeContent: cs ? cs.content : null,
        beforeBorder: cs ? cs.borderLeftWidth + ' ' + cs.borderLeftColor : null,
      };
    });
    out.reduceMotion.push(r);
    log({ m: 'REDUCE', r });
    await ctx.close();
  }

  fs.writeFileSync(path.join(TMP, 'a11y.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE ' + path.join(TMP, 'a11y.json'));
  await browser.close();
})();
