'use strict';
/**
 * fa2-core.js — 最终验收 · A 组：断言 #1–#8 + 归因分离（只读测量，JSON 落 %TEMP%\fa2）
 *
 * 站点：
 *   HEAD 4ce8407 -> http://127.0.0.1:8787   (assets/site.css 与 commit 字节相同)
 *   a19a6c2      -> http://127.0.0.1:8788   (_pre-mobile 树，site.css/html 与 commit 字节相同)
 *
 * 四种状态（都在 HEAD 上注入还原，同一 context 前后各测一次，消除跨进程漂移）：
 *   head      = C1 + C2 + C3 + C5（原样）
 *   noC1      = 注入 .code-pre{font-size:16px!important}    -> 只剩 C2（"C2-only"）
 *   noC2      = 注入 .article p{max-width:none!important}   -> 只剩 C1（"C1-only"）
 *   neither   = 两条都注入                                  -> 批 2/3 之前的行距与列宽
 *
 * 口径（关键，缺一条数字就不可比）：
 *   1. 全站 88 张 content-img 带 loading=lazy，不先加载完就量 scrollHeight 会漂 400+px。
 *      故每次测量前统一 loadAllImages()（eager + decode + 滚到底回顶），与 reports/c2-width.md 同法。
 *   2. ch = round(最长行盒 / canvas 实测 '0' 宽度)，不用 0.5em 近似。
 *   3. 代码块宽度取滚动宿主 clientWidth（.code-scroll 优先，否则 pre 自身）；
 *      横滚判定 host.scrollWidth > host.clientWidth+1 || pre 同条件。
 *   4. 行推进 = code 元素 Range 矩形 top 去重后的相邻差。
 *
 * 用法: node tools/fa2-core.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const BASES = { head: 'http://127.0.0.1:8787', old: 'http://127.0.0.1:8788' };

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const OUT = path.join(os.tmpdir(), 'fa2');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  { key: 'dialogs', path: '/paper/dev/dialogs/' },
  { key: 'worldcfg', path: '/paper/reference/world-configuration/' },
  { key: 'particles', path: '/paper/dev/particles/' },
  { key: 'tuning', path: '/velocity/tuning/' },
];

const CSS_NO_C1 = '.code-pre{font-size:16px !important}';
const CSS_NO_C2 = '.article p{max-width:none !important}';

const MEASURE = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = document.querySelector('article.article') || document.querySelector('article');

  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = art ? [...art.querySelectorAll('p')].filter(isProse) : [];

  const cv = document.createElement('canvas').getContext('2d');
  let zeroW = null;
  let maxLine = 0;
  for (const p of paras) {
    const st = cs(p, 'fontSize') + ' ' + cs(p, 'fontFamily');
    if (zeroW == null) { cv.font = st; zeroW = cv.measureText('0').width; }
    const rg = document.createRange();
    rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    if (rects.length) maxLine = Math.max(maxLine, ...rects.map((r) => r.width));
  }

  const pres = [...document.querySelectorAll('pre.code-pre')];
  const hosts = pres.map((p) => p.closest('.code-scroll') || p);
  const codeCw = hosts.map((h) => h.clientWidth);
  const ovIdx = [];
  hosts.forEach((h, i) => {
    const pre = pres[i];
    if (h.scrollWidth > h.clientWidth + 1 || pre.scrollWidth > pre.clientWidth + 1) ovIdx.push(i);
  });

  /* 行推进：逐块 Range top 差 */
  const perBlock = [];
  pres.forEach((pre) => {
    const code = pre.querySelector('code') || pre;
    const rg = document.createRange();
    rg.selectNodeContents(code);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const tops = [...new Set(rects.map((r) => Math.round(r.top * 100) / 100))].sort((a, b) => a - b);
    const d = [];
    for (let i = 1; i < tops.length; i++) d.push(Math.round(tops[i] - tops[i - 1]));
    if (d.length) perBlock.push(d);
  });
  const all = [].concat(...perBlock);
  const srt = [...all].sort((a, b) => a - b);
  const hist = {};
  for (const d of all) hist[d] = (hist[d] || 0) + 1;

  const pre0 = pres[0];
  const code0 = pre0 ? (pre0.querySelector('code') || pre0) : null;

  const cimgs = [...document.querySelectorAll('img.content-img')].filter((i) => i.getBoundingClientRect().width > 0);
  const de = document.documentElement;
  const ab = art ? art.getBoundingClientRect() : null;

  return {
    path: location.pathname,
    vw: window.innerWidth,
    artW: ab ? r2(ab.width) : null,
    artX: ab ? r2(ab.x) : null,
    lineW: maxLine ? r2(maxLine) : null,
    lineCh: maxLine && zeroW > 0 ? Math.round(maxLine / zeroW) : null,
    zeroW: zeroW == null ? null : r2(zeroW),
    proseN: paras.length,
    paraWMax: paras.length ? r2(Math.max(...paras.map((p) => p.getBoundingClientRect().width))) : null,
    pMaxWidth: paras.length ? cs(paras[0], 'maxWidth') : null,
    codeBlocks: pres.length,
    codeCwRange: codeCw.length ? [Math.min(...codeCw), Math.max(...codeCw)] : null,
    codeOv: ovIdx.length,
    codeOvIdx: ovIdx,
    preFs: pre0 ? r2(parseFloat(cs(pre0, 'fontSize'))) : null,
    preLh: pre0 ? r2(parseFloat(cs(pre0, 'lineHeight'))) : null,
    codeFs: code0 ? r2(parseFloat(cs(code0, 'fontSize'))) : null,
    codeLh: code0 ? r2(parseFloat(cs(code0, 'lineHeight'))) : null,
    adv: { n: all.length, hist, median: srt.length ? srt[Math.floor(srt.length / 2)] : null, min: srt[0] || null, max: srt[srt.length - 1] || null },
    docH: de.scrollHeight,
    hOverflow: de.scrollWidth - de.clientWidth,
    imgN: cimgs.length,
    imgWithDims: cimgs.filter((i) => i.getAttribute('width') && i.getAttribute('height')).length,
    imgSumH: r2(cimgs.reduce((s, i) => s + i.getBoundingClientRect().height, 0)),
    h5: (() => { const h = art && art.querySelector('h5'); return h ? r2(parseFloat(cs(h, 'fontSize'))) : null; })(),
  };
};

const settle = (page, k) => page.evaluate((n) => new Promise((res) => {
  let i = 0;
  const step = () => { if (++i >= n) res(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), k || 2);

const loadAllImages = async (page) => {
  await page.evaluate(async () => {
    const imgs = [...document.images];
    for (const im of imgs) { im.loading = 'eager'; if (im.decode) { try { await im.decode(); } catch (e) {} } }
    const de = document.documentElement;
    window.scrollTo({ top: de.scrollHeight, left: 0, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 120));
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => {
      im.addEventListener('load', r, { once: true });
      im.addEventListener('error', r, { once: true });
      setTimeout(r, 2000);
    }))));
  });
  await page.waitForTimeout(120);
  await settle(page, 3);
};

async function run(browser, base, pageDef, injects, label) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(base + pageDef.path, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(140);
  await loadAllImages(page);
  for (const css of injects) await page.addStyleTag({ content: css });
  if (injects.length) { await page.waitForTimeout(80); await settle(page, 3); }
  const m = await page.evaluate(MEASURE);
  const m2 = await page.evaluate(MEASURE); /* 幂等守卫 */
  await ctx.close();
  return {
    label, errors, m,
    stable: m2.docH === m.docH && m2.lineW === m.lineW && m2.codeCwRange + '' === m.codeCwRange + '',
  };
}

(async () => {
  if (!EXE) throw new Error('no chrome executable found (set CHROME_PATH)');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), chrome: EXE, states: {}, attrib: {} };
  const line = (r) => 'lineW=' + String(r.m.lineW).padEnd(8) + 'ch=' + String(r.m.lineCh).padEnd(4) +
    'artW=' + String(r.m.artW).padEnd(8) + 'codeCw=' + JSON.stringify(r.m.codeCwRange).padEnd(17) +
    'ov=' + (r.m.codeOv + '/' + r.m.codeBlocks).padEnd(7) + 'docH=' + String(r.m.docH).padEnd(7) +
    'adv=' + JSON.stringify((r.m.adv.hist)) + ' hOv=' + r.m.hOverflow + (r.stable ? '' : ' [UNSTABLE]') +
    (r.errors.length ? ' ERR=' + r.errors.join('|') : '');
  try {
    for (const pd of PAGES) {
      const rows = {};
      rows.head = await run(browser, BASES.head, pd, [], 'head');
      rows.noC1 = await run(browser, BASES.head, pd, [CSS_NO_C1], 'noC1');
      rows.noC2 = await run(browser, BASES.head, pd, [CSS_NO_C2], 'noC2');
      rows.neither = await run(browser, BASES.head, pd, [CSS_NO_C1, CSS_NO_C2], 'neither');
      rows.old = await run(browser, BASES.old, pd, [], 'old');
      out.states[pd.key] = rows;
      console.log('[' + pd.key + ']');
      for (const k of ['head', 'noC1', 'noC2', 'neither', 'old']) console.log('  ' + k.padEnd(8) + line(rows[k]));
    }
    const d = out.states.dialogs;
    const H = (k) => d[k].m.docH;
    out.attrib = {
      dialogs: {
        neither: H('neither'), c1_only: H('noC2'), c2_only: H('noC1'), both: H('head'),
        dC1: H('noC2') - H('neither'), dC2: H('noC1') - H('neither'),
        net: H('head') - H('neither'), old: H('old'), vsOld: H('head') - H('old'),
      },
      per_page: {},
    };
    for (const k of Object.keys(out.states)) {
      const r = out.states[k];
      const h = (s) => r[s].m.docH;
      out.attrib.per_page[k] = {
        old: h('old'), neither: h('neither'), dC1: h('noC2') - h('neither'), dC2: h('noC1') - h('neither'),
        net: h('head') - h('neither'), both: h('head'),
      };
    }
    console.log('\nATTR(dialogs) neither=' + out.attrib.dialogs.neither + ' c1only=' + out.attrib.dialogs.c1_only +
      ' (ΔC1=' + out.attrib.dialogs.dC1 + ') c2only=' + out.attrib.dialogs.c2_only +
      ' (ΔC2=' + out.attrib.dialogs.dC2 + ') both=' + out.attrib.dialogs.both +
      ' net=' + out.attrib.dialogs.net + ' old=' + out.attrib.dialogs.old);
    console.log('per_page=');
    for (const k of Object.keys(out.attrib.per_page)) console.log('  ' + k.padEnd(10) + JSON.stringify(out.attrib.per_page[k]));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa2-core.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa2-core.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
