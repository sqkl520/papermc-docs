'use strict';
/**
 * taxcheck.js — independent structural check of data/taxonomy.json against the archives.
 * (Main-agent sanity check; the deep adversarial review is done by a dedicated agent.)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tax = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));

const problems = [];
const sections = tax.sections || [];
const categories = tax.categories || [];
const pages = tax.pages || [];

const catById = new Map(categories.map((c) => [c.id, c]));
const validSections = new Set(sections.map((s) => s.id));

// 1. collect archive truth
const truth = [];
for (const s of validSections) {
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'archive', s, 'manifest.json'), 'utf8'));
  for (const p of mf.pages) truth.push({ id: s + ':' + p.rel, section: s, rel: p.rel, url: p.url, title: p.title });
}
const truthById = new Map(truth.map((t) => [t.id, t]));
const seenIds = new Set();

for (const p of pages) {
  if (seenIds.has(p.id)) problems.push('duplicate page id: ' + p.id);
  seenIds.add(p.id);
  if (!truthById.has(p.id)) problems.push('page not in any archive manifest: ' + p.id);
  const t = truthById.get(p.id);
  if (t) {
    if (p.rel !== t.rel) problems.push('rel mismatch for ' + p.id + ': ' + p.rel + ' != ' + t.rel);
    if (p.url !== t.url) problems.push('url mismatch for ' + p.id);
    if (!p.title) problems.push('missing title: ' + p.id);
  }
  if (!catById.has(p.category)) problems.push('unknown category: ' + p.id + ' -> ' + p.category);
  else if (catById.get(p.category).section !== p.section) problems.push('category/section mismatch: ' + p.id);
  if (!Array.isArray(p.tags) || p.tags.length < 2) problems.push('too few tags: ' + p.id);
  if (!p.summary || p.summary.length < 10) problems.push('summary too short: ' + p.id);
  if (typeof p.order !== 'number') problems.push('order not numeric: ' + p.id);
}

for (const t of truth) if (!seenIds.has(t.id)) problems.push('MISSING from taxonomy: ' + t.id);

// 2. category sanity
const orphanCategories = categories.filter((c) => c.pageCount === 0 || !pages.some((p) => p.category === c.id));
for (const c of orphanCategories) problems.push('category with no pages: ' + c.id);
const tiny = categories.filter((c) => pages.filter((p) => p.category === c.id).length === 1);
for (const c of tiny) problems.push('category with exactly 1 page (allowed but flagged): ' + c.id);

// 3. per-section counts
console.log('sections:', sections.map((s) => s.id + '=' + s.pageCount).join(', '));
console.log('categories:', categories.length, '| pages:', pages.length, '| archive pages:', truth.length);
const perCat = categories
  .map((c) => ({ id: c.id, title: c.title, n: pages.filter((p) => p.category === c.id).length }))
  .sort((a, b) => a.id.localeCompare(b.id));
console.log('\ncategory sizes:');
for (const c of perCat) console.log('  ' + c.id.padEnd(26) + String(c.n).padStart(3) + '  ' + c.title);

// 4. order sequence sanity inside categories
console.log('\norder sequences (should read as a progression):');
for (const c of categories) {
  const list = pages.filter((p) => p.category === c.id).sort((a, b) => a.order - b.order);
  const dup = new Set();
  const dupes = [];
  for (const p of list) {
    if (dup.has(p.order)) dupes.push(p.order);
    dup.add(p.order);
  }
  if (dupes.length) problems.push('duplicate order values in ' + c.id + ': ' + dupes.join(','));
  console.log('  ' + c.id.padEnd(26) + list.map((p) => p.order).join(','));
}

console.log('\nproblems:', problems.length);
problems.slice(0, 40).forEach((p) => console.log('  ! ' + p));
