'use strict';
/**
 * critique-typo-c.js -- fine-grained probes:
 *  A. whole-content mid-word break scanner (chips / sidebar / article, tagged by selector)
 *  B. CJK <-> Latin inter-character gap measurement (is there any optical spacing?)
 *  C. vertical rhythm: consecutive block gaps incl. margin collapsing, and heading offsets
 *  D. dark/auto-dark token + border re-check on a code heavy page
 *  E. first-screen budget: what is rendered in viewport 1 on mobile (TOC vs H1)
 *
 * Usage: node tools/critique-typo-c.js --out="..\_typo-critique\c-probe.json"
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const BASE = opt('url', 'http://127.0.0.1:8787');
const OUT = path.resolve(__dirname, '..', opt('out', path.join('..', '_typo-critique', 'c-probe.json')));

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const IN_PAGE = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const desc = (el) => {
    let p = el, hops = 0;
    while (p && p !== document.body && hops < 4) { p = p.parentElement; hops++; }
    const own = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : '');
    return own;
  };

  /* generic: find every line break that cuts a Latin word in half, within a scope */
  const scanScope = (scope, limit) => {
    const found = [];
    const blocks = qa('p, li, h1, h2, h3, h4, h5, h6, td, th, a, summary, .chip, .page-desc, .crumbs', scope);
    for (const blk of blocks) {
      if (blk.querySelector('p, li, ul, ol')) continue;   // only leaf blocks
      const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, null);
      const chars = [];
      let n;
      while ((n = walker.nextNode())) {
        const v = n.nodeValue;
        for (let i = 0; i < v.length; i++) chars.push({ node: n, i: i, ch: v[i] });
      }
      if (chars.length < 12) continue;
      const rng = document.createRange();
      const geo = [];
      for (let k = 0; k < chars.length; k++) {
        const c = chars[k];
        rng.setStart(c.node, c.i); rng.setEnd(c.node, c.i + 1);
        const rr = rng.getBoundingClientRect();
        geo.push({ k: k, ch: c.ch, top: rr.top, bottom: rr.bottom, x1: rr.right, w: rr.width });
      }
      const lines = [];
      for (const g of geo) {
        let t = null;
        for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
          const L = lines[i];
          const ov = Math.min(L.bottom, g.bottom) - Math.max(L.top, g.top);
          if (ov > Math.min(L.bottom - L.top, g.bottom - g.top) * 0.5) { t = L; break; }
        }
        if (!t) { t = { top: g.top, bottom: g.bottom, startK: g.k, endK: g.k, n: 0, x1: 0 }; lines.push(t); }
        t.top = Math.min(t.top, g.top); t.bottom = Math.max(t.bottom, g.bottom);
        t.endK = g.k; t.x1 = Math.max(t.x1, g.x1);
        if (!/\s/.test(g.ch) && g.w > 0) t.n++;
      }
      lines.sort((a, b) => a.top - b.top);
      if (lines.length < 2) continue;
      const raw = chars.map((c) => c.ch).join('');
      for (let k = 0; k + 1 < lines.length; k++) {
        const a = lines[k], b = lines[k + 1];
        if (a.n < 3) continue;
        const between = raw.slice(a.endK, b.startK + 1);
        if (/\s/.test(between)) continue;
        const ec = raw[a.endK], sc = raw[b.startK];
        if (/[A-Za-z]/.test(ec) && /[A-Za-z]/.test(sc)) {
          let ws = a.endK, we = b.startK;
          while (ws > 0 && /[A-Za-z]/.test(raw[ws - 1])) ws--;
          while (we < raw.length && /[A-Za-z]/.test(raw[we])) we++;
          found.push({
            sel: desc(blk), word: raw.slice(ws, we),
            left: raw.slice(ws, a.endK + 1), right: raw.slice(b.startK, we),
            fontPx: R2(parseFloat(getComputedStyle(blk).fontSize)),
            boxW: R2(blk.getBoundingClientRect().width),
          });
          if (found.length >= (limit || 20)) return found;
        }
      }
    }
    return found;
  };

  /* CJK <-> Latin optical gap: distance between adjacent glyph boxes */
  const cjkLatinGaps = () => {
    const out = [];
    const paras = qa('.article p, .article li').slice(0, 120);
    for (const p of paras) {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walker.nextNode())) {
        const v = n.nodeValue;
        for (let i = 0; i + 1 < v.length; i++) {
          const a = v[i], b = v[i + 1];
          const hanA = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(a);
          const hanB = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(b);
          const latA = /[A-Za-z0-9]/.test(a), latB = /[A-Za-z0-9]/.test(b);
          if ((hanA && latB) || (latA && hanB)) {
            const r = document.createRange();
            r.setStart(n, i); r.setEnd(n, i + 1);
            const r1 = r.getBoundingClientRect();
            r.setStart(n, i + 1); r.setEnd(n, i + 2);
            const r2 = r.getBoundingClientRect();
            if (r1.width === 0 || r2.width === 0) continue;
            out.push({ pair: a + b, gap: R2(r2.left - r1.right), size: R2(parseFloat(getComputedStyle(p).fontSize)), sel: desc(p) });
            if (out.length > 60) return out;
          }
        }
      }
    }
    return out;
  };

  /* vertical rhythm of the article: gap between consecutive siblings */
  const rhythm = () => {
    const art = q('.article');
    if (!art) return null;
    const kids = Array.prototype.slice.call(art.children);
    const arr = kids.map((k) => {
      const s = getComputedStyle(k);
      const r = k.getBoundingClientRect();
      const tag = k.tagName.toLowerCase();
      return {
        tag: tag, cls: typeof k.className === 'string' ? k.className.split(/\s+/)[0] : '',
        y: R2(r.y + window.scrollY), h: R2(r.height),
        mT: R2(parseFloat(s.marginTop)), mB: R2(parseFloat(s.marginBottom)),
        size: R2(parseFloat(s.fontSize)), lh: R2(parseFloat(s.lineHeight)),
        padT: R2(parseFloat(s.paddingTop)), padB: R2(parseFloat(s.paddingBottom)),
        borderT: s.borderTopWidth,
      };
    });
    const gaps = [];
    for (let i = 1; i < arr.length; i++) {
      gaps.push({
        from: arr[i - 1].tag + (arr[i - 1].cls ? '.' + arr[i - 1].cls : ''),
        to: arr[i].tag + (arr[i].cls ? '.' + arr[i].cls : ''),
        visualGap: R2(arr[i].y - (arr[i - 1].y + arr[i - 1].h)),
        cssMB: arr[i - 1].mB, cssMT: arr[i].mT,
      });
    }
    return { count: arr.length, rows: arr.slice(0, 30), gaps: gaps.slice(0, 30) };
  };

  /* table / code / idea of block padding */
  const misc = () => ({
    codeBlock: (function () {
      const pre = q('.code-pre');
      if (!pre) return null;
      const s = getComputedStyle(pre);
      const code = q('code', pre);
      const cs = code ? getComputedStyle(code) : null;
      return {
        prePad: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' '),
        preFont: s.fontSize, preLh: s.lineHeight, preFam: s.fontFamily.split(',')[0],
        codeFont: cs ? cs.fontSize : null, codeLh: cs ? cs.lineHeight : null,
        scrollW: pre.scrollWidth, clientW: pre.clientWidth, hScroll: pre.scrollWidth > pre.clientWidth + 1,
        maxLineChars: (function () {
          const t = (code ? code.innerText : '').split('\n').reduce((m, l) => Math.max(m, l.length), 0);
          return t;
        })(),
      };
    })(),
    inlineCode: (function () {
      const c = q('.article :not(pre)>code');
      if (!c) return null;
      const s = getComputedStyle(c);
      const p = c.closest('p');
      return { font: s.fontSize, pad: s.padding, radius: s.borderRadius, border: s.borderWidth + ' ' + s.borderColor, parentFont: p ? getComputedStyle(p).fontSize : null };
    })(),
    table: (function () {
      const t = q('.table-wrap table');
      if (!t) return null;
      const th = q('th', t), td = q('td', t);
      return {
        font: getComputedStyle(t).fontSize,
        thFont: th ? getComputedStyle(th).fontSize : null,
        tdFont: td ? getComputedStyle(td).fontSize : null,
        thPad: th ? getComputedStyle(th).padding : null,
        tdPad: td ? getComputedStyle(td).padding : null,
        variantNumeric: td ? getComputedStyle(td).fontVariantNumeric : null,
        rows: qa('tr', t).length,
      };
    })(),
    lists: (function () {
      const ul = q('.article ul');
      if (!ul) return null;
      const li = q('li', ul);
      const s = getComputedStyle(ul);
      const ls = li ? getComputedStyle(li) : null;
      return { ulM: s.margin, ulPad: s.padding, liM: ls ? ls.margin : null, liLh: ls ? ls.lineHeight : null, listStyle: s.listStyleType };
    })(),
    emphasis: (function () {
      const art = q('.article');
      if (!art) return null;
      const chars = (art.innerText || '').replace(/\s+/g, '').length || 1;
      return {
        articleChars: chars,
        strong: qa('strong, b', art).length,
        em: qa('em, i', art).length,
        links: qa('a', art).length,
        inlineCode: qa(':not(pre)>code', art).length,
        underlineLinks: qa('a', art).filter((a) => getComputedStyle(a).textDecorationLine.indexOf('underline') >= 0).length,
        strongPer1k: R2(qa('strong, b', art).length / chars * 1000),
        linkPer1k: R2(qa('a', art).length / chars * 1000),
        codePer1k: R2(qa(':not(pre)>code', art).length / chars * 1000),
      };
    })(),
  });

  /* what fills the first viewport */
  const firstViewport = () => {
    const vh = window.innerHeight;
    const items = [];
    qa('.crumbs, .hero, .page-head, .toc-side, .side-toc, .article > *').forEach((el) => {
      const r = el.getBoundingClientRect();
      const y = r.y + window.scrollY;
      if (y < vh) items.push({ sel: desc(el), y: R2(y), h: R2(r.height), aboveFold: y + r.height <= vh, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50) });
    });
    return { vh: vh, items: items };
  };

  /* headings inventory for navigation quality */
  const nav = () => {
    const art = q('.article');
    const scope = art || document;
    const heads = qa('h1,h2,h3,h4,h5,h6', scope).map((h) => ({ tag: h.tagName.toLowerCase(), text: (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), y: R2(h.getBoundingClientRect().y + window.scrollY) }));
    const tocA = qa('.toc-side a').map((a) => ({ text: (a.innerText || '').trim(), href: a.getAttribute('href') }));
    return {
      heads: heads, headCount: heads.length,
      tocItems: tocA.length, tocSample: tocA.slice(0, 8),
      docHeight: Math.round(document.documentElement.scrollHeight),
      artChars: art ? (art.innerText || '').replace(/\s+/g, '').length : null,
    };
  };

  return {
    url: location.pathname,
    theme: document.documentElement.getAttribute('data-theme'),
    nav: nav(),
    firstViewport: firstViewport(),
    splitsArticle: scanScope(q('.article') || document.body, 25),
    splitsChips: scanScope(q('.page-meta') || document.body, 10),
    splitsSidebar: scanScope(q('.sidebar') || document.body, 10),
    cjkGaps: cjkLatinGaps(),
    rhythm: rhythm(),
    misc: misc(),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb'] });
  const jobs = [
    { vp: { width: 1440, height: 900 }, page: '/paper/dev/dialogs/', mode: 'light' },
    { vp: { width: 1440, height: 900 }, page: '/paper/dev/dialogs/', mode: 'dark' },
    { vp: { width: 1440, height: 900 }, page: '/paper/reference/world-configuration/', mode: 'light' },
    { vp: { width: 390, height: 844 }, page: '/paper/dev/dialogs/', mode: 'light' },
    { vp: { width: 390, height: 844 }, page: '/paper/reference/world-configuration/', mode: 'light' },
    { vp: { width: 320, height: 568 }, page: '/paper/dev/dialogs/', mode: 'light' },
    { vp: { width: 320, height: 568 }, page: '/paper/reference/world-configuration/', mode: 'light' },
    { vp: { width: 768, height: 1024 }, page: '/paper/dev/dialogs/', mode: 'light' },
    { vp: { width: 1440, height: 900 }, page: '/velocity/tuning/', mode: 'light' },
    { vp: { width: 1440, height: 900 }, page: '/paper/', mode: 'light' },
  ];
  const results = [];
  for (const j of jobs) {
    const ctx = await browser.newContext({ viewport: j.vp, deviceScaleFactor: 1, colorScheme: j.mode === 'dark' ? 'dark' : 'light' });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + j.page, { waitUntil: 'load', timeout: 30000 });
      await page.evaluate((m) => {
        try { localStorage.setItem('lcb-theme', m); } catch (e) {}
        document.documentElement.setAttribute('data-theme', m);
      }, j.mode);
      await page.waitForTimeout(120);
      const d = await page.evaluate(IN_PAGE);
      results.push({ vp: j.vp.width + 'x' + j.vp.height, page: j.page, mode: j.mode, m: d });
      process.stderr.write('ok ' + j.mode + ' ' + j.vp.width + ' ' + j.page + ' splits=' + d.splitsArticle.length + '\n');
    } catch (e) {
      results.push({ vp: j.vp.width + 'x' + j.vp.height, page: j.page, mode: j.mode, error: String(e).slice(0, 240) });
      process.stderr.write('ERR ' + j.page + ' ' + e + '\n');
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), results: results }, null, 1), 'utf8');
  process.stderr.write('wrote ' + OUT + '\n');
})();
