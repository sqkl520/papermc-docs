'use strict';
/**
 * critique-typo-p14.js — 终版方案端到端验证
 *
 *  E 组：38rem 行文封顶（>=768） + 右栏 TOC 断点上移到 1160 + 可选居中
 *  F 组：auto+系统深色下的 hljs token 补丁（把 dark 选择器补一份到 auto 上），
 *        在真实浏览器里复测对比度，确认补丁有效且 dark 路径不变。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const CAP = `@media (min-width:768px){
  .article > :is(p,ul,ol,blockquote,dl),
  .article li > :is(p,ul,ol){ max-width:38rem }
}`;
const TOCBP = `@media (min-width:1025px) and (max-width:1159px){
  .layout.has-toc{ grid-template-columns:290px minmax(0,1fr) }
  .toc-side{ display:none }
}`;
const CENTER = `@media (min-width:1200px){
  .layout.has-toc{ justify-content:center }
}`;

const GEO = () => {
  const art = document.querySelector('.article');
  const p = art.querySelector('p:not(.page-desc):not(.page-meta)');
  const cs = getComputedStyle(p);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = cs.fontSize + ' ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;
  const pr = p.getBoundingClientRect();
  const toc = document.querySelector('.toc-side');
  const tocVis = toc && getComputedStyle(toc).display !== 'none';
  return {
    vw: window.innerWidth,
    proseW: Math.round(pr.width),
    ch: Math.round((pr.width / zeroW) * 10) / 10,
    cjk: Math.round(pr.width / parseFloat(cs.fontSize)),
    tocVis,
    rightGap: Math.round(window.innerWidth - (pr.x + pr.width)),
    scrollH: Math.round(document.documentElement.scrollHeight),
    horiz: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    preScroll: [...document.querySelectorAll('.code-scroll')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
  };
};

/* auto+深色下补丁：把 dark 的 hljs 规则复制到 auto */
const HLJS_PATCH = `
@media (prefers-color-scheme: dark){
  html[data-theme="auto"] .hljs-comment,html[data-theme="auto"] .hljs-quote{color:#8b95a5}
  html[data-theme="auto"] .hljs-keyword,html[data-theme="auto"] .hljs-selector-tag,html[data-theme="auto"] .hljs-literal,html[data-theme="auto"] .hljs-section,html[data-theme="auto"] .hljs-doctag{color:#d2a8ff}
  html[data-theme="auto"] .hljs-string,html[data-theme="auto"] .hljs-regexp,html[data-theme="auto"] .hljs-addition,html[data-theme="auto"] .hljs-meta .hljs-string{color:#7ee787}
  html[data-theme="auto"] .hljs-number,html[data-theme="auto"] .hljs-bullet,html[data-theme="auto"] .hljs-symbol{color:#ffab70}
  html[data-theme="auto"] .hljs-title,html[data-theme="auto"] .hljs-title.function_,html[data-theme="auto"] .hljs-name,html[data-theme="auto"] .hljs-selector-id,html[data-theme="auto"] .hljs-selector-class,html[data-theme="auto"] .hljs-type,html[data-theme="auto"] .hljs-attr{color:#79c0ff}
  html[data-theme="auto"] .hljs-built_in,html[data-theme="auto"] .hljs-builtin-name,html[data-theme="auto"] .hljs-meta,html[data-theme="auto"] .hljs-tag{color:#ffa657}
  html[data-theme="auto"] .hljs-variable,html[data-theme="auto"] .hljs-template-variable,html[data-theme="auto"] .hljs-params,html[data-theme="auto"] .hljs-property{color:#ffa657}
  html[data-theme="auto"] .hljs-deletion{color:#ff6b6b}
}`;

const HLJS_MEASURE = () => {
  const parse = (s) => { const m = (s || '').match(/^rgba?\(([^)]+)\)$/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const R = (a, b) => Math.round(((Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05)) * 100) / 100;
  const cb = document.querySelector('.code-block');
  const bg = parse(cb ? getComputedStyle(cb).backgroundColor : 'rgb(255,255,255)');
  const out = [];
  for (const t of ['comment', 'keyword', 'string', 'number', 'title', 'built_in', 'variable']) {
    const el = document.querySelector('.hljs-' + t);
    if (!el) { out.push({ token: t, missing: true }); continue; }
    const c = parse(getComputedStyle(el).color);
    out.push({ token: t, color: getComputedStyle(el).color, ratio: R(c, bg), pass: R(c, bg) >= 4.5 });
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const res = { plan: [], hljs: {} };

  for (const w of [1440, 1280, 1200, 1160, 1159, 1100, 1025, 1024, 900, 768, 390, 320]) {
    for (const [name, css] of [['基线', ''], ['终版(CAP+TOCBP)', CAP + TOCBP], ['终版+居中', CAP + TOCBP + CENTER]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light', isMobile: w < 768, hasTouch: w < 768 });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
      if (css) await page.addStyleTag({ content: css });
      await page.waitForTimeout(130);
      res.plan.push({ name, ...(await page.evaluate(GEO)) });
      await ctx.close();
    }
  }

  /* hljs：三条路径 × 打补丁前后 */
  for (const path_ of [
    { k: 'light', cs: 'light', attr: 'light' },
    { k: 'dark', cs: 'dark', attr: 'dark' },
    { k: 'auto-dark', cs: 'dark', attr: 'auto' },
  ]) {
    for (const patch of [false, true]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: path_.cs });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
      await page.evaluate((a) => document.documentElement.setAttribute('data-theme', a), path_.attr);
      if (patch) await page.addStyleTag({ content: HLJS_PATCH });
      await page.waitForTimeout(180);
      res.hljs[path_.k + (patch ? '+patch' : '')] = await page.evaluate(HLJS_MEASURE);
      await ctx.close();
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p14.json'), JSON.stringify(res, null, 1), 'utf8');

  console.log('== 终版方案 ==');
  for (const w of [1440, 1280, 1200, 1160, 1159, 1100, 1025, 1024, 900, 768, 390, 320]) {
    const a = res.plan.find((r) => r.vw === w && r.name === '基线');
    const b = res.plan.find((r) => r.vw === w && r.name === '终版(CAP+TOCBP)');
    const c = res.plan.find((r) => r.vw === w && r.name === '终版+居中');
    console.log(String(w).padEnd(6) + '基线 ' + String(a.ch).padStart(6) + 'ch toc=' + (a.tocVis ? 'Y' : 'n') + '  -> 终版 ' + String(b.ch).padStart(6) + 'ch(' + b.cjk + ') toc=' + (b.tocVis ? 'Y' : 'n') + ' rGap=' + String(b.rightGap).padStart(4) + '  -> 居中 ' + String(c.ch).padStart(6) + 'ch rGap=' + String(c.rightGap).padStart(4) + (b.horiz ? ' !!HSCROLL' : ''));
  }
  console.log('');
  console.log('== hljs token ==');
  for (const k of Object.keys(res.hljs)) {
    const rows = res.hljs[k].filter((r) => !r.missing);
    const fails = rows.filter((r) => !r.pass).length;
    console.log(k.padEnd(16) + 'fails=' + fails + '/' + rows.length + '  ' + rows.map((r) => r.token + ':' + (r.ratio === undefined ? '?' : r.ratio)).join(' '));
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
