'use strict';
/**
 * b1s-drift2.js — 冲突 1 定案：开抽屉位移归「批 0」还是「批 1」
 *
 * b1s-drift.js 已证明触发条件 = html.nav-locked{scrollbar-gutter:stable}。
 * 该规则与 .sidebar{position:fixed} 在 HEAD（批 0）里**逐字相同**（本脚本先做文本比对并打印），
 * 因此预期 b0 也会漂移。本脚本用 b0 构建（8787 HTML + HEAD 的 css/js）实测确认，
 * 并顺带测「批 0 HTML（TOC 默认展开）」对位移量的影响。
 *
 * 变体：
 *   new        = 批 0 + 批 1
 *   b0         = HEAD css/js + 批 1 的折叠 HTML
 *   b0-open    = HEAD css/js + 把 .toc-fold 补回 open（批 0 原始 HTML）
 * 每组测：浅滚(0.1) / 中滚(0.5) / 深滚(0.95) 三个深度，真实鼠标点击。
 * 只读站点；写 <tmp>\b1s\drift2.json。
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
const PAGE = '/paper/dev/particles/index.html';
const log = (o) => console.log(JSON.stringify(o));

const HEAD_CSS = require('child_process').execSync('git show HEAD:assets/site.css', { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8');
const HEAD_JS = require('child_process').execSync('git show HEAD:assets/site.js', { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8');

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(2); }
  const out = { cssDiff: {}, rows: [] };

  // ---- 文本比对：抽屉相关规则在 HEAD 与工作区是否逐字相同 ----
  const curCss = fs.readFileSync(path.join(ROOT, 'assets/site.css'), 'utf8');
  const patterns = ['html.nav-locked{scrollbar-gutter:stable}', '.sidebar{position:fixed', 'body.nav-open .sidebar{transform:none}', '.nav-scrim{'];
  for (const p of patterns) {
    out.cssDiff[p] = { inHead: HEAD_CSS.includes(p), inCur: curCss.includes(p) };
  }
  log({ m: 'CSSDIFF', d: out.cssDiff });
  // site.js 抽屉函数文本比对
  const curJs = fs.readFileSync(path.join(ROOT, 'assets/site.js'), 'utf8');
  const grab = (s, start, len) => { const i = s.indexOf(start); return i < 0 ? null : s.slice(i, i + len); };
  const jsKeys = ['function lockScroll(on)', 'var savedY = window.pageYOffset', 'if (supportsGutter)'];
  for (const k of jsKeys) {
    out.cssDiff['js:' + k] = { inHead: HEAD_JS.includes(k), inCur: curJs.includes(k) };
  }
  log({ m: 'JSDIFF', d: jsKeys.map((k) => k + '=' + HEAD_JS.includes(k) + '/' + curJs.includes(k)).join(' ') });

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  for (const variant of ['new', 'b0', 'b0-open']) {
    for (const frac of [0.1, 0.5, 0.95]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      if (variant !== 'new') {
        await page.route('**/assets/site.css', (r) => r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: HEAD_CSS }));
        await page.route('**/assets/site.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: HEAD_JS }));
      }
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(350);
      if (variant === 'b0-open') {
        await page.evaluate(() => { document.querySelectorAll('.toc-fold').forEach((d) => { d.open = true; }); });
        await page.waitForTimeout(200);
      }
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.evaluate((f) => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * f)), frac);
      await page.waitForTimeout(400);
      const y0 = await page.evaluate(() => Math.round(window.scrollY));
      const pre = await page.evaluate(() => ({ scrollH: document.documentElement.scrollHeight, tocH: (() => { const t = document.querySelector('.toc-side'); return t ? +t.getBoundingClientRect().height.toFixed(1) : null; })(), tocOpen: (() => { const f = document.querySelector('.toc-fold'); return f ? f.open : null; })(), gutter: getComputedStyle(document.documentElement).scrollbarGutter }));
      const tb = await page.evaluate(() => { const t = document.getElementById('nav-toggle'); const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; });
      await page.mouse.click(tb.x, tb.y);
      await page.waitForTimeout(500);
      const y1 = await page.evaluate(() => Math.round(window.scrollY));
      const opened = await page.evaluate(() => ({ scrollH: document.documentElement.scrollHeight, gutter: getComputedStyle(document.documentElement).scrollbarGutter, navOpen: document.body.classList.contains('nav-open'), ariaExpanded: document.getElementById('nav-toggle').getAttribute('aria-expanded') }));
      await page.mouse.click(tb.x, tb.y);
      await page.waitForTimeout(500);
      const y2 = await page.evaluate(() => Math.round(window.scrollY));
      const rec = { variant, frac, y0, y1, y2, dOpen: y1 - y0, dClose: y2 - y1, net: y2 - y0, pre, opened, toggle: tb };
      out.rows.push(rec);
      log({ m: 'D2', variant, frac, y0, dOpen: rec.dOpen, dClose: rec.dClose, net: rec.net, tocH: pre.tocH, tocOpen: pre.tocOpen, scrollH: [pre.scrollH, opened.scrollH], toggle: tb.w + 'x' + tb.h, ariaExpanded: opened.ariaExpanded });
      await ctx.close();
    }
  }

  fs.writeFileSync(path.join(TMP, 'drift2.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE ' + path.join(TMP, 'drift2.json'));
  await browser.close();
})();
