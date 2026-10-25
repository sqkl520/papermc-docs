'use strict';
/**
 * b2b2-lib.js — 批 2/3 基线实测共享装置（只读；不改仓库任何源码/产物）
 *
 * 三方：
 *   new = http://127.0.0.1:8787                     当前工作树 = 批 0 + 批 1
 *   b0  = 8787 页面 + fcdf3e1 的 assets/{site.css,site.js,search-index.js}
 *         + 批 1 改写过的 HTML（index/all-pages/snapshots）也从 fcdf3e1 取
 *         ⇒ 只有批 0。page.route 内存注入，不落仓库。
 *   old = http://127.0.0.1:8788                     ..\_pre-mobile @ a19a6c2（批 0 之前）
 *
 * b0 的 assets 副本另存 TMPDIR\b2b0\ 供人工核对（不写入仓库）。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(require("os").tmpdir() || '.', 'b2b2');
const B0_DIR = path.join(require("os").tmpdir() || '.', 'b2b0');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(B0_DIR, { recursive: true });

const B0_REF = 'fcdf3e1';
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1234', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

function gitShow(rev, file) {
  return execFileSync('git', ['show', rev + ':' + file], { cwd: ROOT, maxBuffer: 1 << 28 }).toString('utf8');
}

function changedSinceB0() {
  const out = execFileSync('git', ['diff', '--name-only', B0_REF, 'HEAD', '--', 'assets/', '*.html'], {
    cwd: ROOT, maxBuffer: 1 << 26,
  }).toString('utf8').trim();
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

const B0_FILES = new Map();
for (const f of changedSinceB0()) {
  if (!/\.(css|js|html)$/.test(f)) continue;
  const type = f.endsWith('.css') ? 'text/css; charset=utf-8'
    : f.endsWith('.js') ? 'application/javascript; charset=utf-8'
      : 'text/html; charset=utf-8';
  B0_FILES.set('/' + f.replace(/\\/g, '/'), { file: f, type });
}

/** 把 b0 的 assets 副本落 TMPDIR\b2b0\ 备查（任务书要求的 b0 口径，落点改到 temp） */
function dumpB0() {
  const done = [];
  for (const key of ['assets/site.css', 'assets/site.js']) {
    const p = path.join(B0_DIR, path.basename(key));
    fs.writeFileSync(p, gitShow(B0_REF, key), 'utf8');
    done.push(p);
  }
  return done;
}

function b0DocumentFor(pathname) {
  const p = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  const key = p.replace(/^\//, '');
  return B0_FILES.get('/' + key) || null;
}

const log = (o) => process.stdout.write(JSON.stringify(o) + '\n');

async function launch() {
  if (!EXE) throw new Error('no chrome executable found');
  return chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
}

async function makeContext(browser, build, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({
    viewport: { width: o.width || 1440, height: o.height || 900 },
    deviceScaleFactor: 1,
    colorScheme: o.colorScheme || 'light',
    reducedMotion: 'reduce',
    bypassCSP: true,
  });
  if (build === 'b0') {
    await ctx.route('**/*', async (route) => {
      const req = route.request();
      let u;
      try { u = new URL(req.url()); } catch { return route.continue(); }
      if (u.hostname !== '127.0.0.1' || u.port !== '8787') return route.continue();
      const p = decodeURIComponent(u.pathname);
      if (req.resourceType() === 'document') {
        const hit = b0DocumentFor(p);
        if (hit) return route.fulfill({ status: 200, contentType: hit.type, body: gitShow(B0_REF, hit.file) });
        return route.continue();
      }
      const hit = B0_FILES.get(p);
      if (hit) return route.fulfill({ status: 200, contentType: hit.type, body: gitShow(B0_REF, hit.file) });
      return route.continue();
    });
  }
  return ctx;
}

function baseUrl(build) {
  return build === 'old' ? OLD : NEW;
}

/* ------------------------------------------------------------------ *
 * 采集脚本（page.evaluate 用，只依赖 DOM/CSSOM，不依赖站点 JS）
 * ------------------------------------------------------------------ */
const MEASURE_FN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: r2(b.x), y: r2(b.y + window.scrollY), w: r2(b.width), h: r2(b.height) };
  };
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);

  const article = q('article.article') || q('article');
  const content = q('main.content') || q('.content');
  const toc = q('.toc-side');

  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = article ? [...article.querySelectorAll('p')].filter(isProse) : [];

  // '0' advance：canvas 实测（不用 0.5em 近似）
  const zeroCache = new Map();
  const zeroFor = (st) => {
    const key = st.fontSize + '|' + st.fontFamily;
    if (zeroCache.has(key)) return zeroCache.get(key);
    const cv = document.createElement('canvas').getContext('2d');
    cv.font = st.fontSize + ' ' + st.fontFamily;
    const w = cv.measureText('0').width;
    zeroCache.set(key, w);
    return w;
  };

  const measureEl = (el) => {
    if (!el) return null;
    const st = getComputedStyle(el);
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    if (!rects.length) return null;
    const lineW = Math.max(...rects.map((r) => r.width));
    const eb = el.getBoundingClientRect();
    const padL = parseFloat(st.paddingLeft) || 0;
    const padR = parseFloat(st.paddingRight) || 0;
    const capW = Math.max(eb.width - padL - padR, lineW);
    const zeroW = zeroFor(st);
    return {
      lineW: r2(lineW), capW: r2(capW), zeroW: r2(zeroW),
      chLine: zeroW > 0 ? Math.round(lineW / zeroW) : null,
      chCap: zeroW > 0 ? Math.round(capW / zeroW) : null,
      cjkCap: Math.round(capW / parseFloat(st.fontSize)),
      lines: rects.length,
      fontSize: r2(parseFloat(st.fontSize)),
      lineHeight: st.lineHeight === 'normal' ? null : r2(parseFloat(st.lineHeight)),
      left: r2(eb.left),
    };
  };

  let prose = null;
  let globalMaxLine = 0;
  let globalLines = 0;
  let proseLeft = null;
  for (const p of paras) {
    const m = measureEl(p);
    if (!m) continue;
    if (m.lineW > globalMaxLine) globalMaxLine = m.lineW;
    globalLines += m.lines;
    if (proseLeft == null) proseLeft = m.left;
    if (!prose || m.capW > prose.capW) prose = { ...m, sample: (p.textContent || '').trim().slice(0, 40) };
  }
  if (prose) {
    prose.lineWGlobal = r2(globalMaxLine);
    prose.chLineGlobal = prose.zeroW > 0 ? Math.round(globalMaxLine / prose.zeroW) : null;
    prose.linesTotal = globalLines;
    prose.leftFirst = proseLeft;
  }

  // 代码块横滚：兼容 new（.code-scroll 包一层）与 old（pre 自己滚）
  const pres = [...document.querySelectorAll('pre.code-pre')];
  const codeOverflow = pres.filter((pre) => {
    const sc = pre.closest('.code-scroll') || pre;
    return sc.scrollWidth > sc.clientWidth + 1;
  }).length;

  const wrappers = [...document.querySelectorAll('.table-wrap')];
  const tableOverflow = wrappers.filter((w) => w.scrollWidth > w.clientWidth + 1).length;

  const tb = box(toc);
  const ab = box(article);
  const tocVisible = !!(toc && cs(toc, 'display') !== 'none' && toc.getBoundingClientRect().width > 0);
  let tocMode = 'hidden';
  if (tocVisible && tb) {
    if (tb.w < 400 && tb.w < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.w - 2) tocMode = 'rail';
    else tocMode = 'top-block';
  }

  return {
    url: location.pathname,
    title: document.title,
    vw: window.innerWidth,
    pageHeight: document.documentElement.scrollHeight,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    layoutCols: cs(q('.layout'), 'gridTemplateColumns'),
    article: ab,
    articleClientW: article ? article.clientWidth : null,
    content: box(content),
    contentClientW: content ? content.clientWidth : null,
    contentMaxW: content ? cs(content, 'maxWidth') : null,
    contentPad: content ? { l: cs(content, 'paddingLeft'), r: cs(content, 'paddingRight') } : null,
    toc: tb,
    tocDisplay: cs(toc, 'display'),
    tocVisible,
    tocMode,
    prose,
    proseCount: paras.length,
    code: { blocks: pres.length, overflow: codeOverflow },
    tables: { blocks: wrappers.length, overflow: tableOverflow },
  };
};

async function gotoAndMeasure(page, url, waitMs) {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(waitMs == null ? 150 : waitMs);
  return page.evaluate(MEASURE_FN);
}

function save(name, obj) {
  const f = path.join(TMP, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 1), 'utf8');
  return f;
}

module.exports = {
  ROOT, TMP, B0_DIR, NEW, OLD, EXE, B0_REF, B0_FILES, changedSinceB0, dumpB0,
  launch, makeContext, baseUrl, gotoAndMeasure, MEASURE_FN, log, save, gitShow,
};
