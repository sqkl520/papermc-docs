'use strict';
/**
 * critique-typo-3.js — 定点补充度量（锐评用，只读站点）
 *  1) 用 CDP CSS.getPlatformFontsForNode 拿"真正渲染的字体"（区分 Latin/CJK/等宽）
 *  2) pre>code 的真实字号/行高（.code-pre 与 .article pre code 的组合结果）
 *  3) 长页面的标题学普查（h1..h6 计数、TOC 是否存在）
 *  4) 主题切换语义：data-theme 取值变化 + hljs token 在 auto/dark 下的真实颜色
 *  5) 列表/嵌套缩进、chip 尺寸、侧栏截断
 * 用法：node tools/critique-typo-3.js --out="..\_typo-critique\probe.md"
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const BASE = opt('url', 'http://127.0.0.1:8787');
const OUT = path.resolve(__dirname, '..', opt('out', path.join('..', '_typo-critique', 'probe.md')));
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const lines = [];
const w = (s) => lines.push(s);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  /* ---------- A. 平台字体（CDP）+ pre>code + 列表 + chip ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'zh-CN' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');

  const fontsFor = async (sel) => {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    if (!nodeId) return null;
    try {
      const r = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      return r.fonts.map((f) => f.familyName + ' ×' + f.glyphCount).join(' + ');
    } catch (e) { return 'err:' + e.message.slice(0, 40); }
  };

  for (const pg of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/']) {
    await page.goto(BASE + pg, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(300);
    w('');
    w('## ' + pg);
    w('');
    w('- 平台字体（CDP 实测）');
    for (const sel of ['.article p', '.article h2', '.article :not(pre) > code', '.article pre code', '.crumbs', '.toc-side .toc-title', '.chip']) {
      const f = await fontsFor(sel);
      if (f) w('  - `' + sel + '` → ' + f);
    }
    const extra = await page.evaluate(() => {
      const px = (v) => Math.round(parseFloat(v) * 100) / 100;
      const g = (el, p) => (el ? getComputedStyle(el)[p] : null);
      const code = document.querySelector('.article pre code') || document.querySelector('pre code');
      const pre = document.querySelector('.article pre');
      const ul = document.querySelector('.article ul');
      const nested = document.querySelector('.article li ul, .article li ol');
      const li = document.querySelector('.article li');
      const chip = document.querySelector('.chip');
      const meta = document.querySelector('.page-meta');
      const kid = document.querySelector('.article h2, .article h3');
      const secHead = document.querySelector('.section-head h2');
      const heroH1 = document.querySelector('.hero h1');
      const desc = document.querySelector('.page-desc');
      const headCensus = {};
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((t) => {
        headCensus[t + '-article'] = document.querySelectorAll('.article ' + t).length;
        headCensus[t + '-doc'] = document.querySelectorAll(t).length;
      });
      const chipBox = chip ? chip.getBoundingClientRect() : null;
      const longLi = Array.from(document.querySelectorAll('.article li')).map((e) => Math.round(e.getBoundingClientRect().width)).sort((a, b) => b - a)[0];
      const trunc = Array.from(document.querySelectorAll('.sidebar .ttl, .sidebar .grp-name')).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent || '').trim().slice(0, 24) + ' (' + e.clientWidth + '<' + e.scrollWidth + ')');
      return {
        preCode: code ? { size: px(g(code, 'fontSize')), lh: px(g(code, 'lineHeight')), lhRatio: Math.round((parseFloat(g(code, 'lineHeight')) / parseFloat(g(code, 'fontSize'))) * 100) / 100, family: g(code, 'fontFamily').split(',')[0], color: g(code, 'color'), deco: g(code, 'textDecorationLine') } : null,
        preBox: pre ? { size: px(g(pre, 'fontSize')), lh: px(g(pre, 'lineHeight')), pad: g(pre, 'padding'), radius: g(pre, 'borderRadius'), bg: g(pre, 'backgroundColor'), margin: g(pre, 'margin') } : null,
        preOuterBg: (function () { const b = document.querySelector('.code-block'), s = document.querySelector('.code-scroll'); return { blockBg: b ? g(b, 'backgroundColor') : null, blockBorder: b ? g(b, 'borderTopWidth') + ' ' + g(b, 'borderTopColor') : null, scrollLh: s ? px(g(s, 'lineHeight')) : null }; })(),
        listNested: { ulPad: ul ? px(g(ul, 'paddingLeft')) : null, ulMT: ul ? px(g(ul, 'marginTop')) : null, nestedPad: nested ? px(g(nested, 'paddingLeft')) : null, nestedMT: nested ? px(g(nested, 'marginTop')) : null, liMT: li ? px(g(li, 'marginTop')) : null, liMB: li ? px(g(li, 'marginBottom')) : null, liMarker: li ? g(li, 'listStyleType') : null, markColor: li ? getComputedStyle(li, '::marker').color : null, widestLi: longLi },
        chip: chipBox ? { w: Math.round(chipBox.width), h: Math.round(chipBox.height), size: px(g(chip, 'fontSize')), pad: g(chip, 'padding'), radius: g(chip, 'borderRadius'), border: g(chip, 'borderTopWidth') + ' ' + g(chip, 'borderTopColor'), bg: g(chip, 'backgroundColor') } : null,
        meta: meta ? { gap: g(meta, 'gap'), mb: px(g(meta, 'marginBottom')), h: Math.round(meta.getBoundingClientRect().height) } : null,
        'article-h2-borderBottom': kid ? g(kid, 'borderBottomWidth') + ' ' + g(kid, 'borderBottomColor') + ' / padB ' + px(g(kid, 'paddingBottom')) : null,
        'section-head-h2': secHead ? px(g(secHead, 'fontSize')) : null,
        'hero-h1': heroH1 ? px(g(heroH1, 'fontSize')) : null,
        'page-desc-size': desc ? px(g(desc, 'fontSize')) : null,
        headCensus,
        truncatedSidebarLabels: trunc.slice(0, 8),
        tocExists: !!document.querySelector('.toc-side'),
        tocItems: document.querySelectorAll('.toc-side a').length,
        dataTheme: document.documentElement.getAttribute('data-theme'),
      };
    });
    w('');
    w('- pre>code：' + JSON.stringify(extra.preCode));
    w('- pre 盒：' + JSON.stringify(extra.preBox) + ' / 外层 ' + JSON.stringify(extra.preOuterBg));
    w('- 列表：' + JSON.stringify(extra.listNested));
    w('- chip：' + JSON.stringify(extra.chip) + ' / page-meta ' + JSON.stringify(extra.meta));
    w('- h2 边框：' + extra['article-h2-borderBottom'] + ' / .section-head h2 ' + extra['section-head-h2'] + ' / .hero h1 ' + extra['hero-h1'] + ' / .page-desc ' + extra['page-desc-size']);
    w('- 标题普查：' + JSON.stringify(extra.headCensus));
    w('- TOC：存在=' + extra.tocExists + ' 条数=' + extra.tocItems);
    w('- 侧栏被截断的标签：' + JSON.stringify(extra.truncatedSidebarLabels));
  }
  await ctx.close();

  /* ---------- B. 主题语义：auto(系统深色) vs 点击切换 ---------- */
  w('');
  w('## 主题切换语义（hljs token 颜色 / 代码块背景）');
  w('');
  for (const scheme of ['light', 'dark']) {
    for (const click of [false, true]) {
      const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, locale: 'zh-CN' });
      const p2 = await c2.newPage();
      await p2.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 45000 });
      await p2.waitForTimeout(250);
      if (click) {
        // 点主题按钮一次（site.js 的循环：auto → dark/light …），记录切换后的 data-theme
        const btn = await p2.$('.tbtn[data-theme-toggle], #theme-toggle, .tbtn[title*="主题"], .tbtn[aria-label*="主题"], [data-action="theme"]');
        if (btn) { await btn.click(); await p2.waitForTimeout(250); } else { w('- (未找到主题按钮选择器，尝试任意 .tbtn)'); const b2 = await p2.$('.tbtn'); if (b2) { await b2.click(); await p2.waitForTimeout(250); } }
      }
      const r = await p2.evaluate(() => {
        const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
        const tok = (c) => { const e = document.querySelector('.hljs-' + c); return e ? cs(e, 'color') : null; };
        const pre = document.querySelector('.article pre code');
        const body = getComputedStyle(document.body);
        return {
          dataTheme: document.documentElement.getAttribute('data-theme'),
          bodyBg: body.backgroundColor, bodyFg: body.color,
          preBg: pre ? (function () { let n = pre; while (n) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') return c; n = n.parentElement; } return null; })() : null,
          tok: { comment: tok('comment'), keyword: tok('keyword'), string: tok('string'), number: tok('number'), title: tok('title'), built_in: tok('built_in'), variable: tok('variable'), attr: tok('attr'), tag: tok('tag'), literal: tok('literal') },
          toggleLabel: (function () { const b = document.querySelector('.tbtn[data-theme-toggle], #theme-toggle, .tbtn'); return b ? (b.textContent || '').trim().slice(0, 20) + ' | aria=' + (b.getAttribute('aria-label') || b.getAttribute('title') || '') : null; })(),
        };
      });
      w('- colorScheme=' + scheme + ' 点击切换=' + click + ' → data-theme=' + r.dataTheme + '，body ' + r.bodyFg + ' on ' + r.bodyBg + '，codeBG=' + r.preBg);
      w('  - tokens: ' + JSON.stringify(r.tok));
      w('  - 切换按钮：' + r.toggleLabel);
      await c2.close();
    }
  }

  await browser.close();

  /* ---------- D. 代码块横向滚动普查（1440 / 6 页） ---------- */
  w('');
  w('## 代码块横向滚动普查（1440x900）');
  w('');
  w('| 页面 | 代码块数 | 需横向滚动的块 | 溢出最大 px | 最长行字符数 | 列内可容字符数（等宽） |');
  w('|---|---|---|---|---|---|');
  {
    const b4 = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
    const c3 = await b4.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'zh-CN' });
    const p3 = await c3.newPage();
    for (const pg of ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html']) {
      await p3.goto(BASE + pg, { waitUntil: 'load', timeout: 45000 });
      await p3.waitForTimeout(250);
      const r3 = await p3.evaluate(() => {
        const sc = Array.from(document.querySelectorAll('.code-scroll'));
        const info = sc.map((s) => ({ over: s.scrollWidth - s.clientWidth, w: s.clientWidth }));
        const pres = Array.from(document.querySelectorAll('.article pre'));
        let longest = 0;
        pres.forEach((pre) => { (pre.textContent || '').split('\n').forEach((l) => { if (l.length > longest) longest = l.length; }); });
        const code = document.querySelector('.code-scroll pre code') || document.querySelector('pre code');
        const chW = (function () { if (!code) return null; const c = document.createElement('canvas').getContext('2d'); const s = getComputedStyle(code); c.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; return c.measureText('0').width; })();
        const wrap = sc[0] ? sc[0].clientWidth : null;
        return { n: sc.length, scrollable: info.filter((x) => x.over > 1).length, maxOver: info.length ? Math.max.apply(null, info.map((x) => x.over)) : 0, longest, chW, wrap, fits: chW && wrap ? Math.floor((wrap - 32) / chW) : null, preWrap: pres[0] ? getComputedStyle(pres[0]).whiteSpace : null };
      });
      w('| ' + pg + ' | ' + r3.n + ' | ' + r3.scrollable + ' | ' + r3.maxOver + ' | ' + r3.longest + ' | ' + r3.fits + '（ch=' + (r3.chW ? Math.round(r3.chW * 100) / 100 : '-') + ', white-space:' + r3.preWrap + '） |');
    }
    await c3.close();
    await b4.close();
  }

  /* ---------- E. 过小字号普查（< 12px） ---------- */
  w('');
  w('## 过小字号普查（computed font-size < 12px，1440x900）');
  w('');
  {
    const b5 = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
    const c4 = await b5.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'zh-CN' });
    const p4 = await c4.newPage();
    for (const pg of ['/', '/paper/dev/dialogs/', '/velocity/tuning/', '/all-pages.html']) {
      await p4.goto(BASE + pg, { waitUntil: 'load', timeout: 45000 });
      await p4.waitForTimeout(200);
      const r4 = await p4.evaluate(() => {
        const seen = {};
        const list = [];
        document.querySelectorAll('body *').forEach((el) => {
          const s = getComputedStyle(el);
          const size = parseFloat(s.fontSize);
          if (size >= 12 || !(el.textContent || '').trim()) return;
          const key = el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 2).join('.') : '') + '@' + Math.round(size * 100) / 100;
          if (seen[key]) { seen[key].n++; return; }
          seen[key] = { n: 1, size: Math.round(size * 100) / 100, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18), chain: getComputedStyle(el).fontSize };
          list.push(seen[key]);
        });
        list.sort((a, b) => a.size - b.size);
        const sizes = {};
        document.querySelectorAll('body *').forEach((el) => { const s = getComputedStyle(el).fontSize; sizes[s] = (sizes[s] || 0) + 1; });
        return { list: list.slice(0, 14), distinct: Object.keys(sizes).length, min: Object.keys(sizes).map(parseFloat).sort((a, b) => a - b)[0] };
      });
      w('- `' + pg + '`：**' + r4.distinct + ' 种字号**，最小 ' + r4.min + 'px；<12px 的元素：');
      r4.list.forEach((x) => w('  - ' + x.size + 'px ×' + x.n + ' 例 —— ' + x.text));
    }
    await c4.close();
    await b5.close();
  }

  /* ---------- C. 对比度计算（WCAG 2.2 相对亮度公式，成对自算） ---------- */
  const hex = (h) => { const s = h.replace('#', ''); return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const L1 = lum(hex(a)), L2 = lum(hex(b)); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };

  const PAIRS_LIGHT = [
    ['正文 #1c1f26 / 页面 #ffffff', '#1c1f26', '#ffffff'],
    ['次要 #5c6470 / 页面 #ffffff', '#5c6470', '#ffffff'],
    ['次要 #5c6470 / 软底 #f7f8fa', '#5c6470', '#f7f8fa'],
    ['链接 #1d4ed8 / 页面 #ffffff', '#1d4ed8', '#ffffff'],
    ['链接 #1d4ed8 **vs 正文色** #1c1f26（WCAG G183 要求 ≥3:1）', '#1d4ed8', '#1c1f26'],
    ['链接 #1d4ed8 / 软底 #f7f8fa', '#1d4ed8', '#f7f8fa'],
    ['accent-soft #e3ebfd / 白底（选中态底色，非文本 1.4.11）', '#e3ebfd', '#ffffff'],
    ['边框 #e2e5ea / 页面 #ffffff（非文本 1.4.11 要求 3:1）', '#e2e5ea', '#ffffff'],
    ['强边框 #cdd2da / 页面 #ffffff', '#cdd2da', '#ffffff'],
    ['按钮填充 #f7f8fa / 页面 #ffffff（控件可辨识度）', '#f7f8fa', '#ffffff'],
    ['代码块底 #fbfbfd / 页面 #ffffff', '#fbfbfd', '#ffffff'],
    ['行内代码底 #f2f3f7 / 页面 #ffffff', '#f2f3f7', '#ffffff'],
    ['徽章 NOTE 白字 #ffffff / #2563eb', '#ffffff', '#2563eb'],
    ['徽章 TIP 白字 / #0b7a43', '#ffffff', '#0b7a43'],
    ['徽章 IMPORTANT 白字 / #7c3aed', '#ffffff', '#7c3aed'],
    ['徽章 WARNING 白字 / #a35a00', '#ffffff', '#a35a00'],
    ['徽章 CAUTION 白字 / #b45309', '#ffffff', '#b45309'],
    ['徽章 DANGER 白字 / #dc2626', '#ffffff', '#dc2626'],
  ];
  const PAIRS_DARK = [
    ['正文 #e6e8ec / 页底 #14161a', '#e6e8ec', '#14161a'],
    ['次要 #9aa3af / 页底 #14161a', '#9aa3af', '#14161a'],
    ['链接 #7aa2ff / 页底 #14161a', '#7aa2ff', '#14161a'],
    ['链接 #7aa2ff **vs 正文色** #e6e8ec', '#7aa2ff', '#e6e8ec'],
    ['边框 #2a2f38 / 页底 #14161a', '#2a2f38', '#14161a'],
    ['强边框 #3a414d / 页底 #14161a', '#3a414d', '#14161a'],
    ['代码块底 #171a1f / 页底 #14161a', '#171a1f', '#14161a'],
    ['徽章 NOTE #6aa2ff / 深字 #14161a', '#6aa2ff', '#14161a'],
    ['徽章 TIP #3ddc97 / 深字 #14161a', '#3ddc97', '#14161a'],
    ['徽章 WARNING #f0b429 / 深字 #14161a', '#f0b429', '#14161a'],
    ['徽章 DANGER #ff6b6b / 深字 #14161a', '#ff6b6b', '#14161a'],
  ];
  const TOKENS = [
    ['comment', '#6b7280', '#8b95a5'],
    ['keyword / literal / selector-tag', '#a626a4', '#d2a8ff'],
    ['string / regexp / addition', '#3f8f4f', '#7ee787'],
    ['number / bullet / symbol', '#986801', '#ffab70'],
    ['title / name / type / attr', '#3b6fd4', '#79c0ff'],
    ['built_in / meta / tag', '#b06f00', '#ffa657'],
    ['variable / params / property', '#c2410c', '#ffa657'],
    ['deletion', '#dc2626', ''],
  ];

  w('');
  w('## 对比度自算（WCAG 2.2 相对亮度公式）');
  w('');
  w('### light 主题（关键对）');
  w('');
  w('| 前景 / 背景 | 比值 | 判定 |');
  w('|---|---|---|');
  PAIRS_LIGHT.forEach((p) => { const r = ratio(p[1], p[2]); w('| ' + p[0] + ' | **' + r + '** | ' + (r >= 4.5 ? 'AA 正文' : r >= 3 ? 'AA 大字/非文本' : '不达标') + ' |'); });
  w('');
  w('### dark 主题（显式 data-theme="dark"）');
  w('');
  w('| 前景 / 背景 | 比值 | 判定 |');
  w('|---|---|---|');
  PAIRS_DARK.forEach((p) => { const r = ratio(p[1], p[2]); w('| ' + p[0] + ' | **' + r + '** | ' + (r >= 4.5 ? 'AA 正文' : r >= 3 ? 'AA 大字/非文本' : '不达标') + ' |'); });
  w('');
  w('### 代码高亮 token：同一套浅色值 × 两种代码底');
  w('');
  w('| token | 浅色值 | 在 #fbfbfd（light） | 在 #171a1f（auto-dark 实际发生） | 显式 dark 值 | 在 #171a1f（显式 dark） |');
  w('|---|---|---|---|---|---|');
  TOKENS.forEach((t) => {
    const a = ratio(t[1], '#fbfbfd'), b = ratio(t[1], '#171a1f'), c = t[2] ? ratio(t[2], '#171a1f') : null;
    const v = (x) => (x === null ? '-' : '**' + x + '**' + (x >= 4.5 ? ' AA' : x >= 3 ? ' 大字/非文本' : ' 不达标'));
    w('| ' + t[0] + ' | ' + t[1] + ' | ' + v(a) + ' | ' + v(b) + ' | ' + (t[2] || '-') + ' | ' + (c === null ? '-' : v(c)) + ' |');
  });

  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
  console.log('写出 ' + OUT);
})();
