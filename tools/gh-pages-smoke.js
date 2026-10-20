#!/usr/bin/env node
'use strict';
/* ============================================================================
 * tools/gh-pages-smoke.js — GitHub Pages「项目页子路径」端到端冒烟检查（可复跑）
 *
 * ── 为什么必须模拟子路径 ───────────────────────────────────────────────
 * 仓库已重构：**站点根 = 仓库根**，GitHub Pages 的**项目页**地址是
 *   https://sqkl520.github.io/papermc-docs/      （形如 …/<repo>/，不在域名根）
 * 站点并不在域名根。于是：
 *   · href="/index.html"           →  解析成 https://<user>.github.io/index.html  → 404
 *   · <base href="/">              →  同上，整站链接全断
 *   · fetch('/search-index.json')  →  同上
 *   · pathname.slice(1).split('/') 这类「假设第一段是 section」的写法也会错位
 * 本脚本起一个本地服务器，把 /<repo>/* 映射到仓库根（= 站点根），**故意让站点跑在
 * 子路径下**，再用真实 HTTP 请求把整站抓一遍，因此上述写法必然暴露（而不是像
 * file:// 打开那样碰巧通过）。
 *
 * ── 新布局的产物位置（本脚本的路径常量全部按这个来） ────────────────────
 *   站点本体（随仓库发布，扫描判失败）：index.html / 404.html / all-pages.html /
 *     snapshots.html / robots.txt / sitemap.xml / assets/** / categories/** /
 *     sections/** / paper/** / velocity/** / folia/**（paper、velocity、folia 三段正文页 URL 与上游
 *     docs.papermc.io 逐段一致，旧的 library/pages/<section>/<rel>.html 已上移一层）
 *   站点数据：search-index.json（+ assets/search-index.js 兜底）、
 *     data/{taxonomy,crosslinks,md-features,build-manifest}.json
 *   归档镜像（发布，含图片与原始 HTML 快照）：archive/**（原 archives/**）
 *   开发期产物（不发布）：tools/**（含 tools/serve.js）、reports/**（已 git-ignore）
 *
 * ── 检查内容 ───────────────────────────────────────────────────────────
 *   1  必检 URL 在子路径下的 HTTP 状态与 Content-Type
 *   2  HTML 里 href/src/srcset/poster 的绝对路径扫描（严格范围 = 站点本体）
 *   3  相对路径在子路径下逐个发请求验证可达（全站链接图解算）
 *   4  下划线目录（_common / _corpus / _astro）可访问 + .nojekyll 存在
 *   5  404.html 生效且只用相对链接（含 Pages 在深层 URL 返回 404 正文的场景）
 *   6  搜索索引（json / js）可解析、内容一致
 *   7  .md / .txt 的 MIME（不得被当 text/html 渲染）
 *   8  127.0.0.1 / localhost 资源引用计数
 *   9  中文（percent-encoded）URL 处理
 *  10  Pages 体积红线：单文件 100 MiB / 站点 1 GiB，> 50 MiB 单独列清单
 *  11  git 将跟踪的文件数与字节数、顶层目录明细
 *  12  <base> 标签、根 index.html 落地页（无 meta refresh，含站点标题并链接两个分区）
 *  13  锚点（#fragment）在本页是否有对应 id/name（warn）
 *
 * ── 用法 ───────────────────────────────────────────────────────────────
 *   node tools/gh-pages-smoke.js
 *   node tools/gh-pages-smoke.js --repo=papermc-docs --seed=20261019
 *   node tools/gh-pages-smoke.js --random --concurrency=24
 *   node tools/gh-pages-smoke.js --json=reports/gh-pages-smoke.json
 *
 * 退出码：PASS → 0；FAIL → 1。
 * 产出：reports/gh-pages-smoke.json （默认，可用 --json 改；该目录已 git-ignore，不发布）
 *
 * 随机抽样默认用固定种子（--seed），因此**同一份产物跑两次结果完全一致**；
 * 需要真随机时加 --random。
 * ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');          // 仓库根 = 站点根（Pages 项目页把 /<repo>/ 映射到这里）
const DEFAULT_REPO = 'papermc-docs';                 // 项目页仓库名，映射 /<repo>/* -> 仓库根
const DEFAULT_JSON = 'reports/gh-pages-smoke.json';   // 报告目录已 git-ignore，不随站点发布
const DEFAULT_SEED = 20261019;
const CJK = /[\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/* ---- 新布局的站点目录常量（站点根 = 仓库根） --------------------------- */
// 站点本体里「目录级」的三段正文（paper/velocity/folia）+ 生成出来的分类页 / 分区页
const SITE_DIRS = ['paper', 'velocity', 'folia', 'categories', 'sections'];
// 站点根下的固定 HTML 产物
const SITE_ROOT_HTML = ['index.html', '404.html', 'all-pages.html', 'snapshots.html'];
// 站点根下的固定文本产物（robots / sitemap 里是公网绝对 URL，属允许项）
const SITE_ROOT_TEXT = ['robots.txt', 'sitemap.xml'];
// assets/** 只扫文本资源：图片/字体是二进制，读进来只会产生噪声命中
const SITE_ASSET_TEXT_RE = /\.(css|js|mjs|json|svg|txt|xml|webmanifest)$/i;
// 「生成站点本体」的前缀 —— 这些文件里的相对路径 / 本机地址问题一律判失败，其余只报警告
const SITE_FAIL_PREFIXES = ['assets/', 'categories/', 'sections/', 'paper/', 'velocity/', 'folia/'];

/* ============================== CLI ====================================== */

function parseArgs(argv) {
  const o = {
    repo: DEFAULT_REPO, port: 0, seed: DEFAULT_SEED, random: false,
    concurrency: 16, maxRefs: 4000, json: DEFAULT_JSON, maxDetails: 15, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const key = eq >= 0 ? a.slice(0, eq) : a;
    const inline = eq >= 0 ? a.slice(eq + 1) : null;
    const val = () => (inline !== null ? inline : argv[++i]);
    switch (key) {
      case '--repo': o.repo = String(val()); break;
      case '--port': o.port = Number(val()) || 0; break;
      case '--seed': o.seed = Number(val()) || DEFAULT_SEED; break;
      case '--concurrency': o.concurrency = Math.max(1, Number(val()) || 16); break;
      case '--max-refs': o.maxRefs = Math.max(50, Number(val()) || 4000); break;
      case '--json': o.json = String(val()); break;
      case '--max-details': o.maxDetails = Math.max(1, Number(val()) || 15); break;
      case '--random': o.random = true; break;
      case '--help': case '-h': o.help = true; break;
      default:
        if (key.startsWith('--')) process.stdout.write('unknown option: ' + key + '\n');
    }
  }
  return o;
}

function printHelp() {
  process.stdout.write([
    'node tools/gh-pages-smoke.js [options]',
    '',
    '  --repo=NAME        模拟的项目页仓库名（URL 前缀），默认 ' + DEFAULT_REPO,
    '  --port=N           本地端口，0 = 自动分配（默认 0）',
    '  --seed=N           抽样随机种子（默认 ' + DEFAULT_SEED + '，保证可复跑）',
    '  --random           改用真随机抽样（默认关，用固定种子）',
    '  --concurrency=N    并发请求数（默认 16）',
    '  --max-refs=N       相对链接解算上限（默认 4000）',
    '  --json=PATH        结果 JSON 路径（默认 ' + DEFAULT_JSON + '）',
    '  --max-details=N    每个检查项在 JSON 里保留的失败明细条数（默认 15）',
    '  -h, --help         显示本帮助',
    '',
  ].join('\n'));
}

/* ============================ 小工具 ===================================== */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickN(arr, n, rnd) {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

function uniq(arr) { return Array.from(new Set(arr)); }

function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }

function walkDir(dir, re, out) {
  out = out || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') walkDir(p, re, out); }
    else if (!re || re.test(e.name)) out.push(rel(p));
  }
  return out;
}

function collect(tops, re) {
  let out = [];
  for (const t of tops) {
    const abs = path.join(ROOT, t);
    try { if (fs.statSync(abs).isDirectory()) { out = walkDir(abs, re, out); continue; } } catch { continue; }
    if (!re || re.test(path.basename(abs))) out.push(rel(abs));
  }
  return out.sort();
}

/**
 * 站点本体的 HTML 文件（仓库相对路径，保持和旧代码一样只给下游「路径数组」）：
 * 站点根的 4 个固定页 + paper/velocity/folia/categories/sections 下的全部 HTML。
 */
function siteHtmlFiles() {
  return uniq(SITE_ROOT_HTML.concat(collect(SITE_DIRS, /\.html?$/i))).filter(exists);
}

/** 站点本体的全部文本文件：HTML + robots.txt/sitemap.xml + assets/** 下的文本资源 */
function siteBodyFiles() {
  return uniq(siteHtmlFiles()
    .concat(SITE_ROOT_TEXT.filter(exists))
    .concat(collect(['assets'], SITE_ASSET_TEXT_RE))).filter(exists);
}

/** 该路径是否属于「生成站点本体」（生成物，路径写错就是线上断链） */
function isSiteFile(p) {
  return SITE_ROOT_HTML.indexOf(p) >= 0 || SITE_ROOT_TEXT.indexOf(p) >= 0 ||
    SITE_FAIL_PREFIXES.some((d) => p.indexOf(d) === 0);
}

function readText(relPath) { return fs.readFileSync(path.join(ROOT, relPath), 'utf8'); }

function exists(relPath) { return fs.existsSync(path.join(ROOT, relPath)); }

function mib(bytes) { return (bytes / 1048576).toFixed(2) + ' MiB'; }

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x2f;/gi, '/').replace(/&#47;/g, '/');
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(Math.max(1, limit), Math.max(1, items.length))).fill(0).map(async () => {
    for (;;) {
      const k = i++;
      if (k >= items.length) return;
      try { out[k] = await fn(items[k], k); }
      catch (e) { out[k] = { __error: String((e && e.message) || e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

/* ====================== HTML 引用抽取与分类 ============================== */

const ATTR_RE = /\b(href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const SRCSET_RE = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function extractRefs(html) {
  const refs = [];
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(html)) !== null) {
    const raw = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
    refs.push({ attr: m[1].toLowerCase(), raw: raw, value: decodeEntities(raw).trim() });
  }
  SRCSET_RE.lastIndex = 0;
  while ((m = SRCSET_RE.exec(html)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2];
    for (const part of raw.split(',')) {
      const v = part.trim().split(/\s+/)[0];
      if (v) refs.push({ attr: 'srcset', raw: v, value: decodeEntities(v).trim() });
    }
  }
  return refs;
}

function classify(v) {
  if (!v) return 'empty';
  if (v.charAt(0) === '#') return 'fragment';
  if (/^[A-Za-z]:[\\/]/.test(v)) return 'drive';            // <drive>:\dir\file
  const sch = /^([A-Za-z][A-Za-z0-9+.\-]*):/.exec(v);
  if (sch) {
    const s = sch[1].toLowerCase();
    if (s === 'file') return 'file';
    if (s === 'http' || s === 'https') return 'external';
    return 'scheme';                                        // mailto: / data: / javascript:
  }
  if (v.startsWith('//')) return 'proto-rel';
  if (v.startsWith('/')) return 'absolute';                 // ★ 子路径下的致命写法
  if (v.startsWith('?')) return 'query';
  return 'relative';
}

function isLocalhostRef(v) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(v);
  if (!m) return false;
  const host = m[1].replace(/:\d+$/, '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host.endsWith('.localhost');
}

function scanHtmlFile(relPath) {
  const text = readText(relPath);
  const out = {
    file: relPath, total: 0, relative: 0, external: 0, fragment: 0, other: 0,
    absolute: [], fileScheme: [], drive: [], protoRel: [], localhost: [], empty: [],
    hasBaseTag: /<base\b/i.test(text),
  };
  for (const r of extractRefs(text)) {
    out.total++;
    switch (classify(r.value)) {
      case 'absolute': out.absolute.push(r); break;
      case 'file': out.fileScheme.push(r); break;
      case 'drive': out.drive.push(r); break;
      case 'proto-rel': out.protoRel.push(r); break;
      case 'external': out.external++; if (isLocalhostRef(r.value)) out.localhost.push(r); break;
      case 'relative': out.relative++; break;
      case 'fragment': out.fragment++; break;
      case 'empty': out.empty.push(r); break;
      default: out.other++;
    }
  }
  return out;
}

/* ====================== 本地服务器：模拟子路径 =========================== */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function send(res, code, type, body, extraHeaders) {
  const headers = Object.assign({ 'cache-control': 'no-store' }, extraHeaders || {});
  if (body === undefined) { res.writeHead(code, headers); return res.end(); }
  headers['content-type'] = type;
  headers['content-length'] = Buffer.byteLength(body);
  res.writeHead(code, headers);
  res.end(body);
}

function startServer(repo, port) {
  const prefix = '/' + repo + '/';
  const hits = [];
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
    catch {
      hits.push({ url: req.url, status: 400, scope: 'bad-encoding' });
      return send(res, 400, 'text/plain; charset=utf-8', 'bad request\n');
    }

    const notFound = (scope) => {
      hits.push({ url: req.url, status: 404, scope: scope });
      // GitHub Pages 行为：404 时返回仓库根 404.html 的正文，URL 不变。
      const p = path.join(ROOT, '404.html');
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        const headers = {
          'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8',
          'content-length': buf.length, 'x-smoke-404-page': '404.html', 'x-smoke-scope': scope,
        };
        res.writeHead(404, headers);
        return res.end(buf);
      }
      return send(res, 404, 'text/plain; charset=utf-8', 'not found (no 404.html)\n', { 'x-smoke-scope': scope });
    };

    // /<repo>  →  /<repo>/   （Pages 的规范化跳转）
    if (pathname === '/' + repo) {
      hits.push({ url: req.url, status: 301, scope: 'inside' });
      res.writeHead(301, { location: prefix, 'cache-control': 'no-store', 'x-smoke-scope': 'inside' });
      return res.end();
    }
    // 子路径之外一律 404 —— 这正是真机上的表现（域名根不属于本项目）
    if (!pathname.startsWith(prefix)) return notFound('outside');

    let relPath = pathname.slice(prefix.length);
    if (relPath === '') relPath = 'index.html';
    if (relPath.endsWith('/')) relPath += 'index.html';

    const target = path.resolve(ROOT, relPath);
    const inside = path.relative(ROOT, target);
    if (inside.startsWith('..') || path.isAbsolute(inside)) return notFound('traversal');

    let st = null;
    try { st = fs.statSync(target); } catch { st = null; }
    if (st && st.isDirectory()) {
      const idx = path.join(target, 'index.html');
      if (!fs.existsSync(idx)) return notFound('inside');
      st = fs.statSync(idx);
      return serveFile(idx, st, pathname, res, hits);
    }
    if (!st || !st.isFile()) return notFound('inside');
    return serveFile(target, st, pathname, res, hits);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server: server,
        hits: hits,
        port: addr.port,
        prefix: prefix,
        base: 'http://127.0.0.1:' + addr.port + prefix,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function serveFile(file, st, pathname, res, hits) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const buf = fs.readFileSync(file);
  hits.push({ url: pathname, status: 200, scope: 'inside', bytes: st.size });
  res.writeHead(200, {
    'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store',
    'x-smoke-scope': 'inside',
  });
  res.end(buf);
}

/* ====================== git / .gitignore 统计 ============================ */

function gitTrackedPaths() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    return { source: 'git ls-files -z --cached --others --exclude-standard', paths: out.split('\0').filter(Boolean) };
  } catch (e) {
    return { source: 'git 不可用，使用 .gitignore 近似模拟', paths: null, error: String((e && e.message) || e) };
  }
}

const DEFAULT_IGNORES = ['node_modules/', '.tmp-*', '*.log', 'crawl-*.log', '*.tmp',
  'npm-debug.log*', '.DS_Store', 'Thumbs.db', 'desktop.ini'];

function simulateIgnore(paths) {
  const lines = exists('.gitignore') ? readText('.gitignore').split(/\r?\n/) : [];
  const rules = [];
  for (let line of lines) {
    line = line.trim();
    if (!line || line.charAt(0) === '#') continue;
    let neg = false;
    if (line.charAt(0) === '!') { neg = true; line = line.slice(1); }
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const parts = line.split('/').filter((x) => x !== '' && x !== '.');
    rules.push({ neg: neg, dirOnly: dirOnly, parts: parts });
  }
  const segMatch = (pat, seg) => {
    if (pat === '**') return true;
    const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
    return re.test(seg);
  };
  const matches = (rule, segs, isDir) => {
    if (rule.dirOnly && !isDir) return false;
    const parts = rule.parts;
    if (!parts.length) return false;
    if (parts.length === 1) {
      for (let i = 0; i < segs.length; i++) if (segMatch(parts[0], segs[i])) return true;
      return false;
    }
    if (parts[0] === '**') return segMatch(parts[parts.length - 1], segs[segs.length - 1]);
    if (segs.length < parts.length) return false;
    const off = segs.length - parts.length;
    for (let i = 0; i < parts.length; i++) if (!segMatch(parts[i], segs[off + i])) return false;
    return true;
  };
  const ignored = [];
  const kept = [];
  for (const p of paths) {
    const segs = p.split('/');
    let ign = false;
    for (const r of rules) {
      // 目录规则的语义：路径上任意前缀目录被匹配 → 整个文件被忽略
      let hit = false;
      if (r.dirOnly) {
        for (let i = 1; i <= segs.length; i++) {
          if (matches(r, segs.slice(0, i), i === segs.length ? false : true) && i < segs.length) { hit = true; break; }
        }
        if (!hit && matches(r, segs, true)) hit = true;
      } else {
        hit = matches(r, segs, false);
      }
      if (hit) ign = !r.neg;
    }
    (ign ? ignored : kept).push(p);
  }
  return { ignored: ignored, kept: kept };
}

function analyzeRepo(opts, checksNote) {
  const all = collect(['archive', 'paper', 'velocity', 'folia', 'categories', 'sections', 'assets', 'data', 'reports', 'tools',
    '.nojekyll', '404.html', 'index.html', 'all-pages.html', 'snapshots.html', 'robots.txt', 'sitemap.xml',
    'package.json', 'package-lock.json', 'README.md', 'LICENSE-PaperMC-docs.txt', '.gitignore'], null);
  const tracked = gitTrackedPaths();
  let kept = tracked.paths;
  let ignored = null;
  let source = tracked.source;
  if (!kept) {
    const sim = simulateIgnore(all);
    kept = sim.kept;
    ignored = sim.ignored;
    source = 'fallback: .gitignore 近似模拟（git 不可用）';
  } else {
    const trackedSet = new Set(kept);
    ignored = all.filter((p) => !trackedSet.has(p));
  }
  const stat = [];
  let total = 0;
  const top = {};
  for (const p of kept) {
    let st;
    try { st = fs.statSync(path.join(ROOT, p)); } catch { continue; }
    if (!st.isFile()) continue;
    stat.push({ path: p, bytes: st.size });
    total += st.size;
    const t = p.includes('/') ? p.split('/')[0] : '(root files)';
    top[t] = (top[t] || 0) + st.size;
  }
  stat.sort((a, b) => b.bytes - a.bytes);
  const ignoredStat = [];
  let ignoredBytes = 0;
  for (const p of ignored || []) {
    let st;
    try { st = fs.statSync(path.join(ROOT, p)); } catch { continue; }
    if (!st.isFile()) continue;
    ignoredStat.push({ path: p, bytes: st.size });
    ignoredBytes += st.size;
  }
  ignoredStat.sort((a, b) => b.bytes - a.bytes);
  return {
    source: source,
    note: opts === undefined ? undefined : checksNote,
    trackedFiles: kept.length,
    trackedBytes: total,
    trackedMiB: Number((total / 1048576).toFixed(3)),
    topLevel: Object.keys(top).sort((a, b) => top[b] - top[a]).map((k) => ({ name: k, bytes: top[k], mib: Number((top[k] / 1048576).toFixed(3)) })),
    ignoredFiles: ignoredStat.length,
    ignoredBytes: ignoredBytes,
    ignoredSample: ignoredStat.slice(0, 30),
    largest: stat.slice(0, 20),
    gt50MiB: stat.filter((x) => x.bytes > 50 * 1048576),
    gt100MiB: stat.filter((x) => x.bytes > 100 * 1048576),
  };
}

/* ============================== 主流程 =================================== */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return 0; }

  const t0 = Date.now();
  const rnd = opts.random ? Math.random : mulberry32(opts.seed);
  const checks = [];
  const add = (id, title, severity, ok, stats, failures, note) => {
    const f = failures || [];
    checks.push({
      id: id, title: title, severity: severity, ok: !!ok,
      stats: stats || {},
      failureTotal: f.length,
      failures: f.slice(0, opts.maxDetails),
      failuresTruncated: f.length > opts.maxDetails,
      note: note,
    });
    return ok;
  };

  process.stdout.write('== gh-pages-smoke · GitHub Pages 项目页子路径模拟 ==\n');
  process.stdout.write('   root   : ' + ROOT + '   （仓库根 = 站点根）\n');
  process.stdout.write('   repo   : ' + opts.repo + '   (URL 前缀 /' + opts.repo + '/  → 仓库根)\n');
  process.stdout.write('   seed   : ' + (opts.random ? 'random (--random)' : opts.seed + ' (固定种子，可复跑)') + '\n\n');

  /* ---------- 1. .nojekyll ---------- */
  {
    const p = path.join(ROOT, '.nojekyll');
    const ok = fs.existsSync(p) && fs.statSync(p).isFile();
    const size = ok ? fs.statSync(p).size : -1;
    add('nojekyll', '.nojekyll 存在且为空文件（下划线目录才能在 Pages 上被发布）', 'fail',
      ok && size === 0, { path: '.nojekyll', exists: ok, bytes: size, isFile: ok },
      ok && size === 0 ? [] : [{ file: '.nojekyll', ref: '(file)', reason: ok ? '非空文件（' + size + ' B），应为 0 字节' : '文件缺失' }]);
  }

  /* ---------- 2. .gitignore ---------- */
  {
    const txt = exists('.gitignore') ? readText('.gitignore') : '';
    const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.charAt(0) !== '#');
    const negated = new Set(lines.filter((l) => l.charAt(0) === '!').map((l) => l.slice(1)));
    const plain = lines.filter((l) => l.charAt(0) !== '!');
    const required = ['node_modules/', '.tmp-*', '*.log', 'crawl-*.log', '.DS_Store', 'Thumbs.db'];
    const missing = required.filter((r) => !plain.includes(r));
    // 不能整目录忽略的目录：archive/**（归档镜像随仓库一起发布，站点页面用相对路径引用其中的图片，
    // 整目录被忽略就会断图断链）。旧布局的 archives/**、library/** 已重命名/删除，规则只作为历史残留，
    // 不判失败；reports/** 是本工具的输出目录（已 git-ignore、不发布），**允许**被忽略。
    const forbidden = plain.filter((l) => /^(archive)(\/|\*|$)/.test(l) || l === '.nojekyll' || l === '/.nojekyll');
    add('gitignore', '.gitignore 含必需忽略项，且不忽略 archive/**、.nojekyll（reports/ 允许被忽略）', 'fail',
      !!txt && !missing.length && !forbidden.length,
      { rules: plain.length, negations: negated.size, required: required, missing: missing, forbidden: forbidden },
      missing.map((m) => ({ file: '.gitignore', ref: m, reason: '缺少必需忽略项' }))
        .concat(forbidden.map((f) => ({ file: '.gitignore', ref: f, reason: '该规则会误伤必须发布的站点内容' }))));
  }

  /* ---------- 3. 站点产物清单与抽样 ---------- */
  const siteHtml = siteHtmlFiles();          // 站点本体 HTML：4 个根页 + paper / velocity / categories / sections
  const strictHtml = siteBodyFiles();        // 严格范围 = 站点本体（HTML + robots.txt/sitemap.xml + assets 文本）
  const archivesHtml = collect(['archive'], /\.html?$/i);         // 上游 HTML 快照（只读归档，发布但不算站点本体）
  const toolsHtml = collect(['tools'], /\.html?$/i);              // tools/** 下的 HTML（若有）
  const categories = collect(['categories'], /\.html$/i);
  const pages = uniq(collect(['paper'], /\.html$/i).concat(collect(['velocity'], /\.html$/i), collect(['folia'], /\.html$/i)));  // 旧 library/pages/**
  const paperImages = collect(['archive/paper/assets'], /\.(webp|png|jpe?g|gif|svg|ico)$/i);
  // 注意：collect() 只拿 basename 去匹配 filter，所以 _astro 目录要在**完整相对路径**上筛。
  const astroImages = paperImages.concat(collect(['archive'], /\.(webp|png|jpe?g|gif|svg|ico)$/i))
    .filter((p) => p.indexOf('/_astro/') >= 0);

  const titleOf = (p) => {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(readText(p));
    return m ? m[1].trim() : '';
  };
  const catPick = pickN(categories, Math.min(3, categories.length), rnd);
  const cjkPages = pages.filter((p) => CJK.test(titleOf(p)));
  const pagePick = uniq(pickN(cjkPages, Math.min(2, cjkPages.length), rnd).concat(pickN(pages, 8, rnd))).slice(0, 8);
  const imgPick = pickN(paperImages, 1, rnd);
  const astroPick = pickN(astroImages, 1, rnd);

  process.stdout.write('   sample : categories=' + catPick.length + '/' + categories.length +
    '  pages=' + pagePick.length + '/' + pages.length +
    '  (中文标题页 ' + cjkPages.length + '/' + pages.length + ')' +
    '  images=' + imgPick.length + '\n\n');

  /* ---------- 4. 必检 URL 列表 ---------- */
  const targets = [];
  const T = (p, group) => targets.push({ rel: p, group: group || 'required' });
  // 站点根的固定产物（index.html 现在是真落地页，不是 meta refresh 跳转页）
  ['index.html', 'all-pages.html', 'snapshots.html', '404.html', 'robots.txt', 'sitemap.xml']
    .forEach((p) => T(p, 'required'));
  // 三个分区的入口页（= 旧 library/pages/<section>/index.html）+ 分区源结构页
  T('paper/index.html');
  T('velocity/index.html');
  T('folia/index.html');
  T('sections/paper.html');
  T('sections/velocity.html');
  T('sections/folia.html');
  // 抽样的分类页（categories/*.html）与正文页（paper|velocity/**/*.html）
  catPick.forEach((p) => T(p, 'sampled-category'));
  pagePick.forEach((p) => T(p, 'sampled-page'));
  ['assets/site.css', 'assets/site.js', 'assets/search-index.js',
    'search-index.json',
    'archive/paper/markdown/index.md',
    'archive/paper/html/dev/dialogs/index.html',
    'archive/_common/llms.txt'].forEach((p) => T(p, 'required'));
  imgPick.forEach((p) => T(p, 'archive-image'));
  astroPick.forEach((p) => T(p, 'underscore-astro'));
  ['data/build-manifest.json', 'data/taxonomy.json', 'data/crosslinks.json', 'data/md-features.json',
    'tools/serve.js', 'archive/_common/llms-full.txt',
    'archive/paper/_corpus/paper-corpus.md', 'archive/velocity/_corpus/velocity-corpus.md',
    'archive/velocity/markdown/index.md'].forEach((p) => T(p, 'supporting'));

  /* ---------- 5. 起服务并抓取 ---------- */
  const srv = await startServer(opts.repo, opts.port);
  const BASE = srv.base;
  process.stdout.write('   server : ' + BASE + '\n');
  process.stdout.write('   fetch  : ' + targets.length + ' 个必检 URL …\n');

  const request = async (url) => {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'gh-pages-smoke/1.0' } });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status, location: res.headers.get('location') || '',
      contentType: res.headers.get('content-type') || '',
      smokeScope: res.headers.get('x-smoke-scope') || '',
      is404Body: res.headers.get('x-smoke-404-page') || '',
      bytes: buf.length, body: buf, url: url,
    };
  };

  const responses = await mapPool(targets, opts.concurrency, async (t) => {
    const r = await request(BASE + t.rel);
    return Object.assign({}, t, r, { onDisk: exists(t.rel) });
  });

  /* ---------- 6. 必检 URL：磁盘存在 + HTTP 200 ---------- */
  {
    const failures = [];
    const table = [];
    for (const r of responses) {
      const row = { rel: r.rel, group: r.group, onDisk: r.onDisk, status: r.status, contentType: r.contentType, bytes: r.bytes };
      if (r.__error) { row.error = r.__error; failures.push({ file: r.rel, ref: BASE + r.rel, reason: '请求异常: ' + r.__error }); }
      else if (!r.onDisk) failures.push({ file: r.rel, ref: BASE + r.rel, reason: '磁盘上没有这个文件' });
      else if (r.status !== 200) failures.push({ file: r.rel, ref: BASE + r.rel, reason: 'HTTP ' + r.status + '（期望 200）' });
      table.push(row);
    }
    add('http-200', '每个必检 URL 在 /<repo>/ 子路径下返回 200 且磁盘文件存在', 'fail',
      failures.length === 0,
      { requested: responses.length, ok: responses.filter((r) => r.status === 200).length, groups: uniq(targets.map((t) => t.group)) },
      failures);
    checks[checks.length - 1].table = table;
  }

  /* ---------- 7. 严格范围（站点本体）的绝对路径扫描 ---------- */
  {
    const scans = strictHtml.map(scanHtmlFile);
    const failures = [];
    const counts = { files: scans.length, refs: 0, absolute: 0, fileScheme: 0, drive: 0, protoRel: 0 };
    for (const s of scans) {
      counts.refs += s.total;
      counts.absolute += s.absolute.length;
      counts.fileScheme += s.fileScheme.length;
      counts.drive += s.drive.length;
      counts.protoRel += s.protoRel.length;
      for (const key of ['absolute', 'fileScheme', 'drive']) {
        for (const r of s[key]) {
          const label = key === 'absolute' ? '以 "/" 开头的绝对路径' : (key === 'fileScheme' ? 'file:// 引用' : 'Windows 盘符路径');
          failures.push({ file: s.file, ref: r.value, reason: label + '（属性 ' + r.attr + '）' });
        }
      }
      for (const r of s.protoRel) failures.push({ file: s.file, ref: r.value, reason: '协议相对 //host/… 在 Pages 上会跳到外站' });
    }
    // 站点本体 = 根 index.html / 404.html / all-pages.html / snapshots.html / robots.txt / sitemap.xml /
    //            assets/** / categories/** / sections/** / paper/** / velocity/** / folia/**。
    // 只判「本地绝对形式」：以 "/" 开头、盘符、file://、协议相对；https 公网绝对 URL（canonical、
    // sitemap.xml、robots.txt 里的 https://sqkl520.github.io/papermc-docs/…）是允许项，不会被匹配到。
    add('no-absolute-refs', '站点本体（根 index.html / 404.html / all-pages.html / snapshots.html / robots.txt / sitemap.xml / assets/** / categories/** / sections/** / paper/** / velocity/** / folia/**）零本地绝对路径引用', 'fail',
      failures.length === 0, counts, failures);
    checks[checks.length - 1].files = scans.filter((s) => s.total).length;
  }

  /* ---------- 8. archive 快照 HTML 的绝对路径（上游产物，记录不判失败） ---------- */
  {
    const scans = archivesHtml.map(scanHtmlFile);
    const failures = [];
    let absolute = 0, fileScheme = 0, drive = 0;
    for (const s of scans) {
      absolute += s.absolute.length; fileScheme += s.fileScheme.length; drive += s.drive.length;
      for (const r of s.absolute.slice(0, 3)) failures.push({ file: s.file, ref: r.value, reason: '上游快照自带绝对路径（只读归档，不改）' });
    }
    add('archives-snapshot-refs', 'archive/** 上游 HTML 快照的绝对路径统计（已知限制，不计入判定）', 'warn',
      true,
      { files: scans.length, absolute: absolute, fileScheme: fileScheme, drive: drive },
      failures.length ? failures : [],
      '这些是 docs.papermc.io 的原始快照（含 src="/_astro/…"、href="/paper/…"），仓库里没有对应的 _astro 产物，属于只读归档；站点导航不依赖它们。');
  }

  /* ---------- 9. 相对路径在子路径下逐个取回 ---------- */
  {
    const pagesToResolve = siteHtml;   // 站点根 4 个固定页 + paper/velocity/folia/categories/sections 下的全部 HTML
    const byUrl = new Map();
    let refCount = 0;
    for (const p of pagesToResolve) {
      const pageUrl = BASE + p;
      for (const r of extractRefs(readText(p))) {
        if (classify(r.value) !== 'relative') continue;
        refCount++;
        let u;
        try { u = new URL(r.value, pageUrl); } catch { continue; }
        if (u.origin !== srv.base.slice(0, srv.base.indexOf(srv.prefix))) continue;
        if (!byUrl.has(u.href)) byUrl.set(u.href, { from: p, ref: r.value, url: u.href });
      }
    }
    let urls = Array.from(byUrl.values());
    const truncated = urls.length > opts.maxRefs;
    if (truncated) urls = urls.slice(0, opts.maxRefs);
    process.stdout.write('   resolve: ' + urls.length + ' 个去重后的相对链接（源自 ' + pagesToResolve.length + ' 个 HTML，共 ' + refCount + ' 处引用）…\n');
    const got = await mapPool(urls, opts.concurrency, async (x) => {
      try {
        const r = await request(x.url);
        return { from: x.from, ref: x.ref, url: x.url, status: r.status, contentType: r.contentType, bytes: r.bytes, __error: null };
      } catch (e) { return { from: x.from, ref: x.ref, url: x.url, status: 0, __error: String((e && e.message) || e) }; }
    });
    const failures = got.filter((g) => !g || g.status !== 200)
      .map((g) => ({ file: g.from, ref: g.ref, reason: g.__error ? '请求异常: ' + g.__error : '解析到 ' + decodeURIComponent(g.url) + ' → HTTP ' + g.status }));
    add('relative-resolve-subpath', '全站相对链接在子路径下逐个请求可达（200）', 'fail',
      failures.length === 0,
      { htmlFiles: pagesToResolve.length, refsFound: refCount, distinctUrls: byUrl.size, fetched: urls.length, truncated: truncated, ok: got.filter((g) => g && g.status === 200).length },
      failures,
      truncated ? '达到 --max-refs 上限，未全部解算' : undefined);
    checks[checks.length - 1].byContentType = got.reduce((acc, g) => {
      if (!g) return acc; const k = g.contentType || '(none)'; acc[k] = (acc[k] || 0) + 1; return acc;
    }, {});
  }

  /* ---------- 10. 下划线目录 ---------- */
  {
    const wanted = responses.filter((r) => r.group === 'underscore-astro' || r.rel === 'archive/_common/llms.txt' ||
      r.rel === 'archive/paper/_corpus/paper-corpus.md' || r.rel === 'archive/velocity/_corpus/velocity-corpus.md');
    const failures = wanted.filter((r) => r.status !== 200)
      .map((r) => ({ file: r.rel, ref: BASE + r.rel, reason: 'HTTP ' + r.status + '（下划线目录必须可访问）' }));
    const underscoreDirs = ['archive/_common', 'archive/paper/_corpus', 'archive/velocity/_corpus',
      'archive/paper/assets/docs.papermc.io/_astro', 'archive/velocity/assets/docs.papermc.io/_astro'];
    add('underscore-dirs', '下划线目录（_common / _corpus / _astro）在子路径下可访问', 'fail',
      failures.length === 0,
      { dirs: underscoreDirs, dirsExisting: underscoreDirs.filter(exists), checkedUrls: wanted.map((w) => w.rel), statuses: wanted.map((w) => w.status), nojekyll: exists('.nojekyll') },
      failures,
      '.nojekyll 只对 GitHub 的 Jekyll 构建起作用；本检查靠「文件确实存在 + 同名 URL 返回 200」来保证发布后不会被当作下划线目录吞掉。');
  }

  /* ---------- 11. 归档图片 ---------- */
  {
    const imgs = responses.filter((r) => r.group === 'archive-image' || r.rel === 'undefined');
    const failures = [];
    for (const r of imgs) {
      if (r.status !== 200) { failures.push({ file: r.rel, ref: BASE + r.rel, reason: 'HTTP ' + r.status }); continue; }
      if (!/^image\//.test(r.contentType)) failures.push({ file: r.rel, ref: BASE + r.rel, reason: 'Content-Type 不是 image/*：' + r.contentType });
      let diskSize = -1;
      try { diskSize = fs.statSync(path.join(ROOT, r.rel)).size; } catch { /* ignore */ }
      if (diskSize !== r.bytes) failures.push({ file: r.rel, ref: BASE + r.rel, reason: '字节数不符：磁盘 ' + diskSize + ' / HTTP ' + r.bytes });
    }
    add('archive-images', 'archive/** 图片在子路径下可取回、Content-Type 为 image/*、字节数与磁盘一致', 'fail',
      imgs.length > 0 && failures.length === 0,
      { checked: imgs.map((r) => ({ rel: r.rel, bytes: r.bytes, contentType: r.contentType })), paperImages: paperImages.length, astroImages: astroImages.length },
      imgs.length ? failures : [{ file: '(sample)', ref: '-', reason: '没抽到任何 archive 图片，检查无效' }]);
  }

  /* ---------- 12. 搜索索引 ---------- */
  {
    const json = responses.find((r) => r.rel === 'search-index.json');
    const js = responses.find((r) => r.rel === 'assets/search-index.js');
    const failures = [];
    let pagesCount = -1, generatedAt = null, jsonBytes = -1;
    if (!json || json.status !== 200) failures.push({ file: 'search-index.json', ref: BASE + 'search-index.json', reason: 'HTTP ' + (json ? json.status : '?') });
    else {
      jsonBytes = json.bytes;
      try {
        const obj = JSON.parse(json.body.toString('utf8'));
        pagesCount = Array.isArray(obj.pages) ? obj.pages.length : -1;
        generatedAt = obj.generated_at || null;
        if (pagesCount <= 0) failures.push({ file: 'search-index.json', ref: '-', reason: 'pages 数组为空或不存在' });
      } catch (e) { failures.push({ file: 'search-index.json', ref: '-', reason: 'JSON 解析失败: ' + e.message }); }
    }
    if (!js || js.status !== 200) failures.push({ file: 'assets/search-index.js', ref: BASE + 'assets/search-index.js', reason: 'HTTP ' + (js ? js.status : '?') });
    else if (!/window\.__LIBRARY_SEARCH__\s*=/.test(js.body.toString('utf8'))) {
      failures.push({ file: 'assets/search-index.js', ref: '-', reason: '未包含 window.__LIBRARY_SEARCH__ 赋值（file:// 场景的兜底失效）' });
    }
    const nPages = pages.length;   // paper/**/*.html + velocity/**/*.html + folia/**/*.html（= 旧 library/pages/**，141 页）
    add('search-index', '搜索索引（JSON + JS 双份）可取回、可解析、与页面数一致', 'fail',
      failures.length === 0,
      { jsonBytes: jsonBytes, jsBytes: js ? js.bytes : -1, indexPages: pagesCount, renderedPages: nPages, generatedAt: generatedAt },
      failures);
  }

  /* ---------- 13. MIME ---------- */
  {
    const seen = {};
    for (const r of responses) if (r.status === 200 && !r.__error) {
      const ext = (path.extname(r.rel) || '(none)').toLowerCase();
      if (!seen[ext]) seen[ext] = r.contentType;
    }
    const md = responses.find((r) => r.rel === 'archive/paper/markdown/index.md');
    const txt = responses.find((r) => r.rel === 'archive/_common/llms.txt');
    const failures = [];
    for (const x of [md, txt]) {
      if (x && x.status === 200 && /text\/html/i.test(x.contentType)) {
        failures.push({ file: x.rel, ref: BASE + x.rel, reason: 'Content-Type 是 text/html —— 会把原始 Markdown/文本当网页渲染' });
      }
    }
    add('mime-types', '.md / .txt 不被当 text/html 提供（纯文本或下载语义，属预期）', 'fail',
      failures.length === 0,
      { byExtension: seen, md: md ? md.contentType : null, txt: txt ? txt.contentType : null },
      failures,
      'GitHub Pages 对 .md/.txt 不做渲染，按纯文本或下载语义返回（不同 CDN 节点可能给 text/plain 或 application/octet-stream）。本站把「上游 index.md / llms.txt 点开是源码」当作预期行为——它们是存档证据，不是导航页。');
  }

  /* ---------- 14. 127.0.0.1 / localhost 资源引用 ---------- */
  {
    // 扫描范围 = 站点本体（判失败）+ 上游归档快照与工具源码（只报告）
    const scans = uniq(strictHtml.concat(archivesHtml, toolsHtml)).map(scanHtmlFile);
    const siteFail = [];
    const otherWarn = [];
    for (const s of scans) {
      for (const r of s.localhost) {
        const item = { file: s.file, ref: r.value, reason: '资源引用指向本机地址，部署到 Pages 后必然失败' };
        if (isSiteFile(s.file)) siteFail.push(item); else otherWarn.push(item);
      }
    }
    add('localhost-refs', '生成站点本体（index.html / 404.html / all-pages.html / snapshots.html / assets/** / categories/** / sections/** / paper/** / velocity/** / folia/**）无 127.0.0.1 / localhost 资源引用', 'fail',
      siteFail.length === 0, { siteHits: siteFail.length, otherHits: otherWarn.length, scanned: scans.length }, siteFail);
    add('localhost-refs-entry', '非生成站点文件（archive/** 上游快照、tools/** 源码）里的本机地址引用（只报告，不改别人的文件）', 'warn',
      otherWarn.length === 0, { hits: otherWarn.length },
      otherWarn,
      'archive/** 是 docs.papermc.io 的原始快照、tools/** 是本地工具源码，二者都不参与站点导航；这里的 http://127.0.0.1… 属上游/工具自带，只作提示。');
  }

  /* ---------- 15. 中文 / percent-encoded URL ---------- */
  {
    const failures = [];
    const nonAscii = collect(['archive', 'paper', 'velocity', 'folia', 'assets', 'categories', 'sections'], null).filter((p) => /[^\x00-\x7F]/.test(p));
    const q = await request(BASE + 'index.html?q=' + encodeURIComponent('插件 加载'));
    if (q.status !== 200) failures.push({ file: 'index.html', ref: BASE + 'index.html?q=%E6%8F%92%E4%BB%B6', reason: '带中文查询串的请求 HTTP ' + q.status });
    const encSeg = encodeURIComponent('中文目录');
    const enc = await request(BASE + encSeg + '/');
    if (enc.status !== 404) failures.push({ file: encSeg + '/', ref: BASE + encSeg + '/', reason: '不存在的 percent-encoded 路径期望 404，实际 ' + enc.status });
    if (enc.is404Body && !/<html/i.test(enc.body.toString('utf8'))) failures.push({ file: '404.html', ref: '-', reason: 'percent-encoded 404 未回落到 404.html 正文' });
    const idx = responses.find((r) => r.rel === 'index.html');
    const idxText = idx && idx.body ? idx.body.toString('utf8') : '';
    const cjkInBody = /[\u3400-\u9fff]/.test(idxText);
    if (!cjkInBody) failures.push({ file: 'index.html', ref: '-', reason: '正文里没有中文（编码可能被破坏）' });
    add('cjk-encoding', 'UTF-8 与 percent-encoded URL 处理正常（含中文正文/查询串）', 'fail',
      failures.length === 0,
      { nonAsciiPaths: nonAscii.length, nonAsciiSample: nonAscii.slice(0, 10), queryStatus: q.status, encodedMissingStatus: enc.status, indexHasCJK: cjkInBody },
      failures,
      nonAscii.length === 0 ? '仓库内没有任何非 ASCII 文件/目录名，所以不存在「中文文件名 URL 编码」的陷阱；中文只出现在文档正文（已抽查 UTF-8 完整）。' : undefined);
  }

  /* ---------- 16. 404 页面 ---------- */
  {
    const missingUrl = BASE + '__gh-pages-smoke-missing__/sub/not-here.html';
    const r = await request(missingUrl);
    const body = r.body ? r.body.toString('utf8') : '';
    const refs = extractRefs(body);
    const failures = [];
    if (r.status !== 404) failures.push({ file: '404.html', ref: missingUrl, reason: '期望 404，实际 ' + r.status });
    if (!r.is404Body) failures.push({ file: '404.html', ref: missingUrl, reason: '404 响应没有回落到仓库根 404.html（Pages 行为）' });
    if (exists('404.html')) {
      const disk = fs.readFileSync(path.join(ROOT, '404.html'));
      if (!disk.equals(r.body)) failures.push({ file: '404.html', ref: missingUrl, reason: '返回的正文与磁盘上的 404.html 不一致' });
    } else {
      failures.push({ file: '404.html', ref: '-', reason: '仓库根缺少 404.html' });
    }
    if (!/[\u3400-\u9fff]/.test(body)) failures.push({ file: '404.html', ref: '-', reason: '没有中文提示' });
    const abs = refs.filter((x) => ['absolute', 'drive', 'file'].indexOf(classify(x.value)) >= 0);
    for (const x of abs) failures.push({ file: '404.html', ref: x.value, reason: '404 页面不得出现绝对路径/本机路径引用' });
    const hasIndex = /href\s*=\s*"\.\/index\.html"/.test(body);
    const hasSnap = /href\s*=\s*"\.\/snapshots\.html"/.test(body);
    if (!hasIndex || !hasSnap) failures.push({ file: '404.html', ref: '-', reason: '缺少 ./index.html 或 ./snapshots.html 的相对链接' });
    if (!/data-gh-pages-link/.test(body)) failures.push({ file: '404.html', ref: '-', reason: '缺少深层 URL 下的相对链接修正脚本' });
    add('404-page', '404 页面生效：Pages 在深层 URL 下返回它，正文中文 + 只用相对链接', 'fail',
      failures.length === 0,
      { url: missingUrl, status: r.status, bytes: r.bytes, contentType: r.contentType,
        relativeLinks: { index: hasIndex, snapshots: hasSnap }, refs: refs.length, absoluteRefs: abs.length, hasRewriteScript: /data-gh-pages-link/.test(body) },
      failures,
      'Pages 会把 404.html 的正文直接回给被请求的深层 URL，所以静态相对链接会再次 404；页面里的内联脚本按 <repo>/ 前缀重写链接来兜底。');
  }

  /* ---------- 17. 子路径隔离（证明这次检查真的在子路径下跑） ---------- */
  {
    // 探针 = 仓库里确实存在、但**不在** /<repo>/ 子路径下的文件。新布局下站点本体就在仓库根，
    // 所以改用根目录的工具类文件；运行时按候选顺序取第一个存在的，避免写成假设。
    const outsideRel = ['package.json', 'tools/build-site.js', 'README.md', '.gitignore'].find(exists) || 'package.json';
    const outsideUrl = 'http://127.0.0.1:' + srv.port + '/' + outsideRel;
    const outside = await request(outsideUrl);
    const rootUrl = await request('http://127.0.0.1:' + srv.port + '/');
    const noSlash = await request('http://127.0.0.1:' + srv.port + '/' + opts.repo);
    const failures = [];
    if (outside.status !== 404) failures.push({ file: '/' + outsideRel, ref: outsideUrl, reason: '子路径之外竟然返回 ' + outside.status + '，说明站点被挂在了域名根，本次模拟无效' });
    if (rootUrl.status !== 404) failures.push({ file: '/', ref: 'http://127.0.0.1:' + srv.port + '/', reason: '域名根返回 ' + rootUrl.status + '，本次模拟无效' });
    if (noSlash.status !== 301 || noSlash.location !== srv.prefix) {
      failures.push({ file: '/' + opts.repo, ref: noSlash.location, reason: '期望 301 → ' + srv.prefix + '（Pages 对 /<repo> 的规范化跳转），实际 ' + noSlash.status + ' ' + noSlash.location });
    }
    add('harness-subpath-isolation', '模拟环境确实运行在 /<repo>/ 子路径下（域名根访问不到站点）', 'fail',
      failures.length === 0,
      { repoPrefix: srv.prefix, outsideProbe: '/' + outsideRel, outsideStatus: outside.status, rootStatus: rootUrl.status, noSlashStatus: noSlash.status, noSlashLocation: noSlash.location },
      failures);
  }

  /* ---------- 18. <base> 标签 + 根 index.html 落地页（不再是 meta refresh 跳转页） ---------- */
  {
    const failures = [];
    const withBase = strictHtml.filter((p) => /<base\b/i.test(readText(p)));
    for (const f of withBase) failures.push({ file: f, ref: '<base>', reason: '出现 <base> 标签，子路径下极易把整站链接打偏' });
    const rootResp = responses.find((r) => r.rel === 'index.html');
    if (!rootResp || rootResp.__error || rootResp.status !== 200) {
      failures.push({ file: 'index.html', ref: BASE + 'index.html', reason: '根 index.html 在子路径下 HTTP ' + (rootResp && !rootResp.__error ? rootResp.status : '?') + '（期望 200）' });
    }
    const rootText = exists('index.html') ? readText('index.html') : '';
    const metaRefresh = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?/i.test(rootText);
    if (metaRefresh) failures.push({ file: 'index.html', ref: '(meta refresh)', reason: '新的根 index.html 是真实落地页，不应再有 http-equiv="refresh" 跳转' });
    if (!/[\u3400-\u9fff]/.test(rootText)) failures.push({ file: 'index.html', ref: '-', reason: '落地页正文里没有中文（编码可能被破坏）' });
    const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(rootText);
    const siteTitle = titleM ? titleM[1].trim() : '';
    if (!siteTitle) failures.push({ file: 'index.html', ref: '-', reason: '落地页缺少 <title> 站点标题' });
    // 三个分区入口：落地页里的相对链接解算后必须正好落到 /<repo>/paper|velocity|folia[/index.html]
    const linksTo = (sec) => extractRefs(rootText).some((r) => {
      if (classify(r.value) !== 'relative') return false;
      let u;
      try { u = new URL(r.value, BASE + 'index.html'); } catch { return false; }
      return u.pathname === srv.prefix + sec || u.pathname === srv.prefix + sec + '/' ||
        u.pathname === srv.prefix + sec + '/index.html';
    });
    const linkPaper = linksTo('paper');
    const linkVelocity = linksTo('velocity');
    const linkFolia = linksTo('folia');
    if (!linkPaper) failures.push({ file: 'index.html', ref: '-', reason: '落地页没有指向 paper/ 的相对链接' });
    if (!linkVelocity) failures.push({ file: 'index.html', ref: '-', reason: '落地页没有指向 velocity/ 的相对链接' });
    if (!linkFolia) failures.push({ file: 'index.html', ref: '-', reason: '落地页没有指向 folia/ 的相对链接' });
    add('root-entry', '根 index.html 是真落地页（200 / 中文 / 站点标题 / 无 meta refresh / 链接 paper、velocity 与 folia）；全站无 <base> 标签', 'fail',
      failures.length === 0,
      { indexStatus: rootResp ? rootResp.status : -1, title: siteTitle, metaRefresh: metaRefresh,
        links: { paper: linkPaper, velocity: linkVelocity, folia: linkFolia }, baseTagFiles: withBase.length, scanned: strictHtml.length },
      failures,
      'Pages 上 https://<user>.github.io/<repo>/ 直接返回这份 index.html（目录索引）：它必须自己承担首页职责，不能再靠 meta refresh 跳到 <repo>/library/index.html（旧路径已取消）。');
  }

  /* ---------- 19. 锚点完整性（warn） ---------- */
  {
    const failures = [];
    let checked = 0;
    for (const r of responses) {
      if (!r || r.status !== 200 || !/text\/html/i.test(r.contentType)) continue;
      const text = r.body.toString('utf8');
      const ids = new Set();
      for (const m of text.matchAll(/\bid\s*=\s*"([^"]+)"/g)) ids.add(m[1]);
      for (const m of text.matchAll(/\bname\s*=\s*"([^"]+)"/g)) ids.add(m[1]);
      for (const x of extractRefs(text)) {
        if (classify(x.value) !== 'fragment' || x.value.length < 2) continue;
        checked++;
        if (!ids.has(x.value.slice(1).split('?')[0])) failures.push({ file: r.rel, ref: x.value, reason: '本页没有对应的 id/name' });
      }
    }
    add('anchor-targets', '抽样页面内的 #锚点都能在本页找到对应 id/name（参考项）', 'warn',
      failures.length === 0, { anchorsChecked: checked, pages: responses.filter((r) => r && /text\/html/i.test(r.contentType)).length }, failures,
      '导航正在被另一个 Agent 改造，此项目前只作参考，不影响 RESULT。');
  }

  /* ---------- 20. 体积红线 ---------- */
  const repo = analyzeRepo(opts);
  {
    const failures = [];
    for (const f of repo.gt100MiB) failures.push({ file: f.path, ref: '-', reason: '单文件 ' + mib(f.bytes) + '，超过 GitHub 的 100 MiB 硬限制' });
    if (repo.trackedBytes > 1024 * 1024 * 1024) {
      failures.push({ file: '(repo)', ref: '-', reason: '将跟踪 ' + mib(repo.trackedBytes) + '，超过 Pages 站点 1 GiB 限制' });
    }
    add('size-limits', '没有超出 GitHub 100 MiB 单文件限制 / 1 GiB 站点限制的文件', 'fail',
      failures.length === 0,
      { trackedMiB: repo.trackedMiB, largestBytes: repo.largest.length ? repo.largest[0].bytes : 0,
        largestPath: repo.largest.length ? repo.largest[0].path : null,
        gt50MiB: repo.gt50MiB.map((x) => ({ path: x.path, mib: Number((x.bytes / 1048576).toFixed(2)) })),
        gt100MiB: repo.gt100MiB.map((x) => ({ path: x.path, mib: Number((x.bytes / 1048576).toFixed(2)) })) },
      failures, '> 50 MiB 的文件会逐个列在 stats.gt50MiB（未超限，但推送会慢）。');
  }

  /* ---------- 21. 仓库体积 / 忽略效果 ---------- */
  {
    const failures = [];
    const trackedSet = new Set(repo.largest.map((x) => x.path));
    const nodeModulesTracked = collect(['node_modules'], null).filter((p) => {
      try { return fs.statSync(path.join(ROOT, p)).isFile(); } catch { return false; }
    });
    const badTracked = nodeModulesTracked.length > 0 && repo.trackedFiles > 0 && (() => {
      // 用忽略模拟复核：node_modules 下应当 0 个被跟踪
      try {
        const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        return out.split('\0').filter((p) => p.indexOf('node_modules/') === 0).length;
      } catch { return 0; }
    })();
    if (badTracked > 0) failures.push({ file: 'node_modules/', ref: '-', reason: '仍有 ' + badTracked + ' 个 node_modules 文件会被跟踪' });
    const logTracked = (() => {
      try {
        const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        return out.split('\0').filter((p) => /\.log$/.test(p) || /crawl-.*\.log$/.test(p)).length;
      } catch { return 0; }
    })();
    if (logTracked > 0) failures.push({ file: '*.log', ref: '-', reason: '仍有 ' + logTracked + ' 个日志文件会被跟踪' });
    add('repo-size', '按 .gitignore 提交时：node_modules 与日志都不进仓库，体积可控', 'fail',
      failures.length === 0,
      { source: repo.source, trackedFiles: repo.trackedFiles, trackedMiB: repo.trackedMiB, ignoredFiles: repo.ignoredFiles,
        ignoredBytes: repo.ignoredBytes, topLevel: repo.topLevel, ignoredSample: repo.ignoredSample,
        trackedNodeModules: badTracked, trackedLogs: logTracked },
      failures);
    void trackedSet;
  }

  /* ---------- 汇总 ---------- */
  const failed = checks.filter((c) => c.severity === 'fail' && !c.ok);
  const warned = checks.filter((c) => c.severity === 'warn' && !c.ok);
  const result = failed.length === 0 ? 'PASS' : 'FAIL';

  process.stdout.write('\n');
  checks.forEach((c, i) => {
    const tag = c.severity === 'warn' ? (c.ok ? 'PASS' : 'WARN') : (c.ok ? 'PASS' : 'FAIL');
    process.stdout.write('[' + String(i + 1).padStart(2) + '/' + checks.length + '] ' + tag + '  ' +
      c.id.padEnd(26) + ' ' + (c.ok ? '' : '(' + c.failureTotal + ') ') +
      (c.stats ? summarize(c) : '') + '\n');
    if (/^(WARN|FAIL)/.test(tag) || (c.note && !c.ok)) {
      for (const f of c.failures.slice(0, 5)) {
        process.stdout.write('         ↳ ' + f.file + ' | ' + String(f.ref).slice(0, 90) + ' | ' + f.reason + '\n');
      }
      if (c.failureTotal > 5) process.stdout.write('         ↳ …共 ' + c.failureTotal + ' 条，完整清单见 JSON\n');
    }
  });

  const durations = Date.now() - t0;
  process.stdout.write('\n');
  process.stdout.write('RESULT: ' + result + '  (' + checks.length + ' checks: ' +
    (checks.length - failed.length - warned.length) + ' pass / ' + failed.length + ' fail / ' + warned.length + ' warn)' +
    '  ·  模拟子路径 ' + srv.prefix + '  ·  ' + srv.hits.length + ' 次 HTTP 请求  ·  本次跟踪体积 ' + mib(repo.trackedBytes) + '  ·  ' + durations + ' ms\n');

  const out = {
    tool: 'tools/gh-pages-smoke.js',
    schema: 1,
    generatedAt: new Date().toISOString(),
    durationMs: durations,
    node: process.version,
    host: process.platform,
    result: result,
    simulatedRepo: opts.repo,
    simulatedBaseUrl: BASE,
    simulatedSubPath: srv.prefix,
    seed: opts.random ? 'random' : opts.seed,
    sampling: { categories: catPick, pages: pagePick, images: imgPick, astroImages: astroPick },
    summary: {
      checks: checks.length,
      passed: checks.filter((c) => c.ok).length,
      failed: failed.length,
      warned: warned.length,
      failedIds: failed.map((c) => c.id),
      warnedIds: warned.map((c) => c.id),
      httpRequests: srv.hits.length,
      trackedFiles: repo.trackedFiles,
      trackedBytes: repo.trackedBytes,
      trackedMiB: repo.trackedMiB,
    },
    checks: checks,
    repoStats: repo,
  };

  const jsonPath = path.resolve(ROOT, opts.json);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  process.stdout.write('json  -> ' + rel(jsonPath) + '\n');

  await srv.close();
  return result === 'PASS' ? 0 : 1;
}

function summarize(c) {
  const s = c.stats || {};
  switch (c.id) {
    case 'nojekyll': return '.nojekyll ' + s.bytes + ' B';
    case 'gitignore': return s.rules + ' 条忽略规则 / ' + s.negations + ' 条保留规则' + (s.missing && s.missing.length ? ' 缺: ' + s.missing.join(',') : '');
    case 'http-200': return s.ok + '/' + s.requested + ' 个 URL 200';
    case 'no-absolute-refs': return s.files + ' 个站点本体文件 / ' + s.refs + ' 处引用 / 绝对 ' + s.absolute + ' · file:// ' + s.fileScheme + ' · 盘符 ' + s.drive;
    case 'archives-snapshot-refs': return s.files + ' 个归档快照 / 绝对 ' + s.absolute + ' 处（上游自带）';
    case 'relative-resolve-subpath': return s.fetched + ' 个相对链接（去重自 ' + s.refsFound + ' 处）/ 200 ' + s.ok;
    case 'underscore-dirs': return s.checkedUrls.length + ' 个下划线路径 → ' + s.statuses.join(',');
    case 'archive-images': return s.checked.length + ' 张图片（候选 ' + s.paperImages + ' + ' + s.astroImages + '）';
    case 'search-index': return 'json ' + s.jsonBytes + ' B / pages ' + s.indexPages + ' / 渲染页 ' + s.renderedPages;
    case 'mime-types': return '.md=' + s.md + '  .txt=' + s.txt;
    case 'localhost-refs': return '站点本体 ' + s.siteHits + ' 处 / 其他文件 ' + s.otherHits + ' 处';
    case 'localhost-refs-entry': return s.hits + ' 处';
    case 'cjk-encoding': return '非 ASCII 路径 ' + s.nonAsciiPaths + ' · 中文查询 ' + s.queryStatus + ' · 编码 404 ' + s.encodedMissingStatus;
    case '404-page': return 'HTTP ' + s.status + ' / ' + s.bytes + ' B / 绝对引用 ' + s.absoluteRefs;
    case 'harness-subpath-isolation': return '域名根 ' + s.rootStatus + ' · 子路径外 ' + s.outsideStatus;
    case 'root-entry': return '落地页「' + s.title + '」· HTTP ' + s.indexStatus + ' · meta refresh ' + (s.metaRefresh ? '有' : '无') +
      ' · 分区链接 ' + (s.links && s.links.paper ? 'paper✓' : 'paper✗') + ' ' + (s.links && s.links.velocity ? 'velocity✓' : 'velocity✗') +
      ' ' + (s.links && s.links.folia ? 'folia✓' : 'folia✗') +
      ' · <base> ' + s.baseTagFiles + ' 处';
    case 'anchor-targets': return s.anchorsChecked + ' 个锚点 / ' + s.pages + ' 页';
    case 'size-limits': return '最大文件 ' + s.largestPath + ' (' + (s.largestBytes / 1048576).toFixed(2) + ' MiB) · 跟踪 ' + s.trackedMiB + ' MiB';
    case 'repo-size': return s.trackedFiles + ' 文件 / ' + s.trackedMiB + ' MiB 将被跟踪（忽略 ' + s.ignoredFiles + ' 个 / ' + (s.ignoredBytes / 1048576).toFixed(2) + ' MiB）';
    default: return '';
  }
}

main().then((code) => { process.exitCode = code; })
  .catch((e) => {
    process.stdout.write('\nRESULT: FAIL  (harness error: ' + ((e && e.stack) || e) + ')\n');
    process.exitCode = 1;
  });
