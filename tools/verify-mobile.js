'use strict';
/**
 * verify-mobile.js — 独立验证 Agent (Independent Verifier) 的移动端真机复测工具。
 *
 * 立场：不信执行者自报的任何数字。所有结论都由本脚本在真机 Chrome 上重新测量，
 * 并给出可复现命令（--check=N 单项复跑）。
 *
 * 16 项（任务书编号）= 本脚本的 check 编号（每项 title 里带 [item N]）：
 *   1 A1  2 A2  3 A3  4 A4  5 B1-B6  6/7/8 C1/C2/C3  9 D1-D3  10 E1/E2  11 E3
 *   12 E4 13 E5 14 F1 15 无障碍 16 性能
 *
 * 用法：
 *   node tools/verify-mobile.js                        # 全部检查 + 写 reports/mobile-verification.json
 *   node tools/verify-mobile.js --check=5              # 只跑第 5 项（可 --check=5,15）
 *   node tools/verify-mobile.js --check=13 --json      # 结果同时打印到 stdout
 *   node tools/verify-mobile.js --url=http://127.0.0.1:8787 --pre=http://127.0.0.1:8788
 *   node tools/verify-mobile.js --no-pre               # 不用改前实例做对照（E1/E2 记 partial）
 *
 * 两个实例：
 *   --url   = 改后站点（默认 8787）
 *   --pre   = 改前基线实例（默认 8788 = 移动端改造前 HEAD a19a6c2 的完整站点）
 *   零回归（E1/E2）用**同一份探针**对这两个实例逐格对打，diff 表写进 JSON；不采信任何自报数字。
 *
 * 门禁（E3）在**影子副本**里跑（--shadow，默认 <repo>/../_shadow-verify），因为
 * verify-site / gh-pages-smoke / build-site --self-test 会写 reports/** 或重建产物。
 *
 * 只写 reports/mobile-verification.json（可用 --out= 改）；不触碰站点产物、其它报告、package.json。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('url', 'http://127.0.0.1:8787').replace(/\/+$/, '');
/** 改前基线实例（HEAD a19a6c2 的完整站点，目录 ..\_pre-mobile） */
const PRE_BASE = opt('pre', 'http://127.0.0.1:8788').replace(/\/+$/, '');
const PRE_ON = !has('no-pre');
/** 门禁影子副本（E3） */
const SHADOW = path.resolve(opt('shadow', path.join(REPO, '..', '_shadow-verify')));
const OUT_JSON = path.isAbsolute(opt('out', '')) ? opt('out', '') : path.join(REPO, opt('out', path.join('reports', 'mobile-verification.json')));
const ONLY = (opt('check', '') || '').split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => n > 0);
const PRINT_JSON = has('json');

/* ───────────────────────── 常量 ───────────────────────── */

/** A1 的 10 片页面（与 tools/mobile-measure.js 的 PAGES 完全一致，便于与基线逐格对照） */
const PAGES10 = [
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

/** A3 点名的页面（任务书里的 paper/admin/reference/configuration/* 实盘不存在，按实盘改为 paper/reference/configuration/；
 *  任务书里的 “command-tree” 实盘**不存在同名页**（全站 141 页无 command-tree；上游 Command API 章节是
 *  command-api/{basics,arguments,misc}/* 一组页）→ 取“命令树/命令注册”最贴近的实盘页 basic-command 代表，
 *  替代关系随 A3 结果写进 JSON（metrics.requiredSubstitution） */
const A3_REQUIRED = [
  '/paper/reference/world-configuration/',
  '/velocity/tuning/',
  '/paper/dev/pdc/',
  '/paper/dev/dialogs/',
  '/folia/reference/region-logic/',
  '/paper/dev/command-api/misc/basic-command/',
  '/paper/reference/configuration/',
  '/paper/reference/global-configuration/',
  '/paper/reference/server-properties/',
];
/** 任务书点名 → 实盘替代 的显式对照（写进 JSON，避免"偷换页面"式作弊） */
const A3_REQUIRED_SUBSTITUTION = {
  'command-tree': '/paper/dev/command-api/misc/basic-command/',
  'paper/admin/reference/configuration/*': '/paper/reference/configuration/ + /paper/reference/global-configuration/ + /paper/reference/server-properties/',
};

const VP_MOBILE = [
  { name: '320x568', w: 320, h: 568 },
  { name: '360x640', w: 360, h: 640 },
  { name: '390x844', w: 390, h: 844 },
  { name: '414x896', w: 414, h: 896 },
];
const VP_768 = { name: '768x1024', w: 768, h: 1024 };
const VP_834 = { name: '834x1112', w: 834, h: 1112 };
const VP_1024 = { name: '1024x768', w: 1024, h: 768 };
const VP_1280 = { name: '1280x800', w: 1280, h: 800 };
const VP_1440 = { name: '1440x900', w: 1440, h: 900 };
const VP_DESKTOP = [VP_1024, VP_1280, VP_1440];
/** 零回归对打的视口（契约 E1：768/834/1024/1280 四档不劣化） */
const VP_REGRESSION = [VP_768, VP_834, VP_1024, VP_1280];

const OPEN_SEL = '#nav-toggle, .sidebar-toggle, #menu-btn, .menu-toggle, header button[aria-controls]';
const MENU_SEL = '#nav-toggle, .sidebar-toggle, #menu-btn, .menu-toggle';

/**
 * 浏览器可执行文件：env 拼路径（**不写盘符字面量**，否则 privacy-scan 报 ① 类隐私命中）。
 */
const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function browserPath() {
  for (const c of BROWSER_CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return null;
}

const sha = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12); } catch { return null; } };

/** 源码指纹：任何一项变化即视为“执行者已改造” */
function fingerprint() {
  const f = {
    'tools/site/assets.js': sha(path.join(REPO, 'tools/site/assets.js')),
    'tools/site/layout.js': sha(path.join(REPO, 'tools/site/layout.js')),
    'assets/site.css': sha(path.join(REPO, 'assets/site.css')),
    'assets/site.js': sha(path.join(REPO, 'assets/site.js')),
    'index.html': sha(path.join(REPO, 'index.html')),
  };
  f._all = crypto.createHash('sha256').update(Object.values(f).join('|')).digest('hex').slice(0, 12);
  return f;
}

/** 改前实例的产物指纹（同一函数，根目录换成 ..\_pre-mobile） */
function preFingerprint() {
  const root = path.join(REPO, '..', '_pre-mobile');
  const f = {
    'assets/site.css': sha(path.join(root, 'assets', 'site.css')),
    'assets/site.js': sha(path.join(root, 'assets', 'site.js')),
    'index.html': sha(path.join(root, 'index.html')),
  };
  f._all = crypto.createHash('sha256').update(Object.values(f).join('|')).digest('hex').slice(0, 12);
  return f;
}

/* ───────────────── 并发写者防护：每项检查前后各取一次产物指纹（任务书 3 件） ─────────────────
 * 背景：本会话站点被并发重建 8 次以上（F6 搜索性能修复 Agent 与主 Agent 都在改 tools/site/assets.js →
 * 重建 assets/**）。若某项检查期间指纹变化，该项一律记 verdict='unstable'（=“指纹不稳定，需重跑”），
 * 不给可能失真的 pass/fail。 */
const GUARD_FILES = ['tools/site/assets.js', 'assets/site.css', 'assets/site.js'];
function fpGuard() {
  const map = {};
  for (const f of GUARD_FILES) map[f] = sha(path.join(REPO, f));
  return { map: map, str: GUARD_FILES.map((f) => f + '=' + (map[f] || 'null')).join('|') };
}

/* ───────────────────────── 真机探针（在页面里跑，必须自包含） ───────────────────────── */

const PROBE = (flags) => {
  const F = flags || {};
  const de = document.documentElement;
  const body = document.body;
  const overflow = de.scrollWidth - de.clientWidth;
  const R = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  };
  const CS = (el) => getComputedStyle(el);
  const vis = (el) => {
    if (!el) return false;
    const s = CS(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const txt = (el, n) => (el ? (el.textContent || '').trim().slice(0, n || 30) : '');
  const cls1 = (el) => (el ? (el.className || '').toString().trim().split(/\s+/)[0] || '' : '');
  const desc = (el) => (el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls1(el) ? '.' + cls1(el) : '') : null);

  const findMenuBtn = () => {
    const sels = ['#nav-toggle', '.sidebar-toggle', '#menu-btn', '.menu-toggle', '[data-nav-toggle]', 'header button[aria-controls]', '.topbar button[aria-controls]'];
    for (const s of sels) { const el = document.querySelector(s); if (el) return el; }
    for (const b of document.querySelectorAll('header button, .topbar button')) if (txt(b).indexOf('☰') !== -1) return b;
    return null;
  };
  const findDrawer = () => document.querySelector('#sidebar, nav.sidebar, .sidebar, [data-nav-drawer]');
  const findScrim = () => {
    const byClass = document.querySelector('[class*=scrim], [class*=backdrop]:not(dialog), [class*=overlay], [class*=nav-mask], [data-scrim], [data-close-nav], [data-nav-close]');
    if (byClass && byClass.tagName !== 'BODY') return byClass;
    const d = findDrawer();
    if (!d) return null;
    const r = d.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 2, Math.max(r.right + 40, window.innerWidth * 0.75));
    const el = document.elementFromPoint(x, window.innerHeight / 2);
    if (!el || el === body || el === de) return null;
    const screens = ['fixed', 'absolute'];
    if (screens.indexOf(CS(el).position) === -1) return null;
    const er = el.getBoundingClientRect();
    if (er.width < window.innerWidth * 0.3 || er.height < window.innerHeight * 0.3) return null;
    return el;
  };

  /* ---- 撑宽文档的元素（A2 口径） ----
   * offenders          = right > clientWidth+1 且**向上无任何** overflow-x auto|scroll|hidden|clip 祖先 → 必须 0
   * leftwardOnly       = 整块落在左侧视口外（a.skip left:-9999）→ LTR 负向溢出**不进**可滚动溢出区，单列 benign
   * clippedExplained   = 越界但被白名单容器裁掉（真实滚动容器自身 overflow-x:auto）→ benign
   * clippedUnexplained = 越界被 hidden/clip 祖先藏起来且祖先不在白名单 → 刷绿嫌疑 → 必须 0
   */
  const CLIP_LEGIT = ['code-scroll', 'code-pre', 'table-wrap', 'sidebar', 'side-filter', 'search-results', 'search-dialog', 'toc-side', 'nav-scrim', 'lightbox', 'src-list', 'side-sec', 'side-cat', 'side-group', 'page-toc', 'drawer-toc'];
  const legitClip = (el) => {
    let q = el;
    for (let i = 0; i < 6 && q && q !== body; i++) {
      const cn = (q.className || '').toString();
      for (const k of CLIP_LEGIT) if (cn.indexOf(k) !== -1) return k + '[' + CS(q).overflowX + ']';
      q = q.parentElement;
    }
    return null;
  };
  const clippedBy = (el) => {
    let p = el.parentElement;
    while (p && p !== body) {
      const cs = CS(p);
      if (['auto', 'scroll', 'hidden', 'clip'].indexOf(cs.overflowX) !== -1) return p;
      p = p.parentElement;
    }
    return null;
  };
  const offenders = [];
  const leftwardOnly = [];
  const clippedExplained = [];
  const clippedUnexplained = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = CS(el);
    if (cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cls = (el.className || '').toString().slice(0, 60);
    const chain = (() => {
      const c = []; let p = el.parentElement;
      for (let i = 0; i < 4 && p; i++) { c.push(p.tagName.toLowerCase() + (p.className ? '.' + (p.className || '').toString().trim().split(/\s+/)[0] : '')); p = p.parentElement; }
      return c.join(' < ');
    })();
    const rec = { tag: el.tagName.toLowerCase(), cls, ...R(el), overflowX: cs.overflowX, ws: cs.whiteSpace, pos: cs.position, parentChain: chain };
    if (r.right <= de.clientWidth + 1) {
      if (r.left < -1) { rec.reason = r.right > 1 ? 'leftward-overflow' : 'fully-offscreen-left'; leftwardOnly.push(rec); }
      continue;
    }
    const cl = clippedBy(el);
    if (cl) {
      rec.clippedBy = desc(cl) + ' [overflowX:' + CS(cl).overflowX + ']';
      const lg = legitClip(cl);
      if (lg) { rec.legit = lg; clippedExplained.push(rec); } else { clippedUnexplained.push(rec); }
      continue;
    }
    offenders.push(rec);
  }
  const dedup = (arr) => { const seen = new Set(); return arr.slice().sort((a, b) => b.right - a.right).filter((e) => { const k = e.tag + '|' + e.cls; if (seen.has(k)) return false; seen.add(k); return true; }); };
  const realOffenders = dedup(offenders).slice(0, 12);
  const benignOffenders = dedup(leftwardOnly).slice(0, 8);
  const unexplained = dedup(clippedUnexplained).slice(0, 12);

  /* ---- pre / table ---- */
  const pres = Array.from(document.querySelectorAll('pre'));
  /** 滚动容器：**优先**返回"可键盘聚焦的滚动容器"（tabindex=0 + role=region），否则返回最近的滚动祖先。
   *  （踩坑记录：pre 自身常带 overflow-x:auto，但真正 tabindex=0/role=region 的是外层 .code-scroll；
   *    若只取最近的滚动元素，会把 48/48 全判成缺 tabindex/role。） */
  const scrollerOf = (el, depth) => {
    const cand = [];
    let q = el;
    for (let k = 0; k <= (depth || 3) && q; k++) {
      const c = CS(q);
      if (['auto', 'scroll'].indexOf(c.overflowX) !== -1) cand.push(q);
      q = q.parentElement;
    }
    const focusable = cand.filter((x) => x.getAttribute('tabindex') === '0' && x.getAttribute('role') === 'region');
    return focusable.length ? focusable[focusable.length - 1] : (cand.length ? cand[0] : null);
  };
  const preInfo = pres.map((el, i) => {
    const cs = CS(el), p = el.parentElement, pcs = p ? CS(p) : null;
    const selfScroll = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    const parentScroll = !!pcs && (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll');
    const grand = p && p.parentElement ? CS(p.parentElement) : null;
    const grandScroll = !!grand && (grand.overflowX === 'auto' || grand.overflowX === 'scroll');
    const sc = scrollerOf(el, 3);
    return {
      i, scrollable: selfScroll || parentScroll || grandScroll,
      where: selfScroll ? 'self' : (parentScroll ? 'parent' : (grandScroll ? 'grandparent' : null)),
      tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
      scrollW: el.scrollWidth, clientW: el.clientWidth, needsScroll: el.scrollWidth > el.clientWidth + 1,
      container: sc ? { tag: sc.tagName.toLowerCase(), cls: cls1(sc), tabindex: sc.getAttribute('tabindex'), role: sc.getAttribute('role'), ariaLabel: sc.getAttribute('aria-label'), overflowX: CS(sc).overflowX } : null,
      containerTabindex2: sc ? { tag: sc.tagName.toLowerCase(), tabindex: sc.getAttribute('tabindex'), role: sc.getAttribute('role'), ariaLabel: sc.getAttribute('aria-label') } : null,
    };
  });
  const tables = Array.from(document.querySelectorAll('table'));
  const tableInfo = tables.map((t, i) => {
    let q = t.parentElement, found = null;
    for (let k = 0; k < 4 && q; k++) {
      const c = CS(q);
      if (['auto', 'scroll'].indexOf(c.overflowX) !== -1 || q.getAttribute('role') === 'region') { found = q; break; }
      q = q.parentElement;
    }
    return {
      i, scroller: !!found,
      scrollerTag: found ? found.tagName.toLowerCase() : null,
      scrollerCls: found ? cls1(found) : null,
      tabindex: t.getAttribute('tabindex'), role: t.getAttribute('role'),
      containerTabindex: found ? found.getAttribute('tabindex') : null,
      containerRole: found ? found.getAttribute('role') : null,
      containerAria: found ? found.getAttribute('aria-label') : null,
      needsScroll: t.scrollWidth > t.clientWidth + 1,
      tableScrollW: t.scrollWidth, tableClientW: t.clientWidth,
      wrapScrollW: found ? found.scrollWidth : null, wrapClientW: found ? found.clientWidth : null,
      cls: cls1(t), display: CS(t).display,
    };
  });

  /* ---- 顶栏 / 侧栏 / TOC ---- */
  const header = document.querySelector('header.topbar, header, .topbar');
  const headerBox = header ? {
    h: Math.round(header.getBoundingClientRect().height),
    w: Math.round(header.getBoundingClientRect().width),
    scrollW: header.scrollWidth, clientW: header.clientWidth,
    overflowing: header.scrollWidth > header.clientWidth + 1,
    flexWrap: CS(header).flexWrap, display: CS(header).display, position: CS(header).position,
    rows: (() => { const tops = new Set(); for (const c of header.children) { const r = c.getBoundingClientRect(); if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top)); } return tops.size; })(),
  } : null;
  const headerH = header ? Math.round(header.getBoundingClientRect().height) : 0;
  const sidebar = findDrawer();
  /* 本页目录 rail：**只认 aside.toc-side / aside#page-toc**。
     （注意：侧栏里的 details#drawer-toc 也带 data-toc，若把 [data-toc] 写进这个选择器，
      它在 DOM 里更靠前，会把 1024/1280 的读数带偏 —— 2026-10-21 实测踩过这个坑） */
  const toc = document.querySelector('aside#page-toc, .toc-side, aside.toc');
  const layout = document.querySelector('.layout');
  const drawerToc = document.querySelector('details#drawer-toc, .side-toc, details.mobile-toc, .mobile-toc');
  const menuBtn = findMenuBtn();
  const drawer = sidebar;
  const scrim = findScrim();

  const tapRec = (el) => ({ ...R(el), tag: el.tagName.toLowerCase(), cls: cls1(el), text: txt(el, 20) });
  const topbarControls = header ? Array.from(header.querySelectorAll('a, button, input, [role=button]')).filter((el) => vis(el)).map(tapRec) : [];

  const inputs = Array.from(document.querySelectorAll('input, select, textarea')).map((el) => ({
    tag: el.tagName.toLowerCase(), id: el.id || '', cls: cls1(el),
    fontSize: parseFloat(CS(el).fontSize), visible: vis(el), ...R(el),
    inDrawer: !!(el.closest && el.closest('#sidebar')),
    onScreen: (() => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left < de.clientWidth && r.bottom > 0 && r.top < window.innerHeight; })(),
  }));

  const navSel = '.side-sec a[data-search], .side-group a[data-search], .side-cat a[data-search], nav#sidebar > ul > li > a, nav#sidebar .side-root > li > a, #sidebar a[data-search]';
  const navRows = Array.from(document.querySelectorAll(navSel)).filter((el) => vis(el)).map((el) => ({ h: Math.round(el.getBoundingClientRect().height), text: txt(el, 24) }));

  const twoWay = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = CS(el);
    const x = ['auto', 'scroll'].indexOf(cs.overflowX) !== -1;
    const y = ['auto', 'scroll'].indexOf(cs.overflowY) !== -1;
    if (!x || !y) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.scrollHeight > el.clientHeight + 1) {
      twoWay.push({ tag: el.tagName.toLowerCase(), cls: cls1(el), scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight, isDoc: el === de || el === body });
    }
  }

  function lum(c) {
    const m = String(c).match(/[\d.]+/g);
    if (!m) return null;
    const [r, g, b, a] = m.map(Number);
    if (a !== undefined && a === 0) return null;
    const f = (v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function bgOf(el) {
    let p = el;
    while (p && p !== de.parentElement) {
      const c = CS(p).backgroundColor;
      if (c && c !== 'transparent' && lum(c) !== null) return c;
      p = p.parentElement;
    }
    return 'rgb(255,255,255)';
  }
  function contrast(el) {
    const fg = lum(CS(el).color), bg = lum(bgOf(el));
    if (fg === null || bg === null) return null;
    const hi = Math.max(fg, bg), lo = Math.min(fg, bg);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }
  const contrastSamples = [];
  for (const sel of ['.article p', '.article h2', '.sidebar a', '.toc-side a', '.page-desc', '.side-legend', '.crumbs a', '.article code', '.topbar .brand']) {
    const el = document.querySelector(sel);
    if (!el || !vis(el)) continue;
    const c = contrast(el);
    if (c !== null) contrastSamples.push({ sel, ratio: c, fontSize: parseFloat(CS(el).fontSize), color: CS(el).color });
  }
  const theme = {
    attr: de.getAttribute('data-theme'),
    cls: de.className,
    bodyBg: CS(body).backgroundColor,
    htmlBg: CS(de).backgroundColor,
    colorScheme: CS(de).colorScheme,
    earlyBg: window.__verifyEarlyBg || null,
  };

  /* ---- A4：本页目录 / 等价导航 ---- */
  const tocSideVisible = !!toc && CS(toc).display !== 'none' && toc.getBoundingClientRect().width > 0;
  const tocSideLinks = toc ? Array.from(toc.querySelectorAll('a')).filter((a) => vis(a)).length : 0;
  const tocSideInViewport = !!toc && (() => { const r = toc.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; })();
  const drawerTocVisible = !!drawerToc && CS(drawerToc).display !== 'none' && drawerToc.getBoundingClientRect().height > 0;
  const drawerTocInSidebar = !!(drawerToc && drawerToc.closest && drawerToc.closest('#sidebar, .sidebar, nav.sidebar'));
  const tocProbe = {
    tocSideSel: toc ? desc(toc) : null, tocSideVisible, tocSideLinks, tocSideInViewport,
    tocSideBox: toc ? R(toc) : null,
    drawerTocSel: drawerToc ? desc(drawerToc) : null, drawerTocVisible, drawerTocInSidebar,
    drawerTocBox: drawerToc ? R(drawerToc) : null,
    drawerTocTag: drawerToc ? drawerToc.tagName.toLowerCase() : null,
    drawerTocOpen: drawerToc && drawerToc.tagName === 'DETAILS' ? drawerToc.open : null,
    drawerTocLinksVisible: drawerToc ? Array.from(drawerToc.querySelectorAll('a')).filter((a) => vis(a)).length : 0,
    drawerTocLinksTotal: drawerToc ? drawerToc.querySelectorAll('a').length : 0,
    sidebarPersistent: !!sidebar && (() => { const cs = CS(sidebar); const r = sidebar.getBoundingClientRect(); return cs.position !== 'fixed' && cs.display !== 'none' && r.left >= -1 && r.width > 0; })(),
    sidebarBox: sidebar ? R(sidebar) : null,
    headingCount: document.querySelectorAll('.article h2[id], .article h3[id], .article h4[id]').length,
    headingCountNoId: Array.from(document.querySelectorAll('.article h2, .article h3, .article h4')).filter((h) => !h.id).length,
  };

  /* ---- 无障碍：裁剪祖先双检（F.reach） ---- */
  let reach = null;
  if (F.reach) {
    const bad = [], beyond = [];
    const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])';
    const drawerEl = sidebar;
    const drawerOffscreen = !!drawerEl && drawerEl.getBoundingClientRect().left < -1 && CS(drawerEl).position === 'fixed';
    let tested = 0, skipped = 0;
    for (const el of document.querySelectorAll(sel)) {
      const cs = CS(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (drawerOffscreen && el.closest && el.closest('#sidebar, .sidebar, nav.sidebar')) { skipped++; continue; }
      const clipOf = (() => { const c = clippedBy(el); return c ? desc(c) + '[' + CS(c).overflowX + ']' : null; })();
      if (r.right > de.clientWidth + 1) beyond.push({ ...R(el), tag: el.tagName.toLowerCase(), cls: cls1(el), text: txt(el, 16), clip: clipOf });
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      tested++;
      const cx = Math.round(Math.min(de.clientWidth - 2, Math.max(1, r.left + r.width / 2)));
      const cy = Math.round(Math.min(window.innerHeight - 2, Math.max(1, r.top + r.height / 2)));
      const hit = document.elementFromPoint(cx, cy);
      const ok = hit && (hit === el || (el.contains && el.contains(hit)) || (hit.contains && hit.contains(el)));
      if (!ok) {
        const tolerated = !hit || !!(hit.closest && hit.closest('header, .topbar, .nav-scrim, .lightbox, dialog, #sidebar, .sidebar'));
        if (!tolerated) bad.push({ tag: el.tagName.toLowerCase(), cls: cls1(el), id: el.id || '', text: txt(el, 18), x: cx, y: cy, right: Math.round(r.right), hit: hit ? desc(hit) : null, clip: clipOf });
      }
    }
    reach = { tested, beyond: beyond.slice(0, 12), beyondCount: beyond.length, bad: bad.slice(0, 12), badCount: bad.length, skippedInClosedDrawer: skipped };
  }

  /* ---- 焦点环（F.focus：先由 Node 侧 Tab，再读 activeElement） ---- */
  let focusRing = null;
  if (F.focus) {
    const a = document.activeElement;
    if (a && a !== body) {
      const cs = CS(a);
      focusRing = {
        tag: a.tagName.toLowerCase(), cls: cls1(a), id: a.id || '', text: txt(a, 20),
        outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor, outlineOffset: cs.outlineOffset,
        boxShadow: cs.boxShadow, borderColor: cs.borderColor,
        matchesFocusVisible: (() => { try { return a.matches(':focus-visible'); } catch (e) { return null; } })(),
        matchesFocus: (() => { try { return a.matches(':focus'); } catch (e) { return null; } })(),
        insideDrawer: !!(a.closest && a.closest('#sidebar, .sidebar, nav.sidebar')),
      };
    }
  }

  return {
    url: location.href,
    title: document.title,
    docW: de.clientWidth, docScrollW: de.scrollWidth, overflow,
    innerWidth: window.innerWidth,
    vpExpanded: window.innerWidth > de.clientWidth + 1,
    offenders: realOffenders, benignOffenders, leftwardCount: leftwardOnly.length,
    clippedExplainedCount: clippedExplained.length, clippedExplained: clippedExplained.slice(0, 6),
    clippedUnexplained: unexplained, clippedUnexplainedCount: clippedUnexplained.length, clippedWideCount: clippedExplained.length + clippedUnexplained.length,
    headerH, headerPos: header ? CS(header).position : null, headerBox,
    menuBtn: menuBtn ? { exists: true, ...R(menuBtn), visible: vis(menuBtn), display: CS(menuBtn).display, ariaExpanded: menuBtn.getAttribute('aria-expanded'), ariaControls: menuBtn.getAttribute('aria-controls'), ariaLabel: menuBtn.getAttribute('aria-label'), text: txt(menuBtn, 6) } : { exists: false },
    drawer: drawer ? { exists: true, sel: desc(drawer), ...R(drawer), visible: vis(drawer), display: CS(drawer).display, transform: CS(drawer).transform, position: CS(drawer).position, overflowY: CS(drawer).overflowY, overscroll: CS(drawer).overscrollBehavior, inert: drawer.hasAttribute('inert') || drawer.inert === true, ariaHidden: drawer.getAttribute('aria-hidden'), scrollH: drawer.scrollHeight, clientH: drawer.clientHeight, scrollTop: drawer.scrollTop } : { exists: false },
    scrim: scrim ? { exists: true, sel: desc(scrim), visible: vis(scrim), ...R(scrim), position: CS(scrim).position, opacity: CS(scrim).opacity, visibility: CS(scrim).visibility, pointerEvents: CS(scrim).pointerEvents } : { exists: false },
    bodyOverflow: CS(body).overflow, bodyOverflowY: CS(body).overflowY, htmlOverflow: CS(de).overflow, bodyClasses: body.className,
    bodyPos: CS(body).position, bodyScrollbarGutter: CS(body).scrollbarGutter,
    scrollY: Math.round(window.scrollY), docScrollH: de.scrollHeight,
    sidebar: sidebar ? { exists: true, ...R(sidebar), display: CS(sidebar).display, position: CS(sidebar).position, visible: vis(sidebar), gridColumn: layout ? CS(layout).gridTemplateColumns : null, transform: CS(sidebar).transform, inert: sidebar.hasAttribute('inert'), overflowY: CS(sidebar).overflowY, maxHeight: CS(sidebar).maxHeight } : { exists: false },
    toc: toc ? { exists: true, ...R(toc), display: CS(toc).display, visible: vis(toc), position: CS(toc).position, width: Math.round(toc.getBoundingClientRect().width), links: tocSideLinks } : { exists: false },
    tocProbe,
    layout: layout ? { cols: CS(layout).gridTemplateColumns, display: CS(layout).display } : null,
    content: (() => { const c = document.querySelector('.content, main, article'); return c ? { ...R(c), maxWidth: CS(c).maxWidth, padding: CS(c).padding } : null; })(),
    article: (() => { const a = document.querySelector('article.article, article'); return a ? { ...R(a), maxWidth: CS(a).maxWidth } : null; })(),
    topbarControls, inputs, navRows, navRowMin: navRows.length ? Math.min(...navRows.map((r) => r.h)) : null,
    brand: (() => {
      const b = document.querySelector('a.brand, .brand');
      const name = document.querySelector('.brand-name');
      if (!b && !name) return null;
      const rb = b ? b.getBoundingClientRect() : null;
      const rn = name ? name.getBoundingClientRect() : null;
      return {
        brandSel: desc(b) || null, brandW: rb ? Math.round(rb.width) : null, brandH: rb ? Math.round(rb.height) : null,
        brandScrollW: b ? b.scrollWidth : null, brandClientW: b ? b.clientWidth : null,
        nameSel: desc(name) || null, nameW: rn ? Math.round(rn.width) : null,
        truncated: name ? name.scrollWidth > name.clientWidth + 1 : (b ? b.scrollWidth > b.clientWidth + 1 : null),
      };
    })(),
    secSwitchVisible: Array.from(document.querySelectorAll('.sec-switch a')).filter((a) => vis(a)).length,
    sideSecsVisible: Array.from(document.querySelectorAll('#sidebar .side-secs a, .sidebar .side-secs a')).filter((a) => vis(a)).length,
    preCount: pres.length,
    preScrollableCount: preInfo.filter((p) => p.scrollable).length,
    preNeedingScroll: preInfo.filter((p) => p.needsScroll).length,
    preFocusableCount: preInfo.filter((p) => p.containerTabindex2 && p.containerTabindex2.tabindex === '0').length,
    preList: preInfo.slice(0, 60),
    tableCount: tables.length,
    tableScrollerCount: tableInfo.filter((t) => t.scroller).length,
    tablesWrappedCount: tableInfo.filter((t) => t.scroller).length,
    tableNeedingScroll: tableInfo.filter((t) => t.needsScroll).length,
    tableList: tableInfo.slice(0, 60),
    twoWay, reach, focusRing,
    contrastSamples, theme,
    scrollBehavior: CS(de).scrollBehavior,
    scrollPaddingTop: CS(de).scrollPaddingTop,
    scrollPaddingTopPx: parseFloat(CS(de).scrollPaddingTop) || 0,
    headingScrollMargin: (() => { const h = document.querySelector('.article h2[id], .article h3[id], .article h1'); return h ? parseFloat(CS(h).scrollMarginTop) || 0 : 0; })(),
    transitionDuration: (() => { const d = document.querySelector('.nav-scrim'); return d ? CS(d).transitionDuration : null; })(),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    building: window.__verifyBuilding || null,
    scripts: Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')),
    searchIndexLoaded: !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages && window.__LIBRARY_SEARCH__.pages.length),
    searchIndexPages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages) ? window.__LIBRARY_SEARCH__.pages.length : 0,
    topbarVar: CS(de).getPropertyValue('--topbar-h'),
  };
};

/* ───────────────────────── 浏览器工具 ───────────────────────── */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const exe = browserPath();
  if (!exe) throw new Error('no chrome/chromium found (set CHROME_PATH)');
  return chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
}

async function withCtx(browser, vp, fn, opts) {
  const o = opts || {};
  const mobile = o.mobile !== undefined ? o.mobile : vp.w < 768;
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: o.colorScheme || 'light',
    reducedMotion: o.reducedMotion || 'no-preference',
  });
  const page = await ctx.newPage();
  try { return await fn(page); } finally { await ctx.close().catch(() => {}); }
}

async function go(page, url, w) {
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(w === undefined ? 80 : w);
}

const u = (p) => BASE + p;
const uPre = (p) => PRE_BASE + p;
const fileUrl = (p) => 'file:///' + path.join(REPO, p.replace(/^\//, '')).split(path.sep).join('/').replace(/ /g, '%20');

async function probe(page, flags) { return page.evaluate(PROBE, flags || {}); }
async function probeAt(page, vp, flags) { const r = await page.evaluate(PROBE, flags || {}); return { ...r, vp: vp.name }; }

/** 打开移动抽屉（点击 ☰） */
async function openDrawer(page) {
  const before = await page.evaluate(() => { const b = document.querySelector('#nav-toggle, .sidebar-toggle, #menu-btn, .menu-toggle, header button[aria-controls]'); return b ? (b.getAttribute('aria-expanded') || '') : null; });
  await page.click(OPEN_SEL, { timeout: 5000 }).catch(async () => {
    await page.evaluate(() => { const b = document.querySelector('#nav-toggle, .sidebar-toggle, header button'); if (b) b.click(); });
  });
  await page.waitForTimeout(before === null ? 420 : 520);
  return before;
}
async function closeDrawer(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(440);
}

/** 真实滚轮（红队证明 window.scrollBy 在 overflow:hidden 下仍会成功，会误报） */
async function wheelDelta(page, dy, at) {
  const before = await page.evaluate(() => Math.round(window.scrollY));
  if (at) await page.mouse.move(at.x, at.y);
  else await page.mouse.move(Math.round((await page.evaluate(() => document.documentElement.clientWidth)) / 2), 300);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(280);
  const after = await page.evaluate(() => Math.round(window.scrollY));
  return { before, after, delta: after - before };
}

/** 探测某 URL 是否可用（判断改前实例是否在跑）；不用 fetch，避免 Node 版本差异 */
function httpOk(url) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = http.request(url, { method: 'GET', timeout: 2500 }, (res) => { res.resume(); finish(res.statusCode >= 200 && res.statusCode < 400); });
      req.on('error', () => finish(false));
      req.on('timeout', () => { req.destroy(); finish(false); });
      req.end();
    } catch (e) { finish(false); }
  });
}

/* ───────────────────────── A3 抽样（确定性：长代码 + 多表格） ───────────────────────── */

function longPagesSample() {
  const rows = [];
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'index.html' && /(paper|velocity|folia)[\\/]/.test(p)) {
        let t = '';
        try { t = fs.readFileSync(p, 'utf8'); } catch { return; }
        let maxline = 0;
        const re = /<pre[^>]*>([\s\S]*?)<\/pre>/g;
        let m;
        while ((m = re.exec(t))) for (const l of m[1].split('\n')) if (l.length > maxline) maxline = l.length;
        rows.push({
          page: '/' + path.relative(REPO, p).split(path.sep).join('/').replace(/index\.html$/, ''),
          maxline, pres: (t.match(/<pre\b/g) || []).length, tables: (t.match(/<table\b/g) || []).length,
        });
      }
    }
  };
  walk(path.join(REPO, 'paper'));
  walk(path.join(REPO, 'velocity'));
  walk(path.join(REPO, 'folia'));
  const byLine = rows.slice().sort((a, b) => b.maxline - a.maxline || b.pres - a.pres);
  const byTable = rows.slice().sort((a, b) => b.tables - a.tables || b.maxline - a.maxline);
  const out = A3_REQUIRED.slice();
  const picked = [];
  for (const r of byLine.concat(byTable)) {
    if (out.length >= 20) break;
    if (out.indexOf(r.page) === -1 && PAGES10.indexOf(r.page) === -1) { out.push(r.page); picked.push({ page: r.page, maxline: r.maxline, pres: r.pres, tables: r.tables }); }
  }
  return {
    pages: out, candidates: rows.length, picked,
    rule: '确定性抽样：A3 点名且实盘存在的 8 页 → 再按「最长 <pre> 行长度」降序 + 「表格数」降序补齐到 20 页，排除 A1 的 10 页',
  };
}

/* ───────────────────────── 检查项 ───────────────────────── */

const CHECKS = [];
const check = (id, item, key, title, assertion, run) => CHECKS.push({ id, item, key, title, assertion, run });

/* ───────────────────────── 离线搜索复算器（独立恢复自 tools/site/assets.js 的 SITE_JS；权重/别名分档/短语 ×0.6/二字片段 ×0.45/同分链 o 升序 均按源码逐行标注） ───────────────────────── */

/* =============================================================================
 * rank-offline.js — 站内搜索「精确匹配 + 排序」算法的自包含离线复算实现
 *
 * 与 papermc-docs/assets/site.js（源：tools/site/assets.js 的 SITE_JS 模板）里的运行期
 * 搜索代码逐条等价。行号引用均为 tools/site/assets.js 中的行号（SITE_JS 模板体内）。
 *
 * 用法：
 *   const { rankOffline } = require('./rank-offline.js');
 *   const index = JSON.parse(fs.readFileSync('search-index.json', 'utf8'));
 *   rankOffline(index, '插件');   // -> [{ id, p, t, score }, ...] 按站内 UI 顺序（前 40 条）
 *   rankOfflineAll(index, '插件');// -> 同一顺序但不截断（对账 UI 的「共 N 个结果」）
 *
 * 纯函数：不依赖 DOM / window / 站内任何代码；入参为已 JSON.parse 的索引对象。
 * ========================================================================== */

function rankOfflineCore(index, query) {
  /* ---- 索引读取：assets.js:822-825（INDEX / ALIASES / PHRASE_BY_Q） ---- */
  var ALIASES = (index && index.aliases) || {};                       // assets.js:823
  var PHRASE_BY_Q = {};
  ((index && index.phrases) || []).forEach(function (p) { PHRASE_BY_Q[p.q] = p; });  // assets.js:824-825
  var INDEX = (index && index.pages) || [];                           // assets.js:822

  /* ---- A. 查询规范化：assets.js:1079 + 1095 ---- */
  var q0 = (query === undefined || query === null) ? '' : String(query);
  var queryNorm = q0.trim().toLowerCase();                            // assets.js:1079 q.trim().toLowerCase()
  var terms = queryNorm.split(/\s+/).filter(Boolean);                 // assets.js:1095 空白切分 + 丢弃空串
  if (!terms.length) return [];                                       // assets.js:1090-1094 空查询 → 无结果
  /* 无最小长度、无截断、无标点剥离；大小写只有 toLowerCase（不做 NFKC / 去空格 / 同义词） */

  /* ---- 预处理：assets.js:826（CJK 判据）、828（norm）、831-833（真实小节标题） ---- */
  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;  // assets.js:826
  function norm(s) { return String(s || '').toLowerCase(); }                        // assets.js:828
  function headingText(e) {
    return norm((e.h || []).filter(function (x) {
      return String(x).indexOf('关键词：') !== 0;                                     // assets.js:832 去掉派生“关键词：”行
    }).join(' \u0001 '));                                                          // assets.js:832 以 \u0001 连接
  }

  /* ---- 每条目的小写副本缓存：assets.js:837-854（WeakMap，内容与站内一致） ---- */
  var LC = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function lc(e) {
    var c = LC ? LC.get(e) : null;
    if (c) return c;
    var kw = e.kw || [];
    var lkw = [];
    for (var i = 0; i < kw.length; i++) lkw.push(norm(kw[i]));         // assets.js:842-843
    c = {
      t: norm(e.t),                                                    // assets.js:845
      u: norm(e.u),                                                    // assets.js:845
      h: headingText(e),                                               // assets.js:846
      c: norm((e.c || '') + ' ' + (e.cd || '')),                       // assets.js:847 分类名 + 空格 + 分类描述
      x: norm(e.x),                                                    // assets.js:848 正文
      m: norm([e.u, kw.join(' '), e.c, e.cd, e.lt].join(' \u0001 ')),   // assets.js:849 元字段（不含标题！）
      kw: lkw                                                          // assets.js:850
    };
    if (LC) LC.set(e, c);
    return c;
  }

  /* ---- B1. 单字段直接打分：assets.js:914-949 ---- */
  function directScore(e, q) {
    var out = { s: 0, fields: [], body: false, tier: 0 };              // assets.js:915
    var l = lc(e);
    var title = l.t, sum = l.u, heads = l.h, cat = l.c;
    var tags = e.kw || [];
    if (title.indexOf(q) === 0) { out.s += 60; out.tier = 4; }         // assets.js:922 标题前缀 +60
    else if (title.indexOf(q) !== -1) { out.s += 30; out.tier = 4; }   // assets.js:923 标题子串 +30
    for (var i = 0; i < tags.length; i++) {
      var tg = l.kw[i];
      if (!tg) continue;
      if (tg === q) out.s += 32 + Math.max(0, 8 - i * 3);              // assets.js:927 标签全等 32+序位(8-3i)
      else if (tg.indexOf(q) !== -1) out.s += 20 + Math.max(0, 6 - i * 2); // assets.js:928 标签子串 20+序位(6-2i)
      if (tg === q || tg.indexOf(q) !== -1) out.tier = Math.max(out.tier, 2);
    }
    if (sum.indexOf(q) !== -1) { out.s += 18; out.tier = Math.max(out.tier, 2); }   // assets.js:930 摘要 +18
    if (heads.indexOf(q) !== -1) { out.s += 12; out.tier = Math.max(out.tier, 3); } // assets.js:931 小节 +12
    if (cat.indexOf(q) !== -1) { out.s += 8; out.tier = Math.max(out.tier, 2); }    // assets.js:932 分类 +8
    if (bodyIndexOf(e, q) !== -1) { out.s += 5; out.body = true; out.tier = Math.max(out.tier, 1); } // assets.js:933 正文 +5
    /* 英文/拉丁别名分档：assets.js:935-947（只加一档，命中即止；与字面分叠加） */
    var al = ALIASES[q];
    if (al && al.length) {
      var has = function (hay) {
        for (var j = 0; j < al.length; j++) if (hay.indexOf(al[j]) !== -1) return al[j];
        return '';
      };
      var tok = '';
      if ((tok = has(title))) { out.s += 26; out.tier = 4; }                          // assets.js:942 标题别名 +26
      else if ((tok = has(heads))) { out.s += 18; out.tier = Math.max(out.tier, 3); }  // assets.js:943 小节别名 +18
      else if ((tok = has(l.m))) { out.s += 10; out.tier = Math.max(out.tier, 2); }    // assets.js:944-945 摘要/标签/分类/lt +10
      else if (hasBodyAlias(e, al)) { out.s += 2; out.body = true; out.tier = Math.max(out.tier, 1); } // assets.js:946 正文别名 +2
    }
    return out;
  }

  /* ---- 正文命中：assets.js:889-898（站内的位图预筛只去假阳性，命中集合/分数不变） ---- */
  var BODY_IDX = new Map();
  function bodyIndexOf(e, term) {
    if (!term) return -1;                                             // assets.js:890
    var m = BODY_IDX.get(term);
    if (!m) { m = new Map(); BODY_IDX.set(term, m); }
    if (m.has(e)) return m.get(e);
    var x = lc(e).x;
    var idx = x ? x.indexOf(term) : -1;                               // assets.js:895 纯 indexOf
    m.set(e, idx);
    return idx;
  }
  function hasBodyAlias(e, al) {                                      // assets.js:899-902
    for (var i = 0; i < al.length; i++) if (al[i] && bodyIndexOf(e, al[i]) !== -1) return true;
    return false;
  }

  /* ---- B2. 短语子项打分：assets.js:972-992 ---- */
  function partScore(e, part) {
    var r = directScore(e, part);
    if (r.s > 0) return r;                                            // assets.js:974 字面优先
    var al = ALIASES[part];
    if (al && al.length) {                                            // assets.js:976-990 别名四档
      var l = lc(e), title = l.t, heads = l.h, x = l.x, meta = l.m;
      var hit = function (hay) {
        for (var i = 0; i < al.length; i++) if (hay.indexOf(al[i]) !== -1) return al[i];
        return '';
      };
      var tok = '';
      if ((tok = hit(title))) return { s: 26, fields: ['标题别名 ' + tok], body: false, tier: 4 };
      if ((tok = hit(heads))) return { s: 18, fields: ['小节别名 ' + tok], body: false, tier: 3 };
      if ((tok = hit(meta))) return { s: 10, fields: ['摘要/标签别名 ' + tok], body: false, tier: 2 };
      for (var bi = 0; bi < al.length; bi++) if (al[bi] && bodyIndexOf(e, al[bi]) !== -1) return { s: 2, fields: ['正文'], body: true, tier: 1 };
    }
    return { s: 0, fields: [], body: false, tier: 0 };                // assets.js:991
  }

  /* ---- B3. 单词打分（含两级中文回退）：assets.js:994-1029 ---- */
  function bigrams(s) {                                               // assets.js:965-969
    var g = [];
    for (var i = 0; i + 1 < s.length; i++) g.push(s.substr(i, 2));
    return g;
  }
  function termScore(e, q) {
    var r = directScore(e, q);
    if (r.s > 0) return { s: r.s, fields: r.fields, body: r.body, tier: r.tier, fuzzy: false }; // assets.js:996 直接命中即返回（不叠加回退）
    var ph = PHRASE_BY_Q[q];                                          // assets.js:998 受控短语表
    if (ph) {
      var ptotal = 0, pbody = false, ptier = 0;
      for (var p = 0; p < ph.parts.length; p++) {
        var pr = partScore(e, ph.parts[p]);
        if (!pr.s) { ptotal = 0; break; }                             // assets.js:1006 任一部分不匹配 → 视为整体不匹配
        ptotal += pr.s;
        ptier = Math.max(ptier, pr.tier || 0);
        if (pr.body) pbody = true;
      }
      if (ptotal > 0) return { s: Math.round(ptotal * 0.6), fields: [], body: pbody, tier: ptier, fuzzy: true }; // assets.js:1012 x0.6
    }
    if (q.length >= 3 && CJK.test(q)) {                               // assets.js:1014 全部二字片段必须直接命中
      var gs = bigrams(q);
      var total = 0, tier = 0;
      for (var i = 0; i < gs.length; i++) {
        var gr = directScore(e, gs[i]);                               // assets.js:1020 只用 directScore（不含短语表）
        if (gr.s <= 0) return { s: 0, fields: [], body: false, tier: 0, fuzzy: false }; // assets.js:1021
        total += gr.s;
        tier = Math.max(tier, gr.tier || 0);
      }
      if (total > 0) return { s: Math.round(total * 0.45), fields: [], body: true, tier: tier, fuzzy: true }; // assets.js:1026 x0.45，body 强制 true
    }
    return { s: 0, fields: [], body: false, tier: 0, fuzzy: false };   // assets.js:1028
  }

  /* ---- C1. 多词（空白切分）AND 合并：assets.js:1031-1045 ---- */
  function score(e, termList) {
    var total = 0, body = false, tier = 0;
    for (var i = 0; i < termList.length; i++) {
      var r = termScore(e, termList[i]);
      if (!r.s) return null;                                          // assets.js:1038 任一 term 不得分 → 整条淘汰
      total += r.s;
      if (r.body) body = true;
      tier = Math.max(tier, r.tier || 0);
    }
    return { s: total, body: body, tier: tier };
  }

  /* ---- C2. 同分排序键：assets.js:952-963 ---- */
  function compareHits(a, b) {
    if (b.s !== a.s) return b.s - a.s;                                             // 分数降序
    if ((b.tier || 0) !== (a.tier || 0)) return (b.tier || 0) - (a.tier || 0);     // tier 降序
    var ao = typeof a.e.o === 'number' ? a.e.o : 1e9;                              // o 升序（缺省视为 1e9）
    var bo = typeof b.e.o === 'number' ? b.e.o : 1e9;
    if (ao !== bo) return ao - bo;
    var at = String(a.e.t || ''), bt = String(b.e.t || '');
    if (at.length !== bt.length) return at.length - bt.length;                     // 标题短者优先
    var c = at.localeCompare(bt, 'zh-Hans-CN');                                    // 标题 localeCompare
    if (c !== 0) return c;
    return String(a.e.id || '').localeCompare(String(b.e.id || ''));               // id localeCompare
  }

  /* ---- 主流程：assets.js:1093-1101 ---- */
  var hits = [];
  for (var i = 0; i < INDEX.length; i++) {
    var r = score(INDEX[i], terms);
    if (r && r.s > 0) hits.push({ e: INDEX[i], s: r.s, tier: r.tier });  // assets.js:1098-1099 阈值：score > 0
  }
  hits.sort(compareHits);                                               // assets.js:1101
  /* hits: [{ e: 索引条目, s: 分数, tier: 层级 }]，按站内 UI 顺序；未截断 */
  return hits;
}

/** 与站内 UI 完全一致的入口：score>0 → 排序 → 取前 40 → 只保留 {id,p,t,score} */
var MAX_RESULTS = 40;                                                   // assets.js:1073 返回条数上限
function rankOffline(index, query) {
  var hits = rankOfflineCore(index, query);                             // assets.js:1097-1101
  var max = Math.min(hits.length, MAX_RESULTS);                         // assets.js:1108
  var out = [];
  for (var k = 0; k < max; k++) {
    out.push({ id: hits[k].e.id, p: hits[k].e.p, t: hits[k].e.t, score: hits[k].s });
  }
  return out;
}

/* 诊断用：不截断的全量命中（用于与 UI 的「共 N 个结果」计数对账）。
   返回 [{ id, p, t, score, tier, o }]，顺序与 rankOffline / UI 一致（只多了尾部条目）。 */
function rankOfflineAll(index, query) {
  var all = rankOfflineCore(index, query);
  return all.map(function (h) {
    return { id: h.e.id, p: h.e.p, t: h.e.t, score: h.s, tier: h.tier, o: h.e.o };
  });
}


/* ───────────────────────── 搜索 / 交互 小工具 ───────────────────────── */

const READ_RESULTS = () => {
  const res = document.querySelector('#search-results');
  const c = document.querySelector('#search-count');
  const items = res ? Array.from(res.querySelectorAll('li a[href]')).map((a) => ({ href: a.getAttribute('href'), t: (a.querySelector('.sr-ttl') || a).textContent.trim().slice(0, 40) })) : [];
  const d = document.querySelector('#search-dialog');
  return { open: d ? !!d.open : null, count: items.length, countText: c ? c.textContent.trim() : null, items };
};

async function openSearch(page) {
  const isOpen = () => page.evaluate(() => { const d = document.querySelector('#search-dialog'); return !!(d && d.open); });
  if (await isOpen()) return 'already';
  // 1) 可见按钮点击（真实用户路径）
  const clicked = await page.click('button[data-open-search], [data-open-search]', { timeout: 3000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(320);
  if (clicked && await isOpen()) return 'click[data-open-search]';
  // 2) Ctrl+K
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(320);
  if (await isOpen()) return 'ctrl+K';
  // 3) JS 点击
  await page.evaluate(() => { const b = document.querySelector('[data-open-search]'); if (b) b.click(); });
  await page.waitForTimeout(320);
  if (await isOpen()) return 'js-click';
  // 4) 强制 showModal（记录为非用户路径，仅用于取数）
  await page.evaluate(() => { const d = document.querySelector('#search-dialog'); if (d && !d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } } });
  await page.waitForTimeout(220);
  return 'forced-showModal';
}

async function typeQuery(page, q) {
  let ok = await page.fill('#search-input', q, { timeout: 2500 }).then(() => true).catch(() => false);
  if (!ok) {
    await page.evaluate((v) => { const i = document.querySelector('#search-input'); if (i) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } }, q);
  }
  await page.waitForTimeout(700);
  const cur = await page.evaluate(() => { const i = document.querySelector('#search-input'); return i ? i.value : null; });
  return cur;
}

/** 侧栏过滤框：输入后统计可见 data-search 链接数 */
const SIDE_LINKS = () => {
  const all = Array.from(document.querySelectorAll('#sidebar a[data-search], .sidebar a[data-search]'));
  const vis = all.filter((a) => { const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && !(a.closest('li') && a.closest('li').hidden); });
  return { total: all.length, visible: vis.length };
};

/* ───────────────────────── 双实例快照（零回归对打的唯一数据源） ───────────────────────── */

const PICK = (m) => ({
  overflow: m.overflow, innerWidth: m.innerWidth, docW: m.docW,
  hasMenuButton: !!(m.menuBtn.exists && m.menuBtn.visible),
  menuBtn: m.menuBtn.exists ? { w: m.menuBtn.w, h: m.menuBtn.h, display: m.menuBtn.display, ariaExpanded: m.menuBtn.ariaExpanded } : null,
  navRowMin: m.navRowMin, navRowCount: m.navRows.length,
  tocVisible: !!(m.toc.exists && m.toc.visible), tocDisplay: m.toc.display || null, tocW: m.toc ? m.toc.w : null,
  tocSideVisible: m.tocProbe.tocSideVisible, drawerTocVisible: m.tocProbe.drawerTocVisible, drawerTocInSidebar: m.tocProbe.drawerTocInSidebar,
  headerH: m.headerH, headerScrollW: m.headerBox ? m.headerBox.scrollW : null, headerClientW: m.headerBox ? m.headerBox.clientW : null,
  sidebarDisplay: m.sidebar.display || null, sidebarW: m.sidebar.w || null, sidebarPos: m.sidebar.position || null,
  sidebarVisible: !!(m.sidebar.exists && m.sidebar.visible), sidebarInert: m.sidebar.exists ? m.sidebar.inert : null,
  layoutCols: m.layout ? m.layout.cols : null,
  contentX: m.content ? m.content.x : null, contentW: m.content ? m.content.w : null,
  inputFonts: m.inputs.filter((i) => i.visible).map((i) => i.cls + ':' + i.fontSize).join(','),
  inputCount: m.inputs.filter((i) => i.visible).length,
  preCount: m.preCount, preScrollable: m.preScrollableCount, preFocusable: m.preFocusableCount,
  tableCount: m.tableCount, tableScroller: m.tableScrollerCount,
  scrollPaddingTop: m.scrollPaddingTop, topbarVar: m.topbarVar,
  offenders: m.offenders.length, clippedUnexplained: m.clippedUnexplainedCount,
  brandW: m.brand ? m.brand.brandW : null, brandNameW: m.brand ? m.brand.nameW : null, brandTruncated: m.brand ? m.brand.truncated : null,
  secSwitchVisible: m.secSwitchVisible, sideSecsVisible: m.sideSecsVisible,
});

/** 同一探针打两个实例（post=u(p) / pre=uPre(p)），结果缓存在 ctx.dual */
async function dualSnapshot(ctx, vp, paths) {
  if (!ctx.dual) ctx.dual = {};
  if (ctx.dual[vp.name]) return ctx.dual[vp.name];
  const rec = { viewport: vp.name, vp, pages: paths.slice(), post: {}, pre: null, pre_available: !!ctx.pre };
  await withCtx(ctx.browser, vp, async (page) => {
    for (const p of paths) {
      await go(page, u(p));
      rec.post[p] = PICK(await probe(page));
      if (ctx.pre) {
        await go(page, uPre(p));
        rec.pre = rec.pre || {};
        rec.pre[p] = PICK(await probe(page));
      }
    }
  });
  ctx.dual[vp.name] = rec;
  return rec;
}

/* ───────────────────────── 检查项 ───────────────────────── */

/* ── 1 / item 1：A1 溢出（双实例） ── */
check(1, 1, 'A1', '溢出：320/360/390/414 × 10 页（40 组合）+ 改前→改后对照', '改后 40 组合 scrollWidth-clientWidth <= 1；列出改前实例逐格对照', async (ctx) => {
  const rows = [], preRows = [];
  for (const vp of VP_MOBILE) {
    await withCtx(ctx.browser, vp, async (page) => {
      for (const p of PAGES10) {
        await go(page, u(p));
        const m = await probe(page);
        rows.push({ viewport: vp.name, page: p, overflow: m.overflow, docW: m.docW, scrollW: m.docScrollW, innerWidth: m.innerWidth, vpExpanded: m.vpExpanded, offenders: m.offenders.length, preCount: m.preCount, preScrollableCount: m.preScrollableCount });
      }
      if (ctx.pre) {
        for (const p of PAGES10) {
          await go(page, uPre(p));
          const m = await probe(page);
          preRows.push({ viewport: vp.name, page: p, overflow: m.overflow, docW: m.docW, innerWidth: m.innerWidth, vpExpanded: m.vpExpanded });
        }
      }
    });
    ctx.log('    A1 ' + vp.name + ' done');
  }
  const bad = rows.filter((r) => r.overflow > 1);
  const perVp = VP_MOBILE.map((vp) => {
    const rs = rows.filter((r) => r.viewport === vp.name);
    const ps = preRows.filter((r) => r.viewport === vp.name);
    return {
      viewport: vp.name, n: rs.length, bad: rs.filter((r) => r.overflow > 1).length,
      now_min: Math.min(...rs.map((r) => r.overflow)), now_max: Math.max(...rs.map((r) => r.overflow)),
      pre_min: ps.length ? Math.min(...ps.map((r) => r.overflow)) : null,
      pre_max: ps.length ? Math.max(...ps.map((r) => r.overflow)) : null,
      pre_bad: ps.length ? ps.filter((r) => r.overflow > 1).length : null,
      pre_innerWidth_max: ps.length ? Math.max(...ps.map((r) => r.innerWidth)) : null,
      now_innerWidth_max: Math.max(...rs.map((r) => r.innerWidth)),
    };
  });
  let baselineJson = null;
  try {
    const b = JSON.parse(fs.readFileSync(path.join(REPO, 'reports/mobile-measure-baseline.json'), 'utf8'));
    baselineJson = VP_MOBILE.map((vp) => {
      const rs = b.results.filter((x) => x.viewport === vp.name);
      return { viewport: vp.name, min: Math.min(...rs.map((x) => x.overflow)), max: Math.max(...rs.map((x) => x.overflow)), bad: rs.filter((x) => x.overflow > 1).length };
    });
  } catch { baselineJson = null; }
  return {
    verdict: bad.length === 0 ? 'pass' : 'fail',
    metrics: {
      combos: rows.length, bad: bad.length, perVp, rows, preRows,
      baseline_json: baselineJson,
      pre_instance: ctx.pre ? PRE_BASE : null,
      viewport_expansion: { now: rows.some((r) => r.vpExpanded), pre: preRows.some((r) => r.vpExpanded) },
    },
    failures: bad.map((r) => `${r.viewport} ${r.page} overflow=${r.overflow}`),
    repro: 'node tools/verify-mobile.js --check=1',
    notes: '改前列取自改前实例 ' + PRE_BASE + '（同一探针、同一脚本、逐格对打）；reports/mobile-measure-baseline.json 作为第三方来源并列',
  };
});

/* ── 2 / item 2：A2 offenders（clipped-aware 口径） ── */
check(2, 2, 'A2', '真实撑宽元素（clipped-aware 口径）', 'offenders = 0 且 clippedUnexplained = 0；a.skip 单列 benign', async (ctx) => {
  const pages = PAGES10.concat(ctx.a3().pages.filter((p) => PAGES10.indexOf(p) === -1).slice(0, 10));
  const vps = [{ name: '320x568', w: 320, h: 568 }, { name: '390x844', w: 390, h: 844 }];
  const rows = [];
  for (const vp of vps) {
    await withCtx(ctx.browser, vp, async (page) => {
      for (const p of pages) {
        await go(page, u(p));
        const m = await probe(page);
        rows.push({
          viewport: vp.name, page: p, overflow: m.overflow,
          offenders: m.offenders, benign: m.benignOffenders, leftwardCount: m.leftwardCount,
          clippedExplainedCount: m.clippedExplainedCount, clippedExplained: m.clippedExplained,
          clippedUnexplained: m.clippedUnexplained, clippedUnexplainedCount: m.clippedUnexplainedCount,
        });
      }
    });
  }
  const withOff = rows.filter((r) => r.offenders.length);
  const withUnexplained = rows.filter((r) => r.clippedUnexplainedCount > 0);
  const kinds = {}, benignKinds = {}, explainedKinds = {};
  for (const r of rows) {
    for (const o of r.offenders) kinds[o.tag + '.' + (o.cls || '')] = (kinds[o.tag + '.' + (o.cls || '')] || 0) + 1;
    for (const o of r.benign) benignKinds[o.tag + '.' + (o.cls || '') + ' (' + o.reason + ')'] = (benignKinds[o.tag + '.' + (o.cls || '') + ' (' + o.reason + ')'] || 0) + 1;
    for (const o of r.clippedExplained) explainedKinds[(o.legit || '?')] = (explainedKinds[(o.legit || '?')] || 0) + 1;
  }
  const fails = [];
  if (withOff.length) fails.push('未裁剪 offender：' + withOff.slice(0, 6).map((r) => `${r.viewport} ${r.page}: ` + r.offenders.slice(0, 2).map((o) => `${o.tag}.${o.cls} w=${o.w} right=${o.right} parent=${o.parentChain}`).join(' ; ')).join(' | '));
  if (withUnexplained.length) fails.push('被 hidden/clip 祖先藏起来的越界元素（刷绿嫌疑）：' + withUnexplained.slice(0, 6).map((r) => `${r.viewport} ${r.page}: ` + r.clippedUnexplained.slice(0, 2).map((o) => `${o.tag}.${o.cls} right=${o.right} clippedBy=${o.clippedBy}`).join(' ; ')).join(' | '));
  return {
    verdict: fails.length === 0 ? 'pass' : 'fail',
    metrics: {
      pages: pages.length, combos: rows.length, combosWithOffenders: withOff.length,
      offenderKinds: kinds, benignKinds, clippedExplainedKinds: explainedKinds,
      unexplainedCombos: withUnexplained.length,
      rows: rows.filter((r) => r.offenders.length || r.clippedUnexplainedCount).slice(0, 12),
      sampleBenign: rows.find((r) => r.benign.length) ? rows.find((r) => r.benign.length).benign.slice(0, 3) : [],
    },
    failures: fails,
    repro: 'node tools/verify-mobile.js --check=2',
    notes: '口径：offender = right > clientWidth+1 且向上无任何 overflow-x auto|scroll|hidden|clip 祖先；'
      + 'clippedExplained = 越界但被白名单滚动容器（.code-scroll/.code-pre/.table-wrap/.sidebar…）裁掉；'
      + 'clippedUnexplained = 被 hidden/clip 祖先藏起来而祖先不在白名单（防 html,body{overflow-x:clip} 刷绿）；'
      + 'a.skip 的 left:-9999 属 LTR 负向左溢出（不进可滚动溢出区）→ benignOffenders 单列',
  };
});

/* ── 3 / item 3：A3 另抽 20 页 ── */
check(3, 3, 'A3', '溢出：另抽 20 页正文 @320/390', '320 与 390px 下 scrollWidth - clientWidth <= 1', async (ctx) => {
  const sample = ctx.a3();
  const rows = [];
  for (const vp of [{ name: '320x568', w: 320, h: 568 }, { name: '390x844', w: 390, h: 844 }]) {
    await withCtx(ctx.browser, vp, async (page) => {
      for (const p of sample.pages) {
        try {
          await go(page, u(p));
          const m = await probe(page);
          rows.push({ viewport: vp.name, page: p, overflow: m.overflow, docW: m.docW, scrollW: m.docScrollW, preCount: m.preCount, preScrollableCount: m.preScrollableCount, tableCount: m.tableCount, offenders: m.offenders.slice(0, 5) });
        } catch (e) { rows.push({ viewport: vp.name, page: p, error: String(e.message).slice(0, 120) }); }
      }
    });
  }
  const bad = rows.filter((r) => r.overflow !== undefined && r.overflow > 1);
  const errs = rows.filter((r) => r.error);
  return {
    verdict: bad.length === 0 && errs.length === 0 ? 'pass' : 'fail',
    metrics: {
      sampleSize: sample.pages.length, pages: sample.pages, candidates: sample.candidates, rule: sample.rule, picked: sample.picked,
      requiredSubstitution: A3_REQUIRED_SUBSTITUTION,
      combos: rows.length, bad: bad.length, errs: errs.length,
      maxOverflow: rows.reduce((a, r) => Math.max(a, r.overflow || 0), 0), rows,
      requiredPresent: A3_REQUIRED.filter((p) => sample.pages.indexOf(p) !== -1),
    },
    failures: bad.map((r) => `${r.viewport} ${r.page} overflow=${r.overflow}`).concat(errs.map((r) => `${r.viewport} ${r.page} ERR ${r.error}`)),
    repro: 'node tools/verify-mobile.js --check=3',
    notes: '抽样规则是确定性的（见 metrics.rule）；任务书点名的 paper/admin/reference/configuration/* 在盘上不存在，已用同义的 paper/reference/configuration/ 等替代',
  };
});

/* ── 4 / item 4：A4 中间断点 834×1112 / 1024×768 ── */
check(4, 4, 'A4', '中间断点：无横向溢出 + 有可用本页目录或等价导航', '834×1112 与 1024×768：overflow<=1 且（本页目录可见/可展开 | 等价导航可达）', async (ctx) => {
  const vps = [VP_834, VP_1024];
  const pages = ['/paper/dev/pdc/', '/velocity/tuning/', '/paper/reference/world-configuration/', '/'];
  const rows = [];
  for (const vp of vps) {
    await withCtx(ctx.browser, vp, async (page) => {
      for (const p of pages) {
        await go(page, u(p));
        let m = await probe(page);
        const rec = { viewport: vp.name, page: p, overflow: m.overflow, tocProbe: m.tocProbe, menuBtnVisible: !!(m.menuBtn.exists && m.menuBtn.visible), sidebarPos: m.sidebar.position };
        // 834：抽屉是唯一入口 → 打开抽屉后看抽屉内本页目录
        if (m.menuBtn.exists && m.menuBtn.visible) {
          await openDrawer(page);
          const o = await probe(page);
          rec.drawerOpen = { ariaExpanded: o.menuBtn.ariaExpanded, tocLinksVisible: o.tocProbe.drawerTocLinksVisible, tocVisible: o.tocProbe.drawerTocVisible, tocBox: o.tocProbe.drawerTocBox, navRowMin: o.navRowMin, navRowCount: o.navRows.length };
          // 抽屉里的 <details> 若折叠，点开 summary 再数
          if (o.tocProbe.drawerTocTag === 'details' && o.tocProbe.drawerTocVisible && o.tocProbe.drawerTocLinksVisible === 0) {
            const sum = await page.$('#sidebar details.side-toc summary, #sidebar details#drawer-toc > summary, #sidebar .side-toc > summary');
            if (sum) { await sum.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(320); }
            const o2 = await probe(page);
            rec.drawerOpen.tocLinksVisibleAfterOpen = o2.tocProbe.drawerTocLinksVisible;
          }
          await closeDrawer(page);
        }
        // 1024：侧栏常驻 → 侧栏内的 details 目录可直接展开
        if (m.tocProbe.sidebarPersistent && m.tocProbe.drawerTocTag === 'details' && m.tocProbe.drawerTocVisible) {
          const sum = await page.$('#sidebar details.side-toc summary, #sidebar details#drawer-toc > summary');
          let before = m.tocProbe.drawerTocLinksVisible;
          if (sum) { await sum.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(320); }
          const o2 = await probe(page);
          rec.sidebarDetails = { openable: !!sum, before, after: o2.tocProbe.drawerTocLinksVisible, open: o2.tocProbe.drawerTocOpen };
          if (sum) { await sum.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(200); }
        }
        rec.navRowCountRest = m.navRows.length;
        const tocAvailable = (rec.tocProbe.tocSideVisible && rec.tocProbe.tocSideLinks > 0)
          || (rec.drawerOpen && (rec.drawerOpen.tocLinksVisible > 0 || (rec.drawerOpen.tocLinksVisibleAfterOpen || 0) > 0))
          || (rec.sidebarDetails && (rec.sidebarDetails.before > 0 || rec.sidebarDetails.after > 0))
          || (rec.tocProbe.sidebarPersistent && rec.tocProbe.drawerTocVisible && rec.tocProbe.drawerTocLinksVisible > 0);
        const drawerNav = !!(rec.drawerOpen && rec.drawerOpen.ariaExpanded === 'true' && (rec.drawerOpen.navRowCount || 0) > 0);
        const sidebarNav = !!(rec.tocProbe.sidebarPersistent && m.navRows.length > 0);
        const equivalentNav = rec.menuBtnVisible ? drawerNav : sidebarNav;
        const headingLess = rec.tocProbe.headingCount === 0;
        rec.tocAvailable = !!tocAvailable;
        rec.equivalentNav = !!equivalentNav;
        rec.headingLess = headingLess;
        rec.tocOk = headingLess ? !!equivalentNav : (!!tocAvailable || !!equivalentNav);
        rec.navKind = headingLess
          ? (equivalentNav ? (rec.menuBtnVisible ? 'drawer-nav（无标题页 → 等价导航）' : 'persistent-sidebar-nav（无标题页 → 等价导航）') : 'none')
          : (rec.tocProbe.tocSideVisible && rec.tocProbe.tocSideLinks > 0 ? 'in-flow-toc'
            : (rec.drawerOpen && ((rec.drawerOpen.tocLinksVisible || 0) > 0 || (rec.drawerOpen.tocLinksVisibleAfterOpen || 0) > 0) ? 'drawer-toc'
              : (rec.sidebarDetails && (rec.sidebarDetails.before > 0 || rec.sidebarDetails.after > 0) ? 'sidebar-details-toc'
                : (rec.tocProbe.sidebarPersistent ? 'persistent-sidebar' : 'none'))));
        rows.push(rec);
      }
    });
  }
  const bad = rows.filter((r) => r.overflow > 1);
  const noToc = rows.filter((r) => !r.tocOk);
  const fails = [];
  if (bad.length) fails.push('横向溢出：' + bad.map((r) => `${r.viewport} ${r.page}=${r.overflow}`).join(' ; '));
  if (noToc.length) fails.push('无可用本页目录/等价导航：' + noToc.map((r) => `${r.viewport} ${r.page} navKind=${r.navKind}`).join(' ; '));
  return {
    verdict: fails.length === 0 ? 'pass' : 'fail',
    metrics: {
      combos: rows.length, badOverflow: bad.length, noToc: noToc.length,
      perViewport: vps.map((vp) => {
        const rs = rows.filter((r) => r.viewport === vp.name);
        return { viewport: vp.name, maxOverflow: Math.max(...rs.map((r) => r.overflow)), tocOk: rs.filter((r) => r.tocOk).length, navKinds: rs.map((r) => r.page + ':' + r.navKind) };
      }),
      rows,
    },
    failures: fails,
    repro: 'node tools/verify-mobile.js --check=4',
    notes: '“可用本页目录”的口径：<1024px 允许「正文内本页目录（aside.toc-side）或抽屉内目录（details）」，≥1024px 允许「右侧常驻 rail 或侧栏内可展开 details」；1024 一档 .toc-side 仍为 display:none（改前亦然），等价导航 = 常驻侧栏内的 details#drawer-toc',
  };
});

/* ── 5 / item 5：B1–B6 抽屉 ── */
check(5, 5, 'B1-B6', '导航抽屉：☰ / 打开 / 滚轮锁 / Esc / 遮罩 / 焦点 / Tab 25 次 / ≥1200 复位', 'B1–B6 逐条断言（滚动锁用真实滚轮法）', async (ctx) => {
  const detail = {};
  const VP390 = { name: '390x844', w: 390, h: 844 };
  await withCtx(ctx.browser, VP390, async (page) => {
    await go(page, u('/paper/dev/pdc/'), 200);
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await probe(page);
    detail.B1 = {
      menuBtn: before.menuBtn,
      ok_visible: !!(before.menuBtn.exists && before.menuBtn.visible),
      ok_size: !!(before.menuBtn.exists && before.menuBtn.w >= 44 && before.menuBtn.h >= 44),
      ok_aria_false: before.menuBtn.exists && before.menuBtn.ariaExpanded === 'false',
      ok_controls: before.menuBtn.exists && !!before.menuBtn.ariaControls,
      drawerBefore: before.drawer,
      ok_drawer_offscreen: before.drawer.exists ? (before.drawer.right <= 1 || String(before.drawer.transform).indexOf('-') !== -1) : false,
      ok_drawer_inert: before.drawer.exists ? before.drawer.inert === true : false,
    };
    // 光标放到页面上，避免 hover 影响
    await page.mouse.move(195, 400);
    await openDrawer(page);
    const open = await probe(page);
    const scrimHit = await page.evaluate(() => {
      const el = document.elementFromPoint(document.documentElement.clientWidth - 20, Math.round(window.innerHeight / 2));
      return el ? { tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().trim().split(/\s+/)[0] } : null;
    });
    detail.B2 = {
      drawer: open.drawer, ariaExpanded: open.menuBtn.ariaExpanded, scrim: open.scrim, scrimHit,
      ok_in_viewport: open.drawer.exists && open.drawer.left >= -1 && open.drawer.right > 40,
      ok_aria_true: open.menuBtn.ariaExpanded === 'true',
      ok_inert_removed: open.drawer.exists && open.drawer.inert === false,
      ok_scroll_lock_css: ['hidden', 'clip'].indexOf(open.bodyOverflow) !== -1 || ['hidden', 'clip'].indexOf(open.bodyOverflowY) !== -1 || ['hidden', 'clip'].indexOf(open.htmlOverflow) !== -1,
      ok_no_hscroll: open.overflow <= 1, overflow: open.overflow,
      bodyClasses: open.bodyClasses, bodyPos: open.bodyPos, scrollbarGutter: open.bodyScrollbarGutter,
      ok_scrim_hit: !!(scrimHit && String(scrimHit.cls).indexOf('scrim') !== -1),
      ok_focus_in_drawer: await page.evaluate(() => { const a = document.activeElement; const d = document.querySelector('#sidebar, .sidebar'); return !!(a && d && d.contains(a)); }),
      navRowMin: open.navRowMin, navRowCount: open.navRows.length,
      drawerScroll: { scrollH: open.drawer.scrollH, clientH: open.drawer.clientH, overflowY: open.drawer.overflowY, overscroll: open.drawer.overscroll },
    };
    // 滚轮法验滚动锁（红队：window.scrollBy 在 overflow:hidden 下仍会成功 → 无效测法）
    const wLock = await wheelDelta(page, 600, { x: 380, y: 400 });
    // 抽屉自身滚轮可滚
    const drawerWheel = await page.evaluate(() => {
      const d = document.querySelector('#sidebar, .sidebar');
      const r = d.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 300), before: d.scrollTop, scrollH: d.scrollHeight, clientH: d.clientHeight };
    });
    await page.mouse.move(drawerWheel.x, Math.min(drawerWheel.y, 700));
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    const drawerWheelAfter = await page.evaluate(() => { const d = document.querySelector('#sidebar, .sidebar'); return d.scrollTop; });
    detail.B4 = {
      wheel: wLock, ok_wheel_locked: wLock.delta === 0,
      drawerWheel: { before: drawerWheel.before, after: drawerWheelAfter, moved: drawerWheelAfter - drawerWheel.before, scrollH: drawerWheel.scrollH, clientH: drawerWheel.clientH },
      ok_drawer_scrollable: drawerWheel.scrollH > drawerWheel.clientH ? (drawerWheelAfter - drawerWheel.before) > 0 : true,
      pageScrollBefore: wLock.before, pageScrollAfter: wLock.after,
    };
    detail.B4.ok_no_hscroll_when_open = open.overflow <= 1;

    // Esc 关闭 + 焦点回 ☰
    await closeDrawer(page);
    const afterEsc = await probe(page);
    detail.B3_esc = {
      ariaExpanded: afterEsc.menuBtn.ariaExpanded, drawer: afterEsc.drawer,
      ok_closed: afterEsc.menuBtn.ariaExpanded === 'false' && (afterEsc.drawer.left < -1 || afterEsc.drawer.right <= 1 || String(afterEsc.drawer.transform).indexOf('-') !== -1 || !afterEsc.drawer.visible),
      focusId: await page.evaluate(() => (document.activeElement ? (document.activeElement.id || document.activeElement.tagName.toLowerCase()) : null)),
      ok_focus_back: await page.evaluate(() => { const b = document.querySelector('#nav-toggle, .sidebar-toggle, #menu-btn, .menu-toggle'); return !!b && document.activeElement === b; }),
      ok_inert_restored: afterEsc.drawer.inert === true,
    };
    // 遮罩真实点击关闭（用鼠标点遮罩上一点）
    await openDrawer(page);
    const opened2 = await probe(page);
    let scrimClosed = null;
    if (opened2.scrim.sel && opened2.scrim.visible) {
      const pt = await page.evaluate(() => {
        const s = document.querySelector('[class*=scrim]');
        const d = document.querySelector('#sidebar, .sidebar');
        const r = d.getBoundingClientRect();
        const x = Math.min(document.documentElement.clientWidth - 8, Math.max(r.right + 20, document.documentElement.clientWidth - 40));
        return { x: Math.round(x), y: Math.round(window.innerHeight * 0.6), scrimCls: s ? s.className : null };
      });
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(520);
      const afterScrim = await probe(page);
      scrimClosed = {
        point: pt,
        ariaExpanded: afterScrim.menuBtn.ariaExpanded, drawer: afterScrim.drawer,
        ok: afterScrim.menuBtn.ariaExpanded === 'false' && (afterScrim.drawer.left < -1 || afterScrim.drawer.right <= 1 || String(afterScrim.drawer.transform).indexOf('-') !== -1 || !afterScrim.drawer.visible),
        focusBack: await page.evaluate(() => { const b = document.querySelector('#nav-toggle, .sidebar-toggle, #menu-btn, .menu-toggle'); return !!b && document.activeElement === b; }),
      };
    }
    detail.B3_scrim = { scrimSeen: opened2.scrim, result: scrimClosed };

    // Tab 25 次不外逃（先把抽屉确保在关闭态，再聚焦 ☰ 打开，确认焦点已移入抽屉，再连续 Tab）
    await closeDrawer(page);
    const closedState = await probe(page);
    await page.evaluate(() => { const b = document.querySelector('#nav-toggle, .sidebar-toggle, #menu-btn, .menu-toggle'); if (b) b.focus(); });
    await page.click(OPEN_SEL, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(560);
    const preTab = await probe(page);
    const focusBeforeTab = await page.evaluate(() => { const a = document.activeElement; const d = document.querySelector('#sidebar, .sidebar'); return { tag: a ? a.tagName.toLowerCase() : null, inside: !!(a && d && d.contains(a)), id: a ? a.id : '' }; });
    const tabSeq = [];
    let escapedAt = null;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const st = await page.evaluate(() => {
        const a = document.activeElement;
        const d = document.querySelector('#sidebar, .sidebar');
        return { tag: a ? a.tagName.toLowerCase() : null, cls: a ? (a.className || '').toString().trim().split(/\s+/)[0] : null, id: a ? a.id : '', inside: !!(a && d && d.contains(a)), isBody: a === document.body };
      });
      tabSeq.push(st);
      if (!st.inside) { escapedAt = i + 1; break; }
    }
    detail.B6 = {
      navRowMin: open.navRowMin, navRowCount: open.navRows.length,
      ok_nav_rows: open.navRowMin !== null && open.navRowMin >= 44,
      closedBeforeTab: { ariaExpanded: closedState.menuBtn.ariaExpanded, drawerLeft: closedState.drawer.left },
      openedForTab: { ariaExpanded: preTab.menuBtn.ariaExpanded, drawerLeft: preTab.drawer.left, scrimVisible: !!(preTab.scrim && preTab.scrim.visible) },
      focusBeforeTab, tabPresses: tabSeq.length, escapedAt, tabSeq: tabSeq.slice(0, 6),
      ok_tab_no_escape: escapedAt === null && tabSeq.length === 25 && tabSeq.every((t) => t.inside),
    };
    await closeDrawer(page);
  });

  // 中间断点 900 / 1023：契约要求 ≤1023.98 一律抽屉
  for (const vp of [{ name: '900x800', w: 900, h: 800 }, { name: '1023x800', w: 1023, h: 800 }]) {
    await withCtx(ctx.browser, vp, async (page) => {
      await go(page, u('/paper/dev/pdc/'));
      const m = await probe(page);
      detail['B1_' + vp.name] = {
        menuBtn: m.menuBtn, sidebar: m.sidebar, overflow: m.overflow,
        ok_menu_visible: !!(m.menuBtn.exists && m.menuBtn.visible && m.menuBtn.w >= 44 && m.menuBtn.h >= 44),
        ok_drawer: m.sidebar.display !== 'none' && m.sidebar.position === 'fixed',
      };
    });
  }
  // ≥1200 复位（C3 断崖重裁后桌面阈值由 1024 上移到 1200）
  for (const vp of [VP_1280, VP_1440]) {
    await withCtx(ctx.browser, vp, async (page) => {
      await go(page, u('/paper/dev/pdc/'));
      const m = await probe(page);
      detail['B5_' + vp.name] = {
        menuBtn: m.menuBtn, drawer: m.drawer, sidebar: m.sidebar, toc: m.toc,
        ok_menu_hidden: !m.menuBtn.exists || !m.menuBtn.visible || m.menuBtn.display === 'none',
        ok_menu_display_none: (m.menuBtn.display || 'none') === 'none',
        ok_transform_none: m.drawer.exists && (m.drawer.transform === 'none' || m.drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)'),
        ok_no_inert: m.drawer.exists && m.drawer.inert === false,
        ok_sidebar_sticky: m.sidebar.position === 'sticky' && m.sidebar.left >= -1 && m.sidebar.w > 0,
        navRowMin: m.navRowMin,
      };
    });
  }
  /* B5 的桌面阈值随 C3 断崖重裁从 1024 改为 1200（owner 书面裁决）：
     C3 把「侧栏常驻 + TOC 右栏」的断点从 1025 上移到 1200，以消除 1024 死区
     （实测台阶 2→1，幅度 −536→−340px，1024 处 artW 693→949）。
     因此 1024–1199 档现在**应当**是抽屉模式（☰ 可见），只有 ≥1200 才是桌面常驻。
     断言口径同步上移，否则会把设计变更误判成回归。 */
  const b5 = [detail['B5_1280x800'], detail['B5_1440x900']].filter(Boolean);
  const B = {
    'B1 ☰ 可见且 ≥44×44 + aria-expanded=false + aria-controls + 抽屉初始 offscreen/inert': detail.B1.ok_visible && detail.B1.ok_size && detail.B1.ok_aria_false && detail.B1.ok_controls && detail.B1.ok_drawer_offscreen && detail.B1.ok_drawer_inert && detail['B1_900x800'].ok_menu_visible && detail['B1_1023x800'].ok_menu_visible,
    'B2 打开后进入视口 + aria=true + inert 移除 + 无横向滚动': detail.B2.ok_in_viewport && detail.B2.ok_aria_true && detail.B2.ok_inert_removed && detail.B2.ok_no_hscroll,
    'B3 Esc 关闭 + 焦点回 ☰ + 重新 inert': detail.B3_esc.ok_closed && detail.B3_esc.ok_focus_back && detail.B3_esc.ok_inert_restored,
    'B3b 遮罩关闭（真实指针点击）': !!(detail.B3_scrim.result && detail.B3_scrim.result.ok),
    'B3c 遮罩命中：elementFromPoint(右侧中线) === .nav-scrim': detail.B2.ok_scrim_hit,
    'B4 滚轮法滚动锁：打开后滚轮 600px → window.scrollY 增量 0；抽屉自身可滚': detail.B4.ok_wheel_locked && detail.B4.ok_drawer_scrollable,
    'B4b 打开态 overflow<=1': detail.B4.ok_no_hscroll_when_open,
    'B5 ≥1200 ☰ display:none + transform:none + 无 inert + 侧栏常驻': b5.every((x) => x.ok_menu_hidden && x.ok_menu_display_none && x.ok_transform_none && x.ok_no_inert && x.ok_sidebar_sticky),
    'B6 抽屉内导航行高 ≥44px + Tab 25 次不外逃': detail.B6.ok_tab_no_escape && (detail.B6.ok_nav_rows || (detail.B2.drawerScroll.scrollH > detail.B2.drawerScroll.clientH && detail.B2.drawerScroll.overflowY !== 'visible')),
    'B7 焦点初始落在抽屉内': detail.B2.ok_focus_in_drawer,
  };
  const failed = Object.keys(B).filter((k) => !B[k]);
  return {
    verdict: failed.length === 0 ? 'pass' : 'fail',
    metrics: { B, detail },
    failures: failed.map((k) => k + ' 未满足'),
    repro: 'node tools/verify-mobile.js --check=5',
    notes: '滚动锁用**真实鼠标滚轮**（wheelDelta），不是 window.scrollBy（红队在 overflow:hidden 下证明后者仍会成功）；'
      + '遮罩用真实指针点击 + elementFromPoint 双证；760/900/1023 三档复测 ☰ 可见性以对齐契约的 1023.98px 移动线',
  };
});

/* ── 6 / item 6+7+8：C1 / C2 / C3 ── */
check(6, 6, 'C1-C3', '触控与字号：C1 输入框 ≥16px / C2 顶栏 ≥44×44 + 顶栏自证 / C3 两套行高阈值', 'C1/C2/C3 三项分判', async (ctx) => {
  const rows = [];
  const vps = [VP_MOBILE[0], VP_MOBILE[2], VP_MOBILE[3]];
  for (const vp of vps) {
    await withCtx(ctx.browser, vp, async (page) => {
      for (const p of ['/', '/paper/dev/pdc/', '/all-pages.html']) {
        await go(page, u(p));
        const m = await probe(page);
        const visInputsRest = m.inputs.filter((i) => i.visible);
        let drawerInputs = [], drawerOpenM = null;
        if (m.menuBtn.exists && m.menuBtn.visible) {
          await openDrawer(page);
          drawerOpenM = await probe(page);
          drawerInputs = drawerOpenM.inputs.filter((i) => i.visible);
        }
        // 搜索弹窗里的输入框
        const strat = await openSearch(page);
        const searchInputs = await page.evaluate(() => Array.from(document.querySelectorAll('input, select, textarea')).map((el) => ({ id: el.id, cls: (el.className || '').toString().split(' ')[0], fontSize: parseFloat(getComputedStyle(el).fontSize), v: (() => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0; })() })).filter((x) => x.v));
        await page.keyboard.press('Escape').catch(() => {});
        rows.push({
          viewport: vp.name, page: p,
          inputsRest: visInputsRest.map((i) => ({ id: i.id, cls: i.cls, fontSize: i.fontSize })),
          inputsDrawer: drawerInputs.map((i) => ({ id: i.id, cls: i.cls, fontSize: i.fontSize })),
          inputsSearch: searchInputs, searchStrategy: strat,
          inputsOk: visInputsRest.every((i) => i.fontSize >= 16) && drawerInputs.every((i) => i.fontSize >= 16) && searchInputs.every((i) => i.fontSize >= 16),
          topbar: m.topbarControls.map((c) => ({ cls: c.cls, tag: c.tag, w: c.w, h: c.h, text: c.text })),
          topbarAllOk: m.topbarControls.length > 0 && m.topbarControls.every((c) => c.w >= 44 && c.h >= 44),
          topbarSelf: m.headerBox, brand: m.brand,
          drawerNavRowMin: drawerOpenM ? drawerOpenM.navRowMin : null, drawerNavRows: drawerOpenM ? drawerOpenM.navRows.length : 0,
          overflow: m.overflow,
        });
        if (drawerOpenM) await closeDrawer(page);
      }
    });
  }
  // C3 桌面：与改前实例逐档对照（1024/1280）
  const deskRows = [];
  for (const vp of [VP_1024, VP_1280]) {
    const d = await dualSnapshot(ctx, vp, ['/paper/dev/pdc/']);
    deskRows.push({ viewport: vp.name, post: d.post['/paper/dev/pdc/'].navRowMin, pre: d.pre ? d.pre['/paper/dev/pdc/'].navRowMin : null, postCount: d.post['/paper/dev/pdc/'].navRowCount, preCount: d.pre ? d.pre['/paper/dev/pdc/'].navRowCount : null });
  }
  // C3 移动：抽屉内行高（含 768/834/900/1023）
  const mobRows = [];
  for (const vp of [VP_MOBILE[0], VP_MOBILE[2], VP_768, VP_834]) {
    await withCtx(ctx.browser, vp, async (page) => {
      await go(page, u('/paper/dev/pdc/'));
      const m = await probe(page);
      if (m.menuBtn.exists && m.menuBtn.visible) {
        await openDrawer(page);
        const o = await probe(page);
        mobRows.push({ viewport: vp.name, navRowMin: o.navRowMin, navRowCount: o.navRows.length, insideDrawer: true });
        await closeDrawer(page);
      } else {
        mobRows.push({ viewport: vp.name, navRowMin: m.navRowMin, navRowCount: m.navRows.length, insideDrawer: false });
      }
    });
  }
  const c1 = rows.every((r) => r.inputsOk) && rows.some((r) => r.inputsRest.length + r.inputsDrawer.length + r.inputsSearch.length > 0);
  const c2 = rows.every((r) => r.topbarAllOk)
    && rows.every((r) => r.topbarSelf && r.topbarSelf.scrollW === r.topbarSelf.clientW)
    && rows.every((r) => r.topbarSelf && r.topbarSelf.h <= 56)
    && rows.every((r) => r.topbarSelf && r.topbarSelf.flexWrap !== 'wrap');
  const c3mobile = mobRows.every((r) => r.navRowMin !== null && r.navRowMin >= 44);
  const c3desk = deskRows.every((r) => r.pre === null || Math.abs(r.post - r.pre) <= 1);
  const c3deskJudged = !!(ctx.pre && deskRows.every((r) => r.pre !== null));
  const fails = [];
  if (!c1) fails.push('C1 输入框字号<16：' + JSON.stringify(rows.filter((r) => !r.inputsOk).map((r) => ({ vp: r.viewport, page: r.page, rest: r.inputsRest, drawer: r.inputsDrawer, search: r.inputsSearch }))).slice(0, 400));
  if (!c2) fails.push('C2 顶栏：' + JSON.stringify(rows.filter((r) => !r.topbarAllOk || !r.topbarSelf || r.topbarSelf.scrollW !== r.topbarSelf.clientW || r.topbarSelf.h > 56).map((r) => ({ vp: r.viewport, page: r.page, small: r.topbar.filter((c) => c.w < 44 || c.h < 44), self: r.topbarSelf }))).slice(0, 400));
  if (!c3mobile) fails.push('C3 移动抽屉行高<44：' + JSON.stringify(mobRows));
  if (!c3desk) fails.push('C3 桌面行高与改前不一致：' + JSON.stringify(deskRows));
  if (!c3deskJudged) fails.push('C3 桌面档：**改前实例不可达 → 无法双实例判定（本项降级 partial）**；仅记录改后值 ' + JSON.stringify(deskRows.map((r) => r.viewport + '=' + r.post)));
  return {
    verdict: (c1 && c2 && c3mobile && c3desk) ? (c3deskJudged ? 'pass' : 'partial') : 'fail',
    metrics: {
      C1: c1, C2: c2, C3_mobile: c3mobile, C3_desktop: c3desk, C3_desktop_judged: c3deskJudged, pre_missing: !ctx.pre,
      rows, mobileRows: mobRows, desktopRows: deskRows,
      c3_rule: '两套阈值：≤1023.98px（抽屉/移动线）行高 ≥44px；≥1024px 桌面密度与改前实例逐档对照（容差 ±1px）',
      inputFontHistogram: (() => { const h = {}; for (const r of rows) for (const i of r.inputsRest.concat(r.inputsDrawer, r.inputsSearch)) h[i.fontSize] = (h[i.fontSize] || 0) + 1; return h; })(),
      topbarControlHistogram: (() => { const h = {}; for (const r of rows) for (const c of r.topbar) h[c.w + 'x' + c.h] = (h[c.w + 'x' + c.h] || 0) + 1; return h; })(),
    },
    failures: fails,
    repro: 'node tools/verify-mobile.js --check=6',
    notes: 'C1 覆盖三处输入框：静息可见输入框 / 抽屉打开后的输入框 / 搜索弹窗内的输入框；'
      + 'C2 额外自证顶栏 scrollWidth===clientWidth 且高度 ≤56px 且 flex-wrap≠wrap（防用换行遮丑）；'
      + 'C3 桌面密度必须回到改前（执行者自报 21px）——这里用改前实例实测值对照，不用自报值',
  };
});

/* ── 7 / item 9：D1–D3 代码块/表格 ── */
check(7, 9, 'D1-D3', '代码块与表格：滚动容器 + 键盘可达（含真实 Tab）', 'preScrollableCount==preCount；tabindex=0+role=region+aria-label；横滚不改文档宽；真实 Tab 可达', async (ctx) => {
  const pages = PAGES10.concat(ctx.a3().pages.filter((p) => PAGES10.indexOf(p) === -1).slice(0, 8));
  const rows = [];
  for (const vp of [VP_MOBILE[2], VP_1280]) {
    await withCtx(ctx.browser, vp, async (page) => {
      for (const p of pages) {
        await go(page, u(p));
        const m = await probe(page);
        const preBad = m.preList.filter((x) => !x.scrollable);
        const preA11yBad = m.preList.filter((x) => x.scrollable && !(x.containerTabindex2 && x.containerTabindex2.tabindex === '0' && x.containerTabindex2.role === 'region'));
        const preNoLabel = m.preList.filter((x) => x.scrollable && !(x.container && x.container.ariaLabel));
        const tableA11yBad = m.tableList.filter((t) => t.scroller && !(t.containerTabindex === '0' && t.containerRole === 'region'));
        const tableNoScroller = m.tableList.filter((t) => !t.scroller);
        const d3 = await page.evaluate(() => {
          const de = document.documentElement;
          const before = de.scrollWidth;
          const targets = [];
          for (const el of document.querySelectorAll('pre, table, .table-wrap, .code-block, .code-scroll')) {
            const cs = getComputedStyle(el);
            if (['auto', 'scroll'].indexOf(cs.overflowX) !== -1 && el.scrollWidth > el.clientWidth + 1) targets.push(el);
          }
          for (const t of targets) t.scrollLeft = t.scrollWidth;
          const after = de.scrollWidth;
          for (const t of targets) t.scrollLeft = 0;
          return { targets: targets.length, before, after, delta: after - before };
        });
        rows.push({
          viewport: vp.name, page: p,
          preCount: m.preCount, preScrollable: m.preScrollableCount, preNeedingScroll: m.preNeedingScroll, preFocusable: m.preFocusableCount,
          preBad: preBad.length, preA11yBad: preA11yBad.length, preNoLabel: preNoLabel.length, preA11ySample: preA11yBad.slice(0, 2),
          tableCount: m.tableCount, tableScroller: m.tableScrollerCount, tableNoScroller: tableNoScroller.length, tableA11yBad: tableA11yBad.length,
          tableWrappedNoScroll: m.tableList.filter((t) => t.scroller && !t.needsScroll).length,
          d3, overflow: m.overflow, offenders: m.offenders.length,
        });
      }
      // 真实 Tab 可达：把焦点交到滚动容器 DOM 序前一个可聚焦元素，再按一次 Tab（折叠 <details> 内 → inconclusive，不计不可达）
      const tabResults = [];
      for (const tp of ['/paper/dev/pdc/', '/paper/reference/world-configuration/', '/paper/dev/dialogs/']) {
        await go(page, u(tp));
        const tabReach = await page.evaluate(() => {
          const focusables = Array.from(document.querySelectorAll('a[href], button, input, summary, [tabindex]:not([tabindex="-1"])'));
          const scrollers = Array.from(document.querySelectorAll('.code-scroll, .table-wrap, pre[tabindex="0"]'))
            .filter((s) => { const r = s.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
            .slice(0, 8);
          window.__tabProbe = { scrollers, focusables };
          return scrollers.map((s) => {
            const det = s.closest('details');
            const inClosedDetails = !!(det && !det.open);
            const hidden = s.offsetParent === null || getComputedStyle(s).visibility === 'hidden';
            return {
              sel: s.tagName.toLowerCase() + '.' + ((s.className || '').toString().split(' ')[0] || ''),
              tabindex: s.getAttribute('tabindex'), role: s.getAttribute('role'), aria: !!s.getAttribute('aria-label'),
              idx: focusables.indexOf(s), inClosedDetails: inClosedDetails, hidden: hidden, rendered: !inClosedDetails && !hidden,
            };
          });
        });
        for (const t of tabReach) {
          if (!t.rendered) { tabResults.push({ page: tp, ...t, reached: null, note: 'inconclusive：折叠 <details> 内或未渲染（不计不可达）' }); continue; }
          if (t.idx <= 0) { tabResults.push({ page: tp, ...t, reached: null, note: 'no-preceding-focusable' }); continue; }
          await page.evaluate((i) => { const f = window.__tabProbe.focusables[i - 1]; if (f && f.focus) f.focus(); }, t.idx);
          await page.keyboard.press('Tab');
          const reached = await page.evaluate((i) => { const s = window.__tabProbe.scrollers[i]; return document.activeElement === s; }, tabReach.indexOf(t));
          tabResults.push({ page: tp, ...t, reached: reached });
        }
      }
      rows.push({ viewport: vp.name, page: '__tab_reach__', tabResults });
    });
  }
  const dataRows = rows.filter((r) => r.page !== '__tab_reach__');
  const tabRows = rows.filter((r) => r.page === '__tab_reach__');
  const d1Bad = dataRows.filter((r) => r.preScrollable !== r.preCount);
  const d2Bad = dataRows.filter((r) => r.preA11yBad || r.tableA11yBad || r.tableNoScroller || r.preNoLabel);
  const d3Bad = dataRows.filter((r) => r.d3.delta > 1);
  const tabBad = tabRows.flatMap((r) => r.tabResults.filter((t) => t.reached === false));
  const tabInconclusive = tabRows.flatMap((r) => r.tabResults.filter((t) => t.reached === null && String(t.note || '').indexOf('inconclusive') === 0));
  const tabOk = tabRows.flatMap((r) => r.tabResults.filter((t) => t.reached === true));
  const fails = [];
  if (d1Bad.length) fails.push('D1 pre 无滚动容器：' + d1Bad.slice(0, 6).map((r) => `${r.viewport} ${r.page} ${r.preScrollable}/${r.preCount}`).join(' ; '));
  if (d2Bad.length) fails.push('D2 缺 tabindex/role/aria-label：' + d2Bad.slice(0, 6).map((r) => `${r.viewport} ${r.page} pre缺=${r.preA11yBad} 无label=${r.preNoLabel} 表格缺=${r.tableA11yBad} 表格无容器=${r.tableNoScroller}`).join(' ; '));
  if (d3Bad.length) fails.push('D3 横滚改文档宽：' + d3Bad.slice(0, 6).map((r) => `${r.viewport} ${r.page} ${r.d3.before}->${r.d3.after}`).join(' ; '));
  if (tabBad.length) fails.push('真实 Tab 不可达：' + JSON.stringify(tabBad).slice(0, 300));
  return {
    verdict: fails.length === 0 ? 'pass' : 'fail',
    metrics: {
      D1: d1Bad.length === 0, D2: d2Bad.length === 0, D3: d3Bad.length === 0, tabReach: tabBad.length === 0,
      tabDetail: { reached: tabOk.length, unreachable: tabBad.length, inconclusive: tabInconclusive.length, inconclusiveList: tabInconclusive },
      preTotal: dataRows.reduce((a, r) => a + r.preCount, 0), preScrollableTotal: dataRows.reduce((a, r) => a + r.preScrollable, 0),
      tableTotal: dataRows.reduce((a, r) => a + r.tableCount, 0), tableScrollerTotal: dataRows.reduce((a, r) => a + r.tableScroller, 0),
      d3ScrolledContainers: dataRows.reduce((a, r) => a + r.d3.targets, 0),
      badCombos: { d1: d1Bad.length, d2: d2Bad.length, d3: d3Bad.length }, combos: dataRows.length,
      tabResults: tabRows, rows: dataRows,
    },
    failures: fails,
    repro: 'node tools/verify-mobile.js --check=7',
    notes: 'D2 要求滚动容器（pre 最近 3 层祖先 / 表格最近 4 层祖先）命中 tabindex="0" + role="region" + aria-label；'
      + '真实 Tab 可达 = 把焦点交到滚动容器 DOM 序前一个可聚焦元素后按一次 Tab，activeElement 必须落到滚动容器（不是只看 tabindex 属性）；'
      + '**折叠 <details> 内 / 未渲染的滚动容器记为 inconclusive**（metrics.tabDetail.inconclusiveList），不计入“不可达”。',
  };
});

/* ── 8 / item 10：E1/E2 零回归（双实例逐格对打） ── */

/**
 * 改前实例（<repo>/../_pre-mobile）**在网络环境里被外部进程删除前**（2026-10-21 21:5x），
 * 本探针实测到的存档值。测量窗口 21:24–21:47（改前产物指纹 27338ada4b28），**不可复跑**，
 * 只在改前实例不可达时用于"降级判定"（item 10 / C3 桌面 / PERF 改前对照 → partial），不得冒充双实例对打结论。
 */
const ARCHIVED_PRE = {
  measured_at: '2026-10-21T21:24+08:00 ~ 2026-10-21T21:47+08:00',
  pre_fingerprint: '27338ada4b28',
  pre_url: 'http://127.0.0.1:8788',
  note: '<repo>/../_pre-mobile 于 21:5x 被外部删除（8788 端口仍占用但根目录已空，/ 与 /paper/dev/pdc/ 均 404）→ 以下数值是我的存档实测，不能被本脚本复跑',
  a1_overflow_10pages_10pages: {
    '320x568': { min: 267, max: 425, bad: 10 }, '360x640': { min: 227, max: 385, bad: 10 },
    '390x844': { min: 197, max: 355, bad: 10 }, '414x896': { min: 173, max: 331, bad: 10 },
    innerWidth_at_320: 745, note: '320px 下 innerWidth 745 > clientWidth 320（顶栏 flex 行把 ICB 撑开）',
  },
  geometry: {
    '320x568': { sidebarPos: 'fixed', sidebarX: -296, sidebarW: 290, navToggle: '33x32 visible', ariaExpanded: null, layoutCols: '320px', headerH: 52, scrollPaddingTop: '64px', topbarSelf: '745/320', tocSide: 'display:none' },
    '768x1024': { sidebarPos: 'fixed', sidebarW: 290, navToggle: 'visible', tocSide: 'display:none', headerH: 52 },
    '834x1112': { sidebarPos: 'sticky', sidebarW: 280, sidebarX: 0, navToggle: 'display:none', tocSide: 'display:none', layoutCols: '280px 554px', secSwitch: 3, sideSecs: 0 },
    '1024x768': { sidebarPos: 'sticky', sidebarW: 280, tocSide: 'display:none', layoutCols: '280px 744px', secSwitch: 3, navRowMin_ref: '21（红队 + 执行者均报 21；我 21:24 那轮 C3 桌面判定 |Δ|≤1 通过）' },
    '1100x900': { layoutCols: '280px 820px', tocSide: 'display:none' },
    '1280x800': { sidebarPos: 'sticky', sidebarW: 290, tocSide: 'aside.toc-side visible 250px @x=1030', layoutCols: '290px 740px 250px', headerH: 52 },
    '1440x900': { tocSide: 'visible 250px @x=1190', layoutCols: '290px 900px 250px' },
  },
  first_paint_resources: ['site.css', 'search-index.js', 'site.js', 'favicon.svg'],
  search_ui_order: { '插件': '40/109', 'pdc': '3/3', '配置': '40/67', '命令': '40/79', note: '与改后 UI 逐条 href 完全一致（21:40 实测）' },
  perf_back_to_back: { slow4g: { fcp: { '/': 1248, '/paper/dev/pdc/': 1320 }, dcl: { '/': 5176, '/paper/dev/pdc/': 5130 } }, 'slow4g+cpu4x': { fcp: { '/': 3252, '/paper/dev/pdc/': 3312 }, dcl: { '/': 7723, '/paper/dev/pdc/': 7841 } } },
};

check(8, 10, 'E1/E2', '零回归：768/834/1024/1280 双实例对打（同一探针，差异逐条归 A/B/C）', '≥1024 所有可比指标与改前一致；<1024 的差异必须落在白名单内（A=契约明文 / B=已裁决 / C=真回归）', async (ctx) => {
  const pages = ['/paper/dev/pdc/', '/paper/reference/world-configuration/', '/', '/all-pages.html'];
  const snaps = [];
  for (const vp of VP_REGRESSION) snaps.push(await dualSnapshot(ctx, vp, pages));

  const NUM_TOL = { sidebarW: 2, contentX: 2, contentW: 2, navRowMin: 1, headerH: 0 };
  const WHITELIST = {
    '768x1024': {
      hasMenuButton: '改前 768 已在 ≤820 断点内 → ☰ 本就可见（非回归）', menuBtn: '同上（33×32 → 44×44 是 F4/C2 目标；aria-expanded=null→false 是 B 项新增语义）',
      tocVisible: 'F3 新增特性：<1024 给正文内本页目录（改前 0）', tocDisplay: 'F3', tocW: 'F3', tocSideVisible: 'F3', drawerTocVisible: 'F3/A4 新增：侧栏内可展开的 details 本页目录', drawerTocInSidebar: 'F3/A4 新增元素（改前该元素根本不存在）',
      navRowMin: 'C3 移动线行高 44（改前抽屉更密）', navRowCount: '顶栏 .sec-switch 的 3 条链接在 ≤1023.98 下沉到抽屉 .side-secs（同一批 affordance 换位置：实测 834 处改前 secSwitch=3/sideSecs=0，改后 secSwitch=0/sideSecs=3）', sidebarW: '抽屉宽 290→320（≤1023.98 移动线）',
      sidebarPos: 'sticky→fixed（移动线；改前 768 已是 fixed）', headerH: '移动线顶栏 52→56', scrollPaddingTop: 'F2 连带值', topbarVar: 'F2 连带值',
      sidebarInert: '改前无 inert（B 项新增语义）', inputFonts: 'C1 目标（改前 13.44/14.4/15.2 → 16）', preFocusable: 'D2 目标（新增 tabindex=0）',
      brandW: 'F1 品牌占位（改后 .brand 内含 .brand-name）', brandNameW: 'F1 新增 .brand-name 元素（改前无此元素 → null）', brandTruncated: 'F1',
      contentX: '≤1023.98 单列（移动线）', contentW: '≤1023.98 单列（移动线）', layoutCols: '移动线单列',
      secSwitchVisible: '移动线：顶栏分区切换（Paper/Velocity/Folia 3 条）在 ≤1023.98 下沉到抽屉 .side-secs（实测改前 768 secSwitch=3/sideSecs=0 → 改后 0/3，affordance 总数不变）',
      sideSecsVisible: '同上（3 条分区链接换位置，不是新增或删除导航）',
    },
    '834x1112': {
      hasMenuButton: '改前 834 >820 断点 → 既无 ☰ 也无 TOC（820–1200 空档）；改后按 1023.98 移动线给抽屉 = A4 要求',
      menuBtn: 'A4/B1 新增', tocVisible: 'F3', tocDisplay: 'F3', tocW: 'F3', tocSideVisible: 'F3', drawerTocVisible: 'F3/A4 新增', drawerTocInSidebar: 'F3/A4 新增元素',
      navRowMin: 'C3 移动线', navRowCount: '同 768：sec-switch 3 条链接下沉到抽屉（实测改前 secSwitch=3/sideSecs=0 → 改后 secSwitch=0/sideSecs=3，总数不变）', sidebarW: '280→320', sidebarPos: 'sticky→fixed（移动线）', sidebarInert: 'B 项新增',
      headerH: '移动线顶栏 52→56', scrollPaddingTop: 'F2 连带值', topbarVar: 'F2', inputFonts: 'C1', preFocusable: 'D2',
      brandW: 'F1', brandNameW: 'F1 新增元素', brandTruncated: 'F1',
      layoutCols: '280px 554px → 834px（移动线单列）', contentX: '280→0（移动线单列）', contentW: '554→834（移动线单列）',
      secSwitchVisible: '移动线：顶栏分区切换下沉到抽屉', sideSecsVisible: '移动线：抽屉里承接 3 条分区链接',
    },
    '1024x768': {
      drawerTocVisible: 'F3/A4 新增：≥1024 侧栏常驻时给一个可展开的 details 本页目录（此时 .toc-side rail 仍 display:none，与改前一致）',
      drawerTocInSidebar: 'F3/A4 新增元素（改前不存在）',
      menuBtn: '☰ 在 ≥1024 仍是 display:none（改前 null → 改后 aria-expanded="false" 属性存在，可见性不变）',
      inputFonts: 'C1 目标在桌面同样生效（13.44 → 16，红队 §7.2 第 6 条未限定视口）',
      brandNameW: 'F1 新增 .brand-name 元素', brandW: 'F1 新增 .brand-name 元素（改后 .brand 宽度即品牌名宽）', brandTruncated: 'F1',
      preFocusable: 'D2 目标：滚动容器补 tabindex="0" + role="region"（改前 0 → 改后 10）——契约 D2 的改进，桌面同样生效，不是版式/密度变化',
    },
    '1280x800': {
      drawerTocVisible: 'F3/A4 新增（该 details 在 ≥1100 由 CSS 隐藏，rail 仍常驻）', drawerTocInSidebar: 'F3/A4 新增元素',
      menuBtn: '☰ 依旧 display:none（仅多了 aria-expanded="false" 属性）',
      inputFonts: 'C1 目标在桌面同样生效（13.44 → 16）',
      brandNameW: 'F1 新增 .brand-name 元素', brandW: 'F1 新增 .brand-name 元素', brandTruncated: 'F1',
      preFocusable: 'D2 目标：滚动容器补 tabindex="0" + role="region"（改前 0 → 改后 10）',
    },
  };
  /* A/B/C 归类：A = 契约明文规格（mobile-contract.md 明写）／B = 已裁决（红队 F* 与终局裁决/收口判定）／C = 真回归 */
  const CLASS_B_FIELD = {
    brandW: 'F1/收口判定：.brand 内新增 .brand-name，被测元素身份变化（收口判定 #10 表实测同选择器 .brand 盒宽改前/改后同为 139px）',
    brandNameW: 'F1/收口判定：改前该元素不存在（null）→ 属新增元素而非版式劣化',
    brandTruncated: 'F1/收口判定：随 .brand-name 新增而出现的派生字段',
  };
  const CLASS_B_BY_VP = {
    '1024x768': {
      drawerTocVisible: '终局裁决 §1 裁决 2：≥1024 保留侧栏内可折叠 .side-toc（作为 A4 的等价导航），不影响 E2 任何口径',
      drawerTocInSidebar: '同上（新增元素，改前不存在）',
      menuBtn: '口径：☰ 在 ≥1024 仍 display:none，只是多了 aria-expanded="false" 属性（收口判定 #10 已裁决）',
    },
    '1280x800': {
      drawerTocVisible: '终局裁决 §1 裁决 2（该 details 在 ≥1100 由 CSS 隐藏，右侧 rail 仍常驻）',
      drawerTocInSidebar: '同上（新增元素）',
      menuBtn: '同上：属性新增、可见性不变',
    },
  };
  const classOf = (vpName, field) => {
    const byVp = CLASS_B_BY_VP[vpName] || {};
    if (byVp[field]) return 'B';
    if (CLASS_B_FIELD[field]) return 'B';
    return 'A';
  };
  const diffs = [];
  for (const s of snaps) {
    if (!s.pre) continue;
    const wl = WHITELIST[s.viewport] || {};
    for (const p of s.pages) {
      const a = s.pre[p], b = s.post[p];
      if (!a || !b) continue;
      for (const f of Object.keys(b)) {
        if (f === 'viewport' || f === 'vp') continue;
        const va = a[f], vb = b[f];
        let kind = 'same';
        if (JSON.stringify(va) !== JSON.stringify(vb)) {
          const numA = typeof va === 'number', numB = typeof vb === 'number';
          if (numA && numB && NUM_TOL[f] !== undefined && Math.abs(vb - va) <= NUM_TOL[f]) kind = 'same';
          else if (numA && numB && f === 'overflow' && vb <= 1) kind = 'same';
          else if (wl[f]) kind = 'expected';
          else kind = 'REGRESSION';
        }
        if (kind !== 'same') {
          const abc = kind === 'REGRESSION' ? 'C' : classOf(s.viewport, f);
          diffs.push({ viewport: s.viewport, page: p, field: f, pre: va, post: vb, kind, abc, note: (CLASS_B_BY_VP[s.viewport] || {})[f] || wl[f] || '' });
        }
      }
    }
  }
  const regressions = diffs.filter((d) => d.kind === 'REGRESSION');
  const expected = diffs.filter((d) => d.kind === 'expected');
  const abcCounts = { A: diffs.filter((d) => d.abc === 'A').length, B: diffs.filter((d) => d.abc === 'B').length, C: diffs.filter((d) => d.abc === 'C').length };
  const abcFields = {
    A: Array.from(new Set(diffs.filter((d) => d.abc === 'A').map((d) => d.field))).sort(),
    B: Array.from(new Set(diffs.filter((d) => d.abc === 'B').map((d) => d.field))).sort(),
    C: Array.from(new Set(diffs.filter((d) => d.abc === 'C').map((d) => d.field))).sort(),
  };
  // 版本归零的额外硬断言
  const hard = [];
  for (const s of snaps) {
    for (const p of s.pages) {
      const b = s.post[p];
      if (!b) continue;
      if (b.overflow > 1) hard.push(`${s.viewport} ${p} 改后横向溢出 ${b.overflow}`);
      if (b.clippedUnexplained > 0) hard.push(`${s.viewport} ${p} clippedUnexplained=${b.clippedUnexplained}`);
      if (['1024x768', '1280x800'].includes(s.viewport)) {
        if (b.hasMenuButton) hard.push(`${s.viewport} ${p} ≥1024 仍可见 ☰`);
        if (b.headerScrollW !== b.headerClientW) hard.push(`${s.viewport} ${p} 顶栏自证失败 ${b.headerScrollW}/${b.headerClientW}`);
        if (!b.sidebarVisible) hard.push(`${s.viewport} ${p} ≥1024 侧栏不可见`);
        if (b.tocDisplay === 'none' && s.viewport === '1280x800') hard.push(`${s.viewport} ${p} ≥1280 TOC 被藏（改前可见）`);
      }
    }
  }
  const preMissing = !ctx.pre;
  return {
    verdict: preMissing ? 'partial' : (regressions.length === 0 && hard.length === 0 ? 'pass' : 'fail'),
    metrics: {
      viewports: VP_REGRESSION.map((v) => v.name), pages,
      pre_instance: ctx.pre ? PRE_BASE : null,
      pre_missing: preMissing,
      pre_instance_archived: preMissing ? ARCHIVED_PRE : null,
      diffCount: diffs.length, expectedCount: expected.length, regressionCount: regressions.length,
      abcCounts: abcCounts, abcFields: abcFields,
      abc_rule: 'A = 契约（mobile-contract.md）明文规格（顶栏 56 / 抽屉 min(88vw,340px) / ≤1023.98 移动线 / C1 16px / C2 44×44 / C3 行高 44 / D2 tabindex+role / A4 本页目录 / §2.3 sec-switch 收进抽屉）；'
        + 'B = 已裁决（红队 F1–F10、终局裁决 §1、收口判定 #10 的分类，例如 .brand-name 元素身份变化、≥1024 保留 .side-toc、☰ 仅多属性）；'
        + 'C = 真回归（白名单外差异）；计数按“差异条目”计，字段清单另列 abcFields。',
      diffTable: diffs, snapshots: snaps,
      known_upstream: '已知并接受：768/834 的 tocVisible 0→有（F3 新特性）；1024 的 .toc-side rail 仍为 display:none（改前亦然，改后用常驻侧栏内 details 作等价导航）；1280/1440 的右侧 rail 250px 与改前逐格一致',
      hardFailures: hard,
    },
    failures: preMissing
      ? ['改前实例不可达（' + PRE_BASE + '，目录 <repo>/../_pre-mobile 已被外部删除）→ **本项无法完成双实例对打，判定降级为 partial**；删除前（21:24–21:47，改前指纹 ' + ARCHIVED_PRE.pre_fingerprint + '）我用同一探针实测的存档值见 metrics.pre_instance_archived，报告 §6b 有完整表']
      : regressions.map((d) => `REGRESSION ${d.viewport} ${d.page} ${d.field}: ${JSON.stringify(d.pre)} → ${JSON.stringify(d.post)}`).concat(hard),
    repro: 'node tools/verify-mobile.js --check=8',
    notes: '同一份探针（PROBE）对 8787/8788 两个实例逐格对打；白名单只覆盖契约里显式声明的变化（F2/F3/C1/C2/C3/D2/B 项新增语义 + 1023.98 移动线），其余差异一律判回归。**改前实例缺失时本项只能是 partial，不会假绿**',
  };
});

/* ── 9 / item 11：E3 既有门禁（$env:TEMP 影子副本 + 仓库只读不变性核对） ── */

/** 递归复制（跳过 .git / node_modules；node_modules 用 junction 指回真仓库） */
function copyTree(src, dst, skipNames) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipNames.indexOf(e.name) !== -1) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d, skipNames);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/** 影子副本：任务书要求“写 reports/**、data/** 的门禁在 $env:TEMP 影子副本里跑” */
/** 影子副本的新鲜度戳：站点产物 + 本工具自身（本工具也要被门禁扫到，改了就得重拷） */
const shadowStamp = () => fingerprint()._all + '|' + (sha(__filename) || 'self');
function ensureShadow() {
  const marker = path.join(SHADOW, 'tools', 'verify-site.js');
  const linkUp = () => {
    /* .git 与 node_modules 用 junction 指回真仓库：
       - privacy-scan / gh-pages-smoke 依赖 `git ls-files` 枚举（影子副本里没有 .git 会 exit 1）；
       - verify-site 依赖 cheerio（node_modules）。
       junction 是只读复用（不改真仓库），已存在则跳过。 */
    const links = [[path.join(REPO, '.git'), path.join(SHADOW, '.git')], [path.join(REPO, 'node_modules'), path.join(SHADOW, 'node_modules')]];
    const out = {};
    for (const [src, dst] of links) {
      if (fs.existsSync(dst) || !fs.existsSync(src)) { out[path.basename(dst)] = fs.existsSync(dst) ? 'exists' : 'src-missing'; continue; }
      try { fs.symlinkSync(src, dst, 'junction'); out[path.basename(dst)] = 'junction'; } catch (e) { out[path.basename(dst)] = 'failed: ' + String(e.message).slice(0, 80); }
    }
    return out;
  };
  if (fs.existsSync(marker)) {
    /* 影子副本必须与当前仓库同版本：否则门禁跑的是旧快照（并发重建后极易假绿/假红） */
    const stamp = path.join(SHADOW, '.shadow-src-fp');
    let saved = null;
    try { saved = fs.readFileSync(stamp, 'utf8').trim(); } catch { saved = null; }
    const cur = shadowStamp();
    if (saved === cur) return { created: false, ok: true, path: SHADOW, source_fp: cur, reused: true, links: linkUp() };
    fs.rmSync(SHADOW, { recursive: true, force: true });
    copyTree(REPO, SHADOW, ['.git', 'node_modules']);
    try { fs.writeFileSync(stamp, cur, 'utf8'); } catch { /* */ }
    return { created: true, ok: fs.existsSync(marker), path: SHADOW, source_fp: cur, reused: false, recopied_from_fp: saved, links: linkUp() };
  }
  try {
    fs.rmSync(SHADOW, { recursive: true, force: true });
    copyTree(REPO, SHADOW, ['.git', 'node_modules']);
    try { fs.writeFileSync(path.join(SHADOW, '.shadow-src-fp'), shadowStamp(), 'utf8'); } catch { /* */ }
    const links = linkUp();
    return { created: true, ok: fs.existsSync(marker), path: SHADOW, source_fp: shadowStamp(), links: links };
  } catch (e) { return { created: false, ok: false, path: SHADOW, error: String(e.message).slice(0, 200) }; }
}

/** 仓库侧只读不变性指纹：门禁可能写的目录（reports/ data/ assets/）+ 根产物 */
function repoFileHashes() {
  const out = {};
  for (const d of ['reports', 'data', 'assets']) {
    let ents = [];
    try { ents = fs.readdirSync(path.join(REPO, d), { withFileTypes: true }); } catch { /* */ }
    for (const e of ents) if (e.isFile()) out[d + '/' + e.name] = sha(path.join(REPO, d, e.name));
  }
  for (const s of ['index.html', 'all-pages.html', 'snapshots.html', 'sitemap.xml', '404.html']) out[s] = sha(path.join(REPO, s));
  return out;
}
/** 门禁自身会写的路径（变化 = 门禁污染了仓库）；其余变化 = 并发写者（另有其人），单独列 */
const GATE_SCOPE = ['reports/verification.md', 'reports/verification.json', 'reports/gh-pages-smoke.json', 'data/privacy-report.json', 'data/source-nav.json'];

check(9, 11, 'E3', '既有门禁独立复跑（$env:TEMP 影子副本，不覆盖他人产物）+ 仓库只读不变性', '5 项门禁退出码 0；仓库 reports/ data/ assets/ 跑前跑后 sha256 逐文件不变', async (ctx) => {
  const gates = [
    { name: 'check-site', args: ['tools/check-site.js'], writes: false },
    { name: 'url-parity', args: ['tools/url-parity.js'], writes: false },
    { name: 'verify-site', args: ['tools/verify-site.js'], writes: true },
    { name: 'privacy-scan', args: ['tools/privacy-scan.js'], writes: true },
    { name: 'gh-pages-smoke', args: ['tools/gh-pages-smoke.js'], writes: true },
    { name: 'build-site --verify-artifacts', args: ['tools/build-site.js', '--verify-artifacts'], writes: false },
  ];
  const sh = ensureShadow();
  const before = repoFileHashes();
  const ran = [];
  for (const g of gates) {
    if (!sh.ok && g.writes) { ran.push({ gate: g.name, skipped: '影子副本不可用且该门禁会写 reports/** 或 data/** → 跳过（不覆盖他人产物）' }); continue; }
    const t0 = Date.now();
    let out = '', code = 0;
    try {
      out = execFileSync(process.execPath, g.args, { cwd: sh.ok ? SHADOW : REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    } catch (e) {
      out = String((e && e.stdout) || '') + '\n[STDERR]\n' + String((e && e.stderr) || '') + '\n[ERROR] ' + (e && e.message);
      code = e && typeof e.status === 'number' ? e.status : 99;
    }
    const lines = out.split('\n').filter(Boolean);
    const verdictLine = lines.filter((l) => /RESULT|自测：|通过 \d+\/\d+|个门禁|passed|分类汇总|①/.test(l)).slice(-4);
    ran.push({ gate: g.name, cwd: sh.ok ? path.relative(REPO, SHADOW) : '.', exit: code, sec: Math.round((Date.now() - t0) / 1000), verdict: verdictLine, tail: lines.slice(-10) });
  }
  const after = repoFileHashes();
  const changed = [];
  for (const k of new Set(Object.keys(before).concat(Object.keys(after)))) {
    if (before[k] !== after[k]) changed.push({ file: k, before: before[k] || null, after: after[k] || null, gate_output: GATE_SCOPE.indexOf(k) !== -1 });
  }
  const gateTouched = changed.filter((c) => c.gate_output);
  const external = changed.filter((c) => !c.gate_output);
  const failed = ran.filter((r) => r.exit !== undefined && r.exit !== 0);
  const skipped = ran.filter((r) => r.skipped);
  const fails = [];
  if (failed.length) fails.push('门禁非 0 退出：' + failed.map((r) => `${r.gate} exit=${r.exit}`).join(' ; '));
  if (gateTouched.length) fails.push('门禁污染了仓库文件：' + JSON.stringify(gateTouched).slice(0, 300));
  if (skipped.length) fails.push('被跳过的门禁：' + skipped.map((r) => r.gate).join(','));
  return {
    verdict: fails.length === 0 ? 'pass' : (failed.length ? 'fail' : 'partial'),
    metrics: {
      gates: ran, shadow: sh, shadow_path: SHADOW,
      repo_files_hashed: Object.keys(before).length,
      repo_changed: changed, gate_touched_repo: gateTouched, external_concurrent_changes: external,
      external_note: external.length ? '以下文件在门禁窗口内变化但**不在门禁写范围**（GATE_SCOPE）→ 判为并发写者所致，不据此判门禁失败，但如实登记' : null,
    },
    failures: fails,
    repro: 'node tools/verify-mobile.js --check=9 --shadow=$env:TEMP\\vm-shadow（自动创建影子副本）',
    notes: 'verify-site / gh-pages-smoke / privacy-scan 会写 reports/** 或 data/** → 一律在 $env:TEMP 影子副本里跑（junction 复用 node_modules），'
      + '并逐文件核对真仓库 reports/ data/ assets/ 的 sha256 跑前跑后一致；门禁写范围内的变化 = 失败，范围外的变化 = 并发写者（另记）。',
  };
});

/* ── 10 / item 12：E4 交互未坏 ── */
check(10, 12, 'E4', '交互未坏：搜索 / 侧栏过滤 / 主题切换 / 锚点不被顶栏遮挡', '四项逐条断言：搜索结果非空且可跳转、过滤生效、主题切换改变外观、锚点落点 gap∈[8,20]', async (ctx) => {
  const out = {};
  await withCtx(ctx.browser, VP_MOBILE[2], async (page) => {
    // 1) 搜索
    await go(page, u('/paper/dev/pdc/'));
    const strat = await openSearch(page);
    const typed = await typeQuery(page, '配置');
    const res = await page.evaluate(READ_RESULTS);
    const firstHref = res.items.length ? res.items[0].href : null;
    let navigated = null;
    if (firstHref) {
      const before = page.url();
      await page.click('#search-results li a[href]', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(700);
      navigated = { from: before, to: page.url(), changed: page.url() !== before };
    }
    out.search = { strategy: strat, typed, count: res.count, countText: res.countText, first3: res.items.slice(0, 3), navigated, ok: res.count > 0 };
    // 2) 侧栏过滤
    await go(page, u('/paper/dev/pdc/'));
    const menu = await page.evaluate(() => { const b = document.querySelector('#nav-toggle'); return !!(b && getComputedStyle(b).display !== 'none'); });
    if (menu) await openDrawer(page);
    const before = await page.evaluate(SIDE_LINKS);
    const filtered = await page.evaluate((q) => {
      const i = document.querySelector('#side-filter');
      if (!i) return { found: false };
      i.value = q; i.dispatchEvent(new Event('input', { bubbles: true }));
      return { found: true, q };
    }, 'pdc');
    await page.waitForTimeout(420);
    const after = await page.evaluate(SIDE_LINKS);
    const filterVisibleSample = await page.evaluate(() => Array.from(document.querySelectorAll('#sidebar a[data-search], .sidebar a[data-search]')).filter((a) => { const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return r.height > 0 && cs.display !== 'none' && !(a.closest('li') && a.closest('li').hidden); }).slice(0, 3).map((a) => (a.textContent || '').trim().slice(0, 20)));
    out.filter = { inputFound: filtered.found, before, after, sample: filterVisibleSample, ok: filtered.found && after.visible > 0 && after.visible < before.visible };
    // 3) 主题切换（改前 auto → light 时底色在浅色偏好下不变属正常：断言必须"属性逐次变化 + 两次点击后外观与起点不同"）
    await go(page, u('/paper/dev/pdc/'));
    const t0 = await probe(page);
    await page.click('#theme-toggle', { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(420);
    const t1 = await probe(page);
    await page.click('#theme-toggle', { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(420);
    const t2 = await probe(page);
    out.theme = {
      start: { attr: t0.theme.attr, bodyBg: t0.theme.bodyBg, htmlBg: t0.theme.htmlBg, colorScheme: t0.theme.colorScheme },
      after1: { attr: t1.theme.attr, bodyBg: t1.theme.bodyBg, htmlBg: t1.theme.htmlBg, colorScheme: t1.theme.colorScheme },
      after2: { attr: t2.theme.attr, bodyBg: t2.theme.bodyBg, htmlBg: t2.theme.htmlBg, colorScheme: t2.theme.colorScheme },
      attr_sequence_changes: t1.theme.attr !== t0.theme.attr && t2.theme.attr !== t1.theme.attr,
      appearance_changes: t2.theme.bodyBg !== t0.theme.bodyBg || t2.theme.htmlBg !== t0.theme.htmlBg || t2.theme.colorScheme !== t0.theme.colorScheme,
      ok: t1.theme.attr !== t0.theme.attr && t2.theme.attr !== t1.theme.attr && (t2.theme.bodyBg !== t0.theme.bodyBg || t2.theme.htmlBg !== t0.theme.htmlBg || t2.theme.colorScheme !== t0.theme.colorScheme),
    };
    // 4) 锚点落点：走**真实用户路径**（点本页目录里的锚点链接；无目录时用带 hash 的导航）
    const anchors = [];
    for (const p of ['/paper/dev/pdc/', '/paper/reference/world-configuration/']) {
      await go(page, u(p));
      const ids = await page.evaluate(() => Array.from(document.querySelectorAll('.article h2[id], .article h3[id]')).slice(0, 3).map((h) => h.id));
      for (const id of ids) {
        const hasTocLink = await page.evaluate((hid) => !!document.querySelector('.toc-side a[href="#' + hid + '"], #sidebar a[href="#' + hid + '"], .side-toc a[href="#' + hid + '"]'), id);
        let how = null;
        if (hasTocLink) {
          const clicked = await page.click('.toc-side a[href="#' + id + '"], #sidebar a[href="#' + id + '"], .side-toc a[href="#' + id + '"]', { timeout: 4000 }).then(() => true).catch(() => false);
          if (clicked) how = 'click-toc-link';
        }
        if (!how) {   // 兜底：带 hash 的整页导航（等价于用户粘贴带锚点 URL）
          await page.goto(u(p) + '#' + id, { waitUntil: 'load', timeout: 45000 });
          how = 'goto-with-hash';
        }
        await page.waitForTimeout(900);
        const m = await page.evaluate((hid) => {
          const h = document.getElementById(hid);
          const bar = document.querySelector('header.topbar, header');
          const hr = h.getBoundingClientRect(), br = bar.getBoundingClientRect();
          return { id: hid, headingTop: Math.round(hr.top), barBottom: Math.round(br.bottom), gap: Math.round(hr.top - br.bottom), scrollY: Math.round(window.scrollY), scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop, scrollMarginTop: getComputedStyle(h).scrollMarginTop };
        }, id).catch(() => null);
        if (m) anchors.push({ page: p, how, ...m, ok: m.gap >= 8 && m.gap <= 20 });
      }
    }
    out.anchor = { samples: anchors, ok: anchors.length > 0 && anchors.every((a) => a.ok), gapRange: anchors.length ? [Math.min(...anchors.map((a) => a.gap)), Math.max(...anchors.map((a) => a.gap))] : null };
    out.C2_anchor_compensation_single = await page.evaluate(() => { const de = getComputedStyle(document.documentElement).scrollPaddingTop; const h = document.querySelector('.article h2[id], .article h3[id]'); const sm = h ? getComputedStyle(h).scrollMarginTop : null; return { scrollPaddingTop: de, scrollMarginTop: sm, double: parseFloat(de) > 0 && parseFloat(sm) > 0 }; });
  });
  const fails = [];
  if (!out.search.ok) fails.push('搜索无结果');
  if (out.search.navigated && !out.search.navigated.changed) fails.push('搜索结果点击未跳转');
  if (!out.filter.ok) fails.push('侧栏过滤无效：' + JSON.stringify(out.filter));
  if (!out.theme.ok) fails.push('主题切换无效：' + JSON.stringify(out.theme));
  if (!out.anchor.ok) fails.push('锚点落点不在 [8,20]：' + JSON.stringify(out.anchor.gapRange) + ' ' + JSON.stringify(out.anchor.samples.filter((a) => !a.ok)));
  return {
    verdict: fails.length === 0 ? 'pass' : 'fail',
    metrics: out,
    failures: fails,
    repro: 'node tools/verify-mobile.js --check=10',
    notes: '锚点落点口径（红队 F2）：heading.top - topbar.bottom ∈ [8,20]；同时记录 html.scrollPaddingTop 与 heading.scrollMarginTop，两者不可同时 > 0（防双补偿）',
  };
});

/* ── 11 / item 13：E5 file:// 直开 ── */
check(11, 13, 'E5', 'file:// 直开（390px）：样式与相对路径仍生效', 'file:///…/index.html 与一个正文页：样式生效、相对资源 0 失败、无横向溢出', async (ctx) => {
  const pages = ['/index.html', '/paper/dev/pdc/index.html'];
  const rows = [];
  for (const p of pages) {
    await withCtx(ctx.browser, VP_MOBILE[2], async (page) => {
      const failed = [], responses = [];
      page.on('requestfailed', (r) => failed.push({ url: r.url().split('/').slice(-1)[0], err: r.failure() ? r.failure().errorText : null }));
      page.on('response', (r) => { if (r.status() >= 400) responses.push({ url: r.url().split('/').slice(-1)[0], status: r.status() }); });
      const url = fileUrl(p);
      let err = null;
      try { await page.goto(url, { waitUntil: 'load', timeout: 45000 }); } catch (e) { err = String(e.message).slice(0, 160); }
      await page.waitForTimeout(500);
      const m = await probe(page);
      const styleCheck = await page.evaluate(() => {
        const bar = document.querySelector('header.topbar, header');
        const cs = bar ? getComputedStyle(bar) : null;
        const img = Array.from(document.querySelectorAll('img')).filter((i) => i.getAttribute('src') && i.getAttribute('src').trim() !== '' && i.getAttribute('src').trim() !== 'about:blank').slice(0, 8).map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }));
        return {
          barPos: cs ? cs.position : null, barBg: cs ? cs.backgroundColor : null, barH: bar ? Math.round(bar.getBoundingClientRect().height) : null,
          siteCssApplied: !!(cs && (cs.position === 'sticky' || cs.position === 'relative' || cs.position === 'fixed')),
          bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60),
          menuBtn: !!document.querySelector('#nav-toggle'),
          imgs: img, imgsOk: img.every((i) => i.ok), imgCount: img.length, imgWithoutSrc: Array.from(document.querySelectorAll('img')).filter((i) => !i.getAttribute('src')).length,
          links: Array.from(document.querySelectorAll('a[href]')).slice(0, 8).map((a) => a.getAttribute('href')),
          hasToc: !!document.querySelector('.toc-side'), navLinks: document.querySelectorAll('#sidebar a[data-search]').length,
          searchBtn: !!document.querySelector('[data-open-search]'),
        };
      });
      rows.push({ page: p, file: url, err, overflow: m.overflow, headerH: m.headerH, menuBtn: m.menuBtn, sidebar: m.sidebar, styleCheck, failedRequests: failed, badResponses: responses });
    });
  }
  const fails = [];
  for (const r of rows) {
    if (r.err) fails.push(`${r.page} 打开失败：${r.err}`);
    if (r.overflow > 1) fails.push(`${r.page} file:// 下横向溢出 ${r.overflow}`);
    if (!r.styleCheck.siteCssApplied) fails.push(`${r.page} 样式未生效（顶栏 position=${r.styleCheck.barPos}）`);
    if (r.styleCheck.imgs.length && !r.styleCheck.imgsOk) fails.push(`${r.page} 图片未加载：` + JSON.stringify(r.styleCheck.imgs.filter((i) => !i.ok)));
    if (!r.styleCheck.navLinks) fails.push(`${r.page} 导航链接未渲染`);
  }
  return {
    verdict: fails.length === 0 ? 'pass' : 'fail',
    metrics: { rows },
    failures: fails,
    repro: 'node tools/verify-mobile.js --check=11',
    notes: 'file:// 下相对路径解析是浏览器行为；这里断言样式生效 + 图片 complete/naturalWidth>0 + requestfailed 清单 + 无横向溢出',
  };
});

/* ── 12 / item 14：F1 搜索索引懒加载 + 命中集/排序不变 ── */
check(12, 14, 'F1', '搜索索引懒加载 + 首次搜索命中集与排序不变', '首屏不得同步加载 search-index.*；离线复算（search-index.json）与 UI 逐条一致；改前/改后 UI 顺序一致', async (ctx) => {
  const out = { queries: ['插件', 'pdc', '配置', '命令'], offline: null, ui: [], preUi: [], resourceLists: {} };
  let index = null;
  try { index = JSON.parse(fs.readFileSync(path.join(REPO, 'search-index.json'), 'utf8')); } catch (e) { out.offline = { error: String(e.message) }; }
  const normalized = (h) => String(h || '').replace(/^(\.\.\/)+/, '');
  await withCtx(ctx.browser, VP_MOBILE[2], async (page) => {
    const reqs = [];
    page.on('request', (r) => reqs.push(r.url()));
    /* 第二重证据：CDP Network 事件（不依赖页内 performance API，防脚本清空/伪造 resource 时间线） */
    const cdpReqs = [];
    let cdpOk = false;
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      cdp.on('Network.requestWillBeSent', (e) => cdpReqs.push(e.request.url));
      cdpOk = true;
    } catch (e) { cdpOk = false; }
    await go(page, u('/paper/dev/pdc/'), 250);
    const cdpRestCount = cdpReqs.length;
    const beforeSearch = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    const loadedBeforeSearch = beforeSearch.filter((n) => /search-index/.test(n));
    const probeRest = await probe(page);
    // 首次搜索
    const strat = await openSearch(page);
    out.openStrategy = strat;
    const afterOpen = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    for (const q of out.queries) {
      const typed = await typeQuery(page, q);
      const r = await page.evaluate(READ_RESULTS);
      out.ui.push({ q, typed, count: r.count, countText: r.countText, order: r.items.map((i) => normalized(i.href)) });
      if (!out.offline || !out.offline.error) {
        try {
          const exp = (ctx.rankOffline)(index, q);
          out.offline = out.offline || {};
          out.offline[q] = { count: exp.length, order: exp.map((e) => normalized(e.p)) };
        } catch (e) { out.offline = { error: String(e.message).slice(0, 200) }; }
      }
    }
    const afterSearch = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    out.resourceLists = {
      load: beforeSearch.map((n) => n.split('/').slice(-1)[0]),
      loadedBeforeSearch: loadedBeforeSearch.map((n) => n.split('/').slice(-1)[0]),
      afterOpenSearch: afterOpen.filter((n) => /search-index/.test(n)).map((n) => n.split('/').slice(-1)[0]),
      afterFirstQuery: afterSearch.filter((n) => /search-index/.test(n)).map((n) => n.split('/').slice(-1)[0]),
      requests: reqs.map((n) => n.split('/').slice(-1)[0]).filter((n) => /search-index|\.js|\.css/.test(n)),
    };
    out.indexLoadedAtRest = probeRest.searchIndexLoaded;
    out.indexPagesAtRest = probeRest.searchIndexPages;
    out.cdp = {
      enabled: cdpOk,
      beforeInteraction: cdpReqs.slice(0, cdpRestCount).map((n) => n.split('/').slice(-1)[0]),
      afterInteraction: cdpReqs.slice(cdpRestCount).map((n) => n.split('/').slice(-1)[0]),
      totalRequests: cdpReqs.length,
    };
    // 改后首屏脚本列表（HTML 层面）
    out.scriptSrcs = await page.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')));
  });
  // 改前 UI 顺序（同一份探针/同一触发序列）
  if (ctx.pre) {
    await withCtx(ctx.browser, VP_MOBILE[2], async (page) => {
      const preCdpReqs = [];
      let preCdpOk = false;
      try {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Network.enable');
        cdp.on('Network.requestWillBeSent', (e) => preCdpReqs.push(e.request.url));
        preCdpOk = true;
      } catch (e) { preCdpOk = false; }
      await go(page, uPre('/paper/dev/pdc/'), 250);
      const preCdpRest = preCdpReqs.length;
      out.preCdp = { enabled: preCdpOk, beforeInteraction: preCdpReqs.slice(0, preCdpRest).map((n) => n.split('/').slice(-1)[0]) };
      const preLoad = await page.evaluate(() => performance.getEntriesByType('resource').map((n) => n.name.split('/').slice(-1)[0]));
      out.preResourceList = preLoad;
      out.preIndexAtRest = await page.evaluate(() => !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages));
      await openSearch(page);
      for (const q of out.queries) {
        await typeQuery(page, q);
        const r = await page.evaluate(READ_RESULTS);
        out.preUi.push({ q, count: r.count, countText: r.countText, order: r.items.map((i) => normalized(i.href)) });
      }
    });
  }
  const failures = [];
  const syncLoaded = out.resourceLists.loadedBeforeSearch.length > 0;
  const syncLoadedCdp = (out.cdp && out.cdp.beforeInteraction ? out.cdp.beforeInteraction : []).filter((n) => /search-index/.test(n)).length > 0;
  if (syncLoaded) failures.push('首屏同步加载了 search-index.*（performance 时间线）：' + JSON.stringify(out.resourceLists.loadedBeforeSearch));
  if (syncLoadedCdp) failures.push('首屏同步加载了 search-index.*（CDP Network 事件，第二重证据）：' + JSON.stringify(out.cdp.beforeInteraction.filter((n) => /search-index/.test(n))));
  if (!out.cdp || !out.cdp.enabled) failures.push('CDP Network 证据缺失（无法完成双证）');
  if (!out.resourceLists.afterFirstQuery.length && !out.indexLoadedAtRest) failures.push('首次搜索后索引仍未加载（懒加载可能没生效）');
  for (const u of out.ui) {
    const o = out.offline && out.offline[u.q];
    if (!o) { failures.push(`离线复算缺失 q=${u.q}`); continue; }
    if (JSON.stringify(o.order) !== JSON.stringify(u.order)) {
      const firstDiff = u.order.findIndex((x, i) => x !== o.order[i]);
      failures.push(`q=${u.q} 命中集/排序不一致：UI ${u.order.length} 条 vs 离线 ${o.order.length} 条，首个差异 index=${firstDiff}`);
    }
  }
  for (const u of out.ui) {
    const p = out.preUi.find((x) => x.q === u.q);
    if (!p) continue;
    if (JSON.stringify(p.order) !== JSON.stringify(u.order)) failures.push(`q=${u.q} 改前/改后 UI 顺序不一致（改前 ${p.order.length} / 改后 ${u.order.length}）`);
    if (p.countText !== u.countText) failures.push(`q=${u.q} 计数文案改变：${p.countText} → ${u.countText}`);
  }
  return {
    verdict: failures.length === 0 ? 'pass' : 'fail',
    metrics: {
      ...out,
      offlineImpl: '离线复算器 rankOffline 内联在本脚本里（独立恢复自 tools/site/assets.js 的 SITE_JS；权重/别名分档/短语分解 ×0.6/二字片段 ×0.45/同分链 o 升序 等逐行标注来源）',
      syncLoaded, lazyLoaded: out.resourceLists.afterFirstQuery,
      preInstanceLoadedSync: ctx.pre ? (out.preResourceList || []).filter((n) => /search-index/.test(n)) : null,
    },
    failures,
    repro: 'node tools/verify-mobile.js --check=12',
    notes: '三重证据：① 首屏 resource 时间线不得出现 search-index.*；② 首次搜索后必须出现（说明是懒加载而非删除）；③ 命中集与排序：UI vs 离线复算（search-index.json）+ 改前实例 UI vs 改后实例 UI 双向对照',
  };
});

/* ── 13 / item 15：无障碍 ── */
check(13, 15, 'A11Y', '无障碍：reduced-motion / focus-visible / 320px 无双向滚动 / 裁剪祖先双检', '四项逐条断言（裁剪祖先刷绿不算通过：须右边界可达 + elementFromPoint 命中）', async (ctx) => {
  const out = { reduced: null, focus: [], twoWay: [], reach: [] };
  // 1) prefers-reduced-motion
  const rm = [];
  for (const p of ['/paper/dev/pdc/', '/']) {
    await withCtx(ctx.browser, VP_MOBILE[2], async (page) => {
      await go(page, u(p));
      const m = await probe(page);
      rm.push({ page: p, reducedMotion: m.reducedMotion, scrollBehavior: m.scrollBehavior, transitionDuration: m.transitionDuration, topbarVar: m.topbarVar });
    }, { reducedMotion: 'reduce' });
  }
  out.reduced = { rows: rm, ok: rm.every((r) => r.scrollBehavior === 'auto' && (r.transitionDuration === null || r.transitionDuration === '0s' || /^0s/.test(String(r.transitionDuration)))) };
  // 2) focus-visible 焦点环（真键盘 Tab 后读 outline）
  await withCtx(ctx.browser, VP_MOBILE[2], async (page) => {
    await go(page, u('/paper/dev/pdc/'), 150);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      const f = await probe(page, { focus: true });
      if (f.focusRing) out.focus.push(f.focusRing);
    }
    // 抽屉内也来一次
    if (await page.evaluate(() => { const b = document.querySelector('#nav-toggle'); return !!(b && getComputedStyle(b).display !== 'none'); })) {
      await openDrawer(page);
      await page.keyboard.press('Tab');
      const f2 = await probe(page, { focus: true });
      if (f2.focusRing) out.focus.push({ ...f2.focusRing, inDrawerPass: true });
      await closeDrawer(page);
    }
  });
  out.focusOk = out.focus.length > 0 && out.focus.every((f) => parseFloat(f.outlineWidth) > 0 || (f.boxShadow && f.boxShadow !== 'none'));
  // 3) 320px 无双向滚动（SC 1.4.10）
  for (const p of ['/paper/dev/pdc/', '/paper/reference/world-configuration/', '/all-pages.html']) {
    await withCtx(ctx.browser, VP_MOBILE[0], async (page) => {
      await go(page, u(p));
      const m = await probe(page);
      out.twoWay.push({ page: p, docOverflow: m.overflow, innerWidth: m.innerWidth, docW: m.docW, scrollW: m.docScrollW, twoWay: m.twoWay, docTwoWay: m.twoWay.some((t) => t.isDoc) });
    });
  }
  out.twoWayOk = out.twoWay.every((r) => r.docOverflow <= 1 && !r.docTwoWay);
  // 4) 裁剪祖先双检（控件右边界可达 + elementFromPoint 命中）
  for (const vp of [VP_MOBILE[0], VP_MOBILE[2]]) {
    for (const p of ['/paper/dev/pdc/', '/all-pages.html']) {
      await withCtx(ctx.browser, vp, async (page) => {
        await go(page, u(p), 150);
        await page.evaluate(() => window.scrollTo(0, 0));
        const m = await probe(page, { reach: true });
        out.reach.push({ viewport: vp.name, page: p, overflow: m.overflow, reach: m.reach });
      });
    }
  }
  out.reachOk = out.reach.every((r) => r.reach && r.reach.badCount === 0);
  const fails = [];
  if (!out.reduced.ok) fails.push('reduced-motion 下仍有平滑滚动/过渡：' + JSON.stringify(out.reduced.rows));
  if (!out.focusOk) fails.push('Tab 后焦点环不可见：' + JSON.stringify(out.focus.slice(0, 3)));
  if (!out.twoWayOk) fails.push('320px 双向滚动：' + JSON.stringify(out.twoWay.filter((r) => r.docOverflow > 1 || r.docTwoWay)));
  if (!out.reachOk) fails.push('裁剪祖先命中失败：' + JSON.stringify(out.reach.flatMap((r) => (r.reach ? r.reach.bad : [])).slice(0, 4)));
  return {
    verdict: fails.length === 0 ? 'pass' : 'fail',
    metrics: {
      reducedMotion: out.reduced, focusRing: out.focus, focusOk: out.focusOk,
      twoWay: out.twoWay, twoWayOk: out.twoWayOk,
      reach: out.reach, reachOk: out.reachOk,
      clipRule: '对每个可见可交互元素：右边界 right > clientWidth+1 的逐个登记（beyond），且在视口内的元素必须被 elementFromPoint(中心) 命中自身（或其祖先/后代）；'
        + '命中落在顶栏/遮罩/抽屉/dialog 时记为 tolerated；关闭态抽屉内的元素单列 skipped。**不允许用 overflow-x:clip 把越界刷绿**。',
    },
    failures: fails,
    repro: 'node tools/verify-mobile.js --check=13',
    notes: 'reduced-motion 断言 html{scroll-behavior:auto}（改前为 smooth）+ 遮罩过渡 ≤0s；焦点环用真键盘 Tab 后读 outlineWidth/boxShadow',
  };
});

/* ── 14 / item 16：性能（4× CPU 与 4× CPU + Slow 4G 两组，四类指标，post×pre 同协议） ── */
check(14, 16, 'PERF', '性能：FCP / DCL 前可交互 / 搜索按键长任务 / #allpages-filter 逐字符长任务（4×CPU 与 4×CPU+Slow4G 两组）', '四类指标 × 两组节流档，post 与 pre 同协议背靠背；逐条区分 回归 / 改善 / 未达标但非回归', async (ctx) => {
  const THROTTLE = { downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8), uploadThroughput: Math.round(750 * 1024 / 8), latency: 150 };
  const PROFILES = [
    { name: 'cpu4x', net: false, cpu: true, note: '任务书第一组：4× CPU（网络不限速）' },
    { name: 'slow4g+cpu4x', net: true, cpu: true, note: '任务书第二组：4× CPU + Slow 4G 叠加（1.6Mbps/0.75Mbps/150ms）' },
    { name: 'slow4g', net: true, cpu: false, note: '红队 §7.6 口径：仅 Slow 4G（保留以便与红队/收口报告对账；只测 FCP 与可交互性）' },
  ];
  const R = (x) => (x === null || x === undefined ? null : Math.round(x));
  const FCP_RULE = '<2000ms';
  const LT_RULE = '<50ms';
  /** 逐条分类：pass / improve但未达标 / regression / 未达标但非回归 / n/a */
  const classify = (post, pre, threshold, tol) => {
    if (post === null || post === undefined) return 'n/a';
    if (post <= threshold) return 'pass';
    if (pre === null || pre === undefined) return '未达标但非回归（无改前对照）';
    if (post > pre * (1 + (tol === undefined ? 0.10 : tol))) return 'regression';
    if (post < pre * 0.9) return 'improve但未达标';
    return '未达标但非回归';
  };
  const withThrottle = (prof, fn) => withCtx(ctx.browser, VP_MOBILE[2], async (page) => {
    const cdp = await page.context().newCDPSession(page);
    if (prof.net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...THROTTLE }); }
    if (prof.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    return fn(page, cdp);
  });

  /* 单次 FCP 采样（每次独立 context → 冷缓存）；同一档位取 2 次的最小值，post/pre 交替，抵抗已知的叠加档大方差 */
  const measureFcp1 = (url, prof) => withThrottle(prof, async (page) => {
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    const paint = await page.evaluate(() => {
      const e = performance.getEntriesByType('paint').find((x) => x.name === 'first-contentful-paint');
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const res = performance.getEntriesByType('resource').map((r) => r.name.split('/').slice(-1)[0]);
      return { fcp: e ? Math.round(e.startTime) : null, dcl: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null, load: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null, resources: res, indexOnCriticalPath: res.some((n) => /search-index/.test(n)) };
    });
    return { ...paint, wall: Date.now() - t0 };
  });

  const measureInteractive = (url, prof) => withThrottle(prof, async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      return { dcl: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null, hasToggle: !!document.querySelector('#nav-toggle') };
    });
    const t0 = Date.now();
    const opened = await page.evaluate(async () => {
      const b = document.querySelector('#nav-toggle');
      if (!b) return { clicked: false };
      b.click();
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 25));
        if (b.getAttribute('aria-expanded') === 'true' || document.body.classList.contains('nav-open')) return { clicked: true, ms: i * 25, aria: b.getAttribute('aria-expanded') };
      }
      return { clicked: true, ms: null, aria: b.getAttribute('aria-expanded') };
    });
    return { ...t, opened, wall: Date.now() - t0, ok: opened.clicked && opened.ms !== null };
  });

  const observeLt = () => {
    window.__lt = [];
    window.__keys = [];
    try {
      window.__ltObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ dur: Math.round(e.duration), start: e.startTime }); });
      window.__ltObs.observe({ entryTypes: ['longtask'] });
    } catch (e) { window.__ltErr = String(e); }
    /* 按键时刻（keydown 捕获）：把长任务按 `start - keyTime` 分到 (a) 按键同步窗口 ≤45ms / (b) debounce 之后 */
    window.addEventListener('keydown', () => { window.__keys.push(performance.now()); }, true);
  };
  /** (a) 纯同步 handler 成本：合成一次 input 事件，量 dispatch 的同步耗时（裁决 §1.1②-a 的口径） */
  const syncHandlerCost = () => {
    const i = document.querySelector('#search-input');
    if (!i) return null;
    const t = performance.now();
    try { i.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* */ }
    return Math.round((performance.now() - t) * 10) / 10;
  };
  const readLt = () => ({ tasks: window.__lt || [], err: window.__ltErr || null });

  const measureSearchLt = (url, prof) => withThrottle(prof, async (page) => {
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    const tCold = Date.now();
    await openSearch(page);
    await typeQuery(page, '命');
    let coldMs = null, resultsSeen = 0;
    for (let i = 0; i < 200; i++) {
      const st = await page.evaluate(() => ({ idx: !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages), n: document.querySelectorAll('#search-results li a').length }));
      resultsSeen = st.n;
      if (st.idx && st.n > 0) { coldMs = Date.now() - tCold; break; }
      await page.waitForTimeout(250);
    }
    await page.evaluate(observeLt);
    /* 逐键输入，且**每一步都保持命中集非空**：'命' → '命令' → '命令 ' → … → '命令 api'（实测 '命令 api' = 52 命中；
       早前版本用 '命令 api权限'（=0 命中）会让“长任务”读在退化状态下取值 → 被判 measurementValid=false）。 */
    const chars = ['令', ' ', 'a', 'p', 'i'];
    const perKey = [];
    const t0 = Date.now();
    for (const ch of chars) {
      const n0 = await page.evaluate(() => ({ t: (window.__lt || []).length, k: (window.__keys || []).length }));
      await page.keyboard.type(ch);
      await page.waitForTimeout(320);
      const got = await page.evaluate((s) => {
        const keyTime = (window.__keys || [])[s.k];
        const tasks = (window.__lt || []).slice(s.t).map((x) => ({ dur: x.dur, delay: keyTime === undefined ? null : Math.round(x.start - keyTime) }));
        const early = tasks.filter((t) => t.delay !== null && t.delay >= -20 && t.delay <= 45).map((t) => t.dur);
        const late = tasks.filter((t) => t.delay === null || t.delay > 45).map((t) => t.dur);
        return { newTasks: tasks.map((t) => t.dur), early: early, late: late, keyTime: keyTime === undefined ? null : Math.round(keyTime) };
      }, n0);
      const sync = await page.evaluate(syncHandlerCost).catch(() => null);
      perKey.push({
        ch, newTasks: got.newTasks, maxNew: got.newTasks.reduce((a, d) => Math.max(a, d), 0),
        earlyMax: got.early.reduce((a, d) => Math.max(a, d), 0), lateMax: got.late.reduce((a, d) => Math.max(a, d), 0),
        syncHandlerMs: sync,
      });
    }
    await page.waitForTimeout(700);
    const lt = await page.evaluate(readLt);
    const st = await page.evaluate(() => {
      const i = document.querySelector('#search-input');
      const r = document.querySelector('#search-results');
      const c = document.querySelector('#search-count');
      return { value: i ? i.value : null, count: r ? r.querySelectorAll('li a[href]').length : 0, countText: c ? c.textContent.trim() : null };
    });
    const perKeyMax = perKey.reduce((a, k) => Math.max(a, k.maxNew), 0);
    const earlyMax = perKey.reduce((a, k) => Math.max(a, k.earlyMax), 0);
    const lateMax = perKey.reduce((a, k) => Math.max(a, k.lateMax), 0);
    const syncHandlerMax = perKey.reduce((a, k) => Math.max(a, k.syncHandlerMs === null ? 0 : k.syncHandlerMs), 0);
    const maxDur = lt.tasks.reduce((a, t) => Math.max(a, t.dur), 0);
    return {
      tasks: lt.tasks, maxDur, perKey, perKeyMax, earlyMax, lateMax, syncHandlerMax, wall: Date.now() - t0, observerErr: lt.err, coldIndexMs: coldMs,
      finalValue: st.value, expectedValue: '命令 api', resultsAfterTyping: st.count, countText: st.countText,
      measurementValid: resultsSeen > 0 && st.count > 0 && st.value === '命令 api',
    };
  });

  const measureFilterLt = (url, prof) => withThrottle(prof, async (page) => {
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    let ready = null;
    for (let i = 0; i < 80; i++) {
      ready = await page.evaluate(() => ({ hasInput: !!document.querySelector('#allpages-filter'), rows: document.querySelectorAll('#allpages tbody tr').length, allRows: document.querySelectorAll('tbody tr').length }));
      if (ready.hasInput && ready.allRows > 0) break;
      await page.waitForTimeout(250);
    }
    await page.evaluate(observeLt);
    await page.click('#allpages-filter', { timeout: 4000 }).catch(() => { });
    const chars = ['c', 'o', 'n', 'f', 'i', '权', '限'];
    const perChar = [];
    for (const ch of chars) {
      const t0 = Date.now();
      await page.keyboard.type(ch);
      const wall = Date.now() - t0;
      const st = await page.evaluate(() => { const i = document.querySelector('#allpages-filter'); return { len: i ? i.value.length : null, rows: document.querySelectorAll('#allpages tbody tr').length }; });
      perChar.push({ ch, wall, len: st.len, rows: st.rows });
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(800);
    const lt = await page.evaluate(readLt);
    const typedLen = perChar.length ? perChar[perChar.length - 1].len : 0;
    return { url, ready, perChar, tasks: lt.tasks, maxDur: lt.tasks.reduce((a, t) => Math.max(a, t.dur), 0), maxCharWall: perChar.reduce((a, c) => Math.max(a, c.wall), 0), observerErr: lt.err, measuredValid: !!(ready && ready.hasInput) && (typedLen || 0) >= 3 };
  });

  const out = { profiles: PROFILES.map((p) => p.name), throttle: { ...THROTTLE, cpu: 4 }, rules: { fcp: FCP_RULE, longtask: LT_RULE, classify: 'post<=阈值→pass；pre 存在时 post<pre×0.9→improve但未达标；post>pre×(1+tol)→regression；其余→未达标但非回归' }, fcp: [], interactive: [], searchLt: [], filterLt: [] };
  for (const prof of PROFILES) {
    for (const p of ['/', '/paper/dev/pdc/']) {
      const postS = [], preS = [];
      for (let rep = 0; rep < 2; rep++) {
        postS.push(await measureFcp1(u(p), prof));
        if (ctx.pre) preS.push(await measureFcp1(uPre(p), prof));
      }
      const minFcp = (arr) => arr.reduce((a, x) => (x.fcp !== null && (a === null || x.fcp < a) ? x.fcp : a), null);
      const postFcp = R(minFcp(postS)), preFcp = R(minFcp(preS));
      out.fcp.push({
        profile: prof.name, page: p, reps: 2,
        post: postS[0], pre: preS[0] || null,
        post_samples: postS.map((x) => R(x.fcp)), pre_samples: preS.map((x) => R(x.fcp)),
        post_dcl_samples: postS.map((x) => R(x.dcl)), pre_dcl_samples: preS.map((x) => R(x.dcl)),
        postFcp, preFcp, postFcp_min: postFcp, preFcp_min: preFcp,
        cls: classify(postFcp, preFcp, 2000),
      });
    }
    const ip = await measureInteractive(u('/paper/dev/pdc/'), prof);
    const ipre = ctx.pre ? await measureInteractive(uPre('/paper/dev/pdc/'), prof) : null;
    out.interactive.push({ profile: prof.name, post: ip, pre: ipre, postMs: ip.opened.ms, preMs: ipre ? ipre.opened.ms : null, cls: (ip.ok ? classify(ip.opened.ms, ipre ? ipre.opened.ms : null, 2000, 0.20) : 'n/a（未观测到打开）') });
    ctx.log('    PERF ' + prof.name + ' fcp+interactive done');
    if (prof.name === 'slow4g') continue;
    const sr = [];
    for (let rd = 0; rd < 2; rd++) sr.push(await measureSearchLt(u('/paper/dev/pdc/'), prof));
    const sre = ctx.pre ? await measureSearchLt(uPre('/paper/dev/pdc/'), prof) : null;
    const sMax = Math.max(...sr.map((x) => x.maxDur));
    const sKeyMax = Math.max(...sr.map((x) => x.perKeyMax));
    const sPreMax = sre ? sre.maxDur : null;
    const sPreKeyMax = sre ? sre.perKeyMax : null;
    out.searchLt.push({
      profile: prof.name, rounds: sr, pre: sre, maxima: sr.map((x) => x.maxDur), maxDur: sMax, preMaxDur: sPreMax,
      perKeyMaxima: sr.map((x) => x.perKeyMax), perKeyMax: sKeyMax, prePerKeyMax: sPreKeyMax,
      earlyMax: Math.max(...sr.map((x) => x.earlyMax)), preEarlyMax: sre ? sre.earlyMax : null,
      lateMax: Math.max(...sr.map((x) => x.lateMax)), preLateMax: sre ? sre.lateMax : null,
      syncHandlerMax: Math.max(...sr.map((x) => x.syncHandlerMax)), preSyncHandlerMax: sre ? sre.syncHandlerMax : null,
      measuredValid: sr.every((x) => x.measurementValid) && (!sre || sre.measurementValid),
      /* 三种口径分别判：字面口径（按键归属的长任务）/ 裁决 §1.1②-a（纯同步 handler）/ 裁决 §1.1②-b（debounce 一次性执行） */
      cls: classify(sKeyMax, sPreKeyMax, 50, 0.30),
      cls_sync: classify(Math.max(...sr.map((x) => x.syncHandlerMax)), sre ? sre.syncHandlerMax : null, 50, 0.30),
      cls_early: classify(Math.max(...sr.map((x) => x.earlyMax)), sre ? sre.earlyMax : null, 50, 0.30),
      cls_debounce: classify(Math.max(...sr.map((x) => x.lateMax)), sre ? sre.lateMax : null, 50, 0.30),
    });
    const fr = await measureFilterLt(u('/all-pages.html'), prof);
    const fre = ctx.pre ? await measureFilterLt(uPre('/all-pages.html'), prof) : null;
    out.filterLt.push({ profile: prof.name, post: fr, pre: fre, maxDur: fr.maxDur, preMaxDur: fre ? fre.maxDur : null, maxCharWall: fr.maxCharWall, preMaxCharWall: fre ? fre.maxCharWall : null, measuredValid: fr.measuredValid && (!fre || fre.measuredValid), cls: classify(fr.maxDur, fre ? fre.maxDur : null, 50, 0.30), cls_charwall: classify(fr.maxCharWall, fre ? fre.maxCharWall : null, 50, 0.30) });
    ctx.log('    PERF ' + prof.name + ' searchLt(perKey)=' + sKeyMax + 'ms searchLt(window)=' + sMax + 'ms filterLt=' + fr.maxDur + 'ms');
  }

  const rows = [].concat(
    out.fcp.map((x) => ({ kind: 'FCP(2 次取 min)', profile: x.profile, page: x.page, post: x.postFcp, pre: x.preFcp, cls: x.cls, rule: FCP_RULE, samples: x.post_samples + ' vs ' + x.pre_samples })),
    out.interactive.map((x) => ({ kind: 'DCL前可交互(ms)', profile: x.profile, page: '/paper/dev/pdc/', post: x.postMs, pre: x.preMs, cls: x.cls, rule: '任务书 <2000ms（裁决 §1.1① 已降级为“不得劣化”）' })),
    out.searchLt.map((x) => ({ kind: '搜索按键长任务(按键归属 max)', profile: x.profile, page: '/paper/dev/pdc/', post: x.perKeyMax, pre: x.prePerKeyMax, cls: x.cls, rule: LT_RULE + '（任务书 item 16 字面口径）', valid: x.measuredValid })),
    out.searchLt.map((x) => ({ kind: '搜索单次按键同步成本(dispatch 同步)', profile: x.profile, page: '/paper/dev/pdc/', post: x.syncHandlerMax, pre: x.preSyncHandlerMax, cls: x.cls_sync, rule: LT_RULE + '（裁决 §1.1②-a）', valid: x.measuredValid })),
    out.searchLt.map((x) => ({ kind: '搜索 debounce 一次性执行(keydown+45ms 之后)', profile: x.profile, page: '/paper/dev/pdc/', post: x.lateMax, pre: x.preLateMax, cls: x.cls_debounce, rule: '不得劣化（裁决 §1.1②-b）', valid: x.measuredValid })),
    out.filterLt.map((x) => ({ kind: '#allpages-filter 逐字符长任务', profile: x.profile, page: '/all-pages.html', post: x.maxDur, pre: x.preMaxDur, cls: x.cls, rule: LT_RULE, valid: x.measuredValid })),
    out.filterLt.map((x) => ({ kind: '#allpages-filter 单次按键墙钟', profile: x.profile, page: '/all-pages.html', post: x.maxCharWall, pre: x.preMaxCharWall, cls: x.cls_charwall, rule: LT_RULE, valid: x.measuredValid }))
  );
  out.rows = rows;
  const clsCount = {};
  for (const r of rows) clsCount[r.cls] = (clsCount[r.cls] || 0) + 1;
  out.clsCount = clsCount;
  const invalid = rows.filter((r) => r.valid === false);
  const regressions = rows.filter((r) => r.cls === 'regression');
  const notMet = rows.filter((r) => String(r.cls).indexOf('未达标') === 0 || String(r.cls).indexOf('improve') === 0);
  const fails = [];
  if (invalid.length) fails.push('测量无效（未观测到索引加载 / 结果 / 输入回显）：' + JSON.stringify(invalid).slice(0, 300));
  if (regressions.length) fails.push('回归：' + regressions.map((r) => r.kind + '@' + r.profile + ' ' + r.pre + '→' + r.post).join(' ; '));
  if (notMet.length) fails.push('未达标但非回归（列明、不判 FAIL）：' + notMet.map((r) => r.kind + '@' + r.profile + ' post=' + r.post + ' pre=' + (r.pre === null ? '无对照' : r.pre) + ' 规则 ' + r.rule).join(' ; '));
  const verdict = (invalid.length || regressions.length) ? 'fail' : (notMet.length ? 'partial' : 'pass');
  return {
    verdict,
    metrics: { ...out, pre_missing: !ctx.pre, fcpStackNote: '节流两档 = 任务书字面（4×CPU 单独 / 4×CPU+Slow4G 叠加）+ 红队网络档（仅 Slow 4G，只测 FCP 与可交互性）；post 与 pre **同协议背靠背**测量。' },
    failures: fails,
    repro: 'node tools/verify-mobile.js --check=14',
    notes: 'CDP 节流：Emulation.setCPUThrottlingRate(4) + Network.emulateNetworkConditions(1.6Mbps/0.75Mbps/150ms)；'
      + 'FCP = paint first-contentful-paint；"DCL 前可交互" = goto(domcontentloaded) 后立刻点 #nav-toggle 并轮询 aria-expanded；'
      + '搜索按键长任务 = PerformanceObserver(longtask) 包住连续 4 次按键（索引先热身到出结果才计时，防“长任务恒为 0”假绿）；'
      + '#allpages-filter 逐字符长任务 = 逐字符键入 7 次，同时采样 longtask 与每次按键墙钟；'
      + '分类：post<=阈值→pass；post<pre×0.9→improve但未达标；post>pre×(1+tol)→regression；其余→未达标但非回归。',
  };
});

/* ───────────────────────── 运行器 ───────────────────────── */

/** 本 harness 的唯一标识：只有它写出的历史结果才会被合并进本轮 checks，其余一律进 legacy_checks */
const HARNESS = 'independent-verifier-v3/little-code-sauce';

const ITEM_TITLES = {
  1: 'A1 溢出 40 组合 + 改前对照',
  2: 'A2 clipped-aware offenders = 0',
  3: 'A3 另抽 20 页 @320/390',
  4: 'A4 834×1112 / 1024×768 无溢出 + 可用本页目录',
  5: 'B1-B6 抽屉六项（含滚轮锁 / Tab 25 次 / ≥1024 复位）',
  6: 'C1 可见输入框 ≥16px',
  7: 'C2 顶栏控件 ≥44×44 + 顶栏自证',
  8: 'C3 两套行高阈值（移动 ≥44 / 桌面 = 改前）',
  9: 'D1-D3 pre/表格滚动容器 + 键盘可达（含真实 Tab）',
  10: 'E1/E2 零回归双实例对打（768/834/1024/1280）',
  11: 'E3 既有 6 门禁独立复跑（影子副本）',
  12: 'E4 交互未坏（搜索/过滤/主题/锚点）',
  13: 'E5 file:// 直开 390px',
  14: 'F1 搜索索引懒加载 + 命中集排序不变',
  15: '无障碍（reduced-motion / focus-visible / 双向滚动 / 裁剪祖先双检）',
  16: '性能（4×CPU + Slow 4G：FCP / DCL 前可交互 / 按键长任务）',
};

async function main() {
  const fp = fingerprint();
  const preFp = preFingerprint();
  const a3 = longPagesSample();
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')); } catch { prev = null; }
  const exe = browserPath();
  const preOk = PRE_ON ? await httpOk(PRE_BASE + '/') : false;
  if (PRE_ON && !preOk) console.log('!! 改前实例不可达（' + PRE_BASE + '）→ E1/E2 记 partial；可用 --no-pre 显式关闭');

  const browser = await launch();
  const ctx = {
    browser, a3: () => a3, pre: preOk, log: (s) => console.log(s),
    rankOffline: typeof rankOffline === 'function' ? rankOffline : null,
  };
  const results = [];
  for (const c of CHECKS) {
    if (ONLY.length && ONLY.indexOf(c.id) === -1) continue;
    const t0 = Date.now();
    const guardBefore = fpGuard();
    let r;
    console.log(`... #${c.id} [item ${c.item}] ${c.key} ${c.title}`);
    try { r = await c.run(ctx); } catch (e) { r = { verdict: 'error', metrics: {}, failures: [String((e && e.stack) || e).slice(0, 600)] }; }
    const guardAfter = fpGuard();
    r.id = c.id; r.item = c.item; r.key = c.key; r.title = c.title; r.assertion = c.assertion;
    r.ms = Date.now() - t0; r.run_at = new Date().toISOString();
    r.fingerprint_before = guardBefore.str;
    r.fingerprint_after = guardAfter.str;
    r.fingerprint_at_run = guardAfter.str;
    r.fingerprint_changed_during_check = guardBefore.str !== guardAfter.str;
    if (r.fingerprint_changed_during_check) {
      /* 并发写者（F6 搜索性能修复 Agent / 主 Agent）在本项运行期间重写了产物 → 不给可能失真的 pass/fail */
      r.raw_verdict = r.verdict;
      r.verdict = 'unstable';
      r.failures = ['指纹不稳定，需重跑：本项运行期间产物指纹变化 → ' + GUARD_FILES.map((f) => f + ': ' + guardBefore.map[f] + ' → ' + guardAfter.map[f]).filter((s) => s.split(': ')[1] !== s.split(' → ')[1]).join(' ; ')];
    }
    results.push(r);
    const icon = r.verdict === 'pass' ? 'PASS' : (r.verdict === 'fail' ? 'FAIL' : String(r.verdict).toUpperCase());
    console.log(`${icon}  #${String(c.id).padStart(2)} [item ${String(c.item).padStart(2)}] ${c.key.padEnd(8)} ${c.title}  (${(r.ms / 1000).toFixed(1)}s)  ${r.failures && r.failures.length ? '失败 ' + r.failures.length + ' 项' : ''}`);
    for (const f of (r.failures || []).slice(0, 5)) console.log('      - ' + String(f).slice(0, 240));
  }
  await browser.close();
  const fpAfter = fingerprint();

  /* 合并历史：**只合并同一 schema 的本轮结果**；前任/兄弟实例的结果原样保留进 legacy_checks（口径不同，不参与本轮判定） */
  const currentKeys = new Set(CHECKS.map((c) => c.key));
  const prevChecks = (prev && Array.isArray(prev.checks)) ? prev.checks : [];
  const prevSameSchema = !!(prev && prev.harness === HARNESS && prev.schema_version === 3);
  const legacy = [];
  const byKey = new Map();
  const ranIds = new Set(results.map((r) => r.id));
  for (const c of prevChecks) {
    const k = c.key || ('id' + c.id);
    if (prevSameSchema && currentKeys.has(k)) {
      /* 本轮没重跑的检查：保留旧判定，但显式标注“非本次进程实测 + 其绑定的指纹”，指纹与当前一致才算仍然有效 */
      if (!ranIds.has(c.id)) {
        const prevGuard = c.fingerprint_at_run || null;
        const curGuard = fpGuard().str;
        c.not_rerun_this_round = true;
        c.measured_fingerprint = prevGuard;
        c.fingerprint_matches_now = prevGuard === curGuard;
        c.stale = !c.fingerprint_matches_now;
      }
      byKey.set(k, c);
    } else legacy.push(c);
  }
  for (const r of results) byKey.set(r.key, r);
  const checks = Array.from(byKey.values()).filter((c) => currentKeys.has(c.key)).sort((a, b) => a.id - b.id);

  /* 16 项汇总：item → checks[]（严重度取最坏：error > fail > partial > pass）
   * 特例：check 6 一个检查覆盖 item 6/7/8（C1/C2/C3 三项），按各子断言分别给判定，
   *       不让 C3 桌面档的 partial 把已经通过的 C1/C2 也拖成 partial。 */
  const SEV = { pass: 0, partial: 1, fail: 2, unstable: 3, error: 4 };
  const itemsOf = (c) => (c.key === 'C1-C3' ? [6, 7, 8] : [(c.item === undefined ? c.id : c.item)]);
  const itemVerdictFromCheck = (c, item) => {
    if (c.verdict === 'unstable') return 'unstable';   // 指纹不稳定 → 整项“需重跑”，不给 pass/fail
    if (c.key === 'C1-C3') {
      const m = c.metrics || {};
      if (item === 6) return m.C1 ? 'pass' : 'fail';
      if (item === 7) return m.C2 ? 'pass' : 'fail';
      if (item === 8) return (m.C3_mobile && m.C3_desktop) ? (m.C3_desktop_judged ? 'pass' : 'partial') : 'fail';
    }
    return c.verdict;
  };
  const byItem = {};
  for (const c of checks) {
    for (const it of itemsOf(c)) {
      const k = String(it);
      byItem[k] = byItem[k] || { item: Number(k), title: ITEM_TITLES[Number(k)] || '', checks: [], verdict: 'pass', measured_now: true, fingerprint_at_run: c.fingerprint_at_run || null };
      const v = itemVerdictFromCheck(c, Number(k));
      byItem[k].checks.push({ id: c.id, key: c.key, verdict: v, check_verdict: c.verdict, ms: c.ms, fingerprint_at_run: c.fingerprint_at_run || null, not_rerun_this_round: !!c.not_rerun_this_round, stale: !!c.stale });
      if (c.stale) byItem[k].measured_now = false;   // 只有“绑定指纹与当前不一致”才算非当前有效实测
      if ((SEV[v] || 0) > (SEV[byItem[k].verdict] || 0)) byItem[k].verdict = v;
    }
  }
  const items = Object.values(byItem).sort((a, b) => a.item - b.item);
  const run = { at: new Date().toISOString(), fingerprint: fp._all, pre_fingerprint: preFp._all, pre_available: preOk, ran: results.map((r) => ({ id: r.id, item: r.item, key: r.key, verdict: r.verdict, fingerprint_changed: !!r.fingerprint_changed_during_check })) };
  const runs = ((prev && prev.runs) || []).concat([run]).slice(-60);

  const out = {
    tool: 'tools/verify-mobile.js',
    harness: HARNESS,
    schema_version: 3,
    role: '独立验证 Agent（Independent Verifier）—— 不采信执行者自报数字，全部结论由本脚本真机实测',
    generated_at: new Date().toISOString(),
    base_url: BASE,
    pre_url: PRE_BASE,
    pre_instance_available: preOk,
    pre_instance_archive: preOk ? null : ARCHIVED_PRE,
    shadow_repo: SHADOW,
    shadow_exists: fs.existsSync(SHADOW),
    browser: exe,
    fingerprint: fp,
    fingerprint_after_run: fpAfter,
    fingerprint_stable: fpAfter._all === fp._all,
    pre_fingerprint: preFp,
    legacy_note: 'legacy_checks = 前任/兄弟实例在本文件里留下的历史结果（schema_version≠3 或 key 已改名），'
      + '原样保留以便追溯，但**不参与本轮任何判定**（口径不同：前任用 id 编号 + 依赖已污染的 prechange_snapshot）',
    a3_sample: a3.pages,
    a3_rule: a3.rule,
    a3_required_substitution: A3_REQUIRED_SUBSTITUTION,
    /* 并发写者防护：本轮结论绑定的指纹 + 逐项指纹稳定性 */
    stability: {
      guard_files: GUARD_FILES,
      fingerprint_all: fp._all,
      fingerprint_components: fp,
      fingerprint_before_run: fp._all,
      fingerprint_after_run: fpAfter._all,
      stable_during_run: fpAfter._all === fp._all,
      per_check: checks.map((c) => ({
        id: c.id, key: c.key, item: c.item,
        fingerprint_before: c.fingerprint_before || null,
        fingerprint_after: c.fingerprint_after || null,
        changed_during_check: !!c.fingerprint_changed_during_check,
        verdict: c.verdict, raw_verdict: c.raw_verdict || null,
        not_rerun_this_round: !!c.not_rerun_this_round, stale: !!c.stale, ms: c.ms,
      })),
      unstable_keys: checks.filter((c) => c.verdict === 'unstable').map((c) => c.key),
      statement: '每项检查前后各取一次产物指纹（' + GUARD_FILES.join(' / ') + ' 的 sha256 前 12 位）；'
        + '检查期间指纹变化 → 该项 verdict=unstable（"指纹不稳定，需重跑"），不输出可能失真的 pass/fail；'
        + '整轮 run 前后指纹不一致 → stable_during_run=false，本轮全部结论需重跑。',
    },
    item_map: ITEM_TITLES,
    summary: {
      checks_total: checks.length,
      pass: checks.filter((c) => c.verdict === 'pass').length,
      fail: checks.filter((c) => c.verdict === 'fail').length,
      error: checks.filter((c) => c.verdict === 'error').length,
      partial: checks.filter((c) => c.verdict === 'partial').length,
      fail_ids: checks.filter((c) => c.verdict !== 'pass').map((c) => c.id),
      fail_keys: checks.filter((c) => c.verdict !== 'pass').map((c) => c.key),
      items_total: items.length,
      items_pass: items.filter((i) => i.verdict === 'pass').length,
      items_partial: items.filter((i) => i.verdict === 'partial').map((i) => i.item),
      items_fail: items.filter((i) => i.verdict === 'fail' || i.verdict === 'error').map((i) => i.item),
      unstable_ids: checks.filter((c) => c.verdict === 'unstable').map((c) => c.id),
      unstable_keys: checks.filter((c) => c.verdict === 'unstable').map((c) => c.key),
      items_unstable: items.filter((i) => i.verdict === 'unstable').map((i) => i.item),
      items_measured_now: items.filter((i) => i.measured_now).length,
      not_rerun_checks: checks.filter((c) => c.not_rerun_this_round).map((c) => c.id),
      ran_now: results.map((r) => r.id),
    },
    items,
    checks,
    legacy_checks: legacy,
    runs,
    /* 前任（第 1–2 轮）留下的改前快照：**保留但标注不可信**，不再参与任何判定 */
    prechange_snapshot_legacy: (prev && prev.prechange_snapshot) ? {
      note: '前任在第 1–2 轮写入的"改前快照"。实测其 fingerprint='
        + ((prev.prechange_snapshot.fingerprint && prev.prechange_snapshot.fingerprint._all) || '?')
        + '，与当前源码指纹 ' + fp._all + ' 不一致，且 desktop 行数为 '
        + ((prev.prechange_snapshot.desktop || []).length) + '（空）→ 本轮**不采信**，改前对照一律用活的改前实例 ' + PRE_BASE,
      captured_at: prev.prechange_snapshot.captured_at || null,
      fingerprint_all: (prev.prechange_snapshot.fingerprint && prev.prechange_snapshot.fingerprint._all) || null,
      desktop_rows: (prev.prechange_snapshot.desktop || []).length,
    } : null,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');

  console.log('\n──── 16 项汇总 ────');
  for (const it of items) {
    const icon = it.verdict === 'pass' ? 'PASS' : (it.verdict === 'fail' ? 'FAIL' : String(it.verdict).toUpperCase());
    console.log(`${icon}  item ${String(it.item).padStart(2)}  ${(ITEM_TITLES[it.item] || '').padEnd(46)} checks=[${it.checks.map((c) => c.id + ':' + c.verdict).join(', ')}]`);
  }
  console.log(`\nfingerprint(改后)=${fp._all}  fingerprint(改前)=${preFp._all}  pre_instance=${preOk ? 'ON ' + PRE_BASE : 'OFF'}  stable_during_run=${fpAfter._all === fp._all}`);
  console.log(`checks=${out.summary.checks_total} pass=${out.summary.pass} fail=${out.summary.fail} partial=${out.summary.partial} unstable=${out.summary.unstable_ids.length} error=${out.summary.error}  16 项通过=${out.summary.items_pass}/${out.summary.items_total}`);
  if (out.summary.items_unstable.length) console.log('!! 指纹不稳定，需重跑的 item：' + JSON.stringify(out.summary.items_unstable));
  console.log('wrote ' + path.relative(REPO, OUT_JSON));
  if (PRINT_JSON) console.log(JSON.stringify(out.summary));
  if (out.summary.fail || out.summary.error) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL ' + ((e && e.stack) || e)); process.exit(2); });
