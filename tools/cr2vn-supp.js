'use strict';
/*
 * cr2vn-supp.js — 补充交叉分析（只读）
 *  1) 卡片/边框 逐页 before vs after（避免把"某一页的结构性改动"误当成全站回归）
 *  2) 字号聚类：多少种字号是"真的独立台阶"，多少是 em 复合产生的近重复值
 *  3) 圆角按区域分布
 *  4) 间距节奏（每条内容流实际渲染出的相邻间距）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const A = JSON.parse(fs.readFileSync(argOf('--after', path.join(os.tmpdir(), 'cr2vn2-after.json')), 'utf8'));
const B = JSON.parse(fs.readFileSync(argOf('--before', path.join(os.tmpdir(), 'cr2vn2-before.json')), 'utf8'));
const VP3 = ['1440x900', '768x1024', '390x844'];
const PAGES = A.pages.map(p => p.name);
const pick = (ds, vp, pg) => ds.results.find(r => r.vp === vp && r.page === pg && r.ok);
const out = []; const say = s => out.push(s);

/* ---------- 1. 逐页卡片 ---------- */
say('## A. 逐页卡片数 / 盒面数（before → after）');
say('');
say('| 视口 | 页面 | 卡片 before | 卡片 after | Δ | 四边盒 after | 边框元素 before | 边框元素 after |');
say('|---|---|---:|---:|---:|---:|---:|---:|');
for (const vp of VP3) for (const pg of PAGES) {
  const b = pick(B, vp, pg), a = pick(A, vp, pg);
  if (!a) continue;
  const bc = b ? b.cards.total : 0, ac = a.cards.total;
  say('| ' + vp + ' | ' + pg + ' | ' + (b ? bc : '-') + ' | ' + ac + ' | ' + (b ? (ac - bc >= 0 ? '+' : '') + (ac - bc) : '-') + ' | ' + a.deco.boxed4 + ' | ' + (b ? b.deco.bordered : '-') + ' | ' + a.deco.bordered + ' |');
}
say('');
say('### index-allpages 单独看（卡片化改动集中在它）');
for (const vp of VP3) {
  const b = pick(B, vp, 'index-allpages'), a = pick(A, vp, 'index-allpages');
  if (!b || !a) continue;
  say('- ' + vp + '：卡片 ' + b.cards.total + ' → ' + a.cards.total + '；边框元素 ' + b.deco.bordered + ' → ' + a.deco.bordered + '；四边盒 ' + b.deco.boxed4 + ' → ' + a.deco.boxed4);
}

/* ---------- 2. 字号聚类 ---------- */
function unionSizes(ds) {
  const m = Object.create(null);
  for (const vp of VP3) for (const pg of PAGES) {
    const r = pick(ds, vp, pg); if (!r) continue;
    for (const f of r.fontSizes) m[f.size] = (m[f.size] || 0) + f.n;
  }
  return m;
}
const fsA = unionSizes(A), fsB = unionSizes(B);
const sizes = Object.keys(fsA).map(Number).sort((a, b) => a - b);

say('');
say('## B. 字号：独立台阶 vs em 复合噪声');
say('');
// 聚类：相邻差值 <1.0px 归入同簇
const clusters = [];
for (const s of sizes) {
  const last = clusters[clusters.length - 1];
  if (last && s - last.max < 1.0) { last.members.push(s); last.max = s; }
  else clusters.push({ min: s, max: s, members: [s] });
}
say('原始去重种数 = **' + sizes.length + '**');
say('按「相邻差 <1px 归为一簇」合并后 = **' + clusters.length + ' 簇**');
say('');
say('| 簇 | 成员 px | 成员数 | 该簇总出现次数 | 判定 |');
say('|---|---|---:|---:|---|');
for (const c of clusters) {
  const tot = c.members.reduce((a, s) => a + fsA[s], 0);
  say('| ' + c.min.toFixed(2) + '–' + c.max.toFixed(2) + ' | ' + c.members.map(x => x).join(', ') + ' | ' + c.members.length + ' | ' + tot + ' | ' + (c.members.length >= 3 ? '**近重复堆**' : c.members.length === 2 ? '近重复对' : '单值') + ' |');
}
say('');
say('出现次数 ≥100 的字号（真正承载版面的）：');
const heavy = sizes.filter(s => fsA[s] >= 100).sort((a, b) => fsA[b] - fsA[a]);
for (const s of heavy) say('- ' + s + 'px ×' + fsA[s]);
say('→ ≥100 次的字号只占 **' + heavy.length + '** 种，其余 ' + (sizes.length - heavy.length) + ' 种均为低频/一次性字号');
say('');
say('出现次数 < 20 的"一次性字号"：');
const once = sizes.filter(s => fsA[s] < 20).sort((a, b) => a - b);
say('- ' + once.map(s => s + 'px×' + fsA[s]).join('，'));

/* 小数来源归因 */
say('');
say('### 非整数（em 复合）字号 vs 整数字号');
const nonInt = sizes.filter(s => Math.abs(s - Math.round(s)) > 0.001);
const ints = sizes.filter(s => Math.abs(s - Math.round(s)) <= 0.001);
say('- 非整数字号：**' + nonInt.length + '** 种 → ' + nonInt.join(', '));
say('- 整数字号：**' + ints.length + '** 种 → ' + ints.join(', '));
say('说明：非整数值来自 `em` 百分比复合（如 `.toc-side .lvl-4{font-size:.95em}` 叠加在 13.76 上得 13.07；`kbd{font-size:.75em}` 叠加得 9.84）。');

/* ---------- 3. 圆角按区域 ---------- */
say('');
say('## C. 圆角值使用分布（after，6页×3视口）');
const radByRegion = Object.create(null);
for (const vp of VP3) for (const pg of PAGES) {
  const r = pick(A, vp, pg); if (!r) continue;
  for (const k of Object.keys(r.deco.radius)) radByRegion['all'] = (radByRegion['all'] || 0) + r.deco.radius[k];
}
const radSorted = Object.keys(radByRegion).length ? null : null;

/* ---------- 4. 圆角/边框：按选择器看"哪些盒子在抢" ---------- */
say('');
say('## D. 正文页「盒面」构成（/paper/dev/dialogs/ @1440x900）');
const d = pick(A, '1440x900', 'content-callout-code');
if (d) {
  say('| 卡片选择器 | 个数 | 区域 | 样本 |');
  say('|---|---:|---|---|');
  for (const g of d.cards.groups) say('| `' + g.sig + '` | ' + g.n + ' | ' + Object.keys(g.region).join(',') + ' | ' + (g.sample || '').slice(0, 40) + ' |');
  say('');
  say('该页可见元素 ' + d.elTotal + '，其中带边框 ' + d.deco.bordered + '（' + (100 * d.deco.bordered / d.elTotal).toFixed(1) + '%），四边盒 ' + d.deco.boxed4 + '，圆角 ' + d.deco.rounded);
}
say('');
say('### world-configuration @1440x900（长参考页）');
const w = pick(A, '1440x900', 'reference-longpage');
if (w) {
  say('可见元素 ' + w.elTotal + '，带边框 ' + w.deco.bordered + '（' + (100 * w.deco.bordered / w.elTotal).toFixed(1) + '%），四边盒 ' + w.deco.boxed4);
  say('边框元素中 4 边盒占比 = ' + (100 * w.deco.boxed4 / Math.max(1, w.deco.bordered)).toFixed(1) + '%');
  say('');
  say('| 卡片选择器 | 个数 |');
  say('|---|---:|');
  for (const g of w.cards.groups) say('| `' + g.sig + '` | ' + g.n + ' |');
}

const md = out.join('\n');
const f = path.join(os.tmpdir(), 'cr2vn-supp.md');
fs.writeFileSync(f, md, 'utf8');
console.log(md);
console.log('\nWROTE ' + f);
