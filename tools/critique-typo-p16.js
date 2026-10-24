'use strict';
// 统计告警类型 / 外链 / 行内元素用法（内容层证据）
const fs = require('fs');
const pages = ['paper/dev/dialogs/index.html', 'paper/reference/world-configuration/index.html', 'velocity/tuning/index.html', 'paper/reference/configuration/index.html'];
for (const f of pages) {
  if (!fs.existsSync(f)) continue;
  const h = fs.readFileSync(f, 'utf8');
  const row = { page: f.split('/').slice(0, 3).join('/') };
  for (const t of ['alert-caution', 'alert-warning', 'alert-note', 'alert-tip', 'alert-important', 'alert-danger']) {
    const n = (h.match(new RegExp(t, 'g')) || []).length;
    if (n) row[t] = n;
  }
  row.externalLinks = (h.match(/class="external"/g) || []).length;
  row.unmirrored = (h.match(/unmirrored/g) || []).length;
  row.unresolved = (h.match(/unresolved/g) || []).length;
  row.strong = (h.match(/<strong/g) || []).length;
  row.em = (h.match(/<em[ >]/g) || []).length;
  row.kbd = (h.match(/<kbd/g) || []).length;
  row.inlineCode = (h.match(/<code(?![^>]*class="[^"]*hljs)/g) || []).length;
  console.log(JSON.stringify(row));
}
