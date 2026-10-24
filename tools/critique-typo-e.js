'use strict';
/**
 * critique-typo-e.js -- calibrate the reading-column width.
 *
 * For a list of candidate column widths (px and ch), measure on the real page:
 *   - median characters per line INCLUDING spaces  (the metric Bringhurst/Butterick use)
 *   - median characters per line EXCLUDING spaces  (glyph count)
 *   - median Han characters per line (CJK measure)
 *   - ragged-edge variance and hyphenless mid-word breaks
 * This is what turns "60-75ch" from a ch-unit guess into an observed value on this
 * exact font stack (system-ui -> Segoe UI on Windows, '0' advance = 8.01px @16px).
 *
 * Also audits non-text contrast (WCAG 1.4.11) for borders/badges in light + dark,
 * computed from the live custom properties.
 *
 * Usage: node tools/critique-typo-e.js --out="..\_typo-critique\e-calib.json"
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const BASE = opt('url', 'http://127.0.0.1:8787');
const OUT = path.resolve(__dirname, '..', opt('out', path.join('..', '_typo-critique', 'e-calib.json')));

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const IN_PAGE = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const art = q('.article');

  const refP = qa('p', art).filter((p) => !p.className && (p.innerText || '').trim().length > 60)[0] || q('p', art);
  const refS = getComputedStyle(refP);

  /* 1ch in px for the body font */
  const chPx = (function () {
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;left:-9999px;display:block;width:1ch;font:' + refS.font;
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return R2(w);
  })();

  /* average advance of a lowercase letter + space (the "character" of typographic measure) */
  const avgAdv = (function () {
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;left:-9999px;white-space:pre;font:' + refS.font;
    const sample = 'the quick brown fox jumps over a lazy dog and then some more words follow here ';
    s.textContent = sample;
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return R2(w / sample.length);
  })();

  const buildProbe = (text) => {
    const el = document.createElement('p');
    el.style.cssText = 'margin:0;padding:0;border:0;width:100%;max-width:none;box-sizing:border-box;' +
      'font:' + refS.font + ';letter-spacing:' + refS.letterSpacing + ';word-spacing:' + refS.wordSpacing +
      ';overflow-wrap:' + refS.overflowWrap + ';word-break:' + refS.wordBreak + ';line-height:' + refS.lineHeight;
    el.textContent = text;
    refP.parentNode.insertBefore(el, refP.nextSibling);
    return el;
  };

  const scan = (el, text) => {
    const node = el.firstChild;
    const rng = document.createRange();
    const geo = [];
    for (let i = 0; i < text.length; i++) {
      rng.setStart(node, i); rng.setEnd(node, i + 1);
      const rr = rng.getBoundingClientRect();
      geo.push({ i: i, ch: text[i], top: rr.top, bottom: rr.bottom, w: rr.width, x1: rr.right });
    }
    const lines = [];
    for (const g of geo) {
      let t = null;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 2; i--) {
        const L = lines[i];
        const ov = Math.min(L.bottom, g.bottom) - Math.max(L.top, g.top);
        if (ov > Math.min(L.bottom - L.top, g.bottom - g.top) * 0.5) { t = L; break; }
      }
      if (!t) { t = { top: g.top, bottom: g.bottom, all: 0, glyphs: 0, han: 0, lastI: 0, x1: 0, firstI: g.i }; lines.push(t); }
      t.top = Math.min(t.top, g.top); t.bottom = Math.max(t.bottom, g.bottom);
      t.lastI = g.i; t.x1 = Math.max(t.x1, g.x1);
      if (g.w > 0) {
        t.all++;
        if (!/\s/.test(g.ch)) { t.glyphs++; if (/[\u4e00-\u9fff]/.test(g.ch)) t.han++; }
      }
    }
    lines.sort((a, b) => a.top - b.top);
    const body = lines.slice(0, -1);   // drop the short last line
    const med = (arr) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)] : null);
    /* mid-word breaks: no whitespace between the two lines, Latin letters on both sides */
    let breaks = 0;
    for (let k = 0; k + 1 < lines.length; k++) {
      const between = text.slice(lines[k].lastI, lines[k + 1].firstI + 1);
      if (/\s/.test(between)) continue;
      const ec = text[lines[k].lastI], sc = text[lines[k + 1].firstI] || '';
      if (/[A-Za-z]/.test(ec) && /[A-Za-z]/.test(sc)) breaks++;
    }
    return {
      lineCount: lines.length,
      medianAll: med(body.map((l) => l.all)),
      medianGlyphs: med(body.map((l) => l.glyphs)),
      medianHan: med(body.map((l) => l.han)),
      minAll: body.length ? Math.min.apply(null, body.map((l) => l.all)) : null,
      maxAll: body.length ? Math.max.apply(null, body.map((l) => l.all)) : null,
      midWordBreaks: breaks,
    };
  };

  const LATIN = ('Minecraft server administrators configure world settings through a hierarchical ' +
    'configuration file that mirrors the structure of the settings themselves. Each leaf value ' +
    'carries a description, a default, and a type. Editing the file requires restarting the server ' +
    'before the changes take effect, and invalid values are silently replaced by defaults. ').repeat(2);
  const HAN = ('世界配置文件采用层级结构组织每一个设置项，其层级与设置本身的嵌套关系保持一致。' +
    '每个叶子节点都带有说明、默认值与类型标注。修改文件后需要重启服务器才会生效，' +
    '若取值非法则会被静默替换为默认值，因此建议在修改前先备份原始文件。').repeat(2);

  const rows = [];
  const style = document.createElement('style');
  style.textContent = '.article>*{max-width:none}';
  document.head.appendChild(style);

  const CAND = [600, 640, 672, 688, 704, 720, 736, 768, 800, 848, 900, 948];
  for (const c of CAND) {
    style.textContent = '.article>*{max-width:' + c + 'px}';
    void art.offsetWidth;
    const lat = buildProbe(LATIN);
    const latW = lat.getBoundingClientRect().width;
    const ls = scan(lat, LATIN);
    lat.remove();
    const han = buildProbe(HAN);
    const hs = scan(han, HAN);
    han.remove();
    /* CJK: does it hyphenate/wrap mid-word? count lines ending without punctuation */
    rows.push({
      target: c, actualW: R2(latW),
      inCh: R2(c / chPx), inRem: R2(c / 16),
      charsPerLine: ls.medianAll, glyphsPerLine: ls.medianGlyphs,
      hanPerLine: hs.medianHan, midWordBreaks: ls.midWordBreaks,
      lines: ls.lineCount, ragged: ls.maxAll - ls.minAll,
    });
  }
  style.remove();
  void art.offsetWidth;

  /* native (unmodified) row for reference */
  const lat0 = buildProbe(LATIN);
  const nativeW = R2(lat0.getBoundingClientRect().width);
  const native = scan(lat0, LATIN);
  lat0.remove();
  const han0 = buildProbe(HAN);
  const nativeHan = scan(han0, HAN);
  han0.remove();

  /* ---- non-text contrast audit (WCAG 1.4.11: 3:1) ---- */
  const hex = (h) => {
    const m = String(h).trim().match(/^#([0-9a-f]{6})$/i);
    if (!m) return null;
    return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const cr = (a, b) => {
    const A = hex(a), B = hex(b);
    if (!A || !B) return null;
    const L1 = lum(A), L2 = lum(B);
    return R2((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
  };
  const pairs = [];
  const readTokens = (scope) => {
    const s = getComputedStyle(scope);
    return {
      bg: s.getPropertyValue('--bg').trim(), bgSoft: s.getPropertyValue('--bg-soft').trim(),
      bgElev: s.getPropertyValue('--bg-elev').trim(), codeBg: s.getPropertyValue('--code-bg').trim(),
      fg: s.getPropertyValue('--fg').trim(), fgMuted: s.getPropertyValue('--fg-muted').trim(),
      border: s.getPropertyValue('--border').trim(), borderStrong: s.getPropertyValue('--border-strong').trim(),
      accent: s.getPropertyValue('--accent').trim(), accentSoft: s.getPropertyValue('--accent-soft').trim(),
    };
  };
  const auditTokens = (label, t) => ([
    { what: label + ' 正文 fg/bg', a: t.fg, b: t.bg, need: 4.5 },
    { what: label + ' 次要 fg-muted/bg-soft', a: t.fgMuted, b: t.bgSoft, need: 4.5 },
    { what: label + ' 次要 fg-muted/bg', a: t.fgMuted, b: t.bg, need: 4.5 },
    { what: label + ' 链接 accent/bg', a: t.accent, b: t.bg, need: 4.5 },
    { what: label + ' 链接 accent/bg-soft', a: t.accent, b: t.bgSoft, need: 4.5 },
    { what: label + ' 行内码 fg/bg-elev', a: t.fg, b: t.bgElev, need: 4.5 },
    { what: label + ' 代码 fg/code-bg', a: t.fg, b: t.codeBg, need: 4.5 },
    { what: label + ' 边框 border/bg', a: t.border, b: t.bg, need: 3.0 },
    { what: label + ' 强边框 border-strong/bg', a: t.borderStrong, b: t.bg, need: 3.0 },
    { what: label + ' 边框 border/bg-soft', a: t.border, b: t.bgSoft, need: 3.0 },
  ]);

  document.documentElement.setAttribute('data-theme', 'light');
  const lightT = readTokens(document.documentElement);
  const lightRows = auditTokens('light', lightT);
  document.documentElement.setAttribute('data-theme', 'dark');
  const darkT = readTokens(document.documentElement);
  const darkRows = auditTokens('dark', darkT);
  document.documentElement.setAttribute('data-theme', 'light');

  /* badge contrast in both themes */
  const badge = (function () {
    const out = [];
    const b = q('.alert-title .badge, .alert-title > span, .alert-title');
    ['light', 'dark'].forEach((m) => {
      document.documentElement.setAttribute('data-theme', m);
      const cs = getComputedStyle(document.documentElement);
      const types = ['note', 'tip', 'important', 'warning', 'caution', 'danger'];
      types.forEach((t) => {
        out.push({ mode: m, type: t, fg: cs.getPropertyValue('--badge-' + t).trim(), bg: cs.getPropertyValue('--badge-fg').trim(), cr: cr(cs.getPropertyValue('--badge-' + t).trim(), cs.getPropertyValue('--badge-fg').trim()) });
      });
    });
    document.documentElement.setAttribute('data-theme', 'light');
    return out;
  })();

  return {
    url: location.pathname,
    bodyFontPx: R2(parseFloat(refS.fontSize)),
    chPx: chPx, avgAdvancePx: avgAdv,
    native: { w: nativeW, charsPerLine: native.medianAll, glyphs: native.medianGlyphs, han: nativeHan.medianHan, breaks: native.midWordBreaks },
    rows: rows,
    contrast: { light: lightRows, dark: darkRows },
    badges: badge,
    tokens: { light: lightT, dark: darkT },
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const out = {};
  for (const pg of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
    const page = await ctx.newPage();
    await page.goto(BASE + pg, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(100);
    out[pg] = await page.evaluate(IN_PAGE);
    process.stderr.write('ok ' + pg + ' ch=' + out[pg].chPx + ' avg=' + out[pg].avgAdvancePx + '\n');
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), data: out }, null, 1), 'utf8');
  process.stderr.write('wrote ' + OUT + '\n');
})();
