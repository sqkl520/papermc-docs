'use strict';
/* b1v-probe2.js — 批 1 独立验证：P0-2 抽屉 / 深色对比度 / 几何归因(P0 分解) / 选择复制风险 / 锚点遮挡
 * 用法: node tools/b1v-probe2.js <port> <outPath>
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const PORT = process.argv[2] || '8787';
const OUT = process.argv[3];
const BASE = 'http://127.0.0.1:' + PORT;

function chromePath() {
  const c = [];
  if (process.env.CHROME_PATH) c.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) {
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe');
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win\\chrome.exe');
  }
  if (process.env.PROGRAMFILES) c.push(process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe');
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  throw new Error('no chrome');
}

const PAGE_TOC = '/paper/dev/particles/index.html';
const PAGE_LAND = '/index.html';
const PAGE_CODE = '/paper/anti-xray/index.html';

// ---------- P0-2: 抽屉开合 3 次，scrollY 净位移 ----------
async function probeDrawer(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  // 滚到页面中部
  const mid = await page.evaluate(() => {
    const target = 1600;
    window.scrollTo({ top: target, behavior: 'instant' });
    return window.scrollY;
  });
  await page.waitForTimeout(350);

  const startY = await page.evaluate(() => window.scrollY);
  const steps = [];
  for (let i = 0; i < 3; i++) {
    const before = await page.evaluate(() => ({ y: window.scrollY, open: document.body.classList.contains('nav-open') }));
    // 点 ☰ 打开；若被遮挡则 force
    const toggle = page.locator('.sidebar-toggle');
    try { await toggle.click({ timeout: 1500 }); }
    catch (e) { await toggle.click({ force: true, timeout: 1500 }); steps.push({ note: 'open-force ' + String(e.message).slice(0, 40) }); }
    await page.waitForTimeout(320);
    const opened = await page.evaluate(() => ({ y: window.scrollY, open: document.body.classList.contains('nav-open') }));
    // 再点关闭
    try { await toggle.click({ timeout: 1500 }); }
    catch (e) { await toggle.click({ force: true, timeout: 1500 }); steps.push({ note: 'close-force' }); }
    await page.waitForTimeout(420);
    const closed = await page.evaluate(() => ({ y: window.scrollY, open: document.body.classList.contains('nav-open') }));
    steps.push({ i, before, opened, closed });
  }
  const endY = await page.evaluate(() => window.scrollY);

  // 是否有 closeDrawer（改前没有）
  const api = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll('script')).map((x) => x.src).join(',');
    return { hasNavLocked: typeof getComputedStyle === 'function', scripts: s, bodyClass: document.body.className };
  });

  return { width, startY, endY, net: +(endY - startY).toFixed(1), steps, api };
}

// ---------- 深色对比度 ----------
async function probeContrast(browser, colorScheme, themeForce) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme,
  });
  const page = await ctx.newPage();
  await page.goto(BASE + PAGE_CODE, { waitUntil: 'load' });
  if (themeForce) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), themeForce);
  }
  await page.waitForTimeout(300);
  const res = await page.evaluate(() => {
    function parse(c) {
      const m = String(c).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    function lum({ r, g, b }) {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function ratio(fg, bg) {
      const L1 = lum(fg), L2 = lum(bg);
      const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
      return (hi + 0.05) / (lo + 0.05);
    }
    // 向上找第一个不透明背景
    function bgOf(el) {
      let n = el;
      const trail = [];
      while (n && n.nodeType === 1) {
        const cs = getComputedStyle(n);
        const c = parse(cs.backgroundColor);
        if (c && c.a >= 0.999) { trail.push(n.className || n.tagName); return { bg: c, from: n.tagName + '.' + (n.className || ''), trail }; }
        trail.push(n.tagName + ':' + cs.backgroundColor);
        n = n.parentElement;
      }
      return { bg: { r: 255, g: 255, b: 255, a: 1 }, from: 'default-white', trail };
    }
    const groups = {};
    const spans = Array.from(document.querySelectorAll('.code-block .hljs-keyword, .code-block .hljs-string, .code-block .hljs-number, .code-block .hljs-title, .code-block .hljs-comment, .code-block .hljs-built_in, .code-block .hljs-variable, .code-block .hljs-attr, .code-block .hljs-literal, .code-block .hljs-tag, .code-block .hljs-name'));
    for (const s of spans) {
      const cls = Array.from(s.classList).find((c) => c.startsWith('hljs-')) || 'x';
      const cs = getComputedStyle(s);
      const fg = parse(cs.color);
      const b = bgOf(s);
      if (!fg) continue;
      const cr = ratio(fg, b.bg);
      const key = cls;
      if (!groups[key]) groups[key] = { cls, color: cs.color, bg: b.from, bgTrail: b.trail.slice(0, 4), n: 0, min: 99, max: 0 };
      groups[key].n++;
      groups[key].min = Math.min(groups[key].min, +cr.toFixed(2));
      groups[key].max = Math.max(groups[key].max, +cr.toFixed(2));
    }
    const themeAttr = document.documentElement.getAttribute('data-theme');
    const preBg = (() => {
      const pre = document.querySelector('.code-block pre');
      if (!pre) return null;
      const b = bgOf(pre);
      return { preOwn: getComputedStyle(pre).backgroundColor, effective: b.from, rgb: b.bg };
    })();
    const fails = Object.values(groups).filter((g) => g.min < 4.5).map((g) => ({ cls: g.cls, color: g.color, min: g.min, bg: g.bg }));
    return { themeAttr, groups, fails, preBg };
  });
  await ctx.close();
  return { colorScheme, themeForce: themeForce || null, ...res };
}

// ---------- 几何归因：在改后站点上逐项回滚批 1 的 CSS，看谁动了阅读列 ----------
async function probeGeomAttribution(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(400);

  const measure = async (label) => page.evaluate((lbl) => {
    const art = document.querySelector('article.article') || document.querySelector('article');
    const content = document.querySelector('.content');
    const csContent = content ? getComputedStyle(content) : null;
    const cs = getComputedStyle(art);
    const ar = art.getBoundingClientRect();
    const ps = Array.from(document.querySelectorAll('article p')).slice(0, 40);
    let maxLine = 0, n = 0, sum = 0;
    for (const p of ps) {
      const range = document.createRange();
      range.selectNodeContents(p);
      for (const r of range.getClientRects()) {
        if (r.width > 20) { if (r.width > maxLine) maxLine = r.width; sum += r.width; n++; }
      }
    }
    return {
      label: lbl,
      articleW: +ar.width.toFixed(2),
      pageHeight: document.documentElement.scrollHeight,
      maxLineW: +maxLine.toFixed(2),
      avgLineW: n ? +(sum / n).toFixed(2) : null,
      contentPad: csContent ? csContent.paddingLeft + '/' + csContent.paddingRight : null,
      artFont: cs.fontSize,
    };
  }, label);

  const out = { width, baseline: await measure('as-built') };

  const variants = [
    ['revert-P03', '.side-group-title a.side-home{min-height:0!important} .code-copy{min-height:0!important;min-width:0!important}'],
    ['revert-P04', '.src-item .src-link::after{display:none!important}'],
    ['revert-P13', '.code-scroll[data-overflowing]::after{display:none!important} .code-block:has(.code-scroll[data-overflowing]) .code-title::after{content:none!important}'],
    ['revert-P15', '.alert-title{font-weight:650!important}'],
    ['revert-P01-sticky', '.toc-side{position:static!important}'],
    ['content-pad-2rem', '.content{padding-left:2rem!important;padding-right:2rem!important}'],
  ];
  for (const [name, css] of variants) {
    const h = await page.addStyleTag({ content: css });
    await page.waitForTimeout(250);
    out[name] = await measure(name);
    await h.evaluate((el) => el.remove());
    await page.waitForTimeout(150);
  }
  // 全量回滚批1（P03+P04+P13+P15 同时）
  const hAll = await page.addStyleTag({
    content: '.side-group-title a.side-home{min-height:0!important} .code-copy{min-height:0!important;min-width:0!important}'
      + ' .src-item .src-link::after{display:none!important}'
      + ' .code-scroll[data-overflowing]::after{display:none!important}'
      + ' .code-block:has(.code-scroll[data-overflowing]) .code-title::after{content:none!important}'
      + ' .alert-title{font-weight:650!important}',
  });
  await page.waitForTimeout(250);
  out['revert-all-batch1'] = await measure('revert-all');
  await hAll.evaluate((el) => el.remove());
  return out;
}

// ---------- P0-4 命中测试（正确滚动到视口内） ----------
async function probeStretch2(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(BASE + PAGE_LAND, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const rows = await page.evaluate(() => document.querySelectorAll('.src-item').length);

  const perRow = [];
  const checkIdx = [0, 1, 2, Math.floor(rows / 2), rows - 2, rows - 1];
  for (const idx of checkIdx) {
    if (idx < 0 || idx >= rows) continue;
    await page.evaluate((i) => {
      const el = document.querySelectorAll('.src-item')[i];
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, idx);
    await page.waitForTimeout(200);
    const r = await page.evaluate((i) => {
      const row = document.querySelectorAll('.src-item')[i];
      const rr = row.getBoundingClientRect();
      const y = rr.top + rr.height / 2;
      const fracs = [0.02, 0.1, 0.25, 0.5, 0.62, 0.75, 0.9, 0.98];
      const hits = [];
      for (const f of fracs) {
        const x = rr.left + rr.width * f;
        const el = document.elementFromPoint(x, y);
        const a = el && el.closest ? el.closest('a') : null;
        hits.push({
          f,
          tag: el ? el.tagName : null,
          cls: el ? String(el.className).slice(0, 30) : null,
          isSrcLink: !!(a && a.classList.contains('src-link')),
        });
      }
      return {
        idx: i,
        w: +rr.width.toFixed(1), h: +rr.height.toFixed(1),
        covered: hits.filter((h) => h.isSrcLink).length, of: hits.length,
        detail: hits,
      };
    }, idx);
    perRow.push(r);
  }
  // 整行覆盖率（用全部行，先滚到视口）
  let allCovered = 0, sample = 0;
  const total = await page.evaluate(() => document.querySelectorAll('.src-item').length);
  for (let i = 0; i < total; i += 7) {
    await page.evaluate((k) => document.querySelectorAll('.src-item')[k].scrollIntoView({ block: 'center', behavior: 'instant' }), i);
    await page.waitForTimeout(60);
    const ok = await page.evaluate((k) => {
      const row = document.querySelectorAll('.src-item')[k];
      const rr = row.getBoundingClientRect();
      const y = rr.top + rr.height / 2;
      let good = 0;
      for (const f of [0.02, 0.5, 0.98]) {
        const el = document.elementFromPoint(rr.left + rr.width * f, y);
        const a = el && el.closest ? el.closest('a') : null;
        if (a && a.classList.contains('src-link')) good++;
      }
      return good === 3;
    }, i);
    sample++;
    if (ok) allCovered++;
  }
  return { srcRows: rows, perRow, sampled: sample, fullyCovered: allCovered };
}

// ---------- 选择/复制风险 ----------
async function probeSelection(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(BASE + PAGE_LAND, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  // 找一行 src-sum 有文字的
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.src-item'));
    const t = items.find((i) => (i.querySelector('.src-sum') || {}).textContent);
    (t || items[0]).scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.src-item'));
    const row = items.find((i) => (i.querySelector('.src-sum') || {}).textContent);
    if (!row) return null;
    const sum = row.querySelector('.src-sum');
    const r = sum.getBoundingClientRect();
    return { x: r.left + 6, y: r.top + r.height / 2, x2: r.left + Math.min(240, r.width - 6), text: sum.textContent.slice(0, 40) };
  });
  if (!box) return { error: 'no row' };
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) {
    await page.mouse.move(box.x + ((box.x2 - box.x) * k) / 8, box.y);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const sel = await page.evaluate(() => {
    const s = window.getSelection();
    return { text: s ? s.toString() : '', len: s ? s.toString().length : 0, anchorTag: s && s.anchorNode && s.anchorNode.parentElement ? s.anchorNode.parentElement.tagName : null };
  });
  return { box, selection: sel, selectable: sel.len > 0 };
}

// ---------- 锚点遮挡（instant 滚动 + 等待） ----------
async function probeAnchorInstant(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('article h2[id], article h3[id]')).slice(1, 9).map((h) => h.id));
  const res = [];
  for (const id of ids) {
    await page.evaluate((i) => {
      // 关掉平滑滚动，模拟"点了目录/锚点后立刻落位"
      document.documentElement.style.scrollBehavior = 'auto';
      const t = document.getElementById(i);
      const top = t.getBoundingClientRect().top + window.scrollY - parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop || '0');
      window.scrollTo({ top, behavior: 'instant' });
    }, id);
    await page.waitForTimeout(320);
    res.push(await page.evaluate((i) => {
      const t = document.getElementById(i);
      const r = t.getBoundingClientRect();
      const tb = document.querySelector('.topbar');
      const toc = document.querySelector('.toc-side');
      const tocR = toc ? toc.getBoundingClientRect() : null;
      const tocVisible = toc ? getComputedStyle(toc).display !== 'none' : false;
      const el = document.elementFromPoint(Math.min(window.innerWidth - 30, r.left + 80), Math.max(1, r.top + 3));
      const owner = el ? (el.closest('.toc-side') ? 'toc-side' : el.closest('.topbar') ? 'topbar' : el.closest('#' + CSS.escape(i)) ? 'heading' : el.tagName) : 'null';
      return {
        id: i,
        headingTop: +r.top.toFixed(1),
        topbarH: tb ? +tb.getBoundingClientRect().height.toFixed(1) : null,
        tocVisible,
        tocBottom: tocR && tocVisible ? +tocR.bottom.toFixed(1) : null,
        scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
        topmost: owner,
        occludedByToc: !!(tocVisible && tocR && r.top < tocR.bottom - 0.5),
      };
    }, id));
  }
  return res;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { port: PORT };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    out.drawer390 = await probeDrawer(page, 390, 844);
    out.drawer320 = await probeDrawer(page, 320, 700);
    out.stretch = await probeStretch2(page, 1280);
    out.stretch390 = await probeStretch2(page, 390);
    out.selection = await probeSelection(page, 1280);
    out.anchor390 = await probeAnchorInstant(page, 390);
    out.anchor1280 = await probeAnchorInstant(page, 1280);
    out.geomAttr1024 = await probeGeomAttribution(page, 1024);
    out.geomAttr1280 = await probeGeomAttribution(page, 1280);
    await ctx.close();

    out.contrast = {};
    out.contrast['light'] = await probeContrast(browser, 'light', null);
    out.contrast['dark-forced'] = await probeContrast(browser, 'light', 'dark');
    out.contrast['auto+sys-dark'] = await probeContrast(browser, 'dark', null);
  } catch (e) {
    out.error = String((e && e.stack) || e);
  } finally {
    await browser.close();
  }
  const json = JSON.stringify(out, null, 1);
  if (OUT) { fs.writeFileSync(OUT, json, 'utf8'); console.log('wrote ' + OUT + ' ' + json.length + 'B'); }
  else console.log(json);
})();
