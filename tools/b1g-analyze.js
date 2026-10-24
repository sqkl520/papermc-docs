'use strict';
/**
 * b1g-analyze.js - turn reports/b1-shots/_diff.json into markdown tables
 * (invariant table + change list). Read-only over the diff json.
 *
 * Usage: node tools/b1g-analyze.js [--in=reports/b1-shots/_diff.json] [--out=reports/b1-shots/_tables.md]
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const IN = opt('in', path.join('reports', 'b1-shots', '_diff.json'));
const OUT = opt('out', path.join('reports', 'b1-shots', '_tables.md'));

const data = JSON.parse(fs.readFileSync(IN, 'utf8'));
const rows = data.rows;

const VPS = ['1440', '1280', '1025', '1024', '768', '390', '320'];
const PAGES = [
  ['/', 'landing'],
  ['/paper/', 'section-paper'],
  ['/paper/dev/dialogs/', 'content-callout-code'],
  ['/paper/reference/world-configuration/', 'reference-longpage'],
  ['/velocity/tuning/', 'content-tuning'],
  ['/all-pages.html', 'index-allpages'],
];

const get = (vp, url, field, side) => {
  const r = rows.find((x) => x.vp === vp && x.page === url && x.field === field);
  return r ? r[side] : undefined;
};
const both = (vp, url, field) => {
  const r = rows.find((x) => x.vp === vp && x.page === url && x.field === field);
  return r ? [r.before, r.after, r.same] : [undefined, undefined, undefined];
};
const fmt = (v) => (v === null ? 'null' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v));

const L = [];
L.push('# b1g tables (generated ' + data.generated_at + ', dark=' + data.dark + ')');
L.push('');

// ---- 1. core invariant table, per viewport, across pages -------------------
// group by viewport: for each field, if all pages identical -> single row, else list
const CORE = ['article.x', 'article.w', 'm.lineW', 'm.capW', 'm.zeroW', 'm.fontSize', 'm.lineHeight',
  'body.fontSize', 'body.lineHeight', 'body.color', 'h1.size', 'h1.mt', 'h2.size', 'h2.mt',
  'code.fontSize', 'code.preLineHeight', 'code.advance', 'code.scrollW',
  'table.w', 'table.clientW', 'img.w', 'img.h', 'pageHeight', 'article.y'];

L.push('## A. per-viewport, per-field (all 6 pages aggregated)');
for (const vp of VPS) {
  L.push('');
  L.push('### ' + vp + 'px');
  L.push('');
  L.push('| field | distinct before | distinct after | changed pages |');
  L.push('|---|---|---|---|');
  for (const f of CORE) {
    const bs = new Set();
    const as = new Set();
    let changed = 0;
    for (const [url] of PAGES) {
      const [b, a, same] = both(vp, url, f);
      if (b === undefined && a === undefined) continue;
      bs.add(fmt(b));
      as.add(fmt(a));
      if (!same) changed++;
    }
    if (!bs.size && !as.size) continue;
    L.push('| ' + f + ' | ' + [...bs].join(' / ') + ' | ' + [...as].join(' / ') + ' | ' + (changed ? changed + '/6' : '-') + ' |');
  }
}

// ---- 2. per-page detail for viewports of interest -------------------------
L.push('');
L.push('## B. per-page detail');
for (const vp of VPS) {
  for (const [url, name] of PAGES) {
    const diffs = rows.filter((r) => r.vp === vp && r.page === url && !r.same);
    if (!diffs.length) continue;
    L.push('');
    L.push('### ' + vp + 'px ' + name + ' (`' + url + '`) — ' + diffs.length + ' changed fields');
    L.push('');
    L.push('| field | before | after | delta |');
    L.push('|---|---|---|---|');
    for (const d of diffs) L.push('| ' + d.field + ' | ' + fmt(d.before) + ' | ' + fmt(d.after) + ' | ' + (d.delta === null ? '—' : fmt(d.delta)) + ' |');
  }
}

// ---- 3. code strut evidence ----------------------------------------------
L.push('');
L.push('## C. code-block strut evidence (after build)');
L.push('');
L.push('| vp | page | pre line-height | code font-size | advance | advance/font | preFS | scrollW/clientW |');
L.push('|---|---|---|---|---|---|---|---|');
for (const vp of VPS) {
  for (const [url, name] of PAGES) {
    const lh = get(vp, url, 'code.preLineHeight', 'after');
    if (lh === undefined) continue;
    L.push('| ' + vp + ' | ' + name + ' | ' + fmt(lh) + ' | ' + fmt(get(vp, url, 'code.fontSize', 'after')) + ' | ' +
      fmt(get(vp, url, 'code.advance', 'after')) + ' | ' + fmt(get(vp, url, 'code.advanceRatio', 'after')) + ' | ' +
      fmt(get(vp, url, 'code.preFontSize', 'after')) + ' | ' + fmt(get(vp, url, 'code.scrollW', 'after')) + '/' + fmt(get(vp, url, 'code.clientW', 'after')) + ' |');
  }
}

// ---- 4. all fields that changed, by field, with viewport coverage --------
L.push('');
L.push('## D. changed-field index');
L.push('');
const byField = {};
for (const r of rows) {
  if (r.same) continue;
  if (!byField[r.field]) byField[r.field] = { vps: new Set(), pages: new Set(), maxDelta: 0, sample: null };
  byField[r.field].vps.add(r.vp);
  byField[r.field].pages.add(r.pageName);
  if (r.delta !== null) byField[r.field].maxDelta = Math.max(byField[r.field].maxDelta, Math.abs(r.delta));
  if (!byField[r.field].sample) byField[r.field].sample = r;
}
L.push('| field | vps | pages | max |delta| | sample before→after |');
L.push('|---|---|---|---|---|');
for (const [f, v] of Object.entries(byField).sort((a, b) => b[1].vps.size - a[1].vps.size)) {
  L.push('| ' + f + ' | ' + [...v.vps].join(',') + ' | ' + v.pages.size + '/6 | ' + fmt(v.maxDelta) + ' | ' +
    fmt(v.sample.before) + ' → ' + fmt(v.sample.after) + ' (' + v.sample.vp + ' ' + v.sample.pageName + ') |');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('wrote ' + OUT + ' (' + L.length + ' lines)');
