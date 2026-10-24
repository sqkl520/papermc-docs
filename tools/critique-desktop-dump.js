/* critique-desktop-dump.js — dump desktop-relevant slices of reports/ui-shots/measure.json */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports/ui-shots/measure.json'), 'utf8'));
const out = [];
for (const r of m.results) {
  if (!/^(1440x900|1280x800)$/.test(r.viewport)) continue;
  const M = r.measure;
  const L = M.layout || {};
  out.push({
    vp: r.viewport, page: r.page, name: r.name,
    pageHeight: M.pageHeight,
    topbar: L.topbar, sidebar: L.sidebar, toc: L.toc, article: L.article,
    typo: M.typography,
    codeBlock: M.codeBlock,
    tocDetail: M.toc,
    sidebarDetail: M.sidebar,
    search: M.search,
    interactive: M.interactive,
    a11y: M.a11y,
    tables: M.tables,
    callouts: M.callouts,
    images: M.images && M.images.slice ? M.images.slice(0, 4) : M.images,
    imageCount: M.images && M.images.length,
    raw: M.rawKeys || undefined,
  });
}
fs.writeFileSync(path.join(ROOT, 'reports', '_critique-desktop-dump.json'), JSON.stringify(out, null, 1), 'utf8');
console.log('wrote', out.length, 'entries');
