'use strict';
/* critique-typo-p.js -- before/after experiment: apply the proposed typography CSS to the
   live page (throwaway context) and re-measure chars-per-line, page height and H1 offset.
   Nothing is written to the site. */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PROPOSED = `
:root{--measure:min(42rem,70ch)}
@media (min-width:1024px){
  .article{max-width:var(--measure);margin-inline:auto}
}
@media (max-width:1023.98px){
  .toc-side{order:3;display:none}
}
.article p{margin:1em 0}
`;

const MEASURE = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const art = q('.article');
  const refP = qa('p', art).filter((p) => !p.className && (p.innerText || '').trim().length > 200)[0] || q('p', art);
  const refS = getComputedStyle(refP);
  const text = ('Minecraft server administrators configure world settings through a hierarchical ' +
    'configuration file that mirrors the structure of the settings themselves. Each leaf value ' +
    'carries a description, a default, and a type. Editing the file requires restarting the server ' +
    'before the changes take effect, and invalid values are silently replaced by defaults. ').repeat(2);
  const el = document.createElement('p');
  el.style.cssText = 'margin:0;padding:0;border:0;width:100%;font:' + refS.font + ';line-height:' + refS.lineHeight +
    ';overflow-wrap:' + refS.overflowWrap + ';word-break:' + refS.wordBreak;
  el.textContent = text;
  refP.parentNode.insertBefore(el, refP.nextSibling);
  const node = el.firstChild;
  const rng = document.createRange();
  const geo = [];
  for (let i = 0; i < text.length; i++) { rng.setStart(node, i); rng.setEnd(node, i + 1); const r = rng.getBoundingClientRect(); geo.push({ ch: text[i], top: r.top, bottom: r.bottom, w: r.width }); }
  const lines = [];
  for (const g of geo) {
    let t = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 2; i--) { const L = lines[i]; const ov = Math.min(L.bottom, g.bottom) - Math.max(L.top, g.top); if (ov > Math.min(L.bottom - L.top, g.bottom - g.top) * 0.5) { t = L; break; } }
    if (!t) { t = { top: g.top, bottom: g.bottom, all: 0, glyphs: 0 }; lines.push(t); }
    t.top = Math.min(t.top, g.top); t.bottom = Math.max(t.bottom, g.bottom);
    if (g.w > 0) { t.all++; if (!/\s/.test(g.ch)) t.glyphs++; }
  }
  const w = R2(el.getBoundingClientRect().width);
  el.remove();
  const body = lines.slice(0, -1).map((l) => l.all).sort((a, b) => a - b);
  const bodyG = lines.slice(0, -1).map((l) => l.glyphs).sort((a, b) => a - b);
  const h1 = q('h1');
  const artBox = art ? art.getBoundingClientRect() : null;
  return {
    articleW: R2(artBox.width),
    charsPerLine: body.length ? body[Math.floor(body.length / 2)] : null,
    glyphsPerLine: bodyG.length ? bodyG[Math.floor(bodyG.length / 2)] : null,
    docHeight: Math.round(document.documentElement.scrollHeight),
    h1Y: h1 ? R2(h1.getBoundingClientRect().y + window.scrollY) : null,
    tocH: (function () { const t = q('.toc-side'); return t && t.offsetParent !== null ? R2(t.getBoundingClientRect().height) : 0; })(),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const pages = ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/'];
  const vps = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1200, height: 900 }, { width: 1025, height: 900 }, { width: 1024, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 568 }];
  const out = [];
  for (const vp of vps) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of pages) {
      for (const apply of [false, true]) {
        await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
        await page.evaluate((css) => {
          document.documentElement.setAttribute('data-theme', 'light');
          if (css) { const s = document.createElement('style'); s.id = '__proposed'; s.textContent = css; document.head.appendChild(s); }
        }, apply ? PROPOSED : '');
        await page.waitForTimeout(100);
        const m = await page.evaluate(MEASURE);
        out.push({ vp: vp.width, page: u, applied: apply, ...m });
        process.stderr.write('ok ' + vp.width + ' ' + u + ' applied=' + apply + ' w=' + m.articleW + ' chars=' + m.charsPerLine + '\n');
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'p-experiment.json'), JSON.stringify(out, null, 1), 'utf8');

  console.log('page'.padEnd(38) + 'vp    before(w/chars/h1Y/H)        after(w/chars/h1Y/H)         delta');
  for (const u of pages) {
    for (const vp of vps) {
      const b = out.find((x) => x.page === u && x.vp === vp.width && !x.applied);
      const a = out.find((x) => x.page === u && x.vp === vp.width && x.applied);
      if (!b || !a) continue;
      console.log(u.padEnd(38) + String(vp.width).padEnd(6) +
        (b.articleW + '/' + b.charsPerLine + '/' + b.h1Y + '/' + b.docHeight).padEnd(28) +
        (a.articleW + '/' + a.charsPerLine + '/' + a.h1Y + '/' + a.docHeight).padEnd(28) +
        'h1 ' + (a.h1Y - b.h1Y) + '  H ' + (a.docHeight - b.docHeight));
    }
  }
})();
