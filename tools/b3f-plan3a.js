'use strict';
/**
 * b3f-plan3a.js — 3a 施工清单：逐条列出候选死规则所在**整条规则**（含无 font-size 的同族容器规则），
 * 便于人工裁决"删整条"还是"只删 font-size 声明"。
 *
 * 判据来源：%TEMP%\b3f-dead-pre3a.json 的 deadRules（0 命中，已剥伪元素壳、177 页×4 视口）。
 * 用法：node tools/b3f-plan3a.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const deadFile = path.join(os.tmpdir(), 'b3f-dead-pre3a.json');
const mapFile = path.join(os.tmpdir(), 'b3f-cssmap.json');
const dead = JSON.parse(fs.readFileSync(deadFile, 'utf8'));
const cmap = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const { SITE_CSS } = require('./site/assets.js');

/* 族前缀：把 0 命中的规则按"组件族"归类，同族的容器规则也一并列出 */
const FAMILIES = [
  { name: 'h6', test: (s) => /\.article h6/.test(s) },
  { name: 'task-card', test: (s) => /\.task-cards?\b/.test(s) },
  { name: 'pager-hint', test: (s) => /\.pager-hint/.test(s) },
  { name: 'stats', test: (s) => /\.stats?\b/.test(s) },
  { name: 'cat-links .ord', test: (s) => /\.cat-links \.ord/.test(s) },
  { name: 'card', test: (s) => /\.(cards?|card-link)\b/.test(s) && !/entry-card|host-card/.test(s) },
  { name: 'crumbs .crumb-zh', test: (s) => /\.crumb-zh/.test(s) },
  { name: 'cfg-raw', test: (s) => /\.cfg-raw/.test(s) },
  { name: 'sr-*', test: (s) => /\.sr-/.test(s) },
  { name: 'section-cards', test: (s) => /\.section-cards/.test(s) },
];

const deadSels = new Set(dead.deadRules.map((d) => d.sel));
const jsSels = new Set(dead.jsInjected.map((d) => d.sel));

/* 逐族打印：CSS 里所有匹配该族的规则（含无 font-size 的），标注 dead / live / js-injected */
for (const fam of FAMILIES) {
  const rows = cmap.allRules.filter((r) => fam.test(r.sel));
  if (!rows.length) continue;
  const fsIdx = new Map(cmap.rulesWithFs.map((r) => [r.idx, r]));
  console.log('\n=== 族：' + fam.name + ' （CSS 里 ' + rows.length + ' 条规则）===');
  for (const r of rows) {
    const isDead = deadSels.has(r.sel);
    const isJs = jsSels.has(r.sel);
    const tag = isDead ? 'DEAD ' : isJs ? 'JS   ' : 'LIVE ';
    const f = fsIdx.get(r.idx);
    console.log('  ' + tag + ' #' + String(r.idx).padStart(3) + ' L' + String(r.line).padStart(4)
      + '  ' + r.sel.slice(0, 68).padEnd(70) + (f ? 'fs=' + f.fontSizes.join('/') : ''));
  }
}

/* 输出"要删的行区间"：整条规则在源文件里的起止行 */
const byIdx = new Map(cmap.allRules.map((r) => [r.idx, r]));
console.log('\n各 0 命中规则的源码起止行（供手工 edit 定位）：');
for (const d of dead.deadRules.sort((a, b) => a.line - b.line)) {
  console.log('  #' + String(d.idx).padStart(3) + '  L' + String(d.line).padStart(4) + '  ' + d.sel.slice(0, 64));
}
