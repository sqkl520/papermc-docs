'use strict';
/* critique-typo-y.js -- what line advance does a code block actually render?
   The <pre> carries 16px/1.55 (strut 24.8px) while the inner <code> is 13.6px/1.55.
   Measure the real gap between two consecutive rendered code lines. */
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
  const pre = q('.code-pre');
  if (!pre) return null;
  const code = q('code', pre);
  const cs = getComputedStyle(code);
  const ps = getComputedStyle(pre);

  /* find the first text node with >=2 lines and measure the vertical distance between
     the rects of two characters on different lines */
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, null);
  let node = null;
  while ((node = walker.nextNode())) { if ((node.nodeValue || '').trim().length > 30) break; }
  const rng = document.createRange();
  const tops = [];
  const v = node ? node.nodeValue : '';
  for (let i = 0; i < Math.min(v.length, 400); i++) {
    rng.setStart(node, i); rng.setEnd(node, i + 1);
    const r = rng.getBoundingClientRect();
    if (r.width === 0 && /\s/.test(v[i])) continue;
    tops.push({ top: R2(r.top), h: R2(r.height), ch: v[i] });
  }
  const uniq = [];
  for (const t of tops) { if (!uniq.length || Math.abs(uniq[uniq.length - 1].top - t.top) > 1) uniq.push(t); }
  const advances = [];
  for (let i = 1; i < uniq.length; i++) advances.push(R2(uniq[i].top - uniq[i - 1].top));

  const blockH = R2(pre.getBoundingClientRect().height);
  const lineCount = uniq.length;
  const padT = parseFloat(ps.paddingTop), padB = parseFloat(ps.paddingBottom);
  const impliedAdvance = lineCount ? R2((blockH - padT - padB) / Math.max(1, (v.split('\n').length - 1 || lineCount - 1))) : null;

  /* also measure a prose paragraph's line advance for comparison */
  const p = qa('.article p').filter((x) => !x.className && (x.innerText || '').trim().length > 200)[0];
  let pAdv = null, pSize = null, pLh = null;
  if (p) {
    const ps2 = getComputedStyle(p);
    pSize = R2(parseFloat(ps2.fontSize)); pLh = R2(parseFloat(ps2.lineHeight));
    const w2 = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
    let nd = null;
    while ((nd = w2.nextNode())) { if ((nd.nodeValue || '').trim().length > 120) break; }
    if (nd) {
      const r2 = document.createRange();
      const tt = [];
      const vv = nd.nodeValue;
      for (let i = 0; i < Math.min(vv.length, 500); i++) {
        r2.setStart(nd, i); r2.setEnd(nd, i + 1);
        const rr = r2.getBoundingClientRect();
        if (rr.width === 0) continue;
        tt.push({ top: R2(rr.top) });
      }
      const u2 = [];
      for (const t of tt) { if (!u2.length || Math.abs(u2[u2.length - 1].top - t.top) > 1) u2.push(t); }
      const a2 = [];
      for (let i = 1; i < u2.length; i++) a2.push(R2(u2[i].top - u2[i - 1].top));
      pAdv = a2.length ? a2.sort((x, y) => x - y)[Math.floor(a2.length / 2)] : null;
    }
  }

  return {
    preFont: R2(parseFloat(ps.fontSize)), preLineHeight: R2(parseFloat(ps.lineHeight)), preLhRatio: R2(parseFloat(ps.lineHeight) / parseFloat(ps.fontSize)),
    codeFont: R2(parseFloat(cs.fontSize)), codeLineHeight: R2(parseFloat(cs.lineHeight)),
    measuredAdvances: advances.slice(0, 6),
    medianAdvance: advances.length ? advances.slice().sort((a, b) => a - b)[Math.floor(advances.length / 2)] : null,
    advanceOverCodeFont: advances.length ? R2(advances.slice().sort((a, b) => a - b)[Math.floor(advances.length / 2)] / parseFloat(cs.fontSize)) : null,
    proseAdvance: pAdv, proseSize: pSize, proseLh: pLh,
    proseAdvanceOverSize: pAdv && pSize ? R2(pAdv / pSize) : null,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const out = {};
  for (const u of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/']) {
    await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(100);
    out[u] = await page.evaluate(IN_PAGE);
    process.stderr.write('ok ' + u + '\n');
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'y-codeleading.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const k of Object.keys(out)) {
    const v = out[k];
    console.log('==', k);
    console.log('   pre', v.preFont + 'px/' + v.preLineHeight + 'px (ratio ' + v.preLhRatio + ')', '| code', v.codeFont + 'px lh ' + v.codeLineHeight + 'px');
    console.log('   code line advance measured:', v.measuredAdvances, '-> median', v.medianAdvance, 'px =', v.advanceOverCodeFont, 'x code font');
    console.log('   prose line advance:', v.proseAdvance, 'px =', v.proseAdvanceOverSize, 'x of', v.proseSize + 'px');
  }
})();
