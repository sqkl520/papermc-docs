// cr2bm-inbound.js — read-only: how many independent nav surfaces lead to each page.
// Writes intermediate JSON to os.tmpdir(); never writes into the repo.
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const index = read('index.html');
const allPages = read('all-pages.html');
const snapshots = read('snapshots.html');

function slice(from, to) {
  const a = index.indexOf(from);
  if (a < 0) return '';
  const b = index.indexOf(to, a + from.length);
  return index.slice(a, b < 0 ? index.length : b);
}

const aside = slice('id="sidebar"', '</nav>');
const main = slice('id="main"', '</main>');
const treeIdx = main.indexOf('目录结构');
const tree = treeIdx >= 0 ? main.slice(treeIdx) : '';

function hrefs(chunk, filter) {
  const out = [];
  for (const m of chunk.matchAll(/href="([^"]+)"/g)) {
    const h = m[1];
    if (!filter || filter(h)) out.push(h);
  }
  return out;
}

const isDoc = (h) => /^(paper|velocity|folia)\//.test(h) && !h.startsWith('..');

const sideHrefs = hrefs(aside, isDoc);
const treeHrefs = hrefs(tree, isDoc);
const allHrefs = hrefs(allPages, isDoc);
const snapHrefs = hrefs(snapshots, isDoc);

const uniq = (a) => [...new Set(a)];
const docTargets = uniq([...sideHrefs, ...treeHrefs, ...allHrefs, ...snapHrefs]);

const surfaces = {
  sidebar: new Set(sideHrefs),
  landingTree: new Set(treeHrefs),
  allPages: new Set(allHrefs),
  snapshots: new Set(snapHrefs),
};

const rows = docTargets.map((t) => {
  const on = Object.keys(surfaces).filter((k) => surfaces[k].has(t));
  // +1 for the site-wide search dialog (indexes every page) if covered by search-index
  return { target: t, surfaces: on, count: on.length };
});

const dist = {};
for (const r of rows) dist[r.count] = (dist[r.count] || 0) + 1;

const out = {
  generatedAt: new Date().toISOString(),
  docTargetsTotal: docTargets.length,
  anchorsPerSurface: {
    sidebar: sideHrefs.length,
    landingTree: treeHrefs.length,
    allPages: allHrefs.length,
    snapshots: snapHrefs.length,
  },
  surfacesPerPage: dist,
  worst: rows.filter((r) => r.count >= 4).slice(0, 5),
  sample: rows.filter((r) => r.target === 'paper/dev/dialogs/index.html' || r.target === 'paper/index.html'),
};

const tmp = path.join(os.tmpdir(), 'cr2bm-inbound.json');
fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
console.log('written: ' + tmp);
