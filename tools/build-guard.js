'use strict';
/**
 * build-guard.js — 构建串行化守卫
 *
 * 问题：本轮有 5 个 Agent 并行，其中 3 个会跑 `node tools/build-site.js`。
 * 并发构建会互相覆盖产物，导致任何"改前/改后"测量都对不上（批 1 就是这么返工的）。
 *
 * 解法：用文件锁把构建串行化。持锁者写 .build-lock，其他人等待。
 *
 * 用法（Agent 应改用这个而不是直接跑 build-site.js）：
 *   node tools/build-guard.js                 # 拿锁 -> 构建 -> 释放
 *   node tools/build-guard.js --timeout=180   # 最长等 180 秒
 *
 * 退出码：0 = 构建成功；1 = 构建失败；3 = 等锁超时
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOCK = path.join(ROOT, '.build-lock');
const argv = process.argv.slice(2);
const get = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? Number(h.slice(p.length)) : d; };
const TIMEOUT = get('timeout', 240);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function isStale() {
  try {
    const st = fs.statSync(LOCK);
    return Date.now() - st.mtimeMs > 300000;   // 5 分钟视为陈旧锁
  } catch { return false; }
}

const start = Date.now();
while (fs.existsSync(LOCK)) {
  if (isStale()) {
    try { fs.unlinkSync(LOCK); console.log('[guard] 清除陈旧锁'); } catch (e) {}
    break;
  }
  if (Date.now() - start > TIMEOUT * 1000) {
    console.log('[guard] 等锁超时（' + TIMEOUT + 's），可能有 Agent 卡住。锁内容：');
    try { console.log(fs.readFileSync(LOCK, 'utf8')); } catch (e) {}
    process.exit(3);
  }
  sleep(400);
}

fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), by: process.env.DSH_AGENT || 'unknown' }, null, 2), 'utf8');
console.log('[guard] 获得构建锁 ' + new Date().toISOString());

let code = 0;
try {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-site.js')], { stdio: 'inherit', cwd: ROOT });
  code = r.status === null ? 1 : r.status;
} catch (e) {
  console.error('[guard] 构建异常: ' + e.message);
  code = 1;
} finally {
  try { fs.unlinkSync(LOCK); } catch (e) {}
  console.log('[guard] 释放锁 ' + new Date().toISOString());
}
process.exit(code);
