'use strict';
/**
 * b1s-attrib.js — 冲突 2 & 3：几何/页高的三方归属切分 + H1 基线出处
 *
 * 三个构建，全部由本脚本同进程、同视口、同页面测出，避免跨报告口径漂移：
 *   new = 8787 原样           = 批 0 + 批 1
 *   b0  = 8787 HTML + HEAD 的 assets/site.css + site.js（page.route 注入）
 *                             = 只有批 0（批 1 的未提交改动全部回滚）
 *   old = 8788（worktree ..\_pre-mobile @ a19a6c2）= 批 0 之前
 *
 * 另做逐项回滚（只在 new 上 addStyleTag）：
 *   r-gutter  : html.nav-locked{scrollbar-gutter:auto}   （冲突 1 的根因验证）
 *   r-copy    : .code-copy 还原 21.2px 高（隔离 P0-3 对 pageHeight 的贡献）
 *   r-pad     : .content 横向 padding 还原 2rem（隔离批 0 的列宽改动）
 *
 * 只读站点；结果写 <tmp>\b1s\attrib.json。用法: node tools/b1s-attrib.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(process.env.TEMP || '.', 'b1s');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';

// HEAD = 批 0 的最后一次提交（批 1 是未提交工作区改动）
const HEAD_CSS = require('child_process').execSync('git show HEAD:assets/site.css', { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8');
const HEAD_JS = require('child_process').execSync('git show HEAD:assets/site.js', { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8');
const HEAD_SHA = require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();

const PAGES = [
  ['particles', '/paper/dev/particles/index.html'],   // 83 TOC / 46 代码块
  ['dialogs', '/paper/dev/dialogs/index.html'],       // 24 TOC / 9 代码块
  ['worldcfg', '/paper/reference/world-configuration/index.html'], // 无 TOC?
  ['landing', '/index.html'],                          // 无 article / 109 源树行
];
const VPS = [
  ['1440x900', 1440, 900],
  ['1280x800', 1280, 800],
  ['1200x800', 1200, 800],
  ['1025x800', 1025, 800],
  ['1024x800', 1024, 800],
  ['768x1024', 768, 1024],
  ['390x844', 390, 844],
];

const log = (o) => console.log(JSON.stringify(o));

async function installB0(page) {
  await page.route('**/assets/site.css', (r) => r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: HEAD_CSS }));
  await page.route('**/assets/site.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: HEAD_JS }));
}

async function measure(page, pagePath) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(2), y: +(b.y + window.scrollY).toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; };
    const art = q('article.article') || q('article') || q('main.content');
    const content = q('.content');
    const toc = q('.toc-side');
    const fold = q('.toc-fold');
    const h1 = q('article h1, h1');
    const cs = content ? getComputedStyle(content) : null;
    return {
      article: box(art), h1: box(h1), toc: box(toc),
      tocDisplay: toc ? getComputedStyle(toc).display : null,
      tocPosition: toc ? getComputedStyle(toc).position : null,
      foldOpen: fold ? fold.open : null,
      contentPad: cs ? { l: cs.paddingLeft, r: cs.paddingRight, t: cs.paddingTop } : null,
      layoutCols: (() => { const l = q('.layout'); return l ? getComputedStyle(l).gridTemplateColumns : null; })(),
      pageHeight: document.documentElement.scrollHeight,
      docW: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
      tocOffsetVar: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
      scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
      copyH: (() => { const c = q('.code-copy'); if (!c) return null; const b = c.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; })(),
      codeBlocks: document.querySelectorAll('.code-block').length,
      codeAdvances: (() => {
        const pre = q('.code-scroll pre.code-pre, pre.code-pre');
        if (!pre) return null;
        const r = document.createRange(); const tn = pre.querySelector('code') || pre;
        const lines = (tn.textContent || '').split('\n');
        if (lines.length < 3) return null;
        const rects = []; let idx = 0;
        for (let i = 0; i < Math.min(3, lines.length); i++) {
          if (!lines[i]) { idx += 1; continue; }
          r.setStart(tn.firstChild, Math.min(tn.firstChild.length, idx));
          r.setEnd(tn.firstChild, Math.min(tn.firstChild.length, idx + 1));
          const b = r.getBoundingClientRect(); rects.push(+b.top.toFixed(2));
          idx += lines[i].length + 1;
        }
        return rects.length > 1 ? +(rects[1] - rects[0]).toFixed(2) : null;
      })(),
    };
  });
}

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { meta: { headSha: HEAD_SHA, headCssBytes: HEAD_CSS.length, headJsBytes: HEAD_JS.length, newCssBytes: fs.statSync(path.join(ROOT, 'assets/site.css')).size }, rows: [] };
  log({ build: out.meta });

  for (const [vpName, w, h] of VPS) {
    for (const [pageName, pagePath] of PAGES) {
      // --- new ---
      const ctxN = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const pageN = await ctxN.newPage();
      let rN = null;
      try {
        await pageN.goto(NEW + pagePath, { waitUntil: 'load' });
        await pageN.waitForTimeout(300);
        rN = await measure(pageN, pagePath);
      } catch (e) { rN = { error: String(e && e.message).slice(0, 120) }; }
      await ctxN.close();

      // --- new + 逐项回滚（只测 1440 / 390 两个关键档） ---
      let rCopy = null, rPad = null, rGutter = null;
      if (vpName === '1440x900' || vpName === '1025x800') {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        const p = await ctx.newPage();
        await p.goto(NEW + pagePath, { waitUntil: 'load' });
        await p.addStyleTag({ content: '.code-copy{min-height:21.2px !important;min-width:0 !important}' });
        await p.waitForTimeout(250);
        rCopy = await measure(p, pagePath);
        await ctx.close();

        const ctx2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        const p2 = await ctx2.newPage();
        await p2.goto(NEW + pagePath, { waitUntil: 'load' });
        await p2.addStyleTag({ content: '.content{padding-left:2rem !important;padding-right:2rem !important}' });
        await p2.waitForTimeout(250);
        rPad = await measure(p2, pagePath);
        await ctx2.close();
      }
      if (vpName === '390x844') {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        const p = await ctx.newPage();
        await p.goto(NEW + pagePath, { waitUntil: 'load' });
        await p.addStyleTag({ content: 'html.nav-locked{scrollbar-gutter:auto !important}' });
        await p.waitForTimeout(200);
        rGutter = { installed: true };
        await ctx.close();
      }

      // --- b0 = HEAD 的 css/js（批 0 only） ---
      const ctxB = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const pageB = await ctxB.newPage();
      let rB = null;
      try {
        await installB0(pageB);
        await pageB.goto(NEW + pagePath, { waitUntil: 'load' });
        await pageB.waitForTimeout(300);
        // 批 0 的 HTML 是 <details class="toc-fold" open>：默认展开。工作区 HTML 去掉了 open，
        // 这里手动补回，才能还原"批 0 真实状态"。
        await pageB.evaluate(() => { document.querySelectorAll('.toc-fold').forEach((d) => { d.open = true; }); });
        await pageB.waitForTimeout(120);
        rB = await measure(pageB, pagePath);
      } catch (e) { rB = { error: String(e && e.message).slice(0, 120) }; }
      await ctxB.close();

      // --- old = 8788 ---
      const ctxO = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const pageO = await ctxO.newPage();
      let rO = null;
      try {
        await pageO.goto(OLD + pagePath, { waitUntil: 'load' });
        await pageO.waitForTimeout(300);
        rO = await measure(pageO, pagePath);
      } catch (e) { rO = { error: String(e && e.message).slice(0, 120) }; }
      await ctxO.close();

      const row = { vp: vpName, page: pageName, new: rN, b0: rB, old: rO, rCopy, rPad };
      out.rows.push(row);
      log({
        vp: vpName, page: pageName,
        artW: [rN && rN.article && rN.article.w, rB && rB.article && rB.article.w, rO && rO.article && rO.article.w],
        artX: [rN && rN.article && rN.article.x, rB && rB.article && rB.article.x, rO && rO.article && rO.article.x],
        h1Y: [rN && rN.h1 && rN.h1.y, rB && rB.h1 && rB.h1.y, rO && rO.h1 && rO.h1.y],
        pageH: [rN && rN.pageHeight, rB && rB.pageHeight, rO && rO.pageHeight],
        pageH_copyRollback: rCopy && rCopy.pageHeight,
        pageH_padRollback: rPad && rPad.pageHeight,
        tocH: [rN && rN.toc && rN.toc.h, rB && rB.toc && rB.toc.h, rO && rO.toc && rO.toc.h],
        tocPos: [rN && rN.tocPosition, rB && rB.tocPosition, rO && rO.tocPosition],
        foldOpen: [rN && rN.foldOpen, rB && rB.foldOpen, rO && rO.foldOpen],
        contentPad: [rN && rN.contentPad, rB && rB.contentPad, rO && rO.contentPad],
        cols: [rN && rN.layoutCols, rB && rB.layoutCols, rO && rO.layoutCols],
        copyH: [rN && rN.copyH, rB && rB.copyH, rO && rO.copyH],
        advances: [rN && rN.codeAdvances, rB && rB.codeAdvances, rO && rO.codeAdvances],
        scrollPadTop: [rN && rN.scrollPadTop, rB && rB.scrollPadTop, rO && rO.scrollPadTop],
        tocOffsetVar: [rN && rN.tocOffsetVar, rB && rB.tocOffsetVar, rO && rO.tocOffsetVar],
      });
    }
  }

  fs.writeFileSync(path.join(TMP, 'attrib.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE ' + path.join(TMP, 'attrib.json'));
  await browser.close();
})();
