'use strict';
/**
 * c45-baseline.js — 把规划阶段留下的单探针基线与当前实测并排打印（只读）。
 * 基线文件: reports/.c5-probe-before.json（由 tools/c5-probe.js --tag=before 生成）
 * 当前文件: reports/.c5-probe-after.json（我这次跑出来的）
 * 用法: node tools/c45-baseline.js [--before=...] [--after=...]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const load = (rel) => {
  const abs = path.resolve(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { return null; }
};

const B = load(opt('before', 'reports/.c5-probe-before.json'));
const A = load(opt('after', 'reports/.c5-probe-after.json'));

if (!B) { console.log('no baseline file'); process.exit(0); }

const pick = (x) => ({
  h5: x.p21 ? {
    cliCount: x.p21.mainPage ? x.p21.mainPage.count : null,
    cliMin: x.p21.mainPage ? x.p21.mainPage.min : null,
    cliMax: x.p21.mainPage ? x.p21.mainPage.max : null,
    bodyFs: x.p21.mainPage ? x.p21.mainPage.bodyFs : null,
    bodyFsAll: x.p21.mainPage ? x.p21.mainPage.bodyFsAll : null,
    siteH5Sampled: x.p21.totalH5Sampled,
  } : null,
  p22: x.p22 ? {
    vp: x.p22.vp, pages: x.p22.pagesProbed,
    broken: x.p22.totalBrokenWords, avoidable: x.p22.totalAvoidable,
    unavoidable: x.p22.totalUnavoidable, inCode: x.p22.totalInCode, cells: x.p22.totalCells,
    perPageMax: x.p22.perPageMax,
  } : null,
  p23: x.p23 ? {
    desktop: x.p23.desktop ? {
      position: x.p23.desktop.position, top: x.p23.desktop.top, z: x.p23.desktop.zIndex,
      inViewport: x.p23.desktop.inViewport, topIsSelf: x.p23.desktop.topIsSelf,
      rectTop: x.p23.desktop.rect ? x.p23.desktop.rect.top : null,
      scrollReached: x.p23.desktop.scrollReached, scrollY: x.p23.desktop.scrollY,
      docH: x.p23.desktop.docH, hitCls: x.p23.desktop.hitCls,
    } : null,
    mobile: x.p23.mobile ? { position: x.p23.mobile.position, inViewport: x.p23.mobile.inViewport, topIsSelf: x.p23.mobile.topIsSelf } : null,
  } : null,
  p16: x.p16 ? {
    pills: x.p16.pills, truncated: x.p16.truncated,
    list: (x.p16.truncatedList || []).map((t) => ({ text: t.text, cw: t.clientW, sw: t.scrollW, zhFs: t.zhFs })),
  } : null,
  overflow: x.overflow ? { cells: x.overflow.cells, nonZero: x.overflow.nonZero.length, max: x.overflow.maxTotal } : null,
  tocSticky: x.tocSticky ? { all: x.tocSticky.allSticky, rows: x.tocSticky.rows.map((r) => r.vw + ':' + r.position + '/' + r.stayed) } : null,
});

const b = pick(B);
const a = A ? pick(A) : null;

const show = (label, val) => console.log('  ' + label.padEnd(26) + JSON.stringify(val));

console.log('=== P2-1  .article h5 字号（cli-arguments 为主战场，正文 16px）');
show('BEFORE', b.h5);
if (a) show('AFTER', a.h5);

console.log('\n=== P2-2  320px 表格词中断');
show('BEFORE', b.p22);
if (a) show('AFTER', a.p22);

console.log('\n=== P2-3  all-pages.html .filter-bar 滚 5000px 后可见');
show('BEFORE', b.p23);
if (a) show('AFTER', a.p23);

console.log('\n=== P1-6  侧栏 pill 组名截断');
show('BEFORE', b.p16);
if (a) show('AFTER', a.p16);

console.log('\n=== 回归  横向溢出 / 桌面 TOC sticky');
show('BEFORE overflow', b.overflow);
if (a) show('AFTER overflow', a.overflow);
show('BEFORE toc', b.tocSticky);
if (a) show('AFTER toc', a.tocSticky);

if (b.h5 && a && a.h5) {
  console.log('\n判定 P2-1: h5 min ' + b.h5.cliMin + ' → ' + a.h5.cliMin
    + ' | 正文 ' + a.h5.bodyFs + ' | h5>正文 = ' + (a.h5.cliMin > a.h5.bodyFs));
}
if (b.p22 && a && a.p22) {
  console.log('判定 P2-2: 词中断 ' + b.p22.broken + ' → ' + a.p22.broken + ' (可避免 ' + b.p22.avoidable + ' → ' + a.p22.avoidable + ')');
}
if (b.p23 && a && a.p23) {
  console.log('判定 P2-3: position ' + b.p23.desktop.position + ' → ' + a.p23.desktop.position
    + ' | 滚后可见 ' + b.p23.desktop.inViewport + ' → ' + a.p23.desktop.inViewport
    + ' | 命中自身 ' + b.p23.desktop.topIsSelf + ' → ' + a.p23.desktop.topIsSelf);
}
if (b.p16 && a && a.p16) {
  console.log('判定 P1-6: 截断 ' + b.p16.truncated + ' → ' + a.p16.truncated + ' / pill ' + a.p16.pills);
}
