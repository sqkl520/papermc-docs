'use strict';
/**
 * b2p-verify.js — 批 2 / 批 3 的统一验收探针（**只读站点**，不改任何源码/产物）
 *
 * 设计原则（对应计划 §4.3 / §5）：
 *   1. 首尾各取一次产物指纹；不一致 ⇒ exit **2**（漂移，证据作废），与断言失败（exit 1）区分。
 *   2. 每个断言给出 {id, desc, expect, actual, pass}，最后输出 `{pass, fails[], metrics{}}`。
 *   3. 阈值全部写成具名常量，报告里引用同一套数字。
 *
 * 用法：
 *   node tools/b2p-verify.js                    # 全部分组
 *   node tools/b2p-verify.js --only=A,C         # 只跑 A 与 C 组
 *   node tools/b2p-verify.js --stage=pre        # 批 2/3 落地前的基线采集（断言会"预期失败"，只采 metrics）
 *   node tools/b2p-verify.js --out=reports/b2-baselines/geom.f3ebbfc.json
 *
 * 分组：
 *   A 批2 · 正文列宽（prose.capW=640 / article.x 不变 / article.w 不变 / 代码横滚不变）
 *   B 批3 · 代码 strut（pre 字号 / code 字号不变 / 行推进 22.0–23.5）
 *   C 批3 · 断崖（1024→1440 的 article.w 序列无 ≥1% 下跌；1280/1440 与基线相同）
 *   D 批3 · 吸顶条（1025/1100/1279 的 toc 高 48±2、吸顶、--toc-offset 48–52、锚点遮挡 0/3）
 *   E 批3 · 图片（88 个 .content-img 带 width/height；lightbox 占位不带）
 *   F 批3 · P2（h5=16px / .grp-zh=12.48px / filter-bar sticky / toc aria-current=1）
 *   G 通用 · 无横向溢出（8 档 × 6 页）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const ONLY = (opt('only', 'A,B,C,D,E,F,G')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const STAGE = opt('stage', 'post');          // pre = 落地前采基线；post = 验收
const OUT = opt('out', '');
const BASE = opt('url', 'http://127.0.0.1:8787');

const TMP = path.join(require("os").tmpdir() || '', 'b2p');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* ---------- 阈值（唯一真源） ---------- */
const T = {
  PROSE_MAX: 640, PROSE_TOL: 1,
  CODE_ADV_MIN: 22.0, CODE_ADV_MAX: 23.5,
  CODE_ADV_BASE: 24.8,
  PRE_FS: '14px', CODE_FS: '13.6px',
  CLIFF_MAX_DROP_PCT: 1.0,
  TOC_BAR_MIN: 48, TOC_BAR_MAX: 52,
  TOC_OFFSET_MIN: 48, TOC_OFFSET_MAX: 52,
  OCCLUDED_MAX: 0,
  IMG_COUNT: 88,
  H5_FS: 16, GRP_ZH_FS: 12.48,
  ARTICLE_X: { 1440: 316, 1280: 316, 1024: 306 },
  ARTICLE_W_BASE: { 1440: 849, 1280: 689, 1024: 693 },
  ARTICLE_W_B23: { 1440: 849, 1280: 689, 1024: 683, 1025: 684, 1100: 759, 1200: 859, 1279: 938 },
};

const PAGES = [
  ['dialogs', '/paper/dev/dialogs/'],
  ['particles', '/paper/dev/particles/'],
  ['tuning', '/velocity/tuning/'],
  ['worldcfg', '/paper/reference/world-configuration/'],
  ['landing', '/'],
  ['allpages', '/all-pages.html'],
];
const VPS = [1024, 1025, 1100, 1200, 1279, 1280, 1440, 1920];

/* ---------- 指纹（首尾自检） ---------- */
function anchorOf() {
  const KEY = ['assets/site.css', 'assets/site.js', 'assets/search-index.js', 'tools/site/assets.js'];
  return crypto.createHash('sha256').update(KEY.map((k) => {
    const p = path.join(ROOT, k);
    return fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'missing';
  }).join('|')).digest('hex').slice(0, 16);
}

/* ---------- 页面内测量 ---------- */
const MEASURE = () => {
  const q = (s) => document.querySelector(s);
  const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y + window.scrollY), w: Math.round(b.width), h: Math.round(b.height * 10) / 10 }; };
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const isProse = (el) => {
    if (!el) return false;
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const art = q('.article') || q('main.content');
  const paras = art ? [...art.querySelectorAll('p')].filter(isProse) : [];
  const measure = (el) => {
    if (!el) return null;
    const st = getComputedStyle(el);
    const r = document.createRange(); r.selectNodeContents(el);
    const rects = [...r.getClientRects()].filter((x) => x.width > 1);
    if (!rects.length) return null;
    const lineW = Math.max(...rects.map((x) => x.width));
    const eb = el.getBoundingClientRect();
    const capW = Math.max(eb.width - (parseFloat(st.paddingLeft) || 0) - (parseFloat(st.paddingRight) || 0), lineW);
    const cvs = document.createElement('canvas').getContext('2d');
    cvs.font = st.fontSize + ' ' + st.fontFamily;
    const zeroW = cvs.measureText('0').width;
    return { capW: Math.round(capW), lineW: Math.round(lineW), ch: Math.round(capW / zeroW), cjk: Math.round(capW / parseFloat(st.fontSize)), fontSize: parseFloat(st.fontSize) };
  };
  const scrolls = [...document.querySelectorAll('.code-scroll')];
  const pre = q('.code-pre');
  const codeEl = pre ? (pre.querySelector('code') || pre) : null;
  let adv = null;
  if (codeEl) {
    const rg = document.createRange(); rg.selectNodeContents(codeEl);
    const tops = [...new Set([...rg.getClientRects()].filter((x) => x.height > 1).map((x) => Math.round(x.top * 100) / 100))].sort((a, b) => a - b);
    if (tops.length > 1) adv = +(tops[1] - tops[0]).toFixed(2);
  }
  const toc = q('.toc-side');
  const imgs = [...document.querySelectorAll('.content-img')];
  const lbImg = q('.lightbox img');
  return {
    article: box(art), h1: box(q('.article h1, h1')),
    proseCount: paras.length, prose: measure(paras[0]),
    proseMaxW: paras.length ? Math.max(...paras.map((p) => Math.round(p.getBoundingClientRect().width))) : null,
    pageHeight: document.documentElement.scrollHeight,
    docW: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
    toc: box(toc), tocDisplay: cs(toc, 'display'), tocPosition: cs(toc, 'position'),
    tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
    code: {
      total: scrolls.length, overflowing: scrolls.filter((s) => s.scrollWidth > s.clientWidth + 1).length,
      preFS: pre ? cs(pre, 'fontSize') : null, preLH: pre ? cs(pre, 'lineHeight') : null,
      codeFS: codeEl ? cs(codeEl, 'fontSize') : null, adv,
    },
    tableTotal: document.querySelectorAll('.table-wrap').length,
    tableOverflowing: [...document.querySelectorAll('.table-wrap')].filter((t) => t.scrollWidth > t.clientWidth + 1).length,
    imgs: {
      total: imgs.length,
      withWH: imgs.filter((i) => i.hasAttribute('width') && i.hasAttribute('height')).length,
      lbHasW: lbImg ? lbImg.hasAttribute('width') : null,
    },
    h5: (() => { const h = q('.article h5'); return h ? parseFloat(getComputedStyle(h).fontSize) : null; })(),
    grpZh: (() => { const g = q('.side-group-title .grp-zh'); return g ? Math.round(parseFloat(getComputedStyle(g).fontSize) * 100) / 100 : null; })(),
    filterBarPos: (() => { const f = q('.filter-bar'); return f ? getComputedStyle(f).position : null; })(),
    tocAria: document.querySelectorAll('.toc-side a[aria-current="true"]').length,
    tocLinksVisible: toc ? [...toc.querySelectorAll('a')].filter((a) => { const b = a.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length : 0,
  };
};

/* ---------- 断言收集 ---------- */
const A = [];
const add = (id, desc, expect, actual, pass) => A.push({ id, desc, expect, actual, pass });
const eq = (id, desc, expect, actual) => add(id, desc, expect, actual, JSON.stringify(expect) === JSON.stringify(actual));
const near = (id, desc, expect, tol, actual) => add(id, desc, `${expect}±${tol}`, actual, typeof actual === 'number' && Math.abs(actual - expect) <= tol);
const le = (id, desc, max, actual) => add(id, desc, `<=${max}`, actual, typeof actual === 'number' && actual <= max);

(async () => {
  if (!EXE) { console.error('no chrome found'); process.exit(1); }
  const fp0 = anchorOf();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const rows = [];
  const byKey = (pg, vw) => rows.find((r) => r.page === pg && r.vw === vw);

  for (const vw of VPS) {
    await page.setViewportSize({ width: vw, height: vw === 1920 ? 1080 : 900 });
    for (const [name, url] of PAGES) {
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
      const m = await page.evaluate(MEASURE);
      rows.push({ vw, page: name, url, ...m });
    }
    process.stderr.write('vp ' + vw + ' measured\n');
  }

  /* ===== A 组：批 2 正文列宽 ===== */
  if (ONLY.includes('A')) {
    for (const vw of [1024, 1280, 1440, 1920]) {
      for (const pg of ['dialogs', 'particles', 'tuning']) {
        const r = byKey(pg, vw);
        if (!r || !r.prose) continue;
        near(`A1.${vw}.${pg}`, `prose.capW 收敛到 40rem（${vw} ${pg}）`, T.PROSE_MAX, T.PROSE_TOL, r.prose.capW);
      }
    }
    // 左边缘不变
    for (const vw of Object.keys(T.ARTICLE_X).map(Number)) {
      const r = byKey('dialogs', vw);
      if (!r) continue;
      eq(`A2.${vw}`, `article.x 左对齐不变（${vw}）`, T.ARTICLE_X[vw], r.article.x);
    }
    // 只封行文块：article.w 不变
    for (const vw of [1280, 1440]) {
      const r = byKey('dialogs', vw);
      if (!r) continue;
      eq(`A3.${vw}`, `article.w 未被整列封顶（${vw}）`, T.ARTICLE_W_BASE[vw], r.article.w);
    }
    // 代码块横滚数不变
    const d1440 = byKey('dialogs', 1440), p1440 = byKey('particles', 1440);
    if (d1440) eq('A4.1440.dialogs', '代码块横滚数不变（1440 dialogs）', 5, d1440.code.overflowing);
    if (p1440) eq('A4.1440.particles', '代码块横滚数不变（1440 particles）', 4, p1440.code.overflowing);
  }

  /* ===== B 组：批 3 代码 strut ===== */
  if (ONLY.includes('B')) {
    for (const pg of ['dialogs', 'particles', 'worldcfg']) {
      const r = byKey(pg, 1440);
      if (!r || !r.code.preFS) continue;
      eq(`B1.${pg}`, `.code-pre 字号 = .875rem（${pg}）`, T.PRE_FS, r.code.preFS);
      eq(`B2.${pg}`, `code 字形字号不变（${pg}）`, T.CODE_FS, r.code.codeFS);
      add(`B3.${pg}`, `代码行推进落在 [${T.CODE_ADV_MIN},${T.CODE_ADV_MAX}]（${pg}）`, `${T.CODE_ADV_MIN}..${T.CODE_ADV_MAX}`, r.code.adv,
        typeof r.code.adv === 'number' && r.code.adv >= T.CODE_ADV_MIN && r.code.adv <= T.CODE_ADV_MAX);
    }
  }

  /* ===== C 组：断崖 ===== */
  if (ONLY.includes('C')) {
    for (const pg of ['dialogs', 'particles', 'tuning']) {
      const seq = VPS.map((vw) => ({ vw, r: byKey(pg, vw) })).filter((x) => x.r && x.r.article);
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1], b = seq[i];
        const drop = ((b.r.article.w - a.r.article.w) / a.r.article.w) * 100;
        add(`C1.${pg}.${a.vw}->${b.vw}`, `相邻档 article.w 跌幅 ≤ ${T.CLIFF_MAX_DROP_PCT}%（${pg} ${a.vw}→${b.vw}）`,
          `>= -${T.CLIFF_MAX_DROP_PCT}%`, drop.toFixed(2) + '%', drop >= -T.CLIFF_MAX_DROP_PCT);
      }
    }
    // 1280/1440 与基线逐字段相同（不回归）
    for (const vw of [1280, 1440]) {
      const r = byKey('dialogs', vw);
      if (r) eq(`C2.${vw}`, `≥1280 的 article.w 与基线相同（${vw}）`, T.ARTICLE_W_BASE[vw], r.article.w);
    }
  }

  /* ===== D 组：吸顶条 + 锚点遮挡 ===== */
  if (ONLY.includes('D')) {
    for (const vw of [1025, 1100, 1279]) {
      const r = byKey('dialogs', vw);
      if (!r) continue;
      add(`D1.${vw}`, `1025–1279 的 toc 高 = 吸顶条（${vw}）`, `${T.TOC_BAR_MIN}..${T.TOC_BAR_MAX}`,
        r.toc ? r.toc.h : null, !!r.toc && r.toc.h >= T.TOC_BAR_MIN && r.toc.h <= T.TOC_BAR_MAX);
      const off = parseInt(r.tocOffset, 10);
      add(`D2.${vw}`, `--toc-offset ∈ [${T.TOC_OFFSET_MIN},${T.TOC_OFFSET_MAX}]（${vw}）`,
        `${T.TOC_OFFSET_MIN}..${T.TOC_OFFSET_MAX}`, r.tocOffset, off >= T.TOC_OFFSET_MIN && off <= T.TOC_OFFSET_MAX);
      eq(`D3.${vw}`, `1025–1279 目录链接仍可数（${vw}）`, true, r.tocLinksVisible >= 1);
    }
    // 吸顶 + 锚点遮挡（需要滚动，单独一轮）
    for (const vw of [1025, 1100, 1279, 390]) {
      await page.setViewportSize({ width: vw, height: vw === 390 ? 844 : 900 });
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
      const stick = await page.evaluate(() => {
        const toc = document.querySelector('.toc-side');
        window.scrollTo(0, 4000);
        const b = toc.getBoundingClientRect();
        return { top: Math.round(b.top * 10) / 10, pos: getComputedStyle(toc).position };
      });
      await page.waitForTimeout(120);
      const stick2 = await page.evaluate(() => {
        const toc = document.querySelector('.toc-side');
        const b = toc.getBoundingClientRect();
        return { top: Math.round(b.top * 10) / 10 };
      });
      const barH = await page.evaluate(() => Math.round(document.querySelector('.toc-side').getBoundingClientRect().height));
      const isBar = barH <= T.TOC_BAR_MAX + 2;
      if (isBar) eq(`D4.${vw}`, `吸顶条滚到 4000 后 top = 顶栏高（${vw}）`, 52, stick2.top);
      // 锚点遮挡：只有在"确有吸顶条"时才有判定意义（否则右栏本就不遮挡，会得到假 PASS）
      const occ = await page.evaluate(() => {
        const heads = [...document.querySelectorAll('.article h2[id], .article h3[id], .article h4[id]')];
        const padTop = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        let bad = 0, total = 0;
        for (const i of [0, 3, 8]) {
          const h = heads[i]; if (!h) continue;
          const abs = h.getBoundingClientRect().top + window.scrollY;
          window.scrollTo(0, Math.max(0, abs - padTop));
          const b = h.getBoundingClientRect();
          const hit = document.elementFromPoint(Math.min(b.x + 25, window.innerWidth - 6), Math.max(b.y + Math.ceil(b.height / 2), 2));
          total++;
          if (hit && hit.closest && (hit.closest('.toc-side') || hit.closest('.topbar'))) bad++;
        }
        return { bad, total };
      });
      if (isBar) le(`D5.${vw}`, `锚点遮挡数（${vw}，吸顶条态）`, T.OCCLUDED_MAX, occ.bad);
      else add(`D5.${vw}`, `锚点遮挡数（${vw}）`, 'N/A（本档无吸顶条，不可判定）', `${occ.bad}/${occ.total}`, true);
    }
  }

  /* ===== E 组：图片 ===== */
  if (ONLY.includes('E')) {
    const d = byKey('dialogs', 1440);
    // 按页面去重（同一页在 8 档视口被量了 8 次，直接累加会得到 8 倍）
    const perPage = PAGES.map(([n]) => rows.find((r) => r.page === n && r.vw === 1440)).filter(Boolean);
    const totalImg = perPage.reduce((a, r) => a + r.imgs.total, 0);
    const totalWH = perPage.reduce((a, r) => a + r.imgs.withWH, 0);
    eq('E1', '抽样 6 页（1440 档）的 .content-img 全部带 width/height', totalImg, totalWH);
    add('E2', `抽样 6 页 .content-img 数（全站静态统计应为 ${T.IMG_COUNT}）`, '>=1', totalImg, totalImg >= 1);
    if (d) eq('E3', 'lightbox 占位 img 不带 width', false, d.imgs.lbHasW);
  }

  /* ===== F 组：P2 收尾 ===== */
  if (ONLY.includes('F')) {
    const h5pages = ['/paper/reference/cli-arguments/', '/paper/dev/pdc/'];
    for (const u of h5pages) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(BASE + u, { waitUntil: 'domcontentloaded' });
      const fs5 = await page.evaluate(() => { const h = document.querySelector('.article h5'); return h ? parseFloat(getComputedStyle(h).fontSize) : null; });
      if (fs5 !== null) eq(`F1${u}`, `.article h5 字号 = 16px（${u}）`, T.H5_FS, fs5);
    }
    const gz = byKey('dialogs', 1440);
    if (gz && gz.grpZh !== null) eq('F2', '.grp-zh 字号 = 12.48px', T.GRP_ZH_FS, gz.grpZh);
    await page.goto(BASE + '/all-pages.html', { waitUntil: 'domcontentloaded' });
    const fb = await page.evaluate(() => { const f = document.querySelector('.filter-bar'); return f ? getComputedStyle(f).position : null; });
    eq('F3', '.filter-bar 吸顶', 'sticky', fb);
    await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(300);
    const aria = await page.evaluate(() => document.querySelectorAll('.toc-side a[aria-current="true"]').length);
    eq('F4', '目录当前项 aria-current 恰好 1 个', 1, aria);
  }

  /* ===== G 组：无横向溢出 ===== */
  if (ONLY.includes('G')) {
    let bad = 0;
    for (const r of rows) if (r.docW.scroll > r.docW.client) { bad++; add(`G1.${r.vw}.${r.page}`, `横向溢出（${r.vw} ${r.page}）`, `${r.docW.client}`, `${r.docW.scroll}`, false); }
    add('G1', '8 档 × 6 页 横向溢出数', 0, bad, bad === 0);
  }

  await browser.close();
  const fp1 = anchorOf();
  const drift = fp0 !== fp1;

  const fails = A.filter((x) => !x.pass);
  const result = {
    stage: STAGE, at: new Date().toISOString(), base: BASE, exe: EXE,
    fingerprint: { before: fp0, after: fp1, drift },
    pass: fails.length === 0 && !drift,
    fails: fails.map((f) => `${f.id} ${f.desc} expect=${f.expect} actual=${f.actual}`),
    checks: A,
    metrics: { rows },
  };
  const outFile = OUT ? path.resolve(ROOT, OUT) : path.join(TMP, `verify.${STAGE}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1), 'utf8');

  console.log('== 断言 ==');
  for (const a of A) console.log((a.pass ? 'PASS ' : 'FAIL ') + a.id + ' | ' + a.desc + ' | expect=' + a.expect + ' actual=' + a.actual);
  console.log('\nfingerprint ' + fp0 + ' -> ' + fp1 + (drift ? '  ** DRIFT **' : '  ok'));
  console.log('checks=' + A.length + ' fails=' + fails.length);
  console.log('WROTE ' + outFile);
  if (drift) { console.error('BUILD DRIFT: 测量期间产物变化，本份结果作废'); process.exit(2); }
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
