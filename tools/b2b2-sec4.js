'use strict';
/**
 * b2b2-sec4.js — 生成报告 E 小节 markdown 到 %TEMP%\b2b2\secE.md（只读数据）
 * 用法：node tools/b2b2-sec4.js
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(process.env.TEMP || '.', 'b2b2');
const rd = (n) => JSON.parse(fs.readFileSync(path.join(TMP, n), 'utf8'));
const w = (n, s) => { const f = path.join(TMP, n); fs.writeFileSync(f, s, 'utf8'); console.log('wrote ' + f + ' (' + s.length + ' chars)'); };

const e = rd('e.json');       // 38/40/42/44rem 扫描（任务书写法）
const e2 = rd('e2.json');     // 直接子 vs 后代
const e3 = rd('e3.json');     // 叶节点 vs 容器
const prose = rd('prose.json');

const PAGES = ['dialogs', 'worldcfg', 'tuning', 'paper', 'particles'];
const VPS = [1440, 1280, 1200, 1025];

let s = '';

/* ---------- E.0 覆盖盲区（必须先讲，否则 E.1 的数字会被误读） ---------- */
s += '### E.0 前置发现：任务书的选择器写法有覆盖盲区\n\n';
s += '任务书写法是 `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}` —— **直接子元素**选择器。实测它的覆盖率并不完整：\n\n';
s += '| 页面 | 正文档落数 | 其中 article **直接子** p | 其中**嵌在容器内**的 p | 直接子最长行 | 嵌套最长行 |\n|---|---|---|---|---|---|\n';
for (const pg of ['dialogs', 'worldcfg', 'tuning', 'particles', 'paper']) {
  const m = prose[pg];
  if (!m || m.error) continue;
  s += '| ' + pg + ' | ' + m.proseTotal + ' | ' + m.directCount + ' | **' + m.nestedCount + '** | ' + m.maxDirectLine + ' | ' + m.maxNestedLine + ' |\n';
}
s += '\n嵌套容器明细（按最长行降序）：\n\n';
for (const pg of ['worldcfg', 'dialogs', 'particles', 'tuning']) {
  const m = prose[pg];
  if (!m || !m.wrappers || !m.wrappers.length) continue;
  s += '- **' + pg + '**：' + m.wrappers.map((x) => '`' + x.w + '` ×' + x.n + '（最长行 ' + x.maxLine + 'px）').join('、') + '\n';
}
s += '\n**两个结构性事实（决定了 E 的结论）：**\n\n';
s += '1. **`worldcfg` 的正文全部在 `<ul>` 里**（29 个段落），另有 2 个在 `aside.alert` 里；article 直接子 `<p>` 为 **0**。因此 `>` 写法连一个段落都限不到。\n';
s += '2. **`worldcfg` 的代码块也嵌在同一个 `<ul>` 内**（`preW` 基线 874.81px）。于是「限宽 `ul`」会把代码块一起压窄——这是 40rem 方案的回归风险（见 E.2）。\n';

/* ---------- E.1 行宽变化 ---------- */
s += '\n### E.1 正文行宽变化（40rem = 640px，1440/1280/1200/1025）\n\n';
s += '下表用**任务书原写法**（`A-direct`）与**后代写法**（`DESC`）两列，说明「行宽降到多少」取决于写法：\n\n';
s += '| 视口 | 页面 | 基线行宽 / 字符 | A-direct（`>`）行宽 / 字符 | DESC（后代）行宽 / 字符 | 40rem 理论上限 |\n|---|---|---|---|---|---|\n';
const pick = (arr, vp, pg, sim) => arr.find((r) => r.vp === vp && r.page === pg && r.sim === sim);
for (const vp of VPS) {
  for (const pg of PAGES) {
    const b = pick(e2, vp, pg, 'base');
    const a = pick(e2, vp, pg, 'A-direct');
    const d = pick(e2, vp, pg, 'B-desc');
    if (!b || !a || !d) continue;
    s += '| ' + vp + ' | ' + pg + ' | ' + (b.maxLine != null ? b.maxLine + ' / ' + b.chLine : 'n/a') + ' | **' + (a.maxLine != null ? a.maxLine + ' / ' + a.chLine : 'n/a') + '** | ' + (d.maxLine != null ? d.maxLine + ' / ' + d.chLine : 'n/a') + ' | ' + (b.rootFS ? (40 * b.rootFS) + 'px' : '640px') + ' |\n';
  }
}
s += '\n关键读数（1440，基线 → 40rem 后代写法）：\n\n';
for (const pg of PAGES) {
  const b = pick(e2, 1440, pg, 'base');
  const d = pick(e2, 1440, pg, 'B-desc');
  if (!b || !d) continue;
  s += '- **' + pg + '**：' + b.maxLine + 'px / ' + b.chLine + ' 字符 → **' + d.maxLine + 'px / ' + d.chLine + ' 字符**（' + (d.chLine - b.chLine >= 0 ? '+' : '') + (d.chLine - b.chLine) + ' 字符）\n';
}
s += '\n> 注意 `tuning` 直接子段落只有 26 个、1 个嵌套；`paper` 全页只有 1 个正文档落（`.page-desc` 被排除在外），因此它的「行宽」参考价值最低。\n';

/* ---------- E.2 代码块横滚（关键判据） ---------- */
s += '\n### E.2 代码块横滚是否变化（关键判据）\n\n';
s += '**分两问回答：横滚「数量」与代码块「宽度」。**\n\n';
s += '#### (a) 横滚数量：四种写法下都不变\n\n';
s += '| 视口 | 页面 | 基线 overflow/blocks | A-direct | DESC |\n|---|---|---|---|---|\n';
for (const vp of [1440, 1280, 1025]) {
  for (const pg of ['dialogs', 'particles', 'worldcfg', 'tuning']) {
    const b = pick(e2, vp, pg, 'base');
    const a = pick(e2, vp, pg, 'A-direct');
    const d = pick(e2, vp, pg, 'B-desc');
    if (!b || !a || !d) continue;
    s += '| ' + vp + ' | ' + pg + ' | ' + b.code.overflow + '/' + b.code.blocks + ' | ' + a.code.overflow + '/' + a.code.blocks + ' | ' + d.code.overflow + '/' + d.code.blocks + ' |\n';
  }
}
s += '\n**横滚数完全不变**——因为 `40rem` 只作用于段落级容器，`pre` / `.code-scroll` 不是 `:is(p,ul,ol,blockquote,dl)` 的匹配对象。这是 40rem 方案**优于**「收窄整个内容列」的关键：收窄内容列会显著增加代码横滚，40rem 不会。\n';

s += '\n#### (b) 代码块宽度：`worldcfg` 会被连带压窄（回归风险）\n\n';
s += '```\n';
for (const vp of [1440, 1280]) {
  for (const pg of ['worldcfg', 'dialogs', 'particles']) {
    for (const sim of ['base', 'P', 'D', 'DESC']) {
      const r = pick(e3, vp, pg, sim);
      if (!r) continue;
      s += 'vp=' + vp + ' ' + pg.padEnd(10) + ' ' + sim.padEnd(6) + '  代码块宽 ' + String(r.codeMinW + '~' + r.codeMaxW).padEnd(16) + ' 行宽 ' + String(r.maxLine).padEnd(8) + ' 页高 ' + r.pageHeight + '\n';
    }
    s += '\n';
  }
}
s += '```\n\n';
s += '**根因**：`worldcfg` 的 `<pre>` 嵌在 `<ul>` 里。限宽 `ul` → `ul` 变 640px → 其中的 `.code-scroll` 只能 566px → **代码块白丢 309px 宽度**（874.81 → 566），而横滚数仍是 0/5（因为该页代码本来就窄），所以**光看横滚数会漏掉这个回归**。\n\n';
s += '**解法（实测有效）**：只限**叶节点 `<p>`**，即 `.article p{max-width:40rem}`：\n\n';
s += '| 写法 | worldcfg 行宽 | worldcfg 代码块宽 | 页高 | 说明 |\n|---|---|---|---|---|\n';
for (const sim of ['base', 'P', 'P-li', 'D', 'DESC']) {
  const r = pick(e3, 1440, 'worldcfg', sim);
  if (!r) continue;
  s += '| `' + sim + '` | ' + r.maxLine + ' | ' + r.codeMinW + '~' + r.codeMaxW + ' | ' + r.pageHeight + ' | ' + (sim === 'P' ? '**推荐**：行宽限到 640，代码块保持 850~875' : sim === 'P-li' ? '失效：`li>p` 被排除，行宽回到 918' : sim === 'base' ? '基线' : '代码块被压到 542~566') + ' |\n';
}
s += '\n> `P-li`（额外 `li>p{max-width:none}`）在 worldcfg 上**完全失效**（行宽回到 918.66），因为该页 29 个段落全在 `li` 内。不要用这个变体。\n';

/* ---------- E.3 左边缘与页高 ---------- */
s += '\n### E.3 左边缘对齐与 `pageHeight` 变化\n\n';
s += '#### 左边缘\n\n';
s += '实测（1440，任务书写法 A-direct，`lefts` = 被限宽块的不同左边缘个数）：\n\n';
s += '| 页面 | 首段 left | 被限宽块左边缘个数 | 代码块 left | 表格 left |\n|---|---|---|---|---|\n';
for (const pg of PAGES) {
  const r = e.find((x) => x.vp === 1440 && x.page === pg && x.rem === 40);
  if (!r) continue;
  s += '| ' + pg + ' | ' + r.firstLeft + ' | **' + r.uniqLeftCount + '** | ' + (r.preX != null ? r.preX : 'n/a') + ' | ' + (r.tableX != null ? r.tableX : 'n/a') + ' |\n';
}
s += '\n**左边缘始终对齐（`uniqLeftCount = 1`）** —— 因为 `max-width` 只压右边界，`margin-left` 保持 0，所有被限宽块左边缘都在同一 x。**但代码块/表格的左边缘与段落一致、右边缘更宽**，形成「正文窄、代码宽」的锯齿；这是 40rem 方案的固有形态，需要在视觉验收时明确接受（或给代码块也加同样的 `max-width`，但那会增加横滚）。\n';

s += '\n#### `pageHeight` 变化（逐页给数值）\n\n';
s += '**预期「大幅增加」成立。** 1440 下用任务书写法 A-direct：\n\n';
s += '| 页面 | 基线 pageHeight | 40rem 后 | Δ | Δ% |\n|---|---|---|---|---|\n';
for (const pg of PAGES) {
  const b = pick(e3, 1440, pg, 'base');
  const p = pick(e3, 1440, pg, 'P');
  const d = pick(e3, 1440, pg, 'D');
  if (!b || !d) continue;
  s += '| ' + pg + ' | ' + b.pageHeight + ' | ' + d.pageHeight + ' | **+' + (d.pageHeight - b.pageHeight) + '** | +' + (Math.round(((d.pageHeight - b.pageHeight) / b.pageHeight) * 1000) / 10) + '% |\n';
}
s += '\n各视口汇总（后代写法 DESC，Δ 页高）：\n\n';
s += '| 视口 | ' + PAGES.join(' | ') + ' |\n|---|' + '---|'.repeat(PAGES.length) + '\n';
for (const vp of VPS) {
  s += '| ' + vp + ' | ' + PAGES.map((pg) => {
    const b = pick(e2, vp, pg, 'base');
    const d = pick(e2, vp, pg, 'B-desc');
    if (!b || !d) return 'n/a';
    const dd = d.pageHeight - b.pageHeight;
    return (dd > 0 ? '+' : '') + dd + '（' + (Math.round((dd / b.pageHeight) * 1000) / 10) + '%）';
  }).join(' | ') + ' |\n';
}
s += '\n- `worldcfg` 增幅最大（+4330px，+26.7%）—— 它行宽从 918 压到 617，行数几乎翻倍。\n';
s += '- `paper`（landing）页高恒为 900，因为它整页只有 1 个正文档落，且首屏已占满视口。\n';
s += '- 1025 下多数页面 Δ 为 0：正文已经只有 433px（< 640px 上限），40rem 根本不触发。\n';

/* ---------- E.4 rem 取参 ---------- */
s += '\n### E.4 38 / 40 / 42 / 44rem 取参对比（1440，任务书写法）\n\n';
s += '| rem | 限宽 px | dialogs 行宽/字符 | worldcfg 行宽/字符 | tuning 行宽/字符 | dialogs 页高 | worldcfg 页高 | 代码横滚（dialogs） |\n|---|---|---|---|---|---|---|---|\n';
for (const rem of [38, 40, 42, 44]) {
  const d = e.find((x) => x.vp === 1440 && x.page === 'dialogs' && x.rem === rem);
  const wc = e.find((x) => x.vp === 1440 && x.page === 'worldcfg' && x.rem === rem);
  const t = e.find((x) => x.vp === 1440 && x.page === 'tuning' && x.rem === rem);
  if (!d || !wc || !t) continue;
  s += '| ' + rem + 'rem | ' + (rem * 16) + ' | ' + d.maxLine + ' / ' + d.chLine + ' | ' + wc.maxLine + ' / ' + wc.chLine + ' | ' + t.maxLine + ' / ' + t.chLine + ' | ' + d.pageHeight + ' | ' + wc.pageHeight + ' | ' + d.code.overflow + '/' + d.code.blocks + ' |\n';
}
s += '\n- `dialogs` 在 38–44rem 之间行宽**都是 797.75**（不变）—— 因为它的最长行来自限不到的那 5 个嵌套段落，与 rem 取值无关。**这是 A-direct 写法的测量假象**；改用后代写法后行宽才随 rem 变化（637.98 / 640 / 671.48 / 703.58 对应 38/40/42/44）。\n';
s += '- 后代写法下 40rem → `tuning` 正好 640px/74 字符；42rem → 671.48/78；44rem → 703.58/82。\n';

w('secE.md', s);
