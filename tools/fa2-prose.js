'use strict';
/**
 * fa2-prose.js — 「正文行宽」全量口径审计（只读）
 *
 * 断言 #1/#4 只量 article 内 <p> 的最长行盒。但站内相当一部分正文是 **<li> 的直接文本节点**
 * （worldcfg 的 `key: value — 说明` 列表就是这种结构）。若这些行没被 40rem 限住，
 * 「正文 98→74ch」的承诺就只在 <p> 上成立。本脚本对**每一行正文**（不含代码/表格）逐行取宽，
 * 给出 ch 直方图与「> 75ch 的行数」，并在 head / old / 撤掉 C2 三种状态下对比。
 *
 * 用法: node tools/fa2-prose.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(os.tmpdir(), 'fa2');
fs.mkdirSync(TMP, { recursive: true });
const BASE = { head: 'http://127.0.0.1:8787', old: 'http://127.0.0.1:8788' };

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const MEASURE = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = document.querySelector('article.article') || document.querySelector('article');
  const cv = document.createElement('canvas').getContext('2d');
  const SKIP = '.code-block, .code-scroll, pre, table, .table-wrap, .page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer, nav, .toc-side, .sidebar, figcaption, .code-title';

  let zeroW = null;
  const fs0 = cs(art || document.body, 'fontSize') + ' ' + (cs(art || document.body, 'fontFamily') || '');
  cv.font = fs0;
  zeroW = cv.measureText('0').width;

  const lines = []; /* {kind, w, ch, text} */
  const push = (kind, rects, txt) => {
    for (const r of rects) {
      if (r.width < 40 || r.height < 4) continue;
      lines.push({ kind, w: r2(r.width), ch: Math.round(r.width / zeroW), text: (txt || '').replace(/\s+/g, ' ').slice(0, 40) });
    }
  };

  const walk = (el) => {
    for (const ch of el.children) {
      if (ch.matches(SKIP) || ch.closest(SKIP)) continue;
      const tag = ch.tagName;
      if (tag === 'P') {
        const kind = (ch.parentElement && ch.parentElement.tagName === 'LI') ? 'p-in-li' : (ch.closest('aside') ? 'p-in-aside' : 'p');
        const rg = document.createRange();
        rg.selectNodeContents(ch);
        push(kind, [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1), ch.textContent);
      } else if (tag === 'LI' || tag === 'TD' || tag === 'DD') {
        const kind = tag === 'LI' ? 'li-text' : tag.toLowerCase() + '-text';
        for (const n of ch.childNodes) {
          if (n.nodeType !== 3) continue; /* 只取直接文本 */
          if (!(n.nodeValue || '').trim()) continue;
          const rg = document.createRange();
          rg.selectNodeContents(n);
          push(kind, [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1), n.nodeValue);
        }
      }
      walk(ch);
    }
  };
  if (art) walk(art);

  const hist = {};
  for (const l of lines) hist[l.ch] = (hist[l.ch] || 0) + 1;
  const widths = lines.map((l) => l.w).sort((a, b) => a - b);
  const over = lines.filter((l) => l.ch > 75);
  const byKind = {};
  for (const l of lines) {
    const k = byKind[l.kind] || (byKind[l.kind] = { n: 0, maxW: 0, maxCh: 0, over75: 0 });
    k.n++;
    if (l.w > k.maxW) { k.maxW = l.w; k.maxCh = l.ch; }
    if (l.ch > 75) k.over75++;
  }
  return {
    path: location.pathname, zeroW: r2(zeroW), artW: art ? r2(art.getBoundingClientRect().width) : null,
    lines: lines.length,
    maxW: widths.length ? widths[widths.length - 1] : null,
    p90: widths.length ? widths[Math.floor(widths.length * 0.9)] : null,
    median: widths.length ? widths[Math.floor(widths.length / 2)] : null,
    maxCh: Math.round((widths[widths.length - 1] || 0) / zeroW),
    over75: over.length,
    over75Samples: over.sort((a, b) => b.w - a.w).slice(0, 5),
    byKind,
    histTop: Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
};

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const b = await chromium.launch({ executablePath: EXE, args: ['--hide-scrollbars', '--disable-lcd-text', '--force-color-profile=srgb'] });
  const out = { generated_at: new Date().toISOString(), states: {} };
  const PAGES = ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/paper/dev/particles/', '/velocity/tuning/'];
  try {
    for (const st of ['head', 'old']) {
      out.states[st] = {};
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
      const p = await ctx.newPage();
      for (const url of PAGES) {
        await p.goto(BASE[st] + url, { waitUntil: 'load', timeout: 60000 });
        await p.waitForTimeout(160);
        const m = await p.evaluate(MEASURE);
        out.states[st][url] = m;
        console.log('[' + st + '] ' + url);
        console.log('   lines=' + m.lines + ' max=' + m.maxW + '(' + m.maxCh + 'ch) p90=' + m.p90 + ' median=' + m.median + '  >75ch: ' + m.over75);
        for (const k of Object.keys(m.byKind).sort()) {
          const v = m.byKind[k];
          console.log('     ' + k.padEnd(12) + 'n=' + String(v.n).padEnd(4) + 'maxW=' + String(v.maxW).padEnd(8) + 'maxCh=' + String(v.maxCh).padEnd(4) + '>75ch=' + v.over75);
        }
        if (m.over75Samples.length) console.log('     widest: ' + m.over75Samples.map((s) => s.ch + 'ch "' + s.text + '"').join(' | '));
      }
      await ctx.close();
    }
  } finally {
    await b.close();
    fs.writeFileSync(path.join(TMP, 'fa2-prose.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(TMP, 'fa2-prose.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
