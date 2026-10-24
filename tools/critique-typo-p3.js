'use strict';
/**
 * critique-typo-p3.js — 补齐 p2 抽错的 hljs 深色 token，并做主题路径的「选择器命中」判定
 * 纯静态解析 assets/site.css，无需浏览器。
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'site.css'), 'utf8');

const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const parseHex = (h) => { h = h.replace(/^#/, ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]; };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100; };

/* 逐行解析：每条规则可能包含多个选择器 */
const lightMap = {};   // token -> hex
const darkMap = {};
for (const raw of css.split('\n')) {
  const line = raw.trim();
  if (!line.startsWith('.hljs') && !line.startsWith('html[data-theme="dark"]')) continue;
  const m = line.match(/^([^{]+)\{color:\s*(#[0-9a-fA-F]{3,6})/);
  if (!m) continue;
  const sels = m[1].split(',');
  const color = m[2];
  for (let s of sels) {
    s = s.trim();
    const dm = s.match(/^html\[data-theme="dark"\]\s+\.hljs-([a-zA-Z0-9_.\- ]+)$/);
    if (dm) { darkMap[dm[1].trim()] = color; continue; }
    const lm = s.match(/^\.hljs-([a-zA-Z0-9_.\- ]+)$/);
    if (lm) lightMap[lm[1].trim()] = color;
  }
}

const lightBg = '#fbfbfd';   // --code-bg light
const darkBg = '#171a1f';    // --code-bg dark

const rowsLight = Object.entries(lightMap).map(([t, c]) => ({ token: t, fg: c, bg: lightBg, ratio: ratio(parseHex(c), parseHex(lightBg)), pass: ratio(parseHex(c), parseHex(lightBg)) >= 4.5 }));
const rowsDark = Object.entries(darkMap).map(([t, c]) => ({ token: t, fg: c, bg: darkBg, ratio: ratio(parseHex(c), parseHex(darkBg)), pass: ratio(parseHex(c), parseHex(darkBg)) >= 4.5 }));
/* auto + 系统深色：选择器 html[data-theme="dark"] 不命中 data-theme="auto" → 仍用 light 色板，但底色已被 auto 块改成深色 */
const rowsAutoDark = rowsLight.map((r) => ({ token: r.token, fg: r.fg, bg: darkBg, ratio: ratio(parseHex(r.fg), parseHex(darkBg)), pass: ratio(parseHex(r.fg), parseHex(darkBg)) >= 4.5 }));

const out = {
  counts: { lightTokens: rowsLight.length, darkTokens: rowsDark.length },
  light: rowsLight,
  dark: rowsDark,
  autoDark: rowsAutoDark,
  autoDarkFails: rowsAutoDark.filter((r) => !r.pass).length,
  lightFails: rowsLight.filter((r) => !r.pass).length,
  darkFails: rowsDark.filter((r) => !r.pass).length,
  /* 选择器命中判定 */
  selectorHit: {
    'html[data-theme="dark"]': '命中：用户手动切到深色',
    'html[data-theme="auto"] + @media prefers-color-scheme:dark': '只搬了 :root 令牌，没有搬 .hljs-* 规则 → 代码高亮停在浅色板',
  },
  /* 每个 token 的建议值：在深色底上补到 ≥4.5:1 */
};

/* 为 auto-dark 每条 token 求「最小提亮」建议：沿 HSL 提升明度，直至 ≥4.5 */
function suggest(fgHex, bgHex, target) {
  const c = parseHex(fgHex);
  const bg = parseHex(bgHex);
  const toHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0; const l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  };
  const hslToRgb = (h, s, l) => {
    const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - C / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [C, X, 0]; else if (h < 120) [r, g, b] = [X, C, 0];
    else if (h < 180) [r, g, b] = [0, C, X]; else if (h < 240) [r, g, b] = [0, X, C];
    else if (h < 300) [r, g, b] = [X, 0, C]; else [r, g, b] = [C, 0, X];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  };
  const [h, s, l0] = toHsl(c[0], c[1], c[2]);
  for (let l = l0; l <= 1; l += 0.005) {
    const rgb = hslToRgb(h, s, l);
    if (ratio(rgb, bg) >= target) {
      return { hex: '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), ratio: ratio(rgb, bg), light: Math.round(l * 1000) / 1000 };
    }
  }
  /* 原色相提不上去（紫/蓝在深底上需要更多明度），退化为「同色相加白混合」 */
  for (let a = 0; a <= 1; a += 0.02) {
    const mix = [c[0] + (255 - c[0]) * a, c[1] + (255 - c[1]) * a, c[2] + (255 - c[2]) * a];
    if (ratio(mix, bg) >= target) return { hex: '#' + mix.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), ratio: ratio(mix, bg), mixWhite: Math.round(a * 100) / 100 };
  }
  return null;
}

out.autoDarkSuggestions = rowsAutoDark.map((r) => {
  const s = suggest(r.fg, darkBg, 4.5);
  return { token: r.token, from: r.fg, fromRatio: r.ratio, to: s ? s.hex : null, toRatio: s ? s.ratio : null, light: s ? s.light : null, mixWhite: s ? s.mixWhite : null };
});

fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p3.json'), JSON.stringify(out, null, 1), 'utf8');
console.log('light tokens=' + out.counts.lightTokens + ' fails=' + out.lightFails);
console.log('dark  tokens=' + out.counts.darkTokens + ' fails=' + out.darkFails);
console.log('auto+dark fails=' + out.autoDarkFails + '/' + rowsAutoDark.length);
