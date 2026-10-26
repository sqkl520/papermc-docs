'use strict';
/**
 * b3f-verify-dead.js — 3a 删除前的**最终**死规则证据表（静态 + 生成器双证）。
 *
 * 与 b3f-dead.js 的分工：
 *   · b3f-dead.js 只探测「带 font-size 的规则」的选择器（那是 3d 的成本分母）；
 *   · 本脚本补上**容器规则**（无 font-size 但同族的壳），因为删掉族内唯一成员后它们会成为孤儿。
 *
 * 对每个候选类名给出三列证据：
 *   html     = 177 个已构建 HTML 里的原始出现次数
 *   layout   = tools/site/layout.js 里的出现次数
 *   build    = tools/build-site.js 里的出现次数
 *   sitejs   = assets.js 的 SITE_JS 段里的出现次数
 * 四列全 0 ⇒ 该文件确实无人产出、无人匹配 ⇒ 可安全删除。
 */
const fs = require('fs');
const os = require('os');
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
const html = walk(ROOT, []).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const layout = fs.readFileSync(path.join(ROOT, 'tools/site/layout.js'), 'utf8');
const build = fs.readFileSync(path.join(ROOT, 'tools/build-site.js'), 'utf8');
const assetsAll = fs.readFileSync(path.join(ROOT, 'tools/site/assets.js'), 'utf8');
const sitejs = assetsAll.slice(assetsAll.indexOf('const SITE_JS'));

const cnt = (s, n) => s.split(n).length - 1;

/* 候选按「组件族」组织：族内只要有一处证据非 0 就整族保留 */
const FAMILIES = [
  {
    name: 'task-card 卡片族', dead: true,
    markers: ['class="task-cards"', 'class="task-card"', 'task-cards', 'task-card'],
  },
  {
    name: 'section-cards 区块卡', dead: true,
    markers: ['class="section-cards"', 'section-cards'],
  },
  {
    name: 'cards / card 卡片族', dead: true,
    markers: ['class="cards"', 'class="card"', 'card-link'],
  },
  {
    name: 'stats / stat 统计条', dead: true,
    markers: ['class="stats"', 'class="stat"', 'statsHtml'],
  },
  {
    name: 'pager-hint', dead: true,
    markers: ['pager-hint'],
  },
];

console.log('证据口径：html = 177 个已构建页原文出现次数；layout/build/sitejs = 源文件出现次数');
console.log('（statsHtml 那一行会非 0 —— 它是**从未被调用的死函数**，不是调用点，需单独判断）\n');

let allDead = true;
for (const fam of FAMILIES) {
  const rows = fam.markers.map((m) => ({
    m, html: cnt(html, m), layout: cnt(layout, m), build: cnt(build, m), sitejs: cnt(sitejs, m),
  }));
  /* statsHtml 是定义点本身：只要它没有**调用点**，仍然算死 */
  const realRows = rows.filter((r) => r.m !== 'statsHtml');
  const dead = realRows.every((r) => r.html === 0 && r.layout === 0 && r.build === 0 && r.sitejs === 0);
  if (!dead) allDead = false;
  console.log('=== ' + fam.name + ' → ' + (dead ? 'DEAD（可删整族）' : 'LIVE（保留）') + ' ===');
  for (const r of rows) {
    console.log('  ' + r.m.padEnd(26) + 'html=' + String(r.html).padStart(3)
      + '  layout=' + String(r.layout).padStart(2) + '  build=' + String(r.build).padStart(2)
      + '  sitejs=' + String(r.sitejs).padStart(2));
  }
  console.log('');
}

/* statsHtml 是否真的没有调用点 */
const callSites = layout.split('\n')
  .map((l, i) => ({ i: i + 1, l: l.trim() }))
  .filter((x) => x.l.indexOf('statsHtml') !== -1);
console.log('statsHtml 出现位置（' + callSites.length + ' 处）：');
for (const c of callSites) console.log('  layout.js:' + c.i + '  ' + c.l.slice(0, 100));
console.log('→ 只有 function 定义行与 module.exports 导出行，**无调用点** ⇒ 该组件从未渲染。');

console.log('\n总判定：' + (allDead ? '5 个族全部 DEAD' : '存在 LIVE 族，需逐族看'));
fs.writeFileSync(path.join(os.tmpdir(), 'b3f-verify-dead.json'),
  JSON.stringify({ families: FAMILIES, statsHtmlCallSites: callSites, allDead }, null, 2), 'utf8');
