#!/usr/bin/env node
'use strict';
/**
 * b1o-gates.js — 在 $env:TEMP 影子副本里**独立复跑**批 1 之后的全部门禁。
 *
 * 为什么要有影子副本：verify-site / gh-pages-smoke / privacy-scan / verify-mobile
 * 会写 reports/** 与 data/privacy-report.json。本脚本把仓库复制到系统临时目录
 * （node_modules 用 junction 只读复用，.git 直接复制），在副本里跑，真仓库零写入。
 *
 * 用法：
 *   node tools/b1o-gates.js                       # 全部 8 项
 *   node tools/b1o-gates.js --only=1,4            # 只跑第 1、4 项
 *   node tools/b1o-gates.js --shadow=$env:TEMP\b1o\shadow --json=$env:TEMP\b1o\gates.json
 *
 * 产出：只写 --json 指定文件（默认系统临时目录）＋ stdout。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const opt = (n, d) => {
  const p = '--' + n + '=';
  const hit = argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : d;
};

const TMPROOT = path.join(require("os").tmpdir() || require("os").tmpdir() || '.', 'b1o');
const SHADOW = path.resolve(opt('shadow', path.join(TMPROOT, 'shadow')));
const OUT_JSON = path.resolve(opt('json', path.join(TMPROOT, 'gates.json')));
const ONLY = (opt('only', '') || '').split(/[,\s]+/).filter(Boolean).map(Number);

/** 门禁清单：id 与任务书编号一致 */
const GATES = [
  { id: 1, key: 'build-verify-artifacts', args: ['tools/build-site.js', '--verify-artifacts'], expect: /RESULT: PASS/ },
  { id: 2, key: 'check-site', args: ['tools/check-site.js'], expect: /PASS/ },
  { id: 3, key: 'verify-site', args: ['tools/verify-site.js'], expect: /PASS/ },
  { id: 4, key: 'url-parity', args: ['tools/url-parity.js'], expect: /PASS/ },
  { id: 5, key: 'privacy-scan', args: ['tools/privacy-scan.js'], expect: /①/ },
  { id: 6, key: 'gh-pages-smoke', args: ['tools/gh-pages-smoke.js'], expect: /RESULT: PASS/ },
  { id: 7, key: 'verify-mobile-check4', args: ['tools/verify-mobile.js', '--check=4'], expect: /PASS/ },
  { id: 8, key: 'verify-mobile-check5', args: ['tools/verify-mobile.js', '--check=5'], expect: /PASS/ },
];

const SKIP_COPY = new Set(['node_modules', '.git']);
/** reports/ 137 MB，全是历史报告，与门禁判定无关；副本里留空目录即可 */
const SKIP_REPORTS = true;

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_COPY.has(e.name)) continue;
    if (SKIP_REPORTS && e.name === 'reports') continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isSymbolicLink()) { try { fs.copyFileSync(fs.realpathSync(s), d); } catch { /* ignore */ } }
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

function prepareShadow() {
  const marker = path.join(SHADOW, 'tools', 'build-site.js');
  const links = {};
  if (!fs.existsSync(marker)) {
    const t0 = Date.now();
    copyTree(REPO, SHADOW);
    fs.mkdirSync(path.join(SHADOW, 'reports'), { recursive: true });
    for (const name of ['node_modules', '.git']) {
      const src = path.join(REPO, name);
      const dst = path.join(SHADOW, name);
      if (!fs.existsSync(src) || fs.existsSync(dst)) { links[name] = 'skip'; continue; }
      try { fs.symlinkSync(src, dst, 'junction'); links[name] = 'junction'; }
      catch (e) { links[name] = 'failed: ' + String(e.message).slice(0, 60); }
    }
    return { created: true, ms: Date.now() - t0, path: SHADOW, links };
  }
  for (const name of ['node_modules', '.git']) {
    links[name] = fs.existsSync(path.join(SHADOW, name)) ? 'present' : 'missing';
  }
  return { created: false, path: SHADOW, links };
}

function tail(text, n) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.length);
  return lines.slice(-n);
}

function runGate(g, extraEnv) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, g.args, {
    cwd: SHADOW,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: Object.assign({}, process.env, extraEnv || {}),
    windowsHide: true,
  });
  const out = (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : '');
  return {
    id: g.id,
    key: g.key,
    cmd: 'node ' + g.args.join(' '),
    exit: r.status === null ? -1 : r.status,
    signal: r.signal || null,
    error: r.error ? String(r.error.message) : null,
    sec: Math.round((Date.now() - t0) / 100) / 10,
    expectHit: g.expect ? g.expect.test(out) : null,
    tail: tail(out, 26),
  };
}

const summary = { tool: 'tools/b1o-gates.js', generatedAt: new Date().toISOString(), node: process.version, repo: REPO, shadow: null, gates: [], notes: [] };

const shadow = prepareShadow();
summary.shadow = shadow;
console.log('SHADOW ' + (shadow.created ? 'created' : 'reused') + '  ' + SHADOW + (shadow.ms ? '  (' + shadow.ms + ' ms)' : ''));
console.log('  links: ' + JSON.stringify(shadow.links));

for (const g of GATES) {
  if (ONLY.length && !ONLY.includes(g.id)) continue;
  process.stdout.write('\n=== [' + g.id + '] ' + g.key + ' :: node ' + g.args.join(' ') + '\n');
  const row = runGate(g);
  summary.gates.push(row);
  console.log('EXIT ' + row.exit + (row.error ? '  error=' + row.error : '') + '  (' + row.sec + 's)');
  for (const l of row.tail) console.log('  | ' + l);
}

const pass = summary.gates.filter((r) => r.exit === 0).length;
summary.summary = { total: summary.gates.length, pass, fail: summary.gates.length - pass };
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), 'utf8');
console.log('\n==== RESULT ' + pass + '/' + summary.gates.length + ' exit==0  -> ' + OUT_JSON);
