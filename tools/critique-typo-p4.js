'use strict';
/**
 * critique-typo-p4.js — 关键归因实验 + max-width 方案实测
 *
 *  E1. `Administration` 到底被谁切断：.grp-name 的 white-space/overflow/宽度、行盒数、是否溢出而非换行
 *  E2. 正文（非 code/表格）有多少「无连字符英文词」被 mid-word 切断；`overflow-wrap:anywhere` 是否为其成因
 *      做法：注入 .article{overflow-wrap:normal} 后再量一次，比较 document.scrollWidth 与断词数
 *  E3. max-width 候选方案实测：给 .article 设不同 max-width，量 ch / 右空 / 代码块横向滚动条出现数 / 表格溢出
 *  E4. 12 个维度的补充数值：段间距一致性、列表缩进、图片留白、代码行高
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PAGE = '/paper/dev/dialogs/';

/* ---------- E1 + E2：归因实验 ---------- */
const ATTRIB = () => {
  const out = {};

  /* E1. grp-name 里的 Administration */
  const grp = [...document.querySelectorAll('.grp-name')].find((e) => e.textContent.includes('Administration'));
  if (grp) {
    const cs = getComputedStyle(grp);
    const r = grp.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(grp);
    const rects = [...range.getClientRects()].filter((x) => x.width > 1);
    out.grpName = {
      text: grp.textContent.trim(),
      whiteSpace: cs.whiteSpace,
      overflowWrap: cs.overflowWrap,
      wordBreak: cs.wordBreak,
      overflow: cs.overflow,
      textOverflow: cs.textOverflow,
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10,
      lineHeight: cs.lineHeight,
      scrollW: grp.scrollWidth,
      clientW: grp.clientWidth,
      lineCount: Math.round(r.height / parseFloat(cs.lineHeight)),
      rangeRects: rects.map((x) => ({ w: Math.round(x.width), top: Math.round(x.top) })),
      overflowing: grp.scrollWidth > grp.clientWidth,
      parentW: Math.round(grp.parentElement.getBoundingClientRect().width * 10) / 10,
      parentDisplay: getComputedStyle(grp.parentElement).display,
    };
  }

  /* E2. 正文段落内的 mid-word 切断（排除 code/td/span） */
  const scanProse = (root) => {
    const hits = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const pel = n.parentElement;
      if (!pel) continue;
      if (pel.closest('code, pre, td, th, .grp-name, .ttl, .pth, .src-rel, .chip, .ec-url')) continue;
      const raw = n.nodeValue;
      /* 只抓「无连字符的连续英文字母」 */
      const re = /[A-Za-z]{8,}/g;
      let m;
      while ((m = re.exec(raw))) {
        const word = m[0];
        const range = document.createRange();
        try { range.setStart(n, m.index); range.setEnd(n, m.index + word.length); } catch (e) { continue; }
        const rects = [...range.getClientRects()].filter((r) => r.width > 1);
        if (rects.length > 1) {
          hits.push({
            word,
            lines: rects.length,
            container: pel.tagName.toLowerCase() + (pel.className ? '.' + String(pel.className).trim().split(/\s+/).join('.') : ''),
            overflowWrap: getComputedStyle(pel).overflowWrap,
            wordBreak: getComputedStyle(pel).wordBreak,
            hyphens: getComputedStyle(pel).hyphens,
          });
        }
      }
    }
    return hits;
  };
  const art = document.querySelector('.article');
  out.proseBreaks_default = art ? scanProse(art) : [];

  /* 计数：正文里最长的无连字符英文词 */
  out.longestProseWords = (() => {
    if (!art) return [];
    const words = new Set();
    const walker = document.createTreeWalker(art, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const pel = n.parentElement;
      if (!pel || pel.closest('code, pre, td, th')) continue;
      for (const m of (n.nodeValue || '').matchAll(/[A-Za-z]{10,}/g)) words.add(m[0]);
    }
    return [...words].sort((a, b) => b.length - a.length).slice(0, 8);
  })();

  /* 现在把 .article 的 overflow-wrap 关掉，看断词是否消失 / 文档是否横向溢出 */
  const st = document.createElement('style');
  st.id = 'probe-ow';
  st.textContent = '.article{overflow-wrap:normal!important}';
  document.head.appendChild(st);
  out.proseBreaks_overflowWrapNormal = art ? scanProse(art) : [];
  out.docScrollW_withNormal = document.documentElement.scrollWidth;
  out.docClientW_withNormal = document.documentElement.clientWidth;
  out.horizOverflow_withNormal = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

  /* 对照：默认（anywhere）下的文档宽度 */
  st.remove();
  out.docScrollW_default = document.documentElement.scrollWidth;
  out.docClientW_default = document.documentElement.clientWidth;
  out.horizOverflow_default = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

  return out;
};

/* ---------- E3：max-width 候选方案 ---------- */
const MW = (px) => {
  const st = document.createElement('style');
  st.id = 'probe-mw';
  st.textContent = '@media (min-width:1024px){.article{max-width:' + px + 'px!important}}';
  document.head.appendChild(st);

  const art = document.querySelector('.article');
  const content = document.querySelector('.content');
  const p = art.querySelector('p:not(.page-desc):not(.page-meta)');
  const cs = getComputedStyle(p);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = cs.fontSize + ' ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;

  const rect = art.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const res = {
    px,
    articleW: Math.round(rect.width),
    ch: Math.round((rect.width / zeroW) * 10) / 10,
    cjk: Math.round(rect.width / 16),
    /* 右侧留白 = 视口右缘 - 文章右缘 */
    rightGap: Math.round(window.innerWidth - (rect.x + rect.width)),
    /* 文章左侧空白（侧栏右侧到文章左缘） */
    leftGap: Math.round(rect.x - (contentRect.x)),
    /* 代码块 / 表格是否出现横向滚动 */
    preScrollable: [...document.querySelectorAll('.code-scroll')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    preTotal: document.querySelectorAll('.code-scroll').length,
    tableScrollable: [...document.querySelectorAll('.table-wrap')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    tableTotal: document.querySelectorAll('.table-wrap').length,
    /* 文章是否居中（左右空白差） */
    centered: Math.abs((rect.x - (contentRect.x + parseFloat(getComputedStyle(content).paddingLeft))) - (window.innerWidth - rect.x - rect.width)) < 40,
    scrollH: Math.round(document.documentElement.scrollHeight),
  };
  st.remove();
  return res;
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const out = { page: PAGE, attrib: {}, maxWidthProbe: {}, textDetail: {} };

  /* 归因：三个视口 */
  for (const vp of [{ n: '1440', w: 1440, h: 900, m: false }, { n: '390', w: 390, h: 844, m: true }, { n: '320', w: 320, h: 568, m: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: 'light', isMobile: vp.m, hasTouch: vp.m });
    const page = await ctx.newPage();
    await page.goto(BASE + PAGE, { waitUntil: 'load' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(200);
    out.attrib[vp.n] = await page.evaluate(ATTRIB);
    await ctx.close();
  }

  /* max-width 候选：1440 与 1280 两个桌面视口 */
  for (const vp of [{ w: 1440, h: 900 }, { w: 1280, h: 800 }]) {
    const key = String(vp.w);
    out.maxWidthProbe[key] = [];
    for (const px of [0, 560, 605, 640, 680, 704, 720, 760, 780, 800, 849, 900, 948, 1000]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.goto(BASE + PAGE, { waitUntil: 'load' });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await page.waitForTimeout(150);
      const r = await page.evaluate(MW, px === 0 ? 'none' : px);
      /* 记录实际生效的 article 宽（none 时取自然宽） */
      out.maxWidthProbe[key].push(r);
      await ctx.close();
    }
  }

  /* 细节：段间距、列表缩进、图片留白、代码行高、首屏 chips 面积 */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(BASE + PAGE, { waitUntil: 'load' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(200);
  out.textDetail = await page.evaluate(() => {
    const art = document.querySelector('.article');
    const css_ = (el, p) => getComputedStyle(el)[p];
    /* 所有直接子块的 margin，统计「不同值」的种类数 */
    const kinds = {};
    for (const el of art.children) {
      const t = el.tagName.toLowerCase();
      const k = t + ':' + css_(el, 'marginTop') + '/' + css_(el, 'marginBottom');
      kinds[k] = (kinds[k] || 0) + 1;
    }
    /* 代码块内部行高与正文字号对比 */
    const pre = document.querySelector('.code-pre');
    const codeIn = pre ? pre.querySelector('code') : null;
    /* 图片：figure? 直接 p>img? 有无 caption */
    const imgs = [...art.querySelectorAll('img')].map((i) => {
      const par = i.parentElement;
      const grand = par ? par.parentElement : null;
      return {
        src: (i.getAttribute('src') || '').split('/').pop(),
        parentTag: par ? par.tagName.toLowerCase() : null,
        grandTag: grand ? grand.tagName.toLowerCase() : null,
        hasFigureCaption: !!(grand && grand.tagName.toLowerCase() === 'figure' && grand.querySelector('figcaption')),
        altLen: (i.getAttribute('alt') || '').length,
        hasDims: i.hasAttribute('width') && i.hasAttribute('height'),
        renderedW: Math.round(i.getBoundingClientRect().width),
        naturalW: i.naturalWidth,
        marginTop: Math.round(parseFloat(css_(par, 'marginTop')) * 10) / 10,
        marginBottom: Math.round(parseFloat(css_(par, 'marginBottom')) * 10) / 10,
      };
    });
    /* 列表缩进：每层 li 文本区宽 */
    const listIndent = [...art.querySelectorAll('li')].slice(0, 6).map((li) => ({
      depth: (() => { let d = 0, n = li; while (n && n !== art) { if (n.tagName === 'LI') d++; n = n.parentElement; } return d; })(),
      padLeft: css_(li.parentElement, 'paddingLeft'),
      textW: Math.round(li.getBoundingClientRect().width),
    }));
    /* 表格字号 vs 正文 */
    const td = document.querySelector('.table-wrap td');
    /* 引用块 */
    const bq = document.querySelector('.article blockquote');
    return {
      childMarginKinds: kinds,
      childMarginKindCount: Object.keys(kinds).length,
      codeLineHeight: codeIn ? { pre: css_(pre, 'lineHeight'), preFs: css_(pre, 'fontSize'), code: css_(codeIn, 'lineHeight'), codeFs: css_(codeIn, 'fontSize') } : null,
      images: imgs,
      listIndent,
      tableCellFontSize: td ? css_(td, 'fontSize') : null,
      tableRowH: td ? Math.round(td.getBoundingClientRect().height) : null,
      blockquote: bq ? { margin: css_(bq, 'margin'), padding: css_(bq, 'padding'), color: css_(bq, 'color') } : null,
      articlePadTop: css_(art, 'paddingTop'),
      h2BorderBottom: (() => { const h = art.querySelector('h2'); return h ? css_(h, 'borderBottom') : null; })(),
    };
  });
  await ctx.close();

  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p4.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('OK');
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
