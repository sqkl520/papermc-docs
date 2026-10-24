'use strict';
/**
 * critique-typo-a.js -- typography measurement collector for the "typography & reading
 * experience" critique (read-only against the site; writes JSON outside the project).
 *
 * Writes: <out>  structured JSON for every viewport x page x theme-mode combination.
 *
 * Usage:
 *   node tools/critique-typo-a.js --mode=light   --out="..\_typo-critique\a-light.json"
 *   node tools/critique-typo-a.js --mode=dark    --out="..\_typo-critique\a-dark.json"
 *   node tools/critique-typo-a.js --mode=auto-dark --out="..\_typo-critique\a-autodark.json"
 *   node tools/critique-typo-a.js --mode=light --pages=dialogs --out=...
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('url', 'http://127.0.0.1:8787');
const MODE = opt('mode', 'light');           // light | dark | auto-dark | auto-light
const OUT = path.resolve(__dirname, '..', opt('out', path.join('..', '_typo-critique', 'a-' + MODE + '.json')));
const ONLY = opt('pages', '');

const ALL_VP = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1025x900', width: 1025, height: 900 },
  { name: '1024x900', width: 1024, height: 900 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
];
const FULL_VP = ['1440x900', '320x568'];
const VIEWPORTS = ONLY ? ALL_VP : ALL_VP.filter((v) => MODE === 'light' || FULL_VP.indexOf(v.name) >= 0);

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

/* ---------------------------------------------------------------- */
/* in-page collector                                                */
/* ---------------------------------------------------------------- */
const COLLECT = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const a = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const cr = (c1, c2) => {
    if (!c1 || !c2) return null;
    const L1 = lum(c1), L2 = lum(c2);
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  const effBg = (el) => {
    let n = el, acc = null;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.001) acc = acc ? blend(acc, c) : c;
      if (acc && acc.a >= 0.999) return acc;
      n = n.parentElement;
    }
    return acc && acc.a >= 0.999 ? acc : { r: 255, g: 255, b: 255, a: 1 };
  };
  const hex = (c) => (c ? '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : null);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: R2(r.width), h: R2(r.height), x: R2(r.x), y: R2(r.y), right: R2(r.right) };
  };
  const q = (s, root) => (root || document).querySelector(s);
  const qa = (s, root) => Array.prototype.slice.call((root || document).querySelectorAll(s));
  const txt = (el, n) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n || 40) : null);

  const info = (el, role) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const fg0 = parse(s.color);
    const bg = effBg(el);
    const r = el.getBoundingClientRect();
    const fg = fg0 && fg0.a < 1 ? blend(fg0, bg) : fg0;
    return {
      role: role,
      sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''),
      sample: txt(el, 48),
      size: R2(parseFloat(s.fontSize)),
      lh: s.lineHeight === 'normal' ? null : R2(parseFloat(s.lineHeight)),
      lhRatio: s.lineHeight === 'normal' ? null : R2(parseFloat(s.lineHeight) / parseFloat(s.fontSize)),
      weight: s.fontWeight,
      style: s.fontStyle,
      spacing: s.letterSpacing,
      family: s.fontFamily.split(',')[0].replace(/"/g, ''),
      familyFull: s.fontFamily,
      color: fg ? 'rgb(' + Math.round(fg.r) + ',' + Math.round(fg.g) + ',' + Math.round(fg.b) + ')' : null,
      colorHex: hex(fg),
      bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
      bgHex: hex(bg),
      contrast: cr(fg, bg),
      mT: R2(parseFloat(s.marginTop)), mB: R2(parseFloat(s.marginBottom)),
      mR: R2(parseFloat(s.marginRight)), mL: R2(parseFloat(s.marginLeft)),
      pT: R2(parseFloat(s.paddingTop)), pB: R2(parseFloat(s.paddingBottom)),
      pL: R2(parseFloat(s.paddingLeft)), pR: R2(parseFloat(s.paddingRight)),
      borderL: s.borderLeftWidth, borderB: s.borderBottomWidth, borderColor: s.borderBottomColor,
      w: R2(r.width), x: R2(r.x), y: R2(r.y),
      maxWidth: s.maxWidth,
      wrap: s.overflowWrap, wordBreak: s.wordBreak, hyphens: s.hyphens,
      textWrap: s.textWrapStyle || s.textWrap || null,
      variantNum: s.fontVariantNumeric,
      deco: s.textDecorationLine, align: s.textAlign,
    };
  };

  /* --- ch width for a given element's font (canvas + 1ch probe) --- */
  const chOf = (el) => {
    const s = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;font:' + s.font;
    probe.textContent = '0'.repeat(100);
    document.body.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 100;
    probe.textContent = '0';
    probe.style.width = '1ch';
    probe.style.display = 'block';
    const w2 = probe.getBoundingClientRect().width;
    probe.remove();
    return { canvas: R2(w), cssCh: R2(w2) };
  };

  /* --- empirical chars per rendered line for the first long paragraph --- */
  const LINE_STATS = (el) => {
    if (!el) return null;
    const node = (function find(n) {
      if (n.nodeType === 3 && n.nodeValue.replace(/\s+/g, '').length > 240) return n;
      for (let i = 0; i < n.childNodes.length; i++) { const r = find(n.childNodes[i]); if (r) return r; }
      return null;
    })(el);
    if (!node) return null;
    const raw = node.nodeValue;
    const rng = document.createRange();
    const rects = [];
    for (let i = 0; i < raw.length; i++) {
      if (/\s/.test(raw[i])) { rects.push(null); continue; }
      rng.setStart(node, i); rng.setEnd(node, i + 1);
      const rr = rng.getBoundingClientRect();
      rects.push({ y: Math.round(rr.y), x: R2(rr.x) });
    }
    const lines = [];
    let cur = null;
    for (let i = 0; i < raw.length; i++) {
      const rc = rects[i];
      if (!rc) continue;
      if (!cur || Math.abs(cur.y - rc.y) > 2) { cur = { y: rc.y, n: 0, first: i }; lines.push(cur); }
      cur.n++;
      cur.last = i;
    }
    // mid-word break detection (Latin letter runs split across lines without hyphen)
    const breaks = [];
    for (let k = 0; k + 1 < lines.length; k++) {
      const a = lines[k], b = lines[k + 1];
      if (a.n < 3) continue;
      const endCh = raw[a.last], startCh = raw[b.first];
      if (/[A-Za-z]/.test(endCh) && /[A-Za-z]/.test(startCh)) {
        let s = a.last, e = b.first + 1;
        while (s > 0 && /[A-Za-z]/.test(raw[s - 1])) s--;
        while (e < raw.length && /[A-Za-z]/.test(raw[e])) e++;
        breaks.push(raw.slice(s, e));
      }
    }
    return {
      paraChars: raw.length,
      lineCount: lines.length,
      firstLineChars: lines[0] ? lines[0].n : null,
      avgCharsPerLine: lines.length ? R2(lines.reduce((s, l) => s + l.n, 0) / lines.length) : null,
      minLineChars: lines.length ? Math.min.apply(null, lines.map((l) => l.n)) : null,
      midWordBreaks: breaks.slice(0, 6),
      midWordBreakCount: breaks.length,
    };
  };

  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const article = q('.article');
  const content = q('.content') || q('main');
  const toc = q('.toc-side');
  const sidebar = q('.sidebar, .side-nav, aside nav');
  const layout = q('.layout');

  const out = {
    url: location.pathname,
    title: document.title,
    lang: root.lang,
    theme: root.getAttribute('data-theme'),
    colorScheme: cs.colorScheme,
    docHeight: Math.round(document.documentElement.scrollHeight),
    articleChars: article ? (article.innerText || '').replace(/\s+/g, '').length : null,
    hasToc: !!(layout && layout.classList.contains('has-toc')),
    boxes: {
      content: box(content),
      article: box(article),
      toc: toc && toc.offsetParent !== null ? box(toc) : null,
      sidebar: sidebar && sidebar.offsetParent !== null ? box(sidebar) : null,
      layout: box(layout),
    },
    contentCss: content ? {
      maxWidth: getComputedStyle(content).maxWidth,
      padL: R2(parseFloat(getComputedStyle(content).paddingLeft)),
      padR: R2(parseFloat(getComputedStyle(content).paddingRight)),
    } : null,
    tokens: {
      bg: cs.getPropertyValue('--bg').trim(),
      bgSoft: cs.getPropertyValue('--bg-soft').trim(),
      bgElev: cs.getPropertyValue('--bg-elev').trim(),
      fg: cs.getPropertyValue('--fg').trim(),
      fgMuted: cs.getPropertyValue('--fg-muted').trim(),
      border: cs.getPropertyValue('--border').trim(),
      borderStrong: cs.getPropertyValue('--border-strong').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
      accentSoft: cs.getPropertyValue('--accent-soft').trim(),
      codeBg: cs.getPropertyValue('--code-bg').trim(),
      font: cs.getPropertyValue('--font').trim(),
      mono: cs.getPropertyValue('--mono').trim(),
    },
    headings: qa('h1,h2,h3,h4,h5,h6', article || document).slice(0, 40).map((h) => {
      const i = info(h, h.tagName.toLowerCase());
      return { tag: h.tagName.toLowerCase(), text: txt(h, 40), size: i.size, lh: i.lh, lhRatio: i.lhRatio, weight: i.weight, mT: i.mT, mB: i.mB, color: i.colorHex, y: i.y, contrast: i.contrast };
    }),
    headingCounts: (function () {
      const c = {};
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((t) => { c[t] = qa(t, article || document).length; });
      return c;
    })(),
    typo: {
      body: info(document.body, 'body'),
      p: info(qa('p', article || document).filter((p) => !p.className && p.innerText.trim().length > 120)[0] || q('p'), 'p'),
      pAll: qa('p', article || document).filter((p) => !p.className).slice(0, 3).map((p) => info(p, 'p')),
      pageDesc: info(q('.page-desc'), 'page-desc'),
      crumbs: info(q('.crumbs'), 'crumbs'),
      pageMeta: info(q('.page-meta'), 'page-meta'),
      chip: info(q('.chip'), 'chip'),
      link: info(qa('p a', article || document)[0], 'body-link'),
      strong: info(qa('strong', article || document)[0], 'strong'),
      em: info(qa('em', article || document)[0], 'em'),
      inlineCode: info(qa(':not(pre)>code', article || document)[0], 'inline-code'),
      preCode: info(qa('.code-pre code', article || document)[0], 'pre-code'),
      codePre: info(q('.code-pre'), 'code-pre'),
      codeTitle: info(q('.code-title'), 'code-title'),
      table: info(q('.table-wrap table'), 'table'),
      th: info(q('.table-wrap thead th'), 'th'),
      td: info(q('.table-wrap tbody td'), 'td'),
      alert: info(q('.alert'), 'alert'),
      alertTitle: info(q('.alert-title'), 'alert-title'),
      tocLink: info(q('.toc-side a'), 'toc-link'),
      tocTitle: info(q('.toc-side .toc-title'), 'toc-title'),
      sideLink: info(q('.side-sec a[data-search], .side-cat a[data-search]'), 'side-link'),
      heroH1: info(q('.hero h1'), 'hero-h1'),
      heroP: info(q('.hero p'), 'hero-p'),
      sectionH2: info(q('.section-head h2'), 'section-h2'),
      cardH3: info(q('.card h3'), 'card-h3'),
      li: info(qa('.article li', article || document)[0], 'li'),
      list: info(q('.article ul'), 'ul'),
    },
    blocks: (function () {
      if (!article) return null;
      const kids = Array.prototype.slice.call(article.children);
      const sel = kids.filter((k) => /^(P|H1|H2|H3|H4|H5|H6|UL|OL|PRE|DIV|TABLE|ASIDE|IMG|FIGURE)$/.test(k.tagName)).slice(0, 24);
      const rows = sel.map((k) => {
        const s = getComputedStyle(k);
        const r = k.getBoundingClientRect();
        return {
          tag: k.tagName.toLowerCase() + (typeof k.className === 'string' && k.className ? '.' + k.className.split(/\s+/)[0] : ''),
          y: R2(r.y + window.scrollY), h: R2(r.height),
          mT: R2(parseFloat(s.marginTop)), mB: R2(parseFloat(s.marginBottom)),
          size: R2(parseFloat(s.fontSize)), lh: R2(parseFloat(s.lineHeight)),
        };
      });
      const gaps = [];
      for (let i = 1; i < rows.length; i++) gaps.push({ from: rows[i - 1].tag, to: rows[i].tag, gap: R2(rows[i].y - (rows[i - 1].y + rows[i - 1].h)) });
      return { rows: rows, gaps: gaps };
    })(),
    firstScreen: (function () {
      const h1 = q('h1', article || document);
      const anchor = h1 || q('h1');
      const sr = { h1Y: anchor ? R2(anchor.getBoundingClientRect().y + window.scrollY) : null };
      sr.beforeH1 = (function () {
        if (!article) return null;
        const kids = Array.prototype.slice.call(article.children);
        const idx = kids.indexOf(kids.filter((k) => k.tagName === 'H1')[0]);
        if (idx < 0) return null;
        return kids.slice(0, idx + 1).map((k) => ({ tag: k.tagName.toLowerCase(), cls: typeof k.className === 'string' ? k.className : '', text: txt(k, 60), h: R2(k.getBoundingClientRect().height) }));
      })();
      sr.chipCount = qa('.page-meta .chip, .page-meta a').length;
      sr.metaHeight = q('.page-meta') ? R2(q('.page-meta').getBoundingClientRect().height) : null;
      sr.crumbsY = q('.crumbs') ? R2(q('.crumbs').getBoundingClientRect().y + window.scrollY) : null;
      sr.tocY = q('.toc-side') && q('.toc-side').offsetParent !== null ? R2(q('.toc-side').getBoundingClientRect().y + window.scrollY) : null;
      sr.tocItems = qa('.toc-side a').length;
      return sr;
    })(),
    measure: (function () {
      const pEl = qa('p', article || document).filter((p) => !p.className && p.innerText.trim().length > 200)[0] || q('p', article || document);
      if (!pEl) return null;
      const ch = chOf(pEl);
      const w = pEl.getBoundingClientRect().width;
      const s = getComputedStyle(pEl);
      const line = LINE_STATS(article);
      const cand = [560, 592, 624, 640, 656, 672, 688, 704, 720, 736, 752, 768, 800, 832, 864, 900, 1000];
      return {
        pWidth: R2(w), pSize: R2(parseFloat(s.fontSize)),
        chPx: ch.cssCh, chCanvas: ch.canvas,
        widthInCh: R2(w / ch.cssCh),
        cands: cand.map((c) => ({ px: c, ch: R2(c / ch.cssCh), rem: R2(c / 16) })),
        line: line,
        htmlFontSize: R2(parseFloat(getComputedStyle(root).fontSize)),
      };
    })(),
    weights: (function () {
      const set = {};
      qa('*', article || document).forEach((el) => {
        const fw = getComputedStyle(el).fontWeight;
        if (!set[fw]) { set[fw] = { count: 0, sample: txt(el, 30), size: R2(parseFloat(getComputedStyle(el).fontSize)) }; }
        set[fw].count++;
      });
      return set;
    })(),
    code: (function () {
      const pre = q('.code-pre');
      if (!pre) return null;
      const codeEl = q('code', pre);
      const pEl = qa('p', article || document).filter((p) => !p.className && p.innerText.trim().length > 200)[0];
      const preS = getComputedStyle(pre);
      const ch = codeEl ? chOf(codeEl) : null;
      return {
        preFontSize: R2(parseFloat(preS.fontSize)),
        codeFontSize: codeEl ? R2(parseFloat(getComputedStyle(codeEl).fontSize)) : null,
        bodySize: pEl ? R2(parseFloat(getComputedStyle(pEl).fontSize)) : null,
        ratio: codeEl && pEl ? R2(parseFloat(getComputedStyle(codeEl).fontSize) / parseFloat(getComputedStyle(pEl).fontSize)) : null,
        lh: R2(parseFloat(preS.lineHeight)), lhRatio: R2(parseFloat(preS.lineHeight) / parseFloat(preS.fontSize)),
        family: preS.fontFamily,
        chPx: ch ? ch.cssCh : null,
        hScroll: pre ? (pre.scrollWidth > pre.clientWidth + 1) : null,
        preW: R2(pre.getBoundingClientRect().width),
        tabSize: preS.tabSize,
        wrap: preS.whiteSpace,
      };
    })(),
    tokensContrast: (function () {
      const res = {};
      const pre = q('.code-pre');
      qa('.hljs-keyword,.hljs-string,.hljs-comment,.hljs-number,.hljs-title,.hljs-built_in,.hljs-variable,.hljs-attr,.hljs-tag,.hljs-params,.hljs-literal,.hljs-type,.hljs-property,.hljs-meta,.hljs-section,.hljs-name,.hljs-symbol,.hljs-selector-tag,.hljs-builtin-name', document).slice(0, 200).forEach((el) => {
        const cls = Array.prototype.slice.call(el.classList).find((c) => c.startsWith('hljs-'));
        if (!cls || res[cls]) return;
        const s = getComputedStyle(el);
        const fg = parse(s.color);
        const bg = effBg(el);
        res[cls] = { color: s.color, colorHex: hex(fg), bgHex: hex(bg), contrast: cr(fg, bg), sample: txt(el, 24), size: R2(parseFloat(s.fontSize)) };
      });
      return res;
    })(),
    tableNums: (function () {
      const td = qa('.table-wrap tbody td, table.allpages td').slice(0, 12);
      if (!td.length) return null;
      return {
        count: qa('.table-wrap tbody td, table.allpages td').length,
        variantNums: td.map((t) => getComputedStyle(t).fontVariantNumeric),
        family: td.map((t) => getComputedStyle(t).fontFamily.split(',')[0].replace(/"/g, '')),
        sample: txt(td[0], 30),
      };
    })(),
    cjk: (function () {
      const pEl = qa('p', article || document).filter((p) => !p.className && p.innerText.trim().length > 200)[0];
      const s = pEl ? getComputedStyle(pEl) : null;
      return {
        overflowWrap: s ? s.overflowWrap : null,
        wordBreak: s ? s.wordBreak : null,
        hyphens: s ? s.hyphens : null,
        textWrap: s ? (s.textWrapStyle || null) : null,
        lineBreak: s ? s.lineBreak : null,
        wordSpacing: s ? s.wordSpacing : null,
        letterSpacing: s ? s.letterSpacing : null,
        textSpacingTrim: s ? (s.textSpacingTrim || null) : null,
        textAutospace: s ? (s.textAutospace || null) : null,
        lang: root.lang,
        inlineCodeWrap: (function () { const c = q(':not(pre)>code', article || document); return c ? getComputedStyle(c).overflowWrap : null; })(),
        linkDeco: (function () { const a = q('p a', article || document); return a ? getComputedStyle(a).textDecorationLine : null; })(),
      };
    })(),
    borders: (function () {
      const samples = ['.table-wrap', '.alert', '.code-block', '.toc-side', '.sidebar', '.page-footer', '.chip', '.card'];
      return samples.map((sel) => {
        const el = q(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        const bc = parse(s.borderTopColor || s.borderBottomColor);
        return { sel: sel, borderColor: s.borderTopColor || s.borderBottomColor, contrastVsBg: cr(bc, effBg(el.parentElement || el)), bg: hex(effBg(el)) };
      }).filter(Boolean);
    })(),
    contrastTable: (function () {
      const rows = [];
      const defs = [
        ['body', 'body'],
        ['article p', '.article p'],
        ['page-desc', '.page-desc'],
        ['crumbs', '.crumbs'],
        ['chip', '.chip'],
        ['p a (link)', '.article p a'],
        ['strong', '.article strong'],
        ['inline code', '.article :not(pre)>code'],
        ['table th', '.table-wrap thead th'],
        ['table td', '.table-wrap tbody td'],
        ['alert body', '.alert .alert-body p'],
        ['alert title', '.alert-title'],
        ['badge', '.alert-title .badge, .alert-title > span:first-child'],
        ['toc link', '.toc-side a'],
        ['toc active', '.toc-side a.active'],
        ['side link', '.side-sec a, .side-cat a'],
        ['pager ttl', '.pager .ttl'],
        ['pager dir', '.pager .dir'],
        ['footer', '.page-footer'],
        ['code lang', '.code-lang'],
        ['copy btn', '.code-copy'],
      ];
      defs.forEach((d) => {
        const el = q(d[1]);
        if (!el) { rows.push({ name: d[0], sel: d[1], missing: true }); return; }
        const s = getComputedStyle(el);
        const fg0 = parse(s.color);
        const bg = effBg(el);
        const fg = fg0 && fg0.a < 1 ? blend(fg0, bg) : fg0;
        rows.push({
          name: d[0], sel: d[1], color: s.color, colorHex: hex(fg), bgHex: hex(bg),
          contrast: cr(fg, bg), size: R2(parseFloat(s.fontSize)), weight: s.fontWeight,
          aa: cr(fg, bg) >= 4.5, aaLarge: cr(fg, bg) >= 3,
        });
      });
      return rows;
    })(),
  };
  return out;
};

/* ---------------------------------------------------------------- */
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
  const results = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      colorScheme: MODE === 'dark' || MODE === 'auto-dark' ? 'dark' : 'light',
      reducedMotion: 'no-preference',
    });
    for (const pg of PAGES) {
      const page = await ctx.newPage();
      const url = BASE + pg.url;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        // force the theme attribute exactly like site.js would (unless auto-* requested)
        await page.evaluate((mode) => {
          const html = document.documentElement;
          if (mode === 'light') { try { localStorage.setItem('lcb-theme', 'light'); } catch (e) {} html.setAttribute('data-theme', 'light'); }
          if (mode === 'dark') { try { localStorage.setItem('lcb-theme', 'dark'); } catch (e) {} html.setAttribute('data-theme', 'dark'); }
          if (mode === 'auto-dark' || mode === 'auto-light') { try { localStorage.removeItem('lcb-theme'); } catch (e) {} html.setAttribute('data-theme', 'auto'); }
        }, MODE);
        await page.waitForTimeout(120);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const data = await page.evaluate(COLLECT);
        results.push({ viewport: vp.name, vpW: vp.width, vpH: vp.height, page: pg.url, name: pg.name, mode: MODE, m: data });
        process.stderr.write('ok ' + MODE + ' ' + vp.name + ' ' + pg.url + ' h=' + data.docHeight + '\n');
      } catch (e) {
        results.push({ viewport: vp.name, page: pg.url, name: pg.name, mode: MODE, error: String(e).slice(0, 300) });
        process.stderr.write('ERR ' + vp.name + ' ' + pg.url + ' ' + e + '\n');
      }
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, mode: MODE, results: results }, null, 1), 'utf8');
  process.stderr.write('wrote ' + OUT + ' (' + results.length + ')\n');
})();
