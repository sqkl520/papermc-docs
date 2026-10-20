'use strict';
/**
 * http-smoke.js — local end-to-end check through tools/serve.js (the way a reader opens the site).
 *
 * Starts the static server on a free port, requests the landing page, both sections, deep
 * pages, static assets, mirrored archives and the 404 page, then shuts the server down.
 *
 * Usage: node tools/http-smoke.js [--port=8791]
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const port = Number((process.argv.find((a) => a.startsWith('--port=')) || '--port=8791').split('=')[1]);
const ROOT = path.resolve(__dirname, '..');

const urls = [
  '/',
  '/index.html',
  '/404.html',
  '/robots.txt',
  '/sitemap.xml',
  '/paper/',
  '/velocity/',
  '/paper/getting-started/',
  '/paper/dev/command-api/basics/introduction/',
  '/velocity/dev/plugin-messaging/',
  '/all-pages.html',
  '/snapshots.html',
  '/sections/paper.html',
  '/categories/paper-dev-command.html',
  '/assets/site.css',
  '/assets/site.js',
  '/assets/search-index.js',
  '/search-index.json',
  '/data/source-nav.json',
  '/archive/paper/markdown/dev/dialogs/index.md',
  '/archive/paper/assets/docs.papermc.io/_astro/anti-xray-overworld.CWzmAZnN_1BCGx4.webp',
  '/definitely-missing.html',
];

function get(pathname) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let len = 0;
      res.on('data', (c) => { len += c.length; });
      res.on('end', () => resolve({ pathname, status: res.statusCode, type: res.headers['content-type'] || '', bytes: len }));
    });
    req.on('error', (e) => resolve({ pathname, status: 0, type: 'ERROR ' + e.code, bytes: 0 }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ pathname, status: 0, type: 'TIMEOUT', bytes: 0 }); });
  });
}

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js'), '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

  await new Promise((s) => setTimeout(s, 1200));

  let ok = 0;
  let bad = 0;
  for (const u of urls) {
    const r = await get(u);
    const expected = u.includes('missing') ? 404 : 200;
    const pass = r.status === expected && (expected === 404 || r.bytes > 0);
    if (pass) ok++; else bad++;
    console.log(
      (pass ? '  OK  ' : ' FAIL ') + String(r.status).padStart(3) + '  ' +
      String(r.bytes).padStart(8) + ' B  ' + (r.type || '-').split(';')[0].padEnd(24) + u
    );
  }
  srv.kill();
  console.log('\nhttp smoke: ' + ok + ' ok / ' + bad + ' failed (server on port ' + port + ')');
  if (bad) process.exitCode = 1;
})();
