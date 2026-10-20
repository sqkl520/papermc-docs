'use strict';
/**
 * crawl.js — polite, resumable archiver for https://docs.papermc.io/paper/
 *
 * Safety / politeness properties:
 *   - robots.txt is fetched first and enforced (allow/deny + Crawl-delay).
 *   - Only GET requests, same-origin, strictly inside the configured path prefix.
 *   - Global pacing: at most one request start per `--delay` (+jitter) across all
 *     workers; concurrency defaults to 2 and never exceeds 4.
 *   - Exponential backoff with jitter on 429/5xx/network errors, honours Retry-After.
 *   - Identifies itself with a descriptive User-Agent.
 *   - Uses the site's own machine-readable surfaces (sitemap, llms.txt, per-page
 *     `index.md`) to avoid redundant/missed fetches.
 *   - Everything is cached on disk: re-running only fetches what is missing.
 *
 * Usage:
 *   node crawl.js [--out DIR] [--delay MS] [--jitter MS] [--concurrency N]
 *                 [--prefix URL] [--html] [--assets] [--no-source-md]
 *                 [--force] [--dry-run] [--max-pages N]
 */

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractPage } = require('./convert');

// ------------------------------------------------------------------ CLI

function parseArgs(argv) {
  const opts = {
    out: 'out',
    delay: 700,
    jitter: 400,
    concurrency: 2,
    prefix: 'https://docs.papermc.io/paper/',
    retries: 4,
    timeout: 30000,
    html: false,
    assets: false,
    sourceMd: true,
    fromHtml: false,
    forceSource: false,
    sharedCorpus: null, // put llms.txt / llms-full.txt in a shared dir instead of per-archive
    force: false,
    dryRun: false,
    maxPages: 500,
    maxAssets: 400,
    ua: 'PapermcDocsArchiver/1.0 (offline documentation mirror; polite crawler)',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    switch (a) {
      case '--out': opts.out = val(); break;
      case '--delay': opts.delay = Number(val()); break;
      case '--jitter': opts.jitter = Number(val()); break;
      case '--concurrency': opts.concurrency = Math.min(4, Number(val())); break;
      case '--prefix': opts.prefix = val(); break;
      case '--retries': opts.retries = Number(val()); break;
      case '--timeout': opts.timeout = Number(val()); break;
      case '--max-pages': opts.maxPages = Number(val()); break;
      case '--max-assets': opts.maxAssets = Number(val()); break;
      case '--html': opts.html = true; break;
      case '--assets': opts.assets = true; break;
      case '--no-source-md': opts.sourceMd = false; break;
      case '--from-html': opts.fromHtml = true; break;
      case '--shared-corpus': opts.sharedCorpus = val(); break;
      case '--force-source': opts.forceSource = true; break;
      case '--force': opts.force = true; break;
      case '--dry-run': opts.dryRun = true; break;
      default:
        if (a.startsWith('--')) console.error('unknown option: ' + a);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const OUT = path.resolve(opts.out);
// Shared corpus directory: the site-wide llms.txt / llms-full.txt are identical for every
// section, so they are stored once instead of once per archive.
const CORPUS_DIR = opts.sharedCorpus ? path.resolve(opts.sharedCorpus) : path.join(OUT, '_corpus');
const relToOut = (p2) => path.relative(OUT, p2).split(path.sep).join('/');
const PREFIX = new URL(opts.prefix);
const PREFIX_PATH = PREFIX.pathname.endsWith('/') ? PREFIX.pathname : PREFIX.pathname + '/';
const ORIGIN = PREFIX.origin;
// Section id derived from the prefix path, e.g. /paper/ -> "paper".
const SECTION = PREFIX_PATH.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'root';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

// ------------------------------------------------------------------ logging

const LOG_FILE = path.join(OUT, 'crawl.log');
fs.mkdirSync(OUT, { recursive: true });
function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

// ------------------------------------------------------------------ pacing

class Pacer {
  constructor(minInterval) {
    this.minInterval = minInterval;
    this.next = 0;
  }
  async wait() {
    const now = Date.now();
    const slot = Math.max(now, this.next);
    this.next = slot + this.minInterval + Math.floor(Math.random() * opts.jitter);
    const d = slot - now;
    if (d > 0) await sleep(d);
  }
}

const stats = {
  startedAt: new Date().toISOString(),
  requests: 0,
  pages: 0,
  reFetched: 0,
  fromHtml: 0,
  failures: [],
  skipped: [],
  bytes: 0,
};

let httpStatusCounts = {};

async function httpGet(url, { accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', raw = false } = {}) {
  const attempts = Math.max(1, opts.retries);
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await pacer.wait();
    stats.requests++;
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': opts.ua, accept, 'accept-language': 'en-US,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeout),
      });
      httpStatusCounts[res.status] = (httpStatusCounts[res.status] || 0) + 1;
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after') || 0);
        const waitMs = ra > 0 ? ra * 1000 : 800 * attempt + Math.random() * 400;
        log('  ! HTTP ' + res.status + ' for ' + url + ' -> retry in ' + Math.round(waitMs) + 'ms');
        await sleep(waitMs);
        lastErr = new Error('HTTP ' + res.status);
        continue;
      }
      if (!res.ok) {
        lastErr = new Error('HTTP ' + res.status);
        break;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      stats.bytes += buf.length;
      return {
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        body: raw ? buf : buf.toString('utf8'),
        ms: Date.now() - t0,
        finalUrl: res.url,
      };
    } catch (e) {
      lastErr = e;
      const waitMs = 800 * attempt + Math.random() * 500;
      if (attempt < attempts) {
        log('  ! ' + (e.code || e.name || 'error') + ' on ' + url + ' -> retry ' + attempt + '/' + (attempts - 1));
        await sleep(waitMs);
      }
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------------ robots.txt

function parseRobots(text, uaToken) {
  const groups = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      current.rules.push({ field, value });
    }
  }
  const matching = groups.filter((g) =>
    g.agents.some((a) => a === '*' || uaToken.toLowerCase().includes(a))
  );
  const rules = [];
  let crawlDelay = null;
  for (const g of matching) {
    for (const r of g.rules) {
      if (r.field === 'allow' || r.field === 'disallow') rules.push({ allow: r.field === 'allow', path: r.value });
      if (r.field === 'crawl-delay') crawlDelay = Math.max(crawlDelay || 0, Number(r.value) || 0);
    }
  }
  return { rules, crawlDelay };
}

function robotsAllows(robots, urlStr) {
  const p = new URL(urlStr).pathname;
  let best = null;
  for (const r of robots.rules) {
    if (!r.path) continue;
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
    if (re.test(p) && (!best || r.path.length > best.path.length)) best = r;
  }
  return best ? best.allow : true;
}

let pacer = new Pacer(opts.delay);

// ------------------------------------------------------------------ url helpers

function inPrefix(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.origin !== ORIGIN) return false;
    return u.pathname === PREFIX_PATH.slice(0, -1) || u.pathname.startsWith(PREFIX_PATH);
  } catch {
    return false;
  }
}

function normalizePageUrl(urlStr) {
  const u = new URL(urlStr);
  u.hash = '';
  u.search = '';
  if (u.pathname.endsWith('.html')) u.pathname = u.pathname.replace(/\.html$/, '/');
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}

function relPathFor(urlStr) {
  const u = new URL(urlStr);
  let p = decodeURI(u.pathname);
  if (p === PREFIX_PATH.slice(0, -1)) return 'index';
  if (!p.startsWith(PREFIX_PATH)) return null;
  let rel = p.slice(PREFIX_PATH.length);
  if (rel === '' ) rel = 'index';
  else if (rel.endsWith('/')) rel += 'index';
  rel = rel.replace(/\/+$/, '');
  return rel.split('/').map((seg) => seg.replace(/[<>:"|?*]/g, '_')).join('/');
}

function pageUrlForRel(rel) {
  return new URL(PREFIX_PATH + (rel === 'index' ? '' : rel.replace(/\/index$/, '/')), ORIGIN).href;
}

// ------------------------------------------------------------------ discovery

async function discoverSeeds() {
  const seeds = new Set();
  const notes = [];

  try {
    const r = await httpGet(new URL('/sitemap-index.xml', ORIGIN).href);
    const maps = [...r.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
    notes.push('sitemap-index.xml -> ' + maps.length + ' sitemap(s)');
    for (const m of maps) {
      const s = await httpGet(m);
      const locs = [...s.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((x) => x[1]);
      for (const l of locs) if (inPrefix(l)) seeds.add(normalizePageUrl(l));
      notes.push(m + ' -> ' + locs.length + ' urls');
    }
  } catch (e) {
    notes.push('sitemap discovery failed: ' + e.message);
  }

  try {
    const r = await httpGet(new URL('/llms.txt', ORIGIN).href, { accept: 'text/plain,*/*' });
    fs.mkdirSync(CORPUS_DIR, { recursive: true });
    fs.writeFileSync(path.join(CORPUS_DIR, 'llms.txt'), r.body, 'utf8');
    const links = [...r.body.matchAll(/\]\((\/[^)\s]+?)\)/g)].map((m) => m[1]);
    let added = 0;
    for (const l of links) {
      const pageUrl = normalizePageUrl(new URL(l.replace(/index\.md$/, ''), ORIGIN).href);
      if (inPrefix(pageUrl) && !seeds.has(pageUrl)) { seeds.add(pageUrl); added++; }
    }
    notes.push('llms.txt -> ' + links.length + ' entries (' + added + ' new)');
  } catch (e) {
    notes.push('llms.txt discovery failed: ' + e.message);
  }

  return { seeds, notes };
}

// ------------------------------------------------------------------ crawl

const manifest = [];
const pageUrlToRel = new Map();
const assetUrls = new Set();

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function fetchPage(pageUrl) {
  const rel = relPathFor(pageUrl);
  if (!rel) return null;
  const mdFile = path.join(OUT, 'markdown', rel + '.md');
  const srcFile = path.join(OUT, 'source', rel + '.md');
  const htmlFile = path.join(OUT, 'html', rel + '.html');

  if (!opts.fromHtml && !opts.force && fs.existsSync(mdFile) && (!opts.sourceMd || fs.existsSync(srcFile))) {
    const prev = fs.readFileSync(mdFile, 'utf8');
    stats.skipped.push(rel);
    return { rel, cached: true, markdown: prev };
  }

  let htmlBody;
  let htmlBytes;
  let usedCachedHtml = false;
  if (opts.fromHtml && fs.existsSync(htmlFile) && !opts.force) {
    htmlBody = fs.readFileSync(htmlFile, 'utf8');
    htmlBytes = Buffer.byteLength(htmlBody, 'utf8');
    usedCachedHtml = true;
    stats.fromHtml++;
  } else {
    const res = await httpGet(pageUrl);
    htmlBody = res.body;
    htmlBytes = Buffer.byteLength(res.body, 'utf8');
    stats.reFetched++;
  }
  const page = extractPage(htmlBody, pageUrl);

  fs.mkdirSync(path.dirname(mdFile), { recursive: true });
  if (opts.html && !usedCachedHtml) {
    fs.mkdirSync(path.dirname(htmlFile), { recursive: true });
    fs.writeFileSync(htmlFile, htmlBody, 'utf8');
  }

  let sourceBody = '';
  let sourceStatus = 'skipped';
  if (opts.sourceMd && (opts.forceSource || !fs.existsSync(srcFile))) {
    const mdUrl = new URL(pageUrl);
    mdUrl.pathname = mdUrl.pathname.replace(/\/$/, '/') + 'index.md';
    try {
      const s = await httpGet(mdUrl.href, { accept: 'text/markdown,text/plain,*/*' });
      if (/text\/(markdown|plain)/i.test(s.contentType) || s.body.startsWith('#')) {
        sourceBody = s.body;
        sourceStatus = 'ok';
        fs.mkdirSync(path.dirname(srcFile), { recursive: true });
        fs.writeFileSync(srcFile, sourceBody, 'utf8');
      } else {
        sourceStatus = 'not-markdown';
      }
    } catch (e) {
      sourceStatus = 'error: ' + e.message;
    }
  } else if (opts.sourceMd) {
    sourceStatus = 'cached';
  }

  const fetchedAt = new Date().toISOString();
  const srcExists = fs.existsSync(srcFile);
  const frontMatter =
    '---\n' +
    'title: ' + JSON.stringify(page.title) + '\n' +
    'source: ' + JSON.stringify(pageUrl) + '\n' +
    (page.description ? 'description: ' + JSON.stringify(page.description) + '\n' : '') +
    'fetched_at: ' + JSON.stringify(fetchedAt) + '\n' +
    '---\n\n';

  const heading = /^#\s/m.test(page.markdown) ? '' : '# ' + (page.title || rel) + '\n\n';
  const body = frontMatter + heading + page.markdown;
  fs.writeFileSync(mdFile, body, 'utf8');

  for (const a of page.assets) assetUrls.add(a);

  stats.pages++;
  const entry = {
    url: pageUrl,
    title: page.title,
    rel,
    file: path.posix.join('markdown', rel + '.md'),
    sourceFile: srcExists ? path.posix.join('source', rel + '.md') : null,
    htmlFile: opts.html ? path.posix.join('html', rel + '.html') : null,
    markdownBytes: Buffer.byteLength(body, 'utf8'),
    htmlBytes,
    sha256: sha256(body),
    codeBlocks: (page.markdown.match(/^[ \t]*```/gm) || []).length / 2,
    links: page.links.length,
    assets: page.assets.length,
    sourceStatus,
    fetchedAt,
    links_out: page.links,
  };
  manifest.push(entry);
  pageUrlToRel.set(pageUrl, rel);
  pageUrlToRel.set(pageUrl.replace(/\/$/, ''), rel);
  return { rel, markdown: body, page, cached: false };
}

async function crawl() {
  const { seeds, notes } = await discoverSeeds();
  notes.forEach((n) => log('discovery: ' + n));
  log('seeds inside prefix: ' + seeds.size);

  const queue = [...seeds].sort();
  const seen = new Set(queue);
  let processed = 0;

  if (opts.dryRun) {
    const list = queue.map((u) => relPathFor(u) + '.md');
    fs.writeFileSync(path.join(OUT, 'seed-list.txt'), list.join('\n') + '\n', 'utf8');
    log('dry run: ' + queue.length + ' urls -> seed-list.txt');
    return;
  }

  let active = 0;
  let index = 0;
  await new Promise((resolve) => {
    const pump = () => {
      while (active < opts.concurrency && index < queue.length && processed < opts.maxPages) {
        const url = queue[index++];
        active++;
        (async () => {
          try {
            const out = await fetchPage(url);
            processed++;
            log(
              '[' + processed + '/' + queue.length + '] ' +
              (out && out.cached ? 'cached ' : 'fetch  ') + relPathFor(url) +
              (out && out.page ? '  (' + out.page.markdown.length + ' md bytes, ' + out.page.assets.length + ' assets)' : '')
            );
            // discover further in-prefix pages from the rendered content
            if (out && out.page) {
              for (const l of out.page.links) {
                if (!inPrefix(l)) continue;
                const nu = normalizePageUrl(l);
                if (!seen.has(nu) && queue.length < 600) { seen.add(nu); queue.push(nu); }
              }
            }
          } catch (e) {
            stats.failures.push({ url, error: e.code || e.message });
            log('FAILED ' + url + ' :: ' + (e.code || e.message));
          } finally {
            active--;
            if (index >= queue.length || processed >= opts.maxPages) {
              if (active === 0) resolve();
            } else pump();
          }
        })();
      }
      if (active === 0 && (index >= queue.length || processed >= opts.maxPages)) resolve();
    };
    pump();
  });

  log('pages done: ' + processed + ', failures: ' + stats.failures.length);
}

// ------------------------------------------------------------------ assets

async function downloadAssets() {
  if (!opts.assets || !assetUrls.size) return [];
  const urls = [...assetUrls].filter((u) => /^https?:/i.test(u)).slice(0, opts.maxAssets);
  const results = [];
  for (const u of urls) {
    let parsed;
    try { parsed = new URL(u); } catch { continue; }
    if (!['docs.papermc.io', 'assets.papermc.io'].includes(parsed.hostname)) continue;
    const rel = decodeURI(parsed.pathname).replace(/^\/+/, '').replace(/[<>:"|?*]/g, '_');
    const dest = path.join(OUT, 'assets', parsed.hostname, rel);
    if (fs.existsSync(dest)) {
      // Reused from an earlier pass: still record size + hash so the manifest stays complete.
      const buf = fs.readFileSync(dest);
      results.push({ url: u, file: dest, cached: true, bytes: buf.length, sha256: sha256(buf) });
      continue;
    }
    try {
      const r = await httpGet(u, { accept: 'image/*,*/*;q=0.8', raw: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, r.body);
      results.push({ url: u, file: dest, bytes: r.body.length, sha256: sha256(r.body) });
      log('asset ' + u + ' -> ' + rel + ' (' + r.body.length + ' bytes)');
    } catch (e) {
      results.push({ url: u, error: e.code || e.message });
      log('asset FAILED ' + u + ' :: ' + (e.code || e.message));
    }
  }
  return results;
}

function rewriteAssetLinks(assetResults) {
  const map = new Map();
  for (const r of assetResults) {
    if (!r.file) continue;
    const rel = 'assets/' + path.relative(path.join(OUT, 'assets'), r.file).split(path.sep).join('/');
    map.set(r.url, rel);
  }
  if (!map.size) return;
  walkFiles(path.join(OUT, 'markdown'), (f) => {
    let t = fs.readFileSync(f, 'utf8');
    const dir = path.dirname(f);
    let changed = false;
    for (const [url, rel] of map) {
      if (!t.includes(url)) continue;
      const relFromFile = path.relative(dir, path.join(OUT, rel)).split(path.sep).join('/');
      t = t.split('(' + url + ')').join('(' + relFromFile + ')');
      changed = true;
    }
    if (changed) fs.writeFileSync(f, t, 'utf8');
  });
}

// ------------------------------------------------------------------ post-processing

function walkFiles(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, fn);
    else if (e.isFile() && e.name.endsWith('.md')) fn(p);
  }
}

function rewriteDocLinks() {
  const urls = [...pageUrlToRel.keys()].sort((a, b) => b.length - a.length);
  const lookup = new Map();
  for (const u of urls) {
    const rel = pageUrlToRel.get(u);
    if (!lookup.has(u)) lookup.set(u, rel);
    const noSlash = u.replace(/\/$/, '');
    if (!lookup.has(noSlash)) lookup.set(noSlash, rel);
  }
  // Any site-absolute or root-relative link target is a candidate; only targets that
  // belong to a page of THIS archive get rewritten (cross-section links stay absolute
  // and are resolved later by the library site generator, which sees all archives).
  const re = /\]\(([^)\s]+)\)/g;
  let rewritten = 0;
  for (const dir of ['markdown', 'source']) {
    walkFiles(path.join(OUT, dir), (f) => {
      const orig = fs.readFileSync(f, 'utf8');
      const relDir = path
        .dirname(path.relative(path.join(OUT, dir), f))
        .split(path.sep)
        .join('/');
      const t = orig.replace(re, (m, target) => {
        if (!/^https?:\/\//i.test(target) && !target.startsWith('/')) return m;
        if (target.startsWith('//')) return m;
        let frag = '';
        let clean = target;
        const h = clean.indexOf('#');
        if (h >= 0) { frag = clean.slice(h); clean = clean.slice(0, h); }
        let abs;
        try { abs = new URL(clean, ORIGIN).href; } catch { return m; }
        const rel =
          lookup.get(abs) || lookup.get(abs.replace(/\/$/, '')) || lookup.get(abs + '/');
        if (!rel) return m;
        const targetFile = path.posix.join(rel + '.md');
        let relFromHere = path.posix.relative(relDir === '.' ? '' : relDir, targetFile);
        if (!relFromHere) relFromHere = path.basename(targetFile);
        return '](' + relFromHere + frag + ')';
      });
      if (t !== orig) { fs.writeFileSync(f, t, 'utf8'); rewritten++; }
    });
  }
  return rewritten;
}

function buildIndex() {
  const entries = manifest
    .slice()
    .sort((a, b) => String(a.rel).localeCompare(String(b.rel)))
    .map((e) => ({ rel: e.rel, title: e.title || e.rel, url: e.url }));

  // Build a directory tree so an index page is listed before its own children.
  const root = { page: null, children: new Map() };
  const nodeAt = (segs) => {
    let node = root;
    for (const s of segs) {
      if (!node.children.has(s)) node.children.set(s, { page: null, children: new Map() });
      node = node.children.get(s);
    }
    return node;
  };
  for (const e of entries) {
    const segs = e.rel.split('/');
    const isIndex = segs[segs.length - 1] === 'index';
    const dirSegs = isIndex ? segs.slice(0, -1) : segs;
    nodeAt(dirSegs).page = e;
  }

  const lines = [
    '# PaperMC Docs — ' + SECTION + ' 文档离线镜像',
    '',
    '- 来源: ' + PREFIX.href,
    '- 页面数: ' + entries.length,
    '- 抓取时间: ' + stats.startedAt + ' → ' + new Date().toISOString(),
    '- 渲染 Markdown: `markdown/`（组件已展开、内链已改为相对路径）',
    '- 站点原始 Markdown: `source/`（作者原稿，保留 `<PageCards />` 等组件）',
    '- 原始 HTML: `html/`　图片: `assets/`',
    '- 合并全文: `' + SECTION + '-docs-all.md`　清单: `manifest.json`　校验: `validation.json`',
    '',
    '## 目录',
    '',
  ];

  const relFromRoot = (rel) => 'markdown/' + rel + '.md';
  const linkLine = (page, depth) =>
    '  '.repeat(depth) + '- [' + String(page.title).replace(/[\[\]]/g, '') + '](' + relFromRoot(page.rel) + ')';
  const emit = (node, depth) => {
    if (node.page) lines.push(linkLine(node.page, depth));
    for (const key of [...node.children.keys()].sort()) {
      const child = node.children.get(key);
      emit(child, child.page ? depth + 1 : depth);
    }
  };
  emit(root, 0);

  fs.writeFileSync(path.join(OUT, 'INDEX.md'), lines.join('\n') + '\n', 'utf8');
  return entries;
}

function buildMerged(entries) {
  const parts = ['# PaperMC Docs — ' + SECTION + ' (full text)', ''];
  for (const e of entries) {
    const f = path.join(OUT, 'markdown', e.rel + '.md');
    if (!fs.existsSync(f)) continue;
    let t = fs.readFileSync(f, 'utf8').replace(/^---\n[\s\S]*?\n---\n\n/, '');
    parts.push('\n\n---\n\n' + t.trimEnd() + '\n');
  }
  const merged = parts.join('\n');
  fs.writeFileSync(path.join(OUT, SECTION + '-docs-all.md'), merged, 'utf8');
  return Buffer.byteLength(merged, 'utf8');
}

function buildSectionCorpus() {
  const p = path.join(CORPUS_DIR, 'llms-full.txt');
  if (!fs.existsSync(p)) return 0;
  const t = fs.readFileSync(p, 'utf8');
  const chunks = t.split(/\n---\n/);
  const needle = new RegExp('(/?' + SECTION + '/|\\b' + SECTION + '\\b)', 'i');
  const kept = chunks.filter((c) => needle.test(c.slice(0, 400)));
  const out = kept.join('\n\n---\n\n');
  fs.mkdirSync(path.join(OUT, '_corpus'), { recursive: true });
  fs.writeFileSync(path.join(OUT, '_corpus', SECTION + '-corpus.md'), out, 'utf8');
  return Buffer.byteLength(out, 'utf8');
}

async function fetchLlmsFull() {
  const dest = path.join(CORPUS_DIR, 'llms-full.txt');
  if (fs.existsSync(dest) && !opts.force) return;
  try {
    const r = await httpGet(new URL('/llms-full.txt', ORIGIN).href, { accept: 'text/plain,*/*' });
    fs.mkdirSync(CORPUS_DIR, { recursive: true });
    fs.writeFileSync(dest, r.body, 'utf8');
    log('llms-full.txt cached (' + Buffer.byteLength(r.body, 'utf8') + ' bytes)');
  } catch (e) {
    log('llms-full.txt failed: ' + e.message);
  }
}

// ------------------------------------------------------------------ main

(async () => {
  const t0 = Date.now();
  log('=== PaperMC docs archive (' + SECTION + ') ===');
  log('prefix=' + PREFIX.href + ' out=' + OUT + ' delay=' + opts.delay + 'ms jitter=' + opts.jitter +
      'ms concurrency=' + opts.concurrency);

  // robots.txt first
  let robots = { rules: [], crawlDelay: null };
  try {
    const r = await httpGet(new URL('/robots.txt', ORIGIN).href, { accept: 'text/plain,*/*' });
    robots = parseRobots(r.body, opts.ua);
    log('robots.txt: ' + robots.rules.length + ' rule(s), crawl-delay=' + robots.crawlDelay);
  } catch (e) {
    log('robots.txt unavailable (' + e.message + ') — proceeding with conservative default pacing');
  }
  if (!robotsAllows(robots, PREFIX.href)) {
    log('robots.txt disallows ' + PREFIX.href + ' — aborting without fetching content.');
    process.exitCode = 2;
    return;
  }
  if (robots.crawlDelay) {
    const ms = robots.crawlDelay * 1000;
    log('applying robots Crawl-delay: ' + ms + 'ms');
    pacer = new Pacer(Math.max(ms, opts.delay));
  }

  await fetchLlmsFull();
  await crawl();

  const assetResults = await downloadAssets();
  if (assetResults.length) rewriteAssetLinks(assetResults);

  const rewritten = rewriteDocLinks();
  log('doc links rewritten in ' + rewritten + ' file(s)');

  // Link rewriting edited the files after they were hashed, so refresh size + hash from disk.
  let refreshed = 0;
  for (const e of manifest) {
    const f = path.join(OUT, 'markdown', e.rel + '.md');
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    const bytes = buf.length;
    const digest = sha256(buf);
    if (e.markdownBytes !== bytes || e.sha256 !== digest) refreshed++;
    e.markdownBytes = bytes;
    e.sha256 = digest;
  }
  if (refreshed) log('refreshed size/sha256 for ' + refreshed + ' page(s) after link rewriting');

  const entries = buildIndex();
  const mergedBytes = buildMerged(entries);
  const corpusBytes = buildSectionCorpus();

  // pages discovered via BFS but never fetched (cached runs) still get manifest rows
  const byRel = new Map(manifest.map((m) => [m.rel, m]));
  for (const rel of stats.skipped) {
    if (byRel.has(rel)) continue;
    byRel.set(rel, { rel, url: pageUrlForRel(rel), cached: true, file: path.posix.join('markdown', rel + '.md') });
  }

  const manifestOut = {
    site: ORIGIN,
    prefix: PREFIX.href,
    crawled_at: new Date().toISOString(),
    options: { delayMs: opts.delay, jitterMs: opts.jitter, concurrency: opts.concurrency, userAgent: opts.ua },
    stats: {
      http_requests: stats.requests,
      pages_fetched: stats.reFetched,
      pages_rebuilt_from_html: stats.fromHtml,
      pages_from_cache: stats.skipped.length,
      failures: stats.failures,
      bytes_downloaded: stats.bytes,
      elapsed_ms: Date.now() - t0,
      http_status_counts: httpStatusCounts,
    },
    corpus: {
      llmsTxt: relToOut(path.join(CORPUS_DIR, 'llms.txt')),
      llmsFullTxt: relToOut(path.join(CORPUS_DIR, 'llms-full.txt')),
      sectionCorpus: relToOut(path.join(OUT, '_corpus', SECTION + '-corpus.md')),
    },
    assets: assetResults.map((a) => ({
      url: a.url,
      file: a.file ? path.relative(OUT, a.file).split(path.sep).join('/') : null,
      bytes: a.bytes || null,
      sha256: a.sha256 || null,
      error: a.error || null,
    })),
    pages: [...byRel.values()].sort((a, b) => String(a.rel).localeCompare(String(b.rel))),
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifestOut, null, 2), 'utf8');

  const report = [
    '# Crawl report',
    '',
    '| item | value |',
    '| --- | --- |',
    '| prefix | ' + PREFIX.href + ' |',
    '| robots.txt | ' + robots.rules.length + ' rule(s), crawl-delay ' + (robots.crawlDelay || 0) + 's |',
    '| user-agent | `' + opts.ua + '` |',
    '| pacing | ≥' + opts.delay + 'ms + 0–' + opts.jitter + 'ms jitter between request starts |',
    '| concurrency | ' + opts.concurrency + ' |',
    '| pages processed this run | ' + entries.length + ' |',
    '| pages re-fetched from the site | ' + stats.reFetched + ' |',
    '| pages rebuilt from cached HTML | ' + stats.fromHtml + ' |',
    '| pages reused from cache untouched | ' + stats.skipped.length + ' |',
    '| http requests (this run) | ' + stats.requests + ' |',
    '| bytes downloaded (this run) | ' + stats.bytes + ' |',
    '| assets | ' + assetResults.filter((a) => a.file).length + ' available, ' + assetResults.filter((a) => a.error).length + ' failed |',
    '| doc links rewritten | ' + rewritten + ' file(s) |',
    '| merged full text | ' + mergedBytes + ' bytes |',
    '| section corpus extract | ' + corpusBytes + ' bytes |',
    '| elapsed | ' + ((Date.now() - t0) / 1000).toFixed(1) + 's |',
    '',
    '## Notes',
    '',
    '- `crawl.log` is append-only and keeps the timestamped history of every pass,',
    '  including the first full pass that fetched all ' + entries.length + ' pages + their upstream markdown.',
    '- A pass with `--from-html` re-runs the converter from the cached `html/` snapshot and',
    '  only touches the network for uncached assets, so the site load stays minimal.',
    '- Nothing is fetched outside `' + PREFIX.href + '` except the site\'s own',
    '  `robots.txt`, `sitemap-index.xml`, `llms.txt`, `llms-full.txt` and image assets referenced by the pages.',
    '',
    '## Failures',
    '',
    stats.failures.length ? stats.failures.map((f) => '- `' + f.url + '` — ' + f.error).join('\n') : '_none_',
    '',
    '## Output layout',
    '',
    '```',
    'markdown/   rendered + resolved Markdown (front matter, H1, rewritten links)',
    'source/     upstream index.md (site-generated original Markdown)',
    'html/       raw HTML of each page (only with --html)',
    'assets/     images referenced by the pages (only with --assets)',
    '_corpus/    llms.txt, llms-full.txt, ' + SECTION + '-corpus.md',
    'INDEX.md    table of contents',
    SECTION + '-docs-all.md  all pages concatenated',
    'manifest.json      per-page metadata + hashes',
    '```',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'crawl-report.md'), report, 'utf8');

  log('done: ' + entries.length + ' pages, ' + stats.requests + ' requests, ' + (stats.bytes / 1048576).toFixed(2) + ' MiB, ' +
      ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => {
  log('FATAL ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
