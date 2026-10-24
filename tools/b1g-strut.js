'use strict';
/**
 * b1g-strut.js - prove the <pre> strut is still present on the AFTER build.
 *
 * Method (in-page, nothing is written to the site): clone the real <pre>,
 * neutralise the inherited 16px font-size on the block, and re-measure the
 * line advance. If the advance drops from 25px to the code element's own
 * line-height (21.08px), the 3.92px per line is the 16px strut.
 *
 * Usage: node tools/b1g-strut.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const ADVANCE = () => {
  const pre = document.querySelector('pre.code-pre') || document.querySelector('pre');
  if (!pre) return null;
  const code = pre.querySelector('code') || pre;
  const adv = (el) => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rs = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const tops = [...new Set(rs.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
    if (tops.length < 2) return null;
    const d = [];
    for (let i = 1; i < tops.length; i++) d.push(tops[i] - tops[i - 1]);
    d.sort((a, b) => a - b);
    return { median: d[Math.floor(d.length / 2)], min: d[0], max: d[d.length - 1], lines: tops.length };
  };
  const cs = (e, p) => getComputedStyle(e)[p];
  const base = {
    preFontSize: parseFloat(cs(pre, 'fontSize')),
    preLineHeight: parseFloat(cs(pre, 'lineHeight')),
    codeFontSize: parseFloat(cs(code, 'fontSize')),
    codeLineHeight: parseFloat(cs(code, 'lineHeight')),
    preRectH: Math.round(pre.getBoundingClientRect().height),
    advance: adv(code),
  };

  // 1) clone, pin the block font-size to the code font-size -> strut should vanish
  const clone = pre.cloneNode(true);
  clone.style.position = 'absolute';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.width = pre.getBoundingClientRect().width + 'px';
  clone.style.fontSize = cs(code, 'fontSize');
  document.body.appendChild(clone);
  const cloneCode = clone.querySelector('code') || clone;
  const fixed = {
    preFontSize: parseFloat(cs(clone, 'fontSize')),
    preLineHeight: parseFloat(cs(clone, 'lineHeight')),
    codeFontSize: parseFloat(cs(cloneCode, 'fontSize')),
    codeLineHeight: parseFloat(cs(cloneCode, 'lineHeight')),
    preRectH: Math.round(clone.getBoundingClientRect().height),
    advance: adv(cloneCode),
  };
  clone.remove();

  // 2) only the line-height strut (keep 16px font, pin line-height to code lh)
  const clone2 = pre.cloneNode(true);
  clone2.style.position = 'absolute';
  clone2.style.left = '-9999px';
  clone2.style.top = '0';
  clone2.style.width = pre.getBoundingClientRect().width + 'px';
  clone2.style.lineHeight = cs(code, 'lineHeight');
  document.body.appendChild(clone2);
  const clone2Code = clone2.querySelector('code') || clone2;
  const lhOnly = {
    preFontSize: parseFloat(cs(clone2, 'fontSize')),
    preLineHeight: parseFloat(cs(clone2, 'lineHeight')),
    codeLineHeight: parseFloat(cs(clone2Code, 'lineHeight')),
    preRectH: Math.round(clone2.getBoundingClientRect().height),
    advance: adv(clone2Code),
  };
  clone2.remove();

  return { base, fixedFontSize: fixed, fixedLineHeight: lhOnly };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { generated_at: new Date().toISOString(), runs: {} };
  for (const [side, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    for (const vp of [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }]) {
      for (const u of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(base + u, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(350);
        const r = await page.evaluate(ADVANCE);
        out.runs[side + ' ' + vp.n + ' ' + u] = r;
        await ctx.close();
      }
    }
  }
  await browser.close();
  const file = path.join('reports', 'b1-shots', '_strut.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out.runs)) {
    if (!v) { console.log(k + ' (no pre)'); continue; }
    console.log(k);
    console.log('   base      : preFS=' + v.base.preFontSize + ' preLH=' + v.base.preLineHeight +
      ' codeFS=' + v.base.codeFontSize + ' codeLH=' + v.base.codeLineHeight +
      ' preH=' + v.base.preRectH + ' advance=' + JSON.stringify(v.base.advance));
    console.log('   blockFS->13.6: preLH=' + v.fixedFontSize.preLineHeight + ' preH=' + v.fixedFontSize.preRectH +
      ' advance=' + JSON.stringify(v.fixedFontSize.advance));
    console.log('   blockLH->21.08: preH=' + v.fixedLineHeight.preRectH + ' advance=' + JSON.stringify(v.fixedLineHeight.advance));
  }
  console.log('\nwrote ' + file);
})();
