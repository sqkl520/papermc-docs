'use strict';
/* b1v-probe.js — 批 1 独立验证主探针（只读，不改任何产物）
 * 用法: node tools/b1v-probe.js <port>
 * 覆盖: P0-1 / P0-3 / P0-4 / P1-3 / P1-5 / 几何不变性 / 新风险(锚点遮挡)
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '8787';
const BASE = 'http://127.0.0.1:' + PORT;

function chromePath() {
  const fs = require('fs');
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) {
    cands.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe');
    cands.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win\\chrome.exe');
  }
  if (process.env.PROGRAMFILES) cands.push(process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe');
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  throw new Error('no chrome found');
}

const PAGE_TOC = '/paper/dev/particles/index.html';   // 166 toc li, 46 code-scroll, 21 alert
const PAGE_SRC = '/index.html';                       // 109 src-item
const PAGE_CODE = '/paper/anti-xray/index.html';      // 366 hljs spans

async function settle(page, ms) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.waitForTimeout(ms || 350);
}

// ---------- P0-1: 390 折叠 / 桌面展开 ----------
async function probeToc(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await settle(page, 500);
  return await page.evaluate(() => {
    const aside = document.querySelector('.toc-side');
    const fold = document.querySelector('.toc-side .toc-fold');
    const h1 = document.querySelector('h1');
    const links = Array.from(document.querySelectorAll('.toc-side li a'));
    const vis = links.filter((a) => {
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
    const ar = aside ? aside.getBoundingClientRect() : null;
    return {
      hasTocSide: !!aside,
      hasFold: !!fold,
      foldOpen: fold ? fold.open : null,
      foldAttrOpen: fold ? fold.hasAttribute('open') : null,
      tocH: ar ? +ar.height.toFixed(1) : null,
      tocTop: ar ? +ar.top.toFixed(1) : null,
      tocSticky: aside ? getComputedStyle(aside).position : null,
      tocDisplay: aside ? getComputedStyle(aside).display : null,
      h1Y: h1 ? +(h1.getBoundingClientRect().top + window.scrollY).toFixed(1) : null,
      tocLinkCount: links.length,
      tocVisibleLinks: vis.length,
      titleMinH: aside && aside.querySelector('.toc-title')
        ? getComputedStyle(aside.querySelector('.toc-title')).minHeight : null,
      olMaxH: fold && fold.querySelector('ol')
        ? getComputedStyle(fold.querySelector('ol')).maxHeight : null,
    };
  });
}

// ---------- P0-3: 命中区尺寸 ----------
async function probeTargets(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await settle(page, 500);
  return await page.evaluate(() => {
    const measure = (sel) => {
      const els = Array.from(document.querySelectorAll(sel));
      const dims = els.map((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return {
          w: +r.width.toFixed(1), h: +r.height.toFixed(1),
          shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0,
        };
      });
      const shown = dims.filter((d) => d.shown);
      return {
        total: els.length,
        shown: shown.length,
        minW: shown.length ? Math.min(...shown.map((d) => d.w)) : null,
        minH: shown.length ? Math.min(...shown.map((d) => d.h)) : null,
        fails: shown.filter((d) => d.w < 24 || d.h < 24).length,
        sample: shown.slice(0, 3),
      };
    };
    return {
      sideHome: measure('.side-group-title a.side-home'),
      codeCopy: measure('.code-copy'),
    };
  });
}

// ---------- P0-4: 整行可点 ----------
async function probeStretch(page, width) {
  await page.setViewportSize({ width: width, height: 900 });
  await page.goto(BASE + PAGE_SRC, { waitUntil: 'load' });
  await settle(page, 500);
  return await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.src-item'));
    let fullRows = 0;
    const samples = [];
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (r.width < 50) continue;
      const y = r.top + r.height / 2 + window.scrollY;
      // 在行内取 5 个横向采样点（避开最左 2px 圆角）
      const xs = [0.05, 0.3, 0.5, 0.75, 0.95].map((f) => r.left + r.width * f);
      let hit = 0;
      for (const x of xs) {
        const el = document.elementFromPoint(x, r.top + r.height / 2);
        if (el && el.closest && el.closest('.src-item') === row) {
          const a = el.closest('a');
          if (a && a.classList.contains('src-link')) hit++;
        }
      }
      if (hit === xs.length) fullRows++;
      if (samples.length < 3) samples.push({ w: +r.width.toFixed(1), h: +r.height.toFixed(1), hit, of: xs.length });
    }
    const first = document.querySelector('.src-item');
    const linkW = first && first.querySelector('.src-link')
      ? +first.querySelector('.src-link').getBoundingClientRect().width.toFixed(1) : null;
    return {
      srcRows: rows.length,
      fullRows,
      firstLinkW: linkW,
      firstRowW: first ? +first.getBoundingClientRect().width.toFixed(1) : null,
      samples,
      linkPosition: first && first.querySelector('.src-link')
        ? getComputedStyle(first.querySelector('.src-link')).position : null,
    };
  });
}

// ---------- P1-3: data-overflowing 的 CSS 消费 ----------
async function probeOverflowHint(page, width) {
  await page.setViewportSize({ width: width, height: 900 });
  await page.goto(BASE + PAGE_CODE, { waitUntil: 'load' });
  await settle(page, 600);
  return await page.evaluate(() => {
    const scrolls = Array.from(document.querySelectorAll('.code-scroll'));
    const flagged = scrolls.filter((s) => s.hasAttribute('data-overflowing'));
    const flagged2 = Array.from(document.querySelectorAll('[data-overflowing]'));
    const hints = { fadeHasBg: 0, titleHint: 0, titleHintText: null };
    for (const s of flagged) {
      const after = getComputedStyle(s, '::after');
      const hasImg = after.content && after.content !== 'none' && after.content !== 'normal';
      const bg = after.backgroundImage;
      if (hasImg && bg && bg !== 'none') hints.fadeHasBg++;
      const block = s.closest('.code-block');
      if (block) {
        const t = block.querySelector('.code-title');
        if (t) {
          const ta = getComputedStyle(t, '::after');
          if (ta.content && ta.content !== 'none' && ta.content !== 'normal') {
            hints.titleHint++;
            if (!hints.titleHintText) hints.titleHintText = ta.content;
          }
        }
      }
    }
    return {
      codeScroll: scrolls.length,
      flaggedByAttr: flagged2.length,
      flaggedScroll: flagged.length,
      fadeAfter: hints.fadeHasBg,
      titleAfter: hints.titleHint,
      titleAfterContent: hints.titleHintText,
      anyFlaggedOverflow: flagged.some((s) => s.scrollWidth > s.clientWidth + 1),
    };
  });
}

// ---------- P1-5: alert-title 字重 ----------
async function probeWeight(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await settle(page, 400);
  return await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.alert-title'));
    const weights = {};
    let odd = 0;
    for (const e of els) {
      const w = getComputedStyle(e).fontWeight;
      weights[w] = (weights[w] || 0) + 1;
      const n = parseInt(w, 10);
      if (n % 100 !== 0) odd++;
    }
    return { count: els.length, weights, nonStandard: odd };
  });
}

// ---------- 几何不变性 ----------
async function probeGeom(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await settle(page, 600);
  return await page.evaluate(() => {
    const art = document.querySelector('article.article') || document.querySelector('article');
    const main = document.querySelector('.content') || document.querySelector('main');
    const ar = art.getBoundingClientRect();
    const cs = getComputedStyle(art);
    const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
    // measure: 段落实际行盒宽度（Range 取每个文本节点的 client rects）
    const ps = Array.from(document.querySelectorAll('article p')).slice(0, 40);
    let maxLine = 0, lines = 0, sum = 0;
    let sample = null;
    for (const p of ps) {
      const range = document.createRange();
      range.selectNodeContents(p);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 20);
      for (const r of rects) { if (r.width > maxLine) maxLine = r.width; lines++; sum += r.width; }
      if (!sample && rects.length) sample = { text: p.textContent.slice(0, 30), w: +rects[0].width.toFixed(1) };
    }
    const h1 = document.querySelector('h1');
    const sidebar = document.querySelector('.sidebar');
    return {
      articleW: +ar.width.toFixed(1),
      articleContentW: +(ar.width - padL - padR).toFixed(1),
      contentW: main ? +main.getBoundingClientRect().width.toFixed(1) : null,
      pageHeight: document.documentElement.scrollHeight,
      maxLineW: +maxLine.toFixed(1),
      avgLineW: lines ? +(sum / lines).toFixed(1) : null,
      lineSamples: lines,
      fontPx: cs.fontSize,
      lineHeight: cs.lineHeight,
      h1Y: h1 ? +(h1.getBoundingClientRect().top + window.scrollY).toFixed(1) : null,
      h1FontPx: h1 ? getComputedStyle(h1).fontSize : null,
      sidebarW: sidebar ? +sidebar.getBoundingClientRect().width.toFixed(1) : null,
      bodyScrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      sample,
    };
  });
}

// ---------- 新风险：sticky toc 是否遮挡锚点落点 ----------
async function probeAnchor(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await settle(page, 600);
  const res = [];
  for (let i = 1; i <= 3; i++) {
    const r = await page.evaluate((idx) => {
      const a = Array.from(document.querySelectorAll('.toc-side li a[href^="#"]'))[idx];
      if (!a) return null;
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      const target = document.getElementById(id);
      if (!target) return { id, missing: true };
      // 走站点自己的平滑滚动通道，然后等待
      location.hash = '#' + id;
      return { id, href: a.getAttribute('href') };
    }, i * 3);
    await page.waitForTimeout(700);
    const after = await page.evaluate((id) => {
      const t = document.getElementById(id);
      if (!t) return null;
      const r = t.getBoundingClientRect();
      const topbar = document.querySelector('.topbar');
      const tbH = topbar ? topbar.getBoundingClientRect().height : 0;
      const toc = document.querySelector('.toc-side');
      const tocR = toc ? toc.getBoundingClientRect() : null;
      // 落点中心处，最上层是谁？
      const probeY = Math.max(r.top + 4, 0);
      const el = document.elementFromPoint(Math.min(window.innerWidth - 20, r.left + 60), probeY);
      const occluder = el ? (el.closest('.toc-side') ? 'toc-side'
        : el.closest('.topbar') ? 'topbar'
        : el.closest('#' + CSS.escape(id)) ? 'target' : (el.tagName + '.' + el.className)) : 'none';
      return {
        headingTop: +r.top.toFixed(1),
        topbarH: +tbH.toFixed(1),
        tocBottom: tocR ? +tocR.bottom.toFixed(1) : null,
        scrollY: +window.scrollY.toFixed(1),
        occluder,
        clearOfTopbar: r.top >= tbH - 1,
        clearOfToc: tocR ? r.top >= tocR.bottom - 1 : null,
        scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
      };
    }, r ? r.id : null);
    res.push({ req: r, after });
  }
  return res;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });
  const out = { port: PORT, base: BASE };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();

    out.toc390 = await probeToc(page, 390, 844);
    out.toc1024 = await probeToc(page, 1024, 844);
    out.toc1280 = await probeToc(page, 1280, 900);
    out.toc1440 = await probeToc(page, 1440, 900);

    out.targets = await probeTargets(page);
    out.stretch = await probeStretch(page, 1280);
    out.overflow = await probeOverflowHint(page, 1280);
    out.weight = await probeWeight(page);

    out.geom = {};
    for (const w of [1024, 1280, 1440]) out.geom[w] = await probeGeom(page, w);

    out.anchor390 = await probeAnchor(page, 390);
    out.anchor1024 = await probeAnchor(page, 1024);

    await ctx.close();
  } catch (e) {
    out.error = String(e && e.stack || e);
  } finally {
    await browser.close();
  }
  const json = JSON.stringify(out, null, 1);
  const outPath = process.argv[3];
  if (outPath) {
    require('fs').writeFileSync(outPath, json, 'utf8');
    console.log('wrote ' + outPath + ' (' + json.length + ' bytes)');
  } else {
    console.log(json);
  }
})();
