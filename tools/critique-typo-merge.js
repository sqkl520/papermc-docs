'use strict';
/* critique-typo-merge.js -- integrate this agent's 4 unique verified findings into
   reports/critique-typography.md (written by a concurrent agent), instead of clobbering it.
   Idempotent: skips a patch whose marker text is already present.
   Writes UTF-8, no BOM, via fs.writeFileSync(p, s, 'utf8'). */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'reports', 'critique-typography.md');

let s = fs.readFileSync(FILE, 'utf8');
const before = s.length;
const applied = [];
const skipped = [];

const patch = (name, marker, find, replace) => {
  if (s.indexOf(marker) >= 0) { skipped.push(name); return; }
  if (s.indexOf(find) < 0) { skipped.push(name + ' (anchor missing)'); return; }
  s = s.replace(find, replace);
  applied.push(name);
};

/* ---------- 1. code leading trap: fix the line-height table row + add the note ---------- */
patch('code-leading',
  '代码行距陷阱',
  '| 代码块 code | 13.6 | 21.08 | 1.55 | 合理 |',
  '| 代码块 code | 13.6 | **24.8（实测渲染）** | **1.82** | **过松——见下方「代码行距陷阱」** |\n' +
  '\n' +
  '> **代码行距陷阱（本轮新发现，`tools/critique-typo-z.js`）**：`.article pre code` 声明 `font-size:.85rem`（13.6px）配 `line-height:1.55` → 计算值 21.08px，**但屏幕上真正的行距是 24.8px**。原因是 `<pre class="code-pre">` 自身仍是 16px/1.55，它的 **strut（行盒撑高）24.8px** 大于内部 `code` 的 21.08px，于是每行被撑到 24.8px。实测：对 10 个代码块（3–96 行）做 `(盒高 − 上下 padding) ÷ 行数`，**全部返回 24.79–24.80px**（`_typo-critique/z-codeleading.json`），与 `Range` 逐字符测得的行间距 24.8px 吻合。\n' +
  '> **代价**：`/paper/dev/dialogs/` 共 243 行代码 → 比 21.08px 多占 **904px 页高**（该页 13737px 的 6.6%）；`/paper/reference/world-configuration/` 29 行 → 多占 108px。\n' +
  '> **修法**：`.code-pre{font-size:.875rem}`（让 strut 跟着缩到 21.7px）。**只改 `code` 的 font-size 无效**——撑高的是 `pre` 自己的 strut。');

/* ---------- 2. link vs body text (WCAG 1.4.1) ---------- */
patch('link-1.4.1',
  '链接可辨识性',
  '| 链接 `--accent` | 6.70 | 7.28 | 7.28 | 全 PASS |',
  '| 链接 `--accent` | 6.70 | 7.28 | 7.28 | 全 PASS |\n' +
  '| **链接色 vs 正文色（WCAG 1.4.1）** | **2.46 ✗** | **2.03 ✗** | 2.03 ✗ | **不达标且链接无下划线——见下** |\n' +
  '\n' +
  '> **链接可辨识性（本轮新发现，`tools/critique-typo-n.js` / `-g.js`）**：上表「链接 `--accent` 6.70/7.28 PASS」只说明**链接对背景**看得清。但 WCAG **1.4.1（Use of Color）** 要求：若链接**仅靠颜色**与周围文字区分，链接色与正文色之间需 **≥3:1**。实测 `#1d4ed8` vs 正文 `#1c1f26` = **2.46:1**（dark `#7aa2ff` vs `#e6e8ec` = **2.03:1**），而 `site.css:51` 是 `a{text-decoration:none}`——全站正文 **70 个链接中 0 个**有下划线（仅 hover 出现；`linksUnderlined: 0`）。\n' +
  '> **修法（零色板改动）**：正文链接加 `text-decoration:underline`（`text-underline-offset:.16em`），导航类（`.chip`/`.tbtn`/侧栏/TOC/pager）保持无线；或链接色改 `#2563eb`（对正文 **3.19**、对白底 **5.17**，双边达标）。');

/* ---------- 3. ch vs real chars ---------- */
patch('ch-vs-chars',
  '`ch` 与「真实字符数」差',
  '3. `p50` 极低（7.7–22.1ch）不是排版问题',
  '3. `p50` 极低（7.7–22.1ch）不是排版问题');

patch('ch-vs-chars-body',
  '`ch` 与「真实字符数」差',
  '判断行宽应看 `p90/max`。',
  '判断行宽应看 `p90/max`。\n' +
  '4. **`ch` 与「真实字符数」差 17–23%，跨站对比不可直接比 `ch`**（`tools/critique-typo-t.js` 逐字符实测）。本表 `capCh` 的分母是 `1ch = 8.63px`（`0` 字宽），但正文平均字符宽只有 **7.0–7.4px**（`avgAdvancePx: 7.41`）。所以 **98.4ch 对应的真实字符数是 115**（849 ÷ 7.38），**110ch 对应 117–126**。拿 98.4ch 去和 VitePress 85ch、Starlight 66.9ch 比会得出「只超一点」的错误结论——真实差距是 **115 vs 85–90 字符**。**本报告正文凡引用「字符/行」均指真实字符数（含空格）**；表中 `capCh` 只是容器容量的标准化刻度。');

/* ---------- 4. correct the line-break table rows + verdict ---------- */
patch('break-rows',
  'aa.js',
  '| `overflow-wrap:anywhere`（`.article`, `site.css:194`） | **1440 与 390 下正文词中断 0 次**；关闭后也 0 次，文档宽度不变（1440→1440） |\n' +
  '| 320 下正文词中断 | 1 处（`notice-type`，含连字符，属正常断点） |\n' +
  '| 代码/表格内词中断（390） | **10 处**；320 下 **19 处**（如 `DialogAfterAction` 断成 3 行、`AsyncPlayerConnectionConfigureEvent`） |',
  '| `overflow-wrap:anywhere`（`.article`, `site.css:194`） | **1440 下正文词中断 0 次**（与 `p4` 一致）；**390 下 12 次、320 下 19 次**（`tools/critique-typo-aa.js`：逐字符 Range + 行聚类，并标注断点所在元素） |\n' +
  '| 320 下词中断归因 | 19 处中 **14 处在行内 `<code>` 内**、**5 处在纯文本**（如 `<td>confirmation → confir\\|mation`、`multiple → multip\\|le`） |\n' +
  '| 代码/表格内词中断（390） | **12 处**（`aa.js`×正确口径；`p4` 为 10）；8 处在行内 `<code>`、4 处在纯文本 `<td>`。典型：`DialogAfterAction → Dialog\\|AfterAction`、`ActionButton → ActionButt\\|on`、`Component → Comp\\|onent` |\n' +
  '| 768 下词中断 | 1 处（`<td>confirmation`） |');

patch('break-verdict',
  '**`overflow-wrap:anywhere` 的指控不成立**',
  '- **`overflow-wrap:anywhere` 的指控不成立**（见 §0.5）。它在正文里是**安全网**，实测未触发；真正被切断的是**代码块与表格单元格**（390 下 10 处、320 下 19 处）——那是 `<td>` 与 `<code>` 的自然换行，可接受（代码长标识符必须能断，否则横向溢出）。',
  '- **`overflow-wrap:anywhere` 的指控「部分成立」，需修正前一节的结论**：1440 下确实 0 次（它是安全网）；但 **390/320 下真实发生**（12 / 19 次），且**不只在代码块**——有 4–5 处是**纯文本 `<td>`**（`confirmation`、`multiple`、`actions`、`server`）被从单词中间切开，`<td>` 本身并没有 `overflow-wrap:anywhere`，是被 `.article{overflow-wrap:anywhere}`（`site.css:194`）继承下来的。这类「5 字母单词被拆成 `confir|mation`」不是必要的防溢出，是**副作用**。\n' +
  '- **可量化改善**（`tools/critique-typo-n.js` 对照实验，320px，仅替换 wrapper）：`anywhere` → **30 处**词中断；改 `break-word` → **9 处**，且**文档横向溢出仍为 0px**。说明 `break-word` 已足够兜住长 token，`anywhere` 的额外断词是不必要的。');

patch('break-advice',
  '② `overflow-wrap:anywhere` **保留**',
  '② `overflow-wrap:anywhere` **保留**（它是防溢出的安全网，实测无害）；③ 若想更严谨，正文用 `overflow-wrap:break-word`（只在必要时断）+ 代码块保留 `anywhere`。',
  '② 正文 `overflow-wrap` 由 `anywhere` 改为 **`break-word`**（实测词中断 30 → 9，横向溢出仍 0px），`anywhere` 只留给真正需要防撑宽的窄容器（`.chip` / `.pth` / `.page-footer` / 侧栏 `.grp-name`）；③ 代码块内的长标识符本来走 `.code-scroll` 横滚，不需要靠断词。');

fs.writeFileSync(FILE, s, 'utf8');
console.log('APPLIED (' + applied.length + '): ' + JSON.stringify(applied));
console.log('SKIPPED (' + skipped.length + '): ' + JSON.stringify(skipped));
console.log('size ' + before + ' -> ' + s.length);
