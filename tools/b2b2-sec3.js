'use strict';
/**
 * b2b2-sec3.js — 生成报告 D / E 小节 markdown 到 TMPDIR\b2b2\（只读数据）
 * 用法：node tools/b2b2-sec3.js d|e
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(require("os").tmpdir() || '.', 'b2b2');
const rd = (n) => JSON.parse(fs.readFileSync(path.join(TMP, n), 'utf8'));
const w = (n, s) => { const f = path.join(TMP, n); fs.writeFileSync(f, s, 'utf8'); console.log('wrote ' + f + ' (' + s.length + ' chars)'); };
const which = process.argv[2] || 'd';

if (which === 'd') {
  const d = rd('d.json');
  const st = d.static;
  let s = '';

  s += '### D.1 `width`/`height` 属性覆盖率\n\n';
  s += '测法：静态解析仓库内全部 `.html`（排除 `archive/`、`node_modules/`、`tools/`、`reports/`），正则抓 `<img ...>`，数属性。**实测口径与任务书不一致，先纠正数量**：\n\n';
  s += '| 项 | 实测 | 说明 |\n|---|---|---|\n';
  s += '| HTML 文件总数 | ' + st.htmlFiles + ' | 产物全量 |\n';
  s += '| 含 `<img>` 的页面 | ' + st.pagesWithImg + ' | — |\n';
  s += '| `<img>` 标签总数 | ' + st.imgTags + ' | 任务书说「89 张」，见下 |\n';
  s += '| 其中**有 `src`** | ' + st.withSrc + ' | **89 —— 与任务书的「89 张图」吻合** |\n';
  s += '| 无 `src` 的占位 | ' + (st.imgTags - st.withSrc) + ' | 每页 1 个 lightbox 占位 `<img alt="">`（`#lightbox` 内），非内容图 |\n';
  s += '| 带 `width` | **' + st.withW + '** | — |\n';
  s += '| 带 `height` | **' + st.withH + '** | — |\n';
  s += '| **同时带 `width` 和 `height`** | **' + st.withBoth + '** | **0 / ' + st.withSrc + ' = 0%** |\n';
  s += '| 带内联 `aspect-ratio` | ' + st.withAspect + ' | — |\n';
  s += '| CSS 里有 `aspect-ratio` | `' + st.cssHasAspectRatio + '` | `assets/site.css` 全文无此属性 |\n';
  s += '| `loading="lazy"` | ' + st.lazy + ' | 只有 `content-img` 带；lightbox 占位为 eager |\n';
  s += '| `alt=""` | ' + st.altEmpty + ' | 全部是 lightbox 占位（无 src 的 164 个） |\n';
  s += '\n图片类名分布：' + st.classes.map(([k, v]) => '`' + k + '` = ' + v).join('、') + '。\n\n';
  s += '**结论：89 张内容图（`img.content-img`）全部没有 `width`/`height`，CSS 侧也没有 `aspect-ratio` 兜底。**';
  s += '唯一相关的 CSS 是 `img.content-img{max-width:100%;height:auto;...}`（`:70`）—— `height:auto` 正是导致「加载前高度塌缩、加载后撑开」的写法。\n\n';
  s += '图片最多的页面（前 8）：\n\n| 页面 | img 数 | 带宽高 |\n|---|---|---|\n';
  for (const p of st.topPages.slice(0, 8)) s += '| `' + p.file.replace(/\\/g, '/') + '` | ' + p.imgs + ' | ' + p.withBoth + ' |\n';

  s += '\n### D.2 实测 CLS\n\n';
  s += '测法：`PerformanceObserver({type:\'layout-shift\', buffered:true})`，**只累加 `!entry.hadRecentInput`** 的 `value`。为放大「图片迟到」的位移：每次新 context（冷缓存）+ CDP `Network.setCacheDisabled(true)` + `emulateNetworkConditions`（120ms 延迟、220KB/s 下行）+ **滚到底再滚回顶**（触发全部 `loading=lazy`）。视口 1440×900 与 390×844 各测一遍。\n\n';
  s += '| 构建 | 视口 | 页面 | CLS（未补宽高） | 条目 | 最大单次 | CLS（补 naturalWidth/Height 后） | Δ |\n|---|---|---|---|---|---|---|---|\n';
  const key = (r) => r.build + '|' + r.vp + '|' + r.page;
  const byKey = new Map();
  for (const r of d.cls) {
    if (r.error) continue;
    const k = key(r);
    if (!byKey.has(k)) byKey.set(k, {});
    byKey.get(k)[r.patch ? 'patched' : 'base'] = r;
  }
  for (const [k, v] of byKey) {
    const [build, vp, page] = k.split('|');
    const a = v.base || {}; const b = v.patched || {};
    const delta = (a.cls != null && b.cls != null) ? (Math.round((b.cls - a.cls) * 10000) / 10000) : null;
    s += '| ' + build + ' | ' + vp + ' | ' + page + ' | **' + (a.cls != null ? a.cls : 'n/a') + '** | ' + (a.entries != null ? a.entries : 'n/a') + ' | ' + (a.max != null ? a.max : 'n/a') + ' | ' + (b.cls != null ? b.cls : 'n/a') + ' | ' + (delta != null ? (delta > 0 ? '+' : '') + delta : 'n/a') + ' |\n';
  }

  s += '\n**要点：**\n\n';
  const good = d.cls.filter((r) => !r.error && r.cls > 0.1);
  s += '- 唯一有实质 CLS 的是 `/paper/dev/dialogs/`（7 张图）：new@1440 = **0.1258**、new@390 = 0.04；b0@390 = **0.9804**（最高）。\n';
  s += '- 其余 3 页 CLS ≈ 0：它们正文只有 1 张图（且在首屏内已加载），或根本没有内容图。**全站 CLS 风险实测集中在图片密集页**，不在所有页。\n';
  s += '- `worldcfg` / `tuning` / `paper` 三页的 `imgs=1` 是 lightbox 占位（`noDim=1`），不是内容图 —— 无图可移位。\n';
  s += '- b0@390 的 0.9804（最大单次 0.9336）说明该页在移动端有一次近乎整屏的位移；new 的批 1 改动把它从 0.98 降到 0.04，但**1440 下仍留下 0.1258**。\n';
  s += '- **补 `naturalWidth/naturalHeight` 的效果不稳定**：dialogs@1440 new 无变化（0.1258→0.1258），b0@1440 从 0.1601→0.1263、b0@390 从 0.9804→0.9562。原因是脚本只能在**图片已加载后**回填，此时首次位移已经发生；真实修法是**在 HTML 里静态写死 `width`/`height`**（或 CSS `aspect-ratio`），让浏览器在布局前就知道尺寸。\n';
  s += '- 因此 D 组的可执行结论：**P1-1 应做静态宽高（构建期从图片文件读尺寸写入 `width`/`height`），而不是运行期 JS 回填**。本报告的 JS 回填测法只能作为「上限收益」的下界参考。\n';
  w('secD.md', s);
}
