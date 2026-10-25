'use strict';
/**
 * b2b2-sec2.js — 生成报告 B / C 小节 markdown 到 %TEMP%\b2b2\（只读数据）
 * 用法：node tools/b2b2-sec2.js b|c
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(process.env.TEMP || '.', 'b2b2');
const rd = (n) => JSON.parse(fs.readFileSync(path.join(TMP, n), 'utf8'));
const w = (n, s) => { const f = path.join(TMP, n); fs.writeFileSync(f, s, 'utf8'); console.log('wrote ' + f + ' (' + s.length + ' chars)'); };
const which = process.argv[2] || 'b';

if (which === 'b') {
  const d = rd('b.json');
  const g = (id) => d.find((x) => x.id === id);
  let s = '';

  s += '### B.1 主曲线 new/b0/old（1200→1300 逐 1px，101 点）\n\n';
  s += '测点：`/paper/dev/dialogs/`，`setViewportSize` 逐 1px 后读 `article.clientWidth`；行宽为同点正文全局最长行盒（Range）。\n\n';
  s += '| sweep | 1200 artW | 1300 artW | 最大单步 Δ | 位置 |\n|---|---|---|---|---|\n';
  for (const id of ['new-1200-1300', 'b0-1200-1300', 'old-1200-1300', 'new-1200-1300-sim1200', 'new-1200-1300-sim1280']) {
    const r = g(id);
    const a = r.maxDelta.at;
    s += '| `' + id + '` | ' + r.points[0].artClientW + ' | ' + r.points[r.points.length - 1].artClientW + ' | '
      + (a ? (r.maxDelta.d > 0 ? '+' : '') + r.maxDelta.d + 'px' : 'n/a') + ' | '
      + (a ? a.from + '→' + a.to + '（' + a.before + '→' + a.after + '）' : 'n/a') + ' |\n';
  }

  s += '\n### B.2 当前断崖定位与幅度\n\n';
  const ns = g('new-1015-1035');
  const step = (sweepId, from, to) => {
    const r = g(sweepId);
    const a = r.points.find((p) => p.vw === from);
    const b = r.points.find((p) => p.vw === to);
    return { a, b };
  };
  const s1023 = step('new-1015-1035', 1023, 1024);
  const s1024 = step('new-1015-1035', 1024, 1025);
  s += '**结论：断崖不在 1025 单点，而是 1023→1025 的「两级台阶」，总计 −536px。**\n\n';
  s += '| 台阶 | 视口 | article.clientWidth | 正文行宽 | 每行字符 | TOC | grid-template-columns | Δ |\n|---|---|---|---|---|---|---|---|\n';
  s += '| — | 1023 | ' + s1023.a.artClientW + ' | ' + s1023.a.line.w + ' | ' + s1023.a.line.ch + ' | ' + s1023.a.tocMode + ' | `' + s1023.a.cols + '` | — |\n';
  s += '| **①** | 1024 | ' + s1023.b.artClientW + ' | ' + s1023.b.line.w + ' | ' + s1023.b.line.ch + ' | ' + s1023.b.tocMode + ' | `' + s1023.b.cols + '` | **' + (s1023.b.artClientW - s1023.a.artClientW) + 'px** |\n';
  s += '| **②** | 1025 | ' + s1024.b.artClientW + ' | ' + s1024.b.line.w + ' | ' + s1024.b.line.ch + ' | ' + s1024.b.tocMode + ' | `' + s1024.b.cols + '` | **' + (s1024.b.artClientW - s1024.a.artClientW) + 'px** |\n';

  s += '\n**两级台阶的成因（读 CSS 证实，非推测）：**\n\n';
  s += '1. **1023→1024（−279px）**：`@media (min-width:1024px){ .layout{grid-template-columns:280px minmax(0,1fr)} }`（`assets/site.css:601`）落地，侧栏从 off-canvas 浮层变为 **280px 常驻列**；但常驻右栏要到 `min-width:1025px`（`:639`）才出现。于是 **1024px 落入「左右双栏但无 TOC」的死区**：侧栏吃掉 280px，正文列仅 744px。1023 及以下是单栏（`grid-template-columns: 1023px`），正文 972px。\n';
  s += '2. **1024→1025（−259px）**：`@media (min-width:1025px)` 生效，`grid-template-columns` 变为 `290px 485px 250px` —— 侧栏 280→290，且 250px TOC 列进场，正文再让出 250px+10px。\n';
  s += '3. **批 1 没有消除这个双台阶**：new 与 b0 在 1015→1035 的曲线逐点完全相同（见 B.3）。批 1 改的是 TOC 在 <1025 的呈现形态（top-block / sticky 限制），不是 1024 死区的列宽。\n';

  s += '\n### B.3 1024↔1025 断崖是否仍在\n\n';
  s += '| 视口 | new artW | b0 artW | old artW | new TOC | old TOC |\n|---|---|---|---|---|---|\n';
  for (const v of [1022, 1023, 1024, 1025, 1026]) {
    const p = (id) => g(id).points.find((x) => x.vw === v);
    const n = p('new-1015-1035'); const b = p('b0-1015-1035'); const o = p('old-1015-1035');
    s += '| ' + v + ' | ' + n.artClientW + ' | ' + b.artClientW + ' | ' + o.artClientW + ' | ' + n.tocMode + ' | ' + o.tocMode + ' |\n';
  }
  s += '\n- **new 与 b0 逐点相同**（1015…1035 全部 21 点）⇒ 批 1 对该区间的列宽**零贡献**，双台阶完全是批 0 引入的。\n';
  s += '- **old（批 0 之前）没有断崖**：1015→1035 逐点只 +1px 线性增长（artW 671→691），TOC 恒 `hidden`。断崖是**批 0 把常驻右栏断点从 1200 下调到 1024/1025 的副作用**。\n';
  s += '- old 的断崖在 **1200→1201**：artW 856→597（−259px），TOC 由 hidden 变 rail（见 B.4 末行）。\n';

  s += '\n### B.4 TOC 断点改到 1200 / 1280 的模拟曲线\n\n';
  s += '模拟手法：在样式表末尾追加同特异度、后出现的 `@media`，把「≥1025 常驻右栏」整体搬到 ≥bp，并在 `1025…bp−0.02` 区间退回 280px 单栏 + 隐藏 `.toc-side`（CSS 见 `tools/b2b2-b.js` 的 `SIM_CSS`）。\n\n';
  s += '| 方案 | 1200 artW | 1300 artW | 最大单步 Δ | 断崖位置 | 断崖前 artW | 断崖后 artW |\n|---|---|---|---|---|---|---|\n';
  for (const [label, id] of [['现状（bp=1025）', 'new-1200-1300'], ['模拟 bp=1200', 'new-1200-1300-sim1200'], ['模拟 bp=1280', 'new-1200-1300-sim1280']]) {
    const r = g(id); const a = r.maxDelta.at;
    s += '| ' + label + ' | ' + r.points[0].artClientW + ' | ' + r.points[r.points.length - 1].artClientW + ' | '
      + (a ? (r.maxDelta.d > 0 ? '+' : '') + r.maxDelta.d + 'px' : '—') + ' | '
      + (a ? a.from + '→' + a.to : '无（1200–1300 内无断崖）') + ' | '
      + (a ? a.before : '—') + ' | ' + (a ? a.after : '—') + ' |\n';
  }
  s += '\n关键点位（模拟 bp=1280）：\n\n';
  s += '```\n';
  for (const v of [1276, 1277, 1278, 1279, 1280, 1281, 1282]) {
    const p = g('new-1200-1300-sim1280').points.find((x) => x.vw === v);
    s += 'vw=' + v + '  artW=' + String(p.artClientW).padStart(4) + '  行宽=' + (p.line ? String(p.line.w).padStart(6) : '     -') + '  ch=' + (p.line ? String(p.line.ch).padStart(3) : '  -') + '  TOC=' + p.tocMode + '  cols=' + p.cols + '\n';
  }
  s += '```\n\n';
  s += '> **模拟的局限（必须写明）**：注入只改 `grid-template-columns` 与 `.toc-side` 显隐，`@media (min-width:1280px){.content{max-width:1000px}}`（`:607`）的原规则仍在 1280 处生效。因此模拟 bp=1280 曲线在 1280 前的 artW 是 948（受 1000px 上限约束的 999px 正文列），断崖后是 689。真实实施时若同时调整 `max-width`，幅度会不同。`max-width:1000px` 在 **b0 与 old 中同样存在**（old 实测 1440 下 artW=836 < 900），不是批 0/批 1 引入。\n';
  w('secB.md', s);
}

if (which === 'c') {
  const d = rd('c.json');
  const B = 'new';
  const pick = (pg) => d.find((x) => x.build === B && x.page === pg);
  let s = '';
  s += '### C.1 computed font-size / line-height 与实际行推进\n\n';
  s += '测法：`<code>` 全体建 Range → `getClientRects()` 每行一 rect → 相邻 `top` 差取中位数（对高亮 `<span>` 嵌套有效）。视口 1440×900。\n\n';
  s += '| 页面 | 代码块 | `pre` font-size | `pre` line-height | `code` font-size | `code` line-height | **实测行推进** | 推进 ÷ code font-size |\n|---|---|---|---|---|---|---|---|\n';
  for (const pg of ['particles', 'dialogs', 'worldcfg']) {
    const r = pick(pg); const b = r.variants[0];
    s += '| ' + pg + ' | ' + b.blockCount + ' | ' + b.preFS + 'px | ' + b.preLH + 'px | ' + b.codeFS + 'px | ' + b.codeLH + 'px | **' + b.advMode + 'px** | ' + (b.codeFS ? Math.round((b.advMode / b.codeFS) * 1000) / 1000 : 'n/a') + ' |\n';
  }

  s += '\n### C.2 strut 判定\n\n';
  s += '**strut 仍在，且三方完全一致（批 0 / 批 1 都没动）。**\n\n';
  s += '| 构建 | particles 行推进 | dialogs 行推进 | worldcfg 行推进 | `pre` FS | `code` FS |\n|---|---|---|---|---|---|\n';
  for (const build of ['new', 'b0', 'old']) {
    const cells = ['particles', 'dialogs', 'worldcfg'].map((pg) => {
      const r = d.find((x) => x.build === build && x.page === pg);
      const b = r.variants[0];
      return b.advMode + 'px';
    });
    const b0v = d.find((x) => x.build === build && x.page === 'dialogs').variants[0];
    s += '| ' + build + ' | ' + cells.join(' | ') + ' | ' + b0v.preFS + 'px | ' + b0v.codeFS + 'px |\n';
  }
  s += '\n机制（`assets/site.css`）：\n\n';
  s += '- `.code-pre{...;line-height:1.55;...}`（`:292`）—— `pre` 自身 **font-size 16px**（未设，继承根字号），故 `pre` 的行高基准 = 16 × 1.55 = **24.8px**。\n';
  s += '- `.article pre code{...;font-size:.85rem}`（`:280`）—— `code` 是 **13.6px**，行高继承 `1.55` 得到 **21.08px**。\n';
  s += '- 但**行盒高度由块容器 `pre` 的 strut 决定**：`pre` 里的匿名行盒用 `pre` 自己的 font-size 建 strut，`code` 是 inline 子元素、只缩小自身字形不改 strut。⇒ 实际每行推进 **24.8px**，比 `code` 应有的 21.08px 多 **3.72px/行**（+17.6%）。\n';
  s += '- 证据：实测行推进 24.8px 与 `pre` 的 computed line-height 24.8px **完全相等**，而与 `code` 的 21.08px 不等。\n';

  s += '\n### C.3 注入 `.code-pre{font-size:.875rem}` 后\n\n';
  s += '| 页面 | 行推进 基线 | 行推进 注入后 | Δ | 页高 基线 | 页高 注入后 | Δ页高 | 代码横滚 基线 | 注入后 |\n|---|---|---|---|---|---|---|---|---|\n';
  for (const pg of ['particles', 'dialogs', 'worldcfg']) {
    const r = pick(pg);
    const b = r.variants[0]; const v = r.variants[1];
    s += '| ' + pg + ' | ' + b.advMode + 'px | ' + v.advMode + 'px | ' + (Math.round((v.advMode - b.advMode) * 100) / 100) + 'px | '
      + b.pageHeight + ' | ' + v.pageHeight + ' | **' + (v.pageHeight - b.pageHeight) + 'px** | '
      + b.overflow + '/' + b.blockCount + ' | ' + v.overflow + '/' + v.blockCount + ' |\n';
  }
  s += '\n- `.code-pre{font-size:.875rem}`（14px）把 `pre` 的 strut 降到 14 × 1.55 = 21.7px，行推进 24.8→**21.69px**（−3.11px/行，−12.5%），页高显著下降。\n';
  s += '- **代码块横滚数不变**（4/46、5/13、0/5 全保持）—— 因为 `.code-scroll>.code-pre{min-width:max-content}`（`:309`）让滚动由内容宽度决定，字号变小只会缩短内容，不会新增横滚。\n';
  s += '- 但行推进 21.69px 对应 `code` 自身 font-size 14px × 1.55 = 21.7px，**恰好等于**（差 0.01px 为取整）⇒ strut 被消除，行高回归 `code` 本征值。\n';

  s += '\n其他变体（dialogs，1440）：\n\n| 变体 | CSS | 行推进 | 页高 | 代码横滚 |\n|---|---|---|---|---|\n';
  for (const v of pick('dialogs').variants) {
    s += '| ' + v.id + ' | `' + (v.css || '（基线）') + '` | ' + v.advMode + 'px | ' + v.pageHeight + ' | ' + v.overflow + '/' + v.blockCount + ' |\n';
  }
  w('secC.md', s);
}
