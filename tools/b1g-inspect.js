'use strict';
/**
 * b1g-inspect.js — 结构侦察（一次性）：确认改前/改后的 DOM 骨架与关键选择器，
 * 供 b1g-diff.js 复用。只读站点，不写站点产物。
 *
 * 用法: node tools/b1g-inspect.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const DUMP = () => {
  const q = (s) => document.querySelector(s);
  const desc = (el) => {
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className || null,
      id: el.id || null,
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      display: getComputedStyle(el).display,
      pos: getComputedStyle(el).position,
    };
  };
  const layout = q('.layout');
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    hasLayout: !!layout,
    layoutClass: layout ? layout.className : null,
    layoutChildren: layout ? [...layout.children].map(desc) : [],
    sidebar: desc(q('.sidebar')),
    tocSide: desc(q('.toc-side')),
    tocSideFold: q('.toc-side') ? q('.toc-side').tagName.toLowerCase() + ' open=' + q('.toc-side').hasAttribute('open') : null,
    sideToc: desc(q('.side-toc')),
    article: desc(q('article') || q('.article')),
    articleCls: q('article') ? q('article').className : (q('.article') ? q('.article').className : null),
    content: desc(q('.content')),
    h1: desc(q('article h1') || q('.article h1') || q('h1')),
    firstPre: desc(q('pre')),
    preClasses: [...document.querySelectorAll('pre')].slice(0, 4).map((p) => p.className || '(none)'),
    codeScroll: [...document.querySelectorAll('.code-scroll')].slice(0, 3).map(desc),
    firstTable: desc(q('article table') || q('table')),
    firstImg: desc(q('article img') || q('img')),
    topbarH: q('.topbar') ? Math.round(q('.topbar').getBoundingClientRect().height) : null,
    pageHeight: document.documentElement.scrollHeight,
    cssVars: (() => {
      const cs = getComputedStyle(document.documentElement);
      const names = ['--topbar-h', '--content-max', '--maxw', '--bg', '--fg'];
      const out = {};
      for (const n of names) { const v = cs.getPropertyValue(n); if (v) out[n] = v.trim(); }
      return out;
    })(),
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const [tag, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    out[tag] = {};
    for (const vp of [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(500);
      out[tag][vp.name] = await page.evaluate(DUMP);
      await ctx.close();
    }
  }
  await browser.close();
  const file = path.join('reports', 'b1-shots', '_inspect.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  for (const tag of Object.keys(out)) {
    for (const vp of Object.keys(out[tag])) {
      const d = out[tag][vp];
      console.log(tag + ' ' + vp + ' pageH=' + d.pageHeight + ' article=' + JSON.stringify(d.article && d.article.rect));
      console.log('   layoutKids=' + JSON.stringify((d.layoutChildren || []).map((c) => c.tag + '.' + c.cls + ' ' + c.rect.w + 'x' + c.rect.h + '@' + c.rect.x)));
      console.log('   tocSide=' + JSON.stringify(d.tocSide) + ' sideToc=' + JSON.stringify(d.sideToc && d.sideToc.rect));
      console.log('   layoutClass=' + d.layoutClass + ' articleCls=' + d.articleCls);
      console.log('   preClasses=' + JSON.stringify(d.preClasses));
      console.log('   cssVars=' + JSON.stringify(d.cssVars));
    }
  }
  console.log('wrote ' + file);
})();
