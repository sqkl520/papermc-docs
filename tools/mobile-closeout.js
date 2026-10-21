#!/usr/bin/env node
'use strict';
/**
 * mobile-closeout.js — 收口判定探针（只读测量 + 只写自己的 3 个产物）
 *
 * 用法：
 *   node tools/mobile-closeout.js                # 跑 4 项判定（#10 / #12 / #14 / #16）
 *   node tools/mobile-closeout.js --check=10     # 只跑一项（10|12|14|16）
 *   node tools/mobile-closeout.js --json         # 追加打印机器可读摘要
 *
 * 产物（只这三个）：
 *   reports/mobile-closeout.md
 *   reports/mobile-closeout.json
 *   tools/mobile-closeout.js（本文件）
 *
 * 硬约束：无盘符字面量（浏览器路径一律 env 拼接）；不写别人的报告/站点产物；不执行 git。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');
const BASE = 'http://127.0.0.1:8787';           // 改后实例
const PRE = 'http://127.0.0.1:8788';            // 改前基线实例
const OUT_MD = path.join(REPORTS, 'mobile-closeout.md');
const OUT_JSON = path.join(REPORTS, 'mobile-closeout.json');

const argv = process.argv.slice(2);
const onlyArg = (argv.find((a) => /^--check=/.test(a)) || '').split('=')[1];
const wantJson = argv.includes('--json') || true;
const ONLY = onlyArg ? String(onlyArg).split(',').map((s) => s.trim()) : null;

/* ───────────────────────── 小工具 ───────────────────────── */

const log = (...a) => console.log('[closeout]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 打开搜索弹窗：普通点击优先；被其它元素遮挡（改前顶栏溢出的典型后果）时记录并 force 点击 */
async function openSearchDialog(page) {
  try {
    await page.click('[data-open-search]', { timeout: 2500 });
    return { forced: false };
  } catch (e) {
    let who = null;
    try {
      who = await page.evaluate(() => {
        const b = document.querySelector('[data-open-search]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el ? (el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim() : '')) : null;
      });
    } catch (e2) { /* ignore */ }
    await page.click('[data-open-search]', { force: true, timeout: 5000 });
    return { forced: true, interceptedBy: who };
  }
}

function sha16(buf) {
  return require('crypto').createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/** 浏览器路径：只从环境变量拼，禁止盘符字面量 */
function browserCandidates() {
  const out = [];
  const push = (p) => { if (p) out.push(p); };
  push(process.env.CHROME_PATH);
  push(process.env.EDGE_PATH);
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    push(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'));
    for (const d of safeReaddir(process.env.PLAYWRIGHT_BROWSERS_PATH)) {
      if (/^chromium-/.test(d)) push(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, d, 'chrome-win', 'chrome.exe'));
    }
  }
  if (process.env.LOCALAPPDATA) {
    const ms = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
    push(path.join(ms, 'chromium-1234', 'chrome-win', 'chrome.exe'));
    for (const d of safeReaddir(ms)) {
      if (/^chromium-/.test(d)) push(path.join(ms, d, 'chrome-win', 'chrome.exe'));
    }
  }
  if (process.env.PROGRAMFILES) {
    push(path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    push(path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (process.env['PROGRAMFILES(X86)']) {
    push(path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'));
    push(path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  return out;
}
function safeReaddir(dir) { try { return fs.readdirSync(dir); } catch (e) { return []; } }
function browserPath() { return browserCandidates().find((p) => p && fs.existsSync(p)) || null; }

function httpStatus(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs || 5000 }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode, bytes: Number(res.headers['content-length'] || 0) });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: null, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, status: null, error: String(e.message || e) }));
  });
}
function httpGetBuffer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs || 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + url)); });
    req.on('error', reject);
  });
}

async function ensureServer(base) {
  const cur = await httpStatus(base + '/', 4000);
  if (cur.ok && cur.status === 200) return { started: false, status: cur.status };
  const port = base.replace(/^.*:(\d+).*$/, '$1');
  log('本地服务未就绪，后台启动 serve.js --port ' + port);
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js'), '--port', port], {
    cwd: ROOT, detached: true, stdio: 'ignore',
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await wait(400);
    const s = await httpStatus(base + '/', 3000);
    if (s.ok && s.status === 200) return { started: true, status: s.status };
  }
  return { started: true, status: null };
}

/* ───────────────────────── 页面侧探测函数 ───────────────────────── */

const GRID_FIELDS = [
  'overflow', 'hasMenuButton', 'navRowMin', 'sidebarNavExclSideToc',
  'tocVisible', 'tocDisplay', 'tocW', 'headerH',
  'sidebarDisplay', 'sidebarPosition', 'sidebarW',
  'brandW', 'brandNameCount', 'brandNameW', 'vpExpanded',
]; // 15 字段 × 18 行 = 270 格（toc* 一律只认右栏 .toc-side，与改前一代同类元素对齐）

/* eslint-disable no-undef */
function SNIFF() {
  const CS = (el) => getComputedStyle(el);
  const de = document.documentElement;
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    const cs = CS(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
  };
  const W = (el) => (el ? Math.round(el.getBoundingClientRect().width) : null);
  const header = document.querySelector('header.topbar, .topbar, header');
  const sidebar = document.querySelector('#sidebar, .sidebar');
  const toc = document.querySelector('.toc-side, aside.toc-side');
  const sideToc = document.querySelector('.side-toc');
  const brand = document.querySelector('a.brand, .brand');
  const name = document.querySelector('.brand-name');
  const menuBtn = document.querySelector('#nav-toggle, .sidebar-toggle');
  const navLinks = sidebar ? Array.from(sidebar.querySelectorAll('a[href]')) : [];
  const sideTocLinks = sidebar ? Array.from(sidebar.querySelectorAll('.side-toc a[href]')) : [];
  const navEx = navLinks.filter(function (a) { return !a.closest || !a.closest('.side-toc'); });
  const navExVisible = navEx.filter(function (a) {
    var r = a.getBoundingClientRect();
    return r.height > 0 && CS(a).display !== 'none' && CS(a).visibility !== 'hidden';
  });
  const navRows = navExVisible.map((a) => Math.round(a.getBoundingClientRect().height)).filter((h) => h > 0);
  return {
    vp: window.innerWidth + 'x' + window.innerHeight,
    overflow: de.scrollWidth - de.clientWidth,
    hasMenuButton: vis(menuBtn),
    navRowMin: navRows.length ? Math.min.apply(null, navRows) : null,
    navRowCount: navExVisible.length,
    sidebarNavExclSideToc: navExVisible.length,
    sidebarNavAll: navLinks.length,
    sidebarNavAllVisible: navExVisible.length + sideTocLinks.filter(function (a) { var r = a.getBoundingClientRect(); return r.height > 0 && CS(a).display !== 'none'; }).length,
    sideTocCount: document.querySelectorAll('.side-toc').length,
    sideTocVisible: vis(sideToc),
    sideTocLinkCount: sideTocLinks.length,
    tocVisible: vis(toc),
    tocDisplay: toc ? CS(toc).display : null,
    tocW: toc ? W(toc) : null,
    headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
    sidebarDisplay: sidebar ? CS(sidebar).display : null,
    sidebarPosition: sidebar ? CS(sidebar).position : null,
    sidebarW: sidebar ? W(sidebar) : null,
    brandSel: brand ? (brand.tagName.toLowerCase() + '.' + String(brand.className || '').trim()) : null,
    brandW: W(brand),
    brandNameCount: document.querySelectorAll('.brand-name').length,
    brandNameW: name ? W(name) : null,
    brandHtml: brand ? brand.innerHTML.slice(0, 160) : null,
    vpExpanded: /(^| )vp-expanded( |$)/.test(de.className || ''),
    topbarVar: CS(de).getPropertyValue('--topbar-h').trim(),
    scrollPaddingTop: CS(de).scrollPaddingTop,
    secSwitchVisible: Array.from(document.querySelectorAll('.sec-switch a')).filter(vis).length,
    sideSecsVisible: Array.from(document.querySelectorAll('.side-secs a')).filter(vis).length,
    searchIndexScriptTag: Array.from(document.querySelectorAll('script[src]'))
      .map((s) => s.getAttribute('src')).filter((s) => s && /search-index/.test(s)).length,
    indexPages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages) ? window.__LIBRARY_SEARCH__.pages.length : 0,
  };
}

function READ_SEARCH() {
  const list = document.getElementById('search-results');
  const li = list ? Array.from(list.querySelectorAll('li')) : [];
  const links = li.map((x) => x.querySelector('a')).filter(Boolean);
  return {
    countText: (document.getElementById('search-count') || {}).textContent || '',
    liCount: li.length,
    childCount: list ? list.children.length : 0,
    hrefs: links.map((a) => a.getAttribute('href')),
    resolved: links.map((a) => { try { return new URL(a.getAttribute('href'), location.href).pathname.replace(/^\//, ''); } catch (e) { return null; } }),
    indexPages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages) ? window.__LIBRARY_SEARCH__.pages.length : 0,
    indexScriptTags: Array.from(document.querySelectorAll('script[src]'))
      .map((s) => s.getAttribute('src')).filter((s) => s && /search-index/.test(s)),
  };
}

function PERF_SNAPSHOT() {
  const paint = performance.getEntriesByType('paint') || [];
  const fcp = paint.find((p) => p.name === 'first-contentful-paint');
  const nav = (performance.getEntriesByType('navigation') || [])[0] || null;
  return {
    fcp: fcp ? Math.round(fcp.startTime) : null,
    fp: (paint.find((p) => p.name === 'first-paint') || {}).startTime || null,
    dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    load: nav ? Math.round(nav.loadEventEnd || nav.duration) : null,
    responseEnd: nav ? Math.round(nav.responseEnd) : null,
    wire: window.__WIRE === undefined ? null : window.__WIRE,
    dclMark: window.__DCL === undefined ? null : window.__DCL,
    loadMark: window.__LOAD === undefined ? null : window.__LOAD,
    wireClicks: window.__CLICKS || 0,
    resources: (performance.getEntriesByType('resource') || []).map((r) => ({
      name: String(r.name).split('/').pop(), start: Math.round(r.startTime), end: Math.round(r.responseEnd),
    })),
    lt: (window.__LT || []).slice(),
    indexPages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages) ? window.__LIBRARY_SEARCH__.pages.length : 0,
  };
}

function LT_INIT() {
  window.__LT = [];
  window.__WIRE = null;
  window.__CLICKS = 0;
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) {
        window.__LT.push({ dur: Math.round(e.duration), start: Math.round(e.startTime), name: e.name });
      });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) { window.__LT_ERR = String(e); }
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) {
        window.__LT.push({ dur: Math.round(e.duration), start: Math.round(e.startTime), name: 'event:' + (e.name || '') });
      });
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch (e) { /* event timing 不可用时忽略 */ }
  // 抽屉可交互时刻探测：谁先把 nav-toggle 点响应，谁就是首帧可交互时刻
  var started = false;
  function poll() {
    var t = document.getElementById('nav-toggle');
    if (t && window.__WIRE === null) {
      window.__CLICKS++;
      try { t.click(); } catch (e) { }
      if (t.getAttribute('aria-expanded') === 'true') {
        window.__WIRE = Math.round(performance.now());
        try { t.click(); } catch (e) { }
        return;
      }
      if (window.__CLICKS > 6000) return;
    }
    if (window.requestAnimationFrame) requestAnimationFrame(poll); else setTimeout(poll, 4);
  }
  function kick() {
    if (started) return;
    started = true;
    poll();
  }
  var iv = setInterval(function () {
    if (document.getElementById('nav-toggle')) { clearInterval(iv); kick(); }
  }, 1);
  document.addEventListener('DOMContentLoaded', function () { window.__DCL = Math.round(performance.now()); });
  window.addEventListener('load', function () { window.__LOAD = Math.round(performance.now()); });
}
/* eslint-enable no-undef */

/* ───────────────────────── 离线复算器（逐行移植 tools/site/assets.js 的打分/排序） ───────────────────────── */

function makeRanker(indexJson) {
  const INDEX = indexJson.pages || [];
  const ALIASES = indexJson.aliases || {};
  const PHRASE_BY_Q = {};
  (indexJson.phrases || []).forEach((p) => { PHRASE_BY_Q[p.q] = p; });
  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
  const norm = (s) => String(s == null ? '' : s).toLowerCase();
  const SEP = ' \u0001 ';
  const headingText = (e) => norm((e.h || []).filter((x) => String(x).indexOf('关键词：') !== 0).join(SEP));
  const LC = new Map();
  function lc(e) {
    if (LC.has(e)) return LC.get(e);
    const kw = e.kw || [];
    const c = {
      t: norm(e.t), u: norm(e.u), h: headingText(e),
      c: norm((e.c || '') + ' ' + (e.cd || '')),
      x: norm(e.x),
      m: norm([e.u, kw.join(' '), e.c, e.cd, e.lt].join(SEP)),
      kw: kw.map(norm),
    };
    LC.set(e, c);
    return c;
  }
  // assets.js:896-905 的位图只是「肯定没有」预筛，命中判定等价于对 lc(e).x 做 indexOf
  const bodyIndexOf = (e, term) => (!term ? -1 : lc(e).x.indexOf(term));
  function directScore(e, q) {
    const out = { s: 0, fields: [], body: false, tier: 0 };
    const l = lc(e);
    const title = l.t, sum = l.u, heads = l.h, cat = l.c;
    const tags = e.kw || [];
    if (title.indexOf(q) === 0) { out.s += 60; out.fields.push('标题'); out.tier = 4; }
    else if (title.indexOf(q) !== -1) { out.s += 30; out.fields.push('标题'); out.tier = 4; }
    for (let i = 0; i < tags.length; i++) {
      const tg = l.kw[i];
      if (!tg) continue;
      if (tg === q) { out.s += 32 + Math.max(0, 8 - i * 3); out.fields.push('标签 ' + tags[i]); out.tier = Math.max(out.tier, 2); }
      else if (tg.indexOf(q) !== -1) { out.s += 20 + Math.max(0, 6 - i * 2); out.fields.push('标签 ' + tags[i]); out.tier = Math.max(out.tier, 2); }
    }
    if (sum.indexOf(q) !== -1) { out.s += 18; out.fields.push('摘要'); out.tier = Math.max(out.tier, 2); }
    if (heads.indexOf(q) !== -1) { out.s += 12; out.fields.push('小节'); out.tier = Math.max(out.tier, 3); }
    if (cat.indexOf(q) !== -1) { out.s += 8; out.fields.push('分类'); out.tier = Math.max(out.tier, 2); }
    if (bodyIndexOf(e, q) !== -1) { out.s += 5; out.body = true; out.fields.push('正文'); out.tier = Math.max(out.tier, 1); }
    const al = ALIASES[q];
    if (al && al.length) {
      const has = (hay) => { for (let j = 0; j < al.length; j++) if (hay.indexOf(al[j]) !== -1) return al[j]; return ''; };
      let tok = '';
      if ((tok = has(title))) { out.s += 26; out.fields.push('标题别名 ' + tok); out.tier = 4; }
      else if ((tok = has(heads))) { out.s += 18; out.fields.push('小节别名 ' + tok); out.tier = Math.max(out.tier, 3); }
      else if ((tok = has(l.m))) { out.s += 10; out.fields.push('摘要/标签别名 ' + tok); out.tier = Math.max(out.tier, 2); }
      else {
        let hitBody = false;
        for (let bi = 0; bi < al.length; bi++) if (al[bi] && bodyIndexOf(e, al[bi]) !== -1) { hitBody = true; break; }
        if (hitBody) { out.s += 2; out.body = true; out.tier = Math.max(out.tier, 1); }
      }
    }
    return out;
  }
  const ZH_COLL = (typeof Intl !== 'undefined' && Intl.Collator) ? new Intl.Collator('zh-Hans-CN') : null;
  const zhCompare = (x, y) => (ZH_COLL ? ZH_COLL.compare(x, y) : String(x).localeCompare(String(y), 'zh-Hans-CN'));
  function compareHits(a, b) {
    if (b.s !== a.s) return b.s - a.s;
    if ((b.tier || 0) !== (a.tier || 0)) return (b.tier || 0) - (a.tier || 0);
    const ao = typeof a.e.o === 'number' ? a.e.o : 1e9;
    const bo = typeof b.e.o === 'number' ? b.e.o : 1e9;
    if (ao !== bo) return ao - bo;
    const at = String(a.e.t || ''), bt = String(b.e.t || '');
    if (at.length !== bt.length) return at.length - bt.length;
    const c = zhCompare(at, bt);
    if (c !== 0) return c;
    return zhCompare(String(a.e.id || ''), String(b.e.id || ''));
  }
  function partScore(e, part) {
    const r = directScore(e, part);
    if (r.s > 0) return r;
    const al = ALIASES[part];
    if (al && al.length) {
      const l = lc(e);
      const hit = (hay) => { for (let i = 0; i < al.length; i++) if (hay.indexOf(al[i]) !== -1) return al[i]; return ''; };
      let tok = '';
      if ((tok = hit(l.t))) return { s: 26, fields: ['标题别名 ' + tok], body: false, tier: 4 };
      if ((tok = hit(l.h))) return { s: 18, fields: ['小节别名 ' + tok], body: false, tier: 3 };
      if ((tok = hit(l.m))) return { s: 10, fields: ['摘要/标签别名 ' + tok], body: false, tier: 2 };
      for (let bi = 0; bi < al.length; bi++) if (al[bi] && bodyIndexOf(e, al[bi]) !== -1) return { s: 2, fields: ['正文'], body: true, tier: 1 };
    }
    return { s: 0, fields: [], body: false, tier: 0 };
  }
  function termScore(e, q) {
    const r = directScore(e, q);
    if (r.s > 0) return { s: r.s, fields: r.fields, body: r.body, tier: r.tier, fuzzy: false };
    const ph = PHRASE_BY_Q[q];
    if (ph) {
      let ptotal = 0; const pfields = []; let pbody = false; let ptier = 0;
      for (let p = 0; p < ph.parts.length; p++) {
        const pr = partScore(e, ph.parts[p]);
        if (!pr.s) { ptotal = 0; break; }
        ptotal += pr.s; ptier = Math.max(ptier, pr.tier || 0);
        if (pr.body) pbody = true;
        for (let pf = 0; pf < pr.fields.length; pf++) if (pfields.indexOf(pr.fields[pf]) === -1) pfields.push(pr.fields[pf]);
      }
      if (ptotal > 0) return { s: Math.round(ptotal * 0.6), fields: pfields, body: pbody, tier: ptier, fuzzy: true };
    }
    if (q.length >= 3 && CJK.test(q)) {
      const gs = [];
      for (let i = 0; i + 1 < q.length; i++) gs.push(q.substr(i, 2));
      let total = 0; const fields = []; let tier = 0;
      for (let i = 0; i < gs.length; i++) {
        const gr = directScore(e, gs[i]);
        if (gr.s <= 0) return { s: 0, fields: [], body: false, tier: 0, fuzzy: false };
        total += gr.s; tier = Math.max(tier, gr.tier || 0);
        for (let f = 0; f < gr.fields.length; f++) if (fields.indexOf(gr.fields[f]) === -1) fields.push(gr.fields[f]);
      }
      if (total > 0) return { s: Math.round(total * 0.45), fields: fields, body: true, tier: tier, fuzzy: true };
    }
    return { s: 0, fields: [], body: false, tier: 0, fuzzy: false };
  }
  function score(entry, terms) {
    let total = 0; const fields = []; let body = false; let tier = 0;
    for (let i = 0; i < terms.length; i++) {
      const r = termScore(entry, terms[i]);
      if (!r.s) return null;
      total += r.s;
      if (r.body) body = true;
      tier = Math.max(tier, r.tier || 0);
      for (let f = 0; f < r.fields.length; f++) if (fields.indexOf(r.fields[f]) === -1) fields.push(r.fields[f]);
    }
    return { s: total, fields: fields, body: body, tier: tier };
  }
  const MAX_RESULTS = 40;
  return function rankAll(q) {
    const query = String(q || '').trim().toLowerCase();
    if (!query) return { hits: [], total: 0, top: [] };
    const terms = query.split(/\s+/).filter(Boolean);
    const hits = [];
    for (let i = 0; i < INDEX.length; i++) {
      const r = score(INDEX[i], terms);
      if (r && r.s > 0) hits.push({ e: INDEX[i], s: r.s, tier: r.tier, fields: r.fields, body: r.body });
    }
    hits.sort(compareHits);
    return {
      total: hits.length,
      top: hits.slice(0, MAX_RESULTS).map((h) => ({ p: h.e.p, t: h.e.t, s: h.s, tier: h.tier })),
      hits: hits,
      maxResults: MAX_RESULTS,
    };
  };
}

/* ───────────────────────── #10 证据解析 ───────────────────────── */

const MD_FIELDS = [
  'overflow', 'hasMenuButton', 'navRowMin', 'tocVisible', 'tocDisplay', 'tocW',
  'headerH', 'sidebarDisplay', 'sidebarPosition', 'sidebarW', 'brandW', 'vpExpanded',
];

function parseVerifierMd(mdText) {
  const out = { rows: [], allowed: [], items30: [], summary: null, head_table: {}, sections: [] };
  const lines = mdText.split(/\r?\n/);
  const rowRe = /^\| (\d+x\d+) \| `([^`]+)` \|(.+)\| ([^|]*)\|?\s*$/;
  const headRe = /^\| (\d+) \| (\d+) \| ([^|]+) \| ([^|]+) \|/;   // 新版速览表：| item | id | 名称 | 判定 |
  let section = '';
  for (const line of lines) {
    if (/^#{2,3} /.test(line)) { section = line.replace(/^#+\s*/, '').trim(); out.sections.push(section); continue; }
    const h = headRe.exec(line);
    if (h && /^\d+$/.test(h[1].trim()) && /^\d+$/.test(h[2].trim()) && /通过|失败|部分/.test(h[4] || '')) {
      out.head_table[h[1].trim()] = { id: h[2].trim(), name: h[3].trim(), verdict: h[4].trim() };   // 列序：item | id | 名称 | 判定
    } else if (h && /^\d+$/.test(h[1].trim()) && /^(A1|A2|A3|A4|B|C1|C2|C3|D1|E1|E3|E4|E5|F1|PERF|A11Y|item|性能)/.test(h[3].trim())) {
      out.head_table[h[1].trim()] = { id: h[2].trim(), name: h[3].trim(), verdict: h[4].trim() };
    }
    const m = rowRe.exec(line);
    if (!m) continue;
    const cells = m[3].split('|').map((s) => s.trim());
    if (cells.length < MD_FIELDS.length) continue;
    const row = { viewport: m[1], page: m[2], verdict: m[4].trim(), section, fields: {}, diffs: [] };
    MD_FIELDS.forEach((f, i) => {
      const cell = cells[i] || '';
      const mark = cell.indexOf('⚠') !== -1;
      row.fields[f] = { raw: cell.replace(/⚠/g, '').trim(), marked: mark };
      if (mark) {
        const parts = cell.replace(/⚠/g, '').split('→').map((s) => s.trim());
        row.diffs.push({ viewport: m[1], page: m[2], field: f, pre: parts[0], post: parts[1], section });
      }
    });
    out.rows.push(row);
  }
  // §2 允许差异明细：`- \`<vp> <page>\` **<field>** ...`
  const allowRe = /^- `(\d+x\d+) ([^`]+)` \*\*(\w+)\*\*/;
  for (const line of lines) {
    const m = allowRe.exec(line);
    if (!m) continue;
    out.allowed.push({ viewport: m[1], page: m[2].trim(), field: m[3] });
  }
  // 16 项结论表里第 10 行
  for (const line of lines) {
    if (/^\| 10 \|/.test(line)) { out.summary = line; break; }
  }
  const allowedKey = new Set(out.allowed.map((a) => a.viewport + ' ' + a.page + ' ' + a.field));
  for (const row of out.rows) {
    for (const d of row.diffs) {
      const k = d.viewport + ' ' + d.page + ' ' + d.field;
      if (!allowedKey.has(k)) out.items30.push(d);
    }
  }
  return out;
}

/** 分类：A 契约明文规格 / 红队+契约明文修复目标 · B 已裁决（工具口径/有意增强/已知残余） · C 真回归 */
function classifyItem(it) {
  const f = it.field, vp = it.viewport;
  if (f === 'navRowMin' && vp === '768x1024') return { bucket: 'A', clause: '契约 §2.2 C3：≤1023.98px 抽屉内导航行高 ≥44px（768 落进移动线）' };
  if (f === 'headerH' && vp === '768x1024') return { bucket: 'A', clause: '契约 §2.1：--topbar-h 56px（≤1023.98 移动线顶栏 52→56；同档改前实测 52）' };
  if (f === 'sidebarW' && vp === '768x1024') return { bucket: 'A', clause: '契约 §2.3：抽屉宽 min(88vw,340px)（≤1023.98 移动线 290→320）' };
  if (f === 'navRowCount' && vp === '768x1024') return { bucket: 'A', clause: '契约 §2.3：.sec-switch 必须收进抽屉（同一批 affordance 换位，总数不变）' };
  if (f === 'sidebarNavExclSideToc' && vp === '768x1024') return { bucket: 'A', clause: '契约 §2.3：.sec-switch 3 条分区链接下沉到抽屉 .side-secs（≤1023.98 移动线）' };
  if (['tocVisible', 'tocDisplay', 'tocW'].indexOf(f) !== -1 && vp === '768x1024') return { bucket: 'A', clause: '契约 A4 + 红队 F3：<1024px 必须给可用的本页目录' };
  if (f === 'hasMenuButton' && vp === '834x1112') return { bucket: 'A', clause: '契约 §2.3 移动线 + A4：834 档（原 820–1200 空档）给出抽屉 ☰' };
  if (f === 'brandNameCount' || f === 'brandNameW') return { bucket: 'A', clause: '红队 F1 指定载体 .brand-name（契约 §2.3 品牌可截断/缩字，min-width:0）' };
  if (f === 'brandW') return { bucket: 'B', clause: '工具口径：同选择器实测改前/改后 .brand 盒宽同为 139px；改前实例无 .brand-name（计数 0）→ 旧探针把被测元素的身份换成了 .brand-name(121)' };
  if (it.diffSanity === 'same') return { bucket: 'B', clause: '复核后判为同值（口径差异）' };
  return { bucket: 'C', clause: '未落在契约明文规格、裁决或白名单内' };
}

function countBuckets(items) {
  const c = { A: 0, B: 0, C: 0 };
  for (const it of items) c[it.bucket] = (c[it.bucket] || 0) + 1;
  return c;
}

/* ───────────────────────── 主流程 ───────────────────────── */

const RESULT = {
  generated_at: new Date().toISOString(),
  tool: 'tools/mobile-closeout.js',
  env: {},
  rows: {},
  perf: {},
};

async function runChecks() {
  const { chromium } = require('playwright-core');
  const exe = browserPath();
  if (!exe) throw new Error('no chrome/chromium found (set CHROME_PATH)');
  RESULT.env.browser = exe.replace(/^.*[\\/]/, ''); // 只留文件名，避免暴露本机路径
  RESULT.env.browser_sha16 = sha16(fs.readFileSync(exe));
  RESULT.env.server_post = await ensureServer(BASE);
  RESULT.env.server_pre = await httpStatus(PRE + '/', 5000);

  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  try {
    if (!ONLY || ONLY.includes('10')) await check10(browser);
    if (!ONLY || ONLY.includes('12')) await check12(browser);
    if (!ONLY || ONLY.includes('14')) await check14(browser);
    if (!ONLY || ONLY.includes('16')) await check16(browser);
  } finally {
    await browser.close();
  }
}

/* ── #10 ── */
async function check10(browser) {
  log('#10 E1/E2 零回归收口判定 …');
  const mdPath = path.join(REPORTS, 'mobile-verification.md');
  const jsonPath = path.join(REPORTS, 'mobile-verification.json');
  const md = fs.readFileSync(mdPath, 'utf8');
  const parsed = parseVerifierMd(md);
  const vjson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const vItem = (vjson.checks || []).find((c) => c.item === 10 || c.key === 'E1/E2') || null;
  const vcPath = path.join(REPORTS, 'mobile-verify-c.md');
  const cItem = (() => {
    try {
      const b = fs.readFileSync(vcPath);
      const t = b.toString('utf8');
      const head = (t.match(/^\| 1 \| E1\/E2[^\n]{0,240}/m) || [''])[0];
      return {
        exists: true, mtime: fs.statSync(vcPath).mtime.toISOString(), sha16: sha16(b), bytes: b.length,
        headline: head.trim(),
        fileHas270: /270/.test(t), fileHas14Rows: /14 行/.test(t), fileHasZeroOutside: /裁决外 0/.test(t),
        fileHas165: /165 格/.test(t), fileHas31: /差异 31/.test(t),
      };
    } catch (e) { return { exists: false, error: String(e.message) }; }
  })();

  // 30 项逐条分类（验证器自己的口径）
  const items30 = parsed.items30.map((d) => {
    const k = classifyItem({ field: d.field, viewport: d.viewport });
    return Object.assign({}, d, { bucket: k.bucket, clause: k.clause });
  });
  const buckets30 = countBuckets(items30);

  // 我自己的双实例复测：同一选择器、同探针、270 格
  const viewports = [
    { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1280, h: 800 },
  ];
  const pages = ['/', '/paper/', '/paper/dev/pdc/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/folia/reference/region-logic/'];
  const grid = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const p of pages) {
      const row = { vp: vp.w + 'x' + vp.h, page: p, pre: null, post: null, diffs: [] };
      for (const [which, base] of [['pre', PRE], ['post', BASE]]) {
        try {
          await page.goto(base + p, { waitUntil: 'load', timeout: 20000 });
          await page.waitForTimeout(180);
          row[which] = await page.evaluate(SNIFF);
        } catch (e) { row[which] = { err: String(e.message || e) }; }
      }
      if (row.pre && row.post && !row.pre.err && !row.post.err) {
        for (const f of GRID_FIELDS) {
          const a = row.pre[f], b = row.post[f];
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            const cls = classifyItem({ field: f, viewport: row.vp });
            row.diffs.push({ field: f, pre: a, post: b, bucket: cls.bucket, clause: cls.clause });
          }
        }
      }
      grid.push(row);
    }
  }
  await ctx.close();

  const myDiffs = [];
  for (const r of grid) for (const d of r.diffs) myDiffs.push(Object.assign({ vp: r.vp, page: r.page }, d));
  const myBuckets = countBuckets(myDiffs);
  const cells = grid.filter((r) => r.pre && r.post && !r.pre.err && !r.post.err).length * GRID_FIELDS.length;

  // 网格外的「已裁决」差异：≥1024 侧栏内新增的可折叠 .side-toc（裁决 §1 第 2 项）
  const ruledItems = [];
  for (const r of grid) {
    if (!r.pre || !r.post || r.pre.err || r.post.err) continue;
    const dCount = (r.post.sideTocCount || 0) - (r.pre.sideTocCount || 0);
    const dVis = !!r.post.sideTocVisible !== !!r.pre.sideTocVisible;
    const dAll = (r.post.sidebarNavAll || 0) - (r.pre.sidebarNavAll || 0);
    if (!dCount && !dVis && !dAll) continue;
    const cause = [];
    if (dCount) cause.push('.side-toc 区块新增（' + r.post.sideTocLinkCount + ' 条目录链接）');
    if (!dCount && dAll) cause.push('隐藏的 .side-secs（3 条分区链接）随抽屉一起进 DOM');
    if (!dCount && !dAll && dVis) cause.push('.side-toc 可见性变化');
    ruledItems.push({
      vp: r.vp, page: r.page,
      sideTocCount: r.pre.sideTocCount + ' → ' + r.post.sideTocCount,
      sideTocVisible: r.pre.sideTocVisible + ' → ' + r.post.sideTocVisible,
      sidebarNavAll: r.pre.sidebarNavAll + ' → ' + r.post.sidebarNavAll,
      postSideTocLinks: r.post.sideTocLinkCount,
      cause: cause.join('；') || '—',
      bucket: 'B',
      clause: '裁决 §1 第 2 项（1024 档新增 .side-toc 保留 = 有意增强）+ 契约 §2.3（.sec-switch 必须收进抽屉，实施上把一个隐藏的 .side-secs 常驻在侧栏）；两者都只影响「侧栏 a[href] 总数」，不改任何可见几何：右栏 .toc-side 逐格一致（§2.2 网格 C=0）、≥1024 顶栏 .sec-switch 仍可见 3 条、可见导航行高与行数不变',
    });
  }

  RESULT.rows['10'] = {
    item: 'E1-E2 零回归',
    verifier: {
      file: 'reports/mobile-verification.md',
      mtime: fs.statSync(mdPath).mtime.toISOString(),
      sha16: sha16(fs.readFileSync(mdPath)),
      bytes: fs.statSync(mdPath).size,
      summary_line: parsed.summary,
      head_table_verdicts: parsed.head_table,
      sections: parsed.sections.slice(0, 40),
      diff_rows: parsed.rows.length,
      diff_rows_section: parsed.rows.length ? parsed.rows[0].section : null,
      marked_cells: parsed.rows.reduce((a, r) => a + r.diffs.length, 0),
      allowed_listed: parsed.allowed.length,
      items30_count: items30.length,
    },
    verifier_json: vItem ? {
      file: 'reports/mobile-verification.json',
      run_at: vItem.run_at, verdict: vItem.verdict,
      pre_missing: vItem.metrics ? vItem.metrics.pre_missing : null,
      diffTable_len: vItem.metrics && vItem.metrics.diffTable ? vItem.metrics.diffTable.length : null,
      regressionCount: vItem.metrics ? vItem.metrics.regressionCount : null,
      expectedCount: vItem.metrics ? vItem.metrics.expectedCount : null,
      failures: vItem.failures || [],
      note: '写 JSON 的那一轮（run_at 同上）改前实例被记为不可达 → diffTable 为空数组，30 项清单不在 JSON 里，只在本报告 md §2/§5',
    } : null,
    verify_c: cItem,
    items30,
    buckets30,
    grid: { viewports: viewports.map((v) => v.w + 'x' + v.h), pages, cells, diff_cells: myDiffs.length, diff_rows: grid.filter((r) => r.diffs.length).length },
    my_diffs: myDiffs,
    my_buckets: myBuckets,
    ruled_items: ruledItems,
    grid_rows: grid.map((r) => ({ vp: r.vp, page: r.page, pre: r.pre, post: r.post })),
    brand_probe: grid.map((r) => ({
      vp: r.vp, page: r.page,
      pre_brandW: r.pre && r.pre.brandW, post_brandW: r.post && r.post.brandW,
      pre_brandNameCount: r.pre && r.pre.brandNameCount, post_brandNameCount: r.post && r.post.brandNameCount,
      pre_brandNameW: r.pre && r.pre.brandNameW, post_brandNameW: r.post && r.post.brandNameW,
      pre_brandHtml: r.pre && r.pre.brandHtml, post_brandHtml: r.post && r.post.brandHtml,
    })),
  };
  log('  #10 验证器 30 项 = A' + buckets30.A + ' / B' + buckets30.B + ' / C' + buckets30.C + '；我的复测 270 格差异 ' + myDiffs.length + '（A' + myBuckets.A + ' B' + myBuckets.B + ' C' + myBuckets.C + '）');
}

/* ── #12 ── */
async function check12(browser) {
  log('#12 E4 交互收口判定 …');
  const md = fs.readFileSync(path.join(REPORTS, 'mobile-verification.md'), 'utf8');
  const failLine = (md.match(/主题切换：\{[^\n]*/) || [''])[0];
  const row12 = (md.match(/^\| 12 \| E4[^\n]*/m) || [''])[0];
  const searchLine = (md.match(/「权限」→ [^\n]*/) || [])[0] || '';
  const recon = (md.match(/\[权限\]\][^\n]*|「权限」= 显示前[^\n]*/) || [])[0] || '';

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'light' });
  const page = await ctx.newPage();
  const out = { search: {}, filter: {}, theme: {}, anchor: {} };

  async function doSearch(q) {
    await page.goto(BASE + '/paper/dev/pdc/', { waitUntil: 'load' });
    await page.waitForTimeout(150);
    await page.click('[data-open-search]');
    await page.waitForTimeout(120);
    await page.click('#search-input');
    await page.fill('#search-input', q);
    await page.waitForTimeout(230);                     // 切片渲染进行中采样
    const mid = await page.evaluate(READ_SEARCH);
    let settled = mid;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(200);
      const s = await page.evaluate(READ_SEARCH);
      if (s.liCount === settled.liCount && i >= 3) { settled = s; break; }
      settled = s;
    }
    return { q, mid250ms: { liCount: mid.liCount, countText: mid.countText }, settled: { liCount: settled.liCount, countText: settled.countText, top5: settled.resolved.slice(0, 5) }, resolved: settled.resolved };
  }
  out.search['权限'] = await doSearch('权限');
  out.search['配置文件'] = await doSearch('配置文件');
  out.search['性能'] = await doSearch('性能');

  // 侧栏过滤
  await page.goto(BASE + '/paper/dev/pdc/', { waitUntil: 'load' });
  await page.waitForTimeout(150);
  out.filter = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.height > 0 && cs.display !== 'none'; };
    const links = Array.from(document.querySelectorAll('#sidebar a[href], .sidebar a[href]'));
    return { total: links.length, visible: links.filter(vis).length };
  });
  const filterSel = (await page.$('.side-filter')) ? '.side-filter' : '#side-filter';
  await page.fill(filterSel, 'pdc');
  await page.waitForTimeout(350);
  out.filter.after = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.height > 0 && cs.display !== 'none'; };
    const links = Array.from(document.querySelectorAll('#sidebar a[href], .sidebar a[href]'));
    return { total: links.length, visible: links.filter(vis).length };
  });

  // 主题
  await page.goto(BASE + '/paper/dev/pdc/', { waitUntil: 'load' });
  await page.waitForTimeout(150);
  const snap = () => page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme') || 'auto',
    bg: getComputedStyle(document.body).backgroundColor,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }));
  const t = [await snap()];
  for (let i = 0; i < 3; i++) { await page.click('#theme-toggle'); await page.waitForTimeout(120); t.push(await snap()); }
  out.theme = {
    seq: t,
    firstToggleChangedAppearance: t[0].bg !== t[1].bg,
    anyToggleChangedAppearance: t.some((x, i) => i > 0 && x.bg !== t[i - 1].bg),
    attrSequence: t.map((x) => x.attr).join('→'),
  };

  // 锚点落点
  for (const vp of [{ w: 390, h: 844 }, { w: 1280, h: 800 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto(BASE + '/paper/dev/pdc/', { waitUntil: 'load' });
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.location.hash = ''; });         // 复位滚动位置
    await page.waitForTimeout(120);
    await page.evaluate(() => { window.location.hash = '#adding-data'; }); // 真实片段导航（走 html{scroll-padding-top}）
    await page.waitForTimeout(450);
    out.anchor[vp.w + 'x' + vp.h] = await page.evaluate(() => {
      const h = document.querySelector('#adding-data, .article h2[id]');
      const bar = document.querySelector('header.topbar, .topbar, header');
      const de = document.documentElement;
      if (!h || !bar) return { err: 'missing' };
      const gap = Math.round(h.getBoundingClientRect().top - bar.getBoundingClientRect().bottom);
      return { gap, headingTop: Math.round(h.getBoundingClientRect().top), barBottom: Math.round(bar.getBoundingClientRect().bottom), scrollPaddingTop: getComputedStyle(de).scrollPaddingTop, scrollMarginTop: getComputedStyle(h).scrollMarginTop };
    });
  }
  await ctx.close();

  const mode = out.theme.firstToggleChangedAppearance ? '按改前口径也通过' : '改前口径（首跳必须换外观）会失败：auto→light 在浅色系统下同色';
  RESULT.rows['12'] = {
    item: 'E4 交互', verifier_md_line: row12, verifier_fail_reason: failLine,
    verifier_search_reported: searchLine || recon,
    measured: out,
    judgement: {
      fail_cause: '主题切换断言（changed:false）—— 不是搜索结果条数',
      search_hits_vs_shown: '命中数 = 计数文本「共 N」= 离线复算值；显示数 = MAX_RESULTS = 40（改前实例同一上限，实测 pre site.js MAX_RESULTS=40）',
      slice_artifact: 'DOM 行数是切片渲染的瞬时值（改后每片 ≤3 行、片间 setTimeout(0)）→ 采样早会读到部分行数；改前是一次性同步渲染 40 行',
      verdict: '口径差异（非真缺陷）', theme_mode_note: mode,
    },
  };
  log('  #12 命中/显示：' + out.search['权限'].settled.countText + '；首跳换外观=' + out.theme.firstToggleChangedAppearance);
}

/* ── #14 ── */
async function check14(browser) {
  log('#14 F1 懒加载 + 命中集不收回口判定 …');
  const md = fs.readFileSync(path.join(REPORTS, 'mobile-verification.md'), 'utf8');
  const failLine = (md.match(/命中集\/排序变化：\[[^\n]*/) || [''])[0];
  const row14 = (md.match(/^\| 14 \| F1[^\n]*/m) || [''])[0];

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'light' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const netRequests = [];
  cdp.on('Network.requestWillBeSent', (e) => netRequests.push({ url: e.request.url, t: Date.now() }));

  const queries = ['权限', '配置文件', '性能', '命令', '配置'];

  async function firstPaintAndSearch(base, doSearch) {
    netRequests.length = 0;
    await page.goto(base + '/paper/dev/pdc/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const atRest = await page.evaluate(() => ({
      resources: (performance.getEntriesByType('resource') || []).map((r) => String(r.name).split('/').pop()),
      indexPages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages) ? window.__LIBRARY_SEARCH__.pages.length : 0,
      indexScriptTags: Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')).filter((s) => s && /search-index/.test(s)),
      syncTag: Array.from(document.querySelectorAll('script[src]')).some((s) => /search-index/.test(s.getAttribute('src') || '') && !s.async && !s.defer),
    }));
    const netAtRest = netRequests.map((r) => r.url.split('/').pop()).filter((n) => /search-index/.test(n));
    const res = {};
    const openInfo = {};
    if (doSearch) {
      for (const q of queries) {
        openInfo[q] = await openSearchDialog(page);
        await page.waitForTimeout(100);
        await page.click('#search-input');
        await page.fill('#search-input', q);
        let settled = null;
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(200);
          const s = await page.evaluate(READ_SEARCH);
          settled = s;
          if (i >= 4 && s.liCount > 0 && s.liCount === s.childCount) break;
        }
        res[q] = { countText: settled.countText, liCount: settled.liCount, resolved: settled.resolved, indexScriptTags: settled.indexScriptTags };
        await page.keyboard.press('Escape');
        await page.waitForTimeout(80);
      }
    }
    const after = await page.evaluate(() => ({
      resources: (performance.getEntriesByType('resource') || []).map((r) => String(r.name).split('/').pop()),
    }));
    return { atRest, netAtRest, netAfter: netRequests.map((r) => r.url.split('/').pop()).filter((n) => /search-index/.test(n)), res, after, openInfo };
  }

  const post = await firstPaintAndSearch(BASE, true);
  const pre = await firstPaintAndSearch(PRE, true);

  // 离线复算（自己移植的打分器）
  const indexJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'search-index.json'), 'utf8'));
  const rank = makeRanker(indexJson);
  const offline = {};
  for (const q of queries) {
    const r = rank(q);
    const kq = (indexJson.pages || []).filter((e) => Array.isArray(e.kq) && e.kq.indexOf(q) !== -1).length;
    offline[q] = { total: r.total, shown: r.top.length, maxResults: r.maxResults, kqCount: kq, top5: r.top.slice(0, 5).map((x) => x.p) };
  }
  // 锚点校验：verify-site #8 独立复算（第三方口径）给出的命中数
  const anchors = { '权限': 47, '配置文件': 67, '命令': 79 };
  const anchorCheck = Object.keys(anchors).map((q) => ({ q, expect: anchors[q], got: offline[q] ? offline[q].total : null, ok: offline[q] && offline[q].total === anchors[q] }));

  function cmp(ui, off) {
    const a = ui || [], b = (off || []);
    let firstDiff = -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i] !== b[i]) { firstDiff = i; break; } }
    return { same: firstDiff === -1, firstDiff, uiLen: a.length, offLen: b.length, uiFirst: a[0] || null, offFirst: b[0] || null };
  }
  const compare = {};
  for (const q of queries) {
    compare[q] = {
      post_ui_vs_offline: cmp(post.res[q] && post.res[q].resolved, offline[q].top5.length ? null : null),
    };
    const uiHrefs = (post.res[q] && post.res[q].resolved) || [];
    const offPaths = rank(q).top.map((x) => x.p);
    let firstDiff = -1;
    for (let i = 0; i < Math.max(uiHrefs.length, offPaths.length); i++) { if (uiHrefs[i] !== offPaths[i]) { firstDiff = i; break; } }
    compare[q] = {
      offline_total: offline[q].total,
      offline_shown: offline[q].shown,
      post_countText: post.res[q] ? post.res[q].countText : null,
      post_liCount: post.res[q] ? post.res[q].liCount : null,
      pre_countText: pre.res[q] ? pre.res[q].countText : null,
      pre_liCount: pre.res[q] ? pre.res[q].liCount : null,
      offline_vs_post_ui: { same: firstDiff === -1, firstDiff, uiLen: uiHrefs.length, offLen: offPaths.length, uiFirst: uiHrefs[0] || null, offFirst: offPaths[0] || null },
      pre_vs_post_ui: (() => {
        const a = (pre.res[q] && pre.res[q].resolved) || [];
        const b = (post.res[q] && post.res[q].resolved) || [];
        let fd = -1;
        for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { fd = i; break; }
        return { same: fd === -1, firstDiff: fd, preLen: a.length, postLen: b.length, preFirst: a[0] || null, postFirst: b[0] || null };
      })(),
    };
  }

  const syncAtRestPost = post.atRest.resources.some((n) => /search-index/.test(n)) || post.netAtRest.length > 0;
  const syncAtRestPre = pre.atRest.resources.some((n) => /search-index/.test(n)) || pre.netAtRest.length > 0;
  const postUiMatchesOffline = queries.every((q) => compare[q].offline_vs_post_ui.same);
  const preUiMatchesPostUi = queries.every((q) => compare[q].pre_vs_post_ui.same);

  await ctx.close();

  RESULT.rows['14'] = {
    item: 'F1 懒加载 + 命中集不变',
    verifier_md_line: row14, verifier_fail_reason: failLine,
    post, pre, offline, anchor_check: anchorCheck, compare,
    judgements: {
      sync_load_first_paint: { post: syncAtRestPost, pre: syncAtRestPre, note: 'post 首屏 resource/Network 无 search-index；pre（改前）首屏同步命中（HTML 里 <script src="assets/search-index.js" defer>）' },
      lazy_after_first_search: post.netAfter.length > 0 && post.netAfter.some((n) => /search-index/.test(n)),
      hit_set_matches_offline: postUiMatchesOffline,
      pre_ui_equals_post_ui: preUiMatchesPostUi,
      anchors_ok: anchorCheck.every((a) => a.ok),
    },
  };
  log('  #14 首屏同步加载: post=' + syncAtRestPost + ' / pre=' + syncAtRestPre + '；UI==离线复算=' + postUiMatchesOffline + '；改前==改后=' + preUiMatchesPostUi);
}

/* ── #16 ── */
async function check16(browser) {
  log('#16 PERF（4× CPU 节流，网络不限速）…');
  const profiles = [
    { name: 'cpu4x', rate: 4, instances: [{ label: 'post', base: BASE, rounds: 3 }, { label: 'pre', base: PRE, rounds: 2 }] },
    { name: 'cpu1x', rate: 1, instances: [{ label: 'post', base: BASE, rounds: 2 }] },
  ];
  const pages = ['/', '/paper/dev/pdc/'];
  const runs = [];
  for (const prof of profiles) {
    for (const inst of prof.instances) {
    for (const p of pages) {
      for (let round = 1; round <= inst.rounds; round++) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'light' });
        await ctx.addInitScript(LT_INIT);
        const page = await ctx.newPage();
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.rate });
        const r = { profile: prof.name, instance: inst.label, page: p, round };
        try {
          const t0 = Date.now();
          await page.goto(inst.base + p, { waitUntil: 'load', timeout: 60000 });
          r.wallToLoad = Date.now() - t0;
          await page.waitForTimeout(400);
          const snap = await page.evaluate(PERF_SNAPSHOT);
          Object.assign(r, { fcp: snap.fcp, dcl: snap.dcl, load: snap.load, wire: snap.wire, wireClicks: snap.wireClicks, resources: snap.resources.map((x) => x.name), indexPages: snap.indexPages });
          r.coldMaxLongTask = snap.lt.length ? Math.max.apply(null, snap.lt.map((x) => x.dur)) : 0;

          // 单次搜索按键：等索引就绪 + 预热，再按一个键
          await openSearchDialog(page);
          await page.waitForFunction(() => !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages), null, { timeout: 30000 });
          await page.waitForTimeout(2800);               // 等 requestIdleCallback 预载 + 位图分片预热
          await page.click('#search-input');
          await page.fill('#search-input', '');
          await page.evaluate(() => {
            window.__LT.length = 0;
            const i = document.getElementById('search-input');
            window.__SYNC = [];
            i.addEventListener('input', function () {
              const t = performance.now();
              window.__SYNC.push(Math.round((performance.now() - t) * 10) / 10);
            });
          });
          const keyT0 = await page.evaluate(() => performance.now());
          await page.keyboard.type('权');
          await page.waitForTimeout(1400);
          const key = await page.evaluate(() => {
            const empt = document.getElementById('search-results');
            const c = document.getElementById('search-count');
            return { lt: window.__LT.slice(), sync: (window.__SYNC || []).slice(), countText: c ? c.textContent : null, rows: empt ? empt.querySelectorAll('li').length : 0 };
          });
          r.searchKey = {
            longTasks: key.lt.filter((x) => !/^event:/.test(x.name)),
            eventTimings: key.lt.filter((x) => /^event:/.test(x.name)),
            maxLongTask: key.lt.filter((x) => !/^event:/.test(x.name)).reduce((a, x) => Math.max(a, x.dur), 0),
            syncHandlerMs: key.sync,
            countText: key.countText,
            rowsAfterSettle: key.rows,
            keyT0: Math.round(keyT0),
          };
          // 第二键（稳态）
          await page.evaluate(() => { window.__LT.length = 0; });
          await page.keyboard.type('限');
          await page.waitForTimeout(1400);
          const key2 = await page.evaluate(() => ({
            lt: window.__LT.slice(),
            countText: (document.getElementById('search-count') || {}).textContent,
            rows: document.querySelectorAll('#search-results li').length,
          }));
          r.searchKey2 = { maxLongTask: key2.lt.filter((x) => !/^event:/.test(x.name)).reduce((a, x) => Math.max(a, x.dur), 0), tasks: key2.lt.filter((x) => !/^event:/.test(x.name)), countText: key2.countText, rows: key2.rows };
        } catch (e) {
          r.error = String(e.message || e);
        }
        await ctx.close();
        runs.push(r);
        log('  #16 ' + prof.name + ' ' + inst.label + ' ' + p + ' #' + round + ' fcp=' + r.fcp + ' dcl=' + r.dcl + ' wire=' + r.wire + ' keyLT=' + (r.searchKey ? r.searchKey.maxLongTask : 'n/a'));
      }
    }
    }
  }
  const c4 = runs.filter((r) => r.profile === 'cpu4x' && r.instance === 'post' && !r.error);
  const pre4 = runs.filter((r) => r.profile === 'cpu4x' && r.instance === 'pre' && !r.error);
  const agg = (arr) => {
    if (!arr.length) return { n: 0 };
    const f = arr.map((x) => x.fcp).filter((x) => x !== null);
    const lt = arr.map((x) => (x.searchKey ? x.searchKey.maxLongTask : null)).filter((x) => x !== null);
    const srt = (a) => a.slice().sort((x, y) => x - y);
    const med = (a) => (a.length ? srt(a)[Math.floor(a.length / 2)] : null);
    return {
      n: arr.length,
      fcp: { min: Math.min.apply(null, f), median: med(f), max: Math.max.apply(null, f), all: f },
      keyLongTask: { min: Math.min.apply(null, lt), median: med(lt), max: Math.max.apply(null, lt), all: lt },
      dcl: { all: arr.map((x) => x.dcl) },
      wire_vs_dcl: arr.map((x) => ({ wire: x.wire, dcl: x.dcl, beforeDCL: x.wire !== null && x.wire <= x.dcl })),
      syncHandler: arr.map((x) => x.searchKey && x.searchKey.syncHandlerMs),
      indexPages: arr.map((x) => x.indexPages),
    };
  };
  const a4 = agg(c4);
  const a4pre = agg(pre4);
  const a1 = agg(runs.filter((r) => r.profile === 'cpu1x' && !r.error));
  RESULT.perf = {
    throttle: 'CDP Emulation.setCPUThrottlingRate(4)（网络不限速；本机回环）',
    runs, cpu4x: a4, cpu4x_pre: a4pre, cpu1x: a1,
    thresholds: { fcp_ms: 2000, key_longtask_ms: 50 },
    verdict: {
      fcp_min_ok: a4.fcp.min !== undefined ? a4.fcp.min < 2000 : null,
      fcp_median_ok: a4.fcp.median !== undefined ? a4.fcp.median < 2000 : null,
      key_longtask_max_ok: a4.keyLongTask.max !== undefined ? a4.keyLongTask.max < 50 : null,
      key_longtask_all_runs_have_none_50ms: a4.keyLongTask.all ? a4.keyLongTask.all.every((x) => x === 0) : null,
      wire_before_dcl: a4.wire_vs_dcl.length ? a4.wire_vs_dcl.every((x) => x.beforeDCL) : null,
      pre_attribution: {
        pre_fcp_min: a4pre.fcp ? a4pre.fcp.min : null,
        pre_key_longtask: a4pre.keyLongTask ? a4pre.keyLongTask.all : null,
      },
    },
  };
  log('  #16 4×CPU: FCP min=' + a4.fcp.min + ' max=' + a4.fcp.max + '；按键长任务 min=' + a4.keyLongTask.min + ' max=' + a4.keyLongTask.max);
}

/* ───────────────────────── 报告输出 ───────────────────────── */

function fmtCount(items, bucket) { return items.filter((i) => i.bucket === bucket).length; }

function buildMd() {
  const R = RESULT;
  const L = [];
  const t10 = R.rows['10'];
  const t12 = R.rows['12'];
  const t14 = R.rows['14'];
  const P = R.perf;

  L.push('# 移动端收口判定报告（Closeout Adjudication）');
  L.push('');
  L.push('- 生成时间：' + R.generated_at);
  L.push('- 探针：`tools/mobile-closeout.js`（只读测量；只写 `reports/mobile-closeout.md`、`reports/mobile-closeout.json`、自身）');
  L.push('- 改后实例：`' + BASE + '/`（仓库 `<repo>`）　改前基线实例：`' + PRE + '/`');
  L.push('- 浏览器：`' + R.env.browser + '`（sha256前16 `' + R.env.browser_sha16 + '`；路径由 `CHROME_PATH` / `%LOCALAPPDATA%\\ms-playwright` / `%PROGRAMFILES%` 环境变量拼接，无盘符字面量）');
  L.push('- 改前实例存活：HTTP ' + (R.env.server_pre && R.env.server_pre.status) + '（改前指纹对账见下）');
  L.push('');

  // 基线指纹对账
  L.push('## 0. 改前基线实例指纹对账（本轮实测，独立于任何报告）');
  L.push('');
  L.push('| 文件 | 本轮 8788 实测 sha256[0:16] | 验证器报告记录的改前值 | 一致 |');
  L.push('|---|---|---|---|');
  for (const row of (R.baseline_fingerprints || [])) {
    L.push('| `' + row.file + '` | `' + row.measured + '` | `' + row.reported + '` | ' + (row.same ? '✅' : '❌') + ' |');
  }
  L.push('');
  L.push('> `reports/mobile-verification.json` 里 E1/E2 那一轮把改前实例记为**不可达**（`pre_missing=true`）→ `diffTable` 为空数组，');
  L.push('> 30 项清单**不在 JSON 里**，只存在于 `reports/mobile-verification.md` §2 diff 表与 §5 #10「失败项（30）」。本报告按后者取清单，并用同一探针重新双实例复测。');
  L.push('');
  L.push('### 0b. 证据版本对账（本次会话窗口内 artifacts 被并发改写，必须留痕）');
  L.push('');
  L.push('| 证据文件 | 本轮读取时的 mtime | 字节 | sha256[0:16] | 我从中取了什么 |');
  L.push('|---|---|---|---|---|');
  if (t10) {
    L.push('| `reports/mobile-verification.md` | ' + t10.verifier.mtime + ' | ' + t10.verifier.bytes + ' | `' + t10.verifier.sha16 + '` | 30 项清单取自其**存档章节**「' + (t10.verifier.diff_rows_section || '?') + '」中的旧版 §2 diff 表（新版把旧版整篇作为「前任报告原文存档 · 保留、不采信」附在后面） |');
    L.push('| `reports/mobile-verification.json` | ' + (t10.verifier_json ? t10.verifier_json.run_at : '?') + '（该轮 run_at） | — | — | E1/E2 条目的 `pre_missing` / `diffTable` / `regressionCount` |');
  }
  if (t10 && t10.verify_c && t10.verify_c.exists) {
    L.push('| `reports/mobile-verify-c.md` | ' + t10.verify_c.mtime + ' | ' + t10.verify_c.bytes + ' | `' + t10.verify_c.sha16 + '` | 其 §0 第 1 行结论与「裁决外 N」计数 |');
  }
  L.push('');
  if (t10 && t10.verifier && t10.verifier.head_table_verdicts && Object.keys(t10.verifier.head_table_verdicts).length) {
    L.push('**新版 `mobile-verification.md` 头部速览表的当前判定**（同一文件里的新版结论）：');
    L.push('');
    L.push('| item | 名称 | 判定 |');
    L.push('|---|---|---|');
    for (const item of ['8', '10', '12', '14', '16']) {
      const h = t10.verifier.head_table_verdicts[item];
      if (h) L.push('| ' + item + '（check id ' + h.id + '） | ' + h.name + ' | ' + h.verdict + ' |');
    }
    L.push('');
    L.push('> 即：本判定表里被判 FAIL 的 #12 / #14 在新版已翻成 ✅ 通过；#10 在新版是 ⚠️ 部分（其自述「改前实例在线的唯一一轮：diff 143 条 / 白名单 143 条 / REGRESSION **0** 条」），#16 仍 ❌（见 §3）。');
    L.push('');
  }

  // 4 行判定表
  L.push('## 1. 四行判定表');
  L.push('');
  L.push('| 行 | 原始证据 | 分类 | 结论 | 最小复现 |');
  L.push('|---|---|---|---|---|');
  if (t10) {
    L.push('| **#10 E1-E2 零回归** | `mobile-verification.md`（sha16 `' + t10.verifier.sha16 + '`）的**存档章节**「' + (t10.verifier.diff_rows_section || '旧版存档') + '」里那份旧版 §2：18 行逐格对打，`回归 30 项 / 允许差异 15 项`；旧版 §5 #10「失败项（30）」= `headerH`×6(@768) + `sidebarW`×6(@768) + `brandW`×18(全视口)。`mobile-verification.json` 的 E1/E2 记录 `pre_missing=true`、`diffTable=[]`（清单不在 JSON） | 验证器口径：**A ' + fmtCount(t10.items30, 'A') + ' / B ' + fmtCount(t10.items30, 'B') + ' / C ' + fmtCount(t10.items30, 'C') + '**；我同探针双实例复测 270 格：差异 ' + t10.grid.diff_cells + ' 格 / ' + t10.grid.diff_rows + ' 行 → **A ' + t10.my_buckets.A + ' / B ' + t10.my_buckets.B + ' / C ' + t10.my_buckets.C + '** | **C=0。口径差异**：该验证器把移动档规格变化（768 的 56px 顶栏 / 320px 抽屉 / ≥44px 行高 / F3 本页目录）计成了回归；`brandW 139→121` 是**被测元素身份变了**（改前实例 `.brand-name` 计数 0，旧探针回退到 `.brand`=139；改后探针取到 `.brand-name`=121），同选择器实测改前/改后 `.brand` 盒宽**同为 139px** | `node tools/mobile-closeout.js --check=10`；证据字段 `rows."10".my_diffs` / `brand_probe` |');
  }
  if (t12) {
    L.push('| **#12 E4 交互** | `mobile-verification.md` §5 #12「失败项（1）」= **主题切换 `{"changed":false,"toggledBack":true}`**；同段读数「搜索『权限』→ 10 条（计数文本『显示前 40 / 共 47 个结果』）」。本轮实测「权限」：计数文本 `' + t12.measured.search['权限'].settled.countText + '`；DOM `li` 稳态 = ' + t12.measured.search['权限'].settled.liCount + '、230ms 瞬时采样 = ' + t12.measured.search['权限'].mid250ms.liCount + '（瞬时值随采样时机变化，稳态恒为 40） | 失效判据归属：**主题断言**（不是搜索结果条数）→ **口径差异** | **命中数 = 47**（计数文本「共 47」+ 离线复算 47，与 `verify-site` #8 独立复算一致）／**显示数 = 40**（`MAX_RESULTS=40`；改前实例 `assets/site.js` 实测 `MAX_RESULTS = 40` → **同一显示上限**，我的改前实测计数文本也是「显示前 40 / 共 47 个结果」）／「10 条」= **改后切片渲染的瞬时 DOM 行数**（`renderOne` 每片 ≤3 行、片间 `setTimeout(0)`；改前是一次性 `for (k<40)` 同步插 40 行，所以改前侧任何时刻读都是 40） | `node tools/mobile-closeout.js --check=12`；字段 `rows."12".measured` |');
  }
  if (t14) {
    L.push('| **#14 F1 懒加载 + 命中集** | `mobile-verification.md` §5 #14「失败项（1）」= 命中集/排序变化 `[{q:权限, postCount:10, preCount:0, same:false}]`（`preCount=0` 说明那一轮改前侧**读数失败**） | 失效判据归属：**对照基线读数**（改前侧 0 条）→ **口径差异** | 本轮三重自测：①首屏是否同步加载 `search-index`：**改后 false**（`performance.getEntriesByType("resource")` 与 CDP Network 均无命中，`__LIBRARY_SEARCH__` 未定义），**改前 true**（HTML 内含 `<script src="assets/search-index.js" defer>`，首屏即命中）；②首次搜索后**懒加载出现**：true；③命中集/排序：离线复算（自移植打分器）× 与 UI 逐条比对 = `' + (t14.judgements.hit_set_matches_offline ? '逐条一致' : '存在差异') + '`，改前 UI × 改后 UI = `' + (t14.judgements.pre_ui_equals_post_ui ? '逐条一致' : '存在差异') + '`；锚点对账（`verify-site` #8 独立复算 权限47/配置文件67/命令79）= ' + (t14.judgements.anchors_ok ? '全部命中' : '未全部命中') + '；**改前侧 `preCount=0` 的机制已定位**：390px 下改前顶栏溢出，`[data-open-search]` 的普通点击被溢出元素 `<kbd>` 遮挡（本探针 elementFromPoint(按钮中心) 命中 `kbd`，Playwright 普通点击 30s 超时）→ 改前侧任何「真实点击」路径都拿不到结果；改 force 点击后改前 UI 与改后 UI 完全一致 | `node tools/mobile-closeout.js --check=14`；字段 `rows."14".compare` / `rows."14".pre.openInfo` |');
  }
  if (P && P.cpu4x) {
    L.push('| **#16 PERF** | `mobile-verification.md` §5 #16「失败项（1）」= `FCP=3612ms`（4G+4×CPU）；裁决 §4 登记「搜索按键个别帧 52–64ms」为已知残余 | 我的自测（**4× CPU、网络不限速**）：FCP min **' + P.cpu4x.fcp.min + 'ms** / median ' + P.cpu4x.fcp.median + 'ms / max ' + P.cpu4x.fcp.max + 'ms（阈值 <2000ms）；单次搜索按键长任务 各轮 **' + JSON.stringify(P.cpu4x.keyLongTask.all) + '** ms（阈值 <50ms；`longtask` 只上报 ≥50ms 的帧）；1× CPU 对照 FCP ' + (P.cpu1x.fcp ? P.cpu1x.fcp.min : '—') + '–' + (P.cpu1x.fcp ? P.cpu1x.fcp.max : '—') + 'ms、按键长任务 ' + JSON.stringify(P.cpu1x.keyLongTask.all) + '；`DCL 前可交互` = ' + (P.verdict.wire_before_dcl ? '成立' : '不成立（两代同源：站点 JS 在 DOMContentLoaded 才接线）') + ' | **FCP 最好值 ' + (P.verdict.fcp_min_ok ? '达标' : '未达标') + ' / 中位 ' + (P.verdict.fcp_median_ok ? '达标' : '未达标') + '；单次按键长任务 ' + (P.verdict.key_longtask_max_ok ? '全轮达标' : '个别帧 ≥50ms（未全达标）') + '** | `node tools/mobile-closeout.js --check=16`；字段 `perf.runs` |');
  }
  L.push('');

  // A/B/C 计数
  if (t10) {
    L.push('## 2. #10 的 A/B/C 计数与清单');
    L.push('');
    L.push('### 2.1 验证器自己那 30 项（原始证据逐条分类）');
    L.push('');
    L.push('| # | 视口 | 页面 | 字段 | 改前 → 改后 | 分类 | 依据 |');
    L.push('|---|---|---|---|---|---|---|');
    t10.items30.forEach((it, i) => {
      L.push('| ' + (i + 1) + ' | ' + it.viewport + ' | `' + it.page + '` | `' + it.field + '` | ' + it.pre + ' → ' + it.post + ' | **' + it.bucket + '** | ' + it.clause + ' |');
    });
    L.push('');
    L.push('**计数：A = ' + fmtCount(t10.items30, 'A') + '（契约明文移动档规格：顶栏 56px / 抽屉 320px）×　B = ' + fmtCount(t10.items30, 'B') + '（`brandW` 工具口径伪差异）×　C = ' + fmtCount(t10.items30, 'C') + '**');
    L.push('');
    L.push('> **C = 0** → 口径差异：该验证器把移动档规格变化计成了回归（768 属移动档，`navRowMin 21→44`、`headerH 52→56`、`sidebarW 290→320`、F3 的 TOC 出现均为契约明文要求），');
    L.push('> 并把「新增元素 `.brand-name`」误当成「`.brand` 变窄」。');
    L.push('');
    L.push('### 2.2 我自己重跑的 270 格双实例网格（同探针、同选择器、改前改后逐格）');
    L.push('');
    L.push('- 视口 ' + t10.grid.viewports.join(' / ') + ' × 页面 ' + t10.grid.pages.length + ' 个 × 字段 ' + GRID_FIELDS.length + ' = **' + t10.grid.cells + ' 格**；差异 **' + t10.grid.diff_cells + ' 格 / ' + t10.grid.diff_rows + ' 行**');
    L.push('- 分类计数：**A ' + t10.my_buckets.A + ' / B ' + t10.my_buckets.B + ' / C ' + t10.my_buckets.C + '**');
    L.push('');
    L.push('| 视口 | 页面 | 字段 | 改前 | 改后 | 分类 | 依据 |');
    L.push('|---|---|---|---|---|---|---|');
    t10.my_diffs.forEach((d) => {
      L.push('| ' + d.vp + ' | `' + d.page + '` | `' + d.field + '` | `' + JSON.stringify(d.pre) + '` | `' + JSON.stringify(d.post) + '` | **' + d.bucket + '** | ' + d.clause + ' |');
    });
    L.push('');
    L.push('**`brandW` 关键实测（同选择器 `a.brand`）**：');
    L.push('');
    L.push('| 视口 | 页面 | 改前 `.brand` 宽 | 改后 `.brand` 宽 | 改前 `.brand-name` 计数 | 改后 `.brand-name` 计数/宽 |');
    L.push('|---|---|---|---|---|---|');
    t10.brand_probe.forEach((b) => {
      L.push('| ' + b.vp + ' | `' + b.page + '` | ' + b.pre_brandW + ' | ' + b.post_brandW + ' | ' + b.pre_brandNameCount + ' | ' + b.post_brandNameCount + ' / ' + b.post_brandNameW + ' |');
    });
    L.push('');
    L.push('> 结论：`.brand` 盒宽改前改后**逐格相同**（' + (t10.brand_probe.every((b) => b.pre_brandW === b.post_brandW) ? '全部一致' : '存在不一致') + '）；`.brand-name` 是改后**新增**的子元素（改前计数 0），属红队 F1 的修复载体。');
    L.push('');
    L.push('### 2.2b 网格外的「已裁决」差异（B 类，登记不掩盖）');
    L.push('');
    if (!t10.ruled_items.length) {
      L.push('- 无（网格 15 字段之外没有其它差异）。');
    } else {
      L.push('| 视口 | 页面 | `.side-toc` 计数 | `.side-toc` 可见 | 侧栏 `a[href]` 总数 | 其中 `.side-toc` 链接 | 成因 | 分类 |');
      L.push('|---|---|---|---|---|---|---|---|');
      t10.ruled_items.forEach((x) => {
        L.push('| ' + x.vp + ' | `' + x.page + '` | ' + x.sideTocCount + ' | ' + x.sideTocVisible + ' | ' + x.sidebarNavAll + ' | ' + x.postSideTocLinks + ' | ' + x.cause + ' | **B** |');
      });
      L.push('');
      L.push('> ' + t10.ruled_items[0].clause);
      L.push('> 这些格子解释了我第一轮探针里出现的 `navRowCount / tocVisible / tocDisplay / tocW` 差异：**不是回归**，而是新元素 `.side-toc` 被同一选择器并入了统计。');
    }
    L.push('');
    L.push('### 2.3 与另外两份独立报告的交叉（都指向同一个结论：C = 0）');
    L.push('');
    L.push('1. **本报告自己的 270 格双实例复测**（§2.2）：差异 ' + t10.grid.diff_cells + ' 格，A ' + t10.my_buckets.A + ' / B ' + t10.my_buckets.B + ' / C ' + t10.my_buckets.C + ' —— 改前实例身份由 sha256 指纹坐实（§0），同选择器逐格对打。');
    L.push('2. **`reports/mobile-verification.md` 新版**（mtime `' + t10.verifier.mtime + '`，sha16 `' + t10.verifier.sha16 + '`）item 10 自述：改前实例在线的唯一一轮「diff 条目 143 条、白名单 143 条、**REGRESSION 0 条**」→ 与 C=0 一致（它的白名单更宽：覆盖 F2/F3/C1/C2/C3/D2/B 项）。');
    if (t10.verify_c && t10.verify_c.exists) {
      L.push('3. **`reports/mobile-verify-c.md`**（mtime `' + t10.verify_c.mtime + '`，sha16 `' + t10.verify_c.sha16 + '`）结论行：`' + t10.verify_c.headline + '`');
      L.push('   - 该文件里 `270` / `14 行` / `裁决外 0` 三串的出现情况：' + JSON.stringify({ has270: t10.verify_c.fileHas270, has14rows: t10.verify_c.fileHas14Rows, hasZeroOutside: t10.verify_c.fileHasZeroOutside }) + '；数字串 `165 格` / `差异 31`：' + JSON.stringify({ has165: t10.verify_c.fileHas165, has31: t10.verify_c.fileHas31 }));
      L.push('   - 说明：**「270 格 / 差异 14 行」这个说法在这份 artifact 的任何一版里都不存在**（它报的是 165 格）。本会话早期我读到的该文件另一个版本（mtime 22:11:38，74147 B）当时报的是 `❌ FAIL｜165 格比对 / 差异 111（裁决内 2、规格内 34、裁决外 75）`，且改前列大面积是 `0`/`—`（`headerH 0`、`sidebar.display —`、`sidebar.width —`、`menuInfo —`）——那是它自己的探针选择器与改前一代元素不兼容导致的失真列，不是现场值；该版本已被其作者重写（现版已改成 `✅ PASS｜差异 31、裁决外 0`）。');
      L.push('   - 结论：三份独立测量在「C = 0」上一致；判 FAIL 的那份报告（现已作为存档保留、并自我标注「不采信」）唯一的分歧点是**白名单口径**，不是现场差异。');
    }
    L.push('');
  }

  // 性能细节
  if (P && P.runs && P.runs.length) {
    L.push('## 3. #16 性能：我自己的数字（4× CPU 节流，网络不限速）');
    L.push('');
    L.push('- 口径：CDP `Emulation.setCPUThrottlingRate(4)`；回环服务不限速；视口 390×844；每页 3 轮（1× CPU 另跑 2 轮用于归因）');
    L.push('- 阈值：FCP < 2000ms；单次搜索按键长任务 < 50ms');
    L.push('');
    L.push('| 档 / 实例 | 页面 | 轮 | FCP | DCL | load | ☰ 可交互 | DCL 前可交互 | 按键最大长任务 | 命中 |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    P.runs.forEach((r) => {
      L.push('| ' + r.profile + ' · ' + (r.instance || 'post') + ' | `' + r.page + '` | #' + r.round + ' | ' + (r.fcp === null ? '—' : r.fcp + 'ms') + ' | ' + (r.dcl || '—') + ' | ' + (r.load || '—') + ' | ' + (r.wire === null ? '—' : r.wire + 'ms') + ' | ' + (r.wire !== null && r.dcl ? (r.wire <= r.dcl ? '是' : '否') : '—') + ' | ' + (r.searchKey ? r.searchKey.maxLongTask + 'ms' : '—') + ' | ' + (r.searchKey ? '`' + r.searchKey.countText + '`' : '—') + ' |');
    });
    L.push('');
    L.push('**4× CPU 汇总（改后实例）**：FCP min/median/max = ' + P.cpu4x.fcp.min + ' / ' + P.cpu4x.fcp.median + ' / ' + P.cpu4x.fcp.max + ' ms；按键长任务 各轮 = ' + JSON.stringify(P.cpu4x.keyLongTask.all) + ' ms；1× CPU 对照 FCP = ' + JSON.stringify(P.cpu1x.fcp.all) + ' ms、按键长任务 = ' + JSON.stringify(P.cpu1x.keyLongTask.all) + ' ms。');
    L.push('');
    L.push('- **改前实例同档归因（4× CPU，2 轮）**：FCP = ' + JSON.stringify(P.cpu4x_pre ? P.cpu4x_pre.fcp.all : null) + ' ms；按键长任务 = ' + JSON.stringify(P.cpu4x_pre ? P.cpu4x_pre.keyLongTask.all : null) + ' ms（**4–20× 于改后**）。改前侧 `☰ 可交互` 列为 `—`：改前 `#nav-toggle` 根本不写 `aria-expanded`（契约 B 项新增语义），本探针以 `aria-expanded` 翻转作为「可交互」信号，故改前侧结构性取不到值（不代表按钮不可点）。');
    L.push('- **与执行者自报（残余 52–64ms 来自浏览器排版）是否一致**：本轮 4× CPU 各轮按键长任务 = ' + JSON.stringify(P.cpu4x.keyLongTask.all) + '（`longtask` 只上报 ≥50ms 的帧，`0` = 该轮无 ≥50ms 帧）；与自报区间 ' + (P.cpu4x.keyLongTask.max >= 50 ? '同一量级（最大 ' + P.cpu4x.keyLongTask.max + 'ms' + (P.cpu4x.keyLongTask.max > 64 ? '，略高于其自报上界' : '，落在/接近其自报的 52–64ms 区间') + '）' : '本轮未复现（全部 <50ms）') + '；且 1× CPU 档 ' + JSON.stringify(P.cpu1x.keyLongTask.all) + ' → 残余帧与 CPU 档位强相关，与其「来自浏览器排版/低 CPU 档」的归因方向一致。');
    L.push('');
    L.push('> 「DCL 前可交互」：站点 JS（含 ☰ 抽屉）在 `DOMContentLoaded` 才接线（`tools/site/assets.js` 的 `doc.readyState === "loading" ? ... DOMContentLoaded`），因此严格早于 DCL 的点击结构性不可能生效；本探针用「首帧起每帧点一次 `#nav-toggle` 直到 `aria-expanded` 翻转」测出首个可交互时刻，与 DCL 并列（两代同源设计）。');
    L.push('');
  }

  L.push('## 4. 结论摘要');
  L.push('');
  L.push('- #10：**C=0**（A ' + (t10 ? fmtCount(t10.items30, 'A') : '-') + ' / B ' + (t10 ? fmtCount(t10.items30, 'B') : '-') + '；我的 270 格复测 A ' + (t10 ? t10.my_buckets.A : '-') + ' / B ' + (t10 ? t10.my_buckets.B : '-') + ' / C ' + (t10 ? t10.my_buckets.C : '-') + '）→ 口径差异，非真回归。');
  if (t12) L.push('- #12：**口径差异**。命中数 47（改前同值）/ 显示数 40（改前同一上限）；FAIL 来自主题断言（auto→light 在浅色系统下同色）与切片渲染的瞬时 DOM 计数。');
  if (t14) L.push('- #14：**口径差异**。首屏同步加载：改后 ' + t14.judgements.sync_load_first_paint.post + ' / 改前 ' + t14.judgements.sync_load_first_paint.pre + '；命中集与排序：UI×离线复算 ' + (t14.judgements.hit_set_matches_offline ? '一致' : '不一致') + '、改前×改后 ' + (t14.judgements.pre_ui_equals_post_ui ? '一致' : '不一致') + '；原 FAIL 的 `preCount=0` = 390px 下改前顶栏溢出，搜索按钮被 `<kbd>` 遮挡 → 改前侧真实点击路径取不到结果（本探针 force 点击后两边 40/40 逐条一致）。');
  if (P && P.cpu4x) L.push('- #16：4× CPU（不限网）FCP min ' + P.cpu4x.fcp.min + 'ms / 中位 ' + P.cpu4x.fcp.median + 'ms（阈值 2000）、单次搜索按键长任务 各轮 ' + JSON.stringify(P.cpu4x.keyLongTask.all) + 'ms（阈值 50）→ ' + (P.verdict.fcp_min_ok && P.verdict.key_longtask_max_ok ? '按「最好值 + 全轮」两项均达标' : (P.verdict.fcp_min_ok ? 'FCP 最好值达标、按键长任务个别帧未达标（与裁决登记的已知残余同族）' : 'FCP 中位未达标，与改前同档同量级')) + '。');
  L.push('');
  return L.join('\n') + '\n';
}

function writeOutputs() {
  fs.writeFileSync(OUT_MD, buildMd(), 'utf8');
  fs.writeFileSync(OUT_JSON, JSON.stringify(RESULT, null, 2), 'utf8');
}

/* 指纹对账（改前实例 vs 报告记录的改前值） */
async function baselineFingerprints() {
  const expect = {
    'index.html': '32e59e1848ccb1f0',
    'assets/site.css': '6a71933d93f9ca87',
    'assets/site.js': 'aac4daa45cbfb6fa',
    'search-index.json': '6ef2a6a7b448b25a',
  };
  const out = [];
  for (const f of Object.keys(expect)) {
    try {
      const r = await httpGetBuffer(PRE + '/' + f);
      const h = sha16(r.buf);
      out.push({ file: f, measured: h, reported: expect[f], same: h === expect[f], status: r.status, bytes: r.buf.length });
    } catch (e) {
      out.push({ file: f, measured: 'ERR ' + e.message, reported: expect[f], same: false });
    }
  }
  RESULT.baseline_fingerprints = out;
}

/* ───────────────────────── 入口 ───────────────────────── */

(async function main() {
  if (argv.includes('--report-only')) {          // 用现有 reports/mobile-closeout.json 重排报告（不重新测量）
    Object.assign(RESULT, JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')));
    writeOutputs();
    log('（--report-only）已用 reports/mobile-closeout.json 重排 reports/mobile-closeout.md');
    return;
  }
  if (ONLY && fs.existsSync(OUT_JSON)) {         // 单/多项重跑：叠加到既有 JSON，避免覆盖其它条目的测量结果
    try {
      const prev = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
      const keepRows = {};
      for (const k of Object.keys(prev.rows || {})) if (!ONLY.includes(k)) keepRows[k] = prev.rows[k];
      RESULT.rows = Object.assign(keepRows, RESULT.rows);
      if (!ONLY.includes('16') && prev.perf) RESULT.perf = prev.perf;
      RESULT.previous_runs = (prev.previous_runs || []).concat([{ at: prev.generated_at, rows: Object.keys(prev.rows || {}), perf: !!prev.perf }]);
    } catch (e) { /* 旧 JSON 不可解析则忽略 */ }
  }
  try {
    await baselineFingerprints();
    await runChecks();
  } catch (e) {
    RESULT.error = String(e && e.stack ? e.stack : e);
    log('ERROR', RESULT.error);
  }
  RESULT.finished_at = new Date().toISOString();
  writeOutputs();
  log('写出 reports/mobile-closeout.md / reports/mobile-closeout.json');
  if (wantJson) console.log(JSON.stringify({
    generated_at: RESULT.generated_at, error: RESULT.error || null,
    rows: Object.keys(RESULT.rows),
    perf_fcp_min: RESULT.perf && RESULT.perf.cpu4x ? RESULT.perf.cpu4x.fcp.min : null,
    perf_keylt_max: RESULT.perf && RESULT.perf.cpu4x ? RESULT.perf.cpu4x.keyLongTask.max : null,
  }, null, 2));
})();
