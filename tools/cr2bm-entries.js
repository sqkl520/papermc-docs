// cr2bm-entries.js — read-only census of "how many entries lead to the same page".
// Writes intermediate JSON to os.tmpdir(); never writes into the repo.
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function slice(from, to) {
  const a = html.indexOf(from);
  if (a < 0) return '';
  const b = html.indexOf(to, a + from.length);
  return html.slice(a, b < 0 ? html.length : b);
}

const aside = slice('id="sidebar"', '</nav>');
const main = slice('id="main"', '</main>');
const treeIdx = main.indexOf('目录结构');
const tree = treeIdx >= 0 ? main.slice(treeIdx) : '';

function hrefs(chunk) {
  return [...chunk.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

const sideHrefs = hrefs(aside);
const treeHrefs = hrefs(tree);
const mainHrefs = hrefs(main);

const tally = new Map();
function bump(map, key) { map.set(key, (map.get(key) || 0) + 1); }

const perTarget = {};
for (const h of sideHrefs) {
  if (!/^(paper|velocity|folia)\//.test(h)) continue;
  perTarget[h] = perTarget[h] || { sidebar: 0, tree: 0, main: 0 };
  perTarget[h].sidebar++;
}
for (const h of treeHrefs) {
  if (!/^(paper|velocity|folia)\//.test(h)) continue;
  perTarget[h] = perTarget[h] || { sidebar: 0, tree: 0, main: 0 };
  perTarget[h].tree++;
}
for (const h of mainHrefs) {
  if (!/^(paper|velocity|folia)\//.test(h)) continue;
  perTarget[h] = perTarget[h] || { sidebar: 0, tree: 0, main: 0 };
  perTarget[h].main++;
}

const targets = Object.keys(perTarget);
const landingDupes = targets.filter((t) => perTarget[t].tree > 0);
const bothSidebarAndTree = targets.filter((t) => perTarget[t].tree > 0 && perTarget[t].sidebar > 0);

const dist = {};
const combo = {};
for (const t of targets) {
  const c = perTarget[t];
  const n = c.sidebar + c.tree + c.main;
  dist[n] = (dist[n] || 0) + 1;
  const k = `sidebar${c.sidebar}/tree${c.tree}/main${c.main}`;
  combo[k] = (combo[k] || 0) + 1;
}

const out = {
  generatedAt: new Date().toISOString(),
  counts: {
    sidebarAnchors: sideHrefs.length,
    treeAnchors: treeHrefs.length,
    mainAnchors: mainHrefs.length,
    distinctArticleTargets: targets.length,
    pagesLinkedFromBothSidebarAndLandingTree: bothSidebarAndTree.length,
    pagesLinkedFromLandingTree: landingDupes.length,
  },
  // how many distinct landing-page links point at each target
  entriesPerTargetHistogram: dist,
  comboHistogram: combo,
  samples: targets.slice(0, 5).map((t) => ({ target: t, ...perTarget[t] })),
};

const tmp = path.join(os.tmpdir(), 'cr2bm-entries.json');
fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
console.log('written: ' + tmp);
