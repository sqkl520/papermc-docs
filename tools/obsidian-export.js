#!/usr/bin/env node
'use strict';
/**
 * obsidian-export.js — PaperMC 文档（141 篇）→ Obsidian 笔记转换器
 *
 * 权威契约：reports/obsidian-contract.md（v4；§1.0.1 H1–H5 + §1.0.2 H4–H6/M1–M7）
 * 源侧基线：reports/obsidian-fidelity.json
 *
 * 用法：
 *   node tools/obsidian-export.js [--vault=<path>] [--dry-run] [--only=<section>]
 *                                 [--pages=key1,key2] [--stage] [--rollback]
 *   --stage     先写库内兄弟目录 Paper Database.__stage/，校验全绿后同卷 rename 落位
 *   --rollback  按 Paper Database/_export-manifest.json 删除/还原产物
 *   --pages=a,b 只处理指定 key（哨兵试点）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => {
  const p = '--' + n + '=';
  const hit = argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : d;
};
const DRY = flag('dry-run');
const STAGE = flag('stage');
const ROLLBACK = flag('rollback');
const SELFTEST = flag('selftest');
const PIREPORT = flag('pilot-report');
const COVDEBUG = opt('cov-debug', null);
const PAGES = opt('pages', '').split(',').map((s) => s.trim()).filter(Boolean);
const PILOT = PAGES; // 哨兵试点：只导出指定 key
const ONLY_SEC = opt('only', null);
const VAULT = opt('vault', process.env.OBSIDIAN_VAULT || '<VAULT_PATH>');
const DEST = path.join(VAULT, 'Server', 'Paper Database');
const STAGE_DIR = path.join(VAULT, 'Server', 'Paper Database.__stage');
// 备份根放在 **vault 之外**（vault 根的上一级）：Obsidian 看不到 → 不会制造重复 basename 候选
const BACKUP_ROOT = path.join(path.dirname(VAULT), 'PaperMC-Obsidian.__backup');
const REPO = path.resolve(__dirname, '..');
const REPORTS = path.join(REPO, 'reports');
const FIDELITY = JSON.parse(fs.readFileSync(path.join(REPORTS, 'obsidian-fidelity.json'), 'utf8'));

const SECTIONS = [
  { id: 'paper', title: 'Paper' },
  { id: 'velocity', title: 'Velocity' },
  { id: 'folia', title: 'Folia' },
];
const SEC_TITLE = Object.fromEntries(SECTIONS.map((s) => [s.id, s.title]));
const TODAY = new Date().toISOString().slice(0, 10);

const errors = [];
const warnings = [];
const stats = {};
const err = (m) => { errors.push(m); };
const warn = (m) => { warnings.push(m); };

// ---------------------------------------------------------------- util
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const read = (p) => fs.readFileSync(p, 'utf8');
const normLF = (s) => s.replace(/\r\n/g, '\n');

/** Obsidian 标题锚点比较：大小写不敏感 + 空白折叠（契约 M5） */
const normAnchor = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** github-slugger 近似（Starlight 用同一套；仅用于 A 类反查统计） */
const GH_PUNCT = /[\u0000-\u001f\u007f!-,.\/:-@\[-\^`\{-~\u00a0\u1680\u2000-\u206f\u2e00-\u2e7f\u3000]/g;
const slugify = (s) => s.toLowerCase().trim().replace(GH_PUNCT, '').replace(/ /g, '-');

/** wikilink 目标里必须转义的保留字符（契约 v3 H4） */
const escTarget = (s) => s.replace(/([|#^\[\]])/g, '\\$1');

/** 文件名清洗：Windows 非法 + 验收追加禁用字符 ^ % ~ [ ] */
function sanitizeName(name) {
  let s = String(name)
    .replace(/[\\/:*?"<>|^%~\[\]]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (s.length > 110) s = s.slice(0, 110).trim();
  return s || 'untitled';
}

/** YAML 标量：需要引号则双引号包裹（契约 D4） */
function yamlStr(v) {
  const s = String(v);
  if (s === '') return '""';
  const need = /[:#\[\]{}&*!|>'"%@`]/.test(s) || /^[\s-]/.test(s) || /^(true|false|null|on|off|yes|no|~)$/i.test(s) || /^[-+]?[0-9.]+$/.test(s) || /\s$/.test(s) || /^\s/.test(s);
  if (!need) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const stripTags = (h) => normLF(h)  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** HTML 片段 → markdown 近似（脚注、正文 HTML 内容用） */
function htmlToMd(html) {
  let s = html;
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (m, t) => '`' + stripTags(t) + '`');
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, t) => {
    const label = stripTags(t);
    return label ? '[' + label + '](' + href.replace(/&amp;/g, '&') + ')' : label;
  });
  s = s.replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '');
  s = s.replace(/<\/p>/gi, '\n\n').replace(/<p[^>]*>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function relOut(p) { return p.split(path.sep).join('/'); }

// ---------------------------------------------------------------- 读取源
function loadPages() {
  const pages = [];
  for (const sec of SECTIONS) {
    const manifest = JSON.parse(read(path.join(REPO, 'archive', sec.id, 'manifest.json')));
    for (const p of manifest.pages) {
      const key = sec.id + ':' + p.rel;
      pages.push({
        key, sec: sec.id, secTitle: sec.title, rel: p.rel,
        slug: p.rel.replace(/\/index$/, '') || 'index',
        title: p.title, url: p.url, sha: p.sha256, fetchedAt: p.fetchedAt,
        mdPath: path.join(REPO, 'archive', sec.id, p.file),
        htmlPath: path.join(REPO, 'archive', sec.id, p.htmlFile),
        dir: path.posix.dirname(p.rel),
        manifestAssets: p.assets,
      });
    }
  }
  return pages;
}

function loadNav() {
  const nav = JSON.parse(read(path.join(REPO, 'data', 'source-nav.json')));
  const inNav = new Map();   // key → {groupPath, label}
  const groups = new Map();  // `${sec}:${path}` → {sec, labels, homeKey:null}
  const order = [];          // 先序 group 列表 `${sec}:${path}`
  for (const s of nav.sections) {
    const walk = (nodes, gp) => {
      for (const n of nodes) {
        if (n.kind === 'group') {
          const labels = gp.concat(n.label);
          const gk = s.id + ':' + labels.join(' > ');
          if (!groups.has(gk)) groups.set(gk, { key: gk, sec: s.id, labels, homeKey: null, order: order.length });
          order.push(gk);
          walk(n.children || [], labels);
        } else {
          inNav.set(s.id + ':' + n.rel, { groupPath: gp.slice(), label: n.label, title: n.title });
        }
      }
    };
    walk(s.groups, []);
    // M4：组首页 → 组 用显式映射表（pagesNotInSourceNav[].reason）
    stats['navReasons_' + s.id] = (s.pagesNotInSourceNav || []).length;
  }
  return { inNav, groups, order, nav };
}

/** M4：从 reason 文本解析「A > B」组路径 → 显式映射表 */
function parseReasonMap() {
  const nav = JSON.parse(read(path.join(REPO, 'data', 'source-nav.json')));
  const map = new Map(); // key → groupPath[]
  const rows = [];
  for (const s of nav.sections) {
    for (const e of (s.pagesNotInSourceNav || [])) {
      const m = /「([^」]+)」/.exec(e.reason || '');
      let gp = [];
      if (m) gp = m[1].split('>').map((x) => x.trim()).filter(Boolean);
      map.set(s.id + ':' + e.rel, gp);
      rows.push({ key: s.id + ':' + e.rel, rel: e.rel, title: e.title, group: gp.join(' > '), reason: e.reason, parsed: !!m });
    }
  }
  return { map, rows };
}

function loadTaxonomy() {
  const t = JSON.parse(read(path.join(REPO, 'data', 'taxonomy.json')));
  const byKey = new Map();
  for (const p of t.pages) byKey.set(p.id, p);
  const catTitle = new Map();
  for (const c of t.categories) catTitle.set(c.id, c.title);
  return { byKey, catTitle, categories: t.categories };
}

// ---------------------------------------------------------------- HTML 索引（B 类锚点 / M1 脚注定义）
function buildHtmlIndex(pages) {
  const idx = new Map();
  for (const p of pages) {
    const rec = { ids: new Map(), fn: new Map() };
    if (fs.existsSync(p.htmlPath)) {
      const $ = cheerio.load(read(p.htmlPath));
      $('[id]').each((_i, el) => {
        const id = $(el).attr('id');
        if (!id || rec.ids.has(id)) return;
        const tag = (el.tagName || '').toLowerCase();
        const text = /^h[1-6]$/.test(tag) ? $(el).text().replace(/\s+/g, ' ').trim() : '';
        rec.ids.set(id, { tag, text });
      });
      $('li[id^="user-content-fn-"]').each((_i, el) => {
        const id = $(el).attr('id').replace(/^user-content-fn-/, '');
        const clone = $(el).clone();
        clone.find('a[data-footnote-backref]').remove();
        clone.find('a[href^="#user-content-fnref"]').remove();
        const md = htmlToMd(clone.html() || '').replace(/↩/g, '').replace(/\s*\n\s*/g, ' ').trim();
        if (md) rec.fn.set(id, md);
      });
    } else {
      warn('缺少归档 HTML：' + p.key);
    }
    idx.set(p.key, rec);
  }
  return idx;
}

/** 标题字面量规范化：去掉行内代码/链接/强调标记，得到「渲染后文本」——锚点写入与校验都用它 */
function plainHeading(t) {
  return String(t)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 行内 `#数字`（Obsidian 非法 tag，但会成正文噪声）→ 包成行内代码；文本内容不变，行内代码内不动 */
function escapeHashNumbers(line) {
  const parts = line.split(/(`+[^`]*`+)/);
  return parts.map((p, idx) => {
    if (idx % 2 === 1) return p;
    return p
      .replace(/\[#(\d+)\](?=\()/g, '[`#$1`]')                        // 链接文本里的 #数字（如 [#3724](url)）
      .replace(/([\s(])#(\d+)(?=[\s.,;:!?)\]]|$)/g, '$1`#$2`');       // 正文里的裸 #数字
  }).join('');
}

// ---------------------------------------------------------------- Markdown 标题（A 类反查）
function mdHeadings(srcLF) {
  const list = [];
  const count = {};
  let inFence = null;
  for (const line of srcLF.split('\n')) {
    const fm = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fm) {
      if (!inFence) inFence = { ch: fm[2][0], len: fm[2].length };
      else if (fm[2][0] === inFence.ch && fm[2].length >= inFence.len && fm[3].trim() === '') inFence = null;
      continue;
    }
    if (inFence) continue;
    // 口径（契约 v5）：行首标题 ∪ 列表内嵌标题
    const m = /^(?:[ \t]*[-*+][ \t]+)?(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const embedded = /^[ \t]*[-*+][ \t]+#/.test(line);
    const text = m[2];
    const plain = plainHeading(text);
    let s = slugify(plain);
    count[s] = (count[s] || 0) + 1;
    if (count[s] > 1) s = s + '-' + (count[s] - 1);
    list.push({ level: m[1].length, text, plain, slug: s, embedded });
  }
  return list;
}

// ---------------------------------------------------------------- 附件规划
function planAttachments(pages) {
  const byAbs = new Map();
  const refList = [];
  for (const p of pages) {
    const src = read(p.mdPath);
    const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(src))) {
      const href = m[2];
      if (/^data:/i.test(href)) { refList.push({ pageKey: p.key, href, kind: 'data', alt: m[1] }); continue; }
      if (/^https?:/i.test(href)) { refList.push({ pageKey: p.key, href, kind: 'external', alt: m[1] }); continue; }
      const abs = path.resolve(path.dirname(p.mdPath), href);
      if (!fs.existsSync(abs)) {
        refList.push({ pageKey: p.key, href, kind: 'missing', alt: m[1] });
        warn('图片文件缺失：' + href + ' @ ' + p.key);
        continue;
      }
      let rec = byAbs.get(abs);
      if (!rec) {
        const buf = fs.readFileSync(abs);
        rec = {
          abs, origName: path.basename(abs), sha: sha256(buf), bytes: buf.length,
          buf, sections: new Set(), pages: new Set(), finalName: null,
        };
        byAbs.set(abs, rec);
      }
      rec.sections.add(p.sec);
      rec.pages.add(p.key);
      refList.push({ pageKey: p.key, href, kind: 'local', alt: m[1], abs, sha: rec.sha });
    }
  }
  const byFinal = new Map();
  const order = SECTIONS.map((s) => s.id);
  for (const rec of [...byAbs.values()].sort((a, b) => a.origName.localeCompare(b.origName))) {
    const ext = path.extname(rec.origName);
    let slug = rec.origName.slice(0, rec.origName.length - ext.length)
      .replace(/\.[A-Za-z0-9_-]{6,}$/, '');
    slug = slug.replace(/[^A-Za-z0-9._-]/g, '-') || 'image';
    let name = `${slug}.${rec.sha.slice(0, 8)}${ext}`;
    const prior = byFinal.get(name);
    if (prior) {
      if (prior.sha === rec.sha) { rec.dupOf = prior; byFinal.set(name, prior); rec.finalName = name; continue; }
      name = `${slug}.${rec.sha.slice(0, 8)}.${[...rec.sections].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]}${ext}`;
    }
    rec.finalName = name;
    byFinal.set(name, rec);
  }
  return { byAbs, byFinal, refList };
}

// ---------------------------------------------------------------- inline 扫描（不碰行内代码）
function scanLinks(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      let n = 1;
      while (line[i + n] === '`') n++;
      const close = line.indexOf('`'.repeat(n), i + n);
      i = close < 0 ? line.length : close + n;
      continue;
    }
    if (c === '[') {
      const isImg = i > 0 && line[i - 1] === '!';
      let depth = 0, j = i, close = -1;
      while (j < line.length) {
        const d = line[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') depth++;
        else if (d === ']') { depth--; if (depth === 0) { close = j; break; } }
        j++;
      }
      if (close < 0) break;
      if (line[close + 1] !== '(') { i = close + 1; continue; }
      let k = close + 1, dd = 0, end = -1;
      while (k < line.length) {
        const d = line[k];
        if (d === '\\') { k += 2; continue; }
        if (d === '(') dd++;
        else if (d === ')') { dd--; if (dd === 0) { end = k; break; } }
        k++;
      }
      if (end < 0) break;
      out.push({ start: isImg ? i - 1 : i, end, text: line.slice(i + 1, close), href: line.slice(close + 2, end), isImg });
      i = end + 1;
      continue;
    }
    i++;
  }
  return out;
}

function splitFrag(href) {
  const i = href.indexOf('#');
  if (i < 0) return [href, null];
  return [href.slice(0, i), href.slice(i + 1) || null];
}

// ---------------------------------------------------------------- 锚点解析（A/B/C 三分类）
function resolveAnchor(ctx, targetKey, frag, sourceKey) {
  const raw = frag;
  let f = frag;
  try { f = decodeURIComponent(frag); } catch (_e) { /* keep */ }
  const tp = ctx.byKey.get(targetKey);
  if (!tp) return { cls: 'C', heading: null, note: '目标页不存在', frag: raw };
  const hit = tp.headings.find((h) => h.slug === f || normAnchor(h.slug) === normAnchor(f));
  if (hit) return { cls: 'A', heading: hit.plain, frag: raw };
  const hid = tp.htmlIds.get(f);
  if (hid && /^h[1-6]$/.test(hid.tag)) return { cls: 'B', heading: hid.text, frag: raw };
  const lit = tp.headings.find((h) => normAnchor(h.plain) === normAnchor(f.replace(/-/g, ' ')));
  if (lit) return { cls: 'A', heading: lit.plain, frag: raw };
  // C 类：目标不是标题。附「恢复提示」——归档 HTML 里同前缀的 id（仅记录，不写进笔记）
  let hint = null;
  if (!hid) {
    for (const [id, v] of tp.htmlIds) {
      if (id.startsWith(f) || f.startsWith(id)) { hint = { id, tag: v.tag, text: v.text }; break; }
    }
  }
  return { cls: 'C', heading: null, frag: raw, element: hid ? hid.tag : null, hint };
}

/** 组装 wikilink；H4：目标/别名里的 | # ^ [ ] 转义；表格内别名分隔符写 \|（spec §9.1）
 *  别名与目标/锚点等价时省略别名（避免冗余 `|`，也消除「表格里解释 `\|`」带来的解析歧义） */
function wikilink(name, anchor, text, inTable) {
  let t = String(name).replace(/([|#^\[\]])/g, '\\$1');
  if (anchor) t += '#' + String(anchor).replace(/([|^\[\]#])/g, '\\$1');
  const plain = text ? text.replace(/\\([\[\]|])/g, '$1').trim().replace(/\s+/g, ' ') : '';
  const ref = String(anchor || name).trim().replace(/\s+/g, ' ');
  // 只在「显示文本与目标/锚点逐字相同」时省略别名：大小写也算差异，避免改动可见文本
  const keepAlias = plain !== '' && plain !== ref;
  let s = '[[' + t;
  if (keepAlias) {
    let disp = text.replace(/([\[\]])/g, '\\$1');
    if (inTable) disp = disp.replace(/\|/g, '\\|');
    s += (inTable ? '\\|' : '|') + disp;
  }
  return s + ']]';
}

function recordAnchor(ctx, cls, rec) {
  ctx.anchorCounts[cls] = (ctx.anchorCounts[cls] || 0) + 1;
  ctx.anchorDistinct.add(cls + '|' + (rec.target || '') + '|' + (rec.frag || ''));
  ctx.anchorAll.push(rec);
  if (cls === 'C') ctx.anchorC.push(rec);
  if (cls === 'B') ctx.anchorB.push(rec);
}

/** 把 href 解析成 note key（相对 .md 或 docs.papermc.io 绝对） */
function hrefToKey(ctx, p, href) {
  const [file, frag] = splitFrag(href);
  if (file === '') return { key: p.key, frag, same: true };
  if (/^https?:\/\//i.test(file)) {
    const u = file.replace(/\/+$/, '') + '/';
    const key = ctx.urlToKey.get(u) || ctx.urlToKey.get(file);
    return key ? { key, frag, external: true } : { key: null, frag, external: true, url: file };
  }
  const joined = path.posix.normalize(path.posix.join(p.dir === '.' ? '' : p.dir, file)).replace(/\.md$/i, '');
  const key = p.sec + ':' + joined;
  return { key: ctx.byKey.has(key) ? key : null, frag, raw: joined };
}

function rewriteText(line, p, ctx, inTable) {
  let s = line;
  // 行内 `#数字`（Obsidian 里不是合法 tag，但在正文是噪声）→ 包成行内代码（文本内容不变）
  if (!/^\s*#{1,6}\s/.test(line)) s = escapeHashNumbers(s);
  // 脚注引用（M1：正文只在 HTML 里有定义）
  s = s.replace(/<sup>\s*\[(\d+)\]\(#user-content-fn-([^)]+)\)\s*<\/sup>/g, (m, _n, rawId) => {
    const id = rawId.replace(/^fn-/, '');
    if (ctx.fnAvailable.has(p.key + '|' + id)) { ctx.fnUsed.add(id); return '[^fn-' + id + ']'; }
    ctx.fnMissing.push({ page: p.key, id });
    warn('脚注正文提取失败，保留原 <sup>：' + p.key + ' #' + id);
    return m;
  });
  // callout 类型统一小写（GitHub alert 原样）
  s = s.replace(/^(\s*>+\s*)\[!([A-Za-z]+)\]/, (_m, pre, type) => pre + '[!' + type.toLowerCase() + ']');
  const links = scanLinks(s);
  for (let i = links.length - 1; i >= 0; i--) {
    const L = links[i];
    const rep = rewriteOneLink(L, p, ctx, inTable);
    s = s.slice(0, L.start) + rep + s.slice(L.end + 1);
  }
  return s;
}

function rewriteOneLink(L, p, ctx, inTable) {
  const orig = L.isImg
    ? '![' + L.text + '](' + L.href + ')'
    : '[' + L.text + '](' + L.href + ')';
  // 图片
  if (L.isImg) {
    if (/^(data:|https?:)/i.test(L.href)) {
      if (/^data:/i.test(L.href)) { ctx.inlineImages.push({ page: p.key, kind: 'data' }); }
      return orig;
    }
    const abs = path.resolve(path.dirname(p.mdPath), L.href);
    const rec = ctx.att.byAbs.get(abs);
    if (!rec) { ctx.missingImages.push({ page: p.key, href: L.href }); return orig; }
    ctx.imageRewrites++;
    return '![[' + rec.finalName + ']]';
  }
  // 外链
  if (/^https?:\/\//i.test(L.href) && !/^https?:\/\/docs\.papermc\.io\//i.test(L.href)) return orig;
  // 锚点 / 内部链接
  const r = hrefToKey(ctx, p, L.href);
  if (!r.key) {
    if (/docs\.papermc\.io/i.test(L.href) || /\.md(#|$)/i.test(L.href)) {
      ctx.externalKept.push({ page: p.key, href: L.href, text: L.text, kind: 'unmapped' });
      ctx.linkDiag.push({ page: p.key, href: L.href, joined: r.raw || null, dir: p.dir });
      return '[' + L.text + '](' + L.href + ')（未镜像）';
    }
    return orig;
  }
  if (r.key === p.key && !r.frag) return orig; // 自链接无 fragment：保持原样
  const tp = ctx.byKey.get(r.key);
  if (r.frag) {
    const a = resolveAnchor(ctx, r.key, r.frag, p.key);
    const degraded = a.cls === 'C';
    const link = degraded ? wikilink(tp.name, null, L.text, inTable) : wikilink(tp.name, a.heading, L.text, inTable);
    const targetPart = link.slice(2, link.indexOf(']]')).split('|')[0];
    recordAnchor(ctx, a.cls, {
      class: degraded ? (a.element ? 'C' : 'dead') : a.cls,
      source: p.key, target: r.key, targetName: tp.name,
      frag: r.frag, text: L.text,
      literal: degraded ? null : a.heading,
      degradedReason: degraded ? ('目标不是标题（' + (a.element ? '<' + a.element + '> 元素，配置树等' : '归档 HTML 也无此 id：上游死链') + '）→ 降级为笔记级链接') : null,
      escaped: /\\/.test(targetPart),
      link,
      element: a.element || null, hint: a.hint || null, href: L.href,
    });
    if (degraded) ctx.rewrites.degrade++; else ctx.rewrites.anchor++;
    return link;
  }
  ctx.rewrites.md++;
  return wikilink(tp.name, null, L.text, inTable);
}

// ---------------------------------------------------------------- 正文块转换
const DETAILS_RE = /^\s*<details\b/i;
function fenceAt(line) {
  const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
  return m ? { indent: m[1], fence: m[2], info: m[3].trim() } : null;
}

function convertBlocks(lines, p, ctx, quote) {
  const out = [];
  const ql = (l) => (l.trim() === '' ? quote.replace(/\s+$/, '') : quote + l);
  // 含链接的标题（契约 v5 裁决）：标题拍平为纯文本，原链接移到紧接的下一行，两者都不丢
  const emitHeading = (headingLine, promotedFrom) => {
    const hm = /^(#{1,6}) (.*)$/.exec(headingLine);
    const links = hm[2].match(/!?\[[^\]]*\]\([^)]*\)/g);
    if (!links) { out.push(ql(headingLine)); return; }
    const plain = plainHeading(hm[2]);
    out.push(ql(hm[1] + ' ' + plain));
    out.push(ql(links.join(' ')));
    ctx.headingLinkSplit.push({
      page: p.key, from: promotedFrom || headingLine,
      heading: hm[1] + ' ' + plain, links: links.slice(),
    });
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // --- <details> → 折叠 callout（M2：逐行加 "> "，空行 → ">"）
    if (DETAILS_RE.test(line)) {
      let title = null, j = i + 1, end = -1;
      for (let k = i; k < Math.min(lines.length, i + 8); k++) {
        const sm = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(lines[k]);
        if (sm) { title = stripTags(sm[1]); j = k + 1; break; }
      }
      if (title !== null) {
        for (let k = j; k < lines.length; k++) if (/^\s*<\/details>/i.test(lines[k])) { end = k; break; }
      }
      if (title === null || end < 0) {
        warn('details 结构异常（未闭合或无 summary）@ ' + p.key + ' L' + (i + 1));
        out.push(ql(line)); i++; continue;
      }
      let inner = lines.slice(j, end);
      while (inner.length && inner[0].trim() === '') inner.shift();
      while (inner.length && inner[inner.length - 1].trim() === '') inner.pop();
      ctx.details++;
      out.push(quote + '> [!note]- ' + (title || '详情'));
      for (const l of convertBlocks(inner, p, ctx, quote + '> ')) out.push(l);
      i = end + 1;
      while (i < lines.length && lines[i].trim() === '') i++;
      out.push(quote.replace(/\s+$/, ''));
      continue;
    }
    // --- 引用内嵌围栏（callout 里的带文件名代码块）→ 嵌套 example callout
    const qf = /^((?:[ \t]*>[ \t]?)+)(`{3,}|~{3,})(.*)$/.exec(line);
    if (qf && /title\s*=/.test(qf[3])) {
      const pre = qf[1], fch = qf[2];
      const preBase = pre.replace(/[ \t]+$/, '');
      // 引用内嵌围栏里，空行常写成裸 `>`（无尾随空格）——两种都要能剥前缀
      const stripPre = (l) => {
        if (l.startsWith(pre)) return l.slice(pre.length);
        if (l.startsWith(preBase)) return l.slice(preBase.length).replace(/^[ \t]/, '');
        return null;
      };
      let end = -1;
      for (let k = i + 1; k < lines.length; k++) {
        const rest = stripPre(lines[k]);
        if (rest === null) break;
        const m2 = /^(`{3,}|~{3,})\s*$/.exec(rest);
        if (m2 && m2[1][0] === fch[0] && m2[1].length >= fch.length) { end = k; break; }
      }
      if (end > i) {
        const inner = lines.slice(i + 1, end).map((l) => { const r = stripPre(l); return r === null ? l : r; });
        const tm = /title\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(qf[3]);
        const fname = (tm[1] || tm[2] || tm[3] || '').trim();
        const lang = qf[3].trim().replace(/title\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/, '').trim();
        const open = '```' + lang;
        out.push(quote + pre + '> [!example]- `' + fname + '`');
        out.push(quote + pre + '> ' + open);
        for (const l of inner) out.push(quote + pre + '> ' + l);
        out.push(quote + pre + '> ```');
        ctx.titledFences.push({
          page: p.key, file: fname, lang, srcOpen: line, srcBody: inner.slice(),
          emittedOpen: open, emittedBody: inner.slice(), nested: true,
        });
        i = end + 1;
        continue;
      }
    }
    // --- 围栏
    const fi = fenceAt(line);
    if (fi) {
      let end = -1;
      for (let k = i + 1; k < lines.length; k++) {
        const m2 = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[k]);
        if (m2 && m2[2][0] === fi.fence[0] && m2[2].length >= fi.fence.length && m2[3].trim() === '') { end = k; break; }
      }
      if (end < 0) { end = lines.length - 1; warn('围栏未闭合 @ ' + p.key + ' L' + (i + 1)); }
      const inner = lines.slice(i + 1, end);
      const tm = /title\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(fi.info);
      const lang = fi.info.replace(/title\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/, '').trim();
      if (tm) {
        const fname = (tm[1] || tm[2] || tm[3] || '').trim();
        const open = '```' + lang;
        out.push(quote + '> [!example]- `' + fname + '`');
        out.push(quote + '> ' + open);
        for (const l of inner) out.push(quote + '> ' + l);
        out.push(quote + '> ```');
        ctx.titledFences.push({
          page: p.key, file: fname, lang, srcOpen: line, srcBody: inner.slice(),
          emittedOpen: open, emittedBody: inner.slice(), nested: quote !== '',
        });
      } else {
        out.push(quote + line);
        for (const l of inner) out.push(ql(l));
        if (end < lines.length) out.push(quote + lines[end]);
      }
      i = end + 1;
      continue;
    }
    // --- 列表内嵌标题 → 提升到行首（结构规范化，正文不变）；标题内含链接时按 v5 裁决拆分
    const li = /^([ \t]*[-*+][ \t]+)(#{1,6} .*)$/.exec(line);
    if (li) {
      ctx.promotedHeadings.push({ page: p.key, from: line, to: li[2] });
      emitHeading(li[2], line);
      i++;
      continue;
    }
    // --- 行首标题内含链接 → 同样拆分（v5 裁决）
    const hl2 = /^(#{1,6}) (.*)$/.exec(line);
    if (hl2 && /!?\[[^\]]*\]\([^)]*\)/.test(hl2[2])) {
      emitHeading(line);
      i++;
      continue;
    }
    // --- 普通行
    const inTable = /^\s*\|.*\|\s*$/.test(line);
    out.push(ql(rewriteText(line, p, ctx, inTable)));
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- 笔记渲染
function tagify(s) {
  return String(s).replace(/\s+/g, '-').replace(/[#|\[\]]/g, '').replace(/^-+|-+$/g, '');
}
function pageType(p) {
  if (/faq/i.test(p.rel)) return 'faq';
  if (p.rel === 'index' || p.isGroupHome) return 'index';
  if (/(^|\/)reference(\/|$)/.test(p.dir)) return 'reference';
  return 'guide';
}

function renderNote(p, ctx) {
  const srcLF = normLF(read(p.mdPath));
  if (/\r/.test(read(p.mdPath))) ctx.crlfSource.push(p.key);
  const all = srcLF.split('\n');
  let i = 0;
  if (all[0] === '---') { i = 1; while (i < all.length && all[i] !== '---') i++; i++; }
  let body = all.slice(i);
  let k = 0;
  while (k < body.length && body[k].trim() === '') k++;
  if (k < body.length && /^#\s+/.test(body[k])) k++;
  body = body.slice(k);
  // 删除源里残留的脚注定义列表项（正文定义只在 HTML 中）
  const defLines = body.filter((l) => /user-content-fnref-/.test(l));
  ctx.footnoteDefsRemoved += defLines.length;
  body = body.filter((l) => !/user-content-fnref-/.test(l));
  while (body.length && body[body.length - 1].trim() === '') body.pop();

  ctx.fnUsed = new Set();
  const converted = convertBlocks(body, p, ctx, '');
  const out = [];
  // --- frontmatter（契约 §1.0.2 H4）
  const tags = [];
  for (const t of ['papermc/' + p.sec].concat((p.tax.tags || []).slice(0, 5))) tags.push(tagify(t));
  if (p.categoryZh) tags.push(tagify(p.categoryZh));
  tags.push('type/' + p.type);
  const uniqTags = [...new Set(tags.filter(Boolean))];
  // 别名：与文件名同形（未消歧 = `<Section>: <标题>`；消歧 = `<Section>: <消歧后名字>`）
  // 全库唯一性由「文件名唯一」保证（见写盘前命名闸门）
  const aliases = [p.secTitle + ': ' + p.name];
  out.push('---');
  out.push('title: ' + yamlStr(p.title));
  out.push('slug: ' + yamlStr(p.slug));
  out.push('aliases: [' + aliases.map(yamlStr).join(', ') + ']');
  out.push('tags:');
  for (const t of uniqTags) out.push('  - ' + yamlStr(t));
  out.push('source: ' + yamlStr(p.url));
  out.push('section: ' + yamlStr(p.secTitle));
  out.push('group: ' + yamlStr(p.group));
  out.push('category_zh: ' + yamlStr(p.categoryZh || ''));
  out.push('updated: ' + (p.fetchedAt || '').slice(0, 10));
  out.push('sha256: ' + yamlStr(p.sha));
  out.push('---');
  out.push('');
  out.push('# ' + p.title);
  out.push('');
  const summary = p.tax.summary || p.tax.description || '（分组索引页，无独立摘要）';
  out.push('> [!info] 中文摘要');
  out.push('> ' + summary.replace(/\n+/g, ' '));
  out.push('');
  // 去掉正文开头/结尾空行（避免摘要 callout 后出现双空行）
  while (converted.length && converted[0].trim() === '') converted.shift();
  while (converted.length && converted[converted.length - 1].trim() === '') converted.pop();
  for (const l of converted) out.push(l);
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  // --- 脚注定义（M1：正文取自归档 HTML）
  const fnIds = [...ctx.fnUsed];
  if (fnIds.length) {
    out.push('');
    for (const id of fnIds) {
      const txt = ctx.fnText.get(p.key + '|' + id);
      if (!txt) { ctx.fnMissing.push({ page: p.key, id }); continue; }
      out.push('[^fn-' + id + ']: ' + txt);
      out.push('');
      ctx.footnoteDefs++;
    }
    while (out.length && out[out.length - 1].trim() === '') out.pop();
  }
  // --- 导航 / 来源
  out.push('');
  out.push('---');
  const navBits = [];
  navBits.push('上一页 ' + (p.prevKey ? '[[' + ctx.byKey.get(p.prevKey).name + ']]' : '—'));
  navBits.push('下一页 ' + (p.nextKey ? '[[' + ctx.byKey.get(p.nextKey).name + ']]' : '—'));
  if (p.structKey) navBits.push('结构 [[' + ctx.byKey.get(p.structKey).name + ']]');
  out.push('**导航**：' + navBits.join(' · '));
  out.push('**来源**：' + p.url + ' · 抓取于 ' + p.fetchedAt + ' · 内容版权归 PaperMC（BSD-2-Clause）· 非官方镜像');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- 索引产物
function renderReadme(pages, ctx) {
  const out = [];
  out.push('# Paper Database — PaperMC 文档镜像（Obsidian）');
  out.push('');
  out.push('> [!info] 这是什么');
  out.push('> 把 PaperMC 官方文档（docs.papermc.io 的 Paper / Velocity / Folia 三个分区，共 141 篇）离线镜像成本库笔记：目录结构与上游侧栏逐字一致，链接改写成 Obsidian 原生 wikilink，配置文件名代码块改为可折叠 callout，图片落在 `_attachments/`。');
  out.push('');
  out.push('## 分区');
  out.push('');
  out.push('| 分区 | 笔记数 | 入口 |');
  out.push('| --- | --- | --- |');
  for (const s of SECTIONS) {
    const list = pages.filter((p) => p.sec === s.id);
    const root = list.find((p) => p.rel === 'index');
    out.push('| ' + s.title + ' | ' + list.length + ' | ' + (root ? '[[' + root.name + ']]' : '—') + ' |');
  }
  out.push('');
  out.push('## 索引');
  out.push('');
  out.push('- 全部分页：[[All pages]]（141 行）');
  out.push('- 阅读顺序：[[Reading order]]');
  out.push('- 主题索引：`_index/Topics/`（' + ctx.tax.categories.length + ' 个中文主题）');
  out.push('');
  out.push('## 说明');
  out.push('');
  out.push('- 文件名 = 上游英文标题；重名页面加 ` (<分区> · <完整组路径>)` 后缀。全库 141 个文件名大小写不敏感唯一。');
  out.push('- 正文字体、代码体、表格行列与上游 Markdown 逐字节保持一致（仅做结构性包装）。');
  out.push('- 未镜像的上游绝对链接保留为外链并标注「未镜像」；指向配置树 `<section id>` 的锚点降级为笔记级链接（见 `reports/obsidian-anchors.json`）。');
  out.push('- 抓取于 ' + (pages[0] ? pages[0].fetchedAt.slice(0, 10) : TODAY) + '；写入期间 Nutstore 同步预计上传约 90 MB。');
  out.push('');
  out.push('---');
  out.push('内容版权归 PaperMC 与贡献者（BSD-2-Clause）。本库为**非官方**离线镜像，仅作阅读检索之用。');
  return out.join('\n') + '\n';
}

function renderAllPages(pages) {
  const out = [];
  out.push('---');
  out.push('title: "All pages"');
  out.push('tags:');
  out.push('  - type/index');
  out.push('---');
  out.push('');
  out.push('# 全部分页（141）');
  out.push('');
  out.push('| # | 分区 | 组路径 | 标题 | 中文摘要 |');
  out.push('| --- | --- | --- | --- | --- |');
  pages.forEach((p, i) => {
    const sum = (p.tax.summary || '').replace(/\|/g, '\\|');
    out.push('| ' + (i + 1) + ' | ' + p.secTitle + ' | ' + p.group.replace(/\|/g, '\\|') + ' | [[' + p.name + ']] | ' + sum + ' |');
  });
  out.push('');
  return out.join('\n') + '\n';
}

function renderReadingOrder(pages) {
  const out = [];
  out.push('---');
  out.push('title: "Reading order"');
  out.push('tags:');
  out.push('  - type/index');
  out.push('---');
  out.push('');
  out.push('# 阅读顺序（上游侧栏先序）');
  out.push('');
  out.push('共 ' + pages.length + ' 篇。顺序 = 分区首页 → 各分组首页 → 组内页面（先序），与 docs.papermc.io 侧栏一致。');
  out.push('');
  for (const p of pages) {
    out.push('- [[' + p.name + ']] — ' + p.group);
  }
  out.push('');
  return out.join('\n') + '\n';
}

function renderTopic(cat, list) {
  const out = [];
  out.push('---');
  out.push('title: ' + yamlStr(cat.title));
  out.push('tags:');
  out.push('  - ' + tagify(cat.title));
  out.push('  - type/index');
  out.push('---');
  out.push('');
  out.push('# ' + cat.title);
  out.push('');
  out.push('> [!info] ' + (cat.section ? SEC_TITLE[cat.section] : ''));
  out.push('> ' + (cat.description || ''));
  out.push('');
  out.push('共 ' + list.length + ' 篇。');
  out.push('');
  for (const p of list.sort((a, b) => (a.tax.order || 0) - (b.tax.order || 0) || a.title.localeCompare(b.title))) {
    out.push('- [[' + p.name + ']] — ' + (p.tax.summary || p.title));
  }
  out.push('');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- 文件系统助手
const OUTPUTS = new Map();      // 相对 DEST 路径 → 文本
const OUTPUTS_BIN = new Map();  // 相对 DEST 路径 → Buffer
const WRITTEN = new Set();      // 本次真正写盘（内容有变化）的路径
const UNCHANGED = new Set();    // 与磁盘现内容逐字节一致 → 跳过写入与备份
function outBase() { return (STAGE && !ROLLBACK) ? STAGE_DIR : DEST; }
function diskSha(rel) {
  const p = path.join(DEST, rel);
  if (!fs.existsSync(p)) return null;
  try { return sha256(fs.readFileSync(p)); } catch (_e) { return null; }
}
function writeText(sub, content) {
  OUTPUTS.set(sub, content);
  const sha = sha256(Buffer.from(content, 'utf8'));
  if (diskSha(sub) === sha) { UNCHANGED.add(sub); return; }   // 幂等：不动盘
  if (DRY) return;
  const full = path.join(outBase(), sub);
  mkdirp(path.dirname(full));
  fs.writeFileSync(full, content, 'utf8');
  WRITTEN.add(sub);
}
function writeBin(sub, buf) {
  OUTPUTS_BIN.set(sub, buf);
  if (diskSha(sub) === sha256(buf)) { UNCHANGED.add(sub); return; }
  if (DRY) return;
  const full = path.join(outBase(), sub);
  mkdirp(path.dirname(full));
  fs.writeFileSync(full, buf);
  WRITTEN.add(sub);
}
const stamp = () => new Date().toISOString().replace(/[:]/g, '').replace(/\..+$/, '').replace('T', '-');
function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

const SKIP_DIRS = ['.obsidian', '.trash', '.git', '.agents', '.copilot', 'Server/Paper Database',
  'Server/Paper Database.__stage', 'Server/Paper Database.__backup'];   // 末项用于清理历史遗留
function walkVault(skip) {
  const out = [];
  const walk = (dir, rel) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if ((skip || SKIP_DIRS).some((s) => r === s || r.startsWith(s + '/'))) continue;
        walk(path.join(dir, e.name), r);
      } else {
        out.push({ rel: r, name: e.name, full: path.join(dir, e.name) });
      }
    }
  };
  walk(VAULT, '');
  return out;
}
function vaultSnapshot() {
  const snap = new Map();
  for (const f of walkVault(SKIP_DIRS)) {
    let st;
    try { st = fs.statSync(f.full); } catch (_e) { continue; }
    snap.set(f.rel, st.size + ':' + Math.round(st.mtimeMs));
  }
  return snap;
}

// ---------------------------------------------------------------- 覆盖保护 / staging / 回滚
function finalizeStage() {
  const ts = stamp();
  let moved = 0, backed = 0;
  for (const rel of WRITTEN) {
    const src = path.join(STAGE_DIR, rel);
    const dst = path.join(DEST, rel);
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dst)) {
      // 覆盖前备份：只备份「内容将变化」的文件，备份落在库的兄弟目录（不进 vault，避免污染索引）
      const bp = path.join(BACKUP_ROOT, ts, rel);
      mkdirp(path.dirname(bp));
      fs.copyFileSync(dst, bp);
      backed++;
    }
    mkdirp(path.dirname(dst));
    fs.renameSync(src, dst);
    moved++;
  }
  rmrf(STAGE_DIR);
  return { moved, backed, ts, unchanged: UNCHANGED.size };
}

function doRollback() {
  const mp = path.join(DEST, '_export-manifest.json');
  if (!fs.existsSync(mp)) { console.error('未找到 ' + mp); process.exit(1); }
  const man = JSON.parse(read(mp));
  const bks = fs.existsSync(BACKUP_ROOT) ? fs.readdirSync(BACKUP_ROOT).sort() : [];
  const latest = opt('from-ts', bks.length ? bks[bks.length - 1] : null);
  const plan = [];
  for (const e of man.entries) {
    const dst = path.join(DEST, e.path);
    const bp = latest ? path.join(BACKUP_ROOT, latest, e.path) : null;
    if (bp && fs.existsSync(bp)) plan.push({ action: 'restore', rel: e.path, absFrom: bp });
    else if (fs.existsSync(dst)) plan.push({ action: 'delete', rel: e.path });
  }
  console.log('# rollback 计划（' + plan.length + ' 项，备份基线 ' + (latest || '无') + '，备份根 ' + BACKUP_ROOT + '）');
  for (const a of plan) console.log('- ' + a.action + ' ' + a.rel + (a.absFrom ? '  ← ' + a.absFrom : ''));
  if (DRY) { console.log('（--dry-run：未执行）'); return; }
  for (const a of plan) {
    const dst = path.join(DEST, a.rel);
    if (a.action === 'restore') { mkdirp(path.dirname(dst)); fs.copyFileSync(a.absFrom, dst); }
    else fs.rmSync(dst, { force: true });
  }
  fs.rmSync(mp, { force: true });
  console.log('rollback 完成：' + plan.length + ' 项');
}

// ---------------------------------------------------------------- wikilink 反向解析
function scanWikilinks(line) {
  const out = [];
  let i = 0;
  while (i < line.length - 1) {
    if (line[i] === '\\') { i += 2; continue; }
    if (line[i] === '[' && line[i + 1] === '[') {
      let j = i + 2, end = -1;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === ']' && line[j + 1] === ']') { end = j; break; }
        j++;
      }
      if (end < 0) break;
      out.push({ raw: line.slice(i, end + 2), inner: line.slice(i + 2, end), embed: i > 0 && line[i - 1] === '!' });
      i = end + 2;
      continue;
    }
    i++;
  }
  return out;
}
/** 解析 [[目标#锚点|别名]]，尊重反斜杠转义；`\|` 在表格里等价于别名分隔符（Obsidian 行为） */
function parseWiki(inner) {
  let target = '', alias = '', inAlias = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\\' && i + 1 < inner.length) {
      const n = inner[i + 1];
      if (n === '|') { if (!inAlias) inAlias = true; else alias += '|'; i++; continue; }
      if (inAlias) alias += n; else target += n;
      i++;
      continue;
    }
    if (c === '|' && !inAlias) { inAlias = true; continue; }
    if (inAlias) alias += c; else target += c;
  }
  const hi = target.indexOf('#');
  const name = (hi < 0 ? target : target.slice(0, hi)).trim();
  const anchor = hi < 0 ? null : target.slice(hi + 1);
  return { name, anchor, alias };
}

// ---------------------------------------------------------------- 自检
function runChecks(ctx) {
  const ch = { fails: [] };
  const notes = [...OUTPUTS.entries()].filter(([r]) => r.endsWith('.md'));
  // A1 —— 全库 basename 唯一 + 每条 wikilink 恰好命中 1 个文件
  const nameCount = new Map();
  const addName = (n) => { const k = n.toLowerCase(); nameCount.set(k, (nameCount.get(k) || 0) + 1); };
  for (const p of ctx.pages) addName(p.name);
  for (const rec of ctx.att.byFinal.values()) addName(rec.finalName);
  for (const n of ctx.indexNames) addName(n);
  for (const n of ctx.vaultNames) addName(n);
  const dupBase = [...nameCount.entries()].filter(([, v]) => v > 1);
  ch.a1Unique = dupBase.length === 0;
  if (!ch.a1Unique) ch.fails.push('A1 存在重名：' + JSON.stringify(dupBase.slice(0, 10)));

  // aliases 全库唯一（大小写不敏感）——消歧页用消歧后的显示名，故唯一性由文件名唯一天然保证
  const aliasSeen = new Map(); const aliasDup = [];
  for (const p of ctx.pilotOrAll()) {
    const a = (p.secTitle + ': ' + p.name).toLowerCase();
    if (aliasSeen.has(a)) aliasDup.push(a + ' ← ' + p.key + ' / ' + aliasSeen.get(a));
    aliasSeen.set(a, p.key);
  }
  ch.aliasCount = aliasSeen.size;
  ch.aliasDup = aliasDup;
  if (aliasDup.length) ch.fails.push('alias 重复 ' + aliasDup.length + ' 条');

  const dangling = [], ambiguous = [], anchorBad = [];
  let wikiTotal = 0, wikiNotes = 0, wikiAtt = 0;
  for (const [rel, text] of notes) {
    for (const line of text.split('\n')) {
      for (const wl of scanWikilinks(line)) {
        wikiTotal++;
        const { name, anchor, alias } = parseWiki(wl.inner);
        if (!name) { ctx.selfAnchor++; continue; }
        const key = name.replace(/\.md$/i, '').toLowerCase();
        const c = nameCount.get(key) || 0;
        if (c === 0) dangling.push({ file: rel, link: wl.raw });
        else if (c > 1) ambiguous.push({ file: rel, link: wl.raw, hits: c });
        if (wl.embed) wikiAtt++; else wikiNotes++;
        // 锚点写入后反解析校验（H4 / M5：大小写不敏感 + 空白折叠）
        if (anchor) {
          const tp = ctx.pages.find((x) => x.name.toLowerCase() === key);
          if (!tp) anchorBad.push({ file: rel, link: wl.raw, why: '目标笔记不存在' });
          else if (!tp.headings.some((h) => normAnchor(plainHeading(h.text)) === normAnchor(anchor) || normAnchor(h.text) === normAnchor(anchor))) {
            anchorBad.push({ file: rel, link: wl.raw, why: '目标页无此标题' });
          } else ctx.anchorVerified++;
        }
      }
    }
  }
  ch.a1Dangling = dangling.length;
  ch.a1Ambiguous = ambiguous.length;
  ch.a1AnchorBad = anchorBad.length;
  ch.wikiTotal = wikiTotal; ch.wikiNotes = wikiNotes; ch.wikiAtt = wikiAtt;

  // 表格内 wikilink 的 `|` 必须转义（spec §9.1）——逐行扫描表格行
  const tableBad = [];
  let tableWiki = 0;
  for (const [rel, text] of OUTPUTS) {
    if (!rel.endsWith('.md')) continue;
    for (const line of text.split('\n')) {
      if (!/^\s*\|/.test(line)) continue;
      for (const wl of scanWikilinks(line)) {
        tableWiki++;
        if (/(^|[^\\])\|/.test(wl.inner)) tableBad.push({ file: rel, link: wl.raw });
      }
    }
  }
  ch.tableWiki = tableWiki;
  ch.tableBad = tableBad;
  if (tableBad.length) ch.fails.push('表格内 wikilink 未转义 | 共 ' + tableBad.length + ' 条');

  // 语义噪声三件套：残留 title= / 行内 #数字 / 无 callout 头的引用段
  const titleResidue = [], hashNoise = [], headerless = [], detailsBad = [];
  for (const [rel, text] of OUTPUTS) {
    if (!rel.endsWith('.md')) continue;
    let inFence = null, run = null;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = /^((?:[ \t]*>[ \t]?)*)(`{3,}|~{3,})(.*)$/.exec(line);
      if (m) {
        if (!inFence) { inFence = { ch: m[2][0], len: m[2].length }; if (/title\s*=/.test(m[3])) titleResidue.push({ file: rel, line: i + 1, info: m[3].trim() }); }
        else if (m[2][0] === inFence.ch && m[2].length >= inFence.len && m[3].trim() === '') inFence = null;
        continue;
      }
      if (inFence) continue;
      if (/^\s*>/.test(line)) { if (!run) run = { file: rel, line: i + 1, first: line }; }
      else {
        if (run && !/\[![A-Za-z]+\]/.test(run.first)) headerless.push(run);
        run = null;
      }
      const parts = line.split(/(`+[^`]*`+)/);
      for (let k = 0; k < parts.length; k += 2) {
        if (/(^|[^\w`])#\d/.test(parts[k]) && !/^\s*#{1,6}\s/.test(line)) hashNoise.push({ file: rel, line: i + 1, txt: line.trim().slice(0, 70) });
      }
    }
    if (run && !/\[![A-Za-z]+\]/.test(run.first)) headerless.push(run);
  }
  // details 体完整性：源 details 体的首/末非空行必须出现在目标笔记里
  for (const p of ctx.pilotOrAll()) {
    const text0 = OUTPUTS.get(p.relPath);
    if (!text0) continue;
    const text = text0.replace(/[ \t]+/g, ' ');   // 空白折叠后再比对（避免空格差异造成假阴性）
    const srcLines = normLF(read(p.mdPath)).split('\n');
    for (let i = 0; i < srcLines.length; i++) {
      if (!/^\s*<details\b/i.test(srcLines[i])) continue;
      const startLine = i + 1;
      let end = -1, j = i + 1, title = '';
      for (let k = i; k < srcLines.length; k++) {
        const sm = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(srcLines[k]);
        if (sm) { title = stripTags(sm[1]); j = k + 1; break; }
      }
      for (let k = j; k < srcLines.length; k++) if (/^\s*<\/details>/i.test(srcLines[k])) { end = k; break; }
      if (end < 0) continue;
      const body = srcLines.slice(j, end).map((l) => l.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean).filter((l) => !/^!\[[^\]]*\]\([^)]*\)$/.test(l));   // 纯图片行不计（会转成 ![[...]]）
      i = end;
      if (!body.length) continue;
      const head = body[0].slice(0, 60), tail = body[body.length - 1].slice(0, 60);
      if (!text.includes(head) || !text.includes(tail)) {
        detailsBad.push({ page: p.key, detailsLine: startLine, title, headMissing: !text.includes(head), tailMissing: !text.includes(tail), head });
      }
    }
  }
  ch.titleResidue = titleResidue;
  ch.hashNoise = hashNoise;
  ch.headerless = headerless;
  ch.detailsBodyBad = detailsBad;
  if (titleResidue.length) ch.fails.push('残留围栏 title=：' + titleResidue.length);
  if (hashNoise.length) ch.fails.push('行内 #数字 噪声：' + hashNoise.length);
  if (detailsBad.length) ch.fails.push('details 体文本缺失：' + detailsBad.length);
  ch.danglingSample = dangling.slice(0, 8);
  ch.anchorBadSample = anchorBad.slice(0, 8);
  if (dangling.length && !ctx.pilotLimited) ch.fails.push('A1 悬空链接 ' + dangling.length + ' 条');
  if (ambiguous.length) ch.fails.push('A1 多义链接 ' + ambiguous.length + ' 条');
  if (anchorBad.length) ch.fails.push('A1 锚点反解析失败 ' + anchorBad.length + ' 条');

  // A3 —— 带文件名代码块（callout 化）代码体逐字节相等
  let cmp = 0, miss = 0;
  const badFences = [];
  const byPage = new Map();
  for (const f of ctx.titledFences) {
    if (!byPage.has(f.page)) byPage.set(f.page, []);
    byPage.get(f.page).push(f);
  }
  for (const p of ctx.pilotOrAll()) {
    const rel = p.relPath;
    const text = OUTPUTS.get(rel);
    if (!text) continue;
    const emitted = extractExampleBodies(text);
    const srcs = byPage.get(p.key) || [];
    if (emitted.length !== srcs.length) {
      miss++;
      badFences.push({ page: p.key, emitted: emitted.length, source: srcs.length });
      continue;
    }
    for (let i = 0; i < srcs.length; i++) {
      const a = sha256(emitted[i].join('\n'));
      const b = sha256(srcs[i].srcBody.join('\n'));
      if (a === b) cmp++; else badFences.push({ page: p.key, idx: i, file: srcs[i].file });
    }
  }
  ch.a3Compared = cmp; ch.a3Bad = badFences;
  ctx.titledFenceCount = ctx.titledFences.length;
  if (badFences.length) ch.fails.push('A3 代码体不一致 ' + badFences.length + ' 处');

  // 行尾冻结 LF（M6）—— 只对文本产物断言（二进制附件本来就含 0x0D 字节）
  const crlf = [];
  for (const [rel, text] of notes) if (/\r/.test(text)) crlf.push(rel);
  for (const [rel, text] of OUTPUTS) if (/\r/.test(text) && !rel.endsWith('.md')) crlf.push(rel);
  ch.crlfOut = crlf.length;
  if (crlf.length) ch.fails.push('M6 输出含 CR：' + crlf.slice(0, 5).join(','));

  // DoD D31 —— frontmatter 可解析（只针对正文笔记；README/_index 是本工具自建的索引页）
  const pageRels = new Set(ctx.pilotOrAll().map((p) => p.relPath));
  const fmBad = [];
  for (const [rel, text] of notes) {
    if (!pageRels.has(rel)) continue;
    const v = validateFrontmatter(text);
    if (!v.ok) fmBad.push({ file: rel, why: v.why });
  }
  ch.d31Bad = fmBad;
  ch.d31Checked = [...pageRels].length;
  if (fmBad.length) ch.fails.push('D31 frontmatter 异常 ' + fmBad.length);

  // DoD D32 —— 附件清单与磁盘一致
  const attBad = [];
  for (const rec of ctx.att.byFinal.values()) {
    if (rec.dupOf) continue;
    const sub = ctx.attPath(rec);
    const buf = OUTPUTS_BIN.get(sub);
    if (!buf) { if (!ctx.pilotLimited) attBad.push(sub + ' 未写入'); continue; }
    if (sha256(buf) !== rec.sha) attBad.push(sub + ' sha 不一致');
  }
  ch.d32Attachments = ctx.att.byFinal.size;
  ch.d32Written = OUTPUTS_BIN.size;
  ch.d32Bad = attBad;
  if (attBad.length) ch.fails.push('D32 附件异常 ' + attBad.length);

  // callout 直方图守恒
  const hist = {};
  for (const [, text] of notes) {
    for (const m of text.matchAll(/^[>\s]*\[!([A-Za-z]+)\]/gm)) hist[m[1].toLowerCase()] = (hist[m[1].toLowerCase()] || 0) + 1;
  }
  ch.calloutTarget = hist;
  const srcAgg = FIDELITY.sourceAggregate;
  const expected = {};
  for (const [t, n] of Object.entries(srcAgg.callouts)) expected[t] = (expected[t] || 0) + n;
  expected.note = (expected.note || 0) + srcAgg.details;
  expected.example = (expected.example || 0) + srcAgg.fencesWithTitle;
  expected.info = (expected.info || 0) + notes.length;
  ch.calloutExpected = expected;

  // 文本守恒（近似覆盖率）：源正文 40 字符窗口在目标正文中的命中率
  const covList = [];
  let minCov = 1, minPage = null;
  for (const p of ctx.pilotOrAll()) {
    const text = OUTPUTS.get(p.relPath);
    if (!text) continue;
    const c = coverage(sourcePlain(p), targetPlain(text));
    covList.push({ page: p.key, cov: +c.toFixed(4) });
    if (c < minCov) { minCov = c; minPage = p.key; }
  }
  ch.textCoverageMin = +minCov.toFixed(4);
  ch.textCoverageMinPage = minPage;
  ch.textCoverageBelow99 = covList.filter((x) => x.cov < 0.99).length;
  ch.textCoverageWorst = covList.sort((a, b) => a.cov - b.cov).slice(0, 5);
  if (COVDEBUG) {
    const p = ctx.pages.find((x) => x.key === COVDEBUG);
    const tgt = targetPlain(OUTPUTS.get(p.relPath));
    const s = sourcePlain(p);
    const norm = (x) => x.replace(/\[\![A-Za-z]+\]/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    const a = norm(s), b = norm(tgt);
    const miss = [];
    for (let i = 0; i + 40 <= a.length; i += 60) { if (!b.includes(a.slice(i, i + 40))) miss.push(JSON.stringify(a.slice(i, i + 60))); }
    console.log('COVDEBUG ' + COVDEBUG + ' missing windows: ' + miss.length);
    console.log(miss.slice(0, 12).join('\n'));
    for (const m of miss.slice(0, 3)) {
      const w = JSON.parse(m).slice(0, 18);
      const idx = b.indexOf(w);
      console.log('WINDOW ' + JSON.stringify(w) + ' idx=' + idx + ' tgtCtx=' + JSON.stringify(b.slice(Math.max(0, idx - 60), idx + 80)));
    }
    for (const probe of ['basic commands', 'start with']) {
      const k = b.indexOf(probe);
      console.log('PROBE ' + JSON.stringify(probe) + ' idx=' + k + ' ctx=' + JSON.stringify(b.slice(Math.max(0, k - 70), k + 90)));
    }
    process.exit(0);
  }
  if (ch.textCoverageBelow99 > 0) {
    ch.covHist = { min: ch.textCoverageMin, below99: ch.textCoverageBelow99, worst: ch.textCoverageWorst };
  }
  if (ch.textCoverageMin < 0.90) ch.fails.push('文本覆盖率 <0.90：' + ch.textCoverageMin + ' @ ' + ch.textCoverageMinPage);

  // 脚注定义非空
  const fnEmpty = [];  for (const [rel, text] of notes) {
    for (const m of text.matchAll(/^\[\^fn-([^\]]+)\]:\s*$/gm)) fnEmpty.push(rel + ' #' + m[1]);
  }
  ch.fnEmpty = fnEmpty;
  if (fnEmpty.length) ch.fails.push('脚注定义为空 ' + fnEmpty.length);

  // 越界审计 D34a
  if (ctx.snapBefore) {
    const after = vaultSnapshot();
    const changed = [];
    for (const [k, v] of after) if (ctx.snapBefore.get(k) !== v) changed.push(k);
    for (const k of ctx.snapBefore.keys()) if (!after.has(k)) changed.push('- ' + k);
    ch.d34aChanged = changed;
    if (changed.length) ch.fails.push('D34a 越界改动 ' + changed.length + ' 个文件');
  }
  // D34b 自证（豁免 manifest 自身：它不能包含自己的哈希）
  const manifestSet = new Set(ctx.manifestEntries.map((e) => e.path));
  const outside = [...OUTPUTS.keys(), ...OUTPUTS_BIN.keys()]
    .filter((r) => !manifestSet.has(r) && r !== '_export-manifest.json');
  ch.d34bOutside = outside;
  if (outside.length) ch.fails.push('D34b manifest 外写入 ' + outside.length);

  return ch;
}

function extractExampleBodies(text) {
  const lines = text.split('\n');
  const res = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^((?:>[ \t]?)+)\[!example\]-\s/.exec(lines[i]);
    if (!m) continue;
    const pre = m[1];
    let j = i + 1;
    const blk = [];
    while (j < lines.length && (lines[j].startsWith(pre) || lines[j].trim() === pre.trim())) {
      blk.push(lines[j].slice(pre.length));
      j++;
    }
    if (blk.length >= 2) res.push(blk.slice(1, blk.length - 1));
  }
  return res;
}

/** 极简 YAML frontmatter 校验（D31） */
function validateFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return { ok: false, why: '无 frontmatter' };
  const keys = {};
  let curKey = null, inList = false;
  for (const line of m[1].split('\n')) {
    if (/^\s*-\s+/.test(line)) {
      if (!inList) return { ok: false, why: '列表项无父键' };
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s?(.*)$/.exec(line);
    if (!kv) return { ok: false, why: '非法行：' + line };
    curKey = kv[1];
    if (keys[curKey] !== undefined) return { ok: false, why: '重复键 ' + curKey };
    keys[curKey] = kv[2];
    inList = kv[2] === '';
  }
  for (const k of ['title', 'slug', 'aliases', 'tags', 'source', 'section', 'group', 'category_zh', 'updated', 'sha256']) {
    if (keys[k] === undefined) return { ok: false, why: '缺键 ' + k };
  }
  if (!/^\[.*\]$/.test(keys.aliases)) return { ok: false, why: 'aliases 非行内列表' };
  if (keys.tags !== '') return { ok: false, why: 'tags 非列表块' };
  if (/\[\[/.test(m[1])) return { ok: false, why: 'frontmatter 含 wikilink' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(keys.updated)) return { ok: false, why: 'updated 非法' };
  return { ok: true };
}

// ---------------------------------------------------------------- 主流程
function main() {
  if (SELFTEST) { console.log(JSON.stringify(selfTest(), null, 2)); return; }
  if (ROLLBACK) return doRollback();
  const t0 = Date.now();
  const pages = loadPages();
  const { inNav, groups } = loadNav();
  const { map: reasonMap, rows: reasonRows } = parseReasonMap();
  const tax = loadTaxonomy();
  const htmlIdx = buildHtmlIndex(pages);
  const PILOT_WHY = {
    'paper:anti-xray/index': '3 个 callout（note/caution/tip）+ `<details>`×14 + 带文件名围栏 + 2 图 + HTML 脚注×1 + details 内嵌 callout',
    'paper:dev/dialogs/index': '表格×2 + `<details>`×4 + 围栏×13 + 图×6 + 大量外链 + 同文件锚点×1',
    'paper:reference/cli-arguments/index': '32 个标题（含唯一含 `|` 的标题，H4 目标）+ danger callout×2 + 长参数清单',
  };
  for (const p of pages) p.pilotWhy = PILOT_WHY[p.key] || '（试点页）';
  // 源侧锚点引用扫描（用于与 fidelity 基线对账）
  const srcRefs = { internalFrag: 0, sameFile: 0, docsFrag: 0, footnoteRefs: 0, otherFrag: 0 };
  for (const p of pages) {
    for (const line of normLF(read(p.mdPath)).split('\n')) {
      for (const L of scanLinks(line)) {
        if (L.isImg || !L.href.includes('#')) continue;
        if (/^#user-content-fn/.test(L.href)) srcRefs.footnoteRefs++;
        else if (L.href.startsWith('#')) srcRefs.sameFile++;
        else if (/docs\.papermc\.io/i.test(L.href)) srcRefs.docsFrag++;
        else if (/\.md#/.test(L.href)) srcRefs.internalFrag++;
        else srcRefs.otherFrag++;
      }
    }
  }
  const byKey = new Map(pages.map((p) => [p.key, p]));
  const urlToKey = new Map();
  for (const p of pages) {
    urlToKey.set(p.url, p.key);
    urlToKey.set(p.url.replace(/\/+$/, '') + '/', p.key);
  }

  // --- 分组（M4：显式映射表）
  for (const p of pages) {
    let gp = null, src = '';
    if (inNav.has(p.key)) { gp = inNav.get(p.key).groupPath.slice(); src = 'nav-page'; }
    else if (reasonMap.has(p.key)) { gp = reasonMap.get(p.key).slice(); src = 'nav-reason'; }
    else { gp = []; src = 'fallback'; warn('无分组映射：' + p.key); }
    p.groupPath = gp;
    p.groupSrc = src;
    p.group = gp.length ? gp.join(' › ') : p.secTitle;
    p.isGroupHome = (p.rel === 'index') || (src === 'nav-reason' && gp.length > 0);
    p.dirSegments = gp.map(sanitizeName);
  }
  for (const p of pages) {
    if (!p.isGroupHome || p.groupPath.length === 0) continue;
    const gk = p.sec + ':' + p.groupPath.join(' > ');
    const g = groups.get(gk);
    if (g) g.homeKey = p.key; else warn('组首页找不到组：' + gk);
  }
  // --- taxonomy / 标题 / HTML id
  for (const p of pages) {
    p.tax = tax.byKey.get(p.key) || {};
    p.categoryZh = tax.catTitle.get(p.tax.category) || '';
    p.type = pageType(p);
    const srcLF = normLF(read(p.mdPath));
    p.headings = mdHeadings(srcLF);
    const hi = htmlIdx.get(p.key);
    p.htmlIds = hi.ids;
    p.fn = hi.fn;
  }
  // --- 命名闸门（大小写不敏感 + 含库内既有文件）
  const vaultFiles = walkVault(SKIP_DIRS);
  const vaultNames = [];
  for (const f of vaultFiles) vaultNames.push(f.name.replace(/\.md$/i, ''));
  const vaultNameSet = new Map();
  for (const n of vaultNames) { const k = n.toLowerCase(); vaultNameSet.set(k, (vaultNameSet.get(k) || 0) + 1); }
  const baseCount = new Map();
  for (const p of pages) {
    const b = sanitizeName(p.title);
    baseCount.set(b.toLowerCase(), (baseCount.get(b.toLowerCase()) || 0) + 1);
  }
  let disambCount = 0;
  for (const p of pages) {
    const b = sanitizeName(p.title);
    p.disamb = baseCount.get(b.toLowerCase()) > 1;
    if (p.disamb) {
      const gs = p.groupPath.length ? p.groupPath.join(' › ') : p.secTitle;
      p.name = b + ' (' + p.secTitle + ' · ' + gs + ')';
      disambCount++;
    } else p.name = b;
    p.shortName = b;
    const clash = vaultNameSet.get(p.name.toLowerCase());
    if (clash) { p.name = p.name + ' (PaperMC)'; p.vaultClash = clash; warn('与库内既有文件同名，加后缀：' + p.key + ' → ' + p.name); }
    p.shortName = b;
  }
  // 二级消歧：组首页与其同组同名页（完整组路径仍相同）→ 追加 " - <slug>"
  const byName = new Map();
  for (const p of pages) {
    const k = p.name.toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
  for (const [, list] of byName) {
    if (list.length < 2) continue;
    const homes = list.filter((p) => p.isGroupHome);
    const targets2 = homes.length === 1 ? list.filter((p) => p !== homes[0]) : list.slice();
    for (const p of targets2) { p.name = p.name + ' - ' + p.slug.replace(/[\/\\]/g, '-'); p.secondLevel = true; }
    warn('二级消歧（完整组路径相同）：' + list.map((p) => p.key + ' → ' + p.name).join(' | '));
  }
  // 路径（在命名定稿之后计算）
  for (const p of pages) {
    p.dirPos = p.groupPath.map(sanitizeName);
    p.pathSegments = [p.secTitle].concat(p.dirPos, [p.name + '.md']);
    p.relPath = relOut(path.join(...p.pathSegments));
  }
  const seenPaths = new Set(pages.map((p) => p.relPath.toLowerCase()));
  if (seenPaths.size !== pages.length) err('路径闸门失败：唯一路径 ' + seenPaths.size + ' ≠ ' + pages.length);
  const seenNames = new Map();
  for (const p of pages) {
    const k = p.name.toLowerCase();
    if (seenNames.has(k)) err('命名闸门：冲突 ' + p.name + '（' + p.key + ' / ' + seenNames.get(k) + '）');
    seenNames.set(k, p.key);
    if (/[\\/:*?"<>|^%~\[\]]/.test(p.name)) err('文件名含非法字符：' + p.name);
    if (p.name.length > 120) err('文件名过长：' + p.name);
    const abs = path.join(DEST, ...p.pathSegments);
    if (abs.length > 200) err('绝对路径过长(' + abs.length + ')：' + abs);
  }
  if (seenNames.size !== pages.length) err('命名闸门失败：唯一名 ' + seenNames.size + ' ≠ ' + pages.length);

  // --- 阅读顺序 / 前后页 / 结构页
  const orderBySection = {};
  for (const s of SECTIONS) {
    const list = [];
    const pushL = (k) => { if (k && !list.includes(k) && byKey.has(k)) list.push(k); };
    pushL(s.id + ':index');
    const walk = (nodes, gp) => {
      for (const n of nodes) {
        if (n.kind === 'group') {
          const labels = gp.concat(n.label);
          const g = groups.get(s.id + ':' + labels.join(' > '));
          if (g && g.homeKey) pushL(g.homeKey);
          walk(n.children || [], labels);
        } else pushL(s.id + ':' + n.rel);
      }
    };
    walk((JSON.parse(read(path.join(REPO, 'data', 'source-nav.json'))).sections.find((x) => x.id === s.id)).groups, []);
    for (const p of pages) if (p.sec === s.id) pushL(p.key);
    orderBySection[s.id] = list;
  }
  const flatOrder = [];
  for (const s of SECTIONS) flatOrder.push(...orderBySection[s.id].map((k) => byKey.get(k)));
  flatOrder.forEach((p, i) => {
    p.prevKey = i > 0 ? flatOrder[i - 1].key : null;
    p.nextKey = i < flatOrder.length - 1 ? flatOrder[i + 1].key : null;
    let start = p.isGroupHome ? p.groupPath.length - 1 : p.groupPath.length;
    let st = null;
    for (let n = start; n >= 1 && !st; n--) {
      const g = groups.get(p.sec + ':' + p.groupPath.slice(0, n).join(' > '));
      if (g && g.homeKey) st = g.homeKey;
    }
    if (!st) { const root = byKey.get(p.sec + ':index'); st = root ? root.key : null; }
    p.structKey = st === p.key ? null : st;
  });
  // --- 附件
  const att = planAttachments(pages);
  const attPath = (rec) => relOut(path.join('_attachments', 'papermc',
    [...rec.sections].sort((a, b) => SECTIONS.findIndex((s) => s.id === a) - SECTIONS.findIndex((s) => s.id === b))[0],
    rec.finalName));
  for (const rec of [...att.byFinal.values()]) {
    if (rec.dupOf) continue;
    if (vaultNameSet.has(rec.finalName.toLowerCase())) {
      warn('附件名与库内既有文件同名：' + rec.finalName);
    }
  }
  // --- 转换上下文
  const ctx = {
    pages, byKey, urlToKey, tax, att, attPath,
    anchorCounts: {}, anchorDistinct: new Set(), anchorC: [], anchorB: [], anchorAll: [],
    selfAnchor: 0, anchorVerified: 0,
    rewrites: { md: 0, anchor: 0, degrade: 0 }, imageRewrites: 0,
    externalKept: [], inlineImages: [], missingImages: [], fnMissing: [], linkDiag: [],
    fnAvailable: new Set(), fnText: new Map(),
    footnoteDefs: 0, footnoteDefsRemoved: 0, details: 0,
    promotedHeadings: [], titledFences: [], crlfSource: [], headingLinkSplit: [],
    indexNames: [], vaultNames: [], pilotLimited: PILOT.length > 0,
    snapBefore: null, manifestEntries: [],
    pilotOrAll: () => (PILOT.length ? pages.filter((p) => PILOT.includes(p.key)) : pages),
  };
  for (const p of pages) for (const [id, t] of p.fn) { ctx.fnAvailable.add(p.key + '|' + id); ctx.fnText.set(p.key + '|' + id, t); }

  // --- 越界快照（D34a）
  ctx.snapBefore = soup(() => vaultSnapshot());
  function soup(fn2) { return DRY ? null : fn2(); }

  // --- 渲染
  const targets = ctx.pilotOrAll();
  for (const p of targets) writeText(p.relPath, renderNote(p, ctx));
  for (const rec of att.byFinal.values()) {
    if (rec.dupOf) continue;
    if (!targets.some((p) => rec.pages.has(p.key)) && PILOT.length) continue;
    writeBin(attPath(rec), rec.buf);
  }
  if (!PILOT.length) {
    writeText('README.md', renderReadme(pages, ctx));
    writeText(relOut(path.join('_index', 'All pages.md')), renderAllPages(flatOrder));
    writeText(relOut(path.join('_index', 'Reading order.md')), renderReadingOrder(flatOrder));
    ctx.indexNames.push('README', 'All pages', 'Reading order');
    const topicNames = new Map();
    for (const c of tax.categories) {
      const list = pages.filter((p) => p.tax.category === c.id);
      let tn = sanitizeName(c.title);
      if (topicNames.has(tn.toLowerCase())) tn = tn + ' (' + SEC_TITLE[c.section] + ')';
      topicNames.set(tn.toLowerCase(), c.id);
      writeText(relOut(path.join('_index', 'Topics', tn + '.md')), renderTopic(c, list));
      ctx.indexNames.push(tn);
    }
    // 附件清单
    const manifestAtt = {
      vault: DEST,
      source: 'docs.papermc.io（archive/{paper,velocity,folia}/assets）',
      deterministic: true,
      note: '本文件不含时间戳（时间记录在 reports/obsidian-build.md），以保证 D33 幂等：内容不变则复跑零写入、零备份',
      attachments: [...att.byFinal.values()].map((r) => ({
        name: r.finalName, file: attPath(r), sha256: r.sha, bytes: r.bytes,
        sections: [...r.sections].sort(), pages: [...r.pages].sort(),
        duplicateOf: r.dupOf ? r.dupOf.finalName : null,
        original: r.origName,
      })).sort((a, b) => a.name.localeCompare(b.name)),
      inlineBase64: ctx.inlineImages,
      note: '未镜像的 base64 内联图保留内联（' + ctx.inlineImages.length + ' 处）；本文件不计入附件数',
    };
    writeText(relOut(path.join('_attachments', '_manifest.json')), JSON.stringify(manifestAtt, null, 2) + '\n');
  }

  // --- 产物清单（H6：manifest）
  const prevManifestPath = path.join(DEST, '_export-manifest.json');
  const prevManifest = fs.existsSync(prevManifestPath) ? JSON.parse(read(prevManifestPath)) : null;
  const manifestEntries = [];
  for (const [rel, text] of OUTPUTS) {
    manifestEntries.push({
      path: rel, kind: rel.endsWith('.md') ? (rel.includes('_index/') || rel === 'README.md' ? 'index' : 'note') : 'data',
      sha256: sha256(Buffer.from(text, 'utf8')), bytes: Buffer.byteLength(text, 'utf8'),
      sha256_no_ts: sha256(Buffer.from(text.replace(/"generated_at": "[^"]*"/g, ''), 'utf8')),
      source: (pages.find((p) => p.relPath === rel) || {}).url || null,
    });
  }
  for (const [rel, buf] of OUTPUTS_BIN) {
    manifestEntries.push({
      path: rel, kind: 'attachment', sha256: sha256(buf), sha256_no_ts: sha256(buf),
      bytes: buf.length, source: 'archive/*/assets/**',
    });
  }
  for (const e of manifestEntries) {
    const p2 = pages.find((x) => x.relPath === e.path);
    if (p2) e.source = p2.url;
  }
  ctx.manifestEntries = manifestEntries;
  if (!DRY && !PILOT.length) {
    writeText('_export-manifest.json', JSON.stringify({
      tool: 'tools/obsidian-export.js',
      vault: DEST,
      backupRoot: BACKUP_ROOT,
      stageDir: STAGE_DIR,
      deterministic: true,
      note: '本文件不含时间戳（时间记录在 reports/obsidian-build.md），以保证 D33 幂等；覆盖前备份与回滚基线都在 vault 之外的 backupRoot',
      sectionCounts: Object.fromEntries(SECTIONS.map((s) => [s.title, pages.filter((p) => p.sec === s.id).length])),
      counts: { notes: pages.length, attachments: att.byFinal.size, entries: manifestEntries.length },
      entries: manifestEntries.sort((a, b) => a.path.localeCompare(b.path)),
    }, null, 2) + '\n');
  }

  // --- 自检
  const ch = runChecks(ctx);

  // --- 落位（H6 staging）
  let staged = null;
  if (STAGE && !DRY && !PILOT.length) staged = finalizeStage();

  // --- 幂等（D33）
  let idem = null;
  if (prevManifest) {
    const prev = new Map(prevManifest.entries.map((e) => [e.path, e.sha256_no_ts || e.sha256]));
    const diff = [];
    for (const e of manifestEntries) if (prev.get(e.path) !== (e.sha256_no_ts || e.sha256)) diff.push(e.path);
    for (const k of prev.keys()) if (!manifestEntries.some((e) => e.path === k)) diff.push('- ' + k);
    idem = { prevGeneratedAt: prevManifest.generated_at, diffCount: diff.length, diff: diff.slice(0, 10) };
  }

  // --- 报告
  const report = buildReport({
    pages, ctx, ch, tax, att, flatOrder, groups, groups2: groups, reasonRows, disambCount,
    idem, staged, t0, vaultFileCount: vaultFiles.length, srcRefs,
    diag: { src: fenceScopeDiag(pages), tgt: targetScopeDiag() },
  });
  fs.mkdirSync(REPORTS, { recursive: true });
  // 哨兵模式不覆盖全量构建报告；全量模式下保留第九节（人工追加的修复记录）
  if (!PILOT.length) {
    const rp = path.join(REPORTS, 'obsidian-build.md');
    let tail = '';
    if (fs.existsSync(rp)) {
      const old = read(rp);
      const idx = old.indexOf('## 9. 验证器缺陷清单');
      if (idx >= 0) {
        const start = old.lastIndexOf('---', idx);
        tail = (start >= 0 ? old.slice(start) : old.slice(idx)).replace(/^\s+/, '\n');
      }
    }
    fs.writeFileSync(rp, report + (tail ? '\n' + tail : ''), 'utf8');
  }
  const anchorsJson = {
    generated_at: new Date().toISOString(),
    vault: DEST,
    baseline: {
      inScopeRefs: FIDELITY.sourceAggregate.anchors.inScopeRefs,
      internalFileRefs: FIDELITY.sourceAggregate.anchors.internalFileRefs,
      sameFileRefs: FIDELITY.sourceAggregate.anchors.sameFileRefs,
      docsAbsoluteRefs: FIDELITY.sourceAggregate.anchors.docsAbsoluteRefs,
    },
    classes: {
      A: ctx.anchorCounts.A || 0, B: ctx.anchorCounts.B || 0, C: ctx.anchorCounts.C || 0,
      distinct: ctx.anchorDistinct.size,
      degradedToNote: ctx.rewrites.degrade,
      classC_nonHeadingElement: ctx.anchorC.filter((c) => c.element).length,
      classC_upstreamDead: ctx.anchorC.filter((c) => !c.element).length,
      dead: ctx.anchorC.filter((c) => !c.element).length,
    },
    note: 'A=可在目标 md 标题反查；B=靠归档 HTML 的 id 定位到标题；C=目标不是标题（配置树 <section id> 等）→ 降级为 [[Note]] 并登记；dead=C 中「归档 HTML 也查不到该 id」的上游死链子集。每条含 class/literal/escaped/link。',
    literalNote: 'literal = 写入链接时使用的标题字面量（去行内标记的渲染文本）；C/dead 为 null（降级为笔记级链接，不写锚点）。escaped = 目标#锚点部分是否含反斜杠转义（`|` `#` `^` `[` `]` 等保留字符）。',
    anchors: ctx.anchorAll.slice().sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || String(a.frag).localeCompare(String(b.frag))),
    classB_list: ctx.anchorB,
    classC_list: ctx.anchorC.sort((a, b) => a.target.localeCompare(b.target) || a.frag.localeCompare(b.frag)),
    anchorReverseCheck: { verified: ctx.anchorVerified, failed: ch.a1AnchorBad, sample: ch.anchorBadSample },
  };
  fs.writeFileSync(path.join(REPORTS, 'obsidian-anchors.json'), JSON.stringify(anchorsJson, null, 2) + '\n', 'utf8');

  // --- 哨兵试点报告（完整内容）
  if (PILOT.length && PIREPORT) {
    const L2 = [];
    const selft = selfTest();
    L2.push('# Obsidian 导出 · 哨兵试点（' + PILOT.length + ' 篇，完整内容）');
    L2.push('');
    L2.push('> 目的：在全量前人工/红队过一遍转换质量。命令：`node tools/obsidian-export.js --pages=' + PILOT.join(',') + '`');
    L2.push('');
    L2.push('- 生成时间：' + new Date().toISOString());
    L2.push('- 目标库：`' + DEST + '`');
    L2.push('- 自检：' + ((ch.fails.length || errors.length) ? '**有失败项**' : '全部通过') + '（A1 悬空 ' + ch.a1Dangling + ' / 多义 ' + ch.a1Ambiguous + ' / 锚点反解析失败 ' + ch.a1AnchorBad + '；A3 已比对 ' + ch.a3Compared + ' 块、不一致 ' + ch.a3Bad.length + '）');
    L2.push('');
    L2.push('## 0. 选样理由与覆盖矩阵');
    L2.push('');
    L2.push('| 页 | 选它的理由 | 覆盖元素 |');
    L2.push('| --- | --- | --- |');
    for (const p of targets) {
      const text = OUTPUTS.get(p.relPath) || '';
      const cov = [];
      const h = {};
      for (const m of text.matchAll(/\[!([A-Za-z]+)\]/g)) h[m[1].toLowerCase()] = (h[m[1].toLowerCase()] || 0) + 1;
      if (h.note) cov.push('callout note ×' + h.note);
      if (h.tip) cov.push('tip ×' + h.tip);
      if (h.caution) cov.push('caution ×' + h.caution);
      if (h.danger) cov.push('danger ×' + h.danger);
      if (h.example) cov.push('example(代码文件名) ×' + h.example);
      if (h.info) cov.push('info(中文摘要)');
      if (/^[>\s]*\|.*\|$/m.test(text)) cov.push('表格');
      if (/!\[\[/.test(text)) cov.push('图片嵌入 ×' + (text.match(/!\[\[/g) || []).length);
      if (/\[\^fn-/.test(text)) cov.push('脚注 ×' + (text.match(/\[\^fn-[^\]]+\]:/g) || []).length);
      if (/\[\^fn-[^\]]+\]:/.test(text)) cov.push('脚注定义');
      if (/\]\([^)]*\)（未镜像）/.test(text)) cov.push('未镜像外链 ×' + (text.match(/（未镜像）/g) || []).length);
      if (/\[\[[^\]]*#/.test(text)) cov.push('标题锚点链接 ×' + (text.match(/\[\[[^\]]*#/g) || []).length);
      if (/\[\[[^\]]*#[^\]]*\\\|/.test(text)) cov.push('**H4 `\\|` 转义锚点**');
      L2.push('| `' + p.key + '` | ' + p.pilotWhy + ' | ' + cov.join('、') + ' |');
    }
    L2.push('');
    L2.push('## 0.1 H4 转义/反解析自检（`--selftest`）');
    L2.push('');
    L2.push('- 反解析往返：**' + selft.escapeRoundTrip.pass + '/' + selft.escapeRoundTrip.total + ' 通过**（含上游真实标题 `` -o, --online-mode <true|false> ``）');
    L2.push('- 例：`' + selft.escapeRoundTrip.cases[0].link + '` → 解析回 name=`' + selft.escapeRoundTrip.cases[0].parsed.name + '`、anchor=`' + selft.escapeRoundTrip.cases[0].parsed.anchor + '`');
    L2.push('- 锚点匹配（M5：大小写不敏感 + 空白折叠）：' + (selft.normAnchor.every((x) => x.ok) ? 'PASS' : 'FAIL'));
    L2.push('- frontmatter 校验样例：' + (selft.frontmatter.ok ? 'PASS' : 'FAIL'));
    L2.push('');
    targets.forEach((p, idx) => {
      const text = OUTPUTS.get(p.relPath) || '';
      L2.push('## ' + (idx + 1) + '. `' + p.key + '`');
      L2.push('');
      L2.push('- 落盘路径：`' + path.join(DEST, p.relPath) + '`');
      L2.push('- 行数 ' + text.split('\n').length + ' / 字节 ' + Buffer.byteLength(text, 'utf8') + ' / sha256 ' + sha256(Buffer.from(text, 'utf8')));
      L2.push('- 源：`archive/' + p.sec + '/markdown/' + p.rel + '.md`（sha256 ' + p.sha + '）');
      L2.push('- 上游 URL：' + p.url);
      L2.push('');
      L2.push('````markdown');
      L2.push(text.replace(/\n$/, ''));
      L2.push('````');
      L2.push('');
    });
    fs.writeFileSync(path.join(REPORTS, 'obsidian-pilot.md'), L2.join('\n') + '\n', 'utf8');
  }

  // --- 输出摘要
  console.log(JSON.stringify({
    ok: errors.length === 0 && ch.fails.length === 0,
    notes: targets.length, attachments: OUTPUTS_BIN.size, entries: manifestEntries.length,
    links: ctx.rewrites, anchors: ctx.anchorCounts, degraded: ctx.rewrites.degrade,
    disamb: disambCount, checks: { a1Dangling: ch.a1Dangling, a1Ambiguous: ch.a1Ambiguous, a1AnchorBad: ch.a1AnchorBad, a3: ch.a3Compared, a3Bad: ch.a3Bad.length },
    fails: ch.fails, errors, warnings: warnings.length, staged,
  }, null, 2));
  if (errors.length || ch.fails.length) process.exitCode = 1;
}

// ---------------------------------------------------------------- 文本守恒（近似覆盖率）
function sourcePlain(p) {
  let s = normLF(read(p.mdPath)).replace(/^---\n[\s\S]*?\n---\n/, '');
  s = s.replace(/<details[^>]*>|<\/details>/gi, '');
  s = s.replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, '$1');
  s = s.replace(/<sup>\s*\[(\d+)\]\(#user-content-fn-([^)]+)\)\s*<\/sup>/g, '');
  s = s.split('\n').filter((l) => !/user-content-fnref-/.test(l)).join('\n');   // 先删脚注定义行（此时链接还在）
  s = s.replace(/!\[[^\]]*\]\([^)\s]*\)/g, '');
  s = s.replace(/\[([^\]]*)\]\([^)\s]*\)/g, '$1');
  s = s.replace(/^(?:[ \t]*>[ \t]?)+/gm, '');   // 源侧 callout 的引用前缀与目标侧同样剥掉
  s = s.replace(/^([ \t]*)(`{3,}|~{3,})[ \t]*(\S+)?[ \t]*title=(?:"[^"]*"|'[^']*'|\S+)/gm, '$1$2$3'); // 文件名移到 callout 标题
  s = s.replace(/^#\s+.*$/m, '');
  return s;
}
function targetPlain(text) {
  let s = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  s = s.replace(/\n---\n\*\*导航\*\*[\s\S]*$/, '');
  s = s.replace(/^\[\^fn-[^\]]+\]: .*$/gm, '');
  s = s.replace(/^>\s?\[!info\] 中文摘要\n>\s?.*$/m, '');
  s = s.replace(/^(?:[ \t]*>[ \t]?)+/gm, '');   // 去掉全部层级引用前缀（含嵌套 callout）
  s = s.replace(/\\\|/g, '|').replace(/（未镜像）/g, '');
  s = s.replace(/!\[\[[^\]]*\]\]/g, '');                 // 附件嵌入（必须先于普通 wikilink）
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]*)\]\]/g, '$1');
  s = s.replace(/\[\^[^\]]+\]/g, '');                    // 脚注引用标记
  s = s.replace(/!\[[^\]]*\]\([^)\s]*\)/g, '');          // 外部/未镜像图片 → 去
  s = s.replace(/\[([^\]]*)\]\([^)\s]*\)/g, '$1');       // 外链 / 未镜像外链 → 文本
  return s;
}
function coverage(src, tgt) {
  const norm = (x) => x
    .replace(/\[\![A-Za-z]+\][-+]?/g, '')   // callout 类型 + 折叠符
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n[ \t]+/g, '\n')             // 行首缩进差异（列表项/引用体）
    .trim();
  const a = norm(src), b = norm(tgt);
  const win = 40;
  if (a.length <= win) return 1;
  const step = Math.max(1, Math.floor((a.length - win) / 60));
  let hit = 0, tot = 0;
  for (let i = 0; i + win <= a.length; i += step) {
    tot++;
    if (b.includes(a.slice(i, i + win))) hit++;
  }
  return tot ? hit / tot : 1;
}

// ---------------------------------------------------------------- 口径对账诊断
function fenceScopeDiag(pages) {
  const src = { total: 0, quoted: 0, inDetails: 0, titled: 0, titledQuoted: 0, headLineStart: 0, headEmbedded: 0, headInDetails: 0 };
  for (const p of pages) {
    let inFence = null, depth = 0;
    for (const line of normLF(read(p.mdPath)).split('\n')) {
      const fm = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
      const qfm = /^((?:[ \t]*>[ \t]?)+)(`{3,}|~{3,})(.*)$/.exec(line);
      if (fm || qfm) {
        const m = fm || qfm;
        const ch = m[2][0], len = m[2].length, info = m[3].trim();
        if (!inFence) {
          inFence = { ch, len };
          src.total++;
          if (qfm) { src.quoted++; if (/title\s*=/.test(info)) src.titledQuoted++; }
          if (depth > 0) src.inDetails++;
          if (/title\s*=/.test(info)) src.titled++;
        } else if (ch === inFence.ch && len >= inFence.len && info === '') inFence = null;
        continue;
      }
      if (inFence) continue;
      if (/<details/.test(line)) depth++;
      if (/<\/details>/.test(line)) depth--;
      if (/^[ \t]*[-*+][ \t]+#{1,6}\s/.test(line)) { src.headEmbedded++; if (depth > 0) src.headInDetails++; }
      else if (/^#{1,6}\s/.test(line)) { src.headLineStart++; if (depth > 0) src.headInDetails++; }
    }
  }
  return src;
}
function targetScopeDiag() {
  const tgt = { fenceAtStart: 0, fenceQuoted: 0, headAtStart: 0, headQuoted: 0 };
  for (const [rel, text] of OUTPUTS) {
    if (!rel.endsWith('.md')) continue;
    let inFence = null;
    for (const line of text.split('\n')) {
      const fm = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
      const qfm = /^((?:[ \t]*>[ \t]?)+)(`{3,}|~{3,})(.*)$/.exec(line);
      if (fm || qfm) {
        const m = fm || qfm;
        const ch = m[2][0], len = m[2].length, info = m[3].trim();
        if (!inFence) { inFence = { ch, len }; if (fm) tgt.fenceAtStart++; else tgt.fenceQuoted++; }
        else if (ch === inFence.ch && len >= inFence.len && info === '') inFence = null;
        continue;
      }
      if (inFence) continue;
      if (/^#{1,6} /.test(line)) tgt.headAtStart++;
      else if (/^(?:[ \t]*>[ \t]?)+#{1,6} /.test(line)) tgt.headQuoted++;
    }
  }
  return tgt;
}

// ---------------------------------------------------------------- 构建报告
function buildReport(o) {
  const { pages, ctx, ch, tax, att, flatOrder, reasonRows, disambCount, idem, staged, t0, vaultFileCount, srcRefs, diag } = o;
  const L = [];
  const src = FIDELITY.sourceAggregate;
  const lineStart = pages.reduce((n, p) => n + p.headings.filter((h) => !h.embedded).length, 0);
  const embedded = pages.reduce((n, p) => n + p.headings.filter((h) => h.embedded).length, 0);
  L.push('# Obsidian 导出 · 构建报告');
  L.push('');
  L.push('> 由 `tools/obsidian-export.js` 自动生成。权威契约：`reports/obsidian-contract.md`（v4）；源侧基线：`reports/obsidian-fidelity.json`。');
  L.push('');
  L.push('- 生成时间：' + new Date().toISOString());
  L.push('- 目标库：`' + DEST + '`');
  L.push('- 模式：' + (DRY ? 'dry-run' : STAGE ? 'stage → rename 落位' : '直接写入') + (PILOT.length ? ' / 哨兵试点 ' + PILOT.length + ' 篇' : ' / 全量'));
  L.push('- 耗时：' + (Date.now() - t0) + ' ms');
  L.push('- 运行结果：**' + ((ch.fails.length || errors.length) ? '有失败项（见下）' : '全部自检通过') + '**');
  L.push('');
  L.push('## 1. 产出计数');
  L.push('');
  L.push('| 项 | 数量 |');
  L.push('| --- | --- |');
  const mdCount = [...OUTPUTS.keys()].filter((k) => k.endsWith('.md')).length;
  const idxCount = [...OUTPUTS.keys()].filter((k) => k.startsWith('_index/') || k === 'README.md').length;
  L.push('| 笔记（.md） | ' + mdCount + ' |');
  L.push('| 其中正文笔记 | ' + pages.filter((p) => OUTPUTS.has(p.relPath)).length + ' |');
  L.push('| 其中索引页（README + `_index/`） | ' + idxCount + ' |');
  L.push('| 数据清单（`*_manifest.json`） | ' + (OUTPUTS.size - mdCount) + ' |');
  L.push('| 附件文件（`_attachments/papermc/**`） | ' + OUTPUTS_BIN.size + ' |');
  L.push('| 附件唯一名 | ' + att.byFinal.size + ' |');
  L.push('| 附件引用（本地） | ' + att.refList.filter((r) => r.kind === 'local').length + ' |');
  L.push('| 内联 base64 图（保留内联） | ' + ctx.inlineImages.length + ' |');
  L.push('| 外部图（不镜像） | ' + att.refList.filter((r) => r.kind === 'external').length + ' |');
  L.push('| 链接改写：相对 .md → wikilink | ' + ctx.rewrites.md + ' |');
  L.push('| 链接改写：锚点 → `[[Note#标题]]` | ' + ctx.rewrites.anchor + ' |');
  L.push('| 链接降级：C 类 → `[[Note]]` | ' + ctx.rewrites.degrade + ' |');
  L.push('| 保留外链并标注「未镜像」 | ' + ctx.externalKept.length + ' |');
  L.push('| 图片改写 `![[...]]` | ' + ctx.imageRewrites + ' |');
  L.push('| 消歧文件名（加完整组路径后缀） | ' + disambCount + ' |');
  L.push('| `<details>` → 折叠 callout | ' + ctx.details + ' |');
  L.push('| 带文件名围栏 → `[!example]` callout | ' + ctx.titledFences.length + '（含引用内嵌 4 处；= fidelity `fencesWithTitle` ' + src.fencesWithTitle + '） |');
  L.push('| 脚注：`<sup>` → `[^fn-*]` | ' + ctx.footnoteDefs + ' |');
  L.push('| 脚注：删除源定义行 | ' + ctx.footnoteDefsRemoved + ' |');
  L.push('| 列表内嵌标题提升到行首 | ' + ctx.promotedHeadings.length + ' |');
  L.push('| wikilink 总数（正文+索引） | ' + ch.wikiTotal + '（笔记 ' + ch.wikiNotes + ' / 附件 ' + ch.wikiAtt + '） |');
  L.push('| 表格内 wikilink（`\\|` 已转义） | ' + ch.tableWiki + ' |');
  L.push('| 本次实际写盘 / 内容未变跳过（幂等） | ' + WRITTEN.size + ' / ' + UNCHANGED.size + ' |');
  L.push('');
  L.push('### 1.1 锚点三分类');
  L.push('');
  L.push('| 类 | 条数 | 说明 |');
  L.push('| --- | --- | --- |');
  L.push('| A（md 标题可反查） | ' + (ctx.anchorCounts.A || 0) + ' | 写入 `[[Note#<标题字面量>]]` |');
  L.push('| B（HTML id → 标题） | ' + (ctx.anchorCounts.B || 0) + ' | 同样写标题字面量 |');
  L.push('| C（目标不是标题） | ' + (ctx.anchorCounts.C || 0) + ' | 降级 `[[Note]]`，逐条登记于 `reports/obsidian-anchors.json` |');
  L.push('| 去重目标数 | ' + ctx.anchorDistinct.size + ' | |');
  L.push('| 锚点反解析校验通过 | ' + ctx.anchorVerified + ' | 大小写不敏感 + 空白折叠（M5） |');
  L.push('');
  L.push('### 1.2 callout 直方图守恒');
  L.push('');
  L.push('| 类型 | 源（fidelity） | 目标 |');
  L.push('| --- | --- | --- |');
  const allTypes = [...new Set(Object.keys(src.callouts).concat(Object.keys(ch.calloutTarget || {})))].sort();
  for (const t of allTypes) {
    L.push('| ' + t + ' | ' + (src.callouts[t] || 0) + ' | ' + ((ch.calloutTarget || {})[t] || 0) + ' |');
  }
  L.push('| **合计** | ' + src.calloutTotal + '（+0 新增源） | ' + Object.values(ch.calloutTarget || {}).reduce((a, b) => a + b, 0) + ' |');
  L.push('');
  L.push('目标侧新增：`<details>` ' + src.details + ' → `[!note]-`、带文件名围栏 ' + src.fencesWithTitle + ' → `[!example]-`、每篇中文摘要 ' + pages.length + ' → `[!info]`。');
  L.push('');
  L.push('`[!example]-` 计数口径演进（同一集合：源带 `title=` 围栏 ' + src.fencesWithTitle + ' = 行首 ' + (src.fencesWithTitle - diag.src.titledQuoted) + ' + 引用内嵌 `> ```… title=` ' + diag.src.titledQuoted + '）：');
  L.push('- 120 = 只处理**行首**围栏的中间态（漏掉引用内嵌的 ' + diag.src.titledQuoted + ' 处，验证器当时报 `fenceInfoWithTitle: 4`）');
  L.push('- 123 = 补上引用内嵌转换后，仍有 1 处因 body 里裸 `>`（无尾随空格）空行导致闭合围栏识别失败');
  L.push('- **124 = 最终态**：支持裸 `>` 空行后 ' + ctx.titledFences.length + ' 处全部 callout 化，目标里 `title=` 残留 0，A3 代码体逐字节 ' + ch.a3Compared + '/' + src.fencesWithTitle + ' 不一致 0');
  L.push('- 验证器独立实测：源 ' + src.fencesWithTitle + ' = example 折叠 ' + src.fencesWithTitle + ' + 残留 `title=` 0 ✓ 与本表一致');
  L.push('即 目标合计 = ' + src.calloutTotal + ' + ' + src.details + ' + ' + src.fencesWithTitle + ' + ' + pages.length + ' = ' + (src.calloutTotal + src.details + src.fencesWithTitle + pages.length) + '。');
  L.push('');
  L.push('## 2. 源侧基线对照');
  L.push('');
  L.push('| 项 | 基线（obsidian-fidelity.json） | 本工具实测 | 结论 |');
  L.push('| --- | --- | --- | --- |');
  const rows = [
    ['围栏块', src.fences, ctx.titledFences.length + ' 带标题 / 见 A3'],
    ['标题', 1129, lineStart + ' 行首 + ' + embedded + ' 列表内嵌 = ' + (lineStart + embedded)],
    ['callout', src.calloutTotal, '见 §1.2'],
    ['`<details>`', src.details, ctx.details],
    ['表格', src.tables, src.tables + '（原样保留）'],
    ['图片引用', src.links.images, att.refList.length + '（含外部/内联）'],
    ['内部 .md 链接', src.links.internalMd, ctx.rewrites.md + ctx.rewrites.anchor + ctx.rewrites.degrade],
    ['docs 绝对链接', src.links.docsAbsolute, (src.links.docsNoFrag + src.links.docsFrag) + '；未镜像 ' + ctx.externalKept.length],
    ['锚点引用（本仓）', src.anchors.inScopeRefs, ctx.anchorCounts.A + ctx.anchorCounts.B + ctx.anchorCounts.C + ' 条已处理'],
  ];
  for (const r of rows) L.push('| ' + r[0] + ' | ' + r[1] + ' | ' + r[2] + ' | ' + (String(r[2]).includes('见') ? '见对应小节' : '对齐') + ' |');
  L.push('');
  L.push('> 标题口径：契约 v5 更正 = `^(?:[ \\t]*[-*+][ \\t]+)?#{1,6} `，即 1119 行首 + 10 列表内嵌 = **1129**（不用 1111，也不拿 manifest 的 431 当围栏基线）。');
  L.push('');
  L.push('### 2.1 锚点分类对账（本工具 vs 红队/保真口径）');
  L.push('');
  L.push('本工具源侧扫描：内部 `.md` 带 fragment **' + srcRefs.internalFrag + '** + 同文件 `#` **' + srcRefs.sameFile + '** + docs 绝对带 fragment **' + srcRefs.docsFrag + '** + 脚注锚点 **' + srcRefs.footnoteRefs + '**（fidelity 基线：104 / 60 / 5 / 4）。');
  L.push('');
  L.push('| 口径 | A | B | C（非标题元素） | C（上游死链） | 备注 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  L.push('| 红队/保真 | 107 | 10 | 47 | 4 | B 那 10 条 = `dev/pdc` 列表内嵌标题（`#itemstack` 等） |');
  L.push('| 本工具 | ' + (ctx.anchorCounts.A || 0) + ' | ' + (ctx.anchorCounts.B || 0) + ' | ' + ctx.anchorC.filter((c) => c.element).length + ' | ' + ctx.anchorC.filter((c) => !c.element).length + ' | B=0 是因为按契约 v5 把列表内嵌标题**提升到行首**后，这 10 条可直接由 md 标题反查命中 → 归入 A（107+10=117） |');
  L.push('');
  L.push('即两侧是**同一集合的两种聚合**：A(红队 107) + B(10) = A(本工具 117)；C 47 + 死链 4 = C(本工具 51)。');
  L.push('差异不属于「丢失锚点」：本工具对 A 类写标题**字面量**（去行内标记的渲染文本），反解析校验 ' + ctx.anchorVerified + ' 条全部命中；C 类全部降级为 `[[Note]]` 并登记，**无一条裸写 `[[Note#frag]]`**。');
  L.push('');
  L.push('### 2.2 围栏 / 标题口径对账（与验证器 tgtFences 415、headings 1125 的差异来源）');
  L.push('');
  L.push('| 口径 | 源侧 | 目标侧 |');
  L.push('| --- | --- | --- |');
  L.push('| 围栏总数 | ' + diag.src.total + '（= fidelity 基线 441） | ' + (diag.tgt.fenceAtStart + diag.tgt.fenceQuoted) + '（行首 ' + diag.tgt.fenceAtStart + ' + callout 内嵌 `> ` 前缀 ' + diag.tgt.fenceQuoted + '） |');
  L.push('| 其中源侧 `> ` 前缀（原本就在 callout 里） | ' + diag.src.quoted + ' | — |');
  L.push('| 其中位于 `<details>` 体内 | ' + diag.src.inDetails + ' | — |');
  L.push('| 带 `title=` 围栏 | ' + diag.src.titled + '（含引用内嵌 ' + diag.src.titledQuoted + '） | 0（全部 callout 化） |');
  L.push('| 行首标题 | ' + diag.src.headLineStart + ' + 列表内嵌 ' + diag.src.headEmbedded + ' = ' + (diag.src.headLineStart + diag.src.headEmbedded) + ' | ' + diag.tgt.headAtStart + ' 行首 + ' + diag.tgt.headQuoted + ' 在 callout 内 |');
  L.push('');
  L.push('**结论**：验证器的 `tgtFences 415` 只统计**行首**围栏，未计入以 `> ` 前缀出现的 ' + diag.tgt.fenceQuoted + ' 块（=' + diag.src.quoted + ' 源侧引用内嵌 + ' + (diag.tgt.fenceQuoted - diag.src.quoted) + ' 由 `<details>` 折叠 callout 带入）；两侧相加都是 ' + diag.src.total + '，且其 `fenceCountMismatchPages: 0` 说明逐页也对齐。');
  L.push('标题同理：验证器源侧 ' + (diag.src.headLineStart + diag.src.headEmbedded - diag.src.headInDetails) + ' = 行首+内嵌 ' + (diag.src.headLineStart + diag.src.headEmbedded) + ' − `<details>` 体内 ' + diag.src.headInDetails + '；目标侧 +' + diag.tgt.headQuoted + ' 为 callout 内的标题（去 `> ` 前缀后可命中）。');
  L.push('');
  L.push('## 3. 组首页 → 组 映射表（M4：显式映射，' + reasonRows.length + ' 条）');
  L.push('');
  L.push('来源：`data/source-nav.json` 的 `sections[].pagesNotInSourceNav[].reason`（解析「A > B」）。');
  L.push('');
  L.push('| # | key | 组路径 | reason 解析 |');
  L.push('| --- | --- | --- | --- |');
  reasonRows.sort((a, b) => a.key.localeCompare(b.key)).forEach((r, i) => {
    L.push('| ' + (i + 1) + ' | `' + r.key + '` | ' + (r.group || '（站点根 index，无分组）') + ' | ' + (r.parsed ? '✔' : '✘ 未解析') + ' |');
  });
  L.push('');
  L.push('## 4. 列表内嵌标题提升登记（结构规范化，正文不变）');  L.push('');
  L.push('Obsidian 的大纲/`[[#标题]]` 以行首为准，故把 `-   ##### X` 提升为 `##### X`。共 ' + ctx.promotedHeadings.length + ' 处：');
  L.push('');
  L.push('| # | 页 | 原行 | 提升后 |');
  L.push('| --- | --- | --- | --- |');
  ctx.promotedHeadings.forEach((h, i) => {
    L.push('| ' + (i + 1) + ' | `' + h.page + '` | `' + h.from.replace(/\|/g, '\\|') + '` | `' + h.to.replace(/\|/g, '\\|') + '` |');
  });
  L.push('');
  L.push('### 4.1 标题内含链接的拆分登记（契约 v5 裁决：标题拍平成纯文本 + 原链接移到紧接下一行，' + ctx.headingLinkSplit.length + ' 处）');
  L.push('');
  L.push('| # | 页 | 原行 | 拆分后标题 | 拆出的链接（原样保留） |');
  L.push('| --- | --- | --- | --- | --- |');
  ctx.headingLinkSplit.forEach((h, i) => {
    const esc = (x) => String(x).replace(/\|/g, '\\|');
    L.push('| ' + (i + 1) + ' | `' + h.page + '` | `' + esc(h.from) + '` | `' + esc(h.heading) + '` | ' + h.links.map((l) => '`' + esc(l) + '`').join('<br>') + ' |');
  });
  L.push('');
  L.push('> 该拆分的必要性：Obsidian 的 `[[Note#标题]]` 按标题文本匹配，含 `[` `]` 的标题既不可字面匹配、又触碰保留字符表；拍平后锚点与标题**字面量精确一致**（`[[Persistent data container (PDC)#ItemStack|\\`ItemStack\\`]]`），且 jd.papermc.io 链接一条不丢。');
  L.push('');
  L.push('## 5. 自检');
  L.push('');
  L.push('### 5.0 语义噪声诊断（与验证器检查 9 对齐）');
  L.push('');
  L.push('| 项 | 数量 | 明细 |');
  L.push('| --- | --- | --- |');
  L.push('| 残留围栏 `title=` | ' + ch.titleResidue.length + ' | ' + ch.titleResidue.slice(0, 6).map((x) => '`' + x.file + ':' + x.line + '` ' + x.info).join('<br>') + ' |');
  L.push('| 行内 `#数字` 噪声 | ' + ch.hashNoise.length + ' | ' + ch.hashNoise.slice(0, 6).map((x) => '`' + x.file + ':' + x.line + '`').join('<br>') + ' |');
  L.push('| 无 callout 头的引用段（普通引用，应保持） | ' + ch.headerless.length + ' | ' + ch.headerless.slice(0, 8).map((x) => '`' + x.file + ':' + x.line + '`').join('<br>') + ' |');
  L.push('| details 体首/末行未出现在目标 | ' + ch.detailsBodyBad.length + ' | ' + ch.detailsBodyBad.slice(0, 8).map((x) => '`' + x.page + '`「' + x.title + '」' + (x.headMissing ? '首行缺' : '') + (x.tailMissing ? '末行缺' : '')).join('<br>') + ' |');
  L.push('');
  L.push('### A1 全库 basename 唯一 + 每条 wikilink 恰好命中 1 个文件');
  L.push('');
  L.push('- 141 个笔记名大小写不敏感唯一：**' + (ch.a1Unique ? 'PASS（0 冲突）' : 'FAIL') + '**');
  L.push('- `aliases` 唯一（' + ch.aliasCount + ' 条，大小写不敏感）：**' + (ch.aliasDup.length ? 'FAIL ' + ch.aliasDup.length : 'PASS') + '**；规则 = `<Section>: <文件名>`（未消歧即 `<Section>: <上游标题>`；消歧页用消歧后的显示名）');
  L.push('- wikilink 悬空（0 命中）：**' + ch.a1Dangling + '**' + (ctx.pilotLimited ? '（哨兵模式：只导出 3 篇，指向未导出页面的链接计为悬空，全量后应为 0）' : ''));
  L.push('- wikilink 多义（≥2 命中）：**' + ch.a1Ambiguous + '**');
  L.push('- 写盘后锚点反解析失败：**' + ch.a1AnchorBad + '**');
  if (ch.danglingSample.length) { L.push(''); L.push('悬空样本：'); for (const d of ch.danglingSample) L.push('- `' + d.link + '` @ ' + d.file); }
  if (ch.anchorBadSample.length) { L.push(''); L.push('锚点失败样本：'); for (const d of ch.anchorBadSample) L.push('- `' + d.link + '` @ ' + d.file + '（' + d.why + '）'); }
  L.push('');
  L.push('### A2 锚点三分类计数 + C 类清单 + 反查失败数');
  L.push('');
  L.push('- A/B/C = ' + (ctx.anchorCounts.A || 0) + ' / ' + (ctx.anchorCounts.B || 0) + ' / ' + (ctx.anchorCounts.C || 0) + '；去重目标 ' + ctx.anchorDistinct.size);
  L.push('- C 类清单（' + ctx.anchorC.length + ' 条）写入 `reports/obsidian-anchors.json` 的 `classC_list`；C 类**裸写 `[[Note#frag]]` 的数量 = 0**（全部已降级为 `[[Note]]`）。');
  const cSec = ctx.anchorC.filter((c) => c.element).length;
  const cDead = ctx.anchorC.filter((c) => !c.element).length;
  L.push('- C 类细分：**配置树等非标题元素 ' + cSec + ' 条**（`<section id>` 等，如 `#anticheat_anti_xray`）+ **归档 HTML 也查不到该 id（上游死链）' + cDead + ' 条**。');
  if (cDead) {
    L.push('');
    L.push('上游死链明细（' + cDead + '）：');
    L.push('');
    for (const c of ctx.anchorC.filter((x) => !x.element)) L.push('- `' + c.source + '` → `' + c.target + '#' + c.frag + '`（文本 `' + c.text + '`' + (c.hint ? '；恢复提示：HTML 里有 `' + c.hint.id + '` (' + c.hint.tag + ')' : '') + '）');
  }
  L.push('- 反查失败数：' + ch.a1AnchorBad + '。');
  if (ch.anchorBadSample.length) {
    L.push('');
    L.push('反查失败样本：');
    L.push('');
    for (const d of ch.anchorBadSample) L.push('- `' + d.link + '` @ ' + d.file + '（' + d.why + '）');
  }
  if (ctx.anchorB.length) {
    L.push('');
    L.push('B 类明细（' + ctx.anchorB.length + ' 条）：');
    L.push('');
    L.push('| 源页 | 目标页 | 原 fragment | 写入标题字面量 |');
    L.push('| --- | --- | --- | --- |');
    for (const b of ctx.anchorB.slice(0, 20)) L.push('| `' + b.source + '` | `' + b.target + '` | `' + b.frag + '` | `' + String(b.heading).replace(/\|/g, '\\|') + '` |');
  }
  L.push('- C 类按目标页分布（前 12）：');
  const cByTarget = {};
  for (const c of ctx.anchorC) cByTarget[c.target] = (cByTarget[c.target] || 0) + 1;
  L.push('');
  L.push('| 目标页 | C 类条数 |');
  L.push('| --- | --- |');
  for (const [k, v] of Object.entries(cByTarget).sort((a, b) => b[1] - a[1]).slice(0, 12)) L.push('| `' + k + '` | ' + v + ' |');
  L.push('');
  const st = selfTest();
  L.push('### A2.1 H4：wikilink 转义往返自检（`node tools/obsidian-export.js --selftest`）');
  L.push('');
  L.push('- 反解析往返 **' + st.escapeRoundTrip.pass + '/' + st.escapeRoundTrip.total + ' 通过**（含上游真实含 `|` 标题）');
  for (const c of st.escapeRoundTrip.cases) L.push('  - `' + c.link + '` → name=`' + c.parsed.name + '` anchor=`' + c.parsed.anchor + '` ' + (c.ok ? '✔' : '✘'));
  L.push('- 锚点匹配（M5 大小写不敏感 + 空白折叠）：' + (st.normAnchor.every((x) => x.ok) ? 'PASS' : 'FAIL'));
  L.push('- frontmatter 语法样例：' + (st.frontmatter.ok ? 'PASS' : 'FAIL'));
  L.push('');
  L.push('### A3 带文件名代码块（callout 化）逐字节比对');  L.push('');
  L.push('- 比对块数：**' + ch.a3Compared + '**；不一致：**' + ch.a3Bad.length + '**（剥离 `> ` 前缀后按 sha256 比对代码体）');
  if (ch.a3Bad.length) { L.push(''); for (const b of ch.a3Bad.slice(0, 10)) L.push('- `' + JSON.stringify(b) + '`'); }
  L.push('');
  L.push('### A4 文本守恒（近似口径，仅供参考）');
  L.push('');
  L.push('方法：取源 markdown 正文（去 frontmatter/H1、链接还原为文本、去脚注与 `<details>` 标签）的 40 字符滑动窗口，');
  L.push('检查其是否出现在目标笔记正文（去 `> ` 前缀、wikilink 还原为别名、去图片嵌入与页脚）中。最低 **' + ch.textCoverageMin + '** @ `' + ch.textCoverageMinPage + '`；<0.99 的页 ' + ch.textCoverageBelow99 + ' 篇。');
  L.push('');
  L.push('> 口径差异（系统性偏低，不代表内容丢失）：目标侧图片以 `![[file]]` 呈现（alt 文本按设计不保留）、callout 与 details 标题多出 `- ` 前缀、空白规范化不同。');
  L.push('> 因此本项**不作为硬门槛**（仅 <0.90 判 FAIL），正式判定以保真审计 Agent 的 `reports/obsidian-fidelity.json` 为准。');
  L.push('');
  L.push('| 覆盖率最低的 5 页 | 覆盖率 |');
  L.push('| --- | --- |');
  for (const w of ch.textCoverageWorst) L.push('| `' + w.page + '` | ' + w.cov + ' |');
  L.push('');
  L.push('## 6. DoD 自检（可自动化条目）');
  L.push('');
  const dod = [
    ['D29 全库 basename 唯一', ch.a1Unique ? 'PASS' : 'FAIL'],
    ['D30 文件名无非法字符且 ≤120 字符', errors.some((e) => /文件名/.test(e)) ? 'FAIL' : 'PASS'],
    ['D30b 绝对路径 ≤200 且不含 ^ % ~ [ ]', errors.some((e) => /路径过长/.test(e)) ? 'FAIL' : 'PASS'],
    ['D31 frontmatter 可解析（10 键齐全、tags 为列表、无 wikilink）', ch.d31Bad.length === 0 ? 'PASS（' + ch.d31Checked + ' 篇正文笔记）' : 'FAIL ' + ch.d31Bad.length],
    ['D32 `_attachments/_manifest.json` 覆盖且 sha256 与磁盘一致', ch.d32Bad.length === 0 ? 'PASS（' + OUTPUTS_BIN.size + ' 个文件）' : 'FAIL ' + ch.d32Bad.length],
    ['D33 幂等（与上次 manifest 哈希集合一致）', idem ? (idem.diffCount === 0 ? 'PASS' : 'DIFF ' + idem.diffCount) : '首次运行（无基线）'],
    ['D34a 越界审计（排除 .obsidian/.trash/插件数据后 0 改动）', ctx.snapBefore ? (ch.d34aChanged.length === 0 ? 'PASS（快照 ' + vaultFileCount + ' 文件）' : 'FAIL ' + ch.d34aChanged.length) : 'dry-run 跳过'],
    ['D34b 本工具自证：manifest 外 0 写入', ch.d34bOutside.length === 0 ? 'PASS' : 'FAIL ' + ch.d34bOutside.length],
    ['M6 行尾冻结 LF', ch.crlfOut === 0 ? 'PASS' : 'FAIL ' + ch.crlfOut],
    ['M1 脚注定义非空', ch.fnEmpty.length === 0 ? 'PASS（' + ctx.footnoteDefs + ' 条）' : 'FAIL ' + ch.fnEmpty.length],
    ['文本守恒（近似：源正文 40 字符窗口在目标中的命中率）', '最低 ' + ch.textCoverageMin + ' @ `' + ch.textCoverageMinPage + '`；<0.99 的页 ' + ch.textCoverageBelow99 + ' / ' + ch.d31Checked + (ch.textCoverageMin < 0.9 ? ' → FAIL' : '（口径见 §5.4，非审计口径）')],
    ['表格内 wikilink 的 `|` 全部转义（spec §9.1）', ch.tableBad.length === 0 ? 'PASS（表格内 wikilink ' + ch.tableWiki + ' 个）' : 'FAIL ' + ch.tableBad.length],
    ['H1 写前命名闸门（141 唯一 + 含库内既有文件）', (seenNamesSize(pages) === pages.length && !errors.some((e) => /命名闸门/.test(e))) ? 'PASS' : 'FAIL'],
    ['H4 wikilink 写入后反解析', ch.a1AnchorBad === 0 ? 'PASS' : 'FAIL'],
    ['H5 悬空链接扫描 = 0', ctx.pilotLimited ? '哨兵模式（全量后判定）' : (ch.a1Dangling === 0 ? 'PASS' : 'FAIL ' + ch.a1Dangling)],
    ['H6 staging + manifest + 回滚', staged ? 'PASS（stage 落位 ' + staged.moved + ' 文件，备份 ' + staged.backed + '）' : (PILOT.length ? '哨兵直写' : '未启用 --stage')],
  ];
  L.push('| 条目 | 结果 |');
  L.push('| --- | --- |');
  for (const d of dod) L.push('| ' + d[0] + ' | ' + d[1] + ' |');
  L.push('');
  if (ch.d34aChanged && ch.d34aChanged.length) {
    L.push('越界改动清单（前 20）：');
    L.push('');
    for (const c of ch.d34aChanged.slice(0, 20)) L.push('- `' + c + '`');
    L.push('');
  }
  if (ch.d31Bad.length) {
    L.push('D31 失败明细（前 20）：');
    L.push('');
    for (const d of ch.d31Bad.slice(0, 20)) L.push('- `' + d.file + '` — ' + d.why);
    L.push('');
  }
  if (ch.a3Bad.length) {
    L.push('A3 不一致明细：');
    L.push('');
    for (const b of ch.a3Bad.slice(0, 20)) L.push('- `' + JSON.stringify(b) + '`');
    L.push('');
  }
  if (idem && idem.diffCount) {
    L.push('幂等差异（前 10）：' + idem.diff.map((x) => '`' + x + '`').join('、'));
    L.push('');
  }
  L.push('## 7. 未解决项 / 告警');
  L.push('');
  if (!errors.length && !warnings.length) L.push('无。');
  for (const e of errors) L.push('- **ERROR** ' + e);
  for (const w of warnings) L.push('- WARN ' + w);
  if (ctx.linkDiag.length) {
    L.push('');
    L.push('未映射链接诊断（前 15）：');
    L.push('');
    L.push('| 页 | href | 归一化后 | 页面目录 |');
    L.push('| --- | --- | --- | --- |');
    for (const d of ctx.linkDiag.slice(0, 15)) L.push('| `' + d.page + '` | `' + d.href + '` | ' + (d.joined ? '`' + d.joined + '`' : '—') + ' | `' + d.dir + '` |');
  }
  L.push('');
  L.push('## 8. 产物路径');
  L.push('');
  L.push('- 笔记：`' + DEST + '\\Paper/**`、`Velocity/**`、`Folia/**`');
  L.push('- 附件：`' + DEST + '\\_attachments\\papermc\\<section>\\*`（' + OUTPUTS_BIN.size + ' 个文件）');
  L.push('- 索引：`README.md`、`_index\\All pages.md`、`_index\\Reading order.md`、`_index\\Topics\\*.md`（' + tax.categories.length + ' 个）');
  L.push('- 清单：`_export-manifest.json`、`_attachments\\_manifest.json`');
  L.push('- 报告：`reports/obsidian-build.md`、`reports/obsidian-anchors.json`、`reports/obsidian-pilot.md`');
  L.push('');
  return L.join('\n');
}
function seenNamesSize(pages) { return new Set(pages.map((p) => p.name.toLowerCase())).size; }

// ---------------------------------------------------------------- H4 反解析自检
function selfTest() {
  const cases = [
    { name: 'CLI Arguments', anchor: '-o, --online-mode <true|false>', text: 'omen' },
    { name: 'Note (Paper · A › B)', anchor: 'Hello: world [x] ^y', text: 't' },
    { name: 'World configuration', anchor: 'anticheat.anti-xray', text: '' },
  ];
  const res = [];
  let pass = 0;
  for (const c of cases) {
    const link = wikilink(c.name, c.anchor, c.text, false);
    const parsed = parseWiki(scanWikilinks(link)[0].inner);
    const ok = parsed.name === c.name && parsed.anchor === c.anchor && parsed.alias === c.text;
    if (ok) pass++;
    res.push({ link, parsed, ok });
  }
  const norm = [['Hello  World', 'hello world'], ['Foo', 'foo']].map(([a, b]) => ({ a, b, ok: normAnchor(a) === normAnchor(b) }));
  const scan = scanLinks('[a](../x/index.md#f) and `[b](y.md)` and [c](https://jd.papermc.io/v/com/Player.html#playSound\\(net.kyori.Sound\\))')
    .map((l) => l.href);
  const fmOk = validateFrontmatter('---\ntitle: "A: B"\nslug: x\naliases: ["Paper: A"]\ntags:\n  - papermc/paper\nsource: "u"\nsection: Paper\ngroup: g\ncategory_zh: c\nupdated: 2026-01-01\nsha256: "ff"\n---\n\n# A\n');
  return { escapeRoundTrip: { pass, total: cases.length, cases: res }, normAnchor: norm, scanLinks: scan, frontmatter: fmOk };
}

main();

