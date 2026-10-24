'use strict';
// 在真实浏览器里验证 h5 在 4 个页面上的实际渲染（字号/颜色/对比度 vs 正文）
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PAGES = [
  '/paper/reference/cli-arguments/',
  '/paper/dev/pdc/',
  '/paper/dev/using-databases/',
  '/paper/dev/scheduler/',
];

const PROBE = () => {
  const parse = (s) => { const m = (s || '').match(/^rgba?\(([^)]+)\)$/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const R = (a, b) => Math.round(((Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05)) * 100) / 100;
  const art = document.querySelector('.article');
  const h5s = [...art.querySelectorAll('h5')];
  const bodyP = art.querySelector('p:not(.page-desc):not(.page-meta)');
  const bcs = bodyP ? getComputedStyle(bodyP) : null;
  const rows = h5s.map((h) => {
    const cs = getComputedStyle(h);
    const fg = parse(cs.color);
    /* 背景取到 body 白底 */
    return {
      text: (h.textContent || '').trim().slice(0, 40),
      fs: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      color: cs.color,
      ratio: R(fg, [255, 255, 255]),
    };
  });
  return {
    h5Count: h5s.length,
    bodyFs: bcs ? parseFloat(bcs.fontSize) : null,
    bodyColor: bcs ? bcs.color : null,
    bodyRatio: bcs ? R(parse(bcs.color), [255, 255, 255]) : null,
    rows: rows.slice(0, 6),
    /* h5 是否比正文更小或更淡 */
    weakerThanBody: rows.length ? (rows[0].fs < (bcs ? parseFloat(bcs.fontSize) : 16) || rows[0].ratio < (bcs ? R(parse(bcs.color), [255, 255, 255]) : 16)) : null,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const out = {};
  for (const url of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(BASE + url, { waitUntil: 'load' });
    await page.waitForTimeout(180);
    out[url] = await page.evaluate(PROBE);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p23.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const k of Object.keys(out)) {
    const r = out[k];
    console.log('===== ' + k + '  h5=' + r.h5Count + '  body=' + r.bodyFs + 'px ' + r.bodyColor + ' (' + r.bodyRatio + ':1)');
    console.log('   weakerThanBody=' + r.weakerThanBody);
    for (const x of r.rows) console.log('   h5 ' + x.fs + 'px/' + x.weight + ' ' + x.color + ' (' + x.ratio + ':1) | ' + x.text);
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
