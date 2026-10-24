'use strict';
/** critique-red-probe12.js — 校验 critique-mobile.md 的可证伪主张 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = process.cwd();
const EXE = [process.env.CHROME_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));

const T = () => {
  const qa = (s) => [...document.querySelectorAll(s)];
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const rows = [];
  for (const el of qa('a[href],button,input,summary,select,textarea')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    // 排除「行内 + 在句子中」的链接（WCAG 2.5.8 Inline 例外）
    const par = el.parentElement;
    const inlineInSentence = (() => {
      if (el.tagName !== 'A') return false;
      const cs = getComputedStyle(el);
      if (cs.display !== 'inline') return false;
      if (!par) return false;
      const t = [...par.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('');
      return t.trim().length > 20; // 该段有实质文字 → 视为行内链接
    })();
    const region = el.closest('.sidebar') ? 'sidebar' : el.closest('.toc-side') ? 'toc' : el.closest('.topbar') ? 'topbar' : el.closest('.page-footer') ? 'footer' : el.closest('.content') ? 'content' : 'other';
    rows.push({ region, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 30), h: Math.round(r.height), w: Math.round(r.width), t: (el.textContent || '').trim().slice(0, 22), inlineInSentence, failAA24: r.height < 24 || r.width < 24, under44: r.height < 44 || r.width < 44 });
  }
  const agg = {};
  for (const r of rows) { const k = r.region; agg[k] = agg[k] || { n: 0, failAA24: 0, under44: 0, inlineExcluded: 0 }; agg[k].n++; if (r.failAA24) agg[k].failAA24++; if (r.under44) agg[k].under44++; if (r.inlineInSentence) agg[k].inlineExcluded++; }
  return { total: rows.length, agg, failAA24: rows.filter((r) => r.failAA24 && !r.inlineInSentence), worstUnder44: rows.filter((r) => r.under44 && !r.inlineInSentence).sort((a, b) => a.h - b.h).slice(0, 12) };
};

const STRUCT = () => {
  const art = document.querySelector('.article');
  const allUl = art ? art.querySelectorAll('ul').length : 0;
  const topUl = art ? [...art.querySelectorAll('ul')].filter((u) => !u.closest('ul').closest('ul') || u.parentElement.closest('ul') === null).length : 0;
  const outerUl = art ? [...art.querySelectorAll('ul')].filter((u) => !u.parentElement.closest('ul')).length : 0;
  const ul = art ? [...art.querySelectorAll('ul')].sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0] : null;
  const ct = document.querySelector('.code-title');
  const blk = document.querySelector('.code-block');
  const pre = document.querySelector('.code-block pre');
  return {
    ulAll: allUl, ulOutermost: outerUl,
    tallestUlH: ul ? Math.round(ul.getBoundingClientRect().height - ul.getBoundingClientRect().height + ul.offsetHeight) : null,
    tallestUlOffsetH: ul ? ul.offsetHeight : null,
    docH: document.documentElement.scrollHeight,
    codeTitleH: ct ? Math.round(ct.getBoundingClientRect().height) : null,
    codeBlockH: blk ? Math.round(blk.getBoundingClientRect().height) : null,
    preH: pre ? Math.round(pre.getBoundingClientRect().height) : null,
    codeScrollHasDataOverflowing: !!document.querySelector('.code-scroll[data-overflowing]'),
    codeScrolls: [...document.querySelectorAll('.code-scroll')].map((s) => ({ cw: s.clientWidth, sw: s.scrollWidth, attr: s.hasAttribute('data-overflowing'), touchAction: getComputedStyle(s).touchAction, bgImage: getComputedStyle(s).backgroundImage })),
    hasBackToTop: !![...document.querySelectorAll('a[href="#top"], .back-to-top, [data-back-to-top]')].length,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { targets: {}, struct: {}, drawer: {} };
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '320x568', w: 320, h: 568 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const page = await ctx.newPage();
    for (const p of ['/', '/paper/dev/dialogs/', '/paper/reference/permissions/', '/paper/dev/particles/', '/paper/reference/world-configuration/']) {
      await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(300);
      const t = await page.evaluate(T).catch(() => null);
      const s = await page.evaluate(STRUCT).catch(() => null);
      if (t) { out.targets[vp.n + ' ' + p] = t; console.log('TGT ' + vp.n + ' ' + p.padEnd(32) + 'visible=' + t.total + '  失败AA(24)=' + t.failAA24.length + '  <44=' + t.worstUnder44.length + '  ' + JSON.stringify(t.agg)); }
      if (s) {
        out.struct[vp.n + ' ' + p] = s;
        if (p === '/paper/reference/world-configuration/') console.log('STRUCT ' + vp.n + ' ' + p + ' ' + JSON.stringify(s).slice(0, 400));
        if (p === '/paper/dev/dialogs/') console.log('CODE ' + vp.n + ' ' + p + ' titleH=' + s.codeTitleH + ' blockH=' + s.codeBlockH + ' preH=' + s.preH + ' scrolls=' + JSON.stringify(s.codeScrolls.slice(0, 2)) + ' backToTop=' + s.hasBackToTop);
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe12.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('写出 reports/critique-red-probe12.json');
})();
