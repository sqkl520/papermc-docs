'use strict';
/* critique-typo-aa.js -- attribution: are the mid-word breaks inside <p> actually inside an
   inline <code>/<a>, i.e. caused by :not(pre)>code{overflow-wrap:anywhere}?
   For each break, report the nearest ancestor element of the two characters. */
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
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const art = document.querySelector('.article');

  const chain = (el) => {
    const out = [];
    let n = el;
    while (n && n !== art && out.length < 5) {
      out.push(n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.split(/\s+/)[0] : ''));
      n = n.parentElement;
    }
    return out.join('<');
  };

  const found = [];
  for (const blk of qa('p, li, td, th', art)) {
    if (blk.querySelector('p, li, ul, ol')) continue;
    const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, null);
    const chars = []; let n;
    while ((n = walker.nextNode())) { const v = n.nodeValue; for (let i = 0; i < v.length; i++) chars.push({ node: n, i: i, ch: v[i], parent: n.parentElement }); }
    if (chars.length < 12) continue;
    const rng = document.createRange();
    const geo = [];
    for (let k = 0; k < chars.length; k++) { const c = chars[k]; rng.setStart(c.node, c.i); rng.setEnd(c.node, c.i + 1); const rr = rng.getBoundingClientRect(); geo.push({ k: k, ch: c.ch, top: rr.top, bottom: rr.bottom, w: rr.width }); }
    const lines = [];
    for (const g of geo) {
      let t = null;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) { const L = lines[i]; const ov = Math.min(L.bottom, g.bottom) - Math.max(L.top, g.top); if (ov > Math.min(L.bottom - L.top, g.bottom - g.top) * 0.5) { t = L; break; } }
      if (!t) { t = { top: g.top, bottom: g.bottom, startK: g.k, endK: g.k, n: 0 }; lines.push(t); }
      t.top = Math.min(t.top, g.top); t.bottom = Math.max(t.bottom, g.bottom); t.endK = g.k;
      if (!/\s/.test(g.ch) && g.w > 0) t.n++;
    }
    lines.sort((a, b) => a.top - b.top);
    if (lines.length < 2) continue;
    const raw = chars.map((c) => c.ch).join('');
    for (let k = 0; k + 1 < lines.length; k++) {
      const a = lines[k], b = lines[k + 1];
      if (a.n < 3) continue;
      const between = raw.slice(a.endK, b.startK + 1);
      if (/\s/.test(between)) continue;
      if (/[A-Za-z]/.test(raw[a.endK]) && /[A-Za-z]/.test(raw[b.startK])) {
        let ws = a.endK, we = b.startK;
        while (ws > 0 && /[A-Za-z]/.test(raw[ws - 1])) ws--;
        while (we < raw.length && /[A-Za-z]/.test(raw[we])) we++;
        const parentA = chars[a.endK].parent, parentB = chars[b.startK].parent;
        found.push({
          block: blk.tagName.toLowerCase(),
          word: raw.slice(ws, we),
          left: raw.slice(ws, a.endK + 1), right: raw.slice(b.startK, we),
          inInlineCode: !!(parentA && parentA.closest('code') && !(parentA.closest('pre'))),
          inLink: !!(parentA && parentA.closest('a')),
          parentChain: chain(parentA),
          sameParent: parentA === parentB,
        });
      }
    }
  }
  return found;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const out = {};
  for (const w of [390, 320, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(100);
    out[w] = await page.evaluate(IN_PAGE);
    await ctx.close();
    process.stderr.write('ok ' + w + '\n');
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'aa-attrib.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const w of Object.keys(out)) {
    const rows = out[w];
    const inCode = rows.filter((r) => r.inInlineCode).length;
    const inLink = rows.filter((r) => r.inLink).length;
    const plain = rows.filter((r) => !r.inInlineCode && !r.inLink).length;
    console.log('== width ' + w + ': total breaks ' + rows.length + ' | inline <code>: ' + inCode + ' | <a>: ' + inLink + ' | plain prose: ' + plain);
    rows.slice(0, 8).forEach((r) => console.log('   ' + r.block.padEnd(4) + ' code=' + (r.inInlineCode ? 'Y' : 'n') + ' a=' + (r.inLink ? 'Y' : 'n') + '  ' + r.word + ' -> ' + r.left + '|' + r.right + '   via ' + r.parentChain));
  }
})();
