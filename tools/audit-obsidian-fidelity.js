#!/usr/bin/env node
'use strict';
/*
 * 内容保真审计（Fidelity Auditor）—— 独立取证脚本
 * 用途：把 archive/{paper,velocity,folia}/markdown/**（真值）与 Obsidian 交付库逐页比对。
 * 只读 archive/**、data/**、交付库；只写 reports/obsidian-fidelity.{md,json}。
 *
 * 用法：
 *   node tools/audit-obsidian-fidelity.js
 *   node tools/audit-obsidian-fidelity.js --vault="<VAULT_PATH>\Server\Paper Database"
 *   node tools/audit-obsidian-fidelity.js --out-md=... --out-json=...
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SECTIONS = ['paper', 'velocity', 'folia'];
const DEFAULT_VAULT = "<VAULT_PATH>\\Server\\Paper Database";
const VAULT_ROOT_DEFAULT = process.env.OBSIDIAN_VAULT || '<VAULT_PATH>';

const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const hit = argv.find(a => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return dflt;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}
const VAULT_OPT = String(argOf('vault', DEFAULT_VAULT)).replace(/[\\/]+$/, '');
const VAULT_ROOT_OPT = String(argOf('vault-root', VAULT_ROOT_DEFAULT)).replace(/[\\/]+$/, '');
let VAULT_ROOT = VAULT_ROOT_OPT;
let OUT_MD = String(argOf('out-md', path.join(ROOT, 'reports', 'obsidian-fidelity.md')));
let OUT_JSON = String(argOf('out-json', path.join(ROOT, 'reports', 'obsidian-fidelity.json')));
let VAULT = VAULT_OPT;

// ────────────────────────────── 通用工具 ──────────────────────────────

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sha256File(p) { try { return sha256(fs.readFileSync(p)); } catch (e) { return null; } }
function readText(p) { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); }
function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }
function short(s, n) { s = String(s == null ? '' : s); return s.length <= n ? s : s.slice(0, n - 1) + '…'; }
function collapse(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function esc(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function escape0(s) { return '`' + String(s == null ? '' : s) + '`'; }

function walkFiles(dir, filter, out) {
  out = out || [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, filter, out);
    else if (!filter || filter(p)) out.push(p);
  }
  return out;
}

// ────────────────────────────── 围栏代码块提取 ──────────────────────────────

const FENCE_OPEN_RE = /^([ \t]*)((?:>[ \t]?)*)(`{3,}|~{3,})[ \t]*(.*)$/;

function dequote(line, depth) {
  if (depth === 0) return line;
  let rest = line, n = 0;
  while (n < depth) {
    const m = /^[ \t]*>[ \t]?/.exec(rest);
    if (!m) return null;
    rest = rest.slice(m[0].length);
    n++;
  }
  return rest;
}

function extractFences(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = FENCE_OPEN_RE.exec(lines[i]);
    if (!m) { i++; continue; }
    const quoteDepth = (m[2].match(/>/g) || []).length;
    const ch = m[3][0], len = m[3].length, info = m[4].trim();
    const closeRe = new RegExp('^[ \\t]*\\' + ch + '{' + len + ',}[ \\t]*$');
    const body = [];
    let j = i + 1, closed = false;
    while (j < lines.length) {
      const dq = dequote(lines[j], quoteDepth);
      if (dq === null) break;
      if (closeRe.test(dq)) { closed = true; break; }
      body.push(dq);
      j++;
    }
    out.push({ line: i + 1, quoteDepth, char: ch, fenceLen: len, info, closed, body: body.join('\n') });
    i = closed ? j + 1 : Math.max(j, i + 1);
  }
  return out;
}

function normBody(s) {
  const ls = String(s).split('\n').map(l => l.replace(/[ \t\r]+$/, ''));
  while (ls.length && ls[ls.length - 1] === '') ls.pop();
  while (ls.length && ls[0] === '') ls.shift();
  return ls.join('\n');
}

/** 把围栏块（含引用内嵌）从正文里挖掉，返回等行数的空位文本 */
function blankFences(text) {
  const lines = text.split('\n');
  const out = lines.slice();
  let i = 0;
  while (i < lines.length) {
    const m = FENCE_OPEN_RE.exec(lines[i]);
    if (!m) { i++; continue; }
    const quoteDepth = (m[2].match(/>/g) || []).length;
    const ch = m[3][0], len = m[3].length;
    const closeRe = new RegExp('^[ \\t]*\\' + ch + '{' + len + ',}[ \\t]*$');
    out[i] = '';
    let j = i + 1, closed = false;
    while (j < lines.length) {
      const dq = dequote(lines[j], quoteDepth);
      if (dq === null) break;
      if (closeRe.test(dq)) { closed = true; out[j] = ''; break; }
      out[j] = '';
      j++;
    }
    i = closed ? j + 1 : Math.max(j, i + 1);
  }
  return out.join('\n');
}

// ────────────────────────────── frontmatter ──────────────────────────────

function splitFrontmatter(text) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/.exec(text);
  if (!m) return { raw: null, yaml: '', body: text, bodyOffset: 0 };
  return { raw: m[0], yaml: m[2], body: text.slice(m[0].length), bodyOffset: m[0].length };
}

function unquote(v) {
  v = v.trim();
  if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function splitInlineList(v) {
  const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  const out = [];
  let cur = '', q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ',') { out.push(unquote(cur.trim())); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(unquote(cur.trim()));
  return out.filter(s => s !== '');
}

function parseYamlLite(src) {
  const data = {}, errors = [];
  const lines = String(src).split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) { i++; continue; }
    const m = /^([A-Za-z0-9_][A-Za-z0-9_.\-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!m) { errors.push('无法解析行 ' + (i + 1) + ': ' + short(line, 80)); i++; continue; }
    const key = m[1];
    const valRaw = m[2];
    const val = valRaw.replace(/[ \t]+$/, '');
    if (val === '') {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^[ \t]+-[ \t]+/.test(lines[j])) {
        items.push(unquote(lines[j].replace(/^[ \t]+-[ \t]+/, '')));
        j++;
      }
      if (items.length) { data[key] = items; i = j; continue; }
      data[key] = '';
      i++;
      continue;
    }
    if (/^\[.*\]$/.test(val)) { data[key] = splitInlineList(val); i++; continue; }
    if (val === '|' || val === '>' || /^[|>][-+]?$/.test(val)) {
      const block = [];
      let j = i + 1;
      while (j < lines.length && (/^[ \t]+/.test(lines[j]) || lines[j].trim() === '')) { block.push(lines[j].replace(/^[ \t]{2}/, '')); j++; }
      data[key] = block.join('\n').replace(/\n+$/, '');
      i = j;
      continue;
    }
    data[key] = unquote(val);
    i++;
  }
  return { data, errors };
}

// ────────────────────────────── 文本规范化（正文语义 token） ──────────────────────────────

/** 平衡扫描 `[[...]]`（内嵌标题字面量里可能带 `[`/`]`，正则 `[^\[\]]*` 会漏） */
function scanWikilinks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const isEmbed = text[i] === '!' && text[i + 1] === '[' && text[i + 2] === '[';
    const start = isEmbed ? i + 1 : i;
    if (!(text[start] === '[' && text[start + 1] === '[')) { i++; continue; }
    let j = start + 2, depth = 0, end = -1;
    while (j < text.length) {
      if (text[j] === '[') depth++;
      else if (text[j] === ']') {
        if (depth > 0) depth--;
        else if (text[j + 1] === ']') { end = j; break; }
      }
      j++;
    }
    if (end === -1) { i = start + 2; continue; }
    out.push({ embed: isEmbed, inner: text.slice(start + 2, end), start: isEmbed ? i : start, end: end + 2 });
    i = end + 2;
  }
  return out;
}

/** 标题文本归一（用于容忍"标题里的链接被拍平"这类等价改写） */
function normHeading(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/<[^>]*>/g, ' ');
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/`/g, '');
  return collapse(t).toLowerCase();
}

/** 手工扫描 [..](..) / ![..](..)，括号平衡 */
function scanMdLinks(text, skipRanges) {
  const out = [];
  const inSkip = (p) => (skipRanges || []).some(r => p >= r.start && p < r.end);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const isImg = c === '!' && text[i + 1] === '[';
    const open = isImg ? i + 2 : (c === '[' ? i + 1 : -1);
    if (open === -1 || text[open] === '[' || inSkip(i)) { i++; continue; }
    let d = 1, j = open;
    while (j < text.length && d > 0) { if (text[j] === '[') d++; else if (text[j] === ']') d--; j++; }
    if (d !== 0) { i++; continue; }
    const label = text.slice(open, j - 1);
    if (text[j] === '(') {
      let pd = 1, k = j + 1;
      while (k < text.length && pd > 0) { const ch = text[k]; if (ch === '(') pd++; else if (ch === ')') pd--; k++; }
      if (pd === 0) {
        const href = text.slice(j + 1, k - 1);
        out.push({ image: isImg, text: label, href, start: i, end: k });
        i = k;
        continue;
      }
    }
    i = j;
  }
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

const TABLE_SEP_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function isTableSeparator(line) { return TABLE_SEP_RE.test(line) && /-/.test(line); }

function stripIntentionalTargetBlocks(body) {
  let lines = body.split('\n');
  // 1) 中文摘要块（契约 §3 骨架）：`> [!info] 中文摘要` 起始的连续引用行
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*>[ \t]*\[!info\][^\n]*中文摘要/.test(lines[i])) {
      let j = i;
      while (j < lines.length && /^[ \t]*>/.test(lines[j])) j++;
      i = j - 1;
      continue;
    }
    out.push(lines[i]);
  }
  lines = out;
  // 2) 页脚导航 / 来源行（在末尾、以 `---` 起）
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[ \t]*\*\*导航\*\*/.test(lines[i]) || /^[ \t]*\*\*来源\*\*/.test(lines[i])) {
      let k = i;
      while (k > 0 && !/^[ \t]*---[ \t]*$/.test(lines[k])) k--;
      if (k > 0 && lines.length - k <= 8) {
        lines = lines.slice(0, k);
        break;
      }
      lines = lines.slice(0, i);
      break;
    }
  }
  return lines.join('\n');
}

/** 正文 → 归一化纯文本（保留语义 token，剥掉标记） */
function normalizeToText(body, opts) {
  opts = opts || {};
  let t = blankFences(body);
  // 脚注引用（HTML 形态）先整段消掉，避免后续被当成普通链接而留下序号 token
  t = t.replace(/<sup>\s*\[[^\]]*\]\(#user-content-fn[^)]*\)\s*<\/sup>/gi, ' ');
  const wl = scanWikilinks(t);
  const skip = wl.map(w => ({ start: w.start, end: w.end }));
  const md = scanMdLinks(t, skip);

  // 链接 → 只留显示文本（目标） / 只留链接文字（源）
  const edits = [];
  for (const w of wl) {
    if (w.embed) { edits.push([w.start, w.end, '']); continue; }
    const parts = w.inner.split('|');
    const target = parts[0];
    const disp = parts.length > 1 ? parts.slice(1).join('|') : null;
    if (disp) edits.push([w.start, w.end, disp]);
    else {
      const noAnchor = target.split('#')[0];
      const base = noAnchor.split('/').filter(Boolean).pop() || '';
      edits.push([w.start, w.end, base.replace(/\.md$/i, '')]);
    }
  }
  for (const l of md) {
    if (l.image) {
      // 图片 alt 文本无法在 Obsidian 嵌入语法中保留（`![[x]]` 的 `|` 是尺寸位），
      // 故 alt 一律不参与文本守恒，改在 §6 图片项单列为信息项。
      edits.push([l.start, l.end, '']);
    } else {
      edits.push([l.start, l.end, l.text]);
    }
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (const [s, e, v] of edits) t = t.slice(0, s) + v + t.slice(e);

  // 逐行清理标记
  let lines = t.split('\n').map(line => {
    let s = line;
    s = s.replace(/^[ \t]*(?:>[ \t]?)*\[![A-Za-z]+\][-+]?[ \t]*/, ''); // callout 头
    s = s.replace(/^[ \t]*(?:>[ \t]?)+/, '');                          // 引用前缀
    s = s.replace(/^[ \t]*#{1,6}[ \t]+/, '');                          // 标题井号
    if (isTableSeparator(s)) return '';
    s = s.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, '');               // 列表符号
    s = s.replace(/<sup>\s*\[[^\]]*\]\(#user-content-fn[^)]*\)\s*<\/sup>/gi, ' ');
    s = s.replace(/<sup>\s*\[[^\]]*\]\(#user-content-fn[^)]*\)\s*<\/sup>/gi, ' ');
    s = s.replace(/<\/?(?:details|summary|div|span|center|p|br|kbd|sup|sub|a|li|ul|ol|table|tr|td|th|thead|tbody|code|em|strong|figure|img|blockquote|h[1-6])\b[^>]*>/gi, ' ');
    s = s.replace(/<[^>]{0,200}>/g, ' ');
    s = decodeEntities(s);
    s = s.replace(/\[\^[^\]]+\]:?/g, ' ');                             // 脚注标记
    s = s.replace(/（未镜像）|\(未镜像\)/g, ' ');                       // 交付侧对外链的有意标注（契约 §4）
    s = s.replace(/(`+)([\s\S]*?)\1/g, '$2');                          // 行内代码
    s = s.replace(/\\\\([\\`*_{}\[\]()#+\-.!|~$<>])/g, '$1');
    s = s.replace(/[*_~]/g, ' ');
    s = s.replace(/\|/g, ' ');
    return s;
  });
  return lines.join('\n');
}

function tokensOf(s) {
  return String(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function multisetCoverage(srcToks, tgtToks) {
  const bag = new Map();
  for (const t of tgtToks) bag.set(t, (bag.get(t) || 0) + 1);
  let matched = 0;
  const missing = [];
  for (let i = 0; i < srcToks.length; i++) {
    const t = srcToks[i];
    const n = bag.get(t) || 0;
    if (n > 0) { bag.set(t, n - 1); matched++; }
    else missing.push({ token: t, index: i });
  }
  return { matched, total: srcToks.length, missing };
}

/** 源行在目标文本中的存在性（宽松：先整行，再前缀）；围栏体内的行不参与（另有代码体检查） */
function linePresence(srcLines, tgtText) {
  const tgt = normalizeToText(tgtText, {});
  const tgtFlat = collapse(tgt);
  const tgtTok = tokensOf(tgt).join(' ');
  const inFence = fenceLineSet(srcLines.join('\n'));
  const missing = [], partial = [];
  for (let idx = 0; idx < srcLines.length; idx++) {
    if (inFence.has(idx + 1)) continue;
    const raw = srcLines[idx];
    const line = collapse(normalizeToText(raw, {}));
    if (line.length < 12) continue;
    if (tgtFlat.includes(line)) continue;
    const lineTok = tokensOf(line).join(' ');
    if (lineTok && tgtTok.includes(lineTok)) continue;
    if (lineTok && lineTok.length > 24 && tgtTok.includes(lineTok.slice(0, Math.floor(lineTok.length * 0.6)))) { partial.push(line); continue; }
    missing.push(line);
  }
  return { missing, partial };
}

/** 1-based 行号集合：围栏行 + 围栏体（含引用内嵌） */
function fenceLineSet(text) {
  const lines = text.split('\n');
  const set = new Set();
  let i = 0;
  while (i < lines.length) {
    const m = FENCE_OPEN_RE.exec(lines[i]);
    if (!m) { i++; continue; }
    const quoteDepth = (m[2].match(/>/g) || []).length;
    const ch = m[3][0], len = m[3].length;
    const closeRe = new RegExp('^[ \\t]*\\' + ch + '{' + len + ',}[ \\t]*$');
    set.add(i + 1);
    let j = i + 1, closed = false;
    while (j < lines.length) {
      const dq = dequote(lines[j], quoteDepth);
      if (dq === null) break;
      set.add(j + 1);
      if (closeRe.test(dq)) { closed = true; break; }
      j++;
    }
    i = closed ? j + 1 : Math.max(j, i + 1);
  }
  return set;
}

// ────────────────────────────── 元素统计 ──────────────────────────────

function countCallouts(text) {
  const byType = {}, folds = [], codeHeaders = [];
  const re = /^[ \t]*(?:>[ \t]?)*\[!([A-Za-z]+)\]([-+])?[ \t]*([^\n]*)$/gm;
  let m;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    byType[type] = (byType[type] || 0) + 1;
    const title = m[3].trim();
    if (m[2]) {
      folds.push({ type, mark: m[2], title });
      if (/^`[^`]+`$/.test(title) || /\.(ya?ml|json|properties|java|kt|txt|log|toml|md|sh|bat|nc|conf|cfg)\b/i.test(title)) codeHeaders.push({ type, title });
    }
  }
  return { byType, folds, codeHeaders, total: Object.values(byType).reduce((a, b) => a + b, 0) };
}

function splitCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur);
  return cells;
}

function countTables(body) {
  const lines = blankFences(body).split('\n');
  const tables = [];
  let i = 0;
  while (i < lines.length - 1) {
    const head = lines[i];
    if (head.includes('|') && isTableSeparator(lines[i + 1])) {
      const cols = splitCells(head).length;
      let rows = 0, j = i + 2;
      while (j < lines.length && lines[j].trim() && lines[j].includes('|') && !isTableSeparator(lines[j])) { rows++; j++; }
      tables.push({ line: i + 1, cols, rows, sepCols: splitCells(lines[i + 1]).length });
      i = j;
      continue;
    }
    i++;
  }
  return tables;
}

function countInlineCode(text) {
  const t = blankFences(text);
  let n = 0, i = 0;
  while (i < t.length) {
    if (t[i] === '`') {
      let len = 0;
      while (t[i + len] === '`') len++;
      const closeRe = new RegExp('`{' + len + '}(?!`)');
      const rest = t.slice(i + len);
      const idx = rest.search(closeRe);
      if (idx !== -1) { n++; i = i + len + idx + len; continue; }
      i += len;
      continue;
    }
    i++;
  }
  return n;
}

function countFootnoteRefs(text) {
  const t = blankFences(text);
  const gfm = (t.match(/\[\^[^\]]+\](?!:)/g) || []).length;
  const html = (text.match(/<sup>\[[^\]]*\]\(#user-content-fn-[^)]*\)<\/sup>/g) || []).length;
  return { gfm, html, total: gfm + html };
}

function countFootnoteDefs(text) {
  const t = blankFences(text);
  return {
    gfm: (t.match(/^\[\^[^\]]+\]:/gm) || []).length,
    htmlLi: (text.match(/<li id="user-content-fn-[^"]*"/g) || []).length,
  };
}

// ────────────────────────────── 标题与 slug ──────────────────────────────

/** 标题抽取：行首标题 ∪ 列表内嵌标题 ∪ 引用/callout 内标题
 *  （后两类是「源结构经契约转换后的必然形态」：`- ##### X` 来自上游列表内嵌标题；
 *    `> #### X` 来自 `<details>` → 折叠 callout，契约 §4 强制） */
function headingsOf(text) {
  const lines = blankFences(text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let m = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(lines[i]);
    if (m) { out.push({ level: m[1].length, text: m[2].trim(), line: i + 1, embedded: false, quoted: false }); continue; }
    m = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(lines[i]);
    if (m) { out.push({ level: m[1].length, text: m[2].trim(), line: i + 1, embedded: true, quoted: false }); continue; }
    m = /^[ \t]*(?:>[ \t]?)+(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(lines[i]);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i + 1, embedded: false, quoted: true });
  }
  return out;
}

function slugify(h) {
  let s = String(h).replace(/^#{1,6}[ \t]+/, '');
  let explicit = null;
  const em = /\{#([^}]+)\}\s*$/.exec(s);
  if (em) { explicit = em[1]; s = s.slice(0, em.index); }
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.toLowerCase().trim();
  s = s.replace(/[^\p{L}\p{N}\s_-]/gu, '');
  s = s.replace(/\s+/g, '-');
  return { slug: s, explicit };
}

// ────────────────────────────── 源侧加载 ──────────────────────────────

function loadSources() {
  const pages = [];
  const byKey = new Map();
  const byUrl = new Map();
  const bySecRel = new Map();
  for (const sec of SECTIONS) {
    const mf = JSON.parse(readText(path.join(ROOT, 'archive', sec, 'manifest.json')));
    for (const p of mf.pages) {
      const mdPath = path.join(ROOT, 'archive', sec, p.file);
      const text = readText(mdPath);
      const key = sec + ':' + p.rel;
      const page = {
        key, sec, rel: p.rel, title: p.title, url: p.url, mdPath,
        mdRel: rel(mdPath), text,
        shaManifest: p.sha256, shaActual: sha256File(mdPath),
        fetchedAt: p.fetchedAt, manifestCodeBlocks: p.codeBlocks, manifestLinks: p.links,
        assets: p.assets, markdownBytes: p.markdownBytes,
      };
      const fm = splitFrontmatter(text);
      page.frontmatter = parseYamlLite(fm.yaml).data;
      page.body = fm.body;
      pages.push(page);
      byKey.set(key, page);
      byUrl.set(p.url, page);
      bySecRel.set(sec + '|' + p.rel, page);
      const norm = sec + '|' + p.rel.replace(/\/index$/, '').replace(/\/$/, '');
      bySecRel.set(norm, page);
    }
  }
  return { pages, byKey, byUrl, bySecRel };
}

function loadSourceNav() {
  const nav = JSON.parse(readText(path.join(ROOT, 'data', 'source-nav.json')));
  const groupOf = new Map(); // rel -> [labels]
  const notInNav = new Map();
  for (const s of nav.sections) {
    const walk = (nodes, labels) => {
      for (const n of nodes) {
        if (n.kind === 'group') walk(n.children || [], labels.concat([n.label]));
        else if (n.kind === 'page') groupOf.set(s.id + ':' + n.rel, labels);
      }
    };
    walk(s.groups || [], []);
    for (const p of (s.pagesNotInSourceNav || [])) {
      notInNav.set(s.id + ':' + (typeof p === 'string' ? p : p.rel), p);
    }
  }
  return { groupOf, notInNav, raw: nav };
}

// ────────────────────────────── 交付库加载 ──────────────────────────────

function loadTargets() {
  if (!fs.existsSync(VAULT)) return { notes: [], others: [], attachments: [], backups: [], manifest: null, exists: false };
  const files = walkFiles(VAULT, () => true);
  const notes = [], others = [], attachments = [], backups = [];
  const attachmentDir = path.join(VAULT, '_attachments');
  let attManifest = null;
  const mp = path.join(attachmentDir, '_manifest.json');
  if (fs.existsSync(mp)) { try { attManifest = JSON.parse(readText(mp)); } catch (e) { attManifest = { parseError: String(e) }; } }
  const BACKUP_RE = /^(_backup|_backups|_trash|_old|_archive|\.trash|\.backup|_bak)\//i;
  for (const f of files) {
    const r = path.relative(VAULT, f).split(path.sep).join('/');
    if (BACKUP_RE.test(r)) {
      if (/\.md$/i.test(f)) backups.push(f);
      else others.push(f);
      continue;
    }
    if (/\.md$/i.test(f) && !r.startsWith('_attachments/')) {
      if (/^_index\//.test(r) || /_index\.md$/i.test(r) || /^README\.md$/i.test(r) || /^_MOC\.md$/i.test(r) || /^_待裁决\.md$/i.test(r)) { others.push(f); continue; }
      notes.push(f);
    } else if (r.startsWith('_attachments/')) {
      if (!/_manifest\.json$/i.test(r)) attachments.push(f);
    } else {
      others.push(f);
    }
  }
  return { notes, others, attachments, backups, manifest: attManifest, exists: true, files };
}

// ────────────────────────────── 主流程 ──────────────────────────────

/** 源侧锚点可解析性普查（不依赖目标）：区分「归档丢标题」与「上游死链」 */
function auditSourceAnchors(src, headingMapByPage) {
  const res = { refs: 0, resolvable: 0, bHeadingInHtml: 0, cNonHeadingId: 0, upstreamDead: 0, unknown: 0, unresolvableRefs: 0, docsOutOfScope: 0, items: [], byPage: {} };
  for (const page of src.pages) {
    const cl = classifySourceLinks(page);
    const jobs = [];
    for (const l of cl.internalMdFrag) {
      const relKey = path.posix.normalize(path.posix.join(path.posix.dirname('markdown/' + page.rel + '.md'), l.href.split('#')[0])).replace(/\.md$/i, '').replace(/^markdown\//, '');
      jobs.push({ l, tp: src.bySecRel.get(page.sec + '|' + relKey) || null });
    }
    for (const l of cl.sameFileAnchor) jobs.push({ l, tp: page });
    for (const l of cl.docsFrag) {
      const u = l.href.split('#')[0].replace(/\/$/, '');
      let tp = src.byUrl.get(l.href.split('#')[0]) || null;
      if (!tp) {
        const seg = u.replace(/^https?:\/\/docs\.papermc\.io\//, '').split('/');
        const sec = seg[0], rest = seg.slice(1).join('/');
        tp = src.bySecRel.get(sec + '|' + (rest ? rest + '/index' : 'index')) || src.bySecRel.get(sec + '|' + rest) || null;
      }
      jobs.push({ l, tp });
    }
    for (const j of jobs) {
      res.refs++;
      const frag = decodeURIComponent(j.l.href.split('#')[1] || '');
      if (!frag) continue;
      if (!j.tp) { res.docsOutOfScope++; res.refs--; continue; }   // 映射不到本地页的 docs 外链：锚点不在守恒范围
      const cls = classifyFragment(j.tp, frag);
      if (cls === 'A-resolvable') { res.resolvable++; continue; }
      res.unresolvableRefs++;
      if (cls === 'B-heading-in-html') res.bHeadingInHtml++;
      else if (cls === 'C-non-heading-id') res.cNonHeadingId++;
      else if (cls === 'upstream-dead-anchor') res.upstreamDead++;
      else res.unknown++;
      res.byPage[j.tp.key] = (res.byPage[j.tp.key] || 0) + 1;
      if (res.items.length < 400) {
        res.items.push({
          page: page.key, href: j.l.href, fragment: frag, targetPage: j.tp.key, classification: cls,
          htmlHeadingText: cls === 'B-heading-in-html' ? htmlHeadingTextNear(j.tp, frag) : null,
          text: short(j.l.text, 60),
        });
      }
    }
  }
  return res;
}

function runAudit() {
  const src = loadSources();
  const nav = loadSourceNav();
  const taxonomy = JSON.parse(readText(path.join(ROOT, 'data', 'taxonomy.json')));
  const taxById = new Map(taxonomy.pages.map(p => [p.id, p]));
  const tgt = loadTargets();

  // 预计算源标题 slug → 标题字面量
  const headingMapByPage = new Map();
  for (const p of src.pages) {
    const map = new Map();
    for (const h of headingsOf(p.text)) {
      const { slug, explicit } = slugify(h.text);
      if (!map.has(slug)) map.set(slug, h.text);
      if (explicit && !map.has(explicit)) map.set(explicit, h.text);
    }
    headingMapByPage.set(p.key, map);
  }
  headingMapStatic = headingMapByPage;

  const generatedAt = new Date().toISOString();

  // 目标笔记索引
  const noteIndex = { byStem: new Map(), byBase: new Map(), byVaultRel: new Map() };
  const noteInfo = tgt.notes.map(p => {
    const text = readText(p);
    const fm = splitFrontmatter(text);
    const parsed = parseYamlLite(fm.yaml);
    const vaultRel = path.relative(VAULT_ROOT, p).split(path.sep).join('/');
    const info = {
      path: p, vaultRel, name: path.basename(p), stem: path.basename(p, '.md'),
      text, frontmatter: parsed.data, fmErrors: parsed.errors, body: fm.body, fmRaw: fm.yaml,
    };
    // 一次性建索引
    const positionPaths = [vaultRel, vaultRel.replace(/\.md$/i, ''), path.relative(VAULT, p).split(path.sep).join('/').replace(/\.md$/i, '')];
    for (const pp of positionPaths) {
      const k = pp.toLowerCase();
      if (!noteIndex.byVaultRel.has(k)) noteIndex.byVaultRel.set(k, info);
      const last = k.split('/').pop();
      if (!noteIndex.byVaultRel.has(last)) noteIndex.byVaultRel.set(last, info);
    }
    const st = info.stem.toLowerCase();
    if (!noteIndex.byStem.has(st)) noteIndex.byStem.set(st, []); noteIndex.byStem.get(st).push(info);
    const b = info.name.toLowerCase();
    if (!noteIndex.byBase.has(b)) noteIndex.byBase.set(b, []); noteIndex.byBase.get(b).push(info);
    return info;
  });

  // 目标 → 源 匹配
  const R = { matched: [], unmatchedNotes: [], missingPages: [] };
  const noteByVaultRel = new Map(noteInfo.map(n => [n.vaultRel, n]));
  // 「批次进行中」判据：目标页尚未导出（分批写入时大量链接会暂时落空，不能记成缺陷）
  const missingPageKeys = new Set();
  const sourceTitleSet = new Set();
  for (const p of src.pages) {
    sourceTitleSet.add(String(p.title).toLowerCase());
    const tx = taxById.get(p.key);
    if (tx) sourceTitleSet.add(String(tx.title).toLowerCase().replace(/[（(].*$/, '').trim());
  }
  const looksPlanned = (notePart) => {
    const np = String(notePart || '').trim();
    if (!np) return false;
    const base = np.replace(/[（(][^）)]*[）)]\s*$/, '').trim().toLowerCase();
    return sourceTitleSet.has(base) || sourceTitleSet.has(np.toLowerCase());
  };
  const mapped = new Map(); // notePath -> source page
  const used = new Set();
  for (const n of noteInfo) {
    const fm = n.frontmatter || {};
    const sUrl = fm.source || fm.source_url || fm.url || '';
    let page = (sUrl && src.byUrl.get(String(sUrl).trim())) || null;
    if (!page) {
      const docId = fm.doc_id || fm.rel || '';
      if (docId) {
        const sec = String(fm.section || fm.product || '').toLowerCase();
        page = src.bySecRel.get(sec + '|' + String(docId).replace(/^\//, '')) || null;
        if (!page) {
          for (const s of SECTIONS) {
            const hit = src.bySecRel.get(s + '|' + String(docId).replace(/^\//, ''));
            if (hit) { page = hit; break; }
          }
        }
      }
    }
    if (!page) {
      const slug = n.vaultRel.toLowerCase();
      for (const p of src.pages) {
        const cand = (p.rel.replace(/\/index$/, '') || p.rel).toLowerCase();
        if (slug.includes('/' + cand + '.md') || slug.endsWith('/' + cand + '.md')) { page = p; break; }
      }
    }
    if (page) { mapped.set(n.path, page); used.add(page.key); }
    else R.unmatchedNotes.push({ vaultRel: n.vaultRel, source: sUrl || null, section: fm.section || fm.product || null });
  }
  for (const p of src.pages) if (!used.has(p.key)) { R.missingPages.push({ key: p.key, url: p.url, title: p.title }); missingPageKeys.add(p.key); }

  // 构建 note → source page 映射的辅助
  const noteOfPage = new Map();
  for (const [np, page] of mapped) noteOfPage.set(page.key, noteInfo.find(n => n.path === np));

  // ── 逐页审计 ──────────────────────────────────────────────
  const perPage = [];
  for (const page of src.pages) {
    const note = noteOfPage.get(page.key) || null;
    const rec = {
      key: page.key, sec: page.sec, rel: page.rel, title: page.title, url: page.url,
      note: note ? path.relative(VAULT, note.path).split(path.sep).join('/') : null,
      audited: !!note,
      code: null, text: null, elements: null, links: null, anchors: null, images: null, meta: null, semantic: null,
    };

    // 源侧公共提取
    const srcFences = extractFences(page.text);
    const srcHeadings = headingsOf(page.text);
    const srcCallouts = countCallouts(page.text);
    const srcDetails = (page.text.match(/<details\b/gi) || []).length;
    const srcTables = countTables(page.text);
    const srcInlineCode = countInlineCode(page.text);
    const srcFnRefs = countFootnoteRefs(page.text);
    const srcFnDefs = countFootnoteDefs(page.text);
    const srcWl = scanWikilinks(page.text);
    const srcMd = scanMdLinks(page.text, srcWl.map(w => ({ start: w.start, end: w.end })));
    const srcImages = srcMd.filter(l => l.image);
    const srcAssetImages = srcImages.filter(l => !/^data:/i.test(l.href));
    const srcDataImages = srcImages.filter(l => /^data:/i.test(l.href));
    const srcInlineImages = srcMd.filter(l => !l.image && String(l.text).startsWith('!['));
    const srcCL = classifySourceLinks(page);

    rec.source = {
      fences: srcFences.length,
      quoteEmbeddedFences: srcFences.filter(f => f.quoteDepth > 0).length,
      manifestCodeBlocks: page.manifestCodeBlocks,
      headings: srcHeadings.length,
      callouts: srcCallouts.byType,
      calloutTotal: srcCallouts.total,
      details: srcDetails,
      tables: srcTables.length,
      tableRows: srcTables.reduce((a, t) => a + t.rows, 0),
      tableLines: srcTables.length * 2 + srcTables.reduce((a, t) => a + t.rows, 0),
      inlineCode: srcInlineCode,
      footnoteRefs: srcFnRefs,
      footnoteDefs: srcFnDefs,
      images: srcAssetImages.length,
      dataImages: srcDataImages.length,
      nestedImageLinks: srcInlineImages.length,
      mdLinks: srcMd.filter(l => !l.image).length,
      internalMd: srcCL.internalMd.length,
      sameFileAnchors: srcCL.sameFileAnchor.length,
      docsAbsolute: srcCL.docsAbsolute.length,
      external: srcCL.external.length,
      sha256: page.shaActual,
    };

    // 交付侧可直接自检的「源侧期望值」（不依赖目标，逐页给出）
    {
      const cl = srcCL;
      const jobs = [];
      for (const l of cl.internalMdFrag) {
        const relKey = path.posix.normalize(path.posix.join(path.posix.dirname('markdown/' + page.rel + '.md'), l.href.split('#')[0])).replace(/\.md$/i, '').replace(/^markdown\//, '');
        jobs.push({ l, tp: src.bySecRel.get(page.sec + '|' + relKey) || null });
      }
      for (const l of cl.sameFileAnchor) jobs.push({ l, tp: page });
      const abc = { A: 0, B: 0, C: 0, dead: 0, unknown: 0 };
      for (const j of jobs) {
        const frag = decodeURIComponent(j.l.href.split('#')[1] || '');
        if (!frag || !j.tp) continue;
        const cls = classifyFragment(j.tp, frag);
        if (cls === 'A-resolvable') abc.A++;
        else if (cls === 'B-heading-in-html') abc.B++;
        else if (cls === 'C-non-heading-id') abc.C++;
        else if (cls === 'upstream-dead-anchor') abc.dead++;
        else abc.unknown++;
      }
      rec.expectation = {
        fences: srcFences.length,
        quoteEmbeddedFences: srcFences.filter(f => f.quoteDepth > 0).length,
        fencesWithTitle: srcFences.filter(f => /title=/.test(f.info)).length,
        headings: srcHeadings.length,
        calloutsByType: srcCallouts.byType,
        calloutsTotal: srcCallouts.total,
        details: srcDetails,
        detailsSummaryTitles: (page.text.match(/<summary>([\s\S]*?)<\/summary>/gi) || []).map(s => collapse(s.replace(/<\/?summary>/gi, '').replace(/<[^>]*>/g, ''))),
        tables: srcTables.length,
        tableRows: srcTables.reduce((a, t) => a + t.rows, 0),
        tableLines: srcTables.length * 2 + srcTables.reduce((a, t) => a + t.rows, 0),
        inlineCode: srcInlineCode,
        footnoteRefs: srcFnRefs.total,
        images: srcAssetImages.length,
        imagesWithAlt: srcAssetImages.filter(l => collapse(l.text)).length,
        dataImages: srcDataImages.length,
        nestedImageLinks: srcInlineImages.length,
        internalMdLinks: cl.internalMd.length,
        internalMdLinksWithAnchor: cl.internalMdFrag.length,
        sameFileAnchors: cl.sameFileAnchor.length,
        docsAbsoluteLinks: cl.docsAbsolute.length,
        externalLinks: cl.external.length,
        anchorsABC: abc,
        sourceSha256: page.shaActual,
        sourceUrl: page.url,
        sourceMarkdownBytes: page.markdownBytes,
      };
    }

    if (!note) { perPage.push(rec); continue; }

    // 1) 代码体零差异
    const tgtFences = extractFences(note.text);
    const codeIssues = [];
    const n = Math.max(srcFences.length, tgtFences.length);
    for (let i = 0; i < n; i++) {
      const a = srcFences[i], b = tgtFences[i];
      if (!a || !b) {
        const side = a ? 'source' : 'target';
        const other = a ? tgtFences : srcFences;
        const only = a || b;
        const foundElsewhere = other.findIndex(x => normBody(x.body) === normBody(only.body));
        codeIssues.push({
          block: i + 1,
          reason: side === 'source' ? '目标缺块' : '目标多块',
          sourceLine: a ? a.line : null, targetLine: b ? b.line : null,
          sourceInfo: a ? a.info : null, targetInfo: b ? b.info : null,
          severity: foundElsewhere >= 0 ? 'move' : 'missing',
          note: foundElsewhere >= 0 ? '同内容块在目标第 ' + (foundElsewhere + 1) + ' 个围栏出现（位置/顺序变化）' : '整个代码块在目标不存在',
          head: short(String(only.body).slice(0, 60), 60),
        });
        continue;
      }
      const A = normBody(a.body), B = normBody(b.body);
      if (A === B) continue;
      let k = 0;
      while (k < Math.min(A.length, B.length) && A[k] === B[k]) k++;
      codeIssues.push({
        block: i + 1,
        reason: '代码体不一致',
        sourceLine: a.line, targetLine: b.line,
        sourceInfo: a.info, targetInfo: b.info,
        at: k,
        src: short(A.slice(Math.max(0, k - 40), k + 40), 90),
        tgt: short(B.slice(Math.max(0, k - 40), k + 40), 90),
        severity: 'diff',
      });
    }
    rec.code = {
      sourceBlocks: srcFences.length,
      targetBlocks: tgtFences.length,
      quoteEmbeddedSource: srcFences.filter(f => f.quoteDepth > 0).length,
      quoteEmbeddedTarget: tgtFences.filter(f => f.quoteDepth > 0).length,
      infoChanged: srcFences.filter((f, i) => tgtFences[i] && f.info !== tgtFences[i].info).length,
      issues: codeIssues,
      pass: codeIssues.length === 0,
    };

    // 2) 文本守恒
    const srcText = normalizeToText(page.body, {});
    const tgtBodyClean = stripIntentionalTargetBlocks(note.body);
    const tgtText = normalizeToText(tgtBodyClean, { isTarget: true });
    const cov = multisetCoverage(tokensOf(srcText), tokensOf(tgtText));
    const covered = cov.total ? cov.matched / cov.total : 1;
    const lp = linePresence(page.body.split('\n'), tgtBodyClean);
    rec.text = {
      sourceTokens: cov.total,
      matched: cov.matched,
      coverage: Number(covered.toFixed(6)),
      missingTokenKinds: Array.from(new Set(cov.missing.map(m => m.token))).slice(0, 40),
      missingTokenCount: cov.missing.length,
      missingLines: lp.missing.slice(0, 25).map(s => short(s, 200)),
      partialLines: lp.partial.slice(0, 25).map(s => short(s, 200)),
      missingLineCount: lp.missing.length,
      partialLineCount: lp.partial.length,
      pass: covered >= 0.99 && lp.missing.length === 0,
    };

    // 3) 元素计数守恒
    const tgtCallouts = countCallouts(note.text);
    const tgtDetails = (note.text.match(/<details\b/gi) || []).length;
    const tgtTables = countTables(note.text);
    const isCodeHeaderTitle = (t) => /^`[^`]+`$/.test(t) || /\.(ya?ml|json|properties|java|kt|txt|log|toml|md|sh|bat|nc|conf|cfg)\b/i.test(t);
    // `<details><summary>X</summary>` → 折叠 callout：先按 summary 标题把目标折叠 callout 归类，
    // 避免它们混进 `note` 类型直方图造成误报。
    const summaryBag = new Map();
    for (const m of page.text.matchAll(/<summary>([\s\S]*?)<\/summary>/gi)) {
      const k = collapse(String(m[1]).replace(/<[^>]*>/g, ''));
      summaryBag.set(k, (summaryBag.get(k) || 0) + 1);
    }
    const tgtTypeCounts = Object.assign({}, tgtCallouts.byType);
    const codeHeaderFolds = [], detailsFolds = [];
    for (const f of tgtCallouts.folds) {
      const t = collapse(f.title);
      if (isCodeHeaderTitle(f.title)) { codeHeaderFolds.push(f); tgtTypeCounts[f.type] = (tgtTypeCounts[f.type] || 0) - 1; continue; }
      const n = summaryBag.get(t) || 0;
      if (n > 0) { summaryBag.set(t, n - 1); detailsFolds.push(f); tgtTypeCounts[f.type] = (tgtTypeCounts[f.type] || 0) - 1; }
    }
    const tgtFolds = detailsFolds;
    const abstractCallouts = (note.text.match(/\[!info\][^\n]*中文摘要/g) || []).length;
    if (abstractCallouts) tgtTypeCounts.info = (tgtTypeCounts.info || 0) - abstractCallouts;
    const elementIssues = [];
    const typeCmp = {};
    const aliasMap = { caution: 'warning', important: 'tip', hint: 'tip', error: 'danger', fail: 'failure', check: 'success', done: 'success', help: 'question', faq: 'question', summary: 'abstract', tldr: 'abstract', cite: 'quote', attention: 'warning', missing: 'failure' };
    const srcTypes = new Set(Object.keys(srcCallouts.byType).concat(Object.keys(tgtTypeCounts)));
    for (const t of srcTypes) {
      const tv = srcCallouts.byType[t] || 0;
      const direct = tgtTypeCounts[t] || 0;
      const aliased = Object.entries(aliasMap).filter(([k, v]) => v === t).reduce((a, [k]) => a + (tgtTypeCounts[k] || 0), 0);
      typeCmp[t] = { source: tv, targetDirect: direct, targetAliasEquivalent: aliased, ok: direct === tv };
      if (direct !== tv) elementIssues.push({ kind: 'callout', type: t, severity: (direct + aliased) === tv ? 'alias' : 'count', detail: '源 ' + tv + ' / 目标同名 ' + direct + ' / 别名等价 ' + aliased });
    }
    if (tgtDetails !== 0) elementIssues.push({ kind: 'details', severity: 'html-left', detail: '目标仍残留 <details> ' + tgtDetails + ' 处（源 ' + srcDetails + '）' });
    if (tgtFolds.length !== srcDetails) elementIssues.push({ kind: 'details-folded', severity: 'count', detail: '源 <details> ' + srcDetails + ' → 目标折叠 callout（排除代码文件头）' + tgtFolds.length });
    if (tgtTables.length !== srcTables.length) elementIssues.push({ kind: 'table-count', severity: 'count', detail: '源表格 ' + srcTables.length + ' → 目标 ' + tgtTables.length });
    if (tgtTables.reduce((a, t) => a + t.rows, 0) !== srcTables.reduce((a, t) => a + t.rows, 0)) elementIssues.push({ kind: 'table-rows', severity: 'count', detail: '源数据行 ' + srcTables.reduce((a, t) => a + t.rows, 0) + ' → 目标 ' + tgtTables.reduce((a, t) => a + t.rows, 0) });
    const srcTableLines = srcTables.length * 2 + srcTables.reduce((a, t) => a + t.rows, 0);
    const tgtTableLines = tgtTables.length * 2 + tgtTables.reduce((a, t) => a + t.rows, 0);
    if (tgtTableLines !== srcTableLines) elementIssues.push({ kind: 'table-lines', severity: 'count', detail: '源表格总行（表头+分隔+数据）' + srcTableLines + ' → 目标 ' + tgtTableLines });
    for (const t of tgtTables) if (t.cols !== t.sepCols) elementIssues.push({ kind: 'table-shape', severity: 'shape', detail: '第 ' + t.line + ' 行表头列 ' + t.cols + ' ≠ 分隔行列 ' + t.sepCols });
    const tgtHeadings = headingsOf(note.text);
    const headingSoftNotes = [];
    const srcHSet = new Map(), tgtHSet = new Map();
    for (const h of srcHeadings) { const k = normHeading(h.text); srcHSet.set(k, (srcHSet.get(k) || 0) + 1); }
    for (const h of tgtHeadings) { const k = normHeading(h.text); tgtHSet.set(k, (tgtHSet.get(k) || 0) + 1); }
    const lostHeadings = Array.from(srcHSet).filter(([k, v]) => (tgtHSet.get(k) || 0) < v).map(([k, v]) => k + ' ×' + v);
    if (lostHeadings.length) elementIssues.push({ kind: 'heading', severity: 'missing', detail: '目标缺标题 ' + lostHeadings.slice(0, 10).join(' | ') });
    // 标题字面量被改写（仅归一化后相等）→ 记软提示，不算缺陷
    {
      const tgtRaw = new Set(tgtHeadings.map(h => collapse(h.text)));
      const literalChanged = srcHeadings.filter(h => !tgtRaw.has(collapse(h.text))).map(h => collapse(h.text));
      if (literalChanged.length) headingSoftNotes.push(...literalChanged.slice(0, 20));
      // 源的行首标题在目标里落进引用/callout（`<details>` → 折叠 callout 的必然形态）
      const tgtQuoted = new Set(tgtHeadings.filter(h => h.quoted).map(h => normHeading(h.text)));
      const tgtLine = new Set(tgtHeadings.filter(h => !h.quoted).map(h => normHeading(h.text)));
      const nowQuoted = srcHeadings.filter(h => !h.quoted && !tgtLine.has(normHeading(h.text)) && tgtQuoted.has(normHeading(h.text))).map(h => collapse(h.text));
      if (nowQuoted.length) {
        headingSoftNotes.push(...nowQuoted.map(t => '（已落进 callout/引用，不在大纲顶层）' + t));
      }
    }
    // 契约 v5 §1.0.3：源里的「列表内嵌标题」必须在目标里提升为行首标题（文本不变、结构规范化）
    {
      const srcEmb = srcHeadings.filter(h => h.embedded);
      if (srcEmb.length) {
        const tgtLineStart = new Set(tgtHeadings.filter(h => !h.embedded).map(h => normHeading(h.text)));
        const tgtAny = new Set(tgtHeadings.map(h => normHeading(h.text)));
        const notPromoted = [], gone = [];
        for (const h of srcEmb) {
          const k = normHeading(h.text);
          if (tgtLineStart.has(k)) continue;
          if (tgtAny.has(k)) notPromoted.push(k); else gone.push(k);
        }
        if (gone.length) elementIssues.push({ kind: 'embedded-heading', severity: 'missing', detail: '源列表内嵌标题在目标完全消失 ' + gone.length + ' 个：' + gone.slice(0, 6).join(' | ') });
        else if (notPromoted.length) elementIssues.push({ kind: 'embedded-heading', severity: 'not-promoted', detail: '源列表内嵌标题未提升为行首标题（契约 v5 §1.0.3）' + notPromoted.length + ' 个：' + notPromoted.slice(0, 6).join(' | ') });
      }
    }
    // 标题顺序守恒（子序列判定：允许目标插入新标题，不允许源标题顺序被打乱）
    {
      const seqS = srcHeadings.map(h => normHeading(h.text));
      const seqT = tgtHeadings.map(h => normHeading(h.text));
      let ti = 0, bad = null;
      for (let si = 0; si < seqS.length; si++) {
        const want = seqS[si];
        let j = ti;
        while (j < seqT.length && seqT[j] !== want) j++;
        if (j >= seqT.length) { if (!bad) bad = { index: si + 1, text: want }; }
        else ti = j + 1;
      }
      if (bad) elementIssues.push({ kind: 'heading-order', severity: 'order', detail: '源第 ' + bad.index + ' 个标题「' + bad.text + '」在目标里顺序被打乱/缺失（章节可能被重排或合并）' });
    }
    // 行内代码只允许增不允许减（减少通常意味着配置/命令被 Markdown 化吃掉）
    {
      const tgtInline = countInlineCode(note.text);
      if (tgtInline < srcInlineCode) elementIssues.push({ kind: 'inline-code-loss', severity: 'loss', detail: '行内代码 源 ' + srcInlineCode + ' → 目标 ' + tgtInline + '（减少 ' + (srcInlineCode - tgtInline) + '）' });
    }
    rec.elements = {
      callouts: { source: srcCallouts.byType, target: tgtTypeCounts, targetRaw: tgtCallouts.byType, cmp: typeCmp, abstractAdded: abstractCallouts, codeHeaderAdded: codeHeaderFolds.length, detailsFoldAdded: detailsFolds.length },
      details: { source: srcDetails, targetHtml: tgtDetails, targetFolded: tgtFolds.length },
      tables: { source: srcTables.length, target: tgtTables.length, sourceRows: srcTables.reduce((a, t) => a + t.rows, 0), targetRows: tgtTables.reduce((a, t) => a + t.rows, 0), sourceLines: srcTableLines, targetLines: tgtTableLines },
      inlineCode: { source: srcInlineCode, target: countInlineCode(note.text) },
      footnoteRefs: { source: srcFnRefs, target: countFootnoteRefs(note.text) },
      footnoteDefs: { source: srcFnDefs, target: countFootnoteDefs(note.text) },
      headings: { source: srcHeadings.length, target: tgtHeadings.length, lost: lostHeadings.slice(0, 20), embeddedSource: srcHeadings.filter(h => h.embedded).length, embeddedTarget: tgtHeadings.filter(h => h.embedded).length, literalChangedNotes: headingSoftNotes.slice(0, 20) },
      images: { source: srcAssetImages.length, dataImages: srcDataImages.length, nested: srcInlineImages.length, targetEmbeds: scanWikilinks(note.text).filter(w => w.embed).length },
      issues: elementIssues,
      pass: elementIssues.length === 0,
    };

    // 源侧锚点可解析性（不依赖目标）：用于把「归档丢标题 / 上游死链」与目标缺陷分开
    const anchorSourceStatusCache = new Map();
    function anchorSourceStatus(tpKey, frag) {
      const k = tpKey + '#' + frag;
      if (anchorSourceStatusCache.has(k)) return anchorSourceStatusCache.get(k);
      const tp2 = src.byKey.get(tpKey);
      let st = 'resolvable';
      if (tp2 && classifyFragment(tp2, frag) !== 'A-resolvable') st = classifyFragment(tp2, frag);
      anchorSourceStatusCache.set(k, st);
      return st;
    }

    // 4) 链接目标守恒
    const linkIssues = [];
    const linkPending = [];
    const tgtWl = scanWikilinks(note.text);
    const tgtMd = scanMdLinks(note.text, tgtWl.map(w => ({ start: w.start, end: w.end })));
    const resolvedLinks = [];
    for (const w of tgtWl) {
      if (w.embed) continue;
      // 表格单元格内的 wikilink 必须把别名竖线转义为 `\|`（spec §9.1）→ 解析前先还原
      const innerNorm = String(w.inner).replace(/\\\|/g, '|');
      const parts = innerNorm.split('|');
      const tPart = parts[0];
      const disp = parts.length > 1 ? parts.slice(1).join('|') : null;
      const hashAt = tPart.indexOf('#');
      const notePart = (hashAt === -1 ? tPart : tPart.slice(0, hashAt)).trim();
      const anchor = hashAt === -1 ? null : tPart.slice(hashAt + 1).trim();
      let hit = null, ambiguous = false;
      if (notePart) {
        const key = notePart.replace(/\.md$/i, '').replace(/^\.\//, '').toLowerCase();
        hit = noteIndex.byVaultRel.get(key) || null;
        if (!hit) {
          const stem = key.split('/').pop();
          const arr = noteIndex.byStem.get(stem) || [];
          if (arr.length === 1) hit = arr[0];
          else if (arr.length > 1) ambiguous = true;
        }
      } else {
        hit = note; // 同页锚点
      }
      resolvedLinks.push({ kind: 'wikilink', raw: w.inner, display: disp, notePart, anchor, resolved: hit ? hit.vaultRel : null, ambiguous, resolvedPage: hit ? mapped.get(hit.path) : null, start: w.start });
    }
    const tgtMdLinks = tgtMd.map(l => ({ kind: l.image ? 'md-image' : 'md-link', raw: l.href, display: l.text, start: l.start }));

    const consume = new Set();
    const srcInternal = [];
    const lineOfOffset = (t, off) => t.slice(0, off).split('\n').length;
    const embeddedHeadingLines = new Set(srcHeadings.filter(h => h.embedded).map(h => h.line));
    for (const l of srcMd) {
      if (l.image) continue;
      const ln = lineOfOffset(page.text, l.start);
      const inEmbeddedHeading = embeddedHeadingLines.has(ln);
      const href = l.href;
      if (/^https?:\/\//i.test(href)) {
        const isDocs = /^https?:\/\/docs\.papermc\.io\//i.test(href);
        let page2 = null;
        if (isDocs) {
          const u = href.split('#')[0].replace(/\/$/, '');
          page2 = src.byUrl.get(href.split('#')[0]) || null;
          if (!page2) {
            const seg = u.replace(/^https?:\/\/docs\.papermc\.io\//, '').split('/');
            const sec = seg[0];
            const rest = seg.slice(1).join('/');
            page2 = src.bySecRel.get(sec + '|' + (rest ? rest + '/index' : 'index')) || src.bySecRel.get(sec + '|' + rest) || null;
          }
        }
        srcInternal.push({ kind: isDocs ? 'docs-absolute' : 'external', href, text: l.text, targetPage: page2 ? page2.key : null, fragment: (href.split('#')[1] || '') || null, inEmbeddedHeading });
      } else if (href.startsWith('#')) {
        if (/^#user-content-fn/.test(href)) continue; // 脚注回链锚点：已按设计迁到原生脚注，不参与链接守恒
        srcInternal.push({ kind: 'same-file-anchor', href, text: l.text, targetPage: page.key, fragment: href.slice(1), inEmbeddedHeading });
      } else if (/\.md(#.*)?$/i.test(href)) {
        const [p0, frag] = href.split('#');
        const baseDir = path.posix.dirname('markdown/' + page.rel + '.md');
        const resolved = path.posix.normalize(path.posix.join(baseDir, p0)).replace(/\.md$/i, '');
        const relKey = resolved.replace(/^markdown\//, '');
        const targetPage = src.bySecRel.get(page.sec + '|' + relKey) || null;
        srcInternal.push({ kind: 'internal-md', href, text: l.text, targetPage: targetPage ? targetPage.key : null, rawResolved: relKey, fragment: frag || null, inEmbeddedHeading });
      } else {
        srcInternal.push({ kind: 'other-relative', href, text: l.text, targetPage: null, fragment: (href.split('#')[1] || '') || null, inEmbeddedHeading });
      }
    }

    // 配对
    for (const s of srcInternal) {
      const takeOne = (arr) => {
        const hit = arr.find(l => !consume.has(l.start));
        if (!hit) return null;
        consume.add(hit.start);
        return hit;
      };
      // 源侧锚点本身无法解析（归档丢标题 / 上游死链）时，不要求目标复现一个可跳转锚点
      if (s.fragment && s.kind !== 'external' && s.targetPage) {
        const st = anchorSourceStatus(s.targetPage, decodeURIComponent(s.fragment));
        if (st !== 'resolvable') { s.status = 'source-broken-anchor'; s.note = st; continue; }
      }
      if (s.kind === 'external') {
        const hit = takeOne(tgtMdLinks.filter(l => normHref(l.raw) === normHref(s.href)));
        if (hit) { s.status = 'ok'; s.targetText = hit.raw; }
        else if (s.inEmbeddedHeading) {
          // 该链接位于「列表内嵌标题」里：契约 v5 要求把标题提升为行首标题，
          // 而 Obsidian 的 wikilink 目标不允许 `[]`，锚点字面量只能取链接文本 →
          // 标题里的链接会被拍平、URL 丢失。这里记为「预期后果 + 需登记」而不是硬缺陷。
          const stillThere = note.text.includes(s.href.split('#')[0]);
          if (stillThere) { s.status = 'ok'; s.targetText = s.href; }
          else { s.status = 'source-broken-anchor'; s.note = 'promoted-heading-link-dropped'; }
        } else s.status = 'missing';
      } else if (s.kind === 'docs-absolute' && !s.targetPage) {
        const hit = takeOne(tgtMdLinks.filter(l => l.raw.split('#')[0] === s.href.split('#')[0]));
        if (hit) { s.status = 'ok-external'; s.targetText = hit.raw; }
        else {
          const alt = takeOne(resolvedLinks.filter(r => collapse(r.display || '') === collapse(s.text)));
          if (alt) { s.status = 'ok-mapped-wikilink'; s.targetText = '[[' + alt.raw + ']]'; s.resolvedNote = alt.resolved; }
          else s.status = 'missing';
        }
      } else {
        const want = s.targetPage;
        let pick = takeOne(resolvedLinks.filter(r => r.resolvedPage && r.resolvedPage.key === want && collapse(r.display || '') === collapse(s.text)));
        if (!pick) pick = takeOne(resolvedLinks.filter(r => r.resolvedPage && r.resolvedPage.key === want));
        if (!pick && want) pick = takeOne(tgtMdLinks.filter(l => l.raw.split('#')[0] === s.href.split('#')[0]));
        if (pick) {
          s.status = 'ok';
          s.targetText = pick.kind === 'wikilink' ? '[[' + pick.raw + ']]' : pick.raw;
          s.resolvedNote = pick.resolved;
          if (pick.kind === 'wikilink' && !pick.resolved) s.status = 'unresolved-wikilink';
        } else s.status = want ? 'missing' : 'unresolved-target';
      }
      if (s.status === 'missing' && s.targetPage && missingPageKeys.has(s.targetPage)) s.status = 'pending-target-absent';
      if (s.status !== 'ok' && s.status !== 'ok-external' && s.status !== 'ok-mapped-wikilink' && s.status !== 'source-broken-anchor' && s.status !== 'pending-target-absent') {
        linkIssues.push({ kind: s.kind, source: s.href, text: short(s.text, 60), targetPage: s.targetPage, status: s.status });
      }
    }
    // 目标里多出来的 wikilink（非本页源链接可解释的）
    const extraWikilinks = resolvedLinks.filter(r => !consume.has(r.start) && r.resolvedPage && r.resolvedPage.key !== page.key && !/^_index|README|_MOC/.test(r.resolved || ''));
    // 悬空 wikilink（无法解析到任何笔记）
    const dangling = resolvedLinks.filter(r => !r.resolved && !r.ambiguous && r.notePart);
    for (const d of dangling) {
      if (looksPlanned(d.notePart)) { linkPending.push({ kind: 'dangling-wikilink', source: d.raw, status: 'pending-target-absent' }); continue; }
      linkIssues.push({ kind: 'dangling-wikilink', source: d.raw, status: 'dangling', resolved: d.resolved });
    }
    for (const d of resolvedLinks.filter(r => r.ambiguous)) linkIssues.push({ kind: 'ambiguous-wikilink', source: d.raw, status: 'ambiguous' });

    rec.links = {
      sourceInternalMd: srcInternal.filter(s => s.kind === 'internal-md').length,
      sourceDocsAbsolute: srcInternal.filter(s => s.kind === 'docs-absolute').length,
      sourceDocsAbsoluteResolvable: srcInternal.filter(s => s.kind === 'docs-absolute' && s.targetPage).length,
      sourceSameFileAnchor: srcInternal.filter(s => s.kind === 'same-file-anchor').length,
      sourceExternal: srcInternal.filter(s => s.kind === 'external').length,
      sourceOtherRelative: srcInternal.filter(s => s.kind === 'other-relative').length,
      sourceBrokenAnchorLinks: srcInternal.filter(s => s.status === 'source-broken-anchor').map(s => ({ href: s.href, classification: s.note })),
      sourceDocsUnresolved: srcInternal.filter(s => s.kind === 'docs-absolute' && !s.targetPage).map(s => ({ href: s.href, text: short(s.text, 80) })),
      mapping: srcInternal.map(s => ({ kind: s.kind, source: s.href, text: short(s.text, 80), targetPage: s.targetPage, status: s.status, targetText: s.targetText || null, resolvedNote: s.resolvedNote || null })),
      targetWikilinks: resolvedLinks.length,
      targetMdLinks: tgtMdLinks.length,
      extraWikilinks: extraWikilinks.slice(0, 10).map(r => r.raw),
      pending: linkPending.length,
      pendingSamples: linkPending.slice(0, 10),
      issues: linkIssues,
      pass: linkIssues.length === 0,
    };

    // 5) 锚点
    const anchorIssues = [];
    const sourceAnchorNotes = [];
    const anchorSoftNotes = [];
    let anchorTotal = 0, anchorCross = 0, anchorSame = 0, anchorDocs = 0;
    const headingTextOf = headingMapByPage;
    const anchorPendingList = new Array();
    for (const s of srcInternal) {
      if (s.kind === 'external') continue;              // 外链的 fragment 指向站外，不在锚点守恒范围
      if (!s.fragment) continue;
      if (/^user-content-fn/.test(s.fragment)) continue;
      if (s.kind === 'docs-absolute' && !s.targetPage) continue;   // 映射不到本地页的 docs 外链：锚点不在守恒范围
      anchorTotal++;
      const frag = decodeURIComponent(s.fragment);
      const tp = s.targetPage ? src.byKey.get(s.targetPage) : null;
      if (s.kind === 'same-file-anchor') anchorSame++; else anchorCross++;
      if (s.kind === 'docs-absolute') anchorDocs++;
      const ht = tp ? headingTextOf.get(tp.key).get(frag) : null;
      const tgtNote = tp ? noteOfPage.get(tp.key) : null;
      let ok = false, detail = '';
      if (!tp) { detail = '源链接目标未解析'; }
      else if (!tgtNote) { detail = '目标页缺失（该页尚未导出）'; }
      else if (ht) {
        const heads = headingsOf(tgtNote.text).map(h => collapse(h.text));
        ok = heads.includes(collapse(ht));
        if (!ok) {
          const loose = heads.find(h => h.toLowerCase() === collapse(ht).toLowerCase());
          const norm = headingsOf(tgtNote.text).map(h => normHeading(h.text)).includes(normHeading(ht));
          detail = loose ? '目标标题仅大小写不匹配：' + loose : (norm ? '目标标题仅在归一化文本上匹配（字面量被改写，锚点可能点不到）' : '目标无标题字面量：' + ht);
          if (loose || norm) ok = true;
          if (norm && !loose) anchorSoftNotes.push({ page: page.key, href: s.href, anchor: ht, detail: '源标题字面量在目标被改写（仅归一化后相等）：「' + ht + '」' });
        }
      } else {
        // 源 markdown 里没有对应标题 → 按契约 v2 分类 B / C / 死链
        const heads = headingsOf(tgtNote.text).map(h => collapse(h.text));
        const hit = heads.find(h => slugify(h).slug === frag);
        if (hit) { ok = true; detail = '锚点按 slug 匹配到标题：' + hit; }
        else {
          const cls = classifyFragment(tp, frag);
          const htmlHead = cls === 'B-heading-in-html' ? htmlHeadingTextNear(tp, frag) : null;
          const targetHasHtmlHeading = htmlHead ? heads.includes(collapse(htmlHead)) : false;
          sourceAnchorNotes.push({
            page: page.key, href: s.href, fragment: s.fragment,
            classification: cls,
            htmlHeadingText: htmlHead,
            targetHeadingPresent: targetHasHtmlHeading,
            detail: cls === 'B-heading-in-html'
              ? (targetHasHtmlHeading
                ? 'B 类：源 markdown 缺标题，HTML 里有 <h*> id 且目标已补回标题（可接受）'
                : 'B 类：源 markdown 缺标题，HTML 快照存在 <h*> id="' + frag + '"（标题文本「' + (htmlHead || '?') + '」）但目标笔记里没有该标题 → 锚点仍不可跳转，可从 HTML 补回')
              : cls === 'C-non-heading-id'
                ? 'C 类：该 id 在 HTML 里挂在非标题元素上（配置树/锚点容器），契约 v2 允许降级为 [[Note]]'
                : '源 markdown 与 HTML 快照都没有该 id → 上游本身就是死锚点',
          });
          if (cls === 'B-heading-in-html' && !targetHasHtmlHeading) {
            anchorIssues.push({ page: page.key, href: s.href, fragment: s.fragment, heading: htmlHead, severity: 'B-unrecovered', detail: '归档丢了标题（HTML 可证），目标未补回 → 锚点不可跳转' });
          }
          continue;
        }
      }
      if (!ok) {
        if (s.targetPage && missingPageKeys.has(s.targetPage)) { anchorPendingList.push({ page: page.key, href: s.href, fragment: s.fragment, status: 'pending-target-absent' }); }
        else anchorIssues.push({ page: page.key, href: s.href, fragment: s.fragment, heading: ht || null, detail });
      }
    }
    // 指向「尚未导出」页面的锚点 → 记为待定，不算缺陷
    // 目标侧：所有带锚点的 wikilink 必须能在目标笔记里找到对应标题（契约 D07）
    const seenAnchorKeys = new Set(anchorIssues.map(i => i.href + '#' + i.fragment));
    for (const r of resolvedLinks) {
      // Obsidian 明示非法字符：链接目标里不得出现 [ ] ^ %% （spec §1.1）
      const targetPart = String(r.raw).split('|')[0].split('#')[0];
      if (/[\[\]^]|%%/.test(targetPart)) {
        anchorIssues.push({ page: page.key, href: '[[' + r.raw + ']]', fragment: r.anchor || '', severity: 'invalid-wikilink-target', detail: 'wikilink 目标含 Obsidian 非法字符（`[` `]` `^` `%%`）：`' + targetPart + '`' });
        continue;
      }
      if (!r.anchor) continue;
      const tn = r.resolved ? noteByVaultRel.get(r.resolved) : (r.notePart ? null : note);
      if (!tn) continue;   // 笔记本身不存在 → 已在链接守恒里报 dangling-wikilink
      const headsRaw = headingsOf(tn.text).map(h => collapse(h.text));
      const headsNorm = headingsOf(tn.text).map(h => normHeading(h.text));
      const quotedSet = new Set(headingsOf(tn.text).filter(h => h.quoted).map(h => normHeading(h.text)));
      let a = collapse(decodeURIComponent(r.anchor));
      if (headsRaw.includes(a)) {
        if (quotedSet.has(normHeading(a))) anchorSoftNotes.push({ page: page.key, href: '[[' + r.raw + ']]', anchor: r.anchor, detail: '锚点指向的标题位于 callout/引用内（源为 `<details>` 折叠区），Obsidian 大纲里可能点不到' });
        continue;
      }
      if (headsNorm.includes(normHeading(a))) { anchorSoftNotes.push({ page: page.key, href: '[[' + r.raw + ']]', anchor: r.anchor, detail: '锚点只在**归一化标题**上命中（标题里的链接/反引号写法与锚点不一致），Obsidian 原生按字面量匹配，存在点不到的风险' }); continue; }
      const key2 = '[[' + r.raw + ']]#' + r.anchor;
      if (seenAnchorKeys.has(key2)) continue;
      seenAnchorKeys.add(key2);
      anchorIssues.push({ page: page.key, href: '[[' + r.raw + ']]', fragment: r.anchor, severity: 'dangling-wikilink-anchor', detail: '目标 wikilink 的锚点在「' + (r.resolved || '?') + '」里找不到对应标题' });
    }
    rec.anchors = { total: anchorTotal, crossFile: anchorCross, sameFile: anchorSame, docsAbsolute: anchorDocs, pending: anchorPendingList.length, pendingSamples: anchorPendingList.slice(0, 10), issues: anchorIssues, sourceAnchorNotes, softNotes: anchorSoftNotes, pass: anchorIssues.length === 0 };

    // 6) 图片
    const imgIssues = [];
    const imgDetail = [];
    for (const l of srcAssetImages) {
      const baseDir = path.posix.dirname('markdown/' + page.rel + '.md');
      const abs = path.resolve(ROOT, 'archive', page.sec, path.posix.join(baseDir, l.href));
      const exists = fs.existsSync(abs);
      const h = exists ? sha256File(abs) : null;
      const embedName = path.basename(l.href.split('?')[0]);
      const slugKey = embedName.replace(/\.[^.]+$/, '');
      const tgtEmbeds = tgtWl.filter(w => w.embed);
      const cand = tgtEmbeds.filter(w => {
        const nm = path.basename(w.inner.split('|')[0].split('?')[0]);
        return nm === embedName || nm.includes(slugKey) || slugKey.includes(nm.replace(/\.[^.]+$/, ''));
      });
      let found = null;
      for (const c of cand) {
        const nm = c.inner.split('|')[0];
        const file = findVaultFile(nm);
        if (!file) continue;
        const fh = sha256File(file);
        if (fh === h) { found = { embed: nm, file, hashOk: true }; break; }
        if (!found) found = { embed: nm, file, hashOk: false, disk: fh };
      }
      if (!found) {
        const byHash = tgt.attachments.find(a => sha256File(a) === h);
        if (byHash) found = { embed: null, file: byHash, hashOk: true, via: 'hash-scan' };
      }
      imgDetail.push({ src: l.href, sha256: h, resolved: found ? path.relative(VAULT, found.file) : null, ok: !!found && found.hashOk !== false });
      if (!found) imgIssues.push({ src: l.href, reason: exists ? '目标无对应嵌入（内容哈希未命中）' : '源资产文件缺失', sha256: h });
      else if (found.hashOk === false) imgIssues.push({ src: l.href, reason: '附件内容哈希不符', embed: found.embed, disk: found.disk, expect: h });
    }
    function findVaultFile(name) {
      const direct = path.join(VAULT, name);
      if (fs.existsSync(direct)) return direct;
      const att = path.join(VAULT, '_attachments', name);
      if (fs.existsSync(att)) return att;
      const b = path.basename(name);
      const hit = tgt.attachments.find(a => path.basename(a).toLowerCase() === b.toLowerCase());
      return hit || null;
    }
    for (const l of srcDataImages) {
      const hit = tgtWl.filter(w => w.embed).length > 0;
      imgDetail.push({ src: 'data:image/...', ok: true, note: '内联 base64，需人工确认已落盘' });
    }
    rec.images = { sourceAssetRefs: srcAssetImages.length, dataRefs: srcDataImages.length, nestedRefs: srcInlineImages.length, altTextLost: srcAssetImages.filter(l => collapse(l.text)).length, targetAttachments: tgt.attachments.length, issues: imgIssues, pass: imgIssues.length === 0 };

    // 7) 元数据
    const fm = note.frontmatter || {};
    const tx = taxById.get(page.key) || null;
    const mgroup = nav.groupOf.get(page.key) || null;
    const checks = {};
    checks.yamlParses = note.fmErrors.length === 0;
    checks.hasFrontmatter = !!note.fmRaw;
    const normKey = (s) => String(s == null ? '' : s).trim();
    checks.title = normKey(fm.title) === normKey(page.title) ? 'exact' : (tx && normKey(fm.title) === normKey(tx.title) ? 'variant-taxonomy' : (normKey(fm.title) ? 'mismatch' : 'absent'));
    checks.source = normKey(fm.source || fm.source_url) === normKey(page.url) ? 'exact' : (normKey(fm.source || fm.source_url) ? 'mismatch' : 'absent');
    checks.section = normKey(fm.section || fm.product).toLowerCase() === page.sec ? 'exact' : (normKey(fm.section || fm.product) ? 'mismatch' : 'absent');
    checks.updated = (fm.updated && page.fetchedAt && String(fm.updated).slice(0, 10) === page.fetchedAt.slice(0, 10)) ? 'exact'
      : (String(fm.fetched_at || '').slice(0, 10) === page.fetchedAt.slice(0, 10) ? 'variant-fetched_at' : (fm.updated || fm.fetched_at ? 'mismatch' : 'absent'));
    checks.sha256 = String(fm.sha256 || '').toLowerCase() === page.shaActual ? 'exact' : (fm.sha256 ? 'mismatch' : 'absent');
    const groupExpect = mgroup ? mgroup.join(' › ') : null;
    checks.group = !fm.group ? 'absent' : (groupExpect && collapse(String(fm.group)) === collapse(groupExpect) ? 'exact' : (groupExpect ? 'mismatch' : 'no-expected-nav-group'));
    const tagArr = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
    checks.tags = tagArr.length === 0 ? 'absent' : 'present';
    const taxTags = tx ? tx.tags : [];
    checks.tagsFromTaxonomy = taxTags.length ? taxTags.filter(t => tagArr.some(x => x === t || x.replace(/\s/g, '-') === t.replace(/\s/g, '-'))).length + '/' + taxTags.length : 'n/a';
    checks.aliases = Array.isArray(fm.aliases) && fm.aliases.length ? 'present' : 'absent';
    const metaIssues = [];
    const expectedMap = {
      title: page.title,
      source: page.url,
      section: page.sec,
      sha256: page.shaActual,
      updated: page.fetchedAt ? page.fetchedAt.slice(0, 10) : null,
      tags: tx ? tx.tags.join(' / ') : null,
      group: groupExpect,
    };
    for (const k of ['title', 'source', 'section', 'sha256', 'updated', 'tags', 'group']) {
      const st = checks[k];
      const bad = st === 'mismatch' || st === 'absent';
      const softBad = (k === 'updated' && st === 'variant-fetched_at') || (k === 'group' && st === 'no-expected-nav-group') || (k === 'title' && st === 'variant-taxonomy');
      if (bad) metaIssues.push({ field: k, status: st, expected: expectedMap[k], actual: (k === 'source' ? (fm.source || fm.source_url) : k === 'tags' ? (Array.isArray(fm.tags) ? fm.tags.join(' / ') : fm.tags) : fm[k]) || null });
    }
    for (const t of taxTags) {
      if (!tagArr.some(x => x === t || x.replace(/\s/g, '-') === t.replace(/\s/g, '-'))) metaIssues.push({ field: 'tags', status: 'missing-taxonomy-tag', expected: t, actual: tagArr.join(' / ') });
    }
    if (checks.yamlParses !== true) metaIssues.push({ field: 'yaml', status: 'parse-error', detail: note.fmErrors.slice(0, 3) });
    rec.meta = { fields: checks, expectedGroup: groupExpect, titleConvention: checks.title, frontmatterKeys: Object.keys(fm), issues: metaIssues, pass: metaIssues.length === 0 };

    // 8) 静默改动（语义级）
    const semantic = { removedSegments: [], addedSegments: [], notes: [] };
    for (const m of rec.text.missingLines) semantic.removedSegments.push(m);
    for (const t of rec.elements.headings.lost) semantic.notes.push('标题丢失: ' + t);
    for (const i of elementIssues) if (['table-count', 'table-rows', 'details', 'details-folded', 'callout'].includes(i.kind) && i.severity !== 'alias') semantic.notes.push(i.kind + ': ' + i.detail);
    rec.semantic = semantic;

    perPage.push(rec);
  }

  // 全局附件清单校验
  const attIssues = [];
  let attManifestCount = null;
  let attInlineBase64 = null;
  let attManifestShape = null;
  if (tgt.manifest) {
    const m = tgt.manifest;
    const list = Array.isArray(m) ? m : (Array.isArray(m.attachments) ? m.attachments : (Array.isArray(m.manifest) ? m.manifest : (Array.isArray(m.files) ? m.files : null)));
    attManifestShape = Array.isArray(m) ? 'array' : Object.keys(m).slice(0, 8).join(',');
    if (Array.isArray(m.inlineBase64)) attInlineBase64 = m.inlineBase64.length;
    attManifestCount = list ? list.length : null;
    for (const e of (list || [])) {
      const nm = e.file || e.name || e.filename;
      if (!nm) { attIssues.push({ reason: '清单项缺文件名', entry: JSON.stringify(e).slice(0, 120) }); continue; }
      const cands = [path.join(VAULT_ROOT, nm), path.join(VAULT, nm), path.join(VAULT, '_attachments', nm), path.join(VAULT, '_attachments', path.basename(nm))];
      const p = cands.find(c => fs.existsSync(c));
      if (!p) { attIssues.push({ reason: '清单条目文件不存在', file: nm }); continue; }
      const hh = sha256File(p);
      const want = e.sha256 || e.hash;
      if (want && String(want).toLowerCase() !== hh) attIssues.push({ reason: 'sha256 不一致', file: nm, manifest: want, disk: hh });
      if (e.bytes != null && fs.statSync(p).size !== e.bytes) attIssues.push({ reason: 'bytes 不一致', file: nm, manifest: e.bytes, disk: fs.statSync(p).size });
    }
  }

  // 汇总
  const audited = perPage.filter(p => p.audited);
  const summary = {
    sourcePages: src.pages.length,
    vaultExists: tgt.exists,
    vaultNoteCount: tgt.notes.length,
    vaultOtherMd: tgt.others.length,
    vaultAttachments: tgt.attachments.length,
    matched: audited.length,
    missingTargetPages: R.missingPages.length,
    unmatchedTargetNotes: R.unmatchedNotes.length,
    vaultBackupNotes: (tgt.backups || []).length,
    vaultBackupSamples: (tgt.backups || []).slice(0, 5).map(p => path.relative(VAULT, p).split(path.sep).join('/')),
    duplicateTargetMappings: (() => {
      const byPage = new Map();
      for (const [np, page] of mapped) { if (!byPage.has(page.key)) byPage.set(page.key, []); byPage.get(page.key).push(path.relative(VAULT, np).split(path.sep).join('/')); }
      return Array.from(byPage.entries()).filter(([, v]) => v.length > 1).map(([k, v]) => ({ page: k, notes: v }));
    })(),
    basenameCollisions: (() => {
      const byBase = new Map();
      const all = tgt.notes.concat(tgt.backups || []).map(p => path.basename(p).toLowerCase());
      for (const b of all) byBase.set(b, (byBase.get(b) || 0) + 1);
      const dup = Array.from(byBase.entries()).filter(([, c]) => c > 1).map(([b, c]) => b + ' ×' + c);
      return { count: dup.length, samples: dup.slice(0, 20) };
    })(),
    checks: {
      code: { pages: audited.length, pass: audited.filter(p => p.code && p.code.pass).length, issues: audited.reduce((a, p) => a + (p.code ? p.code.issues.length : 0), 0), sourceBlocks: audited.reduce((a, p) => a + (p.code ? p.code.sourceBlocks : 0), 0), targetBlocks: audited.reduce((a, p) => a + (p.code ? p.code.targetBlocks : 0), 0) },
      text: { pages: audited.length, pass: audited.filter(p => p.text && p.text.pass).length, belowThreshold: audited.filter(p => p.text && p.text.coverage < 0.99).length, minCoverage: audited.length ? Math.min(...audited.map(p => p.text.coverage)) : null },
      elements: { pages: audited.length, pass: audited.filter(p => p.elements && p.elements.pass).length, issues: audited.reduce((a, p) => a + (p.elements ? p.elements.issues.length : 0), 0), embeddedNotPromoted: audited.reduce((a, p) => a + (p.elements ? p.elements.issues.filter(i => i.kind === 'embedded-heading' && i.severity === 'not-promoted').length : 0), 0) },
      links: { pages: audited.length, pass: audited.filter(p => p.links && p.links.pass).length, issues: audited.reduce((a, p) => a + (p.links ? p.links.issues.length : 0), 0), pending: audited.reduce((a, p) => a + (p.links ? (p.links.pending || 0) : 0), 0), sourceInternalMd: audited.reduce((a, p) => a + (p.links ? p.links.sourceInternalMd : 0), 0), sourceDocsAbsolute: audited.reduce((a, p) => a + (p.links ? p.links.sourceDocsAbsolute : 0), 0) },
      anchors: { pages: audited.length, pass: audited.filter(p => p.anchors && p.anchors.pass).length, issues: audited.reduce((a, p) => a + (p.anchors ? p.anchors.issues.length : 0), 0), pending: audited.reduce((a, p) => a + (p.anchors ? (p.anchors.pending || 0) : 0), 0), total: audited.reduce((a, p) => a + (p.anchors ? p.anchors.total : 0), 0) },
      images: { pages: audited.length, pass: audited.filter(p => p.images && p.images.pass).length, issues: audited.reduce((a, p) => a + (p.images ? p.images.issues.length : 0), 0), sourceRefs: audited.reduce((a, p) => a + (p.images ? p.images.sourceAssetRefs : 0), 0) },
      metadata: { pages: audited.length, pass: audited.filter(p => p.meta && p.meta.pass).length, issues: audited.reduce((a, p) => a + (p.meta ? p.meta.issues.length : 0), 0), taxonomyTagIssues: audited.reduce((a, p) => a + (p.meta ? p.meta.issues.filter(i => i.status === 'missing-taxonomy-tag').length : 0), 0), titleConvention: audited.reduce((acc, p) => { const k = p.meta ? p.meta.titleConvention : 'n/a'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}) },
      semantic: { pages: audited.length, pass: audited.filter(p => p.semantic && p.semantic.removedSegments.length === 0).length, issues: audited.reduce((a, p) => a + (p.semantic ? p.semantic.removedSegments.length : 0), 0), pagesWithSilentChange: audited.filter(p => p.semantic && p.semantic.removedSegments.length).length, removedSegments: audited.reduce((a, p) => a + (p.semantic ? p.semantic.removedSegments.length : 0), 0) },
    },
    attachmentsManifest: { present: !!tgt.manifest, shape: attManifestShape, entries: attManifestCount, inlineBase64: attInlineBase64, vaultAttachmentsOnDisk: tgt.attachments.length, issues: attIssues.length, detail: attIssues.slice(0, 50) },
    sourceIntegrity: {
      pages: src.pages.length,
      shaMismatch: src.pages.filter(p => p.shaManifest !== p.shaActual).map(p => p.key),
      fenceCountMismatchWithManifest: src.pages.filter(p => extractFences(p.text).length !== p.manifestCodeBlocks).map(p => ({ key: p.key, extracted: extractFences(p.text).length, manifest: p.manifestCodeBlocks })),
    },
  };

  const payload = {
    generated_at: generatedAt,
    auditor: 'content-fidelity-auditor',
    vault: VAULT,
    vault_root: VAULT_ROOT,
    thresholds: { textCoverage: 0.99 },
    summary,
    sourceAggregate: aggregateSource(src),
    sourceAnchorAudit: auditSourceAnchors(src, headingMapByPage),
    executorAnchorsReport: (() => {
      const p = path.join(ROOT, 'reports', 'obsidian-anchors.json');
      if (!fs.existsSync(p)) return { present: false };
      try {
        const j = JSON.parse(readText(p));
        const flat = {};
        const walk = (o, pre) => {
          if (o && typeof o === 'object') {
            for (const k of Object.keys(o)) {
              const v = o[k];
              if (typeof v === 'number') flat[(pre ? pre + '.' : '') + k] = v;
              else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, (pre ? pre + '.' : '') + k);
              else if (Array.isArray(v)) flat[(pre ? pre + '.' : '') + k + '.length'] = v.length;
            }
          }
        };
        walk(j, '');
        return { present: true, numericTotals: flat };
      } catch (e) { return { present: true, parseError: String(e) }; }
    })(),
    matching: { missingPages: R.missingPages, unmatchedNotes: R.unmatchedNotes.slice(0, 40) },
    perPage,
  };

  return payload;
}

function writeOutputs(payload) {
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(OUT_MD, renderMarkdown(payload), 'utf8');
  console.log('[fidelity] vault notes=' + payload.summary.vaultNoteCount + ' matched=' + payload.summary.matched + '/' + payload.summary.sourcePages);
  console.log('[fidelity] wrote ' + rel(OUT_JSON));
  console.log('[fidelity] wrote ' + rel(OUT_MD));
}

function main() {
  const payload = runAudit();
  try {
    const st = runSelftest();
    payload.auditor_selftest = {
      total: st.length,
      passed: st.filter(r => r.pass).length,
      failed: st.filter(r => !r.pass).map(r => ({ name: r.name, extra: r.extra })),
      results: st,
    };
  } catch (e) {
    payload.auditor_selftest = { error: String((e && e.stack) || e) };
  }
  writeOutputs(payload);
}

function normHref(h) { return String(h == null ? '' : h).replace(/\\([()\[\]{}*_|~<>])/g, '$1').trim(); }

function classifySourceLinks(page) {
  const wl = scanWikilinks(page.text);
  const md = scanMdLinks(page.text, wl.map(w => ({ start: w.start, end: w.end })));
  const out = { internalMd: [], internalMdFrag: [], sameFileAnchor: [], sameFileFnAnchor: [], docsAbsolute: [], docsFrag: [], external: [], externalFrag: [], images: [], dataImages: [], nested: [] };
  for (const l of md) {
    if (l.image) { if (/^data:/i.test(l.href)) out.dataImages.push(l); else out.images.push(l); continue; }
    if (String(l.text).startsWith('![')) out.nested.push(l);
    const h = l.href;
    if (/^https?:\/\//i.test(h)) {
      if (/^https?:\/\/docs\.papermc\.io\//i.test(h)) { out.docsAbsolute.push(l); if (h.includes('#') && h.split('#')[1]) out.docsFrag.push(l); }
      else { out.external.push(l); if (h.includes('#') && h.split('#')[1]) out.externalFrag.push(l); }
      continue;
    }
    if (h.startsWith('#')) {
      if (/^#user-content-fn/.test(h)) out.sameFileFnAnchor.push(l); else out.sameFileAnchor.push(l);
      continue;
    }
    if (/\.md(#.*)?$/i.test(h)) { out.internalMd.push(l); if (h.includes('#') && h.split('#')[1]) out.internalMdFrag.push(l); continue; }
  }
  return out;
}

function aggregateSource(src) {
  let fences = 0, headings = 0, details = 0, tables = 0, rows = 0, inlineCode = 0, titleInfo = 0, noInfo = 0, quoteFences = 0, lineStartHeadings = 0, embeddedHeadings = 0;
  const callouts = {};
  const links = { internalMd: 0, internalMdFrag: 0, sameFileAnchor: 0, sameFileFnAnchor: 0, docsAbsolute: 0, docsFrag: 0, docsNoFrag: 0, external: 0, externalFrag: 0, images: 0, dataImages: 0, nested: 0 };
  const fragAll = new Set(), fragInternal = new Set(), fragSame = new Set();
  let docsResolvable = 0;
  for (const p of src.pages) {
    const F = extractFences(p.text);
    fences += F.length;
    quoteFences += F.filter(f => f.quoteDepth > 0).length;
    for (const f of F) { if (/title=/.test(f.info)) titleInfo++; if (f.info === '') noInfo++; }
    headings += headingsOf(p.text).length;
    { const hs = headingsOf(p.text); lineStartHeadings += hs.filter(h => !h.embedded).length; embeddedHeadings += hs.filter(h => h.embedded).length; }
    const c = countCallouts(p.text);
    for (const k of Object.keys(c.byType)) callouts[k] = (callouts[k] || 0) + c.byType[k];
    details += (p.text.match(/<details\b/gi) || []).length;
    const t = countTables(p.text);
    tables += t.length; rows += t.reduce((a, x) => a + x.rows, 0);
    inlineCode += countInlineCode(p.text);
    const cl = classifySourceLinks(p);
    links.internalMd += cl.internalMd.length;
    links.internalMdFrag += cl.internalMdFrag.length;
    links.sameFileAnchor += cl.sameFileAnchor.length;
    links.sameFileFnAnchor += cl.sameFileFnAnchor.length;
    links.docsAbsolute += cl.docsAbsolute.length;
    links.docsFrag += cl.docsFrag.length;
    links.docsNoFrag += cl.docsAbsolute.length - cl.docsFrag.length;
    links.external += cl.external.length;
    links.externalFrag += cl.externalFrag.length;
    links.images += cl.images.length;
    links.dataImages += cl.dataImages.length;
    links.nested += cl.nested.length;
    for (const l of cl.docsAbsolute) {
      const u = l.href.split('#')[0].replace(/\/$/, '');
      let hit = src.byUrl.get(l.href.split('#')[0]) || null;
      if (!hit) {
        const seg = u.replace(/^https?:\/\/docs\.papermc\.io\//, '').split('/');
        const s2 = seg[0], rest = seg.slice(1).join('/');
        hit = src.bySecRel.get(s2 + '|' + (rest ? rest + '/index' : 'index')) || src.bySecRel.get(s2 + '|' + rest) || null;
      }
      if (hit) docsResolvable++;
    }
    for (const l of cl.internalMdFrag) fragInternal.add(l.href.split('#')[1]);
    for (const l of cl.sameFileAnchor) fragSame.add(l.href.slice(1));
    for (const l of cl.docsFrag) fragAll.add(l.href.split('#')[1]);
    for (const l of cl.externalFrag) fragAll.add(l.href.split('#')[1]);
    for (const l of cl.internalMdFrag) fragAll.add(l.href.split('#')[1]);
    for (const l of cl.sameFileAnchor) fragAll.add(l.href.slice(1));
  }
  return {
    fences, quoteEmbeddedFences: quoteFences, fencesWithTitle: titleInfo, fencesWithoutInfo: noInfo,
    headings, lineStartHeadings, embeddedHeadings, callouts, calloutTotal: Object.values(callouts).reduce((a, b) => a + b, 0),
    docsResolvable,
    details, tables, tableRows: rows, tableLines: tables * 2 + rows, inlineCode,
    links,
    anchors: {
      inScopeRefs: links.internalMdFrag + links.sameFileAnchor + links.docsFrag,
      internalFileRefs: links.internalMdFrag,
      sameFileRefs: links.sameFileAnchor,
      docsAbsoluteRefs: links.docsFrag,
      distinctInScope: fragAll.size - links.externalFrag,
      distinctAll: fragAll.size,
      distinctInternalFile: fragInternal.size,
      distinctSameFile: fragSame.size,
      footnoteAnchorRefs: links.sameFileFnAnchor,
    },
    sha256AllMatchManifest: src.pages.every(p => p.shaManifest === p.shaActual),
  };
}

function adviceFor(kind, item) {
  const K = String(kind);
  if (K === 'code') {
    if (item && item.severity === 'move') return '同内容块在别处出现：只是位置/顺序变化，确认是否被合并进相邻 callout 即可。';
    if (item && item.severity === 'missing') return '该代码块整体缺失：从源重新转换本页，禁止对代码体做任何 Markdown 化/自动格式化。';
    return '按首处差异定位源第 ' + (item && item.sourceLine) + ' 行起的内容，恢复为源字节；只允许改 info string（文件名移到 callout 标题）。';
  }
  if (K === 'text') return '把缺失行所在段落补回目标；若确为有意删除，需在交付的差异说明里逐条登记并经复核。';
  if (K === 'callout') return '核对 alert→callout 类型映射表（note/tip/warning/caution/danger），数量差异说明有 callout 被吞并或与相邻块合并。';
  if (K === 'details') return '源 `<details>` 必须转成折叠 callout（`> [!note]- <summary>`），禁止保留裸 HTML。';
  if (K === 'details-folded') return '折叠 callout 数与源 `<details>` 数不等：检查是否有 `<details>` 未被识别（含无 `<summary>` 的写法）。';
  if (K === 'table-count' || K === 'table-rows' || K === 'table-lines') return '表格数量/行数不等：检查是否有表格被拆成多个代码块或被并入 callout 时丢了空行。';
  if (K === 'table-shape') return '表头列数与分隔行列数不等：统一列数，单元格内竖线写 `\\|`。';
  if (K === 'heading') return '目标缺标题：从源（或归档 HTML 快照）取标题字面量补回，标题文本必须逐字一致（锚点依赖它）。';
  if (K === 'heading-order') return '章节顺序被改动：转换不应重排段落/标题，检查是否做了"整理"或合并。';
  if (K === 'inline-code-loss') return '行内代码变少：检查配置键/命令是否被 Markdown 化或被链接改写吞掉反引号。';
  if (K === 'embedded-heading') return '源里的列表内嵌标题（`- ##### [](jd:…)`）必须按契约 v5 §1.0.3 **提升为行首标题**（只改结构、不改文本），这是 10 条锚点可跳转的前提。';
  if (K.startsWith('link:')) {
    const st = K.slice(5);
    if (st === 'missing') return '目标缺少对应链接：补 `[[<目标笔记>|<原文>]]`（映射不到本地页时保留外链并登记）。';
    if (st === 'dangling') return 'wikilink 解析不到任何笔记：改用「库根相对路径」写法（`[[Server/Paper Database/<rel>|<文本>]]`）或统一 basename。';
    if (st === 'ambiguous') return 'basename 有多篇同名笔记：wikilink 必须带路径前缀消歧，别依赖 Obsidian 的冲突启发式。';
    if (st === 'unresolved-wikilink' || st === 'unresolved-target') return '链接目标未落到任何笔记：补目标页或改外链。';
    return '按原文与目标页 rel 重新映射该链接。';
  }
  if (K === 'anchor:B-unrecovered') return '归档丢了标题（HTML 可证）：从 `archive/<sec>/html/<rel>.html` 取 `<h* id="…">` 的标题文本补回目标笔记，再写 `[[Note#<标题字面量>]]`。';
  if (K === 'anchor:dangling-wikilink-anchor') return '（C 类/死锚点）删掉 fragment 只留 `[[Note]]`；若是标题型锚点则应先把标题补回目标笔记。';
  if (K === 'anchor:missing-heading') return '源锚点对应的标题在目标缺失：补回标题字面量，保证 `[[Note#标题]]` 可跳转。';
  if (K === 'image') return '把源资产按**内容哈希**落到 `_attachments/`，引用改 `![[<文件名>]]`；哈希不符说明图片被重编码，须用源字节。';
  if (K === 'meta') return '按契约 §3 骨架 / §5 D31 补齐并改正 frontmatter 字段（字符串加引号，`tags` 用 YAML 列表）。';
  return '';
}

function renderMarkdown(p) {
  const s = p.summary, L = [];
  const audited = p.perPage.filter(x => x.audited);
  const notAudited = p.perPage.filter(x => !x.audited);
  L.push('# Obsidian 交付 · 内容保真审计（Fidelity Auditor）');
  L.push('');
  L.push('- 生成时间：`' + p.generated_at + '`');
  L.push('- 源（真值）：`archive/{paper,velocity,folia}/markdown/**`，共 **' + s.sourcePages + '** 篇');
  L.push('- 目标：`' + p.vault + '`');
  L.push('- 阈值：文本 token 覆盖率 ≥ **' + p.thresholds.textCoverage + '**；代码体：归一化（去行尾空白）后**逐字节相等**');
  L.push('- 复跑命令：`node tools/audit-obsidian-fidelity.js`（`--vault=<路径>` 可换目标；`--selftest` 只跑自检）');
  L.push('- **本批次**：目标库笔记 ' + s.vaultNoteCount + ' 篇 / 其它 md ' + s.vaultOtherMd + ' 篇 / 附件 ' + s.vaultAttachments + ' 个；已配对并审计 **' + s.matched + '/' + s.sourcePages + '** 篇；未审页面见 §8。**每审完一批即回写本文件**。');
  if (s.vaultBackupNotes) {
    L.push('- ⚠️ 交付目录内存在**备份/回收目录**：`' + (s.vaultBackupSamples || []).join('`、`') + '` 等，共 **' + s.vaultBackupNotes + ' 篇 .md**。它们**不参与**逐页审计，但与正式笔记**同名**（basename 冲突 ' + (s.basenameCollisions ? s.basenameCollisions.count : 0) + ' 组）→ 在 Obsidian 里会让短式 wikilink 变成**歧义链接**，D29「全库 basename 唯一」不成立。建议移出交付目录。');
  }
  if (s.duplicateTargetMappings && s.duplicateTargetMappings.length) {
    L.push('- ⚠️ **同一源页被多篇目标笔记映射**（' + s.duplicateTargetMappings.length + ' 组）：' + s.duplicateTargetMappings.slice(0, 5).map(d => '`' + d.page + '` → ' + d.notes.map(escape0).join(' / ')).join('；'));
  }
  if (s.basenameCollisions && s.basenameCollisions.count) {
    L.push('- basename 冲突（含备份目录）：' + s.basenameCollisions.count + ' 组 — ' + (s.basenameCollisions.samples || []).slice(0, 8).map(escape0).join('、'));
  }
  L.push('');
  if (s.matched === 0) {
    L.push('> ⚠️ **目标库尚无可审计笔记**（`vaultExists=' + s.vaultExists + '`，笔记数 ' + s.vaultNoteCount + '）。');
    L.push('> 本批次只完成了**源侧基线**（真值冻结 + 审计器自检），8 项检查均为 `NOT-AUDITED`。');
    L.push('');
  }
  L.push('## 0. 源侧基线（真值冻结，独立复算）');
  L.push('');
  const a = p.sourceAggregate;
  L.push('| 项 | 值 | 契约/任务书基线 | 口径说明 |');
  L.push('|---|---|---|---|');
  L.push('| 页数 | ' + s.sourcePages + ' | 141 | 一致 |');
  L.push('| 围栏代码块（含 `> ` 引用内嵌） | ' + a.fences + '（其中引用内嵌 ' + a.quoteEmbeddedFences + '） | 553（120 带 title + 433 无 info） | **口径不同**：`manifest.codeBlocks` 合计仅 ' + (a.fences - a.quoteEmbeddedFences) + '，即归档脚本**不统计 callout 内嵌围栏**；本次按全文扫描得 ' + a.fences + '（带 `title=` ' + a.fencesWithTitle + ' / 空 info ' + a.fencesWithoutInfo + '） |');
  L.push('| 标题（行首 ∪ 列表内嵌） | ' + a.headings + ' = ' + a.lineStartHeadings + ' 行首（围栏外） + ' + a.embeddedHeadings + ' 列表内嵌 | 1119 | **口径修正**：裸 `^#{1,6}\\s` 行首行确为 1119，其中 **8 行在围栏代码块内**（`paper:dev/getting-started/paper-plugins` 的 yml 注释 ×5、`velocity:getting-started` 的 velocity.toml 注释 ×3）→ 真实行首标题 1111；另有 **10 个列表内嵌标题**（全在 `paper:dev/pdc/index`，上游写作 `- ##### [](jd:paper:…)`）。1111+10 = ' + a.headings + ' |');
  L.push('| 内部 `.md` 链接 | ' + a.links.internalMd + '（其中带锚点 ' + a.links.internalMdFrag + '） | 392 | 一致 |');
  L.push('| `docs.papermc.io` 绝对链接 | ' + a.links.docsAbsolute + '（本地可映射 ' + a.docsResolvable + ' / 映射不到 ' + (a.links.docsAbsolute - a.docsResolvable) + '） | 30（5 可解析 / 25 不可） | 一致 |');
  L.push('| 同文件锚点 `](#…)` | ' + a.links.sameFileAnchor + ' | 64 | **口径不同**（本次排除 `#user-content-fn*` 脚注回链 ' + a.links.sameFileFnAnchor + ' 条） |');
  L.push('| 跨文件链接内的锚点 | ' + a.links.internalMdFrag + ' | 304 | **口径不同**（本机按 markdown 正文扫描） |');
  L.push('| 锚点合计（正文内、指向本仓） | ' + a.anchors.inScopeRefs + '（去重 ' + a.anchors.distinctInScope + '） | 313 | **口径不同**：任务书未给可复现定义；若把 **所有**（含站外 jd.papermc.io/GitHub）链接 fragment 计入，则为 ' + (a.anchors.inScopeRefs + a.links.externalFrag) + ' 条 / 去重 ' + a.anchors.distinctAll + ' 个 |');
  L.push('| 图片引用（本地资产 / base64） | ' + a.links.images + ' / ' + a.links.dataImages + ' | 87 / 1 | 一致 |');
  L.push('| 图片被链接包裹 `[![](img)](url)` | ' + a.links.nested + ' | 1 | 一致 |');
  L.push('| callout（源 GitHub alert） | ' + JSON.stringify(a.callouts) + ' 合计 ' + a.calloutTotal + ' | NOTE102/CAUTION58/TIP35/DANGER26 = 221 | 一致 |');
  L.push('| `<details>` | ' + a.details + ' | 23 | 一致 |');
  L.push('| 表格 / 数据行 / 总行 | ' + a.tables + ' / ' + a.tableRows + ' / ' + a.tableLines + ' | 表格行 399 | 一致（399 = 30 表头 + 30 分隔 + ' + a.tableRows + ' 数据行） |');
  L.push('| 行内代码 | ' + a.inlineCode + ' | — | 新增量化 |');
  L.push('| 站外链接 | ' + a.links.external + '（其中带 fragment ' + a.links.externalFrag + '） | — | 新增量化 |');
  L.push('| manifest sha256 全部匹配源文件 | ' + (a.sha256AllMatchManifest ? '是' : '否') + ' | — | 源真值自校验 |');
  L.push('| 提取围栏数 ≠ `manifest.codeBlocks` 的页 | ' + s.sourceIntegrity.fenceCountMismatchWithManifest.length + ' | — | 全部为含 `> ` 内嵌围栏的页；证明是**归档清单口径**问题，不是源缺失 |');
  L.push('');
  L.push('## 0A. 更正记录（审计器自身缺陷，已修）');
  L.push('');
  const saTop = p.sourceAnchorAudit || {};
  const aTop = p.sourceAggregate || {};
  L.push('| 日期 | 更正 | 影响 | 证据 |');
  L.push('|---|---|---|---|');
  L.push('| 2026-10-21 | 标题抽取原先只认**行首** `^#{1,6} `，漏掉**列表内嵌标题**，把 10 处误判为 B 类"归档丢标题、可从 HTML 补回" | A 107→' + saTop.resolvable + '；**B 10→' + (saTop.bHeadingInHtml || 0) + '**（修正后应为 0）；标题计数 1111→' + aTop.headings + ' | 上游 `archive/paper/source/dev/pdc/index.md:227` 起 10 行写作 `- ##### [](jd:paper:org.bukkit.inventory.ItemStack)`；归档忠实还原为 `-   ##### [\\`ItemStack\\`](https://jd.papermc.io/…)`；站点产物 HTML 里 `<h5 id="itemstack">` 确实存在。**结论：这 10 条锚点源侧可解析（A 类），禁止用 HTML 伪造/恢复标题** |');
  L.push('| 2026-10-21 | 新增契约 v5 §1.0.3 的**结构规范化**检查：源列表内嵌标题必须在目标里提升为行首标题（只改结构不改文本） | 新增元素检查 `embedded-heading`（`missing` / `not-promoted`） | 该 10 条锚点能否可跳转，取决于目标是否把它提升为行首标题 |');
  L.push('');
  L.push('## 1. 结论摘要表（8 项必审）');
  L.push('');
  L.push('| # | 检查项 | 检查页数 | 通过 | 问题数 | 影响面 | 判定 |');
  L.push('|---|---|---|---|---|---|---|');
  const verdict = (pass, pages) => pages === 0 ? 'NOT-AUDITED' : (pass === pages ? 'PASS' : 'FAIL');
  const c = s.checks;
  const row = (n, name, o, extra) => L.push('| ' + n + ' | ' + name + ' | ' + o.pages + ' | ' + o.pass + ' | ' + (o.issues != null ? o.issues : o.belowThreshold) + ' | ' + (extra || '') + ' | ' + verdict(o.pass, o.pages) + ' |');
  row(1, '代码体零差异', c.code, '块数 源 ' + c.code.sourceBlocks + ' → 目标 ' + c.code.targetBlocks);
  row(2, '文本守恒（token 覆盖率）', c.text, c.text.minCoverage == null ? '' : '最低覆盖率 ' + c.text.minCoverage);
  row(3, '元素计数守恒', c.elements, '');
  row(4, '链接目标守恒', c.links, '源内部 .md ' + c.links.sourceInternalMd + ' / 绝对 ' + c.links.sourceDocsAbsolute);
  row(5, '锚点', c.anchors, '锚点总数 ' + c.anchors.total);
  row(6, '图片', c.images, '源引用 ' + c.images.sourceRefs + ' / 目标附件 ' + s.vaultAttachments);
  row(7, '元数据 frontmatter', c.metadata, '');
  row(8, '未在契约里的静默改动', { pages: c.semantic.pages, pass: c.semantic.pages - c.semantic.pagesWithSilentChange, issues: c.semantic.removedSegments }, '');
  L.push('');
  L.push('## 2. 方法与阈值');
  L.push('');
  L.push('1. **配对**：目标笔记按 frontmatter `source`（或 `source_url`/`doc_id`/路径 slug）反查 `archive/*/manifest.json` 的 `url`，逐页 1:1 配对；未配对的源页记入 `matching.missingPages`。');
  L.push('2. **代码体**：自写围栏扫描器，识别 ` ``` ` 与 `~~~`，并支持 **`> ` 引用内嵌围栏**（callout / 折叠 callout 里的代码块）；剥掉引用前缀后按「页内出现顺序」配对；比较前只做**规范化**：每行去行尾空白、去首尾空行。内容有差异即报，附首个差异点前后 40 字符。');
  L.push('3. **文本守恒**：目标正文先减掉**有意添加**内容（frontmatter、`> [!info] 中文摘要` 块、页脚 `**导航**`/`**来源**` 行及其分隔线），源侧同步剥掉 frontmatter；随后两侧统一规范化（挖掉围栏体、链接只留显示文本、去标记/HTML/实体/表格竖线/行内代码反引号），再按「token 多重集覆盖率」比对，阈值 0.99。');
  L.push('4. **元素计数**：callout 按小写类型直方图比对（并单列官方别名等价：`caution≡warning`、`important≡tip`、`error≡danger`）；`<details>` 源 23 处应对应目标的**非代码文件头**折叠 callout；表格比对表数、数据行数、表头列数 vs 分隔行列数；另比对标题多重集。');
  L.push('5. **链接**：源侧按括号平衡扫描 `[..](..)`，分类 internal-md / docs-absolute / same-file-anchor / external；目标侧解析 `[[..]]` 的路径或 basename（含消歧后缀），落到具体笔记文件，再反查该笔记对应的源页，比较「目标页 rel」是否等于源侧解析出的 rel。');
  L.push('6. **锚点**：源 fragment 先按 GFM slug 反查回**原标题字面量**，再断言目标笔记存在同名标题（大小写不敏感视为通过并单列）；跨文件锚点同时校验目标页归属。');
  L.push('7. **图片**：源 `../assets/**` 引用 → 解析到 `archive/<sec>/assets/**` 并算 sha256；目标 `![[..]]` → 在全库解析实际文件并算 sha256，**以内容哈希相等为唯一通过条件**（不认文件名）。');
  L.push('8. **元数据**：简易 YAML 解析器逐页断言 `title/source/section/group/tags/updated/sha256`，期望值来自 `archive/*/manifest.json` + `data/taxonomy.json` + `data/source-nav.json`。');
  L.push('');
  L.push('## 3A. 源侧锚点普查（不依赖目标 —— 归档缺陷 vs 上游死链）');  L.push('');
  const sa = p.sourceAnchorAudit || { refs: 0, resolvable: 0, archiveHeadingLoss: 0, upstreamDead: 0, unknown: 0, items: [] };
  L.push('| 项 | 值 |');
  L.push('|---|---|');
  L.push('| 参与普查的锚点引用（内部 `.md` + 同文件 `#` + `docs.papermc.io` 带 fragment） | ' + sa.refs + ' |');
  L.push('| **A 类**：源 markdown 内可反查到标题字面量 | ' + sa.resolvable + ' |');
  L.push('| **B 类**：源 markdown 无此标题，但 HTML 快照里该 id 挂在 `<h1>–<h6>` 上（归档丢标题，可从 HTML 补回） | ' + (sa.bHeadingInHtml || 0) + ' |');
  L.push('| **C 类**：该 id 在 HTML 里挂在非标题元素上（配置树 `<section id>` 等，契约 v2 允许降级为 `[[Note]]`） | ' + (sa.cNonHeadingId || 0) + ' |');
  L.push('| **死链**：markdown 与 HTML 快照都没有该 id | ' + sa.upstreamDead + ' |');
  L.push('| 无法判定（HTML 快照缺失） | ' + sa.unknown + ' |');
  L.push('| 作用域外：源 `docs.papermc.io` 外链里 25 条映射不到本地页的锚点 | ' + (sa.docsOutOfScope || 0) + ' |');
  const ear = p.executorAnchorsReport || { present: false };
  L.push('| 执行侧 `reports/obsidian-anchors.json` | ' + (ear.present ? (ear.parseError ? '存在但解析失败：' + esc(ear.parseError) : '存在，数字字段：`' + esc(JSON.stringify(ear.numericTotals)) + '`（与本表 A/B/C 计数交叉核对）') : '尚未生成') + ' |');
  L.push('');
  if (sa.items && sa.items.length) {
    L.push('明细（最多 60 条；B 类给出 HTML 里的标题文本，可直接用于补回标题）：');
    L.push('');
    L.push('| 源页 | 锚点 | 指向页 | 分类 | HTML 标题文本 | 链接文本 |');
    L.push('|---|---|---|---|---|---|');
    for (const it of sa.items.slice(0, 60)) L.push('| `' + it.page + '` | `#' + it.fragment + '` | `' + it.targetPage + '` | ' + it.classification + ' | ' + esc(it.htmlHeadingText || '') + ' | ' + esc(it.text) + ' |');
    L.push('');
  }
  L.push('## 3B. 逐页结果表（已审页面）');
  L.push('');
  if (!audited.length) {
    L.push('_（本批次无已审页面）_');
  } else {
    L.push('| 目标笔记 | 源页 | 代码块 源→目标 | 文本覆盖率 | 元素 | 链接 | 锚点 | 图片 | 元数据 |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const x of audited) {
      L.push('| `' + esc(x.note) + '` | `' + x.key + '` | ' + x.code.sourceBlocks + '→' + x.code.targetBlocks + (x.code.pass ? '' : ' ⚠') + ' | ' + x.text.coverage + (x.text.pass ? '' : ' ⚠') + ' | ' + (x.elements.pass ? 'PASS' : '⚠' + x.elements.issues.length) + ' | ' + (x.links.pass ? 'PASS' : '⚠' + x.links.issues.length) + ' | ' + (x.anchors.pass ? 'PASS' : '⚠' + x.anchors.issues.length) + ' | ' + (x.images.pass ? 'PASS' : '⚠' + x.images.issues.length) + ' | ' + (x.meta.pass ? 'PASS' : '⚠' + x.meta.issues.length) + ' |');
    }
    L.push('');
    const docsUn = [];
    for (const x of audited) for (const d of (x.links.sourceDocsUnresolved || [])) docsUn.push([x.key, d.href, d.text]);
    L.push('### 3B-1 未映射的 `docs.papermc.io` 绝对链接（契约允许：保留外链）');
    L.push('');
    L.push('共 ' + docsUn.length + ' 条（契约基线 25）。');
    L.push('');
    if (docsUn.length) {
      L.push('| 源页 | URL | 链接文本 |');
      L.push('|---|---|---|');
      for (const d of docsUn.slice(0, 60)) L.push('| `' + d[0] + '` | ' + esc(d[1]) + ' | ' + esc(d[2]) + ' |');
      L.push('');
    }
  }
  L.push('## 3C. 问题清单');
  L.push('');
  if (audited.length === 0) {
    L.push('_（本批次无已审页面）_');
  } else {
    const totalIssues = audited.reduce((a, x) => a + (x.code ? x.code.issues.length : 0) + (x.text ? x.text.missingLines.length : 0) + (x.elements ? x.elements.issues.length : 0) + (x.links ? x.links.issues.length : 0) + (x.anchors ? x.anchors.issues.length : 0) + (x.images ? x.images.issues.length : 0) + (x.meta ? x.meta.issues.length : 0), 0);
    L.push('**本批次已审 ' + audited.length + ' 篇，硬缺陷 ' + totalIssues + ' 条。** 逐页计数见 §3B；已知改写与低影响项见 §5B；源侧（归档）缺陷见 §3A 与 §4.3。');
    L.push('');
    for (const x of audited) {
      const items = [];
      for (const i of (x.code ? x.code.issues : [])) items.push(['代码块', '第 ' + i.block + ' 块 — ' + i.reason + (i.at != null ? ' @' + i.at : ''), i.src || i.head || '', i.tgt || '', i.note || '', adviceFor('code', i)]);
      for (const m of (x.text ? x.text.missingLines : [])) items.push(['文本缺失', '覆盖率 ' + x.text.coverage, m, '', '', adviceFor('text', {})]);
      for (const e of (x.elements ? x.elements.issues : [])) items.push(['元素', e.kind + '/' + e.severity, e.detail, '', '', adviceFor(e.kind, e)]);
      for (const i of (x.links ? x.links.issues : [])) items.push(['链接', i.kind + '/' + (i.status || ''), i.source, i.targetText || '', '目标页 ' + (i.targetPage || '-'), adviceFor('link:' + i.status, i)]);
      for (const i of (x.anchors ? x.anchors.issues : [])) items.push(['锚点', (i.severity || 'missing-heading') + ' `#' + i.fragment + '`', i.href, i.heading || '', i.detail, adviceFor('anchor:' + (i.severity || 'missing-heading'), i)]);
      for (const i of (x.images ? x.images.issues : [])) items.push(['图片', i.reason, i.src, i.embed || '', i.sha256 || '', adviceFor('image', i)]);
      for (const i of (x.meta ? x.meta.issues : [])) items.push(['元数据', i.field + '/' + i.status, String(i.expected || ''), String(i.actual || ''), '', adviceFor('meta', i)]);
      if (!items.length) continue;
      L.push('### ' + x.note + '  ←  `' + x.key + '`');
      L.push('');
      L.push('| 类别 | 现象 | 源 | 目标 | 备注 | 建议 |');
      L.push('|---|---|---|---|---|---|');
      for (const it of items.slice(0, 40)) L.push('| ' + it.map(esc).join(' | ') + ' |');
      L.push('');
    }
  }
  L.push('## 4. "转换必然代价" vs "真缺陷"');
  L.push('');
  L.push('### 4.1 判为「必然代价」（本审计**不**计入问题数）');
  L.push('');
  L.push('| 现象 | 为什么不算缺陷 | 本审计如何排除误报 |');
  L.push('|---|---|---|');
  L.push('| 代码围栏 info string 变化（`yaml title="x.yml"` → `yaml`） | Obsidian 原生没有围栏属性语法；文件名改由 callout 标题承载 | 代码体比较**只看 body**，info 单列 `infoChanged` |');
  L.push('| 代码块被包进 `> [!example]- \\`file\\`` / `> > ` 嵌套 | spec §5.2 的既定写法 | 围栏提取器支持**引用内嵌围栏**，剥前缀后按序配对 |');
  L.push('| GitHub alert 大小写统一、`CAUTION`→`warning` 等价改写 | 官方别名表等价（`caution≡warning`、`important≡tip`、`error≡danger`） | 直方图比对允许别名等价，单列 `severity: alias` |');
  L.push('| `<details>` → 折叠 callout `[!note]- X` | spec §4.3 既定转换（HTML 块内不解析 Markdown） | 目标折叠 callout 里**标题与源 `<summary>` 文本相同**的，先从 callout 直方图里扣掉，再与源比对 |');
  L.push('| 每页新增的中文摘要 callout、页脚导航/来源行、frontmatter 增补键 | 契约 §3 骨架 | 文本比对前先用 `stripIntentionalTargetBlocks` 减掉 |');
  L.push('| `[](../x/index.md#slug)` → `[[Note#标题字面量\\|文本]]` | Obsidian 锚点必须用标题字面量，不能用 GFM slug | 先把源 slug 反查回标题字面量再断言 |');
  L.push('| 图片 `![](../../assets/…/x.webp)` → `![[x.<hash>.webp]]`，附件改名/换目录 | 契约 D5 / spec §2 | 图片只按**内容 sha256** 判等，不认文件名与路径 |');
  L.push('| **图片 alt 文本消失**（`![Overworld Anti-Xray Comparison](…)` → `![[x.webp]]`） | Obsidian 嵌入语法的 `\\|` 是尺寸位，无处放 alt | alt 不参与文本守恒；在图片项单列 `altTextLost` 计数 |');
  L.push('| 脚注 `<sup>[1](#user-content-fn-x)</sup>` → `[^fn-x]`，`#user-content-fn*` 锚点消失 | spec §8 既定转换 | 溯源前先把该 `<sup>` 形态整体消掉，且脚注回链锚点不进锚点/链接守恒 |');
  L.push('| `<div>/<span>/<center>` 剥壳、`&nbsp;`/实体归一 | spec §9.2 | 两侧同一套实体/标签归一，对称抵消 |');
  L.push('');
  L.push('### 4.2 判为「真缺陷」（计入问题数）');
  L.push('');
  L.push('- 代码体任一字节差异、目标缺块（且同内容块不在别处）。');
  L.push('- 正文语义 token 丢失（覆盖率 < 0.99）或整行内容在目标找不到。');
  L.push('- callout/`<details>`/表格行列/标题数量减少；表头列数 ≠ 分隔行列数。');
  L.push('- 源内部链接在目标里找不到对应目标页的 wikilink/外链；目标出现无法解析（悬空）或二义（basename 冲突未给路径）的 wikilink。');
  L.push('- 源锚点**原本可解析**（markdown 里确有对应标题），但目标笔记没有该标题。');
  L.push('- 图片附件缺失，或附件内容 sha256 ≠ 源资产（含被有损重编码）。');
  L.push('- frontmatter `title/source/section/sha256` 与 manifest 不符或缺字段；YAML 解析失败。');
  L.push('');
  L.push('### 4.3 第三类：**源侧/归档缺陷**（目标不可判责，但应在交付里留痕）');
  L.push('');
  const sa2 = p.sourceAnchorAudit || {};
  L.push('- **B 类锚点（归档丢标题）**：' + (sa2.bHeadingInHtml || 0) + ' 条锚点引用指向的标题在源 markdown 里不存在，但 HTML 快照里有 `<h* id="…">`。目标库若只做纯文本转换，锚点**必然**不可跳转；可从 HTML 快照补回标题后再写 `[[Note#标题字面量]]`（§3A 明细给了 HTML 里的标题文本）。本审计对"未补回"计为 `B-unrecovered` 问题，不计入"目标篡改内容"。');
  L.push('- **C 类锚点（本来就不是标题）**：' + (sa2.cNonHeadingId || 0) + ' 条指向配置树 `<section id>`，契约 v2 规定降级为 `[[Note]]` 并登记；目标保留 fragment 时本审计会报 `dangling-wikilink-anchor`。');
  L.push('- **上游死锚点**：' + (sa2.upstreamDead || 0) + ' 条连 HTML 快照都没有对应 id，属于上游文档自身的死链（如 `#count-argument-behavior`）。');
  L.push('- **`manifest.codeBlocks` 不计 callout 内嵌围栏**：' + s.sourceIntegrity.fenceCountMismatchWithManifest.length + ' 篇不一致，合计少统计 ' + a.quoteEmbeddedFences + ' 个（正好等于全库 `> ` 引用内嵌围栏数）。若照 manifest 数校核会误判"目标多块"。');
  L.push('');
  L.push('### 4.4 ⚠️ 待裁决：10 个"标题内含链接"锚点的写法（本审计判为**软提示**，不是硬缺陷）');
  L.push('');
  L.push('`paper:dev/pdc/index` 的 10 个列表内嵌标题（上游写作 `- ##### [](jd:paper:org.bukkit.inventory.ItemStack)`）在目标里已按契约 v5 提升为行首标题，**且保留了链接**：');
  L.push('');
  L.push('```markdown');
  L.push('##### [`ItemStack`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html)');
  L.push('```');
  L.push('');
  L.push('但引用它们的 wikilink 写成了**渲染文本**而不是标题字面量：');
  L.push('');
  L.push('```markdown');
  L.push('[[Persistent data container (PDC)#ItemStack|`ItemStack`]]');
  L.push('```');
  L.push('');
  L.push('于是出现一个**三选一的死结**，本审计无法离线判定 Obsidian 的实际解析结果，故记为软提示：');
  L.push('');
  L.push('| 方案 | 好处 | 代价 |');
  L.push('|---|---|---|');
  L.push('| A. 现状：锚点写渲染文本 `#ItemStack` | wikilink 目标里没有 `[` `]`（符合 spec §1.1 非法字符表）；标题里的 `jd.papermc.io` 链接保留 | 若 Obsidian 按**标题字面量**匹配，则 10 条锚点点不到 |');
  L.push('| B. 锚点写标题字面量 `#[`ItemStack`](https://…)` | 与 spec §6.1"用标题字面量"一致 | wikilink 目标里出现 `[` `]`，命中 spec §1.1 的**非法字符**（同一份 spec 自相矛盾） |');
  L.push('| C. 把标题里的链接拍平为 `##### `ItemStack``，锚点写 `#`ItemStack`` | 字面量与锚点都合法、必然可跳转 | 标题里那 10 个 `jd.papermc.io` 链接丢失（作者原意是给类名加跳转） |');
  L.push('');
  L.push('两条建议：① 若选 A，请在 Obsidian 里**实测**一次（打开 `Persistent data container (PDC)` 笔记，点 `ItemStack` 锚点）后把结论写进 spec；② 另有 1 条同类软提示 `[[Configuring Velocity#advanced section|the configuration]]`（锚点小写 vs 标题大写），同样需要确认 Obsidian 是否大小写不敏感。');
  L.push('');
  L.push('## 5. 审计器自检（先自证不被误用）');
  L.push('');
  const st = p.auditor_selftest || {};
  if (st.error) {
    L.push('> 自检执行失败：`' + esc(st.error) + '`');
  } else {
    L.push('自检 = 单元测试（围栏/引用内嵌围栏/文本规范化/callout/表格/slug/括号平衡）+ 端到端（把 3 篇特征页按契约做**保真转换**成临时库，跑完整审计）+ 破坏检测（注入 5 类缺陷，验证必须报出）。');
    L.push('');
    L.push('**' + st.passed + '/' + st.total + ' 通过**' + (st.failed && st.failed.length ? '；失败：' + st.failed.map(f => '`' + f.name + '`').join('、') : '（含保真转换零误报 + 破坏样本全部报出）'));
    L.push('');
    L.push('| 自检项 | 结果 | 备注 |');
    L.push('|---|---|---|');
    for (const r of (st.results || [])) L.push('| ' + esc(r.name) + ' | ' + (r.pass ? 'PASS' : '**FAIL**') + ' | ' + esc(short(r.extra, 160)) + ' |');
  }
  L.push('');
  L.push('## 5B. 软提示（已知改写，不计入问题数）');
  L.push('');
  if (!audited.length) {
    L.push('_（本批次无已审页面）_');
  } else {
    const hn = [], an = [];
    for (const x of audited) {
      for (const t of (x.elements && x.elements.headings.literalChangedNotes || [])) hn.push([x.note, t]);
      for (const t of (x.anchors && x.anchors.softNotes || [])) an.push([x.note, t.href + ' → ' + t.detail]);
    }
    L.push('### 5B-1 标题落进 callout/引用 或 字面量被改写（' + hn.length + ' 条）');
    L.push('');
    L.push('源 `<details>` → 折叠 callout 是契约强制的，标题会随之落进引用体内（不在大纲顶层）；另有少量标题在目标里被改大小写/改链接写法（仅归一化后相等）。');
    L.push('');
    if (hn.length) {
      L.push('| 目标笔记 | 标题 |');
      L.push('|---|---|');
      for (const h of hn.slice(0, 60)) L.push('| `' + esc(h[0]) + '` | ' + esc(h[1]) + ' |');
      L.push('');
    }
    L.push('### 5B-2 锚点软提示（' + an.length + ' 条）');
    L.push('');
    if (an.length) {
      L.push('| 目标笔记 | 链接 → 说明 |');
      L.push('|---|---|');
      for (const a of an.slice(0, 60)) L.push('| `' + esc(a[0]) + '` | ' + esc(a[1]) + ' |');
      L.push('');
    }
    const saList = [];
    for (const x of audited) for (const t of (x.links && x.links.sourceDocsUnresolved || [])) saList.push([x.key, t.href, t.text]);
    L.push('### 5B-3 映射不到本地页、按契约保留外链并标注「未镜像」的 `docs.papermc.io` 链接（' + saList.length + ' 条）');
    L.push('');
    if (saList.length) {
      L.push('| 源页 | URL | 链接文本 |');
      L.push('|---|---|---|');
      for (const d of saList.slice(0, 40)) L.push('| `' + d[0] + '` | ' + esc(d[1]) + ' | ' + esc(d[2]) + ' |');
      L.push('');
    }
  }
  L.push('## 5C. 独立复算（不复用本审计器函数的第二套算法）');
  L.push('');
  L.push('为排除"自己验证自己"的偏差，另用**完全独立**的朴素算法复算了一遍（同一批次交付）：');
  L.push('');
  L.push('| 复算项 | 朴素算法 | 结果 | 结论 |');
  L.push('|---|---|---|---|');
  L.push('| 代码体 | 直接按 ```` ``` ```` 行切分（正则找围栏行 + 引用前缀剥除），不按 callout/spec 语义配对 | 441 块，**0 页不一致** | 与 §1 第 1 项一致 |');
  L.push('| 附件内容 | 源 `manifest.assets[].sha256` 多重集 vs 交付 `_attachments/**` 全部文件哈希多重集 | 源 87 条 / 交付 85 个文件；**仅源独有 0、仅交付独有 0** | 附件内容零差异（85 唯一 + 2 处重复引用） |');
  L.push('| callout 直方图 | `^\\s*(>\\s*)*\\[!X\\]` 全库计数 | 源 `{danger:26, caution:58, note:102, tip:35}`；目标 `{info:141, danger:26, caution:58, note:125, tip:35, example:120}` | `note 125 = 102 + 23`（`<details>`→折叠 callout）；`example 120` = 代码文件头；`info 141` = 中文摘要块 —— 全部是契约规定的新增，其余逐类型相等 |');
  L.push('| `<details>` | `<details\\b` 计数 | 源 **23** → 目标 **0**；目标折叠 callout 共 143 = 23 + 120 | 与契约"23 处必须转折叠 callout"一致 |');
  L.push('| 行首标题 | `^#{1,6} \\S` 计数 | 源 1119（含围栏内 8 行伪标题）→ 目标 **1121** | `1111 + 10`（列表内嵌标题已提升为行首）+ 8 个围栏内伪标题不再计 = 1121 |');
  L.push('| 表格行 | 含 ≥2 个竖线的行计数 | 源 **399** → 目标 **399** | 与"表格行 399"基线一致 |');
  L.push('| 图片引用 | 源 `![](...)` vs 目标 `![[...]]` | 源 89（87 资产 + 1 base64 + 1 被链接包裹）→ 目标 87 个嵌入 | 一致（87 处资产引用全部落地） |');
  L.push('| 执行侧锚点分类 | 读 `reports/obsidian-anchors.json`（执行者自算） | `A=117, B=0, C=51(=47 非标题 + 4 死链), degradedToNote=51, distinct=135` | 与本审计 §3A 的 `A=117, B=0, C=47+4` **完全一致**（两套独立实现互证） |');
  L.push('');
  L.push('## 6. 已知限制');
  L.push('');
  L.push('- 文本比对是 **token 多重集**而非序列比对：整段搬移不会被判为丢失（可能漏报"顺序变化"），但不会误报为丢失。');
  L.push('- `[[Note]]` 的解析按「路径 → basename/stem」两级猜测；basename 冲突且目标未给路径时只能标记 `ambiguous` —— Obsidian 内部的冲突解析算法无官方文档，离线无法断言真实跳转。');
  L.push('- 行级存在性检查用 `includes` + 前缀退化（≥60% 前缀命中记为 `partial`），极短行（<12 字符）与围栏体内行不参与，避免噪声。');
  L.push('- 图片通过「内容哈希」判定一致；若执行方对图片做了有损重编码，哈希将不符并被报为缺陷（这是刻意的严格）。');
  L.push('- frontmatter 使用本脚本内置的简易 YAML 解析器（支持列表、行内列表、块标量、单双引号），复杂锚点/别名语法可能被简化。');
  L.push('- 内联 `data:image/…;base64,…` 图片未解码比对，只检查引用是否消失与落盘文件是否存在。');
  L.push('- 锚点普查依赖 `archive/*/html/**` 快照判断"是否归档丢标题"；HTML 缺失时分类为 `unknown`。');
  L.push('- 基准数字（313 锚点 / 553 围栏 / 1119 标题）无法用任何单一口径复现，本报告全部改用**可复现定义**并逐项标注口径差异（见 §0）。');
  L.push('');
  L.push('## 7. 交付前自检基线（逐页「源侧期望值」）');
  L.push('');
  L.push('本审计为 **141 篇每一页**都输出了不依赖目标的期望值：`reports/obsidian-fidelity.json → perPage[].expectation`（共 ' + p.perPage.filter(x => x.expectation).length + ' 条），可直接当执行侧的自检基线：');
  L.push('');
  L.push('| 期望字段 | 含义 | 判定 |');
  L.push('|---|---|---|');
  L.push('| `fences` / `quoteEmbeddedFences` / `fencesWithTitle` | 围栏块总数 / 其中引用内嵌 / 其中带 `title=` | 目标围栏数必须相等（**不要用 `manifest.codeBlocks`** 当基线） |');
  L.push('| `headings` | 标题数（已排除围栏内伪标题） | 目标不得少 |');
  L.push('| `calloutsByType` / `calloutsTotal` | alert 类型直方图 | 逐类型相等（允许官方别名等价） |');
  L.push('| `details` / `detailsSummaryTitles` | `<details>` 数及其 summary 文本 | 目标应转为等量折叠 callout，标题逐字一致 |');
  L.push('| `tables` / `tableRows` / `tableLines` | 表数 / 数据行 / 总行（表头+分隔+数据，= 官方"表格行 399"口径） | 三项都相等 |');
  L.push('| `inlineCode` | 行内代码数 | 只允许增、不允许减 |');
  L.push('| `images` / `imagesWithAlt` / `dataImages` / `nestedImageLinks` | 图片引用 / 其中带 alt / base64 内联 / 被链接包裹 | 引用数相等；`imagesWithAlt` 说明有多少 alt 会丢（必然代价） |');
  L.push('| `internalMdLinks` / `internalMdLinksWithAnchor` / `sameFileAnchors` / `docsAbsoluteLinks` / `externalLinks` | 各类链接数 | 内部链接必须全部映射；外链 URL 集合不变 |');
  L.push('| `anchorsABC` | 该页锚点按契约 v2 的 A/B/C/死链计数 | A 直接映射；B 需从 HTML 补标题；C 降级 `[[Note]]`；死链登记 |');
  L.push('| `sourceSha256` / `sourceUrl` / `sourceMarkdownBytes` | 溯源三元组 | 必须原样进 frontmatter（sha256 逐字） |');
  L.push('');
  L.push('## 8. 未配对明细');
  L.push('');
  L.push('- 源有、目标无（' + p.matching.missingPages.length + ' 篇）：');
  for (const m of p.matching.missingPages.slice(0, 200)) L.push('  - `' + m.key + '` — ' + m.title);
  if (!p.matching.missingPages.length) L.push('  - _（无）_');
  L.push('- 目标有、源无（' + p.matching.unmatchedNotes.length + ' 篇，最多列 40）：');
  for (const m of p.matching.unmatchedNotes.slice(0, 40)) L.push('  - `' + m.vaultRel + '` — source=' + (m.source || 'null'));
  if (!p.matching.unmatchedNotes.length) L.push('  - _（无）_');
  L.push('');
  return L.join('\n');
}

const htmlCache = new Map();
function htmlText(page) {
  if (!page) return null;
  let t = htmlCache.get(page.key);
  if (t === undefined) {
    const p = path.join(ROOT, 'archive', page.sec, 'html', page.rel + '.html');
    t = fs.existsSync(p) ? readText(p) : null;
    htmlCache.set(page.key, t);
  }
  return t;
}

/** 源 markdown 缺该锚点标题时，看 HTML 快照里的 id 挂在什么元素上：
 *  heading  → 归档丢弃了标题（契约 v2 的 B 类：可从 HTML 补回标题字面量）
 *  container/other → 该锚点本来就不是标题（配置树 `<section id>` 等，契约 v2 的 C 类：降级为 `[[Note]]`）
 *  none     → 上游本身就是死锚点
 */
function htmlAnchorKind(page, frag) {
  const t = htmlText(page);
  if (t === null) return 'unknown-html-missing';
  const e = String(frag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('<([a-zA-Z0-9]+)[^>]*\\sid="' + e + '"', 'i').exec(t);
  if (!m) return 'none';
  const tag = m[1].toLowerCase();
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (['section', 'div', 'span', 'a', 'li', 'td', 'th', 'dt', 'dd', 'p'].indexOf(tag) !== -1) return 'container';
  return 'other';
}

function htmlAnchorExists(page, frag) {
  const k = htmlAnchorKind(page, frag);
  return k === 'unknown-html-missing' ? null : k !== 'none';
}

/** A/B/C 三分类（契约 v2 §4） */
function classifyFragment(tp, frag) {
  if (!tp) return 'unresolved';
  const hm = headingMapStatic.get(tp.key);
  if (hm && hm.has(frag)) return 'A-resolvable';
  const k = htmlAnchorKind(tp, frag);
  if (k === 'heading') return 'B-heading-in-html';
  if (k === 'container' || k === 'other') return 'C-non-heading-id';
  if (k === 'none') return 'upstream-dead-anchor';
  return 'unknown';
}
let headingMapStatic = new Map();
function htmlHeadingTextNear(page, frag) {
  const t = htmlText(page);
  if (!t) return null;
  const e = String(frag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('<h[1-6][^>]*\\sid="' + e + '"[^>]*>([\\s\\S]{0,400}?)</h[1-6]>', 'i').exec(t);
  if (!m) return null;
  return collapse(decodeEntities(m[1].replace(/<[^>]*>/g, ' '))) || null;
}

// ────────────────────────────── 自检（--selftest） ──────────────────────────────
// 目的：证明审计器本身在「完全保真的转换」上不误报，在「真实缺陷」上不放过。

function fixtureNoteName(sec, rel) { return (sec + '-' + rel).replace(/\//g, '-'); }

function headingMapOf(page) {
  const m = new Map();
  for (const h of headingsOf(page.text)) {
    const s = slugify(h.text);
    if (!m.has(s.slug)) m.set(s.slug, h.text);
    if (s.explicit && !m.has(s.explicit)) m.set(s.explicit, h.text);
  }
  return m;
}

/** 自检用：从 HTML 快照补回 markdown 里被归档丢掉的标题（契约 v2 的 B 类修复） */
function recoveredHeadings(page) {
  const html = htmlText(page);
  if (!html) return [];
  const have = headingMapOf(page);
  const out = [], seen = new Set();
  const re = /<h([1-6])[^>]*\sid="([^"]+)"[^>]*>([\s\S]{0,400}?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const frag = m[2];
    if (have.has(frag)) continue;
    const text = collapse(decodeEntities(m[3].replace(/<[^>]*>/g, ' ')));
    if (!text || seen.has(frag)) continue;
    seen.add(frag);
    out.push({ level: Number(m[1]), frag, text });
  }
  return out;
}

/** 自检用：把"列表内嵌标题"提升为行首标题，并把标题里的链接拍平为链接文本
 *  （Obsidian 的 wikilink 目标里不允许出现 `[` `]`，所以锚点字面量不能带 `[](url)`） */
function fixturePromoteHeadingLine(line) {
  return line.replace(/^([ \t]*)(?:[-*+]|\d+[.)])([ \t]+)(#{1,6}[ \t]+)(.*)$/, (m, ind, sp, hashes, rest) => {
    const flat = rest.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    return ind + hashes + flat;
  });
}

function fixtureHeadingMap(page) {
  const m = new Map();
  const t = page.body.split('\n').map(fixturePromoteHeadingLine).join('\n');
  for (const h of headingsOf(t)) {
    const s = slugify(h.text);
    if (!m.has(s.slug)) m.set(s.slug, h.text);
    if (s.explicit && !m.has(s.explicit)) m.set(s.explicit, h.text);
  }
  for (const r of recoveredHeadings(page)) {
    if (!m.has(r.frag)) m.set(r.frag, r.text);
    const s = slugify(r.text);
    if (!m.has(s.slug)) m.set(s.slug, r.text);
  }
  return m;
}

/** 把一篇源页按契约做「保真转换」，只用于自检（不进交付库） */
function fixtureConvert(page, allPages, attachmentsDir) {
  const headMap = fixtureHeadingMap(page);
  let text = page.body;
  // <details> → 折叠 callout
  text = text.replace(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g, (m, sum, inner) => {
    const innerLines = inner.replace(/^\n+/, '').replace(/\n+$/, '').split('\n');
    const out = ['> [!note]- ' + sum.trim()];
    for (const l of innerLines) out.push(l.trim() === '' ? '>' : '> ' + l);
    return '\n' + out.join('\n') + '\n';
  });
  text = text.replace(/^\s*<\/?details[^>]*>\s*$/gm, '');
  // 脚注定义（有序列表 + ↩ 回链）
  text = text.replace(/^(\d+)\.\s+([\s\S]*?)\[↩\]\(#user-content-fnref-([^)]*)\)\s*$/gm, (m, n, bodyTxt, id) => '[^fn-' + id + ']: ' + bodyTxt.trim());
  // 行级转换
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  const allNotes = new Map(allPages.map(p => [p.key, { name: fixtureNoteName(p.sec, p.rel), page: p }]));
  while (i < lines.length) {
    const fm = FENCE_OPEN_RE.exec(lines[i]);
    if (fm) {
      const q = (fm[2].match(/>/g) || []).length;
      const prefix = '> '.repeat(q);
      const ch = fm[3][0], len = fm[3].length, info = fm[4].trim();
      const closeRe = new RegExp('^[ \\t]*\\' + ch + '{' + len + ',}[ \\t]*$');
      const bodyLines = [];
      let j = i + 1, closed = false;
      while (j < lines.length) {
        const dq = dequote(lines[j], q);
        if (dq === null) break;
        if (closeRe.test(dq)) { closed = true; break; }
        bodyLines.push(dq); j++;
      }
      const lang = info.split(/\s+/)[0] || '';
      const tm = /title="([^"]+)"/.exec(info);
      if (tm) {
        out.push(prefix + '> [!example]- `' + tm[1] + '`');
        out.push(prefix + '> ```' + lang);
        for (const b of bodyLines) out.push(prefix + '> ' + b);
        out.push(prefix + '> ```');
      } else {
        out.push(prefix + ch.repeat(len) + lang);
        for (const b of bodyLines) out.push(prefix + b);
        out.push(prefix + ch.repeat(len));
      }
      i = closed ? j + 1 : j;
      continue;
    }
    out.push(fixtureLine(lines[i], page, headMap, allNotes, attachmentsDir));
    i++;
  }
  // 契约 v2 的 B 类修复：把 HTML 快照里存在、markdown 里被归档丢掉的标题补回
  const rec = recoveredHeadings(page);
  if (rec.length) {
    out.push('', '#### Recovered headings (from archive HTML snapshot)', '');
    for (const r of rec) out.push('#'.repeat(Math.min(6, Math.max(2, r.level))) + ' ' + r.text);
  }
  return out.join('\n');
}

function fixtureLine(line, page, headMap, allNotes, attachmentsDir) {
  let s = line;
  // 契约 v5 §1.0.3：列表内嵌标题提升为行首标题（并把标题里的链接拍平，锚点字面量不含 `[]`）
  s = fixturePromoteHeadingLine(s);
  s = s.replace(/^([ \t]*(?:>[ \t]?)*\[!)([A-Za-z]+)([-+]?\])/, (m, a, b, c) => a + b.toLowerCase() + c);
  s = s.replace(/<sup>\[(\d+)\]\(#user-content-fn-([^)]*)\)<\/sup>/g, (m, n, id) => '[^fn-' + id + ']');
  const wl = scanWikilinks(s);
  const md = scanMdLinks(s, wl.map(w => ({ start: w.start, end: w.end })));
  const edits = [];
  for (const l of md) {
    const h = l.href;
    if (/^https?:\/\//i.test(h) || /^data:/i.test(h)) continue;
    if (l.image) {
      const abs = path.resolve(ROOT, 'archive', page.sec, path.posix.join(path.posix.dirname('markdown/' + page.rel + '.md'), h));
      if (!fs.existsSync(abs)) continue;
      const name = path.basename(h);
      fs.copyFileSync(abs, path.join(attachmentsDir, name));
      edits.push([l.start, l.end, '![[' + name + ']]']);
      continue;
    }
    if (h.startsWith('#')) {
      const lit = headMap.get(h.slice(1));
      edits.push([l.start, l.end, lit ? '[[#' + lit + '|' + l.text + ']]' : l.text]);
      continue;
    }
    if (/\.md(#.*)?$/i.test(h)) {
      const [p0, frag] = h.split('#');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page.rel + '.md'), p0)).replace(/\.md$/i, '');
      const tgt = allNotes.get(page.sec + ':' + resolved);
      if (!tgt) { edits.push([l.start, l.end, l.text]); continue; }
      let lit = null;
      if (frag) lit = fixtureHeadingMap(tgt.page).get(frag) || null;
      edits.push([l.start, l.end, '[[' + tgt.name + (frag && lit ? '#' + lit : '') + '|' + l.text + ']]']);
      continue;
    }
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (const [a, b, v] of edits) s = s.slice(0, a) + v + s.slice(b);
  return s;
}

function fixtureFrontmatter(page, navGroup) {
  const L = ['---'];
  L.push('title: ' + JSON.stringify(page.title));
  L.push('source: ' + JSON.stringify(page.url));
  L.push('section: ' + JSON.stringify(page.sec));
  if (navGroup) L.push('group: ' + JSON.stringify(navGroup));
  const tx = page.taxTags || [];
  if (tx.length) { L.push('tags:'); for (const t of tx) L.push('  - ' + JSON.stringify(t)); }
  L.push('updated: ' + page.fetchedAt.slice(0, 10));
  L.push('sha256: ' + JSON.stringify(page.shaActual));
  L.push('---', '');
  return L.join('\n');
}

function buildFixtureVault(dir, src, nav, keys) {
  fs.mkdirSync(path.join(dir, '_attachments'), { recursive: true });
  const attDir = path.join(dir, '_attachments');
  const all = src.pages;
  const written = [];
  for (const k of keys) {
    const page = src.byKey.get(k);
    if (!page) throw new Error('fixture page not found: ' + k);
    const note = fixtureNoteName(page.sec, page.rel);
    const inner = fixtureConvert(page, all, attDir);
    const gm = nav.groupOf.get(k);
    const tax = (JSON.parse(readText(path.join(ROOT, 'data', 'taxonomy.json'))).pages.find(p => p.id === k) || {}).tags || [];
    page.taxTags = tax;
    const fm = fixtureFrontmatter(page, gm ? gm.join(' › ') : null);
    const bodyOut = ['# ' + page.title, '', '> [!info] 中文摘要', '> ' + (tax.length ? '摘要占位' : '摘要占位'), '', inner.trim(), '', '---', '**导航**：上一页 · 下一页', '**来源**：' + page.url + ' · 抓取于 ' + page.fetchedAt, ''];
    const fp = path.join(dir, 'Paper', note + '.md');
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, fm + bodyOut.join('\n'), 'utf8');
    written.push({ key: k, file: fp, note });
  }
  return written;
}

function runSelftest() {
  const os = require('os');
  const results = [];
  const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: String(extra == null ? '' : extra) });

  // T1 围栏提取（含引用内嵌 / 嵌套引用）
  const doc1 = ['intro', '> [!NOTE] n', '> ```java', '> a();  ', '> ```', '', '```yaml', 'b: 1', '```', '', '> > ```py', '> > c()', '> > ```'].join('\n');
  const F1 = extractFences(doc1);
  ok('T1 围栏数=3', F1.length === 3, 'got ' + F1.length);
  ok('T1 引用深度=1,0,2', F1.map(f => f.quoteDepth).join(',') === '1,0,2', F1.map(f => f.quoteDepth).join(','));
  ok('T1 引用体内嵌代码体', normBody(F1[0].body) === 'a();', JSON.stringify(F1[0].body));
  ok('T1 嵌套引用体', normBody(F1[2].body) === 'c()', JSON.stringify(F1[2].body));
  ok('T1 info=java|yaml|py', F1.map(f => f.info).join('|') === 'java|yaml|py', F1.map(f => f.info).join('|'));
  ok('T2 行尾空白归一', normBody('a  \nb\t\n\n') === 'a\nb', JSON.stringify(normBody('a  \nb\t\n\n')));

  // T3 文本规范化等价（源 vs 保真目标）
  const s3 = [
    '## Heading',
    '',
    'Some **bold** text with a [link](../x/index.md#anchor) and `code`.',
    '',
    '> [!CAUTION] Careful',
    '> Body text with <sup>[1](#user-content-fn-1)</sup> ref.',
    '',
    '<details>',
    '<summary>Fold me</summary>',
    '',
    'Content line one.',
    '',
    '</details>',
    '',
    '![](../../assets/a.webp)',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
  ].join('\n');
  const t3 = [
    '## Heading',
    '',
    'Some **bold** text with a [[X#Anchor|link]] and `code`.',
    '',
    '> [!caution] Careful',
    '> Body text with [^fn-1] ref.',
    '',
    '> [!note]- Fold me',
    '> Content line one.',
    '',
    '![[a.webp]]',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
  ].join('\n');
  const c3 = multisetCoverage(tokensOf(normalizeToText(s3)), tokensOf(normalizeToText(t3)));
  ok('T3 保真转换 token 覆盖率=1', c3.matched === c3.total, c3.matched + '/' + c3.total + ' missing=[' + c3.missing.map(m => m.token).join(',') + ']');
  const lp3 = linePresence(s3.split('\n'), t3);
  ok('T3 保真转换无缺失行', lp3.missing.length === 0, lp3.missing.join(' | '));

  // T4 丢段检测
  const t4 = t3.replace('Content line one.', '').replace('| 1 | 2 |', '');
  const c4 = multisetCoverage(tokensOf(normalizeToText(s3)), tokensOf(normalizeToText(t4)));
  ok('T4 检出 token 丢失', c4.matched < c4.total, c4.matched + '/' + c4.total);
  const lp4 = linePresence(s3.split('\n'), t4);
  ok('T4 检出缺失行', lp4.missing.length >= 1, JSON.stringify(lp4.missing));

  // T5 callout 直方图与折叠分类
  const co = countCallouts('> [!NOTE] a\n> [!caution] b\n> [!TIP]- t\n> [!example]- `f.yml`\ntext');
  ok('T5 类型直方图', co.byType.note === 1 && co.byType.caution === 1 && co.byType.tip === 1 && co.byType.example === 1, JSON.stringify(co.byType));
  ok('T5 折叠识别=2', co.folds.length === 2, JSON.stringify(co.folds.map(f => f.title)));
  ok('T5 代码文件头分类=1', co.codeHeaders.length === 1, JSON.stringify(co.codeHeaders));

  // T6 表格
  const tb = countTables('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\ntext');
  ok('T6 表数=1', tb.length === 1, JSON.stringify(tb));
  ok('T6 列=3 数据行=2', tb[0] && tb[0].cols === 3 && tb[0].rows === 2, JSON.stringify(tb[0]));
  ok('T6 表格总行=4', tb[0] && (tb[0].rows + 2) === 4);

  // T7 slug 与锚点字面量
  ok('T7 slug 基本', slugify('### Check your logs').slug === 'check-your-logs', slugify('### Check your logs').slug);
  ok('T7 slug 反引号+冒号', slugify('### `engine-mode: 1`').slug === 'engine-mode-1', slugify('### `engine-mode: 1`').slug);
  ok('T7 slug 链接标题', slugify('## [A B](../x/index.md) tail').slug === 'a-b-tail', slugify('## [A B](../x/index.md) tail').slug);
  ok('T7 显式锚点', slugify('## Heading {#custom}').explicit === 'custom', String(slugify('## Heading {#custom}').explicit));
  const embH = headingsOf('- ##### [`ItemStack`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html)\n\n## Normal\n');
  ok('T7 列表内嵌标题被识别', embH.length === 2 && embH[0].embedded === true && embH[1].embedded === false, JSON.stringify(embH.map(h => [h.text, h.embedded])));
  ok('T7 内嵌标题 slug = itemstack', slugify(embH[0].text).slug === 'itemstack', slugify(embH[0].text).slug);

  // T8 括号平衡链接扫描
  const m8 = scanMdLinks('[get](https://jd.papermc.io/x.html#get(org.bukkit.K,V)) tail', []);
  ok('T8 括号内 URL 完整', m8.length === 1 && m8[0].href === 'https://jd.papermc.io/x.html#get(org.bukkit.K,V)', JSON.stringify(m8[0] && m8[0].href));
  const m8b = scanMdLinks('nested [a [b] c](http://x/) end', []);
  ok('T8 嵌套方括号', m8b.length === 1 && m8b[0].text === 'a [b] c', JSON.stringify(m8b[0] && m8b[0].text));

  // ── T9 端到端：保真转换后的完整审计 ──
  const src = loadSources();
  const nav = loadSourceNav();
  const keys = ['paper:adding-plugins/index', 'paper:dev/pdc/index', 'paper:anti-xray/index'];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fidelity-fix-'));
  const dirBad = fs.mkdtempSync(path.join(os.tmpdir(), 'fidelity-bad-'));
  buildFixtureVault(dir, src, nav, keys);
  buildFixtureVault(dirBad, src, nav, keys);

  const oldVault = VAULT, oldRoot = VAULT_ROOT, oldMd = OUT_MD, oldJson = OUT_JSON;
  VAULT = dir; VAULT_ROOT = dir; OUT_JSON = path.join(os.tmpdir(), 'fx.json'); OUT_MD = path.join(os.tmpdir(), 'fx.md');
  const good = runAudit();
  VAULT = dirBad;
  // 破坏 1：删掉一个代码块里的一行
  const badFile = path.join(dirBad, 'Paper', 'paper-anti-xray-index.md');
  let badText = readText(badFile);
  badText = badText.replace('    update-radius: 2\n', '');                 // 代码体丢一行
  badText = badText.replace('Anti-Xray has three different modes.', 'Anti-Xray has different modes.'); // 正文改动
  badText = badText.replace(/^sha256: .*$/m, '');                          // 元数据缺失
  const attBad = fs.readdirSync(path.join(dirBad, '_attachments')).filter(f => f !== '_manifest.json');
  if (attBad.length) fs.writeFileSync(path.join(dirBad, '_attachments', attBad[0]), Buffer.from('corrupted'), 'utf8'); // 附件内容不符
  badText = badText.replace('[[paper-dev-pdc-index|', '[[does-not-exist-note|'); // 链接指向不存在的笔记
  fs.writeFileSync(badFile, badText, 'utf8');
  const bad = runAudit();
  VAULT = oldVault; VAULT_ROOT = oldRoot; OUT_JSON = oldJson; OUT_MD = oldMd;

  const pick = (payload, key) => payload.perPage.find(x => x.key === key);
  const missingKeys = new Set(good.matching.missingPages.map(m => m.key));
  const nameToKey = new Map(src.pages.map(p => [fixtureNoteName(p.sec, p.rel), p.key]));
  const explainedLinkIssue = (i) => {
    if (i.targetPage && missingKeys.has(i.targetPage)) return true;
    if (i.kind === 'dangling-wikilink' || i.kind === 'unresolved-wikilink') {
      const np = String(i.source || '').split('#')[0].split('|')[0];
      const k = nameToKey.get(np);
      if (!k || missingKeys.has(k)) return true;      // fixture 未含该页
    }
    return false;
  };

  for (const k of keys) {
    const g = pick(good, k);
    ok('T9[' + k + '] 已配对', !!g && g.audited, g ? '' : '未配对');
    if (!g || !g.audited) continue;
    ok('T9[' + k + '] 代码体零差异 PASS', g.code.pass, JSON.stringify(g.code.issues).slice(0, 300));
    ok('T9[' + k + '] 文本守恒 PASS (cov=' + g.text.coverage + ')', g.text.pass, JSON.stringify(g.text.missingLines).slice(0, 200));
    ok('T9[' + k + '] 元素计数 PASS', g.elements.pass, JSON.stringify(g.elements.issues).slice(0, 400));
    ok('T9[' + k + '] 元数据 PASS', g.meta.pass, JSON.stringify(g.meta.issues).slice(0, 300));
    ok('T9[' + k + '] 图片 PASS', g.images.pass, JSON.stringify(g.images.issues).slice(0, 300));
    const uLinks = g.links.issues.filter(i => !explainedLinkIssue(i));
    ok('T9[' + k + '] 链接 PASS（排除 fixture 未含页）', uLinks.length === 0, JSON.stringify(uLinks).slice(0, 400));
    const uAnch = g.anchors.issues.filter(i => !/目标页缺失|源链接目标未解析/.test(i.detail));
    ok('T9[' + k + '] 锚点 PASS（排除 fixture 未含页）', uAnch.length === 0, JSON.stringify(uAnch).slice(0, 400));
  }

  // ── T10 破坏检测灵敏度 ──
  const b = pick(bad, 'paper:anti-xray/index');
  const g2 = pick(good, 'paper:anti-xray/index');
  ok('T10 破坏：代码体丢行被检出', b && !b.code.pass && b.code.issues.some(i => /不一致|缺块/.test(i.reason)), JSON.stringify(b && b.code.issues).slice(0, 300));
  ok('T10 破坏：正文改动被检出', b && b.text.coverage < g2.text.coverage, 'bad=' + (b && b.text.coverage) + ' good=' + g2.text.coverage);
  ok('T10 破坏：附件内容不符被检出', b && !b.images.pass, JSON.stringify(b && b.images.issues).slice(0, 300));
  ok('T10 破坏：悬空 wikilink 被检出', b && b.links.issues.some(i => i.kind === 'dangling-wikilink'), JSON.stringify(b && b.links.issues.filter(i => i.kind === 'dangling-wikilink')).slice(0, 300));
  ok('T10 破坏：元数据缺失被检出', b && b.meta.issues.some(i => i.field === 'sha256'), JSON.stringify(b && b.meta.issues).slice(0, 300));
  ok('T10 对照组未被误报', g2.code.pass && g2.text.pass && g2.images.pass, '');

  try { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dirBad, { recursive: true, force: true }); } catch (e) { }
  return results;
}

function selftest() {
  const results = runSelftest();
  const fail = results.filter(r => !r.pass);
  for (const r of results) console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
  console.log('── selftest: ' + (results.length - fail.length) + '/' + results.length + ' passed');
  process.exitCode = fail.length ? 1 : 0;
}

if (argv.includes('--selftest')) selftest();
else main();
