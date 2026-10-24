'use strict';
/**
 * b1r2-m.js — 三个待定点
 *   M1 桌面 ≥1025 右栏不再吸顶（对 8788 改前基线证明是回归，而非既有行为）
 *   M2 1024 整数档：左栏里的 .side-toc 是否真的可达（否证"1024 死区"的说法）
 *   M3 焦点环 @supports 兜底：删除整条 @supports 块后链接自身是否仍有可见环
 * 用法: node tools/b1r2-m.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const EXE = [process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787', OLD = 'http://127.0.0.1:8788';
const PAGE = '/paper/dev/particles/';
const lines = []; const log = (s) => { lines.push(s); console.log(s); };

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const R = {};

  // ---------- M1 桌面吸顶：改后 vs 改前 ----------
  R.railSticky = [];
  for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
    for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1280x800', w: 1280, h: 800 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const read = () => page.evaluate(() => {
        const t = document.querySelector('.toc-side');
        if (!t) return { missing: true };
        const cs = getComputedStyle(t); const b = t.getBoundingClientRect();
        const visibleLinks = Array.from(t.querySelectorAll('a')).filter((a) => { const r = a.getBoundingClientRect();
          return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; }).length;
        return { pos: cs.position, top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height),
          display: cs.display, visibleLinks, inViewport: b.bottom > 0 && b.top < innerHeight };
      });
      const atTop = await read();
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(400);
      const scrolled = await read();
      await page.evaluate(() => window.scrollTo(0, 6000));
      await page.waitForTimeout(400);
      const deep = await read();
      R.railSticky.push({ tag, vp: vp.n, atTop, scrolled, deep });
      log('M1 ' + JSON.stringify({ tag, vp: vp.n, atTopPos: atTop.pos, topAtTop: atTop.top,
        top2000: scrolled.top, links2000: scrolled.visibleLinks, top6000: deep.top, links6000: deep.visibleLinks,
        inViewportDeep: deep.inViewport }));
      await ctx.close();
    }
  }

  // ---------- M2 1024 档 .side-toc 可达性 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const pre = await page.evaluate(() => {
      const st = document.querySelector('.side-toc');
      const pageToc = document.querySelector('.toc-side');
      const sb = document.querySelector('.sidebar');
      const sbR = sb.getBoundingClientRect();
      const sum = st ? st.querySelector('summary') : null;
      const sumR = sum ? sum.getBoundingClientRect() : null;
      return {
        pageTocDisplay: getComputedStyle(pageToc).display,
        sideTocExists: !!st,
        sideTocDisplay: st ? getComputedStyle(st).display : null,
        sideTocOpen: st ? st.open : null,
        sidebarPos: getComputedStyle(sb).position,
        sidebarRect: { l: Math.round(sbR.left), r: Math.round(sbR.right), w: Math.round(sbR.width) },
        summaryRect: sumR ? { w: Math.round(sumR.width), h: Math.round(sumR.height), top: Math.round(sumR.top) } : null,
        summaryVisible: sumR ? (sumR.width > 0 && sumR.height > 0 && sumR.top < innerHeight && sumR.top >= 0) : false,
      };
    });
    /* 真实点击 summary 展开，再真实点击第一个目录链接 */
    let clicked = null, landed = null;
    if (pre.summaryVisible) {
      await page.evaluate(() => { const s = document.querySelector('#drawer-toc summary'); if (s) s.click(); });
      await page.waitForTimeout(400);
      clicked = await page.evaluate(() => {
        const st = document.getElementById('drawer-toc');
        const as = Array.from(st.querySelectorAll('a[href^="#"]'));
        const vis = as.filter((a) => { const r = a.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; });
        return { open: st.open, totalLinks: as.length, visibleLinks: vis.length,
          firstHref: as.length ? as[0].getAttribute('href') : null,
          firstLinkRect: as.length ? (() => { const r = as[0].getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; })() : null };
      });
      if (clicked && clicked.firstHref) {
        await page.evaluate((h) => { const a = document.querySelector('#drawer-toc a[href="' + h + '"]'); if (a) a.click(); }, clicked.firstHref);
        await page.waitForTimeout(2200);
        landed = await page.evaluate((h) => {
          const el = document.getElementById(h.slice(1));
          if (!el) return { err: 'no target' };
          const b = el.getBoundingClientRect();
          const tb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
          return { headingTop: Math.round(b.top), topbarBottom: Math.round(tb), vh: innerHeight,
            visiblePx: Math.max(0, Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, tb))),
            hiddenUnderTopbar: b.top < tb, scrollY: Math.round(window.scrollY) };
        }, clicked.firstHref);
      }
    }
    R.dead1024 = { pre, clicked, landed };
    log('M2 ' + JSON.stringify({ pre, clicked, landed }));
    await ctx.close();
  }

  // ---------- M3 @supports 兜底：整块删除 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    R.focusFallback = await page.evaluate(() => {
      const item = document.querySelector('.src-item'); const link = item.querySelector('.src-link');
      const read = () => ({ item: getComputedStyle(item).outlineStyle + '/' + getComputedStyle(item).outlineWidth + '/' + getComputedStyle(item).outlineColor,
        link: getComputedStyle(link).outlineStyle + '/' + getComputedStyle(link).outlineWidth + '/' + getComputedStyle(link).outlineColor });
      link.focus();
      const before = read();
      /* 真删：删掉含 :has 的 CSSSupportsRule（等价于浏览器不支持 :has() 时整块不生效） */
      let deleted = 0;
      for (const sh of document.styleSheets) {
        let rs; try { rs = sh.cssRules; } catch (e) { continue; }
        for (let i = rs.length - 1; i >= 0; i--) {
          const r = rs[i];
          if (r.constructor && r.constructor.name === 'CSSSupportsRule' && r.conditionText && r.conditionText.indexOf(':has(') >= 0) {
            sh.deleteRule(i); deleted++;
          }
        }
      }
      /* 删除后要重新触发样式重算：先失焦再聚焦 */
      link.blur(); void item.offsetWidth; link.focus();
      const after = read();
      return { deleted, before, after, supportsSelector: (() => { try { return CSS.supports('selector(:has(*))'); } catch (e) { return 'err'; } })() };
    });
    log('M3 ' + JSON.stringify(R.focusFallback));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-m.json'), JSON.stringify(R, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-m.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-m.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
