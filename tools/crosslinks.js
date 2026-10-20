'use strict';
/**
 * crosslinks.js — report link targets that leave the mirrored sections.
 *
 * Scans the rendered Markdown of every archive for absolute docs.papermc.io links and
 * groups them by section, so the library can say exactly what still needs the network.
 *
 * Usage: node tools/crosslinks.js [archiveDir ...]
 */

const fs = require('fs');
const path = require('path');

const archives = process.argv.slice(2).length ? process.argv.slice(2) : ['archive/paper', 'archive/velocity'];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

const sections = new Map();
const details = [];

for (const arch of archives) {
  const section = path.basename(arch);
  const files = walk(path.join(arch, 'markdown'));
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const rel = path.relative(path.join(arch, 'markdown'), f).split(path.sep).join('/');
    for (const m of t.matchAll(/\]\((https?:\/\/docs\.papermc\.io\/[^)\s]+)\)/g)) {
      let u;
      try { u = new URL(m[1]); } catch { continue; }
      const seg = u.pathname.split('/').filter(Boolean)[0] || '(root)';
      const key = seg;
      if (!sections.has(key)) sections.set(key, { count: 0, from: new Set() });
      const entry = sections.get(key);
      entry.count++;
      entry.from.add(section + ':' + rel);
      details.push({ from: section + ':' + rel, target: u.href });
    }
  }
}

const mirrored = new Set(archives.map((a) => path.basename(a)));
console.log('=== absolute docs.papermc.io link targets by section ===');
for (const [seg, v] of [...sections.entries()].sort((a, b) => b[1].count - a[1].count)) {
  const state = mirrored.has(seg) ? 'mirrored' : 'NOT mirrored (needs network)';
  console.log(
    '  ' + String(v.count).padStart(4) + '  /' + seg.padEnd(12) + state.padEnd(30) +
    ' from ' + v.from.size + ' page(s)'
  );
}
console.log('\ntotal absolute doc links:', details.length);
console.log('to mirrored sections    :', details.filter((d) => mirrored.has(new URL(d.target).pathname.split('/').filter(Boolean)[0] || '')).length);
console.log('to unmirrored sections  :', details.filter((d) => !mirrored.has(new URL(d.target).pathname.split('/').filter(Boolean)[0] || '')).length);

fs.writeFileSync(path.join('data', 'crosslinks.json'), JSON.stringify({ sections: [...sections].map(([k, v]) => ({ section: k, count: v.count, pages: v.from.size })), details }, null, 2), 'utf8');
console.log('wrote data/crosslinks.json');
