'use strict';
/**
 * b3f-map3d.js — 3d 施工表：把 133 条 font-size 声明逐条映射到 14 级令牌之一。
 *
 * 映射原则（与 upz-ladder.json 的 bucket 归属一致，但按 §2.4 中文约束做偏离）：
 *   · 每个声明先算绝对 px（rem/px 直接算；em 已在 3c 处置完，只剩 7 条装饰类保留 em）
 *   · 按 px 就近归入 14 级阶梯的某一级
 *   · **例外（不参与令牌化）**：输入框 16px（verify-mobile inputFonts 硬约束）、
 *     顶栏内部字号（R9：.brand 已 139px 宽，390 档会溢出）、保留的 7 条 em
 *
 * 用法：node tools/b3f-map3d.js [--write-patch]
 * 输出：%TEMP%\b3f-map3d.json + stdout 施工表
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cmap = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'b3f-cssmap.json'), 'utf8'));
const src = fs.readFileSync(path.join(ROOT, 'tools/site/assets.js'), 'utf8');
const cssStartLine = src.slice(0, src.indexOf('const SITE_CSS')).split('\n').length;
const fileLineOf = (cssLine) => cssStartLine + cssLine - 1;

/* 14 级阶梯（+ h5/h6 别名） */
const LADDER = [
  { tok: '--fs-2xs', px: 11.5 },
  { tok: '--fs-xs', px: 12.5 },
  { tok: '--fs-sm', px: 13.5 },
  { tok: '--fs-md', px: 14.5 },
  { tok: '--fs-base', px: 16 },
  { tok: '--fs-lg', px: 17.5 },
  { tok: '--fs-xl', px: 19 },
  { tok: '--fs-h4', px: 19 },     /* 移动值；≥800 由 3e 重定义为 21 */
  { tok: '--fs-h3', px: 24 },
  { tok: '--fs-h2', px: 28 },
  { tok: '--fs-h1', px: 34 },
];

/* 显式指定（覆盖就近匹配）：标题走 hX 令牌，不按 px 就近 */
const EXPLICIT = [
  { match: /^\.page-head h1$/, tok: '--fs-h1', why: '页头 h1 与正文 h1 合并为同一档（§2.5 点名的"同层级被拆成近似字号"）' },
  { match: /^\.article h1$/, tok: '--fs-h1', why: '正文 h1' },
  { match: /^\.article h2$/, tok: '--fs-h2', why: '正文 h2' },
  { match: /^\.article h3$/, tok: '--fs-h3', why: '正文 h3' },
  { match: /^\.article h4$/, tok: '--fs-h4', why: '正文 h4' },
  { match: /^\.article h5$/, tok: '--fs-h5', why: 'h5 = --fs-lg 别名，不参与断点上移' },
  { match: /^\.hero h1$/, tok: '--fs-h1', why: '首页 hero h1 原 32px → 归入 h1 档' },
  { match: /^\.section-head h2$/, tok: '--fs-h2', why: '分区页区块标题' },
];

/* 不动清单（硬约束） */
const FROZEN = [
  { match: /^\.side-filter$/, why: '输入框：verify-mobile.js:961 inputFonts 逐项列出，动则 C1 fail' },
  { match: /^\.hero-search #hero-search$/, why: '输入框（首页搜索）' },
  { match: /^\.filter-bar input$/, why: '输入框（all-pages 筛选）' },
  { match: /^\.search-box input$/, why: '输入框（搜索面板）' },
  { match: /^\.side-filter,/, why: '输入框' },
  { match: /\.brand-name$/, why: '顶栏内部：R9，.brand 已 139px 宽，390 档会溢出' },
  { match: /^\.sidebar-toggle$/, why: '顶栏内部：☰ 按钮图标' },
  { match: /^\.tbtn$/, why: '顶栏内部：按钮字号' },
  { match: /^\.topbar #theme-toggle/, why: '顶栏内部：主题图标（且是保留的 em）' },
];

const isFrozen = (sel) => FROZEN.find((f) => f.match.test(sel));
const explicitOf = (sel) => EXPLICIT.find((e) => e.match.test(sel));

const nearest = (px) => {
  let best = null;
  for (const l of LADDER) {
    const d = Math.abs(l.px - px);
    if (!best || d < best.d) best = { tok: l.tok, px: l.px, d: +d.toFixed(4) };
  }
  return best;
};

const rows = [];
for (const r of cmap.rulesWithFs) {
  for (let i = 0; i < r.fontSizes.length; i++) {
    const raw = r.fontSizes[i];
    const abs = r.absPx[i];
    if (abs === null) {
      rows.push({ idx: r.idx, line: r.line, fileLine: fileLineOf(r.line), ctx: r.ctx.join(' '), sel: r.sel, raw, px: null, action: 'keep-none', why: '非绝对值（inherit/0），不参与令牌化' });
      continue;
    }
    const frozen = isFrozen(r.sel);
    if (frozen) {
      rows.push({ idx: r.idx, line: r.line, fileLine: fileLineOf(r.line), ctx: r.ctx.join(' '), sel: r.sel, raw, px: abs, action: 'frozen', why: frozen.why });
      continue;
    }
    /* 保留的 em（装饰类）：不动 */
    if (/(^|[^r])em$/.test(raw)) {
      rows.push({ idx: r.idx, line: r.line, fileLine: fileLineOf(r.line), ctx: r.ctx.join(' '), sel: r.sel, raw, px: abs, action: 'keep-em', why: '3c 判定保留：装饰性缩放（图标/折叠三角），必须随父级缩放' });
      continue;
    }
    const ex = explicitOf(r.sel);
    if (ex) {
      rows.push({ idx: r.idx, declIndex: i, line: r.line, fileLine: fileLineOf(r.line), ctx: r.ctx.join(' '), sel: r.sel, raw, px: abs, action: 'token', tok: ex.tok, why: ex.why, delta: null });
      continue;
    }
    const n = nearest(abs);
    rows.push({
      idx: r.idx, declIndex: i, line: r.line, fileLine: fileLineOf(r.line), ctx: r.ctx.join(' '), sel: r.sel,
      raw, px: abs, action: 'token', tok: n.tok, tokPx: n.px, delta: +(n.px - abs).toFixed(4),
      why: '就近归入 14 级阶梯',
    });
  }
}

const stat = {};
for (const r of rows) stat[r.action] = (stat[r.action] || 0) + 1;

const pad = (s, n) => String(s).padEnd(n);
const ordered = rows.slice().sort((a, b) => a.fileLine - b.fileLine);
console.log('3d 施工表（共 ' + rows.length + ' 条声明）\n');
console.log(pad('动作', 11) + pad('文件行', 8) + pad('选择器', 40) + pad('现值', 11) + pad('px', 8) + pad('令牌', 13) + '偏移/说明');
console.log('-'.repeat(152));
for (const r of ordered) {
  const act = { token: '改令牌', frozen: '不动(约束)', 'keep-em': '保留 em', 'keep-none': '不动' }[r.action] || r.action;
  const delta = r.delta === null || r.delta === undefined ? '' : (r.delta > 0 ? '+' : '') + r.delta;
  console.log(pad(act, 11) + pad(r.fileLine, 8) + pad(r.sel.slice(0, 38), 40) + pad(r.raw, 11)
    + pad(r.px === null ? '-' : r.px, 8) + pad(r.tok || '-', 13) + delta + '  ' + r.why.slice(0, 46));
}
console.log('\n汇总：' + Object.keys(stat).map((k) => k + ' ' + stat[k]).join(' · '));
const tokRows = rows.filter((r) => r.action === 'token');
const maxDelta = tokRows.reduce((a, r) => Math.max(a, Math.abs(r.delta || 0)), 0);
console.log('令牌化 ' + tokRows.length + ' 条；最大视觉偏移 ' + maxDelta.toFixed(4) + 'px');
const big = tokRows.filter((r) => Math.abs(r.delta || 0) > 1.0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
console.log('\n偏移 >1px 的 ' + big.length + ' 条（重点复核）：');
for (const b of big) console.log('  L' + b.fileLine + '  ' + b.sel.slice(0, 46).padEnd(48) + b.raw + ' (' + b.px + ') → ' + b.tok + ' (' + b.tokPx + ')  ' + b.delta + 'px');

fs.writeFileSync(path.join(os.tmpdir(), 'b3f-map3d.json'), JSON.stringify({ rows, stat, maxDelta }, null, 2), 'utf8');
console.log('\nJSON → ' + path.join(os.tmpdir(), 'b3f-map3d.json'));
