'use strict';
/**
 * b2b2-imgscan.js — 静态扫描全站 <img> 属性（只读；D 组的静态部分）
 * 用法：node tools/b2b2-imgscan.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'archive', 'tools', 'reports', '.git']);

function scan() {
const htmls = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmls.push(p);
  }
})(ROOT);

const cls = new Map();
const tally = (m, k) => m.set(k, (m.get(k) || 0) + 1);

let total = 0; let contentImg = 0; let altEmpty = 0; let lazy = 0; let eager = 0;
let withSrc = 0; let withW = 0; let withH = 0; let withBoth = 0; let withAspect = 0;
const perPage = [];

for (const f of htmls) {
  const s = fs.readFileSync(f, 'utf8');
  const tags = s.match(/<img\b[^>]*>/gi) || [];
  if (!tags.length) continue;
  let pCount = 0; let pBoth = 0;
  for (const t of tags) {
    total++; pCount++;
    const cm = t.match(/class="([^"]*)"/);
    const c = cm ? cm[1] : '(none)';
    tally(cls, c);
    if (/content-img/.test(c)) contentImg++;
    if (/alt=""/.test(t)) altEmpty++;
    if (/loading="lazy"/.test(t)) lazy++; else eager++;
    if (/src="[^"]+"/.test(t)) withSrc++;
    const hasW = /\swidth\s*=/.test(t);
    const hasH = /\sheight\s*=/.test(t);
    if (hasW) withW++;
    if (hasH) withH++;
    if (hasW && hasH) { withBoth++; pBoth++; }
    if (/aspect-ratio/.test(t) || /\sstyle="[^"]*aspect-ratio/.test(t)) withAspect++;
  }
  perPage.push({ file: path.relative(ROOT, f), imgs: pCount, withBoth: pBoth });
}

const css = fs.readFileSync(path.join(ROOT, 'assets', 'site.css'), 'utf8');

const out = {
  htmlFiles: htmls.length,
  pagesWithImg: perPage.length,
  imgTags: total,
  contentImg, altEmpty, lazy, eager, withSrc,
  withW, withH, withBoth, withAspect,
  cssHasAspectRatio: /aspect-ratio/.test(css),
  classes: [...cls.entries()].sort((a, b) => b[1] - a[1]),
  topPages: perPage.sort((a, b) => b.imgs - a.imgs).slice(0, 15),
  pagesNoDim: perPage.filter((p) => p.withBoth === 0).length,
};
return out;
}

const out = scan();
const TMP = path.join(require("os").tmpdir() || '.', 'b2b2');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'imgscan.json'), JSON.stringify(out, null, 1), 'utf8');
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
