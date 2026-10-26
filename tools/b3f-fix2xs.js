'use strict';
/**
 * b3f-fix2xs.js — 修正 3d 的 CJK 违规：把承载中文的 --fs-2xs(11.5) 升到 --fs-xs(12.5)。
 *
 * 依据：§2.4 「任何 CJK 文本 < 12px 禁止；本方案的中文下限是 12.5px；
 *        --fs-2xs（11.5）在中文语境下只允许承载『数字 / 拉丁』内容」。
 * 并且 §2.4 点名：「.grp-zh（纯中文）必须走 --fs-xs(12.5)，不能走 --fs-2xs(11.5)。
 *        这会与 upz-ladder.json 的 bucket 归属冲突 —— **以本文为准**。」
 *
 * 违规清单由 tools/b3f-cjk.js 实测得出（在 14 个页面样本、所有 details 展开的条件下，
 * 逐选择器统计其渲染文本是否含 CJK）。
 *
 * 用法：node tools/b3f-fix2xs.js [--write]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'tools/site/assets.js');
const WRITE = process.argv.includes('--write');

const cjkFile = path.join(os.tmpdir(), 'b3f-cjk.json');
if (!fs.existsSync(cjkFile)) { console.error('先跑 node tools/b3f-cjk.js'); process.exit(1); }
const { violate } = JSON.parse(fs.readFileSync(cjkFile, 'utf8'));

/* 违规选择器 → 需要在其规则内把 var(--fs-2xs) 改成 var(--fs-xs)。
   注意 .code-block 的两条是同一组逗号规则里的两个选择器，去重后只改一次。 */
const sels = [...new Set(violate.map((v) => v.sel))];

const src = fs.readFileSync(FILE, 'utf8');

/* 定位每条规则的 body 区间（与 b3f-apply3d 同款精简解析器） */
function stripCommentsKeepNewlines(s) {
  let out = ''; let i = 0;
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2); const stop = e === -1 ? s.length : e + 2;
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
const cssDecl = src.indexOf('const SITE_CSS = `');
const cssStart = cssDecl + 'const SITE_CSS = `'.length;
let cssEnd = -1;
for (let i = cssStart; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === '`') { cssEnd = i; break; } }
const css = src.slice(cssStart, cssEnd);
const clean = stripCommentsKeepNewlines(css);

const rules = [];
let pos = 0;
function skipWs() { while (pos < clean.length && /\s/.test(clean[pos])) pos++; }
function readBlockEnd() {
  let depth = 1;
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
    const selStart = pos; let k = pos;
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
    const bodyStart = pos; const bodyEnd = readBlockEnd();
    rules.push({ sel: prelude, bodyStart, bodyEnd });
  }
}
parse([]);

function splitSel(sel) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const edits = [];
const done = new Set();
for (const rule of rules) {
  const parts = splitSel(rule.sel);
  const hit = parts.some((p) => sels.indexOf(p) !== -1);
  if (!hit) continue;
  const body = clean.slice(rule.bodyStart, rule.bodyEnd);
  const re = /font-size\s*:\s*var\(--fs-2xs\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const at = rule.bodyStart + m.index + m[0].indexOf('var(--fs-2xs)');
    edits.push({ at, len: 'var(--fs-2xs)'.length, sel: rule.sel });
  }
  done.add(rule.sel);
}
edits.sort((a, b) => b.at - a.at);
let outCss = css;
for (const e of edits) {
  const cur = outCss.slice(e.at, e.at + e.len);
  if (cur !== 'var(--fs-2xs)') { console.error('✗ 偏移失配 @' + e.at + ' = "' + cur + '"'); process.exit(1); }
  outCss = outCss.slice(0, e.at) + 'var(--fs-xs)' + outCss.slice(e.at + e.len);
}

console.log('违规选择器 ' + sels.length + ' 个；命中规则 ' + done.size + ' 条；替换 ' + edits.length + ' 处');
const missed = sels.filter((s) => ![...done].some((d) => splitSel(d).indexOf(s) !== -1));
if (missed.length) { console.log('⚠ 未命中（可能已在别处改过）：' + missed.join(', ')); }
for (const d of done) console.log('  · ' + d.slice(0, 76));

if (WRITE) {
  fs.writeFileSync(FILE, src.slice(0, cssStart) + outCss + src.slice(cssEnd), 'utf8');
  console.log('\n已写入。');
} else {
  console.log('\n[dry-run] 加 --write 写入。');
}
