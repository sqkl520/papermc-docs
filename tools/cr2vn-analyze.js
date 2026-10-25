'use strict';
/*
 * cr2vn-analyze.js — 对 census2 输出做聚合与交叉表（只读，不写仓库）
 *
 * 用法：node tools/cr2vn-analyze.js --after <json> [--before <json>] [--md <outfile>]
 * 说明：md 只用于生成中间产物到 os.tmpdir()，最终报告由人手写。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const AFTER = argOf('--after', path.join(os.tmpdir(), 'cr2vn2-after.json'));
const BEFORE = argOf('--before', path.join(os.tmpdir(), 'cr2vn2-before.json'));
const MD = argOf('--md', path.join(os.tmpdir(), 'cr2vn-analysis.md'));

const VP3 = ['1440x900', '768x1024', '390x844'];

const A = JSON.parse(fs.readFileSync(AFTER, 'utf8'));
const B = fs.existsSync(BEFORE) ? JSON.parse(fs.readFileSync(BEFORE, 'utf8')) : null;

function pick(ds, vp, page) {
  return ds.results.find(r => r.vp === vp && r.page === page && r.ok);
}
const PAGES = A.pages.map(p => p.name);

const out = [];
const say = s => { out.push(s); };

function unionSizes(ds, vps, pages) {
  const m = Object.create(null);
  for (const vp of vps) for (const pg of pages) {
    const r = pick(ds, vp, pg); if (!r) continue;
    for (const f of r.fontSizes) {
      if (!m[f.size]) m[f.size] = { n: 0, pages: Object.create(null), region: Object.create(null), sigs: Object.create(null), weights: Object.create(null) };
      m[f.size].n += f.n;
      m[f.size].pages[pg] = (m[f.size].pages[pg] || 0) + f.n;
      for (const k of Object.keys(f.region)) m[f.size].region[k] = (m[f.size].region[k] || 0) + f.region[k];
      for (const k of Object.keys(f.weights)) m[f.size].weights[k] = (m[f.size].weights[k] || 0) + f.weights[k];
      for (const s of f.sigs) m[f.size].sigs[s.k] = (m[f.size].sigs[s.k] || 0) + s.v;
    }
  }
  return m;
}

function unionColors(ds, vps, pages) {
  const c = { fg: Object.create(null), bg: Object.create(null), bdE: Object.create(null) };
  for (const vp of vps) for (const pg of pages) {
    const r = pick(ds, vp, pg); if (!r) continue;
    for (const k of Object.keys(r.colors.fg)) c.fg[k] = (c.fg[k] || 0) + r.colors.fg[k];
    for (const k of Object.keys(r.colors.bg)) c.bg[k] = (c.bg[k] || 0) + r.colors.bg[k];
    for (const k of Object.keys(r.colors.borderByElement)) c.bdE[k] = (c.bdE[k] || 0) + r.colors.borderByElement[k];
  }
  return c;
}

function sumField(ds, vps, pages, fn) {
  let t = 0;
  for (const vp of vps) for (const pg of pages) { const r = pick(ds, vp, pg); if (r) t += fn(r) || 0; }
  return t;
}

const topN = (o, n) => Object.keys(o).sort((a, b) => o[b] - o[a]).slice(0, n).map(k => [k, o[k]]);

/* ================= 1. 字号 ================= */
const fsAfter = unionSizes(A, VP3, PAGES);
const fsBefore = B ? unionSizes(B, VP3, PAGES) : null;
const sizesA = Object.keys(fsAfter).map(Number).sort((a, b) => b - a);

say('## 1. font-size 全表（union over 6 页 × 3 视口 1440/768/390）');
say('');
say('| px | 出现次数 | 视口/分区 | 主要标签 | 主要 class |');
say('|---:|---:|---|---|---|');
for (const s of sizesA) {
  const f = fsAfter[s];
  const reg = topN(f.region, 3).map(x => x[0] + ':' + x[1]).join(' ');
  const tg = topN(f.sigs, 3).map(x => x[0]).join(', ');
  say('| ' + s + ' | ' + f.n + ' | ' + reg + ' | | ' + tg + ' |');
}
say('');
say('去重字号种数（after, 3 视口并集）= **' + sizesA.length + '**');
if (fsBefore) say('去重字号种数（before, 3 视口并集）= **' + Object.keys(fsBefore).length + '**');

// 每视口单页最多
let maxPer = { n: 0 };
for (const vp of VP3) for (const pg of PAGES) {
  const r = pick(A, vp, pg); if (!r) continue;
  if (r.fontSizes.length > maxPer.n) maxPer = { n: r.fontSizes.length, vp: vp, pg: pg };
}
say('单页单视口最多字号种数 = **' + maxPer.n + '**（' + maxPer.pg + ' @ ' + maxPer.vp + '）');

/* 分档：正文档 / 小字档 / 大字档 */
function band(s) { return s >= 20 ? 'display(>=20)' : s >= 15 ? 'body(15-19.9)' : s >= 12.5 ? 'small(12.5-14.9)' : 'micro(<12.5)'; }
const bands = Object.create(null);
for (const s of sizesA) { const b = band(s); bands[b] = (bands[b] || 0) + 1; }
say('分档种数：' + Object.keys(bands).map(k => k + '=' + bands[k]).join('  '));

/* ================= 2. 颜色 ================= */
const colA = unionColors(A, VP3, PAGES);
const colB = B ? unionColors(B, VP3, PAGES) : null;
say('');
say('## 2. 颜色全表（union）');
say('');
say('### color（文字前景）— ' + Object.keys(colA.fg).length + ' 个去重值');
say('| 值 | 次数 |');
say('|---|---:|');
for (const [k, v] of topN(colA.fg, 40)) say('| `' + k + '` | ' + v + ' |');
say('');
say('### background-color（不透明）— ' + Object.keys(colA.bg).length + ' 个去重值');
say('| 值 | 次数 |');
say('|---|---:|');
for (const [k, v] of topN(colA.bg, 40)) say('| `' + k + '` | ' + v + ' |');
say('');
say('### border-color（按元素首边）— ' + Object.keys(colA.bdE).length + ' 个去重值');
say('| 值 | 次数 |');
say('|---|---:|');
for (const [k, v] of topN(colA.bdE, 40)) say('| `' + k + '` | ' + v + ' |');
say('');
const allCol = new Set([...Object.keys(colA.fg), ...Object.keys(colA.bg), ...Object.keys(colA.bdE)]);
say('三通道并集去重颜色值 = **' + allCol.size + '**');
if (colB) {
  const allB = new Set([...Object.keys(colB.fg), ...Object.keys(colB.bg), ...Object.keys(colB.bdE)]);
  say('before 三通道并集 = **' + allB.size + '**');
}

/* ================= 3. 边框/圆角/阴影 ================= */
say('');
say('## 3. 边框 / 圆角 / 阴影');
say('');
const decoA = {
  bordered: sumField(A, VP3, PAGES, r => r.deco.bordered),
  boxed4: sumField(A, VP3, PAGES, r => r.deco.boxed4),
  rounded: sumField(A, VP3, PAGES, r => r.deco.rounded),
  shadowed: sumField(A, VP3, PAGES, r => r.deco.shadowed),
  gradient: sumField(A, VP3, PAGES, r => r.deco.gradient),
  bgOpaque: sumField(A, VP3, PAGES, r => r.deco.bgOpaque),
  el: sumField(A, VP3, PAGES, r => r.elTotal)
};
const decoB = B ? {
  bordered: sumField(B, VP3, PAGES, r => r.deco.bordered),
  boxed4: sumField(B, VP3, PAGES, r => r.deco.boxed4),
  rounded: sumField(B, VP3, PAGES, r => r.deco.rounded),
  shadowed: sumField(B, VP3, PAGES, r => r.deco.shadowed),
  gradient: sumField(B, VP3, PAGES, r => r.deco.gradient),
  bgOpaque: sumField(B, VP3, PAGES, r => r.deco.bgOpaque),
  el: sumField(B, VP3, PAGES, r => r.elTotal)
} : null;
say('| 指标 | after | before |');
say('|---|---:|---:|');
for (const k of Object.keys(decoA)) say('| ' + k + ' | ' + decoA[k] + ' | ' + (decoB ? decoB[k] : '-') + ' |');
say('');
say('带边框元素占全部可见元素比例（after）= ' + (100 * decoA.bordered / decoA.el).toFixed(1) + '%');

const radA = Object.create(null);
for (const vp of VP3) for (const pg of PAGES) { const r = pick(A, vp, pg); if (!r) continue; for (const k of Object.keys(r.deco.radius)) radA[k] = (radA[k] || 0) + r.deco.radius[k]; }
say('');
say('### border-radius 去重值（after）');
say('| radius | 元素数 |');
say('|---|---:|');
for (const [k, v] of topN(radA, 20)) say('| ' + k + 'px | ' + v + ' |');
say('去重圆角值 = **' + Object.keys(radA).length + '**');

/* ================= 4. 卡片 ================= */
say('');
say('## 4. 卡片（boxed surface）清单');
say('');
function cardUnion(ds) {
  const g = Object.create(null);
  for (const vp of VP3) for (const pg of PAGES) {
    const r = pick(ds, vp, pg); if (!r) continue;
    for (const c of r.cards.groups) {
      if (!g[c.sig]) g[c.sig] = { n: 0, pages: Object.create(null), region: Object.create(null), heights: [], sample: '', areaSum: 0 };
      g[c.sig].n += c.n;
      g[c.sig].pages[pg] = (g[c.sig].pages[pg] || 0) + c.n;
      for (const k of Object.keys(c.region)) g[c.sig].region[k] = (g[c.sig].region[k] || 0) + c.region[k];
      if (!g[c.sig].sample) g[c.sig].sample = c.sample;
      g[c.sig].areaSum += c.areaSum;
    }
  }
  return g;
}
const cgA = cardUnion(A);
const cgB = B ? cardUnion(B) : null;
say('### after');
say('| 选择器 | 次数 | 命中页 | 区域 | 样本 |');
say('|---|---:|---|---|---|');
for (const [k, v] of Object.entries(cgA).sort((a, b) => b[1].n - a[1].n)) {
  say('| `' + k + '` | ' + v.n + ' | ' + Object.keys(v.pages).join(',') + ' | ' + Object.keys(v.region).join(',') + ' | ' + (v.sample || '').slice(0, 34) + ' |');
}
say('');
say('卡片总数（after, sum over pages×3vp）= **' + Object.values(cgA).reduce((a, b) => a + b.n, 0) + '**');
if (cgB) say('卡片总数（before）= **' + Object.values(cgB).reduce((a, b) => a + b.n, 0) + '**');

/* ================= 5. 选择器硬计数 ================= */
say('');
say('## 5. 关键选择器硬计数（after：1440x900 单视口，DOM 全量）');
say('');
const l1440 = pick(A, '1440x900', 'landing');
const d1440 = pick(A, '1440x900', 'content-callout-code');
const w1440 = pick(A, '1440x900', 'reference-longpage');
const a1440 = pick(A, '1440x900', 'index-allpages');
const s1440 = pick(A, '1440x900', 'section-paper');
say('| 选择器 | landing | paper/ | dialogs | worldcfg | allpages |');
say('|---|---:|---:|---:|---:|---:|');
const selList = (l1440 ? l1440.selectors : []).map(x => x.sel);
for (const sel of selList) {
  const g = ds => { const r = ds ? ds.selectors.find(x => x.sel === sel) : null; return r ? r.visible : 0; };
  say('| `' + sel + '` | ' + g(l1440) + ' | ' + g(s1440) + ' | ' + g(d1440) + ' | ' + g(w1440) + ' | ' + g(a1440) + ' |');
}

/* ================= 6. 间距 ================= */
say('');
say('## 6. 区块间距（margin，正文区）');
say('');
for (const pg of ['content-callout-code', 'reference-longpage', 'content-tuning', 'landing']) {
  const r = pick(A, '1440x900', pg); if (!r) continue;
  say('### ' + pg);
  const mb = Object.keys(r.spacing.mb).map(k => [parseFloat(k.split('|')[0]), k]).sort((a, b) => b[0] - a[0]);
  say('| margin-bottom px | 父>子 | 次数 |');
  say('|---|---|---:|');
  for (const [v, k] of mb) say('| ' + v + ' | `' + k.split('|')[1] + '` | ' + r.spacing.mb[k] + ' |');
  const distinct = new Set(Object.keys(r.spacing.mb).map(k => k.split('|')[0]));
  say('去重 margin-bottom 值 = **' + distinct.size + '** → ' + Array.from(distinct).map(Number).sort((a, b) => b - a).join(', '));
  say('');
}

/* ================= 7. fold ================= */
say('');
say('## 7. 首页 fold 视觉重量（landing @1440x900）');
say('');
const lf = pick(A, '1440x900', 'landing');
if (lf && lf.fold) {
  say('H1：`' + lf.fold.h1.sig + '` ' + lf.fold.h1.fs + 'px/' + lf.fold.h1.fw + ' 重量=' + lf.fold.h1.mass + ' ' + JSON.stringify(lf.fold.h1.parts));
  say('fold 内计入元素 = ' + lf.fold.itemsTotal + '；≥85% H1 = **' + lf.fold.nearH1_85 + '**；≥70% H1 = **' + lf.fold.nearH1_70 + '**');
  say('fold 内「盒面」元素（≥3边+圆角≥8+底色+面积≥6000）= **' + lf.fold.boxedSurfaces.n + '**');
  say('fold 内 ≥0.9×H1 字号的文字元素 = **' + lf.fold.bigType.n + '**');
  say('');
  say('| # | 质量 | type | surf | chrome | sig | 文本 | y | h | bg | bd | r |');
  say('|---:|---:|---:|---:|---:|---|---|---:|---:|---|---:|---:|');
  lf.fold.items.slice(0, 24).forEach((it, i) => {
    say('| ' + (i + 1) + ' | ' + it.mass + ' | ' + it.parts.type + ' | ' + it.parts.surface + ' | ' + it.parts.chrome + ' | `' + it.sig + '` | ' + (it.text || '').slice(0, 26) + ' | ' + it.y + ' | ' + it.h + ' | ' + (it.bg || '-') + ' | ' + it.sides + ' | ' + it.radius + ' |');
  });
  say('');
  say('### fold 内盒面元素明细');
  for (const it of lf.fold.boxedSurfaces.items) say('- `' + it.sig + '` ' + it.w + 'x' + it.h + ' — ' + (it.text || '').slice(0, 40));
}

/* ================= 8. 元信息带 ================= */
say('');
say('## 8. 内容页顶部元信息带（/paper/dev/dialogs/）');
say('');
for (const vp of ['1440x900', '390x844']) {
  const r = pick(A, vp, 'content-callout-code');
  if (!r || !r.metaBand) continue;
  const m = r.metaBand;
  say('### ' + vp);
  say('H1「' + m.h1.text + '」底边 y=' + m.h1.bottom + '；首个 H2 top=' + m.firstH2Top + '；带宽=' + m.bandHeight + 'px');
  say('chip/pill 总数 = **' + m.chipCount + '**（其中带底色/边框的"盒面 pill" = **' + m.chipBoxCount + '**）；带内链接 = ' + m.linkCount + '；chip 高度合计 = ' + m.chipSumHeight + 'px');
  say('');
  say('| sig | 文本 | top | h | w | bg | bd | r | fs |');
  say('|---|---|---:|---:|---:|---|---|---:|---:|');
  for (const c of m.chips) say('| `' + c.sig + '` | ' + (c.text || '').slice(0, 22) + ' | ' + c.top + ' | ' + c.h + ' | ' + c.w + ' | ' + (c.bg ? 'Y' : '-') + ' | ' + (c.bd ? 'Y' : '-') + ' | ' + c.radius + ' | ' + c.fontSize + ' |');
  say('');
}

/* ================= 9. 前后对比 ================= */
if (B) {
  say('');
  say('## 9. 改前 vs 改后（同脚本、同页面、同 3 视口）');
  say('');
  const rows = [];
  rows.push(['字号种数（并集）', Object.keys(fsBefore).length, sizesA.length]);
  rows.push(['单页最多字号种数', (() => { let mx = 0; for (const vp of VP3) for (const pg of PAGES) { const r = pick(B, vp, pg); if (r) mx = Math.max(mx, r.fontSizes.length); } return mx; })(), maxPer.n]);
  const allB = new Set([...Object.keys(colB.fg), ...Object.keys(colB.bg), ...Object.keys(colB.bdE)]);
  rows.push(['颜色去重值（三通道并集）', allB.size, allCol.size]);
  rows.push(['color 去重', Object.keys(colB.fg).length, Object.keys(colA.fg).length]);
  rows.push(['background 去重', Object.keys(colB.bg).length, Object.keys(colA.bg).length]);
  rows.push(['border-color 去重', Object.keys(colB.bdE).length, Object.keys(colA.bdE).length]);
  rows.push(['带边框元素数（6页×3vp）', decoB.bordered, decoA.bordered]);
  rows.push(['四边盒面元素数', decoB.boxed4, decoA.boxed4]);
  rows.push(['圆角元素数', decoB.rounded, decoA.rounded]);
  rows.push(['阴影元素数', decoB.shadowed, decoA.shadowed]);
  rows.push(['卡片总数', Object.values(cgB).reduce((a, b) => a + b.n, 0), Object.values(cgA).reduce((a, b) => a + b.n, 0)]);
  rows.push(['可见元素总数', decoB.el, decoA.el]);
  say('| 指标 | before(a19a6c2) | after(d0fcb30) | Δ |');
  say('|---|---:|---:|---:|');
  for (const [k, b, a] of rows) say('| ' + k + ' | ' + b + ' | ' + a + ' | ' + (a - b >= 0 ? '+' : '') + (a - b) + ' |');

  say('');
  say('### 逐页字号种数 before → after');
  say('| 视口 | 页面 | before | after | Δ |');
  say('|---|---|---:|---:|---:|');
  for (const vp of VP3) for (const pg of PAGES) {
    const rb = pick(B, vp, pg), ra = pick(A, vp, pg);
    if (!rb || !ra) continue;
    const d = ra.fontSizes.length - rb.fontSizes.length;
    if (d !== 0) say('| ' + vp + ' | ' + pg + ' | ' + rb.fontSizes.length + ' | ' + ra.fontSizes.length + ' | ' + (d > 0 ? '+' : '') + d + ' |');
  }
  say('');
  say('### 逐页带边框元素 before → after');
  say('| 视口 | 页面 | before | after | Δ |');
  say('|---|---|---:|---:|---:|');
  for (const vp of VP3) for (const pg of PAGES) {
    const rb = pick(B, vp, pg), ra = pick(A, vp, pg);
    if (!rb || !ra) continue;
    const d = ra.deco.bordered - rb.deco.bordered;
    if (d !== 0) say('| ' + vp + ' | ' + pg + ' | ' + rb.deco.bordered + ' | ' + ra.deco.bordered + ' | ' + (d > 0 ? '+' : '') + d + ' |');
  }

  say('');
  say('### 新增字号（after 有 / before 无）');
  for (const s of sizesA) if (!fsBefore[s]) say('- **' + s + 'px** ×' + fsAfter[s].n + ' — ' + topN(fsAfter[s].sigs, 3).map(x => x[0]).join(', '));
  say('');
  say('### 消失字号（before 有 / after 无）');
  for (const s of Object.keys(fsBefore).map(Number).sort((a, b) => b - a)) if (!fsAfter[s]) say('- **' + s + 'px** ×' + fsBefore[s].n + ' — ' + topN(fsBefore[s].sigs, 3).map(x => x[0]).join(', '));
}

const md = out.join('\n');
fs.writeFileSync(MD, md, 'utf8');
console.log('WROTE ' + MD + '  (' + md.length + ' chars, ' + out.length + ' lines)');
