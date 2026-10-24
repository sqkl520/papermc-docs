'use strict';
/**
 * b1s-toc2.js — 冲突 5 续：--toc-offset 在「展开态」是否真的失同步
 *
 * b1s-a11y.js 的展开态测法有缺陷：先点开 summary，再 location.hash='' 并 scrollTo(0,0)，
 * 这会让浏览器在 hash 清空时产生额外滚动，且 scrollIntoView 会二次触发（不稳定）。
 * 本探针改成最贴近用户的操作顺序：
 *   1. 页面就绪 → 点 summary 展开（真实鼠标）
 *   2. 等 400ms（toggle 事件 → setTimeout(syncTocOffset,0) 已跑完）
 *   3. 读 --toc-offset / scroll-padding-top / tocH  → 三者是否自洽
 *   4. 从目录里真实点击第 N 个链接（不是设 hash），看目标标题相对 sticky 条的位置
 *   5. 再折叠回去，重复一次，看 offset 是否回落到 61
 * 额外：检查 syncTocOffset 只在 resize/toggle 触发，滚轮/内容变化不触发。
 * 只读站点；写 <tmp>\b1s\toc2.json。
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
const P = '/paper/aikars-flags/index.html';
const log = (o) => console.log(JSON.stringify(o));

const read = () => ({
  tocOpen: (() => { const f = document.querySelector('.toc-side .toc-fold'); return f ? f.open : null; })(),
  tocH: (() => { const t = document.querySelector('.toc-side'); if (!t) return null; const b = t.getBoundingClientRect(); return +b.height.toFixed(2); })(),
  tocBottom: (() => { const t = document.querySelector('.toc-side'); if (!t) return null; return +t.getBoundingClientRect().bottom.toFixed(2); })(),
  offsetVar: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
  scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
  vh: window.innerHeight, scrollY: Math.round(window.scrollY),
});

// 目标标题相对视口顶部的位置 + 是否被 sticky 条压住
const headingState = (id) => {
  const h = document.getElementById(id);
  if (!h) return { missing: true };
  const b = h.getBoundingClientRect();
  const toc = document.querySelector('.toc-side');
  const tb = toc ? toc.getBoundingClientRect() : null;
  const cx = Math.min(b.x + 30, window.innerWidth - 5);
  const hit = document.elementFromPoint(cx, Math.max(b.top + 3, 1));
  return {
    id, top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2),
    tocBottom: tb ? +tb.bottom.toFixed(2) : null,
    coveredPx: tb ? +Math.max(0, Math.min(b.bottom, tb.bottom) - Math.max(b.top, tb.top)).toFixed(2) : 0,
    coveredPct: tb && b.height > 0 ? +((Math.max(0, Math.min(b.bottom, tb.bottom) - Math.max(b.top, tb.top)) / b.height) * 100).toFixed(1) : 0,
    hitTag: hit ? hit.tagName : null, hitCls: hit ? String(hit.className).slice(0, 30) : null,
    hitIsToc: !!(hit && hit.closest && hit.closest('.toc-side')),
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { seq: [], expandThenClick: [], refold: [], syncTriggers: [] };

  for (const [vpName, w, h] of [['390x844', 390, 844], ['768x1024', 768, 1024], ['1023x900', 1023, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + P, { waitUntil: 'load' });
    await page.waitForTimeout(450);
    await page.addStyleTag({ content: 'html{scroll-behavior:smooth}' }); // 保留站点默认，测真实行为

    const collapsed0 = await page.evaluate(read);

    // 1. 展开
    const sm = await page.evaluate(() => { const s = document.querySelector('.toc-side .toc-title'); const b = s.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(sm.x, sm.y);
    await page.waitForTimeout(500);
    const expanded = await page.evaluate(read);

    // 2. 展开态下从目录真实点击一个靠后的链接
    const link = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('.toc-side ol a')).find((x) => x.getAttribute('href') === '#recommended-memory') || document.querySelector('.toc-side ol a:nth-child(3)');
      if (!a) return null;
      const b = a.getBoundingClientRect();
      // 若不在视口内，滚到它
      if (b.top < 60 || b.bottom > window.innerHeight - 10) a.scrollIntoView({ block: 'center', behavior: 'instant' });
      const b2 = a.getBoundingClientRect();
      return { href: a.getAttribute('href'), x: b2.x + b2.width / 2, y: b2.y + b2.height / 2, id: (a.getAttribute('href') || '').slice(1) };
    });
    let afterClick = null;
    if (link) {
      await page.waitForTimeout(200);
      await page.mouse.click(link.x, link.y);
      await page.waitForTimeout(1200); // 等平滑滚动落定
      afterClick = {
        target: await page.evaluate(headingState, link.id),
        state: await page.evaluate(read),
        hash: await page.evaluate(() => location.hash),
      };
    }

    // 3. 折叠回去，看 offset 是否回落
    await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.waitForTimeout(300);
    const sm2 = await page.evaluate(() => { const s = document.querySelector('.toc-side .toc-title'); const b = s.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(sm2.x, sm2.y);
    await page.waitForTimeout(500);
    const refolded = await page.evaluate(read);

    // 4. 折叠态再点一次同一链接
    const link2 = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('.toc-side ol a')).find((x) => x.getAttribute('href') === '#recommended-memory');
      if (!a) return null;
      const b = a.getBoundingClientRect();
      return { href: a.getAttribute('href'), x: b.x + b.width / 2, y: b.y + b.height / 2, id: a.getAttribute('href').slice(1) };
    });
    let afterClick2 = null;
    if (link2) {
      await page.mouse.click(link2.x, link2.y);
      await page.waitForTimeout(1200);
      afterClick2 = { target: await page.evaluate(headingState, link2.id), state: await page.evaluate(read), hash: await page.evaluate(() => location.hash) };
    }

    const rec = { vp: vpName, collapsed0, expanded, link, afterClick, refolded, afterClick2 };
    out.expandThenClick.push(rec);
    log({ m: 'EXPAND', vp: vpName, c0: { off: collapsed0.offsetVar, pad: collapsed0.scrollPadTop, tocH: collapsed0.tocH }, exp: { off: expanded.offsetVar, pad: expanded.scrollPadTop, tocH: expanded.tocH, open: expanded.tocOpen }, clickExp: afterClick && { targetTop: afterClick.target.top, cov: afterClick.target.coveredPct, hit: afterClick.target.hitCls, isToc: afterClick.target.hitIsToc, off: afterClick.state.offsetVar, pad: afterClick.state.scrollPadTop }, refold: { off: refolded.offsetVar, pad: refolded.scrollPadTop, tocH: refolded.tocH, open: refolded.tocOpen }, clickCol: afterClick2 && { targetTop: afterClick2.target.top, cov: afterClick2.target.coveredPct, hit: afterClick2.target.hitCls, isToc: afterClick2.target.hitIsToc, off: afterClick2.state.offsetVar, pad: afterClick2.state.scrollPadTop } });
    await ctx.close();
  }

  // 5. syncTocOffset 的触发面：内容变化/图片加载/字体切换是否更新
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + P, { waitUntil: 'load' });
    await page.waitForTimeout(450);
    const before = await page.evaluate(read);
    // 展开，然后人为改变 TOC 内容高度（模拟目录项变多 / 字体加载后变高），看 offset 是否跟随
    await page.evaluate(() => { const f = document.querySelector('.toc-side .toc-fold'); if (f) { f.open = true; f.dispatchEvent(new Event('toggle')); } });
    await page.waitForTimeout(500);
    const afterToggle = await page.evaluate(read);
    // 直接改高度（不触发 toggle/resize）
    await page.evaluate(() => {
      const ol = document.querySelector('.toc-side ol');
      if (ol) { const d = document.createElement('li'); d.innerHTML = '<a href="#x">注入项</a>'; for (let i = 0; i < 6; i++) ol.appendChild(d.cloneNode(true)); }
    });
    await page.waitForTimeout(400);
    const afterInject = await page.evaluate(read);
    // 再触发一次 resize（1px），看是否被修正
    await page.setViewportSize({ width: 391, height: 844 });
    await page.waitForTimeout(450);
    const afterResize = await page.evaluate(read);
    out.syncTriggers.push({ before, afterToggle, afterInject, afterResize });
    log({ m: 'SYNC', before: { off: before.offsetVar, tocH: before.tocH }, afterToggle: { off: afterToggle.offsetVar, tocH: afterToggle.tocH }, afterInject: { off: afterInject.offsetVar, tocH: afterInject.tocH }, afterResize: { off: afterResize.offsetVar, tocH: afterResize.tocH } });
    await ctx.close();
  }

  fs.writeFileSync(path.join(TMP, 'toc2.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE ' + path.join(TMP, 'toc2.json'));
  await browser.close();
})();
