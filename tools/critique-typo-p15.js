'use strict';
/**
 * critique-typo-p15.js — 收尾：落地页/分区页/清单页的真实正文与字号（避免把 .hero-tag 当成正文）
 *  + 中英混排：西文与中文之间是否有空格（内容层）、断行是否有孤字
 *  + 行高：标题/代码/表格的 line-height 比
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PROBE = () => {
  const out = { blocks: [] };
  const root = document.querySelector('.hero') || document.querySelector('.content') || document.body;
  /* 所有真正的文字块（>=40 字符），排除 .page-meta/chip */
  for (const el of root.querySelectorAll('p,li,dd,dt,td,blockquote')) {
    const t = (el.textContent || '').trim();
    if (t.length < 40) continue;
    if (el.closest('.page-meta,.chip,.card,.task-card,.cat-links,.src-item,.table-wrap,.sidebar,.toc-side,.pager,.page-footer')) continue;
    const cs = getComputedStyle(el);
    out.blocks.push({
      tag: el.tagName.toLowerCase(),
      cls: el.className || '',
      fs: parseFloat(cs.fontSize),
      lh: Math.round(parseFloat(cs.lineHeight) * 10) / 10,
      lhr: Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)) * 100) / 100,
      color: cs.color,
      w: Math.round(el.getBoundingClientRect().width),
      sample: t.slice(0, 50),
    });
  }
  /* 字号分布 */
  const dist = {};
  for (const b of out.blocks) dist[b.fs] = (dist[b.fs] || 0) + 1;
  out.fontSizeDist = dist;

  /* 中英混排：中文紧邻拉丁字母时，源码里是否有空格 */
  const art = document.querySelector('.article') || root;
  let noSpace = 0, withSpace = 0;
  const examples = [];
  for (const el of art.querySelectorAll('p,li')) {
    const t = el.textContent || '';
    for (const m of t.matchAll(/[\u4e00-\u9fff][A-Za-z]|[A-Za-z][\u4e00-\u9fff]/g)) {
      noSpace++;
      if (examples.length < 6) examples.push(t.slice(Math.max(0, m.index - 18), m.index + 20));
    }
    for (const m of t.matchAll(/[\u4e00-\u9fff] [A-Za-z]|[A-Za-z] [\u4e00-\u9fff]/g)) withSpace++;
  }
  out.cjkLatin = { noSpace, withSpace, examples };

  /* 行末孤字（orphan）：最后一行只有 1-2 个字符的段落比例 */
  let paras = 0, orphans = 0;
  const orphanEx = [];
  for (const p of art.querySelectorAll('p')) {
    const t = (p.textContent || '').trim();
    if (t.length < 60) continue;
    const range = document.createRange();
    range.selectNodeContents(p);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1);
    if (rects.length < 2) continue;
    paras++;
    const last = rects[rects.length - 1];
    /* 末行宽度 < 1.6 个全角字 → 孤字 */
    if (last.width < 16 * 1.6) { orphans++; if (orphanEx.length < 5) orphanEx.push({ lastW: Math.round(last.width), nLines: rects.length, text: t.slice(-40) }); }
  }
  out.orphans = { paras, orphans, pct: paras ? Math.round((orphans / paras) * 1000) / 10 : 0, examples: orphanEx };

  /* 标题/代码/表格行高 */
  const lhOf = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize); return { fs, lh: Math.round(parseFloat(cs.lineHeight) * 10) / 10, ratio: Math.round((parseFloat(cs.lineHeight) / fs) * 100) / 100 }; };
  out.lineHeights = {
    h1: lhOf('.article h1') || lhOf('.hero h1'),
    h2: lhOf('.article h2'),
    h3: lhOf('.article h3'),
    body: lhOf('.article > p') || lhOf('.hero p'),
    code: lhOf('.code-pre code'),
    td: lhOf('.table-wrap td'),
    li: lhOf('.article li'),
    caption: lhOf('.external-image-note'),
  };
  return out;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const res = {};
  for (const url of ['/', '/paper/', '/paper/dev/dialogs/', '/all-pages.html', '/paper/reference/world-configuration/']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(BASE + url, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    res[url] = await page.evaluate(PROBE);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p15.json'), JSON.stringify(res, null, 1), 'utf8');

  for (const k of Object.keys(res)) {
    const r = res[k];
    console.log('===== ' + k);
    console.log('  fontSizeDist=' + JSON.stringify(r.fontSizeDist));
    console.log('  cjkLatin=' + JSON.stringify({ noSpace: r.cjkLatin.noSpace, withSpace: r.cjkLatin.withSpace }));
    console.log('  orphans=' + JSON.stringify({ paras: r.orphans.paras, orphans: r.orphans.orphans, pct: r.orphans.pct }));
    console.log('  lineHeights=' + JSON.stringify(r.lineHeights));
    for (const b of r.blocks.slice(0, 5)) console.log('    ' + b.tag + '.' + String(b.cls).slice(0, 20) + ' fs=' + b.fs + ' lh=' + b.lh + '(' + b.lhr + ') w=' + b.w + ' | ' + b.sample);
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
