'use strict';
/**
 * util.js — shared helpers for the offline library site generator.
 *
 * All output is written as UTF-8 *without* BOM (never use Set-Content -Encoding UTF8).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
/** 站点根 = 仓库根（GitHub Pages project pages：https://sqkl520.github.io/papermc-docs/） */
const SITE = ROOT;
/** 生成器内部的旧名：现在同样指向站点根 */
const LIB = SITE;
/** 权威输入数据（source-nav.json / taxonomy.json / crosslinks.json / build-manifest.json） */
const DATA = path.join(ROOT, 'data');
/** 只读归档镜像（原 archives/，已改名为 archive/） */
const ARCHIVES = path.join(ROOT, 'archive');
/** 开发期报告（已 gitignore，不发布） */
const REPORTS = path.join(ROOT, 'reports');

/** forward-slash relative path helper */
function posix(p) {
  return String(p).split(path.sep).join('/');
}

/** relative URL from one output directory to a target file/dir, always starting with "./" or "../" */
function relUrl(fromDirAbs, toAbs) {
  let r = posix(path.relative(fromDirAbs, toAbs));
  if (r === '') r = '.';
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

/** join a base relative URL with a path, keeping a single slash */
function joinUrl(base, rest) {
  if (!rest) return base;
  if (base.endsWith('/')) return base + rest;
  return base + '/' + rest;
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** same as escapeHtml but keeps " readable in text nodes */
function escapeText(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** escape for use inside a double-quoted HTML attribute */
function attr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (ENTITIES[body]) return ENTITIES[body];
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code < 0x110000) {
        try { return String.fromCodePoint(code); } catch { return m; }
      }
    }
    return m;
  });
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, '');
}

function decodeAttrText(s) {
  return decodeEntities(stripTags(s));
}

/** GitHub-flavoured heading slug: lowercase, drop punctuation, spaces -> "-", keep CJK and _ / - */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** aggressive key used for fuzzy fragment matching (drops every separator) */
function normKey(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** write UTF-8 without BOM, creating parent dirs */
function writeFile(abs, content) {
  ensureDir(path.dirname(abs));
  const s = String(content);
  if (s.charCodeAt(0) === 0xfeff) throw new Error('refusing to write BOM-prefixed content: ' + abs);
  fs.writeFileSync(abs, Buffer.from(s, 'utf8'));
  return Buffer.byteLength(s, 'utf8');
}

function readText(abs) {
  let t = fs.readFileSync(abs, 'utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t.replace(/\r\n/g, '\n');
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function truncateBytes(s, maxBytes) {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return { text: s, bytes: buf.length, truncated: false };
  let cut = buf.slice(0, maxBytes).toString('utf8');
  // drop a possible replacement char from a split multi-byte sequence
  cut = cut.replace(/\ufffd$/, '');
  const idx = cut.lastIndexOf(' ');
  return { text: cut, bytes: Buffer.byteLength(cut, 'utf8'), truncated: true };
}

function humanBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB';
  return (n / 1048576).toFixed(2) + ' MiB';
}

function sortByOrderThenTitle(list) {
  return list.slice().sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : 1e6;
    const bo = Number.isFinite(b.order) ? b.order : 1e6;
    if (ao !== bo) return ao - bo;
    return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN');
  });
}

/** 站点产物的顶层入口（校验脚本共用）：站点根下的 HTML / 资源 / 数据目录 */
const SITE_SKIP_DIRS = ['reports', 'node_modules', '.git', 'archive', 'data', 'tools'];

module.exports = {
  ROOT, SITE, LIB, DATA, ARCHIVES, REPORTS, SITE_SKIP_DIRS,
  posix, relUrl, joinUrl,
  escapeHtml, escapeText, attr,
  decodeEntities, stripTags, decodeAttrText,
  slugify, normKey,
  sha256, ensureDir, writeFile, readText, rmrf, truncateBytes, humanBytes,
  sortByOrderThenTitle,
};
