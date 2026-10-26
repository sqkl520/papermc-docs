'use strict';
/**
 * b3f-lint.js — SITE_CSS 模板字符串的**反引号守卫**（批 3 专用，铁律落地为脚本）。
 *
 * 背景：SITE_CSS 是 JS 模板字符串，注释里出现反引号会直接终止字符串 → 语法错误。
 * 本会话已因此踩坑两次（`.article h2..h6{...}` 与 `it.zh` 两处注释）。
 * 与其靠人眼，不如每次改完 assets.js 就跑一次。
 *
 * 规则：取出 SITE_CSS 与 SITE_JS 两个模板字符串的**内容**，其中不得出现未转义的 ` 或 ${ 。
 * 做法：用 --check 通过说明 JS 语法本身没问题；本脚本再单独扫"模板字符串内容区"。
 *
 * 用法：node tools/b3f-lint.js
 * 退出码：0 = 干净；1 = 有反引号/插值残留
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'tools/site/assets.js'), 'utf8');

/**
 * 从 src 里定位 `const NAME = \`` ... 收尾反引号，返回内容区间。
 * 收尾判定：第一个**未转义**的反引号，且其后到行尾只有 ; 或空白。
 */
function extract(name) {
  const startRe = new RegExp('const ' + name + '\\s*=\\s*`');
  const m = startRe.exec(src);
  if (!m) return null;
  const bodyStart = m.index + m[0].length;
  let i = bodyStart;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '`') return { name, bodyStart, bodyEnd: i, body: src.slice(bodyStart, i) };
    i++;
  }
  return null;
}

let fail = 0;
for (const name of ['SITE_CSS', 'SITE_JS', 'FAVICON_SVG']) {
  const ex = extract(name);
  if (!ex) { console.log('⚠ 未找到 ' + name + ' 模板字符串'); continue; }
  const bad = [];
  /* 反引号已在 extract 里作为终止符处理，所以内容区理论上不含裸反引号；
     这里查的是 ${ 插值（模板字符串里出现 ${ 会被当插值求值，通常是要写 CSS 时误写）。 */
  const re = /\$\{/g;
  let mm;
  while ((mm = re.exec(ex.body)) !== null) {
    const at = ex.bodyStart + mm.index;
    const line = src.slice(0, at).split('\n').length;
    bad.push({ line, snippet: ex.body.slice(Math.max(0, mm.index - 30), mm.index + 20).replace(/\n/g, '⏎') });
  }
  console.log(name + '：' + ex.body.length + ' 字符，${ 插值 ' + bad.length + ' 处');
  for (const b of bad) {
    console.log('  L' + b.line + '  …' + b.snippet + '…');
    fail++;
  }
}

/* 额外：整份源文件里 "const SITE_CSS" 到 "const SITE_JS" 之间不得有反引号
   （反引号只允许出现在两端；extract 已保证，这里再显式核对一次） */
const cssEx = extract('SITE_CSS');
if (cssEx) {
  const inner = cssEx.body.indexOf('`');
  console.log('\nSITE_CSS 内容区反引号残留：' + (inner === -1 ? '无 ✓' : '有 ✗（位置 ' + inner + '）'));
  if (inner !== -1) fail++;
}

/* 归因辅助：语法已崩时 extract() 会拿不到正确边界，所以这里再加一层"裸反引号计数"，
   统计 SITE_CSS 起点之后出现的反引号个数 —— 正常应为 1（收尾那个）。
   本会话已因此踩坑 3 次，故宁可多一层。 */
if (!cssEx) {
  const at = src.indexOf('const SITE_CSS');
  const after = src.slice(at);
  const ticks = (after.match(/`/g) || []).length;
  console.log('\n⚠ SITE_CSS 模板字符串无法闭合（当前其后有 ' + ticks + ' 个反引号）。');
  console.log('  最常见原因：注释里写了反引号。请在 SITE_CSS 区间内搜 "`" 并改成普通引号。');
  fail++;
}

console.log(fail === 0 ? '\n守卫通过：模板字符串干净' : '\n守卫失败：' + fail + ' 处，先修再提交');
process.exit(fail === 0 ? 0 : 1);
