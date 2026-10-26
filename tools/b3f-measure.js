'use strict';
/**
 * b3f-measure.js — 批 3（字号令牌化）专用实测。只读仓库，不写任何 HTML/CSS。
 *
 * 验收口径（**必须**用这个，不要用 6页×3视口 并集口径）：
 *   · 字号种数 = **单页 + 单视口 1440** + **有直接文本节点的元素** + **可见** +
 *     **排除伪元素** + **排除 `<svg>` 内元素**
 *   · 目标 ≤ 14 级
 *
 * 另外输出：
 *   · h1–h4 / .page-head h1 / .hero h1 的计算字号（移动 390 与桌面 1440 各一份）
 *   · 标题对比度（WCAG 相对亮度比，标题色 vs 最近不透明祖先背景）
 *   · 截断数（.grp-name / .grp-zh，scrollWidth > clientWidth+1，仅可见元素）
 *   · 横向溢出（320/360/390/414 × 10 页）
 *   · h1 行数（390 档，是否换行成 2 行）
 *
 * 用法：
 *   node tools/b3f-measure.js --tag=baseline
 *   node tools/b3f-measure.js --tag=after3a --skip=overflow
 * 输出：%TEMP%\b3f-measure-<tag>.json
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');

const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* A1 的 10 片页面（与 verify-mobile.js:55 的 PAGES10 一一对应，换成文件路径） */
const PAGES10 = [
  'index.html',
  'paper/index.html',
  'paper/dev/command-api/basics/introduction/index.html',
  'paper/reference/world-configuration/index.html',
  'velocity/tuning/index.html',
  'folia/reference/region-logic/index.html',
  'all-pages.html',
  'snapshots.html',
  'sections/paper.html',
  'categories/paper-dev-command.html',
];
/* 补充页：覆盖 404 / 配置键索引 / 内容页 / 分区页 / 分类页 / 快照页 的模板差异 */
const PAGES_EXTRA = [
  '404.html',
  'paper/dev/dialogs/index.html',
  'paper/reference/configuration/index.html',
  'paper/dev/pdc/index.html',
  'velocity/index.html',
  'folia/index.html',
  'sections/velocity.html',
  'categories/paper-config.html',
];
const ALL_PAGES = PAGES10.concat(PAGES_EXTRA);

const VP_DESK = { name: '1440x900', w: 1440, h: 900 };
const VP_MOBILE = { name: '390x844', w: 390, h: 844 };
const VP_OVERFLOW = [
  { name: '320x568', w: 320, h: 568 },
  { name: '360x640', w: 360, h: 640 },
  { name: '390x844', w: 390, h: 844 },
  { name: '414x896', w: 414, h: 896 },
];

/* ---------- 页面内探针 ---------- */
const PROBE_FS = () => {
  const cs = getComputedStyle;
  const inSvg = (el) => !!(el.closest && el.closest('svg'));
  const hasText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  };
  const vis = (el) => {
    const c = cs(el);
    if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    // 被 details 折叠隐藏的子树：offsetParent 为 null 且自身不是 fixed
    return el.getClientRects().length > 0;
  };
  const levels = new Map(); // px -> [sample selectors]
  const levelsPermissive = new Map(); // 与主 Agent 口径一致：把 opacity:0 也算进来
  for (const el of document.querySelectorAll('body *')) {
    if (inSvg(el)) continue;
    if (!hasText(el)) continue;
    const px = parseFloat(cs(el).fontSize);
    if (!(px > 0)) continue;
    const key = px.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    const tag = el.tagName.toLowerCase();
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const sel = tag + cls;
    /* 宽松口径：只排 display:none / visibility:hidden，不排 opacity:0 */
    if (cs(el).display !== 'none' && cs(el).visibility !== 'hidden'
        && el.getClientRects().length > 0) {
      if (!levelsPermissive.has(key)) levelsPermissive.set(key, []);
      const pa = levelsPermissive.get(key);
      if (pa.length < 6 && pa.indexOf(sel) === -1) pa.push(sel);
    }
    if (!vis(el)) continue;
    if (!levels.has(key)) levels.set(key, []);
    const arr = levels.get(key);
    if (arr.length < 6 && arr.indexOf(sel) === -1) arr.push(sel);
  }
  /* 伪元素单独统计（不参与验收，只记录，防止"看似收敛但伪元素散"） */
  const pseudo = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (inSvg(el)) continue;
    for (const p of ['::before', '::after']) {
      const c = cs(el, p);
      if (c.content && c.content !== 'none' && c.content !== 'normal') pseudo.add(parseFloat(c.fontSize).toFixed(4));
    }
  }
  const svgFs = new Set();
  for (const t of document.querySelectorAll('svg text, svg tspan')) svgFs.add(parseFloat(cs(t).fontSize).toFixed(4));

  /* 标题字号 */
  const hs = {};
  for (const sel of ['.article h1', '.article h2', '.article h3', '.article h4',
    '.page-head h1', '.hero h1', '.section-head h2', '.entry-card .ec-title']) {
    const el = document.querySelector(sel);
    hs[sel] = el ? parseFloat(cs(el).fontSize) : null;
  }
  return {
    levels: [...levels.entries()].map(([px, sels]) => ({ px: Number(px), sels })).sort((a, b) => a.px - b.px),
    levelsPermissive: [...levelsPermissive.entries()].map(([px, sels]) => ({ px: Number(px), sels })).sort((a, b) => a.px - b.px),
    pseudoLevels: [...pseudo].map(Number).sort((a, b) => a - b),
    svgLevels: [...svgFs].map(Number).sort((a, b) => a - b),
    headings: hs,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const PROBE_H1 = () => {
  const cs = getComputedStyle;
  const el = document.querySelector('.article h1') || document.querySelector('.hero h1') || document.querySelector('h1');
  if (!el) return { found: false };
  const c = cs(el);
  const lh = parseFloat(c.lineHeight) || 0;
  const r = el.getBoundingClientRect();
  const pad = (parseFloat(c.paddingTop) || 0) + (parseFloat(c.paddingBottom) || 0);
  const border = (parseFloat(c.borderTopWidth) || 0) + (parseFloat(c.borderBottomWidth) || 0);
  const contentH = r.height - pad - border;
  const lines = lh > 0 ? Math.max(1, Math.round(contentH / lh)) : null;
  /* 对比度：往上找第一个不透明背景 */
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c2) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c2.r) + 0.7152 * f(c2.g) + 0.0722 * f(c2.b);
  };
  let bg = null;
  let node = el;
  while (node && node !== document.documentElement) {
    const bc = parse(cs(node).backgroundColor);
    if (bc && bc.a > 0.95) { bg = bc; break; }
    node = node.parentElement;
  }
  if (!bg) {
    const b = parse(cs(document.body).backgroundColor);
    bg = (b && b.a > 0.95) ? b : { r: 255, g: 255, b: 255, a: 1 };
  }
  const fg = parse(c.color) || { r: 0, g: 0, b: 0, a: 1 };
  const L1 = lum(fg), L2 = lum(bg);
  const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  return {
    found: true,
    text: el.textContent.trim().slice(0, 40),
    fontSize: parseFloat(c.fontSize),
    lineHeight: lh,
    height: Math.round(r.height * 100) / 100,
    lines,
    color: c.color,
    bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')',
    contrast: Math.round(ratio * 100) / 100,
  };
};

const PROBE_TRUNC = () => {
  const cs = getComputedStyle;
  const vis = (el) => {
    const c = cs(el);
    if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const one = (sel) => [...document.querySelectorAll(sel)].filter(vis)
    .filter((e) => e.scrollWidth > e.clientWidth + 1)
    .map((e) => ({ sel, text: e.textContent.trim().slice(0, 28), sw: e.scrollWidth, cw: e.clientWidth }));
  const zh = one('.sidebar .grp-zh');
  const name = one('.sidebar .grp-name');
  return {
    zhTruncated: zh.length, nameTruncated: name.length,
    total: zh.length + name.length, samples: zh.concat(name).slice(0, 10),
  };
};

const PROBE_OVF = () => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
});

(async () => {
  if (!EXE) throw new Error('找不到 chromium 可执行文件（设 CHROME_PATH）');
  const tag = arg('tag', 'run');
  const skip = (arg('skip', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const only = arg('pages', '');
  const pages = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : ALL_PAGES;
  const out = { tag, at: new Date().toISOString(), exe: EXE, rows: [], overflow: [], h1: [], trunc: [] };

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const urlOf = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
  const open = async (rel, vp) => {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(urlOf(rel), { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(180);
    return { ctx, page, errs };
  };

  /* ---- 1) 字号种数（1440） ---- */
  if (!skip.includes('fonts')) {
    for (const rel of pages) {
      const { ctx, page } = await open(rel, VP_DESK);
      const m = await page.evaluate(PROBE_FS);
      out.rows.push({ page: rel, vp: VP_DESK.name, ...m });
      await ctx.close();
    }
  }

  /* ---- 2) h1 换行 + 对比度（390 / 1440） ---- */
  if (!skip.includes('h1')) {
    for (const rel of ['index.html', 'paper/dev/dialogs/index.html', 'paper/reference/world-configuration/index.html']) {
      for (const vp of [VP_MOBILE, VP_DESK]) {
        const { ctx, page } = await open(rel, vp);
        const h = await page.evaluate(PROBE_H1);
        out.h1.push({ page: rel, vp: vp.name, ...h });
        await ctx.close();
      }
    }
  }

  /* ---- 3) 截断（390，抽屉需打开；1440 侧栏常驻） ---- */
  if (!skip.includes('trunc')) {
    for (const vp of [VP_DESK, VP_MOBILE]) {
      for (const rel of ['paper/dev/dialogs/index.html', 'paper/reference/world-configuration/index.html']) {
        const { ctx, page } = await open(rel, vp);
        if (vp.w < 1200) {
          await page.evaluate(() => {
            const b = document.getElementById('nav-toggle');
            if (b) b.click();
          });
          await page.waitForTimeout(220);
        }
        const t = await page.evaluate(PROBE_TRUNC);
        out.trunc.push({ page: rel, vp: vp.name, ...t });
        await ctx.close();
      }
    }
  }

  /* ---- 4) 横向溢出（4 视口 × 10 页） ---- */
  if (!skip.includes('overflow')) {
    for (const vp of VP_OVERFLOW) {
      for (const rel of PAGES10) {
        const { ctx, page } = await open(rel, vp);
        const o = await page.evaluate(PROBE_OVF);
        out.overflow.push({ page: rel, vp: vp.name, ...o });
        await ctx.close();
      }
    }
  }

  await browser.close();

  const outFile = path.join(os.tmpdir(), 'b3f-measure-' + tag + '.json');
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');

  /* ---- 控制台摘要 ---- */
  console.log('\n=== 批 3 实测  tag=' + tag + ' ===');
  if (out.rows.length) {
    console.log('\n[1] 单页 1440 字号种数（文本承载元素 / 排除伪元素与 svg）');
    console.log('    严格口径 = 再排除 opacity:0（批 1 起 a.side-home 是 opacity:0）');
    console.log('    宽松口径 = 主 Agent 口径（只排 display:none / visibility:hidden）');
    console.log('  ' + 'page'.padEnd(50) + 'strict'.padStart(7) + 'loose'.padStart(7) + '   values(strict)');
    for (const r of out.rows) {
      const vals = r.levels.map((l) => l.px).join(' ');
      console.log('  ' + r.page.padEnd(50) + String(r.levels.length).padStart(7)
        + String((r.levelsPermissive || []).length).padStart(7) + '  ' + vals);
    }
    const maxS = out.rows.reduce((a, r) => Math.max(a, r.levels.length), 0);
    const maxL = out.rows.reduce((a, r) => Math.max(a, (r.levelsPermissive || []).length), 0);
    const rowS = out.rows.find((r) => r.levels.length === maxS);
    const rowL = out.rows.find((r) => (r.levelsPermissive || []).length === maxL);
    console.log('  → 严格最大 ' + maxS + ' 级（' + (rowS && rowS.page) + '）；宽松最大 ' + maxL + ' 级（' + (rowL && rowL.page) + '）；目标 ≤14');
    const pseudoAll = new Set();
    out.rows.forEach((r) => r.pseudoLevels.forEach((p) => pseudoAll.add(p)));
    console.log('  （伪元素另 ' + pseudoAll.size + ' 个值，不计入验收）');
  }
  if (out.h1.length) {
    console.log('\n[2] h1 实际字号 / 行数 / 对比度');
    for (const r of out.h1) {
      console.log('  ' + r.page.padEnd(46) + r.vp.padEnd(10)
        + 'fs=' + String(r.fontSize).padStart(6) + ' lh=' + String(r.lineHeight).padStart(5)
        + ' h=' + String(r.height).padStart(7) + ' lines=' + String(r.lines).padStart(2)
        + ' contrast=' + String(r.contrast).padStart(5));
    }
  }
  if (out.trunc.length) {
    console.log('\n[3] 截断（.grp-name / .grp-zh，可见元素）');
    for (const r of out.trunc) {
      console.log('  ' + r.page.padEnd(46) + r.vp.padEnd(10)
        + 'zh=' + String(r.zhTruncated).padStart(2) + ' name=' + String(r.nameTruncated).padStart(2)
        + ' total=' + String(r.total).padStart(2) + (r.total ? '  ' + JSON.stringify(r.samples.slice(0, 3)) : ''));
    }
  }
  if (out.overflow.length) {
    const bad = out.overflow.filter((r) => r.overflow > 1);
    console.log('\n[4] 横向溢出：' + (out.overflow.length - bad.length) + '/' + out.overflow.length + ' 组合 = 0');
    if (bad.length) for (const b of bad) console.log('  ✗ ' + b.page + ' @' + b.vp + ' → ' + b.overflow + 'px');
  }
  if (out.rows.length) {
    const primary = out.rows.find((r) => r.page === 'paper/dev/dialogs/index.html') || out.rows[0];
    console.log('\n[5] 主样本 ' + primary.page + ' 的 ' + primary.levels.length + ' 级明细：');
    for (const l of primary.levels) console.log('  ' + String(l.px).padStart(7) + 'px  ' + l.sels.join(' , '));
  }
  console.log('\nJSON → ' + outFile);
})().catch((e) => { console.error(e); process.exit(1); });
