#!/usr/bin/env node
'use strict';
/**
 * b1o-proof.js — 证明「门禁在影子副本里跑，真仓库门禁产物零改动」。
 *
 * 背景：本会话是多 Agent 并行，其他 Agent 同时在写 reports/** 与 tools/**。
 * 因此不能只报「整仓 UNCHANGED」——那是假的。正确做法是按**归属**拆分：
 *
 *   A 类「门禁产物」：任何门禁脚本会写的文件。这些必须零改动，否则说明我的跑动污染了真仓库。
 *   B 类「他人在写」：其他 Agent 的探针脚本与截图。与本次复验无关，单独列出以自证清白。
 *   C 类「站点产物」：index.html / assets/** / <section>/** / data/**。必须零改动。
 *
 * 用法：
 *   node tools/b1o-proof.js --before=$env:TEMP\b1o\before.json --after=$env:TEMP\b1o\after.json
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const TMPROOT = path.join(process.env.TEMP || process.env.TMP || '.', 'b1o');
const BEFORE = path.resolve(opt('before', path.join(TMPROOT, 'before.json')));
const AFTER = path.resolve(opt('after', path.join(TMPROOT, 'after.json')));
const OUT_JSON = path.resolve(opt('json', path.join(TMPROOT, 'proof.json')));

const b = JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
const a = JSON.parse(fs.readFileSync(AFTER, 'utf8'));

/** A 类：门禁脚本的固定输出（这些文件由 verify-site / gh-pages-smoke / privacy-scan / verify-mobile 写） */
const GATE_OUTPUTS = [
  'reports/verification.json',
  'reports/verification.md',
  'reports/gh-pages-smoke.json',
  'reports/mobile-verification.json',
  'data/privacy-report.json',
  'data/build-manifest.json',
];

/** C 类：站点产物前缀 */
const SITE_PREFIXES = ['assets/', 'paper/', 'velocity/', 'folia/', 'categories/', 'sections/', 'archive/', 'data/'];
const SITE_ROOT_FILES = ['index.html', 'all-pages.html', 'snapshots.html', '404.html', 'robots.txt', 'sitemap.xml'];

/** B 类：本会话其他 Agent 的产物特征（用于把「不是我改的」显式列出） */
const FOREIGN = [/^reports\/b1-shots\//, /^reports\/\.b1[arv]-/, /^reports\/_b1[arv]-/, /^tools\/b1[^o]/, /^reports\/b1[a-z]-/];

function cls(rel) {
  if (GATE_OUTPUTS.includes(rel)) return 'A-gate-output';
  if (SITE_ROOT_FILES.includes(rel)) return 'C-site';
  if (SITE_PREFIXES.some((p) => rel.startsWith(p))) return 'C-site';
  if (FOREIGN.some((re) => re.test(rel))) return 'B-foreign';
  if (/^tools\/b1o-/.test(rel)) return 'SELF-script';
  if (/^reports\//.test(rel)) return 'B-other-report';
  if (/^tools\//.test(rel)) return 'B-other-tool';
  return 'other';
}

const changed = [];
const added = [];
const removed = [];
for (const [rel, v] of Object.entries(a.files)) {
  const o = b.files[rel];
  if (!o) { added.push(rel); continue; }
  if (o.sha256 !== v.sha256) changed.push(rel);
}
for (const rel of Object.keys(b.files)) if (!a.files[rel]) removed.push(rel);

const buckets = {};
const push = (kind, rel) => {
  const c = cls(rel);
  buckets[c] = buckets[c] || { changed: [], added: [], removed: [], bytes: 0 };
  buckets[c][kind].push(rel);
};

for (const rel of changed) push('changed', rel);
for (const rel of added) push('added', rel);
for (const rel of removed) push('removed', rel);

const verdictFor = (c) => {
  const x = buckets[c];
  if (!x) return 'CLEAN';
  const n = x.changed.length + x.added.length + x.removed.length;
  return n === 0 ? 'CLEAN' : 'TOUCHED(' + n + ')';
};

console.log('=== 真仓库前后指纹对账 ===');
console.log('before ' + b.generatedAt + '  files=' + b.fileCount);
console.log('after  ' + a.generatedAt + '  files=' + a.fileCount);
console.log('');
for (const c of Object.keys(buckets).sort()) {
  const x = buckets[c];
  console.log('[' + verdictFor(c).padEnd(12) + '] ' + c.padEnd(18) + ' changed=' + x.changed.length + ' added=' + x.added.length + ' removed=' + x.removed.length);
  for (const r of x.changed.slice(0, 12)) console.log('      ~ ' + r);
  for (const r of x.added.slice(0, 6)) console.log('      + ' + r);
  for (const r of x.removed.slice(0, 6)) console.log('      - ' + r);
  if (x.added.length > 6) console.log('      + … 另 ' + (x.added.length - 6) + ' 项');
}

// 结论
const gate = buckets['A-gate-output'] || { changed: [], added: [], removed: [] };
const site = buckets['C-site'] || { changed: [], added: [], removed: [] };
const gateTouched = gate.changed.length + gate.added.length + gate.removed.length;
const siteTouched = site.changed.length + site.added.length + site.removed.length;

console.log('');
console.log('★ A 类（门禁产物）改动 = ' + gateTouched + (gateTouched ? '  → FAIL（我的跑动污染了真仓库）' : '  → PASS（未污染）'));
console.log('★ C 类（站点产物 assets/** data/** paper/** … ）改动 = ' + siteTouched + (siteTouched ? '  → FAIL' : '  → PASS（未污染）'));

// 明确列出「我的脚本」自身的变化（这是允许的：任务书要求只写 tools/b1o-*.js）
const self = buckets['SELF-script'] || { changed: [], added: [], removed: [] };
console.log('  自身脚本（允许）：changed=' + self.changed.length + ' added=' + self.added.length + ' → ' + self.added.concat(self.changed).join(', '));

// 站点产物逐项清单（证明没动）
console.log('');
console.log('--- C 类覆盖范围（抽查存在性 + 哈希一致性）---');
const watch = ['index.html', 'all-pages.html', 'snapshots.html', 'assets/site.css', 'assets/site.js', 'assets/search-index.js', 'data/taxonomy.json', 'data/source-nav.json', 'data/build-manifest.json', 'paper/index.html', 'velocity/tuning/index.html', 'paper/dev/dialogs/index.html'];
for (const rel of watch) {
  const o = b.files[rel], n = a.files[rel];
  const same = o && n && o.sha256 === n.sha256;
  console.log('   ' + (same ? 'SAME ' : 'DIFF ') + rel.padEnd(34) + (same ? (o.sha256.slice(0, 12) + '  ' + o.bytes + ' B') : (o ? o.sha256.slice(0, 12) : 'missing') + ' -> ' + (n ? n.sha256.slice(0, 12) : 'missing')));
}

const proof = {
  tool: 'tools/b1o-proof.js',
  before: { path: BEFORE, at: b.generatedAt, files: b.fileCount },
  after: { path: AFTER, at: a.generatedAt, files: a.fileCount },
  buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { changed: v.changed.length, added: v.added.length, removed: v.removed.length, sampleChanged: v.changed.slice(0, 30), sampleAdded: v.added.slice(0, 30), sampleRemoved: v.removed.slice(0, 10) }])),
  gateOutputsTouched: gateTouched,
  siteArtifactsTouched: siteTouched,
  verdict: (gateTouched === 0 && siteTouched === 0) ? 'PASS: 门禁与站点产物零改动（他人在写文件已按归属剔除）' : 'FAIL',
};
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(proof, null, 2), 'utf8');
console.log('\nVERDICT ' + proof.verdict);
console.log('WROTE ' + OUT_JSON);
