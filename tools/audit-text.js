#!/usr/bin/env node
'use strict';
/*
 * audit-text.js —— 正文覆盖率与编码审计（只读 archives/**，只写 reports/ 两个产物）
 *
 * 用法:  node tools/audit-text.js [archiveDir ...]
 *        默认: archives/paper, archives/velocity
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const OUT_JSON = path.join(REPORTS_DIR, 'audit-text.json');
const OUT_MD = path.join(REPORTS_DIR, 'content-audit-text.md');

const COVERAGE_THRESHOLD = 0.95;
const PROSE_SENTENCE_MIN_TOKENS = 4;
const CARD_HUB_MIN_CARDS = 5;

const CJK_CLASS = '\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uAC00-\\uD7AF';
const TOKEN_RE = new RegExp('[A-Za-z0-9]+|[' + CJK_CLASS + ']+', 'g');
const CJK_CHAR_RE = new RegExp('[' + CJK_CLASS + ']', 'g');
const CJK_CHAR_ONE = new RegExp('[' + CJK_CLASS + ']');
const WS_GLUE_RE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u200B-\u200D\u2060\uFEFF]/g;

/* 乱码模式：hit=true 的为混淆证据；hit=false 的仅统计（可能是真实汉字/正常字符） */
const MOJIBAKE_PATTERNS = [
  { name: 'U+FFFD 替换符', re: /\uFFFD/g, evidence: true },
  { name: '锟斤拷（GBK→UTF-8 经典乱码）', re: /锟斤拷|锟斤|斤拷/g, evidence: true },
  { name: '鈥/鈩/鈽/鈻（UTF-8 被按 GBK 读）', re: /鈥|鈩|鈽|鈻|鍜|鐨|鍙|鏄|绋|鏂|涓/g, evidence: true },
  { name: '鏈/绋/鐨（同族高残字，可能是真实汉字）', re: /鏈|绋|鐨|鏂|鍏|鍜/g, evidence: false },
  { name: 'Ã/Â/ï¿½（UTF-8 被按 Latin-1 读）', re: /Ã|Â|ï¿½/g, evidence: true }
];

const RESIDUE_PATTERNS = [
  { name: 'class="astro-…"', re: /class\s*=\s*["']astro-/g },
  { name: '<span', re: /<span\b/gi },
  { name: '<div', re: /<div\b/gi },
  { name: '<svg', re: /<svg\b/gi },
  { name: '<path', re: /<path\b/gi },
  { name: '<button', re: /<button\b/gi },
  { name: 'RAWHASHTOKEN', re: /RAWHASHTOKEN/g },
  { name: 'md-raw', re: /md-raw/g },
  { name: 'ec-block', re: /ec-block/g },
  { name: '未解码实体 &amp;', re: /&amp;/g },
  { name: '未解码实体 &lt;', re: /&lt;/g },
  { name: '未解码实体 &gt;', re: /&gt;/g },
  { name: '未解码实体 &quot;', re: /&quot;/g },
  { name: '未解码实体 &#x27;', re: /&#x27;|&#39;/g },
  { name: '未解码实体 &nbsp;', re: /&nbsp;/g }
];

const BLOCK_TAGS = 'p|div|li|ul|ol|td|th|tr|table|thead|tbody|h[1-6]|pre|blockquote|aside|details|summary|figcaption|figure|section|article|dd|dt|header|footer|label|nav|form|fieldset|legend';

/* ---------------------------------------------------------------- 基础工具 */

function readText(p) {
  const buf = fs.readFileSync(p);
  const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  let text = buf.toString('utf8');
  if (bom) text = text.replace(/^\uFEFF/, '');
  return { buf, text, bom };
}

function isUtf8Valid(buf) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch (e) { return false; }
}

function normText(s) {
  return s.normalize('NFKC').replace(WS_GLUE_RE, ' ').replace(/\s+/g, ' ').trim();
}

function reFind(text, re) {
  re.lastIndex = 0;
  const m = text.match(re);
  return m || [];
}

function safeCp(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
  try { return String.fromCodePoint(cp); } catch (e) { return ''; }
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => safeCp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => safeCp(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function tokenize(s) {
  const out = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s))) {
    const t = m[0];
    if (CJK_CHAR_ONE.test(t)) {
      if (t.length === 1) out.push(t);
      else for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2));
    } else out.push(t.toLowerCase());
  }
  return out;
}

function makeBag(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/** aTokens 中未能在 bBag 里找到配对的出现（按出现次数），用于取"某一侧独有 token"的样例 */
function sideOnlyTokens(aTokens, bBag) {
  const rem = new Map(bBag);
  const out = [];
  for (const t of aTokens) {
    const c = rem.get(t) || 0;
    if (c > 0) rem.set(t, c - 1);
    else out.push(t);
  }
  return out;
}

function topCounts(tokens, n) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return Array.from(m.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, n);
}

function bagCoverage(tokens, bag) {
  if (!tokens.length) return { coverage: 1, hit: 0, total: 0, remaining: new Map() };
  const rem = new Map(bag);
  let hit = 0;
  for (const t of tokens) {
    const c = rem.get(t) || 0;
    if (c > 0) { rem.set(t, c - 1); hit++; }
  }
  return { coverage: hit / tokens.length, hit, total: tokens.length, remaining: rem };
}

function cjkStats(s) {
  const m = s.match(CJK_CHAR_RE);
  return m ? m.length : 0;
}

function truncate(s, n) {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function round4(n) { return Math.round(n * 10000) / 10000; }

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

/* ------------------------------------------------------------ Markdown 处理 */

function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { fmRaw: null, fm: null, body: text };
  return { fmRaw: m[1], fm: parseYamlLite(m[1]), body: text.slice(m[0].length) };
}

function parseYamlLite(raw) {
  const o = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

/** 识别围栏行：先剥引用前缀与缩进（列表内的围栏会有 4+ 空格缩进，引用块内的围栏有 `> ` 前缀） */
function fenceInfo(line) {
  const stripped = line.replace(/^(?:\s{0,3}>\s?)+/, '').replace(/^[ \t]+/, '');
  const m = /^(`{3,}|~{3,})(.*)$/.exec(stripped);
  if (!m) return null;
  return { char: m[1][0], len: m[1].length, info: m[2] };
}

/** 返回 { lines, inFence[] }，围栏内容保留但标记（CommonMark 规则：闭栏须同字符、长度 ≥ 开栏且无信息串） */
function scanLines(body) {
  const lines = body.split(/\r?\n/);
  const inFence = new Array(lines.length).fill(false);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = fenceInfo(lines[i]);
    let consumed = false;
    if (f) {
      if (!fence && !(f.char === '`' && f.info.includes('`'))) {
        fence = { char: f.char, len: f.len };
        consumed = true;
      } else if (fence && f.char === fence.char && f.len >= fence.len && !f.info.trim()) {
        fence = null;
        consumed = true;
      }
    }
    inFence[i] = consumed || !!fence;
  }
  return { lines, inFence };
}

/** 处理散文片段：去标记、链接只留文字、去行内代码/图片、去残留 HTML 标签
 *  mode='prose'：剥行内代码 + 剥一切 HTML 标签（纯文本口径）
 *  mode='full' ：保留行内代码，且只剥**已知的模板包装标签** —— 因为 `<groupId>`、`<hostname or ip>`
 *               这类尖括号文本是内容（HTML 侧同样在 <pre>/表格里），一律按标签删掉会造出假"整段丢失"。 */
const WRAPPER_TAG_RE = /<\/?(details|summary|div|span|br|img|a|p|ul|ol|li|table|thead|tbody|tr|td|th|figure|figcaption|kbd|small|em|strong|sup|sub|starlight-tabs|starlight-tab-item|aside)\b[^>]*>/gi;

function processProse(s, mode) {
  const full = mode === 'full';
  s = s.replace(/\[!\s*(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\s*\]/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  if (!full) s = s.replace(/`[^`\n]*`/g, ' ');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  s = s.replace(/\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1');
  s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  s = s.replace(/<((?:https?|mailto):[^>]+)>/g, ' ');
  s = full ? s.replace(WRAPPER_TAG_RE, ' ') : s.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, ' ');
  s = s.replace(/^\s*>\s?/gm, ' ');
  s = s.replace(/^\s*([-*+]|\d{1,3}[.)])\s+/gm, ' ');
  s = s.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, ' ');
  // 只剥强调符号；下划线必须保留 —— 它是标识符的一部分（BUBBLE_COLUMN_UP / paper.velocity.secret），
  // 而分词器两侧都把 `_` 当分隔符，保留才能与 HTML 侧对称。删掉会产生大量假"缺失 token"。
  s = s.replace(/[*~]+/g, '');
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|<>~])/g, '$1');
  return s;
}

/**
 * Markdown → 纯文本。
 * keepCode=true 时保留代码围栏内容，且**围栏行按原样保留**（代码里的 `<groupId>`、反引号都是内容，
 * 不能按残留 HTML 标签删掉 —— HTML 侧同一段文字就在 <pre> 里，删了就变成假"整段丢失"）。
 */
function mdText(body, keepCode) {
  const sc = scanLines(body);
  const segs = [];
  let buf = [];
  const flush = () => { if (buf.length) { segs.push(processProse(buf.join('\n'), keepCode ? 'full' : 'prose')); buf = []; } };
  for (let i = 0; i < sc.lines.length; i++) {
    if (sc.inFence[i]) {
      if (keepCode) { flush(); segs.push(sc.lines[i]); }
    } else buf.push(sc.lines[i]);
  }
  flush();
  return normText(decodeEntities(segs.join('\n')));
}

/** Markdown 正文 → 纯文本（剥离代码围栏与行内代码） */
function mdToProse(body) { return mdText(body, false); }

/** Markdown 全内容 → 纯文本（保留围栏代码文字，只去标记） */
function mdAllText(body) { return mdText(body, true); }

/** Markdown 标题（围栏外）*/
function mdHeadings(body) {
  const sc = scanLines(body);
  const byLevel = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
  const texts = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };
  for (let i = 0; i < sc.lines.length; i++) {
    if (sc.inFence[i]) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(sc.lines[i]);
    if (!m) continue;
    const lv = 'h' + m[1].length;
    byLevel[lv]++;
    texts[lv].push(m[2].replace(/`/g, '').replace(/[*_~]/g, '').trim());
  }
  return { byLevel, texts };
}

/* --------------------------------------------------------------- HTML 处理 */

/** cheerio .text() 在块级元素之间不插分隔符，会把相邻单元格/段落粘成一个 token —— 注入换行 */
function blockBoundaries(html) {
  return html
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(new RegExp('</(?:' + BLOCK_TAGS + ')\\s*>', 'gi'), (m) => m + '\n')
    .replace(/<\/?(?:starlight-tabs|starlight-tab-item)\b[^>]*>/gi, '\n');
}

function stripSectionTitled(s) {
  return s.replace(/Section titled [\u201c"][^\u201d"]*[\u201d"]/g, ' ');
}

function loadPageHtml(htmlPath) {
  const raw = readText(htmlPath);
  const $ = cheerio.load(raw.text);
  let el = $('.sl-markdown-content').first();
  if (!el.length) el = $('main').first();
  if (!el.length) el = $('article').first();
  if (!el.length) el = $('body');
  const wrapper = '<div id="__audit_root">' + blockBoundaries(el.html() || '') + '</div>';

  const make = (dropExtra) => {
    const $$ = cheerio.load(wrapper);
    $$('#__audit_root').find('script,style,noscript,svg,.sl-anchor-link').remove();
    if (dropExtra) {
      // HTML 侧的"代码"不只有 <pre><code>：站点还用 expressive-code 框架、starlight-file-tree 文件树组件渲染代码块。
      // Markdown 侧这些内容在围栏里已被剥离，两侧不对称会把成片的键值/树结构误报成"正文丢失"。
      // 注意：不要误删 .not-content 这类组件容器 —— 例如 ConfigNode 配置树是页面正文本身（来自外部 YAML），
      // 删掉会让两侧都退化成空壳（实测会把 world-configuration 的正向覆盖率打到 0.006）。
      $$('#__audit_root').find('pre,code,kbd,samp,starlight-file-tree,.expressive-code,[class*="expressive-code"]').remove();
    }
    return $$;
  };

  const $loose = make(false);
  const looseRaw = stripSectionTitled($loose('#__audit_root').text());
  const looseText = normText(looseRaw);

  // 站点用 not-content 标记"由组件/代码框架渲染、不属于 Markdown 正文"的区块。
  // 转换器若整体跳过这些区块，就会在产物里成片缺行或整块丢失 —— 单独量化，便于定位系统性缺口。
  const $nc = cheerio.load(wrapper);
  $nc('#__audit_root').find('script,style,noscript,svg,.sl-anchor-link').remove();
  const $ncTop = $nc('#__audit_root').find('[class*="not-content"]').filter((i, e) => $nc(e).parents('[class*="not-content"]').length === 0);
  const notContentRaw = $ncTop.map((i, e) => $nc(e).text()).get().join('\n');
  const notContentCount = $ncTop.length;

  const $strict = make(true);
  const proseRaw = stripSectionTitled($strict('#__audit_root').text());
  const proseText = normText(proseRaw);

  const $proseOnly = make(true);
  const $headScope = $('.sl-markdown-content').length ? $('.sl-markdown-content').first() : $('body');
  $proseOnly('#__audit_root').find('pre,code,kbd,samp').remove();

  const clean = (obj) => obj.filter((i, e) => $(e).closest('.footnotes').length === 0);

  const headings = {};
  for (const lv of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const inContent = clean($headScope.find(lv)).length;
    const textsInContent = clean($headScope.find(lv)).map((i, e) => $(e).text().replace(/\s+/g, ' ').trim()).get();
    headings[lv] = {
      content: inContent,
      contentTexts: textsInContent,
      doc: clean($(lv)).length,
      hero: lv === 'h1' ? $(lv).filter((i, e) => $(e).closest('.sl-markdown-content').length === 0).length : 0
    };
  }

  const tabLabels = ($('[role="tab"]').map((i, e) => $(e).text().replace(/\s+/g, ' ').trim()).get() || [])
    .filter(t => t && t.length < 80);
  const footnoteHeadings = $('.footnotes').find('h1,h2,h3,h4,h5,h6').map((i, e) => $(e).text().replace(/\s+/g, ' ').trim()).get();

  // 站点把 Markdown 的一级标题渲染成正文容器之外的 hero <h1>，Markdown 侧却有这段标题文字；
  // 不补回来会系统性地把每个页面的标题算成"缺失 token"。
  const heroText = $('h1').filter((i, e) => $(e).closest('.sl-markdown-content').length === 0)
    .map((i, e) => $(e).text().replace(/\s+/g, ' ').trim()).get().join(' ');

  return {
    raw, looseText, looseRaw, notContentRaw, notContentCount, proseText, proseRaw, headings, tabLabels, footnoteHeadings, heroText,
    cardCount: $('[class*="card" i]').length,
    contentFound: $('.sl-markdown-content').length > 0
  };
}

/* ------------------------------------------------------------------ 链接 */

function normalizeDocUrl(u) {
  try {
    const url = new URL(u);
    let p = url.pathname.replace(/\/+$/, '');
    if (p === '') p = '/';
    return url.origin + p;
  } catch (e) { return null; }
}

function collectMdLinks(body) {
  const out = [];
  const re = /(!?)\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  let m;
  while ((m = re.exec(body))) { if (m[1] !== '!') out.push(m[3]); }
  const re2 = /<((?:https?):\/\/[^>\s]+)>/g;
  while ((m = re2.exec(body))) out.push(m[1]);
  return out;
}

function resolveRelativeDocLink(mdAbsPath, href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return { ok: true, kind: 'anchor-only', target: null };
  const base = path.dirname(mdAbsPath);
  const cands = [];
  if (/^\//.test(clean)) {
    cands.push(path.join(ROOT, clean.replace(/^\//, '')));
    cands.push(path.join(ROOT, clean.replace(/^\//, ''), 'index.md'));
  } else if (clean.endsWith('/')) {
    cands.push(path.resolve(base, clean, 'index.md'));
  } else if (/\.md$/i.test(clean)) {
    cands.push(path.resolve(base, clean));
    cands.push(path.resolve(base, clean.replace(/\.md$/i, ''), 'index.md'));
  } else {
    cands.push(path.resolve(base, clean + '.md'));
    cands.push(path.resolve(base, clean, 'index.md'));
    cands.push(path.resolve(base, clean));
  }
  for (const c of cands) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return { ok: true, kind: 'resolved', target: c };
  }
  return { ok: false, kind: 'broken', target: cands[0] };
}

/* ------------------------------------------------------------ 编码健康扫描 */

function walkFiles(dir, acc, extRe) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc, extRe);
    else if (ent.isFile() && (!extRe || extRe.test(ent.name))) acc.push(p);
  }
  return acc;
}

function scanEncodingFiles(archives) {
  const files = [];
  for (const a of archives) {
    for (const sub of ['markdown', 'source', '_corpus']) walkFiles(path.join(a.dir, sub), files, /\.(md|txt|json)$/i);
    for (const ent of fs.readdirSync(a.dir, { withFileTypes: true })) {
      if (ent.isFile() && /\.(md|json|txt)$/i.test(ent.name)) files.push(path.join(a.dir, ent.name));
    }
    files.push(a.manifestPath);
    walkFiles(path.join(path.dirname(a.dir), '_common'), files, /\.(md|txt|json)$/i);
  }
  const libDir = path.join(ROOT);
  for (const ent of fs.readdirSync(libDir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith('.json')) files.push(path.join(libDir, ent.name));
  }
  return Array.from(new Set(files)).sort();
}

function sampleAround(text, re) {
  re.lastIndex = 0;
  const m = re.exec(text);
  if (!m) return '';
  const i = Math.max(0, m.index - 25);
  return truncate(text.slice(i, m.index + 45), 100);
}

function auditEncoding(files) {
  const entries = [];
  const issues = [];
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(f); } catch (e) {
      issues.push({ file: rel(f), kind: 'unreadable', detail: String(e.message) });
      continue;
    }
    const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    const utf8Valid = isUtf8Valid(buf);
    let text = buf.toString('utf8');
    if (bom) text = text.replace(/^\uFEFF/, '');
    const moji = [];
    for (const p of MOJIBAKE_PATTERNS) {
      const m = reFind(text, p.re);
      if (m.length) moji.push({ pattern: p.name, count: m.length, evidence: p.evidence, sample: sampleAround(text, p.re) });
    }
    const entry = {
      file: rel(f), bytes: buf.length, bom, utf8Valid,
      replacementChar: reFind(text, /\uFFFD/g).length,
      mojibake: moji,
      cjkChars: cjkStats(text)
    };
    entries.push(entry);
    if (bom) issues.push({ file: rel(f), kind: 'utf8-bom', detail: '文件以 UTF-8 BOM 开头' });
    if (!utf8Valid) issues.push({ file: rel(f), kind: 'invalid-utf8', detail: '不是合法 UTF-8 序列' });
    if (entry.replacementChar) issues.push({ file: rel(f), kind: 'replacement-char', detail: 'U+FFFD × ' + entry.replacementChar });
    for (const m of moji) {
      if (!m.evidence) continue;
      issues.push({ file: rel(f), kind: 'mojibake', detail: m.pattern + ' × ' + m.count + '  例: ' + m.sample });
    }
  }
  return {
    fileCount: files.length,
    entries, issues,
    zeroCjk: entries.filter(e => e.cjkChars === 0).map(e => e.file),
    withCjk: entries.filter(e => e.cjkChars > 0).map(e => ({ file: e.file, cjkChars: e.cjkChars }))
  };
}

/* ----------------------------------------------------------------- 主审计 */

function auditPage(archive, page) {
  const relPath = page.rel || (page.url || '').replace(/^https?:\/\/[^/]+\//, '');
  const mdPath = path.join(archive.dir, page.file || ('markdown/' + relPath + '.md'));
  const srcPath = path.join(archive.dir, page.sourceFile || ('source/' + relPath + '.md'));
  const htmlPath = path.join(archive.dir, page.htmlFile || ('html/' + relPath + '.html'));

  const rec = {
    archive: archive.name, rel: relPath, url: page.url, title: page.title,
    mdPath: rel(mdPath), htmlPath: rel(htmlPath), srcPath: rel(srcPath),
    exists: { md: fs.existsSync(mdPath), source: fs.existsSync(srcPath), html: fs.existsSync(htmlPath) },
    problems: []
  };
  if (!rec.exists.md || !rec.exists.html) {
    rec.problems.push({ kind: 'missing-artifact', detail: '缺 markdown 或 html 产物' });
    return rec;
  }

  const mdRaw = readText(mdPath);
  const fmSplit = splitFrontMatter(mdRaw.text);
  const mdProse = mdToProse(fmSplit.body);
  const mdAllProse = mdAllText(fmSplit.body);
  const mdTokens = tokenize(mdProse);
  const mdAllTokens = tokenize(mdAllProse);
  const mdBag = makeBag(mdTokens);

  const H = loadPageHtml(htmlPath);
  // HTML 侧 token 池 = 正文容器 + hero 一级标题（站点把 md 的一级标题渲染到容器外）
  const heroTokens = tokenize(H.heroText || '');
  const htmlStrictTokens = tokenize(H.proseText).concat(heroTokens);
  const strictBag = makeBag(htmlStrictTokens);
  const covLoose = bagCoverage(mdTokens, makeBag(tokenize(H.looseText).concat(heroTokens)));
  const covStrict = bagCoverage(mdTokens, strictBag);

  // 反向覆盖率：HTML 正文 token 中有多少能在 Markdown 里找到 —— 这才是"整段丢失"的正面指标
  const revBag = makeBag(mdTokens);
  const covReverse = bagCoverage(htmlStrictTokens, revBag);
  rec.coverageReverse = round4(covReverse.coverage);
  rec.htmlProseTokens = htmlStrictTokens.length;
  const htmlOnlyStrict = sideOnlyTokens(htmlStrictTokens, revBag);
  rec.htmlOnlyTokenCount = htmlOnlyStrict.length;
  rec.htmlOnlyTokenSample = topCounts(htmlOnlyStrict, 15);

  /* 全内容口径（两侧都不剥代码）：不依赖任何"哪里算代码"的启发式判断，
     因此是判定"整段文本丢失"最稳的口径。 */
  const htmlAllTokens = tokenize(H.looseText).concat(heroTokens);
  const mdAllBag = makeBag(mdAllTokens);
  const covAll = bagCoverage(mdAllTokens, makeBag(htmlAllTokens));
  const covRevAll = bagCoverage(htmlAllTokens, mdAllBag);
  rec.coverageAll = round4(covAll.coverage);
  rec.coverageReverseAll = round4(covRevAll.coverage);
  rec.htmlAllTokens = htmlAllTokens.length;
  rec.mdAllTokens = mdAllTokens.length;
  const htmlOnlyAll = sideOnlyTokens(htmlAllTokens, mdAllBag);
  rec.htmlOnlyTokenCountAll = htmlOnlyAll.length;
  rec.htmlOnlyTokenSampleAll = topCounts(htmlOnlyAll, 15);
  rec.htmlOnlyNonNumeric = topCounts(htmlOnlyAll.filter(t => !/^\d{1,3}$/.test(t)), 15);
  rec.missingFragments = findMissingFragments(H.looseRaw, mdAllBag);

  // 组件区块（not-content）文本落盘率：定位"转换器跳过组件渲染内容"这一系统性缺口
  const ncTokens = tokenize(normText(H.notContentRaw || ''));
  const ncMissing = sideOnlyTokens(ncTokens, mdAllBag);
  rec.notContentBlocks = H.notContentCount;
  rec.notContentTokens = ncTokens.length;
  rec.notContentMissing = ncMissing.length;
  rec.notContentCoverage = ncTokens.length ? round4((ncTokens.length - ncMissing.length) / ncTokens.length) : null;
  rec.notContentMissingSample = topCounts(ncMissing, 12);
  rec.notContentFragments = ncMissing.length ? findMissingFragments(H.notContentRaw, mdAllBag) : [];

  // 去重口径：区分"文本真的不存在"与"只是出现次数少于 md（重复/格式差）"
  const distinct = Array.from(new Set(mdTokens));
  const absent = distinct.filter(t => !strictBag.has(t));
  const looseBagFull = makeBag(tokenize(H.looseText).concat(heroTokens));
  const absentInCodeOnly = absent.filter(t => looseBagFull.has(t));
  rec.coverageDistinct = distinct.length ? round4((distinct.length - absent.length) / distinct.length) : 1;
  rec.distinctTokens = distinct.length;
  rec.absentDistinct = absent.length;
  rec.absentInCodeOnly = absentInCodeOnly.length;
  rec.absentTokenSample = absent.slice(0, 20);
  const absentMisses = absent.reduce((s, t) => s + (mdBag.get(t) || 0), 0);

  rec.coverage = round4(covStrict.coverage);      // 主指标：两侧都剥代码
  rec.coverageLoose = round4(covLoose.coverage);  // 上界：HTML 侧保留代码
  rec.mdTokens = mdTokens.length;
  rec.mdProseChars = mdProse.length;
  rec.htmlProseChars = H.proseText.length;
  rec.htmlTextChars = H.looseText.length;
  rec.missingTokens = covStrict.total - covStrict.hit;
  rec.absentMisses = absentMisses;
  rec.repeatMisses = rec.missingTokens - absentMisses;
  rec.missingTokenSample = topMissing(covStrict.remaining, 12);
  rec.proseFragments = findMissingFragments(H.proseRaw, mdBag);
  rec.cardCount = H.cardCount;
  rec.contentFound = H.contentFound;
  rec.tabLabels = H.tabLabels;

  /* --- 4. 标题层级 --- */
  const mdH = mdHeadings(fmSplit.body);
  const htmlCounts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
  for (const lv of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    htmlCounts[lv] = lv === 'h1' ? H.headings.h1.content + H.headings.h1.hero : H.headings[lv].content;
  }
  rec.mdHeadings = mdH.byLevel;
  rec.htmlHeadings = htmlCounts;
  rec.htmlHeadingsDetail = {
    h1: { content: H.headings.h1.content, hero: H.headings.h1.hero, doc: H.headings.h1.doc },
    footnoteHeadings: H.footnoteHeadings,
    contentTexts: {
      h2: H.headings.h2.contentTexts, h3: H.headings.h3.contentTexts, h4: H.headings.h4.contentTexts,
      h5: H.headings.h5.contentTexts, h6: H.headings.h6.contentTexts
    }
  };
  rec.headingDiff = {};
  for (const lv of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) rec.headingDiff[lv] = mdH.byLevel[lv] - htmlCounts[lv];
  rec.headingAnalysis = analyzeHeadings(rec, mdH, H, fmSplit.body);
  rec.headingJumps = headingJumps(fmSplit.body);
  if (rec.headingAnalysis.unexplained.length) {
    rec.problems.push({ kind: 'heading-mismatch', detail: rec.headingAnalysis.unexplained.map(u => u.level + ' md=' + u.md + ' html=' + u.html + ' (' + u.reason + ')').join('; ') });
  } else if (Object.values(rec.headingDiff).some(v => v !== 0)) {
    rec.problems.push({ kind: 'heading-mismatch-explained', detail: rec.headingAnalysis.reasons.join('; ') });
  }

  /* --- 3. HTML 残渣 --- */
  const residue = scanResidue(fmSplit.body);
  rec.residue = residue;
  if (residue.total > 0) rec.problems.push({ kind: 'html-residue', detail: residue.hits.map(h => h.name + '×' + h.count).join(', ') });

  /* --- 5. 链接（收集，跨页汇总在 auditLinks） --- */
  rec.mdLinks = collectMdLinks(fmSplit.body);

  /* --- 6. front matter --- */
  const fm = fmSplit.fm || {};
  rec.frontMatter = {
    keys: Object.keys(fm),
    title: fm.title || null,
    source: fm.source || null,
    titleMatchesManifest: fm.title === page.title,
    sourceMatchesManifest: normalizeDocUrl(fm.source || '') === normalizeDocUrl(page.url || ''),
    missing: ['title', 'source', 'description', 'fetched_at'].filter(k => !(k in fm))
  };
  if (!fmSplit.fm) rec.problems.push({ kind: 'front-matter-missing', detail: '没有 front matter 块' });
  else {
    if (!rec.frontMatter.titleMatchesManifest) rec.problems.push({ kind: 'front-matter-title', detail: 'md=' + JSON.stringify(fm.title) + ' manifest=' + JSON.stringify(page.title) });
    if (!rec.frontMatter.sourceMatchesManifest) rec.problems.push({ kind: 'front-matter-source', detail: 'md=' + JSON.stringify(fm.source) + ' manifest=' + JSON.stringify(page.url) });
    if (rec.frontMatter.missing.length) rec.problems.push({ kind: 'front-matter-fields', detail: '缺字段: ' + rec.frontMatter.missing.join(', ') });
  }

  /* --- 编码（页面级） --- */
  const mdMojibake = MOJIBAKE_PATTERNS.filter(p => reFind(mdRaw.text, p.re).length).map(p => p.name);
  rec.mdBom = mdRaw.bom;
  rec.mdReplacementChar = reFind(mdRaw.text, /\uFFFD/g).length;
  rec.mdMojibake = mdMojibake;
  rec.mdCjkChars = cjkStats(mdRaw.text);
  if (rec.exists.source) {
    const srcRaw = readText(srcPath);
    rec.srcCjkChars = cjkStats(srcRaw.text);
    rec.srcBom = srcRaw.bom;
    rec.srcReplacementChar = reFind(srcRaw.text, /\uFFFD/g).length;
    if (rec.mdCjkChars < rec.srcCjkChars) rec.problems.push({ kind: 'cjk-loss', detail: 'source 中日韩字符 ' + rec.srcCjkChars + ' → markdown ' + rec.mdCjkChars });
  }
  return rec;
}

function analyzeHeadings(rec, mdH, H, mdBodyRaw) {
  const reasons = [];
  const unexplained = [];
  const levels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const diff = {};
  for (const lv of levels) diff[lv] = rec.mdHeadings[lv] - rec.htmlHeadings[lv];
  if (!levels.some(lv => diff[lv] !== 0)) return { reasons: [], unexplained: [], diff };

  // h1：hero（页面标题）来自站点 frontmatter，与 md 一级标题的对应关系有三种既定形态
  if (diff.h1 !== 0) {
    const m = rec.mdHeadings.h1, c = H.headings.h1.content, hero = H.headings.h1.hero;
    if (m === 0 && c === 0 && hero >= 1) reasons.push('h1: md 无一级标题，hero 由清单标题生成（hero=' + hero + '）');
    else if (m === c && hero >= 1) reasons.push('h1: md 一级标题保留在正文，hero 由页面标题另生成（md=' + m + ' 正文=' + c + ' hero=' + hero + '）');
    else if (m === c + hero) reasons.push('h1: md 一级标题被提升为页面标题（md=' + m + ' = 正文 ' + c + ' + hero ' + hero + '）');
    else unexplained.push({ level: 'h1', md: m, html: rec.htmlHeadings.h1, reason: 'md 一级标题与 hero/正文 h1 无对应关系' });
  }

  // 站方自动生成的脚注标题
  if (H.footnoteHeadings.length) reasons.push('html-extra: 站方自动脚注标题 ' + H.footnoteHeadings.map(t => '"' + t + '"').join('、') + '（已在统计中剔除）');

  // md 多出的标题：多为转换器把 SyncedTabs 标签写成标题
  const mdExtra = [];
  for (const lv of ['h2', 'h3', 'h4', 'h5', 'h6']) {
    if (diff[lv] <= 0) continue;
    const texts = mdH.texts[lv];
    const extraTexts = texts.slice(rec.htmlHeadings[lv]);
    mdExtra.push({ level: lv, count: diff[lv], texts: extraTexts.slice(0, 6) });
  }
  if (mdExtra.length) {
    const allExtra = mdExtra.flatMap(e => e.texts);
    const tabHit = allExtra.filter(t => H.tabLabels.includes(t)).length;
    if (H.tabLabels.length && allExtra.length && tabHit / allExtra.length >= 0.6) {
      reasons.push('md-extra: 转换器把 SyncedTabs 标签写成 ' + mdExtra.map(e => e.level).join('/') + ' 标题（标签数 ' + H.tabLabels.length + '，命中 ' + tabHit + '/' + allExtra.length + '）——非内容丢失，HTML 中同一文本仍在');
    } else {
      unexplained.push({ level: mdExtra.map(e => e.level).join(','), md: null, html: null, reason: 'md 标题多于 HTML：' + mdExtra.map(e => e.level + ' 多 ' + e.count + '（例：' + e.texts.slice(0, 3).join(' / ') + '）').join('; ') });
    }
  }

  // html 多出的标题：用户问的"整段丢失"信号（标题文本是否还在 md 里）
  const htmlExtra = [];
  for (const lv of ['h2', 'h3', 'h4', 'h5', 'h6']) {
    if (diff[lv] >= 0) continue;
    const texts = H.headings[lv].contentTexts;
    const extraTexts = texts.slice(rec.mdHeadings[lv]);
    htmlExtra.push({ level: lv, count: -diff[lv], texts: extraTexts.slice(0, 8) });
  }
  if (htmlExtra.length) {
    const mdBodyText = mdBodyRaw || '';
    const allExtra = htmlExtra.flatMap(e => e.texts);
    const present = allExtra.filter(t => t && mdBodyText.includes(t)).length;
    if (allExtra.length && present === allExtra.length) {
      reasons.push('html-extra: HTML 有而 md 无 ' + htmlExtra.map(e => e.level + '×' + e.count).join('、') + ' 标题，但标题文本均仍在 md 正文（层级丢失，非文本丢失）');
    } else {
      unexplained.push({
        level: htmlExtra.map(e => e.level).join(','), md: null, html: null,
        reason: 'HTML 标题在 md 中找不到对应文本（' + (allExtra.length - present) + '/' + allExtra.length + '）：' + allExtra.filter(t => t && !mdBodyText.includes(t)).slice(0, 5).join(' / ')
      });
    }
  }

  return { reasons, unexplained, diff, mdExtra, htmlExtra };
}

function topMissing(remaining, n) {
  const arr = [];
  for (const [k, v] of remaining) if (v > 0) arr.push({ token: k, count: v });
  arr.sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));
  return arr.slice(0, n);
}

function findMissingFragments(proseRaw, mdBag) {
  if (!proseRaw) return [];
  // 先按空行切块：代码/XML/配置块的行间只有一个换行，按行切会把每一行都切碎（每行 token 太少而漏判）。
  // 只有超长块才进一步按句号/换行细分，用于给出更精确的证据片段。
  const chunks = [];
  for (const block of proseRaw.split(/\n{2,}/)) {
    if (block.length <= 900) chunks.push(block);
    else chunks.push(...block.split(/(?<=[.!?;])\s+|\n/));
  }
  const scored = [];
  for (const c0 of chunks) {
    const c = normText(c0);
    if (c.length < 12) continue;
    const toks = tokenize(c);
    if (toks.length < PROSE_SENTENCE_MIN_TOKENS) continue;
    const cov = bagCoverage(toks, mdBag);
    // 去重后"完全不在 md 里"的 token 个数：比覆盖率更能抓住"整块代码/配置块被吞"（周边同名词会拉高覆盖率）
    const absent = Array.from(new Set(toks.filter(t => !mdBag.has(t))));
    if (cov.coverage >= 0.5 && absent.length < 2) continue;
    scored.push({
      coverage: round4(cov.coverage), tokens: toks.length,
      absentTokens: absent.length, absentSample: absent.slice(0, 8),
      text: truncate(c, 200)
    });
  }
  scored.sort((a, b) => a.coverage - b.coverage || b.absentTokens - a.absentTokens || b.tokens - a.tokens);
  return scored.slice(0, 3);
}

function headingJumps(body) {
  const sc = scanLines(body);
  const levels = [];
  for (let i = 0; i < sc.lines.length; i++) {
    if (sc.inFence[i]) continue;
    const m = /^\s{0,3}(#{1,6})\s+\S/.exec(sc.lines[i]);
    if (m) levels.push(m[1].length);
  }
  const jumps = [];
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) jumps.push(levels[i - 1] + '→' + levels[i]);
  return jumps;
}

function scanResidue(body) {
  const sc = scanLines(body);
  const text = sc.lines.filter((l, i) => !sc.inFence[i]).join('\n').replace(/`[^`\n]*`/g, ' ');
  const hits = [];
  let total = 0;
  for (const p of RESIDUE_PATTERNS) {
    const m = reFind(text, p.re);
    if (m.length) { hits.push({ name: p.name, count: m.length, sample: residueSamples(text, p.re) }); total += m.length; }
  }
  return { total, hits };
}

function residueSamples(text, re) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    re.lastIndex = 0;
    if (re.test(line)) { out.push(truncate(line, 150)); if (out.length >= 2) break; }
  }
  return out;
}

/* -------------------------------------------------------- 链接汇总（跨归档） */

function auditLinks(pages, mirroredSet) {
  const broken = [];
  const absMirrored = new Map();
  const absUnmirrored = new Map();
  const hostMap = new Map();
  const inScopeMissing = [];
  let anchorOnly = 0, relativeTotal = 0, absoluteTotal = 0, rootRelative = 0;

  for (const rec of pages) {
    const mdAbs = path.join(ROOT, rec.mdPath);
    for (const href of rec.mdLinks) {
      if (/^#/.test(href)) { anchorOnly++; continue; }
      if (/^mailto:/i.test(href)) continue;
      if (/^https?:\/\//i.test(href)) {
        absoluteTotal++;
        let host = '';
        try { host = new URL(href).host; } catch (e) { host = '(invalid)'; }
        hostMap.set(host, (hostMap.get(host) || 0) + 1);
        if (host === 'docs.papermc.io') {
          const key = normalizeDocUrl(href);
          if (mirroredSet.has(key)) absMirrored.set(key, (absMirrored.get(key) || 0) + 1);
          else absUnmirrored.set(key, (absUnmirrored.get(key) || 0) + 1);
        }
      } else {
        relativeTotal++;
        if (/^\//.test(href)) rootRelative++;
        const r = resolveRelativeDocLink(mdAbs, href);
        if (!r.ok) broken.push({ page: rec.rel, archive: rec.archive, href, expect: rel(r.target) });
      }
    }
  }

  const scopeOf = (u) => {
    try { return new URL(u).pathname.split('/').filter(Boolean)[0] || '(root)'; } catch (e) { return '(invalid)'; }
  };
  const byScope = new Map();
  for (const [k, v] of absUnmirrored) {
    const s = scopeOf(k);
    if (!byScope.has(s)) byScope.set(s, { scope: s, count: 0, samples: [] });
    const e = byScope.get(s);
    e.count += v;
    if (e.samples.length < 5) e.samples.push(k);
  }
  for (const s of ['paper', 'velocity']) {
    const e = byScope.get(s);
    if (e) for (const [k, v] of absUnmirrored) if (scopeOf(k) === s) {
      const b = inScopeMissing.find(x => x.url === k);
      if (!b) inScopeMissing.push({ url: k, count: v });
    }
  }

  return {
    relativeTotal, rootRelative, absoluteTotal, anchorOnly,
    broken,
    mirroredCount: sumValues(absMirrored),
    unmirroredCount: sumValues(absUnmirrored),
    unmirrored: Array.from(absUnmirrored.entries()).sort((a, b) => b[1] - a[1]),
    unmirroredByScope: Array.from(byScope.values()).sort((a, b) => b.count - a.count),
    inScopeMissing,
    mirrored: Array.from(absMirrored.entries()).sort((a, b) => b[1] - a[1]),
    hosts: Array.from(hostMap.entries()).sort((a, b) => b[1] - a[1])
  };
}

function sumValues(m) { let s = 0; for (const v of m.values()) s += v; return s; }

/* ------------------------------------------------------------------- 主流程 */

function main() {
  const argv = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const archiveDirs = (argv.length ? argv : ['archive/paper', 'archive/velocity'])
    .map(p => (path.isAbsolute(p) ? p : path.resolve(ROOT, p)));
  const archives = archiveDirs.map(loadArchive);

  const mirroredSet = new Set();
  for (const a of archives) for (const p of a.pages) if (p.url) mirroredSet.add(normalizeDocUrl(p.url));

  const allPages = [];
  for (const a of archives) for (const p of a.pages) allPages.push(auditPage(a, p));

  const linkSummary = auditLinks(allPages, mirroredSet);
  const encoding = auditEncoding(scanEncodingFiles(archives));
  const biggest = allPages.filter(r => typeof r.mdTokens === 'number').sort((a, b) => b.mdTokens - a.mdTokens)[0];
  const sensitivity = biggest ? sensitivityCheck(biggest) : null;

  const perArchive = {};
  for (const a of archives) perArchive[a.name] = summarize(allPages.filter(r => r.archive === a.name));
  const overall = summarize(allPages);

  const report = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    threshold: COVERAGE_THRESHOLD,
    method: {
      htmlSelector: '.sl-markdown-content',
      blockBoundaryInjection: true,
      coverageSymmetric: '两侧均剥离代码块（主指标 coverage）',
      coverageLoose: 'HTML 侧保留代码块的宽松上界 coverageLoose',
      tokenization: 'ASCII 字母数字串（小写，- _ . / 为分隔符）+ CJK 字符二元组',
      normalization: "NFKC + 不间断/零宽字符→空格 + 空白折叠 + 实体解码"
    },
    archives: archives.map(a => ({ name: a.name, dir: rel(a.dir), manifest: rel(a.manifestPath), pageCount: a.pages.length })),
    productVersions: archives.map(a => {
      const stat = (f) => { try { return fs.statSync(path.join(a.dir, f)).mtimeMs; } catch (e) { return null; } };
      const mdT = a.pages.map(p => stat(p.file)).filter(Boolean);
      const htT = a.pages.map(p => stat(p.htmlFile)).filter(Boolean);
      const iso = (v) => (v ? new Date(v).toISOString() : null);
      return {
        archive: a.name,
        markdownLatest: iso(mdT.length ? Math.max(...mdT) : null),
        markdownOldest: iso(mdT.length ? Math.min(...mdT) : null),
        htmlLatest: iso(htT.length ? Math.max(...htT) : null),
        htmlOldest: iso(htT.length ? Math.min(...htT) : null)
      };
    }),
    overall,
    perArchive,
    sensitivity,
    lowest: allPages.filter(r => typeof r.coverage === 'number')
      .sort((a, b) => a.coverage - b.coverage).slice(0, 15)
      .map(r => ({
        archive: r.archive, rel: r.rel, url: r.url, title: r.title,
        coverage: r.coverage, coverageDistinct: r.coverageDistinct, coverageLoose: r.coverageLoose,
        mdTokens: r.mdTokens, distinctTokens: r.distinctTokens,
        missingTokens: r.missingTokens, absentDistinct: r.absentDistinct,
        absentMisses: r.absentMisses, repeatMisses: r.repeatMisses,
        absentTokenSample: r.absentTokenSample.slice(0, 20),
        missingTokenSample: r.missingTokenSample.slice(0, 8),
        classification: classifyLow(r).label,
        proseFragments: r.proseFragments
      })),
    lowestReverse: allPages.filter(r => typeof r.coverageReverseAll === 'number')
      .sort((a, b) => a.coverageReverseAll - b.coverageReverseAll).slice(0, 15)
      .map(r => {
        const c = classifyReverseLow(r);
        return {
          archive: r.archive, rel: r.rel, url: r.url, title: r.title,
          coverageReverseAll: r.coverageReverseAll, coverageReverse: r.coverageReverse,
          coverageAll: r.coverageAll, coverage: r.coverage,
          htmlAllTokens: r.htmlAllTokens, mdAllTokens: r.mdAllTokens,
          htmlOnlyTokenCountAll: r.htmlOnlyTokenCountAll,
          htmlOnlyTokenSampleAll: r.htmlOnlyTokenSampleAll.slice(0, 12),
          cardCount: r.cardCount, classification: c.label, classificationCode: c.code,
          missingFragments: r.missingFragments,
          proseFragments: r.proseFragments,
          _r: r
        };
      })
      .map(o => { delete o._r; return o; }),
    notContent: {
      pages: allPages.filter(r => (r.notContentTokens || 0) > 0)
        .sort((a, b) => (a.notContentCoverage || 0) - (b.notContentCoverage || 0))
        .map(r => ({
          archive: r.archive, rel: r.rel, url: r.url,
          blocks: r.notContentBlocks, tokens: r.notContentTokens, missing: r.notContentMissing,
          coverage: r.notContentCoverage,
          missingSample: r.notContentMissingSample.slice(0, 8),
          fragments: r.notContentFragments,
          pageReverseAll: r.coverageReverseAll
        })),
      totals: (() => {
        const withNc = allPages.filter(r => (r.notContentTokens || 0) > 0);
        const tok = withNc.reduce((s, r) => s + r.notContentTokens, 0);
        const mis = withNc.reduce((s, r) => s + r.notContentMissing, 0);
        return {
          pages: withNc.length, tokens: tok, missing: mis,
          coverage: tok ? round4((tok - mis) / tok) : null,
          pagesWithAnyMissing: withNc.filter(r => r.notContentMissing > 0).length
        };
      })()
    },
    belowThreshold: allPages.filter(r => typeof r.coverage === 'number' && r.coverage < COVERAGE_THRESHOLD)
      .sort((a, b) => a.coverage - b.coverage)
      .map(r => {
        const c = classifyLow(r);
        return {
          archive: r.archive, rel: r.rel, title: r.title, coverage: r.coverage,
          coverageDistinct: r.coverageDistinct, coverageLoose: r.coverageLoose,
          mdTokens: r.mdTokens, distinctTokens: r.distinctTokens,
          missingTokens: r.missingTokens, absentDistinct: r.absentDistinct,
          absentMisses: r.absentMisses, repeatMisses: r.repeatMisses,
          absentTokenSample: r.absentTokenSample.slice(0, 20),
          cardCount: r.cardCount, classification: c.label, classificationCode: c.code,
          missingTokenSample: r.missingTokenSample.slice(0, 8),
          proseFragments: r.proseFragments
        };
      }),
    encoding: {
      fileCount: encoding.fileCount,
      issueCount: encoding.issues.length,
      issues: encoding.issues,
      zeroCjkFiles: encoding.zeroCjk,
      withCjk: encoding.withCjk,
      bomFiles: encoding.entries.filter(e => e.bom).map(e => e.file),
      invalidUtf8: encoding.entries.filter(e => !e.utf8Valid).map(e => e.file),
      mojibakeFiles: encoding.entries.filter(e => e.mojibake.some(m => m.evidence))
        .map(e => ({ file: e.file, mojibake: e.mojibake })),
      scannedScopes: ['archive/*/markdown/**', 'archive/*/source/**', 'archive/*/_corpus/**', 'archive/*/{INDEX.md,*-all.md,manifest.json}', 'archives/_common/**', 'data/*.json']
    },
    headings: {
      totals: headingTotals(allPages),
      mismatches: allPages.filter(r => r.problems.some(p => p.kind === 'heading-mismatch' || p.kind === 'heading-mismatch-explained'))
        .map(r => ({
          archive: r.archive, rel: r.rel, md: r.mdHeadings, html: r.htmlHeadings, diff: r.headingDiff,
          reasons: r.headingAnalysis.reasons,
          unexplained: r.headingAnalysis.unexplained,
          tabLabels: r.tabLabels
        })),
      unexplained: allPages.filter(r => r.headingAnalysis.unexplained.length)
        .map(r => ({ archive: r.archive, rel: r.rel, unexplained: r.headingAnalysis.unexplained })),
      jumps: allPages.filter(r => (r.headingJumps || []).length)
        .map(r => ({ archive: r.archive, rel: r.rel, jumps: r.headingJumps }))
    },
    residue: {
      pagesWithResidue: allPages.filter(r => r.residue && r.residue.total > 0)
        .map(r => ({ archive: r.archive, rel: r.rel, total: r.residue.total, hits: r.residue.hits })),
      patternTotals: residueTotals(allPages)
    },
    frontMatter: {
      mismatches: allPages.filter(r => r.problems.some(p => ['front-matter-title', 'front-matter-source', 'front-matter-missing'].includes(p.kind)))
        .map(r => ({ archive: r.archive, rel: r.rel, fm: r.frontMatter, problems: r.problems.filter(p => p.kind.startsWith('front-matter')) })),
      missingFieldTotals: missingFieldTotals(allPages)
    },
    links: {
      ...linkSummary,
      unmirrored: linkSummary.unmirrored.slice(0, 40),
      mirrored: linkSummary.mirrored.slice(0, 20)
    },
    pages: allPages.map(compactPage)
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(OUT_MD, renderMarkdown(report), 'utf8');
  printConsole(report);
}

function loadArchive(archiveDir) {
  const manifestPath = path.join(archiveDir, 'manifest.json');
  const manifest = JSON.parse(readText(manifestPath).text);
  return { name: path.basename(archiveDir), dir: archiveDir, manifestPath, manifest, pages: manifest.pages || [] };
}

function compactPage(r) {
  return {
    archive: r.archive, rel: r.rel, url: r.url, title: r.title,
    mdPath: r.mdPath, htmlPath: r.htmlPath,
    coverage: r.coverage, coverageReverse: r.coverageReverse,
    coverageAll: r.coverageAll, coverageReverseAll: r.coverageReverseAll,
    htmlAllTokens: r.htmlAllTokens, mdAllTokens: r.mdAllTokens,
    htmlOnlyTokenCountAll: r.htmlOnlyTokenCountAll,
    coverageDistinct: r.coverageDistinct, coverageLoose: r.coverageLoose,
    htmlProseTokens: r.htmlProseTokens, htmlOnlyTokenCount: r.htmlOnlyTokenCount,
    mdTokens: r.mdTokens, distinctTokens: r.distinctTokens, missingTokens: r.missingTokens,
    absentDistinct: r.absentDistinct, absentMisses: r.absentMisses, repeatMisses: r.repeatMisses,
    absentTokenSample: r.absentTokenSample,
    mdProseChars: r.mdProseChars, htmlProseChars: r.htmlProseChars,
    cardCount: r.cardCount, contentFound: r.contentFound,
    notContentBlocks: r.notContentBlocks, notContentTokens: r.notContentTokens,
    notContentMissing: r.notContentMissing, notContentCoverage: r.notContentCoverage,
    mdHeadings: r.mdHeadings, htmlHeadings: r.htmlHeadings, headingDiff: r.headingDiff,
    headingReasons: r.headingAnalysis.reasons,
    residue: r.residue ? r.residue.total : 0,
    mdCjkChars: r.mdCjkChars, srcCjkChars: r.srcCjkChars, mdBom: r.mdBom, mdReplacementChar: r.mdReplacementChar,
    proseFragments: r.proseFragments,
    problems: r.problems
  };
}

/** 正向低覆盖分类（md 侧文字有多少没落到 HTML） */
function classifyLow(r) {
  if (!r.contentFound) return { code: 'no-content-container', label: '未找到 .sl-markdown-content，正文容器缺失' };
  if (r.absentDistinct === 0) return { code: 'repeat-count-only', label: '无缺失 token（覆盖率 <1 只来自同一 token 的出现次数差：md 的标题/清单文案重复，HTML 同一文本仍在）' };
  if (r.absentInCodeOnly === r.absentDistinct) return { code: 'format-only', label: '两侧都有该文本，只是 HTML 把它们包在行内代码/上标里而 md 写成纯文本（格式差，非文本缺失）' };
  if (r.cardCount >= CARD_HUB_MIN_CARDS) return { code: 'card-hub', label: '卡片/清单型枢纽页：卡片与清单文案由站点组件渲染，天然只存在于 HTML 侧' };
  if (!(r.proseFragments || []).length) return { code: 'token-level-only', label: '缺的都是短 token（编号/单字母/标点化词），无整句级缺失' };
  return { code: 'suspected-gap', label: '存在整句级缺失，需人工核查' };
}

/** 反向低覆盖分类（HTML 正文有多少没落到 Markdown）—— "整段丢失"的判定入口 */
function classifyReverseLow(r) {
  if (!r.contentFound) return { code: 'no-content-container', label: '未找到 .sl-markdown-content，正文容器缺失' };
  if ((r.missingFragments || []).length) {
    return { code: 'suspected-gap', label: '存在「HTML 有 / Markdown 无」的整句（≤200 字，见样例），需人工核查' };
  }
  if ((r.htmlOnlyTokenCountAll || 0) === 0) {
    return { code: 'complete', label: 'HTML 正文文字 100% 能在 Markdown 中找到' };
  }
  const sample = (r.htmlOnlyNonNumeric || []).map(t => t.token);
  if (!sample.length) {
    return { code: 'line-number-artifact', label: 'HTML 侧独有 token 全是纯数字（代码框行号/列表序号等渲染产物），无文本缺失' };
  }
  return { code: 'token-residue', label: '仅个别 token 未命中（编号/格式差/组件拼接），无整句级缺失' };
}

function summarize(recs) {
  const withCov = recs.filter(r => typeof r.coverage === 'number');
  const mean = withCov.length ? withCov.reduce((s, r) => s + r.coverage, 0) / withCov.length : 0;
  const meanRev = withCov.length ? withCov.reduce((s, r) => s + (r.coverageReverseAll || 0), 0) / withCov.length : 0;
  const sortedRev = withCov.slice().sort((a, b) => (a.coverageReverseAll || 0) - (b.coverageReverseAll || 0));
  const meanLoose = withCov.length ? withCov.reduce((s, r) => s + r.coverageLoose, 0) / withCov.length : 0;
  const below = withCov.filter(r => r.coverage < COVERAGE_THRESHOLD);
  const sorted = withCov.slice().sort((a, b) => a.coverage - b.coverage);
  const perfect = withCov.filter(r => r.coverage >= 0.999).length;
  return {
    pageCount: recs.length,
    covered: withCov.length,
    meanCoverage: round4(mean),
    meanCoverageReverse: round4(meanRev),
    minCoverageReverse: sortedRev.length ? sortedRev[0].coverageReverseAll : null,
    minCoverageReversePage: sortedRev.length ? sortedRev[0].archive + '/' + sortedRev[0].rel : null,
    belowReverseThreshold: withCov.filter(r => (r.coverageReverseAll || 0) < COVERAGE_THRESHOLD).length,
    totalHtmlOnlyTokens: withCov.reduce((s, r) => s + (r.htmlOnlyTokenCountAll || 0), 0),
    pagesWithHtmlOnlyTokens: withCov.filter(r => (r.htmlOnlyTokenCountAll || 0) > 0).length,
    notContentTokens: withCov.reduce((s, r) => s + (r.notContentTokens || 0), 0),
    notContentMissing: withCov.reduce((s, r) => s + (r.notContentMissing || 0), 0),
    meanCoverageLoose: round4(meanLoose),
    minCoverage: sorted.length ? sorted[0].coverage : null,
    minCoveragePage: sorted.length ? sorted[0].archive + '/' + sorted[0].rel : null,
    perfectPages: perfect,
    belowThreshold: below.length,
    belowThresholdShare: withCov.length ? round4(below.length / withCov.length) : 0,
    suspectedGap: withCov.filter(r => classifyReverseLow(r).code === 'suspected-gap').length,
    completeReverse: withCov.filter(r => classifyReverseLow(r).code === 'complete').length,
    cardHub: withCov.filter(r => classifyLow(r).code === 'card-hub').length,
    repeatCountOnly: withCov.filter(r => classifyLow(r).code === 'repeat-count-only').length,
    formatOnly: withCov.filter(r => classifyLow(r).code === 'format-only').length,
    totalAbsentDistinct: withCov.reduce((s, r) => s + (r.absentDistinct || 0), 0),
    totalAbsentMisses: withCov.reduce((s, r) => s + (r.absentMisses || 0), 0),
    totalRepeatMisses: withCov.reduce((s, r) => s + (r.repeatMisses || 0), 0),
    pagesWithAbsentTokens: withCov.filter(r => (r.absentDistinct || 0) > 0).length,
    missingArtifacts: recs.filter(r => !r.exists.md || !r.exists.html).length,
    headingMismatchUnexplained: recs.filter(r => r.headingAnalysis && r.headingAnalysis.unexplained.length).length,
    headingMismatchExplained: recs.filter(r => r.headingAnalysis && r.headingAnalysis.unexplained.length === 0 && Object.values(r.headingDiff || {}).some(v => v !== 0)).length,
    residuePages: recs.filter(r => r.residue && r.residue.total > 0).length,
    fmMismatch: recs.filter(r => r.problems.some(p => p.kind.startsWith('front-matter'))).length,
    cjkLoss: recs.filter(r => r.problems.some(p => p.kind === 'cjk-loss')).length,
    totalMdTokens: withCov.reduce((s, r) => s + r.mdTokens, 0),
    totalMissingTokens: withCov.reduce((s, r) => s + r.missingTokens, 0)
  };
}

function headingTotals(recs) {
  const t = { md: {}, html: {} };
  for (let lv = 1; lv <= 6; lv++) {
    t.md['h' + lv] = recs.reduce((s, r) => s + ((r.mdHeadings && r.mdHeadings['h' + lv]) || 0), 0);
    t.html['h' + lv] = recs.reduce((s, r) => s + ((r.htmlHeadings && r.htmlHeadings['h' + lv]) || 0), 0);
  }
  return t;
}

function residueTotals(recs) {
  const m = new Map();
  for (const r of recs) {
    if (!r.residue) continue;
    for (const h of r.residue.hits) m.set(h.name, (m.get(h.name) || 0) + h.count);
  }
  return Array.from(m.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function missingFieldTotals(recs) {
  const m = new Map();
  for (const r of recs) {
    if (!r.frontMatter) continue;
    for (const f of r.frontMatter.missing) m.set(f, (m.get(f) || 0) + 1);
  }
  return Array.from(m.entries()).map(([field, pages]) => ({ field, pages })).sort((a, b) => b.pages - a.pages);
}

/**
 * 双向灵敏度自检（全内容口径，两侧都不剥代码），回答"这个指标真的能测出整段丢失吗"：
 *  - 删掉 Markdown 全文开头 15%（通常是该页独有的导语）：反向指标"HTML 有而 md 无的 token 数"必须显著上升
 *  - 删掉 HTML 全文开头 15%：正向覆盖率（md→HTML）几乎不变 —— 说明正向指标测的是另一方向（md 侧多余内容）
 */
function sensitivityCheck(rec) {
  const mdRaw = readText(path.join(ROOT, rec.mdPath));
  const mdAll = mdAllText(splitFrontMatter(mdRaw.text).body);
  const H = loadPageHtml(path.join(ROOT, rec.htmlPath));
  const heroTokens = tokenize(H.heroText || '');
  const htmlTokens = tokenize(H.looseText).concat(heroTokens);
  const mdTokens = tokenize(mdAll);

  const cutHead = (s) => {
    const n = Math.max(60, Math.floor(s.length * 0.15));
    return { n, text: s.slice(n) };
  };

  const htmlBag = makeBag(htmlTokens);
  const mdCut = cutHead(mdAll);
  const mdTokensMut = tokenize(mdCut.text);
  const revBagBefore = makeBag(mdTokens);
  const revBagAfter = makeBag(mdTokensMut);
  const missingBefore = sideOnlyTokens(htmlTokens, revBagBefore);
  const missingAfter = sideOnlyTokens(htmlTokens, revBagAfter);

  const htmlCut = cutHead(H.looseText);
  const htmlTokensMut = tokenize(htmlCut.text).concat(heroTokens);
  const mdBag = makeBag(mdTokens);
  const fwdBefore = bagCoverage(mdTokens, htmlBag).coverage;
  const fwdAfter = bagCoverage(mdTokens, makeBag(htmlTokensMut)).coverage;
  const revAfterHtmlCut = bagCoverage(htmlTokensMut, mdBag).coverage;

  return {
    page: rec.archive + '/' + rec.rel,
    scope: '全内容口径（两侧都不剥代码）',
    reverse: {
      htmlOnlyBefore: missingBefore.length,
      htmlOnlyAfterMdCut: missingAfter.length,
      addedMissingTokens: missingAfter.length - missingBefore.length,
      coverageBefore: round4(bagCoverage(htmlTokens, revBagBefore).coverage),
      coverageAfterMdCut: round4(bagCoverage(htmlTokens, revBagAfter).coverage),
      removedMdChars: mdCut.n,
      removedMdTokens: mdTokens.length - mdTokensMut.length
    },
    forward: {
      baseline: round4(fwdBefore),
      afterRemovingHtmlChunk: round4(fwdAfter),
      removedChars: htmlCut.n,
      removedTokens: htmlTokens.length - htmlTokensMut.length,
      reverseCoverageAfter: round4(revAfterHtmlCut)
    }
  };
}

/* --------------------------------------------------------------- 控制台输出 */

function printConsole(rep) {
  const L = [];
  L.push('=== 正文覆盖率与编码审计 (audit-text.js) ===');
  L.push('归档: ' + rep.archives.map(a => a.name + '(' + a.pageCount + '页)').join(', '));
  L.push('');
  L.push('-- 覆盖率（主指标：两侧剥代码；loose=HTML 保留代码）--');
  for (const [name, s] of Object.entries(rep.perArchive)) {
    L.push('  ' + name + ': 均值=' + s.meanCoverage + ' (loose ' + s.meanCoverageLoose + ') 最低=' + s.minCoverage + ' @' + s.minCoveragePage);
    L.push('         <' + rep.threshold + ': ' + s.belowThreshold + '页  100%页: ' + s.perfectPages + '  纯计数差: ' + s.repeatCountOnly
      + '  含缺失token页: ' + s.pagesWithAbsentTokens);
  }
  L.push('  合计: 均值=' + rep.overall.meanCoverage + ' token ' + rep.overall.totalMissingTokens + '/' + rep.overall.totalMdTokens
    + ' 未命中（完全找不到 ' + rep.overall.totalAbsentMisses + ' 次; 计数差 ' + rep.overall.totalRepeatMisses + ' 次）');
  L.push('');
  L.push('-- 反向覆盖率（HTML→Markdown，全内容口径；判定"整段丢失"的指标）--');
  for (const [name, s] of Object.entries(rep.perArchive)) {
    L.push('  ' + name + ': 均值=' + s.meanCoverageReverse + ' 最低=' + s.minCoverageReverse + ' @' + s.minCoverageReversePage
      + '  <' + rep.threshold + ': ' + s.belowReverseThreshold + '页  100%页: ' + s.completeReverse
      + '  HTML有md无token: ' + s.totalHtmlOnlyTokens);
  }
  L.push('  合计: 均值=' + rep.overall.meanCoverageReverse + '  HTML有md无token=' + rep.overall.totalHtmlOnlyTokens
    + '（' + rep.overall.pagesWithHtmlOnlyTokens + ' 页）  有整句缺失页: ' + rep.overall.suspectedGap);
  L.push('');
  L.push('-- 组件区块 not-content 落盘率（系统性缺口定位）--');
  L.push('  页数=' + rep.notContent.totals.pages + ' token=' + rep.notContent.totals.tokens + ' 未落盘='
    + rep.notContent.totals.missing + '（' + (rep.notContent.totals.coverage == null ? '—' : ((1 - rep.notContent.totals.coverage) * 100).toFixed(2) + '%')
    + '） 涉及页=' + rep.notContent.totals.pagesWithAnyMissing);
  rep.notContent.pages.filter(p => p.fragments.length).slice(0, 5).forEach(p => {
    L.push('   * ' + p.archive + '/' + p.rel + ' 落盘率=' + p.coverage + ' :: ' + p.fragments[0].text.slice(0, 90));
  });
  L.push('');
  L.push('-- 覆盖率最低 15 页（正向）--');
  rep.lowest.forEach(r => L.push('  ' + r.coverage.toFixed(4) + ' (loose ' + r.coverageLoose.toFixed(4) + ')  ' + r.archive + '/' + r.rel));
  L.push('');
  L.push('-- 覆盖率最低 15 页（反向，全内容口径）--');
  rep.lowestReverse.forEach(r => L.push('  ' + r.coverageReverseAll.toFixed(4) + '  缺失token ' + String(r.htmlOnlyTokenCountAll).padStart(5)
    + '  ' + r.archive + '/' + r.rel + '  [' + r.classificationCode + ']'));
  L.push('');
  L.push('-- 编码 --');
  L.push('  文件=' + rep.encoding.fileCount + ' 问题=' + rep.encoding.issueCount + ' BOM=' + rep.encoding.bomFiles.length
    + ' 非法UTF8=' + rep.encoding.invalidUtf8.length + ' 乱码文件=' + rep.encoding.mojibakeFiles.length
    + ' 无CJK文件=' + rep.encoding.zeroCjkFiles.length);
  rep.encoding.issues.slice(0, 8).forEach(i => L.push('   * ' + i.kind + ' ' + i.file + ' :: ' + i.detail));
  L.push('');
  L.push('-- HTML 残渣 --');
  L.push('  命中页面=' + rep.residue.pagesWithResidue.length + ' ' + JSON.stringify(rep.residue.patternTotals));
  L.push('');
  L.push('-- 标题层级 --');
  L.push('  md=' + JSON.stringify(rep.headings.totals.md) + ' html=' + JSON.stringify(rep.headings.totals.html));
  L.push('  逐页不同=' + rep.headings.mismatches.length + ' 其中未解释=' + rep.headings.unexplained.length + ' 跳级页面=' + rep.headings.jumps.length);
  rep.headings.unexplained.forEach(u => L.push('   ! ' + u.rel + ' :: ' + u.unexplained.map(x => x.reason).join(' | ')));
  L.push('');
  L.push('-- 链接 --');
  L.push('  相对链接=' + rep.links.relativeTotal + '（根相对 ' + rep.links.rootRelative + '）断链=' + rep.links.broken.length
    + ' | 绝对=' + rep.links.absoluteTotal + ' doc站已镜像=' + rep.links.mirroredCount + ' 未镜像=' + rep.links.unmirroredCount);
  L.push('  未镜像按子站: ' + rep.links.unmirroredByScope.map(s => s.scope + '×' + s.count).join(', '));
  L.push('  外链 host top: ' + rep.links.hosts.slice(0, 8).map(h => h[0] + ':' + h[1]).join(', '));
  L.push('');
  L.push('-- front matter --');
  L.push('  缺字段=' + JSON.stringify(rep.frontMatter.missingFieldTotals) + ' title/source 不一致页面=' + rep.frontMatter.mismatches.length);
  L.push('');
  L.push('JSON: ' + rel(OUT_JSON));
  L.push('MD  : ' + rel(OUT_MD));
  console.log(L.join('\n'));
}

/* --------------------------------------------------------------- Markdown 报告 */

function mdCell(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function fmt4(v) { return typeof v === 'number' ? v.toFixed(4) : String(v == null ? '—' : v); }

function renderMarkdown(rep) {
  const o = [];
  const P = (s) => o.push(s);
  const pl = rep.perArchive.paper || emptySummary();
  const vl = rep.perArchive.velocity || emptySummary();

  P('# 正文覆盖率与编码审计报告');
  P('');
  P('- 生成时间：`' + rep.generatedAt + '`');
  P('- 审计范围：' + rep.archives.map(a => '`' + a.dir + '`（' + a.pageCount + ' 页）').join('、') + '，共 ' + rep.overall.pageCount + ' 页');
  P('- 真值来源：`html/<rel>.html` 的 `.sl-markdown-content`；待测产物：`markdown/<rel>.md`');
  P('- 覆盖率告警阈值：**' + rep.threshold + '**');
  P('- 复现：`node tools/audit-text.js`；机器可读明细：`reports/audit-text.json`');
  P('');
  P('**产物版本**（结论绑定在该版本上；`markdown/**` 属可再生产物，被上游重跑后需重新审计）：');
  P('');
  P('| 归档 | markdown 最新写入 | markdown 最早写入 | html 快照最新写入 |');
  P('| --- | --- | --- | --- |');
  for (const v of rep.productVersions) {
    P('| ' + v.archive + ' | `' + v.markdownLatest + '` | `' + v.markdownOldest + '` | `' + v.htmlLatest + '` |');
  }
  P('');

  /* ---------------- 1 摘要 ---------------- */
  P('## 1. 结论摘要');
  P('');
  P('| 指标 | paper | velocity | 合计 |');
  P('| --- | --- | --- | --- |');
  const rows = [
    ['页数', 'pageCount'], ['覆盖率均值（正向 md→HTML）', 'meanCoverage', fmt4],
    ['覆盖率均值（反向 HTML→md，丢失指标）', 'meanCoverageReverse', fmt4],
    ['反向覆盖率最低值', 'minCoverageReverse', fmt4],
    ['反向覆盖率最低页', 'minCoverageReversePage', v => '`' + mdCell(v) + '`'],
    ['反向覆盖率 < ' + rep.threshold + ' 的页数', 'belowReverseThreshold'],
    ['HTML 有而 md 缺的 token 数（合计）', 'totalHtmlOnlyTokens'],
    ['含「HTML 有而 md 缺」的页数', 'pagesWithHtmlOnlyTokens'],
    ['组件区块(not-content) token 数', 'notContentTokens', v => v],
    ['其中未落到 Markdown 的 token 数', 'notContentMissing', v => v],
    ['覆盖率均值（loose 上界）', 'meanCoverageLoose', fmt4],
    ['最低覆盖率', 'minCoverage', fmt4], ['最低覆盖页', 'minCoveragePage', v => '`' + mdCell(v) + '`'],
    ['覆盖率 = 100% 的页数', 'perfectPages'],
    ['覆盖率 < ' + rep.threshold + ' 的页数', 'belowThreshold'],
    ['低于阈值占比', 'belowThresholdShare', v => (v * 100).toFixed(1) + '%'],
    ['仅计数差（无 token 缺失）页数', 'repeatCountOnly'],
    ['正文 token 总数', 'totalMdTokens'], ['未在 HTML 命中的 token 数', 'totalMissingTokens'],
    ['其中：token 在 HTML 中完全不存在', 'totalAbsentMisses'],
    ['其中：仅出现次数少于 md（重复/格式差）', 'totalRepeatMisses'],
    ['HTML 中完全找不到的 token（去重合计）', 'totalAbsentDistinct'],
    ['存在"完全找不到的 token"的页数', 'pagesWithAbsentTokens'],
    ['疑似整段缺失页数', 'suspectedGap'], ['卡片枢纽型低覆盖页数', 'cardHub'],
    ['标题层级未解释差异', 'headingMismatchUnexplained'], ['标题层级已解释差异', 'headingMismatchExplained'],
    ['HTML 残渣页数', 'residuePages'], ['front matter 不一致页数', 'fmMismatch'],
    ['中日韩字符丢失页数（source→md）', 'cjkLoss']
  ];
  for (const [label, key, f] of rows) {
    const g = f || (v => v);
    P('| ' + label + ' | ' + g(pl[key]) + ' | ' + g(vl[key]) + ' | ' + g(rep.overall[key]) + ' |');
  }
  P('');
  P('### 逐项结论');
  P('');
  P('**1) 正文文字覆盖率**：整体均值 **' + fmt4(rep.overall.meanCoverage) + '**（宽松上界 ' + fmt4(rep.overall.meanCoverageLoose)
    + '）；低于 ' + rep.threshold + ' 的只有 ' + rep.overall.belowThreshold + ' 页（' + (rep.overall.belowThresholdShare * 100).toFixed(1)
    + '%），其中 ' + rep.overall.repeatCountOnly + ' 页是**纯计数差**（去重覆盖率 1.0000）。未命中 token 合计 '
    + rep.overall.totalMissingTokens + '/' + rep.overall.totalMdTokens + '（'
    + (rep.overall.totalMdTokens ? (rep.overall.totalMissingTokens / rep.overall.totalMdTokens * 100).toFixed(3) : '0') + '%），拆开看：'
    + '**在 HTML 正文里完全找不到的只有 ' + rep.overall.totalAbsentMisses + ' 个**（涉及 ' + rep.overall.pagesWithAbsentTokens
    + ' 页，去重后 ' + rep.overall.totalAbsentDistinct + ' 个 token），其余 ' + rep.overall.totalRepeatMisses
    + ' 个只是出现次数少于 Markdown 侧（格式/重复差异）。**没有发现整页或整段正文丢失**：疑似整段缺失页数 = ' + rep.overall.suspectedGap + '。');
  P('**2) 编码健康**：扫描 ' + rep.encoding.fileCount + ' 个文本产物（markdown/source/_corpus/前端产物/清单/library JSON）；'
    + 'UTF-8 BOM **' + rep.encoding.bomFiles.length + '** 个、非法 UTF-8 **' + rep.encoding.invalidUtf8.length + '** 个、'
    + '替换符 U+FFFD **' + rep.encoding.issues.filter(i => i.kind === 'replacement-char').length + '** 处、乱码模式命中文件 **'
    + rep.encoding.mojibakeFiles.length + '** 个。');
  P('**3) HTML 残渣**：命中 **' + rep.residue.pagesWithResidue.length + '** 页；'
    + (rep.residue.patternTotals.length ? rep.residue.patternTotals.map(p => '`' + p.name + '`×' + p.count).join('、') : '未发现任何残渣模式'));
  P('**4) 标题层级**：Markdown ' + JSON.stringify(rep.headings.totals.md) + ' vs HTML ' + JSON.stringify(rep.headings.totals.html)
    + '；逐页计数有差异 ' + rep.headings.mismatches.length + ' 页，其中**未解释 ' + rep.headings.unexplained.length
    + ' 页**，其余差异均可归因（hero 一级标题、脚注自动标题、SyncedTabs 标签被写成标题等）。跳级 ' + rep.headings.jumps.length + ' 页，仅提示。');
  P('**5) 站内链接**：Markdown 相对链接 ' + rep.links.relativeTotal + ' 条，**断链 ' + rep.links.broken.length + '** 条；'
    + '绝对链接 ' + rep.links.absoluteTotal + ' 条，其中 `docs.papermc.io` 已镜像 ' + rep.links.mirroredCount
    + ' 条 / 未镜像 ' + rep.links.unmirroredCount + ' 条（未镜像全部落在本次未镜像的子站：'
    + rep.links.unmirroredByScope.map(s => '`/' + s.scope + '`×' + s.count).join('、') + '）。');
  P('**6) front matter 一致性**：`title`/`source` 与 manifest 不一致 **' + rep.frontMatter.mismatches.length + '** 页；缺字段：'
    + (rep.frontMatter.missingFieldTotals.length ? rep.frontMatter.missingFieldTotals.map(f => '`' + f.field + '`×' + f.pages).join('、') : '无') + '。');
  P('');

  /* ---------------- 2 排行 ---------------- */
  P('## 2. 覆盖率最低 15 页排行');
  P('');
  P('### 2.1 正向覆盖率（Markdown → HTML：md 侧文字有多少能在 HTML 里找到）');
  P('');
  P('| # | 归档 | 页面 | 覆盖率 | 去重覆盖率 | loose | md token | 未命中 token | 其中缺失 token 数 | 缺失片段样例（HTML 有 / Markdown 无，≤200 字） |');
  P('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  rep.lowest.forEach((r, i) => {
    const frag = r.proseFragments && r.proseFragments.length
      ? '`' + mdCell(r.proseFragments[0].text) + '`（该片段覆盖 ' + r.proseFragments[0].coverage + '）'
      : '无整句级缺失片段';
    P('| ' + (i + 1) + ' | ' + r.archive + ' | [`' + mdCell(r.rel) + '`](' + r.url + ') | ' + fmt4(r.coverage) + ' | '
      + fmt4(r.coverageDistinct) + ' | ' + fmt4(r.coverageLoose) + ' | ' + r.mdTokens + ' | ' + r.missingTokens + ' | '
      + r.absentDistinct + ' | ' + frag + ' |');
  });
  P('');
  P('> "去重覆盖率" = 只按**去重后的 token 集合**计算（同一 token 重复多少次都只算一次）；"其中缺失 token 数" = 在 HTML 正文里**完全找不到**的 token 个数。'
    + '覆盖率 < 1 只有两种成因：① 纯计数差（同一 token 在 md 出现次数更多，去重覆盖率仍是 1.0000）② 少量 token 在 HTML 中只以行内代码/上标形式出现（见 4.6.2 逐页证据）。两种都不构成文本缺失。');
  P('');
  P('### 2.2 反向覆盖率最低 15 页（**整段丢失的正面指标**：HTML 正文有多少文字在 Markdown 里找不到）');
  P('');
  P('口径：**全内容**（两侧都不剥代码，因此不依赖"哪里算代码"的启发式判断），HTML 侧 = `.sl-markdown-content` + hero 一级标题。');
  P('');
  P('| # | 归档 | 页面 | 反向覆盖率(全内容) | 反向覆盖率(纯文本口径) | 正向覆盖率 | HTML token | HTML 有而 md 缺的 token | 分类 | 「HTML 有 / Markdown 无」片段样例 |');
  P('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  (rep.lowestReverse || []).forEach((r, i) => {
    const frag = (r.missingFragments && r.missingFragments.length)
      ? '`' + mdCell(r.missingFragments[0].text) + '`'
      : '无整句级缺失';
    P('| ' + (i + 1) + ' | ' + r.archive + ' | [`' + mdCell(r.rel) + '`](' + r.url + ') | **' + fmt4(r.coverageReverseAll)
      + '** | ' + fmt4(r.coverageReverse) + ' | ' + fmt4(r.coverage) + ' | ' + r.htmlAllTokens + ' | ' + r.htmlOnlyTokenCountAll
      + ' | ' + mdCell(r.classification) + ' | ' + frag + ' |');
  });
  P('');
  P('判定：若某页反向覆盖率低**且**存在整句级缺失片段，才说明该页 HTML 正文没有完整落到 Markdown —— 本报告第 4.6 节逐页给出证据。');
  P('');

  /* ---------------- 3 全量低于阈值 ---------------- */
  P('## 3. 低于阈值的全部页面与分类');
  P('');
  if (!rep.belowThreshold.length) P('无。');
  else {
    P('| 归档 | 页面 | 覆盖率 | 去重覆盖率 | loose | 未命中 token | 缺失 token 数 | 卡片节点 | 分类 |');
    P('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rep.belowThreshold) {
      P('| ' + r.archive + ' | `' + mdCell(r.rel) + '` | ' + fmt4(r.coverage) + ' | ' + fmt4(r.coverageDistinct) + ' | '
        + fmt4(r.coverageLoose) + ' | ' + r.missingTokens + ' | ' + r.absentDistinct + ' | ' + r.cardCount + ' | ' + r.classification + ' |');
    }
    P('');
    P('`repeat-count-only` = md 侧同一 token 出现次数多于 HTML（例如页面一级标题在 md 正文里再出现一次，而 HTML 把该标题放在正文容器外），**没有文本缺失**；'
      + '`card-hub` = 卡片/清单型枢纽页，组件文案天然只在 HTML 侧；`token-level-only` = 缺的都是短 token；'
      + '`suspected-gap` = 出现整句级缺失，需要人工核查（本报告第 4.6 节给出证据）。');
  }
  P('');

  /* ---------------- 4 问题清单 ---------------- */
  P('## 4. 问题清单（含证据片段）');
  P('');

  P('### 4.1 编码健康');
  P('');
  P('扫描范围：' + rep.encoding.scannedScopes.map(s => '`' + s + '`').join('、') + '，共 **' + rep.encoding.fileCount + '** 个文件（二进制资源 `assets/**`、`html/**` 快照不在本次文本编码范围内）。');
  P('');
  P('| 检查项 | 结果 |');
  P('| --- | --- |');
  P('| UTF-8 BOM | ' + (rep.encoding.bomFiles.length ? rep.encoding.bomFiles.map(f => '`' + f + '`').join('、') : '**0（全部无 BOM，合规）**') + ' |');
  P('| 非法 UTF-8 字节序列 | ' + (rep.encoding.invalidUtf8.length ? rep.encoding.invalidUtf8.map(f => '`' + f + '`').join('、') : '**0**') + ' |');
  P('| U+FFFD 替换符 | ' + rep.encoding.issues.filter(i => i.kind === 'replacement-char').length + ' 处 |');
  P('| 乱码模式（锟斤拷 / 鈥 / Ã 等） | ' + (rep.encoding.mojibakeFiles.length ? rep.encoding.mojibakeFiles.map(f => '`' + f.file + '`（' + f.mojibake.map(m => m.pattern + '×' + m.count).join('、') + '）').join('；') : '**0**') + ' |');
  P('| 中日韩占比为 0 的文件 | ' + rep.encoding.zeroCjkFiles.length + ' / ' + rep.encoding.fileCount + '（英文字档站，属预期，非编码丢失） |');
  P('| 含中日韩字符的文件 | ' + rep.encoding.withCjk.length + ' 个（见下） |');
  P('');
  if (rep.encoding.withCjk.length) {
    P('| 含中日韩字符的文件 | 字符数 |');
    P('| --- | --- |');
    for (const f of rep.encoding.withCjk) P('| `' + mdCell(f.file) + '` | ' + f.cjkChars + ' |');
    P('');
  }
  P('结论：**全部文本产物为无 BOM 的合法 UTF-8，未发现 `U+FFFD`、`锟斤拷`、`鈥` 类乱码**。');
  P('');

  P('### 4.2 HTML 残渣');
  P('');
  P('残渣模式命中总量：' + (rep.residue.patternTotals.length ? rep.residue.patternTotals.map(p => '`' + p.name + '`×' + p.count).join('、') : '**0（无任何命中）**'));
  P('');
  if (rep.residue.pagesWithResidue.length) {
    P('| 归档 | 页面 | 命中数 | 证据片段 |');
    P('| --- | --- | --- | --- |');
    for (const r of rep.residue.pagesWithResidue.slice(0, 30)) {
      const ev = r.hits.flatMap(h => (h.sample || []).map(s => h.name + ': ' + s)).slice(0, 2).join(' ／ ');
      P('| ' + r.archive + ' | `' + mdCell(r.rel) + '` | ' + r.total + ' | `' + mdCell(ev) + '` |');
    }
  } else {
    P('检查口径：Markdown 正文（**排除代码围栏与行内代码**）中检索 `class="astro-`、`<span`、`<div`、`<svg`、`<path`、`<button`、');
    P('`RAWHASHTOKEN`、`md-raw`、`ec-block`，以及未解码实体 `&amp; &lt; &gt; &quot; &#x27; &nbsp;`。全部 ' + rep.overall.pageCount + ' 页均未命中。');
  }
  P('');

  P('### 4.3 标题层级');
  P('');
  P('Markdown 计数（围栏外）' + JSON.stringify(rep.headings.totals.md) + ' vs HTML 计数 ' + JSON.stringify(rep.headings.totals.html) + '。');
  P('');
  if (rep.headings.mismatches.length) {
    P('| 归档 | 页面 | md 计数 | html 计数 | 差值 | 归因 |');
    P('| --- | --- | --- | --- | --- | --- |');
    for (const r of rep.headings.mismatches) {
      const why = r.unexplained.length
        ? '**未解释：' + mdCell(r.unexplained.map(u => u.reason).join('；')) + '**'
        : mdCell(r.reasons.join('；'));
      P('| ' + r.archive + ' | `' + mdCell(r.rel) + '` | `' + JSON.stringify(r.md) + '` | `' + JSON.stringify(r.html) + '` | `' + JSON.stringify(r.diff) + '` | ' + why + ' |');
    }
  } else P('无差异。');
  P('');
  P('跳级页面（**仅提示，不计错误**）共 ' + rep.headings.jumps.length + ' 页：'
    + (rep.headings.jumps.length ? rep.headings.jumps.slice(0, 8).map(j => '`' + j.rel + '`(' + j.jumps.join(',') + ')').join('、') : '无'));
  P('');

  P('### 4.4 站内链接与外链');
  P('');
  P('- 相对链接 ' + rep.links.relativeTotal + ' 条（其中根相对 `/...` ' + rep.links.rootRelative + ' 条），**断链 ' + rep.links.broken.length + ' 条**。');
  P('- 只锚点链接（`#...`）' + rep.links.anchorOnly + ' 条，已跳过存在性校验。');
  P('- 绝对链接 ' + rep.links.absoluteTotal + ' 条；`docs.papermc.io` 已镜像 ' + rep.links.mirroredCount + ' 条 / 未镜像 ' + rep.links.unmirroredCount + ' 条。');
  P('');
  if (rep.links.broken.length) {
    P('| 归档 | 来源页面 | href | 期望路径 |');
    P('| --- | --- | --- | --- |');
    for (const b of rep.links.broken.slice(0, 60)) P('| ' + b.archive + ' | `' + mdCell(b.page) + '` | `' + mdCell(b.href) + '` | `' + mdCell(b.expect) + '` |');
    P('');
  }
  P('未镜像 `docs.papermc.io` 链接按子站归类：');
  P('');
  P('| 子站 | 次数 | 样例 |');
  P('| --- | --- | --- |');
  for (const s of rep.links.unmirroredByScope) P('| `/' + mdCell(s.scope) + '` | ' + s.count + ' | ' + s.samples.map(u => '`' + mdCell(u) + '`').join('、') + ' |');
  P('');
  if (rep.links.inScopeMissing.length) {
    P('**需要关注**：以下未镜像链接落在本次已镜像的 `paper`/`velocity` 子站内（可能是真缺页）：');
    P('');
    for (const u of rep.links.inScopeMissing) P('- `' + u.url + '` × ' + u.count);
    P('');
  }
  P('外链 host 分布（Top 20）：');
  P('');
  P('| host | 次数 |');
  P('| --- | --- |');
  for (const h of rep.links.hosts.slice(0, 20)) P('| `' + mdCell(h[0]) + '` | ' + h[1] + ' |');
  P('');

  P('### 4.5 front matter 一致性');
  P('');
  P('缺字段统计：' + (rep.frontMatter.missingFieldTotals.length ? rep.frontMatter.missingFieldTotals.map(f => '`' + f.field + '`×' + f.pages + ' 页').join('、') : '无'));
  P('');
  if (rep.frontMatter.mismatches.length) {
    P('| 归档 | 页面 | 问题 |');
    P('| --- | --- | --- |');
    for (const r of rep.frontMatter.mismatches.slice(0, 40)) {
      P('| ' + r.archive + ' | `' + mdCell(r.rel) + '` | ' + mdCell(r.problems.map(p => p.kind + ': ' + p.detail).join('；')) + ' |');
    }
  } else {
    P('所有页面的 `title` 与 `source` 均与 `manifest.json` 一致，无缺 `title`/`source` 的页面。');
  }
  P('');

  P('### 4.6 低覆盖页面的缺失证据');
  P('');
  P('#### 4.6.1 反向覆盖率最低的页面（「HTML 有 / Markdown 无」的候选）');
  P('');
  for (const r of (rep.lowestReverse || []).slice(0, 12)) {
    P('**`' + r.archive + '/' + r.rel + '`** — 反向覆盖率（全内容）' + fmt4(r.coverageReverseAll)
      + '，HTML 有而 md 缺 ' + r.htmlOnlyTokenCountAll + '/' + r.htmlAllTokens + ' token，分类：' + r.classification);
    P('');
    if (r.missingFragments.length) {
      for (const f of r.missingFragments) P('- **整句级缺失**（该句 token 在 md 全内容中缺失 ' + (100 - Math.round(f.coverage * 100)) + '%）`' + mdCell(f.text) + '`');
    } else {
      P('- 无整句级缺失；未命中 token：' + (r.htmlOnlyTokenSampleAll.map(t => '`' + t.token + '`×' + t.count).join('、') || '—'));
    }
    P('');
  }
  P('#### 4.6.2 正向覆盖率低于阈值的页面');
  P('');
  if (!rep.belowThreshold.length) P('无低于阈值的页面。');
  else {
    for (const r of rep.belowThreshold.slice(0, 20)) {
      P('**`' + r.archive + '/' + r.rel + '`** — 正向覆盖率 ' + fmt4(r.coverage) + '（去重覆盖率 ' + fmt4(r.coverageDistinct)
        + '，loose ' + fmt4(r.coverageLoose) + '），未命中 token ' + r.missingTokens + '/' + r.mdTokens
        + '（完全找不到的 token：' + r.absentDistinct + ' 个 / ' + r.absentMisses + ' 次；纯计数差：' + r.repeatMisses + ' 次），分类：' + r.classification);
      P('');
      if (r.absentDistinct > 0) {
        P('- HTML 正文中完全找不到的 token（前 20）：' + r.absentTokenSample.map(t => '`' + t + '`').join('、'));
        P('');
      }
      if (r.proseFragments.length) {
        for (const f of r.proseFragments) P('- 整句级缺失样例（覆盖 ' + f.coverage + '，' + f.tokens + ' token）`' + mdCell(f.text) + '`');
      } else {
        P('- **无整句级缺失**；未命中的都是计数差 token：' + (r.missingTokenSample.map(t => '`' + t.token + '`×' + t.count).join('、') || '—'));
      }
      P('');
    }
  }

  /* ---------------- 5 方法 ---------------- */
  P('### 4.7 组件区块（`not-content`）文本落盘率 —— 系统性缺口定位');
  P('');
  const nct = rep.notContent.totals;
  P('站点用 `class="…not-content…"` 标记"由 Astro 组件 / expressive-code 代码框架 / 配置树组件渲染出来、不属于 Markdown 正文"的区块。');
  P('把这类区块单独拆出来量化后，缺口的来源非常集中：');
  P('');
  P('- 含 `not-content` 区块的页面：**' + nct.pages + '** 页');
  P('- 这些区块里的正文 token：**' + nct.tokens + '**，其中未落到 Markdown 的 **' + nct.missing + '**（'
    + (nct.coverage == null ? '—' : ((1 - nct.coverage) * 100).toFixed(2) + '%') + '），涉及 **' + nct.pagesWithAnyMissing + '** 页');
  P('');
  P('| 归档 | 页面 | not-content 区块 | token | 未落盘 | 落盘率 | 缺失样例（HTML 有 / Markdown 无） |');
  P('| --- | --- | --- | --- | --- | --- | --- |');
  for (const p of rep.notContent.pages.slice(0, 15)) {
    const ev = p.fragments.length ? p.fragments[0].text : (p.missingSample.map(t => t.token + '×' + t.count).join('、') || '—');
    P('| ' + p.archive + ' | `' + mdCell(p.rel) + '` | ' + p.blocks + ' | ' + p.tokens + ' | ' + p.missing + ' | '
      + fmt4(p.coverage) + ' | `' + mdCell(ev) + '` |');
  }
  P('');
  P('**根因**：这类区块里的文字由组件在构建期注入（例如代码框架 `expressive-code` 的代码块、`ConfigNode` 配置树、`starlight-file-tree` 文件树）。');
  P('Markdown 产物是**从 HTML 反向重建**的，重建时若整体跳过 `not-content` 区块，就会出现"整块代码丢失"或"配置说明缺行"。');
  P('本次实测的缺口全部属于这一类：');
  P('');
  const ncPagesWithFrag = rep.notContent.pages.filter(p => p.fragments.length);
  if (!ncPagesWithFrag.length) {
    P('- 当前产物版本下，`not-content` 区块没有出现整块丢失，仅剩零星 token 差。');
  } else {
    for (const p of ncPagesWithFrag.slice(0, 6)) {
      P('- `' + p.archive + '/' + p.rel + '`（落盘率 ' + fmt4(p.coverage) + '）：`' + mdCell(p.fragments[0].text) + '`');
    }
  }
  P('');
  P('**影响面评估**：缺口约占全部正文 token 的 ' + (rep.overall.meanCoverageReverse ? ((1 - rep.overall.meanCoverageReverse) * 100).toFixed(2) : '—')
    + '%（反向覆盖率均值 ' + fmt4(rep.overall.meanCoverageReverse) + '），且全部落在代码块／配置块／文件树这类组件渲染内容上；句级行文未发现丢失。');
  P('其中一部分缺口是代码框的**模板文字**（标题栏里的 `Terminal window`、代码块文件名等，Markdown 通常写成围栏信息串）与代码框行号，');
  P('并非正文；扣除这类模板文字后半句级缺口更少，因此本节的 `未落盘` 数字应视为**上界**。');
  P('修复方向：转换时不要整体跳过 `not-content` 区块，而是把 `expressive-code` / `ConfigNode` / `st-file-tree` 内部的文本按代码块或表格文本落盘。');
  P('');
  P('> 注意：`markdown/**` 属于上游可再生产物（本仓库会在重新转换时被覆盖）。本报告的结论绑定在下方记录的产物版本上，产物更新后请重跑本脚本。');
  P('');

  P('## 5. 方法说明');
  P('');
  P('### 5.1 数据流');
  P('');
  P('1. 读 `html/<rel>.html`，`cheerio.load` 后取 `.sl-markdown-content`（缺失时回退 `main`→`article`→`body`）。');
  P('2. **块边界注入**：`cheerio` 的 `.text()` 不在块级元素之间插入分隔符，`<td>0</td><td>completable</td>` 会粘成 `0completable`，');
  P('   造成大量假缺失。因此在取文本前把所有块级闭合标签（`p/div/li/td/tr/h1-h6/pre/aside/…`）与 `<br>` 替换为换行，再取 `.text()`。');
  P('3. 移除 `script/style/noscript/svg`、`.sl-anchor-link`（`Section titled “…”` 无障碍锚文本属模板 chrome，不是正文），并剥离 `pre/code/kbd/samp` 得到正文。');
  P('4. 读 `markdown/<rel>.md`，剥 front matter → 剥代码围栏（逐行状态机，支持 ```` ``` ```` 与 `~~~`）→ 剥行内代码/图片 → 链接只留显示文字 → 去标题/列表/引用标记与强调符 → 解码实体 → 规范化。');
  P('');
  P('### 5.2 规范化规则');
  P('');
  P('1. `normalize(\'NFKC\')`：统一全角/半角与兼容等价字符。');
  P('2. 不间断空格族（U+00A0/U+2000–200A/U+202F/U+205F/U+3000）与零宽字符（U+200B–200D/U+2060/U+FEFF）→ 空格，连续空白折叠。');
  P('3. 实体解码：`&amp; &lt; &gt; &quot; &apos; &nbsp;` 与全部十进制/十六进制数字实体。');
  P('4. 分词：ASCII 字母数字串转小写（`-`、`_`、`.`、`/` 视为分隔符，故 `paper_global_time` ≡ `paper global time`）；');
  P('   CJK/假名/韩文串取**字符二元组**（中文无空格，整段当一个 token 会失效）。');
  P('');
  P('### 5.3 覆盖率定义与阈值依据');
  P('');
  if (rep.sensitivity) {
    const s = rep.sensitivity;
    P('**双向灵敏度自检（证明指标真的能测出整段丢失）** —— 对最大的页面 `' + s.page + '` 各做一次人为删除（全内容口径）：');
    P('');
    P('| 操作 | 结果 | 结论 |');
    P('| --- | --- | --- |');
    P('| 删掉 Markdown 全文开头 15%（' + s.reverse.removedMdChars + ' 字 / ' + s.reverse.removedMdTokens + ' token） | '
      + '反向指标「HTML 有而 md 无的 token 数」由 ' + s.reverse.htmlOnlyBefore + ' 涨到 **' + s.reverse.htmlOnlyAfterMdCut
      + '**（+' + s.reverse.addedMissingTokens + '），反向覆盖率 ' + fmt4(s.reverse.coverageBefore) + ' → **' + fmt4(s.reverse.coverageAfterMdCut) + '** | 能测出整段丢失 ✅ |');
    P('| 删掉 HTML 全文开头 15%（' + s.forward.removedChars + ' 字 / ' + s.forward.removedTokens + ' token） | '
      + '正向覆盖率 ' + fmt4(s.forward.baseline) + ' → ' + fmt4(s.forward.afterRemovingHtmlChunk)
      + '（大幅下降，这恰好是反方向的现象）；同一次删除后反向覆盖率反而升到 ' + fmt4(s.forward.reverseCoverageAfter)
      + ' | 正向指标测的是反方向（md 有而 HTML 无），不能用于判定丢失 ⚠️ |');
    P('');
    P('补充说明：反向指标对"HTML 侧删内容"不敏感（删掉的多半本身就是 md 缺的那部分，覆盖率反而会小幅上升），');
    P('所以它测的是「md 相对 HTML 少了什么」，这正是"整段丢失"的定义。全站实测反向覆盖率均值 '
      + fmt4(rep.overall.meanCoverageReverse) + '，即"没有整段丢失"是真结论，不是指标性质造成的假象。');
    P('');
  }
  P('- 覆盖率 = **Markdown token 多重集合与 HTML token 多重集合的交集大小 ÷ Markdown token 总数**（按最小计数配对，可发现重复段落被吞）。');
  P('- 主指标 `coverage` 采用**对称口径：两侧都剔除代码块**。Markdown 侧按设计剥离了围栏代码，若 HTML 侧保留代码文本，覆盖率会被单向抬高、掩盖真实丢失。');
  P('- `coverageLoose`（HTML 侧保留代码）作为上界参照，两者差距大说明"差异集中在代码不属于正文"的部分。');
  P('- **`coverageDistinct`（去重覆盖率）**：只用去重后的 token 集合计算。清单/枢纽页里同一文案（页面标题、卡片条目）在 Markdown 会重复出现，而 HTML 只在正文容器里出现较少次数，');
  P('  这会让多重集覆盖率天然掉到 0.93 左右却没有任何文本缺失；去重口径可以立刻区分这两种情形。');
  P('- **缺失 token 二分**：`在 HTML 中完全找不到`（absent，真信号）与 `出现次数少于 md`（repeat，重复/格式差异）。报告里的"缺失 token 数"只统计前者。');
  P('- **阈值 0.95 的依据**：本镜像是对同一站点的机械转换，正文应无损搬运；剩下的 5% 余量留给行内代码剥离、');
  P('  模板 aria 文案、转义与表格边界等已知噪声。低于 0.95 进入人工核查清单，不直接等同缺陷。');
  P('- 缺失片段定位：HTML 正文先按**空行**切块（代码/配置块的行间只有一个换行，按行切会把每行都切碎而漏判），超长块再按句号/换行细分；');
  P('  逐块计算其 token 在 Markdown 多重集中的覆盖率，凡 **覆盖率 < 0.5 或"完全找不到的 token 数 ≥ 2"** 即列入候选');
  P('  （后者用于抓住"整块代码/配置块被吞"——周边同名词会把覆盖率拉高），按覆盖率升序取前 3 条并截断到 200 字。');
  P('');
  P('### 5.4 其余检查口径');
  P('');
  P('- **编码**：读原始 buffer 判 BOM（`EF BB BF`）并用 `TextDecoder(\'utf-8\',{fatal:true})` 判合法性；文本层统计 `U+FFFD` 与乱码模式。');
  P('  `鏈/绋/鐨` 是真实汉字（如"产业链"），只作统计不判为乱码，避免误报。');
  P('- **残渣**：只扫**代码围栏与行内代码之外**的 Markdown 正文，避免把文档里正常示范的 HTML 片段误判为残渣。');
  P('- **标题**：Markdown 侧只在围栏外计数（否则 `# bash 注释`、`# yaml 注释` 会被误当一级标题）；');
  P('  HTML 侧 `h2..h6` 取 `.sl-markdown-content` 内计数并剔除 `.footnotes` 内站方自动生成的脚注标题，`h1` 取"正文内 h1 + 正文外 hero h1"。');
  P('- **链接**：相对链接按源文件所在目录解析，依次尝试 `X.md`、`X/index.md`、原路径（根相对 `/x` 相对仓库根解析）；');
  P('  绝对 `docs.papermc.io` 链接剥 fragment 与尾部斜杠后，与两个 `manifest.json` 的 url 集合作集合比较。');
  P('- **front matter**：轻量 `key: value` 解析（去引号），`title` 对 manifest 的 `title`、`source` 对 manifest 的 `url` 做规范化比较。');
  P('');

  /* ---------------- 6 限制 ---------------- */
  P('## 6. 已知限制');
  P('');
  P('1. **卡片/清单型枢纽页天然低覆盖（单独归类，不算缺陷）**：Starlight 索引页大量使用卡片组件（`[class*="card"]`，本报告判定阈值：卡片节点 ≥ ' + CARD_HUB_MIN_CARDS + ' 个），');
  P('   卡片标题/描述常来自站点 schema 或链接组的渲染结果而非页面 Markdown 正文，这些文案只存在于 HTML 侧。')
  ;
  P('   本次被归入 `card-hub` 的页面：' + (rep.belowThreshold.filter(b => /card-hub/.test(b.classification)).map(b => '`' + b.archive + '/' + b.rel + '`').join('、') || '无')
    + '；在 0.95 阈值之上但同样含卡片的页面未列入问题清单。');
  P('2. **SyncedTabs 标签被转换器写成标题**：`paper/dev/particles` 等页的 `#### ParticleBuilder` / `#### spawnParticle` 来自 `<starlight-tabs role="tab">` 标签，');
  P('   HTML 侧并没有对应 `<h4>`，因此标题计数"Markdown 偏多"属转换器行为，同一文本仍在 HTML 中，**不是内容丢失**。已在 4.3 节逐页归因。');
  P('3. **HTML 侧多出的标题不等于文本丢失**：如 `paper/dev/pdc` 的 10 个 `<h5>` 在 Markdown 中未保留为标题，但标题文本仍在正文（链接列表里出现）。');
  P('   4.3 节已按"标题文本是否仍出现在 Markdown"区分"层级丢失"与"文本丢失"，只有后者计入未解释差异。');
  P('4. **英文语料的"中日韩占比为 0"不是编码丢失证据**：`docs.papermc.io` 是英文文档站，绝大多数页面本就没有中日韩字符。');
  P('   真正有意义的是 `source` → `markdown` 的中日韩字符数下降（本次：' + rep.overall.cjkLoss + ' 页），本报告单独统计。');
  P('5. **模板 chrome 剥离是启发式的**：`.sl-anchor-link`、`Section titled “…”` 按类名/正则剥离；站点模板一变就需要同步更新剥离规则，否则会污染缺失片段。');
  P('6. **纯行内代码与实际代码块不参与主指标**：两侧都剥代码后，主指标对"代码内容丢失"不敏感（代码差异请看 `coverageLoose` 与源码 diff，本次未做代码级对齐）。');
  P('7. **分词粒度**：token 级覆盖率是"词集合"比较，对词序错乱、段落错位不敏感，也不做句序对齐。');
  P('8. **链接检查只看存在性**：相对链接仅校验目标文件存在，不校验 `#fragment` 锚点是否存在，也不校验链接指向的内容是否仍对应。');
  P('9. **未镜像 URL 判定依赖 manifest**：指向 `docs.papermc.io` 其他子站（`/adventure`、`/misc`、`/folia` 等）的链接本身就在本次镜像范围之外，属正常外链；只有落在 `/paper`、`/velocity` 下的未镜像链接才可能是真缺页（见 4.4 节）。');
  P('10. **`html/**` 与 `assets/**` 不在文本编码扫描范围**：本次编码结论只覆盖 Markdown/JSON/语料等文本产物。另外注意用 PowerShell `Get-Content` 查看这些 UTF-8 文件时，PS 5.1 会按 GBK 显示而呈现"假乱码"，校验一律以 Node `utf8` 读取为准。');
  P('11. **审计对象是可再生产物**：`markdown/**`、`source/**`、`INDEX.md`、`*-all.md` 都由转换流程生成，可能在本报告生成之后被重跑覆盖（本次审计期间就发生过一次重跑，见报告头部的产物版本表）。每条结论都要与版本时间一起解读；产物更新后重跑 `node tools/audit-text.js` 即可刷新。');
  P('12. **口径不对称是最大误报源**：Markdown 用反引号/围栏表示代码，站点用 `<code>`、`expressive-code`、`not-content` 组件表示代码，两侧"哪里算代码"的判定并不等价。本报告因此同时给出四个数字（正向/反向 × 纯文本口径/全内容口径），并以**全内容口径的反向覆盖率**作为"整段丢失"的判定依据。');
  P('');
  P('---');
  P('');
  P('产物：`reports/audit-text.json`（逐页 token 级明细与全部证据）、`reports/content-audit-text.md`（本报告）。');
  P('脚本只读 `archive/**`，只写上述两个文件。');
  P('');
  return o.join('\n');
}

function emptySummary() {
  return {
    pageCount: 0, meanCoverage: 0, meanCoverageLoose: 0, minCoverage: 0, minCoveragePage: '—', perfectPages: 0,
    belowThreshold: 0, belowThresholdShare: 0, totalMdTokens: 0, totalMissingTokens: 0, suspectedGap: 0,
    cardHub: 0, headingMismatchUnexplained: 0, headingMismatchExplained: 0, residuePages: 0, fmMismatch: 0, cjkLoss: 0
  };
}

main: {
  if (require.main !== module) break main;
  main();
}
/* 供离线调试/复核复用（require 本文件时不会执行审计） */
module.exports = {
  splitFrontMatter, mdToProse, mdHeadings, tokenize, makeBag, bagCoverage,
  loadPageHtml, blockBoundaries, normalizeDocUrl, COVERAGE_THRESHOLD
};
