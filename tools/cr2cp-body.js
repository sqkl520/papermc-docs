'use strict';
/**
 * cr2cp-body.js — 精确测「正文第一行」（排除 page-desc 摘要 / page-meta 元信息条），
 * 并给出进入正文前用户要跨过的导航与元信息总高。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2cp');
const NEW = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const M = () => {
  const vh = window.innerHeight;
  const abs = (el) => el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
  const art = document.querySelector('article.article');
  const meta = document.querySelector('.page-meta');
  const metaBottom = meta ? Math.round(meta.getBoundingClientRect().bottom + window.scrollY) : null;

  // 真正的正文起点：article 内、排除 page-head / page-desc / page-meta 之后的第一块
  let body = null;
  if (art) {
    for (const el of art.children) {
      if (el.closest('.page-head') || el.matches('.page-head')) continue;
      if (el.matches('.page-desc,.page-meta')) continue;
      if (el.matches('h1')) continue;
      if (/^h[1-6]$/.test(el.tagName)) { body = el; break; }
      if (el.matches('p,ul,ol,pre,table,figure,div.code-block,.alert,blockquote')) { body = el; break; }
    }
  }
  const h1 = document.querySelector('article h1,.page-head h1');
  return {
    vw: window.innerWidth, vh,
    h1Y: abs(h1), descY: abs(document.querySelector('.page-desc')),
    metaY: abs(meta), metaBottom,
    chipsH: (() => { const c = [...document.querySelectorAll('.page-meta .chip')]; if (!c.length) return 0; const ys = c.map((e) => e.getBoundingClientRect()); return Math.round(Math.max(...ys.map((r) => r.bottom)) - Math.min(...ys.map((r) => r.top))); })(),
    bodyY: abs(body), bodyTag: body ? body.tagName.toLowerCase() : null,
    bodyText: body ? body.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : null,
    bodyScreens: body ? +(abs(body) / vh).toFixed(2) : null,
    // 进入正文前要跨过的「非正文」总高：topbar + (toc 条) + 面包屑 + h1 + desc + meta
    chromeH: body ? abs(body) : null,
  };
};

async function run() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const vp of [{ w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 768, h: 1024 }, { w: 390, h: 844 }, { w: 320, h: 568 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.w < 500, hasTouch: vp.w < 500 });
    const page = await ctx.newPage();
    for (const p of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/']) {
      await page.goto(NEW + p, { waitUntil: 'load' });
      await page.waitForTimeout(260);
      out[vp.w + 'x' + vp.h] = out[vp.w + 'x' + vp.h] || {};
      out[vp.w + 'x' + vp.h][p] = await page.evaluate(M);
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'body.json'), JSON.stringify(out, null, 1), 'utf8');
  const L = (s) => console.log(s);
  L('vp         page                          h1Y  descY  metaY  meta底  chips高  正文首行Y  屏数  首块');
  Object.keys(out).forEach((vp) => {
    Object.keys(out[vp]).forEach((p) => {
      const m = out[vp][p];
      L(vp.padEnd(10) + p.replace('/paper/', '').replace('/velocity/', 'v/').padEnd(30)
        + String(m.h1Y).padStart(5) + String(m.descY).padStart(7) + String(m.metaY).padStart(7)
        + String(m.metaBottom).padStart(7) + String(m.chipsH).padStart(8)
        + String(m.bodyY).padStart(10) + String(m.bodyScreens).padStart(6) + '  ' + m.bodyTag + ': ' + String(m.bodyText).slice(0, 34));
    });
  });
  L('\nJSON -> ' + path.join(OUT, 'body.json'));
}
run().catch((e) => { console.error('FAIL', e); process.exit(1); });
