'use strict';
/* critique-typo-k.js -- UI component contrast (WCAG 1.4.11) + true rendered code font size
   + heading navigation density per page. Read-only. */
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
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const a = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 };
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const cr = (a, b) => { if (!a || !b) return null; const L1 = lum(a), L2 = lum(b); return R2((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)); };
  const effBg = (el) => { let n = el, acc = null; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.01) acc = acc ? blend(acc, c) : c; if (acc && acc.a >= 0.999) return acc; n = n.parentElement; } return acc || { r: 255, g: 255, b: 255 }; };

  /* UI components whose boundary must reach 3:1 against the adjacent colour */
  const uiProbe = (sel, label) => {
    const el = q(sel);
    if (!el) return { label, sel, missing: true };
    const s = getComputedStyle(el);
    const bgInside = effBg(el);
    const bgOutside = el.parentElement ? effBg(el.parentElement) : bgInside;
    const bc = parse(s.borderTopColor);
    return {
      label, sel,
      border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor,
      borderCrVsOutside: bc && bc.a > 0.01 ? cr(bc, bgOutside) : null,
      bgInside: 'rgb(' + [bgInside.r, bgInside.g, bgInside.b].map(Math.round).join(',') + ')',
      bgOutside: 'rgb(' + [bgOutside.r, bgOutside.g, bgOutside.b].map(Math.round).join(',') + ')',
      bgStepCr: cr(bgInside, bgOutside),
      focusOutline: s.outlineColor + ' ' + s.outlineStyle,
    };
  };

  /* true glyph size inside a code block: measure a rendered character's box */
  const codeText = (function () {
    const pre = q('.code-pre');
    if (!pre) return null;
    const codeEl = q('code', pre);
    if (!codeEl) return null;
    const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT, null);
    let n = null, best = null;
    while ((n = walker.nextNode())) { if ((n.nodeValue || '').trim().length > 20) { best = n; break; } }
    if (!best) return null;
    const idx = best.nodeValue.search(/[A-Za-z]/);
    const r = document.createRange();
    r.setStart(best, idx); r.setEnd(best, idx + 1);
    const rr = r.getBoundingClientRect();
    const cs = getComputedStyle(codeEl);
    const preCs = getComputedStyle(pre);
    /* canvas: width of 100 'M' in this font */
    const cvs = document.createElement('canvas').getContext('2d');
    cvs.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const w100 = cvs.measureText('M'.repeat(100)).width;
    /* same for the body font, for a relative size comparison */
    const p = qa('.article p').filter((x) => !x.className && (x.innerText || '').trim().length > 80)[0];
    const pCs = p ? getComputedStyle(p) : null;
    cvs.font = pCs ? (pCs.fontStyle + ' ' + pCs.fontWeight + ' ' + pCs.fontSize + ' ' + pCs.fontFamily) : '16px sans-serif';
    const bodyM = cvs.measureText('M'.repeat(100)).width / 100;
    return {
      codeFontSize: R2(parseFloat(cs.fontSize)),
      codeLineHeight: R2(parseFloat(cs.lineHeight)),
      codeLhRatio: R2(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)),
      preFontSize: R2(parseFloat(preCs.fontSize)),
      glyphBoxH: R2(rr.height), glyphBoxW: R2(rr.width),
      advanceM: R2(w100 / 100),
      bodyFontSize: pCs ? R2(parseFloat(pCs.fontSize)) : null,
      bodyAdvanceM: R2(bodyM),
      ratioToBody: pCs ? R2(parseFloat(cs.fontSize) / parseFloat(pCs.fontSize)) : null,
      monoIsMonospace: R2(cvs.measureText('i').width) !== null,
      family: cs.fontFamily,
    };
  })();

  /* heading density: how far apart are anchors down a long page */
  const art = q('.article');
  const heads = qa('h1,h2,h3,h4,h5,h6', art);
  const yPos = heads.map((h) => R2(h.getBoundingClientRect().y + window.scrollY));
  const gaps = [];
  for (let i = 1; i < yPos.length; i++) gaps.push(R2(yPos[i] - yPos[i - 1]));
  const dh = Math.round(document.documentElement.scrollHeight);

  return {
    url: location.pathname,
    ui: [
      uiProbe('.side-filter', 'sidebar filter input'),
      uiProbe('.theme-toggle, #theme-toggle, .tbtn', 'theme button'),
      uiProbe('a.chip', 'meta chip'),
      uiProbe('.tbtn', 'topbar button'),
      uiProbe('.code-copy', 'copy button'),
      uiProbe('.table-wrap', 'table frame'),
      uiProbe('.alert', 'callout frame'),
    ].filter(Boolean),
    code: codeText,
    headingDensity: {
      docHeight: dh,
      headingCount: heads.length,
      headingsPer1000px: heads.length ? R2(heads.length / dh * 1000) : 0,
      maxGapPx: gaps.length ? Math.max.apply(null, gaps) : null,
      maxGapAt: gaps.length ? yPos[gaps.indexOf(Math.max.apply(null, gaps)) + 1] : null,
      gaps: gaps.slice(0, 20),
    },
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb'] });
  const out = {};
  for (const [label, scheme, url] of [
    ['light', 'light', '/paper/dev/dialogs/'],
    ['dark', 'dark', '/paper/dev/dialogs/'],
    ['auto-dark', 'dark', '/paper/dev/dialogs/'],
    ['light', 'light', '/paper/reference/world-configuration/'],
    ['light', 'light', '/paper/'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787' + url, { waitUntil: 'load' });
    await page.evaluate((m) => {
      const want = m.indexOf('auto') === 0 ? 'auto' : m;
      try { localStorage.setItem('lcb-theme', want); } catch (e) {}
      document.documentElement.setAttribute('data-theme', want);
    }, label);
    await page.waitForTimeout(120);
    out[label + ' ' + url] = await page.evaluate(IN_PAGE);
    process.stderr.write('ok ' + label + ' ' + url + '\n');
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'k-ui.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const k of Object.keys(out)) {
    const v = out[k];
    console.log('==', k);
    console.log('  code', JSON.stringify(v.code));
    console.log('  density', JSON.stringify(v.headingDensity));
    v.ui.forEach((u) => console.log('   ui', u.label, u.missing ? 'MISSING' : ('borderCr=' + u.borderCrVsOutside + ' bgStep=' + u.bgStepCr + ' border=' + u.border)));
  }
})();
