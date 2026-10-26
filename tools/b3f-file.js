'use strict';
/**
 * b3f-file.js — 批 3 的 `file://` 直开验证（零依赖、零网络）。
 *
 * 验收口径（ups-plan §7 每批「file:// 必验」）：
 *   · 首页 + 1 个内容页 + 1 个配置页，**直开 file://**
 *   · 0 请求失败（requestfailed）
 *   · 0 pageerror
 *   · CSS 变量（var(--fs-*)）在 file:// 与 http:// 下无差别 —— 通过「计算字号与 http 一致」验证
 *
 * 额外：把同一批页面在 http://127.0.0.1:8787 下再测一遍，逐页比对字号集合，
 * 证明「令牌化没有引入协议相关差异」。
 *
 * 用法：node tools/b3f-file.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PAGES = [
  ['首页', 'index.html', '/'],
  ['内容页', 'paper/dev/dialogs/index.html', '/paper/dev/dialogs/'],
  ['配置页', 'paper/reference/world-configuration/index.html', '/paper/reference/world-configuration/'],
];
const HTTP_BASE = 'http://127.0.0.1:8787';

const PROBE = () => {
  const cs = getComputedStyle;
  const inSvg = (el) => !!(el.closest && el.closest('svg'));
  const hasText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  const vis = (el) => {
    const c = cs(el);
    if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.getClientRects().length > 0;
  };
  const set = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (inSvg(el) || !hasText(el) || !vis(el)) continue;
    const px = parseFloat(cs(el).fontSize);
    if (px > 0) set.add(+px.toFixed(4));
  }
  const fsz = (sel) => { const e = document.querySelector(sel); return e ? +parseFloat(cs(e).fontSize).toFixed(4) : null; };
  /* 令牌是否真的解析成功：取 :root 上 4 个关键令牌的计算值 */
  const rootCs = cs(document.documentElement);
  const tok = (n) => rootCs.getPropertyValue(n).trim();
  return {
    levels: [...set].sort((a, b) => a - b),
    h1: fsz('.article h1') || fsz('.hero h1'),
    h2: fsz('.article h2'), h3: fsz('.article h3'), h4: fsz('.article h4'),
    tokens: { h1: tok('--fs-h1'), h2: tok('--fs-h2'), h3: tok('--fs-h3'), h4: tok('--fs-h4'), base: tok('--fs-base') },
    title: document.title,
    hasCss: !!document.querySelector('link[rel=stylesheet]'),
    hasJs: !!document.querySelector('script[src*="site.js"]'),
    searchIndex: !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages),
  };
};

async function run(browser, url, vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const failed = []; const errs = []; const consoleErrs = [];
  page.on('requestfailed', (r) => failed.push(r.url().split('/').pop() + ' :: ' + (r.failure() && r.failure().errorText)));
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(350);
  const m = await page.evaluate(PROBE);
  await ctx.close();
  return { failed, errs, consoleErrs, ...m };
}

(async () => {
  if (!EXE) throw new Error('找不到 chromium');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--force-color-profile=srgb', '--allow-file-access-from-files'] });
  const VP = { width: 1440, height: 900 };
  const out = { at: new Date().toISOString(), file: [], http: [] };

  console.log('\n════ 批 3 · file:// 直开验证 ════');
  for (const [label, rel] of PAGES) {
    const url = 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
    const r = await run(browser, url, VP);
    out.file.push({ label, rel, ...r });
    console.log('\n[' + label + '] file://' + rel);
    console.log('  请求失败 ' + r.failed.length + (r.failed.length ? '  ✗ ' + r.failed.join(' | ') : '  ✓'));
    console.log('  pageerror ' + r.errs.length + (r.errs.length ? '  ✗ ' + r.errs.join(' | ') : '  ✓'));
    console.log('  console.error ' + r.consoleErrs.length + (r.consoleErrs.length ? '  ⚠ ' + r.consoleErrs.join(' | ') : '  ✓'));
    console.log('  CSS 已加载=' + r.hasCss + '  site.js 已加载=' + r.hasJs + '  搜索索引=' + r.searchIndex);
    console.log('  令牌解析：--fs-h1=' + r.tokens.h1 + ' --fs-h2=' + r.tokens.h2 + ' --fs-h3=' + r.tokens.h3 + ' --fs-h4=' + r.tokens.h4 + ' --fs-base=' + r.tokens.base);
    console.log('  h1/h2/h3/h4 = ' + r.h1 + ' / ' + r.h2 + ' / ' + r.h3 + ' / ' + r.h4 + '   字号级数=' + r.levels.length);
  }

  /* http 对照 */
  let httpOk = true;
  try {
    const probe = await fetch(HTTP_BASE + '/', { signal: AbortSignal.timeout(3000) });
    httpOk = probe.ok;
  } catch (e) { httpOk = false; }
  if (!httpOk) {
    console.log('\n[http 对照] 127.0.0.1:8787 不可达，跳过（file:// 结果独立成立）');
  } else {
    for (const [label, rel, route] of PAGES) {
      const r = await run(browser, HTTP_BASE + route, VP);
      out.http.push({ label, rel, ...r });
      console.log('\n[' + label + '] http://' + route);
      console.log('  请求失败 ' + r.failed.length + '  pageerror ' + r.errs.length
        + '  h1=' + r.h1 + '  级数=' + r.levels.length);
    }
    /* 逐页比对字号集合 */
    console.log('\n[协议一致性] file:// vs http:// 字号集合比对');
    for (let i = 0; i < PAGES.length; i++) {
      const a = out.file[i]; const b = out.http[i];
      const same = JSON.stringify(a.levels) === JSON.stringify(b.levels);
      console.log('  ' + PAGES[i][0].padEnd(8) + (same ? '✓ 完全一致' : '✗ 不一致  file=' + a.levels.join(',') + '  http=' + b.levels.join(',')));
    }
  }
  await browser.close();

  const anyFail = out.file.some((r) => r.failed.length || r.errs.length);
  fs.writeFileSync(path.join(os.tmpdir(), 'b3f-file.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n════ ' + (anyFail ? 'file:// 有失败 ✗' : 'file:// 全部通过：0 请求失败 / 0 pageerror ✓') + ' ════');
  console.log('JSON → ' + path.join(os.tmpdir(), 'b3f-file.json'));
  process.exit(anyFail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
