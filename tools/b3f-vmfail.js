'use strict';
/**
 * b3f-vmfail.js — 复核 verify-mobile 那 3 项 FAIL（item 5 / 8 / 10）是否是真回归。
 *
 * 背景：3d 提交前跑 verify-mobile 时，我在它运行期间改了 3e 的 CSS，它自己报出
 *   tools/site/assets.js: 5ebc94008ab8 → 0b3984289804
 * 并判 item 16 为 UNSTABLE。但 item 5（抽屉六项）/ item 8（两套行高）/ item 10（零回归对打）
 * 是 FAIL 而非 UNSTABLE —— 必须查清这 3 项到底是：
 *   ① 真回归（批 3 引入），还是
 *   ② 历史既有（改前就 fail），还是
 *   ③ 该次运行的产物抖动造成（页面被重建时读到半成品）
 *
 * 做法：直接读 verify-mobile 写出的 JSON 里那 3 项的 detail，逐条打印失败子项。
 *
 * 用法：node tools/b3f-vmfail.js [--file=reports/mobile-verification.json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : d;
};
const file = path.join(ROOT, arg('file', 'reports/mobile-verification.json'));
if (!fs.existsSync(file)) { console.error('找不到 ' + file); process.exit(1); }
const j = JSON.parse(fs.readFileSync(file, 'utf8'));

const items = j.items || j.checks || j.results || [];
console.log('报告文件: ' + path.relative(ROOT, file));
console.log('生成时间: ' + (j.at || j.generated_at || j.generatedAt || '?'));
console.log('汇总字段: ' + JSON.stringify(j.summary || {}).slice(0, 300));
console.log('items 数: ' + items.length + '\n');

const WANT = [5, 8, 10, 16];
for (const it of items) {
  const n = it.n || it.item || it.index;
  if (WANT.indexOf(n) === -1) continue;
  console.log('──────── item ' + n + '  [' + (it.status || it.result) + ']  ' + (it.name || it.title || '') + ' ────────');
  /* 递归找所有 failed / false 的叶子字段，逐条打印 */
  const seen = new Set();
  const walk = (obj, prefix, depth) => {
    if (depth > 4 || obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => walk(v, prefix + '[' + i + ']', depth + 1));
      return;
    }
    if (typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const p = prefix ? prefix + '.' + k : k;
      if (seen.has(p)) continue;
      seen.add(p);
      if (v === false || v === 'fail' || (typeof v === 'string' && /^fail/i.test(v))) {
        console.log('  ✗ ' + p + ' = ' + JSON.stringify(v));
      } else if (typeof v === 'object') {
        walk(v, p, depth + 1);
      } else if (/^(checks|items|rows|diff|mismatch|fail|detail)/i.test(k)) {
        console.log('  · ' + p + ' = ' + JSON.stringify(v).slice(0, 400));
      }
    }
  };
  walk(it, '', 0);
  /* 再直接打印 checks 子项，若存在 */
  const subs = it.checks || it.subs;
  if (Array.isArray(subs)) {
    for (const s of subs) {
      console.log('  子项 [' + (s.status || s.result || '?') + '] ' + (s.name || s.label || s.id || '') + '  ' + JSON.stringify(s.detail || s.value || '').slice(0, 220));
    }
  }
  console.log('');
}

/* 附：全局所有 FAIL 项的清单，确认没有第 4 项 */
console.log('全部非 PASS 项：');
for (const it of items) {
  const st = it.status || it.result;
  if (st && String(st).toUpperCase() !== 'PASS') {
    console.log('  item ' + (it.n || it.item) + '  [' + st + ']  ' + (it.name || it.title || '').slice(0, 80));
  }
}
