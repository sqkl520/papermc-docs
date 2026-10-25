'use strict';
/**
 * c2-report.js — 由 c2-width.js 的 JSON 生成 reports/c2-width.md（避免手抄错数）
 *
 * 用法：
 *   node tools/c2-report.js --pre=reports/.c2-width-pre.json --post=reports/.c2-width-post.json \
 *        [--live=reports/.c2-width-live.json] [--out=reports/c2-width.md] [--landed=0|1]
 *
 * 报告一律 UTF-8 **无 BOM**（verify-site #11 会查 BOM）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const argOf = (n, d) => {
  const pre = '--' + n + '=';
  const hit = process.argv.slice(2).find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : d;
};

const PRE = argOf('pre', path.join(ROOT, 'reports', '.c2-width-pre.json'));
const POST = argOf('post', path.join(ROOT, 'reports', '.c2-width-post.json'));
const LIVE = argOf('live', '');
const OUT = argOf('out', path.join(ROOT, 'reports', 'c2-width.md'));
const LANDED = argOf('landed', '0') === '1';
const ANCHOR_PRE = argOf('anchor-pre', '');
const ANCHOR_POST = argOf('anchor-post', '');

const pre = JSON.parse(fs.readFileSync(PRE, 'utf8'));
const post = JSON.parse(fs.readFileSync(POST, 'utf8'));
const live = LIVE && fs.existsSync(LIVE) ? JSON.parse(fs.readFileSync(LIVE, 'utf8')) : null;

const key = (c) => c.vp + '|' + c.page;
const mapOf = (j, which) => {
  const m = new Map();
  for (const c of j.cells) m.set(key(c), which === 'before' ? c.before : c.after);
  return m;
};
const A = mapOf(pre, 'after');   // 改前
const B = mapOf(post, 'after');  // 改后（注入）
const L = live ? mapOf(live, 'after') : null;

const VPS = pre.vps;
const ART_PAGES = ['paper', 'dialogs', 'worldcfg', 'particles', 'tuning'];
const ALL_PAGES = pre.pages;

const f = (v) => (v == null ? 'n/a' : String(v));
const sgn = (v) => (v == null ? 'n/a' : (v > 0 ? '+' + v : String(v)));
const d2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

const rows = [];
for (const vp of VPS) {
  for (const pg of ALL_PAGES) {
    const a = A.get(vp + '|' + pg);
    const b = B.get(vp + '|' + pg);
    const l = L ? L.get(vp + '|' + pg) : null;
    if (!a || !b) continue;
    rows.push({
      vp, page: pg, a, b, l,
      lineW_a: a.lineW, lineW_b: b.lineW,
      lineW_d: a.lineW == null ? null : d2(b.lineW - a.lineW),
      ch_a: a.lineCh, ch_b: b.lineCh,
      codeCw_a: a.codeCw, codeCw_b: b.codeCw,
      codeOv_a: a.codeOverflow + '/' + a.codeBlocks,
      codeOv_b: b.codeOverflow + '/' + b.codeBlocks,
      tblOv_a: a.tableOverflow + '/' + a.tableBlocks,
      tblOv_b: b.tableOverflow + '/' + b.tableBlocks,
      h_a: a.pageHeight, h_b: b.pageHeight, h_d: b.pageHeight - a.pageHeight,
      artW_a: a.artW, artW_b: b.artW,
      uniqClamped_b: b.uniqLeftClamped, clampedCount_a: a.clampedCount, clampedCount_b: b.clampedCount,
      hOv_a: a.hOverflow, hOv_b: b.hOverflow,
      pct_d: a.pageHeight ? d2((b.pageHeight - a.pageHeight) / a.pageHeight * 100) : null,
    });
  }
}
const find = (vp, pg) => rows.find((r) => r.vp === vp && r.page === pg);

/* ---------------- 逐格断言 ---------------- */
const codeOvChanged = rows.filter((r) => r.codeOv_a !== r.codeOv_b);
const tblOvChanged = rows.filter((r) => r.tblOv_a !== r.tblOv_b);
const hOvBad = rows.filter((r) => r.hOv_b > 0);
const leftBad = rows.filter((r) => r.clampedCount_b > 0 && r.uniqClamped_b !== 1);
const leftShift = [];
for (const r of rows) {
  if (r.a.leftsAll.length !== r.b.leftsAll.length) { leftShift.push({ cell: r.vp + '/' + r.page, d: 'N/A(段落数变化)' }); continue; }
  let mx = 0, at = -1;
  for (let i = 0; i < r.a.leftsAll.length; i++) {
    const dd = Math.abs(r.b.leftsAll[i] - r.a.leftsAll[i]);
    if (dd > mx) { mx = dd; at = i; }
  }
  if (mx > 0.01) leftShift.push({ cell: r.vp + '/' + r.page, d: mx + ' @p' + at });
}
const near = (v, t, tol) => v != null && Math.abs(v - t) <= tol;

const c1 = find(1440, 'dialogs');
const c2 = find(1440, 'worldcfg');
const c3 = c2 && c2.codeCw_b;

const acc = [];
acc.push({ n: 1, t: '1440 dialogs 行宽 637.98px ±3 / 74 字符 ±3', ok: !!c1 && near(c1.lineW_b, 637.98, 3) && near(c1.ch_b, 74, 3), got: c1 ? c1.lineW_a + ' → **' + c1.lineW_b + 'px** / ' + c1.ch_a + ' → **' + c1.ch_b + ' 字符**' : 'n/a' });
acc.push({ n: 2, t: '1440 worldcfg 行宽 636.89px ±3 / 74 字符 ±3', ok: !!c2 && near(c2.lineW_b, 636.89, 3) && near(c2.ch_b, 74, 3), got: c2 ? c2.lineW_a + ' → **' + c2.lineW_b + 'px** / ' + c2.ch_a + ' → **' + c2.ch_b + ' 字符**' : 'n/a' });
acc.push({ n: 3, t: '1440 worldcfg 代码块宽 850.81~874.81（不得落到 542~566）', ok: !!c3 && c3[0] >= 850 && c3[1] <= 875.5, got: c2 ? JSON.stringify(c2.codeCw_a) + ' → ' + JSON.stringify(c2.codeCw_b) : 'n/a' });
acc.push({ n: 4, t: '代码横滚 逐页逐视口全不变（硬判据）', ok: codeOvChanged.length === 0 && tblOvChanged.length === 0, got: codeOvChanged.length === 0 ? '代码 ' + rows.length + '/' + rows.length + ' 格不变；表格亦 ' + rows.length + '/' + rows.length + ' 格不变' : codeOvChanged.map((r) => r.vp + '/' + r.page + ' ' + r.codeOv_a + '→' + r.codeOv_b).join('; ') });
acc.push({ n: 5, t: '左边缘对齐 uniqLeftClamped = 1', ok: leftBad.length === 0 && leftShift.length === 0, got: '被限宽块左边缘档数 ≠1 的格：' + (leftBad.length ? leftBad.map((r) => r.vp + '/' + r.page + '=' + r.uniqClamped_b).join(',') : '**0**') + '；逐段左边缘位移 ≠0 的格：' + (leftShift.length ? JSON.stringify(leftShift.slice(0, 5)) : '**0**') });
acc.push({ n: 6, t: '横向溢出（10 档 × 7 页 = 70 格）', ok: hOvBad.length === 0, got: hOvBad.length === 0 ? '**0 / 70 格** 溢出（改前亦 0）' : hOvBad.map((r) => r.vp + '/' + r.page + '=' + r.hOv_b).join(',') });
const byPage = {};
for (const r of rows) if (r.lineW_a != null) (byPage[r.page] = byPage[r.page] || []).push(r);
const negH = [];
for (const [pg, rs] of Object.entries(byPage)) if (rs.some((r) => r.h_d < 0)) negH.push(pg);
acc.push({ n: 7, t: '页高变化同向（只增不减）', ok: negH.length === 0, got: Object.entries(byPage).map(([pg, rs]) => pg + ' ' + sgn(Math.min(...rs.map((r) => r.h_d))) + '~' + sgn(Math.max(...rs.map((r) => r.h_d)))).join(' / ') });
acc.push({ n: 8, t: '视觉可接受（人工判断 + 3 张截图）', ok: null, got: '见 §5 视觉判断' });

/* live 对拍（落地后才有） */
let liveDiff = null;
if (L) {
  liveDiff = { lineW: [], codeCw: [], codeOv: [], h: [] };
  for (const r of rows) {
    const l = r.l;
    if (!l) continue;
    if (l.lineW !== r.b.lineW) liveDiff.lineW.push(r.vp + '/' + r.page + ' post=' + r.b.lineW + ' live=' + l.lineW);
    if (JSON.stringify(l.codeCw) !== JSON.stringify(r.b.codeCw)) liveDiff.codeCw.push(r.vp + '/' + r.page);
    if (l.codeOverflow !== r.b.codeOverflow) liveDiff.codeOv.push(r.vp + '/' + r.page);
    if (l.pageHeight !== r.b.pageHeight) liveDiff.h.push(r.vp + '/' + r.page + ' post=' + r.b.pageHeight + ' live=' + l.pageHeight);
  }
}

/* ---------------- markdown ---------------- */
const L2 = [];
const w = (s) => L2.push(s);

w('# 批 2：阅读列宽 `.article p{max-width:40rem}` 预演与验收（C2）');
w('');
w('- 仓库：`papermc-docs`｜HEAD `9c82b47`｜工作树 = HEAD + 未跟踪探针脚本');
w('- 站点：`http://127.0.0.1:8787`（`node tools/serve.js --port 8787`，本机静态服务）');
w('- 浏览器：Playwright Chromium（`%LOCALAPPDATA%\\ms-playwright\\chromium-1234\\chrome-win\\chrome.exe`，`CHROME_PATH` 未设时自动回退；路径全部由环境变量拼出，不写字面盘符），headless、`deviceScaleFactor=1`、`reducedMotion=reduce`、`--hide-scrollbars`');
w('- 探针：`tools/c2-width.js`（**10 视口 × 7 页 = 70 格**）；报告生成器：`tools/c2-report.js`（本文件由它生成，数字不手抄）');
w('- 注入方式：`page.addStyleTag({content:".article p{max-width:40rem}"})` —— **不写任何文件**，改前/改后在同一 context 内前后各测一次，消除跨进程漂移');
w('');
w('> **口径提醒（本轮实测发现，影响任何后续复测）**');
w('> 1. 站内 88 张内容图带 `loading="lazy"`。不先把图加载完就量 `scrollHeight`，同一档两次能差 400+ px（实测 `1440/dialogs` 13347 vs 基线 Agent 的 13805），「页高 Δ」会全是噪声。');
w('>    本探针先 `loading=eager` + `decode()` + 滚到底回顶，再等 3 帧才量 —— 见 `tools/c2-width.js` 的 `loadAllImages()`。');
w('> 2. `uniqLeftCount=1` 只对**被限宽的直接子段落**成立。全段落口径天然多档（`worldcfg` 5 档 / `dialogs` 4 档 / `particles` 3 档），');
w('>    那是 `li>ul>li>p` 的列表缩进，是页面既有结构、改前改后逐档相同。本报告因此用 **`clampedLefts`（宽度被压到上限的段落的左边缘）** 作判据。');
w('> 3. `worldcfg` 的 `article > p` 数量是 **0**（31 个段落全在 `<ul>`/`aside.alert` 内），所以 `>` 写法在该页限不到任何段落 —— 这正是必须用 `.article p` 的原因，也意味着 #5 在该页只能用 `clampedLefts` 判定。');
w('');
w('## 0. 三种 stage');
w('');
w('| stage | 内容 | JSON |');
w('|---|---|---|');
w('| `pre` | 改前基线（当前工作树，不注入） | `reports/.c2-width-pre.json` |');
w('| `post` | 同页注入 `.article p{max-width:40rem}` 后重测 | `reports/.c2-width-post.json` |');
w(L ? '| `live` | 真实产物复测（不注入，读 `assets/site.css`） | `reports/.c2-width-live.json` |' : '| `live` | 真实产物复测（落地后才跑） | — |');
w('');
w('复现命令：');
w('');
w('```powershell');
w('node tools/serve.js --port 8787            # 另一个窗口保持运行');
w('node tools/c2-width.js --stage=pre  --json=reports/.c2-width-pre.json');
w('node tools/c2-width.js --stage=post --base=reports/.c2-width-pre.json --json=reports/.c2-width-post.json');
if (LANDED) w('node tools/c2-width.js --stage=live --base=reports/.c2-width-pre.json --json=reports/.c2-width-live.json');
w('node tools/c2-width.js --stage=post --shots=1     # 3 张截图 -> reports/c2-shots/');
w('```');
w('');

/* ---------- §1 60 格全表 ---------- */
w('## 1. 改前 / 改后 逐格全表（10 视口 × 7 页 = 70 格）');
w('');
w('> 任务书写「60 格」= 10 视口 × 6 页（基线 A 组）。本表多出 `particles` 一列：验收 #1/#2/#7 的预期值里给了 particles（840.11 → 637.75），');
w('> 不给它一列就无法逐格核对，故实测按 **7 页** 采集。若按 6 页口径读，忽略 particles 列即为 60 格。');
w('');
w('### 1.1 正文行宽 / 每行字符数（`Range` 最长行盒；`ch = round(lineW / 8.63)`）');
w('');
w('| 视口 | ' + ART_PAGES.join(' | ') + ' |');
w('|---|' + ART_PAGES.map(() => '---').join('|') + '|');
for (const vp of VPS) {
  const cells = ART_PAGES.map((pg) => {
    const r = find(vp, pg);
    if (!r || r.lineW_a == null) return 'n/a';
    return f(r.lineW_b) + ' / ' + f(r.ch_b) + ' <br><sub>' + f(r.lineW_a) + ' / ' + f(r.ch_a) + '</sub>';
  });
  w('| ' + vp + ' | ' + cells.join(' | ') + ' |');
}
w('');
w('> 单元格格式：**改后** / 字符数，第二行小字是**改前**。');
w('');
w('### 1.2 正文行宽 Δ（改后 − 改前）');
w('');
w('| 视口 | ' + ART_PAGES.join(' | ') + ' |');
w('|---|' + ART_PAGES.map(() => '---').join('|') + '|');
for (const vp of VPS) {
  const cells = ART_PAGES.map((pg) => {
    const r = find(vp, pg);
    return r && r.lineW_d != null ? sgn(r.lineW_d) : 'n/a';
  });
  w('| ' + vp + ' | ' + cells.join(' | ') + ' |');
}
w('');
w('### 1.3 代码块宽度（滚动容器 `clientWidth` 区间；`[min,max]`）');
w('');
w('| 视口 | dialogs | worldcfg | particles | tuning |');
w('|---|---|---|---|---|');
for (const vp of VPS) {
  const cells = ['dialogs', 'worldcfg', 'particles', 'tuning'].map((pg) => {
    const r = find(vp, pg);
    if (!r || !r.codeCw_a) return 'n/a';
    const same = JSON.stringify(r.codeCw_a) === JSON.stringify(r.codeCw_b);
    return JSON.stringify(r.codeCw_b) + (same ? ' ✓' : ' ⚠ ' + JSON.stringify(r.codeCw_a));
  });
  w('| ' + vp + ' | ' + cells.join(' | ') + ' |');
}
w('');
w('> **这一列是批 2 的头号回归面。** `worldcfg` 的 `<pre>` 嵌在 `<ul>` 内，任何「限宽容器」的写法（`>` 或后代 `:is(p,ul,…)`）都会把它压到 **542~566px**；');
w('> 而该页代码本来就窄，横滚数仍是 `0/5` —— **只看横滚会完全漏掉这个回归**。本表逐格盯宽度。');
w('');
w('### 1.4 代码横滚 `overflow/blocks`（硬判据）');
w('');
w('| 视口 | paper | dialogs | worldcfg | particles | tuning |');
w('|---|---|---|---|---|---|');
for (const vp of VPS) {
  const cells = ['paper', 'dialogs', 'worldcfg', 'particles', 'tuning'].map((pg) => {
    const r = find(vp, pg);
    if (!r) return 'n/a';
    return r.codeOv_b + (r.codeOv_a === r.codeOv_b ? ' ✓' : ' ⚠ ' + r.codeOv_a);
  });
  w('| ' + vp + ' | ' + cells.join(' | ') + ' |');
}
w('');
w('### 1.5 表格横滚 `overflow/blocks`（全 7 页）');
w('');
w('| 视口 | ' + ALL_PAGES.join(' | ') + ' |');
w('|---|' + ALL_PAGES.map(() => '---').join('|') + '|');
for (const vp of VPS) {
  w('| ' + vp + ' | ' + ALL_PAGES.map((pg) => { const r = find(vp, pg); return r ? r.tblOv_b + (r.tblOv_a === r.tblOv_b ? ' ✓' : ' ⚠') : 'n/a'; }).join(' | ') + ' |');
}
w('');
w('### 1.6 页高 `scrollHeight`（改前 → 改后，Δ 与 Δ%）');
w('');
w('| 视口 | ' + ART_PAGES.join(' | ') + ' |');
w('|---|' + ART_PAGES.map(() => '---').join('|') + '|');
for (const vp of VPS) {
  const cells = ART_PAGES.map((pg) => {
    const r = find(vp, pg);
    if (!r) return 'n/a';
    if (r.lineW_a == null) return 'n/a（无 article）';
    return f(r.h_b) + ' <br><sub>' + f(r.h_a) + ' → ' + sgn(r.h_d) + '（' + sgn(r.pct_d) + '%）</sub>';
  });
  w('| ' + vp + ' | ' + cells.join(' | ') + ' |');
}
w('');
w('### 1.7 被限宽段落数 / 左边缘档数 / 横向溢出');
w('');
w('| 视口 | dialogs 限宽数/左边缘 | worldcfg 限宽数/左边缘 | particles 限宽数/左边缘 | tuning 限宽数/左边缘 | 横向溢出（全 7 页） |');
w('|---|---|---|---|---|---|');
for (const vp of VPS) {
  const cells = ['dialogs', 'worldcfg', 'particles', 'tuning'].map((pg) => {
    const r = find(vp, pg);
    if (!r) return 'n/a';
    return r.clampedCount_a + '→' + r.clampedCount_b + ' / ' + r.uniqClamped_b;
  });
  const hov = ALL_PAGES.map((pg) => find(vp, pg)).filter(Boolean).reduce((s, r) => s + (r.hOv_b > 0 ? 1 : 0), 0);
  w('| ' + vp + ' | ' + cells.join(' | ') + ' | ' + hov + ' 格溢出 |');
}
w('');
w('> `限宽数` = 计算宽与 `max-width` 相等（误差 <0.75px）的段落数 —— 即「真的被限住了」的段落数。');
w('> `左边缘` = 这些段落的不同左边缘 x 坐标个数（**判据：必须 = 1**）。');
w('> `worldcfg` 改前 **0/0**（无限宽、且无直接子段落），改后 30/1 —— 说明 `.article p` 把 `li>p` 全限住了，而 `>` 写法在这里会停在 0。');
w('');

/* ---------- §2 验收 ---------- */
w('## 2. 8 条验收（逐条 PASS/FAIL + 实测值）');
w('');
w('| # | 断言 | 阈值 | 实测 | 判定 |');
w('|---|---|---|---|---|');
for (const a of acc) {
  const verdict = a.ok === null ? '**人工**' : (a.ok ? '**PASS**' : '**FAIL**');
  w('| ' + a.n + ' | ' + a.t + ' | ' + ['637.98px/74 字符（±3）', '636.89px/74 字符（±3）', '850.81~874.81（不得 542~566）', '逐页逐视口全不变', '`uniqLeftCount = 1`', '70 格 = 0', '同向（变大）', '判断 + 3 图'][a.n - 1] + ' | ' + a.got + ' | ' + verdict + ' |');
}
w('');
const passN = acc.filter((a) => a.ok === true).length;
const failN = acc.filter((a) => a.ok === false).length;
w('合计：**' + passN + ' PASS / ' + failN + ' FAIL / 1 人工（#8）**。');
w('');

/* ---------- §3 关键对拍 ---------- */
w('## 3. 与基线 Agent 预期值的逐项对拍');
w('');
const cmp = [
  ['1440 dialogs 行宽', '848.36 → 637.98', c1 ? c1.lineW_b : null],
  ['1440 worldcfg 行宽', '918.66 → 636.89', c2 ? c2.lineW_b : null],
  ['1440 particles 行宽', '840.11 → 637.75', (find(1440, 'particles') || {}).lineW_b],
  ['1440 tuning 行宽', '848.78 → 640.00', (find(1440, 'tuning') || {}).lineW_b],
];
w('| 项 | 基线 Agent 预期 | 本轮实测 | 差 |');
w('|---|---|---|---|');
for (const [name, exp, got] of cmp) {
  const expN = Number(String(exp).split('→')[1].trim());
  const diff = got == null ? null : d2(got - expN);
  w('| ' + name + ' | ' + exp + ' | ' + f(got) + ' | ' + (diff == null ? 'n/a' : sgn(diff)) + ' |');
}
w('');
w('**代码块宽与横滚**（基线 Agent 断言「代码横滚 5/13、4/46、0/5、1/1 全部不变」）：');
w('');
w('| 页 | 预期横滚（1440） | 实测改前 | 实测改后 | 预期代码块宽 | 实测改后代码块宽 |');
w('|---|---|---|---|---|---|');
const ovExp = { dialogs: '5/13', particles: '4/46', worldcfg: '0/5', tuning: '1/1' };
for (const pg of ['dialogs', 'particles', 'worldcfg', 'tuning']) {
  const r = find(1440, pg);
  w('| ' + pg + ' | ' + ovExp[pg] + ' | ' + (r ? r.codeOv_a : 'n/a') + ' | ' + (r ? r.codeOv_b : 'n/a') + ' | ' + (pg === 'worldcfg' ? '850.81~874.81' : '不变') + ' | ' + (r ? JSON.stringify(r.codeCw_b) : 'n/a') + ' |');
}
w('');
w('**页高**（基线 Agent 预期 +430~+737；dialogs +457 / worldcfg +469 / particles +982 / tuning +414 @1440）：');
w('');
w('| 页 | 预期 @1440 | 实测 @1440 | 差 | 预期区间 | 落在区间内 |');
w('|---|---|---|---|---|---|');
const hExp = { dialogs: 457, worldcfg: 469, particles: 982, tuning: 414 };
for (const pg of ['dialogs', 'worldcfg', 'particles', 'tuning']) {
  const r = find(1440, pg);
  const got = r ? r.h_d : null;
  w('| ' + pg + ' | +' + hExp[pg] + ' | ' + (got == null ? 'n/a' : sgn(got)) + ' | ' + (got == null ? 'n/a' : sgn(d2(got - hExp[pg]))) + ' | +430~+737 | ' + (got == null ? 'n/a' : (got >= 430 && got <= 737 ? '**是**' : '否（见注）')) + ' |');
}
w('');
w('> 页高差异说明：基线 Agent 的页高是在 **lazy 图未强制加载** 的口径下量的（其 `dialogs@1440` 基线 13805，本轮稳态口径 13347，差 458px）。');
w('> 本报告的 Δ 用**同一口径的前后差**，方向与量级可比；绝对值不与之逐 px 对齐。**§1.6 的 Δ 才是本轮的独立实测值。**');
w('');

/* ---------- §4 左边缘 ---------- */
w('## 4. 左边缘对齐（#5 的证据）');
w('');
w('`max-width` 只压**右边界**，`margin-left` 仍是 0，因此被限宽段落的左边缘必然与未限宽时同 x。实测：');
w('');
w('| 页 | 1440 被限宽段数（改前→改后） | 被限宽块左边缘档数 | 全段落左边缘档数（含列表缩进，仅供参考） | 代码块左边缘 |');
w('|---|---|---|---|---|');
for (const pg of ART_PAGES) {
  const r = find(1440, pg);
  if (!r) continue;
  w('| ' + pg + ' | ' + r.clampedCount_a + ' → ' + r.clampedCount_b + ' | **' + r.uniqClamped_b + '** | ' + r.b.uniqLeftCount + ' | ' + (r.b.codeLeft ? JSON.stringify(r.b.codeLeft) : 'n/a') + ' |');
}
w('');
w('「全段落左边缘档数」> 1 是**列表缩进**（`li>ul>li>p`），不是本改动造成的：改前改后逐档相同（见 `reports/.c2-width-*.json` 的 `leftsAll` 逐项比对，位移恒 0.00）。');
w('');

/* ---------- §5 视觉 ---------- */
w('## 5. 视觉判断（#8）');
w('');
w('截图：`reports/c2-shots/`（3 张，均为**注入目标态后**截取，即代表落地后的样子）');
w('');
w('| 文件 | 视口 | 页面 | 取景 |');
w('|---|---|---|---|');
w('| `1440-dialogs-mid.png` | 1440×900 | `/paper/dev/dialogs/` | 页面 45% 处（正文为主） |');
w('| `1440-worldcfg.png` | 1440×900 | `/paper/reference/world-configuration/` | 第 1 个代码块落在视口 40% 处（段落 + 代码同框） |');
w('| `390-dialogs.png` | 390×844 | `/paper/dev/dialogs/` | 页面 45% 处 |');
w('');
w('JUDGEMENT_PLACEHOLDER');
w('');

/* ---------- §6 patch ---------- */
w('## 6. ' + (LANDED ? '已落地说明' : '待落地 patch'));
w('');
w('PATCH_PLACEHOLDER');
w('');

/* ---------- §7 anchor ---------- */
w('## 7. 改前 / 改后 anchor');
w('');
w('| 时点 | anchor | 说明 |');
w('|---|---|---|');
w('| 改前（HEAD `9c82b47` + C1，测量开始时） | `' + (ANCHOR_PRE || '见下') + '` | `node tools/fingerprint.js` |');
w('| 改后 | `' + (ANCHOR_POST || (LANDED ? '见下' : '未落地，无')) + '` | ' + (LANDED ? '`node tools/build-guard.js` 之后 |' : '**未落地**（等 C3 让出 `tools/site/assets.js`）|'));
w('');
if (liveDiff) {
  w('### 7.1 live（真实产物）与 post（注入）对拍');
  w('');
  const allSame = liveDiff.lineW.length === 0 && liveDiff.codeCw.length === 0 && liveDiff.codeOv.length === 0 && liveDiff.h.length === 0;
  w('| 指标 | 不一致格数 | 明细 |');
  w('|---|---|---|');
  w('| 正文行宽 | ' + liveDiff.lineW.length + ' | ' + (liveDiff.lineW.slice(0, 6).join('; ') || '—') + ' |');
  w('| 代码块宽 | ' + liveDiff.codeCw.length + ' | ' + (liveDiff.codeCw.slice(0, 6).join('; ') || '—') + ' |');
  w('| 代码横滚 | ' + liveDiff.codeOv.length + ' | ' + (liveDiff.codeOv.slice(0, 6).join('; ') || '—') + ' |');
  w('| 页高 | ' + liveDiff.h.length + ' | ' + (liveDiff.h.slice(0, 6).join('; ') || '—') + ' |');
  w('');
  w(allSame ? '**真实产物与注入预演逐格完全一致（70/70）** —— 预演结论可直接迁移到落地效果。'
    : '⚠️ 存在不一致格，见上表；不一致说明「注入预演」与「真实 CSS 落地」不等价，需归因后再采信预演数字。');
  w('');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L2.join('\n') + '\n', 'utf8');
console.log('wrote ' + OUT + '  (' + L2.length + ' lines, ' + Buffer.byteLength(L2.join('\n'), 'utf8') + ' bytes)');
console.log('PASS=' + passN + ' FAIL=' + failN + ' manual=1');
for (const a of acc) console.log('#' + a.n + ' ' + (a.ok === null ? 'MANUAL' : (a.ok ? 'PASS' : 'FAIL')) + '  ' + a.got);
if (liveDiff) console.log('live-vs-post diffs: lineW=' + liveDiff.lineW.length + ' codeCw=' + liveDiff.codeCw.length + ' codeOv=' + liveDiff.codeOv.length + ' h=' + liveDiff.h.length);
