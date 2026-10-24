'use strict';
/**
 * b1g-raw.js - print selected raw measurements from _diff.json for eyeballing.
 * Usage: node tools/b1g-raw.js [file]
 */
const fs = require('fs');
const path = require('path');
const file = process.argv[2] || path.join('reports', 'b1-shots', '_diff.json');
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = d.rows;

const pick = (vp, url, fields) => {
  const o = {};
  for (const f of fields) {
    const r = rows.find((x) => x.vp === vp && x.page === url && x.field === f);
    o[f] = r ? [r.before, r.after] : null;
  }
  return o;
};

const URLS = ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html'];
const F1 = ['article.x', 'article.w', 'article.y', 'content.padL', 'content.padR', 'content.maxW', 'docScrollW', 'pageHeight'];
const F2 = ['code.preFontSize', 'code.preLineHeight', 'code.fontSize', 'code.lineHeight', 'code.advance', 'code.advanceRatio', 'code.scrollW', 'code.clientW'];
const F3 = ['m.lineW', 'm.capW', 'm.zeroW', 'm.sh', 'm.advance', 'm.fontSize', 'm.lineHeight'];

console.log('== layout / padding ==');
for (const vp of ['1440', '1280', '1025', '1024', '768', '390', '320']) {
  for (const u of URLS) console.log(vp.padEnd(5) + u.padEnd(40) + JSON.stringify(pick(vp, u, F1)));
}
console.log('\n== code block ==');
for (const vp of ['1440', '1025', '390']) {
  for (const u of URLS) {
    const p = pick(vp, u, F2);
    if (p['code.fontSize']) console.log(vp.padEnd(5) + u.padEnd(40) + JSON.stringify(p));
  }
}
console.log('\n== measure ==');
for (const vp of ['1440', '1280', '1025', '1024', '768', '390', '320']) {
  for (const u of URLS) {
    const p = pick(vp, u, F3);
    if (p['m.fontSize']) console.log(vp.padEnd(5) + u.padEnd(40) + JSON.stringify(p));
  }
}
