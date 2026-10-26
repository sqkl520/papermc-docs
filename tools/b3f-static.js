'use strict';
/**
 * b3f-static.js — 死规则的第二条独立证据链（纯静态，不启浏览器）。
 *
 * 为什么需要两条链：浏览器链（b3f-dead.js）证明的是「当前已构建的 177 页里 0 命中」；
 * 静态链额外回答一个浏览器链答不了的问题：**这个类是不是由 build-dev 的某个代码路径在
 * 未触发的条件下会产出**（例如 .cfg-raw 只对「叶子没有子节点」的分支产出）。
 * 二者结论不一致时 → **不删**（3a 是纯减法，宁可少删一条，不可删错一条）。
 *
 * 检查项：
 *   A. 全站已构建 HTML 里该 class / 标签的原始出现次数（含属性值内）
 *   B. tools/site/layout.js 与 tools/build-site.js 里是否有 `class="..."` 字面量产出它
 *   C. tools/site/assets.js 的 SITE_JS 里是否有 innerHTML 产出它
 *
 * 用法：node tools/b3f-static.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIR = /[\\/](archive|node_modules|_pre-mobile|_shadow)[\\/]/;

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (SKIP_DIR.test(full)) continue;
    if (e.isDirectory()) walk(full, acc);
    else if (e.isFile() && e.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}
const htmlFiles = walk(ROOT, []).sort();

const GEN = ['tools/site/layout.js', 'tools/build-site.js'].map((p) => ({
  p, src: fs.readFileSync(path.join(ROOT, p), 'utf8'),
}));
const assetsSrc = fs.readFileSync(path.join(ROOT, 'tools/site/assets.js'), 'utf8');
const SITE_JS = assetsSrc.slice(assetsSrc.indexOf('const SITE_JS'));

const countIn = (src, needle) => src.split(needle).length - 1;

/* 候选：浏览器链判定 0 命中的 13 条 + 规划里点名但我也要复核的若干条 */
const CANDIDATES = [
  { sel: '.article h6', marker: '<h6', kind: 'tag', note: 'h6 标签' },
  { sel: '.task-card .kicker', marker: 'task-card', kind: 'cls', note: 'te 卡片族' },
  { sel: '.task-card .t', marker: 'task-card', kind: 'cls', note: '' },
  { sel: '.task-card .d', marker: 'task-card', kind: 'cls', note: '' },
  { sel: '.pager-hint', marker: 'pager-hint', kind: 'cls', note: '' },
  { sel: '.stat b', marker: 'class="stat"', kind: 'cls', note: '统计卡' },
  { sel: '.stat span', marker: 'class="stat"', kind: 'cls', note: '' },
  { sel: '.cat-links .ord', marker: 'cat-links', kind: 'cls', note: '需再看 .ord' },
  { sel: '.card h3', marker: 'class="card"', kind: 'cls', note: '' },
  { sel: '.card p', marker: 'class="card"', kind: 'cls', note: '' },
  { sel: '.card .meta', marker: 'class="card"', kind: 'cls', note: '' },
  { sel: '.crumbs .crumb-zh', marker: 'crumb-zh', kind: 'cls', note: '' },
  { sel: '.cfg-raw', marker: 'cfg-raw', kind: 'cls', note: 'build 有条件产出' },
  /* 规划/主 Agent 点名但我的浏览器链判定为「活」的，一并留证 */
  { sel: '.cat-block h3', marker: 'cat-block', kind: 'cls', note: '主 Agent 说死，我测是活' },
  { sel: '.tax-list .sum', marker: 'tax-list', kind: 'cls', note: '同上' },
  { sel: '.external-image-note', marker: 'external-image-note', kind: 'cls', note: '同上' },
  { sel: '.sr-path', marker: 'sr-path', kind: 'cls', note: 'SITE_JS 注入' },
  { sel: '.article h5', marker: '<h5', kind: 'tag', note: '对照：活' },
];

/* 一次性统计全站 HTML 里每个 marker 的出现次数 + 出现在哪些页 */
const HTML_STATS = new Map();
for (const c of CANDIDATES) {
  if (!HTML_STATS.has(c.marker)) HTML_STATS.set(c.marker, { total: 0, pages: [] });
}
for (const f of htmlFiles) {
  const h = fs.readFileSync(f, 'utf8');
  for (const [marker, st] of HTML_STATS) {
    const n = countIn(h, marker);
    if (n) { st.total += n; st.pages.push(path.relative(ROOT, f).replace(/\\/g, '/') + '×' + n); }
  }
}

console.log('扫描已构建 HTML：' + htmlFiles.length + ' 个\n');
const rows = [];
for (const c of CANDIDATES) {
  const st = HTML_STATS.get(c.marker);
  const gen = GEN.map((g) => ({ p: g.p, n: countIn(g.src, c.marker) }));
  const js = countIn(SITE_JS, c.marker);
  const genTotal = gen.reduce((a, b) => a + b.n, 0);
  const verdict = st.total > 0 ? 'LIVE' : (genTotal > 0 || js > 0) ? 'CONDITIONAL' : 'DEAD';
  rows.push({ ...c, htmlTotal: st.total, gen, js, verdict, pages: st.pages.slice(0, 4) });
}

console.log('选择器'.padEnd(26) + 'marker'.padEnd(26) + 'HTML'.padStart(6) + 'gen'.padStart(5) + 'js'.padStart(4) + '  判定');
console.log('-'.repeat(96));
for (const r of rows) {
  const g = r.gen.map((x) => path.basename(x.p) + '=' + x.n).join(' ');
  console.log(r.sel.padEnd(26) + r.marker.padEnd(26) + String(r.htmlTotal).padStart(6)
    + String(r.gen.reduce((a, b) => a + b.n, 0)).padStart(5) + String(r.js).padStart(4)
    + '  ' + r.verdict + '   ' + g + (r.pages.length ? '  ' + r.pages.join(', ') : ''));
}

const dead = rows.filter((r) => r.verdict === 'DEAD');
const cond = rows.filter((r) => r.verdict === 'CONDITIONAL');
console.log('\n可安全删除（DEAD，两条链一致）: ' + dead.length);
for (const d of dead) console.log('  · ' + d.sel);
console.log('\n有条件产出 → **不删**（CONDITIONAL）: ' + cond.length);
for (const d of cond) console.log('  · ' + d.sel + '   ← ' + d.gen.map((x) => path.basename(x.p) + ':' + x.n).join(' ') + (d.js ? ' SITE_JS:' + d.js : ''));

fs.writeFileSync(path.join(require('os').tmpdir(), 'b3f-static.json'), JSON.stringify({ htmlFiles: htmlFiles.length, rows }, null, 2), 'utf8');
console.log('\nJSON → ' + path.join(require('os').tmpdir(), 'b3f-static.json'));
