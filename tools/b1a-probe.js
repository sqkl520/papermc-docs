'use strict';
/**
 * b1a-probe.js — 批 1 a11y 审查阶段 A：几何 / 命中目标 / 对比度 / 代码区语义
 *
 * 证据只写系统临时目录（硬性约束：仓库内只允许写 reports/b1-a11y.md 与 tools/b1a-*.js）。
 * 同时跑 8787（改后）与 8788（改前对照）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(os.tmpdir(), 'dsh-b1a');
fs.mkdirSync(TMP, { recursive: true });
const OUT = path.join(TMP, 'probe.json');

function chromePath() {
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) {
    cands.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'));
    cands.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'));
  }
  if (process.env.PROGRAMFILES) cands.push(path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  throw new Error('no chrome: ' + cands.join(' | '));
}

const PORTS = [8787, 8788];

// ---- 颜色工具（Node 侧，吃浏览器返回的 computed 字符串）----
function parseColor(s) {
  s = String(s || '').trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[,\/\s]+/).filter(Boolean).map(Number);
    if (p.length >= 3) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function relLum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
function over(fg, bg) {
  const a = fg.a === undefined ? 1 : fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}
function ratio(fgS, bgS) {
  let fg = parseColor(fgS), bg = parseColor(bgS);
  if (!fg || !bg) return null;
  if (bg.a < 1) bg = over(bg, { r: 255, g: 255, b: 255, a: 1 });
  if (fg.a < 1) fg = over(fg, bg);
  const L1 = relLum(fg), L2 = relLum(bg);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}
function verdict(r, need) { return r === null ? 'n/a' : (r >= need ? 'PASS' : 'FAIL'); }

// 颜色采样器（浏览器内）
const SAMPLE = `
function parseC(s){
  s=String(s||'').trim();
  let m=s.match(/^#([0-9a-f]{3,8})$/i);
  if(m){let h=m[1];if(h.length===3)h=h.split('').map(c=>c+c).join('');
    return {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16),a:h.length>=8?parseInt(h.slice(6,8),16)/255:1};}
  m=s.match(/^rgba?\\(([^)]+)\\)$/i);
  if(m){const p=m[1].split(/[,\\/\\s]+/).filter(Boolean).map(Number);
    if(p.length>=3) return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
  return null;
}
function effBg(el){
  let n=el;
  while(n&&n!==document.documentElement){
    const p=parseC(getComputedStyle(n).backgroundColor);
    if(p&&p.a>0.5) return getComputedStyle(n).backgroundColor;
    n=n.parentElement;
  }
  const b=parseC(getComputedStyle(document.body).backgroundColor);
  if(b&&b.a>0.5) return getComputedStyle(document.body).backgroundColor;
  return 'rgb(255,255,255)';
}
function snap(el,label){
  if(!el) return {label,missing:true};
  const cs=getComputedStyle(el);
  const bg=effBg(el);
  return {label,color:cs.color,bg,fontSize:cs.fontSize,fontWeight:cs.fontWeight,
    outlineColor:cs.outlineColor,outlineStyle:cs.outlineStyle,outlineWidth:cs.outlineWidth,
    borderColor:cs.borderTopColor,borderWidth:cs.borderTopWidth};
}
function rawTok(name){
  const d=document.createElement('div');
  d.style.color='var('+name+')';
  d.style.background='var('+name+')';
  document.body.appendChild(d);
  const cs=getComputedStyle(d);
  const out={color:cs.color,bg:cs.backgroundColor};
  d.remove();
  return out;
}
`;

const PAGES = [
  { key: 'aikars', url: '/paper/aikars-flags/' },
  { key: 'getting-started', url: '/paper/getting-started/' },
  { key: 'paper-index', url: '/paper/' },
];

async function run(browser, port) {
  const res = { port, pages: {}, viewports: {}, errors: [] };
  for (const pg of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => res.errors.push(port + '/' + pg.key + ': ' + String(e.message)));
    await page.goto(`http://127.0.0.1:${port}${pg.url}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(400);
    const d = await page.evaluate((SAMPLE) => {
      eval(SAMPLE);
      const out = {};
      const q = (s) => document.querySelector(s);
      // ---------- 对比度（浅色） ----------
      out.snap = {
        body: snap(document.body, 'body'),
        contentP: snap(q('.article p, .content p, main p'), '正文段落'),
        contentLink: snap(q('.article a:not(.heading-anchor):not(.chip), .content a:not(.heading-anchor)'), '正文链接'),
        h2: snap(q('.article h2'), 'h2'),
        tocTitle: snap(q('.toc-side .toc-title'), 'TOC 标题'),
        tocLink: snap(q('.toc-side .toc-fold a, .toc-side a'), 'TOC 链接'),
        tocCount: snap(q('.toc-count'), 'TOC 计数'),
        srcLink: snap(q('.src-item .src-link'), '源树链接'),
        srcSum: snap(q('.src-item .src-sum'), '源树摘要'),
        srcRel: snap(q('.src-item .src-rel'), '源树路径'),
        sideHome: snap(q('.side-home'), '组首页 pill'),
        sideGroupTitle: snap(q('.side-group-title'), '侧栏组标题'),
        sideCount: snap(q('.side-count'), '侧栏计数'),
        codeCopy: snap(q('.code-copy'), '复制按钮'),
        codeLang: snap(q('.code-title .code-lang'), '代码语言标'),
        codeFile: snap(q('.code-file'), '代码文件名'),
        codePlain: snap(q('pre code'), '代码正文'),
        crumbs: snap(q('.crumbs a'), '面包屑'),
        chip: snap(q('a.chip'), '分类 chip'),
        pageMeta: snap(q('.page-meta'), '页面元信息'),
        skip: snap(q('.skip'), '跳到正文'),
      };
      out.tokens = {};
      for (const t of ['--bg', '--bg-soft', '--bg-elev', '--fg', '--fg-muted', '--border', '--border-strong', '--accent', '--code-bg', '--hl-comment', '--hl-keyword', '--hl-string', '--hl-number', '--hl-title', '--hl-builtin', '--hl-variable', '--hl-deletion', '--note', '--tip', '--warning']) {
        const r = rawTok(t);
        out.tokens[t] = r.color;
      }
      // hljs 实采
      out.hljs = {};
      for (const tc of ['hljs-comment', 'hljs-keyword', 'hljs-string', 'hljs-number', 'hljs-title', 'hljs-built_in', 'hljs-variable', 'hljs-attr', 'hljs-tag', 'hljs-meta', 'hljs-params', 'hljs-property', 'hljs-type', 'hljs-literal', 'hljs-symbol', 'hljs-name', 'hljs-section', 'hljs-deletion', 'hljs-addition']) {
        const el = q('pre code .' + tc);
        if (el) out.hljs[tc] = snap(el, tc);
      }
      // ---------- 命中目标 ----------
      const rect = (el) => { const r = el.getBoundingClientRect(); return { w: Number(r.width.toFixed(1)), h: Number(r.height.toFixed(1)) }; };
      out.targets = {
        sideHome: Array.from(document.querySelectorAll('.side-home')).slice(0, 6).map((el) => ({ ...rect(el), text: el.textContent.trim() })),
        codeCopy: Array.from(document.querySelectorAll('.code-copy')).slice(0, 4).map((el) => ({ ...rect(el), ariaLabel: el.getAttribute('aria-label') })),
        tocAnchor: Array.from(document.querySelectorAll('.toc-side .toc-fold a, .toc-side a')).slice(0, 5).map(rect),
        sideGroupTitle: Array.from(document.querySelectorAll('.side-group-title')).slice(0, 3).map(rect),
      };
      // 相邻 side-home 的最小间距（矩形边距，垂直）
      const homes = Array.from(document.querySelectorAll('.side-home')).map((el) => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      let minGap = null;
      for (let i = 1; i < homes.length; i++) {
        const g = Number((homes[i].top - homes[i - 1].bottom).toFixed(1));
        if (g >= 0 && (minGap === null || g < minGap)) minGap = g;
      }
      out.targets.sideHomeMinVerticalGap = minGap;
      // ---------- 代码区（审查项 7） ----------
      const scrollers = Array.from(document.querySelectorAll('.code-scroll'));
      out.code = {
        count: scrollers.length,
        withRole: scrollers.filter((h) => h.getAttribute('role') === 'region').length,
        withLabel: scrollers.filter((h) => (h.getAttribute('aria-label') || '').length > 0).length,
        withTabindex0: scrollers.filter((h) => h.getAttribute('tabindex') === '0').length,
        overflowing: scrollers.filter((h) => h.hasAttribute('data-overflowing')).length,
        labelSaysScrollable: scrollers.filter((h) => /可横向滚动/.test(h.getAttribute('aria-label') || '')).length,
        containersWithoutLabelThatOverflow: scrollers.filter((h) => h.hasAttribute('data-overflowing') && !/可横向滚动/.test(h.getAttribute('aria-label') || '')).length,
        samples: scrollers.slice(0, 5).map((h) => {
          const fig = h.closest('.code-block');
          const title = fig ? fig.querySelector('.code-title') : null;
          return {
            ariaLabel: h.getAttribute('aria-label'),
            role: h.getAttribute('role'),
            tabindex: h.getAttribute('tabindex'),
            overflowing: h.hasAttribute('data-overflowing'),
            scrollW: h.scrollWidth, clientW: h.clientWidth,
            titleAfterContent: title ? getComputedStyle(title, '::after').content : null,
            titleTextHasHint: title ? /可横向滚动/.test(title.textContent) : null,
          };
        }),
      };
      out.tables = Array.from(document.querySelectorAll('.table-wrap')).slice(0, 3).map((w) => ({
        role: w.getAttribute('role'), ariaLabel: w.getAttribute('aria-label'), tabindex: w.getAttribute('tabindex'),
        overflowing: w.hasAttribute('data-overflowing'),
      }));
      // ---------- TOC 结构 ----------
      const toc = q('.toc-side');
      const det = q('.toc-side details.toc-fold');
      const sum = q('.toc-side .toc-title');
      out.toc = {
        asideExists: !!toc,
        asideLabel: toc ? toc.getAttribute('aria-label') : null,
        hasDetails: !!det,
        open: det ? det.open : null,
        linkCount: toc ? toc.querySelectorAll('a').length : 0,
        summaryTag: sum ? sum.tagName : null,
        summaryDisplay: sum ? getComputedStyle(sum).display : null,
        summaryTabIndex: sum ? sum.tabIndex : null,
        summaryRole: sum ? sum.getAttribute('role') : null,
        summaryAriaExpanded: sum ? sum.getAttribute('aria-expanded') : null,
        detailsAriaExpanded: det ? det.getAttribute('aria-expanded') : null,
        beforeContent: sum ? getComputedStyle(sum, '::before').content : null,
        // 折叠态下 ol 是否仍占位/可见
        olHeight: (function () { const ol = toc ? toc.querySelector('ol') : null; return ol ? Math.round(ol.getBoundingClientRect().height) : null; })(),
        tocHeight: toc ? Math.round(toc.getBoundingClientRect().height) : null,
        landmarks: Array.from(document.querySelectorAll('nav,aside,[role=navigation],[role=complementary]')).map((el) => ({
          tag: el.tagName, cls: String(el.className || '').slice(0, 34), label: el.getAttribute('aria-label'), id: el.id,
        })),
      };
      // ---------- 拉伸链接 ----------
      const item = q('.src-item');
      if (item) {
        const lr = item.querySelector('.src-link').getBoundingClientRect();
        const ir = item.getBoundingClientRect();
        const sum2 = item.querySelector('.src-sum');
        const rel2 = item.querySelector('.src-rel');
        out.stretch = {
          itemH: Math.round(ir.height), itemW: Math.round(ir.width),
          linkW: Math.round(lr.width), linkH: Math.round(lr.height),
          linkAreaPct: Number(((lr.width * lr.height) / (ir.width * ir.height) * 100).toFixed(1)),
          afterInset: (function () { const a = getComputedStyle(item.querySelector('.src-link'), '::after'); return [a.top, a.right, a.bottom, a.left].join(' '); })(),
          sumUserSelect: sum2 ? getComputedStyle(sum2).userSelect : null,
          sumPointerEvents: sum2 ? getComputedStyle(sum2).pointerEvents : null,
          relPointerEvents: rel2 ? getComputedStyle(rel2).pointerEvents : null,
          hitOnSum: (function () {
            if (!sum2) return null;
            const r = sum2.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + Math.min(24, r.width / 2), r.top + r.height / 2);
            return el ? { tag: el.tagName, cls: String(el.className || '').slice(0, 30) } : null;
          })(),
          hitOnRel: (function () {
            if (!rel2) return null;
            const r = rel2.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
            return el ? { tag: el.tagName, cls: String(el.className || '').slice(0, 30) } : null;
          })(),
        };
      }
      out.geom = {
        scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        topbarH: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim(),
        topbarRectH: Math.round((q('.topbar') || document.body).getBoundingClientRect().height),
        tocPosition: toc ? getComputedStyle(toc).position : null,
        tocTop: toc ? getComputedStyle(toc).top : null,
        tocZ: toc ? getComputedStyle(toc).zIndex : null,
        tocRect: toc ? (function () { const r = toc.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; })() : null,
      };
      return out;
    }, SAMPLE);
    res.pages[pg.key] = d;
    await page.close();
  }

  // ---------- viewport 矩阵：390 / 1024 / 1025 / 1440 ----------
  for (const vp of [{ w: 390, h: 844 }, { w: 1024, h: 800 }, { w: 1025, h: 800 }, { w: 1440, h: 900 }]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(350);
    res.viewports[vp.w] = await page.evaluate(() => {
      const toc = document.querySelector('.toc-side');
      const det = document.querySelector('.toc-side details.toc-fold');
      const sum = document.querySelector('.toc-side .toc-title');
      const cs = toc ? getComputedStyle(toc) : null;
      const h1 = document.querySelector('h1');
      return {
        w: innerWidth, h: innerHeight,
        mq1025: matchMedia('(min-width:1025px)').matches,
        toc: toc ? {
          display: cs.display, position: cs.position, top: cs.top, z: cs.zIndex,
          h: Math.round(toc.getBoundingClientRect().height),
          maxH: cs.maxHeight, overflowY: cs.overflowY,
          open: det ? det.open : null,
          summaryTabIndex: sum ? sum.tabIndex : null,
          linkTabIndexes: Array.from(toc.querySelectorAll('a')).slice(0, 3).map((a) => a.tabIndex),
        } : null,
        h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
        scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
      };
    });
    await page.close();
  }

  // ---------- 深色：显式 data-theme=dark 与 auto+prefers-color-scheme:dark ----------
  for (const mode of ['dark', 'auto-dark']) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: mode === 'auto-dark' ? 'dark' : 'light',
    });
    await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(300);
    res[mode] = await page.evaluate((SAMPLE) => {
      eval(SAMPLE);
      const root = document.documentElement;
      if (!root.getAttribute('data-theme')) root.setAttribute('data-theme', 'auto');
      const out = { themeAttr: root.getAttribute('data-theme') };
      const q = (s) => document.querySelector(s);
      out.snap = {
        body: snap(document.body, 'body'),
        contentP: snap(q('.article p, .content p, main p'), '正文段落'),
        contentLink: snap(q('.article a:not(.heading-anchor):not(.chip), .content a:not(.heading-anchor)'), '正文链接'),
        tocTitle: snap(q('.toc-side .toc-title'), 'TOC 标题'),
        tocLink: snap(q('.toc-side .toc-fold a, .toc-side a'), 'TOC 链接'),
        srcSum: snap(q('.src-item .src-sum'), '源树摘要'),
        srcRel: snap(q('.src-item .src-rel'), '源树路径'),
        sideHome: snap(q('.side-home'), '组首页 pill'),
        codeCopy: snap(q('.code-copy'), '复制按钮'),
        codeLang: snap(q('.code-title .code-lang'), '代码语言标'),
        codePlain: snap(q('pre code'), '代码正文'),
        sideGroupTitle: snap(q('.side-group-title'), '侧栏组标题'),
      };
      out.tokens = {};
      for (const t of ['--bg', '--bg-soft', '--bg-elev', '--fg', '--fg-muted', '--border', '--border-strong', '--accent', '--code-bg', '--hl-comment', '--hl-keyword', '--hl-string', '--hl-number', '--hl-title', '--hl-builtin', '--hl-variable', '--hl-deletion']) {
        out.tokens[t] = rawTok(t).color;
      }
      out.hljs = {};
      for (const tc of ['hljs-comment', 'hljs-keyword', 'hljs-string', 'hljs-number', 'hljs-title', 'hljs-built_in', 'hljs-variable', 'hljs-attr', 'hljs-tag', 'hljs-meta', 'hljs-params', 'hljs-property', 'hljs-type', 'hljs-literal', 'hljs-symbol', 'hljs-name', 'hljs-section', 'hljs-deletion', 'hljs-addition']) {
        const el = q('pre code .' + tc);
        if (el) out.hljs[tc] = snap(el, tc);
      }
      return out;
    }, SAMPLE);
    await page.close();
  }
  return res;
}

function scoreLight(page) {
  const rows = [];
  const put = (label, fg, bg, need, note) => {
    const r = ratio(fg, bg);
    rows.push({ label, fg, bg, need, ratio: r, verdict: verdict(r, need), note: note || '' });
  };
  const s = page.snap;
  const bodyBg = s.body.bg;
  for (const k of Object.keys(s)) {
    const v = s[k];
    if (!v || v.missing) continue;
    // 正文 4.5（1.4.3）；大字（>=24px 或 >=18.66px bold）3:1；UI 组件/边框 3:1（1.4.11）
    let need = 4.5;
    const fs = parseFloat(v.fontSize);
    const bold = parseInt(v.fontWeight, 10) >= 700;
    if (fs >= 24 || (bold && fs >= 18.66)) need = 3;
    put(k + ' 文字', v.color, v.bg, need, v.fontSize + '/' + v.fontWeight);
  }
  // 边框 / 焦点环（UI 组件 3:1）
  put('--border vs --bg (1.4.11)', page.tokens['--border'], page.tokens['--bg'], 3, '卡片/代码块边框');
  put('--border-strong vs --bg (1.4.11)', page.tokens['--border-strong'], page.tokens['--bg'], 3, 'chip/胶囊边框');
  put('--accent vs --bg (2.4.11 焦点环)', page.tokens['--accent'], bodyBg, 3, '2.4.11 焦点外观');
  put('--accent vs --bg-soft (焦点环在侧栏)', page.tokens['--accent'], page.tokens['--bg-soft'], 3, '');
  put('--fg-muted vs --bg-soft (1.4.3)', page.tokens['--fg-muted'], page.tokens['--bg-soft'], 4.5, '');
  put('--fg-muted vs --bg (1.4.3)', page.tokens['--fg-muted'], page.tokens['--bg'], 4.5, '');
  for (const k of Object.keys(page.hljs || {})) {
    const v = page.hljs[k];
    put('hljs.' + k, v.color, v.bg, 4.5, '代码 token');
  }
  return rows;
}

(async () => {
  const exe = chromePath();
  const browser = await chromium.launch({ executablePath: exe });
  const out = { chrome: exe, at: new Date().toISOString(), runs: [] };
  for (const port of PORTS) {
    out.runs.push(await run(browser, port));
  }
  await browser.close();

  // Node 侧算对比度并打印
  for (const r of out.runs) {
    console.log('\n############ port ' + r.port + ' ############');
    if (r.errors.length) console.log(' pageerrors: ' + JSON.stringify(r.errors));
    const pg = r.pages.aikars;
    console.log('\n--- 浅色对比度 ---');
    for (const row of scoreLight(pg)) {
      console.log(` ${row.verdict.padEnd(4)} ${String(row.ratio).padStart(5)} (need ${row.need}) ${row.label} [${row.fg} on ${row.bg}] ${row.note}`);
    }
    for (const mode of ['dark', 'auto-dark']) {
      const m = r[mode];
      if (!m) continue;
      console.log('\n--- ' + mode + ' 对比度（data-theme=' + m.themeAttr + '） ---');
      const fake = { snap: m.snap, tokens: m.tokens, hljs: m.hljs };
      for (const row of scoreLight(fake)) {
        console.log(` ${row.verdict.padEnd(4)} ${String(row.ratio).padStart(5)} (need ${row.need}) ${row.label} [${row.fg} on ${row.bg}] ${row.note}`);
      }
    }
    console.log('\n--- 命中目标 ---');
    console.log(' sideHome: ' + JSON.stringify(r.pages.aikars.targets.sideHome));
    console.log(' sideHomeMinVerticalGap: ' + r.pages.aikars.targets.sideHomeMinVerticalGap);
    console.log(' codeCopy: ' + JSON.stringify(r.pages.aikars.targets.codeCopy));
    console.log(' tocAnchor: ' + JSON.stringify(r.pages.aikars.targets.tocAnchor));
    console.log('\n--- 代码区 ---');
    console.log(' ' + JSON.stringify(r.pages.aikars.code));
    console.log(' tables: ' + JSON.stringify(r.pages.aikars.tables));
    console.log('\n--- TOC ---');
    console.log(' ' + JSON.stringify(r.pages.aikars.toc));
    console.log('\n--- 拉伸链接 ---');
    console.log(' ' + JSON.stringify(r.pages.aikars.stretch || r.pages['paper-index'].stretch));
    console.log('\n--- geom ---');
    console.log(' ' + JSON.stringify(r.pages.aikars.geom));
    console.log('\n--- viewports ---');
    for (const k of Object.keys(r.viewports)) console.log(' ' + k + ': ' + JSON.stringify(r.viewports[k]));
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('\nartifact: ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
