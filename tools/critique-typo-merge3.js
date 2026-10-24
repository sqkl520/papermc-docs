'use strict';
/* critique-typo-merge3.js -- third pass: rewrite the appendix section that still claims
   "anywhere never fires at 1440 or 390". Idempotent. UTF-8 no BOM. */
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

rep('appendix-css',
  ':not(pre)>code{ overflow-wrap:anywhere }   /* 行内代码允许断 */\n.article{ overflow-wrap:anywhere }          /* 正文兜底 */',
  ':not(pre)>code{ overflow-wrap:break-word } /* 行内代码：只在必要时断 */\n.article{ overflow-wrap:break-word }        /* 正文兜底（原 anywhere，见下） */');

rep('appendix-prose',
  '初看像「到处乱断」，但实测（`p4`）证明它**在有空间时根本不触发**：1440 与 390 下正文词中断 **0 次**，关闭该属性后文档宽度不变（1440→1440）。它只在**极端窄容器**里救场——这是「安全网」而非「常规断行」。',
  '初看像「到处乱断」。实测分部结论（`p4` + 本轮 `tools/critique-typo-aa.js` 复核）：**1440 下确实 0 次**，它确实是安全网；**但 390 下 12 次、320 下 19 次**，且经元素归因，其中 **4–5 处发生在纯文本 `<td>`**（`confirmation`→`confir|mation`、`multiple`→`multip|le`、`actions`→`action|s`、`server`→`serve|r`），这些 `<td>` 自身没有 `overflow-wrap`，是被 `.article` 继承的。对照实验（320px，仅换 wrapper）：`anywhere` 30 处 → `break-word` **9 处**，文档横向溢出仍 **0px**。因此：**该属性在宽屏是安全网，在窄屏是可见副作用**，建议正文降级为 `break-word`。');

fs.writeFileSync(FILE, s, 'utf8');
console.log('APPLIED (' + applied.length + '): ' + JSON.stringify(applied));
console.log('MISSED (' + missed.length + '): ' + JSON.stringify(missed));
console.log('size ' + before + ' -> ' + s.length);
