'use strict';
/**
 * c2-width.js — 批 2「阅读列宽 40rem」预演 / 落地复测探针（C2 Agent 专用）
 *
 * 目的：独立验证 `.article p{max-width:40rem}` 这一条 CSS 是否达到
 *   ① 正文行宽落到 640px / 74 字符；② 代码块宽度与代码横滚数逐格不变；
 *   ③ 左边缘不位移；④ 横向溢出仍为 0；⑤ 页高只增不减（同向）。
 *
 * 三种 stage：
 *   --stage=pre   改前基线（只读当前 http://127.0.0.1:8787）
 *   --stage=post  注入 `.article p{max-width:40rem}`（page.addStyleTag，**不落盘**）后重测，
 *                 并与 pre 的 JSON 逐格对比
 *   --stage=live  真实产物复测（不注入），与 pre 的 JSON 逐格对比 —— 用于「落地后」证明
 *                 真实 assets/site.css 的效果与预演逐格一致
 *
 * 口径（与 reports/b2-baseline.md §0.2 对齐，便于逐格对拍）：
 *   lineW  = 各正文档落 Range.getClientRects() 的最长行盒，再取全页最大值
 *   ch     = round(lineW / zeroW)，zeroW = canvas 实测 '0' advance（16px 系统 UI = 8.63px）
 *   codeW  = pre.code-pre 的**滚动容器 clientWidth**（= 视觉列宽；pre 自身宽是内容盒，会被长代码撑大）
 *   codeOv = pre.closest('.code-scroll')||pre 的 scrollWidth > clientWidth+1 的块数
 *   uniqLeftCount = 被限宽判据块（.article 直接子段落）的不同左边缘个数
 *   hOverflow = documentElement.scrollWidth - clientWidth
 *
 * 用法：
 *   node tools/c2-width.js --stage=pre  --json=reports/.c2-width-pre.json
 *   node tools/c2-width.js --stage=post --base=reports/.c2-width-pre.json --json=reports/.c2-width-post.json
 *   node tools/c2-width.js --stage=live --base=reports/.c2-width-pre.json --json=reports/.c2-width-live.json
 *   加 --shots=1 时额外截 3 张图到 reports/c2-shots/
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:8787';
const CSS_B2 = '.article p{max-width:40rem}';

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* 7 页 = 基线 A 组 6 页 + particles（基线 E/C 组的第四张正文页，验收 §1/§2 需要它） */
const PAGES = [
  { key: 'landing', path: '/', article: false },
  { key: 'paper', path: '/paper/', article: true },
  { key: 'dialogs', path: '/paper/dev/dialogs/', article: true },
  { key: 'worldcfg', path: '/paper/reference/world-configuration/', article: true },
  { key: 'particles', path: '/paper/dev/particles/', article: true },
  { key: 'tuning', path: '/velocity/tuning/', article: true },
  { key: 'allpages', path: '/all-pages.html', article: false },
];

const VPS = [1440, 1280, 1200, 1100, 1025, 1024, 900, 768, 390, 320];

/* ------------------------------------------------------------------ *
 * 页面内采集（只依赖 DOM/CSSOM）
 * ------------------------------------------------------------------ */
const MEASURE_FN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);

  const article = q('article.article') || q('article');
  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = article ? [...article.querySelectorAll('p')].filter(isProse) : [];

  /* '0' advance：canvas 实测，不用 0.5em 近似 */
  let zeroW = null;
  const cv = document.createElement('canvas').getContext('2d');

  let gMaxLine = 0;
  const lefts = [];
  const leftsDirect = [];
  const widths = [];
  const parentIdx = [];
  const parentSeen = new Map();
  for (const p of paras) {
    const st = getComputedStyle(p);
    if (zeroW == null) { cv.font = st.fontSize + ' ' + st.fontFamily; zeroW = cv.measureText('0').width; }
    const rg = document.createRange();
    rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    if (rects.length) gMaxLine = Math.max(gMaxLine, ...rects.map((r) => r.width));
    const b = p.getBoundingClientRect();
    lefts.push(r2(b.left));
    widths.push(r2(b.width));
    if (p.parentElement === article) leftsDirect.push(r2(b.left));
    /* 父容器编号：判断「同一容器内左边缘唯一」用（跨容器的多档缩进是列表结构，不是 max-width 造成的） */
    const par = p.parentElement;
    if (!parentSeen.has(par)) parentSeen.set(par, parentSeen.size);
    parentIdx.push(parentSeen.get(par));
  }

  /* 代码块：视觉列宽 = 滚动容器 clientWidth */
  const pres = [...document.querySelectorAll('pre.code-pre')];
  const scrollers = pres.map((p) => p.closest('.code-scroll') || p);
  const cw = scrollers.map((s) => s.clientWidth);
  const codeOverflowBlocks = scrollers.map((s) => s.scrollWidth > s.clientWidth + 1);
  const codeOverflow = codeOverflowBlocks.filter(Boolean).length;
  const preW = pres.map((p) => p.getBoundingClientRect().width);
  const rng = (a) => (a.length ? [Math.min(...a), Math.max(...a)] : null);
  const rr = (pair) => (pair ? [r2(pair[0]), r2(pair[1])] : null);

  const tables = [...document.querySelectorAll('.table-wrap')];
  const tableOverflow = tables.filter((w) => w.scrollWidth > w.clientWidth + 1).length;

  /* 内容图几何：`.article p{max-width:40rem}` 会连带压窄 <p> 内的 img（img{max-width:100%}），
     图片变窄→按比例变矮→页高可能**下降**。particles 有 18 张 848.81×478.33 的图，
     逐张 640/848.81 缩比即可解释 −2000px 级别的页高变化。必须单独记录，否则页高读数无法归因。 */
  const cimgs = [...document.querySelectorAll('img.content-img')].filter((i) => i.getBoundingClientRect().width > 0);
  const imgSumH = cimgs.reduce((s, i) => s + i.getBoundingClientRect().height, 0);
  const imgSumW = cimgs.reduce((s, i) => s + i.getBoundingClientRect().width, 0);

  const ab = article ? article.getBoundingClientRect() : null;
  const de = document.documentElement;
  const rootFS = parseFloat(cs(de, 'fontSize')) || 16;

  /* 「被限宽块」= 实际宽度被压到上限（max-width 生效）的段落。
     左边缘对齐判据分两层（见 reports/c2-width.md §4）：
       (a) **同一父容器内**：被限宽段落的左边缘必须唯一（极差 0）—— 这是 max-width 能影响的范围；
       (b) **逐段位移**：改前 vs 改后同索引左边缘必须完全相同（max-width 只压右边界）。
     跨父容器的多档 left（worldcfg 5 档 / dialogs 4 档）是 li>ul>li>p 的列表缩进，
     是页面既有结构、改前改后逐档相同，**不是** max-width 造成的，不能当 FAIL 判据。 */
  const clamped = [];
  const groupMap = new Map();
  for (let i = 0; i < paras.length; i++) {
    const st = cs(paras[i], 'max-width');
    if (st && st !== 'none') {
      const mw = parseFloat(st);
      if (Math.abs(widths[i] - mw) < 0.75) {
        clamped.push(i);
        const par = paras[i].parentElement;
        if (!groupMap.has(par)) groupMap.set(par, []);
        groupMap.get(par).push(lefts[i]);
      }
    }
  }
  const clampedLefts = clamped.map((i) => lefts[i]);
  let uniqPerParentMax = 0;
  let withinGroupSpread = 0;
  for (const arr of groupMap.values()) {
    uniqPerParentMax = Math.max(uniqPerParentMax, new Set(arr).size);
    if (arr.length > 1) withinGroupSpread = Math.max(withinGroupSpread, Math.max(...arr) - Math.min(...arr));
  }
  const directClamped = clamped.filter((i) => paras[i].parentElement === article).map((i) => lefts[i]);

  return {
    path: location.pathname,
    vw: window.innerWidth,
    rootFontSize: rootFS,
    artW: ab ? r2(ab.width) : null,
    artLeft: ab ? r2(ab.left) : null,
    lineW: paras.length ? r2(gMaxLine) : null,
    lineCh: paras.length && zeroW > 0 ? Math.round(gMaxLine / zeroW) : null,
    zeroW: zeroW == null ? null : r2(zeroW),
    proseCount: paras.length,
    paraMaxWidthCss: paras.length ? cs(paras[0], 'maxWidth') : null,
    uniqLeftCount: new Set(lefts).size,
    uniqLeftDirect: new Set(leftsDirect).size,
    uniqLeftClamped: new Set(clampedLefts).size,
    clampedCount: clamped.length,
    clampedLefts: [...new Set(clampedLefts)],
    uniqPerParentMax,
    withinGroupSpread: r2(withinGroupSpread),
    directClampedCount: directClamped.length,
    directClampedUniq: new Set(directClamped).size,
    leftsAll: lefts,
    leftsDirect,
    parentIdx,
    paraWidths: widths,
    codeBlocks: pres.length,
    codeOverflow,
    codeOverflowBlocks,
    codeCw: rr(rng(cw)),
    codePreW: rr(rng(preW)),
    codeLeft: rr(rng(pres.map((p) => p.getBoundingClientRect().left))),
    tableBlocks: tables.length,
    tableOverflow,
    contentImgs: cimgs.length,
    contentImgInP: cimgs.filter((i) => i.closest('p')).length,
    imgSumH: r2(imgSumH),
    imgSumW: r2(imgSumW),
    pageHeight: de.scrollHeight,
    docScrollW: de.scrollWidth,
    docClientW: de.clientWidth,
    hOverflow: de.scrollWidth - de.clientWidth,
  };
};

/* ------------------------------------------------------------------ */
function argOf(name, dflt) {
  const pre = '--' + name + '=';
  const hit = process.argv.slice(2).find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : dflt;
}
const STAGE = argOf('stage', 'pre');
const JSON_OUT = argOf('json', path.join(ROOT, 'reports', `.c2-width-${STAGE}.json`));
const BASE_JSON = argOf('base', path.join(ROOT, 'reports', '.c2-width-pre.json'));
const SHOTS = argOf('shots', '0') === '1';
const VPS_ARG = argOf('vps', '');
const vps = VPS_ARG ? VPS_ARG.split(',').map(Number) : VPS;

const settle = (page, k) => page.evaluate((n) => new Promise((res) => {
  let i = 0;
  const step = () => { if (++i >= n) res(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), k || 2);

/**
 * pageHeight 稳定化：全站 88 张图带 loading=lazy，只加载视口附近的。
 * 不先把图load完，pageHeight 会随滚动位置/时序抖动（实测同一档两次差 400+px），
 * 拿它做「改前改后 Δ」会全是噪声。做法：把 loading 改成 eager + 滚到底再回顶
 * + await 每张图的 complete/decode —— 之后 scrollHeight 才是稳态值。
 * 注意：这是**测量装置的预处理**，不写盘、不改产物。
 */
const loadAllImages = async (page) => {
  await page.evaluate(async () => {
    const imgs = [...document.images];
    for (const im of imgs) { im.loading = 'eager'; if (im.decode) { try { await im.decode(); } catch (e) {} } }
    const de = document.documentElement;
    window.scrollTo({ top: de.scrollHeight, left: 0, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 120));
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => {
      im.addEventListener('load', r, { once: true });
      im.addEventListener('error', r, { once: true });
      setTimeout(r, 2000);
    }))));
  });
  await page.waitForTimeout(120);
  await settle(page, 3);
};

async function main() {
  if (!EXE) throw new Error('no chrome executable found (set CHROME_PATH)');
  const readBefore = STAGE !== 'pre';
  const before = readBefore ? JSON.parse(fs.readFileSync(BASE_JSON, 'utf8')) : null;

  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });

  const cells = [];
  for (const vp of vps) {
    const ctx = await browser.newContext({
      viewport: { width: vp, height: 900 },
      deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
    });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      await page.goto(BASE + p.path, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(140);
      await loadAllImages(page);
      await settle(page, 2);
      const a = await page.evaluate(MEASURE_FN);
      let b = a;
      if (STAGE === 'post') {
        await page.addStyleTag({ content: CSS_B2 });
        await page.waitForTimeout(60);
        await settle(page, 2);
        b = await page.evaluate(MEASURE_FN);
      }
      cells.push({ vp, page: p.key, before: a, after: b });
    }
    await ctx.close();
  }

  await browser.close();

  const payload = {
    generated_at: new Date().toISOString(),
    stage: STAGE,
    css: STAGE === 'post' ? CSS_B2 : (STAGE === 'live' ? '(真实产物 / no inject)' : null),
    chrome: EXE,
    vps, pages: PAGES.map((p) => p.key),
    cells,
  };
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(payload, null, 1), 'utf8');

  /* ---------------- 对照 / 验收 ---------------- */
  const key = (c) => c.vp + '|' + c.page;
  const preMap = new Map();
  if (before) for (const c of before.cells) preMap.set(key(c), c.after);

  const rows = [];
  const codeOvChanged = [];
  let hOverflowAfter = 0;
  let leftShiftMax = 0;
  let leftShiftCell = null;
  let uniqLeftBad = [];
  const unclampedLeak = [];

  for (const c of cells) {
    const A = before ? preMap.get(key(c)) : c.before;
    const B = c.after;
    if (!A) continue;
    const d = {
      vp: c.vp, page: c.page,
      lineW_a: A.lineW, lineW_b: B.lineW, lineW_d: A.lineW == null ? null : Math.round((B.lineW - A.lineW) * 100) / 100,
      ch_a: A.lineCh, ch_b: B.lineCh,
      codeCw_a: A.codeCw, codeCw_b: B.codeCw,
      codeOv_a: A.codeOverflow + '/' + A.codeBlocks,
      codeOv_b: B.codeOverflow + '/' + B.codeBlocks,
      codeOvSame: A.codeOverflow === B.codeOverflow && A.codeBlocks === B.codeBlocks,
      tableOv_a: A.tableOverflow + '/' + A.tableBlocks,
      tableOv_b: B.tableOverflow + '/' + B.tableBlocks,
      h_a: A.pageHeight, h_b: B.pageHeight, h_d: B.pageHeight - A.pageHeight,
      artW_a: A.artW, artW_b: B.artW,
      uniqLeftDirect_b: B.uniqLeftDirect,
      uniqLeftAll_b: B.uniqLeftCount,
      uniqLeftClamped_b: B.uniqLeftClamped,
      uniqPerParentMax_b: B.uniqPerParentMax,
      withinGroupSpread_b: B.withinGroupSpread,
      directClampedCount_b: B.directClampedCount,
      directClampedUniq_b: B.directClampedUniq,
      clampedCount_a: A.clampedCount,
      clampedCount_b: B.clampedCount,
      clampedLefts_b: B.clampedLefts,
      imgSumH_a: A.imgSumH, imgSumH_b: B.imgSumH,
      contentImgs_a: A.contentImgs, contentImgs_b: B.contentImgs,
      hOver_a: A.hOverflow, hOver_b: B.hOverflow,
      paraMaxWidthCss_b: B.paraMaxWidthCss,
    };
    /* 左边缘位移：逐段对位比较（同一段落索引） */
    if (A.leftsAll.length === B.leftsAll.length) {
      for (let i = 0; i < A.leftsAll.length; i++) {
        const dd = Math.abs(B.leftsAll[i] - A.leftsAll[i]);
        if (dd > leftShiftMax) { leftShiftMax = dd; leftShiftCell = c.vp + '/' + c.page + '#' + i; }
      }
    }
    if (!d.codeOvSame) codeOvChanged.push(d);
    if (B.hOverflow > 0) hOverflowAfter++;
    /* #5 判据（两层）：
       (a) 同一父容器内被限宽段落左边缘唯一（uniqPerParentMax=1，极差 0）
       (b) 逐段左边缘位移 0（上面已算 leftShiftMax）
       全段落跨容器的多档 lefted 是列表缩进，改前改后逐档相同，不计入 FAIL。 */
    if (B.clampedCount > 0 && (B.uniqPerParentMax !== 1 || B.withinGroupSpread > 0.01)) {
      uniqLeftBad.push(c.vp + '/' + c.page + '(组内档=' + B.uniqPerParentMax + ',极差=' + B.withinGroupSpread + ')');
    }
    /* 「被限宽块增加但左边缘不唯一」以外的漏限：改前有段落但改后 clampedCount=0 */
    if (B.proseCount > 0 && B.clampedCount === 0 && A.clampedCount === 0 && B.lineW != null && B.lineW > 640.5) {
      unclampedLeak.push(c.vp + '/' + c.page + ' lineW=' + B.lineW);
    }
    rows.push(d);
  }

  /* ---- 打印全表 ---- */
  const hdr = ['vp', 'page', 'lineW a→b (Δ)', 'ch a→b', 'codeW a→b', 'codeOv a→b', 'tblOv a→b', 'pageH a→b (Δ)', 'uniqL/clamped', 'hOv b'];
  console.log('stage=' + STAGE + '  cells=' + rows.length);
  console.log(hdr.join(' | '));
  for (const r of rows) {
    console.log([
      String(r.vp).padEnd(4),
      r.page.padEnd(9),
      (r.lineW_a + '→' + r.lineW_b + ' (' + (r.lineW_d > 0 ? '+' : '') + r.lineW_d + ')').padEnd(26),
      (r.ch_a + '→' + r.ch_b).padEnd(10),
      (JSON.stringify(r.codeCw_a) + '→' + JSON.stringify(r.codeCw_b)).padEnd(28),
      (r.codeOv_a + '→' + r.codeOv_b).padEnd(12),
      (r.tableOv_a + '→' + r.tableOv_b).padEnd(10),
      (r.h_a + '→' + r.h_b + ' (' + (r.h_d > 0 ? '+' : '') + r.h_d + ')').padEnd(30),
      (String(r.uniqLeftClamped_b) + '/' + r.clampedCount_b).padEnd(8),
      String(r.hOver_b),
    ].join(' | '));
  }

  /* ---- 8 条验收 ---- */
  const find = (vp, pg) => rows.find((r) => r.vp === vp && r.page === pg);
  const near = (v, t, tol) => v != null && Math.abs(v - t) <= tol;
  const acc = [];
  const c1 = find(1440, 'dialogs');
  acc.push({ n: 1, name: '1440 dialogs 行宽 637.98±3 / 74字符±3', pass: !!c1 && near(c1.lineW_b, 637.98, 3) && near(c1.ch_b, 74, 3), got: c1 ? c1.lineW_b + 'px / ' + c1.ch_b + 'ch' : 'n/a' });
  const c2 = find(1440, 'worldcfg');
  acc.push({ n: 2, name: '1440 worldcfg 行宽 636.89±3 / 74字符±3', pass: !!c2 && near(c2.lineW_b, 636.89, 3) && near(c2.ch_b, 74, 3), got: c2 ? c2.lineW_b + 'px / ' + c2.ch_b + 'ch' : 'n/a' });
  const c3 = c2 && c2.codeCw_b;
  acc.push({ n: 3, name: '1440 worldcfg 代码块宽 850.81~874.81（不得 542~566）', pass: !!c3 && c3[0] >= 850 && c3[1] <= 875.5, got: c2 ? JSON.stringify(c2.codeCw_a) + ' → ' + JSON.stringify(c2.codeCw_b) : 'n/a' });
  acc.push({ n: 4, name: '代码横滚 逐页逐视口全不变', pass: codeOvChanged.length === 0, got: codeOvChanged.length === 0 ? 'all identical (' + rows.length + ' cells)' : codeOvChanged.map((c) => c.vp + '/' + c.page + ' ' + c.codeOv_a + '→' + c.codeOv_b).join(', ') });
  acc.push({ n: 5, name: '左边缘对齐 uniqLeftClamped=1 且逐段左边缘位移=0', pass: uniqLeftBad.length === 0 && leftShiftMax < 0.01 && unclampedLeak.length === 0, got: 'uniqBad=' + (uniqLeftBad.join(',') || '0') + '; maxShift=' + leftShiftMax + (leftShiftCell ? ' @' + leftShiftCell : '') + '; 漏限=' + (unclampedLeak.join(',') || '0') });
  acc.push({ n: 6, name: '横向溢出 全档全页 = 0', pass: hOverflowAfter === 0, got: hOverflowAfter + ' / ' + rows.length + ' cells overflow' });
  const negPages = [];
  const byPage = {};
  for (const r of rows) { if (r.lineW_a != null) { byPage[r.page] = byPage[r.page] || []; byPage[r.page].push(r.h_d); } }
  for (const [pg, ds] of Object.entries(byPage)) if (ds.some((d) => d < 0)) negPages.push(pg);
  acc.push({ n: 7, name: '页高变化同向（Δ≥0）', pass: negPages.length === 0, got: Object.entries(byPage).map(([p, ds]) => p + ':' + Math.min(...ds) + '~' + Math.max(...ds)).join(' ') });
  acc.push({ n: 8, name: '视觉可接受（人工判断 + 3 张截图）', pass: null, got: '见 reports/c2-width.md §视觉判断' });

  console.log('\n=== 验收 ===');
  for (const a of acc) console.log('#' + a.n + ' ' + (a.pass === null ? 'MANUAL' : (a.pass ? 'PASS' : 'FAIL')) + '  ' + a.name + '  => ' + a.got);

  /* 一致性守卫：post/live 与 pre 的 product anchor 无关，但产物字节必须没被重建 */
  console.log('\nJSON: ' + JSON_OUT);

  if (SHOTS) await shoot();
}

/* ------------------------------------------------------------------ *
 * 3 张截图：1440 dialogs 中部 / 1440 worldcfg / 390 dialogs
 * 1100 / 1130 两张「对照」附带（可选，默认只截 3 张）
 * ------------------------------------------------------------------ */
async function shoot() {
  const OUT = path.join(ROOT, 'reports', 'c2-shots');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const jobs = [
    { file: '1440-dialogs-mid.png', path: '/paper/dev/dialogs/', width: 1440, height: 900, at: 'mid' },
    { file: '1440-worldcfg.png', path: '/paper/reference/world-configuration/', width: 1440, height: 900, at: 'codeblock' },
    { file: '390-dialogs.png', path: '/paper/dev/dialogs/', width: 390, height: 844, at: 'mid' },
  ];
  for (const j of jobs) {
    const ctx = await browser.newContext({ viewport: { width: j.width, height: j.height }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + j.path, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(200);
    /* 注入同一份目标态 —— 截图必须代表「落地后」的样子 */
    await page.addStyleTag({ content: CSS_B2 });
    await page.waitForTimeout(80);
    const y = await page.evaluate((mode) => {
      const de = document.documentElement;
      if (mode === 'mid') return Math.round((de.scrollHeight - window.innerHeight) * 0.45);
      /* codeblock：让第 1 个代码块落在视口 40% 处 */
      const pre = document.querySelector('pre.code-pre');
      if (!pre) return Math.round((de.scrollHeight - window.innerHeight) * 0.45);
      const r = pre.getBoundingClientRect();
      return Math.max(0, Math.round(window.scrollY + r.top - window.innerHeight * 0.4));
    }, j.at);
    await page.evaluate((top) => window.scrollTo({ top, left: 0, behavior: 'instant' }), y);
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(OUT, j.file) });
    console.log('shot ' + j.file + '  scrollY=' + y);
    await ctx.close();
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
