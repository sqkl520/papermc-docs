'use strict';
/**
 * b2b-mk.js — 从实测 JSON 生成报告用的 markdown 片段（只读，写 %TEMP%）
 * 用法：node tools/b2b-mk.js <a|c|d|e|d2>  → 打印 markdown
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(process.env.TEMP || '.', 'b2b');
const load = (n) => JSON.parse(fs.readFileSync(path.join(TMP, n + '.json'), 'utf8'));
const R0 = (v) => (v == null ? '—' : Math.round(v));
const R1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const R2 = (v) => (v == null ? '—' : (Math.round(v * 100) / 100).toFixed(2));

const PAGES = ['landing', 'paper', 'dialogs', 'worldcfg', 'tuning', 'allpages'];
const VPS = ['1440', '1280', '1200', '1100', '1025', '1024', '900', '768', '390', '320'];

function A1() { // dialogs 三方 × 10 视口
  const d = load('a');
  const g = (b, v) => d.find((r) => r.build === b && r.vp === v && r.page === 'dialogs');
  const L = [];
  L.push('| 视口 | 构建 | article.w | 正文行宽 px | 行宽 ch | 每行容量 ch | pageHeight | TOC | 代码横滚 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const v of VPS) {
    for (const b of ['new', 'b0', 'old']) {
      const r = g(b, v);
      if (!r) continue;
      const p = r.prose || {};
      const toc = r.tocMode === 'rail' ? `rail ${R0(r.toc.w)}` : r.tocMode === 'top-block' ? `top ${R0(r.toc.w)}` : 'hidden';
      L.push(`| ${v} | ${b} | ${R2(r.article && r.article.w)} | ${R2(p.lineWGlobal != null ? p.lineWGlobal : p.lineW)} | ${p.chLineGlobal != null ? p.chLineGlobal : R0(p.chLine)} | ${R0(p.chCap)} | ${r.pageHeight} | ${toc} | ${r.code ? r.code.overflow + '/' + r.code.blocks : '—'} |`);
    }
  }
  return L.join('\n');
}

function A2() { // new 全页 × 全视口，紧凑两列
  const d = load('a');
  const L = [];
  L.push('| 页面 | ' + VPS.join(' | ') + ' |');
  L.push('|---|' + VPS.map(() => '---').join('|') + '|');
  for (const pg of PAGES) {
    const cells = VPS.map((v) => {
      const r = d.find((x) => x.build === 'new' && x.vp === v && x.page === pg);
      if (!r) return '—';
      const p = r.prose || {};
      const w = r.article ? R0(r.article.w) : '无article';
      return `${w}<br>${R0(p.chCap)}ch`;
    });
    L.push(`| ${pg} | ${cells.join(' | ')} |`);
  }
  return L.join('\n');
}

function A3() { // 归因表：关键视口的 old/b0/new 与 Δ
  const d = load('a');
  const rows = [];
  for (const v of VPS) {
    for (const pg of ['dialogs', 'worldcfg', 'tuning', 'paper']) {
      const o = d.find((r) => r.build === 'old' && r.vp === v && r.page === pg);
      const b = d.find((r) => r.build === 'b0' && r.vp === v && r.page === pg);
      const n = d.find((r) => r.build === 'new' && r.vp === v && r.page === pg);
      if (!o || !b || !n) continue;
      const ow = o.article ? o.article.w : null, bw = b.article ? b.article.w : null, nw = n.article ? n.article.w : null;
      const dB0 = ow != null && bw != null ? Math.round((bw - ow) * 100) / 100 : null;
      const dB1 = bw != null && nw != null ? Math.round((nw - bw) * 100) / 100 : null;
      if (dB0 === 0 && dB1 === 0) continue; // 只列有变化的
      rows.push(`| ${v} | ${pg} | ${R2(ow)} | ${R2(bw)} | ${R2(nw)} | ${dB0 > 0 ? '+' : ''}${R2(dB0)} | ${dB1 > 0 ? '+' : ''}${R2(dB1)} |`);
    }
  }
  return ['| 视口 | 页面 | old | b0 | new | 批 0 贡献 | 批 1 贡献 |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
}

function A4() { // 代码/表格横滚 三方
  const d = load('a');
  const L = [];
  L.push('| 页面 | 视口 | new 代码 | b0 代码 | old 代码 | new 表格 | old 表格 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const pg of ['dialogs', 'particles', 'worldcfg', 'allpages', 'tuning']) {
    for (const v of ['1440', '1280', '1200', '1025', '1024', '768', '390']) {
      const get = (b) => d.find((r) => r.build === b && r.vp === v && r.page === pg);
      const n = get('new'), b = get('b0'), o = get('old');
      if (!n) continue;
      const f = (r) => (r && r.code ? r.code.overflow + '/' + r.code.blocks : '—');
      const ft = (r) => (r && r.tables ? r.tables.overflow + '/' + r.tables.blocks : '—');
      L.push(`| ${pg} | ${v} | ${f(n)} | ${f(b)} | ${f(o)} | ${ft(n)} | ${ft(o)} |`);
    }
  }
  return L.join('\n');
}

function C() {
  const d = load('c');
  const L = [];
  L.push('| 构建 | 页面 | 行数 | 实际行推进 | `<pre>` font-size | `<code>` font-size | `<pre>` line-height | `<code>` line-height | 推进/字号 | pageHeight |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of d) {
    const b = r.variants[0];
    L.push(`| ${r.build} | ${r.page} | ${b.lineCount} | **${R2(b.advMode)}** | ${R1(b.pre.fontSize)} | ${R1(b.codeFS)} | ${R1(b.preLH)} | ${R1(b.codeLH)} | ${R2(b.codeFS ? b.advMode / b.codeFS : null)} | ${b.pageHeight} |`);
  }
  L.push('');
  L.push('**注入 `.code-pre{font-size:.875rem}` 后（new）**');
  L.push('');
  L.push('| 页面 | 行推进 前 → 后 | 页高 前 → 后 | Δ页高 | 代码横滚 前 → 后 |');
  L.push('|---|---|---|---|---|');
  for (const r of d.filter((x) => x.build === 'new')) {
    const b = r.variants[0], v = r.variants[1];
    L.push(`| ${r.page} | ${R2(b.advMode)} → ${R2(v.advMode)} | ${b.pageHeight} → ${v.pageHeight} | ${v.pageHeight - b.pageHeight > 0 ? '+' : ''}${v.pageHeight - b.pageHeight} | ${b.overflow}/${b.blockCount} → ${v.overflow}/${v.blockCount} |`);
  }
  L.push('');
  L.push('**三方基线（行推进，无注入）**');
  L.push('');
  L.push('| 页面 | old | b0 | new | 归属 |');
  L.push('|---|---|---|---|---|');
  const pages = [...new Set(d.map((r) => r.page))];
  for (const pg of pages) {
    const g = (b) => d.find((r) => r.build === b && r.page === pg);
    const o = g('old'), b0 = g('b0'), n = g('new');
    const f = (x) => (x ? R2(x.variants[0].advMode) : '—');
    const same = JSON.stringify([f(o), f(b0), f(n)]);
    const who = f(o) === f(b0) && f(b0) === f(n) ? '三者相同 = 存量（批 0 之前就有）' : (f(b0) === f(n) ? '批 0 未动 / 批 1 未动' : '有变化');
    L.push(`| ${pg} | ${f(o)} | ${f(b0)} | ${f(n)} | ${who} |`);
  }
  return L.join('\n');
}

function D2() {
  const d = load('d2');
  const L = [];
  L.push('| 构建 | 页面 | `<img>` 数 | 补到 dims 的标签 | 未补 | CLS 基线 | CLS 补 dims 后 | 降幅 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of d) {
    const drop = r.clsBaseSettled > 0 ? Math.round((1 - r.clsFixSettled / r.clsBaseSettled) * 100) + '%' : 'n/a（基线 0）';
    L.push(`| ${r.build} | ${r.page} | ${r.imgs} | ${r.patchedTags} | ${r.missedTags} | **${r.clsBaseSettled}** | **${r.clsFixSettled}** | ${drop} |`);
  }
  return L.join('\n');
}

function E() {
  const d = load('e');
  const L = [];
  // 每视口每页：base vs prose40
  L.push('| 视口 | 页面 | 变体 | 正文容器宽 | 每行容量 ch | 首段 cap ch | 行宽 px | 代码横滚 | 表格横滚 | 左边缘差 | pageHeight |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of d.filter((x) => x.build === 'new')) {
    if (!['base', 'prose40', 'prose44', 'article40'].includes(r.variant)) continue;
    L.push(`| ${r.vp} | ${r.page} | ${r.variant} | ${R2(r.proseCapMax)} | ${R0(r.chCap)} | ${R0(r.chCapFirst)} | ${R2(r.lineW)} | ${r.codeOverflow}/${r.codeBlocks} | ${r.tableOverflow}/${r.tableBlocks} | ${R2(r.leftGap)} | ${r.pageHeight} |`);
  }
  return L.join('\n');
}

const w = process.argv[2];
const map = { a1: A1, a2: A2, a3: A3, a4: A4, c: C, d2: D2, e: E };
if (!map[w]) { console.log('usage: a1|a2|a3|a4|c|d2|e'); process.exit(1); }
console.log(map[w]());
