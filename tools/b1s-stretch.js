'use strict';
/**
 * b1s-stretch.js — 冲突 4：实测 owner 改后的 P0-4 折中版本
 *
 * 覆盖四件事（1280 与 390）：
 *   A. 整行命中率：把行盒横向切成 30 段，每段 elementFromPoint 看是否为拉伸后的链接
 *   B. 拖选 .src-sum / .src-rel / 整行 的真实字符数（真实鼠标 down/move/up）
 *   C. 双击取词（src-sum / src-rel）
 *   D. 右键目标（contextmenu 时 elementFromPoint 的 tag/class）
 *   E. 键盘：Tab 到 .src-link 是否出现焦点环（:has(:focus-visible)）
 * 对照：8788（old）同位置同样操作。
 * 只读站点；写 TMPDIR\b1s\stretch.json。用法: node tools/b1s-stretch.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(require("os").tmpdir() || '.', 'b1s');
fs.mkdirSync(TMP, { recursive: true });
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const PAGE = '/index.html';
const log = (o) => console.log(JSON.stringify(o));

// 把第 N 行滚到视口中部，返回其几何
async function rowInfo(page, idx) {
  return page.evaluate((i) => {
    const rows = document.querySelectorAll('.src-item');
    if (!rows[i]) return null;
    const r = rows[i];
    r.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = r.getBoundingClientRect();
    const parts = {};
    for (const k of ['src-link', 'src-sum', 'src-rel']) {
      const el = r.querySelector('.' + k);
      if (!el) continue;
      const pb = el.getBoundingClientRect();
      parts[k] = { x: +pb.x.toFixed(2), w: +pb.width.toFixed(2), h: +pb.height.toFixed(2), pe: getComputedStyle(el).pointerEvents, us: getComputedStyle(el).userSelect, text: (el.textContent || '').trim().slice(0, 40) };
    }
    return { idx: i, box: { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }, parts };
  }, idx);
}

async function hitScan(page, geo) {
  // 横向 30 段 × 行中线
  return page.evaluate((g) => {
    const out = [];
    const y = g.box.y + g.box.h / 2;
    const N = 30;
    for (let i = 0; i < N; i++) {
      const x = g.box.x + (g.box.w * (i + 0.5)) / N;
      const el = document.elementFromPoint(x, y);
      const isLink = !!(el && (el.closest && el.closest('a.src-link')));
      out.push({ pct: Math.round(((i + 0.5) / N) * 100), tag: el ? el.tagName : null, cls: el ? String(el.className).slice(0, 24) : null, link: isLink });
    }
    const links = out.filter((o) => o.link).length;
    return { cells: out.map((o) => o.pct + ':' + (o.link ? 'L' : (o.cls || o.tag))), linkPct: Math.round((links / N) * 100), deadPct: Math.round(((N - links) / N) * 100) };
  }, geo);
}

async function dragSelect(page, x1, y, x2) {
  await page.mouse.move(x1, y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y);
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
  const t = await page.evaluate(() => (window.getSelection() || '').toString());
  await page.evaluate(() => { try { window.getSelection().removeAllRanges(); } catch (e) {} });
  return { len: t.length, sample: t.slice(0, 50) };
}

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { hit: [], drag: [], dbl: [], ctx: [], focusRing: [] };

  for (const [vpName, w, h] of [['1280x800', 1280, 800], ['390x844', 390, 844]]) {
    for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.waitForTimeout(350);

      // 取一行有 src-sum + src-rel 的
      const rowCount = await page.evaluate(() => document.querySelectorAll('.src-item').length);
      const geo = await rowInfo(page, Math.min(6, rowCount - 1));
      if (!geo) { await ctx.close(); continue; }
      await page.waitForTimeout(200);
      const geo2 = await rowInfo(page, geo.idx); // 稳定后重取（scrollIntoView 后 y 会变）
      const hs = await hitScan(page, geo2);
      out.hit.push({ vp: vpName, tag, geo: geo2, scan: hs });
      log({ m: 'HIT', vp: vpName, tag, box: geo2.box, linkPct: hs.linkPct, deadPct: hs.deadPct, cells: hs.cells.join(' ') });

      // ---- 拖选 ----
      const yMid = geo2.box.y + geo2.box.h / 2;
      const p = geo2.parts;
      const rec = { vp: vpName, tag, row: geo2.idx, parts: p, drags: {} };
      if (p['src-sum']) {
        rec.drags.sum = await dragSelect(page, p['src-sum'].x + 4, yMid, p['src-sum'].x + Math.min(p['src-sum'].w - 6, 260));
      }
      if (p['src-rel']) {
        rec.drags.rel = await dragSelect(page, p['src-rel'].x + 3, yMid, p['src-rel'].x + p['src-rel'].w - 4);
      }
      // 整行拖选
      rec.drags.full = await dragSelect(page, geo2.box.x + 6, yMid, geo2.box.x + geo2.box.w - 10);
      out.drag.push(rec);
      log({ m: 'DRAG', vp: vpName, tag, sum: rec.drags.sum && rec.drags.sum.len, rel: rec.drags.rel && rec.drags.rel.len, full: rec.drags.full && rec.drags.full.len, sumTxt: rec.drags.sum && rec.drags.sum.sample });

      // ---- 双击取词 ----
      const dbl = {};
      for (const k of ['src-sum', 'src-rel']) {
        if (!p[k]) continue;
        // 双击前先把选区清空，再定位到词上
        await page.evaluate(() => { try { window.getSelection().removeAllRanges(); } catch (e) {} });
        const cx = p[k].x + Math.min(p[k].w * 0.35, 40);
        await page.mouse.move(cx, yMid);
        await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
        await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
        await page.waitForTimeout(180);
        const t = await page.evaluate(() => (window.getSelection() || '').toString());
        dbl[k] = { len: t.length, sample: t.slice(0, 40) };
        await page.evaluate(() => { try { window.getSelection().removeAllRanges(); } catch (e) {} });
      }
      rec.dbl = dbl;
      out.dbl.push({ vp: vpName, tag, dbl });
      log({ m: 'DBL', vp: vpName, tag, dbl });

      // ---- 右键目标 ----
      await page.evaluate(() => { window.__ctx = null; document.addEventListener('contextmenu', (e) => { window.__ctx = { tag: e.target.tagName, cls: String(e.target.className || '').slice(0, 30) }; }, true); });
      const ctxProbe = {};
      for (const k of ['src-sum', 'src-rel']) {
        if (!p[k]) continue;
        const cx = p[k].x + Math.min(p[k].w * 0.5, 60);
        await page.mouse.move(cx, yMid);
        await page.mouse.click(cx, yMid, { button: 'right' });
        await page.waitForTimeout(200);
        ctxProbe[k] = await page.evaluate(() => window.__ctx);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
      }
      out.ctx.push({ vp: vpName, tag, ctx: ctxProbe });
      log({ m: 'CTX', vp: vpName, tag, ctx: ctxProbe });

      // ---- 焦点环：Tab 到第一个 .src-link ----
      if (tag === 'new') {
        const fr = await page.evaluate(() => {
          const a = document.querySelector('.src-item .src-link');
          if (!a) return null;
          a.scrollIntoView({ block: 'center', behavior: 'instant' });
          a.focus({ preventScroll: true });
          // 强制 :focus-visible 需真实键盘；这里检查 CSS 规则是否存在且命中
          const item = a.closest('.src-item');
          const cs = getComputedStyle(item);
          const csA = getComputedStyle(a);
          const matched = a.matches(':focus-visible');
          return { outlineItem: cs.outline, outlineOffset: cs.outlineOffset, outlineLink: csA.outline, matchesFocusVisible: matched };
        });
        // 真实键盘路径：先点正文再按 Tab
        await page.evaluate(() => { const b = document.body; b.setAttribute('tabindex', '-1'); b.focus(); });
        await page.keyboard.press('Tab');
        let found = null;
        for (let i = 0; i < 400; i++) {
          const st = await page.evaluate(() => ({ tag: document.activeElement && document.activeElement.tagName, cls: document.activeElement && String(document.activeElement.className || '').slice(0, 30), isSrc: !!(document.activeElement && document.activeElement.matches && document.activeElement.matches('.src-item .src-link')) }));
          if (st.isSrc) {
            found = await page.evaluate(() => {
              const a = document.activeElement; const item = a.closest('.src-item');
              const csI = getComputedStyle(item); const csA = getComputedStyle(a);
              return { itemOutline: csI.outline, itemOffset: csI.outlineOffset, linkOutline: csA.outline, matches: a.matches(':focus-visible') };
            });
            break;
          }
          await page.keyboard.press('Tab');
        }
        out.focusRing.push({ vp: vpName, tabSteps: 0, cssRuleProbe: fr, realTab: found });
        log({ m: 'FOCUS', vp: vpName, fr, found });
      }
      await ctx.close();
    }
  }

  fs.writeFileSync(path.join(TMP, 'stretch.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE ' + path.join(TMP, 'stretch.json'));
  await browser.close();
})();
