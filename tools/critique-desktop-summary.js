/* critique-desktop-summary.js — compact tabular summary of desktop measure.json slices */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports/ui-shots/measure.json'), 'utf8'));
const rows = [];
for (const r of m.results) {
  if (!/^(1440x900|1280x800)$/.test(r.viewport)) continue;
  const M = r.measure, L = M.layout || {}, T = M.typography || {}, CB = M.codeBlock, TOC = M.toc, SB = M.sidebar, A = M.a11y || {}, I = M.interactive || {};
  rows.push([
    r.viewport, r.page,
    'H=' + M.pageHeight,
    'top=' + (L.topbar ? L.topbar.w + 'x' + L.topbar.h : '-'),
    'side=' + (L.sidebar ? L.sidebar.w + 'x' + L.sidebar.h + '@' + L.sidebar.x : '-'),
    'toc=' + (L.toc ? L.toc.w + 'x' + L.toc.h + '@' + L.toc.x : 'none'),
    'art=' + (L.article ? L.article.w + 'x' + L.article.h + '@' + L.article.x : '-'),
    'body=' + T.bodyFontSize + '/' + T.bodyLineHeight,
    'ch=' + T.measureCh, 'maxW=' + T.maxWidth,
    'h1=' + (T.h1 ? T.h1.size + ':' + T.h1.weight : '-'),
    'h2=' + (T.h2 ? T.h2.size + ':mt' + T.h2.marginTop + ':mb' + T.h2.marginBottom : '-'),
    'pMB=' + T.pMarginBottom,
    'code=' + (CB ? JSON.stringify(CB) : '-'),
    'tocN=' + (TOC ? (TOC.count || TOC.items || JSON.stringify(TOC).slice(0, 200)) : '-'),
    'sblinks=' + (SB ? SB.links + '/g' + SB.groups + '/f' + SB.hasFilter : '-'),
    'sticks=' + JSON.stringify({ sb: SB && SB.sticky, toc: TOC && TOC.sticky }),
    'a11y=' + JSON.stringify({ h1c: A.h1Count, noAlt: A.imgsWithoutAlt, lmk: A.landmarks, skip: A.skipLink, cur: A.ariaCurrent, focus: A.focusables }),
    'inter=' + JSON.stringify(I),
  ].join(' | '));
}
fs.writeFileSync(path.join(ROOT, 'reports', '_critique-desktop-summary.txt'), rows.join('\n\n'), 'utf8');
console.log(rows.join('\n\n'));
