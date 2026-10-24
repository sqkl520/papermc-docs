'use strict';
/* critique-typo-j.js -- CJK/Latin adjacency probe (synthetic, inheriting real paragraph
   style) + chip mid-word break test at narrow widths + line-break opportunity analysis.
   Read-only. */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const IN_PAGE = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  /* 1. CJK-Latin gap on a synthetic paragraph that definitely mixes scripts */
  const refP = qa('.article p').filter((p) => !p.className && (p.innerText || '').trim().length > 40)[0] || q('.article p');
  const refS = refP ? getComputedStyle(refP) : getComputedStyle(document.body);
  const probeText = '本文介绍Paper服务端的世界配置文件world-configuration的写法，涉及anticheat与anti-xray两个节点。';
  const el = document.createElement('p');
  el.style.cssText = 'margin:0;padding:0;border:0;width:100%;font:' + refS.font + ';letter-spacing:' + refS.letterSpacing + ';line-height:' + refS.lineHeight;
  el.textContent = probeText;
  if (refP) refP.parentNode.insertBefore(el, refP.nextSibling); else document.body.appendChild(el);
  const node = el.firstChild;
  const rng = document.createRange();
  const geo = [];
  for (let i = 0; i < probeText.length; i++) {
    rng.setStart(node, i); rng.setEnd(node, i + 1);
    const r = rng.getBoundingClientRect();
    geo.push({ ch: probeText[i], left: r.left, right: r.right, w: r.width, top: r.top });
  }
  const pairs = [];
  for (let i = 0; i + 1 < probeText.length; i++) {
    const a = geo[i], b = geo[i + 1];
    if (Math.abs(a.top - b.top) > 3) continue;
    const hanA = /[\u4e00-\u9fff]/.test(a.ch), hanB = /[\u4e00-\u9fff]/.test(b.ch);
    const latA = /[A-Za-z0-9]/.test(a.ch), latB = /[A-Za-z0-9]/.test(b.ch);
    if ((hanA && latB) || (latA && hanB)) pairs.push({ pair: a.ch + b.ch, gap: R2(b.left - a.right) });
  }
  /* Han-Han gap for comparison (should be 0) */
  const hanPairs = [];
  for (let i = 0; i + 1 < probeText.length && hanPairs.length < 6; i++) {
    if (/[\u4e00-\u9fff]/.test(geo[i].ch) && /[\u4e00-\u9fff]/.test(geo[i + 1].ch)) hanPairs.push(R2(geo[i + 1].left - geo[i].right));
  }
  /* Latin-space-Latin gap for comparison */
  const spaceGaps = [];
  for (let i = 0; i + 1 < probeText.length && spaceGaps.length < 6; i++) {
    if (geo[i].ch === ' ') spaceGaps.push(R2(geo[i].w));
  }
  el.remove();

  /* 2. chip mid-word break test: force the real chip to a narrow box and see if it splits */
  const chipTests = [];
  const chip = qa('.chip').filter((c) => /[A-Za-z]{8,}/.test(c.innerText || ''))[0];
  if (chip) {
    const orig = chip.style.maxWidth;
    for (const w of [160, 120, 90]) {
      chip.style.maxWidth = w + 'px';
      void chip.offsetWidth;
      const t = chip.innerText || '';
      /* find rendered line count of the chip's text */
      const r = chip.getBoundingClientRect();
      const lineH = parseFloat(getComputedStyle(chip).lineHeight) || 20;
      chipTests.push({ maxWidth: w, chipH: R2(r.height), approxLines: Math.round(r.height / lineH), text: t.slice(0, 40), wrap: getComputedStyle(chip).overflowWrap, wordBreak: getComputedStyle(chip).wordBreak, hyphens: getComputedStyle(chip).hyphens });
    }
    chip.style.maxWidth = orig;
  }

  /* 3. does the article ever use word-break/hyphens? */
  const artS = getComputedStyle(q('.article') || document.body);

  return {
    url: location.pathname,
    cjkLatin: pairs.slice(0, 20),
    cjkLatinMedian: (function () { const v = pairs.map((p) => p.gap).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; })(),
    hanHanGap: hanPairs,
    spaceGap: spaceGaps,
    chipTests: chipTests,
    articleWrap: { overflowWrap: artS.overflowWrap, wordBreak: artS.wordBreak, hyphens: artS.hyphens, lineBreak: artS.lineBreak, textWrap: artS.textWrapStyle || null },
    lang: document.documentElement.lang,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb'] });
  const out = [];
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of ['/', '/paper/reference/world-configuration/', '/all-pages.html']) {
      await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
      await page.waitForTimeout(60);
      const d = await page.evaluate(IN_PAGE);
      out.push({ vp: vp.width + 'x' + vp.height, ...d });
      process.stderr.write('ok ' + vp.width + ' ' + u + '\n');
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'j-cjk.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const r of out) {
    console.log('==', r.vp, r.url);
    console.log('  cjkLatinMedian', r.cjkLatinMedian, 'hanHan', JSON.stringify(r.hanHanGap), 'spaceGap', JSON.stringify(r.spaceGap));
    console.log('  pairs', JSON.stringify(r.cjkLatin.slice(0, 6)));
    console.log('  chip', JSON.stringify(r.chipTests));
    console.log('  wrap', JSON.stringify(r.articleWrap));
  }
})();
