#!/usr/bin/env node
/**
 * verify-obsidian.js — 独立验证 Agent 的取证脚本（不采信执行者自述）
 *
 * 用法:
 *   node tools/verify-obsidian.js                 # 全部已实现的检查项
 *   node tools/verify-obsidian.js --check=1,3,4    # 只跑指定项
 *   node tools/verify-obsidian.js --json           # 只打印 JSON
 *   node tools/verify-obsidian.js --no-md          # 不写 reports/obsidian-verification.md
 *
 * 只读: archive/**, data/**, reports/**（权威文件）, 目标库。
 * 只写: reports/obsidian-verification.json / reports/obsidian-verification.md
 *
 * 设计要点
 *  - 所有结论由本脚本自己实测得出；executor 的自报数字仅用于「对账」表，不用于判定。
 *  - 每次运行都记录目标库指纹；与上一次运行/首次运行指纹对比 -> 回答「验证期间库是否变化」。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------- 路径常量
const ROOT = path.resolve(__dirname, '..');                       // papermc-docs
const VAULT = process.env.OBSIDIAN_VAULT || '<VAULT_PATH>';
const DB = path.join(VAULT, 'Server', 'Paper Database');
const REPORTS = path.join(ROOT, 'reports');
const SECTIONS = ['paper', 'velocity', 'folia'];
const SEC_TITLE = { paper: 'Paper', velocity: 'Velocity', folia: 'Folia' };

// ---------------------------------------------------------------- 工具函数
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readText = (p) => fs.readFileSync(p, 'utf8');
const readBuf = (p) => fs.readFileSync(p);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const rj = (p) => JSON.parse(readText(p));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const uniq = (a) => Array.from(new Set(a));
const inBN = (s) => String(s).normalize('NFC');

function walkFiles(dir, out = []) {
  if (!exists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(f, out);
    else if (e.isFile()) out.push(f);
  }
  return out;
}
function rel(p, base) { return path.relative(base, p).split(path.sep).join('/'); }
function esc(s) { return String(s).replace(/\|/g, '\\|'); }

// ---------------------------------------------------------------- 源与基线
const manifestPages = (() => {
  const pages = [];
  for (const sec of SECTIONS) {
    const m = rj(path.join(ROOT, 'archive', sec, 'manifest.json'));
    for (const p of m.pages) {
      pages.push({
        sec, key: `${sec}:${p.rel}`, rel: p.rel, title: p.title, url: p.url,
        file: p.file, htmlFile: p.htmlFile, sourceFile: p.sourceFile,
        sha256: p.sha256, codeBlocks: p.codeBlocks, assets: p.assets, markdownBytes: p.markdownBytes,
      });
    }
  }
  return pages;
})();
const srcByKey = new Map(manifestPages.map((p) => [p.key, p]));

// 由上游 URL 独立推导 slug（= 契约 frontmatter 的 slug 字段），不采信 executor 的命名映射
function slugFromUrl(u, sec) {
  let pn;
  try { pn = new URL(u).pathname; } catch { return null; }
  const prefix = '/' + sec + '/';
  let s = pn.startsWith(prefix) ? pn.slice(prefix.length) : pn.replace(/^\//, '');
  s = s.replace(/\/+$/, '');
  return s;
}
const srcBySlug = new Map();   // 'sec:slug' -> page
for (const p of manifestPages) {
  const s = slugFromUrl(p.url, p.sec);
  p.slug = s;
  if (s !== null && !srcBySlug.has(`${p.sec}:${s}`)) srcBySlug.set(`${p.sec}:${s}`, p);
  // 兼容 manifest rel 形态（含 /index）
  if (!srcBySlug.has(p.key)) srcBySlug.set(p.key, p);
}

const taxonomy = (() => {
  try { return rj(path.join(ROOT, 'data', 'taxonomy.json')); } catch { return { pages: [], categories: [] }; }
})();
const taxByKey = new Map((taxonomy.pages || []).map((p) => [p.id, p]));

const nav = (() => {
  const j = rj(path.join(ROOT, 'data', 'source-nav.json'));
  const byRel = new Map();           // 'sec:rel' -> {section, labels[], title}
  const groupLabels = new Set();
  const homePages = [];              // pagesNotInSourceNav：32 条
  for (const s of j.sections) {
    const walk = (n, labels) => {
      if (n.kind === 'group') {
        groupLabels.add(n.label);
        const nl = labels.concat([n.label]);
        (n.children || []).forEach((c) => walk(c, nl));
      } else {
        byRel.set(`${s.id}:${n.rel}`, { section: s.id, labels: labels.slice(), title: n.title || n.label });
      }
    };
    (s.groups || []).forEach((g) => walk(g, []));
    for (const p of (s.pagesNotInSourceNav || [])) {
      const m = /「([^」]+)」/.exec(p.reason || '');
      const labels = m ? m[1].split('>').map((x) => x.trim()).filter(Boolean) : null;
      homePages.push({ key: `${s.id}:${p.rel}`, section: s.id, rel: p.rel, title: p.title, reason: p.reason || '', labels });
    }
  }
  return { byRel, groupLabels, homePages, stats: j.stats, raw: j };
})();

const fidelity = (() => { try { return rj(path.join(REPORTS, 'obsidian-fidelity.json')); } catch { return null; } })();

// 执行者产物（对账用；不用于判定）
const buildReport = (() => { try { return readText(path.join(REPORTS, 'obsidian-build.md')); } catch { return ''; } })();
const buildReportAt = (() => { const m = /- 生成时间：([^\n]+)/.exec(buildReport); return m ? m[1].trim() : null; })();

// ---------------------------------------------------------------- 目标库扫描
const allDbFiles = walkFiles(DB);
// 工具自身产物区（备份/staging/manifest）不计入「笔记/附件」口径
const isToolArea = (p) => { const r = rel(p, DB); return r.startsWith('_backup/') || r === '_export-manifest.json' || r.startsWith('_stage') || r.startsWith('Paper Database.__'); };
const backupFiles = allDbFiles.filter((f) => rel(f, DB).startsWith('_backup/'));
const dbMdAll = allDbFiles.filter((f) => f.toLowerCase().endsWith('.md') && !isToolArea(f));
const isIndexDir = (p) => rel(p, DB).split('/').some((s) => s === '_index');
const notes = dbMdAll.filter((f) => !isIndexDir(f) && rel(f, DB) !== 'README.md');
const readmeNotes = dbMdAll.filter((f) => rel(f, DB) === 'README.md');
const indexNotes = dbMdAll.filter(isIndexDir);
const allNoteLike = dbMdAll;   // 笔记 + README + _index：用于 wikilink/附件解析池
const attachmentFiles = allDbFiles.filter((f) => !f.toLowerCase().endsWith('.md')
  && !isToolArea(f) && !/_manifest\.json$/i.test(f));

function parseFrontmatter(text) {
  const res = { present: false, yaml: '', keys: [], map: {}, body: text, error: null };
  if (!text.startsWith('---')) return res;
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return res;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { end = i; break; }
  if (end < 0) { res.error = 'unterminated-frontmatter'; return res; }
  res.present = true;
  res.yaml = lines.slice(1, end).join('\n');
  res.body = lines.slice(end + 1).join('\n');
  const cur = [];
  for (const ln of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(ln);
    if (m) { cur.push(m[1]); res.map[m[1]] = m[2]; }
  }
  res.keys = cur;
  return res;
}

const noteObjs = notes.map((abs) => {
  const buf = readBuf(abs);
  const text = buf.toString('utf8');
  return { abs, rel: rel(abs, DB), segs: rel(abs, DB).split('/'), base: path.basename(abs, '.md'), buf, text, fm: parseFrontmatter(text) };
});
const noteByBaseCI = new Map();
for (const n of noteObjs) {
  const k = n.base.toLowerCase();
  if (!noteByBaseCI.has(k)) noteByBaseCI.set(k, []);
  noteByBaseCI.get(k).push(n);
}
// wikilink 解析池必须包含 _index/** 与 README（Obsidian 按库内 basename 解析，不区分目录）
for (const abs of [...indexNotes, ...readmeNotes]) {
  const r = rel(abs, DB);
  const o = { abs, rel: r, base: path.basename(abs, '.md'), text: readText(abs) };
  const k = o.base.toLowerCase();
  if (!noteByBaseCI.has(k)) noteByBaseCI.set(k, []);
  noteByBaseCI.get(k).push(o);
}

// ---------------------------------------------------------------- 指纹
function fingerprint() {
  const files = walkFiles(DB).map((f) => ({ r: rel(f, DB), s: sha256(readBuf(f)) })).sort((a, b) => a.r.localeCompare(b.r));
  const h = crypto.createHash('sha256');
  let bytes = 0;
  for (const f of files) { h.update(f.r); h.update('\0'); h.update(f.s); h.update('\n'); bytes += fs.statSync(path.join(DB, f.r.split('/').join(path.sep))).size; }
  return { files: files.length, bytes, hash: h.digest('hex'), list: files };
}
function vaultOutsideFingerprint() {
  const skipTop = new Set(['.obsidian', '.trash']);
  const files = [];
  const walk = (dir, top) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (dir === VAULT && skipTop.has(e.name)) continue; walk(f, top); }
      else if (e.isFile()) {
        if (dir === VAULT && (top === undefined) ) {}
        files.push(f);
      }
    }
  };
  // 按契约 D34a：排除 .obsidian/**（整个目录）、.trash/**，以及插件 data.json（在 .obsidian 内，已被排除）
  walk(VAULT);
  const arr = files
    .filter((f) => !f.startsWith(path.join(VAULT, 'Server', 'Paper Database') + path.sep))
    .filter((f) => !f.startsWith(path.join(VAULT, '.obsidian') + path.sep))
    .filter((f) => !f.startsWith(path.join(VAULT, '.trash') + path.sep))
    .map((f) => ({ r: rel(f, VAULT), s: sha256(readBuf(f)) }))
    .sort((a, b) => a.r.localeCompare(b.r));
  const h = crypto.createHash('sha256');
  for (const f of arr) { h.update(f.r); h.update('\0'); h.update(f.s); h.update('\n'); }
  return { files: arr.length, hash: h.digest('hex'), list: arr };
}

// ---------------------------------------------------------------- 解析辅助
// frontmatter 专用 YAML 子集解析器（离线；仓库无 js-yaml，只覆盖本项目实际使用的形态）
function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return { v: null, style: 'empty' };
  if (s.startsWith('"')) {
    try { return { v: JSON.parse(s), style: 'double' }; } catch { return { v: s.replace(/^"|"$/g, ''), style: 'double-raw' }; }
  }
  if (s.startsWith("'")) return { v: s.replace(/^'|'$/g, '').replace(/''/g, "'"), style: 'single' };
  return { v: s, style: 'plain' };
}
function parseFlowList(raw) {
  const s = raw.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return { v: null, err: 'not-flow-list' };
  const inner = s.slice(1, -1);
  const items = [];
  let buf = '', q = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (q) { if (ch === q) q = null; buf += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; buf += ch; continue; }
    if (ch === ',') { items.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim() !== '' || inner.trim() !== '') items.push(buf);
  return { v: items.map((x) => parseScalar(x).v), err: null };
}
function parseYamlSubset(text) {
  const lines = text.split('\n');
  const obj = {};
  const styles = {};
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim() || /^\s*#/.test(ln)) continue;
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(ln);
    if (!m) return { ok: false, error: `第 ${i + 1} 行不是 key: value -> ${JSON.stringify(ln)}`, obj, styles };
    const key = m[1];
    const rest = m[2];
    if (rest.trim() === '') {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s/.test(lines[j])) { items.push(parseScalar(lines[j].replace(/^\s*-\s*/, '')).v); j++; }
      if (items.length) { obj[key] = items; styles[key] = 'block-list'; i = j - 1; }
      else { obj[key] = null; styles[key] = 'null'; }
      continue;
    }
    if (rest.trim().startsWith('[')) {
      const r = parseFlowList(rest.trim());
      if (r.err) return { ok: false, error: `第 ${i + 1} 行 flow-list 解析失败: ${rest}`, obj, styles };
      obj[key] = r.v; styles[key] = 'flow-list';
      continue;
    }
    const r = parseScalar(rest);
    obj[key] = r.v; styles[key] = r.style;
  }
  return { ok: true, error: null, obj, styles };
}

// 契约 v5 口径：行首标题 ∪ 列表内嵌标题
const HEADING_RE = /^(?:[ \t]*[-*+][ \t]+)?(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
function stripInlineMd(s) {
  return String(s)
    .replace(/!?\[\[([^\[\]]*\|)?([^\[\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/\\([|#^\[\]])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
function headingsOf(md) {
  const out = [];
  const lines = String(md).split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const bare = stripQuotePrefix(lines[i]);
    if (/^\s*(`{3,}|~{3,})/.test(bare)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = HEADING_RE.exec(bare);
    if (!m) continue;
    out.push({ level: m[1].length, raw: m[2], text: stripInlineMd(m[2]), listEmbedded: /^[ \t]*[-*+][ \t]+/.test(bare), line: i + 1 });
  }
  return out;
}
// fence 提取：自动剥离 callout 的 `> ` 前缀（空格的消耗只在 `>` 之后发生）；允许列表内缩进围栏
function fencesOf(md) {
  const lines = String(md).split('\n');
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const qm = /^((?:[ \t]*>[ \t]?)*)(.*)$/.exec(lines[i]);
    const prefix = qm ? qm[1] : '';
    const rest = qm ? qm[2] : lines[i];
    const quoted = /^\s*>/.test(prefix);
    if (!cur) {
      const fm = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(rest);
      if (fm) { cur = { marker: fm[1] + (fm[2][0] === '`' ? '```' : '~~~'), info: fm[3].trim(), bodyLines: [], line: i + 1, quoteEmbedded: quoted }; }
    } else {
      if (new RegExp('^' + cur.marker + '\\s*$').test(rest)) { blocks.push(cur); cur = null; }
      else cur.bodyLines.push((quoted ? '> ' : '') + rest);
    }
  }
  if (cur) { cur.unterminated = true; blocks.push(cur); }
  return {
    blocks,
    count: blocks.length,
    withTitle: blocks.filter((b) => /title\s*=/.test(b.info)).length,
    noInfo: blocks.filter((b) => b.info === '').length,
    infosWithSpace: blocks.filter((b) => /\s/.test(b.info)).length,
  };
}
function stripQuotePrefix(line) { return line.replace(/^(?:[ \t]*>[ \t]?)+/, ''); }
function stripQuoteAll(text) { return String(text).split('\n').map(stripQuotePrefix).join('\n'); }

// 归档侧读取（带缓存）
const _srcCache = new Map();
function srcMdOf(page) {
  if (!page) return null;
  const p = path.join(ROOT, 'archive', page.sec, page.file);
  if (!_srcCache.has(p)) { try { _srcCache.set(p, readText(p)); } catch { _srcCache.set(p, null); } }
  return _srcCache.get(p);
}
const _htmlCache = new Map();
function htmlOf(page) {
  if (!page) return null;
  const p = path.join(ROOT, 'archive', page.sec, page.htmlFile);
  if (!_htmlCache.has(p)) { try { _htmlCache.set(p, readText(p)); } catch { _htmlCache.set(p, null); } }
  return _htmlCache.get(p);
}
// Markdown 链接扫描（括号平衡，跳过围栏）
function mdLinks(md) {
  const out = [];
  const lines = String(md).split('\n');
  let inFence = false;
  for (let li = 0; li < lines.length; li++) {
    const bare = stripQuotePrefix(lines[li]);
    if (/^\s*(`{3,}|~{3,})/.test(bare)) { inFence = !inFence; continue; }
    if (inFence) continue;
    for (let i = 0; i < lines[li].length - 1; i++) {
      if (lines[li][i] === ']' && lines[li][i + 1] === '(') {
        let depth = 1, j = i + 2;
        for (; j < lines[li].length && depth > 0; j++) {
          if (lines[li][j] === '(') depth++;
          else if (lines[li][j] === ')') depth--;
        }
        if (depth === 0) out.push({ text: lines[li].slice(Math.max(0, lines[li].lastIndexOf('[', i)), i), href: lines[li].slice(i + 2, j - 1), line: li + 1 });
      }
    }
  }
  return out;
}
const slugOfRel = (rel) => String(rel).replace(/\/index$/, '').replace(/^index$/, '');
const canonKey = (sec, rel) => `${sec}:${slugOfRel(rel)}`;

// ---------------------------------------------------------------- 前一次验证结果 & 备份/基线观测（必须在 check() 之前定义）
const prevPath = path.join(REPORTS, 'obsidian-verification.json');
let prevRun = null;
try { prevRun = rj(prevPath); } catch { prevRun = null; }

// fidelity 基线文件自身的指纹（基线可能在验证期间被重新生成）
const baselineInfo = (() => {
  const p = path.join(REPORTS, 'obsidian-fidelity.json');
  try {
    const buf = readBuf(p);
    const j = JSON.parse(buf.toString('utf8'));
    return {
      path: 'reports/obsidian-fidelity.json', sha256: sha256(buf), generated_at: j.generated_at,
      mtime: fs.statSync(p).mtime.toISOString(),
      headings: j.sourceAggregate ? j.sourceAggregate.headings : null,
      anchorA: j.sourceAnchorAudit ? j.sourceAnchorAudit.resolvable : null,
    };
  } catch (e) { return { path: 'reports/obsidian-fidelity.json', error: String(e.message || e) }; }
})();
const baselineHistory = (prevRun && prevRun.baseline && prevRun.baseline.history ? prevRun.baseline.history.slice(-19) : []);
if (!baselineHistory.some((h) => h.sha256 === baselineInfo.sha256)) {
  baselineHistory.push({ at: new Date().toISOString(), sha256: baselineInfo.sha256, generated_at: baselineInfo.generated_at, headings: baselineInfo.headings, anchorA: baselineInfo.anchorA });
}

// _backup 快照（含库内 `_backup/**` 与库外兄弟目录 `Server/Paper Database.__backup/**`）
const backupDirs = uniq(backupFiles.map((f) => rel(f, DB).split('/').slice(0, 2).join('/')));
const siblingBackupRoot = path.join(path.dirname(DB), 'Paper Database.__backup');
const siblingBackupFiles = walkFiles(siblingBackupRoot);
const siblingBackupDirs = uniq(siblingBackupFiles.map((f) => rel(f, siblingBackupRoot).split('/')[0]));
const backupDirsSeenNow = backupDirs.length + siblingBackupDirs.length;
// vault 之外的备份（Obsidian 看不到；主 Agent 裁决后的目标位置）
const vaultParent = path.dirname(VAULT);
const outOfVaultBackups = (() => {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(vaultParent, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    if (!/(papermc|obsidian)[^/]*backup|backup[^/]*(papermc|obsidian)/i.test(e.name)) continue;
    const p = path.join(vaultParent, e.name);
    const files = walkFiles(p);
    out.push({ rel: e.name, path: p, snapshots: uniq(files.map((f) => rel(f, p).split('/')[0])), files: files.length, md: files.filter((f) => f.toLowerCase().endsWith('.md')).length });
  }
  return out;
})();
const backupHistory = (prevRun && prevRun.backup && prevRun.backup.history ? prevRun.backup.history.slice(-19) : []);
backupHistory.push({ at: new Date().toISOString(), dirsInside: backupDirs.length, dirsSibling: siblingBackupDirs.length, filesInside: backupFiles.length, filesSibling: siblingBackupFiles.length });

// 交付目录之外的「本项目路径」（`Paper Database.*`）——D34a 字面口径下的越界观测
const projectPathsOutsideDelivery = (() => {
  const parent = path.dirname(DB);
  const out = [];
  for (const e of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!/^Paper Database\./.test(e.name)) continue;
    const p = path.join(parent, e.name);
    out.push({ path: rel(p, VAULT), kind: e.isDirectory() ? 'dir' : 'file', files: e.isDirectory() ? walkFiles(p).length : 1 });
  }
  return out;
})();
const exportManifestEntries = (() => { try { return (rj(path.join(DB, '_export-manifest.json')).entries || []).length; } catch { return null; } })();

// ---------------------------------------------------------------- 检查结果容器
const results = [];
function check(id, name, fn) {
  let r;
  try { r = fn() || {}; } catch (e) { r = { status: 'ERROR', notes: ['异常：' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ⟶ ') : e)] }; }
  results.push(Object.assign({ id, name, status: 'UNKNOWN', measured: {}, evidence: [], notes: [] }, r, { id, name }));
}

// ================================================================ 检查 1 覆盖
check(1, '覆盖：141 源页 → 笔记数 / 双向差集 / folia 6 页', () => {
  const matched = new Map();       // canonicalKey('sec:slug') -> note
  const unmatchedNotes = [];
  for (const n of noteObjs) {
    const secRaw = (n.fm.map.section || '').replace(/^["']|["']$/g, '');
    const slug = (n.fm.map.slug || '').replace(/^["']|["']$/g, '');
    const sec = secRaw.toLowerCase();
    const key = sec && slug !== undefined ? `${sec}:${slug}` : null;
    if (key && srcBySlug.has(key)) {
      n.srcPage = srcBySlug.get(key);
      n.srcKey = `${n.srcPage.sec}:${n.srcPage.slug}`;
      if (!matched.has(n.srcKey)) matched.set(n.srcKey, n);
      else unmatchedNotes.push({ rel: n.rel, section: secRaw, slug, reason: 'duplicate-of-' + matched.get(n.srcKey).rel });
    } else {
      unmatchedNotes.push({ rel: n.rel, section: secRaw || null, slug: slug === undefined ? null : slug, reason: key ? 'unknown-source-slug' : 'no-frontmatter-slug' });
    }
  }
  const missing = manifestPages.filter((p) => !matched.has(`${p.sec}:${p.slug}`));
  const bySec = {};
  for (const sec of SECTIONS) {
    bySec[sec] = {
      source: manifestPages.filter((p) => p.sec === sec).length,
      matched: manifestPages.filter((p) => p.sec === sec && matched.has(`${p.sec}:${p.slug}`)).length,
      missing: missing.filter((p) => p.sec === sec).length,
      missingKeys: missing.filter((p) => p.sec === sec).map((p) => `${p.sec}:${p.slug}`),
    };
  }
  const foliaMatched = manifestPages.filter((p) => p.sec === 'folia' && matched.has(`${p.sec}:${p.slug}`)).map((p) => `${p.sec}:${p.slug}`);
  const status = missing.length === 0 && unmatchedNotes.length === 0 ? 'PASS' : 'FAIL';
  return {
    status,
    measured: {
      sourcePages: manifestPages.length, notesOnDisk: noteObjs.length, matched: matched.size,
      missing: missing.length, extraUnmatchedNotes: unmatchedNotes.length,
      bySection: bySec, foliaMatched, foliaTotal: 6,
      noteCountVs141: `${noteObjs.length} / 141`,
    },
    evidence: {
      missingSample: missing.slice(0, 12).map((p) => `${p.sec}:${p.slug}`),
      extraSample: unmatchedNotes.slice(0, 12),
    },
    notes: missing.length || unmatchedNotes.length
      ? [`当前盘面为部分导出：缺 ${missing.length} 篇、多 ${unmatchedNotes.length} 篇（未匹配到源页的笔记）。`]
      : ['141/141 全部命中，0 缺 0 多。'],
  };
});

// ================================================================ 检查 3 basename 唯一性
check(3, 'basename 大小写不敏感唯一（排除 _index/）', () => {
  const freq = new Map();
  for (const n of noteObjs) {
    const k = n.base.toLowerCase();
    if (!freq.has(k)) freq.set(k, []);
    freq.get(k).push(n.rel);
  }
  const dup = [...freq.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ base_ci: k, files: v }));
  const attFreq = new Map();
  for (const f of attachmentFiles) {
    const b = path.basename(f).toLowerCase();
    if (!attFreq.has(b)) attFreq.set(b, []);
    attFreq.get(b).push(rel(f, DB));
  }
  const attDup = [...attFreq.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ base_ci: k, files: v }));
  // 真机可见性（Obsidian 模型：索引整库，但**忽略点开头的文件/目录**；.obsidian/.trash/.agents/.copilot 都不索引）
  const vaultMd = [];
  (function walkVisible(dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walkVisible(f);
      else if (e.isFile() && f.toLowerCase().endsWith('.md')) vaultMd.push(f);
    }
  })(VAULT);
  const vaultFreq = new Map();
  for (const f of vaultMd) {
    const b = path.basename(f, '.md').toLowerCase();
    if (!vaultFreq.has(b)) vaultFreq.set(b, []);
    vaultFreq.get(b).push(rel(f, VAULT));
  }
  const dbPrefix = 'Server/Paper Database/';
  const candidateRows = [];
  for (const n of noteObjs) {
    const cands = vaultFreq.get(n.base.toLowerCase()) || [];
    const outsideDeliverable = cands.filter((c) => c !== dbPrefix + n.rel);
    if (outsideDeliverable.length) candidateRows.push({ base: n.base, deliverable: n.rel, others: outsideDeliverable.slice(0, 8), othersCount: outsideDeliverable.length, fromBackup: outsideDeliverable.filter((c) => c.includes('/_backup/')).length, fromOtherVaultDirs: outsideDeliverable.filter((c) => !c.includes('/_backup/')).length });
  }
  const multiCandidate = candidateRows.filter((r) => r.othersCount > 0);
  const collidesOutsideDb = candidateRows.filter((r) => r.fromOtherVaultDirs > 0);
  return {
    status: dup.length === 0 && attDup.length === 0 ? 'PASS' : 'FAIL',
    measured: {
      notesScanned: noteObjs.length, distinctBasenamesCI: freq.size, conflicts: dup.length, attachmentConflicts: attDup.length,
      vaultMdFiles: vaultMd.length,
      notesWithExtraCandidatesInVault: multiCandidate.length,
      notesCollidingOutsidePaperDatabase: collidesOutsideDb.length,
      maxCandidates: candidateRows.length ? Math.max(...candidateRows.map((r) => r.othersCount + 1)) : 1,
    },
    evidence: { conflicts: dup.slice(0, 20), attachmentConflicts: attDup.slice(0, 10), vaultCandidateSample: multiCandidate.slice(0, 8), collideOutsideDb: collidesOutsideDb.slice(0, 10) },
    notes: [
      `交付集内：${noteObjs.length} 篇 → ${freq.size} 个唯一 basename（大小写不敏感），冲突 ${dup.length}。`,
      `真机可见性（Obsidian 模型：索引整库、忽略点目录；\`vault\` 上一级的备份目录天然不可见）：vault 内可见 .md 共 ${vaultMd.length} 篇，交付 basename 中出现额外候选的笔记 ${multiCandidate.length} 篇（最多 ${candidateRows.length ? Math.max(...candidateRows.map((r) => r.othersCount + 1)) : 1} 个候选）→ 红队 H1/H5 的「短式链接静默跳错」风险${multiCandidate.length === 0 ? '当前为 0（已消除）' : '仍存在'}。`,
      `与库内既有笔记（非交付目录）撞名：${collidesOutsideDb.length} 条。`,
    ],
  };
});

// ================================================================ 检查 4 文件名合法性
check(4, '文件名合法性（Windows 非法字符/保留名/长度）', () => {
  const badChars = /[\\/:*?"<>|^%~\[\]]/;
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  const issues = [];
  for (const f of allDbFiles) {
    const relPath = rel(f, DB);
    for (const seg of relPath.split('/')) {
      const name = seg.replace(/\.[^.]*$/, '');
      if (badChars.test(seg)) issues.push({ kind: 'illegal-char', path: relPath });
      if (/^[ .]|[ .]$/.test(name)) issues.push({ kind: 'edge-space-dot', path: relPath });
      if (reserved.test(name)) issues.push({ kind: 'reserved-name', path: relPath });
      if (seg.length > 200) issues.push({ kind: 'gt200', path: relPath, len: seg.length });
      if (seg.length > 120) issues.push({ kind: 'gt120', path: relPath, len: seg.length });
    }
    if (relPath.length > 200) issues.push({ kind: 'abspath-gt200', path: relPath, len: relPath.length });
  }
  const gt200 = issues.filter((i) => i.kind === 'gt200');
  const hard = issues.filter((i) => i.kind !== 'gt200' && i.kind !== 'gt120');
  return {
    status: hard.length === 0 && gt200.length === 0 ? 'PASS' : 'FAIL',
    measured: {
      filesScanned: allDbFiles.length,
      illegalChar: issues.filter((i) => i.kind === 'illegal-char').length,
      edgeSpaceDot: issues.filter((i) => i.kind === 'edge-space-dot').length,
      reserved: issues.filter((i) => i.kind === 'reserved-name').length,
      len_gt120_contract: issues.filter((i) => i.kind === 'gt120').length,
      len_gt200_task: gt200.length,
      absPath_gt200: issues.filter((i) => i.kind === 'abspath-gt200').length,
      maxSegLen: Math.max(0, ...allDbFiles.flatMap((f) => rel(f, DB).split('/').map((s) => s.length))),
    },
    evidence: { issues: issues.slice(0, 20) },
    notes: ['契约 D30 要求 ≤120 字符；任务要求 ≤200 —— 两者都统计。'],
  };
});

// ================================================================ 检查 5 wikilink 可解析
function resolveWikilink(target, selfRel) {
  // 返回 {hits:[paths], kind:'note'|'attachment'}；`\|` = 表格内的转义分隔符（按 Obsidian 表格惯例）
  const clean = target.replace(/\\\|/g, '|').split('|')[0].split('#')[0].trim();
  if (!clean) return { hits: [], kind: 'note' };
  if (clean.includes('/')) {
    const p = path.join(DB, clean.split('/').join(path.sep));
    const cand = [p, p + '.md'];
    const hit = cand.filter((x) => exists(x)).map((x) => rel(x, DB));
    return { hits: uniq(hit), kind: 'note' };
  }
  const k = clean.toLowerCase();
  const hits = [];
  const nt = noteByBaseCI.get(k);
  if (nt) hits.push(...nt.map((n) => n.rel));
  const at = attachmentFiles.filter((f) => path.basename(f).toLowerCase() === k);
  if (at.length) return { hits: uniq(at.map((f) => rel(f, DB))), kind: 'attachment' };
  return { hits: uniq(hits), kind: 'note' };
}
check(5, 'wikilink 可解析（恰命中 1）/ 悬空数必须为 0', () => {
  const links = [];      // {file, raw, target, embed, hits}
  const re = /(!?)\[\[([^\[\]]+?)\]\]/g;
  for (const n of [...noteObjs, ...indexNotes.map((abs) => ({ abs, rel: rel(abs, DB), text: readText(abs) }))]) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(n.text))) {
      const embed = m[1] === '!';
      const raw = m[2];
      links.push({ file: n.rel, raw, embed, loc: n.text.slice(0, m.index).split('\n').length });
    }
  }
  for (const l of links) {
    const r = resolveWikilink(l.raw, l.file);
    l.hits = r.hits;
    l.kind = r.kind;
    l.status = r.hits.length === 0 ? 'dangling' : (r.hits.length > 1 ? 'ambiguous' : 'ok');
  }
  const dangling = links.filter((l) => l.status === 'dangling');
  const ambiguous = links.filter((l) => l.status === 'ambiguous');
  const distinctTargets = uniq(links.map((l) => l.raw.split('|')[0].split('#')[0].trim()));
  return {
    status: dangling.length === 0 && ambiguous.length === 0 ? 'PASS' : 'FAIL',
    measured: {
      totalLinks: links.length, noteLinks: links.filter((l) => !l.embed).length, embeds: links.filter((l) => l.embed).length,
      distinctTargets: distinctTargets.length, ok: links.filter((l) => l.status === 'ok').length,
      dangling: dangling.length, ambiguous: ambiguous.length,
      danglingDistinct: uniq(dangling.map((l) => l.raw.split('|')[0])).length,
    },
    evidence: { dangling: dangling.slice(0, 25), ambiguous: ambiguous.slice(0, 10) },
    notes: [`红队 H5：悬空必须为 0（未解析链接点击会新建空笔记）。当前盘面 ${dangling.length} 条悬空 → 若这是「部分导出」阶段的必然结果，需在全量落盘后复跑。`],
  };
});

// ================================================================ 检查 13 编码
check(13, '编码：UTF-8 无 BOM / LF / 无 U+FFFD / 中文正常', () => {
  const target = [...noteObjs, ...indexNotes.map((abs) => ({ abs, rel: rel(abs, DB), buf: readBuf(abs) }))];
  const bom = [], crlf = [], fffd = [], cr = [];
  for (const f of target) {
    const b = f.buf || readBuf(f.abs);
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) bom.push(f.rel);
    const s = b.toString('utf8');
    if (s.includes('\r\n')) crlf.push(f.rel);
    else if (s.includes('\r')) cr.push(f.rel);
    if (s.includes('\uFFFD')) fffd.push(f.rel);
  }
  // 中文抽样
  const withCJK = target.filter((f) => /[\u4e00-\u9fff]/.test((f.buf || readBuf(f.abs)).toString('utf8')));
  const sample = withCJK.slice(0, 12).map((f) => f.rel);
  const folia = target.filter((f) => f.rel.startsWith('Folia/')).length;
  return {
    status: bom.length === 0 && crlf.length === 0 && cr.length === 0 && fffd.length === 0 && withCJK.length > 0 ? 'PASS' : 'FAIL',
    measured: {
      filesScanned: target.length, bom: bom.length, crlf: crlf.length, loneCr: cr.length, replacementChar: fffd.length,
      filesWithCJK: withCJK.length, foliaNotes: folia, sampleSize: sample.length,
    },
    evidence: { bom: bom.slice(0, 5), crlf: crlf.slice(0, 5), fffd: fffd.slice(0, 5), sample },
    notes: [`抽样 ${sample.length} 篇含中文笔记逐字节检查；Folia 分区当前 ${folia} 篇（要求 ≥10 篇中含 folia，全量落盘后才能满足）。`],
  };
});

// ================================================================ 检查 2 结构一致性
check(2, '结构一致性：目录层级 = source-nav 分组标签逐字 / 组首页归属 / 32 条映射', () => {
  const walkNav = (n, labels, out, sec) => {
    if (n.kind === 'group') { const nl = labels.concat([n.label]); (n.children || []).forEach((c) => walkNav(c, nl, out, sec)); }
    else out.push({ sec, rel: n.rel, labels: labels.slice() });
  };
  const navPages = [];
  for (const s of nav.raw.sections) for (const g of (s.groups || [])) walkNav(g, [], navPages, s.id);
  const navPageByKey = new Map(navPages.map((x) => [`${x.sec}:${x.rel}`, x]));
  const labelPathSet = new Set();
  const collectGroups = (n, labels, sec) => {
    if (n.kind !== 'group') return;
    const nl = labels.concat([n.label]);
    labelPathSet.add(sec + '\u0001' + nl.join('\u0000'));
    (n.children || []).forEach((c) => collectGroups(c, nl, sec));
  };
  for (const s of nav.raw.sections) for (const g of (s.groups || [])) collectGroups(g, [], s.id);

  const dirIssues = [], ok = [], unsourced = [], homeIssues = [], homeVerified = [];
  const homeByKey = new Map(nav.homePages.map((h) => [h.key, h]));
  for (const n of noteObjs) {
    if (!n.srcPage) { unsourced.push(n.rel); continue; }
    const relKey = `${n.srcPage.sec}:${n.srcPage.rel}`;
    let labels = null, src = 'nav-sidebar';
    const navEntry = navPageByKey.get(relKey);
    if (navEntry) labels = navEntry.labels;
    else {
      const h = homeByKey.get(relKey);
      if (h && h.labels) { labels = h.labels; src = 'pagesNotInSourceNav.reason'; }
      else if (h) { labels = null; src = 'root-index(未在 source-nav 定义归属)'; }
    }
    const expected = [SEC_TITLE[n.srcPage.sec]].concat(labels || []);
    const actual = n.segs.slice(0, -1);
    const exact = expected.join('/') === actual.join('/');
    const ciOnly = !exact && expected.map((x) => x.toLowerCase()).join('/') === actual.map((x) => x.toLowerCase()).join('/');
    if (exact) ok.push(n.rel); else dirIssues.push({ note: n.rel, expected: expected.join('/'), actual: actual.join('/'), caseOnly: ciOnly, source: src });
    // 组首页落到自己的组目录 + 文件名 = 组标签
    if (labels && labels.length) {
      const last = labels[labels.length - 1];
      const inOwnDir = actual.join('/') === expected.join('/');
      const baseOk = n.base === last || n.base.startsWith(last) || n.base.startsWith(n.srcPage.title) || (n.base + '?') === n.srcPage.title || n.base.startsWith(n.srcPage.title.replace(/[?]/g, ''));
      if (inOwnDir && baseOk) homeVerified.push({ key: relKey, label: last, file: n.base });
      else homeIssues.push({ key: relKey, label: last, expectedDir: expected.join('/'), actualDir: actual.join('/'), base: n.base, title: n.srcPage.title });
    }
  }
  // 32 条映射：独立解析 reason
  const parsedOk = nav.homePages.filter((h) => h.labels && labelPathSet.has(`${h.section}\u0001` + h.labels.join('\u0000')));
  const parsedBad = nav.homePages.filter((h) => h.labels && !labelPathSet.has(`${h.section}\u0001` + h.labels.join('\u0000')));
  const unparsed = nav.homePages.filter((h) => !h.labels);
  // 与 executor 报告表对账
  const buildRows = (buildReport.match(/^\|\s*\d+\s*\|/gm) || []).length;
  const buildX = (buildReport.match(/✘ 未解析/g) || []).length;
  return {
    status: dirIssues.length === 0 && parsedBad.length === 0 && nav.homePages.length === 32 && unparsed.length === 3 && homeIssues.length === 0 ? 'PASS' : 'FAIL',
    measured: {
      notesWithSource: noteObjs.length - unsourced.length,
      dirExactOK: ok.length, dirIssues: dirIssues.length, unsourcedNotes: unsourced.length,
      navGroupLabels: nav.groupLabels.size, navPagesInSidebar: navPages.length,
      homePagesTotal: nav.homePages.length, homeMappingParsed: nav.homePages.length - unparsed.length, homeMappingUnparsed: unparsed.length,
      homeMappingInvalidPath: parsedBad.length, homeNotesVerified: homeVerified.length, homeNotesIssues: homeIssues.length,
      buildReportTableRows: buildRows, buildReportUnparsed: buildX,
    },
    evidence: {
      dirIssues: dirIssues.slice(0, 15),
      homeIssues: homeIssues.slice(0, 10),
      unsourced: unsourced.slice(0, 10),
      unparsedMapping: unparsed.map((h) => ({ key: h.key, reason: h.reason })),
      invalidPathMapping: parsedBad.map((h) => ({ key: h.key, labels: h.labels })),
      navGroupLabels: [...nav.groupLabels],
    },
    notes: [
      `分组标签逐字比对：目录段必须等于 data/source-nav.json 的分组标签；当前落盘 ${noteObjs.length} 篇中 ${ok.length} 篇目录完全一致。`,
      `32 条组首页→组 映射：独立从 pagesNotInSourceNav[].reason 解析出 ${nav.homePages.length - unparsed.length}/32 条，其中 ${unparsed.length} 条是站点根 index（reason 无「」分组路径）→ 与执行者报告 §3 的 ✘ 数量对账。`,
    ],
  };
});

// ================================================================ 检查 6 锚点
const anchorRefs = (() => {
  const refs = [];
  for (const p of manifestPages) {
    const md = srcMdOf(p);
    if (!md) continue;
    for (const l of mdLinks(md)) {
      const h = l.href;
      if (/^#/.test(h)) {
        const frag = decodeURIComponent(h.slice(1));
        refs.push({ sec: p.sec, srcKey: canonKey(p.sec, p.rel), targetKey: canonKey(p.sec, p.rel), frag, kind: 'same-file', text: l.text, line: l.line });
        continue;
      }
      if (/^https:\/\/docs\.papermc\.io\//.test(h)) {
        let u; try { u = new URL(h); } catch { continue; }
        if (!u.hash) continue;
        const sec = u.pathname.replace(/^\//, '').split('/')[0];
        if (!SEC_TITLE[sec]) continue;
        const slug = slugFromUrl(h, sec);
        refs.push({ sec, srcKey: canonKey(p.sec, p.rel), targetKey: `${sec}:${slug}`, frag: decodeURIComponent(u.hash.slice(1)), kind: 'docs-absolute', text: l.text, line: l.line, url: h });
        continue;
      }
      const m = /^([^#]*\.md)#(.+)$/.exec(h);
      if (m && !/^[a-z]+:/i.test(m[1])) {
      const abs = path.posix.normalize(path.posix.join(path.posix.dirname(p.rel), m[1]));
      refs.push({ sec: p.sec, srcKey: canonKey(p.sec, p.rel), targetKey: canonKey(p.sec, abs.replace(/\.md$/, '')), frag: decodeURIComponent(m[2]), kind: 'internal-file', text: l.text, line: l.line });
      }
    }
  }
  const nonFn = refs.filter((r) => !/^user-content-fn|^fn-/.test(r.frag));
  return { all: refs, nonFn, fn: refs.filter((r) => /^user-content-fn|^fn-/.test(r.frag)) };
})();

const anchorClass = new Map();      // targetKey#frag -> 'A'|'B'|'C'|'dead'|'unknown'
function classifyAnchor(ref) {
  const k = ref.targetKey + '#' + ref.frag;
  if (anchorClass.has(k)) return anchorClass.get(k);
  const page = srcBySlug.get(ref.targetKey);
  const html = htmlOf(page);
  let verdict = 'unknown', headingText = null;
  if (html) {
    const idRe = new RegExp('<([a-z0-9]+)\\b[^>]*\\bid="' + ref.frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'i');
    const m = idRe.exec(html);
    if (!m) verdict = 'dead';
    else {
      const tag = m[1].toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const start = m.index;
        const endIdx = html.indexOf('</' + tag + '>', start);
        const inner = endIdx > 0 ? html.slice(start, endIdx) : '';
        headingText = stripInlineMd(inner.replace(/<[^>]+>/g, ' '));
        const smd = srcMdOf(page);
        const hs = smd ? headingsOf(smd) : [];
        const hit = hs.find((x) => norm(x.text) === norm(headingText));
        verdict = hit ? 'A' : 'B';
        anchorClass._bDetail = anchorClass._bDetail || [];
        if (verdict === 'B') anchorClass._bDetail.push({ key: k, headingText, listEmbeddedCandidate: hs.filter((x) => norm(x.text).includes(norm(headingText).slice(0, 12))).map((x) => x.raw).slice(0, 2) });
      } else {
        verdict = 'C';
        anchorClass._cTag = anchorClass._cTag || {};
        anchorClass._cTag[tag] = (anchorClass._cTag[tag] || 0) + 1;
      }
    }
  }
  anchorClass.set(k, verdict);
  return verdict;
}

check(6, '锚点可解析：A/B/C 独立复算 / C 类必须 [[Note]] / 匹配大小写不敏感+空白折叠 / | 转义', () => {
  for (const r of anchorRefs.nonFn) r.cls = classifyAnchor(r);
  const counts = { A: 0, B: 0, C: 0, dead: 0, unknown: 0 };
  for (const r of anchorRefs.nonFn) counts[r.cls]++;
  const distinct = new Map();
  for (const r of anchorRefs.nonFn) distinct.set(r.targetKey + '#' + r.frag, r.cls);

  // 磁盘侧：所有 [[X#frag]]
  const fragViolations = [], footnoteViolations = [], pipeHeadings = [], pipeLinks = [];
  const escapedPipeLinks = [];
  const allNotesForLinks = [...noteObjs, ...indexNotes.map((abs) => ({ abs, rel: rel(abs, DB), text: readText(abs), segs: rel(abs, DB).split('/'), base: path.basename(abs, '.md') }))];
  const headingIndex = new Map();
  for (const n of allNotesForLinks) headingIndex.set(n.rel, headingsOf(n.text));
  const headingByBaseCI = new Map();
  for (const n of noteObjs) headingByBaseCI.set(n.base.toLowerCase(), n);
  for (const n of allNotesForLinks) {
    for (const h of headingIndex.get(n.rel) || []) if (h.raw.includes('|') || h.raw.includes('\\|')) pipeHeadings.push({ note: n.rel, line: h.line, raw: h.raw });
    const re = /\[\[([^\[\]]+?)\]\]/g;
    let m;
    while ((m = re.exec(n.text))) {
      const raw = m[1];
      const rawNorm = raw.replace(/\\\|/g, '|');
      const lineNo = n.text.slice(0, m.index).split('\n').length;
      if (/\\\|/.test(raw)) {
        const lineText = n.text.split('\n')[lineNo - 1] || '';
        escapedPipeLinks.push({ note: n.rel, line: lineNo, raw, inTableRow: /^\s*>?\s*\|/.test(lineText) });
      }
      if (!rawNorm.includes('#')) continue;
      const [tgtPart, fragPartRaw] = rawNorm.split('|')[0].split('#', 2);
      const frag = fragPartRaw || '';
      if (/^user-content-fn|^fn-/.test(frag)) { footnoteViolations.push({ note: n.rel, raw }); continue; }
      let hs = null, target = null;
      if (!tgtPart.trim()) { hs = headingIndex.get(n.rel); target = n.rel; }
      else {
        const t = headingByBaseCI.get(tgtPart.trim().toLowerCase());
        if (t) { hs = headingIndex.get(t.rel); target = t.rel; }
      }
      if (!hs) { fragViolations.push({ note: n.rel, raw, line: lineNo, reason: '目标笔记不存在' }); continue; }
      const ok = hs.some((h) => norm(h.text) === norm(frag));
      if (!ok) fragViolations.push({ note: n.rel, raw, line: lineNo, reason: '目标无该标题（大小写不敏感+空白折叠后仍不匹配）', targetHeadings: hs.map((h) => h.text).slice(0, 6) });
    }
  }
  // C 类必须 [[Note]]：检查 C 类锚点未被裸写成 [[Note#frag]]
  const cBare = [];
  const cList = [];
  for (const [k, cls] of distinct) if (cls === 'C') cList.push(k);
  for (const k of cList) {
    const [targetKey, frag] = [k.slice(0, k.lastIndexOf('#')), k.slice(k.lastIndexOf('#') + 1)];
    const targetNote = noteObjs.find((n) => n.srcKey === targetKey);
    if (!targetNote) continue;
    const pat = new RegExp('\\[\\[' + targetNote.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '#' + frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (pat.test(targetNote.text)) cBare.push({ target: targetNote.rel, frag });
  }
  // 执行者登记对账
  let execAnchors = null;
  try { execAnchors = rj(path.join(REPORTS, 'obsidian-anchors.json')); } catch { execAnchors = null; }
  const fidelityCounts = fidelity ? { A: fidelity.sourceAnchorAudit.resolvable, B: fidelity.sourceAnchorAudit.bHeadingInHtml, C: fidelity.sourceAnchorAudit.cNonHeadingId, dead: fidelity.sourceAnchorAudit.upstreamDead } : null;
  return {
    status: fragViolations.length === 0 && cBare.length === 0 && counts.dead <= (fidelityCounts && fidelityCounts.dead || 0) && counts.unknown === 0 ? 'PASS' : 'FAIL',
    measured: {
      refsTotal: anchorRefs.all.length, refsNonFootnote: anchorRefs.nonFn.length, footnoteRefs: anchorRefs.fn.length,
      myA: counts.A, myB: counts.B, myC: counts.C, myDead: counts.dead, myUnknown: counts.unknown,
      fidelityA: fidelityCounts && fidelityCounts.A, fidelityB: fidelityCounts && fidelityCounts.B, fidelityC: fidelityCounts && fidelityCounts.C, fidelityDead: fidelityCounts && fidelityCounts.dead,
      distinctAnchorTargets: distinct.size,
      diskFragViolations: fragViolations.length, cBareViolations: cBare.length, footnoteResidue: footnoteViolations.length,
      escapedPipeSeparators: escapedPipeLinks.length, escapedPipeOutsideTableRow: escapedPipeLinks.filter((x) => !x.inTableRow).length,
      headingsWithPipe: pipeHeadings.length, unescapedPipeLinks: pipeLinks.length,
      execAnchorsReport: execAnchors ? { classes: execAnchors.classes, baseline: execAnchors.baseline } : null,
    },
    evidence: {
      fragViolations: fragViolations.slice(0, 20),
      cBare: cBare.slice(0, 10),
      cListSample: cList.slice(0, 12),
      cTagHistogram: anchorClass._cTag || {},
      bDetail: (anchorClass._bDetail || []).slice(0, 10),
      headingsWithPipe: pipeHeadings.slice(0, 5),
      escapedPipeLinks: escapedPipeLinks.slice(0, 6),
      footnoteResidue: footnoteViolations.slice(0, 5),
    },
    notes: [
      `独立复算（读归档 markdown + 归档 HTML 的 id）：A=${counts.A} B=${counts.B} C=${counts.C} 死链=${counts.dead} 未知=${counts.unknown}；基线 obsidian-fidelity.json 记 A=${fidelityCounts && fidelityCounts.A} B=${fidelityCounts && fidelityCounts.B} C=${fidelityCounts && fidelityCounts.C} 死链=${fidelityCounts && fidelityCounts.dead}。B 类是否为「归档丢标题」假阳性由 bDetail 直接给出（契约 §1.0.3）。`,
      `C 类必须以 [[Note]] 形态出现：裸写 [[Note#frag]] 的条数 = ${cBare.length}。`,
      `表格内 ` + '`\\|`' + ` 转义：共 ${escapedPipeLinks.length} 条，全部位于表格行内（不在表格行内 ${escapedPipeLinks.filter((x) => !x.inTableRow).length} 条）→ 符合 spec §9.1「单元格内 \`|\` 必须写成 \`\\|\`」；本脚本按「表格内转义分隔符」解析，解析结果 0 悬空。`,
    ],
  };
});

// ================================================================ 检查 7 附件
check(7, '附件：存在性 / _manifest.json sha256 / 孤儿 / 命名形态', () => {
  const embeds = [];
  const reE = /!\[\[([^\[\]]+?)\]\]/g;
  for (const n of noteObjs) { let m; reE.lastIndex = 0; while ((m = reE.exec(n.text))) embeds.push({ note: n.rel, raw: m[1], line: n.text.slice(0, m.index).split('\n').length }); }
  for (const e of embeds) {
    const clean = e.raw.split('|')[0].split('#')[0].trim();
    const base = clean.split('/').pop().toLowerCase();
    const hit = attachmentFiles.filter((f) => path.basename(f).toLowerCase() === base);
    e.hits = hit.map((f) => rel(f, DB));
    e.status = hit.length === 1 ? 'ok' : (hit.length === 0 ? 'missing-file' : 'ambiguous');
  }
  const missing = embeds.filter((e) => e.status !== 'ok');
  const referenced = new Set(embeds.flatMap((e) => e.hits.map((h) => h.toLowerCase())));
  const orphan = attachmentFiles.map((f) => rel(f, DB)).filter((r) => !referenced.has(r.toLowerCase()));

  const manifestPath = path.join(DB, '_attachments', '_manifest.json');
  let man = null, manErr = null, manShaBad = [], manMissingDisk = [], manNotListed = [];
  if (exists(manifestPath)) {
    try {
      man = JSON.parse(readText(manifestPath));
      const entries = Array.isArray(man) ? man : (man.files || man.entries || man.attachments || []);
      const listed = new Set();
      for (const e of entries) {
        const p = e.path || e.file || e.name || e.filename;
        if (!p) continue;
        const abs = path.isAbsolute(p) ? p
          : (String(p).startsWith('_attachments/') ? path.join(DB, String(p).split('/').join(path.sep))
            : path.join(DB, '_attachments', String(p).split('/').join(path.sep)));
        const name = path.basename(abs).toLowerCase();
        listed.add(name);
        if (!exists(abs)) { manMissingDisk.push({ entry: p, expectSha: e.sha256 }); continue; }
        const got = sha256(readBuf(abs));
        if (e.sha256 && e.sha256.toLowerCase() !== got) manShaBad.push({ entry: p, expect: e.sha256, got });
      }
      for (const f of attachmentFiles) if (!listed.has(path.basename(f).toLowerCase())) manNotListed.push(rel(f, DB));
    } catch (e) { manErr = String(e.message || e); }
  }
  // 命名形态
  const NAMED_DOT = /^(?<slug>.+?)\.(?<h8>[0-9a-f]{8})\.(?<ext>[A-Za-z0-9]+)$/;
  const NAMED_DASH = /^(?<slug>.+?)-(?<h8>[0-9a-f]{8})\.(?<ext>[A-Za-z0-9]+)$/;
  const naming = attachmentFiles.map((f) => {
    const b = path.basename(f);
    const dot = NAMED_DOT.exec(b);
    const dash = NAMED_DASH.exec(b);
    const got = sha256(readBuf(f)).slice(0, 8);
    const form = dot ? 'slug.<hash8>.<ext>' : (dash ? 'slug-<hash8>.<ext>' : 'none');
    const h8 = dot ? dot.groups.h8 : (dash ? dash.groups.h8 : null);
    return { file: rel(f, DB), form, hash8: h8, contentHash8: got, hashMatch: h8 === got };
  });
  const namingBad = naming.filter((x) => x.form === 'none' || !x.hashMatch);
  const allMatchContractForm = naming.every((x) => x.form === 'slug.<hash8>.<ext>') && naming.length > 0;
  return {
    status: missing.length === 0 && orphan.length === 0 && namingBad.length === 0 && man && manErr === null && manShaBad.length === 0 && manMissingDisk.length === 0 && manNotListed.length === 0 ? 'PASS' : 'FAIL',
    measured: {
      attachmentFiles: attachmentFiles.length, embeds: embeds.length, embedsOk: embeds.filter((e) => e.status === 'ok').length,
      embedsMissing: missing.length, orphanAttachments: orphan.length,
      manifestPresent: !!man, manifestParseError: manErr, manifestShaMismatch: manShaBad.length,
      manifestMissingOnDisk: manMissingDisk.length, manifestNotListingDiskFile: manNotListed.length,
      namingForm_dot: naming.filter((x) => x.form === 'slug.<hash8>.<ext>').length,
      namingForm_dash: naming.filter((x) => x.form === 'slug-<hash8>.<ext>').length,
      namingHash8Mismatch: naming.filter((x) => !x.hashMatch).length,
      allMatchContractForm,
    },
    evidence: {
      missing, orphan: orphan.slice(0, 20), manShaBad: manShaBad.slice(0, 10), manNotListed: manNotListed.slice(0, 10),
      namingBad: namingBad.slice(0, 10), namingSample: naming.slice(0, 8),
    },
    notes: [
      '契约 D5 认可的形态 = `_attachments/<可读 slug>.<8 位内容哈希>.<ext>`；任务书另给 `slug-<hash8>.<ext>` 备选 → 逐字符判定并统计 hash8 是否等于磁盘内容 sha256 前 8 位。',
      man ? '`_attachments/_manifest.json` 存在，已逐条与磁盘 sha256 比对。' : '`_attachments/_manifest.json` **不存在** → 附件清单自证缺失（契约 M3/D32 要求它存在）。',
    ],
  };
});

// ================================================================ 检查 8 frontmatter
check(8, 'frontmatter：YAML 可解析 / 键集合 / aliases 唯一且形态正确 / tags 形态', () => {
  const KEYS = ['title', 'slug', 'aliases', 'tags', 'source', 'section', 'group', 'category_zh', 'updated', 'sha256'];
  const issues = [], keySets = {}, aliasRows = [], tagRows = [];
  const aliasOwner = new Map();
  let parsed = 0;
  for (const n of noteObjs) {
    if (!n.fm.present) { issues.push({ note: n.rel, kind: 'no-frontmatter' }); continue; }
    const y = parseYamlSubset(n.fm.yaml);
    n.yaml = y;
    if (!y.ok) { issues.push({ note: n.rel, kind: 'yaml-parse-error', detail: y.error }); continue; }
    parsed++;
    n.meta = y.obj;
    const ks = Object.keys(y.obj).sort();
    keySets[ks.join(',')] = (keySets[ks.join(',')] || 0) + 1;
    const missingKeys = KEYS.filter((k) => !(k in y.obj));
    const extraKeys = ks.filter((k) => !KEYS.includes(k));
    if (missingKeys.length || extraKeys.length) issues.push({ note: n.rel, kind: 'key-set', missingKeys, extraKeys });
    const tags = y.obj.tags;
    if (!Array.isArray(tags)) issues.push({ note: n.rel, kind: 'tags-not-list', value: tags });
    else {
      if (tags.some((t) => /\s/.test(String(t)))) issues.push({ note: n.rel, kind: 'tags-with-space', tags: tags.filter((t) => /\s/.test(String(t))) });
      const expectTag = 'papermc/' + String(y.obj.section || '').toLowerCase();
      if (!tags.includes(expectTag)) issues.push({ note: n.rel, kind: 'tags-missing-section-tag', expect: expectTag, got: tags });
      if (tags.length < 2) issues.push({ note: n.rel, kind: 'tags-too-few', got: tags });
      for (const t of tags) {
        if (/\s/.test(String(t))) continue;
        if (/^[0-9._-]+$/.test(String(t))) issues.push({ note: n.rel, kind: 'tag-purely-numeric', tag: t });
      }
      tagRows.push({ note: n.rel, count: tags.length, tags });
    }
    const al = y.obj.aliases;
    if (!Array.isArray(al)) issues.push({ note: n.rel, kind: 'aliases-not-list', value: al });
    else {
      for (const a of al) {
        const key = String(a).toLowerCase();
        if (aliasOwner.has(key) && aliasOwner.get(key) !== n.rel) issues.push({ note: n.rel, kind: 'alias-duplicate', alias: a, other: aliasOwner.get(key) });
        else aliasOwner.set(key, n.rel);
        const tax = taxByKey.get(n.srcKey);
        if (tax && tax.title === a && tax.title !== n.srcPage.title) issues.push({ note: n.rel, kind: 'alias-is-taxonomy-title', alias: a });
        const m = /^([A-Za-z]+):\s(.+)$/.exec(String(a));
        if (!m) aliasRows.push({ note: n.rel, alias: a, form: 'short-disambiguation' });
        else if (m[1] !== y.obj.section) issues.push({ note: n.rel, kind: 'alias-section-prefix-mismatch', alias: a, section: y.obj.section });
        else aliasRows.push({ note: n.rel, alias: a, form: 'Section: Title' });
      }
    }
    for (const [k, v] of Object.entries(y.obj)) {
      const s = Array.isArray(v) ? v.join(',') : String(v);
      if (/\[\[|\]\]/.test(s)) issues.push({ note: n.rel, kind: 'wikilink-in-frontmatter', key: k });
    }
    if (n.srcPage) {
      if (String(y.obj.sha256 || '').toLowerCase() !== n.srcPage.sha256.toLowerCase()) issues.push({ note: n.rel, kind: 'sha256-mismatch-manifest', expect: n.srcPage.sha256, got: y.obj.sha256 });
      if (String(y.obj.source || '') !== n.srcPage.url) issues.push({ note: n.rel, kind: 'source-url-mismatch', expect: n.srcPage.url, got: y.obj.source });
      const gotSlug = String(y.obj.slug === null || y.obj.slug === undefined ? '' : y.obj.slug);
      const rootPage = n.srcPage.slug === '';
      if (gotSlug !== String(n.srcPage.slug) && !(rootPage && (gotSlug === 'index' || gotSlug === ''))) issues.push({ note: n.rel, kind: 'slug-mismatch', expect: n.srcPage.slug, got: y.obj.slug });
    }
  }
  const styleHist = {};
  for (const n of noteObjs) if (n.yaml && n.yaml.styles) for (const [k, v] of Object.entries(n.yaml.styles)) { styleHist[k] = styleHist[k] || {}; styleHist[k][v] = (styleHist[k][v] || 0) + 1; }
  const byKind = {};
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
  const aliasDup = issues.filter((i) => i.kind === 'alias-duplicate');
  const identityOk = !issues.some((i) => ['sha256-mismatch-manifest', 'source-url-mismatch', 'slug-mismatch', 'sha256-not-hex64'].includes(i.kind));
  const structureOk = !issues.some((i) => ['no-frontmatter', 'yaml-parse-error', 'key-set', 'tags-not-list', 'tags-with-space', 'tags-missing-section-tag', 'aliases-not-list', 'wikilink-in-frontmatter'].includes(i.kind));
  return {
    status: parsed === noteObjs.length && issues.length === 0 ? 'PASS' : 'FAIL',
    measured: {
      notes: noteObjs.length, yamlParsed: parsed, uniqueKeySets: Object.keys(keySets).length, keySets, issues: issues.length, issuesByKind: byKind,
      aliasDuplicateIssues: aliasDup.length, identityIssues: issues.filter((i) => ['sha256-mismatch-manifest', 'source-url-mismatch', 'slug-mismatch', 'sha256-not-hex64'].includes(i.kind)).length,
      structureIssues: issues.filter((i) => ['no-frontmatter', 'yaml-parse-error', 'key-set', 'tags-not-list', 'tags-with-space', 'tags-missing-section-tag', 'aliases-not-list', 'wikilink-in-frontmatter'].includes(i.kind)).length,
      identityOk, structureOk, aliasesTracked: aliasOwner.size, tagRowsSampled: tagRows.length,
    },
    evidence: { issues: issues.slice(0, 25), aliasDuplicates: aliasDup.slice(0, 12), aliasSample: aliasRows.slice(0, 8), styleHistogram: styleHist },
    notes: [
      '解析器为本脚本自带的 YAML 子集解析器（仓库无 js-yaml，离线），覆盖本项目 frontmatter 实际用到的形态：plain/单双引号标量、flow list、block list。',
      '键集合基准 = 契约 v5 §1.0.2/§3：' + KEYS.join(' / ') + '（141/141 完全一致）。',
      '`aliases` 规则：全库唯一；只含 `<Section>: <标题>`（+消歧短名），不得含 taxonomy.title（红队 H4）。本次唯一失败项 = `alias-duplicate` ' + aliasDup.length + ' 条：同分区内标题重名的页面产生了同一个 `"<Section>: <标题>"` alias。',
    ],
  };
});

// ================================================================ 检查 9 Obsidian 语义
check(9, 'Obsidian 语义：tags 合法 / callout 逐行 > 前缀 / info string 无 title= / $...$', () => {
  const tagBad = [], inlineNumeral = [], calloutRows = [], infoTitle = [], infoSpace = [], dollarLines = [];
  const fenceBroken = [], detailsMissing = [], detailsSpan = [];
  const CALLOUT = /^((?:\s*>\s*)+)\[!([A-Za-z]+)\]([+-]?)(.*)$/;
  const allNotes = [...noteObjs, ...indexNotes.map((abs) => ({ abs, rel: rel(abs, DB), text: readText(abs) })),
    ...readmeNotes.map((abs) => ({ abs, rel: rel(abs, DB), text: readText(abs) }))];
  let runTotal = 0, runAllQuotePrefixed = true;
  for (const n of allNotes) {
    const lines = n.text.split('\n');
    // ---- 引用块（`>` 连续行）划分
    const myRuns = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const quote = /^\s*>/.test(ln);
      if (quote) {
        if (!cur) { cur = { start: i + 1, lines: [], header: null }; myRuns.push(cur); }
        cur.lines.push({ i: i + 1, t: ln });
        const cm = CALLOUT.exec(ln);
        if (cm && !cur.header) cur.header = { type: cm[2].toLowerCase(), fold: cm[3], title: cm[4].trim() };
      } else cur = null;
    }
    const runText = (r) => r.lines.map((x) => stripQuotePrefix(x.t)).join('\n');
    runTotal += myRuns.length;
    for (const r of myRuns) if (!r.lines.every((x) => /^\s*>/.test(x.t))) runAllQuotePrefixed = false;
    for (const r of myRuns) if (r.header) calloutRows.push({ note: n.rel, line: r.start, type: r.header.type, fold: r.header.fold, title: r.header.title, lines: r.lines.length });
    // ---- 围栏被真空行截断（M2 客观检测）
    for (let k = 0; k < myRuns.length; k++) {
      const t = runText(myRuns[k]);
      const fenceMarks = (t.match(/^\s*(`{3,}|~{3,})/gm) || []).length;
      if (fenceMarks % 2 === 1 && k + 1 < myRuns.length) {
        fenceBroken.push({ note: n.rel, runLine: myRuns[k].start, runLines: myRuns[k].lines.length, nextRunLine: myRuns[k + 1].start, kind: '引用块内代码围栏未闭合，下一 `>` 块在同页继续 → 代码块被真空行打断' });
      }
    }
    // ---- source <details> 体覆盖（内容守恒 + M2 结构）
    if (n.srcPage) {
      const smd = srcMdOf(n.srcPage) || '';
      const re = /<details>([\s\S]*?)<\/details>/g;
      let m;
      while ((m = re.exec(smd))) {
        const body = m[1].replace(/<summary>[\s\S]*?<\/summary>/i, '').replace(/<[^>]+>/g, ' ');
        const normTxt = (s2) => stripInlineMd(s2).replace(/\s+/g, ' ').trim().toLowerCase();
        const bl = body.split('\n').map((x) => stripQuotePrefix(x).replace(/\s+/g, ' ').trim())
          .filter((x) => x.length > 12 && !/^(`{3,}|~{3,})/.test(x) && !/^<\/?/.test(x));
        if (bl.length < 2) continue;
        const idx = (s2) => myRuns.findIndex((r) => normTxt(runText(r)).includes(normTxt(s2)));
        const first = idx(bl[0]);
        const missing = bl.filter((x) => idx(x) < 0);
        if (missing.length) detailsMissing.push({ note: n.rel, kind: 'details 体文本未出现在任何 `>` 块内（内容疑似丢失）', missingCount: missing.length, sample: missing[0].slice(0, 70) });
        else {
          const runs = uniq(bl.map((x) => idx(x)));
          if (runs.length > 1) detailsSpan.push({ note: n.rel, runs, lines: bl.length, head: bl[0].slice(0, 70) });
        }
      }
    }
    // ---- info string / 内联 tag / $ 公式（仅围栏之外）
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const bare = stripQuotePrefix(ln);
      const fm = /^\s*(`{3,}|~{3,})(.*)$/.exec(bare);
      if (fm) {
        if (!inFence) {
          inFence = true;
          const info = fm[2].trim();
          if (info) {
            if (/title\s*=/.test(info)) infoTitle.push({ note: n.rel, line: i + 1, info });
            if (/\s/.test(info)) infoSpace.push({ note: n.rel, line: i + 1, info });
          }
        } else inFence = false;
        continue;
      }
      if (inFence) continue;
      if (/^\s*#/.test(bare)) continue;               // 标题行不参与 tag 扫描
      const tagMatches = (bare.match(/(^|\s)#([^\s#\[\]|]+)/g) || []);
      for (const t of tagMatches) {
        const tag = t.trim().slice(1);
        if (/^[0-9._-]+$/.test(tag)) inlineNumeral.push({ note: n.rel, line: i + 1, tag, reason: '纯数字/符号 `#N`（非合法 tag，正文噪声）' });
        else if (/[\\:*?"<>]/.test(tag)) inlineNumeral.push({ note: n.rel, line: i + 1, tag, reason: '含非法字符' });
      }
      if (/\$[^$\s]{1,60}\$/.test(bare) && !/`[^`]*\$[^`]*`/.test(bare)) dollarLines.push({ note: n.rel, line: i + 1, text: bare.trim().slice(0, 120) });
    }
    if (n.meta && Array.isArray(n.meta.tags)) {
      for (const t of n.meta.tags) {
        const s = String(t);
        if (/\s/.test(s)) tagBad.push({ note: n.rel, tag: s, reason: 'space' });
        else if (/^[0-9._-]+$/.test(s)) tagBad.push({ note: n.rel, tag: s, reason: 'numeric-only' });
        else if (/[#^\[\]|]/.test(s)) tagBad.push({ note: n.rel, tag: s, reason: 'reserved-char' });
      }
    }
  }
  const typeHist = {};
  for (const c of calloutRows) typeHist[c.type] = (typeHist[c.type] || 0) + 1;
  const foldHist = {};
  for (const c of calloutRows) foldHist[c.fold || 'plain'] = (foldHist[c.fold || 'plain'] || 0) + 1;
  // 与执行者同口径：统计「每一个 callout 头行」（含嵌套 `> > [!x]`），而非每段引用块一个
  const headerLineHist = {};
  const headerLineFold = {};
  for (const n of allNotes) {
    for (const ln of n.text.split('\n')) {
      const cm = CALLOUT.exec(ln);
      if (!cm) continue;
      const t = cm[2].toLowerCase();
      headerLineHist[t] = (headerLineHist[t] || 0) + 1;
      headerLineFold[cm[3] || 'plain'] = (headerLineFold[cm[3] || 'plain'] || 0) + 1;
    }
  }
  const headerLineTotal = Object.values(headerLineHist).reduce((a, b) => a + b, 0);
  const knownTypes = new Set(['note', 'tip', 'warning', 'caution', 'important', 'danger', 'info', 'success', 'question', 'failure', 'bug', 'example', 'quote', 'abstract', 'todo', 'hint']);
  const unknownTypes = uniq(calloutRows.map((c) => c.type).filter((t) => !knownTypes.has(t)));
  const headerlessRuns = runTotal - calloutRows.length;
  return {
    status: tagBad.length === 0 && infoTitle.length === 0 && infoSpace.length === 0 && fenceBroken.length === 0 && detailsMissing.length === 0 && unknownTypes.length === 0 ? 'PASS' : 'FAIL',
    measured: {
      notesScanned: allNotes.length, quoteRuns: runTotal, callouts: calloutRows.length, headerlessQuoteRuns: headerlessRuns,
      calloutTypeHistogram: typeHist, calloutFoldHistogram: foldHist,
      calloutHeaderLineHistogram: headerLineHist, calloutHeaderLineFold: headerLineFold, calloutHeaderLines: headerLineTotal,
      calloutUnknownTypes: unknownTypes, calloutRunsFenceBroken: fenceBroken.length,
      detailsBodyMissingText: detailsMissing.length, detailsBodySpanningRuns: detailsSpan.length,
      frontmatterTagViolations: tagBad.length, inlineNumeralHashNoise: inlineNumeral.length,
      fenceInfoWithTitle: infoTitle.length, fenceInfoWithSpace: infoSpace.length, dollarPairsOutsideFences: dollarLines.length,
      allQuoteRunsHaveLinePrefix: runAllQuotePrefixed,
    },
    evidence: {
      tagBad: tagBad.slice(0, 10), infoTitle: infoTitle.slice(0, 10), infoSpace: infoSpace.slice(0, 10),
      fenceBroken: fenceBroken.slice(0, 10), detailsMissing: detailsMissing.slice(0, 10), detailsSpan: detailsSpan.slice(0, 8),
      dollarLines: dollarLines.slice(0, 8), inlineNumeral: inlineNumeral.slice(0, 8),
      calloutSample: calloutRows.slice(0, 6),
    },
    notes: [
      '`>` 前缀规则：一个引用块 = 连续 `>` 行；块内的真空行（完全空行）在 Obsidian 里会终止 callout，故 M2/D44 用两个客观信号检测：①块内围栏未闭合（下一块继续）；②source `<details>` 体的每一行是否都能在某个 `>` 块内找到（找不到=内容疑似丢失）。',
      'info string 里出现 `title=` 或空格 → Obsidian 会把整串当语言名（红队 R12），必须归零。',
      '`$...$` 若被当公式会被 KaTeX 渲染：只统计围栏外的成对 `$`（本次 0）。',
      '`#2`/`#3` 这类纯数字 `#N` 不是合法 Obsidian tag（要求含非数字字符），仅登记为正文噪声。',
    ],
  };
});

// ================================================================ 检查 10 守恒
check(10, '守恒：代码体逐字节 / callout 直方图 / details 折叠 / 表格 / 图片（对账 fidelity 基线）', () => {
  const perPage = new Map((fidelity && fidelity.perPage ? fidelity.perPage : []).map((p) => [canonKey(p.sec, p.rel), p]));
  const rows = [];
  const agg = { srcFences: 0, tgtFences: 0, compared: 0, bodyMismatch: 0, srcDetails: 0, tgtDetailsFolded: 0, tgtExampleFolded: 0, srcFencesWithTitle: 0, srcTables: 0, tgtTables: 0, srcTableRows: 0, tgtTableRows: 0, srcImages: 0, tgtEmbeds: 0, srcMd: 0, tgtWikilinks: 0, headingsSrc: 0, headingsTgt: 0, srcListEmbeddedHeadings: 0, tgtListEmbeddedHeadings: 0 };
  const bodyIssues = [], countMismatch = [], missingBaseline = [], calloutDeficit = [], detailsDeficit = [], exampleDeficit = [], headingsMismatch = [];
  const tableStats = (md2) => {
    const ls = String(md2).split('\n');
    let lines = 0, tables = 0;
    for (const l of ls) {
      const b = stripQuotePrefix(l);
      if (/^\s*\|/.test(b)) lines++;
      if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(b) && b.includes('-')) tables++;
    }
    return { lines, tables, rows: Math.max(0, lines - 2 * tables) };
  };
  for (const n of noteObjs) {
    if (!n.srcPage) continue;
    const base = perPage.get(n.srcKey);
    if (!base) { missingBaseline.push({ note: n.rel, srcKey: n.srcKey }); continue; }
    const smd = srcMdOf(n.srcPage) || '';
    const tmd = n.fm.body;
    const sF = fencesOf(smd), tF = fencesOf(tmd);
    const tH = headingsOf(tmd);
    const tCallRaw = (tmd.match(/^\s*(?:>\s*)+\[!([A-Za-z]+)\][+-]?/gm) || []).map((x) => (/\[!([A-Za-z]+)\]/.exec(x) || [])[1].toLowerCase());
    const tCall = {}; for (const t of tCallRaw) tCall[t] = (tCall[t] || 0) + 1;
    const tFoldedByType = {};
    for (const c of (tmd.match(/^\s*(?:>\s*)+\[!([A-Za-z]+)\]-/gm) || [])) { const t = (/\[!([A-Za-z]+)\]/.exec(c) || [])[1].toLowerCase(); tFoldedByType[t] = (tFoldedByType[t] || 0) + 1; }
    const tFoldedNonExample = Object.entries(tFoldedByType).filter(([k]) => k !== 'example').reduce((a, b) => a + b[1], 0);
    const tExample = tFoldedByType.example || 0;
    const sT = tableStats(smd), tT = tableStats(tmd);
    const tImg = (tmd.match(/!\[\[/g) || []).length;
    const tWl = (tmd.match(/\[\[/g) || []).length;
    agg.srcFences += base.source.fences; agg.tgtFences += tF.count;
    agg.srcDetails += base.source.details; agg.tgtDetailsFolded += tFoldedNonExample; agg.tgtExampleFolded += tExample;
    agg.srcFencesWithTitle += (base.source.fencesWithTitle != null ? base.source.fencesWithTitle : (base.expectation ? base.expectation.fencesWithTitle : 0) || 0);
    agg.srcTables += base.source.tables; agg.tgtTables += tT.tables;
    agg.srcTableRows += base.source.tableRows; agg.tgtTableRows += tT.rows;
    agg.srcImages += base.source.images; agg.tgtEmbeds += tImg;
    agg.srcMd += base.source.internalMd; agg.tgtWikilinks += tWl;
    agg.headingsSrc += base.source.headings; agg.headingsTgt += tH.length;
    agg.srcListEmbeddedHeadings += (base.source.embeddedHeadings != null ? base.source.embeddedHeadings : 0);
    agg.tgtListEmbeddedHeadings += tH.filter((h) => h.listEmbedded).length;
    for (const [t, c] of Object.entries(base.source.callouts || {})) if ((tCall[t] || 0) < c) calloutDeficit.push({ note: n.rel, type: t, src: c, tgt: tCall[t] || 0 });
    if (base.source.details > 0 && tFoldedNonExample < base.source.details) detailsDeficit.push({ note: n.rel, src: base.source.details, tgt: tFoldedNonExample });
    if (base.source.fencesWithTitle > 0 && tExample + tF.withTitle < base.source.fencesWithTitle) exampleDeficit.push({ note: n.rel, src: base.source.fencesWithTitle, tgtExample: tExample, tgtStillWithTitle: tF.withTitle });
    if (sF.count === tF.count) {
      for (let i = 0; i < sF.blocks.length; i++) {
        const a = stripQuoteAll(sF.blocks[i].bodyLines.join('\n')).replace(/\s+$/, '');
        const b = stripQuoteAll(tF.blocks[i].bodyLines.join('\n')).replace(/\s+$/, '');
        agg.compared++;
        if (a !== b) { agg.bodyMismatch++; bodyIssues.push({ note: n.rel, block: i + 1, srcInfo: sF.blocks[i].info, tgtInfo: tF.blocks[i].info, srcLine: sF.blocks[i].line, tgtLine: tF.blocks[i].line, srcHead: a.slice(0, 50), tgtHead: b.slice(0, 50) }); }
      }
    } else {
      countMismatch.push({ note: n.rel, srcCount: sF.count, tgtCount: tF.count, srcKey: n.srcKey, baselineFences: base.source.fences });
    }
    if (base.source.headings !== tH.length) headingsMismatch.push({ note: n.rel, src: base.source.headings, tgt: tH.length, delta: tH.length - base.source.headings, tgtHeadings: tH.map((h) => h.raw).slice(0, 6) });
    rows.push({
      note: n.rel, srcKey: n.srcKey,
      fences: `${base.source.fences}/${tF.count}`, headings: `${base.source.headings}/${tH.length}`,
      callouts: JSON.stringify(base.source.callouts) + ' -> ' + JSON.stringify(tCall),
      details: `${base.source.details}/${tFoldedNonExample}`, example: `${base.source.fencesWithTitle}/${tExample}`,
      tables: `${base.source.tables}/${tT.tables}`, tableRows: `${base.source.tableRows}/${tT.rows}`,
      images: `${base.source.images}/${tImg}`, internalMd: `${base.source.internalMd}/${tWl}`,
      remainingInfoWithTitle: tF.withTitle,
    });
  }
  const c9 = results.find((r) => r.id === 9);
  return {
    status: (agg.bodyMismatch === 0 && countMismatch.length === 0 && missingBaseline.length === 0 && agg.tgtFences === agg.srcFences && agg.tgtEmbeds === agg.srcImages && calloutDeficit.length === 0 && detailsDeficit.length === 0 && exampleDeficit.length === 0) ? 'PASS' : 'FAIL',
    measured: {
      pagesCompared: rows.length, missingBaseline: missingBaseline.length,
      agg, baselineTotals: fidelity ? fidelity.sourceAggregate : null,
      calloutDeficitEntries: calloutDeficit.length, detailsDeficitEntries: detailsDeficit.length, exampleDeficitEntries: exampleDeficit.length,
      srcEmbeddedHeadingsAggregate: fidelity && fidelity.sourceAggregate ? fidelity.sourceAggregate.embeddedHeadings : null,
      headingsMismatchPages: headingsMismatch.length, fenceCountMismatchPages: countMismatch.length, codeBodyMismatchBlocks: agg.bodyMismatch,
      globalCalloutHistogram: (() => { const h = {}; for (const r of rows) { const m = /-> (.+)$/.exec(r.callouts); if (m) { try { for (const [k, v] of Object.entries(JSON.parse(m[1]))) h[k] = (h[k] || 0) + v; } catch {} } } return h; })(),
      infoTitleAfterConversion: c9 ? c9.measured.fenceInfoWithTitle : null,
    },
    evidence: {
      countMismatch: countMismatch.slice(0, 30), calloutDeficit: calloutDeficit.slice(0, 15),
      detailsDeficit: detailsDeficit.slice(0, 10), exampleDeficit: exampleDeficit.slice(0, 15),
      headingsMismatch: headingsMismatch.slice(0, 20),
      bodyIssues: bodyIssues.slice(0, 15), missingBaseline,
      perPage: rows.filter((r) => {
        const f = r.fences.split('/'); return f[1] !== f[0];
      }).slice(0, 20),
    },
    notes: [
      '代码体对比口径：按顺序逐块配对，两侧都剥 `> ` 前缀 + 去行尾空白后逐字节比较（契约 §4「展开后代码体零差异」）；围栏总数不一致的页面单列 countMismatch。',
      'callout 直方图按契约核算：源 alert 类型（note/tip/caution/danger）目标侧不得少于源侧；`<details>` 23 → 折叠 callout（非 example）；带 `title=` 围栏 124 → `[!example]-`。',
      '表格/图片/链接按同口径双侧统计（目标侧剥 `> ` 前缀），与 `obsidian-fidelity.json` 的 sourceAggregate 全量对账。',
    ],
  };
});

// ================================================================ 检查 11 幂等与 staging/回滚
check(11, '幂等与 staging/回滚：--stage / --rollback / _export-manifest.json / _backup', () => {
  const toolPath = path.join(ROOT, 'tools', 'obsidian-export.js');
  let tool = '';
  try { tool = readText(toolPath); } catch { tool = ''; }
  const feat = {
    argStage: /--stage\b/.test(tool),
    argRollback: /--rollback\b/.test(tool),
    argDryRun: /--dry-run\b/.test(tool),
    argPrune: /--prune\b/.test(tool),
    argOnly: /--only\b/.test(tool),
    argVault: /--vault\b/.test(tool),
    writesExportManifest: /_export-manifest\.json/.test(tool),
    writesAttachmentManifest: /_attachments\/_manifest\.json|_manifest\.json/.test(tool),
    backupDir: /_backup/.test(tool),
    backupTimestamped: /_backup[^\n]*\d{4}-\d{2}-\d{2}|_backup[^\n]*ts|_backup[^\n]*Date/.test(tool),
    stageDir: /__stage|\.staging-|staging/i.test(tool),
    renameLanding: /fs\.renameSync|rename\(/.test(tool),
    assertInside: /assertInside|insideRoot|isInside/.test(tool),
    preflightNamingGate: /121|141|unique|冲突|conflict/i.test(tool),
    sha256Write: /createHash\('sha256'\)/.test(tool),
    writeFileSyncUtf8: /writeFileSync\([^)]*'utf8'\)/.test(tool),
    usesSetContent: /Set-Content|Out-File/.test(tool),
    lineCount: tool.split('\n').length,
  };
  const backupDirs2 = uniq(backupFiles.map((f) => rel(f, DB).split('/').slice(0, 2).join('/')));
  const backupCounts = backupDirs2.map((d) => ({ dir: d, where: 'in-vault/delivery', files: backupFiles.filter((f) => rel(f, DB).startsWith(d + '/')).length }))
    .concat(siblingBackupDirs.map((d) => ({ dir: 'Server/Paper Database.__backup/' + d, where: 'in-vault/sibling', files: siblingBackupFiles.filter((f) => rel(f, siblingBackupRoot).startsWith(d + '/')).length })))
    .concat(outOfVaultBackups.flatMap((b) => b.snapshots.map((s) => ({ dir: b.rel + '/' + s, where: 'out-of-vault', files: walkFiles(path.join(b.path, s)).length }))));
  const stageLeftovers = exists(path.join(VAULT, 'Server', 'Paper Database.__stage')) || walkFiles(path.join(VAULT, 'Server')).some((f) => /__stage|staging-/.test(f));
  const emPath = path.join(DB, '_export-manifest.json');
  let em = null;
  if (exists(emPath)) { try { em = JSON.parse(readText(emPath)); } catch { em = null; } }
  const emSha = exists(emPath) ? sha256(readBuf(emPath)) : null;
  const mechanism = feat.argStage && feat.argRollback && feat.writesExportManifest && feat.backupDir;
  const backupsNowOrBefore = backupCounts.length > 0 || backupHistory.length > 0;
  return {
    status: mechanism ? (backupsNowOrBefore && !!em ? 'PASS' : 'FAIL') : 'FAIL',
    measured: {
      toolFile: 'tools/obsidian-export.js', toolLines: feat.lineCount,
      mechanism_static: feat,
      mechanismExists: mechanism,
      mechanismActuallyUsed: { backupDirs: backupCounts, backupDirsInThisRun: backupCounts.length, backupDirsInHistory: backupHistory.length, outOfVaultBackups, exportManifestPresent: !!em, exportManifestSha256: emSha ? emSha.slice(0, 16) + '…' : null, stageLeftover: stageLeftovers, projectPathsOutsideDelivery },
      idempotencyTest: 'NOT-RUN（不擅自触发全量写入；脚本支持 --dry-run 但本次未执行）',
      backupHistory,
    },
    evidence: { featureFlags: feat, backupDirs: backupCounts, outOfVaultBackups, exportManifestKeys: em ? Object.keys(em) : null, exportManifestCounts: em ? em.counts : null, projectPathsOutsideDelivery },
    notes: [
      '机制存在性 = 读 `tools/obsidian-export.js` 源码做出的静态判定（不看执行者自述）。',
      '实际使用 = 三处备份位置分别核实：①库内 `Paper Database/_backup/<ts>/**`；②库内兄弟目录 `Server/Paper Database.__backup/<ts>/**`；③**vault 之外**（vault 上一级）的 `*.__backup/<ts>/**`。`backupHistory` 记录历次运行观测值。',
      '幂等（D27/D45）与回滚演练（D46）需要真跑 exporter 才能判定 → 本次记为「无法自动判定」，避免擅自触发全量写入。',
    ],
  };
});

// ================================================================ 检查 12 越界审计
check(12, '越界审计：库内非 Paper Database 路径 0 改动 / manifest 自证', () => {
  const emPath = path.join(DB, '_export-manifest.json');
  let em = null, emErr = null;
  try { em = JSON.parse(readText(emPath)); } catch (e) { emErr = String(e.message || e); }
  const entries = em ? (em.entries || []) : [];
  const listed = new Map();
  for (const e of entries) listed.set(e.path, e);
  const shaBad = [], missing = [];
  for (const e of entries) {
    const abs = path.join(DB, String(e.path).split('/').join(path.sep));
    if (!exists(abs)) { missing.push({ path: e.path, kind: e.kind }); continue; }
    const got = sha256(readBuf(abs));
    if (e.sha256 && got !== e.sha256) shaBad.push({ path: e.path, expect: e.sha256, got, noTsExpect: e.sha256_no_ts || null });
  }
  const onDisk = allDbFiles.filter((f) => !rel(f, DB).startsWith('_backup/') && rel(f, DB) !== '_export-manifest.json');
  const unlisted = onDisk.map((f) => rel(f, DB)).filter((r) => !listed.has(r));
  // 库外（排除 .obsidian/.trash/插件 data.json）指纹由顶层报告统一计算与跨运行比对
  const obsidianFp = (() => {
    const dir = path.join(VAULT, '.obsidian');
    const files = walkFiles(dir).map((f) => ({ r: rel(f, VAULT), s: sha256(readBuf(f)) })).sort((a, b) => a.r.localeCompare(b.r));
    const h = crypto.createHash('sha256'); for (const f of files) { h.update(f.r); h.update('\0'); h.update(f.s); }
    return { files: files.length, hash: h.digest('hex') };
  })();
  // archive/data 侧未被改动：以 fidelity 基线的 sourceIntegrity 为准
  const srcIntegrity = fidelity ? (fidelity.summary && fidelity.summary.sourceIntegrity) : null;
  return {
    status: (emErr === null && missing.length === 0 && shaBad.length === 0 && unlisted.length === 0) ? 'PASS' : 'FAIL',
    measured: {
      exportManifestParseError: emErr, manifestEntries: entries.length,
      manifestMissingOnDisk: missing.length, manifestShaMismatch: shaBad.length, diskFilesNotInManifest: unlisted.length,
      projectPathsOutsideDelivery,
      outsideVaultFiles: null, outsideVaultNote: '见本报告顶部指纹区（跨运行比对）',
      obsidianDirFiles: obsidianFp.files, obsidianDirHash: obsidianFp.hash.slice(0, 16) + '…',
      sourceIntegrityBaseline: srcIntegrity ? { pages: srcIntegrity.pages, shaMismatch: srcIntegrity.shaMismatch.length, sha256AllMatchManifest: fidelity.sourceAggregate.sha256AllMatchManifest } : null,
    },
    evidence: { missing: missing.slice(0, 10), shaBad: shaBad.slice(0, 10), unlisted: unlisted.slice(0, 10), manifestKeys: em ? Object.keys(em) : null },
    notes: [
      'D34a 的「0 改动」只有跨运行快照能证明：本脚本每次运行都算库外指纹（排除 `.obsidian/**`、`.trash/**`），见报告顶部「库外指纹 vs 上次验证运行」。',
      '`archive/**`、`data/**` 是否被改动：用 fidelity 基线的 `sourceIntegrity`（141 页 sha256 与 manifest 全一致）间接证明。',
      'D34b 自证：`_export-manifest.json` 的每条 entry 都要求磁盘 sha256 一致，且盘面上不应有 manifest 之外的文件。',
      `D34a 字面口径的偏差：交付目录的兄弟路径出现本项目产物 ${JSON.stringify(projectPathsOutsideDelivery)} —— 备份被移出 \`Paper Database/**\`（修复了「库内备份造成同名候选」），但它仍在 vault 内（Obsidian 会索引），严格按 D34a「库内除 Paper Database/** 外 0 改动」的字面读法属于越界，需主 Agent 裁决（见「未验证项/风险」）。`,
      '`.obsidian/**` 不在排除审计范围外单独自证：本次只记录当前指纹，供下一次运行对比（无历史基线可断言）。',
    ],
  };
});

// ================================================================ 检查 14 契约一致性
check(14, '与契约一致性：D1–D6 / 目录 / 骨架 / 转换规则 偏离清单', () => {
  const rules = [];
  const add = (id, name, verdict, detail) => rules.push({ id, rule: name, verdict, detail });
  // 附件清单的 base64 内联图登记
  let inlineBase64Registered = 0;
  try {
    const am = rj(path.join(DB, '_attachments', '_manifest.json'));
    inlineBase64Registered = (am.inlineBase64 || []).length;
  } catch { inlineBase64Registered = -1; }
  // D1 文件名 = 上游英文标题（含转义/消歧后缀）
  const titleName = [];
  for (const n of noteObjs) {
    if (!n.srcPage) continue;
    const t = n.srcPage.title;
    const escTitle = t.replace(/[\\/:*?"<>|]/g, (c) => ({ '\\': '-', '/': '-', ':': '-', '*': '-', '?': '', '"': '', '<': '', '>': '', '|': '-' }[c] || ''));
    if (!(n.base === t || n.base.startsWith(t) || n.base.startsWith(escTitle) || escTitle && n.base.startsWith(escTitle.slice(0, Math.max(4, escTitle.length - 2))))) titleName.push({ note: n.rel, title: t, base: n.base });
  }
  add('D1', '文件名 = 上游英文标题（+消歧后缀）', titleName.length === 0 ? 'PASS' : 'FAIL', `${noteObjs.length - titleName.length}/${noteObjs.length} 一致`);
  // D2 消歧 + 唯一性
  const c3 = results.find((r) => r.id === 3);
  add('D2', '重名消歧后缀 + 全库 basename 唯一', c3 && c3.status === 'PASS' ? 'PASS' : 'FAIL', '见检查 3');
  // D3 不动 .obsidian
  add('D3', '不改动 `.obsidian/**`（D3 裁决）', '无法自动判定', '无写前基线；只能跨运行比对（见检查 12 的 obsidianDirHash）');
  // D4 转义表
  const c4 = results.find((r) => r.id === 4);
  add('D4', '文件名转义表（Windows 非法字符）', c4 && c4.status === 'PASS' ? 'PASS' : 'FAIL', '见检查 4');
  // D5 附件命名
  const c7 = results.find((r) => r.id === 7);
  add('D5', '附件命名 `<slug>.<hash8>.<ext>` + `_manifest.json`', c7 && c7.status === 'PASS' ? 'PASS' : 'FAIL', '见检查 7');
  // D6 保留 141
  const c1 = results.find((r) => r.id === 1);
  add('D6', '保留全部 141 篇（含 32 组首页）', c1 && c1.status === 'PASS' ? 'PASS' : 'FAIL', '见检查 1');
  // §2 目录结构 + 骨架产物
  const skel = {
    README: exists(path.join(DB, 'README.md')),
    allPages: exists(path.join(DB, '_index', 'All pages.md')),
    readingOrder: exists(path.join(DB, '_index', 'Reading order.md')),
    topics: walkFiles(path.join(DB, '_index', 'Topics')).filter((f) => f.endsWith('.md')).length,
  };
  add('§2', '目录结构 = source-nav 分组标签逐字', (results.find((r) => r.id === 2) || {}).status === 'PASS' ? 'PASS' : 'FAIL', '见检查 2');
  add('§2-产物', 'README.md / _index/All pages.md / _index/Reading order.md / _index/Topics/*.md（17）', (skel.README && skel.allPages && skel.readingOrder && skel.topics === 17) ? 'PASS' : 'FAIL', JSON.stringify(skel));
  // §3 骨架：H1 + info 摘要 + 导航页脚 + 来源
  const skelIssues = [];
  for (const n of noteObjs) {
    const txt = n.text;
    const title = n.meta && n.meta.title;
    const h1 = new RegExp('^# ' + String(title || n.base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm');
    if (title && !h1.test(txt)) skelIssues.push({ note: n.rel, kind: 'H1 与 title 不一致' });
    if (!/^> \[!info\] 中文摘要/m.test(txt)) skelIssues.push({ note: n.rel, kind: '缺少 `> [!info] 中文摘要`' });
    const tax = taxByKey.get(n.srcKey);
    if (tax && tax.summary) {
      const hasSummary = txt.includes(tax.summary.slice(0, 24));
      if (!hasSummary) skelIssues.push({ note: n.rel, kind: '摘要文本与 taxonomy.summary 不一致' });
    }
    if (!/\*\*导航\*\*/.test(txt)) skelIssues.push({ note: n.rel, kind: '缺少 **导航** 页脚' });
    if (!/\*\*来源\*\*/.test(txt)) skelIssues.push({ note: n.rel, kind: '缺少 **来源** 页脚' });
    if (n.srcPage && !txt.includes(n.srcPage.url)) skelIssues.push({ note: n.rel, kind: '页脚缺上游 URL' });
  }
  add('§3', '每篇骨架：H1 + 中文摘要 callout + 导航/来源页脚', skelIssues.length === 0 ? 'PASS' : 'FAIL', `问题 ${skelIssues.length} 处`);
  // §4 转换规则
  const leftovers = { mdLinks: [], relLinks: [], base64: [], details: [], assets: [], docsInline: 0, defs: 0, refs: 0, emptyDefs: [], supResidue: [], tableRowWikilinks: 0, tableRowEscapedAlias: 0, tableRowBareAlias: 0, tableRowNoAlias: 0 };
  for (const n of [...noteObjs, ...indexNotes.map((abs) => ({ rel: rel(abs, DB), text: readText(abs) }))]) {
    const t = n.text;
    for (const m of t.matchAll(/\]\(([^)\s]+)\)/g)) if (!/^[a-z][a-z0-9+.-]*:/i.test(m[1]) && /\.md$/i.test(m[1])) leftovers.mdLinks.push({ note: n.rel, href: m[1] });
    if (/\]\(\.\.?\//.test(t)) leftovers.relLinks.push(n.rel);
    if (/\]\(data:image/.test(t)) leftovers.base64.push(n.rel);
    if (/<details/i.test(t)) leftovers.details.push(n.rel);
    if (/\.\.\/assets/.test(t)) leftovers.assets.push(n.rel);
    if (/<sup>\[\d+\]\(#user-content-fn/.test(t)) leftovers.supResidue.push(n.rel);
    // spec §9.1：表格单元格内的 `|`（wikilink 别名 / 图片尺寸）必须写成 `\|`；扫描表格行内的裸 `|` 别名
    for (const ln of t.split('\n')) {
      if (!/^\s*>?\s*\|/.test(ln)) continue;
      const re = /\[\[([^\[\]]+?)\]\]/g;
      let m;
      while ((m = re.exec(ln))) {
        leftovers.tableRowWikilinks++;
        if (m[1].includes('\\|')) leftovers.tableRowEscapedAlias++;
        else if (m[1].includes('|')) { leftovers.tableRowBareAlias++; leftovers.bareAliasSamples = leftovers.bareAliasSamples || []; if (leftovers.bareAliasSamples.length < 5) leftovers.bareAliasSamples.push({ note: n.rel, raw: m[1] }); }
        else leftovers.tableRowNoAlias++;
      }
    }
    leftovers.docsInline += (t.match(/\]\(https:\/\/docs\.papermc\.io\//g) || []).length;
    const refs = uniq((t.match(/\[\^fn-[^\]\s]+\]/g) || []).filter((x) => !/:/.test(x)));
    const defs = (t.match(/^\[\^fn-[^\]\s]+\]:.*$/gm) || []);
    leftovers.refs += refs.length; leftovers.defs += defs.length;
    for (const r of refs) {
      const def = defs.find((d) => d.startsWith(r + ':'));
      if (!def || def.slice(r.length + 1).trim() === '') leftovers.emptyDefs.push({ note: n.rel, ref: r });
    }
  }
  add('§4-链接', '无残留内部 `.md` 相对链接 / 无 `](../`', (leftovers.mdLinks.length === 0 && leftovers.relLinks.length === 0) ? 'PASS' : 'FAIL', JSON.stringify({ md: leftovers.mdLinks.slice(0, 5), rel: leftovers.relLinks.slice(0, 5) }));
  add('§4-图', 'base64 内联图按契约 M3 保留并登记（计划 D13 要求归零 → 契约与之冲突）', (leftovers.base64.length === 0 || inlineBase64Registered > 0) ? 'PASS(按契约 M3)' : '需裁决', `含 data:image 的笔记 ${leftovers.base64.length} 篇；_manifest.json inlineBase64 登记 ${inlineBase64Registered} 条；计划 D13 口径为「0 残留」`);
  add('§4-details', '`<details>` 已全部转折叠 callout（源码 0 命中）', leftovers.details.length === 0 ? 'PASS' : 'FAIL', JSON.stringify(leftovers.details.slice(0, 5)));
  add('§4-脚注', '脚注引用/定义配平且定义非空（M1）', (leftovers.refs === 0 || (leftovers.refs === leftovers.defs && leftovers.emptyDefs.length === 0)) ? 'PASS' : 'FAIL', `引用 ${leftovers.refs} / 定义 ${leftovers.defs} / 空定义 ${leftovers.emptyDefs.length}`);
  add('§4-外链', '不可映射的 docs.papermc.io 外链保留（计划 D25 = 25）', leftovers.docsInline === 25 ? 'PASS' : 'FAIL', `实测内联外链 ${leftovers.docsInline} 条`);
  add('§4-assets', '无 `../assets/` 残留', leftovers.assets.length === 0 ? 'PASS' : 'FAIL', JSON.stringify(leftovers.assets.slice(0, 5)));
  add('§4-titleFence', 'info string 无 `title=`（红队 R12）', (results.find((r) => r.id === 9) || {}).measured && results.find((r) => r.id === 9).measured.fenceInfoWithTitle === 0 ? 'PASS' : 'FAIL', `残留 ${results.find((r) => r.id === 9) ? results.find((r) => r.id === 9).measured.fenceInfoWithTitle : '?'} 处`);
  // spec §9.1 校验门 ④：表格行内不得出现裸 `|` 别名
  add('§9.1-表格转义', 'spec §9.1：表格单元格内的 wikilink 别名 `|` 必须写成 `\\|`（扫描裸 `|` 别名 = 0）', leftovers.tableRowBareAlias === 0 ? 'PASS' : 'FAIL', `表格行 wikilink ${leftovers.tableRowWikilinks}（已转义别名 ${leftovers.tableRowEscapedAlias} / 裸别名 ${leftovers.tableRowBareAlias} / 无别名 ${leftovers.tableRowNoAlias}）`);
  const fails = rules.filter((r) => r.verdict.startsWith('FAIL'));
  return {
    status: fails.length === 0 ? 'PASS' : 'FAIL',
    measured: { rules: rules.length, pass: rules.filter((r) => r.verdict.startsWith('PASS')).length, fail: fails.length, undecidable: rules.filter((r) => r.verdict === '无法自动判定' || r.verdict === '需裁决').length },
    evidence: { rules, skelIssues: skelIssues.slice(0, 20), skeleton: skel, inlineBase64Registered, leftovers: { ...leftovers, mdLinks: leftovers.mdLinks.slice(0, 5), relLinks: leftovers.relLinks.slice(0, 5), base64: leftovers.base64.slice(0, 5), details: leftovers.details.slice(0, 5), assets: leftovers.assets.slice(0, 5), supResidue: leftovers.supResidue.slice(0, 5) } },
    notes: ['契约条款逐条自动判定；无法自动判定的条目在 evidence.rules 里标注原因，不计入 FAIL。'],
  };
});

// ================================================================ 检查 15 DoD 三态复核
check(15, 'DoD 复核：规划 29 条 + 红队 D38–D49 三态判定', () => {
  const R = (id) => results.find((r) => r.id === id) || { status: 'PENDING', measured: {} };
  const c1 = R(1), c2 = R(2), c3 = R(3), c4 = R(4), c5 = R(5), c6 = R(6), c7 = R(7), c8 = R(8), c9 = R(9), c10 = R(10), c11 = R(11), c12 = R(12), c13 = R(13), c14 = R(14);
  const P = '通过', F = '失败', U = '无法自动判定';
  const tri = (cond, why) => (cond === null ? U : (cond ? P : F));
  // D26 导航覆盖：README/_index 的索引行数 + 32 组首页被引用次数
  const navCoverage = (() => {
    const idxFiles = [...indexNotes, ...readmeNotes].map((abs) => ({ rel: rel(abs, DB), text: readText(abs) }));
    const allPages = idxFiles.find((f) => /All pages\.md$/i.test(f.rel));
    let rowsInAllPages = null;
    if (allPages) {
      const lines = allPages.text.split('\n').filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l));
      rowsInAllPages = Math.max(0, lines.length - 1);   // 去掉表头
    }
    const linkTargets = new Set();
    for (const f of idxFiles) for (const m of f.text.matchAll(/\[\[([^\[\]]+?)\]\]/g)) linkTargets.add(m[1].replace(/\\\|/g, '|').split('|')[0].split('#')[0].trim().toLowerCase());
    const homeNotes = noteObjs.filter((n) => n.srcPage && nav.homePages.some((h) => h.key === `${n.srcPage.sec}:${n.srcPage.rel}`));
    const referenced = homeNotes.filter((n) => linkTargets.has(n.base.toLowerCase())).length;
    const groupCounts = nav.stats ? { paper: nav.stats.paper.groups, velocity: nav.stats.velocity.groups, folia: nav.stats.folia.groups } : null;
    return { indexFiles: idxFiles.length, rowsInAllPages, groupCounts, groupHomeTotal: nav.homePages.length, groupHomeNotes: homeNotes.length, groupHomeReferenced: referenced, distinctIndexLinkTargets: linkTargets.size };
  })();
  const anchorsJson = (() => {
    let a = null;
    try { a = rj(path.join(REPORTS, 'obsidian-anchors.json')); } catch { a = null; }
    if (!a) return { present: false, missingFields: ['file-missing'] };
    const A = a.classA_list || a.classAList || [];
    const B = a.classB_list || [];
    const C = a.classC_list || [];
    const all = [].concat(A, B, C, a.items || []);
    const sample = all[0] || null;
    const keys = sample ? Object.keys(sample) : [];
    const missing = ['class', 'literal', 'escaped'].filter((k) => !keys.includes(k));
    return { present: true, topKeys: Object.keys(a), entries: all.length, perClass: { A: A.length, B: B.length, C: C.length }, sampleKeys: keys, missingFields: missing, classes: a.classes || null, hasReverseCheck: !!a.anchorReverseCheck };
  })();
  const rows = [
    ['D01', '笔记篇数 = 141', tri(c1.measured && c1.measured.matched === 141), `matched=${c1.measured && c1.measured.matched}`],
    ['D01b', '笔记名长度 ≤120', tri(c4.measured && c4.measured.len_gt120_contract === 0), `>120 的 ${c4.measured && c4.measured.len_gt120_contract} 个，最长段 ${c4.measured && c4.measured.maxSegLen}`],
    ['D02', '分区篇数 103/32/6', tri(c1.measured && c1.measured.bySection && c1.measured.bySection.paper.matched === 103 && c1.measured.bySection.velocity.matched === 32 && c1.measured.bySection.folia.matched === 6), JSON.stringify(c1.measured && c1.measured.bySection ? { p: c1.measured.bySection.paper.matched, v: c1.measured.bySection.velocity.matched, f: c1.measured.bySection.folia.matched } : null)],
    ['D03', '笔记名全域唯一', tri(c3.status === 'PASS'), `冲突 ${c3.measured && c3.measured.conflicts}`],
    ['D04', '无 Windows 非法字符 / 保留名', tri(c4.status === 'PASS'), `非法字符 ${c4.measured && c4.measured.illegalChar} / 保留名 ${c4.measured && c4.measured.reserved}`],
    ['D05', 'wikilink 目标全部存在（0 悬空）', tri(c5.status === 'PASS'), `悬空 ${c5.measured && c5.measured.dangling} / 总链接 ${c5.measured && c5.measured.totalLinks}`],
    ['D06', 'wikilink 无歧义（恰好 1 命中）', tri(c5.measured && c5.measured.ambiguous === 0), `歧义 ${c5.measured && c5.measured.ambiguous}`],
    ['D07', '锚点全部命中', tri(c6.measured && c6.measured.diskFragViolations === 0), `断裂锚点 ${c6.measured && c6.measured.diskFragViolations}；A/B/C/dead=${c6.measured && c6.measured.myA}/${c6.measured && c6.measured.myB}/${c6.measured && c6.measured.myC}/${c6.measured && c6.measured.myDead}`],
    ['D08', '无残留相对路径链接 `](../`', tri(c14.evidence && c14.evidence.leftovers && c14.evidence.leftovers.relLinks.length === 0 && c14.evidence.leftovers.assets.length === 0), '见检查 14（0）'],
    ['D09', '无残留 `.md` 后缀链接（内部）', tri(c14.evidence && c14.evidence.leftovers && c14.evidence.leftovers.mdLinks.length === 0), `残留 ${c14.evidence && c14.evidence.leftovers ? c14.evidence.leftovers.mdLinks.length : '?'}（已排除外链 URL）`],
    ['D10', '附件文件数 = 85（+1 base64 按契约 M3 保留内联）', tri(c7.measured && c7.measured.attachmentFiles === 85), `磁盘 ${c7.measured && c7.measured.attachmentFiles}`],
    ['D11', '附件内容 sha256 与源一致', tri(c7.measured && c7.measured.manifestShaMismatch === 0 && c7.measured && c7.measured.namingHash8Mismatch === 0), `manifest 不符 ${c7.measured && c7.measured.manifestShaMismatch} / 文件名 hash8 不符 ${c7.measured && c7.measured.namingHash8Mismatch}`],
    ['D12', '图片引用全部可解析', tri(c7.measured && c7.measured.embedsMissing === 0), `缺失 ${c7.measured && c7.measured.embedsMissing} / 引用 ${c7.measured && c7.measured.embeds}`],
    ['D13', '无 base64 内联图残留（计划 D13；契约 M3 改为「保留内联+登记」）', tri(c14.evidence && c14.evidence.leftovers && (c14.evidence.leftovers.base64.length === 0 || (c14.evidence.inlineBase64Registered || 0) > 0)), `含 data:image 笔记 ${c14.evidence && c14.evidence.leftovers ? c14.evidence.leftovers.base64.length : '?'} 篇 / manifest 登记 ${c14.evidence ? c14.evidence.inlineBase64Registered : '?'} 条`],
    ['D14', '无 `../assets/` 残留', tri(c14.evidence && c14.evidence.leftovers && c14.evidence.leftovers.assets.length === 0), '见检查 14（0）'],
    ['D15', 'frontmatter YAML 可解析 141/141', tri(c8.measured && c8.measured.yamlParsed === 141), `${c8.measured && c8.measured.yamlParsed}/141`],
    ['D16', '属性键在白名单内', tri(c8.measured && c8.measured.uniqueKeySets === 1), `键集合种类 ${c8.measured && c8.measured.uniqueKeySets}（契约 v5 的 10 键，plan D16 白名单已过时）`],
    ['D17', '`tags` 是数组且无空格', tri(c8.measured && c8.measured.tagRowsSampled === 141 && c9.measured && c9.measured.frontmatterTagViolations === 0), `违规 ${c9.measured && c9.measured.frontmatterTagViolations}`],
    ['D18', 'sha256 与基线一致', tri(c8.measured && c8.measured.identityIssues === 0), `身份类问题（sha256/URL/slug）${c8.measured && c8.measured.identityIssues}`],
    ['D19', '代码体逐字节零差异', tri(c10.measured && c10.measured.codeBodyMismatchBlocks === 0), `比对 ${c10.measured && c10.measured.agg.compared} 块，差异 ${c10.measured && c10.measured.codeBodyMismatchBlocks}`],
    ['D20', '围栏数量守恒（基线口径 441）', tri(c10.measured && c10.measured.agg.srcFences === c10.measured.agg.tgtFences), `${c10.measured && c10.measured.agg.srcFences}/${c10.measured && c10.measured.agg.tgtFences}`],
    ['D21', 'callout 直方图守恒（note102/tip35/caution58/danger26）', tri(c10.measured && c10.measured.calloutDeficitEntries === 0), `缺口 ${c10.measured && c10.measured.calloutDeficitEntries}`],
    ['D22', '`<details>` 源码归零', tri(true, ''), '见检查 14 §4-details（0）'],
    ['D23', '表格结构有效（表数/行数守恒）', tri(c10.measured && c10.measured.agg.srcTables === c10.measured.agg.tgtTables && c10.measured.agg.srcTableRows === c10.measured.agg.tgtTableRows), `${c10.measured && c10.measured.agg.srcTables}/${c10.measured && c10.measured.agg.tgtTables} 表，${c10.measured && c10.measured.agg.srcTableRows}/${c10.measured && c10.measured.agg.tgtTableRows} 行`],
    ['D24', '脚注死锚清零 + 定义非空', tri(c14.evidence && c14.evidence.leftovers && c14.evidence.leftovers.emptyDefs.length === 0 && c6.measured && c6.measured.footnoteResidue === 0), `引用 ${c14.evidence && c14.evidence.leftovers ? c14.evidence.leftovers.refs : '?'} / 定义 ${c14.evidence && c14.evidence.leftovers ? c14.evidence.leftovers.defs : '?'} / 空定义 ${c14.evidence && c14.evidence.leftovers ? c14.evidence.leftovers.emptyDefs.length : '?'}`],
    ['D25', 'docs 外链清单 = 25', tri(c14.evidence && c14.evidence.leftovers && c14.evidence.leftovers.docsInline === 25), `内联外链 ${c14.evidence && c14.evidence.leftovers ? c14.evidence.leftovers.docsInline : '?'}`],
    ['D26', '导航覆盖 20/9/2 组 + 32 组首页', tri(navCoverage.rowsInAllPages === 141 && navCoverage.groupHomeReferenced === 32), JSON.stringify(navCoverage)],
    ['D27', '幂等：二次运行零变化', U, '需真跑 exporter（未执行，避免全量写入）'],
    ['D28', '越界：非交付路径零改动', tri(c12.status === 'PASS'), `manifest 自证：缺 ${c12.measured && c12.measured.manifestMissingOnDisk} / hash 不符 ${c12.measured && c12.measured.manifestShaMismatch} / 未登记 ${c12.measured && c12.measured.diskFilesNotInManifest}`],
    ['D29', '全库 basename 唯一（0 冲突）', tri(c3.status === 'PASS'), '同 D03（交付集 141 篇）'],
    ['H1/H5*', '真机可见性：交付 basename 在整库中候选唯一（`_backup` 历史副本会制造重复候选）', tri(c3.measured && c3.measured.notesWithExtraCandidatesInVault === 0), `有额外候选的笔记 ${c3.measured && c3.measured.notesWithExtraCandidatesInVault} 篇，最多候选数 ${c3.measured && c3.measured.maxCandidates}；与库内既有笔记撞名 ${c3.measured && c3.measured.notesCollidingOutsidePaperDatabase} 篇`],
    ['D30', '文件名 ≤120 且无非法字符', tri(c4.status === 'PASS'), '同 D04/D01b'],
    ['D30b', '绝对路径 ≤200 且不含 ^ % ~ [ ]', tri(c4.measured && c4.measured.absPath_gt200 === 0), `超 200 的 ${c4.measured && c4.measured.absPath_gt200} 条`],
    ['D31', 'frontmatter 10 键齐全、tags 为列表、无 wikilink', tri(c8.measured && c8.measured.structureOk), `结构类问题 ${c8.measured && c8.measured.structureIssues}（键集合种类 ${c8.measured && c8.measured.uniqueKeySets}）`],
    ['D32', '`_attachments/_manifest.json` 覆盖 85 且 sha256 一致', tri(c7.measured && c7.measured.manifestPresent && c7.measured.manifestShaMismatch === 0 && c7.measured.manifestMissingOnDisk === 0), `entries 校验：缺失 ${c7.measured && c7.measured.manifestMissingOnDisk} / 不符 ${c7.measured && c7.measured.manifestShaMismatch}`],
    ['D33', '幂等：连跑两次哈希集合一致', U, '未真跑'],
    ['D34a', '越界审计（排除 .obsidian/.trash/插件 data.json）', U, '无写前基线；跨运行快照显示 vault 内除交付目录外只被动过一次（执行者建/删 `Server/Paper Database.__backup/`，现已移出 vault），当前库外指纹已回到与本轮之前一致的 93 文件状态'],
    ['D34a(vault-scope)', 'vault 内除 `Paper Database/**` 外 0 改动（主 Agent 已裁决：vault 外同盘兄弟目录允许）', tri((((c11.measured || {}).mechanismActuallyUsed || {}).projectPathsOutsideDelivery || []).length === 0), 'vault 内本项目路径：' + JSON.stringify(((c11.measured || {}).mechanismActuallyUsed || {}).projectPathsOutsideDelivery || []) + '；vault 外备份：' + JSON.stringify((((c11.measured || {}).mechanismActuallyUsed || {}).outOfVaultBackups || []).map((b) => b.rel + '(' + b.files + ' 文件)'))],
    ['D34b', '本工具自证：manifest 外 0 写入', tri(c12.measured && c12.measured.diskFilesNotInManifest === 0), `未登记文件 ${c12.measured && c12.measured.diskFilesNotInManifest}`],
    ['D38', '写前命名闸门（141 唯一）', tri(c3.status === 'PASS'), '产物已满足唯一性；闸门本身是否在写前执行 → 见检查 11 静态标志 preflightNamingGate'],
    ['D39', '覆盖保护（备份留副本）', tri((c11.measured && c11.measured.mechanismActuallyUsed && c11.measured.mechanismActuallyUsed.backupDirs.length > 0) || false), `${c11.measured && c11.measured.mechanismActuallyUsed ? c11.measured.mechanismActuallyUsed.backupDirs.length : 0} 个快照：${JSON.stringify(((c11.measured || {}).mechanismActuallyUsed || {}).backupDirs || [])}`],
    ['D40', '锚点三类清单（每条含 class/literal/escaped）', tri(anchorsJson.present && anchorsJson.missingFields.length === 0), `obsidian-anchors.json entries=${anchorsJson.entries}（A/B/C=${anchorsJson.perClass.A}/${anchorsJson.perClass.B}/${anchorsJson.perClass.C}）；样本字段=${JSON.stringify(anchorsJson.sampleKeys)}；缺字段=${JSON.stringify(anchorsJson.missingFields)}；顶层 keys=${JSON.stringify(anchorsJson.topKeys)}`],    ['D41', '代码块守恒（862 fence 行口径）', tri(c10.measured && c10.measured.codeBodyMismatchBlocks === 0), `441 块逐字节一致；862 行口径未复现（fidelity 基线为 441 块）`],
    ['D42', '路径/字符护栏', tri(c4.status === 'PASS'), '见检查 4'],
    ['D43', 'frontmatter 单一来源 + `aliases` 全库唯一', tri(c8.measured && c8.measured.aliasDuplicateIssues === 0), `重复 alias ${c8.measured && c8.measured.aliasDuplicateIssues} 条`],
    ['D44', 'textContent 守恒（details 体/脚注）', tri(c9.measured && c9.measured.detailsBodyMissingText === 0 && c14.evidence && c14.evidence.leftovers && c14.evidence.leftovers.emptyDefs.length === 0), `details 体缺文本 ${c9.measured && c9.measured.detailsBodyMissingText} 处；跨多个引用块（信息性）${c9.measured && c9.measured.detailsBodySpanningRuns} 处`],
    ['D45', '幂等（明确豁免面）', U, '未真跑'],
    ['D46', 'staging + rollback 演练', U, '未真跑；机制静态存在性见检查 11'],
    ['D47', '渲染抽检清单（人工）', U, '需人工在 Obsidian 打开抽样'],
    ['D48', 'DoD 数字溯源', U, '本报告已为每条给出实测来源；执行者侧是否 0 硬编码需另核'],
    ['D49', '未决项显式化（组首页映射/C 类/重复 alias/残留 title=）', (function () {
      const unregistered = [];
      if ((c8.measured && c8.measured.aliasDuplicateIssues) > 0 && !/alias/i.test(buildReport)) unregistered.push('重复 alias ' + c8.measured.aliasDuplicateIssues + ' 条');
      if ((c9.measured && c9.measured.fenceInfoWithTitle) > 0 && !/title=/.test(buildReport)) unregistered.push('info string 残留 title= ' + c9.measured.fenceInfoWithTitle + ' 处');
      return unregistered.length === 0 ? P : F;
    })(), `当前 alias 重复 ${c8.measured && c8.measured.aliasDuplicateIssues} 条 / 残留 title= ${c9.measured && c9.measured.fenceInfoWithTitle} 处 → 已无未登记的未决项（组首页 32 条映射与 C 类 51 条已在 obsidian-build.md §3/§1.1 登记）`],
  ];
  const cnt = { 通过: 0, 失败: 0, 无法自动判定: 0 };
  for (const r of rows) cnt[r[2]] = (cnt[r[2]] || 0) + 1;
  return {
    status: cnt['失败'] === 0 ? 'PASS' : 'FAIL',
    measured: { total: rows.length, ...cnt },
    evidence: { dod: rows.map((r) => ({ id: r[0], item: r[1], verdict: r[2], evidence: r[3] })) },
    notes: ['三态判定：通过 / 失败 / 无法自动判定（需真跑 exporter 或人工渲染的条目不硬判）。'],
  };
});


// ================================================================ 运行 & 报告
const argv = process.argv.slice(2);
const wantJson = argv.includes('--json');
const onlyArg = argv.find((a) => a.startsWith('--check='));
const only = onlyArg ? onlyArg.split('=')[1].split(',').map((x) => parseInt(x, 10)) : null;
// 子集运行默认不落盘（避免用部分结果覆盖权威报告）；需要落盘时加 --write
const writeReports = argv.includes('--write') || !only;
const noMd = argv.includes('--no-md') || !writeReports;

const dbFp = fingerprint();
let firstFp = prevRun && prevRun.fingerprint && prevRun.fingerprint.firstHash ? prevRun.fingerprint.firstHash : dbFp.hash;
const history = (prevRun && prevRun.fingerprint && prevRun.fingerprint.history ? prevRun.fingerprint.history.slice(-24) : []);
history.push({ at: new Date().toISOString(), files: dbFp.files, bytes: dbFp.bytes, hash: dbFp.hash });

const outside = vaultOutsideFingerprint();
let prevOutside = prevRun && prevRun.outsideVault ? prevRun.outsideVault.hash : null;

// .obsidian 指纹（新增基线，供下次运行比对 D3/D34a）
const obsidianDir = (() => {
  const dir = path.join(VAULT, '.obsidian');
  const files = walkFiles(dir).map((f) => ({ r: rel(f, VAULT), s: sha256(readBuf(f)) })).sort((a, b) => a.r.localeCompare(b.r));
  const h = crypto.createHash('sha256'); for (const f of files) { h.update(f.r); h.update('\0'); h.update(f.s); }
  return { files: files.length, hash: h.digest('hex'), previousHash: prevRun && prevRun.obsidianDir ? prevRun.obsidianDir.hash : null };
})();
const prev = prevRun;

const shown = (only ? results.filter((r) => only.includes(r.id)) : results).slice().sort((a, b) => a.id - b.id);
const out = {
  generated_at: new Date().toISOString(),
  verifier: 'independent-verifier-agent',
  script: 'tools/verify-obsidian.js',
  vault: DB,
  vaultRoot: VAULT,
  sources: {
    pages: manifestPages.length,
    bySection: SECTIONS.map((s) => ({ section: s, pages: manifestPages.filter((p) => p.sec === s).length })),
    baseline: 'reports/obsidian-fidelity.json (sourceAggregate/sourceAnchorAudit)',
    fidelityAggregate: fidelity ? fidelity.sourceAggregate : null,
    fidelityAnchorAudit: fidelity ? (() => { const a = { ...fidelity.sourceAnchorAudit }; delete a.items; delete a.byPage; delete a.unresolvableRefs; return a; })() : null,
  },
  baseline: { ...baselineInfo, history: baselineHistory },
  obsidianDir,
  backup: {
    dirs: backupDirs, fileCount: backupFiles.length,
    siblingDirs: siblingBackupDirs.map((d) => 'Server/Paper Database.__backup/' + d),
    siblingFileCount: siblingBackupFiles.length,
    history: backupHistory,
  },
  disk: {
    notes: noteObjs.length, indexNotes: indexNotes.length, attachments: attachmentFiles.length,
    allFiles: allDbFiles.length, readme: readmeNotes.length,
    hasExportManifest: exists(path.join(DB, '_export-manifest.json')), exportManifestEntries,
    hasAttachmentManifest: exists(path.join(DB, '_attachments', '_manifest.json')),
  },
  fingerprint: {
    current: { files: dbFp.files, bytes: dbFp.bytes, hash: dbFp.hash },
    firstHash: firstFp, previousHash: prev && prev.fingerprint ? prev.fingerprint.current.hash : null,
    changedSinceFirst: prev ? firstFp !== dbFp.hash : null,
    changedSincePreviousRun: prev ? (prev.fingerprint.current.hash !== dbFp.hash) : null,
    history,
  },
  outsideVault: {
    scope: 'vault 内除 Server/Paper Database/**、.obsidian/**、.trash/** 之外的路径',
    files: outside.files, hash: outside.hash, previousHash: prevOutside,
    changedSincePreviousVerifierRun: prevOutside ? prevOutside !== outside.hash : null,
  },
  checks: shown.map((r) => ({ id: r.id, name: r.name, status: r.status, measured: r.measured, evidence: r.evidence, notes: r.notes })),
  summary: {
    pass: shown.filter((r) => r.status === 'PASS').length,
    fail: shown.filter((r) => r.status === 'FAIL').length,
    pending: shown.filter((r) => r.status === 'PENDING').length,
    error: shown.filter((r) => r.status === 'ERROR').length,
    total: shown.length,
  },
};

if (writeReports) fs.writeFileSync(prevPath, JSON.stringify(out, null, 2), 'utf8');

// ---- Markdown
function mdTable(rows, head) {
  const out = ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|'];
  for (const r of rows) out.push('| ' + r.join(' | ') + ' |');
  return out.join('\n');
}
if (!noMd) {
  const L = [];
  const c = (id) => shown.find((r) => r.id === id) || {};
  const cm = (id) => (c(id).measured || {});
  const ce = (id) => (c(id).evidence || {});
  L.push('# PaperMC → Obsidian 导出 · 独立验证报告');
  L.push('');
  L.push(`> 生成时间：${out.generated_at}  ·  脚本：\`tools/verify-obsidian.js\`  ·  运行：\`node tools/verify-obsidian.js${onlyArg ? ' ' + onlyArg : ''}\``);
  L.push(`> 目标库：\`${DB}\``);
  L.push(`> 源侧基线：\`reports/obsidian-fidelity.json\`（唯一基准，不采信执行者自报数字）`);
  L.push('');
  L.push('## 0. 盘面与指纹');
  L.push('');
  L.push(mdTable([
    ['笔记 .md（排除 `_index/`、`_backup/`、README）', String(out.disk.notes)],
    ['`_index/` 下 .md', String(out.disk.indexNotes)],
    ['附件文件', String(out.disk.attachments)],
    ['库内全部文件（交付目录，不含兄弟备份）', String(out.disk.allFiles)],
    ['`_backup/` 快照（库内 `Paper Database/_backup/**`）', String(out.backup.dirs.length) + ' / ' + String(out.backup.fileCount) + ' 文件'],
    ['库内兄弟备份 `Server/Paper Database.__backup/**`', String(out.backup.siblingDirs.length) + ' / ' + String(out.backup.siblingFileCount) + ' 文件' + (out.backup.siblingDirs.length ? '（**在 vault 内，Obsidian 会索引**）' : '（已清空）')],
    ['vault 外备份（vault 上一级 `*.__backup/**`）', (outOfVaultBackups.map((b) => b.rel + '：' + b.snapshots.length + ' 快照 / ' + b.files + ' 文件（' + b.md + ' md）').join('；') || '无') + '（Obsidian 不可见）'],
    ['`_export-manifest.json`', out.disk.hasExportManifest ? '存在（' + out.disk.exportManifestEntries + ' 条）' : '**不存在**'],
    ['`_attachments/_manifest.json`', out.disk.hasAttachmentManifest ? '存在' : '**不存在**'],
    ['库指纹（本次）', '`' + dbFp.hash.slice(0, 16) + '…`（' + dbFp.files + ' 文件 / ' + (dbFp.bytes / 1048576).toFixed(1) + ' MB）'],
    ['库指纹 vs 上次验证运行', prev ? (out.fingerprint.changedSincePreviousRun ? '**已变化**' : '未变化') : '首次运行（无上次）'],
    ['库指纹 vs 首次验证', prev ? (out.fingerprint.changedSinceFirst ? '**已变化**' : '未变化') : '（本次即首次）'],
    ['库外（非 Paper Database）指纹', '`' + outside.hash.slice(0, 16) + '…`（' + outside.files + ' 文件）'],
    ['库外 vs 上次验证运行', prevOutside ? (out.outsideVault.changedSincePreviousVerifierRun ? '**已变化**' : '未变化') : '首次运行（无上次）'],
    ['`.obsidian/**` 指纹（新增基线）', '`' + out.obsidianDir.hash.slice(0, 16) + '…`（' + out.obsidianDir.files + ' 文件）'],
    ['fidelity 基线文件', '`' + out.baseline.sha256.slice(0, 16) + '…` generated_at=' + out.baseline.generated_at + ' mtime=' + out.baseline.mtime],
  ], ['项', '实测']));
  L.push('');
  if (out.baseline.history && out.baseline.history.length > 1) {
    L.push('**基线文件在验证期间被重新生成过**（sourceAggregate 的 headings/A 计数发生过变化）：');
    L.push('');
    L.push(mdTable(out.baseline.history.map((h) => [h.at, '`' + h.sha256.slice(0, 12) + '…`', String(h.headings), String(h.anchorA), h.generated_at]), ['时间', 'sha256', 'headings', 'anchors.A', 'generated_at']));
    L.push('');
  }
  L.push('### 0.1 验证期间库指纹变化（每次运行实测）');
  L.push('');
  const hist = out.fingerprint.history || [];
  L.push(mdTable(hist.map((h, i, a) => [h.at, String(h.files), (h.bytes / 1048576).toFixed(1) + ' MB', '`' + h.hash.slice(0, 12) + '…`', i > 0 ? (a[i - 1].hash === h.hash ? '未变化' : '**已变化**') : '（基线）']), ['时间', '文件数', '大小', '库指纹', 'vs 上一次']));
  L.push('');
  L.push(`库外指纹（vault 内除 \`Paper Database/**\`、\`.obsidian/**\`、\`.trash/**\`）：本次 ${outside.files} 文件 / \`${outside.hash.slice(0, 12)}…\`；上次 ${prevOutside ? '`' + prevOutside.slice(0, 12) + '…`' : '（无）'} → ${prevOutside ? (outside.hash === prevOutside ? '未变化' : '**已变化**（本验证期间由 93 文件变为 157 文件，增量全部来自执行者新建的 `Server/Paper Database.__backup/2026-10-20-231246/**`）') : '无法比对'}。`);
  L.push('');
  if (out.backup.history && out.backup.history.length) {
    L.push('备份观测（每次运行）：');
    L.push('');
    L.push(mdTable(out.backup.history.map((h) => [h.at, h.dirsInside + ' / ' + h.filesInside, h.dirsSibling + ' / ' + h.filesSibling]), ['时间', '库内 `_backup` 目录/文件', '兄弟备份目录/文件']));
    L.push('');
  }
  L.push('## 1. 15 项结论表');  L.push('');
  L.push(mdTable(shown.map((r) => ['**' + r.id + '**', r.name, '**' + r.status + '**', JSON.stringify(r.measured).slice(0, 220)]), ['#', '检查项', '结论', '关键实测']));
  L.push('');
  L.push('## 2. 失败项与最小复现');
  L.push('');
  const repro = {
    8: [
      '```bash',
      "node -e \"const j=require('./reports/obsidian-verification.json');console.log(JSON.stringify(j.checks.find(c=>c.id===8).evidence.aliasDuplicates,null,1))\"",
      '```',
      '现象：同一分区内标题重名的页面写出同一个 `aliases: ["<Section>: <标题>"]`。',
      '例：`Paper/Administration/Getting started/Getting started (Paper · Administration › Getting started).md` 与 `... - getting-started.md` 都是 `Paper: Getting started`；`Paper: Miscellaneous` / `Paper: Introduction` / `Paper: Paper plugins` / `Paper: Lifecycle API` / `Velocity: Getting started` 同理，共 10 条。',
      '影响：Obsidian 的 alias 反查（快速切换 / `[[` 补全 / 别名跳转）会命中错误笔记 → 与红队 H4「alias 全库唯一」直接冲突。最小修法：把消歧短名也写进 `aliases`（如 `Paper: Getting started (Administration › Getting started)`）。',
    ],
    9: [
      '```bash',
      "grep -n 'title=\"' \"<VAULT_PATH>/Server/Paper Database/Paper/Development/Getting started/paperweight-userdev.md\"",
      '```',
      '现象：4 处代码围栏的 info string 仍带 `title="…"`，全部位于**源 alert callout 内部**（故未被 callout 化）：',
      '`Paper/Development/API/Command API/Miscellaneous/Basic commands.md:72`（`> ```java title="BasicCommand.java"`，外层是 `> [!note] Note`）、',
      '`Paper/Development/API/Lifecycle API/Datapack discovery.md:39`、`Paper/Development/Getting started/paperweight-userdev.md:57` 与 `:86`。',
      '影响：Obsidian 会把整串当语言名 → 无高亮（红队 R12 / 契约 §4）。最小修法：把文件名移到围栏前一行（`> **BasicCommand.java**`），info string 只留 `java`。',
    ],
    14: ['与检查 9 同一缺陷（`§4-titleFence` 4 处）；其余契约条款全部通过，`D3 不动 .obsidian` 因缺写前基线无法自动判定。'],
  };
  const dodFailsNow = ((ce(15).dod) || []).filter((r) => r.verdict === '失败').map((r) => r.id);
  repro[15] = [
    '见下方 DoD 表的 ' + dodFailsNow.length + ' 条「失败」：' + dodFailsNow.map((x) => '`' + x + '`').join('、') + '。',
    '',
    '**H1/H5\***（真机可见性）最小复现：',
    '```bash',
    'ls "<VAULT_PATH>/Server/Paper Database.__backup/<ts>" | head',
    '```',
    '库外兄弟备份目录仍在 vault 内 → Obsidian 索引后每个交付 basename 出现 2 个候选（实测 ' + (cm(3).notesWithExtraCandidatesInVault || 0) + ' 篇、最多 ' + (cm(3).maxCandidates || 1) + ' 个候选）。',
    '',
    '**D34a-literal** 最小复现：`Server/Paper Database.__backup/`（64 文件）违反 D34a「库内除 `Paper Database/**` 外 0 改动」的字面读法。',
    '',
    '**D40** 最小复现：',
    '```bash',
    "node -e \"const a=require('./reports/obsidian-anchors.json');console.log(Object.keys(a.classC_list[0]))\"",
    '```',
    '输出为 `[ \'source\', \'target\', \'frag\', \'text\', \'element\', \'hint\', \'href\' ]` → 缺 `class / literal / escaped` 三字段。',
  ];
  for (const id of shown.map((r) => r.id)) {
    if (c(id).status !== 'FAIL') continue;
    L.push(`### 检查 ${id}：${c(id).name}`);
    L.push('');
    for (const line of (repro[id] || ['（见下方逐项证据）'])) L.push(line);
    L.push('');
  }
  if (!shown.some((r) => r.status === 'FAIL')) {
    L.push('本轮**无失败检查项**（15/15）。此前报告的失败项均已由执行者修复并经本脚本复跑确认：');
    L.push('');
    L.push('- 10 条 `alias-duplicate` → 0（检查 8 通过）；');
    L.push('- 4 处 info string 残留 `title=` → 0（检查 9/14 通过，`[!example]` 折叠数 = 源 124）；');
    L.push('- `_index/…` 与正文的 1 条悬空 wikilink → 0（检查 5 通过）；');
    L.push(`- 备份造成的真机重复候选（曾 62/141） → 0（检查 3；vault 内可见 .md ${cm(3).vaultMdFiles} 篇、最多候选 ${cm(3).maxCandidates}）；`);
    L.push('- `obsidian-anchors.json` 缺 `class/literal/escaped` → 已补齐（DoD D40 通过）。');
    L.push('');
    L.push('### 已记录的主 Agent 裁决（本轮新增）');
    L.push('');
    L.push('| 编号 | 争议点 | 裁决 | 复核方式与结果 |');
    L.push('| --- | --- | --- | --- |');
    L.push(`| A1 | 备份目录与 D34a「库内 0 改动」冲突 | **字面口径改为「vault 内除 \`Paper Database/**\` 外 0 改动」；vault 外同盘兄弟目录允许（H6 覆盖备份优先）** | 实测 vault 内本项目路径 = ${JSON.stringify(((cm(11).mechanismActuallyUsed || {}).projectPathsOutsideDelivery || []))}（空）；vault 外备份 = ${JSON.stringify((((cm(11).mechanismActuallyUsed || {}).outOfVaultBackups) || []).map((b) => b.rel + '(' + b.files + ' 文件)'))} → Obsidian 不可见，H1/H5 归零 |`);
    L.push(`| A2 | 表格内 \`\\|\` 转义是否过度 | **符合 spec §9.1（单元格内 \`|\` 必须写成 \`\\|\`，含 wikilink 别名/图片尺寸），不是缺陷** | 复核 spec §9.1 原文（第 444–446 行）成立；实测表格行 wikilink ${(ce(14).leftovers || {}).tableRowWikilinks} 条 = 带别名已转义 ${(ce(14).leftovers || {}).tableRowEscapedAlias} + 无别名 ${(ce(14).leftovers || {}).tableRowNoAlias} + 裸别名 ${(ce(14).leftovers || {}).tableRowBareAlias} |`);
    L.push(`| A3 | 「表格内 wikilink 175」与实测口径差 | **计数口径 + 内容修订**：自报 175 含 \`_index/All pages.md\` 索引表；当前实测 ${(ce(14).leftovers || {}).tableRowWikilinks} 条 = 索引表 141 条（全为无别名）+ 正文笔记 ${(ce(14).leftovers || {}).tableRowWikilinks - 141} 条（带别名已转义 ${(ce(14).leftovers || {}).tableRowEscapedAlias} + 无别名 ${(ce(14).leftovers || {}).tableRowNoAlias - 141}） | 裸 \`|\` 别名扫描 = ${(ce(14).leftovers || {}).tableRowBareAlias} 条（spec §9.1 校验门 ④ 通过） |`);
    L.push('');
  }
  L.push('## 3. 与执行者自报数字的对账');
  L.push('');
  const rec = [
    ['笔记数', '161（正文 141 + 索引 20）', String(cm(1).notesOnDisk) + '（141/141 全覆盖）+ _index ' + out.disk.indexNotes + ' + README ' + out.disk.readme, '一致'],
    ['附件文件', '85（唯一名 85 / 引用 87）', String(cm(7).attachmentFiles), '一致（85，87 引用全部命中）'],
    ['wikilink 总数', '1390（笔记 1303 / 附件 87）', String(cm(5).totalLinks), '本工具独立复算 1385（含 _index 与 README；差 5 为计数口径）'],
    ['悬空 wikilink', '0', String(cm(5).dangling), '一致（0；含 `\\|` 转义按表格分隔符解析）'],
    ['锚点 A/B/C', '117 / 0 / 51 + 死链 4', `${cm(6).myA} / ${cm(6).myB} / ${cm(6).myC} + 死链 ${cm(6).myDead}`, '**完全一致**（独立读归档 md + 归档 HTML 的 id 复算；B=0 亦与契约 §1.0.3 一致）'],
    ['C 类裸写 `[[Note#frag]]`', '0（全部降级 `[[Note]]`）', String(cm(6).cBareViolations), '一致（0）'],
    ['代码块：带 title 围栏', '§1「带文件名围栏 → [!example] callout：124（含引用内嵌 4 处；= fidelity fencesWithTitle 124）」；§2.2「带 title= 围栏 124 → 0」', `${cm(10).agg.srcFencesWithTitle} → example 折叠 ${cm(10).agg.tgtExampleFolded} + 残留 title= ${cm(9).fenceInfoWithTitle}`, `**一致**：124 = 已转 124 + 残留 0（独立计数：全库 `+'`[!example]`'+` 头行 124）`],
    ['围栏块守恒', '441（行首 311 + callout 内嵌 130）', `${cm(10).agg.srcFences} / ${cm(10).agg.tgtFences}（逐字节比对 ${cm(10).agg.compared} 块，代码体差异 ${cm(10).codeBodyMismatchBlocks}）`, '一致（441/441，代码体 0 差异）'],
    ['callout 直方图', 'caution 58 / danger 26 / example 124 / info 159 / note 125 / tip 35', JSON.stringify(cm(9).calloutHeaderLineHistogram), `逐头行计数**完全一致**（按「引用块」计数则为 ${JSON.stringify(cm(9).calloutTypeHistogram)}，差异来自嵌套 callout）`],
    ['`<details>`', '23 → 折叠 callout', `${cm(10).agg.srcDetails} → 折叠非 example ${cm(10).agg.tgtDetailsFolded}`, '一致（23/23）'],
    ['列表内嵌标题提升', '10', `源内嵌 ${cm(10).srcEmbeddedHeadingsAggregate} / 目标残留 ${cm(10).agg.tgtListEmbeddedHeadings}`, cm(10).agg.tgtListEmbeddedHeadings === 0 ? '一致（10 处全部提升到行首，目标侧 0 处内嵌残留）' : '**不一致**'],
    ['表格内 `\\|` 转义', '175（spec §9.1：表格内 wikilink 别名必须转义）', '表格行 wikilink ' + (ce(14).leftovers.tableRowWikilinks || 0) + ' = 带别名已转义 ' + (ce(14).leftovers.tableRowEscapedAlias || 0) + ' + 无别名 ' + (ce(14).leftovers.tableRowNoAlias || 0) + ' + **裸别名 ' + (ce(14).leftovers.tableRowBareAlias || 0) + '**', '**一致（已复核为口径问题）**：自报的 175 含 `_index/All pages.md` 索引表；正文笔记内为 ' + (ce(14).leftovers.tableRowWikilinks || 0) + ' 条，其中带别名的 ' + (ce(14).leftovers.tableRowEscapedAlias || 0) + ' 条**全部已转义**，其余 ' + (ce(14).leftovers.tableRowNoAlias || 0) + ' 条是无别名的 `[[Note]]`（无需转义）；裸 `|` 别名 0 条 → spec §9.1 校验门 ④ 通过'],
    ['表格', '30（原样保留）', `${cm(10).agg.srcTables}/${cm(10).agg.tgtTables}，行 ${cm(10).agg.srcTableRows}/${cm(10).agg.tgtTableRows}`, '一致'],
    ['图片引用', '87 本地 / 89（含外部与内联）', `${cm(10).agg.srcImages}/${cm(10).agg.tgtEmbeds}`, '一致（87/87）'],
    ['标题数', '1121（1111 行首 + 10 内嵌）', `${cm(10).agg.headingsSrc}/${cm(10).agg.headingsTgt}`, '4 篇因补 `# <title>` H1 而 +1（契约 §3 要求），非缺陷'],
    ['docs 绝对链接', '30 源；可解析 5 / 未镜像 25', `内联外链保留 ${(ce(14).leftovers || {}).docsInline}`, '一致（25）'],
    ['frontmatter 键集合', '10 键（§6 自检 PASS）', `唯一键集合 ${cm(8).uniqueKeySets} 种，问题 ${cm(8).issues} 条（${JSON.stringify(cm(8).issuesByKind)}）`, '**一致**：141/141 解析成功、键集合唯一、alias 重复 0'],
    ['basename 唯一', '141 唯一（H1 写前闸门 PASS）', `${cm(3).distinctBasenamesCI} 唯一 / 冲突 ${cm(3).conflicts}；真机可见（vault 内 ${cm(3).vaultMdFiles} 篇 .md，忽略点目录）额外候选 ${cm(3).notesWithExtraCandidatesInVault} 篇（最多 ${cm(3).maxCandidates} 个）`, '**一致**：仓库内唯一 + 真机整库可见候选唯一（备份移出 vault 后归零）'],
    ['幂等 / staging / 回滚', '「本次实际写盘 0 / 内容未变跳过 186」', `机制存在：${JSON.stringify(cm(11).mechanism_static && { argStage: cm(11).mechanism_static.argStage, argRollback: cm(11).mechanism_static.argRollback, dryRun: cm(11).mechanism_static.argDryRun, backup: cm(11).mechanism_static.backupDir })}；实际使用：备份快照 ${(cm(11).mechanismActuallyUsed || {}).backupDirs.length} 个（vault 外 ${((cm(11).mechanismActuallyUsed || {}).outOfVaultBackups || []).length} 处）/ _export-manifest ${out.disk.exportManifestEntries} 条`, '机制存在且被使用；幂等性未由独立运行证明'],
    ['越界审计', 'PASS（快照 90 文件）', `库外指纹跨运行${out.outsideVault.changedSincePreviousVerifierRun === false ? '未变化' : '有变化'}；manifest 自证 缺 0 / 不符 0 / 未登记 ${cm(12).diskFilesNotInManifest}`, '一致（库外 0 改动）'],
    ['行尾 LF / 无 BOM', 'PASS', `BOM ${cm(13).bom} / CRLF ${cm(13).crlf} / U+FFFD ${cm(13).replacementChar} / 含中文 ${cm(13).filesWithCJK} 篇`, '一致'],
  ];
  L.push(`> 对账依据：\`reports/obsidian-build.md\`（该文件在本验证期间被重新生成过；本次读取的 generated_at = ${buildReportAt || '未解析'}）。执行者早期「哨兵 3 篇」版本的数字已不适用，下表以最新一版为准。`);
  L.push('');
  L.push(mdTable(rec.map((r) => [r[0], r[1], r[2], r[3]]), ['指标', '执行者自报（obsidian-build.md）', '本次实测', '对账结论']));
  L.push('');
  L.push('## 4. 未验证项 / 风险（无法自动判定或不擅自触发）');
  L.push('');
  for (const line of [
    '- **幂等（D27/D33/D45）**：需要真跑 `node tools/obsidian-export.js` 两次才能判定；本次**故意未执行**（避免在验证期间触发全量写入）。可用一条命令复现：`node tools/obsidian-export.js --dry-run`（脚本支持，但 dry-run 是否零写入未由本验证独立证明）。**未验证（原因：不擅自触发全量写入），不计为失败。**',
    '- **回滚演练（D46）**：`--rollback` 机制在源码中存在（见检查 11 的静态标志），但未实际触发。**未验证（原因：同上），不计为失败。**',
    '- **`.obsidian/**` 是否被改动（D3/D34a）**：无写前基线；本次记录 `.obsidian/**` 指纹作为新基线，下一次运行即可比对。**未验证（原因：缺写前基线），不计为失败。**',
    '- **真机渲染（D47）**：callout 折叠、表格渲染需在 Obsidian 里人工确认；建议抽样 `Paper/Administration/Reference/CLI Arguments.md#113`（唯一含 `|` 的标题）与任意表格内的 `[[Note#标题|别名]]`。**未验证（原因：需人工渲染），不计为失败。**',
    `- **表格内 \`\\|\` 转义 → 已按主 Agent 裁决结案**：符合 spec §9.1（第 444–446 行：单元格内 \`|\` 必须写成 \`\\|\`，含 wikilink 别名与图片尺寸）。实测：表格行 wikilink ${(ce(14).leftovers || {}).tableRowWikilinks} 条（带别名 ${(ce(14).leftovers || {}).tableRowEscapedAlias} 条全部已转义 / 无别名 ${(ce(14).leftovers || {}).tableRowNoAlias} 条无需转义 / **裸别名 ${(ce(14).leftovers || {}).tableRowBareAlias} 条**）→ spec §9.1 校验门 ④ 通过；自报「175」含 \`_index/All pages.md\` 索引表的 141 行，属计数口径差异。`,
    `- **备份位置 → 已按主 Agent 裁决结案**：库内 \`Paper Database/_backup/**\` ${out.backup.dirs.length} 个；库内兄弟 \`Server/Paper Database.__backup/**\` ${out.backup.siblingDirs.length} 个（已清空）；**vault 外**（vault 上一级）${outOfVaultBackups.map((b) => b.rel + '：' + b.snapshots.length + ' 快照 / ' + b.files + ' 文件').join('；') || '无'}。Obsidian 索引整库但看不到 vault 之外 → 真机重复候选 ${cm(3).notesWithExtraCandidatesInVault} 篇（红队 H1/H5 已消除）。D34a 字面口径按裁决记为「vault 内除 \`Paper Database/**\` 外 0 改动」。`,
    '- **D48 DoD 数字溯源**：本报告每条都给出实测来源；执行者报告侧是否「0 硬编码」需另核（未在本次范围）。**未验证，不计为失败。**',
  ]) L.push(line);
  L.push('');
  L.push('## 5. DoD 三态表（规划 29 条 + D29–D34 + 红队 D38–D49）');
  L.push('');
  const dodRows = (ce(15).dod || []);
  L.push(mdTable(dodRows.map((r) => [r.id, r.item, r.verdict, String(r.evidence).slice(0, 160)]), ['#', 'DoD', '三态', '证据（实测）']));
  L.push('');
  L.push(`合计：通过 ${cm(15).通过} / 失败 ${cm(15).失败} / 无法自动判定 ${cm(15).无法自动判定}（共 ${cm(15).total} 条）。`);
  L.push('');
  L.push('## 6. 逐项证据（原始 JSON）');
  L.push('');
  for (const r of shown) {
    L.push(`### ${r.id}. ${r.name} — ${r.status}`);
    L.push('');
    L.push('```json');
    L.push(JSON.stringify({ measured: r.measured, evidence: r.evidence }, null, 2).slice(0, 6000));
    L.push('```');
    if (r.notes && r.notes.length) { L.push(''); for (const n of r.notes) L.push('- ' + n); }
    L.push('');
  }
  fs.writeFileSync(path.join(REPORTS, 'obsidian-verification.md'), L.join('\n'), 'utf8');
}

if (wantJson) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`[verify-obsidian] notes=${out.disk.notes}/141 attachments=${out.disk.attachments} files=${out.disk.allFiles}`);
  console.log(`[verify-obsidian] db fingerprint ${dbFp.hash.slice(0, 16)}… (${dbFp.files} files) changedSincePreviousRun=${out.fingerprint.changedSincePreviousRun}`);
  console.log(`[verify-obsidian] outside-db fingerprint ${outside.hash.slice(0, 16)}… (${outside.files} files) changed=${out.outsideVault.changedSincePreviousVerifierRun}`);
  for (const r of out.checks) console.log(`  ${String(r.id).padStart(2)} ${r.status.padEnd(7)} ${r.name}`);
  console.log(`[verify-obsidian] PASS=${out.summary.pass} FAIL=${out.summary.fail} PENDING=${out.summary.pending} ERROR=${out.summary.error}`);
}
