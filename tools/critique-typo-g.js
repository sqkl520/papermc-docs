'use strict';
/* critique-typo-g.js -- targeted: body link colour/underline, code-block token contrast in
   light/dark/auto-dark, border visibility, and the 1024<->1025 cliff. Read-only. */
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
  const cr = (a, b) => { if (!a || !b) return null; const L1 = lum(a), L2 = lum(b); return R2((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)); };
  const effBg = (el) => { let n = el; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a >= 0.99) return c; n = n.parentElement; } return { r: 255, g: 255, b: 255 }; };

  const art = q('.article');
  const bodyLink = qa('p a', art).filter((a) => !/chip|tbtn/.test(a.className))[0];
  const inP = bodyLink ? bodyLink.closest('p') : null;

  const linkInfo = bodyLink ? (function () {
    const s = getComputedStyle(bodyLink);
    return {
      text: (bodyLink.innerText || '').trim().slice(0, 30),
      cls: bodyLink.className,
      color: s.color, colorHex: (function () { const c = parse(s.color); return c ? '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : null; })(),
      deco: s.textDecorationLine, decoStyle: s.textDecorationStyle, decoThickness: s.textDecorationThickness,
      weight: s.fontWeight,
      borderBottom: s.borderBottomWidth + ' ' + s.borderBottomStyle + ' ' + s.borderBottomColor,
      contrastVsBody: cr(parse(s.color), effBg(inP)),
      sameColorAsText: false,
    };
  })() : null;

  /* token contrast in a real code block */
  const pre = q('.code-pre');
  const tokens = {};
  if (pre) {
    qa('[class*="hljs-"]', pre).forEach((el) => {
      const cls = Array.prototype.slice.call(el.classList).find((c) => c.indexOf('hljs-') === 0);
      if (!cls || tokens[cls]) return;
      const s = getComputedStyle(el);
      const bg = effBg(el);
      tokens[cls] = { color: s.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].join(',') + ')', cr: cr(parse(s.color), bg), sample: (el.textContent || '').slice(0, 20) };
    });
  }
  const preS = pre ? getComputedStyle(pre) : null;
  const preBg = pre ? effBg(pre) : null;

  /* borders that actually matter for structure */
  const borderProbe = (sel) => {
    const el = q(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const w = ['Top', 'Right', 'Bottom', 'Left'].map((d) => parseFloat(s['border' + d + 'Width']) || 0);
    const bc = parse(s.borderTopColor);
    const bg = effBg(el.parentElement || el);
    return { sel, widths: w, color: s.borderTopColor, crVsParentBg: cr(bc, bg), style: s.borderTopStyle };
  };

  return {
    theme: document.documentElement.getAttribute('data-theme'),
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    link: linkInfo,
    code: {
      preBg: preBg ? 'rgb(' + [preBg.r, preBg.g, preBg.b].join(',') + ')' : null,
      preFont: preS ? preS.fontSize : null,
      tokenCount: Object.keys(tokens).length,
      tokens: tokens,
    },
    borders: ['.table-wrap', '.alert', '.code-block', '.page-footer', '.toc-side', '.chip', '.card', '.article h2'].map(borderProbe).filter(Boolean),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb'] });
  const out = {};
  const cases = [
    ['light', 'light', '/paper/dev/dialogs/'],
    ['dark', 'dark', '/paper/dev/dialogs/'],
    ['auto-dark', 'dark', '/paper/dev/dialogs/'],
    ['auto-light', 'light', '/paper/dev/dialogs/'],
    ['light', 'light', '/paper/reference/world-configuration/'],
    ['dark', 'dark', '/paper/reference/world-configuration/'],
  ];
  for (const [label, scheme, url] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787' + url, { waitUntil: 'load' });
    await page.evaluate((m) => {
      const want = m.indexOf('auto') === 0 ? 'auto' : m;
      try { localStorage.setItem('lcb-theme', want); } catch (e) {}
      document.documentElement.setAttribute('data-theme', want);
    }, label);
    await page.waitForTimeout(150);
    out[label + ' ' + url] = await page.evaluate(IN_PAGE);
    process.stderr.write('ok ' + label + ' ' + url + '\n');
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'g-links.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log(JSON.stringify(out, null, 1).slice(0, 4000));
})();
