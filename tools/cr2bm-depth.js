// cr2bm-depth.js — read-only: sidebar nesting depth + landing-page block heights.
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const depths = {};
for (const m of html.matchAll(/class="src-list"\s+data-depth="(\d+)"/g)) {
  depths[m[1]] = (depths[m[1]] || 0) + 1;
}
const groupDepths = {};
for (const m of html.matchAll(/class="src-group"\s+style="--d:(\d+)"/g)) {
  groupDepths[m[1]] = (groupDepths[m[1]] || 0) + 1;
}

// Landing page structure: count top-level blocks between hero and footer.
const mainStart = html.indexOf('id="main"');
const mainEnd = html.indexOf('</main>', mainStart);
const main = html.slice(mainStart, mainEnd);
const blocks = [...main.matchAll(/<(div|section)\s+class="([^"]+)"/g)]
  .map((m) => m[2])
  .filter((c) => /^(hero|entry-cards|quickbar|stats|section-head|src-tree|tax|about)/.test(c));

const out = {
  generatedAt: new Date().toISOString(),
  sidebarNestingDepths: { bySrcList: depths, byGroup: groupDepths, max: Math.max(...Object.keys(depths).map(Number)) },
  landingTopLevelBlocks: blocks,
  landingByteSize: Buffer.byteLength(main, 'utf8'),
  wholeDocBytes: Buffer.byteLength(html, 'utf8'),
};
const tmp = path.join(os.tmpdir(), 'cr2bm-depth.json');
fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
