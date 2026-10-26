'use strict';
/**
 * b3f-keyless.js — 判定 `.cfg-raw` 是否真的可达。
 *
 * 背景：`renderConfigNodeTree()`（build-site.js:1405-1409）只在 `!p.key`（无 key 的 <li>）时
 * 产出 `.cfg-raw`。当前 177 页里 `.cfg-raw` = 0，两种可能：
 *   ① 该分支从未被走到（所有 li 都带 key）→ 规则是死的；
 *   ② 该分支会走到，但 6 个配置页的 `<h[23]>` / keyed<60% 早退把它绕过了 → 规则是**活的**。
 * 本脚本直接复刻 1404-1409 的判定，在 210 个 Markdown 源上跑，数出 keyless 叶子/内部节点。
 *
 * 用法：node tools/b3f-keyless.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MD = path.join(ROOT, 'archive/paper/markdown');

if (!fs.existsSync(MD)) {
  console.error('缺少 ' + MD);
  process.exit(1);
}
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}
const mds = walk(MD, []);

/* 简化的列表解析：只看缩进层级 + 每项的行首是否以 `key:` 形式开头。
   目的不是复刻整个 HTML 管线，而是回答「是否存在不带 key 的列表项」这一是非题。 */
const KEY_RE = /^\s*[-*]\s+(?:<code>)?([A-Za-z0-9_.\-]+)(?:<\/code>)?\s*:/;

let filesWithList = 0;
let keylessItems = 0;
let keyedItems = 0;
const keylessSamples = [];

for (const f of mds) {
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split('\n');
  let sawList = false;
  for (const ln of lines) {
    if (!/^\s*[-*]\s+/.test(ln)) continue;
    sawList = true;
    if (KEY_RE.test(ln)) keyedItems++;
    else {
      keylessItems++;
      if (keylessSamples.length < 12) {
        keylessSamples.push(path.relative(ROOT, f).replace(/\\/g, '/') + '  ' + ln.trim().slice(0, 70));
      }
    }
  }
  if (sawList) filesWithList++;
}

console.log('Markdown 源：' + mds.length + ' 个；含列表的 ' + filesWithList + ' 个');
console.log('带 key 的列表项：' + keyedItems);
console.log('**不带 key 的列表项：' + keylessItems + '**');
console.log('\n无 key 项样例（这些就是 .cfg-raw 的产出对象）：');
for (const s of keylessSamples) console.log('  · ' + s);

console.log('\n判定：' + (keylessItems > 0
  ? '.cfg-raw 分支**可达**（存在 ' + keylessItems + ' 个无 key 列表项）→ 规则**保留**，不删'
  : '.cfg-raw 分支不可达 → 可删'));
