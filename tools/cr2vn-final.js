'use strict';
/* cr2vn-final.js — 最终数字汇总（只读，输出到 tmpdir 供人工核对） */
const fs = require('fs'), os = require('os'), path = require('path');
const A = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'cr2vn2-after.json'), 'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'cr2vn2-before.json'), 'utf8'));
const AT = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'cr2vn-attrib-after.json'), 'utf8'));
const out = []; const say = s => out.push(s);

/* ---- attrib 3 视口总计 ---- */
const k = { inlineCode: 0, inlineOther: 0, blockBox: 0, oneSide: 0 };
let bordered = 0, rounded = 0, shadowed = 0;
for (const r of AT.results) {
  for (const x of Object.keys(k)) k[x] += r.borderKind[x];
  bordered += r.bordered; rounded += r.rounded; shadowed += r.shadowed;
}
say('## attrib（3 视口 1440/768/390 合计）');
say('- 带边框元素总计 **' + bordered + '**');
say('- 其中 inline code（行内代码）**' + k.inlineCode + '**（' + (100 * k.inlineCode / bordered).toFixed(1) + '%）');
say('- 其中其他行内元素 **' + k.inlineOther + '**（' + (100 * k.inlineOther / bordered).toFixed(1) + '%）');
say('- 其中整块盒面（≥3 边、非行内）**' + k.blockBox + '**（' + (100 * k.blockBox / bordered).toFixed(1) + '%）');
say('- 其中单边（分隔线/左边框）**' + k.oneSide + '**（' + (100 * k.oneSide / bordered).toFixed(1) + '%）');
say('- 圆角元素 **' + rounded + '**，阴影元素 **' + shadowed + '**');
say('');
say('判读：真正"装饰性盒子"= 整块盒面 ' + k.blockBox + '，占带边框元素的 ' + (100 * k.blockBox / bordered).toFixed(1) + '%；其余 ' +
  (100 * (k.inlineCode + k.inlineOther + k.oneSide) / bordered).toFixed(1) + '% 是**语义载体**（行内代码、表格单元格、列表左边框、面包屑链接）。');
say('');

/* ---- 单视口 1440 的干净口径 ---- */
const pick = (ds, vp, pg) => ds.results.find(r => r.vp === vp && r.page === pg && r.ok);
say('## 单视口口径（1440×900，6 页合计）');
say('| 指标 | after | before |');
say('|---|---:|---:|');
let sA = { b: 0, q: 0, c: 0, e: 0 }, sB = { b: 0, q: 0, c: 0, e: 0 };
for (const p of A.pages.map(x => x.name)) {
  const a = pick(A, '1440x900', p), b = pick(B, '1440x900', p);
  if (a) { sA.b += a.deco.bordered; sA.q += a.deco.boxed4; sA.c += a.cards.total; sA.e += a.elTotal; }
  if (b) { sB.b += b.deco.bordered; sB.q += b.deco.boxed4; sB.c += b.cards.total; sB.e += b.elTotal; }
}
say('| 带边框元素 | ' + sA.b + ' | ' + sB.b + ' |');
say('| 四边盒面 | ' + sA.q + ' | ' + sB.q + ' |');
say('| 卡片（盒面且面积≥6000） | ' + sA.c + ' | ' + sB.c + ' |');
say('| 可见元素 | ' + sA.e + ' | ' + sB.e + ' |');
say('');

/* ---- 首页首屏盒面 ---- */
say('## 首页 1440×900 首屏（fold=900px）盒面清单');
const L = pick(A, '1440x900', 'landing');
if (L && L.fold) {
  const items = L.fold.boxedSurfaces.items;
  const byKind = {};
  for (const it of items) { const kk = it.sig; byKind[kk] = (byKind[kk] || 0) + 1; }
  say('盒面元素 **' + items.length + '** 个：' + Object.keys(byKind).map(x => '`' + x + '`×' + byKind[x]).join('，'));
  say('排除侧栏后的内容区盒面 = ' + items.filter(x => x.sig !== 'details.side-sec').length + '（3 entry-card + 3 qa? + 9 stat 中的首屏部分）');
  for (const it of items) if (it.sig !== 'details.side-sec') say('- `' + it.sig + '` ' + it.w + '×' + it.h + ' — ' + (it.text || '').slice(0, 30));
}
say('');
say('## 首页内容区盒面（全页，非仅首屏）');
for (const sel of ['.entry-card', '.qa', '.stat', '.cat-anchorbar a']) {
  const r = L.selectors.find(x => x.sel === sel);
  if (r) say('- `' + sel + '` = ' + r.visible + '（盒面 ' + r.boxed + '）');
}
say('- `.cat-anchorbar` 容器 1 个 + 内部 pill 17 个');
say('');

/* ---- 侧栏常量 ---- */
say('## 侧栏（每页恒定）');
const reg = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'cr2vn-region.json'), 'utf8'));
for (const r of reg.results) {
  say('- ' + r.page + '：可见元素 ' + r.total + '，侧栏 **' + r.regionEl.sidebar + '**（' + (100 * r.regionEl.sidebar / r.total).toFixed(1) + '%），正文 ' + (r.regionEl.content || 0) +
    '，侧栏 pill **' + (r.regionPill.sidebar || 0) + '**，正文 pill ' + (r.regionPill.content || 0));
}
say('');
say('侧栏 pill 构成（1440 landing）：' + reg.results[0].pillsBySel.filter(x => x.k.indexOf('sidebar') === 0).map(x => x.k.split('|')[1] + '×' + x.v).join('，'));
say('');

/* ---- H1 三尺寸 ---- */
say('## H1 尺寸（三种）');
for (const r of reg.results) for (const h of r.h1s) say('- ' + r.page + ' → `' + h.sig + '` **' + h.fs + 'px**/' + h.fw);
say('');

/* ---- 单视口字号种数 ---- */
say('## 每页字号种数（1440 单视口）');
for (const r of reg.results) say('- ' + r.page + ' = **' + r.sizeCount + '** 种');

const md = out.join('\n');
const f = path.join(os.tmpdir(), 'cr2vn-final.md');
fs.writeFileSync(f, md, 'utf8');
console.log(md);
