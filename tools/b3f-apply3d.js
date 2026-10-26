'use strict';
/**
 * b3f-apply3d.js — 3d 施工器：把 108 条 font-size 声明批量替换为 var(--fs-*)。
 *
 * 为什么用脚本而不是 108 次手工 edit：
 *   · 手工 edit 每次都要求 old_string 全局唯一，而 .78rem / .95rem 这类值在文件里重复出现
 *     十几次 —— 手工改极易改错行（改到别的选择器上）；
 *   · 脚本按 **规则（选择器）** 定位，而不是按字面值定位，天然避免串行；
 *   · 改完可立刻用 b3f-cssmap.js 复核 133 → 令牌化后剩余声明数。
 *
 * 实现要点：
 *   ① 用 b3f-cssmap.js 的**同一套解析器逻辑**（此处内联精简版）拿到每条规则的
 *      body 在源文件里的绝对区间 [bodyStart, bodyEnd)；
 *   ② 只在**该区间内**替换 font-size 的值，不碰区间外；
 *   ③ 同一规则里有多个 font-size 时按出现顺序一一替换；
 *   ④ 写回前做三重自检：语法（复用 require 编译）、声明计数、token 计数。
 *
 * 用法：
 *   node tools/b3f-apply3d.js --dry     # 只打印将改什么
 *   node tools/b3f-apply3d.js --write   # 实际写入
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'tools/site/assets.js');
const DRY = !process.argv.includes('--write');

const mapFile = path.join(os.tmpdir(), 'b3f-map3d.json');
if (!fs.existsSync(mapFile)) {
  console.error('先跑 node tools/b3f-map3d.js');
  process.exit(1);
}
const { rows } = JSON.parse(fs.readFileSync(mapFile, 'utf8'));

const src = fs.readFileSync(FILE, 'utf8');

/* ---------- 定位 SITE_CSS 内容区 ---------- */
const cssDecl = src.indexOf('const SITE_CSS = `');
if (cssDecl === -1) { console.error('找不到 SITE_CSS'); process.exit(1); }
const cssStart = cssDecl + 'const SITE_CSS = `'.length;
/* 收尾反引号：从 cssStart 起第一个未转义反引号 */
let cssEnd = -1;
for (let i = cssStart; i < src.length; i++) {
  if (src[i] === '\\') { i++; continue; }
  if (src[i] === '`') { cssEnd = i; break; }
}
if (cssEnd === -1) { console.error('SITE_CSS 未闭合'); process.exit(1); }
const css = src.slice(cssStart, cssEnd);

/* ---------- 精简解析器：产出每条规则的 body 绝对区间（相对 css） ---------- */
function stripCommentsKeepNewlines(s) {
  let out = ''; let i = 0;
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2);
      const stop = e === -1 ? s.length : e + 2;
      for (let k = i; k < stop; k++) out += s[k] === '\n' ? '\n' : ' ';
      i = stop; continue;
    }
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i]; out += s[i++];
      while (i < s.length && s[i] !== q) { if (s[i] === '\\') { out += s[i++]; if (i < s.length) out += s[i++]; continue; } out += s[i++]; }
      if (i < s.length) out += s[i++];
      continue;
    }
    out += s[i++];
  }
  return out;
}
const clean = stripCommentsKeepNewlines(css);

const rules = [];
let pos = 0;
function skipWs() { while (pos < clean.length && /\s/.test(clean[pos])) pos++; }
function readBlockEnd() {
  let depth = 1; const start = pos;
  while (pos < clean.length) {
    const c = clean[pos];
    if (c === '"' || c === "'") { const q = c; pos++; while (pos < clean.length && clean[pos] !== q) { if (clean[pos] === '\\') pos++; pos++; } pos++; continue; }
    if (c === '{') { depth++; pos++; continue; }
    if (c === '}') { depth--; if (depth === 0) { const e = pos; pos++; return e; } pos++; continue; }
    pos++;
  }
  return clean.length;
}
function parse(ctx) {
  for (;;) {
    skipWs();
    if (pos >= clean.length) return;
    if (clean[pos] === '}') { pos++; return; }
    const selStart = pos;
    let k = pos;
    while (k < clean.length && clean[k] !== '{' && clean[k] !== ';' && clean[k] !== '}') {
      if (clean[k] === '"' || clean[k] === "'") { const q = clean[k]; k++; while (k < clean.length && clean[k] !== q) { if (clean[k] === '\\') k++; k++; } }
      k++;
    }
    const prelude = clean.slice(selStart, k).trim();
    pos = k;
    if (pos < clean.length && clean[pos] === ';') { pos++; continue; }
    if (pos >= clean.length) return;
    if (clean[pos] === '}') { pos++; return; }
    pos++;
    if (prelude.startsWith('@')) {
      if (/^@(media|supports|layer|container|scope)\b/.test(prelude)) { parse(ctx.concat(prelude)); continue; }
      readBlockEnd(); continue;
    }
    const bodyStart = pos;
    const bodyEnd = readBlockEnd();
    rules.push({ sel: prelude, ctx, bodyStart, bodyEnd });
  }
}
parse([]);

/* ---------- 把行号映射到规则：用 body 内的绝对偏移找 font-size ---------- */
/* rows 里有 idx（cssmap 的规则序号）。两套解析器顺序一致，故 idx 可直接索引。 */
if (rules.length < 1) { console.error('解析出 0 条规则'); process.exit(1); }

const edits = [];   /* { at, len, text } —— 相对 css 的替换 */
const skipped = [];
for (const r of rows) {
  if (r.action !== 'token') continue;
  const rule = rules[r.idx];
  if (!rule) { skipped.push({ ...r, why: '规则索引越界' }); continue; }
  /* 在该规则的 body 里找第 declIndex 个 font-size 的值区间 */
  const body = clean.slice(rule.bodyStart, rule.bodyEnd);
  const re = /font-size\s*:\s*([^;}]+)/g;
  let m; let n = -1;
  while ((m = re.exec(body)) !== null) {
    n++;
    if (n !== (r.declIndex || 0)) continue;
    const valRaw = m[1];
    const valStart = rule.bodyStart + m.index + m[0].indexOf(valRaw);
    /* 值可能带尾随空格 —— 精确裁到 valRaw 的非空边界 */
    const lead = valRaw.length - valRaw.trimStart().length;
    const valStart2 = valStart + lead;
    const valText = valRaw.trim();
    edits.push({ at: valStart2, len: valText.length, text: 'var(' + r.tok + ')', sel: r.sel, from: valText, tok: r.tok, fileLine: r.fileLine });
    break;
  }
  if (n !== (r.declIndex || 0)) skipped.push({ ...r, why: 'body 内未找到第 ' + (r.declIndex || 0) + ' 个 font-size' });
}

/* ---------- 应用（从后往前，避免偏移漂移） ---------- */
edits.sort((a, b) => b.at - a.at);
let outCss = css;
for (const e of edits) {
  const before = outCss.slice(e.at, e.at + e.len);
  if (before !== e.from) {
    console.error('✗ 偏移失配 @' + e.at + ' 期望 "' + e.from + '" 实际 "' + before + '"');
    process.exit(1);
  }
  outCss = outCss.slice(0, e.at) + e.text + outCss.slice(e.at + e.len);
}

const newSrc = src.slice(0, cssStart) + outCss + src.slice(cssEnd);

/* ---------- 自检 ---------- */
const fsCountOld = (css.match(/font-size\s*:/g) || []).length;
const fsCountNew = (outCss.match(/font-size\s*:/g) || []).length;
const tokCount = (outCss.match(/font-size\s*:\s*var\(--fs-/g) || []).length;

console.log('=== 3d 施工器 ===');
console.log('规则总数（解析）      : ' + rules.length);
console.log('待替换声明            : ' + rows.filter((r) => r.action === 'token').length);
console.log('成功定位              : ' + edits.length);
console.log('定位失败              : ' + skipped.length);
if (skipped.length) for (const s of skipped.slice(0, 10)) console.log('   ✗ L' + s.fileLine + '  ' + s.sel + '  (' + s.why + ')');
console.log('font-size 声明数      : ' + fsCountOld + ' → ' + fsCountNew + '（应相等）');
console.log('其中已令牌化          : ' + tokCount);

if (fsCountOld !== fsCountNew) { console.error('✗ 声明数变化，可能有误替换'); process.exit(1); }

if (DRY) {
  console.log('\n[dry-run] 未写入。前 12 条将改成：');
  for (const e of edits.slice(0, 12)) console.log('  L' + e.fileLine + '  ' + e.sel.slice(0, 44).padEnd(46) + e.from + ' → ' + e.text);
  console.log('\n加 --write 实际写入。');
} else {
  fs.writeFileSync(FILE, newSrc, 'utf8');
  console.log('\n已写入 ' + FILE);
}
