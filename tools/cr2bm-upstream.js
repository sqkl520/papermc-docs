// cr2bm-upstream.js — read-only: census of the upstream (docs.papermc.io) Starlight sidebar
// as declared in astro.config.ts, fetched once and cached in os.tmpdir().
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const cache = path.join(os.tmpdir(), 'cr2bm-upstream-astro.config.ts');
const url = 'https://cdn.jsdelivr.net/gh/PaperMC/docs@main/astro.config.ts';

function fetchOnce() {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

(async () => {
  let src;
  if (fs.existsSync(cache)) src = fs.readFileSync(cache, 'utf8');
  else { src = await fetchOnce(); fs.writeFileSync(cache, src, 'utf8'); }

  // Only the sidebar topics array matters: from "starlightSidebarTopics(" to the topics option.
  const start = src.indexOf('starlightSidebarTopics(');
  const end = src.indexOf('pages excluded from sidebars', start);
  const block = src.slice(start, end < 0 ? src.length : end);

  const out = {
    generatedAt: new Date().toISOString(),
    source: url,
    cachedAt: cache,
    collapsedGroupsInUpstreamSidebar: (block.match(/collapsed:\s*true/g) || []).length,
    // "paper/xxx" style slugs are the sidebar's leaf entries
    paperLeafSlugs: (block.match(/"(paper\/[^"]+)"/g) || []).length,
    velocityLeafSlugs: (block.match(/"(velocity\/[^"]+)"/g) || []).length,
    foliaLeafSlugs: (block.match(/"(folia\/[^"]+)"/g) || []).length,
    topicIds: [...block.matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1]),
    // upstream landing page: splash template + CardGrid + ContributorList, no stats
    landingTemplate: 'splash',
  };
  const tmp = path.join(os.tmpdir(), 'cr2bm-upstream.json');
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
})();
