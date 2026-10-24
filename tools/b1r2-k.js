'use strict';
/**
 * b1r2-k.js — 全量复核（针对当前构建，防"移动靶"）：一次跑完全部头条结论
 * 每次运行首尾各取一次构建指纹，若不一致则明确标注漂移。
 * 用法: node tools/b1r2-k.js
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

const fp = () => {
  const fs2 = require('fs'), p = require('path'), c = require('crypto');
  const f = (n) => { const b = fs2.readFileSync(p.join(ROOT, 'assets', n)); return { bytes: b.length, sha16: c.createHash('sha256').update(b).digest('hex').slice(0, 16) }; };
  return { css: f('site.css'), js: f('site.js') };
};

const COVER = () => {
  const toc = document.querySelector('.toc-side');
  const tb = toc.getBoundingClientRect();
  const blocks = Array.from(document.querySelectorAll('.article p, .article h2, .article h3, .article h4, .article li, .article pre'));
  let occluded = 0; const sample = [];
  for (const el of blocks) {
    const b = el.getBoundingClientRect();
    if (b.height <= 0 || b.width <= 0) continue;
    if (b.bottom <= tb.top || b.top >= tb.bottom) continue;
    const y = Math.min(b.bottom, tb.bottom) - 4;
    const x = Math.min(Math.max(b.left + 40, tb.left + 8), tb.right - 8);
    const hit = document.elementFromPoint(x, y);
    if (hit && toc.contains(hit)) { occluded++; if (sample.length < 3) sample.push({ tag: el.tagName, top: Math.round(b.top), txt: (el.textContent || '').trim().slice(0, 20) }); }
  }
  return { tocH: Math.round(tb.height), pctVh: +(100 * tb.height / innerHeight).toFixed(1),
    remainBelowPx: Math.round(innerHeight - Math.max(tb.bottom, 0)), occluded, sample };
};

(async () => {
  const before = fp();
  log('FP_BEFORE ' + JSON.stringify(before));
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const R = { fpBefore: before };

  // K1 展开态遮挡 + 落点（4 档）
  R.sticky = [];
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '768x1024', w: 768, h: 1024 }, { n: '812x375', w: 812, h: 375 }, { n: '320x568', w: 320, h: 568 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const collapsed = await page.evaluate(() => { const t = document.querySelector('.toc-side'); const b = t.getBoundingClientRect(); return { tocH: Math.round(b.height), offset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim() }; });
    await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
    await page.waitForTimeout(450);
    const expanded = await page.evaluate(COVER);
    const expOffset = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim());
    // 展开态点第 3 个目录项
    const id = await page.evaluate(() => document.querySelectorAll('.toc-side a[href^="#"]')[3].getAttribute('href').slice(1));
    await page.evaluate((x) => { document.querySelector('.toc-side a[href="#' + x + '"]').click(); }, id);
    await page.waitForTimeout(2600);
    const land = await page.evaluate((x) => {
      const b = document.getElementById(x).getBoundingClientRect();
      const mb = document.querySelector('.toc-side').getBoundingClientRect();
      return { headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom), vh: innerHeight,
        landingPct: +(100 * b.top / innerHeight).toFixed(1),
        visiblePx: Math.max(0, Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, mb.bottom))),
        headingH: Math.round(b.height), clippedBottom: b.bottom > innerHeight,
        scrollPad: getComputedStyle(document.documentElement).scrollPaddingTop };
    }, id);
    R.sticky.push({ vp: vp.n, collapsed, expanded, expOffset, land, id });
    log('K1 ' + JSON.stringify({ vp: vp.n, cH: collapsed.tocH, eH: expanded.tocH, pctVh: expanded.pctVh, remain: expanded.remainBelowPx, occluded: expanded.occluded, offsetC: collapsed.offset, offsetE: expOffset, landPct: land.landingPct, visPx: land.visiblePx, headingH: land.headingH, clipped: land.clippedBottom, pad: land.scrollPad }));
    await ctx.close();
  }

  // K2 skip 链接被 --toc-offset 推走
  R.skip = [];
  for (const vp of [{ n: '812x375', w: 812, h: 375 }, { n: '320x568', w: 320, h: 568 }]) {
    for (const st of ['collapsed', 'expanded']) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(350);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (st === 'expanded') { await page.evaluate(() => { document.querySelector('.toc-fold').open = true; }); await page.waitForTimeout(400); }
      await page.evaluate(() => { document.querySelector('.skip').focus(); });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1600);
      const r = await page.evaluate(() => {
        const first = document.querySelector('.article h1, .article h2, .article p');
        const b = first.getBoundingClientRect();
        const tb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
        const tocB = document.querySelector('.toc-side').getBoundingClientRect().bottom;
        return { firstTop: Math.round(b.top), vh: innerHeight, topbar: Math.round(tb), tocBottom: Math.round(tocB),
          visible: b.top >= Math.max(tb, tocB) && b.top < innerHeight,
          pad: getComputedStyle(document.documentElement).scrollPaddingTop };
      });
      R.skip.push({ vp: vp.n, st, ...r });
      log('K2 ' + JSON.stringify({ vp: vp.n, st, firstTop: r.firstTop, vh: r.vh, tocBottom: r.tocBottom, visible: r.visible, pad: r.pad }));
      await ctx.close();
    }
  }

  // K3 lastIsWide 旋转链
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    const snap = async (l) => ({ l, ...(await page.evaluate(() => { const d = document.querySelector('.toc-fold'); const t = document.querySelector('.toc-side'); return { vw: innerWidth, open: d ? !!d.open : null, display: getComputedStyle(t).display, tocH: Math.round(t.getBoundingClientRect().height), offset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim() }; })) });
    const steps = [await snap('390初始折叠')];
    await page.evaluate(() => { document.querySelector('.toc-fold').open = true; }); await page.waitForTimeout(300);
    steps.push(await snap('390用户展开'));
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(350);
    steps.push(await snap('旋转844同档'));
    await page.setViewportSize({ width: 1025, height: 800 }); await page.waitForTimeout(350);
    steps.push(await snap('跨到1025'));
    await page.setViewportSize({ width: 1024, height: 800 }); await page.waitForTimeout(350);
    steps.push(await snap('回1024'));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    steps.push(await snap('回390(用户选择是否还在)'));
    R.rotate = steps;
    steps.forEach((s) => log('K3 ' + JSON.stringify(s)));
    await ctx.close();
  }

  // K4 抽屉：焦点是否在视口内 / 净位移
  R.drawer = [];
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '320x568', w: 320, h: 568 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const snap = () => page.evaluate(() => {
      const side = document.querySelector('.sidebar'); const sr = side.getBoundingClientRect();
      const ae = document.activeElement; const ar = ae ? ae.getBoundingClientRect() : null;
      return { y: Math.round(window.pageYOffset), drawerScrollTop: Math.round(side.scrollTop),
        focus: ae ? ae.tagName + '.' + String(ae.className || '').split(' ')[0] : null,
        focusTop: ar ? Math.round(ar.top) : null,
        focusInDrawer: ar ? (ar.top >= sr.top && ar.bottom <= sr.bottom && ar.height > 0) : null,
        activeTop: (() => { const a = side.querySelector('a.active,[aria-current="page"]'); return a ? Math.round(a.getBoundingClientRect().top) : null; })(),
        invisibleFocus: !!(ar && (ar.bottom <= sr.top || ar.top >= sr.bottom)) };
    });
    await page.evaluate(() => window.scrollTo(0, 4200)); await page.waitForTimeout(400);
    const a0 = await snap();
    await page.click('.sidebar-toggle'); await page.waitForTimeout(550);
    const a1 = await snap();
    await page.click('.sidebar-toggle'); await page.waitForTimeout(550);
    const a2 = await snap();
    await page.click('.sidebar-toggle'); await page.waitForTimeout(450);
    await page.click('.sidebar-toggle'); await page.waitForTimeout(450);
    const a3 = await snap();
    R.drawer.push({ vp: vp.n, a0, a1, a2, a3, net1: a2.y - a0.y, net2: a3.y - a0.y });
    log('K4 ' + JSON.stringify({ vp: vp.n, y0: a0.y, yOpen: a1.y, yClose: a2.y, y2cycles: a3.y, net1: a2.y - a0.y, net2: a3.y - a0.y, focus: a1.focus, focusTop: a1.focusTop, focusInDrawer: a1.focusInDrawer, activeTop: a1.activeTop, invisibleFocus: a1.invisibleFocus }));
    await ctx.close();
  }

  // K5 :has() 焦点环（CSSOM 改写）
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    R.hasFocus = await page.evaluate(() => {
      const item = document.querySelector('.src-item'); const link = item.querySelector('.src-link');
      const read = () => ({ item: getComputedStyle(item).outlineStyle + '/' + getComputedStyle(item).outlineWidth, link: getComputedStyle(link).outlineStyle + '/' + getComputedStyle(link).outlineWidth });
      link.focus();
      const withHas = read();
      let n = 0;
      for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; }
        for (const r of rules) { if (r.selectorText && r.selectorText.includes(':has(') && r.selectorText.includes('src-item')) { try { r.selectorText = '.b1r2-x'; n++; } catch (e) {} } } }
      const withoutHas = read();
      return { rewritten: n, withHas, withoutHas, supportsHas: (() => { try { return CSS.supports('selector(:has(a))'); } catch (e) { return 'err'; } })() };
    });
    log('K5 ' + JSON.stringify(R.hasFocus));
    await ctx.close();
  }

  // K6 主题按钮窄屏可识别性
  R.themeBtn = [];
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '480x800', w: 480, h: 800 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const b = document.getElementById('theme-toggle'); const br = b.getBoundingClientRect();
      const vis = Array.from(b.children).filter((c) => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 0).map((c) => c.className);
      return { w: +br.width.toFixed(1), h: +br.height.toFixed(1), visibleChildren: vis, aria: b.getAttribute('aria-label'), text: (b.textContent || '').trim() };
    });
    R.themeBtn.push({ vp: vp.n, ...r });
    log('K6 ' + JSON.stringify({ vp: vp.n, ...r }));
    await ctx.close();
  }

  // K7 1024 死区
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    const at = async (w) => { await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(350);
      return page.evaluate(() => { const t = document.querySelector('.toc-side'); const d = document.querySelector('.toc-fold');
        return { vw: innerWidth, display: getComputedStyle(t).display, tocH: Math.round(t.getBoundingClientRect().height), open: d ? !!d.open : null,
          onClickableToc: (() => { const a = document.querySelector('.toc-side a[href^="#"]'); if (!a) return 0; const r = a.getBoundingClientRect(); return r.height > 0 ? 1 : 0; })(),
          drawerToc: !!document.getElementById('drawer-toc'),
          sidebarToggleVisible: (() => { const s = document.querySelector('.sidebar-toggle'); return s ? getComputedStyle(s).display !== 'none' : null; })(),
          sidebarStatic: getComputedStyle(document.querySelector('.sidebar')).position }; }); };
    R.deadBand = [await at(1023), await at(1024), await at(1025)];
    R.deadBand.forEach((x) => log('K7 ' + JSON.stringify(x)));
    await ctx.close();
  }

  // K8 17.5em em 基准（浏览器默认字号 24px）
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    R.emBasis = [];
    for (const f of [16, 20, 24]) {
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: f, fixed: Math.round(f * 0.8125) } });
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => ({ htmlFs: getComputedStyle(document.documentElement).fontSize,
        mq17_5: matchMedia('(max-width:17.5em)').matches, mq280: matchMedia('(max-width:280px)').matches,
        pad: (() => { const l = document.querySelector('.src-list[data-depth="3"]'); return l ? getComputedStyle(l).paddingLeft : null; })(),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      r.defaultFont = f; R.emBasis.push(r); log('K8 ' + JSON.stringify(r));
    }
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 13 } });
    await ctx.close();
  }

  // K9 200%/160px 溢出
  R.overflow = [];
  for (const w of [320, 280, 200, 160]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 640 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(350);
    const r = await page.evaluate(() => {
      const dw = document.documentElement.clientWidth; const culprits = [];
      document.querySelectorAll('*').forEach((el) => { const b = el.getBoundingClientRect();
        if (b.width > 0 && b.right > dw + 1) culprits.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 18), right: Math.round(b.right), w: Math.round(b.width) }); });
      return { vw: innerWidth, scrollW: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth - dw, count: culprits.length, top: culprits.slice(0, 4) };
    });
    R.overflow.push(r); log('K9 ' + JSON.stringify(r));
    await ctx.close();
  }

  // K10 几何（8787 vs 8788）
  R.geom = [];
  for (const pg of ['/paper/dev/particles/', '/paper/dev/dialogs/', '/paper/reference/system-properties/']) {
    for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1025x800', w: 1025, h: 800 }]) {
      const row = { page: pg, vp: vp.n };
      for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
        const page = await ctx.newPage();
        await page.goto(base + pg, { waitUntil: 'load' });
        await page.waitForTimeout(300);
        row[tag] = await page.evaluate(() => { const a = document.querySelector('article.article') || document.querySelector('article'); const r = a ? a.getBoundingClientRect() : null;
          return { pageHeight: document.documentElement.scrollHeight, articleW: r ? +r.width.toFixed(2) : null, tocDisplay: (() => { const t = document.querySelector('.toc-side'); return t ? getComputedStyle(t).display : null; })() }; });
        await ctx.close();
      }
      row.dW = +(row.new.articleW - row.old.articleW).toFixed(2);
      row.dH = row.new.pageHeight - row.old.pageHeight;
      R.geom.push(row);
      log('K10 ' + JSON.stringify(row));
    }
  }

  // K11 渐隐条到最右
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    R.fade = await page.evaluate(async () => {
      const hs = Array.from(document.querySelectorAll('.code-scroll')).filter((h) => h.scrollWidth > h.clientWidth + 1);
      if (!hs.length) return { err: 'none' };
      const h = hs.sort((a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth))[0];
      const read = () => ({ sl: Math.round(h.scrollLeft), max: Math.round(h.scrollWidth - h.clientWidth),
        afterW: getComputedStyle(h, '::after').width, afterOpacity: getComputedStyle(h, '::after').opacity,
        bg: getComputedStyle(h, '::after').backgroundImage.slice(0, 40) });
      const at0 = read();
      h.scrollLeft = h.scrollWidth; await new Promise((r) => setTimeout(r, 250));
      return { at0, atMax: read(), dataOverflowing: h.hasAttribute('data-overflowing') };
    });
    log('K11 ' + JSON.stringify(R.fade));
    await ctx.close();
  }

  await browser.close();
  const after = fp();
  R.fpAfter = after;
  R.drifted = JSON.stringify(before) !== JSON.stringify(after);
  log('FP_AFTER ' + JSON.stringify(after) + ' DRIFTED=' + R.drifted);
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-k.json'), JSON.stringify(R, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-k.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-k.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
