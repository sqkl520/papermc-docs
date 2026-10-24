'use strict';
/* critique-typo-r.js -- compare two candidate fixes on the live DOM (throwaway context).
   A: cap the whole .article, centred  (simple, but narrows code blocks too)
   B: cap only prose blocks, leave .code-block/.table-wrap full width, left aligned
      (prose measure obeyed, code stays usable, left edges stay aligned)
   Reports prose chars/line, code overflow, doc height, and left-edge alignment. */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const SCHEMES = {
  none: '',
  A_44rem_centered: '.article{max-width:min(44rem,72ch)!important;margin-inline:auto!important}',
  A_42rem_centered: '.article{max-width:min(42rem,70ch)!important;margin-inline:auto!important}',
  B_42rem_prose: '.article>*{max-width:min(42rem,70ch)}.article>.code-block,.article>.table-wrap,.article>.alert{max-width:none}',
  B_44rem_prose: '.article>*{max-width:min(44rem,72ch)}.article>.code-block,.article>.table-wrap,.article>.alert{max-width:none}',
  B_38rem_prose: '.article>*{max-width:min(38rem,64ch)}.article>.code-block,.article>.table-wrap,.article>.alert{max-width:none}',
};

const MEASURE = (sk) => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const art = q('.article');
  /* prose measure on a synthetic paragraph that inherits body style */
  const refP = qa('p', art).filter((p) => !p.className && (p.innerText || '').trim().length > 150)[0] || q('p', art);
  const refS = getComputedStyle(refP);
  const text = ('Minecraft server administrators configure world settings through a hierarchical ' +
    'configuration file that mirrors the structure of the settings themselves. Each leaf value ' +
    'carries a description, a default, and a type. Editing the file requires restarting the server ' +
    'before the changes take effect, and invalid values are silently replaced by defaults. ').repeat(2);
  const el = document.createElement('p');
  el.style.cssText = 'margin:0;padding:0;border:0;width:100%;font:' + refS.font + ';line-height:' + refS.lineHeight;
  el.textContent = text;
  refP.parentNode.insertBefore(el, refP.nextSibling);
  void el.offsetWidth;
  const node = el.firstChild;
  const rng = document.createRange();
  const geo = [];
  for (let i = 0; i < text.length; i++) { rng.setStart(node, i); rng.setEnd(node, i + 1); const r = rng.getBoundingClientRect(); geo.push({ ch: text[i], top: r.top, bottom: r.bottom, w: r.width, x: r.left }); }
  const lines = [];
  for (const g of geo) {
    let t = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 2; i--) { const L = lines[i]; const ov = Math.min(L.bottom, g.bottom) - Math.max(L.top, g.top); if (ov > Math.min(L.bottom - L.top, g.bottom - g.top) * 0.5) { t = L; break; } }
    if (!t) { t = { top: g.top, bottom: g.bottom, all: 0, x0: g.x }; lines.push(t); }
    t.top = Math.min(t.top, g.top); t.bottom = Math.max(t.bottom, g.bottom); t.x0 = Math.min(t.x0, g.x);
    if (g.w > 0) t.all++;
  }
  const probeW = R2(el.getBoundingClientRect().width);
  const probeX = R2(lines.length ? lines[0].x0 : 0);
  el.remove();
  const body = lines.slice(0, -1).map((l) => l.all).sort((a, b) => a - b);

  /* code blocks: real overflow of their scroll wrapper */
  const scrollers = qa('.code-scroll, .table-wrap');
  let over = 0;
  scrollers.forEach((s) => { if (s.scrollWidth > s.clientWidth + 1) over++; });
  /* left-edge alignment: prose vs first code block */
  const cb = q('.code-block');
  const p1 = qa('p', art).filter((p) => !p.className && (p.innerText || '').trim().length > 150)[0];
  const align = (cb && p1) ? { codeX: R2(cb.getBoundingClientRect().x), proseX: R2(p1.getBoundingClientRect().x), delta: R2(cb.getBoundingClientRect().x - p1.getBoundingClientRect().x) } : null;
  const h1 = q('h1');
  return {
    scheme: sk,
    proseW: probeW,
    proseChars: body.length ? body[Math.floor(body.length / 2)] : null,
    codeScrollers: scrollers.length,
    codeOverflow: over,
    docHeight: Math.round(document.documentElement.scrollHeight),
    h1Y: h1 ? R2(h1.getBoundingClientRect().y + window.scrollY) : null,
    align: align,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const out = [];
  for (const [u, vp] of [
    ['/paper/dev/dialogs/', { width: 1440, height: 900 }],
    ['/paper/dev/dialogs/', { width: 1280, height: 800 }],
    ['/paper/dev/dialogs/', { width: 1025, height: 900 }],
    ['/paper/reference/world-configuration/', { width: 1440, height: 900 }],
    ['/paper/reference/world-configuration/', { width: 1025, height: 900 }],
    ['/velocity/tuning/', { width: 1440, height: 900 }],
  ]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const sk of Object.keys(SCHEMES)) {
      await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
      await page.evaluate((css) => {
        document.documentElement.setAttribute('data-theme', 'light');
        if (css) { const s = document.createElement('style'); s.id = '__sch'; s.textContent = css; document.head.appendChild(s); }
      }, SCHEMES[sk]);
      await page.waitForTimeout(90);
      const m = await page.evaluate(MEASURE, sk);
      out.push({ page: u, vp: vp.width, ...m });
      process.stderr.write('ok ' + vp.width + ' ' + sk + ' prose=' + m.proseW + '/' + m.proseChars + ' codeOver=' + m.codeOverflow + '\n');
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'r-schemes.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('page'.padEnd(38) + 'vp    scheme              proseW/chars  codeOver  H      alignDelta');
  for (const r of out) {
    console.log(r.page.padEnd(38) + String(r.vp).padEnd(6) + r.scheme.padEnd(20) +
      (r.proseW + '/' + r.proseChars).padEnd(14) + String(r.codeOverflow + '/' + r.codeScrollers).padEnd(10) +
      String(r.docHeight).padEnd(7) + (r.align ? r.align.delta : '-'));
  }
})();
