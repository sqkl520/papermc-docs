'use strict';
/**
 * b2p-fingerprint.js — 构建指纹（**只读**，不构建、不写站点）
 *
 * 用途（§4.3 的第 5 步）：在 freeze commit 之后钉住产物指纹，
 * 让每个测量数字都能反查到唯一一个构建。上一轮就是因为没做这步导致证据对不上代码。
 *
 * 输出：reports/b2-baselines/build.<sha7>.json（若目录不存在则创建）
 * 用法：
 *   node tools/b2p-fingerprint.js                # 写 reports/b2-baselines/build.<sha7>.json
 *   node tools/b2p-fingerprint.js --stdout       # 只打印，不落盘
 *   node tools/b2p-fingerprint.js --check=<file> # 与既有指纹比对，不一致 exit 2
 *   node tools/b2p-fingerprint.js --tag=pre-b2   # 自定文件名
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const has = (n) => argv.includes('--' + n);

const FILES = [
  'assets/site.css',
  'assets/site.js',
  'assets/site.js.map',
  'assets/search-index.js',
  'search-index.json',
  'data/build-manifest.json',
  'tools/site/assets.js',
  'tools/site/render.js',
  'tools/site/layout.js',
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function fingerprint() {
  const out = {};
  for (const rel of FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { out[rel] = null; continue; }
    const st = fs.statSync(abs);
    const buf = fs.readFileSync(abs);
    out[rel] = {
      size: st.size,
      sha256: sha256(buf),
      mtimeMs: Math.round(st.mtimeMs),
    };
  }
  let head = null, status = null;
  try { head = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch (e) {}
  try { status = execSync('git status --porcelain', { cwd: ROOT }).toString(); } catch (e) {}
  const dirty = status ? status.split('\n').filter(Boolean) : null;
  // 锚点：产物三件 + 源码三件的联合哈希（任何一件变了都变）
  const KEY = ['assets/site.css', 'assets/site.js', 'assets/search-index.js', 'tools/site/assets.js', 'tools/site/render.js', 'tools/site/layout.js'];
  const anchor = sha256(KEY.map((k) => (out[k] ? out[k].sha256 : 'missing')).join('|')).slice(0, 16);
  return {
    at: new Date().toISOString(),
    head,
    head7: head ? head.slice(0, 7) : null,
    dirty: dirty && dirty.length ? dirty : [],
    dirtyCount: dirty ? dirty.length : 0,
    anchor,
    files: out,
  };
}

const fp = fingerprint();

if (has('check')) {
  const target = opt('check');
  const prev = JSON.parse(fs.readFileSync(path.resolve(ROOT, target), 'utf8'));
  const keys = [...new Set([...Object.keys(prev.files || {}), ...Object.keys(fp.files)])].sort();
  const diffs = [];
  for (const k of keys) {
    const a = prev.files && prev.files[k];
    const b = fp.files[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ file: k, before: a, after: b });
  }
  const sameAnchor = prev.anchor === fp.anchor;
  console.log(JSON.stringify({ check: target, sameAnchor, prevAnchor: prev.anchor, curAnchor: fp.anchor, diffs }, null, 1));
  if (!sameAnchor || diffs.length) { console.error('BUILD DRIFT: 指纹不一致，本份证据作废'); process.exit(2); }
  console.log('OK 指纹一致');
  process.exit(0);
}

if (has('stdout')) { console.log(JSON.stringify(fp, null, 1)); process.exit(0); }

const tag = opt('tag', fp.head7 || 'nogit');
const dir = path.join(ROOT, 'reports', 'b2-baselines');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `build.${tag}.json`);
fs.writeFileSync(file, JSON.stringify(fp, null, 1), 'utf8');
console.log('anchor=' + fp.anchor + ' head=' + fp.head7 + ' dirty=' + fp.dirtyCount);
console.log('WROTE ' + file);
if (fp.dirtyCount) console.warn('WARN: 工作区不干净（' + fp.dirtyCount + ' 项），这份指纹仍可用来做漂移检测，但不能当"freeze 点"');
