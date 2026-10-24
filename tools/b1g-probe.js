'use strict';
/**
 * b1g-probe.js - targeted follow-ups for batch-1 geometry:
 *   (a) horizontal overflow offenders at 390/320 before vs after
 *   (b) identify which page/paragraph drove the m.capW change at 390
 *   (c) confirm code-block strut in the after build (line advance vs font-size)
 *   (d) check /all-pages.html mobile layout (page height 12k -> 29k)
 *
 * Usage: node tools/b1g-probe.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const AFTER = 'http://127.0.0.1:8787';
const BEFORE = 'http://127.0.0.1:8788';
const PAGES = ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html'];

const OVERFLOW = () => {
  const docW = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const right = r.right + window.scrollX;
    if (right > docW + 1) {
      out.push({
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
        right: Math.round(right), w: Math.round(r.width), x: Math.round(r.x),
        disp: getComputedStyle(el).display, overflowX: getComputedStyle(el).overflowX,
      });
    }
  }
  // keep the outermost few, dedupe by selector
  const seen = new Set();
  const uniq = [];
  for (const o of out.sort((a, b) => b.right - a.right)) {
    const k = o.sel + '|' + o.w;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(o);
    if (uniq.length >= 8) break;
  }
  return { docW, scrollW: document.documentElement.scrollWidth, offenders: uniq };
};

const PROSE = () => {
  const isProse = (el) => {
    if (!el) return false;
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const art = document.querySelector('article');
  const ps = [...art.querySelectorAll('p')].filter(isProse);
  return ps.map((p, i) => {
    const st = getComputedStyle(p);
    const b = p.getBoundingClientRect();
    return {
      i, cls: p.className || null,
      parent: p.parentElement.tagName.toLowerCase() + '.' + (typeof p.parentElement.className === 'string' ? p.parentElement.className.split(/\s+/)[0] : ''),
      w: Math.round(b.width * 100) / 100,
      text: (p.textContent || '').trim().slice(0, 40),
    };
  }).slice(0, 3);
};

const CODE = () => {
  const pre = document.querySelector('pre');
  if (!pre) return null;
  const code = pre.querySelector('code') || pre;
  const rg = document.createRange();
  rg.selectNodeContents(code);
  const rs = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
  const tops = [...new Set(rs.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
  const d = [];
  for (let i = 1; i < tops.length; i++) d.push(tops[i] - tops[i - 1]);
  d.sort((a, b) => a - b);
  const cs = getComputedStyle(pre);
  const csc = getComputedStyle(code);
  return {
    preFontSize: parseFloat(cs.fontSize), preLineHeight: parseFloat(cs.lineHeight),
    codeFontSize: parseFloat(csc.fontSize), codeLineHeight: parseFloat(csc.lineHeight),
    advanceMedian: d.length ? d[Math.floor(d.length / 2)] : null,
    advanceMin: d[0] || null, advanceMax: d[d.length - 1] || null,
    ratio: d.length ? Math.round((d[Math.floor(d.length / 2)] / parseFloat(csc.fontSize)) * 100) / 100 : null,
    preH: Math.round(pre.getBoundingClientRect().height),
    lines: tops.length,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { generated_at: new Date().toISOString(), overflow: {}, prose390: {}, code: {}, allpages390: {} };

  for (const [side, base] of [['after', AFTER], ['before', BEFORE]]) {
    for (const vp of [{ n: '390', w: 390, h: 844 }, { n: '320', w: 320, h: 568 }]) {
      for (const u of PAGES) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await page.goto(base + u, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(350);
        out.overflow[side + ' ' + vp.n + ' ' + u] = await page.evaluate(OVERFLOW);
        if (vp.n === '390' && (u === '/paper/dev/dialogs/' || u === '/velocity/tuning/')) {
          out.prose390[side + ' ' + u] = await page.evaluate(PROSE);
        }
        await ctx.close();
      }
    }
    // code strut at 1440 + 390
    for (const u of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
      for (const vp of [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }]) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(base + u, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(350);
        out.code[side + ' ' + vp.n + ' ' + u] = await page.evaluate(CODE);
        await ctx.close();
      }
    }
    // all-pages at 390: what is the table rendered as
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(base + '/all-pages.html', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(400);
    out.allpages390[side] = await page.evaluate(() => {
      const t = document.querySelector('table.allpages');
      const tr = t && t.querySelector('tbody tr');
      const td = tr && tr.querySelector('td');
      const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
      return {
        tableDisplay: cs(t, 'display'), tableW: t ? Math.round(t.getBoundingClientRect().width) : null,
        rowDisplay: cs(tr, 'display'), rowH: tr ? Math.round(tr.getBoundingClientRect().height) : null,
        cellDisplay: cs(td, 'display'), cellH: td ? Math.round(td.getBoundingClientRect().height) : null,
        rows: t ? t.querySelectorAll('tbody tr').length : 0,
        pageH: document.documentElement.scrollHeight,
        theadDisplay: cs(t && t.querySelector('thead'), 'display'),
        firstRowText: tr ? (tr.textContent || '').trim().slice(0, 60) : null,
      };
    });
    await ctx.close();
  }
  await browser.close();

  const file = path.join('reports', 'b1-shots', '_probe.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');

  console.log('== overflow (390) ==');
  for (const [k, v] of Object.entries(out.overflow)) {
    if (!k.includes(' 390 ')) continue;
    if (k.includes('after')) console.log(k.padEnd(48) + 'docW=' + v.docW + ' scrollW=' + v.scrollW + ' offenders=' + v.offenders.length + (v.offenders[0] ? ' top=' + v.offenders[0].sel + '@' + v.offenders[0].right : ''));
  }
  console.log('\n== code strut ==');
  for (const [k, v] of Object.entries(out.code)) console.log(k.padEnd(50) + JSON.stringify(v));
  console.log('\n== prose 390 ==');
  for (const [k, v] of Object.entries(out.prose390)) console.log(k + ' ' + JSON.stringify(v));
  console.log('\n== all-pages 390 ==');
  for (const [k, v] of Object.entries(out.allpages390)) console.log(k + ' ' + JSON.stringify(v));
  console.log('\nwrote ' + file);
})();
