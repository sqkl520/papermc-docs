'use strict';
/**
 * b3f-emtable.js — 3c 台账：把 21 处 em 的「规划改法」与「当前源码行」对齐成一张施工表。
 *
 * 规划（ups-plan §2.3）给的是 assets.js:OLD 行号（批 1 之前），3a 又删了 21 行，
 * 所以行号必须重算。本脚本按**选择器**匹配回当前源码，输出可直接照着改的清单。
 *
 * 汇总（§2.3）：6 保留 em / 10 改 rem 令牌 / 3 删 font-size / 2 删规则。
 * 其中 2 条删规则的（.cat-links .ord / .crumbs .crumb-zh）已由 3a 删掉，
 * 所以 3c 实际只剩 19 条待处置。
 *
 * 用法：node tools/b3f-emtable.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cmap = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'b3f-cssmap.json'), 'utf8'));
const src = fs.readFileSync(path.join(ROOT, 'tools/site/assets.js'), 'utf8');

/* SITE_CSS 在文件里的起始行（供换算） */
const cssStartLine = src.slice(0, src.indexOf('const SITE_CSS')).split('\n').length;
const cssStartIdx = src.indexOf('const SITE_CSS');

/* §2.3 的 21 条，按选择器归一化匹配（选择器文本可能带 @media 前缀外的空格差异） */
const PLAN = [
  { sel: 'a.external::after', verdict: 'keep', why: '外链箭头必须随正文缩放' },
  { sel: 'kbd', verdict: 'rem', to: '--fs-xs', why: '父级不定会派生 2 值；上游 kbd=12px，取 12.5' },
  { sel: '.topbar #theme-toggle>.theme-icon', verdict: 'keep', why: '图标随按钮字号缩放' },
  { sel: '.toc-side .toc-title::before', verdict: 'drop-decl', to: '0', why: ':177 已改为 font-size:0 + border 三角' },
  { sel: '.toc-side .toc-count', verdict: 'rem', to: '--fs-2xs', why: '计数值应为固定小档' },
  { sel: '.side-toc>summary.side-toc-title::before', verdict: 'keep', why: '折叠三角' },
  { sel: '.side-toc .lvl-5', verdict: 'del-fs', why: 'TOC 层级靠 padding 表达，不靠字号' },
  { sel: 'summary.side-section-title::before', verdict: 'keep', why: '折叠三角' },
  { sel: '.side-cat>summary::before', verdict: 'keep', why: '折叠三角' },
  { sel: '.side-group-title::before', verdict: 'keep', why: '折叠三角' },
  { sel: '.side-count', verdict: 'rem', to: '--fs-2xs', why: '同一类派生 3–4 个 px，是碎片级主因' },
  { sel: '.article code', verdict: 'rem', to: '--fs-sm', why: 'h2 里 .86em→24.8px 比正文还大' },
  { sel: '.alert-title::before', verdict: 'keep', why: '提示框图标' },
  { sel: '.page-footer code', verdict: 'rem', to: '--fs-xs', why: '页脚哈希该是固定档' },
  { sel: '.toc-side .lvl-4', verdict: 'del-fs', why: '同上' },
  { sel: '.toc-side .lvl-5', verdict: 'del-fs', why: '同上；且 lvl-5 比 lvl-4 小 → 层级倒置' },
  { sel: '.cat-links .ord', verdict: 'deleted-3a', why: '0 匹配，3a 已删' },
  { sel: '.crumbs .crumb-zh', verdict: 'deleted-3a', why: '0 匹配，3a 已删' },
  { sel: '.cfg-key code', verdict: 'rem', to: '--fs-sm', why: '子(.94em=15.04)比父(12.8)大 17%' },
  { sel: '.cfg-key .cfg-n', verdict: 'rem', to: '--fs-2xs', why: '子比父大' },
  { sel: '.info-footer code', verdict: 'rem', to: '--fs-xs', why: '固定档' },
];

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const emRules = cmap.emDecls;

/* 把 cmap 的 CSS 内行号换算成文件行号：SITE_CSS 内容从 const 那一行的下一行开始 */
const cssContentStartLine = cssStartLine; /* const SITE_CSS = ` 所在行，内容紧随其后 */
const fileLineOf = (cssLine) => cssContentStartLine + cssLine - 1;

const rows = [];
for (const p of PLAN) {
  const hit = emRules.find((r) => norm(r.sel) === norm(p.sel));
  rows.push({
    ...p,
    found: !!hit,
    idx: hit ? hit.idx : null,
    cssLine: hit ? hit.line : null,
    fileLine: hit ? fileLineOf(hit.line) : null,
    raw: hit ? hit.fontSizes.join(',') : null,
  });
}

const order = { rem: 0, keep: 1, 'del-fs': 2, 'drop-decl': 3, 'deleted-3a': 4 };
rows.sort((a, b) => (order[a.verdict] - order[b.verdict]) || ((a.fileLine || 0) - (b.fileLine || 0)));

const label = {
  rem: '改 rem 令牌', keep: '保留 em', 'del-fs': '删 font-size',
  'drop-decl': '删死声明', 'deleted-3a': '3a 已删',
};
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));

console.log('3c 施工表（' + cn(cssContentStartLine) + '）\n'.replace('（' + cn(cssContentStartLine) + '）', ''));
function cn(x) { return 'SITE_CSS 起始文件行 ' + x; }

console.log(pad('处置', 12) + pad('选择器', 44) + pad('现值', 9) + pad('文件行', 8) + '目标 / 理由');
console.log('-'.repeat(140));
for (const r of rows) {
  const tgt = r.to ? 'var(' + r.to + ')' : '—';
  console.log(pad(label[r.verdict], 12) + pad(r.sel, 44) + pad(r.raw || '(未找到)', 9)
    + pad(r.fileLine || '-', 8) + (r.verdict === 'rem' ? tgt + '  ' : '') + r.why);
}

const stat = {};
for (const r of rows) stat[r.verdict] = (stat[r.verdict] || 0) + 1;
console.log('\n汇总：' + Object.keys(stat).map((k) => label[k] + ' ' + stat[k]).join(' · '));
const missing = rows.filter((r) => !r.found && r.verdict !== 'deleted-3a');
if (missing.length) {
  console.log('\n⚠ 未在源码里找到的选择器（可能已被 3a 删或改名）：');
  for (const m of missing) console.log('  · ' + m.sel);
}
