'use strict';
// 全站 h2/h3/h4 用量统计（补全 p22 的 h5/h6）
const fs = require('fs');
const path = require('path');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|\.git|archive|assets|tools|reports|data)$/.test(e.name)) continue;
      walk(p, out);
    } else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const root = path.join(__dirname, '..');
const files = walk(root, []);
let pages = 0;
const tot = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
const withAny = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
const noH2 = [];
for (const f of files) {
  const h = fs.readFileSync(f, 'utf8');
  pages++;
  const c = {};
  for (const lv of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const n = (h.match(new RegExp('<' + lv + '[\\s>]', 'g')) || []).length;
    c[lv] = n;
    tot[lv] += n;
    if (n) withAny[lv]++;
  }
  /* 正文页（有 .article）但无 h2 的，记入清单 */
  if (/class="[^"]*\barticle\b/.test(h) && c.h2 === 0 && h.length > 30000) {
    noH2.push({ f: path.relative(root, f), chars: h.length, h3: c.h3, h4: c.h4, h5: c.h5 });
  }
}
console.log('html files scanned = ' + pages);
console.log('total: ' + JSON.stringify(tot));
console.log('files containing each: ' + JSON.stringify(withAny));
console.log('pages with .article but 0 h2 (len>30k): ' + noH2.length);
for (const x of noH2.slice(0, 15)) console.log('   ' + x.f + ' len=' + x.chars + ' h3=' + x.h3 + ' h4=' + x.h4 + ' h5=' + x.h5);
