'use strict';
/* critique-typo-n.js -- last mile:
   (1) .code-block / .alert / .table-wrap vertical margins
   (2) h1 size on every page type (cross-page consistency)
   (3) WCAG 1.4.1: contrast between body link colour and surrounding text colour
   (4) experiment: overflow-wrap:break-word vs anywhere -> mid-word break counts at 320/390
   Read-only (mutations are reverted / in a throwaway page). */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const hex = (h) => { const m = String(h).match(/^#([0-9a-f]{6})$/i); return m ? { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) } : null; };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const cr = (a, b) => { const A = hex(a), B = hex(b); if (!A || !B) return null; const L1 = lum(A), L2 = lum(B); return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100; };
const rgb2hex = (s) => { const m = String(s).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('') : null; };

const BLOCK_METRICS = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const out = {};
  ['.code-block', '.table-wrap', '.alert', '.article p', '.article ul', '.article blockquote', '.article hr', '.pager', '.page-footer'].forEach((sel) => {
    const el = q(sel);
    if (!el) { out[sel] = null; return; }
    const s = getComputedStyle(el);
    out[sel] = { mT: R2(parseFloat(s.marginTop)), mB: R2(parseFloat(s.marginBottom)), pT: R2(parseFloat(s.paddingTop)), pB: R2(parseFloat(s.paddingBottom)), font: R2(parseFloat(s.fontSize)) };
  });
  /* h1 across the page */
  const h1 = q('h1');
  out.h1 = h1 ? { size: R2(parseFloat(getComputedStyle(h1).fontSize)), lh: R2(parseFloat(getComputedStyle(h1).lineHeight)), weight: getComputedStyle(h1).fontWeight, cls: h1.className } : null;
  /* code block internal: title bar + pre padding */
  const cb = q('.code-block');
  if (cb) {
    const ct = q('.code-title', cb);
    const pre = q('.code-pre', cb);
    out.codeBlockParts = {
      titleH: ct ? R2(ct.getBoundingClientRect().height) : null,
      titleFont: ct ? R2(parseFloat(getComputedStyle(ct).fontSize)) : null,
      prePad: pre ? getComputedStyle(pre).padding : null,
      preFont: pre ? R2(parseFloat(getComputedStyle(pre).fontSize)) : null,
      codeFont: pre && q('code', pre) ? R2(parseFloat(getComputedStyle(q('code', pre)).fontSize)) : null,
    };
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const result = { blocks: {}, h1: {}, linkColor: {}, breakExp: {} };

  for (const u of ['/paper/dev/dialogs/', '/velocity/tuning/', '/paper/reference/world-configuration/', '/paper/', '/', '/all-pages.html']) {
    await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(60);
    const m = await page.evaluate(BLOCK_METRICS);
    result.blocks[u] = m;
    result.h1[u] = m.h1;

    /* link vs surrounding text colour (WCAG 1.4.1 / G183) */
    const lc = await page.evaluate(() => {
      const q = (s, r) => (r || document).querySelector(s);
      const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
      const p = qa('.article p, .content p').filter((x) => q('a', x) && (x.innerText || '').length > 60)[0];
      if (!p) return null;
      const a = q('a', p);
      if (!a) return null;
      const cs = getComputedStyle(a);
      const deco = cs.textDecorationLine;
      return { linkColor: cs.color, textColor: getComputedStyle(p).color, deco, weight: cs.fontWeight, underlineOnHover: getComputedStyle(p).textDecorationLine };
    });
    result.linkColor[u] = lc;
  }

  /* break experiment at 320 and 390 */
  for (const w of [320, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const mode of ['anywhere', 'break-word']) {
      await page.goto('http://127.0.0.1:8787/paper/dev/dialogs/', { waitUntil: 'load' });
      await page.evaluate((m) => {
        document.documentElement.setAttribute('data-theme', 'light');
        if (m === 'break-word') {
          const st = document.createElement('style');
          st.id = '__wrap_exp';
          st.textContent = '.article, .article :not(pre)>code, .article a, .chip{overflow-wrap:break-word}';
          document.head.appendChild(st);
        }
      }, mode);
      await page.waitForTimeout(120);
      const res = await page.evaluate(() => {
        const R2 = (v) => Math.round(v * 100) / 100;
        const q = (s, r) => (r || document).querySelector(s);
        const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
        const art = q('.article');
        const found = [];
        const blocks = qa('p, li, td, th, a, summary, .chip', art);
        for (const blk of blocks) {
          if (blk.querySelector('p, li, ul, ol')) continue;
          const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, null);
          const chars = []; let n;
          while ((n = walker.nextNode())) { const v = n.nodeValue; for (let i = 0; i < v.length; i++) chars.push({ node: n, i: i, ch: v[i] }); }
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
              const inCode = !!blk.closest('code');
              let ws = a.endK, we = b.startK;
              while (ws > 0 && /[A-Za-z]/.test(raw[ws - 1])) ws--;
              while (we < raw.length && /[A-Za-z]/.test(raw[we])) we++;
              found.push({ tag: blk.tagName.toLowerCase(), cls: blk.className, inCode: inCode, word: raw.slice(ws, we), left: raw.slice(ws, a.endK + 1), right: raw.slice(b.startK, we) });
            }
          }
        }
        const docOv = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        return { total: found.length, samples: found.slice(0, 10), inCodeCount: found.filter((f) => f.inCode).length, docOverflow: docOv };
      });
      result.breakExp[w + ' ' + mode] = res;
      process.stderr.write('ok break ' + w + ' ' + mode + ' total=' + res.total + ' inCode=' + res.inCodeCount + ' docOv=' + res.docOverflow + '\n');
    }
  }

  /* link vs body text contrast */
  const lcRows = [];
  for (const mode of ['light', 'dark']) {
    const t = mode === 'light'
      ? { accent: '#1d4ed8', fg: '#1c1f26' }
      : { accent: '#7aa2ff', fg: '#e6e8ec' };
    lcRows.push({ mode, accent: t.accent, text: t.fg, cr: cr(t.accent, t.fg) });
  }
  result.linkVsText = lcRows;

  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'n-final.json'), JSON.stringify(result, null, 1), 'utf8');
  console.log('h1 per page:'); for (const k of Object.keys(result.h1)) console.log('  ', k.padEnd(42), JSON.stringify(result.h1[k]));
  console.log('blocks dialogs:', JSON.stringify(result.blocks['/paper/dev/dialogs/'], null, 1));
  console.log('linkColors:', JSON.stringify(result.linkColor, null, 1));
  console.log('link vs text:', JSON.stringify(lcRows));
  console.log('breakExp:', JSON.stringify(result.breakExp, null, 1).slice(0, 2500));
})();
