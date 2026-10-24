'use strict';
/**
 * critique-typo-d.js -- per-page measure (chars per rendered line) for EVERY page type.
 *
 * Index / section / landing pages have no long body paragraph, so an empirical scan of
 * existing text under-reports. This script appends a probe paragraph that inherits the
 * body paragraph style, fills it with (a) pure Latin words and (b) pure Han text, and
 * counts characters per rendered line with Range rects. The probe node is removed again.
 *
 * Also records the heading scale, weight inventory, link/underline policy, badge + border
 * contrast, and page heights for the whole matrix.
 *
 * Usage: node tools/critique-typo-d.js --out="..\_typo-critique\d-measure.json"
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const BASE = opt('url', 'http://127.0.0.1:8787');
const OUT = path.resolve(__dirname, '..', opt('out', path.join('..', '_typo-critique', 'd-measure.json')));

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1025x900', width: 1025, height: 900 },
  { name: '1024x900', width: 1024, height: 900 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
];
const PAGES = [
  { url: '/', name: 'landing' },
  { url: '/paper/', name: 'section-paper' },
  { url: '/paper/dev/dialogs/', name: 'content-dialogs' },
  { url: '/paper/reference/world-configuration/', name: 'reference-longpage' },
  { url: '/velocity/tuning/', name: 'content-tuning' },
  { url: '/all-pages.html', name: 'index-allpages' },
];

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const IN_PAGE = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const art = q('.article') || q('.content') || document.body;

  /* reference body paragraph style: first unclassed <p> in the article, else body */
  const refP = qa('p', art).filter((p) => !p.className && (p.innerText || '').trim().length > 60)[0] || q('p', art) || document.body;
  const refS = getComputedStyle(refP);

  /* --- probe: same font, long text, count chars per line --- */
  const probe = (text) => {
    const el = document.createElement('p');
    el.style.cssText = 'margin:0;padding:0;border:0;position:static;max-width:none;width:100%;box-sizing:border-box;' +
      'font:' + refS.font + ';letter-spacing:' + refS.letterSpacing + ';word-spacing:' + refS.wordSpacing + ';' +
      'overflow-wrap:' + refS.overflowWrap + ';word-break:' + refS.wordBreak + ';line-height:' + refS.lineHeight;
    el.textContent = text;
    refP.parentNode.insertBefore(el, refP.nextSibling);
    const node = el.firstChild;
    const rng = document.createRange();
    const geo = [];
    for (let i = 0; i < text.length; i++) {
      rng.setStart(node, i); rng.setEnd(node, i + 1);
      const rr = rng.getBoundingClientRect();
      geo.push({ ch: text[i], top: rr.top, bottom: rr.bottom, w: rr.width, x1: rr.right });
    }
    const lines = [];
    for (const g of geo) {
      let t = null;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 2; i--) {
        const L = lines[i];
        const ov = Math.min(L.bottom, g.bottom) - Math.max(L.top, g.top);
        if (ov > Math.min(L.bottom - L.top, g.bottom - g.top) * 0.5) { t = L; break; }
      }
      if (!t) { t = { top: g.top, bottom: g.bottom, n: 0 }; lines.push(t); }
      t.top = Math.min(t.top, g.top); t.bottom = Math.max(t.bottom, g.bottom);
      if (!/\s/.test(g.ch) && g.w > 0) t.n++;
    }
    const w = el.getBoundingClientRect().width;
    el.remove();
    const full = lines.slice(0, -1).map((l) => l.n);
    return {
      w: R2(w),
      lines: lines.length,
      fullLineChars: full,
      medianChars: full.length ? full.slice().sort((a, b) => a - b)[Math.floor(full.length / 2)] : null,
      maxChars: full.length ? Math.max.apply(null, full) : null,
    };
  };

  const LATIN = ('Minecraft server administrators configure world settings through a hierarchical ' +
    'configuration file that mirrors the structure of the settings themselves. Each leaf value ' +
    'carries a description, a default, and a type. Editing the file requires restarting the server ' +
    'before the changes take effect, and invalid values are silently replaced by defaults. ').repeat(3);
  const HAN = ('世界配置文件采用层级结构组织每一个设置项，其层级与设置本身的嵌套关系保持一致。' +
    '每个叶子节点都带有说明、默认值与类型标注。修改文件后需要重启服务器才会生效，' +
    '若取值非法则会被静默替换为默认值，因此建议在修改前先备份原始文件。').repeat(3);

  const latin = probe(LATIN);
  const han = probe(HAN);

  /* --- heading scale (all six levels, synthesised where absent) --- */
  const headingScale = {};
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((t) => {
    const el = q(t + ', .article ' + t) || q(t);
    if (el) {
      const s = getComputedStyle(el);
      headingScale[t] = { size: R2(parseFloat(s.fontSize)), lh: R2(parseFloat(s.lineHeight) || 0), ratio: R2((parseFloat(s.lineHeight) || 0) / parseFloat(s.fontSize)), weight: s.fontWeight, color: s.color, mT: R2(parseFloat(s.marginTop)), mB: R2(parseFloat(s.marginBottom)), present: true };
    } else {
      headingScale[t] = { present: false };
    }
  });
  /* h5/h6 usually absent -> read the cascade by injecting */
  ['h5', 'h6', 'h4'].forEach((t) => {
    if (headingScale[t] && headingScale[t].present) return;
    const el = document.createElement(t);
    el.textContent = 'probe';
    art.appendChild(el);
    const s = getComputedStyle(el);
    headingScale[t] = { size: R2(parseFloat(s.fontSize)), lh: R2(parseFloat(s.lineHeight) || 0), ratio: R2((parseFloat(s.lineHeight) || 0) / parseFloat(s.fontSize)), weight: s.fontWeight, color: s.color, mT: R2(parseFloat(s.marginTop)), mB: R2(parseFloat(s.marginBottom)), present: false, injected: true };
    el.remove();
  });

  /* --- weight inventory over rendered text --- */
  const weights = {};
  qa('*', art).forEach((el) => {
    if (!(el.innerText || '').trim() && !qa('img', el).length) return;
    const fw = getComputedStyle(el).fontWeight;
    if (!weights[fw]) weights[fw] = { count: 0, tags: {}, sample: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) };
    weights[fw].count++;
    const t = el.tagName.toLowerCase();
    weights[fw].tags[t] = (weights[fw].tags[t] || 0) + 1;
  });

  /* --- emphasis budget --- */
  const chars = (art.innerText || '').replace(/\s+/g, '').length || 1;
  const emp = {
    chars: chars,
    strong: qa('strong,b', art).length,
    em: qa('em,i', art).length,
    links: qa('a', art).length,
    inlineCode: qa(':not(pre)>code', art).length,
    linksUnderlined: qa('a', art).filter((a) => (getComputedStyle(a).textDecorationLine || '').indexOf('underline') >= 0).length,
    linksUnderlinedNonHover: qa('a', art).filter((a) => (getComputedStyle(a).textDecorationLine || '').indexOf('underline') >= 0).length,
    linkColor: (function () { const a = qa('a', art)[0]; return a ? getComputedStyle(a).color : null; })(),
    bodyColor: refS.color,
  };

  /* --- table numeric alignment --- */
  const tableInfo = (function () {
    const t = q('.table-wrap table') || q('table');
    if (!t) return null;
    const tds = qa('td', t).slice(0, 20);
    const nums = tds.filter((x) => /^[\s\d.,%+-]+$/.test(x.innerText || ''));
    return {
      font: getComputedStyle(t).fontSize,
      tdCount: qa('td', t).length,
      numericCells: nums.length,
      variantNumeric: tds.length ? getComputedStyle(tds[0]).fontVariantNumeric : null,
      family: tds.length ? getComputedStyle(tds[0]).fontFamily.split(',')[0].replace(/"/g, '') : null,
      chPx: (function () {
        if (!tds.length) return null;
        const s = document.createElement('span');
        s.style.cssText = 'position:absolute;left:-9999px;display:block;width:1ch;font:' + getComputedStyle(tds[0]).font;
        document.body.appendChild(s);
        const w = s.getBoundingClientRect().width;
        s.remove();
        return R2(w);
      })(),
      sampleNums: nums.slice(0, 5).map((x) => (x.innerText || '').trim()),
    };
  })();

  /* --- chip / badge geometry above body --- */
  const meta = q('.page-meta');
  const h1 = q('h1', art);
  const firstP = qa('p', art).filter((p) => !p.className && (p.innerText || '').trim().length > 80)[0];

  return {
    url: location.pathname,
    docHeight: Math.round(document.documentElement.scrollHeight),
    innerW: document.documentElement.clientWidth,
    lang: document.documentElement.lang,
    hasToc: !!(q('.layout') && q('.layout').classList.contains('has-toc')),
    tocVisible: !!(q('.toc-side') && q('.toc-side').offsetParent !== null && getComputedStyle(q('.toc-side')).display !== 'none'),
    tocItems: qa('.toc-side a').length,
    contentW: R2((q('.content') || art).getBoundingClientRect().width),
    articleW: R2(art.getBoundingClientRect().width),
    bodyFont: { size: R2(parseFloat(refS.fontSize)), lh: R2(parseFloat(refS.lineHeight)), lhRatio: R2(parseFloat(refS.lineHeight) / parseFloat(refS.fontSize)), family: refS.fontFamily.split(',')[0] },
    latin: latin,
    han: han,
    headingScale: headingScale,
    weights: weights,
    emph: emp,
    table: tableInfo,
    y: {
      h1: h1 ? R2(h1.getBoundingClientRect().y + window.scrollY) : null,
      meta: meta ? R2(meta.getBoundingClientRect().y + window.scrollY) : null,
      metaH: meta ? R2(meta.getBoundingClientRect().height) : null,
      chipCount: meta ? qa('.chip, .tbtn, a', meta).length : 0,
      firstP: firstP ? R2(firstP.getBoundingClientRect().y + window.scrollY) : null,
      toc: (function () { const t = q('.toc-side'); return t && t.offsetParent !== null ? R2(t.getBoundingClientRect().y + window.scrollY) : null; })(),
      tocH: (function () { const t = q('.toc-side'); return t && t.offsetParent !== null ? R2(t.getBoundingClientRect().height) : null; })(),
    },
    headings: qa('h1,h2,h3,h4,h5,h6', art).length,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const results = [];
  for (const vp of VIEWPORTS) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const pg of PAGES) {
      try {
        await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 30000 });
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
        await page.waitForTimeout(80);
        const d = await page.evaluate(IN_PAGE);
        results.push({ viewport: vp.name, vpW: vp.width, page: pg.url, name: pg.name, m: d });
        process.stderr.write('ok ' + vp.name + ' ' + pg.url + ' latin=' + d.latin.medianChars + ' han=' + d.han.medianChars + '\n');
      } catch (e) {
        results.push({ viewport: vp.name, page: pg.url, name: pg.name, error: String(e).slice(0, 200) });
        process.stderr.write('ERR ' + vp.name + ' ' + pg.url + ' ' + e + '\n');
      }
    }
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, results: results }, null, 1), 'utf8');
  process.stderr.write('wrote ' + OUT + '\n');
})();
