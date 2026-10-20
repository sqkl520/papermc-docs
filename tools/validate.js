'use strict';
/**
 * validate.js — quality gate for the crawled archive.
 *
 * Checks every rendered Markdown file for converter defects, then verifies that
 * internal links resolve and that the source/rendered pairs agree on page count.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] || 'out');
const MD = path.join(OUT, 'markdown');
const SRC = path.join(OUT, 'source');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

const files = walk(MD).sort();
const problems = [];
const warnings = [];
const rows = [];

const has = (t, s) => t.includes(s);

for (const f of files) {
  const rel = path.relative(MD, f).split(path.sep).join('/');
  const t = fs.readFileSync(f, 'utf8');
  const issues = [];

  if (t.trim().length < 80) issues.push('very short (' + t.trim().length + ' chars)');
  if (has(t, 'RAWHASHTOKEN')) issues.push('raw token leaked');
  // Placeholders such as `<directory>` / `<path>` are legitimate prose; only inspect
  // text outside inline code spans when looking for leftover markup.
  const prose = t.replace(/`[^`\n]*`/g, '');
  if (/md-raw|ec-block|<starlight-|class="astro-|&#x27;|&amp;|&quot;|&nbsp;/.test(prose)) issues.push('markup/entity leak');
  if (/<span[\s>]|<div[\s>]|<svg[\s>]|<code dir=|<a href=/.test(prose)) issues.push('html fragment leak');
  if (/^\s*undefined|NaN/.test(t)) issues.push('undefined/NaN');

  const fenced = (t.match(/^[ \t]*```/gm) || []).length;
  if (fenced % 2 !== 0) issues.push('unbalanced code fences (' + fenced + ')');

  // Inside code fences: no Expressive Code UI artefacts (line-number gutters / collapse markers)
  let bareNumbers = 0;
  let collapseMarkers = 0;
  for (const m of t.matchAll(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```$/gm)) {
    for (const line of m[1].split('\n')) if (/^\d+$/.test(line)) bareNumbers++;
    if (/collapsed lines?/i.test(m[1])) collapseMarkers++;
  }
  if (bareNumbers) issues.push(bareNumbers + ' bare line-number line(s) in code fences');
  if (collapseMarkers) issues.push(collapseMarkers + ' collapsed-lines marker(s) in code fences');

  if (!/^---\n[\s\S]*?\n---\n/.test(t)) issues.push('missing front matter');
  if (!/^# /m.test(t)) issues.push('missing H1');

  const twoSpaceDash = (t.match(/: `[^`]*`\s{2,}\u2014/g) || []).length;
  if (twoSpaceDash) issues.push('double space before em dash x' + twoSpaceDash);

  const absDocLinks = (t.match(/\]\(https:\/\/docs\.papermc\.io\/paper/g) || []).length;
  const rootLinks = (t.match(/\]\(\/paper/g) || []).length;
  if (absDocLinks + rootLinks > 0) warnings.push(rel + ': ' + (absDocLinks + rootLinks) + ' un-rewritten paper links');

  // internal link resolution
  const dir = path.dirname(f);
  let broken = 0;
  for (const m of t.matchAll(/\]\(([^)\s#]+\.md)(#[^)\s]*)?\)/g)) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target)) continue;
    const resolved = path.resolve(dir, decodeURI(target));
    if (!fs.existsSync(resolved)) broken++;
  }
  if (broken) issues.push(broken + ' broken internal md link(s)');

  const codeBlocks = fenced / 2;
  const headings = (t.match(/^#{1,6} /gm) || []).length;
  const tables = (t.match(/^\|.*\|$/gm) || []).length;
  const details = (t.match(/<details>/g) || []).length;

  rows.push({
    rel,
    bytes: Buffer.byteLength(t, 'utf8'),
    codeBlocks,
    headings,
    tableRows: tables,
    details,
    issues,
  });
  if (issues.length) problems.push(rel + ' :: ' + issues.join('; '));
}

// source coverage
const srcFiles = walk(SRC).map((f) => path.relative(SRC, f).split(path.sep).join('/'));
const mdRels = new Set(rows.map((r) => r.rel));
const missingSource = [...mdRels].filter((r) => !srcFiles.includes(r));

const totalBytes = rows.reduce((a, r) => a + r.bytes, 0);
console.log('rendered pages:', rows.length, '| total', (totalBytes / 1048576).toFixed(2), 'MiB');
console.log('source pages  :', srcFiles.length, '| missing source for', missingSource.length, 'page(s)');
console.log('code blocks   :', rows.reduce((a, r) => a + r.codeBlocks, 0));
console.log('headings      :', rows.reduce((a, r) => a + r.headings, 0));
console.log('table rows    :', rows.reduce((a, r) => a + r.tableRows, 0));
console.log('details blocks:', rows.reduce((a, r) => a + r.details, 0));
console.log('warnings      :', warnings.length);
console.log('problems      :', problems.length);
if (missingSource.length) console.log('  missing source:', missingSource.slice(0, 12).join(', '));
warnings.slice(0, 20).forEach((w) => console.log('  warn: ' + w));
problems.forEach((p) => console.log('  problem: ' + p));

console.log('\n--- smallest pages ---');
rows.slice().sort((a, b) => a.bytes - b.bytes).slice(0, 8)
  .forEach((r) => console.log(String(r.bytes).padStart(7), r.rel, '| h=' + r.headings, 'cb=' + r.codeBlocks));

// --- archive-level checks -----------------------------------------------------

const archiveIssues = [];

const indexFile = path.join(OUT, 'INDEX.md');
if (fs.existsSync(indexFile)) {
  const t = fs.readFileSync(indexFile, 'utf8');
  let checked = 0;
  let broken = 0;
  for (const m of t.matchAll(/\]\(([^)#]+\.md)\)/g)) {
    checked++;
    if (!fs.existsSync(path.resolve(OUT, decodeURI(m[1])))) { broken++; archiveIssues.push('INDEX.md -> ' + m[1]); }
  }
  console.log('INDEX.md links:', checked, '| broken:', broken);
} else {
  archiveIssues.push('INDEX.md missing');
}

const mergedName = fs.readdirSync(OUT).find((n) => /-docs-all\.md$/.test(n)) || null;
if (mergedName) {
  const t = fs.readFileSync(path.join(OUT, mergedName), 'utf8');
  const fences = (t.match(/^[ \t]*```/gm) || []).length;
  console.log('merged full text (' + mergedName + '):', (Buffer.byteLength(t) / 1048576).toFixed(2), 'MiB | balanced fences:', fences % 2 === 0);
  if (fences % 2 !== 0) archiveIssues.push(mergedName + ' has unbalanced code fences');
} else {
  archiveIssues.push('no *-docs-all.md merged full text found');
}

const manifestFile = path.join(OUT, 'manifest.json');
if (fs.existsSync(manifestFile)) {
  const mf = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const missing = mf.pages.filter((p) => p.file && !fs.existsSync(path.join(OUT, p.file)));
  const missingSrc = mf.pages.filter((p) => p.sourceFile && !fs.existsSync(path.join(OUT, p.sourceFile)));
  console.log('manifest: ' + mf.pages.length + ' pages, ' + mf.assets.length + ' assets, ' + missing.length + ' missing file refs, ' + missingSrc.length + ' missing source refs');
  missing.forEach((p) => archiveIssues.push('manifest missing file: ' + p.file));
  missingSrc.forEach((p) => archiveIssues.push('manifest missing source: ' + p.sourceFile));
  if (mf.pages.length !== rows.length) archiveIssues.push('manifest pages (' + mf.pages.length + ') != rendered pages (' + rows.length + ')');
} else {
  archiveIssues.push('manifest.json missing');
}

console.log('archive issues:', archiveIssues.length);
archiveIssues.slice(0, 15).forEach((a) => console.log('  archive issue: ' + a));

fs.writeFileSync(path.join(OUT, 'validation.json'), JSON.stringify({ rows, problems, warnings, missingSource, archiveIssues }, null, 2), 'utf8');
console.log('\nwrote ' + path.join(OUT, 'validation.json'));
if (problems.length || archiveIssues.length) process.exitCode = 1;
