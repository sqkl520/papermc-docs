'use strict';
/* critique-typo-f.js -- static HTML audit: link class inventory, heading level skips,
   chip composition above H1, and per-page text volume. Read-only. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PAGES = [
  ['/', 'landing'],
  ['/paper/', 'section-paper'],
  ['/paper/dev/dialogs/', 'content-dialogs'],
  ['/paper/reference/world-configuration/', 'reference-longpage'],
  ['/velocity/tuning/', 'content-tuning'],
  ['/all-pages.html', 'index-allpages'],
];

const out = {};
for (const [url, name] of PAGES) {
  const rel = url.endsWith('/') ? url.slice(1) + 'index.html' : url.slice(1);
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { out[name] = { url, missing: true }; continue; }
  const html = fs.readFileSync(file, 'utf8');
  const ai = html.indexOf('<article');
  const art = ai >= 0 ? html.slice(ai) : html;

  const links = art.match(/<a\s[^>]*>/g) || [];
  const cls = {};
  for (const l of links) {
    const m = l.match(/class="([^"]*)"/);
    const k = m ? m[1] : '(none)';
    cls[k] = (cls[k] || 0) + 1;
  }

  const heads = [];
  const hre = /<h([1-6])[^>]*>/g;
  let m;
  while ((m = hre.exec(art))) heads.push(Number(m[1]));

  const skips = [];
  for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) skips.push(heads[i - 1] + '->' + heads[i]);

  const count = (re) => (art.match(re) || []).length;

  out[name] = {
    url,
    bytes: html.length,
    headings: heads.length,
    counts: { h1: count(/<h1/g), h2: count(/<h2/g), h3: count(/<h3/g), h4: count(/<h4/g), h5: count(/<h5/g), h6: count(/<h6/g) },
    skips,
    links: links.length,
    linkClasses: cls,
    imgs: count(/<img/g),
    tables: count(/<table/g),
    codeBlocks: count(/<pre/g),
    alerts: count(/class="alert/g),
    chips: count(/class="chip"/g),
    strong: count(/<strong/g),
    em: count(/<em[ >]/g),
    hasToc: /class="toc-side"/.test(html),
    tocItems: (html.match(/class="toc-side"[\s\S]*?<\/aside>/) || [''])[0].split('<a ').length - 1,
    pageMeta: (function () {
      const mm = html.match(/<p class="page-meta">([\s\S]*?)<\/p>/);
      if (!mm) return null;
      const inner = mm[1];
      return { chips: (inner.match(/class="chip"/g) || []).length, raw: inner.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').slice(0, 160) };
    })(),
  };
}

fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'f-static.json'), JSON.stringify(out, null, 1), 'utf8');
for (const k of Object.keys(out)) {
  const o = out[k];
  if (o.missing) { console.log(k, 'MISSING'); continue; }
  console.log(k.padEnd(20), 'H', o.headings, JSON.stringify(o.counts), 'skips', JSON.stringify(o.skips), 'links', o.links, 'toc', o.tocItems, 'chips', o.chips);
}
console.log('\nlink classes (dialogs):', JSON.stringify(out['content-dialogs'].linkClasses, null, 1));
console.log('pageMeta (dialogs):', JSON.stringify(out['content-dialogs'].pageMeta));
