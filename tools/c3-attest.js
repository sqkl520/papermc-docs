'use strict';
/**
 * c3-attest.js — 产物与「哪个版本的源」一致（只读）
 *
 * 用途：批 3 期间其他 Agent 也在改 tools/site/assets.js。本脚本从 git 取指定 revision 的
 *       assets.js，导出 SITE_CSS / SITE_JS，与磁盘上的 assets/site.css、assets/site.js
 *       逐字节比较，从而判定「当前产物是由哪个 commit 的源构建的」。
 *
 * 用法：
 *   node tools/c3-attest.js            # 对 HEAD 与工作树各判一次
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);

function loadFromFile(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}
function loadFromRev(rev) {
  const buf = execFileSync('git', ['-C', ROOT, 'show', rev + ':tools/site/assets.js'], { maxBuffer: 128 * 1024 * 1024 });
  const tmp = path.join(os.tmpdir(), 'c3', 'attest-' + rev.replace(/[^\w.-]/g, '_') + '.js');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, buf);
  return loadFromFile(tmp);
}

const diskCss = fs.readFileSync(path.join(ROOT, 'assets', 'site.css'));
const diskJs = fs.readFileSync(path.join(ROOT, 'assets', 'site.js'));
console.log('disk assets/site.css  ' + diskCss.length + 'B  ' + sha(diskCss));
console.log('disk assets/site.js   ' + diskJs.length + 'B  ' + sha(diskJs));

const rows = [];
for (const [label, mod] of [['HEAD(5d0831b)', loadFromRev('HEAD')], ['worktree', loadFromFile(path.join(ROOT, 'tools', 'site', 'assets.js'))]]) {
  const cssOk = Buffer.from(mod.SITE_CSS, 'utf8').equals(diskCss);
  const jsOk = Buffer.from(mod.SITE_JS, 'utf8').equals(diskJs);
  rows.push({ label, cssOk, jsOk, cssBytes: Buffer.byteLength(mod.SITE_CSS, 'utf8'), jsBytes: Buffer.byteLength(mod.SITE_JS, 'utf8') });
  console.log(label.padEnd(16) + ' SITE_CSS=' + (cssOk ? 'MATCH' : 'differs') + ' (' + Buffer.byteLength(mod.SITE_CSS, 'utf8') + 'B)'
    + '  SITE_JS=' + (jsOk ? 'MATCH' : 'differs') + ' (' + Buffer.byteLength(mod.SITE_JS, 'utf8') + 'B)');
}
const head = rows.find((r) => r.label.startsWith('HEAD'));
console.log('\n判定：当前产物 = ' + (head.cssOk && head.jsOk ? 'HEAD(5d0831b) 的源（= 批 3 的提交态）' : '工作树（含他人未提交改动）的源'));
