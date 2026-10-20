'use strict';
/**
 * check-site.js — main-agent smoke test for the generated documentation site.
 *
 * Independent of the generator's own bookkeeping: walks every produced HTML file and
 * verifies that each relative href/src target actually exists on disk, plus a
 * code-block census that understands fenced blocks nested inside blockquotes/alerts.
 *
 * Layout: the site root IS the repository root, pages live at <section>/<rel>.html
 * (matching the upstream URL structure), sources live in archive/<section>/markdown.
 *
 * Usage: node tools/check-site.js [siteRoot] [archiveRoot]
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const LIB = process.argv[2] ? path.resolve(process.argv[2]) : REPO;
const ARCHIVE = process.argv[3] ? path.resolve(process.argv[3]) : path.join(REPO, 'archive');
const ARCHIVES = ['paper', 'velocity'];

/** directories that are not part of the rendered site */
const SITE_SKIP = new Set(['node_modules', 'tools', 'reports', 'archive', 'data', '.git', 'assets']);

function walk(root, ext, skip = new Set(['REPORTS', 'node_modules', 'assets'])) {
  const out = [];
  const rec = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) rec(p); }
      else if (e.isFile() && p.endsWith(ext)) out.push(p);
    }
  };
  rec(root);
  return out;
}

/** every rendered HTML of the site (sections, categories, landing pages) */
function siteHtmlFiles() {
  const files = [];
  // pages live under <section>/**
  for (const sec of ARCHIVES) {
    const dir = path.join(LIB, sec);
    if (fs.existsSync(dir)) files.push(...walk(dir, '.html', new Set()));
  }
  // top-level index/sections/categories/*.html
  const rec = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SITE_SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.isFile() && e.name.endsWith('.html')) files.push(p);
    }
  };
  rec(LIB);
  return [...new Set(files)];
}

const htmlFiles = siteHtmlFiles();
const problems = [];

// ---- 1. relative href/src resolution ----
let checked = 0;
const brokenByKind = new Map();
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, 'utf8');
  const dir = path.dirname(f);
  for (const m of t.matchAll(/(?:href|src)="([^"#?][^"]*)"/g)) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target) || target.startsWith('//') || target.startsWith('#')) continue;
    checked++;
    const clean = decodeURI(target.split('#')[0].split('?')[0]);
    if (!clean) continue;
    if (!fs.existsSync(path.resolve(dir, clean))) {
      const kind = path.extname(clean) || '(none)';
      if (!brokenByKind.has(kind)) brokenByKind.set(kind, []);
      if (brokenByKind.get(kind).length < 5) brokenByKind.get(kind).push({ from: path.relative(LIB, f), target });
      problems.push(path.relative(LIB, f) + ' -> ' + target);
    }
  }
}
console.log('html files:', htmlFiles.length);
console.log('relative href/src checked:', checked, '| broken:', problems.length);
for (const [kind, list] of brokenByKind) {
  console.log('  broken ' + kind + ':');
  list.forEach((b) => console.log('    ' + b.from + ' -> ' + b.target));
}

// ---- 2. fenced code census (counts fences inside `> ` blockquotes too) ----
function mdFenceCount(mdText) {
  let n = 0;
  for (const line of mdText.split('\n')) {
    const stripped = line.replace(/^(?:[ \t]*>[ \t]?)+/, '');
    if (/^[ \t]*```/.test(stripped)) n++;
  }
  return n / 2;
}

let mdTotal = 0;
let htmlTotal = 0;
const mismatches = [];
for (const section of ARCHIVES) {
  const base = path.join(ARCHIVE, section, 'markdown');
  const mds = walk(base, '.md', new Set());
  for (const md of mds) {
    const rel = path.relative(base, md).split(path.sep).join('/');
    const mdText = fs.readFileSync(md, 'utf8');
    const fences = mdFenceCount(mdText);
    const outFile = path.join(LIB, section, rel.replace(/\.md$/, '.html'));
    if (!fs.existsSync(outFile)) { mismatches.push({ page: section + ':' + rel, fences, pre: -1 }); continue; }
    const html = fs.readFileSync(outFile, 'utf8');
    const pre = (html.match(/<pre[\s>]/g) || []).length;
    mdTotal += fences;
    htmlTotal += pre;
    if (fences !== pre) mismatches.push({ page: section + ':' + rel, fences, pre });
  }
}
console.log('\nmarkdown code blocks (incl. nested in alerts):', mdTotal, '| <pre> in generated pages:', htmlTotal);
console.log('pages with code-block mismatch:', mismatches.length);
mismatches.slice(0, 10).forEach((m) => console.log('  ' + JSON.stringify(m)));

console.log('\nRESULT:', problems.length === 0 && mismatches.length === 0 ? 'PASS' : 'FAIL');
if (problems.length || mismatches.length) process.exitCode = 1;
