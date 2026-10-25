'use strict';
/**
 * cr-probe.js — 红队独立测量：对「6 条声称改动」做运行时模拟（CSS 注入），
 * 在**未改动**的站点上同时量 baseline 与 simulated，给出数值判定。
 *
 * 只读：不写源码/产物；截图落到 TMPDIR\cr\。
 *
 * 用法：node tools/cr-probe.js [--only=C1,C3,...]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(require("os").tmpdir() || '.', 'cr');
fs.mkdirSync(OUT, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const BASE = 'http://127.0.0.1:8787';

/* ---------------- 模拟各条改动的 CSS（与计划声称的写法一致） ---------------- */
const SIM = {
  // C1: .code-pre 加 font-size:.875rem
  C1: `.code-pre{font-size:.875rem}`,
  // C2: 段落封顶 40rem（计划用 :is(p,ul,ol,blockquote,dl)）
  C2: `.article :is(p,ul,ol,blockquote,dl){max-width:40rem}`,
  // C2b: 任务书口径：只限 p
  C2p: `.article p{max-width:40rem}`,
  // C5a: h5 17px
  C5h5: `.article h5{font-size:17px}`,
  // C5b: 表格单元格断词
  C5td: `.table-wrap td{overflow-wrap:break-word}`,
  // C5c: 筛选框 sticky（计划：筛选条吸顶）
  C5filter: `.filter-bar{position:sticky;top:var(--topbar-h);z-index:5;background:var(--bg);border-bottom:1px solid var(--border)}`,
  // C5d: 侧栏 ▸ 换三角
  C5tri: '.side-cat>summary::marker{content:"\u25B8  "}',
  // C3: 侧栏 + TOC 同绑 1200（把 1024/1025 两个断点整体推到 1200）
  C3: `
@media (min-width:1024px){ .layout{grid-template-columns:280px minmax(0,1fr)} .layout.has-toc{grid-template-columns:280px minmax(0,1fr)} .toc-side{display:none} .content{padding:1.4rem 1.6rem 3rem;max-width:1000px} }
@media (min-width:1200px){ .layout{grid-template-columns:290px minmax(0,1fr)} .layout.has-toc{grid-template-columns:290px minmax(0,1fr) 250px} .toc-side{order:0;display:block;position:sticky;top:var(--topbar-h);max-height:calc(100vh - var(--topbar-h));overflow-y:auto;padding:1rem .9rem 2rem;border:0;border-left:1px solid var(--border);border-radius:0;background:transparent;font-size:.82rem;margin:0} .toc-side a{display:block;min-height:0;padding:.16rem .4rem} .side-toc{display:none} }
`,
};

/* ---------------- 页面内采集函数 ---------------- */
const MEASURE = function () {
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
  const cs = (el, p) => (el ? getComputedStyle(el).getPropertyValue(p) : null);

  const res = {};
  res.vw = window.innerWidth;
  res.scrollW = document.documentElement.scrollWidth;
  res.pageH = document.documentElement.scrollHeight;
  res.hScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

  // 布局列
  const layout = q('.layout');
  if (layout) res.cols = getComputedStyle(layout).gridTemplateColumns;
  res.article = R(q('.article'));
  res.tocSide = R(q('.toc-side'));
  res.tocDisplay = cs(q('.toc-side'), 'display');
  res.tocPos = cs(q('.toc-side'), 'position');
  res.sidebarPos = cs(q('.sidebar'), 'position');
  res.contentW = R(q('.content'));

  // C1：代码块行推进 / 字号 / 横滚
  const pres = qa('.code-pre');
  res.codePre = pres.slice(0, 6).map((pre) => {
    const code = pre.querySelector('code');
    const r = pre.getBoundingClientRect();
    let adv = null;
    // 用两行 span 的 y 差算真实行推进
    const lines = code ? Array.from(code.children).filter((c) => c.nodeType === 1) : [];
    if (lines.length >= 2) {
      const a = lines[0].getBoundingClientRect(), b = lines[Math.min(1, lines.length - 1)].getBoundingClientRect();
      if (b.y - a.y > 0) adv = +(b.y - a.y).toFixed(2);
    }
    if (adv == null && lines.length === 1) {
      // 单行：用两行时的高度差不可得，退回 lineHeight
      adv = parseFloat(cs(code || pre, 'line-height'));
    }
    return {
      preFont: cs(pre, 'font-size'), codeFont: cs(code || pre, 'font-size'),
      preLH: cs(pre, 'line-height'), codeLH: cs(code || pre, 'line-height'),
      advance: adv, clientW: Math.round(pre.clientWidth), scrollW: Math.round(pre.scrollWidth),
      overflowX: pre.scrollWidth > pre.clientWidth + 1,
      scrollWrapOverflow: (function () { const w = pre.parentElement; return w ? w.scrollWidth > w.clientWidth + 1 : null; })(),
    };
  });
  res.codeCount = pres.length;
  res.codeOverflowCount = pres.filter((p) => p.scrollWidth > p.clientWidth + 1).length;

  // 行内 code 是否被误伤
  const inlineCodes = qa('.article p > code, .article li > code, .article h2 code, .article h3 code');
  res.inlineCode = inlineCodes.slice(0, 5).map((c) => ({ font: cs(c, 'font-size'), lh: cs(c, 'line-height') }));
  res.inlineCodeCount = inlineCodes.length;

  // 打印样式下的 pre
  res.printCodeFont = (function () {
    const p = q('.code-pre'); if (!p) return null;
    const m = Array.from(document.styleSheets).flatMap((s) => { try { return Array.from(s.cssRules); } catch (e) { return []; } })
      .filter((r) => r.media && /print/.test(r.conditionText || ''));
    return { printBlocks: m.length };
  })();

  // C2：正文行宽（字符数 / 像素）
  const capOf = (el) => el ? Math.round(el.getBoundingClientRect().width) : null;
  const ps = qa('.article p').filter((p) => p.textContent.trim().length > 40);
  res.para = {
    count: ps.length,
    widths: ps.slice(0, 8).map(capOf),
    maxW: ps.length ? Math.max.apply(null, ps.map(capOf)) : null,
    minW: ps.length ? Math.min.apply(null, ps.map(capOf)) : null,
  };
  const codeBlocks = qa('.code-scroll');
  res.codeWrapW = codeBlocks.length ? Math.round(codeBlocks[0].getBoundingClientRect().width) : null;
  const tables = qa('.table-wrap');
  res.tableWrapW = tables.length ? Math.round(tables[0].getBoundingClientRect().width) : null;

  // 左侧起边：正文 p 与 code 块是否对齐（锯齿判据）
  res.leftEdge = {
    p: ps.length ? +ps[0].getBoundingClientRect().x.toFixed(2) : null,
    code: codeBlocks.length ? +codeBlocks[0].getBoundingClientRect().x.toFixed(2) : null,
    table: tables.length ? +tables[0].getBoundingClientRect().x.toFixed(2) : null,
  };
  // 右边缘参差
  res.rightEdge = {
    p: ps.length ? +ps[0].getBoundingClientRect().right.toFixed(2) : null,
    code: codeBlocks.length ? +codeBlocks[0].getBoundingClientRect().right.toFixed(2) : null,
    table: tables.length ? +tables[0].getBoundingClientRect().right.toFixed(2) : null,
  };

  // C5：h5 宽度 vs 容器
  const h5s = qa('.article h5');
  res.h5 = {
    count: h5s.length,
    longest: h5s.map((h) => ({ t: h.textContent.trim().slice(0, 70), w: +h.getBoundingClientRect().width.toFixed(2), sh: h.scrollWidth, fs: cs(h, 'font-size'), lines: Math.round(h.getBoundingClientRect().height / parseFloat(cs(h, 'line-height') || '1')) }))
      .sort((a, b) => b.w - a.w).slice(0, 5),
    overflow: h5s.filter((h) => h.scrollWidth > h.clientWidth + 1).length,
  };

  // C5：表格 td 断词 —— 最大单词宽度 & 溢出
  const tds = qa('.table-wrap td');
  res.td = {
    count: tds.length,
    overflow: tds.filter((t) => t.scrollWidth > t.clientWidth + 1).length,
    maxScrollOver: tds.length ? Math.max.apply(null, tds.map((t) => t.scrollWidth - t.clientWidth)) : null,
    tableWrapOverflow: tables.map((t) => ({ cw: t.clientWidth, sw: t.scrollWidth, over: t.scrollWidth > t.clientWidth + 1 })),
    // 长 API 名示例宽度
    samples: tds.filter((t) => t.textContent.trim().length > 2).slice(0, 6).map((t) => ({ t: t.textContent.trim().slice(0, 34), w: Math.round(t.getBoundingClientRect().width), h: Math.round(t.getBoundingClientRect().height), ow: cs(t, 'overflow-wrap') })),
  };

  // C5：筛选条 sticky 是否盖表头
  const fb = q('.filter-bar');
  res.filterBar = fb ? { pos: cs(fb, 'position'), top: cs(fb, 'top'), z: cs(fb, 'z-index'), r: R(fb), h: Math.round(fb.getBoundingClientRect().height) } : null;
  const thead = q('.table-wrap thead th');
  res.thead = thead ? R(thead) : null;
  const topbar = q('.topbar');
  res.topbar = topbar ? { r: R(topbar), pos: cs(topbar, 'position'), z: cs(topbar, 'z-index') } : null;

  // C5 / C3：TOC aria-current 与滚动高亮同步
  const tocLinks = qa('.toc-side a[href^="#"], .side-toc a[href^="#"]');
  res.toc = {
    count: tocLinks.length,
    ariaCurrent: tocLinks.filter((a) => a.hasAttribute('aria-current')).map((a) => ({ href: a.getAttribute('href'), v: a.getAttribute('aria-current'), cls: a.className })),
    activeCls: tocLinks.filter((a) => /(^|\s)(active|is-active)(\s|$)/.test(a.className)).map((a) => a.getAttribute('href')),
  };

  // 锚点遮挡判据：--toc-offset 与 heading 的 scroll-margin
  res.tocOffset = getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim();
  const h2 = q('.article h2[id]');
  res.headingScrollMargin = h2 ? cs(h2, 'scroll-margin-top') : null;
  res.headingIds = qa('.article h2[id], .article h3[id]').length;

  return res;
};

/* ---------------- C3/C5 专项：锚点遮挡实测（点 TOC 链接后标题是否可见） ---------------- */
const ANCHOR_TEST = async (page) => {
  return await page.evaluate(async () => {
    const topbar = document.querySelector('.topbar');
    const topbarH = topbar ? topbar.getBoundingClientRect().height : 0;
    const toc = document.querySelector('.toc-side');
    const tocSticky = toc && getComputedStyle(toc).position === 'sticky' && getComputedStyle(toc).display !== 'none';
    // TOC 若是吸顶条（不在右栏），它自己会盖住正文顶部
    const tocBottom = tocSticky ? toc.getBoundingClientRect().bottom : 0;
    const covers = [];
    const links = Array.from(document.querySelectorAll('.toc-side a[href^="#"]'));
    for (const a of links.slice(0, 6)) {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      const h = document.getElementById(id);
      if (!h) { covers.push({ href: a.getAttribute('href'), ok: null, reason: 'no-target' }); continue; }
      h.scrollIntoView();
      await new Promise((r) => setTimeout(r, 60));
      const r = h.getBoundingClientRect();
      // 可见判据：标题矩形完全落在 遮挡带 之下
      const occl = Math.max(topbarH, tocBottom);
      covers.push({
        href: a.getAttribute('href'),
        top: +r.top.toFixed(2),
        bar: +occl.toFixed(2),
        visible: r.top >= occl - 0.5,
        hiddenBy: +(occl - r.top).toFixed(2),
      });
    }
    return { topbarH: +topbarH.toFixed(2), tocBottom: +tocBottom.toFixed(2), tocSticky, covers };
  });
};

const PAGES = {
  cli: '/paper/reference/cli-arguments/',
  dialogs: '/paper/dev/dialogs/',
  worldcfg: '/paper/reference/world-configuration/',
  sysprops: '/paper/reference/system-properties/',
  index: '/index.html',
  allpages: '/all-pages.html',
  particles: '/paper/dev/particles/',
};

async function newPage(browser, width, height) {
  const ctx = await browser.newContext({
    viewport: { width: width, height: height || 900 },
    deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function load(page, url, css) {
  await page.goto(BASE + url, { waitUntil: 'load', timeout: 45000 });
  if (css) {
    await page.addStyleTag({ content: css });
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(150);
}

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const want = (k) => !only.length || only.includes(k);
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = {};

  /* ============ 攻击 A2：C1 代码字号副作用 ============ */
  if (want('C1')) {
    const r = { rows: [] };
    for (const name of ['dialogs', 'worldcfg', 'particles']) {
      for (const w of [390, 768, 1024, 1440]) {
        const { ctx, page } = await newPage(browser, w);
        await load(page, PAGES[name], null);
        const base = await page.evaluate(MEASURE);
        await page.addStyleTag({ content: SIM.C1 });
        await page.waitForTimeout(150);
        const sim = await page.evaluate(MEASURE);
        r.rows.push({
          page: name, vw: w,
          advance: [base.codePre[0] && base.codePre[0].advance, sim.codePre[0] && sim.codePre[0].advance],
          preFont: [base.codePre[0] && base.codePre[0].preFont, sim.codePre[0] && sim.codePre[0].preFont],
          codeFont: [base.codePre[0] && base.codePre[0].codeFont, sim.codePre[0] && sim.codePre[0].codeFont],
          codeOverflow: [base.codeOverflowCount, sim.codeOverflowCount],
          codeCount: base.codeCount,
          inlineCodeFont: [base.inlineCode[0] && base.inlineCode[0].font, sim.inlineCode[0] && sim.inlineCode[0].font],
          inlineCodeCount: base.inlineCodeCount,
          pageH: [base.pageH, sim.pageH],
          hScroll: [base.hScroll, sim.hScroll],
        });
        // 打印媒体下的字号
        await page.emulateMedia({ media: 'print' });
        const pr = await page.evaluate(() => {
          const p = document.querySelector('.code-pre');
          const c = p && p.querySelector('code');
          return { pre: p ? getComputedStyle(p).fontSize : null, code: c ? getComputedStyle(c).fontSize : null };
        });
        r.rows[r.rows.length - 1].print = pr;
        await page.emulateMedia({ media: 'screen' });
        await ctx.close();
      }
    }
    out.C1 = r;
  }

  /* ============ 攻击 A6：C2 段落封顶（锯齿） ============ */
  if (want('C2')) {
    const r = { rows: [] };
    for (const name of ['worldcfg', 'dialogs', 'cli']) {
      for (const w of [390, 768, 1024, 1200, 1440]) {
        const { ctx, page } = await newPage(browser, w);
        await load(page, PAGES[name], null);
        const base = await page.evaluate(MEASURE);
        await page.addStyleTag({ content: SIM.C2 });
        await page.waitForTimeout(150);
        const sim = await page.evaluate(MEASURE);
        r.rows.push({
          page: name, vw: w,
          pMax: [base.para.maxW, sim.para.maxW],
          codeW: [base.codeWrapW, sim.codeWrapW],
          tableW: [base.tableWrapW, sim.tableWrapW],
          leftEdge: [base.leftEdge, sim.leftEdge],
          rightEdge: [base.rightEdge, sim.rightEdge],
          pageH: [base.pageH, sim.pageH],
          hScroll: [base.hScroll, sim.hScroll],
          articleW: [base.article && base.article.w, sim.article && sim.article.w],
        });
        if (w === 1440) {
          await page.screenshot({ path: path.join(OUT, 'c2-' + name + '-1440.png'), fullPage: false });
        }
        await ctx.close();
      }
    }
    // 只限 p 的变体（任务书口径）
    const { ctx, page } = await newPage(browser, 1440);
    await load(page, PAGES.worldcfg, null);
    const b0 = await page.evaluate(MEASURE);
    await page.addStyleTag({ content: SIM.C2p });
    await page.waitForTimeout(150);
    const sp = await page.evaluate(MEASURE);
    r.pOnlyAt1440 = { pMax: [b0.para.maxW, sp.para.maxW], codeW: [b0.codeWrapW, sp.codeWrapW], pageH: [b0.pageH, sp.pageH] };
    await ctx.close();
    out.C2 = r;
  }

  /* ============ 攻击 A4：C5 四条 ============ */
  if (want('C5')) {
    const r = { h5: [], td: [], filter: [], aria: [] };
    // h5：cli-arguments 有最多 h5
    for (const w of [390, 768, 1024, 1200, 1440]) {
      const { ctx, page } = await newPage(browser, w);
      await load(page, PAGES.cli, null);
      const base = await page.evaluate(MEASURE);
      await page.addStyleTag({ content: SIM.C5h5 });
      await page.waitForTimeout(150);
      const sim = await page.evaluate(MEASURE);
      r.h5.push({
        vw: w, count: base.h5.count,
        baseOverflow: base.h5.overflow, simOverflow: sim.h5.overflow,
        baseTop: base.h5.longest[0], simTop: sim.h5.longest[0],
        basePageH: base.pageH, simPageH: sim.pageH,
        articleW: [base.article && base.article.w, sim.article && sim.article.w],
      });
      await ctx.close();
    }
    // td 断词：sysprops + allpages
    for (const name of ['sysprops', 'cli']) {
      for (const w of [390, 1024, 1440]) {
        const { ctx, page } = await newPage(browser, w);
        await load(page, PAGES[name], null);
        const base = await page.evaluate(MEASURE);
        await page.addStyleTag({ content: SIM.C5td });
        await page.waitForTimeout(150);
        const sim = await page.evaluate(MEASURE);
        r.td.push({
          page: name, vw: w,
          tdCount: base.td.count,
          overflow: [base.td.overflow, sim.td.overflow],
          maxOver: [base.td.maxScrollOver, sim.td.maxScrollOver],
          wrapW: base.tableWrapW, simWrapW: sim.tableWrapW,
          pageH: [base.pageH, sim.pageH],
          sampleBase: base.td.samples.slice(0, 3), sampleSim: sim.td.samples.slice(0, 3),
        });
        await ctx.close();
      }
    }
    // 筛选条 sticky 盖表头：all-pages.html 有 filter-bar + 大表
    for (const w of [768, 1024, 1440]) {
      const { ctx, page } = await newPage(browser, w);
      await load(page, PAGES.allpages, null);
      const base = await page.evaluate(MEASURE);
      await page.addStyleTag({ content: SIM.C5filter });
      await page.waitForTimeout(200);
      // 滚动到表头附近，检查 sticky 筛选条是否覆盖 thead
      const cover = await page.evaluate(async () => {
        const fb = document.querySelector('.filter-bar');
        const th = document.querySelector('.table-wrap thead th');
        if (!fb || !th) return { ok: false };
        window.scrollTo(0, th.getBoundingClientRect().top + window.scrollY - 120);
        await new Promise((r) => setTimeout(r, 120));
        let best = null;
        for (let dy = -60; dy <= 60; dy += 4) {
          window.scrollTo(0, window.scrollY + dy);
          await new Promise((r) => setTimeout(r, 16));
          const a = fb.getBoundingClientRect(), b = th.getBoundingClientRect();
          const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlap > 0) {
            // 命中测试：表头中心点最上层元素是不是筛选条
            const cx = Math.min(b.right, a.right) - 8;
            const cy = Math.max(a.top, b.top) + 2;
            const el = document.elementFromPoint(cx, cy);
            const hit = el ? (fb.contains(el) || el === fb) : false;
            if (!best || overlap > best.overlap) best = { overlap: +overlap.toFixed(2), hit, cx: Math.round(cx), cy: Math.round(cy) };
          }
        }
        return { ok: true, best, fbPos: getComputedStyle(fb).position, fbZ: getComputedStyle(fb).zIndex };
      });
      r.filter.push({ vw: w, base: base.filterBar, cover });
      if (w === 1440) await page.screenshot({ path: path.join(OUT, 'c5-filter-1440.png') });
      await ctx.close();
    }
    // aria-current 与滚动高亮同步：滚动过程中比对
    {
      const { ctx, page } = await newPage(browser, 1440);
      await load(page, PAGES.worldcfg, null);
      const sync = await page.evaluate(async () => {
        const links = Array.from(document.querySelectorAll('.toc-side a[href^="#"]'));
        const out = [];
        for (const a of links.slice(0, 8)) {
          const id = decodeURIComponent(a.getAttribute('href').slice(1));
          const h = document.getElementById(id);
          if (!h) continue;
          window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 200);
          await new Promise((r) => setTimeout(r, 350));
          const cur = Array.from(document.querySelectorAll('.toc-side a[aria-current]')).map((x) => x.getAttribute('href'));
          const act = Array.from(document.querySelectorAll('.toc-side a.active')).map((x) => x.getAttribute('href'));
          out.push({ scrolledTo: a.getAttribute('href'), ariaCurrent: cur, activeClass: act, same: JSON.stringify(cur) === JSON.stringify(act) });
        }
        return out;
      });
      r.aria = sync;
      await ctx.close();
    }
    out.C5 = r;
  }

  /* ============ 攻击 A5：C3 断点 1200 ============ */
  if (want('C3')) {
    // 1) 断点前后列宽曲线（baseline vs simulated），1023..1300
    const widths = [1023, 1024, 1025, 1100, 1199, 1200, 1280, 1300, 1440, 1540, 1541];
    const curve = [];
    for (const w of widths) {
      const { ctx, page } = await newPage(browser, w);
      await load(page, PAGES.dialogs, null);
      const base = await page.evaluate(MEASURE);
      await page.addStyleTag({ content: SIM.C3 });
      await page.waitForTimeout(150);
      const sim = await page.evaluate(MEASURE);
      curve.push({
        vw: w,
        baseArticle: base.article && base.article.w, simArticle: sim.article && sim.article.w,
        baseCols: base.cols, simCols: sim.cols,
        baseToc: base.tocDisplay, simToc: sim.tocDisplay,
        baseH: base.pageH, simH: sim.pageH,
      });
      await ctx.close();
    }
    out.C3 = { curve };

    // 2) 锚点遮挡：1025–1199 档（syncTocOffset 写死 <1025）
    const anchor = [];
    for (const w of [1025, 1100, 1150, 1199, 1200, 1440]) {
      const { ctx, page } = await newPage(browser, w);
      await load(page, PAGES.worldcfg, null);
      const base = await page.evaluate(MEASURE);
      await page.addStyleTag({ content: SIM.C3 });
      await page.waitForTimeout(200);
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(150);
      const at = await ANCHOR_TEST(page);
      const sim = await page.evaluate(MEASURE);
      anchor.push({
        vw: w, tocOffset: { base: base.tocOffset, sim: sim.tocOffset },
        tocPos: { base: [base.tocDisplay, base.tocPos], sim: [sim.tocDisplay, sim.tocPos] },
        topbarH: at.topbarH, tocBottom: at.tocBottom, tocSticky: at.tocSticky,
        covers: at.covers,
        visibleCount: at.covers.filter((c) => c.visible === true).length,
        total: at.covers.filter((c) => c.visible !== null).length,
      });
      await ctx.close();
    }
    out.C3.anchor = anchor;
  }

  /* ============ 自测 A7/A8：C4 图片 width/height 变形 ============ */
  if (want('C4')) {
    const { ctx, page } = await newPage(browser, 1440);
    // 找 3 张不同纵横比的 content-img
    await load(page, PAGES.sysprops, null);
    const imgs = await page.evaluate(async () => {
      const all = Array.from(document.querySelectorAll('img.content-img'));
      const info = all.map((im) => ({ src: im.getAttribute('src'), nw: im.naturalWidth, nh: im.naturalHeight, w: Math.round(im.getBoundingClientRect().width), h: Math.round(im.getBoundingClientRect().height), cls: im.className }));
      return info;
    });
    out.C4 = { imagesOnPage: imgs.length, imgs: imgs.slice(0, 10) };
    await ctx.close();

    // 在含较多图片的页面实测：注入 width/height 属性看是否变形
    const targets = ['/paper/dev/dialogs/', '/paper/reference/system-properties/', '/paper/admin/getting-started/'];
    const distort = [];
    for (const url of targets) {
      const { ctx, page } = await newPage(browser, 1440);
      await page.goto(BASE + url, { waitUntil: 'load' });
      const res = await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll('img.content-img')).filter((i) => i.naturalWidth > 0);
        const out = [];
        for (const im of imgs.slice(0, 4)) {
          const before = im.getBoundingClientRect();
          const ar0 = before.width / before.height;
          const natAR = im.naturalWidth / im.naturalHeight;
          im.setAttribute('width', String(im.naturalWidth));
          im.setAttribute('height', String(im.naturalHeight));
          await new Promise((r) => requestAnimationFrame(r));
          const after = im.getBoundingClientRect();
          const ar1 = after.width / after.height;
          out.push({
            src: (im.getAttribute('src') || '').slice(-48),
            nat: [im.naturalWidth, im.naturalHeight], natAR: +natAR.toFixed(4),
            beforeWH: [+before.width.toFixed(2), +before.height.toFixed(2)], ar0: +ar0.toFixed(4),
            afterWH: [+after.width.toFixed(2), +after.height.toFixed(2)], ar1: +ar1.toFixed(4),
            arDelta: +Math.abs(ar1 - ar0).toFixed(4),
            distortPct: +(Math.abs(ar1 - ar0) / Math.max(ar0, 1e-6) * 100).toFixed(2),
          });
          im.removeAttribute('width'); im.removeAttribute('height');
        }
        return out;
      });
      distort.push({ url, imgs: res });
      await ctx.close();
    }
    out.C4.distort = distort;
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(out, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(out));
})();
