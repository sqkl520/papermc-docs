#!/usr/bin/env node
'use strict';
/**
 * b1o-snapshot.js — 独立复验 Agent（批 1 离线/门禁复验）用的真仓库指纹快照。
 *
 * 用途：在跑任何门禁「之前」与「之后」各取一次，证明所有门禁都在 $env:TEMP 影子副本里跑，
 *       真仓库的 reports/ data/ assets/ （以及站点产物）一个字节都没被改动。
 *
 * 用法：
 *   node tools/b1o-snapshot.js --out=$env:TEMP\b1o\before.json
 *   node tools/b1o-snapshot.js --out=$env:TEMP\b1o\after.json
 *   node tools/b1o-snapshot.js --compare=$env:TEMP\b1o\before.json --out=$env:TEMP\b1o\after.json
 *
 * 只读：本脚本只读仓库、只写 --out 指定的文件（放在系统临时目录，不落在仓库里）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const p = '--' + n + '=';
  const hit = argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : d;
};

const OUT = opt('out', path.join(require("os").tmpdir() || '.', 'b1o-snapshot.json'));
const CMP = opt('compare', '');

/** 不做全量哈希的重目录：依赖与 git 元数据与本任务无关 */
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out);
    } else if (e.isFile()) {
      out.push(p);
    }
  }
}

const toPosix = (p) => p.split(path.sep).join('/');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function snapshot() {
  const files = [];
  walk(REPO, files);
  const rows = {};
  const groups = {};
  for (const abs of files) {
    const rel = toPosix(path.relative(REPO, abs));
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    let hex = null;
    try { hex = sha(fs.readFileSync(abs)); } catch { hex = 'READ_ERROR'; }
    rows[rel] = { sha256: hex, bytes: st.size, mtimeMs: Math.round(st.mtimeMs) };
    const top = rel.indexOf('/') === -1 ? '(root file)' : rel.slice(0, rel.indexOf('/'));
    groups[top] = groups[top] || { files: 0, bytes: 0 };
    groups[top].files += 1;
    groups[top].bytes += st.size;
  }
  return { repo: REPO, generatedAt: new Date().toISOString(), fileCount: files.length, groups, files: rows };
}

const cur = snapshot();

if (CMP) {
  const before = JSON.parse(fs.readFileSync(CMP, 'utf8'));
  const changed = [];
  const added = [];
  const removed = [];
  for (const [rel, v] of Object.entries(cur.files)) {
    const b = before.files[rel];
    if (!b) { added.push(rel); continue; }
    if (b.sha256 !== v.sha256) changed.push({ rel, before: b.sha256.slice(0, 12), after: v.sha256.slice(0, 12), bytesBefore: b.bytes, bytesAfter: v.bytes });
  }
  for (const rel of Object.keys(before.files)) if (!cur.files[rel]) removed.push(rel);
  const verdict = (!changed.length && !added.length && !removed.length) ? 'UNCHANGED' : 'MODIFIED';
  const cmp = {
    before: CMP,
    beforeFileCount: before.fileCount,
    afterFileCount: cur.fileCount,
    changedCount: changed.length,
    addedCount: added.length,
    removedCount: removed.length,
    changed: changed.slice(0, 200),
    added: added.slice(0, 200),
    removed: removed.slice(0, 200),
    verdict,
  };
  cur.compare = cmp;
  console.log('SNAPSHOT COMPARE: ' + verdict);
  console.log('  files  before=' + before.fileCount + '  after=' + cur.fileCount);
  console.log('  changed=' + changed.length + '  added=' + added.length + '  removed=' + removed.length);
  for (const c of changed.slice(0, 40)) console.log('  ~ ' + c.rel + '  ' + c.before + ' -> ' + c.after);
  for (const a of added.slice(0, 40)) console.log('  + ' + a);
  for (const r of removed.slice(0, 40)) console.log('  - ' + r);
  // 「重点目录」单独结论
  const focus = ['reports', 'data', 'assets'];
  const focusMod = changed.concat(added.map((a) => ({ rel: a }))).concat(removed.map((r) => ({ rel: r })))
    .filter((x) => focus.some((f) => x.rel === f || x.rel.startsWith(f + '/')));
  console.log('  focus(reports|data|assets) touched=' + focusMod.length);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(cur, null, 0), 'utf8');
console.log('SNAPSHOT WROTE ' + OUT + '  files=' + cur.fileCount);
for (const [g, v] of Object.entries(cur.groups).sort()) {
  console.log('  ' + g.padEnd(14) + ' files=' + String(v.files).padStart(5) + '  MB=' + (v.bytes / 1048576).toFixed(1));
}
