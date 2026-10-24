'use strict';
/* critique-typo-w.js -- verify the "every page declares lang=zh-CN" claim across all HTML files. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.html$/i.test(e.name)) files.push(p);
  }
})(ROOT);

let ok = 0, missing = 0, other = 0;
const missingList = [];
const langCount = {};
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8').slice(0, 3000);
  const m = html.match(/<html[^>]*\blang="([^"]*)"/i);
  if (!m) { missing++; if (missingList.length < 8) missingList.push(path.relative(ROOT, f)); continue; }
  langCount[m[1]] = (langCount[m[1]] || 0) + 1;
  if (m[1] === 'zh-CN') ok++; else other++;
}
console.log('html files:', files.length);
console.log('lang="zh-CN":', ok, ' other lang:', other, ' missing:', missing);
console.log('lang distribution:', JSON.stringify(langCount));
if (missingList.length) console.log('missing sample:', missingList);

/* also: how many pages have a <meta name="viewport"> and a single h1 */
let vp = 0, h1one = 0, h1zero = 0, h1multi = 0;
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  if (/name="viewport"/i.test(html)) vp++;
  const n = (html.match(/<h1[\s>]/gi) || []).length;
  if (n === 1) h1one++; else if (n === 0) h1zero++; else h1multi++;
}
console.log('with viewport:', vp, '/', files.length);
console.log('exactly one h1:', h1one, ' zero h1:', h1zero, ' multiple h1:', h1multi);

/* where are the lang="en" pages, and which files are not single-h1? */
const enFiles = [];
const notSingle = [];
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const m = html.slice(0, 3000).match(/<html[^>]*\blang="([^"]*)"/i);
  if (m && m[1] === 'en') enFiles.push(f);
  const n = (html.match(/<h1[\s>]/gi) || []).length;
  if (n !== 1) notSingle.push([path.relative(ROOT, f), n]);
}
console.log('\nlang="en" files:', enFiles.length);
const buckets = {};
for (const f of enFiles) {
  const rel = path.relative(ROOT, f);
  const top = rel.split(path.sep)[0] || '(root)';
  buckets[top] = (buckets[top] || 0) + 1;
}
console.log('en by top dir:', JSON.stringify(buckets));
console.log('en sample:', enFiles.slice(0, 5).map((f) => path.relative(ROOT, f)));
console.log('\nnot exactly one <h1>:', JSON.stringify(notSingle));
