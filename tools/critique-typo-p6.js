'use strict';
/**
 * critique-typo-p6.js — 一致性巡检：四类页面的正文列宽、同语义元素样式是否一致
 *  + 图片加载/尺寸（CLS）+ 主题切换后的代码块可见性
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

const PAGES = [
  { url: '/', name: 'landing（落地页）' },
  { url: '/paper/', name: 'section（分区页）' },
  { url: '/paper/dev/dialogs/', name: 'content（正文页·有 TOC）' },
  { url: '/velocity/tuning/', name: 'content（正文页·有 TOC）' },
  { url: '/all-pages.html', name: 'index（清单页）' },
];

const PROBE = () => {
  const px = (v) => Math.round(parseFloat(v) * 100) / 100;
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      fontSize: px(cs.fontSize), fontWeight: cs.fontWeight, lineHeight: px(cs.lineHeight),
      color: cs.color, width: Math.round(r.width), marginTop: px(cs.marginTop), marginBottom: px(cs.marginBottom),
      fontFamily: cs.fontFamily.split(',')[0],
      bg: cs.backgroundColor, borderLeft: cs.borderLeftWidth,
    };
  };
  const art = document.querySelector('.article');
  const main = document.querySelector('.content');
  const contentCS = main ? getComputedStyle(main) : null;
  const cvs = document.createElement('canvas').getContext('2d');
  const pRef = document.querySelector('.article > p') || document.querySelector('.hero p') || document.body;
  const csP = getComputedStyle(pRef);
  cvs.font = csP.fontSize + ' ' + csP.fontFamily;
  const zeroW = cvs.measureText('0').width;

  /* 内容列几何 */
  const geo = main ? {
    contentW: Math.round(main.getBoundingClientRect().width),
    contentPadL: px(contentCS.paddingLeft),
    contentPadR: px(contentCS.paddingRight),
    contentMaxW: contentCS.maxWidth,
    articleW: art ? Math.round(art.getBoundingClientRect().width) : null,
    textColumnW: art ? Math.round(art.getBoundingClientRect().width) : Math.round(main.getBoundingClientRect().width - px(contentCS.paddingLeft) - px(contentCS.paddingRight)),
  } : null;
  if (geo) {
    geo.textColumnCh = Math.round((geo.textColumnW / zeroW) * 10) / 10;
    geo.textColumnCjk = Math.round(geo.textColumnW / parseFloat(csP.fontSize));
  }

  /* 同语义元素跨页对比 */
  const sem = {
    'h1': pick('h1'),
    '正文 p': pick('.article > p:not(.page-desc):not(.page-meta)') || pick('.hero p') || pick('.section-head p'),
    'H2': pick('.article h2') || pick('.section-head h2'),
    'H3': pick('.article h3') || pick('.cat-block h3'),
    '行内 code': pick('.article code'),
    '代码块 pre': pick('.code-pre'),
    '表格': pick('.table-wrap'),
    '提示框': pick('.alert'),
    '引导段（hero p）': pick('.hero p'),
    '卡片标题（.t）': pick('.task-card .t'),
    '卡片正文（.d）': pick('.task-card .d'),
    '清单表头': pick('.table-wrap thead th'),
  };

  /* 图片：加载状态 + 尺寸声明 + 是否 figure/caption */
  const imgs = [...(art || document).querySelectorAll('img')].map((i) => ({
    name: (i.getAttribute('src') || '').split('/').pop().slice(0, 30),
    complete: i.complete, naturalW: i.naturalWidth, naturalH: i.naturalHeight,
    renderedW: Math.round(i.getBoundingClientRect().width),
    renderedH: Math.round(i.getBoundingClientRect().height),
    hasDims: i.hasAttribute('width') && i.hasAttribute('height'),
    loading: i.getAttribute('loading'), decoding: i.getAttribute('decoding'),
    inParagraph: !!(i.parentElement && i.parentElement.tagName === 'P'),
    inFigure: !!(i.closest('figure')),
    hasCaption: !!(i.closest('figure') && i.closest('figure').querySelector('figcaption')),
  }));

  /* 主题相关：代码块与边框在深色下的可见性（相对自身容器底） */
  const codeBlock = document.querySelector('.code-block');
  const codeInfo = codeBlock ? {
    bg: getComputedStyle(codeBlock).backgroundColor,
    border: getComputedStyle(codeBlock).borderTopColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    preBg: getComputedStyle(document.querySelector('.code-pre')).backgroundColor,
    titleBg: document.querySelector('.code-title') ? getComputedStyle(document.querySelector('.code-title')).backgroundColor : null,
    radius: getComputedStyle(codeBlock).borderRadius,
  } : null;

  return { geo, sem, imgs, codeInfo, articleExists: !!art };
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const res = { pages: {}, codeLight: null, codeDark: null, codeAutoDark: null };
  for (const pg of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(BASE + pg.url, { waitUntil: 'load' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(300);
    res.pages[pg.name] = await page.evaluate(PROBE);
    await ctx.close();
  }
  /* 三条主题路径下的代码块 */
  for (const t of [{ k: 'codeLight', cs: 'light', a: 'light' }, { k: 'codeDark', cs: 'dark', a: 'dark' }, { k: 'codeAutoDark', cs: 'dark', a: 'auto' }]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: t.cs });
    const page = await ctx.newPage();
    await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.evaluate((a) => document.documentElement.setAttribute('data-theme', a), t.a);
    await page.waitForTimeout(200);
    res[t.k] = await page.evaluate(() => {
      const cb = document.querySelector('.code-block');
      const kw = document.querySelector('.hljs-keyword');
      const str = document.querySelector('.hljs-string');
      const cs = (el) => (el ? getComputedStyle(el).color : null);
      return {
        themeAttr: document.documentElement.getAttribute('data-theme'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        codeBg: cb ? getComputedStyle(cb).backgroundColor : null,
        preBg: document.querySelector('.code-pre') ? getComputedStyle(document.querySelector('.code-pre')).backgroundColor : null,
        titleBg: document.querySelector('.code-title') ? getComputedStyle(document.querySelector('.code-title')).backgroundColor : null,
        border: cb ? getComputedStyle(cb).borderTopColor : null,
        keywordColor: cs(kw), stringColor: cs(str),
        plainCode: cs(document.querySelector('.code-pre code')),
      };
    });
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p6.json'), JSON.stringify(res, null, 1), 'utf8');
  console.log(JSON.stringify(res.pages, null, 1).slice(0, 4000));
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
