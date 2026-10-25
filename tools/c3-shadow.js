'use strict';
/**
 * c3-shadow.js — 为 check=8 的双实例对打**重建改前实例**（只读仓库；只写 %TEMP%）
 *
 * 背景：check=8 需要 http://127.0.0.1:8788 的「改前」站点，但 <repo>/../_pre-mobile
 *       已被外部删除，门禁因此永远记 partial（差异表为空，硬断言被 partial 掩盖）。
 *       批 3 改了桌面断点，1024 的语义从「桌面」变成「移动线」—— 必须拿到**真实差异表**
 *       才能判断是白名单要改，还是方案要改。
 *
 * 做法：
 *   1) 把仓库树复制到 %TEMP%\c3-pre（跳过 .git / node_modules / reports；node_modules 用 junction 指回）
 *   2) 用 `git show HEAD:tools/site/assets.js` 把**改前源**写回影子副本（HEAD=9c82b47）
 *   3) 在影子副本里跑 build-site.js（只写影子副本，绝不碰仓库产物）
 *
 * 用法：node tools/c3-shadow.js            # 建影子副本
 *       node tools/c3-shadow.js --where    # 只打印路径
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHADOW = path.join(os.tmpdir(), 'c3-pre');
const SKIP = new Set(['.git', 'node_modules', 'reports', '.build-lock']);

const argv = process.argv.slice(2);
const REV = (() => { const h = argv.find((a) => a.startsWith('--rev=')); return h ? h.slice(6) : '9c82b47'; })();
if (argv.includes('--where')) { console.log(SHADOW); process.exit(0); }

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isSymbolicLink()) { try { fs.symlinkSync(fs.readlinkSync(s), d); } catch (x) {} }
    else fs.copyFileSync(s, d);
  }
}

/* 1) 清空 + 复制 */
if (fs.existsSync(SHADOW)) fs.rmSync(SHADOW, { recursive: true, force: true });
copyTree(ROOT, SHADOW);

/* node_modules 用 junction 指回真仓库（避免 300MB 复制；Windows 用 /J） */
const nmSrc = path.join(ROOT, 'node_modules');
const nmDst = path.join(SHADOW, 'node_modules');
if (fs.existsSync(nmSrc)) {
  try { fs.symlinkSync(nmSrc, nmDst, 'junction'); } catch (e) { console.error('junction 失败: ' + e.message); }
}

/* 2) 基线源：git show <REV>:tools/site/assets.js（不含任何工作树改动） */
const baseline = execFileSync('git', ['-C', ROOT, 'show', REV + ':tools/site/assets.js'], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
fs.writeFileSync(path.join(SHADOW, 'tools', 'site', 'assets.js'), baseline, 'utf8');
console.log('baseline rev=' + REV + ' assets.js 字节 = ' + Buffer.byteLength(baseline, 'utf8'));

/* 3) 在影子副本里构建 */
const r = spawnSync(process.execPath, [path.join(SHADOW, 'tools', 'build-site.js')], {
  cwd: SHADOW, stdio: 'inherit',
});
console.log('[shadow] build exit=' + (r.status === null ? 1 : r.status));
console.log('SHADOW=' + SHADOW);
process.exit(r.status === null ? 1 : r.status);
