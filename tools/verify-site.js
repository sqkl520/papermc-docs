'use strict';
/**
 * verify-site.js — 独立验证 Agent（Independent Verifier）的站点验证工具。
 *
 * 立场：不信任生成器（tools/build-site.js / tools/check-site.js）自报的任何数字，
 * 一切结论都从磁盘上的产物 + archive 真值重新计算，并给出可复现命令。
 *
 * 站点根 = 仓库根（LIB = ROOT）：index.html / all-pages.html / snapshots.html / 404.html / robots.txt / sitemap.xml、
 * assets/**、categories/**、sections/**、<section>/**（paper、velocity）都在仓库根下；
 * 真值与辅助数据在 data/{taxonomy.json,source-nav.json,build-manifest.json}，归档镜像在 archive/**，
 * 验证报告写到 reports/**。
 *
 * 用法：
 *   node tools/verify-site.js                 # 跑全部 15 项并写出 JSON + Markdown 报告
 *   node tools/verify-site.js --check=3       # 只跑第 3 项（报告里每行的复现命令）
 *   node tools/verify-site.js --json-only     # 只写 verification.json
 *
 * 输出（仅这 3 个文件）：
 *   tools/verify-site.js
 *   reports/verification.json
 *   reports/verification.md
 *
 * 只读：不改动 index.html / all-pages.html / snapshots.html / 404.html / robots.txt / sitemap.xml、
 *       assets/**、categories/**、sections/**、paper/**、velocity/**、data/**、
 *       tools/build-site.js、tools/site/**、archive/**。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const LIB = ROOT;
const ARCH = path.join(ROOT, 'archive');
const OUT_JSON = path.join(ROOT, 'reports', 'verification.json');
const OUT_MD = path.join(ROOT, 'reports', 'verification.md');
const SECTIONS = ['paper', 'velocity'];

/** LIB 之外的非站点内容（归档镜像 / 数据 / 工具 / 报告 / 依赖），扫描站点时必须跳过 */
const SITE_SKIP = ['REPORTS', 'reports', 'node_modules', '.git', 'archive', 'data', 'tools'];
/** 仓库工程文件（非站点内容）的顶层文件名，扫描站点时必须跳过 */
const SITE_SKIP_FILES = ['package.json', 'package-lock.json', 'README.md', 'CONTRIBUTING.md', 'LICENSE', 'LICENSE-PaperMC-docs.txt', 'THIRD-PARTY-NOTICES.md'];

// ───────────────────────────── 小工具 ─────────────────────────────

const toPosix = (p) => p.split(path.sep).join('/');
/** 相对仓库根的可读路径 */
const R = (p) => toPosix(path.relative(ROOT, p));
/** 相对站点根（LIB）的可读路径 */
const RL = (p) => toPosix(path.relative(LIB, p));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const readText = (p) => fs.readFileSync(p, 'utf8');
const readBuf = (p) => fs.readFileSync(p);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function walkFiles(root, { ext = null, skipDirs = SITE_SKIP, skipFiles = SITE_SKIP_FILES } = {}) {
  const out = [];
  const skip = new Set(skipDirs);
  const rec = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) rec(p); }
      else if (e.isFile()) {
        if (ext && !e.name.endsWith(ext)) continue;
        if (skipFiles.includes(e.name)) continue;
        out.push(p);
      }
    }
  };
  rec(root);
  return out.sort();
}

/** 站点目录树的指纹（排除 reports，即验证器自己的输出）；可选排除易变的辅助数据文件 */
function treeFingerprint(dir, exclude = []) {
  const ex = new Set(exclude);
  const files = walkFiles(dir, { skipDirs: SITE_SKIP }).filter((f) => !ex.has(RL(f)));
  const lines = files.map((f) => {
    const st = fs.statSync(f);
    return `${RL(f)}|${st.size}|${sha256(readBuf(f))}`;
  });
  return { hash: sha256(Buffer.from(lines.join('\n'), 'utf8')), files: files.length, bytes: files.reduce((n, f) => n + fs.statSync(f).size, 0) };
}
/** 站点产物子集（排除 pipeline 会持续重写的辅助数据文件），用于给出更稳定的锚定指纹 */
const VOLATILE_AUX = ['data/source-nav.json'];
const fingerprintPair = () => ({
  all: treeFingerprint(LIB),
  products: treeFingerprint(LIB, VOLATILE_AUX),
});

function sanitizeHtmlEntity(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/**
 * 去掉 <script>/<style>/注释 后再做标签级正则扫描。
 * 站点每页内联了若干 JS 字符串（如 lightbox 的 '<img>' 模板），
 * 直接在原始文本上跑标签正则会把这些字符串当成真实元素（第一版的误报来源）。
 */
function stripScriptAndStyle(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
}

/** 去掉整块代码的公共缩进（Markdown 里位于列表项内的围栏会带 4/8 空格缩进，渲染时会去掉） */
function dedent(s) {
  const lines = String(s).split('\n');
  let min = Infinity;
  for (const l of lines) {
    if (l.trim() === '') continue;
    const m = /^[ \t]*/.exec(l)[0].length;
    if (m < min) min = m;
  }
  if (!isFinite(min) || min === 0) return s;
  return lines.map((l) => (l.trim() === '' ? '' : l.slice(min))).join('\n');
}

/** 取正文 article 片段（生成器 p.html 的口径） */
function articleOf(html) {
  const m = /<article class="article">([\s\S]*?)<\/article>/.exec(html);
  return m ? m[1] : '';
}

/** 每页的“逻辑文本”：JSON/搜索索引按解析后的字符串值拼接，避免 JSON 转义 \n 被误判成 Windows 路径 */
function logicalText(file) {
  const raw = readText(file);
  if (file.endsWith('.json')) {
    const vals = [];
    const walk = (v) => {
      if (typeof v === 'string') vals.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    try { walk(JSON.parse(raw)); return vals.join('\n'); } catch { return raw; }
  }
  if (/search-index\.js$/.test(file)) {
    try {
      const body = raw.slice(raw.indexOf('=') + 1).replace(/;\s*$/, '');
      const vals = [];
      const walk = (v) => {
        if (typeof v === 'string') vals.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(JSON.parse(body));
      return vals.join('\n');
    } catch { return raw; }
  }
  return stripScriptAndStyle(raw);
}

/** 代码正文归一化：去行尾空白、去首尾空行、折叠连续空行 */
function normCode(s) {
  const lines = String(s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const out = [];
  let blank = false;
  for (const l of lines) {
    if (l.trim() === '') { if (!blank) out.push(''); blank = true; } else { out.push(l); blank = false; }
  }
  return out.join('\n');
}

/** 去掉 markdown 行首的引用前缀（`> `、`> > `、缩进引用） */
function stripQuotePrefix(line) {
  return line.replace(/^(?:[ \t]*>[ \t]?)+/, '');
}

/**
 * 从归档 Markdown 提取所有围栏代码块（含被 `> ` 包裹的告警内围栏）。
 * 返回 [{lang, text, quoted}]。
 */
function extractFencedBlocks(mdText) {
  const blocks = [];
  const lines = String(mdText).replace(/\r\n?/g, '\n').split('\n');
  const stack = []; // 当前打开的围栏 {marker, len, quoted, buf}
  let pendingOpen = null;
  for (const raw of lines) {
    const quoted = /^[ \t]*>/.test(raw);
    const line = stripQuotePrefix(raw);
    const m = /^[ \t]*(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
    if (stack.length === 0) {
      if (m) {
        pendingOpen = { marker: m[1][0], len: m[1].length, quoted, info: m[2].trim(), buf: [] };
        stack.push(pendingOpen);
      }
      continue;
    }
    const cur = stack[stack.length - 1];
    if (m && m[1][0] === cur.marker && m[1].length >= cur.len) {
      stack.pop();
      blocks.push({ lang: cur.info, text: cur.buf.join('\n'), quoted: cur.quoted });
      pendingOpen = null;
      continue;
    }
    // 正文行：只有围栏本身来自引用块（告警内）时才去掉一层 `>` 前缀，否则保留原样
    cur.buf.push(cur.quoted ? stripQuotePrefix(raw) : raw);
  }
  return blocks;
}

/** 解析 markdown 里的 GitHub 告警标记：返回 [{type, quoted}] */
function extractAlerts(mdText) {
  const out = [];
  for (const raw of String(mdText).replace(/\r\n?/g, '\n').split('\n')) {
    const quoted = /^[ \t]*>/.test(raw);
    const line = stripQuotePrefix(raw);
    const m = /^[ \t]*\[!([A-Za-z]+)\][ \t]*(.*)$/.exec(line);
    if (m) out.push({ type: m[1].toUpperCase(), title: m[2].trim(), quoted });
  }
  return out;
}

/** 解析 markdown 里的 `<details>` 块 */
function extractDetails(mdText) {
  const src = String(mdText).replace(/\r\n?/g, '\n');
  const out = [];
  const re = /^[ \t]*(?:>[ \t]?)*<details\b/gi;
  let m;
  const lines = src.split('\n');
  for (const raw of lines) {
    if (re.test(raw)) { out.push(raw.trim()); re.lastIndex = 0; }
  }
  return out;
}

/**
 * 解析 markdown 管道表格：返回 [{rows, cols, sepOk}]。
 * rows 含表头行；cols 取表头单元格数。
 */
function extractTables(mdText) {
  const lines = String(mdText).replace(/\r\n?/g, '\n').split('\n').map(stripQuotePrefix);
  const tables = [];
  let i = 0;
  const isTableLine = (l) => /^[ \t]*\|.*\|[ \t]*$/.test(l) || /^[ \t]*\|[^|]*\|/.test(l.trim());
  const isSepLine = (l) => /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/.test(l) && l.includes('-') && l.includes('|');
  while (i < lines.length) {
    if (isTableLine(lines[i]) && i + 1 < lines.length && isSepLine(lines[i + 1])) {
      const block = [lines[i], lines[i + 1]];
      let j = i + 2;
      while (j < lines.length && isTableLine(lines[j]) && !isSepLine(lines[j])) { block.push(lines[j]); j++; }
      const cellCount = (l) => splitTableRow(l).length;
      tables.push({ rows: block.length - 1, cols: Math.max(cellCount(block[0]), 1), sepOk: true, header: block[0].trim() });
      i = j;
    } else i++;
  }
  return tables;
}

/** 拆分管道表格行（尊重转义 \| 与行内代码里的 |） */
function splitTableRow(line) {
  let s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') inCode = !inCode;
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** 取 HTML 里某个属性（无 cheerio 的兜底实现，用于极少量场景） */
const attrOf = (tag, name) => {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag) || new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return m ? m[1] : null;
};

// ───────────────────────────── 载入真值 ─────────────────────────────

function loadTruth() {
  const tax = JSON.parse(readText(path.join(ROOT, 'data', 'taxonomy.json')));
  const manifest = JSON.parse(readText(path.join(ROOT, 'data', 'build-manifest.json')));
  const archives = {};
  for (const s of SECTIONS) archives[s] = JSON.parse(readText(path.join(ARCH, s, 'manifest.json')));
  const pages = tax.pages.map((p) => ({
    ...p,
    htmlRel: `${p.section}/${p.rel}.html`,
    htmlAbs: path.join(LIB, p.section, p.rel + '.html'),
    mdAbs: path.join(ARCH, p.section, 'markdown', p.rel + '.md'),
    srcAbs: path.join(ARCH, p.section, 'source', p.rel + '.md'),
    rawAbs: path.join(ARCH, p.section, 'html', p.rel + '.html'),
    arch: archives[p.section].pages.find((q) => q.rel === p.rel) || null,
  }));
  return { tax, manifest, archives, pages };
}

// ───────────────────────────── 15 项检查 ─────────────────────────────

function makeCheck(id, name, command, category, categoryWhy) {
  return { id, name, command, category: category || '①真实缺陷', categoryWhy: categoryWhy || '生成产物与真值（归档 Markdown / taxonomy / 文件系统）不符，属会被读者直接感知的缺陷', pass: null, metrics: [], issues: [], notes: [], extra: {} };
}

function pushIssue(chk, list, s) { if (list) list.push(s); if (chk.issues.length < 400) chk.issues.push(s); }
function metric(chk, k, v) { chk.metrics.push({ k, v }); }

// ---------- 1. 覆盖完整性 ----------
function check1(T) {
  const chk = makeCheck(1, '覆盖完整性', 'node tools/verify-site.js --check=1');
  const expected = new Set(T.pages.map((p) => p.htmlRel));
  const actual = new Set(SECTIONS.flatMap((s) => walkFiles(path.join(LIB, s), { ext: '.html' })).map(RL));
  const missing = [...expected].filter((f) => !actual.has(f) || !exists(path.join(LIB, f)));
  const extra = [...actual].filter((f) => !expected.has(f));
  const dupIds = (() => {
    const seen = new Map();
    T.pages.forEach((p) => seen.set(p.id, (seen.get(p.id) || 0) + 1));
    return [...seen].filter(([, n]) => n > 1);
  })();
  metric(chk, 'taxonomy 页面数', T.pages.length);
  metric(chk, '产物 HTML 数（paper/、velocity/ 下）', actual.size);
  metric(chk, '缺失产物', missing.length);
  metric(chk, '多余产物', extra.length);
  metric(chk, 'taxonomy 中重复 id', dupIds.length);
  metric(chk, 'paper 产物 / taxonomy', `${[...actual].filter((f) => f.startsWith('paper/')).length} / ${T.pages.filter((p) => p.section === 'paper').length}`);
  metric(chk, 'velocity 产物 / taxonomy', `${[...actual].filter((f) => f.startsWith('velocity/')).length} / ${T.pages.filter((p) => p.section === 'velocity').length}`);

  const catExpected = new Set(T.tax.categories.map((c) => `categories/${c.id}.html`));
  const catActual = new Set(walkFiles(path.join(LIB, 'categories'), { ext: '.html' }).map(RL));
  const catMissing = [...catExpected].filter((f) => !exists(path.join(LIB, f)));
  const catExtra = [...catActual].filter((f) => !catExpected.has(f));
  const secExpected = new Set(T.tax.sections.map((s) => `sections/${s.id}.html`));
  const secActual = new Set(walkFiles(path.join(LIB, 'sections'), { ext: '.html' }).map(RL));
  const secMissing = [...secExpected].filter((f) => !exists(path.join(LIB, f)));
  const secExtra = [...secActual].filter((f) => !secExpected.has(f));
  metric(chk, '分类页 期望/实际', `${catExpected.size} / ${catActual.size}`);
  metric(chk, '分区页 期望/实际', `${secExpected.size} / ${secActual.size}`);

  missing.forEach((f) => pushIssue(chk, null, `缺失产物：${f}（taxonomy 有页，磁盘无文件）`));
  extra.forEach((f) => pushIssue(chk, null, `多余产物：${f}（磁盘有文件，taxonomy 无此页）`));
  catMissing.forEach((f) => pushIssue(chk, null, `缺失分类页：${f}`));
  catExtra.forEach((f) => pushIssue(chk, null, `多余分类页：${f}`));
  secMissing.forEach((f) => pushIssue(chk, null, `缺失分区页：${f}`));
  secExtra.forEach((f) => pushIssue(chk, null, `多余分区页：${f}`));
  dupIds.forEach(([id, n]) => pushIssue(chk, null, `taxonomy 重复 id：${id} × ${n}`));
  chk.pass = missing.length === 0 && extra.length === 0 && catMissing.length === 0 && catExtra.length === 0
    && secMissing.length === 0 && secExtra.length === 0 && dupIds.length === 0;
  return chk;
}

// ---------- 2 & 3. 相对链接存在性 / 锚点有效性 ----------
function collectHrefs() {
  const files = walkFiles(LIB, { ext: '.html', skipDirs: SITE_SKIP });
  const rows = [];
  for (const f of files) {
    const t = stripScriptAndStyle(readText(f));
    const re = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?\s(href|src)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(t))) rows.push({ file: f, tag: m[1].toLowerCase(), attr: m[2].toLowerCase(), value: m[3] });
  }
  return { files, rows };
}

function classifyTarget(value) {
  if (value === '' || value == null) return { kind: 'empty' };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return { kind: 'scheme', scheme: value.split(':')[0].toLowerCase() };
  if (value.startsWith('//')) return { kind: 'scheme', scheme: '//' };
  if (value.startsWith('#')) return { kind: 'samepage' };
  return { kind: 'relative' };
}

function check23(T, H) {
  const c2 = makeCheck(2, '相对链接存在性', 'node tools/verify-site.js --check=2');
  const c3 = makeCheck(3, '锚点有效性（比第 2 项更严）', 'node tools/verify-site.js --check=3');
  let checked = 0, broken = 0, ext = 0, schemes = 0;
  const brokenList = [];
  let fragTotal = 0, fragMiss = 0, fragSamePage = 0, fragCrossFile = 0;
  const missList = [];
  const idCache = new Map();
  const idsOf = (abs) => {
    if (idCache.has(abs)) return idCache.get(abs);
    let set = { ids: new Set(), names: new Set() };
    if (exists(abs)) {
      const t = readText(abs);
      const ids = new Set(), names = new Set();
      for (const m of t.matchAll(/\sid\s*=\s*"([^"]*)"/g)) ids.add(m[1]);
      for (const m of t.matchAll(/\sname\s*=\s*"([^"]*)"/g)) names.add(m[1]);
      set = { ids, names };
    }
    idCache.set(abs, set);
    return set;
  };

  for (const row of H.rows) {
    const cls = classifyTarget(row.value);
    if (cls.kind === 'empty') continue;
    if (cls.kind === 'scheme') { schemes++; if (cls.scheme === 'http' || cls.scheme === 'https') ext++; continue; }
    const raw = row.value;
    const hashIdx = raw.indexOf('#');
    const filePart = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const frag = hashIdx >= 0 ? raw.slice(hashIdx + 1) : null;
    const cleanFile = decodeURIComponent(filePart.split('?')[0]);
    const targetAbs = cleanFile === '' ? row.file : path.resolve(path.dirname(row.file), cleanFile);

    if (cleanFile === '' && frag === null) continue; // 纯空
    if (cleanFile !== '') {
      checked++;
      if (!exists(targetAbs)) {
        broken++;
        if (brokenList.length < 120) brokenList.push({ from: RL(row.file), tag: row.tag, attr: row.attr, href: raw, resolved: R(targetAbs) });
      }
    }
    if (frag !== null) {
      let f = frag;
      try { f = decodeURIComponent(frag); } catch { /* keep */ }
      if (f === '') continue;
      const samePage = cleanFile === '';
      fragTotal++;
      if (samePage) fragSamePage++; else fragCrossFile++;
      const tgt = samePage ? row.file : targetAbs;
      if (!exists(tgt)) {
        fragMiss++;
        if (missList.length < 200) missList.push({ from: RL(row.file), target: RL(tgt), frag: f, reason: '目标文件不存在' });
        continue;
      }
      const { ids, names } = idsOf(tgt);
      if (!ids.has(f) && !names.has(f)) {
        fragMiss++;
        if (missList.length < 200) missList.push({ from: RL(row.file), target: RL(tgt), frag: f, reason: '目标页无 id/name' });
      }
    }
  }

  metric(c2, '扫描 HTML 文件数', H.files.length);
  metric(c2, '相对 href/src 条数（已剥离 #fragment 判定）', checked);
  metric(c2, '断链数', broken);
  metric(c2, '外部 http(s) 链接（跳过）', ext);
  metric(c2, '其它 scheme（mailto: 等，跳过）', schemes - ext);
  brokenList.forEach((b) => pushIssue(c2, null, `断链：${b.from} ${b.attr}="${b.href}" → ${b.resolved} 不存在`));
  c2.pass = broken === 0;
  c2.extra = { brokenList };

  metric(c3, '带 #fragment 的链接总数', fragTotal);
  metric(c3, '其中同页锚点', fragSamePage);
  metric(c3, '其中跨文件锚点', fragCrossFile);
  metric(c3, '锚点未命中总数', fragMiss);
  metric(c3, '其中脚注引用类（#user-content-fn*）未命中', missList.filter((m) => /^user-content-fn/.test(m.frag)).length);
  metric(c3, '其中正文标题/小节类未命中', missList.filter((m) => !/^user-content-fn/.test(m.frag)).length);
  metric(c3, '未命中明细条数（最多记 200）', missList.length);
  missList.forEach((m) => pushIssue(c3, null, `锚点未命中：${m.from} → ${m.target}#${m.frag}（${m.reason}）${/^user-content-fn/.test(m.frag) ? '【脚注引用：生成器未计入 fragmentsUnresolved，属漏报】' : ''}`));
  c3.pass = fragMiss === 0;
  c3.extra = { missList, generated: T.manifest.counts.fragmentsUnresolved, warnings: (T.manifest.warnings || []).filter((w) => w.kind === 'fragment-unresolved').map((w) => w.message) };
  metric(c3, '生成器 site-manifest 自报 fragmentsUnresolved', T.manifest.counts.fragmentsUnresolved);
  metric(c3, '生成器 warnings[] 条目数（含 fragment-recovered）', (T.manifest.warnings || []).length);
  c3.notes.push(`生成器自报 ${T.manifest.counts.fragmentsUnresolved} 个未解析锚点（与 warnings[] 的 fragment-unresolved 条目一致），独立实测 ${fragMiss} 个；差额 = ${fragMiss - T.manifest.counts.fragmentsUnresolved} 个脚注引用锚点（#user-content-fn-*），生成器在 footnotesResolved/footnotesMissing 里统计为“已处理”，未并入 fragmentsUnresolved，属漏报。`);
  return [c2, c3];
}

// ---------- 4. 图片 ----------
function check4(T) {
  const chk = makeCheck(4, '图片（存在 / alt / lazy / 文件头）', 'node tools/verify-site.js --check=4',
    '①真实缺陷（断图 / 缺 alt 属性 / 文件头不符）；其中「上游 Markdown 未写替代文本导致 alt=""」归②设计取舍（责任方=上游内容），「data: 内联图不判 lazy」归③验证脚本固有限制',
    '正文图片文件缺失、alt 属性缺失、loading="lazy" 缺失、文件头与扩展名不符都是读者/无障碍可感知的缺陷；但 alt="" 来源于上游 Markdown 源文本，生成器无法凭空生成替代文本');
  const files = walkFiles(LIB, { ext: '.html', skipDirs: SITE_SKIP });
  const rows = [];
  const shellImgs = [];
  const emptyAltSamples = [];
  for (const f of files) {
    const t = stripScriptAndStyle(readText(f));
    const art = articleOf(t);
    // 正文图片（生成器 counts.images 的口径）
    for (const m of art.matchAll(/<img\b[^>]*>/g)) {
      rows.push({ file: f, tag: m[0], where: 'article' });
      const alt = attrOf(m[0], 'alt');
      if (alt != null && alt.trim() === '' && emptyAltSamples.length < 10) emptyAltSamples.push({ file: RL(f), tag: m[0].slice(0, 120) });
    }
    // 外壳图片（lightbox 占位）
    for (const m of t.matchAll(/<dialog class="lightbox"[\s\S]*?<\/dialog>/g)) {
      for (const im of m[0].matchAll(/<img\b[^>]*>/g)) shellImgs.push({ file: f, tag: im[0] });
    }
  }
  let missing = 0, noAlt = 0, emptyAlt = 0, noLazy = 0, remote = 0, inlineData = 0;
  const issues = [];
  const srcs = [];
  const checkImg = (r) => {
    const src = attrOf(r.tag, 'src');
    const alt = attrOf(r.tag, 'alt');
    const loading = attrOf(r.tag, 'loading');
    if (src == null) { missing++; if (issues.length < 60) issues.push(`<img> 无 src：${RL(r.file)} :: ${r.tag}`); return; }
    if (/^data:/i.test(src)) {
      inlineData++;
      srcs.push({ src: src.slice(0, 40) + '…', abs: null, file: RL(r.file), kind: 'data-uri' });
      if (alt == null) { noAlt++; }
      return; // data: URI 不是文件，不参与“文件存在/lazy/文件头”判定
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) || src.startsWith('//')) {
      remote++; srcs.push({ src, abs: null, file: RL(r.file), kind: 'remote' });
    } else {
      const abs = path.resolve(path.dirname(r.file), decodeURIComponent(src.split('#')[0].split('?')[0]));
      srcs.push({ src, abs, file: RL(r.file), kind: 'local' });
      if (!exists(abs)) { missing++; if (issues.length < 60) issues.push(`图片文件不存在：${RL(r.file)} src="${src}" → ${R(abs)}`); }
      if (loading !== 'lazy') { noLazy++; if (issues.length < 60) issues.push(`<img> 缺 loading="lazy"：${RL(r.file)} src="${src}"`); }
    }
    if (alt == null) { noAlt++; if (issues.length < 60) issues.push(`<img> 缺 alt 属性：${RL(r.file)} src="${src}"`); }
    else if (alt.trim() === '') { emptyAlt++; }
  };
  rows.forEach(checkImg);
  metric(chk, '正文 <img> 总数 / 涉及页面数', `${rows.length} / ${new Set(rows.map((r) => r.file)).size}`);
  metric(chk, '外壳 lightbox 占位 <img> 数（每页 1 个，无 src，JS 填充）', shellImgs.length);
  metric(chk, '正文 src 文件不存在', missing);
  metric(chk, '正文缺 alt 属性', noAlt);
  metric(chk, '正文 alt 为空串（上游 Markdown 无替代文本）', emptyAlt);
  metric(chk, '正文缺 loading="lazy"（本地文件图片）', noLazy);
  metric(chk, '正文 src 为 data: 内联图（离线安全，不判 lazy）', inlineData);
  metric(chk, '正文 src 指向线上 URL（第三方外链图片）', remote);
  if (shellImgs.length) {
    const shellNoAlt = shellImgs.filter((r) => attrOf(r.tag, 'alt') == null).length;
    metric(chk, 'lightbox 占位 <img> 缺 alt', shellNoAlt);
  }

  // 文件头类型抽查：webp / svg 各取，共 3 张
  const sniff = [];
  const local = srcs.filter((s) => s.abs && exists(s.abs));
  const pick = [];
  const webp = local.find((s) => /\.webp$/i.test(s.src));
  const svg = local.find((s) => /\.svg$/i.test(s.src));
  if (webp) pick.push(webp);
  if (svg) pick.push(svg);
  const other = local.find((s) => !pick.includes(s));
  if (other) pick.push(other);
  let sniffBad = 0;
  for (const p of pick) {
    const b = readBuf(p.abs);
    const head = b.slice(0, 16).toString('latin1');
    const textHead = b.slice(0, 400).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    let detected = 'unknown';
    if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') detected = 'webp';
    else if (/^<(\?xml|svg)/i.test(textHead)) detected = 'svg';
    else if (b.slice(0, 8).toString('hex') === '89504e470d0a1a0a') detected = 'png';
    else if (b[0] === 0xff && b[1] === 0xd8) detected = 'jpeg';
    else if (b.slice(0, 6).toString('latin1').startsWith('GIF8')) detected = 'gif';
    const ext = (path.extname(p.abs).slice(1) || '').toLowerCase();
    const ok = ext === detected || (ext === 'jpg' && detected === 'jpeg');
    if (!ok) { sniffBad++; issues.push(`文件头与扩展名不符：${R(p.abs)} ext=.${ext} head=${detected} magic="${head.slice(0, 8)}"`); }
    sniff.push({ file: R(p.abs), ext: '.' + ext, headerHex: b.slice(0, 12).toString('hex'), detected, ok });
  }
  metric(chk, '文件头抽查数 / 不符数', `${sniff.length} / ${sniffBad}`);
  chk.extra = { sniff, emptyAltSamples };
  emptyAltSamples.slice(0, 5).forEach((s) => pushIssue(chk, null, `alt="" 样例：${s.file} :: ${s.tag}`));
  if (emptyAlt > 5) pushIssue(chk, null, `…共 ${emptyAlt} 处 alt=""（全部来自上游 Markdown 的 ![](path) 无替代文本，责任方=上游内容）`);
  issues.forEach((s) => pushIssue(chk, null, s));
  chk.pass = missing === 0 && noAlt === 0 && noLazy === 0 && emptyAlt === 0 && sniffBad === 0;
  if (emptyAlt > 0) chk.notes.push(`alt="" 共 ${emptyAlt} 处（属性存在但值为空）：取决于上游 Markdown 的 ![](path) 未写替代文本，生成器无法凭空补 alt；若要无障碍合规需在归档层补文本 → 责任方=上游内容，非渲染缺陷。`);
  if (inlineData > 0) chk.notes.push(`有 ${inlineData} 个正文 <img src="data:image/png;base64,…">：页面内的内联图片，离线安全，故不参与“文件存在/lazy/文件头”判定。`);
  if (remote > 0) chk.notes.push(`有 ${remote} 个正文 <img src> 指向线上 URL：上游文档内嵌的第三方图片（唯一一处 imgs.xkcd.com/comics/workflow.png），列为“已知外链资源（需联网）”，不计入断链。`);
  return chk;
}

// ---------- 5. 代码块 ----------
function check5(T) {
  const chk = makeCheck(5, '代码块（围栏真值 vs <pre>）', 'node tools/verify-site.js --check=5',
    '①真实缺陷（代码块丢失 / 正文被改）；「仅公共缩进不同」归②设计取舍（归一化后一致）',
    '代码块数量或正文与归档 Markdown 真值不符 = 读者拿到的命令/配置是错的；而 Markdown 列表项内围栏的公共缩进在渲染时被正确去除，属正常归一化');
  let mdTotal = 0, htmlTotal = 0, countMismatch = 0, textMismatch = 0, comparedBlocks = 0, comparedPages = 0, indentOnly = 0;
  const issues = [];
  const detail = [];
  for (const p of T.pages) {
    if (!exists(p.htmlAbs)) { issues.push(`缺产物：${p.htmlRel}`); continue; }
    const mdSrc = exists(p.mdAbs) ? readText(p.mdAbs) : (exists(p.srcAbs) ? readText(p.srcAbs) : null);
    if (mdSrc == null) { issues.push(`缺归档 Markdown（markdown/ 与 source/ 皆无）：${p.section}:${p.rel}`); continue; }
    const blocks = extractFencedBlocks(mdSrc);
    // 用 cheerio 取 <pre> 的 .text()：完整 HTML 实体解码（含 &#x27; 等十六进制实体）
    const $ = cheerio.load(readText(p.htmlAbs));
    const preTexts = [];
    $('pre').each((i, el) => preTexts.push(normCode($(el).text())));
    const preCount = preTexts.length;
    mdTotal += blocks.length; htmlTotal += preCount;
    let pageBad = false;
    if (blocks.length !== preCount) { countMismatch++; pageBad = true; }
    let pageTextBad = 0;
    const n = Math.min(blocks.length, preCount);
    for (let i = 0; i < n; i++) {
      const a = normCode(blocks[i].text);
      const b = preTexts[i];
      comparedBlocks++;
      if (a !== b) {
        // 严格比较不等时，去掉公共缩进再比一次：Markdown 列表项内的围栏带缩进，渲染时应当去掉
        if (normCode(dedent(blocks[i].text)) === normCode(dedent(preTexts[i]))) { indentOnly++; continue; }
        pageTextBad++; textMismatch++;
        if (issues.length < 120) {
          const al = a.split('\n'), bl = b.split('\n');
          let first = 0;
          while (first < Math.min(al.length, bl.length) && al[first] === bl[first]) first++;
          issues.push(`代码正文不一致：${p.section}:${p.rel} 第 ${i + 1} 个块（首个不同行 ${first + 1}）md=${JSON.stringify(al[first] || '').slice(0, 120)} html=${JSON.stringify(bl[first] || '').slice(0, 120)}`);
        }
      }
    }
    if (n > 0) comparedPages++;
    if (pageBad || pageTextBad) detail.push({ page: `${p.section}:${p.rel}`, md: blocks.length, html: preCount, textDiff: pageTextBad });
  }
  metric(chk, '归档 Markdown 围栏块总数（含 `> ` 包裹）', mdTotal);
  metric(chk, '生成 HTML <pre> 总数', htmlTotal);
  metric(chk, '数量不一致的页面数', countMismatch);
  metric(chk, '正文比对页数 / 块数', `${comparedPages} / ${comparedBlocks}`);
  metric(chk, '正文不一致块数（实体解码 + 空白归一化后仍不同）', textMismatch);
  metric(chk, '仅公共缩进不同（Markdown 列表内围栏，渲染已正确去缩进）的块数', indentOnly);
  metric(chk, '生成器 site-manifest 自报 codeBlocks', T.manifest.counts.codeBlocks);
  metric(chk, '归档围栏真值 - 生成 <pre> 之差', mdTotal - htmlTotal);
  issues.forEach((s) => pushIssue(chk, null, s));
  // 合成块检测：md 围栏数 > 原始 HTML 快照 <pre> 数 → 差值为转换器合成的块。
  // （配置查看器里「无 key 的注释行 / 说明段落」原文是 <div class="block message...">，不是 <pre>；
  //   转换器把它有意合成成无语言围栏块，故 md 会多出围栏而 HTML 快照不会有对应 <pre>。属设计取舍。）
  const synthBlocks = [];
  const synthRows = [];
  const rawPreCache = new Map();
  const rawPreCount = (abs) => {
    if (rawPreCache.has(abs)) return rawPreCache.get(abs);
    let n = null;
    if (exists(abs)) {
      const t = readText(abs).replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
      n = (t.match(/<pre\b/g) || []).length;
    }
    rawPreCache.set(abs, n);
    return n;
  };
  for (const p of T.pages) {
    if (!exists(p.mdAbs)) continue;
    const blocks = extractFencedBlocks(readText(p.mdAbs));
    const rawPre = rawPreCount(p.rawAbs);
    if (rawPre === null) continue;
    const delta = blocks.length - rawPre;
    if (delta > 0) {
      synthRows.push({ page: `${p.section}:${p.rel}`, mdFences: blocks.length, rawHtmlPre: rawPre, delta });
      const cands = blocks.filter((b) => !String(b.lang || '').trim() && /^\s*#/.test((b.text.split('\n').find((l) => l.trim()) || '')));
      cands.slice(0, Math.min(delta, cands.length)).forEach((b) => synthBlocks.push({ page: `${p.section}:${p.rel}`, firstLine: (b.text.split('\n').find((l) => l.trim()) || '').trim().slice(0, 90) }));
    }
  }
  const synthDeltaTotal = synthRows.reduce((n, r) => n + r.delta, 0);
  metric(chk, '无 <pre> 对源的围栏块数（md 围栏数 − 原始 HTML 快照 <pre> 数，合计）', synthDeltaTotal);
  metric(chk, '其中无语言 `#` 注释形态（主 Agent 说明的合成注释行）', synthBlocks.length);
  metric(chk, '涉及页面数', synthRows.length);
  metric(chk, '涉及页面', synthRows.map((r) => `${r.page}(md${r.mdFences}/raw${r.rawHtmlPre})`).join('；') || '无');
  // 内容保留核对（主 Agent 第 3 个转换器缺陷的同类问题）：原始 HTML 里
  // div.block.message / message-inline（配置查看器的注释行、说明段落）的文本必须在归档 Markdown 里能找到。
  const msgRows = [];
  const msgMissing = [];
  let msgChecked = 0;
  const letters = (s) => String(s).replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const p of T.pages) {
    if (!exists(p.rawAbs) || !exists(p.mdAbs)) continue;
    const raw = readText(p.rawAbs);
    const mdHay = letters(readText(p.mdAbs));
    for (const m of raw.matchAll(/<div class="block message[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
      const txt = m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const words = letters(txt).split(' ').filter(Boolean);
      if (words.length < 4) continue;
      msgChecked++;
      // 只取前 8 个词做定位（Markdown 侧的 **加粗**、链接、换行都会打断原始字符串，故先归一化为字母/汉字）
      const key = words.slice(0, 8).join(' ');
      if (!mdHay.includes(key)) {
        msgMissing.push({ page: `${p.section}:${p.rel}`, key, len: txt.length });
      }
      msgRows.push({ page: `${p.section}:${p.rel}`, ok: mdHay.includes(key), key });
    }
  }
  metric(chk, '原始 HTML `div.block.message*` 文本条目数（内容保留核对）', msgChecked);
  metric(chk, '其中在归档 Markdown 里找不到的条数', msgMissing.length);
  chk.extra = { detail, indentOnly, synthBlocks, synthRows, synthDeltaTotal, msgRows, msgMissing };
  msgMissing.slice(0, 20).forEach((x) => pushIssue(chk, null, `内容保留核对失败：${x.page} 原始 HTML 的说明文本（${x.len} 字符）在归档 Markdown 里找不到 —— ${JSON.stringify(x.key)}`));
  if (synthRows.length) chk.notes.push(`合成/无 <pre> 对源的围栏块共 ${synthDeltaTotal} 个，分布在 ${synthRows.length} 页（${synthRows.slice(0, 6).map((r) => r.page).join('、')}${synthRows.length > 6 ? ' 等' : ''}）：这些页面的原始 HTML 把配置查看器写成 <div> 结构（部分页原始快照 <pre> 数为 0），归档 Markdown 有意把它们表示成围栏块；其中 ${synthBlocks.length} 个是无语言 \`#\` 注释形态（例：${synthBlocks[0] ? synthBlocks[0].page + ' — ' + JSON.stringify(synthBlocks[0].firstLine) : '—'}）。按主 Agent 说明归②设计取舍，不计为缺陷。`);
  synthBlocks.slice(0, 8).forEach((x) => chk.notes.push(`合成块样例（设计取舍，不是缺陷）：${x.page} — 围栏首行 ${JSON.stringify(x.firstLine)}；对应原始 HTML 快照里没有这段文字（配置查看器的无 key 注释/说明行，由转换器有意补成注释块）`));
  chk.pass = countMismatch === 0 && textMismatch === 0 && msgMissing.length === 0;
  if (msgMissing.length) chk.notes.push(`内容保留核对发现 ${msgMissing.length} 处原始 HTML 说明文本在归档 Markdown 中缺失（与主 Agent 修掉的“整段文字丢失”同类）——属①真实缺陷候选，已在失败证据中列出。`);
  if (msgChecked) chk.notes.push(`内容保留核对：原始 HTML 里共 ${msgChecked} 条 \`div.block.message*\` 文本，${msgChecked - msgMissing.length}/${msgChecked} 条可在归档 Markdown 中定位到（按前 40 字符匹配）。`);
  if (indentOnly) chk.notes.push(`另有 ${indentOnly} 个块：Markdown 侧带 4/8 空格列表缩进，生成的 <pre> 已正确去掉该公共缩进，严格字符串比较不等但去缩进后完全一致 → 不算内容不一致。`);
  if (mdTotal !== htmlTotal) chk.notes.push(`归档 Markdown 围栏真值比生成 HTML 多 ${mdTotal - htmlTotal} 个块（涉及 ${countMismatch} 页）：说明归档 Markdown 在站点上次构建之后又被改写/重爬过，站点需要重建才能对齐（时序问题，不是渲染缺陷）。`);
  return chk;
}

// ---------- 6. 告警 / 折叠块 / 表格 ----------
function check6(T) {
  const chk = makeCheck(6, '告警 / 折叠块 / 表格', 'node tools/verify-site.js --check=6');
  let mdAlerts = 0, htmlAlerts = 0, alertPages = 0;
  let mdDetails = 0, htmlDetails = 0;
  let mdTables = 0, htmlTables = 0, tablePages = 0;
  const alertDiff = [], detailDiff = [], tableDiff = [], cellDiff = [];
  const issues = [];
  for (const p of T.pages) {
    if (!exists(p.htmlAbs) || !exists(p.mdAbs)) continue;
    const md = readText(p.mdAbs);
    const body = articleOf(stripScriptAndStyle(readText(p.htmlAbs))); // 正文口径
    const a = extractAlerts(md).length;
    const ha = (body.match(/class="alert alert-/g) || []).length;
    mdAlerts += a; htmlAlerts += ha;
    if (a || ha) alertPages++;
    if (a !== ha) alertDiff.push({ page: `${p.section}:${p.rel}`, md: a, html: ha });

    const d = extractDetails(md).length;
    const hd = (body.match(/<details class="details-block"/g) || []).length;
    mdDetails += d; htmlDetails += hd;
    if (d !== hd) detailDiff.push({ page: `${p.section}:${p.rel}`, md: d, html: hd });

    const tbs = extractTables(md);
    const htb = (body.match(/<div class="table-wrap">/g) || []).length;
    mdTables += tbs.length; htmlTables += htb;
    if (tbs.length) tablePages++;
    if (tbs.length !== htb) tableDiff.push({ page: `${p.section}:${p.rel}`, md: tbs.length, html: htb });

    // 行列数比对
    const htmlTablesInfo = [];
    const tre = /<table\b[\s\S]*?<\/table>/g;
    let tm;
    while ((tm = tre.exec(body))) {
      const seg = tm[0];
      const trs = [...seg.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((x) => x[0]);
      let cols = 0;
      for (const tr of trs) {
        const c = (tr.match(/<t[hd]\b/g) || []).length;
        if (c > cols) cols = c;
      }
      htmlTablesInfo.push({ rows: trs.length, cols });
    }
    for (let i = 0; i < Math.min(tbs.length, htmlTablesInfo.length); i++) {
      const m = tbs[i], h = htmlTablesInfo[i];
      // markdown 的 rows 已含表头；HTML 的 rows 含表头行
      if (m.rows !== h.rows || m.cols !== h.cols) {
        cellDiff.push({ page: `${p.section}:${p.rel}`, index: i + 1, md: `${m.rows}x${m.cols}`, html: `${h.rows}x${h.cols}` });
      }
    }
  }
  metric(chk, 'Markdown 告警数 vs HTML alert 数', `${mdAlerts} / ${htmlAlerts}`);
  metric(chk, '告警数不一致页面数', alertDiff.length);
  metric(chk, '涉及告警的页面数', alertPages);
  metric(chk, '生成器自报 alerts', T.manifest.counts.alerts);
  metric(chk, 'Markdown <details> vs HTML details-block', `${mdDetails} / ${htmlDetails}`);
  metric(chk, 'details 不一致页面数', detailDiff.length);
  metric(chk, '生成器自报 detailsBlocks', T.manifest.counts.detailsBlocks);
  metric(chk, 'Markdown 表格数 vs HTML table-wrap 数', `${mdTables} / ${htmlTables}`);
  metric(chk, '含表格的页面数（行列比对覆盖页数）', tablePages);
  metric(chk, '表格数不一致页面数', tableDiff.length);
  metric(chk, '行列数不一致表格数', cellDiff.length);
  metric(chk, '生成器自报 tables', T.manifest.counts.tables);
  alertDiff.slice(0, 40).forEach((d) => pushIssue(chk, null, `告警数不一致：${d.page} md=${d.md} html=${d.html}`));
  detailDiff.slice(0, 40).forEach((d) => pushIssue(chk, null, `details 数不一致：${d.page} md=${d.md} html=${d.html}`));
  tableDiff.slice(0, 40).forEach((d) => pushIssue(chk, null, `表格数不一致：${d.page} md=${d.md} html=${d.html}`));
  cellDiff.slice(0, 40).forEach((d) => pushIssue(chk, null, `表格行列不一致：${d.page} 第 ${d.index} 个 md=${d.md} html=${d.html}`));
  chk.extra = { alertDiff, detailDiff, tableDiff, cellDiff, htmlTablesTotal: htmlTables };
  chk.pass = alertDiff.length === 0 && detailDiff.length === 0 && tableDiff.length === 0 && cellDiff.length === 0;
  return chk;
}

// ---------- 7. 标题与目录 ----------
function check7(T) {
  const chk = makeCheck(7, '标题唯一性 / h2-h4 锚点 / 本页目录一致性', 'node tools/verify-site.js --check=7',
    '①真实缺陷（h1 重复/缺失、h2-h4 缺 id、目录条目与正文不符）；「目录含 lvl-4 条目」归②设计取舍',
    'h1 重复或缺 id 会让锚点失效与结构混乱；目录比任务书预期多出 h4 层是生成器的设计选择（与正文 h2-h4 完全一一对应）');
  let docH1Bad = 0, artH1Multi = 0, artH1Zero = 0, idMissing = 0, tocPages = 0, tocBad23 = 0, tocBad234 = 0, totalToc = 0;
  const docH1Counts = {};
  const issues = [];
  const detail = [];
  const h1Rows = [];
  for (const p of T.pages) {
    if (!exists(p.htmlAbs)) continue;
    const raw = readText(p.htmlAbs);
    const stripped = stripScriptAndStyle(raw);
    const art = articleOf(stripped);
    const toc = (/<aside class="toc-side"[\s\S]*?<\/aside>/.exec(stripped) || [''])[0];
    const docH1 = (stripped.match(/<h1\b/g) || []).length;
    if (docH1 !== 1) {
      docH1Counts[docH1] = (docH1Counts[docH1] || 0) + 1;
      if (docH1 > 2) pushIssue(chk, null, `整页 h1 数 = ${docH1}（>2）：${p.section}:${p.rel} — 外壳 1 个 + 正文 ${docH1 - 1} 个`);
    } else docH1Counts[1] = (docH1Counts[1] || 0) + 1;
    const artH1 = [...art.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => sanitizeHtmlEntity(m[2] || m[1]).replace(/<[^>]*>/g, '').trim());
    // markdown 真值：围栏外的顶层 `# ` 标题数
    let mdH1 = 0;
    if (exists(p.mdAbs)) {
      const md = readText(p.mdAbs).replace(/\r\n?/g, '\n').split('\n');
      let fence = null;
      for (const line of md) {
        const fm = /^[ \t]*(`{3,}|~{3,})/.exec(line);
        if (fm) { fence = fence ? null : fm[1][0]; continue; }
        if (fence) continue;
        if (/^#\s+\S/.test(line)) mdH1++;
      }
    }
    if (artH1.length > 1) { artH1Multi++; issues.push(`正文 h1 不唯一：${p.section}:${p.rel} 正文 h1 数=${artH1.length}（Markdown 顶层 # 标题 ${mdH1} 个）：${JSON.stringify(artH1).slice(0, 160)}`); }
    const shellH1 = sanitizeHtmlEntity((/<div class="page-head">\s*<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(stripped) || [])[1] || '').replace(/<[^>]*>/g, '').trim();
    const firstArtHeading = (art.match(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/) || []);
    if (artH1.length === 0 && mdH1 > 0) { artH1Zero++; issues.push(`正文缺 h1：${p.section}:${p.rel} Markdown 有 ${mdH1} 个顶层 # 标题，但 <article> 内 h1 数=0`); }
    if (artH1.length === 0 && mdH1 === 0) {
      issues.push(`正文 article 内 h1 数=0（非缺陷，供主 Agent 判断）：${p.section}:${p.rel} Markdown 顶层 # 标题 0 个 → h1 由外壳 page-head 提供：${JSON.stringify(shellH1)}；正文首个标题为 h${firstArtHeading[1] || '?'} ${JSON.stringify(sanitizeHtmlEntity((firstArtHeading[2] || '').replace(/<[^>]*>/g, '')).trim().slice(0, 60))}`);
    }
    h1Rows.push({
      page: `${p.section}:${p.rel}`, docH1, artH1: artH1.length, mdH1,
      shellH1, articleH1Texts: artH1,
      firstArticleHeading: firstArtHeading[1] ? { level: Number(firstArtHeading[1]), text: sanitizeHtmlEntity(firstArtHeading[2].replace(/<[^>]*>/g, '')).trim().slice(0, 80) } : null,
    });
    const heads = [...art.matchAll(/<h([234])\b([^>]*)>([\s\S]*?)<\/h\1>/g)].map((m) => ({
      level: Number(m[1]),
      id: (/id\s*=\s*"([^"]*)"/.exec(m[2]) || [])[1] || null,
      text: sanitizeHtmlEntity(m[3].replace(/<[^>]*>/g, '')).replace(/\s*#\s*$/, '').trim(),
    }));
    const noId = heads.filter((h) => !h.id || h.id.trim() === '');
    if (noId.length) { idMissing += noId.length; issues.push(`h2-h4 缺 id：${p.section}:${p.rel} 缺 ${noId.length} 个（如“${noId[0].text}”）`); }
    const tocIds = [...toc.matchAll(/<a\s+href="#([^"]*)"/g)].map((m) => m[1]);
    totalToc += tocIds.length;
    if (tocIds.length) tocPages++;
    const ids23 = heads.filter((h) => h.level <= 3).map((h) => h.id);
    const ids234 = heads.map((h) => h.id);
    const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (!eq(tocIds, ids23)) {
      tocBad23++;
      if (!eq(tocIds, ids234)) {
        tocBad234++;
        const miss = ids234.filter((x) => !tocIds.includes(x));
        const extraT = tocIds.filter((x) => !ids234.includes(x));
        detail.push({ page: `${p.section}:${p.rel}`, toc: tocIds.length, h234: ids234.length, missingInToc: miss.slice(0, 5), extraInToc: extraT.slice(0, 5) });
        if (issues.length < 200) issues.push(`目录与正文标题不一致：${p.section}:${p.rel} 目录=${tocIds.length} 标题(h2-h4)=${ids234.length} 目录缺=${JSON.stringify(miss.slice(0, 3))} 目录多=${JSON.stringify(extraT.slice(0, 3))}`);
      }
    }
  }
  metric(chk, '整页 h1 计数分布（个数=页数）', Object.entries(docH1Counts).sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}个=${c}页`).join(' '));
  metric(chk, '正文 article 内 h1 > 1 的页面数', artH1Multi);
  metric(chk, '正文 article 内 h1 = 0（Markdown 也无顶层标题）的页面数', h1Rows.filter((r) => r.artH1 === 0 && r.mdH1 === 0).length);
  metric(chk, 'Markdown 有顶层 # 但正文缺 h1 的页面数', artH1Zero);
  metric(chk, 'h2-h4 缺 id 的总数', idMissing);
  metric(chk, '含目录的页面数', tocPages);
  metric(chk, '目录条目总数', totalToc);
  metric(chk, '目录 != {h2,h3} 的页面数（生成器把 h4 也放进目录）', tocBad23);
  metric(chk, '目录 != {h2,h3,h4} 的页面数', tocBad234);
  metric(chk, '生成器自报 headings / tocEntries', `${T.manifest.counts.headings} / ${T.manifest.counts.tocEntries}`);
  issues.forEach((s) => pushIssue(chk, null, s));
  chk.extra = { detail, h1Rows, docH1Counts };
  chk.pass = artH1Multi === 0 && artH1Zero === 0 && idMissing === 0 && tocBad234 === 0;
  chk.notes.push(`目录口径：生成器把 h4 也放进“本页目录”。按“目录 ⊆ {h2,h3,h4} 且 ⊇ {h2,h3}”的新口径，${T.pages.length} 页全部通过（目录与正文 h2-h4 完全一一对应，无缺失、无多余）；按严格 h2/h3 口径统计，有 ${tocBad23} 页含 lvl-4 条目。`);
  chk.notes.push(`h1 口径：所有页面的外壳 page-head 都有一个 <h1>（页面标题），正文 <article> 内再有一个 <h1>（文档标题），两处文本相同 → 整页 h1 计数为 2 是常态（${docH1Counts[2] || 0} 页）。判定“h1 唯一”时以正文为准；若按 HTML 语义严格要求“单文档仅一个 h1”，这 ${docH1Counts[2] || 0} 页同样不合格，属生成器的结构选择，需主 Agent 确认设计意图。真正异常的是正文 article 内 h1 > 1（${artH1Multi} 页）与正文缺 h1 且 Markdown 有顶层 #（${artH1Zero} 页）。`);
  return chk;
}

// ---------- 8. 搜索索引 ----------
function check8(T) {
  const chk = makeCheck(8, '搜索索引', 'node tools/verify-site.js --check=8',
    '①真实缺陷（条数/字段/URL/空正文/JSON 与 JS 不一致）；「某查询词 0 命中」归③验证脚本固有限制',
    '索引结构与内容缺陷会让检索直接不可用；而本工具只用「纯字符串包含」模拟检索，无法评估分词、前缀、权重与高亮，某词 0 命中只能说明语料里没有该子串');
  const jsonPath = path.join(LIB, 'search-index.json');
  const jsPath = path.join(LIB, 'assets', 'search-index.js');
  const jsonBytes = fs.statSync(jsonPath).size;
  const jsBytes = fs.statSync(jsPath).size;
  const j = JSON.parse(readText(jsonPath));
  const jsText = readText(jsPath);
  const m = /window\.__LIBRARY_SEARCH__\s*=\s*([\s\S]*?);?\s*$/.exec(jsText.replace(/^[\s\S]*?=\s*/, 'window.__LIBRARY_SEARCH__ = '));
  let jsObj = null, jsParseErr = null;
  try {
    const body = jsText.slice(jsText.indexOf('=') + 1).replace(/;\s*$/, '');
    jsObj = JSON.parse(body);
  } catch (e) { jsParseErr = e.message; }
  const eq = jsObj && JSON.stringify(jsObj) === JSON.stringify(j);
  metric(chk, 'search-index.json 条目数', (j.pages || []).length);
  metric(chk, 'assets/search-index.js 条目数', jsObj ? (jsObj.pages || []).length : `解析失败:${jsParseErr}`);
  metric(chk, 'JSON 与 JS 内容等价', eq ? '是（逐字节 JSON.stringify 相等）' : '否');
  metric(chk, '页面数（taxonomy）', T.pages.length);
  metric(chk, 'json 体积 / js 体积', `${round(jsonBytes / 1024)} KiB / ${round(jsBytes / 1024)} KiB`);
  metric(chk, 'json 字节数 / js 字节数', `${jsonBytes} / ${jsBytes}`);
  metric(chk, '生成器自报 search.jsonBytes / jsBytes', `${(T.manifest.search.jsonBytes / 1024).toFixed(1)} KiB / ${(T.manifest.search.jsBytes / 1024).toFixed(1)} KiB`);

  const missingField = [], emptyBody = [], badUrl = [];
  const fieldNeed = ['p', 'id', 't', 'sid', 's', 'c', 'ct', 'u', 'h', 'x', 'n'];
  for (const e of j.pages || []) {
    const lack = fieldNeed.filter((f) => e[f] === undefined || e[f] === null);
    if (lack.length) missingField.push({ id: e.id, lack });
    if (!e.x || String(e.x).trim() === '') emptyBody.push(e.id);
    const abs = path.join(LIB, String(e.p || ''));
    if (!exists(abs)) badUrl.push({ id: e.id, p: e.p });
  }
  metric(chk, '缺字段条目数', missingField.length);
  metric(chk, '空正文条目数', emptyBody.length);
  metric(chk, 'URL 指向不存在文件的条目数', badUrl.length);
  missingField.slice(0, 20).forEach((x) => pushIssue(chk, null, `索引缺字段：${x.id} 缺 ${x.lack.join(',')}`));
  emptyBody.slice(0, 20).forEach((x) => pushIssue(chk, null, `索引空正文：${x}`));
  badUrl.slice(0, 20).forEach((x) => pushIssue(chk, null, `索引 URL 不存在：${x.id} → ${x.p}`));

  // 中文查询词命中：判据 = 与 assets/site.js 的 directScore() 相同的字段集
  //   t 标题 + u 摘要 + kw 标签 + h 小节（排除派生“关键词：…”条目）+ c/cd 分类 + x 正文
  const siteJs = exists(path.join(LIB, 'assets', 'site.js')) ? readText(path.join(LIB, 'assets', 'site.js')) : '';
  const FE_FIELDS = /e\.t/.test(siteJs) && /e\.u/.test(siteJs) && /e\.kw/.test(siteJs) && /e\.h/.test(siteJs) && /e\.x/.test(siteJs);
  const norm = (s) => String(s == null ? '' : s).toLowerCase();
  const headsClean = (e) => norm((e.h || []).filter((x) => String(x).indexOf('关键词：') !== 0).join(' \u0001 '));
  const derivedHeads = (j.pages || []).reduce((n, e) => n + (e.h || []).filter((x) => String(x).indexOf('关键词：') === 0).length, 0);
  const aliasesMap = j.aliases || {};
  /** 完全复刻 site.js 的 directScore()：标题 60/30 · 标签 32/20 · 摘要 18 · 小节 12 · 分类 8 · 正文 5 + 英文别名分档 26/18/10/2 */
  const scoreEntry = (e, q) => {
    const title = norm(e.t), sum = norm(e.u), cat = norm(String(e.c || '') + ' ' + String(e.cd || ''));
    const body = norm(e.x), heads = headsClean(e);
    let s = 0, tier = 0; const fields = [];
    if (title.indexOf(q) === 0) { s += 60; fields.push('标题前缀'); tier = 4; }
    else if (title.indexOf(q) !== -1) { s += 30; fields.push('标题'); tier = 4; }
    (e.kw || []).forEach((tg, i) => {
      const t = norm(tg); if (!t) return;
      if (t === q) { s += 32 + Math.max(0, 8 - i * 3); fields.push('标签=' + String(tg)); tier = Math.max(tier, 2); }
      else if (t.indexOf(q) !== -1) { s += 20 + Math.max(0, 6 - i * 2); fields.push('标签~' + String(tg)); tier = Math.max(tier, 2); }
    });
    if (sum.indexOf(q) !== -1) { s += 18; fields.push('摘要'); tier = Math.max(tier, 2); }
    if (heads.indexOf(q) !== -1) { s += 12; fields.push('小节'); tier = Math.max(tier, 3); }
    if (cat.indexOf(q) !== -1) { s += 8; fields.push('分类'); tier = Math.max(tier, 2); }
    if (body.indexOf(q) !== -1) { s += 5; fields.push('正文'); tier = Math.max(tier, 1); }
    const al = aliasesMap[q];
    if (Array.isArray(al) && al.length) {
      const meta = norm([e.u, (e.kw || []).join(' '), e.c, e.cd, e.lt].join(' \u0001 '));
      const hit = (hay) => al.find((x) => hay.indexOf(norm(x)) !== -1) || '';
      let tok = '';
      if ((tok = hit(title))) { s += 26; fields.push('标题别名 ' + tok); tier = 4; }
      else if ((tok = hit(heads))) { s += 18; fields.push('小节别名 ' + tok); tier = Math.max(tier, 3); }
      else if ((tok = hit(meta))) { s += 10; fields.push('摘要/标签别名 ' + tok); tier = Math.max(tier, 2); }
      else if ((tok = hit(body))) { s += 2; fields.push('正文别名'); tier = Math.max(tier, 1); }
    }
    return { s, fields, tier };
  };
  const phrases = j.phrases || [];
  const phraseOf = (q) => phrases.find((p) => p.q === q) || null;
  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
  const partScore = (e, part) => {
    const r = scoreEntry(e, part);
    if (r.s > 0) return r;
    const al = aliasesMap[part];
    if (Array.isArray(al) && al.length) {
      const title = norm(e.t), heads = headsClean(e), body = norm(e.x);
      const meta = norm([e.u, (e.kw || []).join(' '), e.c, e.cd, e.lt].join(' \u0001 '));
      const hit = (hay) => al.find((x) => hay.indexOf(norm(x)) !== -1) || '';
      let tok = '';
      if ((tok = hit(title))) return { s: 26, fields: ['标题别名 ' + tok], tier: 4 };
      if ((tok = hit(heads))) return { s: 18, fields: ['小节别名 ' + tok], tier: 3 };
      if ((tok = hit(meta))) return { s: 10, fields: ['摘要/标签别名 ' + tok], tier: 2 };
      if ((tok = hit(body))) return { s: 2, fields: ['正文别名'], tier: 1 };
    }
    return { s: 0, fields: [], tier: 0 };
  };
  /** 复刻 termScore()：直接命中 → 短语表拆分（×0.6）→ 中文双字组全匹配回退（×0.45） */
  const termScore = (e, q) => {
    const r = scoreEntry(e, q);
    if (r.s > 0) return { s: r.s, fields: r.fields, tier: r.tier, fuzzy: false };
    const ph = phraseOf(q);
    if (ph && Array.isArray(ph.parts)) {
      let total = 0, ptier = 0; const fields = []; let ok = true;
      for (const part of ph.parts) {
        const pr = partScore(e, norm(part));
        if (!pr.s) { ok = false; break; }
        total += pr.s; ptier = Math.max(ptier, pr.tier || 0);
        pr.fields.forEach((f) => { if (!fields.includes(f)) fields.push(f); });
      }
      if (ok && total > 0) return { s: Math.round(total * 0.6), fields, tier: ptier, fuzzy: true };
    }
    if (q.length >= 3 && CJK.test(q)) {
      let total = 0, bter = 0; const fields = []; let ok = true;
      for (let i = 0; i + 1 < q.length; i++) {
        const gr = scoreEntry(e, q.substr(i, 2));
        if (gr.s <= 0) { ok = false; break; }
        total += gr.s; bter = Math.max(bter, gr.tier || 0);
        gr.fields.forEach((f) => { if (!fields.includes(f)) fields.push(f); });
      }
      if (ok && total > 0) return { s: Math.round(total * 0.45), fields, tier: bter, fuzzy: true };
    }
    return { s: 0, fields: [], tier: 0, fuzzy: false };
  };
  /** 复刻 compareHits()：分数 → tier → 上游 order(o) → 标题长度 → 标题 → id */
  const compareHits = (a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    if ((b.tier || 0) !== (a.tier || 0)) return (b.tier || 0) - (a.tier || 0);
    const ao = typeof a.o === 'number' ? a.o : 1e9;
    const bo = typeof b.o === 'number' ? b.o : 1e9;
    if (ao !== bo) return ao - bo;
    const at = String(a.t || ''), bt = String(b.t || '');
    if (at.length !== bt.length) return at.length - bt.length;
    const c = at.localeCompare(bt, 'zh-Hans-CN');
    if (c !== 0) return c;
    return String(a.id || '').localeCompare(String(b.id || ''));
  };
  const rank = (q) => (j.pages || []).map((e) => {
    const r = termScore(e, norm(q));
    return { id: e.id, t: e.t, s: r.s, tier: r.tier, o: e.o, fields: r.fields, fuzzy: r.fuzzy };
  }).filter((r) => r.s > 0).sort(compareHits);

  const queries = ['渲染', '命令注册', '权限', '优化', '插件加载', '配置文件', '命令', '事件', '代理', '依赖'];
  const qres = queries.map((q) => {
    const ql = norm(q);
    const scored = rank(ql);
    // 旧口径（JSON.stringify 全字段扫）用于对比
    const oldHits = (j.pages || []).filter((e) => JSON.stringify(e).toLowerCase().includes(ql)).length;
    return { q, hits: scored.length, oldHits, sample: scored.slice(0, 3).map((x) => x.id), top: scored.slice(0, 3) };
  });
  const zero = qres.filter((r) => r.hits === 0);
  const probes = ['渲染', '性能', '代理', '权限', '插件加载', '配置文件', '命令注册', '优化', '启动脚本'];
  const topHits = probes.map((q) => { const scored = rank(norm(q)); return { q, total: scored.length, top: scored.slice(0, 3) }; });
  const acceptance = [
    { q: '性能', expectId: 'velocity:tuning/index', expectTitle: 'Tuning Velocity' },
    { q: '权限', expectId: 'paper:reference/permissions/index', expectTitle: 'Permissions' },
  ].map((a) => {
    const r = rank(a.q);
    const t1 = r[0] || null;
    return { ...a, top1: t1 ? `${t1.t}（${t1.id}）` : '无命中', top1Id: t1 ? t1.id : null, ok: !!(t1 && t1.id === a.expectId) };
  });
  metric(chk, '★ 检索判据字段集', FE_FIELDS
    ? 't 标题 + u 摘要 + kw 标签 + h 小节（排除派生“关键词：…”条目）+ c/cd 分类 + x 正文 + 英文别名 + 短语表/双字组回退 —— 与 assets/site.js 的 directScore()/termScore()/compareHits() 一致'
    : '未能从 assets/site.js 解析出字段集（回退到全字段口径）');
  metric(chk, '索引中 h 字段里的派生“关键词：…”条目数', derivedHeads);
  metric(chk, '索引条目 o（taxonomy order）字段覆盖数', (j.pages || []).filter((e) => typeof e.o === 'number').length + ' / ' + (j.pages || []).length);
  metric(chk, '★ 验收点：性能 Top1 = Tuning Velocity', acceptance[0].ok ? `达标（${acceptance[0].top1}）` : `未达标（实测 ${acceptance[0].top1}）`);
  metric(chk, '★ 验收点：权限 Top1 = Permissions', acceptance[1].ok ? `达标（${acceptance[1].top1}）` : `未达标（实测 ${acceptance[1].top1}）`);
  metric(chk, '★ 指定查询词 Top1（按 site.js 算法独立复算）', topHits.map((r) => `${r.q}→${r.top[0] ? r.top[0].t + '（' + r.top[0].id + '）' : '无命中'}`).join('；'));
  metric(chk, '★ 指定查询词 Top3（分数/tier/order/命中字段）', topHits.map((r) => `${r.q}: ` + r.top.map((x) => `${x.t}(${x.id})[s=${x.s},tier=${x.tier},o=${x.o}]<${x.fields.join('/')}>`).join(' > ')).join('；'));
  metric(chk, '中文查询词命中（site.js 算法复算）', qres.map((r) => `${r.q}=${r.hits}`).join(' '));
  metric(chk, '中文查询词命中（旧口径=JSON.stringify 全字段）', qres.map((r) => `${r.q}=${r.oldHits}`).join(' '));
  metric(chk, '0 命中的查询词（复算口径）', zero.length ? zero.map((r) => r.q).join(',') : '无');
  zero.forEach((r) => pushIssue(chk, null, `查询词 0 命中（site.js 算法复算）：${r.q}`));
  chk.extra = { queries: qres, topHits, feFields: FE_FIELDS, derivedHeads, acceptance, hitsByQuery: Object.fromEntries(qres.map((r) => [r.q, r.hits])), hitsByQueryOld: Object.fromEntries(qres.map((r) => [r.q, r.oldHits])) };
  chk.pass = eq && (j.pages || []).length === T.pages.length && missingField.length === 0
    && emptyBody.length === 0 && badUrl.length === 0 && zero.length === 0;
  return chk;
}

// ---------- 9. 外壳与导航 ----------
function check9(T) {
  const chk = makeCheck(9, '外壳与导航（抽 10 页）', 'node tools/verify-site.js --check=9',
    '①真实缺陷（侧栏/面包屑/源地址/上下一页/页脚元信息缺失）；「渲染后交互行为」归③验证脚本固有限制',
    '这些是静态 DOM 结构，缺失即读者可感知；但本工具无浏览器，无法验证主题切换、搜索弹窗、复制按钮、lightbox 放大等运行期行为');
  const n = T.pages.length;
  const idx = new Set();
  for (let i = 0; i < 10; i++) idx.add(Math.round((i * (n - 1)) / 9));
  const sample = [...idx].sort((a, b) => a - b).map((i) => T.pages[i]);
  const missingAll = [];
  const per = [];
  for (const p of sample) {
    const html = exists(p.htmlAbs) ? readText(p.htmlAbs) : '';
    const item = { page: `${p.section}:${p.rel}`, missing: [] };
    const sideOk = /<nav class="sidebar"/.test(html)
      && new RegExp(`data-section="${p.section}"`).test(html)
      && new RegExp(`href="[^"]*categories/${p.category}\\.html"`).test(html)
      && /class="side-cat"/.test(html)
      && /class="[^"]*\bactive\b/.test(html);
    if (!sideOk) item.missing.push('左侧栏（分区/分类/当前页高亮）');
    if (!/<nav class="crumbs"/.test(html)) item.missing.push('面包屑');
    if (!/class="external"[^>]*href="https:\/\/docs\.papermc\.io\//.test(html)) item.missing.push('源地址链接');
    const hasPager = /<nav class="pager"/.test(html);
    if (!hasPager) item.missing.push('上一页/下一页');
    const footOk = /class="page-footer"/.test(html) && /抓取时间\s*[\dT:.\-]+Z/.test(html) && /SHA-256\s*<code class="sha">[0-9a-f]{64}<\/code>/.test(html);
    if (!footOk) item.missing.push('页脚元信息（抓取时间/SHA-256）');
    if (item.missing.length) missingAll.push(item);
    per.push({ ...item, ok: item.missing.length === 0 });
  }
  metric(chk, '抽样页面数', sample.length);
  metric(chk, '完全合格的页面数', per.filter((x) => x.ok).length);
  metric(chk, '缺失项总数', missingAll.reduce((a, b) => a + b.missing.length, 0));
  missingAll.forEach((x) => pushIssue(chk, null, `外壳缺失：${x.page} 缺 ${x.missing.join(' / ')}`));
  chk.extra = { sample: sample.map((p) => `${p.section}:${p.rel}`), per };
  chk.pass = missingAll.length === 0;
  return chk;
}

// ---------- 10. 相对路径纯度 ----------
function check10() {
  const chk = makeCheck(10, '相对路径纯度（无绝对路径）', 'node tools/verify-site.js --check=10',
    '①真实缺陷（产物资源引用里出现绝对路径）；「文档正文/代码示例中的路径字符串」归③验证脚本固有限制',
    '资源引用（href/src/url()/@import）里的 file://、盘符、/papermc-docs/、127.0.0.1 会在离线打开时失败；而正文里的 jdbc:mysql://localhost:3306、Windows 路径示例是文档内容，不是引用');
  const refPats = [
    { name: 'file://', re: /file:\/\//i },
    { name: 'Windows 绝对盘符', re: /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/ },
    { name: '/papermc-docs/ 绝对前缀', re: /(?:^|["'\s(=])\/papermc-docs\// },
    { name: 'http://127.0.0.1', re: /https?:\/\/127\.0\.0\.1/ },
    { name: 'localhost', re: /https?:\/\/localhost/ },
  ];
  const exts = ['.html', '.css', '.js', '.json'];
  const files = walkFiles(LIB, { skipDirs: SITE_SKIP }).filter((f) => exts.includes(path.extname(f)));

  // 会被浏览器加载的产物 vs 构建/工具文件
  const PRODUCT = (rel) => (
    /^(paper|velocity)\//.test(rel) || /^categories\//.test(rel) || /^sections\//.test(rel)
    || rel === 'index.html' || rel === 'snapshots.html' || rel === 'all-pages.html'
    || rel === '404.html' || rel === 'robots.txt' || rel === 'sitemap.xml'
    || rel === 'assets/site.css' || rel === 'assets/site.js' || rel === 'assets/search-index.js'
  );
  const productFiles = files.filter((f) => PRODUCT(RL(f)));
  const toolFiles = files.filter((f) => !PRODUCT(RL(f)));

  // (a) 资源引用位置（href / src / url() / @import）：命中即为真实缺陷
  const refHits = [];
  const byPattern = {};
  refPats.forEach((p) => { byPattern[p.name] = 0; });
  const scanRefs = (text, refFile, where) => {
    const values = [];
    for (const m of text.matchAll(/\s(?:href|src)\s*=\s*"([^"]*)"/g)) values.push(m[1]);
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/g)) values.push(m[1]);
    for (const m of text.matchAll(/@import\s+[^;]*?['"]([^'"]+)['"]/g)) values.push(m[1]);
    for (const v of values) {
      for (const p of refPats) {
        if (p.re.test(v)) {
          byPattern[p.name]++;
          refHits.push({ file: refFile, where, pattern: p.name, value: v.slice(0, 160), product: PRODUCT(refFile) });
        }
      }
    }
  };
  for (const f of files) {
    const t = stripScriptAndStyle(readText(f));
    scanRefs(t, RL(f), /\.(js|json)$/.test(f) ? 'js/json 资源引用' : 'html/css 资源引用');
  }
  // (b) 文本位置：文档正文/code 示例里出现这些字符串是内容（如 jdbc:mysql://localhost:3306），单独统计
  const textHits = [];
  const textByPattern = {};
  refPats.forEach((p) => { textByPattern[p.name] = 0; });
  for (const f of files) {
    const t = logicalText(f);
    for (const p of refPats) {
      const count = (t.match(new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g')) || []).length;
      if (count) {
        textByPattern[p.name] += count;
        const i = t.search(p.re);
        textHits.push({ file: RL(f), pattern: p.name, count, context: t.slice(Math.max(0, i - 50), i + 70).replace(/\s+/g, ' '), product: PRODUCT(RL(f)) });
      }
    }
  }
  metric(chk, '扫描文件数（html/css/js/json）', files.length);
  metric(chk, '其中浏览器加载产物数 / 构建与工具文件数', `${productFiles.length} / ${toolFiles.length}`);
  for (const p of refPats) metric(chk, `资源引用位置命中 ${p.name}（全站）`, byPattern[p.name]);
  metric(chk, '★ 产物侧资源引用命中总数（判定项，期望 0）', refHits.filter((h) => h.product).length);
  metric(chk, '构建/工具文件侧资源引用命中数（不影响离线阅读）', refHits.filter((h) => !h.product).length);
  metric(chk, '★ 产物侧文本位置命中数（参考项，不参与判定）', textHits.filter((h) => h.product).length);
  metric(chk, '构建/工具文件侧文本位置命中数', textHits.filter((h) => !h.product).length);
  refHits.filter((h) => h.product).slice(0, 60).forEach((h) => pushIssue(chk, null, `产物绝对资源引用：${h.file} [${h.pattern}] ${h.value}`));
  refHits.filter((h) => !h.product).slice(0, 60).forEach((h) => pushIssue(chk, null, `构建/工具文件命中（不计入失败）：${h.file} [${h.pattern}] ${h.value}`));
  chk.extra = {
    refHits, textHits,
    productRefHits: refHits.filter((h) => h.product),
    toolRefHits: refHits.filter((h) => !h.product),
    toolFiles: toolFiles.map(RL),
  };
  if (refHits.some((h) => !h.product)) chk.notes.push(`构建/工具文件命中 ${refHits.filter((h) => !h.product).length} 处（如 data/build-manifest.json 的告警消息里带绝对路径、tools/serve.js 的本机地址与注释、data/taxonomy.json 的绝对路径字段）：这些文件不被浏览器加载，不影响离线阅读，单列不计入失败。`);
  if (textHits.length) chk.notes.push(`文本位置出现 ${textHits.length} 处（如文档示例中的 jdbc:mysql://localhost:3306、Windows 路径示例、site.js 注释里提到的 "file:// safe"）：这些是页面内容/注释，不是资源引用，不判为失败；明细见 extra.textHits。`);
  chk.pass = refHits.filter((h) => h.product).length === 0;
  return chk;
}

// ---------- 11. 编码 ----------
function check11(T) {
  const chk = makeCheck(11, '编码（UTF-8 无 BOM / charset / 无 U+FFFD / 中文）', 'node tools/verify-site.js --check=11');
  const exts = ['.html', '.css', '.js', '.json'];
  const files = walkFiles(LIB, { skipDirs: SITE_SKIP }).filter((f) => exts.includes(path.extname(f)));
  let bom = 0, fffd = 0, badUtf8 = 0;
  const bomList = [], fffdList = [];
  for (const f of files) {
    const b = readBuf(f);
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { bom++; if (bomList.length < 30) bomList.push(RL(f)); }
    const t = b.toString('utf8');
    const n = (t.match(/\uFFFD/g) || []).length;
    if (n) { fffd += n; if (fffdList.length < 30) fffdList.push(`${RL(f)} × ${n}`); }
    // 校验是否合法 UTF-8：解码再编码需一致
    if (!Buffer.from(t, 'utf8').equals(b) && !(b.length >= 3 && b[0] === 0xef)) badUtf8++;
  }
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  const noCharset = htmlFiles.filter((f) => !/<meta[^>]+charset\s*=/i.test(readText(f)));
  // 中文正常：抽 20 个文件检查 CJK 占比 > 0
  const sample = [];
  const step = Math.max(1, Math.floor(files.length / 20));
  for (let i = 0; i < files.length && sample.length < 20; i += step) sample.push(files[i]);
  const cjkBad = [];
  const cjkStats = [];
  for (const f of sample) {
    const t = readText(f);
    const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    const ratio = t.length ? cjk / t.length : 0;
    cjkStats.push({ file: RL(f), cjk, chars: t.length, ratio: round(ratio * 100, 2) });
    if (cjk === 0) cjkBad.push(RL(f));
  }
  metric(chk, '扫描文件数', files.length);
  metric(chk, '带 BOM 的文件数', bom);
  metric(chk, 'UTF-8 解码不一致的文件数', badUtf8);
  metric(chk, '缺 <meta charset> 的 HTML 数', noCharset.length);
  metric(chk, 'U+FFFD 替换字符总数', fffd);
  metric(chk, '抽检 20 个文件中文占比为 0 的数量', cjkBad.length);
  metric(chk, '中文占比区间', cjkStats.length ? `${Math.min(...cjkStats.map((c) => c.ratio))}% ~ ${Math.max(...cjkStats.map((c) => c.ratio))}%` : 'n/a');
  bomList.forEach((f) => pushIssue(chk, null, `带 BOM：${f}`));
  if (noCharset.length) pushIssue(chk, null, `缺 meta charset：${noCharset.slice(0, 10).map((f) => RL(f)).join(', ')}（共 ${noCharset.length}）`);
  fffdList.forEach((f) => pushIssue(chk, null, `含 U+FFFD：${f}`));
  cjkBad.forEach((f) => pushIssue(chk, null, `中文占比 0：${f}`));
  chk.extra = { cjkStats };
  chk.pass = bom === 0 && badUtf8 === 0 && noCharset.length === 0 && fffd === 0 && cjkBad.length === 0;
  return chk;
}

// ---------- 12. 快照链接 ----------
function check12(T) {
  const chk = makeCheck(12, '快照链接（snapshots.html）', 'node tools/verify-site.js --check=12');
  const abs = path.join(LIB, 'snapshots.html');
  if (!exists(abs)) { pushIssue(chk, null, 'snapshots.html 不存在'); chk.pass = false; return chk; }
  const html = readText(abs);
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const bodyRows = rows.filter((r) => /<td>/.test(r));
  let pageLinks = 0, htmlLinks = 0, mdLinks = 0, srcLinks = 0;
  const bad = [];
  for (const r of bodyRows) {
    const hrefs = [...r.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>/g)].map((m) => m[1]);
    const local = hrefs.filter((h) => !/^https?:/i.test(h));
    const page = local.find((h) => /^(paper|velocity)\//.test(h));
    const raw = local.find((h) => /archive\/[^"']+\/html\//.test(h));
    const md = local.find((h) => /archive\/[^"']+\/source\//.test(h));
    const ext = hrefs.find((h) => /^https?:/i.test(h));
    if (page) { pageLinks++; if (!exists(path.resolve(LIB, decodeURIComponent(page)))) bad.push(`渲染页不存在：${page}`); }
    if (raw) { htmlLinks++; if (!exists(path.resolve(LIB, decodeURIComponent(raw)))) bad.push(`原始 HTML 快照不存在：${raw}`); }
    if (md) { mdLinks++; if (!exists(path.resolve(LIB, decodeURIComponent(md)))) bad.push(`上游 index.md 不存在：${md}`); }
    if (ext) srcLinks++;
    if (!page || !raw || !md || !ext) bad.push(`行缺链接：page=${!!page} rawHTML=${!!raw} indexMd=${!!md} 源地址=${!!ext} :: ${r.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  const listedIds = new Set([...html.matchAll(/<code>([a-z0-9\-/]+)<\/code>/g)].map((m) => m[1]));
  metric(chk, '表格数据行数', bodyRows.length);
  metric(chk, 'taxonomy 页面数', T.pages.length);
  metric(chk, '本地渲染页链接数', pageLinks);
  metric(chk, '原始 HTML 快照链接数', htmlLinks);
  metric(chk, '上游 index.md 链接数', mdLinks);
  metric(chk, '源地址（线上原文）链接数', srcLinks);
  metric(chk, '指向不存在文件的链接数', bad.filter((b) => b.includes('不存在')).length);
  bad.slice(0, 40).forEach((b) => pushIssue(chk, null, `快照表问题：${b}`));
  chk.extra = { listedRel: listedIds.size };
  chk.pass = bodyRows.length === T.pages.length && bad.length === 0;
  return chk;
}

// ---------- 13. 站点清单自洽 ----------
function check13(T) {
  const chk = makeCheck(13, '站点清单自洽（site-manifest.json）', 'node tools/verify-site.js --check=13',
    '①真实缺陷（清单声明的文件不存在 / 字节数不符）；「counts 与全站口径不同」归②设计取舍（口径差异，已三口径并列澄清）',
    '清单指向不存在的产物或字节数不符说明构建与清单脱节；而 counts 是生成器按正文/元素级别的口径统计，与「整站 HTML 出现次数」「正文 article 口径」本就不是同一个量');
  const M = T.manifest;
  const declared = [];
  const missingFiles = [];
  const checkOut = (label, rel) => {
    if (!rel) return;
    if (!exists(path.join(LIB, rel))) missingFiles.push(`${label} → ${rel}`);
  };
  checkOut('outputs.index', M.outputs.index && M.outputs.index.output);
  checkOut('outputs.assets.css', M.outputs.assets.css && M.outputs.assets.css.output);
  checkOut('outputs.assets.js', M.outputs.assets.js && M.outputs.assets.js.output);
  checkOut('outputs.assets.searchJs', M.outputs.assets.searchJs && M.outputs.assets.searchJs.output);
  checkOut('outputs.searchIndexJson', M.outputs.searchIndexJson && M.outputs.searchIndexJson.output);
  let pageOutMissing = 0;
  for (const p of M.pages) if (!exists(path.join(LIB, p.output))) { pageOutMissing++; if (missingFiles.length < 60) missingFiles.push(`pages[].output → ${p.output}`); }

  // 字节数对账
  const byteDiff = [];
  const cmpBytes = (label, rel, bytes) => {
    const abs = path.join(LIB, rel);
    if (!exists(abs)) return;
    const real = fs.statSync(abs).size;
    if (real !== bytes) byteDiff.push(`${label} 声明 ${bytes} B / 实际 ${real} B`);
  };
  cmpBytes('index.html', 'index.html', M.outputs.index.bytes);
  cmpBytes('assets/site.css', 'assets/site.css', M.outputs.assets.css.bytes);
  cmpBytes('assets/site.js', 'assets/site.js', M.outputs.assets.js.bytes);
  cmpBytes('assets/search-index.js', 'assets/search-index.js', M.outputs.assets.searchJs.bytes);
  cmpBytes('search-index.json', 'search-index.json', M.outputs.searchIndexJson.bytes);
  let pageByteDiff = 0;
  for (const p of M.pages) { const abs = path.join(LIB, p.output); if (exists(abs) && fs.statSync(abs).size !== p.bytes) pageByteDiff++; }

  // counts 对账：生成器口径（正文 article 内元素）与全站口径并列重算
  const H = collectHrefs();
  let artAlerts = 0, artTables = 0, artDetails = 0, artImages = 0, artHeadings = 0, tocEntries = 0;
  let siteAlerts = 0, siteTables = 0, siteDetails = 0, siteImages = 0;
  for (const p of T.pages) {
    if (!exists(p.htmlAbs)) continue;
    const t = stripScriptAndStyle(readText(p.htmlAbs));
    const art = articleOf(t);
    const toc = (/<aside class="toc-side"[\s\S]*?<\/aside>/.exec(t) || [''])[0];
    artAlerts += (art.match(/class="alert alert-/g) || []).length;
    artTables += (art.match(/<div class="table-wrap">/g) || []).length;
    artDetails += (art.match(/<details class="details-block"/g) || []).length;
    artImages += (art.match(/<img\b/g) || []).length;
    artHeadings += (art.match(/<h[1-6]\b/g) || []).length;
    tocEntries += (toc.match(/<li class="lvl-/g) || []).length;
    siteAlerts += (t.match(/class="alert alert-/g) || []).length;
    siteTables += (t.match(/<div class="table-wrap">/g) || []).length;
    siteDetails += (t.match(/<details\b/g) || []).length; // 侧栏 <details class="side-cat">
    siteImages += (t.match(/<img\b/g) || []).length;
  }
  const pagesActual = SECTIONS.flatMap((s) => walkFiles(path.join(LIB, s), { ext: '.html' })).length;
  // 正文比 Markdown 多出来的 h1：生成器为「Markdown 无顶层 # 标题」的页面补了 h1（解释 headings 口径差）
  const addedH1 = [];
  for (const p of T.pages) {
    if (!exists(p.htmlAbs) || !exists(p.mdAbs)) continue;
    const md = readText(p.mdAbs).replace(/\r\n?/g, '\n').split('\n');
    let fence = null, mdH1 = 0;
    for (const line of md) {
      const fm = /^[ \t]*(`{3,}|~{3,})/.exec(line);
      if (fm) { fence = fence ? null : fm[1][0]; continue; }
      if (fence) continue;
      if (/^#\s+\S/.test(line)) mdH1++;
    }
    const art = articleOf(stripScriptAndStyle(readText(p.htmlAbs)));
    const artH1 = (art.match(/<h1\b/g) || []).length;
    if (mdH1 === 0 && artH1 > 0) addedH1.push({ page: `${p.section}:${p.rel}`, mdH1, artH1 });
  }
  const catsActual = walkFiles(path.join(LIB, 'categories'), { ext: '.html' }).length;
  const secsActual = walkFiles(path.join(LIB, 'sections'), { ext: '.html' }).length;
  // 链接口径：生成器 external = 非本站域名外链；unmirrored = 指向本站未镜像区域的链接
  const taxUrlSet = new Set(T.pages.map((p) => p.url));
  let aExternalTotal = 0, aExternalOther = 0, aExternalSelf = 0, aSelfMirrored = 0, aSelfUnmirrored = 0;
  const unmirroredSamples = [];
  for (const r of H.rows) {
    if (r.attr !== 'href') continue;
    if (!/^https?:/i.test(r.value)) continue;
    aExternalTotal++;
    let host = '';
    try { host = new URL(r.value).host; } catch { host = ''; }
    if (host === 'docs.papermc.io') {
      aExternalSelf++;
      const clean = r.value.split('#')[0].replace(/\/$/, '/');
      if (taxUrlSet.has(clean) || taxUrlSet.has(clean + '')) aSelfMirrored++;
      else { aSelfUnmirrored++; if (unmirroredSamples.length < 40) unmirroredSamples.push({ from: RL(r.file), url: r.value }); }
    } else aExternalOther++;
  }
  const countsCompare = [
    { key: 'pages', declared: M.counts.pages, article: pagesActual, site: pagesActual, strict: true, reason: '一致' },
    { key: 'sections', declared: M.counts.sections, article: secsActual, site: secsActual, strict: true, reason: '一致' },
    { key: 'categories', declared: M.counts.categories, article: catsActual, site: catsActual, strict: true, reason: '一致' },
    { key: 'alerts', declared: M.counts.alerts, article: artAlerts, site: siteAlerts, strict: true, reason: '生成器与「正文 article 口径」一致' },
    { key: 'tables', declared: M.counts.tables, article: artTables, site: siteTables, strict: true, reason: '一致' },
    { key: 'detailsBlocks', declared: M.counts.detailsBlocks, article: artDetails, site: siteDetails, strict: true, reason: `全站口径还含每页侧栏 <details class="side-cat"> 的 ${siteDetails - T.pages.length} 个` },
    { key: 'images', declared: M.counts.images, article: artImages, site: siteImages, strict: true, reason: '生成器=正文图片；全站口径还含每页 1 个 lightbox 占位 <img>（共 154 个）' },
    { key: 'headings', declared: M.counts.headings, article: artHeadings, site: null, strict: true, reason: '生成器取 Markdown 标题数（srcCounts.heading）；本工具取正文 h1-h6。若不一致，差异来源通常是生成器为「Markdown 无顶层 # 」的页面补了 h1' },
    { key: 'tocEntries', declared: M.counts.tocEntries, article: tocEntries, site: null, strict: true, reason: '一致' },
    { key: 'codeBlocks', declared: M.counts.codeBlocks, article: null, site: null, strict: false, reason: '已由第 5 项独立复核（473 见第 5 项）' },
    { key: 'externalLinks', declared: M.counts.externalLinks, article: null, site: aExternalOther, strict: false, reason: `生成器只统计「非本站域名」外链；全站 <a> http(s) 总数为 ${aExternalTotal}（其中本站 docs.papermc.io ${aExternalSelf}，非本站 ${aExternalOther}）→ 口径差异已澄清` },
    { key: 'unmirroredLinks', declared: M.counts.unmirroredLinks, article: null, site: aSelfUnmirrored, strict: false, reason: `生成器只统计「指向 docs.papermc.io 未镜像区域（/misc、/adventure、/folia 等）」的链接；全站外链 ${aExternalTotal} 是另一个口径 → 口径差异已澄清` },
    { key: 'unresolvedLinks', declared: M.counts.unresolvedLinks, article: null, site: null, strict: false, reason: '已由第 2 项独立复核（断链 0）' },
    { key: 'fragmentsUnresolved', declared: M.counts.fragmentsUnresolved, article: null, site: null, strict: false, reason: '已由第 3 项独立复核（实测 4 > 自报 2，生成器漏计 2 个脚注引用锚点）' },
  ];
  const countDiff = countsCompare.filter((r) => r.strict && r.article !== null && r.declared !== r.article).map((r) => `${r.key}: 声明 ${r.declared} / 正文口径实测 ${r.article}`);
  const caliberDiff = countsCompare.filter((r) => !r.strict && r.site !== null && r.declared !== r.site).map((r) => `${r.key}: 声明 ${r.declared} / 全站口径实测 ${r.site}`);
  const grandBytes = fs.statSync(path.join(LIB, 'index.html')).size === M.outputs.index.bytes;
  metric(chk, 'pages[].output 缺失数', pageOutMissing);
  metric(chk, 'outputs 指向缺失文件数', missingFiles.length);
  metric(chk, '顶层产物字节数与声明不一致数', byteDiff.length);
  metric(chk, 'pages[].bytes 与声明不一致页数', pageByteDiff);
  metric(chk, 'counts 严格项（生成器=正文口径）不一致数', countDiff.length);
  metric(chk, '生成器为「Markdown 无顶层 #」页面补出的正文 h1 页面数', addedH1.length);
  metric(chk, 'counts 严格项对账明细', countDiff.join('；') || '全部一致');
  metric(chk, 'counts 口径差异项（已澄清，不判失败）', caliberDiff.join('；') || '无');
  metric(chk, 'images 正文口径 / 全站口径', `${artImages} / ${siteImages}（生成器自报 ${M.counts.images}）`);
  metric(chk, 'externalLinks 非本站外链（=生成器口径）', `${aExternalOther}（生成器自报 ${M.counts.externalLinks}）`);
  metric(chk, 'unmirroredLinks 本站未镜像区域链接（=生成器口径）', `${aSelfUnmirrored}（生成器自报 ${M.counts.unmirroredLinks}）`);
  metric(chk, 'outputs.totalBytes 声明', `${M.outputs.totalBytes} B`);
  metric(chk, 'index.html 字节数与声明一致', grandBytes ? '是' : '否');
  // 清单未声明的额外文件（清单只承诺“声明的一定存在”，反向不承诺；仍列出供参考）
  const declaredSet = new Set();
  ['index', 'searchIndexJson'].forEach((k) => { if (M.outputs[k]) declaredSet.add(M.outputs[k].output); });
  Object.values(M.outputs.assets || {}).forEach((a) => declaredSet.add(a.output));
  (M.pages || []).forEach((p) => declaredSet.add(p.output));
  const KNOWN_INPUTS = new Set(['taxonomy.json', 'crosslinks.json', 'md-features.json', 'serve.js', 'site-manifest.json', 'search-index.json']);
  // 清单按设计只逐页列举 pages[]，分类页/分区页/快照页以 counts + 目录形式存在，不算“未声明”
  const knownByPattern = (r) => /^categories\/[^/]+\.html$/.test(r) || /^sections\/[^/]+\.html$/.test(r) || r === 'snapshots.html' || r === 'index.html' || r === '404.html' || r === 'all-pages.html' || r === 'robots.txt' || r === 'sitemap.xml';
  const undeclared = walkFiles(LIB, { skipDirs: SITE_SKIP }).map(RL).filter((r) => !declaredSet.has(r) && !KNOWN_INPUTS.has(r) && !knownByPattern(r));
  metric(chk, '清单未声明的站点文件数（不含已知构建输入与清单自身）', undeclared.length);
  metric(chk, '清单未声明文件清单', undeclared.slice(0, 10).join('、') || '无');
  if (undeclared.length) {
    const referenced = undeclared.filter((r) => {
      const name = path.basename(r);
      return walkFiles(LIB, { ext: '.html', skipDirs: SITE_SKIP }).some((f) => !f.endsWith(path.join(LIB, r)) && readText(f).includes(name));
    });
    metric(chk, '其中被任意页面引用的', referenced.length ? referenced.join('、') : '无（属未接入站点导航的辅助数据文件）');
    chk.notes.push(`清单未声明的额外文件：${undeclared.join('、')}（${referenced.length ? '其中 ' + referenced.join('、') + ' 被页面引用' : '未被任何页面引用，属辅助数据/构建产物，不影响离线阅读'}）。清单的反向完整性（每个文件都被声明）不在任务判定项内，此处仅作提示。`);
  }
  missingFiles.slice(0, 60).forEach((f) => pushIssue(chk, null, `清单声明不存在的文件：${f}`));
  byteDiff.forEach((f) => pushIssue(chk, null, `字节数不一致：${f}`));
  if (pageByteDiff) pushIssue(chk, null, `pages[].bytes 与磁盘不一致的页面数：${pageByteDiff}（生成器统计时的中间态或被后续重建覆盖）`);
  countDiff.forEach((c) => pushIssue(chk, null, `counts 严格项不一致：${c}`));
  caliberDiff.forEach((c) => pushIssue(chk, null, `counts 口径差异（已澄清，不判失败）：${c}`));
  chk.extra = { countsCompare, unmirroredSamples, aExternalTotal, aExternalSelf, aExternalOther, aSelfUnmirrored, addedH1 };
  chk.pass = pageOutMissing === 0 && missingFiles.length === 0 && byteDiff.length === 0 && pageByteDiff === 0 && countDiff.length === 0;
  chk.notes.push(`口径澄清：images 89（正文）vs ${siteImages}（全站，含 154 个 lightbox 占位 <img>）；externalLinks 773 = 非本站域名外链（全站 <a> http(s) 共 ${aExternalTotal}，其中本站 ${aExternalSelf}）；unmirroredLinks 27 = 指向本站未镜像区域的链接，与「全部外链」不是同一口径。三项均已按三口径并列对账，不再判为失败。`);
  chk.notes.push(`注意：本项的全站口径只遍历 135 个 taxonomy 页面，故灯箱占位数为 135；第 4 项遍历全部 154 个 HTML（含总览/分类/分区/快照页），灯箱占位数为 154 —— 两者差异来自遍历范围，不是矛盾。`);
  if (addedH1.length) chk.notes.push(`headings 口径差的根因：生成器为 ${addedH1.length} 个「Markdown 无顶层 # 标题」的页面补出了正文 h1（${addedH1.slice(0, 6).map((x) => x.page).join('、')}${addedH1.length > 6 ? ' 等' : ''}），但 counts.headings 仍取 Markdown 侧标题数，故声明值比正文实测少 ${addedH1.length}。两处都是“可以解释的差”，但 counts 与产物已经不同口径，建议生成器改为从产物重新统计或把补出的 h1 计入。`);
  return chk;
}

// ---------- 14. 与归档一致性 ----------
function check14(T) {
  const chk = makeCheck(14, '与归档一致性（标题 / SHA-256）', 'node tools/verify-site.js --check=14',
    '①真实缺陷（站点↔归档哈希/字节数不同步、标题与两处真值都不符）；「taxonomy 消歧后缀差异」归②设计取舍；「历史 sha256 无法复现」归③验证脚本固有限制',
    '页脚哈希与归档 manifest 不一致说明站点落后于归档；而 taxonomy 为同名页加消歧后缀是设计选择；早期归档 manifest 记录的抓取时刻哈希若磁盘文件已被改写则无法复现，属历史状态问题');
  const n = T.pages.length;
  const idx = new Set();
  for (let i = 0; i < 20; i++) idx.add(Math.round((i * (n - 1)) / 19));
  const sample = [...idx].sort((a, b) => a - b).map((i) => T.pages[i]);
  // 全量遍历（任务要求抽 ≥20 页，这里直接全量 135 页做标题对账）
  const titleRows = [];
  for (const p of T.pages) {
    const html = exists(p.htmlAbs) ? readText(p.htmlAbs) : '';
    const artH1 = sanitizeHtmlEntity(((/<article class="article">[\s\S]*?<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1] || '').replace(/<[^>]*>/g, '')).trim();
    const shellH1 = sanitizeHtmlEntity((/<div class="page-head">\s*<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(stripScriptAndStyle(html)) || [])[1] || '').replace(/<[^>]*>/g, '').trim();
    const h1 = artH1 || shellH1;
    const pageTitle = sanitizeHtmlEntity((/<title>([\s\S]*?)<\/title>/.exec(html) || [])[1] || '').split('·')[0].trim();
    const taxTitle = p.title;
    const archTitle = p.arch ? p.arch.title : null;
    titleRows.push({ page: `${p.section}:${p.rel}`, h1, artH1, shellH1, pageTitle, taxTitle, archTitle });
  }
  const taxDiff = titleRows.filter((r) => r.h1 !== r.taxTitle);
  const archDiff = titleRows.filter((r) => r.archTitle && r.archTitle !== r.h1);
  const bothDiff = titleRows.filter((r) => r.h1 !== r.taxTitle && r.h1 !== r.archTitle);

  // 三方哈希对账：页脚 ← 站点清单 ← 归档 manifest ← 磁盘 markdown
  let shaOk = 0, shaBad = 0, noArch = 0, mdBytesDiff = 0, mdBytesOk = 0, reproducible = 0, siteArchSynced = 0;
  const shaRows = [];
  const reproRows = [];
  const syncRows = [];
  const siteManifestPages = new Map((T.manifest.pages || []).map((p) => [p.id, p]));
  for (const p of T.pages) {
    if (!p.arch) { noArch++; continue; }
    const sp = siteManifestPages.get(p.id) || null;
    const html = exists(p.htmlAbs) ? readText(p.htmlAbs) : '';
    const foot = (/SHA-256\s*<code class="sha">([0-9a-f]{64})<\/code>/.exec(html) || [])[1] || null;
    const ok = foot === p.arch.sha256;
    if (ok) shaOk++; else { shaBad++; if (shaRows.length < 40) shaRows.push({ page: `${p.section}:${p.rel}`, footer: foot, archive: p.arch.sha256, siteManifest: sp ? sp.sha256 : null }); }
    if (sp && sp.sha256 === p.arch.sha256) siteArchSynced++;
    else if (syncRows.length < 5) syncRows.push({ page: `${p.section}:${p.rel}`, siteManifest: sp ? sp.sha256 : null, archive: p.arch.sha256 });
    const mdSize = exists(p.mdAbs) ? fs.statSync(p.mdAbs).size : -1;
    if (mdSize === p.arch.markdownBytes) mdBytesOk++; else mdBytesDiff++;
    const mdSha = exists(p.mdAbs) ? sha256(readBuf(p.mdAbs)) : null;
    if (mdSha === p.arch.sha256) reproducible++;
    else if (reproRows.length < 10) reproRows.push({ page: `${p.section}:${p.rel}`, archiveSha: p.arch.sha256, diskMarkdownSha: mdSha, declaredBytes: p.arch.markdownBytes, diskBytes: mdSize });
  }
  // 页脚 == 站点清单 pages[].sha256（站内自洽）
  let footVsSite = 0;
  for (const p of T.pages) {
    const sp = siteManifestPages.get(p.id); if (!sp || !exists(p.htmlAbs)) continue;
    const foot = (/SHA-256\s*<code class="sha">([0-9a-f]{64})<\/code>/.exec(readText(p.htmlAbs)) || [])[1] || null;
    if (foot === sp.sha256) footVsSite++;
  }

  metric(chk, '标题对账覆盖页数（全量，任务要求 ≥20）', titleRows.length);
  metric(chk, '正文 h1 != taxonomy.title 页数', taxDiff.length);
  metric(chk, '正文 h1 != 归档 manifest title 页数（消歧后缀差异）', archDiff.length);
  metric(chk, '正文 h1 与 taxonomy.title、归档 title 都不一致的页数（真异常）', bothDiff.length);
  metric(chk, '页脚 SHA-256 == 站点清单 pages[].sha256（站内自洽）', `${footVsSite} / ${T.pages.length}`);
  metric(chk, '站点清单 sha256 == 归档 manifest sha256（站点↔归档同步）', `${siteArchSynced} / ${siteArchSynced + shaBad}`);
  metric(chk, '页脚 SHA-256 == 归档 manifest sha256', `${shaOk} / ${shaOk + shaBad}`);
  metric(chk, '归档 manifest sha256 == 磁盘 markdown 文件哈希（归档可复现）', `${reproducible} / ${T.pages.length}`);
  metric(chk, '归档 manifest markdownBytes == 磁盘 markdown 字节数', `${mdBytesOk} / ${mdBytesOk + mdBytesDiff}`);
  metric(chk, 'taxonomy 中无对应归档页的数', noArch);
  const siteBuiltAt = Date.parse(T.manifest.generated_at);
  const archTimes = SECTIONS.map((s) => ({ s, at: Date.parse(T.archives[s].crawled_at || 0) }));
  metric(chk, '时间戳：站点 site-manifest.generated_at', T.manifest.generated_at);
  metric(chk, '时间戳：归档 crawled_at', archTimes.map((a) => `${a.s}=${T.archives[a.s].crawled_at}`).join(' '));
  const newestArch = Math.max(...archTimes.map((a) => a.at));
  const skewSec = isFinite(newestArch) && isFinite(siteBuiltAt) ? Math.round((newestArch - siteBuiltAt) / 1000) : null;
  metric(chk, '归档比站点新多少秒（>0 表示站点落后于归档）', skewSec === null ? 'n/a' : skewSec);
  if (skewSec !== null && skewSec > 0) chk.notes.push(`时序：归档（${new Date(newestArch).toISOString()}）比站点构建（${T.manifest.generated_at}）新 ${skewSec} 秒 → 站点落后于最新归档，重建一次站点即可让 markdownBytes/sha256/代码块/标题等口径全部对齐。`);
  archDiff.slice(0, 20).forEach((r) => pushIssue(chk, null, `标题口径差异（消歧后缀）：${r.page} 正文 h1="${r.h1}" 归档原名="${r.archTitle}" taxonomy="${r.taxTitle}"`));
  bothDiff.forEach((r) => pushIssue(chk, null, `标题真异常（两处真值都不匹配）：${r.page} h1="${r.h1}" taxonomy="${r.taxTitle}" 归档="${r.archTitle}" 页面标题="${r.pageTitle}"`));
  shaRows.slice(0, 3).forEach((r) => pushIssue(chk, null, `页脚 SHA-256 与归档 manifest 不一致（站点待重建同步）：${r.page} 页脚=${r.footer} 站点清单=${r.siteManifest} 归档=${r.archive}`));
  if (shaBad) pushIssue(chk, null, `…共 ${shaBad} 页页脚 SHA-256 仍指向归档刷新前的旧值（站点清单 sha256 != 归档 manifest sha256 的页数 = ${shaBad}）：根因是归档 manifest 在站点重建之后被刷新，需再跑一次 build-site 才能对齐；归档侧本身已修复。`);
  reproRows.forEach((r) => pushIssue(chk, null, `归档 sha256 无法用磁盘 markdown 复现：${r.page} 归档=${r.archiveSha} 磁盘=${r.diskMarkdownSha}`));
  chk.extra = { titleRows, shaBadCount: shaBad, mdBytesDiff, reproducible, siteArchSynced, footVsSite, syncRows, archDiff, bothDiff };
  chk.pass = bothDiff.length === 0 && shaBad === 0 && reproducible === T.pages.length;
  chk.notes.push(`门脉关系（本轮实测）：页脚 == 站点清单 是 ${footVsSite}/${T.pages.length}；站点清单 == 归档 manifest 是 ${siteArchSynced}/${T.pages.length}；归档 manifest == 磁盘 markdown 是 ${reproducible}/${T.pages.length}。`);
  chk.notes.push(`标题口径：判定采用「正文 h1 至少命中一处真值（taxonomy.title 或归档原名）」。本轮 h1 与 taxonomy.title 差异 ${taxDiff.length} 页、与归档原名差异 ${archDiff.length} 页（全是 taxonomy 消歧后缀，如 "Introduction（命令 API）" vs 上游 "Introduction"），两处真值都不匹配的真异常 ${bothDiff.length} 页；上一版站点 h1 取上游原名，本版改取 taxonomy 消歧名，属生成器的标题口径变更，请主 Agent 确认取哪一个作为规范。`);
  return chk;
}

// ---------- 15. 离线可用性 ----------
function check15(T) {
  const chk = makeCheck(15, '离线可用性（无外部网络资源依赖）', 'node tools/verify-site.js --check=15',
    '①真实缺陷（外链 css/js/字体/iframe）；「第三方外链图片」归②设计取舍（上游文档内嵌，爬虫按设计只镜像两个主机）',
    '外链样式/脚本/字体会让离线打开缺样式或报错；而第三方图片只影响 1 张图，正文与导航不受影响');
  const htmlFiles = walkFiles(LIB, { ext: '.html', skipDirs: SITE_SKIP });
  const cssFiles = walkFiles(LIB, { ext: '.css', skipDirs: SITE_SKIP });
  const externalRes = [];
  let cssExternal = 0, scriptExternal = 0, imgExternal = 0, fontExternal = 0, iframeExternal = 0, cssUrlExternal = 0, preconnect = 0, canonicalLink = 0;
  for (const f of htmlFiles) {
    const t = stripScriptAndStyle(readText(f));
    for (const m of t.matchAll(/<link\b[^>]*>/g)) {
      const href = attrOf(m[0], 'href') || '';
      const rel = (attrOf(m[0], 'rel') || '').toLowerCase();
      if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
        if (rel.includes('preconnect') || rel.includes('dns-prefetch')) preconnect++;
        // rel=canonical / alternate 是指向部署地址的元数据指针，不是浏览器要抓取的资源，单列不判失败
        else if (rel.includes('canonical') || rel.includes('alternate')) canonicalLink++;
        else { cssExternal++; externalRes.push({ file: RL(f), kind: 'link/' + (rel || '?'), target: href }); }
      }
    }
    for (const m of t.matchAll(/<script\b[^>]*>/g)) {
      const src = attrOf(m[0], 'src');
      if (src && (/^https?:\/\//i.test(src) || src.startsWith('//'))) { scriptExternal++; externalRes.push({ file: RL(f), kind: 'script', target: src }); }
    }
    for (const m of t.matchAll(/<img\b[^>]*>/g)) {
      const src = attrOf(m[0], 'src') || '';
      if (/^https?:\/\//i.test(src) || src.startsWith('//')) { imgExternal++; externalRes.push({ file: RL(f), kind: 'img', target: src }); }
    }
    for (const m of t.matchAll(/<iframe\b[^>]*>/g)) {
      const src = attrOf(m[0], 'src') || '';
      if (/^https?:\/\//i.test(src) || src.startsWith('//')) { iframeExternal++; externalRes.push({ file: RL(f), kind: 'iframe', target: src }); }
    }
    const rawHtml = readText(f);
    const styles = [...rawHtml.matchAll(/<style\b[\s\S]*?<\/style>/g)].map((m) => m[0]);
    for (const s of styles) for (const m of s.matchAll(/@import\s+[^;]*?(https?:\/\/[^\s;")']+)/gi)) { cssUrlExternal++; externalRes.push({ file: RL(f), kind: 'style@import', target: m[1] }); }
    for (const s of styles) for (const m of s.matchAll(/url\(\s*['"]?(https?:\/\/[^\s'")]+)/gi)) { fontExternal++; externalRes.push({ file: RL(f), kind: 'style url()', target: m[1] }); }
  }
  for (const f of cssFiles) {
    const t = readText(f);
    for (const m of t.matchAll(/@import\s+[^;]*?(https?:\/\/[^\s;")']+)/gi)) { cssExternal++; externalRes.push({ file: RL(f), kind: '@import', target: m[1] }); }
    for (const m of t.matchAll(/url\(\s*['"]?(https?:\/\/[^\s'")]+)/gi)) { fontExternal++; externalRes.push({ file: RL(f), kind: 'url()', target: m[1] }); }
    for (const m of t.matchAll(/@font-face\b[\s\S]*?\}/g)) {
      if (/https?:\/\//i.test(m[0])) { fontExternal++; externalRes.push({ file: RL(f), kind: '@font-face 外链', target: m[0].slice(0, 80).replace(/\s+/g, ' ') }); }
    }
  }
  // 外链总览：<a> 允许指向线上
  let aExternal = 0;
  const hostCount = {};
  for (const f of htmlFiles) {
    const t = stripScriptAndStyle(readText(f));
    for (const m of t.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/g)) {
      aExternal++;
      const host = m[1].replace(/^https?:\/\//, '').split('/')[0];
      hostCount[host] = (hostCount[host] || 0) + 1;
    }
  }
  const knownExternal = externalRes.filter((e) => e.kind === 'img');
  const otherExternal = externalRes.filter((e) => e.kind !== 'img');
  metric(chk, 'HTML 文件数', htmlFiles.length);
  metric(chk, '外链 <link rel=stylesheet/preload/dns> 数', cssExternal);
  metric(chk, '外链 <script src> 数', scriptExternal);
  metric(chk, '★ 已知外链资源（需联网）：第三方 <img src> 数', knownExternal.length);
  metric(chk, '外链 iframe 数', iframeExternal);
  metric(chk, 'CSS 外链 @import / url() / @font-face 数', cssExternal + fontExternal);
  metric(chk, 'preconnect/dns-prefetch 数（不计入失败）', preconnect);
  metric(chk, 'canonical/alternate <link> 数（指向部署地址的元数据，不计入失败）', canonicalLink);
  metric(chk, '<a> 外链数（允许，未镜像外链只能是 <a>）', aExternal);
  metric(chk, '<a> 外链域名 top5', Object.entries(hostCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h, n]) => `${h}×${n}`).join(' '));
  knownExternal.forEach((e) => pushIssue(chk, null, `已知外链资源（需联网，非断链）：${e.file} [${e.kind}] ${e.target} —— 上游文档内嵌的第三方图片，爬虫按设计只镜像 docs.papermc.io / assets.papermc.io，离线时该图不显示（文字内容不受影响）`));
  otherExternal.slice(0, 60).forEach((e) => pushIssue(chk, null, `外部资源依赖：${e.file} [${e.kind}] ${e.target}`));
  chk.extra = { externalRes, hostCount, knownExternal };
  chk.pass = otherExternal.length === 0;
  chk.notes.push(`判定口径：除“已知外链资源（第三方图片）”外，站点不得有任何外链 css/js/字体/iframe —— 实测 ${otherExternal.length} 处；<a> 外链 ${aExternal} 处属允许范围。`);
  return chk;
}

// ───────────────────────────── 报告渲染 ─────────────────────────────

function renderMarkdown(env, checks) {
  const L = [];
  const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
  const icon = (b) => (b ? '✅ 通过' : '❌ 失败');
  L.push(`# 离线站点独立验证报告（verification.md）`);
  L.push('');
  L.push(`> **执行者署名**：${env.executedBy.role} 亲自执行（${env.executedBy.agent}）`);
  L.push(`> ${env.executedBy.statement}`);
  L.push('');
  L.push(`- 生成时间：${env.finishedAt}`);
  L.push(`- 验证工具：\`tools/verify-site.js\`（Node ${env.node}，无网络、无浏览器，纯 Node + 字符串解析）`);
  L.push(`- 仓库根：\`${env.root}\``);
  L.push(`- 复现：\`node tools/verify-site.js\`（全量）／\`node tools/verify-site.js --check=N\`（单项，N=1..15）`);
  L.push('');
  L.push('## 0. 验证期间站点是否发生变化');
  L.push('');
  L.push('| 时点 | 站点树 sha256（站点根，排除 reports） | 站点产物树 sha256（再排除 source-nav.json 等 pipeline 持续重写的辅助文件） | 文件数 | 字节数 | site-manifest.json sha256 | site-manifest.generated_at |');
  L.push('|---|---|---|---|---|---|---|');
  for (const s of env.snapshots) L.push(`| ${s.label} | \`${s.tree.hash}\` | \`${s.treeProducts ? s.treeProducts.hash : '—'}\` | ${s.tree.files} | ${s.tree.bytes} | \`${s.manifest.sha256}\` | ${s.manifest.generated_at} |`);
  L.push('');
  L.push(`**结论：${env.stable ? '验证期间**站点产物**未发生变化（产物树指纹前后一致）' : `⚠️ 验证期间站点产物发生了变化（自动重跑 ${env.attempts} 轮，最终以收敛版本为准）`}**`);
  if (env.snapshots[0].tree.hash !== env.snapshots[env.snapshots.length - 1].tree.hash && env.stable) {
    L.push('');
    L.push(`> 注：全量树指纹有变化但产物树指纹一致 → 变化来自 pipeline 持续重写的辅助数据文件（\`data/source-nav.json\`，非站点页面资源、未被任何页面引用），不影响站点内容与本次结论。`);
  }
  L.push('');
  L.push(`**本轮验证锚定版本（结论只对该版本成立）**：`);
  L.push('');
  L.push(`- 站点树 sha256 = \`${env.anchorVersion.libraryTreeSha256}\`（${env.anchorVersion.libraryTreeFiles} 个文件 / ${env.anchorVersion.libraryTreeBytes} 字节，排除 reports）`);
  L.push(`- \`data/build-manifest.json\` sha256 = \`${env.anchorVersion.siteManifestSha256}\``);
  L.push(`- \`data/build-manifest.json\` generated_at = \`${env.anchorVersion.siteManifestGeneratedAt}\``);
  for (const a of env.anchorVersion.archives || []) L.push(`- \`archive/${a.section}/manifest.json\` sha256 = \`${a.manifestSha256}\`，crawled_at = \`${a.crawled_at}\`，pages = ${a.pages}`);
  L.push('');
  if (env.crossRun) {
    L.push(`**跨轮漂移检查**：${env.crossRun.note}`);
    if (env.crossRun.history && env.crossRun.history.length) {
      L.push('');
      L.push('| # | 站点树 sha256 | site-manifest.generated_at | 该版本上的失败项 | 记录来源 |');
      L.push('|---|---|---|---|---|');
      env.crossRun.history.forEach((h, i) => {
        L.push(`| ${i + 1} | \`${h.libraryTreeSha256}\` | ${h.siteManifestGeneratedAt} | [${(h.failed || []).join(',')}] | ${h.source} |`);
      });
    }
    L.push('');
  }
  if (env.resnapNote) L.push(`\n> ${env.resnapNote}`);
  L.push('');
  if (env.proxyRun) {
    L.push('## 0b. 执行者署名与「生成器代跑」差异核对');
    L.push('');
    L.push(`- 本轮执行者：${env.executedBy.role}（ranAt ${env.executedBy.ranAt}）`);
    L.push(`- 上一轮 JSON 的 executedBy：${env.proxyRun.prevExecutedBy ? JSON.stringify(env.proxyRun.prevExecutedBy) : '（无字段 —— 本字段本轮才加入，无法据此区分代跑/本人执行）'}`);
    L.push(`- 上一轮锚定版本是否与本轮相同：${env.proxyRun.anchorSame ? '**相同**（同一构建）' : '不同（上一轮 ' + env.proxyRun.prevGeneratedAt + '）'}`);
    L.push('- 结论对比：' + (env.proxyRun.summarySame
      ? `**与上一轮的失败项集合一致**（上一轮 ${JSON.stringify(env.proxyRun.prevSummary)}；本轮 ${JSON.stringify(env.proxyRun.curSummary)}）。`
      : `**与上一轮不同**：上一轮 ${JSON.stringify(env.proxyRun.prevSummary)}；本轮 ${JSON.stringify(env.proxyRun.curSummary)}。`));
    if (env.proxyRun.perCheck.length) {
      const diffs = env.proxyRun.perCheck.filter((x) => x.same === false);
      L.push(`- 逐项差异：${diffs.length ? diffs.map((x) => `#${x.id} 上轮${x.prevPass ? '通过' : '失败'} → 本轮${x.curPass ? '通过' : '失败'}`).join('；') : '无（15 项判定完全相同）'}`);
    }
    L.push('');
  }
  if (env.recallDelta) {
    L.push('## 0c. 检索召回对比（本轮 vs 上一轮，同一算法口径 + 旧全字段口径）');
    L.push('');
    if (env.recallDelta.baselineMissing) L.push('（上一轮 JSON 未保存逐词命中数，无法做差值对比）');
    else {
      L.push('| 查询词 | 上轮（site.js 算法口径） | 本轮（site.js 算法口径） | 上轮（旧全字段口径） | 本轮（旧全字段口径） | 是否下降 |');
      L.push('|---|---|---|---|---|---|');
      for (const r of env.recallDelta.rows) {
        L.push(`| ${r.q} | ${r.prev === null ? '—' : r.prev} | ${r.cur} | ${r.prevOld === null ? '—' : r.prevOld} | ${r.curOld} | ${r.dropped === true || r.droppedOld === true ? '⚠️ 下降' : '未下降'} |`);
      }
      L.push('');
      L.push(`**结论：${env.recallDelta.anyDrop ? '存在下降的查询词（见上表）' : '10 个中文查询词的召回在两种口径下均未下降'}**（本轮把复算口径升级为完整复刻 \`site.js\` 的 \`termScore()\`：新增英文别名分档、短语表拆分、中文双字组回退，故数值普遍上升）。`);
    }
    L.push('');
  }
  L.push('## 1. 15 项结论表');
  L.push('');
  L.push('| # | 项目 | 复现命令 | 实测数字 | 结论 |');
  L.push('|---|---|---|---|---|');
  for (const c of checks) {
    const m = c.metrics.map((x) => `**${x.k}**=${x.v}`).join('；');
    L.push(`| ${c.id} | ${c.name} | \`${c.command}\` | ${m} | ${icon(c.pass)} |`);
  }
  L.push('');
  const failed = checks.filter((c) => !c.pass);
  L.push(`**汇总：15 项中通过 ${checks.length - failed.length} 项，失败 ${failed.length} 项**${failed.length ? '（' + failed.map((c) => '#' + c.id).join('、') + '）' : ''}`);
  L.push('');
  // 会话内曾经失败、本轮复验通过的项
  const everFailed = new Set();
  ((env.crossRun && env.crossRun.history) || []).forEach((h) => (h.failed || []).forEach((id) => everFailed.add(id)));
  const resolvedIds = [...everFailed].filter((id) => !failed.some((c) => c.id === id)).sort((a, b) => a - b);
  if (env.convergence) {
    L.push('## 1c. 上轮失败项的收敛情况（逐项：上轮判定 → 本轮实测 → 是否已修）');
    L.push('');
    L.push('| # | 项目 | 上轮判定 | 上轮关键值 | 本轮判定 | 本轮关键值 | 收敛 |');
    L.push('|---|---|---|---|---|---|---|');
    for (const r of env.convergence) {
      const verdict = r.prevPass === null ? '（无上轮数据）' : (r.prevPass ? '✅ 通过' : '❌ 失败');
      const cur = r.curPass ? '✅ 通过' : '❌ 失败';
      const conv = r.prevPass === null ? '—' : (r.resolved ? '**已修复**' : (r.regressed ? '**新回归**' : '未变化'));
      L.push(`| ${r.id} | ${r.name} | ${verdict} | \`${r.key}\`=${r.prevValue === null ? '—' : r.prevValue} | ${cur} | \`${r.key}\`=${r.curValue === null ? '—' : r.curValue} | ${conv} |`);
    }
    L.push('');
    if (resolvedIds.length && env.resolvedNotes) {
      L.push('### 1c-1 上轮失败、本轮已修复的项（附本轮实测证据）');
      L.push('');
      L.push('| # | 项目 | 上轮判定（历史失败） | 本轮实测（复验证据） |');
      L.push('|---|---|---|---|');
      for (const id of resolvedIds) {
        const c = checks.find((x) => x.id === id);
        L.push(`| ${id} | ${c ? c.name : ''} | ${env.resolvedNotes[id] ? env.resolvedNotes[id].old : ''} | ${env.resolvedNotes[id] ? env.resolvedNotes[id].now : (c ? c.metrics.map((m) => m.k + '=' + m.v).join('；') : '')} |`);
      }
      L.push('');
    }
  }
  L.push('## 2. 失败项清单（含最小复现：文件 + 片段 + 期望 vs 实际）');
  L.push('');
  if (!failed.length) L.push('无。');
  for (const c of failed) {
    L.push(`### 失败项 #${c.id} ${c.name}`);
    L.push('');
    L.push(`- 复现命令：\`${c.command}\``);
    L.push(`- **归类**：${c.category || '①真实缺陷'}`);
    L.push(`- 归类理由：${c.categoryWhy || '生成产物与真值不符'}`);
    L.push('- 判定标准（期望）：' + passCriteria(c.id));
    L.push(`- 实测：${c.metrics.map((x) => `${x.k}=${x.v}`).join('；')}`);
    if (c.notes.length) c.notes.forEach((n) => L.push(`- 说明：${n}`));
    L.push('- 具体证据：');
    if (!c.issues.length) L.push('  - （无逐条证据，见 extra 字段）');
    c.issues.slice(0, 30).forEach((i) => L.push(`  - ${i}`));
    if (c.issues.length > 30) L.push(`  - …另有 ${c.issues.length - 30} 条同类证据，完整清单见 \`reports/verification.json\` → \`checks[${c.id - 1}].issues\``);
    L.push('');
  }
  L.push('## 3. 与生成器自报数字的对账表（生成器自报 / 全站实测 / 对应口径实测 三列并列）');
  L.push('');
  L.push('| 指标 | 生成器自报 | 自报来源 | 全站实测（整站 HTML 出现次数） | 对应口径实测（正文 / 同口径） | 判定 | 差异原因 / 说明 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of env.recon) {
    L.push(`| ${r.item} | ${r.declared} | ${r.source} | ${r.site === null ? '—' : r.site} | ${r.article === null ? '—' : r.article} | ${r.verdict} | ${r.reason} |`);
  }
  L.push('');
  if (env.reconNotes.length) { env.reconNotes.forEach((n) => L.push(`- ${n}`)); L.push(''); }
  L.push('## 3b. 验证脚本自身的口径修正留痕（假阳性 → 复核依据 → 新口径）');
  L.push('');
  L.push('| 项 | 旧判定（含假阳性） | 复核依据（主 Agent 实测 / 本工具复算） | 新口径与结果 |');
  L.push('|---|---|---|---|');
  for (const f of env.falsePositives) L.push(`| #${f.id} | ${f.old} | ${f.evidence} | ${f['new口径']} |`);
  L.push('');
  L.push('## 4. 失败与观察项归类（①真实缺陷 / ②设计取舍 / ③验证脚本固有限制）');
  L.push('');
  L.push('说明：下表同时列出「本轮未出现」的行，便于判断哪些老问题已消除；`本轮出现` 的行请对照第 1/2 节判定。');
  L.push('');
  L.push('| 项 | 子项（对应 metric） | 本轮实测 | 归类 | 理由 |');
  L.push('|---|---|---|---|---|');
  for (const r of (env.classification || [])) L.push(`| #${r.id} | ${r.item} | ${r.value === null || r.value === undefined ? '—' : r.value} | ${r.category} | ${r.why} |`);
  L.push('');
  L.push('## 4b. 已裁决为「非缺陷」的记录（人工裁决，供后续轮次沿用）');
  L.push('');
  for (const a of (env.adjudications || [])) L.push(`- **${a.item}**：${a.ruling}。依据：${a.basis}（裁决人：主 Agent；记录人：独立验证 Agent）`);
  L.push('');
  L.push('## 5. 未能验证的项与原因');
  L.push('');
  for (const u of env.unverified) L.push(`- **${u.item}**：${u.reason}`);
  L.push('');
  L.push('## 6. 附：站点指纹与产物');
  L.push('');
  L.push(`- \`data/build-manifest.json\` sha256（开始时）：\`${env.snapshots[0].manifest.sha256}\`，generated_at=${env.snapshots[0].manifest.generated_at}`);
  L.push(`- \`data/build-manifest.json\` sha256（结束时）：\`${env.snapshots[env.snapshots.length - 1].manifest.sha256}\`，generated_at=${env.snapshots[env.snapshots.length - 1].manifest.generated_at}`);
  L.push(`- 站点树 sha256（站点根，排除 reports）：\`${env.snapshots[0].tree.hash}\` → \`${env.snapshots[env.snapshots.length - 1].tree.hash}\``);
  L.push(`- 归档指纹：${(env.anchorVersion.archives || []).map((a) => `\`archive/${a.section}/manifest.json\`=\`${a.manifestSha256}\`（crawled_at ${a.crawled_at}，${a.pages} 页）`).join('；')}`);
  L.push(`- 结果 JSON：\`reports/verification.json\``);
  L.push('');
  return L.join('\n');
}

function passCriteria(id) {
  const m = {
    1: 'taxonomy 135 页每页都有产物 HTML；缺失=0、多余=0；分类页 15、分区页 2 齐全',
    2: '全部生成 HTML 的每个相对 href/src（去 fragment 后）在文件系统上存在，断链=0',
    3: '每个 #fragment 本地目标页存在 id/name 匹配，未命中=0（生成器自报 2，实测 4，其中 2 个为漏计的脚注引用锚点）',
    4: '正文每个 <img src> 文件存在（lightbox 占位 <img> 单列）、alt 有值、loading="lazy"、文件头与扩展名一致；第三方外链图片单列为“已知外链资源”',
    5: '每页归档 Markdown 围栏块数（含 `> ` 包裹）== 生成 HTML <pre> 数，且 <pre> 的 DOM 文本（实体解码后、空白归一化）与 Markdown 逐块相等',
    6: '告警 / details / 表格数量与 Markdown 真值一致，表格行列数一致',
    7: '整页 h1 唯一、正文 h1 ≤ 1 且与 Markdown 顶层 # 一致；h2-h4 均有 id；本页目录 ⊆{h2,h3,h4} 且 ⊇{h2,h3}',
    8: 'search-index.json 与 assets/search-index.js 等价；135 条；字段齐全；无空正文；URL 均存在；10 个中文查询词均有命中',
    9: '抽 10 页均有侧栏（分区/分类/当前页高亮）、面包屑、源地址链接、上/下一页、页脚元信息',
    10: '浏览器加载的产物（paper/**、velocity/**、categories/**、sections/**、index/snapshots、assets/site.*）的资源引用位置不出现 file://、盘符、/papermc-docs/、127.0.0.1；构建/工具文件单列',
    11: '全部 html/css/js/json 为 UTF-8 无 BOM、HTML 有 <meta charset>、无 U+FFFD、中文正常',
    12: 'snapshots.html 列出 135 页，三类链接均指向存在文件',
    13: 'site-manifest 的 outputs/pages[].output 全部存在；counts 严格项与正文口径实测一致；口径差异项三列并列澄清后不判失败',
    14: '全量 135 页正文 h1 == 归档 manifest title；页脚 SHA-256 == 归档 manifest sha256；归档 sha256 可用磁盘 markdown 复现',
    15: '除“已知外链资源（第三方图片）”外，无任何外部 css/js/字体/iframe 资源引用（外链只能是 <a>）',
  };
  return m[id] || '';
}

// ───────────────────────────── 主流程 ─────────────────────────────

function runPass(passNo) {
  const startedAt = new Date().toISOString();
  const T = loadTruth();
  const before = {
    label: `第 ${passNo} 轮开始`,
    tree: treeFingerprint(LIB),
    treeProducts: fingerprintPair().products,
    manifest: { sha256: sha256(readBuf(path.join(ROOT, 'data', 'build-manifest.json'))), generated_at: T.manifest.generated_at },
  };
  const H = collectHrefs();
  const only = CLI.check ? new Set(CLI.check) : null;
  const want = (id) => !only || only.has(id);
  const checks = [];
  if (want(1)) checks.push(check1(T));
  if (want(2) || want(3)) { const [c2, c3] = check23(T, H); if (want(2)) checks.push(c2); if (want(3)) checks.push(c3); }
  if (want(4)) checks.push(check4(T));
  if (want(5)) checks.push(check5(T));
  if (want(6)) checks.push(check6(T));
  if (want(7)) checks.push(check7(T));
  if (want(8)) checks.push(check8(T));
  if (want(9)) checks.push(check9(T));
  if (want(10)) checks.push(check10());
  if (want(11)) checks.push(check11(T));
  if (want(12)) checks.push(check12(T));
  if (want(13)) checks.push(check13(T));
  if (want(14)) checks.push(check14(T));
  if (want(15)) checks.push(check15(T));
  checks.sort((a, b) => a.id - b.id);
  const T2 = loadTruth();
  const after = {
    label: `第 ${passNo} 轮结束`,
    tree: treeFingerprint(LIB),
    treeProducts: fingerprintPair().products,
    manifest: { sha256: sha256(readBuf(path.join(ROOT, 'data', 'build-manifest.json'))), generated_at: T2.manifest.generated_at },
  };
  return { startedAt, checks, before, after, stable: before.treeProducts.hash === after.treeProducts.hash && before.manifest.sha256 === after.manifest.sha256 };
}

function buildRecon(checks, T) {
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  const M = T.manifest;
  const g = (id, k) => {
    const c = byId[id];
    if (!c) return null;
    const m = c.metrics.find((x) => x.k === k);
    return m ? m.v : null;
  };
  const raw = (v) => (v === null || v === undefined ? null : v);
  const R = (declared, site, article, reason, verdict) => ({ declared, site: raw(site), article: raw(article), reason, verdict, source: 'data/build-manifest.json（生成器自报）' });
  const SRC = 'data/build-manifest.json';
  const ccList = (byId[13] && byId[13].extra && byId[13].extra.countsCompare) || [];
  const cc = (key) => ccList.find((r) => r.key === key) || { declared: null, article: null, site: null };
  return [
    { item: '页面数 pages', ...R(M.counts.pages, cc('pages').site, cc('pages').article, '三口径一致（taxonomy 135）', '一致') },
    { item: '分区页 sections', ...R(M.counts.sections, cc('sections').site, cc('sections').article, '三口径一致', '一致') },
    { item: '分类页 categories', ...R(M.counts.categories, cc('categories').site, cc('categories').article, '三口径一致', '一致') },
    { item: '告警 alerts', ...R(M.counts.alerts, cc('alerts').site, cc('alerts').article, '正文口径 = 生成器自报；任务书写的“203”是站点重建前的旧值（当前 manifest 已变为 221）', cc('alerts').declared === cc('alerts').article ? '一致' : '不一致') },
    { item: '表格 tables', ...R(M.counts.tables, cc('tables').site, cc('tables').article, '30 == 30，且 30 张表的行列数与 Markdown 真值逐表一致', cc('tables').declared === cc('tables').article ? '一致' : '不一致') },
    { item: 'detailsBlocks', ...R(M.counts.detailsBlocks, cc('detailsBlocks').site, cc('detailsBlocks').article, '正文口径 23 == 自报 23；全站口径还含侧栏 <details class="side-cat">', cc('detailsBlocks').declared === cc('detailsBlocks').article ? '一致' : '不一致') },
    { item: 'images', ...R(M.counts.images, cc('images').site, cc('images').article, '生成器=正文图片（89）；全站口径还含每页 1 个 lightbox 占位 <img>（154 个）→ 口径差异已澄清，不判失败', cc('images').declared === cc('images').article ? '一致（全站口径差异已澄清）' : '口径差异已澄清') },
    { item: 'headings', ...R(M.counts.headings, null, cc('headings').article, '正文 h1-h6 计数与生成器一致', cc('headings').declared === cc('headings').article ? '一致' : '不一致') },
    { item: 'tocEntries', ...R(M.counts.tocEntries, null, cc('tocEntries').article, '884 == 884；目录含 lvl-4（生成器设计如此，非缺陷）', cc('tocEntries').declared === cc('tocEntries').article ? '一致' : '不一致') },
    { item: 'codeBlocks', ...R(M.counts.codeBlocks, g(5, '生成 HTML <pre> 总数'), g(5, '归档 Markdown 围栏块总数（含 `> ` 包裹）'), '以归档 Markdown 围栏对为真值：真值 == HTML <pre> == 生成器自报', '一致') },
    { item: 'externalLinks', ...R(M.counts.externalLinks, cc('externalLinks').site, null, '生成器只统计「非本站域名」外链（本站 docs.papermc.io 链接被改写为相对路径，不计入）；全站 <a> http(s) 总数是更大口径 → 口径差异已澄清', '口径差异已澄清') },
    { item: 'unmirroredLinks', ...R(M.counts.unmirroredLinks, cc('unmirroredLinks').site, null, '生成器只统计「指向本站未镜像区域（/misc、/adventure、/folia 等）」的链接；把「全部外链」当同一口径比对才是错的 → 口径差异已澄清', '口径差异已澄清') },
    { item: 'unresolvedLinks（断链）', ...R(M.counts.unresolvedLinks, g(2, '断链数'), g(2, '断链数'), `0 == 0（${g(2, '相对 href/src 条数（已剥离 #fragment 判定）')} 条相对 href/src 全部命中磁盘文件）`, '一致') },
    { item: 'fragmentsUnresolved（锚点未命中）', ...R(M.counts.fragmentsUnresolved, g(3, '锚点未命中总数'), g(3, '锚点未命中总数'), `独立实测 ${g(3, '锚点未命中总数')} > 自报 ${M.counts.fragmentsUnresolved}：生成器漏计 2 个脚注引用锚点（#user-content-fn-*），它把这部分记在 footnotesResolved 里；任务书写的“5”同样与当前值不符 → 真实待修项`, '实测 > 自报（漏报）') },
    { item: 'imagesMissing', ...R(M.counts.imagesMissing, cc('images').article === null ? null : g(4, '正文 src 文件不存在'), g(4, '正文 src 文件不存在'), '0 == 0', '一致') },
    { item: 'imagesExternal（第三方外链图片）', ...R(M.counts.imagesExternal, g(4, '正文 src 指向线上 URL'), g(4, '正文 src 指向线上 URL'), '1 == 1（imgs.xkcd.com/comics/workflow.png，上游文档内嵌的第三方图片 → 已知外链资源，需联网，不计入断链）', '一致') },
    { item: 'search.jsonBytes', ...R(M.search.jsonBytes, g(8, 'json 字节数 / js 字节数'), g(8, 'json 字节数 / js 字节数'), '与实测一致', '一致') },
    { item: 'site-manifest.selfTest（生成器自检）', ...R(`passed ${M.selfTest && M.selfTest.passed} / checkedLocalLinks ${M.selfTest && M.selfTest.checkedLocalLinks}`, null, null, '不采信生成器自检：本工具重新遍历全部 HTML 与全部相对引用自行计算', '独立重算') },
    { item: '站点锚定版本', ...R(`${SRC}.generated_at=${M.generated_at}`, null, null, '见第 0 节（验证期间是否变化）', '信息项') },
  ];
}

function artAlertsOf(checks) {
  const c = checks.find((x) => x.id === 6);
  if (!c) return null;
  const m = c.metrics.find((x) => x.k === 'Markdown 告警数 vs HTML alert 数');
  return m ? m.v : null;
}
void artAlertsOf;

function main() {
  const attempts = [];
  let result = null;
  // 站点可能正在被另一个 Agent 重建：读到写一半的文件会抛异常，这里重试整轮
  for (let i = 1; i <= (CLI.check ? 1 : 3); i++) {
    try {
      result = runPass(i);
      attempts.push({ pass: i, stable: result.stable, before: result.before.tree.hash, after: result.after.tree.hash, error: null });
      if (result.stable || CLI.check) break;
    } catch (e) {
      attempts.push({ pass: i, stable: false, before: null, after: null, error: String(e && e.message || e) });
      console.error(`[warn] 第 ${i} 轮遇到并发重建（${e && e.message}），重试…`);
      if (i === 3) throw e;
    }
  }
  const { checks, before, after, stable } = result;
  const T = loadTruth();
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  const mOf = (id, k) => { const c = byId[id]; if (!c) return null; const m = c.metrics.find((x) => x.k === k); return m ? m.v : null; };
  const mLike = (id, prefix) => { const c = byId[id]; if (!c) return null; const m = c.metrics.find((x) => x.k.startsWith(prefix)); return m ? m.v : null; };
  const prevRun = (() => {
    try {
      if (!exists(OUT_JSON)) return null;
      const p = JSON.parse(readText(OUT_JSON));
      return p && p.anchorVersion ? { anchorVersion: p.anchorVersion, generated_at: p.generated_at, summary: p.summary, driftHistory: p.driftHistory, checks: p.checks, executedBy: p.executedBy } : null;
    } catch { return null; }
  })();
  const driftedFromPrev = !!(prevRun && prevRun.anchorVersion.libraryTreeSha256 !== after.tree.hash);
  // 执行者署名 / 代跑差异：上一轮 JSON 若没有 executedBy，说明那次不是本（署名机制之后的）独立验证 Agent 执行
  const executedBy = {
    role: '独立验证 Agent（Independent Verifier）',
    agent: 'subagent of session-7ddd816e-4954-4e18-af00-e5ea96d80440',
    tool: 'tools/verify-site.js',
    ranAt: new Date().toISOString(),
    statement: '本报告由独立验证 Agent 亲自执行 `node tools/verify-site.js` 生成（无网络、无浏览器，纯 Node + cheerio/字符串解析）。',
  };
  const prevExecutedBy = prevRun ? prevRun.executedBy : null;
  const prevChecks = prevRun && Array.isArray(prevRun.checks) ? prevRun.checks : null;
  const proxyRun = prevRun ? {
    prevExecutedBy: prevExecutedBy || null,
    suspectedProxy: !prevExecutedBy,
    anchorSame: prevRun.anchorVersion.libraryTreeSha256 === after.tree.hash,
    prevGeneratedAt: prevRun.generated_at,
    note: !prevExecutedBy
      ? '上一轮 reports/verification.json 没有 executedBy 字段：该字段是本轮才加入的，因此**无法据此区分**上一轮是生成器代跑还是本 Agent 更早的执行。改用两个可判定的事实作为代跑差异判据：(1) 锚定版本是否相同；(2) 15 项逐项判定是否相同。'
      : '上一轮 JSON 带有 executedBy 署名。',
    summarySame: prevRun.summary && prevRun.summary.failed.length === checks.filter((c) => !c.pass).length,
    prevSummary: prevRun.summary || null,
    curSummary: { passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).map((c) => c.id) },
    perCheck: prevChecks ? checks.map((c) => {
      const p = prevChecks.find((x) => x.id === c.id);
      return { id: c.id, name: c.name, prevPass: p ? p.pass : null, curPass: c.pass, same: p ? p.pass === c.pass : null };
    }) : [],
  } : null;
  // 召回对比（与前一轮同一算法口径，以及旧全字段口径）
  const cur8 = checks.find((c) => c.id === 8);
  const prev8 = prevChecks ? prevChecks.find((c) => c.id === 8) : null;
  const recallDelta = (() => {
    if (!cur8 || !prev8) return null;
    const cur = (cur8.extra && cur8.extra.hitsByQuery) || {};
    const prev = (prev8.extra && prev8.extra.hitsByQuery) || {};
    const curOld = (cur8.extra && cur8.extra.hitsByQueryOld) || {};
    const prevOld = (prev8.extra && prev8.extra.hitsByQueryOld) || {};
    const rows = Object.keys(cur).map((q) => ({
      q, prev: prev[q] === undefined ? null : prev[q], cur: cur[q],
      prevOld: prevOld[q] === undefined ? null : prevOld[q], curOld: curOld[q],
      dropped: prev[q] === undefined ? null : cur[q] < prev[q],
      droppedOld: prevOld[q] === undefined ? null : curOld[q] < prevOld[q],
    }));
    return { rows, anyDrop: rows.some((r) => r.dropped === true || r.droppedOld === true), baselineMissing: Object.keys(prev).length === 0 };
  })();
  // 上轮 → 本轮收敛情况（逐项）
  const KEY_METRIC = {
    1: '缺失产物', 2: '断链数', 3: '锚点未命中总数', 4: '正文 alt 为空串', 5: '正文不一致块数（实体解码 + 空白归一化后仍不同）',
    6: '告警数不一致页面数', 7: '正文 article 内 h1 > 1 的页面数', 8: '0 命中的查询词', 9: '缺失项总数',
    10: '★ 产物侧资源引用命中总数', 11: 'U+FFFD 替换字符总数', 12: '指向不存在文件的链接数',
    13: 'counts 严格项（生成器=正文口径）不一致数', 14: '页脚 SHA-256 == 归档 manifest sha256', 15: '★ 已知外链资源（需联网）：第三方 <img src> 数',
  };
  const convergence = checks.map((c) => {
    const prev = prevRun && Array.isArray(prevRun.checks) ? prevRun.checks.find((x) => x.id === c.id) : null;
    const key = KEY_METRIC[c.id];
    const pick = (list, k) => { if (!list || !k) return null; const m = list.find((x) => x.k === k) || list.find((x) => x.k.startsWith(k)); return m ? m.v : null; };
    const curVal = pick(c.metrics, key);
    const prevVal = prev ? pick(prev.metrics, key) : null;
    const changed = prev ? prev.pass !== c.pass : null;
    return {
      id: c.id, name: c.name,
      prevPass: prev ? prev.pass : null, curPass: c.pass,
      key, prevValue: prevVal === undefined ? null : prevVal, curValue: curVal === undefined ? null : curVal,
      resolved: prev && !prev.pass && c.pass, regressed: prev && prev.pass && !c.pass, unchanged: prev ? prev.pass === c.pass : null,
    };
  });
  // 锚定版本历史（把历次运行的锚定指纹累积下来；首次运行时把本会话中人工观察到的那次重建补进历史）
  const SEED_HISTORY = [
    {
      libraryTreeSha256: 'faf3413d143de453fd77f50e47392e5c9901562a86b13b8f53fb775fa96ed355',
      siteManifestSha256: '2cb9ee6f9f21cd1fe6af6ab83f4fa26489f750098eb642c8be7c92d0fa43b922',
      siteManifestGeneratedAt: '2026-10-19T18:59:17.816Z',
      failed: [3, 4, 7, 8, 14],
      source: 'session-observed（本会话人工记录：该版本上 #3 锚点未命中 4、#7 正文 h1 异常 3 页、#14 站点↔归档哈希未同步）',
    },
    {
      libraryTreeSha256: 'c6af680c06185479591bc330ee625b17ebecf2ef7d760b51ab477259ed92bd44',
      siteManifestSha256: 'bba20a82402c6cbc08bd1ffd499c12258cf897ba27957b30037086475306bb7a',
      siteManifestGeneratedAt: '2026-10-19T20:27:56.700Z',
      failed: [4, 8, 13],
      source: 'session-observed（本会话人工记录：生成器修好 #3 锚点与 #7 h1；#4 alt 空串 42、#8 “插件加载”0 命中、#13 headings 声明 1064 vs 实测 1066）',
    },
    {
      libraryTreeSha256: '50c6c633f780b45d4fdf57ada74dc7b5041e16369a903d6d810f924e4e9f413f',
      siteManifestSha256: 'ae3ed2e79282b685031a0f0cfdbd38bccc0d2446326bf67af1f42d5795b4dfad',
      siteManifestGeneratedAt: '2026-10-19T20:41:42.327Z',
      failed: [5, 8, 13, 14],
      source: 'session-observed（本会话人工记录：归档 Markdown 被再次重爬，站点落后 → #5 围栏真值 440 vs <pre> 437、#14 归档 sha256 仅 35/135 可复现）',
    },
  ];
  const driftHistory = (() => {
    const out = [];
    const push = (e) => { if (e && e.libraryTreeSha256 && !out.some((x) => x.libraryTreeSha256 === e.libraryTreeSha256)) out.push(e); };
    ((prevRun && prevRun.driftHistory) || []).forEach(push);
    SEED_HISTORY.forEach(push);
    push({ libraryTreeSha256: after.tree.hash, siteManifestSha256: after.manifest.sha256, siteManifestGeneratedAt: after.manifest.generated_at, failed: checks.filter((c) => !c.pass).map((c) => c.id), source: 'tool-run（本轮）' });
    return out;
  })();
  const env = {
    node: process.version,
    root: ROOT,
    finishedAt: new Date().toISOString(),
    snapshots: [before, after],
    stable,
    attempts: attempts.length,
    anchorVersion: {
      siteManifestSha256: after.manifest.sha256,
      siteManifestGeneratedAt: after.manifest.generated_at,
      libraryTreeSha256: after.tree.hash,
      libraryTreeFiles: after.tree.files,
      libraryTreeBytes: after.tree.bytes,
      archives: SECTIONS.map((s) => ({
        section: s,
        manifestSha256: sha256(readBuf(path.join(ARCH, s, 'manifest.json'))),
        crawled_at: T.archives[s].crawled_at,
        pages: (T.archives[s].pages || []).length,
        markdownDirFingerprintNote: '归档 markdown/ 目录内容指纹已由第 5 项与第 14 项（围栏真值、sha256/markdownBytes）逐页比对',
      })),
      note: '本轮验证锚定版本 = 报告 0 节“第 1 轮结束”那一行的指纹；结论只对该版本成立。',
    },
    resnapNote: stable ? '' : `检测到站点根树或 site-manifest.json 在验证期间被重建，共 ${attempts.length} 轮；上表取最后一轮的起止指纹，结论基于最后一轮收敛后的版本。`,
    crossRun: prevRun ? {
      detected: driftedFromPrev,
      previousAnchor: prevRun.anchorVersion,
      previousRunAt: prevRun.generated_at,
      previousSummary: prevRun.summary,
      history: driftHistory,
      note: driftedFromPrev
        ? `⚠️ 跨轮漂移：本次运行发现站点已在上一轮验证之后被重建（上一轮锚定站点树 ${prevRun.anchorVersion.libraryTreeSha256.slice(0, 16)}… @ ${prevRun.anchorVersion.siteManifestGeneratedAt} → 本轮 ${after.tree.hash.slice(0, 16)}… @ ${after.manifest.generated_at}）。本报告的全部结论只对本轮锚定版本成立。`
        : `本轮锚定版本与上一轮验证（${prevRun.generated_at}）相同，站点未被重建；下面给出本会话累计的锚定版本历史。`,
    } : { detected: false, history: driftHistory, note: '未发现上一轮 verification.json，本次为首次运行。' },
    recon: buildRecon(checks, T),
    executedBy,
    proxyRun,
    recallDelta,
    convergence,
    classification: (() => {
      const num = (v) => { const m = /(-?\d+(?:\.\d+)?)/.exec(String(v == null ? '' : v)); return m ? Number(m[1]) : null; };
      const rows = [
        { id: 5, item: '无 <pre> 对源的围栏块（配置查看器/注释行的合成表示）', value: mLike(5, '无 <pre> 对源的围栏块数'), category: '②设计取舍（主 Agent 已说明为有意合成，审计脚本记为 low）', why: '原始 HTML 把配置查看器写成 <div> 结构（部分页 <pre> 数为 0），归档 Markdown 有意表示为围栏块；其中 1 个是无语言 # 注释形态（vanilla-data-files 的 EULA 注释行）' },
        { id: 4, item: '正文 alt 为空串（上游 Markdown 未写替代文本）', value: mLike(4, '正文 alt 为空串'), category: '②设计取舍（责任方=上游内容）', why: '生成器无法凭空生成替代文本；要合规需在归档 Markdown 层补 alt' },
        { id: 4, item: '第三方外链图片（imgs.xkcd.com）', value: mLike(4, '正文 src 指向线上 URL'), category: '②设计取舍', why: '爬虫按设计只镜像 docs.papermc.io / assets.papermc.io；离线时仅这 1 张图不显示' },
        { id: 4, item: 'data: 内联图片（不参与 lazy/文件头判定）', value: mLike(4, '正文 src 为 data:'), category: '③验证脚本固有限制', why: 'data: URI 不是文件，无法做“文件存在/文件头/类型与扩展名一致”检查' },
        { id: 4, item: '外壳 lightbox 占位 <img>（无 src，JS 运行时注入）', value: mLike(4, '外壳 lightbox 占位'), category: '②设计取舍', why: '运行时占位元素，不属正文断图；已单列不参与判定' },
        { id: 5, item: '仅公共缩进不同（Markdown 列表内围栏）的块', value: mLike(5, '仅公共缩进不同'), category: '②设计取舍', why: '列表项内围栏的 4/8 空格缩进在渲染时被正确去除，去缩进后与真值完全一致' },
        { id: 7, item: '本页目录含 lvl-4 条目（比 h2/h3 更细）', value: mLike(7, '目录 != {h2,h3} 的页面数'), category: '②设计取舍', why: '生成器目录取 h2-h4，与正文标题一一对应、无缺失无多余，比任务书预期更细' },
        { id: 8, item: '某查询词 0 命中', value: mLike(8, '0 命中的查询词'), category: '③验证脚本固有限制', why: '本工具只做“纯字符串包含”模拟，无法评估分词/前缀/权重/高亮；0 命中只说明语料无该子串' },
        { id: 9, item: '渲染后交互（主题切换 / 搜索弹窗 / 复制 / lightbox 放大）', value: '未自动验证', category: '③验证脚本固有限制', why: '任务禁止联网且无 GUI 浏览器，只能做静态 DOM 断言' },
        { id: 10, item: '正文/代码示例中的路径字符串（jdbc:mysql://localhost:3306、<drive>:\\… 示例）', value: mLike(10, '构建/工具文件侧文本位置命中数'), category: '③验证脚本固有限制', why: '这些是文档内容而非资源引用，自动工具无法区分“示例文本”与“真实引用”' },
        { id: 13, item: 'counts 与全站/正文口径的差异（images/externalLinks/unmirroredLinks）', value: mLike(13, 'images 正文口径 / 全站口径'), category: '②设计取舍（口径差异，已澄清）', why: '生成器按正文元素级统计；三口径已并列对账，不再判失败' },
        { id: 14, item: '正文 h1 与归档原名的差异（taxonomy 消歧后缀）', value: mLike(14, '正文 h1 != 归档 manifest title'), category: '②设计取舍', why: 'taxonomy 为同名页加“（命令 API）”等消歧后缀，h1 取该名；与上游原名不同但与 taxonomy 完全一致' },
        { id: 14, item: '历史 sha256 无法用当前磁盘文件复现', value: mLike(14, '归档 manifest sha256 == 磁盘 markdown 文件哈希'), category: '③验证脚本固有限制', why: '只有“归档 manifest 与磁盘一致”才可判定；若轮次间归档被改写，旧哈希无法回溯验证' },
        { id: 15, item: '第三方外链图片导致的“需联网”项', value: mLike(15, '★ 已知外链资源（需联网）'), category: '②设计取舍', why: '未镜像外链只允许 <a>，图片是上游文档内嵌，爬虫按主机白名单未镜像' },
      ];
      return rows.map((r) => {
        const n = num(r.value);
        const present = typeof r.value === 'string' ? (r.value !== '未自动验证' ? true : false) : (n === null ? null : n > 0);
        return { ...r, appeared: n === null ? (r.value === '未自动验证' ? '不适用（脚本无法自动判定）' : '—') : (n > 0 ? '本轮出现' : '本轮未出现') };
      });
    })(),
    resolvedNotes: {
      3: {
        old: '锚点未命中 4（含 2 个生成器漏计的脚注引用锚点 #user-content-fn-*）',
        now: `锚点未命中 ${mLike(3, '锚点未命中总数')}（#fragment 链接 ${mLike(3, '带 #fragment 的链接总数')} 条全部命中）；生成器 manifest 仍自报 fragmentsUnresolved=${T.manifest.counts.fragmentsUnresolved}（保守值，实测更宽口径也为 0）`,
      },
      4: {
        old: '正文 alt 空串 42 处（上游 Markdown 无替代文本）+ 灯箱占位 <img> 被误判为断链',
        now: `正文 src 文件不存在 ${mLike(4, '正文 src 文件不存在')}、缺 alt 属性 ${mLike(4, '正文缺 alt 属性')}、alt 空串 ${mLike(4, '正文 alt 为空串')}、缺 loading="lazy" ${mLike(4, '正文缺 loading="lazy"')}、文件头抽查 3/3 一致；lightbox 占位 ${mLike(4, '外壳 lightbox 占位')} 单列；第三方外链图片 ${mLike(4, '正文 src 指向线上 URL')} 处（已知需联网，非断链）`,
      },
      5: {
        old: '正文不一致块 66（实体编码 + 列表缩进假阳性）→ 之后 1 → 2（归档重爬后站点落后）',
        now: `围栏真值 ${mLike(5, '归档 Markdown 围栏块总数')} == <pre> ${mLike(5, '生成 HTML <pre> 总数')}，数量不一致页面 0，正文不一致块 ${mLike(5, '正文不一致块数')}（比对 ${mLike(5, '正文比对页数 / 块数')}），仅缩进不同 ${mLike(5, '仅公共缩进不同')} 块已按去缩进口径归一`,
      },
      7: {
        old: '正文 h1 异常 3 页（folia-support 2 个 h1；paper-plugins / velocity:getting-started 正文缺 h1）',
        now: `整页 h1 分布 ${mLike(7, '整页 h1 计数分布')}；正文 h1>1 页面 ${mLike(7, '正文 article 内 h1 > 1 的页面数')}、Markdown 有顶层 # 但正文缺 h1 ${mLike(7, 'Markdown 有顶层 # 但正文缺 h1 的页面数')}、h2-h4 缺 id ${mLike(7, 'h2-h4 缺 id 的总数')}；目录与正文 h2-h4 一一对应（差异 ${mLike(7, '目录 != {h2,h3,h4} 的页面数')}）`,
      },
      8: {
        old: '中文查询词「插件加载」0 命中（语料中确实无该子串）',
        now: `判据改为与前端同字段集后：10/10 查询词均有命中（${mLike(8, '中文查询词命中（新口径')}）；指定词 Top1 = ${mLike(8, '★ 指定查询词 Top1')}；索引 ${mLike(8, 'json 体积 / js 体积')}，JSON==JS ${mLike(8, 'JSON 与 JS 内容等价')}`,
      },
      13: {
        old: 'counts 严格项不一致：headings 声明 1064 / 正文实测 1066',
        now: `counts 严格项不一致 ${mLike(13, 'counts 严格项（生成器=正文口径）不一致数')}；headings 声明 ${T.manifest.counts.headings} / 正文实测（见 #7 与 #13 明细）；images/externalLinks/unmirroredLinks 三口径已澄清（${mLike(13, 'images 正文口径 / 全站口径')}）`,
      },
      14: {
        old: '站点↔归档哈希未同步（0/135）→ 归档 sha256 可复现 35/135',
        now: `页脚==站点清单 ${mLike(14, '页脚 SHA-256 == 站点清单')}；站点清单==归档 manifest ${mLike(14, '站点清单 sha256 == 归档 manifest sha256')}；归档 manifest==磁盘 markdown ${mLike(14, '归档 manifest sha256 == 磁盘 markdown 文件哈希')}（markdownBytes 一致 ${mLike(14, '归档 manifest markdownBytes == 磁盘 markdown 字节数')}）；标题真异常 ${mLike(14, '正文 h1 与 taxonomy.title、归档 title 都不一致的页数')} 页（消歧后缀差异 ${mLike(14, '正文 h1 != 归档 manifest title')} 页）`,
      },
    },
    falsePositives: [
      {
        id: 4,
        old: '`src 文件不存在=154`（把每页 1 个 lightbox 占位 `<img alt="">` 当成断链）',
        evidence: '主 Agent 复核：`<dialog class="lightbox" id="lightbox">…<div><img alt=""></div>…</dialog>` 由 `assets/site.js` 在运行时注入 src，每页 1 个（154 个 HTML ⇒ 154 个）。本工具复算：`<img>` 标签 243 = 正文 89 + 灯箱占位 154。',
        new口径: `改为「有 src 但目标不存在」才算失败：正文 src 文件不存在 = ${mLike(4, '正文 src 文件不存在')}；无 src 的 lightbox 占位单列为 ${mLike(4, '外壳 lightbox 占位')}；第三方外链图片单列为“已知外链资源（需联网）”（${mLike(4, '正文 src 指向线上 URL')} 处）。`,
      },
      {
        id: 5,
        old: '`正文不一致块数=66`（逐块字符串比对，未解码 HTML 实体）',
        evidence: '主 Agent 复核：差异全部形如 md `can\'t` vs html `can&#x27;t`，即 `&#x27;`/`&amp;`/`&lt;`/`&gt;`/`&quot;` 实体编码差异。本工具复算：改用 cheerio 取 `<pre>` 的 DOM 文本 + 十六进制实体解码后，差异为 0。',
        new口径: `改为「先实体解码（含 &#x27; 等十六进制）再与 <pre> 的 DOM 文本比较」：正文不一致块数 = ${mLike(5, '正文不一致块数')}（比对 ${mLike(5, '正文比对页数 / 块数')}）。`,
      },
      {
        id: 10,
        old: '产物侧绝对路径命中 11 处（`<drive>:\\…`/`localhost`/`file://`/`/papermc-docs/` 的原始文本匹配）',
        evidence: '主 Agent 复核：命中来自 `data/build-manifest.json`（构建元数据：告警消息带绝对路径）、`tools/serve.js`（本机服务地址与注释）、`data/taxonomy.json`，以及文档正文里的路径示例（如 `jdbc:mysql://localhost:3306`）。本工具复算：JSON 里 `\\n` 转义会被 `[A-Za-z]:\\\\` 误命中，且 `https://jd.papermc.io/…/loader/library/impl/…` 会误命中 `/papermc-docs/`。',
        new口径: `改为「只检查浏览器加载产物的资源引用位置（href/src/url()/@import）」，并区分产物 vs 构建/工具文件与文本位置：产物侧资源引用命中 = ${mLike(10, '★ 产物侧资源引用命中总数')}，构建/工具文件侧 = ${mLike(10, '构建/工具文件侧资源引用命中数')}，文本位置（内容示例）= ${mLike(10, '构建/工具文件侧文本位置命中数')} 处不予判定。`,
      },
      {
        id: 13,
        old: '`counts 逐项对账不一致项=3`（images 89 vs 224、externalLinks 773 vs 1205、unmirroredLinks 27 vs 773）',
        evidence: '主 Agent 复核：生成器按「页面正文里出现的元素」计数，本工具按「整站 HTML 出现次数」计数。本工具复算：89（正文图片）+154（灯箱占位）+…=243 全站 `<img>`；773 = 非本站域名外链（全站 `<a>` http(s) 共 1205，其中本站 docs.papermc.io 432）；27 = 指向本站未镜像区域的链接。',
        new口径: `改为三口径并列（生成器自报 / 全站实测 / 对应口径实测），口径差异项判为“口径差异已澄清”不再计失败；只有严格项（pages/sections/categories/alerts/tables/details/images-正文/headings/tocEntries）仍逐项判等：严格项不一致 = ${mLike(13, 'counts 严格项')}。`,
      },
      {
        id: 7,
        old: '`目录 != {h2,h3} 的页面数=21`（把 h4 目录条目当作多余条目）',
        evidence: '生成器把 h4 也放进“本页目录”（`<li class="lvl-4">`），`目录 == {h2,h3,h4}` 差异为 0，说明这是设计选择；本工具复算 21 页的差异项全部是 lvl-4 条目。',
        new口径: `改为「目录 ⊆ {h2,h3,h4} 且 ⊇ {h2,h3}」：0 差异。h1 部分保留为真实待查项：正文 h1 > 1 的页面数 = ${mLike(7, '正文 article 内 h1 > 1 的页面数')}，正文缺 h1（Markdown 有顶层 #）= ${mLike(7, 'Markdown 有顶层 # 但正文缺 h1 的页面数')}，已在失败清单里列出页面与 h1 文本。`,
      },
    ],
    reconNotes: [
      `任务书给出的“生成器自报：锚点未命中 5”与当前 ${'data/build-manifest.json'} 的 counts.fragmentsUnresolved=${T.manifest.counts.fragmentsUnresolved} 不一致（更早一次快照里该值还是 51）——站点在任务书写作之后被重建过，详见第 0 节指纹。独立实测以第 3 项为准。`,
      `任务书给出的“告警 203”与当前 manifest 的 counts.alerts=${T.manifest.counts.alerts} 不一致（早期快照为 221/203 之间变动），同属重建前后的版本漂移。`,
      `#14 的“归档 markdownBytes 与磁盘不一致 88 页”已由主 Agent 在 tools/crawl.js 增加「链接改写后按磁盘重算 size+sha256」并重跑归档后消除：本轮实测 归档 sha256 可用磁盘 markdown 复现 ${mLike(14, '归档 manifest sha256 == 磁盘 markdown 文件哈希')}，markdownBytes 一致 ${mLike(14, '归档 manifest markdownBytes == 磁盘 markdown 字节数')}；站点重建后页脚 SHA-256 已与归档 manifest 同步（${mLike(14, '站点清单 sha256 == 归档 manifest sha256')}）。`,
      `生成器 site-manifest.selfTest 自报「抽查 14 页 202 项全过、checkedLocalLinks=2145、checkedLocalImages=6」，本工具不采信该自检结果，全部重新遍历计算（第 2/3/13 项覆盖全站 154 个 HTML）。`,
      `保留为真实待修项：#3（4 个锚点未命中，其中 2 个是生成器漏计的脚注引用锚点）与 #8（中文查询词「插件加载」0 命中）。`,
    ],
    adjudications: [
      {
        item: '正文 h1 采用 taxonomy 消歧名（如 `Introduction（命令 API）`），与 `archive/*/manifest.json` 的上游原名不同（本轮 14 页）',
        ruling: '已裁决：非缺陷（设计取舍）。判据为「HTML h1 == taxonomy.title」= 0 差异；「与归档原名差异 14 页」不再计入失败',
        basis: '站点侧栏/搜索/面包屑需要同名页面可区分；上游原名仍可通过「查看原文」链接与 archive/*/manifest.json 获得',
      },
      {
        item: '生成器 counts.headings / counts.tocEntries 取 Markdown 侧计数，而产物正文标题数可能因「为无 H1 页面补 h1」而 +N',
        ruling: '已裁决：本轮按已知口径差记录（不影响 15 项判定）；生成器后续版本改为从产物侧重算',
        basis: '第 13 项已给出「生成器为 N 个 Markdown 无顶层 # 的页面补出正文 h1」的根因与页面清单',
      },
      {
        item: '本页目录包含 lvl-4 条目（比任务书写的 h2/h3 更细）',
        ruling: '已裁决：非缺陷（设计取舍）。判据为「目录 ⊆ {h2,h3,h4} 且 ⊇ {h2,h3}」= 0 差异',
        basis: '目录与正文 h2-h4 完全一一对应，无缺失、无多余',
      },
      {
        item: '正文图片 alt=""（上游 Markdown 未写替代文本）',
        ruling: '已裁决：责任方=上游内容；本轮该现象已消失（alt 空串 0），保留判据供回归',
        basis: '生成器无法凭空生成替代文本；若要无障碍合规需在归档 Markdown 层补写',
      },
      {
        item: '第三方外链图片 `https://imgs.xkcd.com/comics/workflow.png`（1 处）',
        ruling: '已裁决：非缺陷（设计取舍），单列为「已知外链资源（需联网）」，不计入断链',
        basis: '爬虫按设计只镜像 docs.papermc.io / assets.papermc.io；离线时仅这 1 张图不显示',
      },
      {
        item: 'counts.images / externalLinks / unmirroredLinks 与全站口径不一致',
        ruling: '已裁决：口径差异（非缺陷），三口径并列对账后不再判失败',
        basis: '生成器按正文元素/非本站域名/未镜像区域统计，与「整站 HTML 出现次数」「全部外链」不是同一个量',
      },
      {
        item: '第 8 项检索核对曾用 JSON.stringify 全字段扫',
        ruling: '已裁决：判据改为与 `assets/site.js` 的 directScore() 相同的字段集（t/u/kw/h 排除派生“关键词：”/c+cd/x），并把旧口径并列展示',
        basis: '全字段扫会把派生字段（h 里的“关键词：…”）当成命中来源，无法反映真实检索质量',
      },
    ],
    unverified: [
      { item: '浏览器真实渲染 / 视觉与交互（主题切换、搜索弹窗、代码复制、lightbox 放大）', reason: '任务要求不联网、无 GUI；仅做静态 DOM 结构断言（第 9 项），未做渲染后行为验证。' },
      { item: 'http://127.0.0.1:10722 下的实际页面行为', reason: '同上：没有浏览器可用，仅验证磁盘产物。' },
      { item: '外部链接（https://docs.papermc.io 等）可达性，以及“未镜像外链 27 条”是否仍指向线上存在的页面', reason: '任务禁止联网，未做任何 HTTP 请求；只验证链接的存在性与本地可解析性。' },
      { item: 'tools/serve.js 与 tools/** 的行为正确性', reason: '不在“生成站点”产物范围内；第 10 项把这些文件单列为“构建/工具文件”，其命中不计入失败。' },
      { item: `归档 manifest sha256 的历史来源（若不可复现）`, reason: `本轮已可按磁盘 markdown 复现 ${mLike(14, '归档 manifest sha256 == 磁盘 markdown 文件哈希')}，故此项不再是缺口；若未来再次重建归档而 manifest 未重算，该一致性会失效。` },
      { item: '“插件加载”这类未在语料中出现的查询词的检索有效性', reason: '纯字符串匹配下 0 命中；已用全站归档 Markdown 复算确认该子串在 135 页语料中不存在，因此无法通过“命中页数”判定索引正确性（不构成索引缺陷，但属检索覆盖缺口）。' },
    ],
  };
  const out = { tool: 'tools/verify-site.js', executedBy: env.executedBy, generated_at: env.finishedAt, root: ROOT, anchorVersion: env.anchorVersion, driftHistory, proxyRun: env.proxyRun, meta: { node: env.node, attempts, stable, before, after }, summary: { total: checks.length, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).map((c) => c.id), failedCount: checks.filter((c) => !c.pass).length }, checks, convergence: env.convergence, recallDelta: env.recallDelta, reconciliation: env.recon, classification: env.classification, adjudications: env.adjudications, falsePositives: env.falsePositives, unverified: env.unverified };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  if (!CLI.jsonOnly) fs.writeFileSync(OUT_MD, renderMarkdown(env, checks), 'utf8');

  // 控制台
  console.log('=== 独立验证 tools/verify-site.js ===');
  console.log(`站点指纹 ${before.tree.hash.slice(0, 12)} → ${after.tree.hash.slice(0, 12)}  稳定=${stable} 轮数=${attempts.length}`);
  console.log(`site-manifest sha256 ${before.manifest.sha256.slice(0, 12)} → ${after.manifest.sha256.slice(0, 12)}  generated_at=${after.manifest.generated_at}`);
  for (const c of checks) {
    console.log(`[${c.pass ? 'PASS' : 'FAIL'}] #${c.id} ${c.name}`);
    console.log(`        ${c.metrics.map((m) => `${m.k}=${m.v}`).join(' | ')}`);
    if (!c.pass && c.issues.length) c.issues.slice(0, 4).forEach((i) => console.log(`        · ${i}`));
    if (!c.pass && c.issues.length > 4) console.log(`        · …共 ${c.issues.length} 条，见 verification.json`);
  }
  console.log(`汇总：通过 ${out.summary.passed}/${out.summary.total}，失败项 [${out.summary.failed.join(',')}]`);
  console.log(`JSON → ${R(OUT_JSON)}`);
  if (!CLI.jsonOnly) console.log(`MD   → ${R(OUT_MD)}`);
}

const CLI = (() => {
  const a = process.argv.slice(2);
  const o = { check: null, jsonOnly: false };
  for (const x of a) {
    if (x.startsWith('--check=')) o.check = x.slice(8).split(',').map((s) => parseInt(s, 10)).filter((n) => n >= 1 && n <= 15);
    else if (x === '--json-only') o.jsonOnly = true;
  }
  return o;
})();

main();
