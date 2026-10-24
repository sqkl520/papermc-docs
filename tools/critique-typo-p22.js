'use strict';
// 全站统计 h5/h6 实际用量（用于支撑「修没人用的层级不如修行宽」的判断）
const fs = require('fs');
const path = require('path');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|\.git|archive|assets|tools|reports|data)$/.test(e.name)) continue;
      walk(p, out);
    } else if (e.name === 'index.html' || e.name === 'all-pages.html' || e.name === 'snapshots.html') {
      out.push(p);
    }
  }
  return out;
}

const root = path.join(__dirname, '..');
const files = walk(root, []);
let pages = 0, filesWithH5 = 0, filesWithH6 = 0, h5 = 0, h6 = 0;
const hits = [];
for (const f of files) {
  const h = fs.readFileSync(f, 'utf8');
  const n5 = (h.match(/<h5[\s>]/g) || []).length;
  const n6 = (h.match(/<h6[\s>]/g) || []).length;
  pages++;
  h5 += n5; h6 += n6;
  if (n5) { filesWithH5++; hits.push({ f: path.relative(root, f), h5: n5, h6: n6 }); }
  if (n6) filesWithH6++;
}
console.log('pages scanned = ' + pages);
console.log('total <h5> = ' + h5 + ' (in ' + filesWithH5 + ' files)');
console.log('total <h6> = ' + h6 + ' (in ' + filesWithH6 + ' files)');
console.log('files with h5: ' + JSON.stringify(hits.slice(0, 10)));
