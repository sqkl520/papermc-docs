'use strict';
/**
 * md-features.js — survey the Markdown feature surface of the archives.
 *
 * The static-site generator must render whatever the converter produced, so this
 * reports, per archive, which constructs actually occur (and how often), plus the
 * concrete examples a generator has to get right.
 *
 * Usage: node tools/md-features.js [archiveDir ...]
 */

const fs = require('fs');
const path = require('path');

const archives = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['archive/paper', 'archive/velocity'];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

const PATTERNS = {
  'fenced code block': /^[ \t]*```/gm,
  'info string with title=': /^[ \t]*```[^\n]*title="/gm,
  'info string with lang': /^[ \t]*```[a-zA-Z0-9+#-]+/gm,
  'github alert': /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gm,
  'raw <details>': /^<details>/gm,
  'raw <summary>': /^<summary>/gm,
  'gfm table header': /^\|.*\|$/gm,
  'inline code': /`[^`\n]+`/g,
  'image': /!\[[^\]]*\]\([^)]+\)/g,
  'link (relative md)': /\]\([^)\s]+\.md(#[^)\s]*)?\)/g,
  'link (absolute docs)': /\]\(https?:\/\/docs\.papermc\.io\/[^)\s]+\)/g,
  'link (external)': /\]\(https?:\/\/(?!docs\.papermc\.io)[^)\s]+\)/g,
  'footnote ref': /\[\^\d+\]/g,
  'autolink': /<https?:\/\/[^>]+>/g,
  'html comment': /<!--/g,
  'kbd tag': /<kbd>/g,
  'sup/sub tag': /<(sup|sub)>/g,
  'nbsp entity': /&nbsp;/g,
  'html entity (other)': /&(amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi,
  'math $$': /\$\$[\s\S]{1,200}?\$\$/g,
  'math inline $': /(?<!\$)\$(?!\$)[^\n$]{2,60}\$(?!\$)/g,
  'task list': /^[ \t]*[-*] \[[ xX]\]/gm,
  'blockquote': /^> /gm,
  'h1': /^# /gm,
  'h2': /^## /gm,
  'h3': /^### /gm,
  'h4+': /^#{4,6} /gm,
  'heading with {#id}': /^#{1,6} .*\{#[a-z0-9-]+\}/gim,
  'hr': /^---$/gm,
  'deep indent list (>=3 levels)': /^(?:[ \t]{4,}[-*] )/gm,
};

const report = {};
for (const arch of archives) {
  const files = walk(path.join(arch, 'markdown'));
  const counts = {};
  const examples = {};
  let totalBytes = 0;
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    totalBytes += Buffer.byteLength(t, 'utf8');
    const rel = path.relative(path.join(arch, 'markdown'), f).split(path.sep).join('/');
    for (const [name, re] of Object.entries(PATTERNS)) {
      const m = t.match(re);
      if (!m) continue;
      counts[name] = (counts[name] || 0) + m.length;
      if (!examples[name]) examples[name] = { file: rel, sample: m[0].replace(/\s+/g, ' ').slice(0, 110) };
    }
  }
  report[arch] = { pages: files.length, totalBytes, counts, examples };
}

for (const [arch, r] of Object.entries(report)) {
  console.log('\n=== ' + arch + ' — ' + r.pages + ' pages, ' + (r.totalBytes / 1048576).toFixed(2) + ' MiB ===');
  const rows = Object.entries(r.counts).sort((a, b) => b[1] - a[1]);
  for (const [name, n] of rows) {
    console.log('  ' + String(n).padStart(6) + '  ' + name.padEnd(28) + ' e.g. ' + r.examples[name].file);
  }
  console.log('  -- raw samples for the risky ones --');
  for (const k of ['info string with title=', 'github alert', 'raw <details>', 'math inline $', 'html entity (other)', 'heading with {#id}']) {
    if (r.examples[k]) console.log('    ' + k + ': ' + JSON.stringify(r.examples[k].sample));
  }
}

fs.writeFileSync(
  path.join('data', 'md-features.json'),
  JSON.stringify(report, null, 2),
  'utf8'
);
console.log('\nwrote data/md-features.json');
