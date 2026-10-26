'use strict';
/**
 * b2h-diffcheck.js —— 提交前核对：未暂存的构建产物到底差了什么（只读）
 *
 * 为什么需要：`git diff` 对这 3 个文件会把**整行**打出来（all-pages.html 的表格是单行
 * 12 万字符），肉眼无法判断"差的是时间戳还是内容"。
 * 本脚本按行比对 HEAD 版与磁盘版，只打印**首处差异的上下文**与长度，
 * 用来确认：差异全部来自本次构建的时间戳/字节数，而不是别的 Agent 的改动。
 *
 * 用法：node tools/b2h-diffcheck.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const FILES = ['all-pages.html', 'snapshots.html', 'search-index.json', 'data/build-manifest.json'];

for (const rel of FILES) {
  let head;
  try {
    head = execFileSync('git', ['show', 'HEAD:' + rel], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.log('[' + rel + '] HEAD 读不到（新文件？）');
    continue;
  }
  const disk = fs.readFileSync(path.join(REPO, rel), 'utf8');
  if (head === disk) { console.log('[' + rel + '] 与 HEAD 完全相同'); continue; }

  const hl = head.split('\n');
  const dl = disk.split('\n');
  let diffs = 0;
  const shown = [];
  const n = Math.max(hl.length, dl.length);
  for (let i = 0; i < n; i++) {
    if (hl[i] === dl[i]) continue;
    diffs++;
    if (shown.length < 3) {
      const a = hl[i] === undefined ? '<无此行>' : hl[i];
      const b = dl[i] === undefined ? '<无此行>' : dl[i];
      /* 找首处不同的字符位置，各取 ±60 字符上下文 */
      let k = 0;
      while (k < a.length && k < b.length && a[k] === b[k]) k++;
      shown.push({
        line: i + 1,
        at: k,
        head: a.slice(Math.max(0, k - 60), k + 60),
        disk: b.slice(Math.max(0, k - 60), k + 60),
      });
    }
  }
  console.log('\n[' + rel + ']  行数 ' + hl.length + ' → ' + dl.length + '  ；差异行数 = ' + diffs
    + '  ；字节 ' + Buffer.byteLength(head) + ' → ' + Buffer.byteLength(disk));
  for (const s of shown) {
    console.log('  第 ' + s.line + ' 行，首处差异在字符 ' + s.at + '：');
    console.log('    HEAD: …' + s.head + '…');
    console.log('    磁盘: …' + s.disk + '…');
  }
}
