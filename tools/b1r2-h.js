'use strict';
/**
 * b1r2-h.js — 收尾：短落点是否由 scroll anchoring 造成（给出可执行替代方案）；17.5em 的 em 基准；打印底色
 * 用法: node tools/b1r2-h.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/particles/';
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const MEASURE = (id) => {
  const el = document.getElementById(id);
  const b = el.getBoundingClientRect();
  const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0;
  const toc = document.querySelector('.toc-side');
  const tb = toc ? toc.getBoundingClientRect() : { bottom: 0, height: 0, top: 0 };
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const scrollY = Math.round(window.scrollY);
  const maxScroll = Math.round(document.documentElement.scrollHeight - innerHeight);
  const headingDocY = scrollY + Math.round(b.top);
  const ideal = Math.max(0, Math.min(maxScroll, headingDocY - pad));
  return { scrollY, ideal, shortfallPx: ideal - scrollY, headingTop: Math.round(b.top), vh: innerHeight,
    visiblePx: Math.max(0, Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, tb.height > 2 ? tb.bottom : 0, topbar))),
    pad, maxScroll, clamped: ideal === maxScroll };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { anchorFix: [], emBasis: [], printBg: {} };

  // ---------- H1 scroll anchoring 隔离 ----------
  const MODES = [
    { n: 'asis', css: null },
    { n: 'overflowAnchorNone', css: 'html,body,*{overflow-anchor:none !important}' },
    { n: 'scrollBehaviorAuto', css: 'html{scroll-behavior:auto !important}' },
    { n: 'anchorNone+auto', css: 'html{scroll-behavior:auto !important}html,body,*{overflow-anchor:none !important}' },
  ];
  for (const m of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    if (m.css) await page.addStyleTag({ content: m.css });
    await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
    await page.waitForTimeout(450);
    const id = await page.evaluate(() => {
      const as = Array.from(document.querySelectorAll('.toc-side a[href^="#"]'));
      return as[Math.floor(as.length / 2)].getAttribute('href').slice(1);
    });
    await page.evaluate((x) => { document.querySelector('.toc-side a[href="#' + x + '"]').click(); }, id);
    await page.waitForTimeout(5000);
    const r = await page.evaluate(MEASURE, id);
    r.mode = m.n;
    out.anchorFix.push(r);
    log('ANCHORFIX ' + JSON.stringify({ mode: m.n, scrollY: r.scrollY, ideal: r.ideal, shortfall: r.shortfallPx, headingTop: r.headingTop, visiblePx: r.visiblePx }));
    await ctx.close();
  }

  // ---------- H2 17.5em 的 em 基准 ----------
  for (const rootFs of [16, 20, 24]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const r = await page.evaluate((fs) => {
      document.documentElement.style.fontSize = fs + 'px';
      /* 强制重算 */
      void document.body.offsetHeight;
      return {
        rootFs: getComputedStyle(document.documentElement).fontSize,
        mq17_5_Matches: matchMedia('(max-width:17.5em)').matches,
        mq280pxMatches: matchMedia('(max-width:280px)').matches,
        vw: innerWidth,
        srcListPadLeft: (() => { const l = document.querySelector('.src-list[data-depth="3"]'); return l ? getComputedStyle(l).paddingLeft : null; })(),
      };
    }, rootFs);
    r.setRootFs = rootFs;
    out.emBasis.push(r);
    log('EMBASIS ' + JSON.stringify(r));
    await ctx.close();
  }

  // ---------- H3 打印底色 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const probe = () => page.evaluate(() => {
      const c = document.querySelector('.code-pre') || document.querySelector('.code-block') || document.querySelector('pre');
      const cs = c ? getComputedStyle(c) : null;
      return { tag: c ? c.tagName + '.' + String(c.className || '') : null, bg: cs ? cs.backgroundColor : null, color: cs ? cs.color : null,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        printColorAdjust: cs ? (cs.printColorAdjust || cs.webkitPrintColorAdjust) : null };
    });
    out.printBg.screen = await probe();
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(250);
    out.printBg.print = await probe();
    /* PDF 里实际是什么底色：打印成 PDF 并读大小/是否存在 */
    await page.emulateMedia({ media: 'screen' });
    log('PRINTBG ' + JSON.stringify(out.printBg));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-h.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-h.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-h.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
