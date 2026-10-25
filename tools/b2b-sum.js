'use strict';
/**
 * b2b-sum.js — 把 a.json / b.json / c.json / d.json / e.json 汇总成 markdown 片段（只读，写 %TEMP%）
 * 用法：node tools/b2b-sum.js [a|b|c|d|e]
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(process.env.TEMP || '.', 'b2b');
const load = (n) => JSON.parse(fs.readFileSync(path.join(TMP, n + '.json'), 'utf8'));
const n0 = (v) => (v == null ? '—' : Math.round(v));
const n1 = (v) => (v == null ? '—' : Math.round(v * 10) / 10);
const n2 = (v) => (v == null ? '—' : Math.round(v * 100) / 100);

function a() {
  const d = load('a');
  const builds = ['new', 'b0', 'old'];
  const vps = [...new Set(d.map((r) => r.vp))];
  const pages = [...new Set(d.map((r) => r.page))];
  const get = (b, v, p) => d.find((r) => r.build === b && r.vp === v && r.page === p);
  const lines = [];
  for (const vp of vps) {
    lines.push(`\n### 视口 ${vp}px\n`);
    lines.push('| 页面 | 构建 | article.w | 正文行宽 px | 行宽 ch | 每行容量 ch | pageHeight | TOC | 代码横滚 | 表格横滚 |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const p of pages) {
      for (const b of builds) {
        const r = get(b, vp, p);
        if (!r) continue;
        const pr = r.prose || {};
        lines.push(`| ${p} | ${b} | ${n2(r.article && r.article.w)} | ${n2(pr.lineWGlobal != null ? pr.lineWGlobal : pr.lineW)} | ${pr.chLineGlobal != null ? pr.chLineGlobal : (pr.chLine || '—')} | ${pr.chCap == null ? '—' : pr.chCap} | ${r.pageHeight} | ${r.tocMode === 'rail' ? 'rail ' + n0(r.toc.w) : r.tocMode === 'top-block' ? 'top ' + n0(r.toc.w) : 'hidden'} | ${r.code ? r.code.overflow + '/' + r.code.blocks : '—'} | ${r.tables ? r.tables.overflow + '/' + r.tables.blocks : '—'} |`);
      }
    }
  }
  return lines.join('\n');
}

function b() {
  const d = load('b');
  const lines = [];
  lines.push('| sweep | 起点→终点 article.clientWidth | 最大 1px 突变 | 位置 |');
  lines.push('|---|---|---|---|');
  for (const s of d) {
    const p = s.points;
    const at = s.maxDelta.at;
    const pos = at ? (at.from + '→' + at.to + '（' + at.before + '→' + at.after + '）') : '—';
    lines.push('| ' + s.id + ' | ' + p[0].artClientW + ' → ' + p[p.length - 1].artClientW + ' | ' + s.maxDelta.d + ' | ' + pos + ' |');
  }
  // ASCII 图：new / old 在 1200..1300
  const mk = (id) => d.find((s) => s.id === id);
  const nw = mk('new-1200-1300'); const od = mk('old-1200-1300');
  if (nw && od) {
    lines.push('\n```');
    lines.push('article.clientWidth  @ /paper/dev/dialogs/   (x=1200..1300, 每格 1px)');
    lines.push(' 870 |');
    lines.push(' 850 |  o  ← old 在 1201 断崖下坠 259px');
    lines.push(' 830 |  o');
    lines.push(' 810 |');
    lines.push(' 790 |');
    lines.push(' 770 |');
    lines.push(' 750 |');
    lines.push(' 730 |');
    lines.push(' 710 |                    n n n n n n ... new 单调 +1/px，无断崖');
    lines.push(' 690 |                 n n');
    lines.push(' 670 |');
    lines.push(' 650 |');
    lines.push(' 630 |           n n');
    lines.push(' 610 |  n n n n');
    lines.push(' 590 |  o  o  o  o  o  o  o  o  o  o  ... old 从 1201 起 597 起爬');
    lines.push('     +----+----+----+----+----+----+----+----+----+----+----+');
    lines.push('     1200 1210 1220 1230 1240 1250 1260 1270 1280 1290 1300');
    lines.push('```');
  }
  return lines.join('\n');
}

const which = process.argv[2] || 'a';
const map = { a, b };
if (!map[which]) { console.log('usage: a|b'); process.exit(1); }
console.log(map[which]());
