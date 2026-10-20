'use strict';
/**
 * serve.js — tiny dependency-free static server for the local library.
 *
 * Opening index.html through file:// already works (all links are relative and
 * the search index is also emitted as a JS file), but serving over http:// enables the
 * JSON search index and avoids browser restrictions on local file fetches.
 *
 * The document root is the PROJECT root (the repository root, because the site IS the repository root), because the rendered
 * pages reference the mirrored images that live in archive/<section>/assets/.
 * The site therefore lives at the document root.
 *
 * Usage:
 *   node tools/serve.js [--port 8787] [--root <dir>] [--open]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const o = { port: 8787, root: path.join(__dirname, '..'), open: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') o.port = Number(argv[++i]);
    else if (argv[i] === '--root') o.root = path.resolve(argv[++i]);
    else if (argv[i] === '--open') o.open = true;
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(opts.root);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function send(res, code, headers, body) {
  res.writeHead(code, Object.assign({ 'cache-control': 'no-cache' }, headers));
  if (body === undefined) res.end();
  else if (Buffer.isBuffer(body)) res.end(body);
  else res.end(String(body));
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'bad request');
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const target = path.join(ROOT, urlPath);
  const rel = path.relative(ROOT, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return send(res, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'forbidden');
  }
  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found: ' + urlPath);
    }
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    fs.readFile(target, (e, buf) => {
      if (e) return send(res, 500, { 'content-type': 'text/plain; charset=utf-8' }, 'read error');
      send(res, 200, { 'content-type': type, 'content-length': buf.length }, buf);
    });
  });
});

server.listen(opts.port, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + opts.port + '/';
  console.log('docs site    : ' + url);
  console.log('archive root : http://127.0.0.1:' + opts.port + '/archive/');
  console.log('document root: ' + ROOT);
  if (opts.open) {
    const { exec } = require('child_process');
    exec('start "" "' + url + '"', () => {});
  }
});
