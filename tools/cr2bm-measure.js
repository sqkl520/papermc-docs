// cr2bm-measure.js — read-only measurement of the built landing page + sidebar.
// Writes intermediate JSON to os.tmpdir(); never writes into the repo.
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function slice(from, to) {
  const a = html.indexOf(from);
  if (a < 0) return '';
  const b = to ? html.indexOf(to, a) : html.length;
  return html.slice(a, b < 0 ? html.length : b);
}

// Landmarks actually present in the built file.
const marks = {};
for (const needle of ['<aside', '</aside>', 'id="main"', '<main', '</main>', '<footer', 'class="stat"', 'entry-card', 'src-item', '目录结构']) {
  marks[needle] = html.indexOf(needle);
}

const aside = slice('id="sidebar"', '</nav>');
const main = slice('id="main"', '</main>');
marks.asideChars = aside.length;
marks.mainChars = main.length;

// Walk the aside markup tracking <details> depth so we can tell which links are
// visible on first paint (links inside closed <details> are hidden until opened).
function census(chunk) {
  let groups = 0, openGroups = 0, links = 0, vis = 0, hid = 0;
  const stack = [];
  const re = /<details([^>]*)>|<\/details>|<a\s[^>]*>/g;
  let m;
  while ((m = re.exec(chunk))) {
    const tok = m[0];
    if (tok.startsWith('<details')) {
      const open = /\bopen\b/.test(m[1] || '');
      stack.push(open);
      groups++;
      if (open) openGroups++;
    } else if (tok === '</details>') stack.pop();
    else {
      links++;
      // A link is visible on first paint only when every ancestor <details> is open.
      if (stack.every(Boolean)) vis++;
      else hid++;
    }
  }
  return { linksTotal: links, linksVisibleFirstPaint: vis, linksInClosedGroups: hid, groups, groupsOpenByDefault: openGroups };
}

const treeIdx = main.indexOf('目录结构');
const treeSection = treeIdx >= 0 ? main.slice(treeIdx) : '';

const headings = [...main.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').trim());

const out = {
  generatedAt: new Date().toISOString(),
  source: path.join(root, 'index.html'),
  htmlBytes: Buffer.byteLength(html, 'utf8'),
  marks,
  aside: census(aside),
  main: {
    anchors: (main.match(/<a\s/g) || []).length,
    statCards: (main.match(/class="stat"/g) || []).length,
    entryCards: (main.match(/class="entry-card"/g) || []).length,
    sectionHeads: (main.match(/class="section-head"/g) || []).length,
    headings,
    tree: {
      anchors: (treeSection.match(/<a\s/g) || []).length,
      details: (treeSection.match(/<details/g) || []).length,
      chars: treeSection.length,
    },
  },
  wholeDoc: { anchors: (html.match(/<a\s/g) || []).length, details: (html.match(/<details/g) || []).length },
};

const tmp = path.join(os.tmpdir(), 'cr2bm-measure.json');
fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
console.log('written: ' + tmp);
