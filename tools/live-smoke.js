'use strict';
/**
 * live-smoke.js — end-to-end check of the PUBLISHED site (GitHub Pages).
 *
 * Verifies that the deployed documentation site answers for the landing page, both
 * sections, deep pages, static assets, data files, the archive mirror and the 404 page.
 *
 * Usage: node tools/live-smoke.js [baseUrl]
 *        node tools/live-smoke.js --local          → http://127.0.0.1:8787
 */

const argBase = process.argv.find((a) => a.startsWith('http'));
const BASE = argBase || (process.argv.includes('--local') ? 'http://127.0.0.1:8787' : 'https://sqkl520.github.io/papermc-docs');

const urls = [
  '/',
  '/index.html',
  '/404.html',
  '/robots.txt',
  '/sitemap.xml',
  // section roots and index pages
  '/paper/',
  '/paper/index.html',
  '/velocity/',
  '/folia/',
  '/folia/faq/',
  '/folia/reference/region-logic/',
  // deep pages (URL parity with docs.papermc.io)
  '/paper/getting-started/',
  '/paper/dev/command-api/basics/introduction/',
  '/paper/reference/vanilla-data-files/',
  '/velocity/dev/plugin-messaging/',
  '/velocity/tuning/',
  // navigation & search
  '/all-pages.html',
  '/snapshots.html',
  '/sections/paper.html',
  '/sections/velocity.html',
  '/sections/folia.html',
  '/categories/paper-dev-command.html',
  '/assets/site.css',
  '/assets/site.js',
  '/assets/search-index.js',
  '/search-index.json',
  '/data/source-nav.json',
  '/data/taxonomy.json',
  // archive mirror
  '/archive/paper/markdown/index.md',
  '/archive/paper/html/dev/dialogs/index.html',
  '/archive/_common/llms.txt',
  '/archive/paper/assets/docs.papermc.io/_astro/anti-xray-overworld.CWzmAZnN_1BCGx4.webp',
  // must be 404
  '/does-not-exist-xyz',
];

(async () => {
  let ok = 0;
  let bad = 0;
  for (const p of urls) {
    try {
      const r = await fetch(BASE + p, { redirect: 'manual', signal: AbortSignal.timeout(45000) });
      const buf = Buffer.from(await r.arrayBuffer());
      const expect404 = p.includes('does-not-exist');
      const good = expect404 ? r.status === 404 : (r.status === 200 && buf.length > 0);
      if (good) ok++; else bad++;
      console.log(
        (good ? '  OK  ' : ' FAIL ') + String(r.status).padStart(3) + '  ' +
        String(buf.length).padStart(8) + ' B  ' + (r.headers.get('content-type') || '-').split(';')[0].padEnd(24) + p
      );
    } catch (e) {
      bad++;
      console.log(' FAIL  ERR  ' + p + '  ' + e.message);
    }
  }
  console.log('\nlive smoke: ' + ok + ' ok / ' + bad + ' failed   (' + BASE + ')');
  if (bad) process.exitCode = 1;
})();
