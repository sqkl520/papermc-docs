#!/usr/bin/env node
'use strict';
/**
 * build-site.js — static site generator for the offline PaperMC docs library.
 *
 *   node tools/build-site.js [--self-test] [--quiet] [--verify-artifacts]
 *
 * 站点根 = 仓库根（GitHub Pages project pages：https://sqkl520.github.io/papermc-docs/）。
 * 页面产物路径 = rel 直接展开（'index' -> <section>/index.html），故站点 URL 与上游逐段一致。
 *
 * Reads   : archive/<section>/manifest.json + archive/<section>/markdown/**.md
 *           data/source-nav.json（权威源侧栏结构：主导航的唯一依据）
 *           data/taxonomy.json (optional; falls back to manifest/INDEX.md structure)
 * Writes  : index.html(落地页), 404.html, robots.txt, sitemap.xml, all-pages.html, snapshots.html,
 *           <section>/<rel>.html(141), categories/**, sections/**,
 *           assets/{site.css,site.js,search-index.js,favicon.svg}, search-index.json,
 *           data/build-manifest.json
 *
 * Never touches: archive/**, data/{source-nav,taxonomy,crosslinks,md-features}.json, tools/**,
 * reports/**, 以及仓库治理文件（README.md / THIRD-PARTY-NOTICES.md / package.json / .gitignore / .nojekyll）。
 *
 * All writes are UTF-8 without BOM (fs.writeFileSync(..., 'utf8') through util.writeFile).
 * The build is idempotent: previous generated artefacts are removed first.
 */

const fs = require('fs');
const path = require('path');
const U = require('./site/util');
const R = require('./site/render');
const L = require('./site/layout');
const S = require('./site/search');
const NAV = require('./site/nav');
const { SITE_CSS, SITE_JS, FAVICON_SVG } = require('./site/assets');

const ARGS = process.argv.slice(2);
const SELF_TEST = ARGS.includes('--self-test');
const QUIET = ARGS.includes('--quiet');
const log = (...a) => { if (!QUIET) console.log(...a); };
const T0 = Date.now();

const SECTIONS = [
  { id: 'paper', title: 'Paper', subtitle: 'Minecraft 服务端本体（docs.papermc.io/paper）', archive: 'archive/paper' },
  { id: 'velocity', title: 'Velocity', subtitle: 'Minecraft 代理端（docs.papermc.io/velocity）', archive: 'archive/velocity' },
  { id: 'folia', title: 'Folia', subtitle: 'Minecraft 区域化多线程服务端（docs.papermc.io/folia）', archive: 'archive/folia' },
];

const warnings = [];
function warn(kind, message, extra) {
  warnings.push(Object.assign({ kind, message }, extra || {}));
}

// ---------------------------------------------------------------------------
// 1. manifests
// ---------------------------------------------------------------------------

function loadManifests() {
  const pages = [];
  const manifests = {};
  for (const sec of SECTIONS) {
    const mf = path.join(U.ROOT, sec.archive, 'manifest.json');
    if (!fs.existsSync(mf)) {
      warn('manifest-missing', '未找到清单文件: ' + U.posix(path.relative(U.ROOT, mf)));
      continue;
    }
    const man = JSON.parse(U.readText(mf));
    manifests[sec.id] = man;
    for (const p of man.pages || []) {
      pages.push({
        id: sec.id + ':' + p.rel,
        section: sec.id,
        rel: p.rel,
        url: p.url,
        title: p.title || p.rel,
        description: p.description || '',
        sha256: p.sha256 || '',
        markdownBytes: p.markdownBytes || 0,
        fetchedAt: p.fetchedAt || man.crawled_at || '',
        mdAbs: path.join(U.ROOT, sec.archive, p.file || ('markdown/' + p.rel + '.md')),
        manifestCodeBlocks: p.codeBlocks,
      });
    }
    log('  ' + sec.id + ': ' + (man.pages || []).length + ' 页（manifest）');
  }
  return { pages, manifests };
}

// ---------------------------------------------------------------------------
// 2. taxonomy (optional) + coverage diff
// ---------------------------------------------------------------------------

function loadTaxonomy(pages, manifests) {
  const file = path.join(U.DATA, 'taxonomy.json');
  const result = {
    present: false, path: 'data/taxonomy.json', generatedAt: null,
    categories: new Map(), sections: new Map(), pageMeta: new Map(),
    coverage: { missingInTaxonomy: [], extraInTaxonomy: [] }, mode: 'manifest-fallback',
  };
  if (!fs.existsSync(file)) {
    warn('taxonomy-missing', 'data/taxonomy.json 不存在，使用 manifest/INDEX.md 目录结构生成临时分类');
    return result;
  }
  let tax;
  try {
    tax = JSON.parse(U.readText(file));
  } catch (e) {
    warn('taxonomy-invalid', 'data/taxonomy.json 解析失败（' + e.message + '），回退到 manifest 模式');
    return result;
  }
  result.present = true;
  result.mode = 'taxonomy';
  result.generatedAt = tax.generated_at || null;
  for (const s of tax.sections || []) {
    result.sections.set(s.id, s);
  }
  for (const c of tax.categories || []) {
    result.categories.set(c.id, {
      id: c.id, title: c.title || c.id, section: c.section || 'paper',
      order: Number.isFinite(c.order) ? c.order : 1e6, description: c.description || '',
      synthetic: false,
    });
  }
  const manifestKeys = new Set(pages.map((p) => p.id));
  for (const p of tax.pages || []) {
    const key = (p.section || 'paper') + ':' + p.rel;
    if (!manifestKeys.has(key)) {
      result.coverage.extraInTaxonomy.push(key);
      continue;
    }
    result.pageMeta.set(key, p);
  }
  for (const p of pages) {
    if (!result.pageMeta.has(p.id)) {
      result.coverage.missingInTaxonomy.push(p.id);
      warn('taxonomy-page-missing', 'taxonomy.json 缺少页面 ' + p.id + '（已回退到 manifest 的 title/description）');
    }
  }
  for (const key of result.coverage.extraInTaxonomy) {
    warn('taxonomy-page-extra', 'taxonomy.json 含多余页面 ' + key + '（该页在 manifest/归档中不存在，已忽略）');
  }
  return result;
}

/** category derived from the mirror's own directory structure (fallback mode only) */
function fallbackCategory(sec, rel) {
  const seg = rel.includes('/') ? rel.split('/')[0] : 'root';
  const id = sec + '-' + seg;
  return {
    id,
    title: seg === 'root' ? '总览' : seg,
    section: sec,
    order: seg === 'root' ? 0 : 10 + hashOrder(seg),
    description: '由 manifest URL 目录结构推导的临时分类（taxonomy.json 待生成）',
    synthetic: true,
  };
}

function hashOrder(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 90;
  return h;
}

// ---------------------------------------------------------------------------
// 3. markdown rendering (pass 1)
// ---------------------------------------------------------------------------

function parseFrontMatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = {};
  if (!m) return { fm, body: md };
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fm, body: md.slice(m[0].length) };
}

function renderAllPages(pages) {
  for (const p of pages) {
    if (!fs.existsSync(p.mdAbs)) {
      warn('markdown-missing', '缺少 Markdown 源文件: ' + U.posix(path.relative(U.ROOT, p.mdAbs)));
      p.renderError = 'markdown missing';
      continue;
    }
    const raw = U.readText(p.mdAbs);
    const { fm, body } = parseFrontMatter(raw);
    p.fm = fm;
    p.frontTitle = fm.title || '';
    p.frontDescription = fm.description || p.description || '';
    p.fetchedAt = p.fetchedAt || fm.fetched_at || '';
    p.sourceUrl = fm.source || p.url;
    const renderer = new R.MarkdownRenderer({
      warn: (kind, msg) => warn(kind, p.id + ': ' + msg),
    });
    const res = renderer.render(body);
    p.html = res.html;
    p.toc = res.toc;
    p.headingIds = res.ids;
    p.srcCounts = res.counts;
    p.markdownTitle = renderer.markdownTitle;
    // fence pairs in the source: top-level + the ones written inside a quote/alert ("^> ```")
    const plainFences = (body.match(/^[ \t]*(?:`{3,}|~{3,})/gm) || []).length;
    const quotedFences = (body.match(/^[ \t]*>[ \t]*(?:`{3,}|~{3,})/gm) || []).length;
    p.srcCounts.fencePairsPlain = Math.round(plainFences / 2);
    p.srcCounts.fencePairsQuoted = Math.round(quotedFences / 2);
    p.srcCounts.fencePairs = p.srcCounts.fencePairsPlain + p.srcCounts.fencePairsQuoted;
    p.alertTypes = renderer.alertTypes;
  }
}

// ---------------------------------------------------------------------------
// 3b. intrinsic image size → build-time width/height (P1-1, zero CLS)
// ---------------------------------------------------------------------------

/**
 * 正文图片在 HTML 里写死 intrinsic `width`/`height`，浏览器才能在**布局前**预留占位，
 * 从而消除懒加载图片带来的累积布局偏移（CLS）。运行期 JS 回填无效：回填时首次位移已发生。
 * CSS 仍是 `img.content-img{max-width:100%;height:auto}`，宽高属性只提供宽高比，
 * 显示尺寸不变（渲染几何逐像素不变，见 tools/c4-geom.js）。
 *
 * 只读图片头，不引入任何依赖：PNG(IHDR) / JPEG(SOFn) / GIF / WebP(VP8/VP8L/VP8X) / SVG(viewBox)。
 * 灯箱占位 `<img alt="">` 没有 class="content-img"，因此不会被匹配到（它们不该有尺寸）。
 */

const IMG_SIZE_CACHE = new Map();
const IMG_SIZE_STATS = {
  written: 0, candidates: 0, skippedDataUri: 0, skippedExternal: 0,
  skippedMissingFile: 0, skippedUnsupported: 0, alreadySized: 0, dataUriSized: 0, failures: [],
};

/** parse PNG / JPEG / GIF / WebP / SVG pixel size from a header buffer; null = unknown */
function readImageSize(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG: IHDR width/height are BE32 at offset 16 / 20
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null;
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return w > 0 && h > 0 ? { w, h, format: 'png' } : null;
  }
  // GIF: logical screen width/height are LE16 at offset 6 / 8
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    if (buf.length < 10) return null;
    const w = buf.readUInt16LE(6);
    const h = buf.readUInt16LE(8);
    return w > 0 && h > 0 ? { w, h, format: 'gif' } : null;
  }
  // WebP: RIFF....WEBP
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return readWebpSize(buf);
  }
  // JPEG: walk the marker chain to the first SOF0/SOF1/SOF2/… frame header
  if (buf[0] === 0xff && buf[1] === 0xd8) return readJpegSize(buf);
  // SVG: text, take width/height, else viewBox (scaled by whichever single axis was given)
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  if (/<svg[\s>]/i.test(head)) return readSvgSize(head);
  return null;
}

/** VP8X canvas size (authoritative) or the VP8 / VP8L frame size */
function readWebpSize(buf) {
  let off = 12;
  let canvas = null;
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (fourcc === 'VP8X' && body + 10 <= buf.length) {
      const w = 1 + (buf[body + 4] | (buf[body + 5] << 8) | (buf[body + 6] << 16));
      const h = 1 + (buf[body + 7] | (buf[body + 8] << 8) | (buf[body + 9] << 16));
      canvas = { w, h, format: 'webp' };
    } else if (fourcc === 'VP8 ' && body + 10 <= buf.length) {
      // 3-byte frame tag, then the 0x9D 0x01 0x2A start code
      if (buf[body + 3] === 0x9d && buf[body + 4] === 0x01 && buf[body + 5] === 0x2a) {
        const w = buf.readUInt16LE(body + 6) & 0x3fff;
        const h = buf.readUInt16LE(body + 8) & 0x3fff;
        if (w > 0 && h > 0) return { w, h, format: 'webp' };
      }
    } else if (fourcc === 'VP8L' && body + 5 <= buf.length) {
      if (buf[body] === 0x2f) {
        const bits = buf.readUInt32LE(body + 1);
        const w = 1 + (bits & 0x3fff);
        const h = 1 + ((bits >>> 14) & 0x3fff);
        if (w > 0 && h > 0) return { w, h, format: 'webp' };
      }
    }
    off = body + size + (size % 2); // RIFF chunks are word aligned
  }
  return canvas;
}

function readJpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    let marker = buf[i + 1];
    while (marker === 0xff) { i += 1; marker = buf[i + 1]; } // fill bytes
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc; // DHT/JPG/DAC are not frames
    if (isSof) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return w > 0 && h > 0 ? { w, h, format: 'jpeg' } : null;
    }
    i += 2 + len;
  }
  return null;
}

function readSvgSize(head) {
  const svg = head.match(/<svg\b[^>]*>/i);
  if (!svg) return null;
  const tag = svg[0];
  const attrOf = (name) => {
    const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'i'))
      || tag.match(new RegExp("\\s" + name + "\\s*=\\s*'([^']*)'", 'i'));
    return m ? m[1] : '';
  };
  const px = (v) => {
    const m = String(v || '').trim().match(/^(-?[\d.]+)(?:px)?$/);
    return m ? parseFloat(m[1]) : null;
  };
  const vb = attrOf('viewBox').split(/[\s,]+/).filter(Boolean).map(Number);
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  const aw = px(attrOf('width'));
  const ah = px(attrOf('height'));
  if (aw && ah) return { w: Math.round(aw), h: Math.round(ah), format: 'svg' };
  if (hasVb && aw) return { w: Math.round(aw), h: Math.round(aw * vb[3] / vb[2]), format: 'svg' };
  if (hasVb && ah) return { w: Math.round(ah * vb[2] / vb[3]), h: Math.round(ah), format: 'svg' };
  if (hasVb) return { w: Math.round(vb[2]), h: Math.round(vb[3]), format: 'svg' };
  return null;
}

/** absolute path of a site-relative image URL → intrinsic size (cached, null when unreadable) */
function intrinsicImageSize(abs, outAbs) {
  if (IMG_SIZE_CACHE.has(abs)) return IMG_SIZE_CACHE.get(abs);
  let size = null;
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const st = fs.statSync(abs);
      const fd = fs.openSync(abs, 'r');
      try {
        const buf = Buffer.alloc(Math.min(st.size, 65536));
        const read = fs.readSync(fd, buf, 0, buf.length, 0);
        size = readImageSize(read === buf.length ? buf : buf.subarray(0, read));
      } finally { fs.closeSync(fd); }
    }
  } catch (e) {
    size = null;
  }
  IMG_SIZE_CACHE.set(abs, size);
  if (!size) IMG_SIZE_STATS.failures.push(U.posix(path.relative(U.ROOT, abs)));
  return size;
}

/**
 * Write intrinsic width/height onto every `class="content-img"` <img> of one finished page.
 * Lightbox placeholders (`<img alt="">`, no src, no content-img class) are left untouched.
 */
function addIntrinsicImageSizes(html, outAbs) {
  const dir = path.dirname(outAbs);
  return String(html).replace(/<img\b[^>]*>/g, (tag) => {
    if (!/class="[^"]*\bcontent-img\b[^"]*"/.test(tag)) return tag;
    if (!/\ssrc="[^"]*"/.test(tag)) return tag;
    IMG_SIZE_STATS.candidates += 1;
    if (/\swidth="\d+"/.test(tag) || /\sheight="\d+"/.test(tag)) { IMG_SIZE_STATS.alreadySized += 1; return tag; }
    const raw = U.decodeEntities((tag.match(/\ssrc="([^"]*)"/) || [])[1] || '');
    // data: URI 的图片头同样可读（内联 PNG/JPEG/GIF/WebP），解析失败就跳过而不是猜
    if (/^data:/i.test(raw)) {
      const dm = raw.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/i);
      let size = null;
      if (dm) {
        try {
          const buf = dm[2] ? Buffer.from(dm[3], 'base64') : Buffer.from(decodeURIComponent(dm[3]), 'latin1');
          size = readImageSize(buf);
        } catch (e) { size = null; }
      }
      if (!size) { IMG_SIZE_STATS.skippedDataUri += 1; return tag; }
      IMG_SIZE_STATS.written += 1;
      IMG_SIZE_STATS.dataUriSized += 1;
      return tag.replace(/(class="[^"]*\bcontent-img\b[^"]*")/,
        '$1 width="' + size.w + '" height="' + size.h + '"');
    }
    if (/^(?:https?:)?\/\//i.test(raw)) { IMG_SIZE_STATS.skippedExternal += 1; return tag; }
    const clean = raw.split('#')[0].split('?')[0];
    let abs = path.resolve(dir, clean);
    if (!fs.existsSync(abs)) {
      try {
        const dec = path.resolve(dir, decodeURIComponent(clean));
        if (fs.existsSync(dec)) abs = dec;
      } catch (e) { /* malformed %-escape: keep the raw path */ }
    }
    if (!fs.existsSync(abs)) { IMG_SIZE_STATS.skippedMissingFile += 1; return tag; }
    const size = intrinsicImageSize(abs, outAbs);
    if (!size) { IMG_SIZE_STATS.skippedUnsupported += 1; return tag; }
    IMG_SIZE_STATS.written += 1;
    // insert right after the class attribute so the tag stays readable
    return tag.replace(/(class="[^"]*\bcontent-img\b[^"]*")/,
      '$1 width="' + size.w + '" height="' + size.h + '"');
  });
}

// ---------------------------------------------------------------------------
// 4. link + asset resolution (pass 2)
// ---------------------------------------------------------------------------

function splitFragment(href) {
  const i = href.indexOf('#');
  if (i === -1) return { path: href, frag: '' };
  return { path: href.slice(0, i), frag: href.slice(i + 1) };
}

class Linker {
  constructor(state) {
    this.state = state;
    this.stats = {
      rewrittenRelativeMd: 0, rewrittenAbsoluteDocs: 0, rewrittenCrossSection: 0,
      fragmentsResolvedFuzzy: 0, fragmentsUnresolved: 0, external: 0, unmirrored: 0,
      unresolvedLocal: 0, mailto: 0, samePageFragment: 0,
      imagesLocal: 0, imagesAbsoluteLocalized: 0, imagesExternal: 0, imagesMissing: 0,
      footnotesResolved: 0, footnotesMissing: 0,
    };
  }

  get state() { return this._state; }
  set state(v) { this._state = v; }

  outDirOf(page) { return path.dirname(page.outAbs); }

  findPage(section, relish) {
    const clean = String(relish || '')
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.md$/i, '');
    const cands = [];
    if (!clean || clean === '.') cands.push('index');
    else {
      cands.push(clean, clean + '/index');
      if (/\/index$/.test(clean)) cands.push(clean.replace(/\/index$/, ''));
    }
    for (const c of cands) {
      const pg = this._state.pageByKey.get(section + ':' + c);
      if (pg) return pg;
    }
    return null;
  }

  /** resolve a docs.papermc.io URL to a mirrored page (cross-section capable) */
  fromDocsUrl(href) {
    const m = String(href).match(/^https?:\/\/(?:www\.)?docs\.papermc\.io\/(.*)$/i);
    if (!m) return null;
    const { path: p, frag } = splitFragment(m[1]);
    const segs = p.replace(/^\/+/, '').split('/').filter(Boolean);
    if (!segs.length) return null;
    const section = segs.shift();
    const pg = this.findPage(section, segs.join('/'));
    if (!pg) return null;
    return { page: pg, frag };
  }

  resolveFragment(target, frag) {
    if (!frag) return { frag: '', status: 'none' };
    const map = this._state.slugMaps.get(target.id);
    if (!map) return { frag, status: 'no-target' };
    if (map.ids.has(frag)) return { frag, status: 'exact' };
    const nk = U.normKey(frag);
    const hit = map.fuzzy.get(nk);
    if (hit && hit.length === 1) return { frag: hit[0], status: 'fuzzy' };
    // unique prefix: upstream heading "Count argument behavior (important)" vs link "#count-argument-behavior"
    const prefixed = [...map.ids].filter((id) => id.startsWith(frag + '-'));
    if (prefixed.length === 1) return { frag: prefixed[0], status: 'fuzzy' };
    return { frag, status: 'unresolved' };
  }

  resolveLink(page, href) {
    const out = { href, changed: false, kind: 'keep' };
    if (href === null || href === undefined || href === '') return out;
    const raw = String(href).trim();
    if (/^(mailto:|tel:|data:|javascript:)/i.test(raw)) { this.stats.mailto += 1; return out; }
    if (raw.startsWith('#')) {
      const frag = raw.slice(1);
      if (frag.startsWith('user-content-')) return out; // footnotes handled separately
      const r = this.resolveFragment(page, frag);
      if (r.status === 'fuzzy') { this.stats.fragmentsResolvedFuzzy += 1; return { href: '#' + r.frag, changed: true, kind: 'fragment' }; }
      if (r.status === 'unresolved') {
        this.stats.fragmentsUnresolved += 1;
        warn('fragment-unresolved', page.id + ': 本页锚点 #' + frag + ' 没有对应标题',
          { from: page.id, target: page.id, frag, href: raw });
        return { href: raw, changed: true, kind: 'fragment', cls: 'anchor-missing', title: '本页无此锚点' };
      }
      this.stats.samePageFragment += 1;
      return out;
    }
    const abs = raw.match(/^https?:\/\//i) || raw.startsWith('//');
    if (abs) {
      const docs = this.fromDocsUrl(raw);
      if (docs) {
        const target = docs.page;
        const fr = this.resolveFragment(target, docs.frag);
        if (fr.status === 'unresolved') {
          this.stats.fragmentsUnresolved += 1;
          warn('fragment-unresolved', page.id + ': 目标页 ' + target.id + ' 无锚点 #' + docs.frag,
            { from: page.id, target: target.id, frag: docs.frag, href: raw });
        } else if (fr.status === 'fuzzy') {
          this.stats.fragmentsResolvedFuzzy += 1;
        }
        const rel = U.relUrl(this.outDirOf(page), target.outAbs) + (fr.frag ? '#' + fr.frag : '');
        if (target.section !== page.section) this.stats.rewrittenCrossSection += 1;
        this.stats.rewrittenAbsoluteDocs += 1;
        return { href: rel, changed: true, kind: 'absolute-docs', cls: 'internal' };
      }
      if (/^https?:\/\/(?:www\.)?docs\.papermc\.io\//i.test(raw)) {
        this.stats.unmirrored += 1;
        return { href: raw, changed: true, kind: 'unmirrored', cls: 'external unmirrored', title: '未镜像，需联网', target: '_blank', rel: 'noopener' };
      }
      this.stats.external += 1;
      return { href: raw, changed: true, kind: 'external', cls: 'external', target: '_blank', rel: 'noopener' };
    }
    // relative link
    const { path: relPathRaw, frag } = splitFragment(raw);
    const qs = relPathRaw.includes('?') ? relPathRaw.slice(relPathRaw.indexOf('?')) : '';
    const relPath = decodeURI(relPathRaw.replace(/\?.*$/, ''));
    const targetAbs = path.resolve(path.dirname(page.mdAbs), relPath);
    const relFromArchives = U.posix(path.relative(U.ARCHIVES, targetAbs));
    if (relFromArchives.startsWith('..')) {
      this.stats.unresolvedLocal += 1;
      warn('link-outside-archive', page.id + ': 相对链接越出归档目录 ' + raw);
      return { href: raw, changed: true, kind: 'unresolved', cls: 'unresolved', title: '目标不在归档范围内' };
    }
    const segs = relFromArchives.split('/');
    const section = segs.shift();
    if (segs[0] === 'markdown') segs.shift(); // manifest rel paths are relative to markdown/
    const target = this.findPage(section, segs.join('/'));
    if (!target) {
      this.stats.unresolvedLocal += 1;
      warn('link-unresolved', page.id + ': 相对链接无法解析到已镜像页面 ' + raw);
      return { href: raw, changed: true, kind: 'unresolved', cls: 'unresolved', title: '目标页未镜像' };
    }
    const fr = this.resolveFragment(target, frag);
    if (fr.status === 'unresolved') {
      this.stats.fragmentsUnresolved += 1;
      warn('fragment-unresolved', page.id + ': 目标页 ' + target.id + ' 无锚点 #' + frag,
        { from: page.id, target: target.id, frag, href: raw });
    } else if (fr.status === 'fuzzy') {
      this.stats.fragmentsResolvedFuzzy += 1;
    }
    const rel = U.relUrl(this.outDirOf(page), target.outAbs) + (fr.frag ? '#' + fr.frag : '') + qs;
    if (target.section !== page.section) this.stats.rewrittenCrossSection += 1;
    this.stats.rewrittenRelativeMd += 1;
    return { href: rel, changed: true, kind: 'relative-md', cls: 'internal' };
  }

  /** try to map an absolute image URL onto a mirrored assets/ file */
  localizeAssetUrl(raw) {
    const m = String(raw).match(/^https?:\/\/([^/]+)\/(.*)$/i);
    if (!m) return null;
    const host = m[1].replace(/^www\./, '');
    const rest = m[2].split('#')[0].split('?')[0];
    for (const sec of SECTIONS) {
      const cand = path.join(U.ROOT, sec.archive, 'assets', host, rest);
      if (fs.existsSync(cand) && fs.statSync(cand).size > 0) return { abs: cand, section: sec.id };
      const cand2 = path.join(U.ROOT, sec.archive, 'assets', 'docs.papermc.io', rest);
      if (fs.existsSync(cand2) && fs.statSync(cand2).size > 0) return { abs: cand2, section: sec.id };
    }
    return null;
  }

  resolveImage(page, src) {
    const raw = String(src || '').trim();
    if (raw.startsWith('data:')) {
      return { src: raw, cls: 'content-img', zoom: true, lazy: false, kind: 'data-uri' };
    }
    if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) {
      const local = this.localizeAssetUrl(raw);
      if (local) {
        this.stats.imagesAbsoluteLocalized += 1;
        return {
          src: U.relUrl(this.outDirOf(page), local.abs), cls: 'content-img', zoom: true, lazy: true,
          kind: 'absolute-localized', localizedFrom: raw,
        };
      }
      this.stats.imagesExternal += 1;
      return {
        src: raw, cls: 'external-image', title: '外链图片（需联网）', lazy: true,
        referrerPolicy: true, zoom: false,
        note: '外链图片，离线不可用（第三方资源未镜像）', kind: 'external',
      };
    }
    const targetAbs = path.resolve(path.dirname(page.mdAbs), raw.split('#')[0].split('?')[0]);
    if (!fs.existsSync(targetAbs)) {
      this.stats.imagesMissing += 1;
      warn('image-missing', page.id + ': 图片文件不存在 ' + raw + ' → ' + U.posix(path.relative(U.ROOT, targetAbs)));
      return { src: raw, cls: 'content-img img-missing', title: '本地图片缺失：' + raw, zoom: false, lazy: true, kind: 'missing' };
    }
    this.stats.imagesLocal += 1;
    return { src: U.relUrl(this.outDirOf(page), targetAbs), cls: 'content-img', zoom: true, lazy: true, kind: 'local' };
  }

  /**
   * Attach #user-content-fn-<name> ids to the matching list item and #user-content-fnref-<name>
   * to the <sup> reference. Names are numeric for most pages but can be slugs
   * (e.g. velocity/dev/pitfalls uses #user-content-fn-sounds-note).
   */
  repairFootnotes(html, page) {
    const FN = '[A-Za-z0-9_-]+';
    let out = html;
    const found = [];
    const refRe = new RegExp('href="#user-content-fnref-(' + FN + ')"', 'g');
    let m;
    while ((m = refRe.exec(out))) found.push({ n: m[1], at: m.index });
    for (let i = found.length - 1; i >= 0; i--) {
      const { n, at } = found[i];
      const open = out.lastIndexOf('<li', at);
      if (open === -1) continue;
      const end = out.indexOf('>', open);
      if (end === -1) continue;
      const tag = out.slice(open, end);
      if (/\sid=/.test(tag)) continue;
      out = out.slice(0, end) + ' id="user-content-fn-' + n + '"' + out.slice(end);
      this.stats.footnotesResolved += 1;
    }
    const resolvedNums = new Set();
    const idRe = new RegExp('id="user-content-fn-(' + FN + ')"', 'g');
    while ((m = idRe.exec(out))) resolvedNums.add(m[1]);
    const supRefs = [];
    const supRe = new RegExp('href="#user-content-fn-(' + FN + ')"', 'g');
    while ((m = supRe.exec(out))) supRefs.push({ n: m[1], at: m.index });
    for (let i = supRefs.length - 1; i >= 0; i--) {
      const { n, at } = supRefs[i];
      const ok = resolvedNums.has(n);
      const open = out.lastIndexOf('<sup', at);
      if (open !== -1) {
        const end = out.indexOf('>', open);
        const tag = end === -1 ? '' : out.slice(open, end);
        if (!/\sid=/.test(tag)) out = out.slice(0, end) + ' id="user-content-fnref-' + n + '"' + out.slice(end);
      }
      if (!ok) {
        this.stats.footnotesMissing += 1;
        warn('footnote-anchor-missing', page.id + ': 脚注引用 #user-content-fn-' + n + ' 未找到对应的列表项锚点');
        const aIdx = out.lastIndexOf('<a', at);
        if (aIdx !== -1) {
          const aEnd = out.indexOf('>', aIdx);
          const aTag = out.slice(aIdx, aEnd);
          if (!/class=/.test(aTag)) out = out.slice(0, aEnd) + ' class="anchor-missing"' + out.slice(aEnd);
        }
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// 5. site structure
// ---------------------------------------------------------------------------

function buildSiteModel(pages, tax, nav) {
  const sectionById = new Map();
  const sections = SECTIONS.map((s) => {
    const t = tax.sections.get(s.id);
    const sec = {
      id: s.id, title: (t && t.title) || s.title,
      subtitle: (t && t.subtitle) || s.subtitle,
      archive: s.archive, pageCount: 0, categories: [],
    };
    sectionById.set(sec.id, sec);
    return sec;
  });

  const categoryById = new Map();
  const ensureCategory = (secId, catId, catTitle, opts = {}) => {
    if (categoryById.has(catId)) return categoryById.get(catId);
    const cat = {
      id: catId, title: catTitle || catId, section: secId,
      order: Number.isFinite(opts.order) ? opts.order : 1e6,
      description: opts.description || '', synthetic: !!opts.synthetic, pages: [],
    };
    categoryById.set(catId, cat);
    return cat;
  };

  for (const c of tax.categories.values()) {
    if (!sectionById.has(c.section)) {
      warn('taxonomy-category-orphan', 'taxonomy.json 分类 ' + c.id + ' 指向未知分区 ' + c.section);
      continue;
    }
    ensureCategory(c.section, c.id, c.title, c);
  }

  for (const p of pages) {
    const meta = tax.pageMeta.get(p.id);
    if (meta && meta.category) {
      p.taxTitle = meta.title || '';
      p.title = p.taxTitle || p.frontTitle || p.title;
      p.description = meta.description || p.frontDescription || p.description || '';
      p.summary = meta.summary || '';
      p.tags = Array.isArray(meta.tags) ? meta.tags : [];
      p.order = Number.isFinite(meta.order) ? meta.order : 1e6;
      p.category = meta.category;
    } else {
      if (meta) warn('taxonomy-category-missing', 'taxonomy.json 页面 ' + p.id + ' 缺少 category 字段，已按目录结构临时归类');
      p.title = (meta && meta.title) || p.frontTitle || p.title;
      p.description = (meta && meta.description) || p.frontDescription || p.description || '';
      p.summary = (meta && meta.summary) || '';
      p.tags = [];
      const fb = fallbackCategory(p.section, p.rel);
      p.category = fb.id;
      p.order = (meta && Number.isFinite(meta.order)) ? meta.order : fb.order;
      if (!categoryById.has(fb.id)) {
        ensureCategory(fb.section, fb.id, (tax.mode === 'taxonomy' ? '[临时] ' + fb.title : fb.title),
          { order: fb.order, description: fb.description, synthetic: true });
      }
    }
    if (!categoryById.has(p.category)) {
      warn('category-undefined', '页面 ' + p.id + ' 引用了 taxonomy.json 中不存在的分类 ' + p.category + '，已创建占位分类');
      ensureCategory(p.section, p.category, '[未定义分类] ' + p.category, { synthetic: true });
    }
    categoryById.get(p.category).pages.push(p);
  }

  for (const cat of categoryById.values()) {
    cat.pages = U.sortByOrderThenTitle(cat.pages);
    for (let i = 0; i < cat.pages.length; i++) {
      const p = cat.pages[i];
      p.categoryTitle = cat.title;
      p.categoryIndex = i + 1;
      p.categoryTotal = cat.pages.length;
      p.sectionTitle = (sectionById.get(p.section) || {}).title || p.section;
      // 上一页 / 下一页不再按自建分类的 order，而是由源结构先序遍历给出（见下）
      p.prev = null;
      p.next = null;
    }
  }

  for (const sec of sections) {
    sec.categories = [...categoryById.values()]
      .filter((c) => c.section === sec.id)
      .sort((a, b) => (a.order - b.order) || String(a.title).localeCompare(String(b.title), 'zh-Hans-CN'));
    sec.pageCount = sec.categories.reduce((n, c) => n + c.pages.length, 0);
  }

  // ---- 源结构主导航：每页拿到源结构路径 / 面包屑 / 祖先分组，并按先序串起上一页/下一页 ----
  const pageByKey = new Map(pages.map((p) => [p.id, p]));
  const navMissing = [];
  if (nav) {
    for (const p of pages) {
      const meta = nav.lookup(p.section, p.rel);
      if (!meta) { navMissing.push(p.id); continue; }
      p.navMeta = meta;
      p.navPathText = meta.pathText;
      p.navGroupPath = meta.groupPath;
      p.navGroupKeys = meta.groupKeys;
      p.navLabel = meta.label;
      p.navIndex = meta.index;
      p.navTotal = meta.total;
      p.navKind = meta.isGroupHome ? 'group-home' : (meta.isSectionRoot ? 'section-root' : 'page');
    }
    for (const sec of nav.sections) {
      for (const e of sec.preorder) {
        const p = pageByKey.get(e.key);
        if (!p) continue;
        p.navPrevKey = e.prevKey;
        p.navNextKey = e.nextKey;
        p.prev = e.prevKey ? pageByKey.get(e.prevKey) || null : null;
        p.next = e.nextKey ? pageByKey.get(e.nextKey) || null : null;
      }
    }
    for (const id of navMissing) {
      warn('source-nav-page-uncovered', id + ' 不在源结构导航模型内（面包屑/上下页回退到分区）');
    }
  }

  return { sections, sectionById, categoryById, categories: [...categoryById.values()], navMissing };
}

// ---------------------------------------------------------------------------
// 6. write
// ---------------------------------------------------------------------------

/**
 * Measured totals over every generated HTML file (so the manifest can be reconciled with an
 * independent checker: counts.total* is per-source-link, siteTotals.* is per-rendered-element).
 */
function computeSiteTotals(written) {
  const files = []
    .concat(written.pages.map((p) => p.output))
    .concat(written.categories.map((c) => c.output))
    .concat(written.sections.map((s) => s.output))
    .concat([written.index.output, written.allPages ? written.allPages.output : null,
      written.snapshots ? written.snapshots.output : null])
    .filter(Boolean);
  const totals = {
    htmlFiles: files.length,
    imgAll: 0, imgInArticle: 0, imgExternal: 0, imgMissing: 0,
    anchorsAll: 0, anchorsExternal: 0, anchorsUnmirrored: 0, anchorsInternalPage: 0,
    anchorsFragmentOnly: 0, anchorsUnresolved: 0,
    uniqueExternalHrefs: 0,
  };
  const externals = new Set();
  for (const rel of files) {
    const abs = path.join(U.SITE, rel);
    if (!fs.existsSync(abs)) continue;
    const html = U.readText(abs);
    totals.imgAll += (html.match(/<img\b/g) || []).length;
    totals.imgExternal += (html.match(/class="external-image"/g) || []).length;
    totals.imgMissing += (html.match(/class="content-img img-missing"/g) || []).length;
    const artStart = html.indexOf('<article class="article">');
    const artEnd = html.indexOf('</article>');
    if (artStart !== -1 && artEnd > artStart) {
      totals.imgInArticle += (html.slice(artStart, artEnd).match(/<img\b/g) || []).length;
    }
    totals.anchorsAll += (html.match(/<a\b[^>]*\shref="/g) || []).length;
    totals.anchorsExternal += (html.match(/<a\b[^>]*\shref="https?:/g) || []).length;
    totals.anchorsUnmirrored += (html.match(/class="[^"]*unmirrored/g) || []).length;
    totals.anchorsInternalPage += (html.match(/<a\b[^>]*href="[^"]*(?:paper|velocity|folia)\/[^"]*\.html/g) || []).length;
    totals.anchorsFragmentOnly += (html.match(/<a\b[^>]*href="#/g) || []).length;
    totals.anchorsUnresolved += (html.match(/class="[^"]*anchor-missing/g) || []).length;
    for (const m of html.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/g)) externals.add(m[1]);
  }
  totals.uniqueExternalHrefs = externals.size;
  return totals;
}

/**
 * 清掉上一次构建的站点产物。站点根 = 仓库根，所以这里**只**删生成物：
 * 三个分区目录、assets/、分类页/分区页目录，以及根级 HTML / JSON / XML / TXT 产物。
 * archive/、data/、tools/、reports/、node_modules/、.git/ 与仓库治理文件一律不动。
 */
const GENERATED_ROOT_FILES = [
  'index.html', '404.html', 'robots.txt', 'sitemap.xml',
  'all-pages.html', 'snapshots.html', 'search-index.json',
];
const GENERATED_DIRS = ['paper', 'velocity', 'folia', 'categories', 'sections', 'assets'];

function cleanOutputs() {
  for (const d of GENERATED_DIRS) U.rmrf(path.join(U.SITE, d));
  for (const f of GENERATED_ROOT_FILES) {
    const p = path.join(U.SITE, f);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  const bm = path.join(U.DATA, 'build-manifest.json');
  if (fs.existsSync(bm)) fs.rmSync(bm, { force: true });
}

/** allocate an id that is not already used on the page */
function uniqueIdIn(ids, base) {
  const used = new Set(ids || []);
  if (!used.has(base)) return base;
  let n = 1;
  while (used.has(base + '-' + n)) n += 1;
  return base + '-' + n;
}

function countOccurrences(hay, needle) {
  let n = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n += 1; i += needle.length; }
  return n;
}

function writeEverything(state) {
  const { pages, site, tax, nav } = state;
  const written = { pages: [], categories: [], sections: [], allPages: null };

  for (const p of pages) {
    const outAbs = path.join(U.SITE, p.section, p.rel + '.html');
    const prefix = U.relUrl(path.dirname(outAbs), U.SITE) + '/';
    // snapshot links (raw HTML copy + upstream index.md) computed with path.relative from this page
    const htmlSnap = path.join(U.ROOT, 'archive', p.section, 'html', p.rel + '.html');
    const srcSnap = path.join(U.ROOT, 'archive', p.section, 'source', p.rel + '.md');
    const mdSnap = path.join(U.ROOT, 'archive', p.section, 'markdown', p.rel + '.md');
    const hasSrc = fs.existsSync(srcSnap);
    const hasMd = fs.existsSync(mdSnap);
    // 页面源 Markdown：优先 archive/<section>/source/<rel>.md，没有则用转换后的 markdown/<rel>.md
    p.snapshotLinks = {
      html: U.relUrl(path.dirname(outAbs), htmlSnap),
      markdown: hasMd ? U.relUrl(path.dirname(outAbs), mdSnap) : '',
      source: hasSrc
        ? U.relUrl(path.dirname(outAbs), srcSnap)
        : (hasMd ? U.relUrl(path.dirname(outAbs), mdSnap) : ''),
      local: prefix + p.section + '/' + p.rel + '.html',
    };
    p.snapshotExists = { html: fs.existsSync(htmlSnap), source: hasSrc, markdown: hasMd };
    p.prefix = prefix;
    // 面包屑 = 源结构路径：总览 › Paper › Development › API › Command API › Basics › Introduction
    const navMeta = p.navMeta || null;
    const crumbItems = [{ label: '总览', href: prefix + 'index.html' }];
    if (navMeta) {
      for (const c of navMeta.crumbs) {
        crumbItems.push({ label: c.label, href: c.href ? prefix + c.href : null });
      }
    } else {
      crumbItems.push({ label: p.sectionTitle, href: prefix + 'sections/' + p.section + '.html' });
      crumbItems.push({ label: p.title });
    }
    const crumbs = L.crumbsHtml(crumbItems);
    const metaChips = ['<a class="chip" href="' + U.attr(prefix + 'sections/' + p.section + '.html') + '">'
      + U.escapeHtml(p.sectionTitle) + '</a>'];
    if (navMeta) {
      metaChips.push('<span class="chip">源结构 ' + U.escapeHtml(navMeta.groupPath || '（分区根级）') + '</span>');
      metaChips.push('<span class="chip">源结构第 ' + navMeta.index + ' 篇 / 共 ' + navMeta.total + ' 篇</span>');
      if (navMeta.isGroupHome) metaChips.push('<span class="chip">分组「' + U.escapeHtml(navMeta.groupPath) + '」的索引页</span>');
      if (navMeta.isSectionRoot) metaChips.push('<span class="chip">分区根页</span>');
    }
    // 自建主题分类：降级为次要入口（读者仍可回溯旧分类）
    metaChips.push('<a class="chip" href="' + U.attr(prefix + 'categories/' + p.category + '.html')
      + '" title="按主题浏览（自定义）次入口">主题 ' + U.escapeHtml(p.categoryTitle) + '</a>');
    const viewOriginal = p.sourceUrl
      ? '<a class="tbtn external" href="' + U.attr(p.sourceUrl) + '" target="_blank" rel="noopener">查看原文</a>'
      : '';
    // one <h1> per document: the page title lives inside the article, followed by its metadata
    const titleId = p.titleId || U.slugify(p.title) || 'page';
    const titleHtml = '<h1 id="' + U.attr(titleId) + '" class="heading heading-1 page-title-h1">'
      + U.escapeHtml(p.title) + '</h1>'
      + (p.titleAliasId ? '<span id="' + U.attr(p.titleAliasId) + '" class="anchor-alias" aria-hidden="true"></span>' : '');
    const head = titleHtml
      + (p.description ? '<p class="page-desc">' + U.escapeHtml(p.description) + '</p>' : '')
      + '<p class="page-meta">' + metaChips.join('') + viewOriginal + '</p>';
    let article = p.html;
    const pager = L.pagerHtml(p.prev, p.next, prefix);
    const html = L.shell({
      site, prefix,
      title: p.title + ' · ' + p.sectionTitle + ' · ' + L.SITE_TITLE,
      description: p.summary || p.description || p.title,
      canonical: L.PUBLIC_BASE + p.section + '/' + p.rel.replace(/\/index$/, '') + (p.rel === 'index' ? '/' : '/'),
      active: { pageId: p.id, rel: p.rel, sectionId: p.section, categoryId: p.category, navGroupKeys: p.navGroupKeys || [] },
      // one <h1> per document, living inside the article: the page title + its metadata,
      // followed by the Markdown body whose own h1 the renderer already dropped.
      crumbs, toc: p.toc, content: '<article class="article">' + head + article + '</article>',
      pager, page: p,
    });
    const bytes = U.writeFile(outAbs, html);
    written.pages.push({ id: p.id, output: U.posix(path.relative(U.SITE, outAbs)), bytes });
  }

  for (const cat of site.categories) {
    const outAbs = path.join(U.SITE, 'categories', cat.id + '.html');
    const prefix = U.relUrl(path.dirname(outAbs), U.SITE) + '/';
    const html = L.categoryPage(site, cat, { prefix, generatedAt: state.generatedAt, taxonomyPending: tax.mode !== 'taxonomy' });
    const bytes = U.writeFile(outAbs, html);
    written.categories.push({ id: cat.id, output: U.posix(path.relative(U.SITE, outAbs)), bytes, pages: cat.pages.length });
  }

  for (const sec of site.sections) {
    const outAbs = path.join(U.SITE, 'sections', sec.id + '.html');
    const prefix = U.relUrl(path.dirname(outAbs), U.SITE) + '/';
    const html = L.sectionPage(site, sec, { prefix, generatedAt: state.generatedAt, taxonomyPending: tax.mode !== 'taxonomy' });
    const bytes = U.writeFile(outAbs, html);
    written.sections.push({ id: sec.id, output: U.posix(path.relative(U.SITE, outAbs)), bytes, pages: sec.pageCount });
  }

  const idxAbs = path.join(U.SITE, 'index.html');
  const taskSpec = [
    ['服主路线', '装一台 Paper 服务端', '从下载、启动脚本到插件安装与版本更新', 'paper:getting-started/index'],
    ['开发者路线', '写第一个插件', '工程搭建、事件监听、命令注册与调试', 'paper:dev/getting-started/paper-plugins/index'],
    ['调优与排错', '性能调优与故障处理', 'JVM 参数、profiling 与启动/崩溃排错', 'paper:aikars-flags/index'],
  ];
  const tasks = taskSpec
    .filter(([, , , id]) => state.pageByKey.has(id))
    .map(([kicker, title, desc, id]) => {
      const pg = state.pageByKey.get(id);
      return { kicker, title, desc, href: pg.section + '/' + pg.rel + '.html' };
    });
  const idxHtml = L.overviewPage(site, state.stats, {
    prefix: '', generatedAt: state.generatedAt, tasks,
    sourceNavSha: nav && nav.sha256,
    taxonomyMode: tax.mode === 'taxonomy'
      ? '分类体系：data/taxonomy.json（' + tax.categories.size + ' 个分类）'
      : '分类体系待生成：manifest 目录结构回退模式',
    taxonomyPending: tax.mode !== 'taxonomy',
  });
  const idxBytes = U.writeFile(idxAbs, idxHtml);

  // library/all-pages.html —— 141 页扁平清单，按源结构先序
  const allRows = [];
  if (nav) {
    for (const sec of nav.sections) {
      for (const e of sec.preorder) {
        const p = state.pageByKey.get(e.key);
        if (!p) continue;
        allRows.push({
          index: e.index, kind: e.kind, sectionTitle: sec.title,
          rel: e.rel, href: sec.id + '/' + e.rel + '.html',
          label: (p.navMeta && p.navMeta.label) || e.title,
          title: p.title, summary: p.summary || p.description || '',
          groupPath: (p.navMeta && p.navMeta.groupPath) || '',
          pathText: (p.navMeta && p.navMeta.pathText) || '',
        });
      }
    }
  }
  const allAbs = path.join(U.SITE, 'all-pages.html');
  const allHtml = L.allPagesPage(site, allRows, { prefix: '', generatedAt: state.generatedAt });
  const allBytes = U.writeFile(allAbs, allHtml);
  written.allPages = { output: 'all-pages.html', bytes: allBytes, rows: allRows.length };

  const snapRows = pages.map((p) => ({
    title: p.title, rel: p.rel, url: p.url,
    sectionTitle: p.sectionTitle, categoryTitle: p.categoryTitle,
    navPath: p.navPathText || p.categoryTitle,
    pageHref: p.section + '/' + p.rel + '.html',
    htmlHref: U.relUrl(U.SITE, path.join(U.ROOT, 'archive', p.section, 'html', p.rel + '.html')),
    sourceHref: U.relUrl(U.SITE, path.join(U.ROOT, 'archive', p.section, 'source', p.rel + '.md')),
    markdownHref: U.relUrl(U.SITE, path.join(U.ROOT, 'archive', p.section, 'markdown', p.rel + '.md')),
    exists: p.snapshotExists || { html: false, source: false, markdown: false },
  }));
  const snapAbs = path.join(U.SITE, 'snapshots.html');
  const snapHtml = L.snapshotsPage(site, snapRows, { prefix: '', generatedAt: state.generatedAt });
  const snapBytes = U.writeFile(snapAbs, snapHtml);

  const cssBytes = U.writeFile(path.join(U.SITE, 'assets', 'site.css'), SITE_CSS);
  const jsBytes = U.writeFile(path.join(U.SITE, 'assets', 'site.js'), SITE_JS);
  const faviconBytes = U.writeFile(path.join(U.SITE, 'assets', 'favicon.svg'), FAVICON_SVG);
  const searchJsonBytes = U.writeFile(path.join(U.SITE, 'search-index.json'), state.search.json);
  const searchJsBytes = U.writeFile(path.join(U.SITE, 'assets', 'search-index.js'), state.search.js);

  // 404.html（相对链接回首页；样式内联）
  const notFoundBytes = U.writeFile(path.join(U.SITE, '404.html'), L.notFoundPage({ pageCount: pages.length }));
  // robots.txt
  const robotsBytes = U.writeFile(path.join(U.SITE, 'robots.txt'), L.robotsTxt());
  // sitemap.xml：141 个内容页 + 落地页 + all-pages.html + snapshots.html（公网绝对 URL）
  const sitemapRows = [{ loc: L.PUBLIC_BASE, lastmod: (state.generatedAt || '').slice(0, 10) }];
  for (const sec of (nav ? nav.sections : [])) {
    for (const e of sec.preorder) {
      const pg = state.pageByKey.get(e.key);
      if (!pg) continue;
      sitemapRows.push({
        loc: L.publicUrl(pg.section + '/' + pg.rel + '.html'),
        lastmod: String(pg.fetchedAt || '').slice(0, 10),
      });
    }
  }
  sitemapRows.push({ loc: L.PUBLIC_BASE + 'all-pages.html', lastmod: (state.generatedAt || '').slice(0, 10) });
  sitemapRows.push({ loc: L.PUBLIC_BASE + 'snapshots.html', lastmod: (state.generatedAt || '').slice(0, 10) });
  const sitemapBytes = U.writeFile(path.join(U.SITE, 'sitemap.xml'), L.sitemapXml(sitemapRows));

  return Object.assign(written, {
    index: { output: 'index.html', bytes: idxBytes },
    notFound: { output: '404.html', bytes: notFoundBytes },
    robots: { output: 'robots.txt', bytes: robotsBytes },
    sitemap: { output: 'sitemap.xml', bytes: sitemapBytes, urls: sitemapRows.length },
    allPages: { output: 'all-pages.html', bytes: allBytes, rows: allRows.length },
    snapshots: { output: 'snapshots.html', bytes: snapBytes, rows: snapRows.length },
    assets: {
      css: { output: 'assets/site.css', bytes: cssBytes },
      js: { output: 'assets/site.js', bytes: jsBytes },
      favicon: { output: 'assets/favicon.svg', bytes: faviconBytes },
      searchJs: { output: 'assets/search-index.js', bytes: searchJsBytes },
    },
    searchJson: { output: 'search-index.json', bytes: searchJsonBytes },
  });
}

// ---------------------------------------------------------------------------
// 6. anchor recovery + visible marking for anchors that cannot be localised
// ---------------------------------------------------------------------------

/**
 * The upstream Starlight config pages give every nested list key an id built from its
 * nesting path (`anticheat` > `anti-xray` > `enabled` -> anticheat_anti_xray_enabled).
 * The archived Markdown lost those ids, so recover the exact ones that inbound links need
 * by walking the rendered <li> tree and rebuilding each item's path from its key code span.
 * Only ids that are actually referenced are injected — nothing else changes.
 */
function recoverListAnchors(html, needed) {
  const recovered = [];
  if (!needed || !needed.size) return { html, recovered };
  const tokRe = /<(\/?)(ul|ol|li)\b[^>]*>/g;
  const itemStack = [];
  const inject = [];
  let m;
  while ((m = tokRe.exec(html)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2];
    if (tag !== 'li') continue;
    if (closing) { itemStack.pop(); continue; }
    const tagStart = m.index;
    const tagEnd = m.index + m[0].length;      // first char after ">"
    const gtIdx = tagEnd - 1;                  // index of ">"
    if (/\sid="/.test(m[0])) { itemStack.push('\u0000'); continue; }
    const rest = html.slice(tagEnd, tagEnd + 1200);
    // a nested list / block ends the item's own lead-in; <p> wrappers are transparent
    const stop = rest.search(/<ul\b|<ol\b|<\/li\b|<div\b|<pre\b|<table\b|<blockquote\b/);
    let lead = stop === -1 ? rest : rest.slice(0, stop);
    lead = lead.replace(/<\/?p\b[^>]*>/g, '');
    const cm = lead.match(/<code[^>]*>([\s\S]*?)<\/code>/);
    const parent = itemStack.length ? itemStack[itemStack.length - 1] : '';
    let path = parent + '_\u0000keyless';
    if (cm) {
      const seg = U.decodeAttrText(cm[1]).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (seg) path = parent ? parent + '_' + seg : seg;
    }
    itemStack.push(path);
    if (needed.has(path) && !/\sid="/.test(html.slice(tagStart, gtIdx))) {
      inject.push({ at: gtIdx, path });
    }
  }
  let out = html;
  for (let i = inject.length - 1; i >= 0; i--) {
    const { at, path } = inject[i];
    out = out.slice(0, at) + ' id="' + U.attr(path) + '"' + out.slice(at);
    recovered.push(path);
  }
  return { html: out, recovered };
}

/** rewrite href="X#frag" -> href="X" and add a visible marker (target page has no such anchor) */
function degradeAnchor(html, hrefWithFrag, hrefWithoutFrag, titleText) {
  const needle = 'href="' + U.attr(hrefWithFrag) + '"';
  let out = html;
  let idx = 0;
  while ((idx = out.indexOf(needle, idx)) !== -1) {
    const tagStart = out.lastIndexOf('<a', idx);
    const tagEnd = out.indexOf('>', idx);
    if (tagStart === -1 || tagEnd === -1) break;
    let tag = out.slice(tagStart, tagEnd).replace(needle, 'href="' + U.attr(hrefWithoutFrag) + '"');
    if (!/anchor-missing/.test(tag)) {
      if (/\sclass="/.test(tag)) tag = tag.replace(/\sclass="([^"]*)"/, ' class="$1 anchor-missing"');
      else tag += ' class="anchor-missing"';
    }
    if (titleText && !/\stitle="/.test(tag)) tag += ' title="' + U.attr(titleText) + '"';
    out = out.slice(0, tagStart) + tag + out.slice(tagEnd);
    idx = tagStart + tag.length;
  }
  return out;
}

/** add a visible "target has no such anchor" marker to an anchor whose fragment cannot be fixed */
function decorateAnchor(html, hrefExact, titleText) {
  const needle = 'href="' + U.attr(hrefExact) + '"';
  let out = html;
  let idx = 0;
  while ((idx = out.indexOf(needle, idx)) !== -1) {
    const tagStart = out.lastIndexOf('<a', idx);
    const tagEnd = out.indexOf('>', idx);
    if (tagStart === -1 || tagEnd === -1) break;
    let tag = out.slice(tagStart, tagEnd);
    if (/anchor-missing/.test(tag)) { idx = tagEnd; continue; }
    if (/\sclass="/.test(tag)) tag = tag.replace(/\sclass="([^"]*)"/, ' class="$1 anchor-missing"');
    else tag += ' class="anchor-missing"';
    if (titleText && !/\stitle="/.test(tag)) tag += ' title="' + U.attr(titleText) + '"';
    out = out.slice(0, tagStart) + tag + out.slice(tagEnd);
    idx = tagStart + tag.length;
  }
  return out;
}

/**
 * After all pages are finalised: try to create the missing ids, mark what is still broken.
 * @returns {{recovered:number, unresolved:Array<object>}}
 */
function resolveAnchors(pages, warnList) {
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const unresolvedWarns = warnList.filter((w) => w.kind === 'fragment-unresolved');
  const needed = new Map();   // targetId -> Set(frag)
  const wanted = [];          // every request
  for (const w of unresolvedWarns) {
    if (!w.target || !w.frag) continue;
    if (!needed.has(w.target)) needed.set(w.target, new Set());
    needed.get(w.target).add(w.frag);
    wanted.push(w);
  }

  let recoveredCount = 0;
  const recoveredByTarget = new Map(); // targetId -> Set(frag)
  for (const [targetId, frags] of needed) {
    const target = pageById.get(targetId);
    if (!target || target.html === undefined) continue;
    const { html, recovered } = recoverListAnchors(target.html, frags);
    if (recovered.length) {
      target.html = html;
      for (const id of recovered) {
        target.headingIds.push(id);
        const sm = recoveredByTarget.get(targetId) || new Set();
        sm.add(id);
        recoveredByTarget.set(targetId, sm);
      }
      recoveredCount += recovered.length;
    }
  }

  const unresolved = [];
  for (const w of wanted) {
    if (recoveredByTarget.has(w.target) && recoveredByTarget.get(w.target).has(w.frag)) {
      warn('fragment-recovered', w.from + ': 锚点 #' + w.frag + ' 已按配置键路径在 ' + w.target + ' 中补回');
      continue;
    }
    unresolved.push({ from: w.from, target: w.target, frag: w.frag, href: w.href, recovered: false });
    // Same-page anchors are already marked by the renderer. For cross-page anchors that cannot
    // be recovered the link degrades to the top of the target page and keeps a visible marker.
    if (w.from !== w.target) {
      const from = pageById.get(w.from);
      const target = pageById.get(w.target);
      if (from && target && from.html !== undefined) {
        const withoutFrag = U.relUrl(path.dirname(from.outAbs), target.outAbs);
        from.html = degradeAnchor(from.html, withoutFrag + '#' + w.frag, withoutFrag,
          '目标页没有这个锚点 #' + w.frag + '，已跳到页面顶部');
      }
    }
  }
  // drop the now-recovered warnings from the report list
  const keep = warnList.filter((w) => w.kind !== 'fragment-unresolved');
  warnList.length = 0;
  warnList.push(...keep);
  for (const w of unresolved) {
    warnList.push({
      kind: 'fragment-unresolved',
      message: w.from + ': 目标页 ' + w.target + ' 无锚点 #' + w.frag + '（已加可见标记 anchor-missing）',
      from: w.from, target: w.target, frag: w.frag,
    });
  }
  return { recovered: recoveredCount, unresolved };
}

// ---------------------------------------------------------------------------
// 7. self test
// ---------------------------------------------------------------------------

function pickSample(pages, count) {
  const preferred = [
    'paper:anti-xray/index', 'paper:aikars-flags/index', 'paper:getting-started/index',
    'paper:dev/command-api/arguments/minecraft/index', 'paper:reference/world-configuration/index',
    'paper:admin/getting-started/index', 'velocity:built-in-commands/index',
    'velocity:dev/creating-your-first-plugin/index', 'velocity:index', 'paper:index',
  ];
  const byId = new Map(pages.map((p) => [p.id, p]));
  const sample = [];
  for (const id of preferred) {
    const p = byId.get(id);
    if (p && !sample.includes(p)) sample.push(p);
  }
  let seed = 20261020;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pool = pages.filter((p) => !sample.includes(p));
  while (sample.length < count && pool.length) {
    sample.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return sample;
}

/**
 * Load the ranking code that is actually shipped inside assets/site.js and run it in Node,
 * so the search self test measures the delivered implementation rather than a copy of it.
 */
function loadShippedRanker() {
  const src = SITE_JS;
  const start = src.indexOf('function norm(s)');
  const end = src.indexOf('function setCount(');
  if (start === -1 || end === -1) return null;
  const snippet = src.slice(start, end);
  const phraseMap = {};
  for (const p of S.PHRASES) phraseMap[p.q] = p;
  try {
    // eslint-disable-next-line no-new-func
    return new Function('ALIASES', 'CJK', 'PHRASE_BY_Q', snippet
      + '\nreturn { score: score, termScore: termScore, partScore: partScore, compareHits: compareHits };')(S.ALIASES, /[\u3400-\u9fff]/, phraseMap);
  } catch (e) {
    warn('selftest-ranker-load', '无法载入内置排序函数用于自测：' + e.message);
    return null;
  }
}

function hexLuminance(hex) {
  const h = String(hex).replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = v.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a, b) {
  const l1 = hexLuminance(a);
  const l2 = hexLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

function runSelfTest(state) {
  const { pages, site } = state;
  const sample = pickSample(pages, Math.max(8, Math.min(14, pages.length)));
  const checks = [];
  const push = (page, name, ok, detail) => checks.push({ page: page ? page.id : '-', name, ok: !!ok, detail: detail || '' });
  let totalLocalLinks = 0;
  let totalLocalImages = 0;

  for (const p of sample) {
    const outAbs = path.join(U.SITE, p.section, p.rel + '.html');
    const exists = fs.existsSync(outAbs);
    push(p, '输出 HTML 存在', exists, U.posix(path.relative(U.SITE, outAbs)));
    if (!exists) continue;
    const html = U.readText(outAbs);

    push(p, '无 BOM / charset=utf-8', html.charCodeAt(0) !== 0xfeff && /<meta charset="utf-8">/.test(html), '');
    const gotCode = countOccurrences(html, '<figure class="code-block');
    push(p, '代码块数量一致', gotCode === p.srcCounts.code, 'markdown=' + p.srcCounts.code + ' html=' + gotCode);
    push(p, '代码块带 title 一致', gotCode >= p.srcCounts.codeWithTitle, 'title=' + p.srcCounts.codeWithTitle);
    const gotAlerts = countOccurrences(html, 'class="alert alert-');
    push(p, '告警数量一致', gotAlerts === p.srcCounts.alert, 'markdown=' + p.srcCounts.alert + ' html=' + gotAlerts);
    const gotTables = countOccurrences(html, '<div class="table-wrap">');
    push(p, '表格数量一致', gotTables === p.srcCounts.table, 'markdown=' + p.srcCounts.table + ' html=' + gotTables);
    const gotDetails = countOccurrences(html, '<details class="details-block"');
    push(p, 'details 数量一致', gotDetails === p.srcCounts.rawDetails, 'markdown=' + p.srcCounts.rawDetails + ' html=' + gotDetails);
    push(p, '代码内容未被二次转义', !/<pre[^>]*><code[^>]*>(<|&lt;)?figure class="code-block"/.test(html) && !/&amp;lt;details/.test(html), '');

    // images
    const imgs = [...html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    let imgOk = true;
    let imgBad = [];
    for (const src of imgs) {
      if (/^(https?:|data:|\/\/)/i.test(src)) continue;
      totalLocalImages += 1;
      const abs = path.resolve(path.dirname(outAbs), decodeURI(src.split('#')[0]));
      if (!fs.existsSync(abs)) { imgOk = false; imgBad.push(src); }
    }
    push(p, '本地图片路径全部存在', imgOk, imgs.length + ' 张图，缺失: ' + imgBad.slice(0, 3).join(', '));
    push(p, '图片带 loading=lazy 或 data-uri', imgs.every((s) => /^data:/.test(s)) || /loading="lazy"/.test(html), '');

    // links
    const links = [...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((m) => m[1]);
    let linkOk = true;
    const linkBad = [];
    for (const href of links) {
      if (/^(https?:|mailto:|tel:|data:|#|\/\/)/i.test(href)) continue;
      totalLocalLinks += 1;
      const abs = path.resolve(path.dirname(outAbs), decodeURI(href.split('#')[0]));
      if (!fs.existsSync(abs)) { linkOk = false; linkBad.push(href); }
    }
    push(p, '本地相对链接全部存在', linkOk, links.length + ' 条链接，缺失: ' + linkBad.slice(0, 3).join(', '));

    // sidebar highlight (current page link carries class="active" + aria-current)
    const sidebarActive = new RegExp('<a href="[^"]*"[^>]*class="active"[^>]*aria-current="page"').test(html)
      || new RegExp('<a href="[^"]*"[^>]*aria-current="page"[^>]*class="active"').test(html);
    push(p, '侧栏当前页高亮', sidebarActive, '');
    push(p, '面包屑 / 原文链接', /class="crumbs"/.test(html) && /查看原文/.test(html), '');
    const prefix = U.relUrl(path.dirname(outAbs), U.SITE) + '/';
    push(p, 'asset 相对路径可解析',
      fs.existsSync(path.resolve(path.dirname(outAbs), prefix + 'assets/site.css'))
      && fs.existsSync(path.resolve(path.dirname(outAbs), prefix + 'assets/search-index.js')), 'prefix=' + prefix);
  }

  // site-wide invariants
  const allOut = pages.map((p) => path.join(U.SITE, p.section, p.rel + '.html'));
  const missingOut = allOut.filter((f) => !fs.existsSync(f));
  push(null, '全部页面均已生成', missingOut.length === 0, missingOut.length + ' 个缺失');

  // exactly one <h1> in EVERY produced HTML file (pages + index + all-pages + sections + categories + snapshots)
  // 只遍历“站点产物”：根级 4 个 HTML + 三个分区目录 + categories/sections。
  // 站点根 = 仓库根，所以不能整目录递归（会扫到 archive/** 的原始 HTML 快照与 node_modules）。
  const allHtmlAbs = [];
  (function collectHtml(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (!U.SITE_SKIP_DIRS.includes(e.name)) collectHtml(f); }
      else if (f.endsWith('.html')) allHtmlAbs.push(f);
    }
  })(U.SITE);
  let docH1Bad = 0, artH1Bad = 0;
  const h1BadSample = [];
  for (const f of allHtmlAbs) {
    const html = U.readText(f);
    const doc = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    const docH1 = (doc.match(/<h1\b/g) || []).length;
    if (docH1 !== 1) { docH1Bad += 1; if (h1BadSample.length < 6) h1BadSample.push(U.posix(path.relative(U.SITE, f)) + ' h1=' + docH1); }
    if (doc.indexOf('<article class="article">') !== -1) {
      const art = doc.slice(doc.indexOf('<article class="article">'), doc.indexOf('</article>'));
      const artH1 = (art.match(/<h1\b/g) || []).length;
      if (artH1 !== 1) { artH1Bad += 1; if (h1BadSample.length < 6) h1BadSample.push(U.posix(path.relative(U.SITE, f)) + ' artH1=' + artH1); }
    }
  }
  push(null, '每个产物 HTML 恰好 1 个 h1（共 ' + allHtmlAbs.length + ' 个）', docH1Bad === 0,
    docH1Bad + ' 页异常 ' + h1BadSample.join(', '));
  push(null, '每页 article 内恰好 1 个 h1', artH1Bad === 0, artH1Bad + ' 页异常');

  // build-time fields must not leak into index / all-pages / sections / categories / snapshots
  const debugChipRe = /order\s+\d+|data-order=|<span class="ord">|分类 id:|<span class="chip">(paper|velocity|folia)<\/span>|chip">[a-z-]+\/index</;
  const catChipBad = site.categories.filter((c) => {
    const f = path.join(U.SITE, 'categories', c.id + '.html');
    if (!fs.existsSync(f)) return true;
    const t = U.readText(f);
    const body = t.slice(t.indexOf('<main class="content">'), t.indexOf('</main>'));
    return debugChipRe.test(body);
  });
  push(null, '分类页无构建期调试 chip', catChipBad.length === 0, catChipBad.length + ' 个分类页仍含 order/id/rel 徽章');

  // ---- 源结构主导航 ----
  const navModel = state.site.sourceNav;
  const navPreorderTotal = navModel.sections.reduce((n, s) => n + s.preorder.length, 0);
  push(null, '源结构覆盖：先序页数 = 产物页数（' + pages.length + '）', navPreorderTotal === pages.length && navModel.coverage.ok,
    navPreorderTotal + '/' + pages.length + ' coverage=' + navModel.coverage.ok);
  push(null, '源结构覆盖：每 section 页数 = manifest 页数（' + navModel.sections.map((s) => s.id + ' ' + s.manifestPageCount).join(' / ') + '）',
    navModel.sections.every((s) => s.preorder.length === s.manifestPageCount),
    navModel.sections.map((s) => s.id + ' ' + s.preorder.length + '/' + s.manifestPageCount).join(' '));
  push(null, '组首页 rel↔分组路径 映射全部命中（' + navModel.mapping.checked + ' 条）',
    navModel.mapping.unattached.length === 0 && navModel.mapping.mismatched.length === 0,
    'unattached=' + navModel.mapping.unattached.length + ' mismatch=' + navModel.mapping.mismatched.length);
  const notInNavTotal = navModel.sections.reduce((n, s) => n + s.pagesNotInNav, 0);
  const homeTotal = navModel.sections.reduce((n, s) => n + s.groupHomes, 0);
  push(null, notInNavTotal + ' 个组首页/根页全部分配（' + homeTotal + ' 个挂到组 + ' + navModel.sections.length + ' 个分区根页挂到分区标题）',
    notInNavTotal === homeTotal + navModel.sections.length, 'notInNav=' + notInNavTotal + ' groupHomes=' + homeTotal);
  const idxProbe = fs.existsSync(path.join(U.SITE, 'index.html')) ? U.readText(path.join(U.SITE, 'index.html')) : '';
  const idxNavLinks = new Set([...idxProbe.matchAll(/href="((?:paper|velocity|folia)\/[^"]+\.html)"/g)].map((m) => m[1]));
  const unreachable = pages.filter((p) => !idxNavLinks.has(p.section + '/' + p.rel + '.html'));
  push(null, pages.length + ' 页全部可从 library/index.html 主导航到达（' + idxNavLinks.size + ' 个页面链接）',
    unreachable.length === 0 && idxNavLinks.size === pages.length,
    unreachable.length + ' 页不可达：' + unreachable.slice(0, 3).map((p) => p.id).join(', '));

  // 上一页 / 下一页：同 section、首尾不越界、无自指、链闭合
  const pagerBad = [];
  for (const sec of navModel.sections) {
    const first = state.pageByKey.get(sec.preorder[0].key);
    const last = state.pageByKey.get(sec.preorder[sec.preorder.length - 1].key);
    if (first && first.prev) pagerBad.push(first.id + ' 首篇仍有上一页');
    if (last && last.next) pagerBad.push(last.id + ' 末篇仍有下一页');
    for (const e of sec.preorder) {
      const p = state.pageByKey.get(e.key);
      if (!p || !p.outAbs) continue;
      if (p.prev && (p.prev.id === p.id || p.prev.section !== p.section)) pagerBad.push(p.id + ' prev 异常');
      if (p.next && (p.next.id === p.id || p.next.section !== p.section)) pagerBad.push(p.id + ' next 异常');
      if (p.next && p.next.prev !== p) pagerBad.push(p.id + ' → ' + p.next.id + ' 链不闭合');
      if (p.prev && p.prev.next !== p) pagerBad.push(p.id + ' ← ' + p.prev.id + ' 链不闭合');
      const html = fs.existsSync(p.outAbs) ? U.readText(p.outAbs) : '';
      const pagerBlock = /<nav class="pager"[\s\S]*?<\/nav>/.exec(html);
      if (!pagerBlock) { pagerBad.push(p.id + ' 缺 pager'); continue; }
      if (p.prev && !pagerBlock[0].includes(p.prev.section + '/' + p.prev.rel + '.html')) pagerBad.push(p.id + ' pager 缺上一页');
      if (p.next && !pagerBlock[0].includes(p.next.section + '/' + p.next.rel + '.html')) pagerBad.push(p.id + ' pager 缺下一页');
      if (!p.prev && /class="prev"/.test(pagerBlock[0])) pagerBad.push(p.id + ' 首篇渲染了上一页');
      if (!p.next && /class="next"/.test(pagerBlock[0])) pagerBad.push(p.id + ' 末篇渲染了下一页');
    }
  }
  push(null, '上一页/下一页 = 源树先序（同 section、首尾不越界、无自指、链闭合）', pagerBad.length === 0,
    pagerBad.slice(0, 5).join('；') || pages.length + ' 页全部合格');

  // 面包屑 = 源结构路径
  const crumbProbeRel = 'dev/command-api/basics/introduction/index';
  const crumbProbe = state.pageByKey.get('paper:' + crumbProbeRel);
  const crumbBad = [];
  for (const p of pages) {
    if (!p.navMeta || !p.outAbs || !fs.existsSync(p.outAbs)) continue;
    const html = U.readText(p.outAbs);
    const blk = /<nav class="crumbs"[\s\S]*?<\/nav>/.exec(html);
    if (!blk) { crumbBad.push(p.id + ' 缺面包屑'); continue; }
    const plain = blk[0].replace(/<[^>]*>/g, '').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
    if (!plain.includes(p.sectionTitle) || !plain.includes(p.navMeta.label)) crumbBad.push(p.id + ' 面包屑缺源结构路径');
  }
  push(null, '面包屑 = 源结构路径（含上游分组标签，' + pages.length + ' 页）', crumbBad.length === 0, crumbBad.slice(0, 5).join('；'));
  let crumbSample = '';
  if (crumbProbe && crumbProbe.outAbs && fs.existsSync(crumbProbe.outAbs)) {
    const blk = /<nav class="crumbs"[\s\S]*?<\/nav>/.exec(U.readText(crumbProbe.outAbs));
    crumbSample = blk ? blk[0].replace(/<[^>]*>/g, '').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim() : '';
  }
  const expectCrumb = '总览 / Paper / Development / API / Command API / Basics / Introduction';
  push(null, '面包屑示例 paper:' + crumbProbeRel, crumbSample === expectCrumb, '实测「' + crumbSample + '」');

  // ---- all-pages.html ----
  const allAbs = path.join(U.SITE, 'all-pages.html');
  const allTxt = fs.existsSync(allAbs) ? U.readText(allAbs) : '';
  const allRowHrefs = [...allTxt.matchAll(/<td class="lnk"><a href="([^"]+)"/g)].map((m) => m[1]);
  const expectRowHrefs = [];
  for (const sec of navModel.sections) for (const e of sec.preorder) expectRowHrefs.push(sec.id + '/' + e.rel + '.html');
  push(null, 'all-pages.html 行数 = ' + pages.length + ' 且顺序 = 源结构先序',
    allRowHrefs.length === pages.length && JSON.stringify(allRowHrefs) === JSON.stringify(expectRowHrefs),
    allRowHrefs.length + '/' + pages.length);
  push(null, 'all-pages.html 有页内过滤框（Ctrl+F 之外的第二条路）',
    /data-table-filter="allpages"/.test(allTxt) && /id="allpages-count"/.test(allTxt)
    && /data-filter-clear="allpages"/.test(allTxt), '');

  // sidebar data-search coverage: every page link carries title + summary + 源结构组路径
  const somePage = pages.find((p) => p.rel === 'index') || pages[0];
  const sidebarProbe = fs.existsSync(somePage.outAbs) ? U.readText(somePage.outAbs) : '';
  const sideStart = sidebarProbe.indexOf('<nav class="sidebar"');
  const sidebarHtmlOnly = sideStart === -1 ? '' : sidebarProbe.slice(sideStart, sidebarProbe.indexOf('</nav>', sideStart));
  const sideAnchors = [...sidebarHtmlOnly.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  const sidePageAnchors = sideAnchors.filter((t) => /href="[^"]*(?:paper|velocity|folia)\/(?!\.\.)/.test(t));
  const sideMissing = sidePageAnchors.filter((t) => !/data-search="/.test(t));
  push(null, '侧栏 data-search 覆盖全部页面条目', sidePageAnchors.length > 0 && sideMissing.length === 0,
    sidePageAnchors.length + ' 条页面链接，缺 data-search ' + sideMissing.length);
  push(null, '侧栏 data-search 含中文摘要', /data-search="[^"]*[\u4e00-\u9fff]/.test(sidebarHtmlOnly), '');
  const probeMeta = crumbProbe && crumbProbe.navMeta ? crumbProbe.navMeta : null;
  const pathNeedle = probeMeta ? U.attr(probeMeta.groupPath) : '';
  const sideSearchVals = [...sidebarHtmlOnly.matchAll(/data-search="([^"]*)"/g)].map((m) => m[1]);
  push(null, '侧栏 data-search 写入源结构组路径',
    !!pathNeedle && sideSearchVals.some((v) => v.includes(pathNeedle)),
    'needle="' + (probeMeta ? probeMeta.groupPath : '') + '"');
  push(null, '侧栏仍提供「按主题浏览（自定义）」次要入口',
    /class="side-cat"/.test(sidebarHtmlOnly) && /按主题浏览（自定义）/.test(sidebarHtmlOnly)
    && site.categories.every((c) => sidebarHtmlOnly.includes('categories/' + c.id + '.html')), '');

  // empty TOC must not be emitted (P1-7)
  const noTocPages = pages.filter((p) => !p.toc || !p.toc.length);
  const tocLeak = noTocPages.filter((p) => fs.existsSync(p.outAbs) && /toc-side/.test(U.readText(p.outAbs)));
  push(null, '无标题页面不输出空目录', tocLeak.length === 0, noTocPages.length + ' 页无目录，泄漏 ' + tocLeak.length + ' 页');

  // alert badge contrast (P1-5, WCAG AA >= 4.5)
  const palette = [
    ['note', '#2563eb', '#6aa2ff'], ['tip', '#0b7a43', '#3ddc97'], ['important', '#7c3aed', '#b388ff'],
    ['warning', '#a35a00', '#f0b429'], ['caution', '#b45309', '#ff9d4d'], ['danger', '#dc2626', '#ff6b6b'],
  ];
  const contrastRows = palette.map(([name, light, dark]) => ({
    name, light: contrast(light, '#ffffff'), dark: contrast(dark, '#14161a'),
  }));
  const contrastBad = contrastRows.filter((r) => r.light < 4.5 || r.dark < 4.5);
  push(null, '告警徽标对比度 ≥ 4.5:1',
    contrastBad.length === 0,
    contrastRows.map((r) => r.name + ' ' + r.light + '/' + r.dark).join(' '));
  const activeContrast = { light: contrast('#1d4ed8', '#e3ebfd'), dark: contrast('#7aa2ff', '#1d2634') };
  push(null, '侧栏高亮项对比度 ≥ 4.5:1', activeContrast.light >= 4.5 && activeContrast.dark >= 4.5,
    'light=' + activeContrast.light + ' dark=' + activeContrast.dark);

  // shipped search ranking: run the code that assets/site.js actually ships
  const rankerFactory = loadShippedRanker();
  const rankQueries = ['性能', '权限', '代理', '插件加载', '命令注册', '配置文件', '事件', '优化'];
  const recallQueries = ['渲染', '命令注册', '权限', '优化', '插件加载', '配置文件', '命令', '事件', '代理', '依赖'];
  const rankResults = {};
  if (rankerFactory && state.search && state.search.payload) {
    const ranker = rankerFactory;
    for (const q of rankQueries.concat(recallQueries.filter((x) => rankQueries.indexOf(x) === -1))) {
      const terms = q.toLowerCase().split(/\s+/);
      const hits = [];
      for (const e of state.search.payload.pages) {
        const r = ranker.score(e, terms);
        if (r && r.s > 0) hits.push({ e, id: e.id, title: e.t, s: r.s, tier: r.tier, fields: r.fields });
      }
      hits.sort(ranker.compareHits);
      rankResults[q] = {
        hits: hits.length,
        top3: hits.slice(0, 3).map((h) => ({ id: h.id, title: h.title, s: h.s, tier: h.tier, fields: h.fields })),
      };
    }
  }
  push(null, '搜索召回：8 个中文词均有命中',
    rankQueries.every((q) => rankResults[q] && rankResults[q].hits > 0),
    rankQueries.map((q) => q + '=' + ((rankResults[q] || {}).hits || 0)).join(' '));
  push(null, '搜索召回：10 词全部非零（渲染/命令注册/权限/优化/插件加载/配置文件/命令/事件/代理/依赖）',
    recallQueries.every((q) => rankResults[q] && rankResults[q].hits > 0),
    recallQueries.map((q) => q + '=' + ((rankResults[q] || {}).hits || 0)).join(' '));
  push(null, '搜索排序：权限 → Permissions 第 1',
    !!rankResults['权限'] && (rankResults['权限'].top3[0] || {}).id === 'paper:reference/permissions/index',
    JSON.stringify((rankResults['权限'] || {}).top3 || []));
  push(null, '搜索排序：性能 → Tuning Velocity 第 1',
    !!rankResults['性能'] && (rankResults['性能'].top3[0] || {}).id === 'velocity:tuning/index',
    JSON.stringify((rankResults['性能'] || {}).top3 || []));

  const catOut = site.categories.map((c) => path.join(U.SITE, 'categories', c.id + '.html'));
  push(null, '全部分类页已生成', catOut.every((f) => fs.existsSync(f)), catOut.length + ' 个分类页');
  const secOut = site.sections.map((s) => path.join(U.SITE, 'sections', s.id + '.html'));
  push(null, '全部分区页已生成', secOut.every((f) => fs.existsSync(f)), secOut.length + ' 个分区页');
  push(null, '搜索索引体积 ≤ 3 MiB', state.search.stats.jsonBytes <= 3 * 1024 * 1024,
    U.humanBytes(state.search.stats.jsonBytes));
  push(null, '搜索索引覆盖全部页面', state.search.stats.entries === pages.length,
    state.search.stats.entries + '/' + pages.length);
  push(null, '未修改归档目录', !fs.existsSync(path.join(U.ARCHIVES, 'build-manifest.json')), '');

  // ---- 产物 = 源（红队 F10）----
  const cssAbs = path.join(U.SITE, 'assets', 'site.css');
  const jsAbs = path.join(U.SITE, 'assets', 'site.js');
  const cssDisk = fs.existsSync(cssAbs) ? U.readText(cssAbs) : null;
  const jsDisk = fs.existsSync(jsAbs) ? U.readText(jsAbs) : null;
  push(null, '产物 = 源：assets/site.css 与 tools/site/assets.js 的 SITE_CSS 逐字节一致',
    cssDisk !== null && cssDisk === SITE_CSS,
    cssDisk === null ? '缺 assets/site.css' : (cssDisk === SITE_CSS ? '' : '不一致 → 先跑 node tools/build-site.js'));
  push(null, '产物 = 源：assets/site.js 与 tools/site/assets.js 的 SITE_JS 逐字节一致',
    jsDisk !== null && jsDisk === SITE_JS,
    jsDisk === null ? '缺 assets/site.js' : (jsDisk === SITE_JS ? '' : '不一致 → 先跑 node tools/build-site.js'));

  return {
    sample: sample.map((p) => p.id), checks, totalLocalLinks, totalLocalImages,
    contrastRows, activeContrast, rankResults, docH1Bad, artH1Bad, catChipBad: catChipBad.length,
    allHtmlFiles: allHtmlAbs.length, crumbSample, unreachablePages: unreachable.length,
    pagerBad: pagerBad.length, allPagesRows: allRowHrefs.length,
    sourceNavTotal: navPreorderTotal,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/** 仓库根的许可 / 来源声明文件：按优先级取第一个存在的（治理文件可能被改名，构建期探测） */
function resolveLicenseFile() {
  const candidates = ['LICENSE-PaperMC-docs.txt', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'LICENSE.md'];
  for (const c of candidates) if (fs.existsSync(path.join(U.SITE, c))) return c;
  return candidates[0];
}

function main() {
  log('== build-site: 离线资料库构建 ==');
  const licenseFile = resolveLicenseFile();
  L.setLicenseFile(licenseFile);
  log('      许可 / 来源声明文件: ' + licenseFile);
  log('[1/7] 读取 manifest …');
  const { pages, manifests } = loadManifests();
  if (!pages.length) throw new Error('no pages found in archives/*/manifest.json');

  log('[2/7] 读取 taxonomy …');
  const tax = loadTaxonomy(pages, manifests);
  log('      taxonomy(data/taxonomy.json): ' + (tax.present ? '已加载 ' + tax.categories.size + ' 分类 / ' + tax.pageMeta.size + ' 页' : '缺失 → manifest 回退模式'));
  if (tax.coverage.missingInTaxonomy.length || tax.coverage.extraInTaxonomy.length) {
    log('      覆盖率差集：缺页 ' + tax.coverage.missingInTaxonomy.length + ' / 多余 ' + tax.coverage.extraInTaxonomy.length);
  }

  log('[3/7] 渲染 Markdown（' + pages.length + ' 页）…');
  renderAllPages(pages);

  log('[3b/7] 装载源侧栏结构（data/source-nav.json）…');
  const pageByKey = new Map(pages.map((p) => [p.id, p]));
  const nav = NAV.loadSourceNav({ pageByKey, sections: SECTIONS });
  if (nav.present) {
    log('      source-nav.json sha256=' + String(nav.sha256).slice(0, 16) + '… '
      + nav.sections.map((s) => s.id + ': ' + s.preorder.length + ' 页 / ' + s.groupCount + ' 组 / 深度 ' + s.maxDepth
        + '（导航 ' + s.pagesInNav + ' + 组首页/根页 ' + s.pagesNotInNav + '）').join(' | '));
    log('      覆盖校验：' + (nav.coverage.ok ? 'PASS（' + pages.length + ' 页全部可从源结构到达）' : 'FAIL → ' + nav.coverage.problems.join('; ')));
  } else {
    log('      源结构缺失 → 侧栏回退到分区/分类模式');
  }
  for (const w of nav.warnings) warn(w.kind, w.message);

  const site = buildSiteModel(pages, tax, nav);
  site.sourceNav = nav;
  // output paths must exist before link resolution (relative URLs are computed from them).
  // Pages live at <siteRoot>/<section>/<rel>.html so the site URL mirrors the upstream path.
  for (const p of pages) {
    p.outAbs = path.join(U.SITE, p.section, p.rel + '.html');
  }

  // The document's single <h1> is the page title rendered by the shell. Reuse the id of the
  // Markdown h1 that the renderer dropped so in-page/back links keep working, and add an alias
  // anchor when the taxonomy title slugs differently from the upstream title.
  for (const p of pages) {
    const base = (p.markdownTitle && p.markdownTitle.id) || U.slugify(p.title) || 'page';
    p.titleId = uniqueIdIn(p.headingIds, base);
    if (!p.headingIds.includes(p.titleId)) p.headingIds.push(p.titleId);
    const aliasSlug = U.slugify(p.title);
    if (aliasSlug && aliasSlug !== p.titleId && !p.headingIds.includes(aliasSlug)) {
      p.titleAliasId = aliasSlug;
      p.headingIds.push(aliasSlug);
    }
  }

  const state = {
    pages, site, tax, manifests, nav,
    pageByKey: new Map(pages.map((p) => [p.id, p])),
    slugMaps: new Map(),
    generatedAt: new Date().toISOString(),
  };
  for (const p of pages) {
    const fuzzy = new Map();
    for (const id of p.headingIds || []) {
      const nk = U.normKey(id);
      if (!nk) continue;
      if (!fuzzy.has(nk)) fuzzy.set(nk, []);
      fuzzy.get(nk).push(id);
    }
    state.slugMaps.set(p.id, { ids: new Set(p.headingIds || []), fuzzy });
  }

  const linker = new Linker(state);

  log('[4/7] 改写链接 / 图片 / 脚注 …');
  for (const p of pages) {
    if (p.html === undefined) continue;
    p.html = R.finalizeHtml(p.html, p, linker);
  }

  // 图片 intrinsic 宽高（P1-1）：必须在链接/图片地址最终落定之后、写盘之前插入，
  // 这样 `src` 已经是相对输出目录的路径，可直接解析到磁盘上的真实文件。
  for (const p of pages) {
    if (p.html === undefined) continue;
    p.html = addIntrinsicImageSizes(p.html, p.outAbs);
  }

  // anchors that no heading provides (Starlight config-leaf ids lost in conversion) are
  // recovered from the list-key nesting path; whatever stays missing is marked visibly.
  const anchorFix = resolveAnchors(pages, warnings);
  log('      锚点回收 ' + anchorFix.recovered + ' / 仍缺失 ' + anchorFix.unresolved.length + '（已加可见标记）');

  // 宽高注入的自证：逐项记录未能写入的图片，绝不猜测尺寸
  if (IMG_SIZE_STATS.skippedDataUri) {
    warn('image-size-data-uri', IMG_SIZE_STATS.skippedDataUri + ' 张 data: URI 图片头无法解析，未写 width/height（不猜尺寸）');
  }
  if (IMG_SIZE_STATS.skippedMissingFile) {
    warn('image-size-file-missing', IMG_SIZE_STATS.skippedMissingFile + ' 张正文图片的 src 无法解析到磁盘文件，未写 width/height');
  }
  if (IMG_SIZE_STATS.skippedUnsupported) {
    warn('image-size-unreadable', IMG_SIZE_STATS.skippedUnsupported + ' 张正文图片头无法解析，未写 width/height：'
      + IMG_SIZE_STATS.failures.join(', '));
  }
  log('      图片 intrinsic 宽高 ' + IMG_SIZE_STATS.written + ' / ' + IMG_SIZE_STATS.candidates
    + ' 写入（含 data:URI ' + IMG_SIZE_STATS.dataUriSized
    + '；跳过 data:URI 头不可读 ' + IMG_SIZE_STATS.skippedDataUri
    + ' / 外链 ' + IMG_SIZE_STATS.skippedExternal
    + ' / 缺文件 ' + IMG_SIZE_STATS.skippedMissingFile
    + ' / 头不可读 ' + IMG_SIZE_STATS.skippedUnsupported + '）');

  for (const p of pages) {
    if (p.html === undefined) continue;
    // exactly one h1 per document: the shell owns it, the article's own h1 was dropped by the
    // renderer (its id is reused below), so count the article h1s for the self test.
    p.articleH1 = (p.html.match(/<h1\b/g) || []).length;
    p.text = R.htmlToText(p.html);
    p.tocText = (p.toc || []).map((h) => h.text);
    p.htmlCounts = {
      code: countOccurrences(p.html, '<figure class="code-block'),
      alerts: countOccurrences(p.html, 'class="alert alert-'),
      tables: countOccurrences(p.html, '<div class="table-wrap">'),
      images: countOccurrences(p.html, '<img '),
      details: countOccurrences(p.html, '<details class="details-block"'),
      headings: (p.html.match(/<h[1-6]\b/g) || []).length,
      recoveredAnchors: (p.html.match(/ id="[^"]*_/g) || []).length,
    };
  }

  const stats = {
    pages: pages.length,
    sections: site.sections.length,
    categories: site.categories.length,
    codeBlocks: pages.reduce((n, p) => n + (p.htmlCounts ? p.htmlCounts.code : 0), 0),
    codeFencePairs: pages.reduce((n, p) => n + ((p.srcCounts && p.srcCounts.fencePairs) || 0), 0),
    codeFencePairsPlain: pages.reduce((n, p) => n + ((p.srcCounts && p.srcCounts.fencePairsPlain) || 0), 0),
    codeFencePairsQuoted: pages.reduce((n, p) => n + ((p.srcCounts && p.srcCounts.fencePairsQuoted) || 0), 0),
    codeBlocksWithTitle: pages.reduce((n, p) => n + ((p.srcCounts && p.srcCounts.codeWithTitle) || 0), 0),
    alerts: pages.reduce((n, p) => n + (p.htmlCounts ? p.htmlCounts.alerts : 0), 0),
    tables: pages.reduce((n, p) => n + (p.htmlCounts ? p.htmlCounts.tables : 0), 0),
    images: pages.reduce((n, p) => n + (p.htmlCounts ? p.htmlCounts.images : 0), 0),
    detailsBlocks: pages.reduce((n, p) => n + (p.htmlCounts ? p.htmlCounts.details : 0), 0),
    headings: pages.reduce((n, p) => n + (p.htmlCounts ? p.htmlCounts.headings : 0) + 1, 0),
    headingsFromMarkdown: pages.reduce((n, p) => n + ((p.srcCounts && p.srcCounts.heading) || 0), 0),
    tocEntries: pages.reduce((n, p) => n + ((p.toc || []).length), 0),
    linksRewritten: linker.stats.rewrittenRelativeMd + linker.stats.rewrittenAbsoluteDocs,
    externalLinks: linker.stats.external,
    unmirroredLinks: linker.stats.unmirrored,
    unresolvedLinks: linker.stats.unresolvedLocal,
    fragmentsUnresolved: anchorFix.unresolved.length,
    fragmentsRecovered: anchorFix.recovered,
    fragmentsResolvedFuzzy: linker.stats.fragmentsResolvedFuzzy,
    crossSectionLinks: linker.stats.rewrittenCrossSection,
    footnotesResolved: linker.stats.footnotesResolved,
    footnotesMissing: linker.stats.footnotesMissing,
    imagesLocal: linker.stats.imagesLocal,
    imagesLocalized: linker.stats.imagesAbsoluteLocalized,
    imagesExternal: linker.stats.imagesExternal,
    imagesMissing: linker.stats.imagesMissing,
    imagesWithIntrinsicSize: IMG_SIZE_STATS.written,
    imagesIntrinsicSkipped: IMG_SIZE_STATS.candidates - IMG_SIZE_STATS.written,
    inDocH1NonUnique: pages.filter((p) => p.articleH1 !== 1).length,
    categoryPageDebugChips: 0,
    sourceNavGroups: nav.present ? nav.sections.reduce((n, s) => n + s.groupCount, 0) : 0,
    sourceNavPagesInNav: nav.present ? nav.sections.reduce((n, s) => n + s.pagesInNav, 0) : 0,
    sourceNavPagesNotInNav: nav.present ? nav.sections.reduce((n, s) => n + s.pagesNotInNav, 0) : 0,
    // “小节”= 生成页 article 内的 h2-h6（本页目录只收 h2-h4）
    subsections: pages.reduce((n, p) => n + (p.htmlCounts ? p.htmlCounts.headings : 0), 0),
  };
  stats.codeBlocksExtra = stats.codeBlocks - stats.codeFencePairs;
  state.stats = stats;
  state.linkerStats = linker.stats;

  log('[5/7] 构建搜索索引 …');
  const search = S.buildSearchIndex(pages.map((p) => ({
    id: p.id, outputRel: p.section + '/' + p.rel + '.html',
    title: p.title, section: p.section, sectionTitle: p.sectionTitle,
    category: p.category, categoryTitle: p.categoryTitle,
    categoryDescription: (site.categoryById.get(p.category) || {}).description || '',
    summary: p.summary, description: p.description, tags: p.tags, order: p.order,
    tocText: p.tocText, text: p.text,
    navPath: p.navPathText || '',
  })), { generatedAt: state.generatedAt });
  state.search = search;

  // Pre-compute, for every page, which of the curated Chinese phrases match it. This uses the
  // exact ranking code shipped inside assets/site.js. The result lives only in entry.kq — the
  // heading list (h) stays a faithful list of the page's real h2-h4 titles.
  const shippedRanker = loadShippedRanker();
  if (shippedRanker) {
    let kqTotal = 0;
    for (const e of search.payload.pages) {
      const kq = S.PHRASES.filter((ph) => shippedRanker.termScore(e, ph.q).s > 0).map((ph) => ph.q);
      if (kq.length) { e.kq = kq; kqTotal += kq.length; }
    }
    const ser = S.serialize(search.payload);
    search.json = ser.json;
    search.js = ser.js;
    search.stats.jsonBytes = Buffer.byteLength(ser.json, 'utf8');
    search.stats.jsBytes = Buffer.byteLength(ser.js, 'utf8');
    search.stats.precomputedPhrases = kqTotal;
    search.stats.pagesWithPhrases = search.payload.pages.filter((p) => Array.isArray(p.kq) && p.kq.length).length;
  }

  log('      ' + search.stats.entries + ' 条 / ' + U.humanBytes(search.stats.jsonBytes)
    + '（正文上限 ' + search.stats.bodyCapBytes + ' B，预计算命中词 ' + (search.stats.precomputedPhrases || 0) + ' 条）');

  log('[6/7] 清理旧产物并写入 …');
  cleanOutputs();
  const written = writeEverything(state);

  // 产物 = 源（红队 F10）：构建完立刻自证 assets/ 与 SITE_CSS/SITE_JS 逐字节一致，
  // 避免“源与产物错代”（改完源忘记重建，或产物被手工改过）静默通过。
  const cssOnDisk = U.readText(path.join(U.SITE, 'assets', 'site.css'));
  const jsOnDisk = U.readText(path.join(U.SITE, 'assets', 'site.js'));
  const artifactMatchesSource = cssOnDisk === SITE_CSS && jsOnDisk === SITE_JS;
  log('      产物 = 源 校验：' + (artifactMatchesSource
    ? 'assets/site.css · assets/site.js 与 tools/site/assets.js 的 SITE_CSS/SITE_JS 逐字节一致'
    : '不一致 ✗ 请先跑 node tools/build-site.js'));
  if (!artifactMatchesSource) process.exitCode = 1;
  state.artifactMatchesSource = artifactMatchesSource;
  state.siteTotals = computeSiteTotals(written);

  const manifest = {
    generated_at: state.generatedAt,
    generator: 'tools/build-site.js',
    mode: tax.mode,
    // 主导航的权威来源：docs.papermc.io 自己的 Starlight 侧栏结构
    sourceNav: {
      path: 'data/source-nav.json',
      sourceNavSha256: nav.sha256,
      present: nav.present,
      generated_at: nav.generatedAt,
      method: nav.method,
      consistent_across_pages: nav.consistentAcrossPages,
      breadcrumbSource: 'source-nav.json',
      prevNextOrder: 'source-preorder',
      coverage: {
        ok: nav.coverage.ok,
        problems: nav.coverage.problems,
        pagesCovered: nav.sections.reduce((n, s) => n + s.preorder.length, 0),
        pagesInNav: nav.sections.reduce((n, s) => n + s.pagesInNav, 0),
        pagesNotInNav: nav.sections.reduce((n, s) => n + s.pagesNotInNav, 0),
        reachableFromMainNav: nav.sections.reduce((n, s) => n + s.preorder.length, 0),
        note: nav.sections.reduce((n, s) => n + s.preorder.length, 0) + ' = '
          + nav.sections.reduce((n, s) => n + s.pagesInNav, 0) + ' 个上游 <a> 导航项 + '
          + nav.sections.reduce((n, s) => n + s.pagesNotInNav, 0)
          + ' 个组首页/分区根页（挂在组标题或分区标题上，先序插入）：'
          + nav.sections.map((s) => s.id + ' ' + s.pagesInNav + '+' + s.pagesNotInNav).join(' + '),
      },
      groupHomeMapping: {
        method: 'rel ↔ 分组路径（目录前缀 → 逐段标签匹配，与 tools/source-nav.js 的 reasonForMissing 同算法）',
        checked: nav.mapping.checked,
        mismatchedWithReason: nav.mapping.mismatched,
        unattached: nav.mapping.unattached,
      },
      sections: nav.sections.map((s) => ({
        id: s.id,
        title: s.title,
        sourceHref: s.sourceHref,
        groups: s.groupCount,
        pagesInNav: s.pagesInNav,
        pagesNotInNav: s.pagesNotInNav,
        maxDepth: s.maxDepth,
        preorderPages: s.preorder.length,
        groupHomes: s.groupHomes,
        root: s.rootRel,
        coverageOk: s.coverage.ok,
        sourceStatsMatch: s.coverage.statsMatch,
      })),
    },
    taxonomy: {
      present: tax.present,
      path: 'data/taxonomy.json',
      generated_at: tax.generatedAt,
      categories: tax.categories.size,
      pages: tax.pageMeta.size,
      coverage: tax.coverage,
    },
    sections: site.sections.map((s) => ({
      id: s.id, title: s.title, subtitle: s.subtitle, archive: s.archive,
      pageCount: s.pageCount, categories: s.categories.map((c) => c.id),
    })),
    categories: site.categories.map((c) => ({
      id: c.id, title: c.title, section: c.section, order: c.order,
      description: c.description, synthetic: c.synthetic, pageCount: c.pages.length,
      output: 'categories/' + c.id + '.html',
    })),
    counts: stats,
    countsMeta: {
      pages: '归档 manifest 中的页面数（' + SECTIONS.map((s) => s.id + ' ' + (manifests[s.id] ? (manifests[s.id].pages || []).length : 0)).join(' + ')
        + ' = ' + stats.pages + '）',
      categories: 'taxonomy.json 的分类数（回退模式为目录结构推导）',
      codeBlocks: '生成页中的代码块（<figure class="code-block">）总数 = 围栏块 ' + stats.codeFencePairs
        + '（顶层 ' + stats.codeFencePairsPlain + ' + 引用/告警内 ' + stats.codeFencePairsQuoted + '）',
      codeFencePairs: '源 Markdown 中的围栏块对数（顶层 + 以 "> " 前缀包裹在引用/告警里的）',
      codeBlocksWithTitle: 'info string 里带 title="…" 的代码块数（figcaption 显示文件名）',
      alerts: '源 Markdown 中的 GitHub 告警数（NOTE/TIP/IMPORTANT/WARNING/CAUTION/DANGER，含上游 md-features.json 漏掉的 DANGER）',
      tables: '生成页中的 GFM 表格总数（md-features.json 的 "gfm table header" 统计的是表格行，不是表格数）',
      images: '源 Markdown 中的图片引用数（![](...)），' + stats.images + ' = ' + stats.imagesLocal
        + ' 本地 + ' + stats.imagesExternal + ' 第三方外链 + 1 data: URI；不含每页灯箱占位 <img>',
      detailsBlocks: '源 Markdown 中的原始 <details> 折叠块数',
      headings: '生成页 article 内的 h1-h6 总数（= Markdown 标题数 - 被外壳接管的 h1 + 为无 h1 页面补的标题）',
      tocEntries: '“本页目录”条目总数（h2-h4）',
      linksRewritten: '相对 .md 链接 + 指向 docs.papermc.io 的绝对链接中被改写本地化的条数',
      externalLinks: '源 Markdown 中指向站外的链接条数（docs.papermc.io 之外）',
      unmirroredLinks: '源 Markdown 中指向 docs.papermc.io 未镜像区域（misc / adventure 等）的条数；folia 已纳入镜像，指向它的绝对链接改为本地化（计入 linksRewritten/crossSectionLinks）',
      unresolvedLinks: '无法本地化的相对链接条数（当前 0）',
      fragmentsUnresolved: '锚点目标页确实不存在该标题的条数（已加可见标记 anchor-missing）',
      fragmentsRecovered: '按配置键路径从嵌套列表键补回的锚点 id 数',
      imagesLocal: '本地相对路径图片（已校验文件存在）',
      imagesExternal: '第三方外链图片（保持在线，加 visible 提示）',
      imagesWithIntrinsicSize: '正文图片中已写入 intrinsic width/height 的条数（构建期读图片头，消除懒加载 CLS）',
      imagesIntrinsicSkipped: '正文图片中未写入宽高的条数（data: URI / 外链 / 文件缺失 / 格式不支持，逐项见 image-size-* 告警）',
      footnotesResolved: '已补 id 的脚注锚点数',
      sourceNavGroups: '源侧栏（source-nav.json）分组总数：' + nav.sections.map((s) => s.id + ' ' + s.groupCount).join(' + ')
        + ' = ' + stats.sourceNavGroups,
      sourceNavPagesInNav: '上游侧栏 <a> 导航项总数：' + nav.sections.map((s) => s.id + ' ' + s.pagesInNav).join(' + ')
        + ' = ' + stats.sourceNavPagesInNav,
      sourceNavPagesNotInNav: '组首页 / 分区根页总数：' + nav.sections.map((s) => s.id + ' ' + s.pagesNotInNav).join(' + ')
        + ' = ' + stats.sourceNavPagesNotInNav + '（挂在组标题或分区标题上，未丢弃）',
      subsections: '生成页 article 内的 h2-h6 小节总数（其中 h2-h4 进入“本页目录”= tocEntries）',
    },
    siteTotals: state.siteTotals,
    siteTotalsMeta: {
      htmlFiles: '生成的全部 HTML 文件数（' + stats.pages + ' 页 + ' + stats.categories + ' 分类 + ' + stats.sections + ' 分区 + index + all-pages + snapshots）',
      imgAll: '全部 HTML 中的 <img> 出现次数（含每页灯箱占位图，故远大于 counts.images）',
      imgInArticle: '仅正文 <article> 内的 <img>（与 counts.images + data-uri 可对账）',
      imgExternal: '正文中标注为 class="external-image" 的第三方外链图片',
      anchorsAll: '全部 HTML 中的 <a href> 出现次数（含侧栏、面包屑、页脚、上一页/下一页的重复出现）',
      anchorsExternal: '全部 HTML 中的站外 <a href="http…">（每页侧栏/页脚重复计入）',
      anchorsUnmirrored: '带 unmirrored 标记的锚点出现次数',
      anchorsInternalPage: '指向 <section>/<rel>/index.html 的站内锚点出现次数',
      uniqueExternalHrefs: '去重后的站外 URL 数（用于与外部链接清单对账）',
    },
    linkStats: linker.stats,
    linkStatsLegend: {
      rewrittenRelativeMd: '相对 .md 链接 → 对应生成页 HTML 的相对路径（保留 #fragment）',
      rewrittenAbsoluteDocs: 'https://docs.papermc.io/<section>/… → 命中 manifest 的本地生成页（含跨区域 velocity→paper、paper→folia）',
      rewrittenCrossSection: '上两类改写中跨区域的条数（如 velocity 页面链接 paper 页面、paper 页面链接 folia 页面）',
      unresolvedLocal: '相对链接无法定位到已镜像页面（越出归档或目标缺失）→ 保留原样并加 class="unresolved"；具体条目见 warnings(kind=link-*)',
      unmirrored: '指向未镜像区域（/misc、/adventure、第三方站点等）→ 保留绝对 URL，class="external unmirrored" + title="未镜像，需联网" + target="_blank"',
      external: '站外链接 → class="external" + target="_blank" rel="noopener"',
      samePageFragment: '本页 #fragment 命中标题 id，无需改写',
      fragmentsResolvedFuzzy: '锚点经模糊匹配（忽略分隔符 / 唯一前缀）改写为真实标题 id',
      fragmentsUnresolved: '目标页确实没有该锚点 → 保留 #fragment 并加 class="anchor-missing" + title（页面内可见标记）',
      imagesLocal: '相对路径图片，已按 Markdown 所在目录解析并换算到输出目录（path.relative 计算，逐个校验存在）',
      imagesAbsoluteLocalized: '绝对图片 URL 命中 assets/ 镜像文件 → 本地化',
      imagesExternal: '绝对图片 URL 未镜像 → 保留远程地址，class="external-image" + title + referrerpolicy + 可见小字提示',
      imagesMissing: '相对图片文件不存在 → class="img-missing" 并计入告警',
      footnotesResolved: '脚注锚点 #user-content-fn-<name> 已补到对应列表项上，并把 #user-content-fnref-<name> 补到引用处的 <sup>',
      footnotesMissing: '脚注锚点无法匹配列表项 → 引用处加 class="anchor-missing"',
      externalNoRewrite: '统计的 external/unmirrored 计数包含 raw HTML 与 Markdown 两种来源',
    },
    anchors: {
      recovered: anchorFix.recovered,
      recoveryRule: 'Starlight 配置页的每个嵌套列表键都有 id（anticheat > anti-xray > enabled → anticheat_anti_xray_enabled），转换器丢掉了它们；生成器按 <li> 层级 + 首个 <code> 键名重建，仅注入被引用到的 id',
      unresolvedCount: anchorFix.unresolved.length,
      unresolved: anchorFix.unresolved,
    },
    codeBlockAccounting: {
      fencePairs: stats.codeFencePairs,
      fencePairsPlain: stats.codeFencePairsPlain,
      fencePairsQuoted: stats.codeFencePairsQuoted,
      indented4SpaceBlocks: stats.codeBlocksExtra,
      renderedPreElements: stats.codeBlocks,
      withTitle: stats.codeBlocksWithTitle,
      note: '围栏块总数 = 顶层围栏块 ' + stats.codeFencePairsPlain + ' + 写在引用/告警里（以 "> " 前缀包裹）的围栏块 '
        + stats.codeFencePairsQuoted + ' = ' + stats.codeFencePairs + '；'
        + '渲染出的 <pre> 数量与之一致（tools/check-site.js 独立复核 ' + stats.codeFencePairs + ' = ' + stats.codeBlocks + '，差异 ' + stats.codeBlocksExtra + '）',
    },
    search: Object.assign({}, search.stats, {
      jsonPath: 'search-index.json',
      jsPath: 'assets/search-index.js',
      jsonBytes: written.searchJson.bytes,
      jsBytes: written.assets.searchJs.bytes,
    }),
    outputs: {
      index: written.index,
      notFound: written.notFound,
      robots: written.robots,
      sitemap: written.sitemap,
      allPages: written.allPages,
      snapshots: written.snapshots,
      assets: written.assets,
      searchIndexJson: written.searchJson,
      pageCount: written.pages.length,
      categoryCount: written.categories.length,
      sectionCount: written.sections.length,
      siteDir: 'repo-root (GitHub Pages /papermc-docs/)',
      pageLayout: '<section>/<rel>.html（rel 直接展开，URL 与上游 docs.papermc.io 逐段一致）',
      totalBytes: written.pages.reduce((n, p) => n + p.bytes, 0)
        + written.categories.reduce((n, c) => n + c.bytes, 0)
        + written.sections.reduce((n, s) => n + s.bytes, 0) + written.index.bytes
        + written.allPages.bytes + written.snapshots.bytes,
    },
    pages: pages.map((p) => ({
      id: p.id, section: p.section, rel: p.rel, title: p.title,
      category: p.category, order: p.order,
      navPath: p.navPathText || '', navGroupPath: p.navGroupPath || '',
      navIndex: p.navIndex, navTotal: p.navTotal, navKind: p.navKind,
      navPrev: p.navPrevKey || null, navNext: p.navNextKey || null,
      output: p.section + '/' + p.rel + '.html',
      url: p.url, source_url: p.sourceUrl, fetched_at: p.fetchedAt, sha256: p.sha256,
      markdown_bytes: p.markdownBytes,
      stats: p.htmlCounts, source_stats: p.srcCounts,
      headings: (p.toc || []).map((h) => ({ level: h.level, id: h.id, text: h.text })),
      bytes: (written.pages.find((w) => w.id === p.id) || {}).bytes || 0,
      warnings: warnings.filter((w) => w.message && w.message.startsWith(p.id + ':')).length,
    })),
    warningCount: warnings.length,
    warningsByKind: warnings.reduce((acc, w) => { acc[w.kind] = (acc[w.kind] || 0) + 1; return acc; }, {}),
    warnings: warnings.slice(0, 500),
    timing_ms: { total: Date.now() - T0 },
  };

  let selfTest = null;
  if (SELF_TEST) {
    log('[7/7] 自测 …');
    selfTest = runSelfTest(state);
    manifest.selfTest = {
      sample: selfTest.sample,
      passed: selfTest.checks.filter((c) => c.ok).length,
      failed: selfTest.checks.filter((c) => !c.ok).length,
      failedChecks: selfTest.checks.filter((c) => !c.ok),
      checkedLocalLinks: selfTest.totalLocalLinks,
      checkedLocalImages: selfTest.totalLocalImages,
      h1: { docH1Bad: selfTest.docH1Bad, artH1Bad: selfTest.artH1Bad, htmlFiles: selfTest.allHtmlFiles },
      breadcrumbSample: selfTest.crumbSample,
      sourceNavPreorderPages: selfTest.sourceNavTotal,
      pagesUnreachableFromMainNav: selfTest.unreachablePages,
      pagerProblems: selfTest.pagerBad,
      allPagesRows: selfTest.allPagesRows,
      categoryPagesWithDebugChips: selfTest.catChipBad,
      alertBadgeContrast: selfTest.contrastRows,
      sidebarActiveContrast: selfTest.activeContrast,
      searchRanking: selfTest.rankResults,
    };
  }

  manifest.timing_ms.total = Date.now() - T0;
  U.writeFile(path.join(U.DATA, 'build-manifest.json'), JSON.stringify(manifest, null, 2));

  log('');
  log('页面 ' + stats.pages + ' / 分类 ' + stats.categories + ' / 代码块 ' + stats.codeBlocks
    + ' / 告警 ' + stats.alerts + ' / 表格 ' + stats.tables + ' / 图片 ' + stats.images);
  log('改写链接 ' + stats.linksRewritten + '（跨区域 ' + stats.crossSectionLinks + '）/ 未镜像外链 ' + stats.unmirroredLinks
    + ' / 未解析 ' + stats.unresolvedLinks + ' / 锚点未命中 ' + stats.fragmentsUnresolved);
  log('搜索索引 ' + U.humanBytes(search.stats.jsonBytes) + ' / 告警条目 ' + warnings.length
    + ' / 耗时 ' + manifest.timing_ms.total + ' ms');
  if (selfTest) {
    const failed = selfTest.checks.filter((c) => !c.ok);
    log('自测：' + (selfTest.checks.length - failed.length) + '/' + selfTest.checks.length + ' 通过');
    for (const f of failed) log('  ✗ [' + f.page + '] ' + f.name + ' — ' + f.detail);
  }
  log('写入 data/build-manifest.json');
  return manifest;
}

/**
 * 产物 = 源（红队 F10 / H2）：**不重建**、只比对。可在任何检查清单或 CI 里单独跑：
 *   node tools/build-site.js --verify-artifacts
 * 退出码 0 = 一致；1 = assets/ 落后于 tools/site/assets.js（先跑 node tools/build-site.js）。
 * 背景：本会话真实踩过“源改了、产物还是上一代（差 40 分钟）”导致两代状态缺陷集不同。
 */
function verifyArtifacts() {
  const same = (a, b) => a !== null && a.replace(/^\uFEFF/, '') === b;
  const rows = [
    ['assets/site.css', path.join(U.SITE, 'assets', 'site.css'), SITE_CSS],
    ['assets/site.js', path.join(U.SITE, 'assets', 'site.js'), SITE_JS],
    ['assets/favicon.svg', path.join(U.SITE, 'assets', 'favicon.svg'), FAVICON_SVG],
  ];
  let bad = 0;
  for (const [rel, abs, src] of rows) {
    const disk = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    const ok = same(disk, src);
    if (!ok) bad += 1;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + rel + (ok
      ? ' === tools/site/assets.js 中的源'
      : (disk === null ? ' 缺失' : ' 与 tools/site/assets.js 中的源不一致 → 先跑 node tools/build-site.js')));
  }
  console.log(bad ? ('RESULT: FAIL（' + bad + ' 个产物落后于源）') : 'RESULT: PASS（产物 = 源）');
  if (bad) process.exitCode = 1;
  return bad === 0;
}

if (require.main === module) {
  if (ARGS.includes('--verify-artifacts')) {
    verifyArtifacts();
  } else {
    try {
      main();
    } catch (e) {
      console.error('build failed: ' + (e && e.stack ? e.stack : e));
      process.exit(1);
    }
  }
}

module.exports = {
  main, Linker, buildSiteModel, loadManifests, loadTaxonomy, renderAllPages, runSelfTest,
  verifyArtifacts, readImageSize, addIntrinsicImageSizes, IMG_SIZE_STATS,
};
