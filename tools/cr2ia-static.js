'use strict';
/**
 * cr2ia-static.js — 静态产物审计（只读 index.html / all-pages.html / snapshots.html）
 * 不运行 build-site.js，只读现有文件。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'cr2ia');
fs.mkdirSync(OUT, { recursive: true });

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const count = (s, re) => (s.match(re) || []).length;

const files = ['index.html', 'all-pages.html', 'snapshots.html', 'paper/index.html', 'paper/dev/dialogs/index.html', 'paper/reference/world-configuration/index.html', 'velocity/tuning/index.html'];

const R = { files: {}, tree: {} };

for (const f of files) {
  const s = read(f);
  const bytes = Buffer.byteLength(s, 'utf8');
  const lines = s.split('\n').length;
  // 抽 sidebar 块
  const sideM = s.match(/<nav class="sidebar"[\s\S]*?<\/nav>/);
  const mainM = s.match(/<main id="main" class="content">([\s\S]*)<\/main>/);
  const side = sideM ? sideM[0] : '';
  const main = mainM ? mainM[1] : '';
  const anchors = count(s, /<a\b/g);
  const hrefs = [...s.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1]);
  const uniqHref = new Set(hrefs);
  const norm = (h) => { let p = h.replace(/^[./]+/, '').replace(/#.*$/, ''); if (p.endsWith('index.html')) p = p.slice(0, -10); if (p === '') p = './'; return p; };
  const uniqNorm = new Set(hrefs.filter((h) => !h.startsWith('#') && !h.startsWith('http')).map(norm));
  R.files[f] = {
    bytes, KB: Math.round(bytes / 1024), lines,
    aTags: anchors,
    aWithHref: hrefs.length,
    uniqHref: uniqHref.size,
    uniqInternalNorm: uniqNorm.size,
    details: count(s, /<details\b/g),
    detailsOpen: count(s, /<details\b[^>]*\bopen\b/g),
    sideGroup: count(s, /class="side-group"/g),
    sideSec: count(s, /class="side-sec"/g),
    sideHome: count(s, /class="side-home"/g),
    srcItem: count(s, /class="src-item"/g),
    srcGroup: count(s, /class="src-group"/g),
    srcLink: count(s, /class="src-link"/g),
    tgHome: count(s, /class="tg-home"/g),
    sidebar: {
      bytes: Buffer.byteLength(side, 'utf8'),
      aTags: count(side, /<a\b/g),
      details: count(side, /<details\b/g),
      detailsOpen: count(side, /<details\b[^>]*\bopen\b/g),
      sideGroup: count(side, /class="side-group"/g),
      sideSec: count(side, /class="side-sec"/g),
      sideCat: count(side, /class="side-cat"/g),
      sideToc: count(side, /class="side-toc"/g),
      inputs: count(side, /<input\b/g),
      uls: count(side, /<ul\b/g),
      // 嵌套深度：按 <ul 累加
      maxUlNest: (() => {
        let d = 0, m = 0;
        for (const ch of side) { if (ch === '<' && side.startsWith('<ul', side.indexOf(ch))) { } }
        // 简化：用栈解析 <ul>/</ul>
        const re = /<(\/?)ul\b/g; let x;
        while ((x = re.exec(side))) { if (x[1]) d--; else { d++; if (d > m) m = d; } }
        return m;
      })(),
      maxDetailsNest: (() => {
        const re = /<(\/?)details\b/g; let x, d = 0, m = 0;
        while ((x = re.exec(side))) { if (x[1]) d--; else { d++; if (d > m) m = d; } }
        return m;
      })(),
    },
    main: {
      bytes: Buffer.byteLength(main, 'utf8'),
      aTags: count(main, /<a\b/g),
      srcTree: count(main, /class="src-tree"/g),
      h2: count(main, /<h2\b/g),
      h3: count(main, /<h3\b/g),
      stats: count(main, /class="stat"/g),
      entryCards: count(main, /class="entry-card"/g),
      qa: count(main, /class="qa"/g),
      sectionHead: count(main, /class="section-head"/g),
      catAnchor: count(main, /class="cat-anchorbar"/g),
    },
  };
}

// 首页 src-tree 每层的节点数 & 每个 section 的树高
const idx = read('index.html');
for (const sec of ['paper', 'velocity', 'folia']) {
  const m = idx.match(new RegExp('<section class="src-tree" id="tree-' + sec + '">([\\s\\S]*?)</section>'));
  if (!m) { R.tree[sec] = null; continue; }
  const body = m[1];
  R.tree[sec] = {
    bytes: Buffer.byteLength(body, 'utf8'),
    items: count(body, /class="src-item"/g),
    groups: count(body, /class="src-group"/g),
    links: count(body, /<a\b/g),
  };
}

// 无 JS 时首页可见链接（<details> 默认折叠 → 侧栏只剩 12 条渲染），由 vis.json 佐证

fs.writeFileSync(path.join(OUT, 'static.json'), JSON.stringify(R, null, 2), 'utf8');

const L = [];
L.push('== FILES ==');
for (const k of Object.keys(R.files)) {
  const f = R.files[k];
  L.push(k + '  ' + f.KB + 'KB  lines=' + f.lines + '  a=' + f.aTags + ' href=' + f.aWithHref + ' uniqHref=' + f.uniqHref + ' uniqInternal=' + f.uniqInternalNorm);
  L.push('   details=' + f.details + ' open=' + f.detailsOpen + ' sideGroup=' + f.sideGroup + ' sideSec=' + f.sideSec + ' srcItem=' + f.srcItem + ' srcGroup=' + f.srcGroup + ' tgHome=' + f.tgHome);
  L.push('   sidebar: ' + JSON.stringify(f.sidebar));
  L.push('   main: ' + JSON.stringify(f.main));
}
L.push('');
L.push('== HOME TREE PER SECTION ==');
for (const k of Object.keys(R.tree)) L.push(k + ' ' + JSON.stringify(R.tree[k]));
const txt = L.join('\n');
fs.writeFileSync(path.join(OUT, 'static.txt'), txt, 'utf8');
console.log(txt);
