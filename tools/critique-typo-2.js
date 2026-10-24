'use strict';
/**
 * critique-typo-2.js — 把 critique-typo-1.js 的度量导出为锐评用的 Markdown 表 / 诊断。
 * 用法：
 *   node tools/critique-typo-2.js --mode=debug --page=content-dialogs --vp=1440x900
 *   node tools/critique-typo-2.js --mode=tables --out="..\_typo-critique\tables.md"
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const MODE = opt('mode', 'debug');
const L = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', opt('light', path.join('..', '_typo-critique', 'measure-light.json'))), 'utf8'));
let D = null;
try { D = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', opt('dark', path.join('..', '_typo-critique', 'measure-dark.json'))), 'utf8')); } catch (e) { D = null; }

const pick = (set, vp, name) => set.results.find((r) => !r.error && r.viewport === vp && r.name === name);
const pad = (s, n) => String(s === null || s === undefined ? '-' : s).padEnd(n);

if (MODE === 'debug') {
  const vp = opt('vp', '1440x900');
  const name = opt('page', 'content-dialogs');
  const r = pick(L, vp, name);
  const m = r.m;
  console.log('== ' + name + ' @ ' + vp + '  h=' + m.pageHeight + ' chars=' + m.articleChars);
  console.log('layout', JSON.stringify(m.layout));
  console.log('contentBox', JSON.stringify(m.contentBox));
  console.log('\n-- paragraphs --');
  m.paragraphs.forEach((p, i) => console.log(pad(i, 3) + pad(p.size, 8) + pad(p.lh, 8) + pad(p.lhRatio, 7) + pad(p.inner, 7) + pad(p.chW, 8) + pad(p.chPerLine, 10) + pad(p.cjkPerLine, 11) + pad(p.inkMax, 8) + pad(p.inkP90, 8) + pad(p.lines, 6) + p.text));
  console.log('\n-- heads --');
  m.heads.forEach((h) => console.log(pad(h.role, 5) + pad(h.size, 8) + pad(h.lh, 8) + pad(h.lhRatio, 8) + pad(h.weight, 6) + pad(h.spacing, 8) + pad(h.mT, 8) + pad(h.mB, 8) + pad(h.bB, 6) + pad(h.contrast, 8) + h.sample));
  console.log('\n-- header order --');
  m.header.forEach((h) => console.log(pad(h.tag + '.' + h.cls, 26) + pad(h.y, 8) + pad(h.h, 7) + h.text));
  console.log('\n-- rhythm --');
  m.rhythm.forEach((x) => console.log(pad(x.prev, 22) + '-> ' + pad(x.next, 22) + pad(x.gap, 8) + ' (prevMB ' + x.prevMB + ' / nextMT ' + x.nextMT + ')'));
  console.log('\n-- panels --');
  m.panels.forEach((p) => console.log(pad(p.role, 20) + pad(p.color, 22) + pad(p.bg, 20) + p.ratio));
  console.log('\n-- misc --');
  console.log('counts', JSON.stringify(m.counts));
  console.log('sizeHist', JSON.stringify(m.sizeHist));
  console.log('pSizeCensus', JSON.stringify(m.pSizeCensus));
  console.log('weights', JSON.stringify(m.weightHist));
  console.log('mono', JSON.stringify(m.mono));
  console.log('table', JSON.stringify(m.tableInfo));
  console.log('links', JSON.stringify(m.links));
  console.log('cjk', JSON.stringify(m.cjk));
  console.log('lists', JSON.stringify(m.lists));
  console.log('mobileToc', JSON.stringify(m.mobileToc));
  console.log('chipInfo', JSON.stringify(m.chipInfo));
  console.log('longPage', JSON.stringify(m.longPage));
  console.log('typography', JSON.stringify(m.typography, null, 1).slice(0, 4000));
  process.exit(0);
}

/* ---------------- tables ---------------- */
const VPS = ['1440x900', '1280x800', '1024x768', '768x1024', '390x844', '320x568'];
const NAMES = ['landing', 'section-paper', 'content-dialogs', 'reference-longpage', 'content-tuning', 'index-allpages'];
const LABEL = { landing: '`/`', 'section-paper': '`/paper/`', 'content-dialogs': '`/paper/dev/dialogs/`', 'reference-longpage': '`/paper/reference/world-configuration/`', 'content-tuning': '`/velocity/tuning/`', 'index-allpages': '`/all-pages.html`' };
const out = [];
const w = (s) => out.push(s);

w('### T1 · 行宽全表（light）');
w('');
w('| 视口 | 页面 | 内容列 inner(px) | 正文字号 | 0 宽(ch) | **每行 ch** | **每行全角字** | 最长墨迹(px) | p90 墨迹 | 行数 |');
w('|---|---|---|---|---|---|---|---|---|---|');
L.results.filter((r) => !r.error).forEach((r) => {
  const p = r.m.bodyP;
  if (!p) return;
  w('| ' + r.viewport + ' | ' + LABEL[r.name] + ' | ' + p.inner + ' | ' + p.size + 'px/' + p.lhRatio + ' | ' + p.chW + ' | ' + p.chPerLine + ' | ' + p.cjkPerLine + ' | ' + p.inkMax + ' | ' + p.inkP90 + ' | ' + p.lines + ' |');
});
w('');
w('### T2 · 字号阶梯（含暗色同值校验）');
w('');
w('| 角色 | 1440 实测 px | rem | 相对正文 | 相邻比 | 字重 | 行高 px | 行高比 | letter-spacing |');
w('|---|---|---|---|---|---|---|---|---|');
const r1440 = pick(L, '1440x900', 'content-dialogs').m;
const bodyS = 16;
const rows = r1440.heads.filter((h) => ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(h.role));
const uniq = {};
rows.forEach((h) => { if (!uniq[h.role]) uniq[h.role] = h; });
['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((tag) => {
  const h = uniq[tag];
  if (!h) { w('| ' + tag + ' | 本页无 | | | | | | | |'); return; }
  w('| ' + tag + ' | ' + h.size + ' | ' + (Math.round((h.size / 16) * 1000) / 1000) + ' | ' + (Math.round((h.size / bodyS) * 1000) / 1000) + ' | | ' + h.weight + ' | ' + h.lh + ' | ' + h.lhRatio + ' | ' + h.spacing + ' |');
});
const t = r1440.typography;
[['正文 p', t.p], ['lead .page-desc', t.lead], ['crumbs', t.crumb], ['chip', t.chip], ['inline code', t.inlineCode], ['pre', t.pre], ['table', t.table], ['toc link', t.tocLink], ['side link', t.sideLink], ['footer link', t.footLink]].forEach((x) => {
  if (!x[1]) { w('| ' + x[0] + ' | - | | | | | | | |'); return; }
  w('| ' + x[0] + ' | ' + x[1].size + ' | ' + (Math.round((x[1].size / 16) * 1000) / 1000) + ' | ' + (Math.round((x[1].size / (t.p ? t.p.size : 16)) * 1000) / 1000) + ' | | ' + x[1].weight + ' | ' + x[1].lh + ' | ' + x[1].lhRatio + ' | ' + x[1].spacing + ' |');
});
w('');
w('### T3 · 行高（正文/标题/代码）');
w('');
w('| 角色 | 字号 | 行高 | 比值 | 中文建议区间 | ');
w('|---|---|---|---|---|');
const lhRows = [['正文 p', t.p], ['h1', uniq.h1], ['h2', uniq.h2], ['h3', uniq.h3], ['h4', uniq.h4], ['h5/h6', uniq.h5 || uniq.h6], ['inline code', t.inlineCode], ['pre', t.pre], ['toc link', t.tocLink], ['side link', t.sideLink], ['table td', t.table], ['li', r1440.lists && r1440.lists.liLh ? { size: r1440.lists.liSize, lh: r1440.lists.liLh, lhRatio: Math.round((r1440.lists.liLh / r1440.lists.liSize) * 100) / 100 } : null]];
lhRows.forEach((x) => { if (!x[1]) { w('| ' + x[0] + ' | - | - | - | |'); return; } w('| ' + x[0] + ' | ' + x[1].size + ' | ' + x[1].lh + ' | ' + x[1].lhRatio + ' | ' + (x[0].indexOf('正文') === 0 || x[0] === 'li' ? '1.7–1.9' : x[0].indexOf('h') === 0 ? '1.25–1.35' : '1.45–1.6') + ' |'); });
w('');
w('### T4 · 垂直节奏（article 相邻块间距，1440 / dialogs）');
w('');
w('| 上一块 | 下一块 | 实测间距 px | prev margin-bottom | next margin-top |');
w('|---|---|---|---|---|');
r1440.rhythm.forEach((x) => w('| ' + x.prev + ' | ' + x.next + ' | ' + x.gap + ' | ' + x.prevMB + ' | ' + x.nextMT + ' |'));
w('');
w('### T5 · 强调手段与字重用量（1440）');
w('');
NAMES.forEach((n) => {
  const r = pick(L, '1440x900', n);
  if (!r) return;
  const c = r.m.counts;
  w('- ' + LABEL[n] + '：p ' + c.p + ' / li ' + c.li + ' / strong ' + c.strong + ' / em ' + c.em + ' / code ' + c.code + ' / a ' + c.a + ' / pre ' + c.pre + ' / table ' + c.table + ' / img ' + c.img + ' / blockquote ' + c.blockquote + ' / alert ' + c.alert + ' / h2 ' + c.h2 + ' h3 ' + c.h3 + ' h4 ' + c.h4 + ' h5 ' + c.h5 + ' h6 ' + c.h6 + '；字重分布 ' + JSON.stringify(r.m.weightHist));
});
w('');
w('### T6 · 对比度（light / dark，1440 dialogs）');
w('');
w('| 角色 | light 前景 | light 背景 | light 比值 | 判定(4.5/3.0) | dark 前景 | dark 背景 | dark 比值 | 判定 |');
w('|---|---|---|---|---|---|---|---|---|');
const dl = pick(L, '1440x900', 'content-dialogs').m.panels;
const dd = D ? (pick(D, '1440x900', 'content-dialogs') || {}).m : null;
dl.forEach((p) => {
  const q = dd ? dd.panels.find((x) => x.role === p.role) : null;
  const bigText = false;
  const verdict = p.ratio >= 4.5 ? 'AA(正文)' : p.ratio >= 3 ? 'AA(仅大字/非文本)' : '不达标';
  const v2 = q ? (q.ratio >= 4.5 ? 'AA(正文)' : q.ratio >= 3 ? 'AA(仅大字/非文本)' : '不达标') : '-';
  w('| ' + p.role + ' | ' + p.color + ' | ' + p.bg + ' | **' + p.ratio + '** | ' + verdict + ' | ' + (q ? q.color : '-') + ' | ' + (q ? q.bg : '-') + ' | ' + (q ? '**' + q.ratio + '**' : '-') + ' | ' + v2 + ' |');
});
w('');
w('### T7 · 数字与代码字体');
w('');
NAMES.forEach((n) => {
  const r = pick(L, '1440x900', n);
  if (!r) return;
  w('- ' + LABEL[n] + '：mono=' + JSON.stringify(r.m.mono) + '；table=' + JSON.stringify(r.m.tableInfo));
});
w('');
w('### T8 · 首屏阅读引导（1440）');
w('');
NAMES.forEach((n) => {
  const r = pick(L, '1440x900', n);
  if (!r) return;
  w('- ' + LABEL[n] + '：h1Y=' + r.m.h1Order.h1Y + ' chips=' + (r.m.chipInfo ? r.m.chipInfo.count + ' 个 @y' + r.m.chipInfo.box.y + ' h' + r.m.chipInfo.box.h : '无') + ' 顺序=' + r.m.header.map((h) => h.tag + '(' + h.y + ')').join(' → '));
});
w('');
w('### T9 · 长页面 / 移动端首屏');
w('');
w('| 视口 | 页面 | 页高 px | 正文可见字号 | h2 数 | 每 h2 覆盖 px | 正文非空白字符数 | 每 1000px 字符数 |');
w('|---|---|---|---|---|---|---|---|');
L.results.filter((r) => !r.error).forEach((r) => {
  const m = r.m;
  w('| ' + r.viewport + ' | ' + LABEL[r.name] + ' | ' + m.pageHeight + ' | ' + (m.typography.p ? m.typography.p.size : '-') + ' | ' + m.counts.h2 + ' | ' + (m.counts.h2 ? Math.round(m.pageHeight / m.counts.h2) : '-') + ' | ' + m.articleChars + ' | ' + (m.pageHeight ? Math.round(m.articleChars / (m.pageHeight / 1000)) : '-') + ' |');
});
w('');
w('| 视口 | 页面 | 移动 TOC 高度 | TOC 条数 | h1 Y | 正文首块 Y | 首屏是否见到 h1 |');
w('|---|---|---|---|---|---|---|');
L.results.filter((r) => !r.error && ['390x844', '320x568', '768x1024'].includes(r.viewport)).forEach((r) => {
  const t2 = r.m.mobileToc;
  w('| ' + r.viewport + ' | ' + LABEL[r.name] + ' | ' + t2.tocH + ' | ' + t2.tocItems + ' | ' + t2.h1Y + ' | ' + t2.firstArticleTextY + ' | ' + (t2.h1Y !== null && t2.h1Y < r.m.vp.split('x')[1] * 1 ? '是' : '否') + ' |');
});
w('');
w('### T10 · 中文排版细节（1440 article）');
w('');
NAMES.forEach((n) => {
  const r = pick(L, '1440x900', n);
  if (!r) return;
  w('- ' + LABEL[n] + '：' + JSON.stringify(r.m.cjk) + ' links=' + JSON.stringify(r.m.links));
});
w('');
w('### T11 · 一致性（同一语义元素跨页）');
w('');
w('| 页面 | page-desc/lead | chip | crumbs | footer link | 备注 |');
w('|---|---|---|---|---|---|');
NAMES.forEach((n) => {
  const r = pick(L, '1440x900', n);
  if (!r) return;
  const tt = r.m.typography;
  const f = (x) => (x ? x.size + '/' + x.lhRatio + '/' + x.weight + (x.color ? '/' + x.color.replace('rgb(', '').replace(')', '') : '') : '-');
  w('| ' + LABEL[n] + ' | ' + f(tt.lead) + ' | ' + f(tt.chip) + ' | ' + f(tt.crumb) + ' | ' + f(tt.footLink) + ' | h1=' + (r.m.heads.find((h) => h.role === 'h1') ? r.m.heads.find((h) => h.role === 'h1').size : '-') + ' |');
});
w('');
w('### T12 · 主题切换后的排版（dark 相比 light 的差异点）');
w('');
if (!D) w('(未采集 dark)');
else {
  w('| 视口 | 页面 | light pageH | dark pageH | light 正文对比 | dark 正文对比 | light code 对比 | dark code 对比 | light muted 对比 | dark muted 对比 |');
  w('|---|---|---|---|---|---|---|---|---|---|');
  D.results.filter((r) => !r.error).forEach((r) => {
    const l = pick(L, r.viewport, r.name);
    if (!l) return;
    const g = (m, role) => { const p = m.panels.find((x) => x.role === role); return p ? p.ratio : '-'; };
    w('| ' + r.viewport + ' | ' + LABEL[r.name] + ' | ' + l.m.pageHeight + ' | ' + r.m.pageHeight + ' | ' + g(l.m, 'body-text') + ' | ' + g(r.m, 'body-text') + ' | ' + g(l.m, 'code-pre') + ' | ' + g(r.m, 'code-pre') + ' | ' + g(l.m, 'muted(.page-desc)') + ' | ' + g(r.m, 'muted(.page-desc)') + ' |');
  });
  w('');
  w('dark 全部面板（1440 dialogs）：');
  w('');
  const dp = pick(D, '1440x900', 'content-dialogs');
  if (dp) dp.m.panels.forEach((p) => w('- ' + p.role + '：' + p.color + ' on ' + p.bg + ' → **' + p.ratio + '**'));
}

const OUT = path.resolve(__dirname, '..', opt('out', path.join('..', '_typo-critique', 'tables.md')));
fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8');
console.log('写出 ' + OUT + '（' + out.length + ' 行）');
