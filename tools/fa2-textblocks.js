'use strict';
/**
 * fa2-textblocks.js — C2 的作用域审计（只读）：哪些「正文行」被 40rem 限住了，哪些没有
 *
 * 动机：断言 #4 只量 article 内的 <p>。若正文文本并非都在 <p> 里（例如 <li> 直接文本、
 * <aside.alert> 里的行内片段），则「正文 74ch」的口径会**系统性漏掉更宽的行**，
 * 而视觉上的「锯齿」恰恰由这些漏掉的行构成。本脚本按容器类型分组量「最长行盒宽」。
 *
 * 用法: node tools/fa2-textblocks.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(os.tmpdir(), 'fa2');
fs.mkdirSync(TMP, { recursive: true });
const BASE = 'http://127.0.0.1:8787';

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

  /* 「正文块」= 直接承载文本的元素，不含代码/表格/导航/卡片 */
  const SKIP = '.code-block, .code-scroll, pre, table, .table-wrap, .page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer, nav, .toc-side, .sidebar, figcaption, .code-title';
  const blocks = [];
  const walk = (el) => {
    for (const ch of el.children) {
      if (ch.matches(SKIP) || ch.closest(SKIP)) continue;
      const tag = ch.tagName;
      if (tag === 'P' || tag === 'LI' || tag === 'DD' || tag === 'BLOCKQUOTE' || tag === 'TD') {
        blocks.push(ch);
      }
      walk(ch);
    }
  };
  if (art) walk(art);
  /* 去重（li 里的 p 也会被收，分开统计） */
  const uniq = [...new Set(blocks)];

  const rows = [];
  /* 关键：li/td 的 Range 矩形会把后代 <p> 的行盒也算进来，从而把「未限宽的直接文本」
     伪装成 640。必须只取**直接文本子节点**的矩形。 */
  const directTextRects = (el) => {
    const out = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue; /* TEXT_NODE */
      if (!(n.nodeValue || '').trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) out.push(r);
    }
    return out;
  };

  for (const el of uniq) {
    const txt = (el.textContent || '').trim();
    if (txt.length < 40) continue;
    const st = getComputedStyle(el);
    cv.font = st.fontSize + ' ' + st.fontFamily;
    const zeroW = cv.measureText('0').width;
    const kind0 = el.tagName === 'P'
      ? (el.parentElement && el.parentElement.tagName === 'LI' ? 'p-in-li' : (el.closest('aside') ? 'p-in-aside' : 'p'))
      : (el.tagName === 'LI' ? 'li-direct' : el.tagName.toLowerCase());

    let rects;
    if (el.tagName === 'LI' || el.tagName === 'TD' || el.tagName === 'DD') {
      rects = directTextRects(el); /* 只算直接文本 */
      if (!rects.length) continue;
    } else {
      const rg = document.createRange();
      rg.selectNodeContents(el);
      rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (!rects.length) continue;
    }
    const maxW = Math.max(...rects.map((r) => r.width));
    const box = el.getBoundingClientRect();
    rows.push({
      kind: kind0,
      w: r2(box.width),
      lineW: r2(maxW),
      ch: Math.round(maxW / zeroW),
      maxW: cs(el, 'maxWidth'),
      text: txt.slice(0, 48),
      lines: rects.length,
    });
  }
  const byKind = {};
  for (const r of rows) {
    byKind[r.kind] = byKind[r.kind] || { n: 0, maxLineW: 0, maxCh: 0, examples: [] };
    const b = byKind[r.kind];
    b.n++;
    if (r.lineW > b.maxLineW) { b.maxLineW = r.lineW; b.maxCh = r.ch; b.examples.unshift({ text: r.text, lineW: r.lineW, ch: r.ch, boxW: r.w, maxW: r.maxW }); b.examples = b.examples.slice(0, 3); }
  }
  const widest = [...rows].sort((a, b) => b.lineW - a.lineW).slice(0, 8);
  return { path: location.pathname, artW: art ? r2(art.getBoundingClientRect().width) : null, byKind, widest, total: rows.length };
};

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const b = await chromium.launch({ executablePath: EXE, args: ['--hide-scrollbars', '--disable-lcd-text', '--force-color-profile=srgb'] });
  const out = { generated_at: new Date().toISOString(), pages: {} };
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  for (const url of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/paper/dev/particles/', '/velocity/tuning/']) {
    await p.goto(BASE + url, { waitUntil: 'load', timeout: 60000 });
    await p.waitForTimeout(160);
    const m = await p.evaluate(MEASURE);
    out.pages[url] = m;
    console.log('=== ' + url + '  artW=' + m.artW + '  blocks=' + m.total + ' ===');
    for (const k of Object.keys(m.byKind).sort()) {
      const v = m.byKind[k];
      console.log('  ' + k.padEnd(11) + 'n=' + String(v.n).padEnd(4) + ' maxLine=' + String(v.maxLineW).padEnd(8) + 'ch=' + String(v.maxCh).padEnd(4));
      for (const e of v.examples) console.log('       ' + String(e.lineW).padEnd(8) + 'ch=' + String(e.ch).padEnd(4) + 'boxW=' + String(e.boxW).padEnd(8) + 'maxW=' + String(e.maxW).padEnd(8) + ' "' + e.text + '"');
    }
    console.log('  widest 5:');
    for (const r of m.widest.slice(0, 5)) console.log('       ' + r.kind.padEnd(11) + r.lineW + '(' + r.ch + 'ch) "' + r.text + '"');
  }
  await b.close();
  fs.writeFileSync(path.join(TMP, 'fa2-textblocks.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\nJSON: ' + path.join(TMP, 'fa2-textblocks.json'));
})().catch((e) => { console.error(e); process.exit(1); });
