'use strict';
/**
 * b3f-cssmap.js — 把 SITE_CSS 解析成「规则 → 选择器 + font-size 声明」的机器可读清单。
 * 只读 tools/site/assets.js，不写任何仓库文件；输出 %TEMP%\b3f-cssmap.json。
 *
 * 用途：
 *   · 3a 死规则普查（按选择器逐个在 177 个已构建页上 querySelectorAll）
 *   · 3c/3d 的逐条改造台账（一眼看到"第 N 条规则、选择器 X、现值 Y"）
 *
 * 实现要点：
 *   ① 先把注释替换成等长空白（保留换行，行号因此仍准确）；
 *   ② 再按花括号做真正的嵌套解析（@media/@supports 有自己的块），
 *      这样既不会把注释当选择器，也不会把 @media 当成规则；
 *   ③ 每条规则记录它所在的 at-rule 上下文链。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SITE_CSS } = require('./site/assets.js');

/* ---------- ① 注释 → 等长空白（保留 \n，行号不变） ---------- */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) out += src[k] === '\n' ? '\n' : ' ';
      i = stop;
      continue;
    }
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      out += src[i++];
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += src[i++]; if (i < n) out += src[i++]; continue; }
        out += src[i++];
      }
      if (i < n) out += src[i++];
      continue;
    }
    out += src[i++];
  }
  return out;
}

const clean = stripComments(SITE_CSS);
const lineAt = (() => {
  const starts = [0];
  for (let k = 0; k < clean.length; k++) if (clean.charCodeAt(k) === 10) starts.push(k + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
})();

/* ---------- ② 递归下降解析 ---------- */
const rules = [];
let pos = 0;

function skipWs() {
  while (pos < clean.length) {
    const c = clean[pos];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { pos++; continue; }
    break;
  }
}

function readBlock() {
  /* pos 指向 '{' 之后；返回到匹配 '}' 之前的内容结束位置 */
  let depth = 1;
  const start = pos;
  while (pos < clean.length) {
    const c = clean[pos];
    if (c === '"' || c === "'") {
      const q = c; pos++;
      while (pos < clean.length && clean[pos] !== q) { if (clean[pos] === '\\') pos++; pos++; }
      pos++;
      continue;
    }
    if (c === '{') { depth++; pos++; continue; }
    if (c === '}') { depth--; if (depth === 0) { const body = clean.slice(start, pos); pos++; return body; } pos++; continue; }
    pos++;
  }
  return clean.slice(start);
}

function parseRules(ctx) {
  for (;;) {
    skipWs();
    if (pos >= clean.length) return;
    if (clean[pos] === '}') { pos++; return; }   /* 回到上层 */
    const selStart = pos;
    /* 找本段的 '{' 或 ';'（@charset/@import 这类无块语句） */
    let k = pos;
    while (k < clean.length && clean[k] !== '{' && clean[k] !== ';' && clean[k] !== '}') {
      if (clean[k] === '"' || clean[k] === "'") {
        const q = clean[k]; k++;
        while (k < clean.length && clean[k] !== q) { if (clean[k] === '\\') k++; k++; }
      }
      k++;
    }
    const prelude = clean.slice(selStart, k).trim();
    pos = k;
    if (pos < clean.length && clean[pos] === ';') { pos++; continue; }   /* @import 等 */
    if (pos >= clean.length) return;
    if (clean[pos] === '}') { pos++; return; }
    pos++; /* 吃掉 '{' */
    if (prelude.startsWith('@')) {
      if (/^@(media|supports|layer|container|scope)\b/.test(prelude)) {
        parseRules(ctx.concat(prelude));
        continue;
      }
      readBlock();      /* @font-face / @keyframes 等：整块跳过 */
      continue;
    }
    const bodyRaw = readBlock();
    rules.push({
      idx: rules.length,
      line: lineAt(selStart),
      ctx,
      sel: prelude,
      body: bodyRaw.replace(/\s+/g, ' ').trim(),
      fontSizes: [...bodyRaw.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].trim()),
    });
  }
}
parseRules([]);

/* ---------- ③ 汇总 ---------- */
const withFs = rules.filter((r) => r.fontSizes.length);
const declTotal = withFs.reduce((a, r) => a + r.fontSizes.length, 0);
const uniqueRaw = new Set();
withFs.forEach((r) => r.fontSizes.forEach((v) => uniqueRaw.add(v)));

const absPx = (v) => {
  const m = /^([\d.]+)(px|rem|em)$/.exec(v);
  if (!m) return null;
  const x = parseFloat(m[1]);
  return +(m[2] === 'px' ? x : x * 16).toFixed(4);
};
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

const out = {
  at: new Date().toISOString(),
  source: 'tools/site/assets.js SITE_CSS',
  cssBytes: Buffer.byteLength(SITE_CSS),
  ruleCount: rules.length,
  fontDecl: { total: declTotal, uniqueRaw: uniqueRaw.size, uniqueRawValues: [...uniqueRaw].sort() },
  emRules: withFs.filter((r) => r.fontSizes.some((v) => /(^|[^r])em$/.test(v))).length,
  emDecls: withFs.filter((r) => r.fontSizes.some((v) => /(^|[^r])em$/.test(v)))
    .map((r) => ({ idx: r.idx, line: r.line, ctx: r.ctx, sel: r.sel, fontSizes: r.fontSizes })),
  rulesWithFs: withFs.map((r) => ({
    idx: r.idx, line: r.line, ctx: r.ctx, sel: r.sel, fontSizes: r.fontSizes,
    absPx: r.fontSizes.map(absPx), parts: splitSel(r.sel),
  })),
  allRules: rules.map((r) => ({ idx: r.idx, line: r.line, ctx: r.ctx, sel: r.sel })),
};

const outFile = path.join(os.tmpdir(), 'b3f-cssmap.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');

console.log('规则总数           : ' + out.ruleCount);
console.log('含 font-size 的规则 : ' + withFs.length);
console.log('font-size 声明数    : ' + declTotal + '（去重原始值 ' + uniqueRaw.size + '）');
console.log('em 声明所在规则     : ' + out.emDecls.length);
console.log('\nem 声明逐条：');
for (const r of out.emDecls) {
  console.log('  #' + String(r.idx).padStart(3) + ' L' + String(r.line).padStart(4)
    + '  ' + (r.ctx.length ? '[' + r.ctx.join(' > ') + '] ' : '') + r.sel.slice(0, 66)
    + '  →  ' + r.fontSizes.join(' / '));
}
console.log('\nJSON → ' + outFile);
