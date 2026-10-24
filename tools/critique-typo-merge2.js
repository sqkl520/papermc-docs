'use strict';
/* critique-typo-merge2.js -- second pass: correct the remaining "anywhere is harmless"
   claims (verdict, advice, summary table, CSS block, appendix) now that 390/320 breaks
   are measured and attributed. Idempotent. UTF-8 no BOM. */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'reports', 'critique-typography.md');

let s = fs.readFileSync(FILE, 'utf8');
const before = s.length;
const applied = [];
const missed = [];

const rep = (name, find, replace) => {
  const i = s.indexOf(find);
  if (i < 0) { missed.push(name); return; }
  s = s.slice(0, i) + replace + s.slice(i + find.length);
  applied.push(name);
};

/* verdict bullet in section 10 */
rep('verdict',
  '- **`overflow-wrap:anywhere` 的指控不成立**（见 §0.5）。它在正文里是**安全网**，实测未触发；真正被切断的是**代码块与表格单元格**（390 下 10 处、320 下 19 处）——那是 `<td>` 与 `<code>` 的自然换行，可接受（代码长标识符必须能断，否则横向溢出）。',
  '- **`overflow-wrap:anywhere` 的指控「部分成立」，本条修正 §0.5 的结论**：1440 下确实 0 次（它是安全网）；但 **390/320 下真实发生（12 / 19 次）**，且**不只在代码块**——4–5 处是**纯文本 `<td>`**（`confirmation`→`confir|mation`、`multiple`→`multip|le`、`actions`→`action|s`、`server`→`serve|r`）被从词中间切开。`<td>` 自身并无 `overflow-wrap`，是被 `.article{overflow-wrap:anywhere}`（`site.css:194`）继承的。5 字母单词被拆开不是必要的防溢出，是**副作用**。\n' +
  '- **可量化改善**（`tools/critique-typo-n.js`，320px，仅替换 wrapper 的对照实验）：`anywhere` → **30 处**词中断；`break-word` → **9 处**，且**文档横向溢出仍为 0px**。说明 `break-word` 已足够兜住长 token。');

/* advice line */
rep('advice',
  '**具体数值建议**：① 构建时在 `汉字↔拉丁` 边界插入 `U+2009`（thin space）或普通空格；② `overflow-wrap:anywhere` **保留**（它是防溢出的安全网，实测无害）；③ 若想更严谨，正文用 `overflow-wrap:break-word`（只在必要时断）+ 代码块保留 `anywhere`。',
  '**具体数值建议**：① 构建时在 `汉字↔拉丁` 边界插入 `U+2009`（thin space）或普通空格；② 正文 `overflow-wrap` 由 `anywhere` 改为 **`break-word`**（实测 30 → 9 处，横向溢出仍 0px）；③ `anywhere` 只留给真正需要防撑宽的窄容器（`.chip` / `.pth` / `.page-footer` / 侧栏 `.grp-name`）；代码块长标识符走 `.code-scroll` 横滚，不需要靠断词。');

/* summary/decision table row */
rep('summary-row',
  '| `.article{overflow-wrap:anywhere}`（`site.css:194`） | 实测未造成正文词中断（1440/390 均 0 次），**不要删**——它是长 URL/长 token 的防溢出安全网。 | 保留 |',
  '| `.article{overflow-wrap:anywhere}`（`site.css:194`） | 1440 下 0 次，但 **390 下 12 次、320 下 19 次**（含纯文本 `confir\\|mation`）。**改为 `break-word`**（实测 30→9，溢出 0px）。 | **改** |');

/* CSS snippet */
rep('css',
  '  :not(pre)>code{ overflow-wrap:anywhere }   /* 行内代码允许断 */\n.article{ overflow-wrap:anywhere }          /* 正文兜底 */',
  '  :not(pre)>code{ overflow-wrap:break-word } /* 行内代码：只在必要时断 */\n.article{ overflow-wrap:break-word }        /* 正文兜底（原 anywhere） */');

fs.writeFileSync(FILE, s, 'utf8');
console.log('APPLIED (' + applied.length + '): ' + JSON.stringify(applied));
console.log('MISSED (' + missed.length + '): ' + JSON.stringify(missed));
console.log('size ' + before + ' -> ' + s.length);
