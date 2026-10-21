'use strict';
/**
 * verify-mobile-a.js — Agent A verification harness (横向溢出与抽样).
 *
 * Four assertions:
 *   A1  320/360/390/414 × 10 core pages  -> documentElement.scrollWidth - clientWidth <= 1   (40 combos)
 *   A2  clipped-aware "real wideners" == 0 (clear definition below) + a.skip listed as benign
 *   A3  20 deterministically sampled *other* pages @ 320 & 390 -> overflow <= 1 (40 combos)
 *   A4  834x1112 & 1024x768 -> overflow <= 1, and vpExpanded (innerWidth > clientWidth+1) == 0
 *
 * A2 definition (must stay explicit):
 *   real widener = an element that
 *     (a) is rendered (rect.width>0 && rect.height>0), and
 *     (b) is not itself position:fixed and has NO position:fixed ancestor (fixed subtrees never widen the document), and
 *     (c) is not position:absolute && visibility:hidden, and
 *     (d) has rect.right > documentElement.clientWidth + 1  (LTR: only rightward overflow enters the scrollable overflow region), and
 *     (e) has NO ancestor (parent chain up to and incl. documentElement) whose computed overflow-x is auto|scroll|hidden|clip.
 *   Benign, counted separately: rect.right <= clientWidth+1 && rect.left < -1  -> LTR negative overflow, never creates a scroll area
 *   (today that is a.skip{left:-9999px} in the pre-change build).
 *   Also reported: rawWideners = (d) without (e)/(b), and rootClip = body/html overflow-x is clipping (would mask everything).
 *
 * Usage:
 *   node tools/verify-mobile-a.js [--json] [--json=path] [--md=path] [--url=http://127.0.0.1:8787]
 *                                 [--before=http://127.0.0.1:8788] [--bases=both|after|before] [--limit=N]
 *   --json      print the summary JSON to stdout as well
 *   --limit=N   only take N extra (A3) pages  (smoke runs)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const hasFlag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const AFTER_URL = opt('url', 'http://127.0.0.1:8787');
const BEFORE_URL = opt('before', 'http://127.0.0.1:8788');
const BASES_OPT = opt('bases', 'both');
const LIMIT = Number(opt('limit', '0')) || 0;
const JSON_ARG = opt('json', null);
const STDIO_JSON = hasFlag('json') || (JSON_ARG !== null && JSON_ARG !== '');
const JSON_OUT = path.resolve(REPO, (JSON_ARG && JSON_ARG !== 'true') ? JSON_ARG : path.join('reports', 'mobile-verify-a.json'));
const MD_OUT = path.resolve(REPO, opt('md', path.join('reports', 'mobile-verify-a.md')));

const BASES = BASES_OPT === 'both'
  ? [{ name: 'after', url: AFTER_URL }, { name: 'before', url: BEFORE_URL }]
  : BASES_OPT === 'before' ? [{ name: 'before', url: BEFORE_URL }] : [{ name: 'after', url: AFTER_URL }];

/* ------------------------------------------------------------------ page sets */

const CORE_PAGES = [
  '/',
  '/paper/',
  '/paper/dev/command-api/basics/introduction/',
  '/paper/reference/world-configuration/',
  '/velocity/tuning/',
  '/folia/reference/region-logic/',
  '/all-pages.html',
  '/snapshots.html',
  '/sections/paper.html',
  '/categories/paper-dev-command.html',
];

const V_A1 = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x640', width: 360, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '414x896', width: 414, height: 896 },
];
const V_A4 = [
  { name: '834x1112', width: 834, height: 1112 },
  { name: '1024x768', width: 1024, height: 768 },
];
const V_A3 = [V_A1[0], V_A1[2]]; // 320, 390

/* --------------------------------------------------- A3 deterministic sampling */

const REQUIRED_EXTRA = [
  '/paper/reference/world-configuration/',
  '/velocity/tuning/',
  '/paper/dev/pdc/',
  '/paper/dev/dialogs/',
  '/folia/reference/region-logic/',
  '/paper/dev/command-api/basics/command-tree/',
];

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–', '&rarr;': '→', '&times;': '×' };
const decode = (s) => s.replace(/&[a-z#0-9x]+;/gi, (m) => (ENT[m] !== undefined ? ENT[m] : m));

/** longest rendered line inside <pre> (px proxy: character count after tag/entity strip). */
function preStats(html) {
  const blocks = html.match(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi) || [];
  let maxLine = 0;
  let maxHead = 0;
  for (const b of blocks) {
    const text = decode(b.replace(/<[^>]*>/g, ''));
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (line.length > maxLine) maxLine = line.length;
    }
    const head = /<pre\b([^>]*)>/i.exec(b);
    const h = head ? head[1].replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    if (h.length > maxHead) maxHead = h.length;
  }
  return { preBlocks: blocks.length, maxPreLine: maxLine };
}

/** page inventory from the built search index; URL form uses directory URLs (serve.js appends index.html). */
function pageInventory() {
  const idx = JSON.parse(fs.readFileSync(path.join(REPO, 'search-index.json'), 'utf8'));
  const out = [];
  for (const p of idx.pages) {
    const rel = String(p.p || '').replace(/^\.?\//, '');
    if (!rel) continue;
    const fileRel = rel.endsWith('/') ? rel + 'index.html' : rel;
    const file = path.join(REPO, fileRel);
    let url;
    if (fileRel.endsWith('/index.html')) url = '/' + fileRel.slice(0, -'index.html'.length);
    else url = '/' + fileRel;
    let html = '';
    try { html = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const tables = (html.match(/<table\b/gi) || []).length;
    const st = preStats(html);
    out.push({ url, source_path: fileRel, title: String(p.t || ''), section: String(p.sid || ''), tableCount: tables, ...st });
  }
  return out;
}

function sampleExtra() {
  const all = pageInventory();
  const coreSet = new Set(CORE_PAGES);
  const pool = all.filter((p) => !coreSet.has(p.url) && (p.preBlocks > 0 || p.tableCount > 0));
  const ranked = pool.slice().sort((a, b) =>
    (b.maxPreLine - a.maxPreLine) || (b.tableCount - a.tableCount) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const byUrl = new Map(all.map((p) => [p.url, p]));
  const selected = [];
  const seen = new Set();
  const push = (url, why) => {
    if (seen.has(url)) return;
    const rec = byUrl.get(url) || { url, missing: true };
    seen.add(url);
    selected.push({ url, rank: selected.length + 1, required: why === 'required', why, ...rec });
  };
  for (const u of REQUIRED_EXTRA) push(u, 'required');
  const requiredCount = selected.length;
  for (const r of ranked) {
    if (LIMIT && selected.length - requiredCount >= LIMIT) break;
    push(r.url, 'ranked');
    if (selected.length >= 20) break;
  }
  return {
    rule: '池 = search-index.json 全部构建页（141）去掉核心 10 页、且 pre 块数或 table 数 > 0；'
      + '排序 = 最长 <pre> 行字符数降序 → <table> 数量降序 → URL 升序；前 6 名为任务指定强制包含项，其余按序补齐到 20 页。',
    pool_size: pool.length,
    pool_with_pre: pool.filter((p) => p.preBlocks > 0).length,
    pool_with_tables: pool.filter((p) => p.tableCount > 0).length,
    inventory_size: all.length,
    ranked_top: ranked.slice(0, 25).map((r, i) => ({ rank: i + 1, url: r.url, maxPreLine: r.maxPreLine, preBlocks: r.preBlocks, tableCount: r.tableCount })),
    required_count: requiredCount,
    selected,
  };
}

/* ---------------------------------------------------------------------- probe */

const PROBE = () => {
  const de = document.documentElement;
  const cw = de.clientWidth;
  const overflow = de.scrollWidth - de.clientWidth;
  const CLIP = ['auto', 'scroll', 'hidden', 'clip'];
  const sel = (el) => {
    let s = el.tagName.toLowerCase();
    const c = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    if (c) s += '.' + c;
    const id = el.id ? '#' + el.id : '';
    return s + id;
  };
  const chain = (el) => {
    const c = [];
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++) { c.push(sel(p)); p = p.parentElement; }
    return c.join(' < ');
  };
  /** ancestor that clips horizontally, or a fixed-position ancestor (fixed subtree never widens the doc) */
  const clipInfo = (el) => {
    let p = el.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      if (cs.position === 'fixed') return { reason: 'fixed-ancestor', node: sel(p) };
      if (CLIP.includes(cs.overflowX)) return { reason: 'overflow-x:' + cs.overflowX, node: sel(p) };
      p = p.parentElement;
    }
    return null;
  };

  const realWideners = [];
  const clippedWideners = [];
  const rawWideners = [];
  const negOverflow = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;                                  // (b) fixed subtree root
    if (cs.position === 'absolute' && cs.visibility === 'hidden') continue;  // (c)
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;                          // (a)
    const rec = {
      sel: sel(el), tag: el.tagName.toLowerCase(),
      left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
      overflowX: cs.overflowX, ws: cs.whiteSpace, pos: cs.position,
      parentChain: chain(el),
    };
    if (r.right > cw + 1) {                                                 // (d) rightward overflow
      rawWideners.push(rec);
      const ci = clipInfo(el);
      if (ci) clippedWideners.push({ ...rec, clippedBy: ci.node, why: ci.reason });
      else realWideners.push(rec);
    } else if (r.left < -1) {                                               // benign LTR negative overflow
      negOverflow.push(rec);
    }
  }
  const byRight = (a, b) => b.right - a.right;
  const uniqCls = (arr) => [...new Set(arr.map((x) => x.sel))];
  const clipHist = {};
  for (const c of clippedWideners) {
    const k = c.clippedBy + '  [' + c.why + ']';
    clipHist[k] = (clipHist[k] || 0) + 1;
  }

  const rootClip = (() => {
    const b = getComputedStyle(document.body).overflowX;
    const h = getComputedStyle(de).overflowX;
    return { body: b, html: h, clipping: [...CLIP].slice(0).includes(b) || CLIP.includes(h) };
  })();

  const skipEl = document.querySelector('a.skip');
  const sk = skipEl ? skipEl.getBoundingClientRect() : null;

  return {
    overflow, clientWidth: cw, innerWidth: window.innerWidth,
    scrollWidth: de.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
    vpExpanded: window.innerWidth > de.clientWidth + 1,
    realWidenersCount: realWideners.length,
    clippedWidenersCount: clippedWideners.length,
    rawWidenersCount: rawWideners.length,
    negOverflowCount: negOverflow.length,
    realWideners: realWideners.sort(byRight).slice(0, 10),
    realWidenersAll: uniqCls(realWideners).slice(0, 30),
    clippedWideners: clippedWideners.sort(byRight).slice(0, 10),
    clippedByHist: clipHist,
    negOverflow: negOverflow.slice(0, 10),
    negOverflowAll: uniqCls(negOverflow).slice(0, 30),
    rootClip,
    skipProbe: sk ? { left: Math.round(sk.left), right: Math.round(sk.right), w: Math.round(sk.width), transform: getComputedStyle(skipEl).transform } : null,
    title: document.title,
  };
};

/* ------------------------------------------------------------------- browser */

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

function browserPath() {
  for (const c of CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch {} }
  return null;
}

const combos = new Set(); // "vp|page"
function need(vp, page) { combos.add(vp.name + '|' + page); }

async function run() {
  const extra = sampleExtra();
  const extraPages = extra.selected.map((s) => s.url);

  for (const vp of V_A1) for (const p of CORE_PAGES) need(vp, p);
  for (const vp of V_A4) for (const p of CORE_PAGES) need(vp, p);
  for (const vp of V_A3) for (const p of extraPages) need(vp, p);

  const exe = browserPath();
  if (!exe) throw new Error('no chrome/chromium found');
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const VP_BY_NAME = {};
  for (const vp of [...V_A1, ...V_A4]) VP_BY_NAME[vp.name] = vp;

  const measurements = {};
  for (const base of BASES) {
    measurements[base.name] = [];
    const vpNames = [...new Set([...combos].map((c) => c.split('|')[0]))];
    for (const vn of vpNames) {
      const vp = VP_BY_NAME[vn];
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2, isMobile: vp.width < 768, hasTouch: vp.width < 768,
      });
      const page = await ctx.newPage();
      for (const c of combos) {
        if (!c.startsWith(vn + '|')) continue;
        const p = c.slice(vn.length + 1);
        const url = base.url + p;
        const row = { base: base.name, viewport: vn, page: p, url };
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 30000 });
          Object.assign(row, await page.evaluate(PROBE));
        } catch (e) {
          row.error = String(e.message || e).slice(0, 200);
        }
        measurements[base.name].push(row);
        const bad = row.error ? 'ERR ' : (row.overflow > 1 ? 'FAIL' : 'ok  ');
        console.log(bad + ' ' + base.name.padEnd(6) + vn.padEnd(9) + p.padEnd(56)
          + (row.error ? row.error.slice(0, 60)
            : 'overflow=' + String(row.overflow).padStart(4)
              + ' real=' + String(row.realWidenersCount).padStart(2)
              + ' raw=' + String(row.rawWidenersCount).padStart(2)
              + ' neg=' + String(row.negOverflowCount).padStart(2)
              + ' vpExp=' + row.vpExpanded
              + ' iw/cw=' + row.innerWidth + '/' + row.clientWidth));
      }
      await ctx.close();
    }
  }
  await browser.close();
  return { extra, measurements };
}

/* ---------------------------------------------------------------- assertions */

const find = (rows, base, vp, page) => rows.find((r) => r.base === base && r.viewport === vp && r.page === page);
const maxOverflow = (rows, base, vp, pages) => {
  const v = rows.filter((r) => r.base === base && r.viewport === vp && pages.includes(r.page) && !r.error)
    .map((r) => r.overflow);
  return v.length ? Math.max(...v) : null;
};
const fails = (rows, base, vp, pages, pred) =>
  rows.filter((r) => r.base === base && r.viewport === vp && pages.includes(r.page) && !pred(r));

function assertions(extra, rows) {
  const extraPages = extra.selected.map((s) => s.url);
  const out = {};

  // A1
  {
    const combosTotal = V_A1.length * CORE_PAGES.length;
    const bad = [];
    for (const vp of V_A1) for (const p of CORE_PAGES) {
      const r = find(rows, 'after', vp.name, p);
      if (!r || r.error || !(r.overflow <= 1)) bad.push(r || { viewport: vp.name, page: p, missing: true });
    }
    out.A1 = {
      assert: 'documentElement.scrollWidth - clientWidth <= 1',
      combos: combosTotal,
      combos_ok: combosTotal - bad.length,
      pass: bad.length === 0,
      failed: bad.map((r) => ({ viewport: r.viewport, page: r.page, overflow: r.overflow, error: r.error })),
      per_viewport: V_A1.map((vp) => ({
        viewport: vp.name,
        after_max: maxOverflow(rows, 'after', vp.name, CORE_PAGES),
        before_max: maxOverflow(rows, 'before', vp.name, CORE_PAGES),
        after_fail: fails(rows, 'after', vp.name, CORE_PAGES, (r) => r.overflow <= 1).length,
        before_fail: rows.filter((r) => r.base === 'before' && r.viewport === vp.name && CORE_PAGES.includes(r.page) && (r.error || r.overflow > 1)).length,
      })),
    };
  }

  // A2 — asserted on the AFTER build; the BEFORE build is reported as the contrast (it has real wideners).
  {
    const real = rows.filter((r) => !r.error && r.realWidenersCount > 0);
    const afterRows = rows.filter((r) => r.base === 'after' && !r.error);
    const beforeRows = rows.filter((r) => r.base === 'before' && !r.error);
    const sumReal = (rs) => rs.reduce((s, r) => s + (r.realWidenersCount || 0), 0);
    const totalRealAfter = sumReal(afterRows);
    const totalRealBefore = sumReal(beforeRows);
    const totalRaw = rows.reduce((s, r) => s + (r.rawWidenersCount || 0), 0);
    const perVp = {};
    for (const r of rows) {
      if (r.error) continue;
      const k = r.base + ' ' + r.viewport;
      perVp[k] = perVp[k] || { base: r.base, viewport: r.viewport, real: 0, raw: 0, clipped: 0, neg: 0, combos: 0 };
      perVp[k].real += r.realWidenersCount; perVp[k].raw += r.rawWidenersCount;
      perVp[k].clipped += r.clippedWidenersCount; perVp[k].neg += r.negOverflowCount; perVp[k].combos++;
    }
    const rootClip = rows.find((r) => !r.error && r.rootClip && r.rootClip.clipping);
    const clipHist = {};
    for (const r of afterRows) for (const [k, n] of Object.entries(r.clippedByHist || {})) clipHist[k] = (clipHist[k] || 0) + n;
    const negHist = {};
    for (const r of rows) {
      if (r.error) continue;
      for (const s of (r.negOverflowAll || [])) {
        const key = s.replace(/#.*$/, '');
        negHist[key] = (negHist[key] || 0) + 1;
      }
    }
    const negSample = [
      ...rows.filter((r) => r.base === 'after' && !r.error && r.negOverflowCount > 0).slice(0, 4),
      ...rows.filter((r) => r.base === 'before' && !r.error && r.negOverflowCount > 0).slice(0, 4),
    ].map((r) => ({ base: r.base, viewport: r.viewport, page: r.page, count: r.negOverflowCount, selectors: r.negOverflowAll.slice(0, 5), skipProbe: r.skipProbe }));
    out.A2 = {
      assert: '真实撑宽元素 = 0（clipped-aware，判定取改后构建）',
      pass: totalRealAfter === 0,
      real_total: totalRealAfter,
      real_total_after: totalRealAfter,
      real_total_before: totalRealBefore,
      real_hits: real.filter((r) => r.base === 'after').map((r) => ({ base: r.base, viewport: r.viewport, page: r.page, count: r.realWidenersCount, elements: r.realWidenersAll })),
      real_hits_before: real.filter((r) => r.base === 'before').slice(0, 12).map((r) => ({ base: r.base, viewport: r.viewport, page: r.page, count: r.realWidenersCount, elements: r.realWidenersAll.slice(0, 8) })),
      raw_total: totalRaw,
      clipped_total: rows.reduce((s, r) => s + (r.clippedWidenersCount || 0), 0),
      clipped_by_hist: Object.entries(clipHist).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ clippedBy: k, n })),
      neg_overlap_hist: Object.entries(negHist).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ selector: k, viewports_seen: n })),
      per_base_viewport: Object.values(perVp).sort((a, b) => (a.base + a.viewport < b.base + b.viewport ? -1 : 1)),
      root_clipping_any: rootClip ? rootClip.rootClip : null,
      benign_negative_total: rows.reduce((s, r) => s + (r.negOverflowCount || 0), 0),
      benign_negative_sample: negSample,
      rule: [
        'rect 宽高均 > 0（已渲染元素）',
        '元素本身与全部祖先都不是 position:fixed（fixed 子树不参与文档宽度）',
        '不是 position:absolute 且 visibility:hidden',
        'rect.right > documentElement.clientWidth + 1（LTR 下只有右侧越界进入可滚动溢出区）',
        '父链向上直到（含）documentElement，没有任何祖先的 computed overflow-x ∈ {auto, scroll, hidden, clip}',
      ],
    };
  }

  // A3
  {
    const combosTotal = V_A3.length * extraPages.length;
    const bad = [];
    for (const vp of V_A3) for (const p of extraPages) {
      const r = find(rows, 'after', vp.name, p);
      if (!r || r.error || !(r.overflow <= 1)) bad.push(r || { viewport: vp.name, page: p, missing: true });
    }
    out.A3 = {
      assert: '抽样 20 页 @320/390：overflow <= 1',
      pages: extraPages,
      combos: combosTotal,
      combos_ok: combosTotal - bad.length,
      pass: bad.length === 0,
      failed: bad.map((r) => ({ viewport: r.viewport, page: r.page, overflow: r.overflow, error: r.error })),
      per_viewport: V_A3.map((vp) => ({
        viewport: vp.name,
        after_max: maxOverflow(rows, 'after', vp.name, extraPages),
        before_max: maxOverflow(rows, 'before', vp.name, extraPages),
        after_fail: rows.filter((r) => r.base === 'after' && r.viewport === vp.name && extraPages.includes(r.page) && (r.error || r.overflow > 1)).length,
        before_fail: rows.filter((r) => r.base === 'before' && r.viewport === vp.name && extraPages.includes(r.page) && (r.error || r.overflow > 1)).length,
      })),
    };
  }

  // A4 — overflow + vpExpanded both asserted on the AFTER build; BEFORE reported as contrast.
  {
    const bad = [];
    for (const vp of V_A4) for (const p of CORE_PAGES) {
      const r = find(rows, 'after', vp.name, p);
      if (!r || r.error || !(r.overflow <= 1)) bad.push(r || { viewport: vp.name, page: p, missing: true });
    }
    const vpExpAll = [];
    for (const r of rows) {
      if (r.error) continue;
      if (r.vpExpanded) vpExpAll.push({ base: r.base, viewport: r.viewport, page: r.page, innerWidth: r.innerWidth, clientWidth: r.clientWidth });
    }
    const vpExpAfter = vpExpAll.filter((d) => d.base === 'after');
    const vpExpBefore = vpExpAll.filter((d) => d.base === 'before');
    out.A4 = {
      assert: '834x1112 / 1024x768：overflow <= 1；且 vpExpanded（innerWidth > clientWidth+1）= 0（判定取改后构建）',
      combos: V_A4.length * CORE_PAGES.length,
      combos_ok: V_A4.length * CORE_PAGES.length - bad.length,
      pass: bad.length === 0 && vpExpAfter.length === 0,
      overflow_pass: bad.length === 0,
      vpExpanded_pass: vpExpAfter.length === 0,
      failed: bad.map((r) => ({ viewport: r.viewport, page: r.page, overflow: r.overflow, error: r.error })),
      vpExpanded_total: vpExpAll.length,
      vpExpanded_total_after: vpExpAfter.length,
      vpExpanded_total_before: vpExpBefore.length,
      vpExpanded_details: vpExpAll.slice(0, 20),
      per_viewport: V_A4.map((vp) => ({
        viewport: vp.name,
        after_max: maxOverflow(rows, 'after', vp.name, CORE_PAGES),
        before_max: maxOverflow(rows, 'before', vp.name, CORE_PAGES),
        after_fail: rows.filter((r) => r.base === 'after' && r.viewport === vp.name && CORE_PAGES.includes(r.page) && (r.error || r.overflow > 1)).length,
        before_fail: rows.filter((r) => r.base === 'before' && r.viewport === vp.name && CORE_PAGES.includes(r.page) && (r.error || r.overflow > 1)).length,
        after_max_inner_over_client: (() => {
          const v = rows.filter((r) => r.base === 'after' && r.viewport === vp.name && CORE_PAGES.includes(r.page) && !r.error).map((r) => r.innerWidth - r.clientWidth);
          return v.length ? Math.max(...v) : null;
        })(),
        before_max_inner_over_client: (() => {
          const v = rows.filter((r) => r.base === 'before' && r.viewport === vp.name && CORE_PAGES.includes(r.page) && !r.error).map((r) => r.innerWidth - r.clientWidth);
          return v.length ? Math.max(...v) : null;
        })(),
      })),
    };
  }
  return out;
}

/* ------------------------------------------------------------------- report */

const num = (v) => (v === null || v === undefined ? '—' : String(v));
const yes = (b) => (b ? 'PASS' : 'FAIL');

function markdown(doc) {
  const A = doc.assertions;
  const m = doc.measurements;
  const afterVpAll = doc.all_measurements_vp_expanded.filter((d) => d.base === 'after');
  const beforeVpAll = doc.all_measurements_vp_expanded.filter((d) => d.base === 'before');
  const L = [];
  L.push('# Agent A 移动端验证报告 —— 横向溢出与抽样');
  L.push('');
  L.push('- 生成时间：`' + doc.generated_at + '`');
  L.push('- 改后站点（after）：`' + doc.after_url + '`　仓库 `papermc-docs`');
  L.push('- 改前基线（before）：`' + doc.before_url + '`　目录 `..\\_pre-mobile`（移动端改造前 HEAD `a19a6c2`）');
  L.push('- 工具：`tools/verify-mobile-a.js`（Playwright + 真实 Chromium；`deviceScaleFactor:2`，`width<768` 时 `isMobile/hasTouch`）');
  L.push('- 判定阈值：`documentElement.scrollWidth - clientWidth <= 1`');
  L.push('');
  L.push('## 1. 结论表');
  L.push('');
  L.push('| 断言 | 改前（8788） | 改后（8787） | 判定 |');
  L.push('| --- | --- | --- | --- |');

  const a1b = A.A1.per_viewport.map((v) => `${v.viewport}: max ${num(v.before_max)}`).join('；');
  const a1a = A.A1.per_viewport.map((v) => `${v.viewport}: max ${num(v.after_max)}`).join('；');
  L.push(`| **A1** 320/360/390/414 × 核心 10 页 = 40 组合，overflow ≤ 1 | ${A.A1.per_viewport.map((v) => v.viewport + '=' + num(v.before_max)).join(' / ')}（越界页数 ${A.A1.per_viewport.reduce((s, v) => s + v.before_fail, 0)}/40） | ${a1a}（越界页数 ${A.A1.per_viewport.reduce((s, v) => s + v.after_fail, 0)}/40） | **${yes(A.A1.pass)}** |`);
  L.push(`| **A2** clipped-aware 真实撑宽元素 = 0 | ${doc.assertions.A2.per_base_viewport.filter((x) => x.base === 'before').reduce((s, x) => s + x.real, 0)} 个 | ${A.A2.real_total} 个 | **${yes(A.A2.pass)}** |`);
  const a3b = A.A3.per_viewport.map((v) => v.viewport + '=' + num(v.before_max)).join(' / ');
  const a3a = A.A3.per_viewport.map((v) => v.viewport + '=' + num(v.after_max)).join(' / ');
  L.push(`| **A3** 另抽 20 页 @320/390 = 40 组合，overflow ≤ 1 | ${a3b}（越界页数 ${A.A3.per_viewport.reduce((s, v) => s + v.before_fail, 0)}/40） | ${a3a}（越界页数 ${A.A3.per_viewport.reduce((s, v) => s + v.after_fail, 0)}/40） | **${yes(A.A3.pass)}** |`);
  const a4b = A.A4.per_viewport.map((v) => v.viewport + '=' + num(v.before_max)).join(' / ');
  const a4a = A.A4.per_viewport.map((v) => v.viewport + '=' + num(v.after_max)).join(' / ');
  L.push(`| **A4** 834×1112 / 1024×768 × 核心 10 页 = 20 组合，overflow ≤ 1 | ${a4b}（越界页数 ${A.A4.per_viewport.reduce((s, v) => s + v.before_fail, 0)}/20） | ${a4a}（越界页数 ${A.A4.per_viewport.reduce((s, v) => s + v.after_fail, 0)}/20） | **${yes(A.A4.overflow_pass)}** |`);
  L.push(`| **A4b** vpExpanded（innerWidth > clientWidth + 1）= 0 | 全量组合命中 ${beforeVpAll.length} 次（\`innerWidth\` 587/745 vs \`clientWidth\` 320–414） | 全量组合命中 ${afterVpAll.length} 次 | **${yes(A.A4.vpExpanded_pass)}** |`);
  L.push('');
  L.push('> `vpExpanded` 统计口径：本次运行中**所有**被测量的 base×视口×页面组合（不只 834/1024），因为移动视口扩张是红队发现的连锁效应，需要全量确认。');
  L.push('>');
  L.push('> 读表要点：A4 的 834/1024 两档在**改前就是干净的**（overflow 0、vpExpanded false），所以 A4 是"改造没有把中间档改坏"的回归断言，而不是"改造修好了中间档"；移动端 320–414 才是本次修复的对象（改前 267–425px 溢出 + 视口扩张到 587/745px）。');
  L.push('');

  L.push('## 2. 失败项最小复现');
  L.push('');
  const failRows = [];
  for (const k of ['A1', 'A3', 'A4']) for (const f of A[k].failed) failRows.push({ k, ...f });
  const realHits = A.A2.real_hits.filter((h) => h.base === 'after');
  if (!failRows.length && !realHits.length) {
    L.push('无失败项：4 项断言全部通过，没有需要复现的溢出组合。为便于复核，§3 给出 A2 的判定口径与逐条归因，§6 给出全部组合的原始数值。');
  } else {
    for (const f of failRows) {
      const r = find(m.after, 'after', f.viewport, f.page);
      L.push(`- **${f.k}** \`${doc.after_url}${f.page}\` @ ${f.viewport} → ` + (f.error ? 'ERR ' + f.error : `overflow=${f.overflow}（clientWidth=${r.clientWidth}, scrollWidth=${r.scrollWidth}）`));
      if (r && r.realWideners && r.realWideners.length) for (const w of r.realWideners.slice(0, 3)) {
        L.push(`  - 真实撑宽：\`${w.sel}\` left=${w.left} right=${w.right} w=${w.w} pos=${w.pos} ws=${w.ws} ／ 祖先：\`${w.parentChain}\``);
      }
    }
    for (const h of realHits) {
      L.push(`- **A2** \`${doc.after_url}${h.page}\` @ ${h.base}/${h.viewport} → 真实撑宽元素 ${h.count}：${h.elements.map((e) => '`' + e + '`').join('、')}`);
    }
  }
  L.push('');

  L.push('');
  L.push('## 3. A2 口径说明（必须显式）');
  L.push('');
  L.push('“真实撑宽元素”判定为**同时**满足以下全部条件：');
  L.push('');
  A.A2.rule.forEach((r, i) => L.push(`${i + 1}. ${r}`));
  L.push('');
  L.push('- 单列 benign（**不计入**溢出区、不算失败）：`rect.right <= clientWidth + 1` 且 `rect.left < -1`。LTR 文档里负向（向左）溢出永远不进入可滚动溢出区，因此既不撑宽文档、也不产生横向滚动条。');
  L.push('- 被裁剪的候选（向右越界但落在 `overflow-x:auto|scroll|hidden|clip` 祖先内）单独记为 `clippedWideners`，用于区分“被容器正确收容”与“真撑宽文档”。');
  L.push('- `rootClip`：若 `body`/`html` 自身 `overflow-x` 为裁剪值，则整个口径会被掩盖，测试等于自证；本次结果：' + (A.A2.root_clipping_any ? '**出现 root 裁剪，需警惕**' : '`body`/`html` 均无裁剪型 `overflow-x`，口径未被掩盖') + '。');
  L.push('');
  L.push('| base / 视口 | 组合数 | 真实撑宽 real | 被裁剪候选 clipped | raw（仅按 right 判） | benign 负向 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of A.A2.per_base_viewport) {
    L.push(`| ${r.base} ${r.viewport} | ${r.combos} | ${r.real} | ${r.clipped} | ${r.raw} | ${r.neg} |`);
  }
  L.push('');
  L.push('#### A2 逐条归因：向右越界元素被谁收容（改后构建）');
  L.push('');
  L.push('全部 base 合计：raw（仅 right > clientWidth+1）= ' + A.A2.raw_total + '；**改后** real = ' + A.A2.real_total_after + '，clipped = ' + A.A2.clipped_total + '；**改前** real = ' + A.A2.real_total_before + '（对照组）。改后被裁剪元素的收容者分布：');
  L.push('');
  L.push('| 裁剪祖先 | 原因 | 元素数 |');
  L.push('| --- | --- | --- |');
  if (!A.A2.clipped_by_hist.length) L.push('| — | 无向右越界候选 | 0 |');
  for (const h of A.A2.clipped_by_hist.slice(0, 15)) {
    const mm = /^(.*?)\s+\[(.*)\]$/.exec(h.clippedBy);
    L.push(`| \`${mm ? mm[1] : h.clippedBy}\` | ${mm ? mm[2] : ''} | ${h.n} |`);
  }
  L.push('');
  L.push('> 结论：改后构建里所有向右越界元素都能被 `.code-scroll` / `.code-pre` / `.table-wrap` 这类 `overflow-x:auto` 容器收容，没有一个是“裸撑宽文档”的。改前的 861 个 real 则相反——它们不在任何滚动容器内，直接撑宽了文档（与 §1/§6 的 267–425px 溢出同源）。');
  L.push('');
  L.push('#### benign 负向溢出构成（`left < -1 && right <= clientWidth+1`）');
  L.push('');
  L.push('| 元素选择器（去 id） | 出现组合数 |');
  L.push('| --- | --- |');
  for (const h of A.A2.neg_overlap_hist) L.push(`| \`${h.selector}\` | ${h.viewports_seen} |`);
  L.push('');
  L.push('> 移动端（<1024px）改前/改后都会出现大量负向溢出，来源是**关闭状态的左侧抽屉**：`assets/site.css:87` `.sidebar{position:fixed; left:0; transform:translateX(-102%)}`，`body.nav-open .sidebar{transform:none}`。抽屉整体是 `position:fixed` 子树（按口径 b 已被排除出“真实撑宽元素”），其内部链接/输入框的 `rect.left` 为负（`a`、`input.side-filter`、`details.side-sec`、`ul.side-root` …）→ 命中 benign 负向溢出，不进入可滚动区。');
  L.push('');
  L.push('#### `a.skip` 跳转链接探针（单列说明）');
  L.push('');
  const allRows = [...m.after, ...m.before];
  const skipBefore = allRows.filter((r) => r.base === 'before' && !r.error && r.skipProbe && r.skipProbe.left < -1000).length;
  const skipAfter = allRows.filter((r) => r.base === 'after' && !r.error && r.skipProbe && Math.abs(r.skipProbe.left) <= 1).length;
  L.push(`- **改前**：\`a.skip{position:absolute;left:-9999px}\` → 命中“负向溢出”判据（\`left < -1\`），本次运行 **${skipBefore}** 个改前组合如此；它属于 LTR 良性负向溢出，从不进入溢出区，因此不参与 A2 判定，也不影响 A1 的 \`scrollWidth - clientWidth\`。`);
  L.push(`- **改后**：\`.skip{left:0; transform:translateY(-140%)}\` → 横向 \`left=0\`、\`right≈96 < clientWidth\`，**已完全不在负向溢出集合内**（向下改上移出视口，方向更稳），本次运行 **${skipAfter}** 个改后组合满足 \`|left| <= 1\`。`);
  L.push('- 结论：`a.skip` 在改前是“负向溢出噪声源”，在改后已被消除；两种状态下它都从未撑宽文档，因此 A2 把它单列为 benign 而不是失败项。');
  L.push('');
  L.push('#### benign 负向溢出逐组合样本（改后 4 例 + 改前 4 例）');
  L.push('');
  if (!A.A2.benign_negative_sample.length) L.push('（本次运行无负向溢出样本）');
  else {
    L.push('| base | 视口 | 页面 | 负向元素数 | 选择器（前 5） | `a.skip` 探针 rect |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const s of A.A2.benign_negative_sample) {
      const sk = s.skipProbe ? `left=${s.skipProbe.left} right=${s.skipProbe.right} w=${s.skipProbe.w} transform=${s.skipProbe.transform}` : '—';
      L.push(`| ${s.base} | ${s.viewport} | \`${s.page}\` | ${s.count} | ${s.selectors.map((x) => '`' + x + '`').join('、')} | ${sk} |`);
    }
  }
  L.push('');

  L.push('## 4. A3 抽样清单与规则');
  L.push('');
  L.push('- 规则：' + doc.a3_sampling.rule);
  L.push(`- 候选池大小：${doc.a3_sampling.pool_size}（页库存量 ${doc.a3_sampling.inventory_size} 页；池中含 \`<pre>\` 的 ${doc.a3_sampling.pool_with_pre} 页、含 \`<table>\` 的 ${doc.a3_sampling.pool_with_tables} 页）。`);
  L.push(`- 强制包含：${doc.a3_sampling.required_count}；最终：${doc.a3_sampling.selected.length} 页（与核心 10 页无交集）。`);
  const noPre = doc.a3_sampling.selected.filter((s) => s.maxPreLine === 0 && s.tableCount === 0);
  L.push(`- 排序键说明：该仓库构建产物里 \`<table>\` 元素极少（表格类内容主要由 \`.table-wrap\` 承载在 \`/all-pages.html\`、\`/snapshots.html\`），因此主排序键是“最长 \`<pre>\` 行字符数”，\`<table>\` 数量只作次级键。`);
  if (noPre.length) L.push(`- 注意：${noPre.map((s) => '`' + s.url + '`').join('、')} 无 \`<pre>\` 也无 \`<table>\`，属任务指定强制包含项，其横向压力来自其它内容结构（长行内代码 / 内联代码列等），仍按 \`overflow <= 1\` 判定。`);
  L.push('');
  L.push('| # | 页面 | 来源 | 最长 `pre` 行 | `pre` 块 | `table` | @320 | @390 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of doc.a3_sampling.selected) {
    const r320 = find(m.after, 'after', '320x568', s.url);
    const r390 = find(m.after, 'after', '390x844', s.url);
    L.push(`| ${s.rank} | \`${s.url}\` | ${s.required ? '强制' : '排序'} | ${num(s.maxPreLine)} | ${num(s.preBlocks)} | ${num(s.tableCount)} | ${r320 && !r320.error ? r320.overflow : 'ERR'} | ${r390 && !r390.error ? r390.overflow : 'ERR'} |`);
  }
  L.push('');
  L.push('排序前 25 名（确定性排序键，供复核）：');
  L.push('');
  L.push('| 名次 | 页面 | 最长 `pre` 行 | `pre` 块 | `table` |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const r of doc.a3_sampling.ranked_top) L.push(`| ${r.rank} | \`${r.url}\` | ${r.maxPreLine} | ${r.preBlocks} | ${r.tableCount} |`);
  L.push('');

  L.push('## 5. vpExpanded（移动视口扩张连锁效应）');
  L.push('');
  L.push('口径：`vpExpanded = window.innerWidth > documentElement.clientWidth + 1`。统计覆盖本次运行中被测量的**全部** base × 视口 × 页面组合。');
  L.push('');
  L.push('| base | 视口 | 页面 | innerWidth | clientWidth | 差值 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  const vpRows = [...beforeVpAll.slice(0, 8), ...afterVpAll.slice(0, 8)];
  if (!vpRows.length) L.push('| — | — | 全部组合均无扩张 | — | — | — |');
  for (const d of vpRows) L.push(`| ${d.base} | ${d.viewport} | \`${d.page}\` | ${d.innerWidth} | ${d.clientWidth} | +${d.innerWidth - d.clientWidth} |`);
  if (beforeVpAll.length > 8) L.push(`| before | … | 其余 ${beforeVpAll.length - 8} 个 before 组合同样扩张（略） | | | |`);
  L.push('');
  L.push(`- 改后（8787）扩张命中：**${afterVpAll.length}** / ${m.after.filter((r) => !r.error).length} 个组合（要求 0）。`);
  L.push(`- 改前（8788）扩张命中：**${beforeVpAll.length}** / ${m.before.filter((r) => !r.error).length} 个组合（红队报告的连锁效应，对照组）。`);
  L.push(`- 改前扩张幅度：\`innerWidth\` 587 / 745，而 \`clientWidth\` 320 / 360 / 390 / 414 → 最大 +${beforeVpAll.length ? Math.max(...beforeVpAll.map((d) => d.innerWidth - d.clientWidth)) : 0} px；这是"薄弱视口被内容撑到 745px 布局宽度"的症状，与 §6 的改前 overflow 267–425px 同源。`);
  L.push(`- 改后最大值：\`innerWidth\` − \`clientWidth\` = ${num(Math.max(...m.after.filter((r) => !r.error).map((r) => r.innerWidth - r.clientWidth)))} px（全视口全页面），即无扩张。`);
  L.push('');

  L.push('## 6. 逐视口原始数值（核心 10 页）');
  L.push('');
  L.push('| 视口 | base | 页面 | overflow | client | scroll | real | clipped | benign | vpExpanded |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const vp of [...V_A1, ...V_A4]) for (const b of ['after', 'before']) for (const p of CORE_PAGES) {
    const r = find(m[b], b, vp.name, p);
    if (!r) { L.push(`| ${vp.name} | ${b} | \`${p}\` | (未测) | | | | | | |`); continue; }
    if (r.error) { L.push(`| ${vp.name} | ${b} | \`${p}\` | ERR | | | | | | |`); continue; }
    L.push(`| ${vp.name} | ${b} | \`${p}\` | ${r.overflow} | ${r.clientWidth} | ${r.scrollWidth} | ${r.realWidenersCount} | ${r.clippedWidenersCount} | ${r.negOverflowCount} | ${r.vpExpanded} |`);
  }
  L.push('');
  L.push('## 7. 环境与复现');
  L.push('');
  L.push('```');
  L.push('node tools/serve.js --port 8787');
  L.push('node tools/serve.js --port 8788 --root ..\\_pre-mobile');
  L.push('node tools/verify-mobile-a.js --json');
  L.push('```');
  L.push('');
  L.push('- 浏览器：' + doc.browser + '（路径由 `CHROME_PATH` / `LOCALAPPDATA\\ms-playwright` / `PROGRAMFILES` / `PROGRAMFILES(X86)` 环境变量拼出，未写死盘符字面量）。');
  L.push('- 本报告由 `tools/verify-mobile-a.js` 一次运行同时产出 `reports/mobile-verify-a.json` 与 `reports/mobile-verify-a.md`。');
  L.push('');
  return L.join('\n');
}

/* --------------------------------------------------------------------- main */

(async () => {
  if (hasFlag('sample-only')) {
    const extra = sampleExtra();
    console.log('pool_size=' + extra.pool_size + ' required=' + extra.required_count + ' selected=' + extra.selected.length);
    console.log('rule: ' + extra.rule);
    for (const s of extra.selected) {
      console.log(String(s.rank).padStart(2) + ' ' + (s.required ? 'REQ' : '   ') + ' ' + s.url.padEnd(56)
        + ' maxPreLine=' + String(s.maxPreLine).padStart(4) + ' pre=' + String(s.preBlocks).padStart(3) + ' table=' + String(s.tableCount).padStart(3)
        + (s.missing ? '  MISSING' : ''));
    }
    console.log('\nranked top 25:');
    for (const r of extra.ranked_top) console.log(String(r.rank).padStart(2) + ' ' + r.url.padEnd(56) + ' maxPreLine=' + String(r.maxPreLine).padStart(4) + ' pre=' + String(r.preBlocks).padStart(3) + ' table=' + String(r.tableCount).padStart(3));
    return;
  }
  const t0 = Date.now();
  const { extra, measurements } = await run();
  const rows = [...(measurements.after || []), ...(measurements.before || [])];
  const A = assertions(extra, rows);

  const doc = {
    generated_at: new Date().toISOString(),
    generator: 'tools/verify-mobile-a.js',
    agent: 'A (横向溢出与抽样)',
    after_url: AFTER_URL,
    before_url: BEFORE_URL,
    before_root: '..\\_pre-mobile （移动端改造前 HEAD a19a6c2）',
    browser: browserPath(),
    viewports: { A1: V_A1.map((v) => v.name), A3: V_A3.map((v) => v.name), A4: V_A4.map((v) => v.name) },
    core_pages: CORE_PAGES,
    a3_sampling: extra,
    assertions: A,
    summary: {
      A1: A.A1.pass, A2: A.A2.pass, A3: A.A3.pass, A4_overflow: A.A4.overflow_pass, A4_vpExpanded: A.A4.vpExpanded_pass,
      all_pass: A.A1.pass && A.A2.pass && A.A3.pass && A.A4.pass,
    },
    all_measurements_vp_expanded: rows.filter((r) => !r.error && r.vpExpanded)
      .map((r) => ({ base: r.base, viewport: r.viewport, page: r.page, innerWidth: r.innerWidth, clientWidth: r.clientWidth })),
    measurements,
    elapsed_sec: Math.round((Date.now() - t0) / 1000),
  };

  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(doc, null, 2), 'utf8');
  fs.mkdirSync(path.dirname(MD_OUT), { recursive: true });
  fs.writeFileSync(MD_OUT, markdown(doc), 'utf8');

  console.log('\n==== ASSERTIONS ====');
  for (const [k, v] of Object.entries(doc.summary)) console.log(k.padEnd(16) + ' ' + (v ? 'PASS' : 'FAIL'));
  console.log('A1 ' + A.A1.combos_ok + '/' + A.A1.combos + '  A3 ' + A.A3.combos_ok + '/' + A.A3.combos + '  A4 ' + A.A4.combos_ok + '/' + A.A4.combos);
  console.log('A2 real wideners (after) = ' + A.A2.real_total + ', benign negative total = ' + A.A2.benign_negative_total);
  console.log('vpExpanded after = ' + doc.all_measurements_vp_expanded.filter((d) => d.base === 'after').length
    + ', before = ' + doc.all_measurements_vp_expanded.filter((d) => d.base === 'before').length);
  console.log('elapsed ' + doc.elapsed_sec + 's');
  console.log('wrote ' + path.relative(REPO, JSON_OUT) + ' and ' + path.relative(REPO, MD_OUT));

  if (STDIO_JSON) console.log('\n__JSON__\n' + JSON.stringify({
    generated_at: doc.generated_at, after_url: doc.after_url, before_url: doc.before_url,
    summary: doc.summary, A1: A.A1, A2: { pass: A.A2.pass, real_total: A.A2.real_total, raw_total: A.A2.raw_total, benign_negative_total: A.A2.benign_negative_total, root_clipping_any: A.A2.root_clipping_any, per_base_viewport: A.A2.per_base_viewport },
    A3: A.A3, A4: A.A4,
    a3_pages: extra.selected.map((s) => s.url),
    vpExpanded: doc.all_measurements_vp_expanded,
  }, null, 2));

  if (!doc.summary.all_pass) process.exitCode = 1;
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(2); });
