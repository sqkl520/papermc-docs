/* C4: count <img> shapes across built HTML (read-only). */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE_ROOTS = ['paper', 'velocity', 'folia', 'sections', 'categories'];
const SKIP = new Set(['node_modules', 'archive', 'assets', 'data', 'tools', 'reports', '.git']);

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else if (e.isFile() && e.name.endsWith('.html')) acc.push(path.join(dir, e.name));
  }
  return acc;
}

const files = [];
for (const r of SITE_ROOTS) {
  const abs = path.join(ROOT, r);
  if (fs.existsSync(abs)) walk(abs, files);
}
// top-level html pages too
for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (e.isFile() && e.name.endsWith('.html')) files.push(path.join(ROOT, e.name));
}

const imgRe = /<img\b[^>]*>/g;
const out = {
  files: files.length,
  imgTags: 0,
  contentImg: 0,
  contentImgWithSrc: 0,
  contentImgWithWh: 0,
  externalImage: 0,
  dataUri: 0,
  missing: 0,
  lightboxPlaceholder: 0,
  otherImgs: 0,
  placeholdersWithWh: 0,
  perPage: [],
};

for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const tags = t.match(imgRe) || [];
  const page = { file: path.relative(ROOT, f).replace(/\\/g, '/'), imgs: tags.length, contentImg: 0, withWh: 0 };
  for (const tag of tags) {
    out.imgTags += 1;
    const hasSrc = /\ssrc="/.test(tag);
    const hasWh = /\swidth="\d+"/.test(tag) && /\sheight="\d+"/.test(tag);
    if (/class="[^"]*\bcontent-img\b/.test(tag)) {
      out.contentImg += 1;
      page.contentImg += 1;
      if (hasSrc) out.contentImgWithSrc += 1;
      if (hasWh) { out.contentImgWithWh += 1; page.withWh += 1; }
      if (!hasSrc) out.missing += 1;
    } else if (/class="[^"]*\bexternal-image\b/.test(tag)) {
      out.externalImage += 1;
    } else if (!hasSrc && /alt=""/.test(tag)) {
      out.lightboxPlaceholder += 1;
      if (hasWh) out.placeholdersWithWh += 1;
    } else {
      out.otherImgs += 1;
      if (/src="data:/.test(tag)) out.dataUri += 1;
    }
  }
  if (page.imgs) out.perPage.push(page);
}

out.perPage.sort((a, b) => b.contentImg - a.contentImg);
console.log(JSON.stringify(out, null, 2));
