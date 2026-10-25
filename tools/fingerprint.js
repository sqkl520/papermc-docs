'use strict';
/**
 * fingerprint.js — 产物指纹（C0 冻结 + 漂移检测的基础设施）
 *
 * 为什么需要它：上一轮（批 1）的返工成本全部来自"测量期间产物被重建"。
 * `reports/` 被 .gitignore 排除，证据只活在磁盘上，任何重建都会让"改前/改后"对不上。
 *
 * 用法：
 *   node tools/fingerprint.js                    # 打印当前指纹（JSON）
 *   node tools/fingerprint.js --write            # 写入 data/build.json
 *   node tools/fingerprint.js --check <anchor>   # 与给定 anchor 比对，不一致 exit 2
 *   node tools/fingerprint.js --json=<path>      # 同时写入指定路径（不覆盖 data/build.json）
 *
 * 退出码：
 *   0 = 一致 / 正常
 *   1 = 文件缺失等一般错误
 *   2 = 指纹漂移（与 --check 的 anchor 不同）—— 用来与断言失败(1)区分
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

/** 参与指纹的文件（产物 + 构建清单；不包括 reports/ 与 tools/） */
const TARGETS = [
  'assets/site.css',
  'assets/site.js',
  'assets/search-index.js',
  'assets/favicon.svg',
  'search-index.json',
  'data/build-manifest.json',
];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function collect() {
  const files = {};
  for (const rel of TARGETS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { files[rel] = { missing: true }; continue; }
    const buf = fs.readFileSync(abs);
    files[rel] = {
      bytes: buf.length,
      sha256: sha256(buf),
      sha12: sha256(buf).slice(0, 12),
    };
  }
  // 联合 anchor：把所有 (路径, 哈希) 按固定顺序拼接后再哈希
  const joined = TARGETS.map((r) => r + ':' + (files[r].sha256 || 'missing')).join('|');
  return {
    generated_at: new Date().toISOString(),
    anchor: sha256(Buffer.from(joined, 'utf8')).slice(0, 16),
    files,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const get = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

  const fp = collect();

  const checkAnchor = get('check', null);
  if (checkAnchor) {
    const ok = fp.anchor === checkAnchor;
    console.log('fingerprint ' + checkAnchor + ' -> ' + fp.anchor + '  ' + (ok ? 'ok' : 'DRIFTED'));
    if (!ok) {
      console.log('产物自测量开始后被改动，本轮数字作废。差异明细：');
      for (const [k, v] of Object.entries(fp.files)) console.log('  ' + k.padEnd(30) + (v.missing ? 'MISSING' : v.bytes + 'B  ' + v.sha12));
      process.exit(2);
    }
    process.exit(0);
  }

  const jsonOut = get('json', null);
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(fp, null, 2), 'utf8');
    console.log('wrote ' + jsonOut + '  anchor=' + fp.anchor);
    process.exit(0);
  }

  if (argv.includes('--write')) {
    const out = path.join(ROOT, 'data', 'build.json');
    fs.writeFileSync(out, JSON.stringify(fp, null, 2), 'utf8');
    console.log('wrote data/build.json  anchor=' + fp.anchor);
    for (const [k, v] of Object.entries(fp.files)) {
      console.log('  ' + k.padEnd(30) + (v.missing ? 'MISSING' : v.bytes + 'B  ' + v.sha12));
    }
    process.exit(0);
  }

  // 默认：打印
  console.log(JSON.stringify(fp, null, 2));
  process.exit(0);
}

main();
