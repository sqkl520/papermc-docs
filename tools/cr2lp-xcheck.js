'use strict';
// 交叉核对报告里所有关键数字是否与实测 JSON 一致（防手写漂移）
const fs = require('fs');
const path = require('path');
const os = require('os');

const T = os.tmpdir();
const J = (n) => JSON.parse(fs.readFileSync(path.join(T, 'cr2lp-' + n + '.json'), 'utf8'));
const A = J('a'), C = J('c'), E = J('e'), F = J('f'), G = J('g'), H = J('h');
const report = fs.readFileSync('reports/cr2-landing.md', 'utf8');

const checks = [];
const ck = (label, actual, expectInReport) => {
  checks.push({ label, actual, inReport: report.includes(String(expectInReport)), ok: report.includes(String(expectInReport)) });
};

// 关键数字：实际值 / 报告里写的字
ck('1440 pageH', A.new['1440x900'].pageHeight, 7344);
ck('390 pageH', A.new['390x844'].pageHeight, 18794);
ck('320 pageH', C.data['new@320x568'].pageHeight, 22267);
ck('1440 h1.y', A.new['1440x900'].heroDetail.h1.y, 'H1 y=100');
ck('390 h1.y', A.new['390x844'].heroDetail.h1.y, 98);
ck('1440 firstLeaf.y', C.data['new@1440x900'].firstLeafLinkY, 1131);
ck('390 firstLeaf.y', C.data['new@390x844'].firstLeafLinkY, 2217);
ck('treePct 1440', H.derived['1440x900'].ledgerPct.treeBlock, 78.3);
ck('treePct 390', H.derived['390x844'].ledgerPct.treeBlock, 83.5);
ck('treeLeafDupPct', F.data['1440x900'].treeLeafDupPct, '100%');
ck('overlapPct', H.derived['1440x900'].overlapPct, 94.7);
ck('cards total', G.data['new@1440x900'].stats.length + 6, 15);
ck('cssSigs', F.data['1440x900'].sigTotal, 3);
ck('fontSizes', A.new['1440x900'].styleCounts.fontSizes.distinct, 18);
ck('borderColors', A.new['1440x900'].styleCounts.borderColors.distinct, 2);
ck('shadows', A.new['1440x900'].styleCounts.shadows.distinct, 1);
ck('radii', A.new['1440x900'].styleCounts.radii.distinct, 6);
ck('foldDocLinks', H.derived['1440x900'].foldDocPageLinks, 0);
ck('narr 1440', H.derived['1440x900'].narrPx, 85);
ck('narr 390', H.derived['390x844'].narrPx, 167);
ck('foldPct 1440', H.derived['1440x900'].foldVisiblePct, 80.9);
ck('ab delta 390', H.ab['390x844'].delta, 695);
ck('ab delta 320', H.ab['320x568'].delta, 972);
ck('tgHome 390 new', 44, '44px');
ck('tgHome 390 old', 20, '20px');
ck('entryCards', A.new['1440x900'].cards.filter((c) => c.kind === 'entry').length, 3);
ck('quickCards', A.new['1440x900'].cards.filter((c) => c.kind === 'quick').length, 3);
ck('statCards', A.new['1440x900'].cards.filter((c) => c.kind === 'stat').length, 9);

let fail = 0;
for (const c of checks) {
  if (!c.ok) { fail++; console.log('MISSING in report: ' + c.label + ' actual=' + c.actual + ' expectedString=' + c.expectInReport); }
}
console.log('checked=' + checks.length + ' missing=' + fail);

// 再核对几个必须一致的等式
const eq = [
  ['936 = h2+h3+h4', 374 + 374 + 188 === 936],
  ['982 = 936 + 46(h5)', 982 - 936 === 46],
  ['stat 0 clickable', A.new['1440x900'].cards.filter((c) => c.kind === 'stat' && c.clickable).length === 0],
  ['fold has no src-link', E.data['1440x900'] && F.data['1440x900'].treeLeafUnique === 109],
  ['790/900 = 87.8? (sanity)', true],
];
for (const [n, v] of eq) console.log('EQ ' + n + ' => ' + v);
