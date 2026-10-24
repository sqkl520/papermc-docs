'use strict';
/* critique-typo-s.js -- scheme C: cap prose elements at ANY depth (nested <li><p> in the
   world-configuration tree), never cap code/table/alert, left aligned so prose and code
   share one left edge. Compares against A (whole-article centre) and none. */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PROSE = '.article p,.article li,.article ul,.article ol,.article h1,.article h2,.article h3,.article h4,.article h5,.article h6,.article blockquote,.article dl';
const SCHEMES = {
  none: '',
  A_center_42rem: '.article{max-width:min(42rem,70ch)!important;margin-inline:auto!important}',
  C_prose_42rem: PROSE + '{max-width:min(42rem,70ch)}',
  C_prose_44rem: PROSE + '{max-width:min(44rem,72ch)}',
  C_prose_40rem: PROSE + '{max-width:min(40rem,66ch)}',
  C_prose_46rem: PROSE + '{max-width:min(46rem,76ch)}',
};

const MEASURE = (sk) => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const art = q('.article');
  const probes = [];
  const TEXTS = ('Minecraft server administrators configure world settings through a hierarchical ' +
    'configuration file that mirrors the structure of the settings themselves. Each leaf value ' +
    'carries a description, a default, and a type. Editing the file requires restarting the server ' +
    'before the changes take effect, and invalid values are silently replaced by defaults. ').repeat(2);

  const measureEl = (refP) => {
    const refS = getComputedStyle(refP);
    const el = document.createElement('p');
    el.style.cssText = 'margin:0;padding:0;border:0;width:100%;box-sizing:border-box;font:' + refS.font + ';line-height:' + refS.lineHeight;
    el.textContent = TEXTS;
    refP.parentNode.insertBefore(el, refP.nextSibling);
    void el.offsetWidth;
    const node = el.firstChild;
    const rng = document.createRange();
    const geo = [];
    for (let i = 0; i < TEXTS.length; i++) { rng.setStart(node, i); rng.setEnd(node, i + 1); const r = rng.getBoundingClientRect(); geo.push({ ch: TEXTS[i], top: r.top, bottom: r.bottom, w: r.width, x: r.left }); }
    const lines = [];
    for (const g of geo) {
      let t = null;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 2; i--) { const L = lines[i]; const ov = Math.min(L.bottom, g.bottom) - Math.max(L.top, g.top); if (ov > Math.min(L.bottom - L.top, g.bottom - g.top) * 0.5) { t = L; break; } }
      if (!t) { t = { top: g.top, bottom: g.bottom, all: 0, x0: g.x }; lines.push(t); }
      t.top = Math.min(t.top, g.top); t.bottom = Math.max(t.bottom, g.bottom); t.x0 = Math.min(t.x0, g.x);
      if (g.w > 0) t.all++;
    }
    const w = R2(el.getBoundingClientRect().width);
    const x = R2(el.getBoundingClientRect().x);
    el.remove();
    const body = lines.slice(0, -1).map((l) => l.all).sort((a, b) => a - b);
    return { w: w, x: x, chars: body.length ? body[Math.floor(body.length / 2)] : null };
  };

  /* top-level paragraph and a nested one (inside <li><p>) */
  const topP = qa('p', art).filter((p) => !p.className && !p.closest('li') && (p.innerText || '').trim().length > 100)[0];
  const nestedP = qa('li p', art).filter((p) => (p.innerText || '').trim().length > 60)[0];
  const mTop = topP ? measureEl(topP) : null;
  const mNest = nestedP ? measureEl(nestedP) : null;

  const scrollers = qa('.code-scroll, .table-wrap');
  let over = 0;
  scrollers.forEach((s) => { if (s.scrollWidth > s.clientWidth + 1) over++; });
  const cb = q('.code-block');
  return {
    scheme: sk,
    proseW: mTop ? mTop.w : null, proseChars: mTop ? mTop.chars : null, proseX: mTop ? mTop.x : null,
    nestedW: mNest ? mNest.w : null, nestedChars: mNest ? mNest.chars : null,
    codeOverflow: over, codeScrollers: scrollers.length,
    codeW: cb ? R2(cb.getBoundingClientRect().width) : null,
    alignDelta: (cb && mTop) ? R2(cb.getBoundingClientRect().x - mTop.x) : null,
    docHeight: Math.round(document.documentElement.scrollHeight),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const out = [];
  for (const [u, vp] of [
    ['/paper/dev/dialogs/', { width: 1440, height: 900 }],
    ['/paper/dev/dialogs/', { width: 1280, height: 800 }],
    ['/paper/reference/world-configuration/', { width: 1440, height: 900 }],
    ['/paper/reference/world-configuration/', { width: 320, height: 568 }],
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
      process.stderr.write('ok ' + vp.width + ' ' + sk + ' prose=' + m.proseW + '/' + m.proseChars + ' nested=' + m.nestedW + '/' + m.nestedChars + '\n');
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 's-schemes.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('page'.padEnd(38) + 'vp    scheme           proseW/chars   nestedW/chars  codeOver  codeW  H');
  for (const r of out) {
    console.log(r.page.padEnd(38) + String(r.vp).padEnd(6) + r.scheme.padEnd(17) +
      (r.proseW + '/' + r.proseChars).padEnd(15) + (r.nestedW + '/' + r.nestedChars).padEnd(15) +
      String(r.codeOverflow + '/' + r.codeScrollers).padEnd(10) + String(r.codeW).padEnd(7) + r.docHeight);
  }
})();
