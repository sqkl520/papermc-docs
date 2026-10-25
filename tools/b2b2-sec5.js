'use strict';
/**
 * b2b2-sec5.js — 生成报告 F 小节（给规划的结论）markdown 到 TMPDIR\b2b2\secF.md
 * 用法：node tools/b2b2-sec5.js
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(require("os").tmpdir() || '.', 'b2b2');
const rd = (n) => JSON.parse(fs.readFileSync(path.join(TMP, n), 'utf8'));
const w = (n, s) => { const f = path.join(TMP, n); fs.writeFileSync(f, s, 'utf8'); console.log('wrote ' + f + ' (' + s.length + ' chars)'); };

const a = rd('a.json');
const b = rd('b.json');
const b2 = rd('b2.json');
const b3 = rd('b3.json');
const c = rd('c.json');
const e2 = rd('e2.json');
const e3 = rd('e3.json');

const gA = (build, vp, page) => a.find((r) => r.build === build && r.vp === vp && r.page === page);
const gE = (arr, vp, pg, sim) => arr.find((r) => r.vp === vp && r.page === pg && r.sim === sim);

let s = '';

/* ---------- F.1 批 2 取值 ---------- */
s += '### F.1 批 2 该取什么值（40rem 方案）\n\n';
s += '**结论：取 40rem，但选择器必须改成「后代 + 只限叶段落」，并且必须排除列表项内的段落。**\n\n';
s += '实测依据（1440，new）：\n\n';
s += '| 写法 | 能限住的段落 | dialogs 行宽 | worldcfg 行宽 | worldcfg 代码块宽 | 结论 |\n|---|---|---|---|---|---|\n';
const rows = [
  ['`.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}`（任务书原写法）', '只限 article 直接子元素', gE(e2, 1440, 'dialogs', 'A-direct'), gE(e2, 1440, 'worldcfg', 'A-direct'), gE(e3, 1440, 'worldcfg', 'D'), '**不采用**：worldcfg 的 `<ul>` 被限宽 → 代码块 874.81→566px（−309px）'],
  ['`.article :is(p,ul,ol,blockquote,dl){max-width:40rem}`（后代）', '全部（含容器）', gE(e2, 1440, 'dialogs', 'B-desc'), gE(e2, 1440, 'worldcfg', 'B-desc'), gE(e3, 1440, 'worldcfg', 'DESC'), '**不采用**：同样压窄代码块（542~566px）'],
  ['`.article p{max-width:40rem}`（只限叶段落）', '全部 `<p>`，不含容器', gE(e3, 1440, 'dialogs', 'P'), gE(e3, 1440, 'worldcfg', 'P'), gE(e3, 1440, 'worldcfg', 'P'), '**✅ 推荐**：代码块保持 850.81~874.81px 原宽'],
  ['`.article p{max-width:40rem}` + `.article li>p{max-width:none}`', '排除列表内段落', gE(e3, 1440, 'dialogs', 'P-li'), gE(e3, 1440, 'worldcfg', 'P-li'), gE(e3, 1440, 'worldcfg', 'P-li'), '**不采用**：worldcfg 段落全在 `li` 内 → 行宽回到 918.66，等于没做'],
];
for (const [name, cov, dl, wc, wcode, verdict] of rows) {
  s += '| ' + name + ' | ' + cov + ' | ' + (dl ? dl.maxLine + ' / ' + dl.chLine : 'n/a') + ' | ' + (wc ? wc.maxLine + ' / ' + wc.chLine : 'n/a') + ' | ' + (wcode ? wcode.codeMinW + '~' + wcode.codeMaxW : 'n/a') + ' | ' + verdict + ' |\n';
}
s += '\n**推荐写法（实测最优）：**\n\n```css\n.article p{max-width:40rem}\n```\n\n';
s += '- 只限 `<p>`（叶节点），**不碰** `ul/ol/dl/blockquote` 等容器 —— 容器里可能嵌 `pre.code-pre`，限容器会连带压窄代码块。\n';
s += '- 40rem = 640px（根字号未缩放时）。实测 dialogs 行宽 848.36 → **637.98**（98 → 74 字符），worldcfg 918.66 → **636.89**（107 → 74 字符）。\n';
s += '- 若想更宽，42rem（672px）→ dialogs 671.48 / 78 字符；44rem（704px）→ 703.58 / 82 字符。**40rem 是唯一让各行宽都落在 640±2px 且字符数 74 的取值**，推荐值。\n';

s += '\n### F.2 断崖该切在哪\n\n';
s += '**先说结论：不是「把断点搬到 1200 或 1280」，而是「让侧栏断点与 TOC 断点重合」。**\n\n';
s += '现状是**两级台阶**（实测，`/paper/dev/dialogs/`）：\n\n';
s += '```\n';
s += 'vw=1022  artW= 971  TOC=top-block   cols=1022px\n';
s += 'vw=1023  artW= 972  TOC=top-block   cols=1023px\n';
s += 'vw=1024  artW= 693  TOC=hidden      cols=280px 744px    ← 台阶① −279px（侧栏 280px 进场、TOC 未进）\n';
s += 'vw=1025  artW= 434  TOC=rail        cols=290px 485px 250px ← 台阶② −259px（TOC 250px 进场）\n';
s += '```\n\n';
s += '成因（读 CSS 证实）：\n\n';
s += '- `@media (min-width:1024px)`（`assets/site.css:601`）→ 侧栏成为 280px 常驻列。\n';
s += '- `@media (min-width:1025px)`（`:639`）→ 250px TOC 列进场。\n';
s += '- **两个断点差 1px，中间夹出一个「有侧栏、无 TOC」的死区**。\n\n';
s += '四个修法的实测对照（`1021→1300` 逐 1px，找所有 ≥20px 台阶；`tools/b2b2-b3.js`）：\n\n';
s += '| 修法 | ≥20px 台阶 | 评价 |\n|---|---|---|\n';
for (const r of b3) {
  const st = r.steps.map((x) => x.from + '→' + x.to + '：' + (x.d > 0 ? '+' : '') + x.d + 'px（' + x.before + '→' + x.after + '）').join('；');
  let verdict = '';
  if (r.id === 'base-1000-1320') verdict = '基线（两级台阶）';
  else if (r.id.startsWith('FixAlign1025')) verdict = '**单级 −515px**：把侧栏/TOC 都绑到 1025。台阶①消失（只余 −23px 的 `max-width:1000px` 生效），但台阶②合并后放大到 −515px';
  else if (r.id.startsWith('FixAlign1200')) verdict = '**推荐**：两级合并为**单级 −340px**，且落在 1200（改造前的原始断点）';
  else if (r.id.startsWith('FixAlign1280')) verdict = '单级 −260px，落在 1280；但 1280 已接近 `max-width:1000px` 上限，收益有限';
  else verdict = '与 FixAlign1200 完全相同（1000px 上限在 1200 处已生效，改 1280 无差）';
  s += '| `' + r.id + '` | ' + st + ' | ' + verdict + ' |\n';
}

s += '\n**残留的 −23px 是什么（必须写清，否则会被当成没修干净）：**\n\n';
s += '`.content{padding:1.4rem 1.6rem 3rem;max-width:1000px}`（`assets/site.css:610`）是**基础规则，没有媒体查询**，它一直在。\n';
s += '1023 及以下：`.content` 实际宽度 1023px < 1000px？不 —— 1023 > 1000，所以本该早就生效。实测 `content.w = 1023`（1023 时）、`1000`（1024 时），差异来自 `.layout` 在 1024 以下是否建立 grid 轨道：\n\n';
s += '```\n';
s += 'vw=1023  content.w=1023  artW=971.81\n';
s += 'vw=1024  content.w=1000  artW=948.81   ← max-width:1000px 开始约束（此前被 grid 单列的 1fr 撑到 1023）\n';
s += '```\n';
s += '即 `max-width:1000px` 在 1024 才「表现出来」，因此任何把断点放在 ≥1025 的修法都会残留这 **−23px**。\n';
s += '**这是可以接受的**：23px 远低于感知阈值（约 2.3%），且方向正确（窄屏更窄）。若要求「零台阶」，需同时把 `max-width` 也纳管到同一断点。\n';

s += '\n**推荐方案（给批 3）：**\n\n';
s += '1. 把「侧栏常驻」与「TOC 常驻」绑到**同一个断点**。取 **1200px**（改造前的原始值，也是 `b1-ruling` 记载的原始断点），得到**单级 −340px**、无死区。\n';
s += '2. 若必须保留 1025（已上线的选择），则至少把侧栏断点从 1024 提到 1025，让两级合并为一级 −515px。**但 −515px 的突变幅度过大，不推荐。**\n';
s += '3. 不要选 1280：会让 1025–1279 全部退化为单栏，等于放弃这一整段宽度的信息密度（实测 1200 下正文 609px、1025 下仅 434px）。\n';

/* ---------- F.3 基线数值表 ---------- */
s += '\n### F.3 基线数值表（供后续改动对拍）\n\n';
s += '口径：`new` = HEAD `f3ebbfc`；`artW` = `article.clientWidth`；`lineW` = 正文全局最长行盒；`ch` = `round(lineW / 8.63)`；`h` = `scrollHeight`。**任何批 2/3 改动后，这张表应逐格复测。**\n\n';

s += '#### F.3.1 正文行宽基线（new，10 视口 × 4 个有 article 的页）\n\n';
s += '| 视口 | paper artW/lineW/ch/h | dialogs artW/lineW/ch/h | worldcfg artW/lineW/ch/h | tuning artW/lineW/ch/h |\n|---|---|---|---|---|\n';
for (const vp of ['1440', '1280', '1200', '1100', '1025', '1024', '900', '768', '390', '320']) {
  const cell = (pg) => {
    const r = gA('new', vp, pg);
    if (!r || !r.prose) return 'n/a';
    return r.articleClientW + ' / ' + r.prose.lineWGlobal + ' / ' + r.prose.chLineGlobal + ' / ' + r.pageHeight;
  };
  s += '| ' + vp + ' | ' + ['paper', 'dialogs', 'worldcfg', 'tuning'].map(cell).join(' | ') + ' |\n';
}

s += '\n#### F.3.2 代码块横滚基线（new，`overflow/blocks`）\n\n';
s += '| 视口 | dialogs | worldcfg | tuning | particles |\n|---|---|---|---|---|\n';
for (const vp of ['1440', '1280', '1200', '1100', '1025', '1024', '900', '768', '390', '320']) {
  const cell = (pg) => { const r = gA('new', vp, pg); return r && r.code ? r.code.overflow + '/' + r.code.blocks : 'n/a'; };
  s += '| ' + vp + ' | ' + ['dialogs', 'worldcfg', 'tuning', 'particles'].map(cell).join(' | ') + ' |\n';
}
s += '\n> `particles` 不在 A 组 6 页内，此处数值取自 C 组（1440）与 E 组（1280/1025）；A 组未覆盖的格标 `n/a`。\n';

s += '\n#### F.3.3 代码 strut 基线（C 组，1440）\n\n';
s += '| 页面 | 行推进 | `pre` FS/LH | `code` FS/LH | 代码块高 | 页高 | 页高（注入 .875rem 后） |\n|---|---|---|---|---|---|---|\n';
for (const pg of ['particles', 'dialogs', 'worldcfg']) {
  const r = c.find((x) => x.build === 'new' && x.page === pg);
  const v0 = r.variants[0]; const v1 = r.variants[1];
  s += '| ' + pg + ' | ' + v0.advMode + 'px | ' + v0.preFS + ' / ' + v0.preLH + ' | ' + v0.codeFS + ' / ' + v0.codeLH + ' | ' + v0.preH + 'px | ' + v0.pageHeight + ' | ' + v1.pageHeight + '（' + (v1.pageHeight - v0.pageHeight) + 'px） |\n';
}

s += '\n#### F.3.4 40rem 预演基线（E 组，4 视口 × 5 页 × 4 写法）\n\n';
s += '完整数据在 `TMPDIR\\b2b2\\e.json` / `e2.json` / `e3.json`。下表给「基线 + 推荐写法（`.article p`）」两列，作为对拍锚点：\n\n';
s += '| 视口 | 页面 | 基线 lineW/ch/h | 40rem（`.article p`）lineW/ch/h | 代码块宽 基线 → 40rem |\n|---|---|---|---|---|\n';
for (const vp of [1440, 1280, 1025]) {
  for (const pg of ['dialogs', 'worldcfg', 'particles', 'tuning']) {
    const base = gE(e3, vp, pg, 'base');
    const p = gE(e3, vp, pg, 'P');
    if (!base || !p) continue;
    s += '| ' + vp + ' | ' + pg + ' | ' + base.maxLine + ' / ' + base.chLine + ' / ' + base.pageHeight + ' | '
      + p.maxLine + ' / ' + p.chLine + ' / ' + p.pageHeight + ' | ' + base.codeMinW + '~' + base.codeMaxW + ' → ' + p.codeMinW + '~' + p.codeMaxW + ' |\n';
  }
}

s += '\n#### F.3.5 待验改动的验收判据（可直接照抄成断言）\n\n';
s += '| 改动 | 断言 | 基线值 | 期望值 |\n|---|---|---|---|\n';
s += '| 批 2：`.article p{max-width:40rem}` | 1440 dialogs 正文最长行 | 848.36px / 98 字符 | **637.98px / 74 字符**（±3px） |\n';
s += '| 批 2：同上 | 1440 worldcfg 正文最长行 | 918.66px / 107 字符 | **636.89px / 74 字符**（±3px） |\n';
s += '| 批 2：同上 | 1440 dialogs 代码横滚 | 5/13 | **仍 5/13**（不得增加） |\n';
s += '| 批 2：同上 | 1440 worldcfg 代码块宽 | 850.81~874.81px | **保持不变**（若变 542~566 说明误用了容器选择器） |\n';
s += '| 批 2：同上 | 1440 worldcfg 页高 | 16214 | **16683**（+469，+2.9%） |\n';
s += '| 批 3：代码 strut `.code-pre{font-size:.875rem}` | dialogs 行推进 | 24.8px | **21.69px** |\n';
s += '| 批 3：同上 | dialogs 页高 | 13805 | **13050**（−755） |\n';
s += '| 批 3：同上 | dialogs 代码横滚 | 5/13 | **仍 5/13**（不得增加） |\n';
s += '| 批 3：断点合并到 1200 | 1023→1200 逐 1px 的 ≥20px 台阶 | 2 个（−279 / −259） | **1 个（1200 处 −340px）** |\n';
s += '| 批 3：同上 | 1024 处 artW | 693（死区） | **949**（与 1023 同一单调序列） |\n';
s += '| 批 3：图片宽高 | 89 张内容图带 `width`+`height` | **0 张** | **89 张** |\n';
s += '| 批 3：同上 | dialogs@1440 CLS | **0.1258** | **< 0.1**（实测 JS 回填的极限收益仅到 0.1258，静态写死才有望达标） |\n';

s += '\n### F.4 未测 / 测不到的项目（诚实标注）\n\n';
s += '- **`<pre>` 内高亮 `<span>` 对行推进的影响**：未单独测（当前 `advUniq` 显示 24.79 / 24.80 两值，差 0.01px 属浮点，无独立影响）。\n';
s += '- **真实网络下的 CLS**：本报告用 CDP 限速 220KB/s + 冷缓存模拟，非真实 4G/3G。数值只用于**相对比较**（new vs b0 vs old、补宽高前后）。\n';
s += '- **图片静态宽高的最终 CLS**：无法在不修改 HTML 的前提下测「构建期写死 width/height」的效果（本报告只能用 JS 运行期回填，收益偏低）。需批 3 实施后复测。\n';
s += '- **`/paper/` 之外的分区首页**（`/velocity/`、`/folia/`）未纳入 A 组 6 页，其列宽结构应与 `/paper/` 同构（未验证）。\n';
s += '- **打印样式 / `prefers-reduced-motion` 路径**未测（不在批 2/3 范围）。\n';

w('secF.md', s);
