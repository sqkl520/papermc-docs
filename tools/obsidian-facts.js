'use strict';
/**
 * obsidian-facts.js — data facts the Obsidian exporter needs, computed from the archives.
 *
 * Reports: note-name collisions, image inventory, internal link graph, heading anchors,
 * and the per-section structure derived from data/source-nav.json.
 *
 * Usage: node tools/obsidian-facts.js [--json]
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const ARCHIVE = path.join(REPO, 'archive');
const SECTIONS = ['paper', 'velocity', 'folia'];

/** absolute path of a page's rendered markdown */
function mdPathOf(p) {
  return path.join(ARCHIVE, p.section, 'markdown', p.rel + '.md');
}

const nav = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'source-nav.json'), 'utf8'));
let tax = null;
try { tax = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'taxonomy.json'), 'utf8')); } catch { /* optional */ }

const pages = [];
for (const sec of SECTIONS) {
  const man = JSON.parse(fs.readFileSync(path.join(ARCHIVE, sec, 'manifest.json'), 'utf8'));
  for (const p of man.pages || []) {
    const mdAbs = path.join(ARCHIVE, sec, p.file || ('markdown/' + p.rel + '.md'));
    const md = fs.existsSync(mdAbs) ? fs.readFileSync(mdAbs, 'utf8') : '';
    pages.push({
      section: sec, rel: p.rel, url: p.url, title: p.title,
      description: p.description || '', sha256: p.sha256 || '', fetchedAt: p.fetchedAt || '',
      assets: p.assets || 0, mdBytes: Buffer.byteLength(md, 'utf8'), md,
    });
  }
}

// ---------- 1. name collisions ----------
const byTitle = new Map();
for (const p of pages) {
  const key = p.title.trim();
  if (!byTitle.has(key)) byTitle.set(key, []);
  byTitle.get(key).push(p);
}
const collisions = [...byTitle].filter(([, v]) => v.length > 1);

// ---------- 2. images ----------
const images = new Map();
for (const p of pages) {
  for (const m of p.md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    const src = m[2];
    if (/^[a-z]+:/i.test(src) && !src.startsWith('https://docs.papermc.io/')) { images.set(src, (images.get(src) || 0) + 1); continue; }
    const abs = path.resolve(path.dirname(mdPathOf(p)), src);
    const base = path.basename(src);
    if (!images.has(base)) images.set(base, { count: 0, abs, exists: fs.existsSync(abs), pages: [] });
    const e = images.get(base);
    if (typeof e === 'object') { e.count++; e.pages.push(p.section + ':' + p.rel); }
  }
}
const imageList = [...images].filter(([, v]) => typeof v === 'object');
const imgMissing = imageList.filter(([, v]) => !v.exists);
const imgDupName = [...new Set(imageList.map(([k]) => k))].length !== imageList.length;

// ---------- 3. internal links ----------
const urlToPage = new Map();
for (const p of pages) {
  urlToPage.set(p.url, p);
  urlToPage.set(p.url.replace(/\/$/, ''), p);
}
let internalMdLinks = 0;
let internalResolved = 0;
let absoluteDocsLinks = 0;
let anchorsUsed = new Set();
for (const p of pages) {
  const dir = path.dirname(mdPathOf(p));
  for (const m of p.md.matchAll(/\]\(([^)\s]+)\)/g)) {
    const t = m[1];
    const [file, frag] = t.split('#');
    if (frag) anchorsUsed.add(frag);
    if (/^https?:\/\/docs\.papermc\.io\//.test(file)) { absoluteDocsLinks++; if (urlToPage.has(file.replace(/\/$/, ''))) internalResolved++; continue; }
    if (/^[a-z]+:/i.test(file) || file.startsWith('#')) continue;
    if (file.endsWith('.md')) {
      internalMdLinks++;
      const abs = path.resolve(dir, file);
      if (fs.existsSync(abs)) internalResolved++;
    }
  }
}

// ---------- 4. headings (anchor targets) ----------
const headingCount = pages.reduce((a, p) => a + (p.md.match(/^#{1,6} /gm) || []).length, 0);
const headingSamples = pages.slice(0, 2).flatMap((p) => (p.md.match(/^#{2,3} .*$/gm) || []).slice(0, 4).map((h) => p.section + ' | ' + h.trim()));

// ---------- 5. nav structure ----------
const navSummary = nav.sections.map((s) => {
  const count = (nodes) => nodes.reduce((a, n) => a + (n.kind === 'page' ? 1 : count(n.children || [])), 0);
  const groups = [];
  const walk = (nodes, depth, prefix) => {
    for (const n of nodes) {
      if (n.kind === 'group') { groups.push({ path: prefix.concat(n.label).join(' › '), depth: depth + 1, pages: count(n.children || []) }); walk(n.children || [], depth + 1, prefix.concat(n.label)); }
    }
  };
  walk(s.groups || [], 0, []);
  return { id: s.id, title: s.title, pages: s.pageCount, inNav: count(s.groups || []), groupCount: groups.length, maxDepth: Math.max(0, ...groups.map((g) => g.depth)), groups };
});

const out = {
  generated_at: new Date().toISOString(),
  totals: {
    pages: pages.length,
    bySection: Object.fromEntries(SECTIONS.map((s) => [s, pages.filter((p) => p.section === s).length])),
    headings: headingCount,
    internalMdLinks, internalResolved, absoluteDocsLinks,
    uniqueImages: imageList.length,
    imageRefs: imageList.reduce((a, [, v]) => a + v.count, 0),
    anchors: anchorsUsed.size,
  },
  nameCollisions: collisions.map(([title, list]) => ({ title, count: list.length, where: list.map((p) => p.section + ':' + p.rel) })),
  images: {
    missing: imgMissing.map(([k, v]) => ({ name: k, file: path.relative(REPO, v.abs) })),
    duplicateBasenames: imgDupName,
    top: imageList.sort((a, b) => b[1].count - a[1].count).slice(0, 8).map(([k, v]) => ({ name: k, refs: v.count, exists: v.exists })),
  },
  nav: navSummary,
  headingSamples,
};

if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(REPO, 'reports', 'obsidian-facts.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('wrote reports/obsidian-facts.json');
} else {
  console.log('pages:', out.totals.pages, JSON.stringify(out.totals.bySection));
  console.log('headings:', out.totals.headings, '| internal .md links:', internalMdLinks, '(resolved', internalResolved + ')', '| absolute docs links:', absoluteDocsLinks);
  console.log('images:', out.totals.uniqueImages, 'unique /', out.totals.imageRefs, 'refs | missing:', out.images.missing.length, '| duplicate basenames:', out.images.duplicateBasenames);
  console.log('anchors referenced:', out.totals.anchors);
  console.log('\n=== name collisions (' + collisions.length + ') ===');
  collisions.forEach(([title, list]) => console.log('  ' + title.padEnd(34) + list.map((p) => p.section + ':' + p.rel).join('  ,  ')));
  console.log('\n=== nav structure ===');
  for (const s of navSummary) console.log('  ' + s.id.padEnd(9) + 'pages=' + String(s.pages).padEnd(4) + 'groups=' + String(s.groupCount).padEnd(3) + 'maxDepth=' + s.maxDepth + '  groups: ' + s.groups.slice(0, 6).map((g) => g.path + '(' + g.pages + ')').join(' | '));
  console.log('\n=== heading samples ===');
  headingSamples.forEach((h) => console.log('  ' + h));
}
