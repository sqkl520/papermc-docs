'use strict';
/**
 * url-parity.js — assert that the published site URLs match the upstream docs URLs.
 *
 * For every mirrored page the site must expose exactly the upstream path:
 *   https://docs.papermc.io/paper/dev/project-setup/  ->  <site>/paper/dev/project-setup/
 * and the file that serves it must be <repo>/<section>/<rel>.html.
 *
 * Usage: node tools/url-parity.js
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const ARCHIVE = path.join(REPO, 'archive');
const UPSTREAM = 'https://docs.papermc.io';
/** 站点镜像的分区目录（paper / velocity / folia） */
const SECTIONS = ['paper', 'velocity', 'folia'];

let total = 0;
let same = 0;
const bad = [];

for (const section of SECTIONS) {
  const man = JSON.parse(fs.readFileSync(path.join(ARCHIVE, section, 'manifest.json'), 'utf8'));
  for (const p of man.pages || []) {
    total++;
    const upstreamPath = new URL(p.url).pathname;                 // /paper/dev/project-setup/
    const localFile = path.join(REPO, section, p.rel + '.html');  // <repo>/paper/dev/project-setup/index.html
    const seg = p.rel.replace(/\/?index$/, '');                   // '' for the section root
    const localUrlPath = '/' + section + '/' + (seg ? seg + '/' : '');
    const expectedPath = upstreamPath.endsWith('/') ? upstreamPath : upstreamPath + '/';
    const okFile = fs.existsSync(localFile);
    const okPath = localUrlPath === expectedPath;
    if (okFile && okPath) same++;
    else bad.push({ section, rel: p.rel, upstreamPath: expectedPath, localUrlPath, file: path.relative(REPO, localFile), fileExists: okFile });
  }
}

console.log('pages checked:', total);
console.log('URL + file parity:', same + '/' + total);
if (bad.length) {
  console.log('\nmismatches:');
  bad.slice(0, 20).forEach((b) => console.log('  ' + JSON.stringify(b)));
}

// also verify sitemap covers every page
const sitemap = fs.readFileSync(path.join(REPO, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
let inSitemap = 0;
for (const section of SECTIONS) {
  const man = JSON.parse(fs.readFileSync(path.join(ARCHIVE, section, 'manifest.json'), 'utf8'));
  for (const p of man.pages || []) {
    const want = 'https://sqkl520.github.io/papermc-docs/' + section + '/' + p.rel.replace(/\/?index$/, '') + '/';
    if (locs.includes(want)) inSitemap++;
    else if (p.rel === 'index' && locs.includes('https://sqkl520.github.io/papermc-docs/' + section + '/')) inSitemap++;
    else bad.push({ sitemap_missing: want });
  }
}
console.log('sitemap entries:', locs.length, '| pages present in sitemap:', inSitemap + '/' + total);

console.log('\nRESULT:', same === total && inSitemap === total ? 'PASS' : 'FAIL');
if (same !== total || inSitemap !== total) process.exitCode = 1;
