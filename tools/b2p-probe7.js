'use strict';
/**
 * b2p-probe7.js — 只读：P0-6 的**锚点遮挡**判据（F-2 回归风险）+ `--toc-offset` 联动缺口
 *
 * probe6 发现的一件事（本脚本要坐实它）：
 *   在 1025–1279 注入目标态 CSS 后，我手动 `setProperty('--toc-offset', 50px)`，
 *   但 80ms 后读回来是 **0px** —— 因为 site.js 在 `.toc-fold` 的 `toggle` 监听里
 *   `setTimeout(syncTocOffset, 0)`，而 `syncTocOffset()` 的条件写死 `window.innerWidth < 1025`。
 *   ⇒ **P0-6 若只改 CSS，1025–1279 的 `--toc-offset` 恒为 0**，锚点落点会被 50px 吸顶条盖住。
 *
 * 本脚本用确定性方法（不用 hash、不用 smooth）测遮挡：
 *   手动 `scrollTo(0, headingAbsoluteY - scrollPaddingTop)`，
 *   再在标题文字的第一个字符位置 `elementFromPoint` —— 若命中 `.toc-side` 则被遮挡。
 *
 * 变体：
 *   base            = 现状（1025–1279 有 250px 右栏，不遮挡）
 *   target_noOffset = P0-6 CSS + 折叠条，但 JS 未改（--toc-offset 恒 0）→ 预期遮挡
 *   target_offset   = 同上，但把 offset 钉成 50px（等价于 JS 断点改到 1280）→ 预期不遮挡
 *
 * 只读。结果写 <TEMP>\b2p\probe7.json。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(require("os").tmpdir() || '', 'b2p');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const BASE = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/dialogs/';

const CSS_TARGET = `
@media (min-width:1025px) and (max-width:1279.98px){
  .layout,.layout.has-toc{grid-template-columns:290px minmax(0,1fr)}
  .toc-side{grid-column:1 / -1;grid-row:1;display:block;position:sticky;top:var(--topbar-h);z-index:4;
    max-height:none;overflow:visible;margin:0 0 .75rem;padding:0;
    border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-soft);font-size:.86rem}
  .toc-side .toc-title{display:flex;align-items:center;gap:.4rem;min-height:48px;margin:0;padding:0 .75rem;
    cursor:pointer;list-style:none;font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--fg-muted)}
  .toc-side a{display:block;min-height:0;padding:.16rem .4rem}
  .sidebar{grid-column:1;grid-row:2}
  .content{grid-column:2;grid-row:2}
}`;

const VP = [[1025, 800], [1100, 800], [1279, 800], [1280, 800], [390, 844]];

const run = (variant, offsetPin) => async (page) => {
  await page.evaluate((pin) => {
    if (pin) document.documentElement.style.setProperty('--toc-offset', pin + 'px');
  }, offsetPin);
  await page.waitForTimeout(60);
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const toc = q('.toc-side');
    const heads = [...document.querySelectorAll('.article h2[id], .article h3[id], .article h4[id]')];
    const padTop = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const results = [];
    // 取第 1、4、9 个标题，逐个测「手动落点 → 是否被吸顶元素盖住」
    for (const i of [0, 3, 8]) {
      const h = heads[i];
      if (!h) continue;
      const abs = h.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, abs - padTop));
      const b = h.getBoundingClientRect();
      const px = Math.min(b.x + 25, window.innerWidth - 6);
      const py = Math.max(b.y + Math.ceil(b.height / 2), 2);
      const hit = document.elementFromPoint(px, py);
      const isToc = !!(hit && hit.closest && hit.closest('.toc-side'));
      const isTop = !!(hit && hit.closest && hit.closest('.topbar'));
      results.push({
        idx: i, id: h.id,
        headingTop: Math.round(b.top * 10) / 10,
        hitTag: hit ? hit.tagName : null, hitCls: hit && hit.className ? String(hit.className).slice(0, 40) : null,
        coveredByToc: isToc, coveredByTopbar: isTop, occluded: !!(isToc || isTop),
      });
    }
    // 代码块从吸顶条下沿开始是否可见
    const tb = document.querySelector('.topbar').getBoundingClientRect();
    const tcb = toc ? toc.getBoundingClientRect() : null;
    return {
      scrollY: Math.round(window.scrollY),
      padTop: Math.round(padTop), tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
      topbarBottom: Math.round(tb.bottom), tocBottom: tcb ? Math.round(tcb.bottom) : 0,
      tocH: tcb ? Math.round(tcb.height) : 0, tocPos: toc ? getComputedStyle(toc).position : null,
      results, occludedCount: results.filter((r) => r.occluded).length, total: results.length,
    };
  });
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const out = [];
  for (const [w, h] of VP) {
    await page.setViewportSize({ width: w, height: h });
    for (const variant of ['base', 'target_noOffset', 'target_offset']) {
      await page.goto(BASE + PAGE, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
      if (variant !== 'base' && w < 1280) {
        await page.addStyleTag({ content: CSS_TARGET });
        await page.evaluate(() => {
          document.querySelectorAll('.toc-side .toc-fold').forEach((f) => { f.removeAttribute('open'); });
          const host = document.querySelector('.toc-side'); if (host) host.classList.remove('toc-open');
        });
        await page.waitForTimeout(80);
        if (variant === 'target_offset') {
          // 钉住 offset，防止 site.js 的 toggle 监听清零
          await page.evaluate(() => {
            const toc = document.querySelector('.toc-side');
            const n = toc ? Math.round(toc.getBoundingClientRect().height) : 0;
            document.documentElement.style.setProperty('--toc-offset', n + 'px');
          });
          await page.waitForTimeout(50);
        }
      }
      const r = await run(variant, variant === 'target_offset' ? null : 0)(page);
      out.push({ vw: w, variant, ...r });
      console.log([w, variant, 'padTop=' + r.padTop, 'offset=' + r.tocOffset, 'tocH=' + r.tocH, 'tocBottom=' + r.tocBottom,
        'occluded=' + r.occludedCount + '/' + r.total,
        ...r.results.map((x) => '#' + x.idx + ':top=' + x.headingTop + ' hit=' + x.hitTag + (x.hitCls ? '.' + x.hitCls.split(' ')[0] : '') + (x.occluded ? ' 遮挡' : ' ok'))].join(' '));
    }
  }
  await browser.close();
  const f = path.join(TMP, 'probe7.json');
  fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), rows: out }, null, 1), 'utf8');
  console.log('WROTE ' + f);
})().catch((e) => { console.error(e); process.exit(1); });
