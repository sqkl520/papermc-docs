// cr2bm-visible.js — read-only: list the sidebar links actually visible on first paint.
// Writes intermediate JSON to os.tmpdir(); never writes into the repo.
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'assets/site.js'), 'utf8');

const a = html.indexOf('id="sidebar"');
const b = html.indexOf('</nav>', a);
const aside = html.slice(a, b);

const stack = [];
const visible = [];
const hiddenGroups = [];
const re = /<details([^>]*)>|<summary[^>]*>([\s\S]*?)<\/summary>|<\/details>|<a\s([^>]*)>([\s\S]*?)<\/a>/g;
let m;
while ((m = re.exec(aside))) {
  const tok = m[0];
  if (tok.startsWith('<details')) {
    const open = /\bopen\b/.test(m[1] || '');
    stack.push(open);
    if (!open) hiddenGroups.push(m[1].trim());
  } else if (tok === '</details>') stack.pop();
  else if (tok.startsWith('<summary')) {
    // summaries are always visible labels
  } else if (tok.startsWith('<a')) {
    const label = (m[4] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const href = ((m[3] || '').match(/href="([^"]+)"/) || [])[1] || '';
    if (stack.every(Boolean)) visible.push({ label, href });
  }
}

// Does site.js force-open groups on load (which would change first paint)?
const autoOpen = /details[^\n]*open\s*=\s*true|setAttribute\(\s*['"]open/.test(js);
const hashExpand = /hash|location\.hash/.test(js);

const out = {
  generatedAt: new Date().toISOString(),
  sidebarAnchors: (aside.match(/<a\s/g) || []).length,
  visibleOnFirstPaint: visible.length,
  visibleSamples: visible,
  collapsedGroups: hiddenGroups.length,
  siteJsAutoOpensGroups: autoOpen,
  siteJsUsesHashToExpand: hashExpand,
};

const tmp = path.join(os.tmpdir(), 'cr2bm-visible.json');
fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
