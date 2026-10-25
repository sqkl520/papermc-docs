'use strict';
/* c3-extract.js — 用 git 取某个 revision 的文件到临时路径（UTF-8 精确，不经过 PowerShell 重定向） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const rev = process.argv[2] || 'HEAD';
const rel = process.argv[3] || 'tools/site/assets.js';
const buf = execFileSync('git', ['-C', ROOT, 'show', rev + ':' + rel], { maxBuffer: 128 * 1024 * 1024 });
const out = path.join(os.tmpdir(), 'c3', 'rev-' + rev.replace(/[^\w.-]/g, '_') + '-' + path.basename(rel));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log('wrote ' + out + '  bytes=' + buf.length);
