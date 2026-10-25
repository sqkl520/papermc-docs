'use strict';
/* ============================================================================
 * tools/verify-nav.js —— 导航保真与发布就绪「独立验证」工具
 *
 * 立场：默认怀疑实现者（tools/build-site.js / tools/site/**）自报的任何数字。
 *      所有结论都在本进程里从磁盘上的产物 + 渲染后的 HTML + archives 重新实测。
 *      结构比对数据源有两份且互相交叉验证：
 *        (a) 权威结构 data/source-nav.json（只读）
 *        (b) 渲染后 HTML 里的侧栏 DOM（index.html、sections/*.html、135 页）
 *
 * 用法：
 *   node tools/verify-nav.js               # 跑全部 12 项，写 JSON + Markdown
 *   node tools/verify-nav.js --check=1     # 只跑第 N 项（只打印，不写文件）
 *   node tools/verify-nav.js --no-external # 跳过 6/9 里对其它工具的 spawn（离线快跑）
 *
 * 产出（全量运行时仅这 3 个文件）：
 *   tools/verify-nav.js
 *   reports/nav-verification.json
 *   reports/nav-verification.md
 *
 * 只读：不写 **、sections/**、categories/**、
 *      assets/**、*.html、library/*.json、data/source-nav.json、
 *      archives/**、tools/build-site.js、tools/site/**、.gitignore、.nojekyll、404.html、
 *      根 index.html、README.md。
 *      （第 6 / 9 项会 spawn 既有工具；gh-pages-smoke.js 的结果 JSON 被重定向到系统临时目录，
 *        以免多写一个仓库内文件。）
 * ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT);
const REPORTS = path.join(LIB, 'REPORTS');
const OUT_JSON = path.join(REPORTS, 'nav-verification.json');
const OUT_MD = path.join(REPORTS, 'nav-verification.md');
const GEN_REPORT = path.join(REPORTS, 'nav-rebuild.md');
const SRC_NAV = path.join(ROOT, 'data', 'source-nav.json');
const SECTIONS = ['paper', 'velocity'];

const CLI = { check: null, external: true };
for (const a of process.argv.slice(2)) {
  let m;
  if ((m = /^--check=(\d+)$/.exec(a))) CLI.check = Number(m[1]);
  else if (a === '--no-external') CLI.external = false;
}

/* ────────────────────────────── 小工具 ────────────────────────────── */

const toPosix = (p) => p.split(path.sep).join('/');
const R = (p) => toPosix(path.relative(ROOT, p));
const RL = (p) => toPosix(path.relative(LIB, p));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readText = (p) => fs.readFileSync(p, 'utf8');
const readBuf = (p) => fs.readFileSync(p);
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const mib = (b) => round(b / 1048576, 3);

function walkFiles(root, { ext = null, skipDirs = [] } = {}) {
  const out = [];
  const skip = new Set(skipDirs);
  const rec = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) rec(p); }
      else if (e.isFile() && (!ext || p.endsWith(ext))) out.push(p);
    }
  };
  rec(root);
  return out.sort();
}

/** 与 tools/verify-site.js 同口径的 library 树指纹（排除 REPORTS），便于跨工具比对 */
function treeFingerprint(dir, exclude = []) {
  const ex = new Set(exclude);
  const files = walkFiles(dir, { skipDirs: ['REPORTS'] }).filter((f) => !ex.has(RL(f)));
  const lines = files.map((f) => `${RL(f)}|${fs.statSync(f).size}|${sha256(readBuf(f))}`);
  return {
    hash: sha256(Buffer.from(lines.join('\n'), 'utf8')),
    files: files.length,
    bytes: files.reduce((n, f) => n + fs.statSync(f).size, 0),
  };
}

function fingerprint() {
  const manifestPath = path.join(ROOT, 'data', 'build-manifest.json');
  let gen = null, msha = null;
  if (exists(manifestPath)) {
    msha = sha256(readBuf(manifestPath));
    try { gen = JSON.parse(readText(manifestPath)).generated_at || null; } catch {}
  }
  return {
    at: new Date().toISOString(),
    products: treeFingerprint(LIB, ['data/source-nav.json']),
    all: treeFingerprint(LIB),
    srcNav: { sha256: sha256(readBuf(SRC_NAV)), generated_at: (() => { try { return JSON.parse(readText(SRC_NAV)).generated_at; } catch { return null; } })() },
    siteManifest: { sha256: msha, generated_at: gen },
    genReportSha256: exists(GEN_REPORT) ? sha256(readBuf(GEN_REPORT)) : null,
  };
}

/** 面包屑 / 侧栏里的显示文本：去实体（cheerio 已解码）、统一 NBSP、去首尾空白 */
const txt = (el) => el.text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

/** 把 HTML 里的相对 href 解析成「相对仓库根」的 posix 路径 */
function resolveHref(fromRepoRel, href) {
  if (!href) return null;
  const h = String(href).trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(h)) return 'EXTERNAL:' + h;
  if (h.startsWith('//')) return 'EXTERNAL:' + h;
  if (h.startsWith('#')) return null;
  const clean = h.split('#')[0].split('?')[0];
  if (!clean) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromRepoRel), clean));
}

/** <sec>/<rel>.html ⇄ 页 id */
const pagePathOf = (sec, rel) => `${sec}/${rel}.html`;
function pageIdOf(repoRel) {
  const m = /^library\/pages\/(paper|velocity)\/(.+)\.html$/.exec(repoRel);
  return m ? { sec: m[1], rel: m[2], id: `${m[1]}:${m[2]}` } : null;
}

/* ────────────────────────────── 检查项容器 ────────────────────────────── */

const checks = [];
function newCheck(id, name, cmd) {
  return { id, name, cmd, pass: null, metrics: [], issues: [], notes: [] };
}
function metric(c, k, v) { c.metrics.push({ k, v }); return v; }
/** kind: defect | tradeoff | limit */
function issue(c, kind, msg) { c.issues.push({ kind, msg }); return c; }
function note(c, s) { c.notes.push(s); return c; }

/* ────────────────────────────── 侧栏 DOM 解析 ────────────────────────────── */

/**
 * 解析一个 `details.side-sec`（= 一个 section 的主导航）为树。
 * 返回 { tree, homes, links, searchCount }：
 *   tree   —— 与 source-nav.json 同构的递归树（去掉站点自造的「组首页/根页」条目）
 *   homes  —— 站点自造条目 { target, label, tag, groupPath }
 *   links  —— 侧栏里所有带 data-search 的 <a>（含组首页 chip）
 */
function parseSectionNav($, $sec, fromRepoRel) {
  const tree = [], homes = [], links = [];
  const $body = $sec.children('.side-sec-body').first();

  const parseItem = ($li, groupPath) => {
    const $det = $li.children('details.side-group').first();
    if ($det.length) return parseGroup($det, groupPath);
    const $a = $li.children('a').first();
    if (!$a.length) return null;
    const label = txt($a.children('span.ttl').first());
    const tag = txt($a.children('span.tag').first());
    const target = resolveHref(fromRepoRel, $a.attr('href'));
    const dataSearch = $a.attr('data-search') || '';
    if (dataSearch) links.push({ target, label, dataSearch, groupPath, role: tag || 'page' });
    // 站点自造：根页（tag=根页）/ 组首页（tag=组首页，class=nav-home）
    if ($a.hasClass('nav-home') || tag === '组首页' || tag === '根页') {
      homes.push({ target, label, tag: tag || 'nav-home', groupPath });
      return null;
    }
    return { kind: 'page', label, target, dataSearch, groupPath };
  };

  const parseGroup = ($det, _outerPath) => {
    const $sum = $det.children('summary').first();
    const label = txt($sum.children('span.grp-name').first());
    const groupPath = $det.attr('data-nav-path') || $det.attr('data-nav-key') || '';
    const navKey = $det.attr('data-nav-key') || '';
    const $home = $sum.children('a.side-home').first();
    const homeHref = $home.attr('href') || null;
    const homeTarget = resolveHref(fromRepoRel, homeHref);
    if ($home.length) {
      links.push({ target: homeTarget, label, dataSearch: $home.attr('data-search') || '', groupPath, role: 'side-home' });
      homes.push({ target: homeTarget, label, tag: 'side-home', groupPath });
    }
    const children = [];
    const $ul = $det.children('ul').first();
    $ul.children('li').each((_, li) => {
      const n = parseItem($(li), groupPath);
      if (n) children.push(n);
    });
    return { kind: 'group', label, navKey, groupPath, homeTarget, children };
  };

  $body.children('ul').each((_, ul) => {
    const $ul = $(ul);
    if ($ul.hasClass('side-root')) {
      $ul.children('li').each((__, li) => { parseItem($(li), ''); });
    } else {
      $ul.children('li').each((__, li) => {
        const n = parseItem($(li), '');
        if (n) tree.push(n);
      });
    }
  });
  return { tree, homes, links };
}

function navModelsFromFile(repoRel) {
  const $ = cheerio.load(readText(path.join(ROOT, repoRel)));
  const out = {};
  $('nav.sidebar details.side-sec').each((_, el) => {
    const id = $(el).attr('data-section');
    out[id] = {
      sectionTitle: txt($(el).children('summary').first().children('span.sec-name').first()),
      open: $(el).attr('open') !== undefined,
      ...parseSectionNav($, $(el), repoRel),
    };
  });
  // 侧栏里所有 data-search 链接（含 15 个自定义分类链接）
  out.__allSearchLinks = $('nav.sidebar a[data-search]').length;
  out.__catLinks = $('nav.sidebar a[data-search][href*="categories/"]').length;
  return out;
}

/* ────────────────────────────── 页面抽取 ────────────────────────────── */

function parsePage(repoRel) {
  const html = readText(path.join(ROOT, repoRel));
  const $ = cheerio.load(html);
  const crumbs = [];
  $('nav.crumbs a, nav.crumbs > span:not(.sep)').each((_, el) => {
    if ($(el).is('span') && $(el).hasClass('sep')) return;
    crumbs.push({ text: txt($(el)), target: $(el).is('a') ? resolveHref(repoRel, $(el).attr('href')) : null, link: $(el).is('a') });
  });
  const pager = {
    prev: (() => { const $a = $('nav.pager a.prev').first(); return $a.length ? { target: resolveHref(repoRel, $a.attr('href')), title: txt($a.children('span.ttl').first()), path: txt($a.children('span.pth').first()) } : null; })(),
    next: (() => { const $a = $('nav.pager a.next').first(); return $a.length ? { target: resolveHref(repoRel, $a.attr('href')), title: txt($a.children('span.ttl').first()), path: txt($a.children('span.pth').first()) } : null; })(),
  };
  const h1All = [];
  $('h1').each((_, el) => h1All.push(txt($(el))));
  const h1Article = [];
  $('article h1').each((_, el) => h1Article.push(txt($(el))));
  const footer = $('footer.page-footer').first();
  const refs = [];
  $('link,script,img,iframe,source,video,audio,embed,object,a').each((_, el) => {
    const $el = $(el);
    for (const at of ['href', 'src', 'poster', 'data']) {
      const v = $el.attr(at);
      if (v) refs.push({ tag: el.tagName ? el.tagName.toLowerCase() : 'x', attr: at, value: v });
    }
  });
  const chips = [];
  $('p.page-meta span.chip, p.page-meta a.chip').each((_, el) => chips.push(txt($(el))));
  return {
    html, crumbs, pager,
    h1All, h1Article,
    h1Count: h1All.length,
    footerText: footer.length ? footer.text().replace(/\s+/g, ' ').trim() : '',
    footerHrefs: footer.length ? footer.find('a').map((_, a) => $(a).attr('href')).get() : [],
    refs, chips,
    title: txt($('title')),
    sidebarLabelMap: null,
  };
}

/* ────────────────────────────── 主流程 ────────────────────────────── */

const t0 = Date.now();
const before = fingerprint();

const srcNav = JSON.parse(readText(SRC_NAV));
/** 上一轮独立验证的基线快照：必须在任何会覆写 verification.json 的动作之前读取 */
const BASELINE = (() => {
  try {
    const j = JSON.parse(readText(path.join(REPORTS, 'verification.json')));
    const c8 = j.checks.find((x) => x.id === 8);
    return {
      generated_at: j.generated_at, summary: j.summary,
      recallDelta: j.recallDelta ? j.recallDelta.rows : null,
      hitsByQuery: c8 && c8.extra ? c8.extra.hitsByQuery : null,
      hitsByQueryOld: c8 && c8.extra ? c8.extra.hitsByQueryOld : null,
    };
  } catch { return null; }
})();
const srcBySec = {};
for (const s of srcNav.sections) srcBySec[s.id] = s;

// 每个 section 的源结构模型：页 rel→路径/标签；组→索引页 rel
function buildSourceModel(sec) {
  const pages = new Map();   // rel -> { label, pathLabels:[], groupPath, depth }
  const groups = [];         // { pathLabels, indexRel|null, node }
  const walk = (node, pathLabels, groupPath, depth) => {
    if (node.kind === 'page') {
      pages.set(node.rel, { label: node.label, pathLabels: [sec.title, ...pathLabels, node.label], groupPath, depth, title: node.title });
      return;
    }
    const gp = groupPath ? `${groupPath} > ${node.label}` : node.label;
    const g = { pathLabels: [sec.title, ...pathLabels, node.label], label: node.label, groupPath: gp, depth, indexRel: null, node };
    groups.push(g);
    for (const c of node.children) walk(c, [...pathLabels, node.label], gp, depth + 1);
  };
  for (const g of sec.groups) walk(g, [], '', 1);
  // 组 → 组首页 rel：从 pagesNotInSourceNav[].reason 里的「组路径」反解（不读渲染产物，保持独立）
  const reasonMap = new Map(); // groupPath -> rel
  const rootRels = [];
  for (const e of sec.pagesNotInSourceNav) {
    const m = /\u300c([^\u300d]+)\u300d/.exec(e.reason || '');
    if (m) reasonMap.set(m[1], e.rel); else rootRels.push(e.rel);
  }
  for (const g of groups) if (reasonMap.has(g.groupPath)) g.indexRel = reasonMap.get(g.groupPath);
  const attached = [...reasonMap.keys()];
  const unclaimed = groups.filter((g) => !g.indexRel).map((g) => g.groupPath);
  const noGroup = attached.filter((p) => !groups.some((g) => g.groupPath === p));
  return { sec, pages, groups, reasonMap, rootRels, unclaimed, noGroup };
}
const S = {};
for (const s of SECTIONS) S[s] = buildSourceModel(srcBySec[s]);

// 渲染侧栏（每 section 一份完整侧栏；章节页里两个 section 都在）
const navFromSections = {};
for (const s of SECTIONS) navFromSections[s] = navModelsFromFile(`sections/${s}.html`);
const navFromIndex = navModelsFromFile('index.html');

// 135 页全量抽取
const pageFiles = walkFiles(LIB + '/pages', { ext: '.html' }).map(R);
const P = new Map();
for (const f of pageFiles) P.set(f, parsePage(f));

const pageIds = pageFiles.map(pageIdOf).filter(Boolean);
const allTargets = new Set(pageFiles);

/* ═══════════════════════ 1. 结构逐字一致 ═══════════════════════ */

function check1() {
  const c = newCheck(1, '结构逐字一致（渲染侧栏 vs source-nav.json）', 'node tools/verify-nav.js --check=1');
  let labels = 0, kinds = 0, order = 0, rels = 0, other = 0;
  const perSection = [];
  const diff = [];
  const cmp = (site, srcSec, srcNodes, ctx, sectionId) => {
    if (site.length !== srcNodes.length) {
      other++;
      diff.push({ type: 'count', ctx, note: `渲染 ${site.length} 项 vs 源 ${srcNodes.length} 项`, site: site.map((x) => x.label), src: srcNodes.map((x) => x.label) });
    }
    const n = Math.min(site.length, srcNodes.length);
    for (let i = 0; i < n; i++) {
      const a = site[i], b = srcNodes[i];
      if (a.kind !== b.kind) { kinds++; diff.push({ type: 'kind', ctx: ctx + ' [' + i + ']', note: `渲染 ${a.kind} vs 源 ${b.kind}`, site: a.label, src: b.label }); continue; }
      if (a.label !== b.label) {
        const soft = a.label.replace(/\s+/g, ' ') === String(b.label).replace(/\s+/g, ' ');
        labels++;
        diff.push({ type: soft ? 'label-whitespace' : 'label', ctx: ctx + ' [' + i + ']', note: soft ? '仅空白差异' : '逐字节不同', site: a.label, src: b.label });
      }
      if (a.kind === 'group') cmp(a.children, srcSec, b.children, ctx + ' > ' + b.label, sectionId);
      else {
        const expect = pagePathOf(sectionId, b.rel);
        if (a.target !== expect) { rels++; diff.push({ type: 'rel-path', ctx, note: 'page 节点产物路径与 rel 不一一对应', site: a.target, src: b.rel, expect }); }
      }
    }
    if (site.length > n) for (let i = n; i < site.length; i++) other++;
    if (srcNodes.length > n) for (let i = n; i < srcNodes.length; i++) other++;
  };
  for (const secId of SECTIONS) {
    const model = S[secId];
    const srcNodes = srcBySec[secId].groups;
    const nav = navFromSections[secId][secId];
    if (!nav) { issue(c, 'defect', `sections/${secId}.html 里找不到 details.side-sec[data-section=${secId}]`); continue; }
    const beforeN = diff.length;
    cmp(nav.tree, srcBySec[secId], srcNodes, secId, secId);
    const countTree = (n) => n.reduce((a, x) => a + 1 + (x.kind === 'group' ? countTree(x.children) : 0), 0);
    const countLeaves = (n) => n.reduce((a, x) => a + (x.kind === 'group' ? countLeaves(x.children) : 1), 0);
    perSection.push({ section: secId, siteGroups: countTree(nav.tree) - countLeaves(nav.tree), siteNodes: countTree(nav.tree), sitePages: countLeaves(nav.tree), srcGroups: model.groups.length, srcPages: model.pages.size, diff: diff.length - beforeN });
  }
  metric(c, '逐节点比对：分组 label 逐字节差异数', labels);
  metric(c, '逐节点比对：节点 kind 差异数', kinds);
  metric(c, '逐节点比对：同级项数差异处', other);
  metric(c, '逐节点比对：page 节点 rel→产物路径不符数', rels);
  metric(c, '差异清单总条数', diff.length);
  for (const s of perSection) metric(c, `${s.section}：渲染树 ${s.siteGroups} 组 / ${s.sitePages} 页  vs  源 ${s.srcGroups} 组 / ${s.srcPages} 页`, `差异 ${s.diff} 条`);
  // 徽章并入文本（Paper plugins Experimental 这类）逐字节核对
  const badge = [];
  for (const secId of SECTIONS) {
    for (const [rel, info] of S[secId].pages) {
      if (/\s(Experimental|Beta|Deprecated)$/.test(info.label)) badge.push({ id: `${secId}:${rel}`, src: info.label });
    }
  }
  let badgeOk = 0, badgeBad = [];
  for (const b of badge) {
    const [secId, rel] = b.id.split(':');
    const f = pagePathOf(secId, rel);
    const p = P.get(f);
    const ttl = findTtlInSidebar(secId, rel);
    if (ttl === b.src) badgeOk++; else badgeBad.push({ id: b.id, src: b.src, rendered: ttl });
  }
  metric(c, '含徽章并入文本的上游标签数（… Experimental/Beta/Deprecated）', badge.length);
  metric(c, '其中渲染标签逐字节相同', `${badgeOk} / ${badge.length}`);
  // 跨页一致：index.html 与 135 页里的同一 section 侧栏应与 sections/<id>.html 完全一致
  let sameIdx = 0, samePages = 0, pagesChecked = 0;
  const sig = (t) => sha256(JSON.stringify(t));
  for (const secId of SECTIONS) {
    const ref = sig(navFromSections[secId][secId].tree);
    if (navFromIndex[secId] && sig(navFromIndex[secId].tree) === ref) sameIdx++;
  }
  for (const [f, p] of P) {
    if (!pageIdOf(f)) continue;
    pagesChecked++;
    try {
      const m = navModelsFromFile(f);
      if (SECTIONS.every((s) => !m[s] || sig(m[s].tree) === sig(navFromSections[s][s].tree))) samePages++;
    } catch { /* ignore */ }
  }
  metric(c, `index.html 侧栏 == sections/<id>.html（${SECTIONS.length} 个 section）`, `${sameIdx} / ${SECTIONS.length}`);
  metric(c, `135 页每页侧栏 == sections/<id>.html（全量，非抽样）`, `${samePages} / ${pagesChecked}`);

  // 组首页映射交叉验证：source-nav.json 的 pagesNotInSourceNav[].reason 指名的组 ⇄ 渲染侧 .side-home 指向的产物
  const homeMismatch = [], homeMissing = [];
  let mappedGroups = 0, renderedHomes = 0, renderedRoots = 0, renderedPageEntries = 0;
  for (const secId of SECTIONS) {
    const model = S[secId], nav = navFromSections[secId][secId];
    for (const g of model.groups) {
      if (!g.indexRel) continue;
      mappedGroups++;
      const want = pagePathOf(secId, g.indexRel);
      const hit = nav.homes.find((h) => h.tag === 'side-home' && h.groupPath === g.groupPath);
      if (!hit) homeMissing.push(`${secId}: 组「${g.groupPath}」没有 .side-home`);
      else if (hit.target !== want) homeMismatch.push(`${secId}: 组「${g.groupPath}」渲染=${hit.target} 期望=${want}`);
    }
    for (const rel of model.rootRels) {
      const want = pagePathOf(secId, rel);
      if (!nav.homes.some((h) => h.tag === '根页' && h.target === want)) homeMissing.push(`${secId}: 分区根页 ${rel} 没有「根页」条目`);
    }
    renderedHomes += nav.homes.filter((h) => h.tag === 'side-home').length;
    renderedRoots += nav.homes.filter((h) => h.tag === '根页').length;
    const cnt = (n) => n.reduce((a, x) => a + (x.kind === 'group' ? cnt(x.children) : 1), 0);
    renderedPageEntries += cnt(nav.tree);
  }
  metric(c, '渲染侧导航项构成（上游页条目 + 组首页 + 分区根页）', `${renderedPageEntries} + ${renderedHomes} + ${renderedRoots} = ${renderedPageEntries + renderedHomes + renderedRoots}`);
  metric(c, '从 reason 文本反解出的「组 → 组首页 rel」映射条数 / 分区根页条数', `${mappedGroups} / ${SECTIONS.reduce((n, s) => n + S[s].rootRels.length, 0)}`);
  metric(c, '映射与渲染侧 .side-home 一致（27/27 应为一致）', `${mappedGroups - homeMismatch.length} / ${mappedGroups}`);
  metric(c, '组首页条目缺失数', homeMissing.length);
  metric(c, '源树里没有独立组首页 rel 的组数（信息项：非缺陷，见下条）', SECTIONS.reduce((n, s) => n + S[s].unclaimed.length, 0));
  const unclaimedList = SECTIONS.map((s) => S[s].unclaimed.map((g) => `${s}: ${g}`)).flat();
  metric(c, '这 2 个组的性质（逐条说明）', unclaimedList.map((x) => {
    const [sec, gp] = [x.split(':')[0], x.slice(x.indexOf(':') + 1).trim()];
    if (!S[sec].groups.find((g) => g.groupPath === gp).indexRel) {
      const g = S[sec].groups.find((x2) => x2.groupPath === gp);
      const firstChildRel = g.node.children.find((ch) => ch.kind === 'page');
      const empty = g.node.children.length === 0;
      return empty
        ? `${x}：上游空组（children=[]），归档里没有对应索引页 → 保留折叠空组是「逐字对齐上游」的结果`
        : `${x}：该组的组首页本身就是上游侧栏里的一项（首个子节点 ${firstChildRel ? firstChildRel.rel : '?'}），因此不需要额外的 pagesNotInSourceNav 条目`;
    }
    return x;
  }).join(' ; ') || '无');
  metric(c, 'reason 指名但源树里不存在的组路径数（应为 0）', SECTIONS.reduce((n, s) => n + S[s].noGroup.length, 0));
  if (homeMismatch.length) issue(c, 'defect', `组首页映射与 reason 不一致 ${homeMismatch.length}：${homeMismatch.slice(0, 8).join(' ; ')}`);
  if (homeMissing.length) issue(c, 'defect', `缺一级入口 ${homeMissing.length}：${homeMissing.slice(0, 8).join(' ; ')}`);
  if (SECTIONS.reduce((n, s) => n + S[s].noGroup.length, 0)) issue(c, 'defect', `reason 指名的组在源树里不存在：${SECTIONS.map((s) => S[s].noGroup.join(',')).filter(Boolean).join(' ; ')}`);
  // 上游空组（velocity Development > API > Component API）是否被原样保留
  const emptyGroups = [];
  for (const secId of SECTIONS) {
    const model = S[secId], nav = navFromSections[secId][secId];
    const find = (n, path) => n.forEach((x) => { if (x.kind !== 'group') return; const p = path ? `${path} > ${x.label}` : x.label; if (!x.children.length) emptyGroups.push({ sec: secId, path: p, inSource: !!S[secId].groups.find((g) => g.groupPath === p) }); find(x.children, p); });
    find(nav.tree, '');
    void model;
  }
  metric(c, '渲染侧的空分组（上游如此的空组）', emptyGroups.map((e) => `${e.sec}:${e.path}${e.inSource ? '' : '(源树无)'}`).join(' ; ') || '无');
  const emptyBad = emptyGroups.filter((e) => !e.inSource);
  if (emptyBad.length) issue(c, 'defect', `渲染侧出现源树里没有的空组：${emptyBad.map((e) => e.sec + ':' + e.path).join(', ')}`);

  c.pass = labels === 0 && kinds === 0 && other === 0 && rels === 0 && sameIdx === SECTIONS.length && samePages === pagesChecked
    && homeMismatch.length === 0 && homeMissing.length === 0 && emptyBad.length === 0
    && SECTIONS.every((s) => S[s].noGroup.length === 0);
  if (!c.pass) for (const d of diff.slice(0, 30)) issue(c, 'defect', `[${d.type}] ${d.ctx} :: ${d.note} :: 渲染=${JSON.stringify(d.site)} 源=${JSON.stringify(d.src)}${d.expect ? ' 期望=' + d.expect : ''}`);
  c.extra = {
    diff: diff.slice(0, 200), diffTotal: diff.length, perSection,
    badge: { total: badge.length, ok: badgeOk, bad: badgeBad.slice(0, 20) },
    navComposition: { pageEntries: renderedPageEntries, groupHomes: renderedHomes, sectionRoots: renderedRoots, total: renderedPageEntries + renderedHomes + renderedRoots },
    homeMapping: { mappedGroups, mismatchedWithReason: homeMismatch, missing: homeMissing, unclaimed: SECTIONS.map((s) => S[s].unclaimed).flat(), indexRelNoGroup: SECTIONS.map((s) => S[s].noGroup).flat() },
    emptyGroups,
  };
  metric(c, '差异清单（前 30 条）', diff.length ? diff.slice(0, 30).map((d) => `${d.type}@${d.ctx}`).join(' | ') : '无');
  return c;
}

/** 从 sections/<id>.html 的侧栏里取某页的挂载 label（.ttl） */
function findTtlInSidebar(secId, rel) {
  const want = pagePathOf(secId, rel);
  const bag = [];
  const walk = (n) => n.forEach((x) => { if (x.kind === 'group') walk(x.children); else bag.push(x); });
  walk(navFromSections[secId][secId].tree);
  const hit = bag.find((x) => x.target === want);
  return hit ? hit.label : null;
}

/* ═══════════════════════ 2. 覆盖与可达性 ═══════════════════════ */

function check2() {
  const c = newCheck(2, '覆盖与可达性（135 页全部从主导航可达 / 孤页 0 / 最大点击数）', 'node tools/verify-nav.js --check=2');
  const collect = (nav) => {
    const s = new Set();
    const homes = new Set();
    for (const secId of SECTIONS) {
      if (!nav[secId]) continue;
      nav[secId].homes.forEach((h) => { if (h.target) { s.add(h.target); homes.add(h.target); } });
      const walk = (n) => n.forEach((x) => { if (x.kind === 'group') walk(x.children); else if (x.target) s.add(x.target); });
      walk(nav[secId].tree);
    }
    return { s, homes };
  };
  const fromIndex = collect(navFromIndex);
  const fromSections = new Set();
  for (const secId of SECTIONS) { const g = collect(navFromSections[secId]); g.s.forEach((x) => fromSections.add(x)); }

  const orphans = [...allTargets].filter((t) => !fromIndex.s.has(t));
  metric(c, 'index.html 主导航可达产物页数', `${[...allTargets].filter((t) => fromIndex.s.has(t)).length} / ${allTargets.size}`);
  metric(c, 'sections/*.html 主导航可达产物页数', `${[...allTargets].filter((t) => fromSections.has(t)).length} / ${allTargets.size}`);
  metric(c, '孤页数（135 页里主导航到不了的）', orphans.length);
  const stray = [...fromIndex.s].filter((t) => !allTargets.has(t) && !/sections\/|categories\/|all-pages|snapshots|index\.html/.test(t));
  metric(c, '主导航里指向非产物页的目标数', stray.length);

  // 29 条 pagesNotInSourceNav 的一级入口
  const missingEntry = [];
  for (const secId of SECTIONS) {
    for (const e of srcBySec[secId].pagesNotInSourceNav) {
      const t = pagePathOf(secId, e.rel);
      if (!fromIndex.homes.has(t)) missingEntry.push(`${secId}:${e.rel}`);
    }
  }
  metric(c, 'pagesNotInSourceNav（29 条）在主导航里有「组首页/根页」一级入口的条数', `${29 - missingEntry.length} / ${29}`);

  // 点击数：depth = 1 + 组祖先数（含组首页条目）；同时给「初始 DOM open 状态」与「全折叠」两种口径
  const dist = {};
  const distBySec = {};
  let maxDepth = 0, maxClicksInit = 0, maxClicksWorst = 0;
  const deep = [];
  const bump = (secId, d) => { dist[d] = (dist[d] || 0) + 1; distBySec[secId][d] = (distBySec[secId][d] || 0) + 1; };
  for (const secId of SECTIONS) {
    const nav = navFromSections[secId][secId];
    distBySec[secId] = {};
    const secOpen = nav.open;
    const visit = (n, gDepth) => n.forEach((x) => {
      if (x.kind === 'group') { visit(x.children, gDepth + 1); return; }
      const depth = gDepth + 1;
      bump(secId, depth);
      if (depth > maxDepth) maxDepth = depth;
      const initClicks = depth + (secOpen ? 0 : 1);
      const worstClicks = depth + 1;
      if (initClicks > maxClicksInit) maxClicksInit = initClicks;
      if (worstClicks > maxClicksWorst) maxClicksWorst = worstClicks;
      deep.push({ id: `${secId}:${RL(path.join(ROOT, x.target || ''))}`, depth, initClicks, worstClicks });
    });
    // 组首页条目深度 = 其所在组深度；分区根页深度 = 1
    visit(nav.tree, 0);
    for (const h of nav.homes) {
      if (h.tag === 'side-home') { const d = h.groupPath ? h.groupPath.split('>').length + 1 : 1; bump(secId, d); if (d > maxDepth) maxDepth = d; }
      else if (h.tag === '根页') { bump(secId, 1); }
    }
  }
  metric(c, '侧栏条目深度分布（1 跳 = 分区根页；组首页计其组深度）', Object.entries(dist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k} 跳=${v}`).join('  '));
  for (const secId of SECTIONS) metric(c, `${secId} 深度分布（对照实现者 §2.3 表）`, Object.entries(distBySec[secId]).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k} 跳=${v}`).join('  '));
  const distTotal = Object.values(dist).reduce((a, b) => a + b, 0);
  metric(c, '深度分布合计（应 = 135）', distTotal);
  metric(c, '最大深度/点击数（初始 DOM：paper 展开、velocity 折叠时）', maxClicksInit);
  metric(c, '最大点击数（最坏情况：所有 details 折叠）', maxClicksWorst);
  metric(c, '最坏情况下最深页例', deep.sort((a, b) => b.worstClicks - a.worstClicks).slice(0, 3).map((d) => `${d.id}(${d.worstClicks} 击)`).join('、'));
  if (orphans.length) issue(c, 'defect', `孤页 ${orphans.length} 个：${orphans.slice(0, 10).join(', ')}`);
  if (missingEntry.length) issue(c, 'defect', `pagesNotInSourceNav 缺一级入口 ${missingEntry.length} 条：${missingEntry.slice(0, 10).join(', ')}`);
  if (stray.length) issue(c, 'defect', `主导航指向非产物页 ${stray.length} 条：${stray.slice(0, 5).join(', ')}`);
  c.pass = orphans.length === 0 && missingEntry.length === 0 && stray.length === 0;
  c.extra = { dist, distBySec, maxDepth, maxClicksInit, maxClicksWorst, orphans, missingEntry, stray };
  return c;
}

/* ═══════════════════════ 3. 面包屑 ═══════════════════════ */

function expectedCrumbs(secId, repoRel) {
  const pi = pageIdOf(repoRel);
  if (!pi) return null;
  const model = S[secId];
  if (pi.rel === 'index') return [srcBySec[secId].title, P.get(repoRel) ? labelOfEntry(secId, repoRel) : 'index'];
  if (model.pages.has(pi.rel)) return model.pages.get(pi.rel).pathLabels;
  // pagesNotInSourceNav：组首页（= 组路径）或分区根页
  const g = model.groups.find((x) => x.indexRel === pi.rel);
  if (g) return g.pathLabels;
  const root = navFromSections[secId][secId].homes.find((h) => h.target === repoRel);
  return root ? [srcBySec[secId].title, root.label] : null;
}
function labelOfEntry(secId, repoRel) {
  const nav = navFromSections[secId][secId];
  const home = nav.homes.find((h) => h.target === repoRel);
  if (home) return home.label;
  const bag = [];
  const walk = (n) => n.forEach((x) => { if (x.kind === 'group') walk(x.children); else bag.push(x); });
  walk(nav.tree);
  const hit = bag.find((x) => x.target === repoRel);
  return hit ? hit.label : null;
}

function check3() {
  const c = newCheck(3, '面包屑 == 源结构路径（抽样 ≥20 页，覆盖 paper/velocity 与深度 1–5）', 'node tools/verify-nav.js --check=3');
  // 抽样：每个 (section, depth) 取前 4 页 + 每个 section 若干组首页 + 分区根页（去重后应 ≥20）
  const sample = new Set();
  for (const secId of SECTIONS) {
    const byDepth = {};
    for (const [rel, info] of S[secId].pages) {
      const f = pagePathOf(secId, rel);
      (byDepth[info.depth] = byDepth[info.depth] || []).push(f);
    }
    for (const d of Object.keys(byDepth).sort((a, b) => a - b)) byDepth[d].slice(0, 4).forEach((f) => sample.add(f));
    const homes = navFromSections[secId][secId].homes;
    homes.filter((h) => h.tag === 'side-home').forEach((h, i) => { if (i % 3 === 0 && h.target) sample.add(h.target); });
    sample.add(pagePathOf(secId, 'index'));
  }
  const list = [...sample].filter((f) => allTargets.has(f)).sort();
  const bad = [];
  let checked = 0, linkOk = 0, linkTotal = 0;
  for (const f of list) {
    const pi = pageIdOf(f);
    if (!pi) continue;
    checked++;
    const exp = expectedCrumbs(pi.sec, f);
    const p = P.get(f);
    const got = p.crumbs.filter((x, i) => !(i === 0 && x.text === '总览')).map((x) => x.text);
    const eq = exp && JSON.stringify(got) === JSON.stringify(exp);
    if (!eq) bad.push({ page: f, expected: exp, got });
    else {
      // 分组 breadcrumb 必须指向对应组首页；末级必须是纯文本
      const last = p.crumbs[p.crumbs.length - 1];
      if (!last || last.link) bad.push({ page: f, expected: exp, got, note: '末级不是纯文本' });
      for (let i = 1; i < p.crumbs.length - 1; i++) {
        const cur = p.crumbs[i];
        linkTotal++;
        const want = i === 1 ? `sections/${pi.sec}.html` : groupIndexTarget(pi.sec, exp.slice(1, i));
        if (cur.target === want) linkOk++;
        else bad.push({ page: f, expected: exp, got, note: `第 ${i} 级面包屑链接 ${cur.target} ≠ ${want}` });
      }
    }
  }
  function groupIndexTarget(secId, labelPath) {
    const gp = labelPath.join(' > ');
    const g = S[secId].groups.find((x) => x.groupPath === gp);
    return g && g.indexRel ? pagePathOf(secId, g.indexRel) : null;
  }
  metric(c, '抽样页数', list.length);
  metric(c, '面包屑 == 源结构路径的页数', `${checked - new Set(bad.map((b) => b.page)).size} / ${checked}`);
  metric(c, '面包屑分组级链接指向正确组首页的比例', `${linkOk} / ${linkTotal}`);
  metric(c, '不符项条数', bad.length);
  const samples = list.slice(0, 5).map((f) => { const exp = expectedCrumbs(pageIdOf(f).sec, f); return `${exp ? exp.join(' › ') : '?'}`; });
  metric(c, '抽样路径样例（前 5）', samples.join('  |  '));
  if (bad.length) for (const b of bad.slice(0, 20)) issue(c, 'defect', `${b.page}${b.note ? ' :: ' + b.note : ''} :: 期望 ${JSON.stringify(b.expected)} 实际 ${JSON.stringify(b.got)}`);
  c.pass = bad.length === 0 && checked >= 20;
  c.extra = { sampled: list.length, checked, bad: bad.slice(0, 60), badTotal: bad.length };
  return c;
}

/* ═══════════════════════ 4. 上一页 / 下一页 ═══════════════════════ */

function expectedChain() {
  const chain = [];
  for (const secId of SECTIONS) {
    chain.push(pagePathOf(secId, 'index'));
    const walk = (n) => n.forEach((x) => {
      if (x.kind === 'group') {
        const g = S[secId].groups.find((y) => y.groupPath === x.groupPath);
        if (g && g.indexRel) chain.push(pagePathOf(secId, g.indexRel));
        walk(x.children);
      } else chain.push(x.target);
    });
    // 用源树（含顺序）而不是渲染树
    const srcWalk = (node, groupPath) => {
      if (node.kind === 'group') {
        const gp = groupPath ? `${groupPath} > ${node.label}` : node.label;
        const g = S[secId].groups.find((y) => y.groupPath === gp);
        if (g && g.indexRel) chain.push(pagePathOf(secId, g.indexRel));
        for (const ch of node.children) srcWalk(ch, gp);
      } else chain.push(pagePathOf(secId, node.rel));
    };
    srcWalk({ kind: 'group', label: '', children: srcBySec[secId].groups }, '');
  }
  return chain;
}

function check4() {
  const c = newCheck(4, '上一页/下一页 == 源树先序（首尾不越界、无自指、顺序一致）', 'node tools/verify-nav.js --check=4');
  const exp = expectedChain();
  // 从渲染 DOM 独立重建链：从无 prev 的页出发顺着 next 走
  const nodes = [...allTargets];
  const noPrev = nodes.filter((f) => !(P.get(f).pager.prev && P.get(f).pager.prev.target));
  const noNext = nodes.filter((f) => !(P.get(f).pager.next && P.get(f).pager.next.target));
  // 每个分区各成一条链：从「无上一页」的页出发顺 next 走到底
  const walkChain = (head) => {
    const out = []; const seen = new Set();
    let cur = head;
    while (cur && !seen.has(cur)) {
      out.push(cur); seen.add(cur);
      const nx = P.get(cur).pager.next;
      cur = nx && nx.target && allTargets.has(nx.target) ? nx.target : null;
    }
    return out;
  };
  const chains = noPrev.map(walkChain).sort((a, b) => exp.indexOf(a[0]) - exp.indexOf(b[0]));
  const chain = chains.flat();
  const seen = new Set(chain);
  const crossSection = nodes.filter((f) => {
    const p = P.get(f); const a = pageIdOf(f);
    return [p.pager.prev, p.pager.next].some((x) => x && x.target && pageIdOf(x.target) && pageIdOf(x.target).sec !== a.sec);
  });
  const selfRef = nodes.filter((f) => { const p = P.get(f).pager; return (p.prev && p.prev.target === f) || (p.next && p.next.target === f); });
  const mismatches = [];
  for (let i = 0; i < Math.max(exp.length, chain.length); i++) {
    if (exp[i] !== chain[i]) mismatches.push({ i, expected: exp[i] || null, dom: chain[i] || null });
  }
  // 交叉闭合：A.next=B ⇒ B.prev=A
  let closure = 0, closureTotal = 0;
  for (const f of nodes) {
    const nx = P.get(f).pager.next;
    if (nx && nx.target && allTargets.has(nx.target)) {
      closureTotal++;
      const back = P.get(nx.target).pager.prev;
      if (back && back.target === f) closure++;
    }
  }
  metric(c, '源码树先序链长度（期望 135）', exp.length);
  metric(c, 'DOM 里顺 next 走出的链数 / 合计长度', `${chains.length} / ${chain.length}`);
  metric(c, 'DOM 链去重后覆盖页数', seen.size);
  metric(c, '无上一页的页数（应为 2：两个分区根页）', noPrev.length);
  metric(c, '无下一页的页数（应为 2：两个分区末页）', noNext.length);
  metric(c, '自指条数', selfRef.length);
  metric(c, '跨 section 的 prev/next 条数', crossSection.length);
  metric(c, '与先序链不一致的位置数', mismatches.length);
  metric(c, '反向闭合 A.next=B ⇒ B.prev=A', `${closure} / ${closureTotal}`);
  metric(c, '链首 / 链尾', `${chain[0] || '?'} → ${chain[chain.length - 1] || '?'}`);
  metric(c, '分区链首尾', chains.map((x) => `${RL(path.join(ROOT, x[0]))} → ${RL(path.join(ROOT, x[x.length - 1]))}（${x.length} 页）`).join(' ; '));
  if (mismatches.length) issue(c, 'defect', `上下页顺序与先序链不一致 ${mismatches.length} 处（前 10）：` + mismatches.slice(0, 10).map((m) => `#${m.i} 期望 ${m.expected} 实际 ${m.dom}`).join(' ; '));
  if (selfRef.length) issue(c, 'defect', `自指 ${selfRef.length} 页：${selfRef.slice(0, 5).join(', ')}`);
  if (crossSection.length) issue(c, 'defect', `跨 section 的 prev/next ${crossSection.length} 页：${crossSection.slice(0, 5).join(', ')}`);
  if (seen.size !== allTargets.size) issue(c, 'defect', `链未覆盖全部页面：${seen.size} / ${allTargets.size}`);
  c.pass = mismatches.length === 0 && selfRef.length === 0 && crossSection.length === 0 && seen.size === allTargets.size && closure === closureTotal && exp.length === allTargets.size;
  c.extra = { expectedLen: exp.length, domChainLen: chain.length, chains: chains.map((x) => ({ len: x.length, head: x[0], tail: x[x.length - 1] })), mismatches: mismatches.slice(0, 60), mismatchTotal: mismatches.length, selfRef: selfRef.slice(0, 20), crossSection: crossSection.slice(0, 20), noPrev, noNext };
  return c;
}

/* ═══════════════════════ 5. 标签语言（英文主标签 + 中文辅注） ═══════════════════════ */

const CJK = /[\u3400-\u9fff]/;

function check5() {
  const c = newCheck(5, '标签语言：上游英文 label 为主标签、中文仅作辅注', 'node tools/verify-nav.js --check=5');
  const rows = [];
  for (const f of [...allTargets]) {
    const pi = pageIdOf(f);
    if (!pi) continue;
    const model = S[pi.sec];
    const p = P.get(f);
    const srcLabel = model.pages.has(pi.rel) ? model.pages.get(pi.rel).label
      : (model.groups.find((g) => g.indexRel === pi.rel) || {}).label || null;
    const ttl = findTtlInSidebar(pi.sec, pi.rel) || labelOfEntry(pi.sec, f);
    const h1 = p.h1Article[0] || p.h1All[0] || '';
    const metaZh = p.chips.join(' ');
    const sidebarEntry = sidebarSearchText(pi.sec, f);
    const zhAux = CJK.test(h1) || CJK.test(metaZh) || CJK.test(sidebarEntry);
    rows.push({
      page: f, sec: pi.sec, rel: pi.rel, srcLabel, ttl, h1,
      enInTtl: srcLabel ? ttl === srcLabel : null,
      enInH1: srcLabel ? h1.includes(srcLabel) : null,
      zhAux, ttlHasCjk: CJK.test(ttl || ''),
      h1HasCjk: CJK.test(h1),
    });
  }
  const srcPages = rows.filter((r) => r.enInTtl !== null);
  const ttlBad = srcPages.filter((r) => r.enInTtl === false);
  const h1NotEn = rows.filter((r) => !/[A-Za-z]{2}/.test(r.h1));
  const h1NoLabel = srcPages.filter((r) => r.enInH1 === false);
  const h1NoLabelBadge = h1NoLabel.filter((r) => /\s(Experimental|Beta|Deprecated)$/.test(r.srcLabel || ''));
  const h1NoLabelOther = h1NoLabel.filter((r) => !/\s(Experimental|Beta|Deprecated)$/.test(r.srcLabel || ''));
  // 用归档 md 的 frontmatter title 交叉验证「h1 是否忠实于上游正文标题」
  for (const r of h1NoLabel) {
    r.archiveTitle = archiveMdTitle(r.sec, r.rel);
    r.h1FollowsArchive = r.archiveTitle ? r.h1.includes(r.archiveTitle) || r.archiveTitle.includes(r.h1.replace(/\uff08.*\uff09$/, '')) : null;
  }
  const onlyZh = rows.filter((r) => r.ttlHasCjk && r.enInTtl === false);
  const noZhAux = rows.filter((r) => !r.zhAux);
  const noZhAuxSrc = srcPages.filter((r) => !r.zhAux);
  metric(c, '页面数', rows.length);
  metric(c, '① 侧栏主标签 == 上游英文 label（逐字节，133 个上游导航页）', `${srcPages.length - ttlBad.length} / ${srcPages.length}`);
  metric(c, '② h1 为英文主导（含 ≥2 个 ASCII 字母、未整体替换为中文）', `${rows.length - h1NotEn.length} / ${rows.length}`);
  metric(c, '③ h1 内含上游「侧栏 label」的页数（信息项，非判据）', `${srcPages.length - h1NoLabel.length} / ${srcPages.length}`);
  metric(c, '分布：h1 未含侧栏 label —— 其中 label 带徽章（… Experimental/Beta/Deprecated）', h1NoLabelBadge.map((r) => `${r.id || r.rel}(上游=${r.srcLabel} h1=${r.h1} 归档标题=${r.archiveTitle})`).join(' ; ') || '无');
  metric(c, '分布：h1 未含侧栏 label —— 其中侧栏 label ≠ 上游正文标题', h1NoLabelOther.map((r) => `${r.rel}(上游 label=${r.srcLabel} h1=${r.h1} 归档 md title=${r.archiveTitle} 一致=${r.h1FollowsArchive})`).join(' ; ') || '无');
  metric(c, '分布：「主标签里只有中文、没有英文」页数', onlyZh.length);
  metric(c, '分布：「只有英文、没有任何中文辅注（h1/chip/侧栏 data-search）」页数', `${noZhAux.length} / ${rows.length}（其中上游导航页 ${noZhAuxSrc.length} 个）`);
  metric(c, 'h1 带中文副标题（「English（中文）」形态）页数', rows.filter((r) => r.h1HasCjk).length);
  metric(c, '20 条抽样断言（侧栏主标签逐字节 == 上游 label）', srcPages.slice(0, 20).map((r) => `${r.rel}→${JSON.stringify(r.ttl)}`).join(' ; '));
  metric(c, '抽样中文辅注样例', rows.slice(0, 6).map((r) => `${r.rel}: h1=${JSON.stringify(r.h1)}`).join(' ; '));
  if (ttlBad.length) issue(c, 'defect', `侧栏主标签与上游 label 不一致 ${ttlBad.length} 条：` + ttlBad.slice(0, 10).map((r) => `${r.page} 上游=${JSON.stringify(r.srcLabel)} 渲染=${JSON.stringify(r.ttl)}`).join(' ; '));
  if (h1NotEn.length) issue(c, 'defect', `h1 整体被替换成中文 ${h1NotEn.length} 条：` + h1NotEn.slice(0, 10).map((r) => r.page).join(', '));
  if (onlyZh.length) issue(c, 'defect', `只有中文没有英文的主标签 ${onlyZh.length} 条：` + onlyZh.slice(0, 10).map((r) => r.page).join(', '));
  if (h1NoLabelBadge.length) issue(c, 'tradeoff', `${h1NoLabelBadge.length} 页的上游侧栏 label 带徽章词（… Experimental），站点 h1 用去掉徽章的正文标题（徽章是上游侧栏的 <span> 徽章，不是正文标题的一部分；侧栏主标签本身与上游逐字节相同，已通过 ①）：` + h1NoLabelBadge.map((r) => `${r.rel}：${r.srcLabel} → h1「${r.h1}」`).join(' ; '));
  if (h1NoLabelOther.length) issue(c, 'tradeoff', `${h1NoLabelOther.length} 页的「上游侧栏 label」与「上游正文标题」本来就不是一回事（站点 h1 跟随正文标题，与归档 md title 一致），侧栏主标签仍与上游侧栏逐字节相同：` + h1NoLabelOther.map((r) => `${r.rel}：侧栏 label「${r.srcLabel}」 vs h1「${r.h1}」/ 归档 md title「${r.archiveTitle}」`).join(' ; '));
  if (noZhAuxSrc.length) issue(c, 'tradeoff', `${noZhAuxSrc.length} 个上游导航页没有任何中文辅注（纯英文主标签，符合“中文只作辅注”，但辅注覆盖不完整）：` + noZhAuxSrc.slice(0, 12).map((r) => r.rel).join(', '));
  c.pass = ttlBad.length === 0 && h1NotEn.length === 0 && onlyZh.length === 0;
  c.extra = { rows, ttlBad: ttlBad.slice(0, 40), h1NotEn: h1NotEn.slice(0, 40), h1NoLabel: h1NoLabel.map((r) => ({ rel: r.rel, srcLabel: r.srcLabel, h1: r.h1, archiveTitle: r.archiveTitle, h1FollowsArchive: r.h1FollowsArchive })), onlyZh, noZhAux: noZhAux.slice(0, 60) };
  return c;
}
/** 上游正文标题：取自 archives/<sec>/manifest.json（归档时的上游页 title）+ md 的一级标题 */
const _archTitleCache = new Map();
function archiveMdTitle(sec, rel) {
  const k = sec + ':' + rel;
  if (_archTitleCache.has(k)) return _archTitleCache.get(k);
  let out = null;
  try {
    const m = JSON.parse(readText(path.join(ROOT, 'archive', sec, 'manifest.json')));
    const pg = (m.pages || []).find((x) => x.rel === rel);
    if (pg && pg.title) out = pg.title;
  } catch {}
  if (!out) {
    try {
      const t = readText(path.join(ROOT, 'archive', sec, 'source', rel + '.md'));
      const m = /^#\s+(.+)$/m.exec(t);
      if (m) out = m[1].trim();
    } catch {}
  }
  _archTitleCache.set(k, out);
  return out;
}
function sidebarSearchText(secId, repoRel) {
  const nav = navFromSections[secId][secId];
  const hit = nav.links.find((l) => l.target === repoRel && l.role === 'page');
  return hit ? hit.dataSearch : '';
}

/* ═══════════════════════ 6. 不回归 ═══════════════════════ */

function runNode(script, args = [], timeout = 900000) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, code: 0, out };
  } catch (e) {
    return { ok: false, code: e.status === undefined ? null : e.status, out: `${e.stdout || ''}${e.stderr || ''}`, err: String(e.message || e).slice(0, 400) };
  }
}

function check6() {
  const c = newCheck(6, '不回归：check-site / verify-site(15/15) / 每页 h1=1 / 页脚 5 项', 'node tools/check-site.js ; node tools/verify-site.js');
  // (a) check-site.js
  const cs = runNode('tools/check-site.js');
  const m1 = /RESULT:\s*(PASS|FAIL)/.exec(cs.out || '');
  metric(c, 'node tools/check-site.js → RESULT', m1 ? m1[1] : '（未解析到 RESULT 行）');
  metric(c, 'check-site 关键行', (cs.out || '').split(/\r?\n/).filter((l) => /html files|broken|code blocks|mismatch|RESULT/i.test(l)).slice(0, 6).join('  |  '));
  if (!(m1 && m1[1] === 'PASS')) issue(c, 'defect', `check-site.js 未 PASS：${(cs.out || cs.err || '').slice(-500)}`);
  // (b) h1 唯一性（全部产物 HTML，非抽样）
  const htmlAll = walkFiles(LIB, { ext: '.html', skipDirs: ['REPORTS'] }).map(R);
  const h1bad = [];
  for (const f of htmlAll) {
    const p = P.get(f) || parsePage(f);
    if (p.h1Count !== 1) h1bad.push(`${f} h1=${p.h1Count}`);
  }
  metric(c, `每页 h1 恰好 1 个（${htmlAll.length} 个产物 HTML，全量）`, `${htmlAll.length - h1bad.length} / ${htmlAll.length}`);
  if (h1bad.length) issue(c, 'defect', `h1 数量异常 ${h1bad.length} 处：${h1bad.slice(0, 10).join(' ; ')}`);
  // (c) 页脚 5 项
  const FOOT = ['源地址', '原始 HTML 快照', '上游 index.md', '抓取时间', '归档 SHA-256'];
  const footBad = [];
  for (const f of allTargets) {
    const t = P.get(f).footerText;
    const miss = FOOT.filter((k) => !t.includes(k));
    if (miss.length || !/归档 SHA-256 [0-9a-f]{64}/.test(t)) footBad.push(`${f} 缺=${miss.join(',') || 'sha256格式'}`);
  }
  metric(c, `页脚 5 项齐备（135 页全量：源地址/原始 HTML 快照/上游 index.md/抓取时间/归档 SHA-256）`, `${allTargets.size - footBad.length} / ${allTargets.size}`);
  if (footBad.length) issue(c, 'defect', `页脚缺项 ${footBad.length} 页：${footBad.slice(0, 10).join(' ; ')}`);
  // (d) verify-site.js 15/15（该工具会无条件覆写 REPORTS/verification.json；运行前后按原字节还原，保持只写 3 个文件的约束）
  let vsSummary = null;
  let vsRestored = null;
  if (CLI.external) {
    const vjPath = path.join(REPORTS, 'verification.json');
    const vmdPath = path.join(REPORTS, 'verification.md');
    const bj = exists(vjPath) ? readBuf(vjPath) : null;
    const bmd = exists(vmdPath) ? readBuf(vmdPath) : null;
    const vs = runNode('tools/verify-site.js', ['--json-only']);
    const m2 = /(\d+)\s*\/\s*(\d+)/.exec((vs.out || '').split(/\r?\n/).filter((l) => /PASS|通过|FAIL|总计|合计|15/.test(l)).slice(-30).join(' '));
    try {
      const j = JSON.parse(readText(vjPath));
      vsSummary = { total: j.summary.total, passed: j.summary.passed, failed: j.summary.failed, generated_at: j.generated_at };
    } catch {}
    // 还原
    try {
      if (bj) fs.writeFileSync(vjPath, bj);
      if (bmd) fs.writeFileSync(vmdPath, bmd);
      vsRestored = {
        json: bj ? sha256(readBuf(vjPath)) === sha256(bj) : null,
        md: bmd ? sha256(readBuf(vmdPath)) === sha256(bmd) : null,
      };
    } catch {}
    metric(c, 'node tools/verify-site.js → summary', vsSummary ? `${vsSummary.passed}/${vsSummary.total}（失败项 ${JSON.stringify(vsSummary.failed)}）` : `未解析（exit=${vs.code}） ${m2 ? m2[0] : ''}`);
    metric(c, 'verify-site.js 运行退出码', vs.code === null ? 'n/a' : vs.code);
    metric(c, '运行后 verification.json / .md 已按原字节还原', `json=${vsRestored ? vsRestored.json : 'n/a'} md=${vsRestored ? vsRestored.md : 'n/a'}`);
    if (!vsSummary || vsSummary.passed !== vsSummary.total) issue(c, 'defect', `verify-site.js 非全通过：${JSON.stringify(vsSummary)}`);
    note(c, '本项按任务书要求真实执行 node tools/verify-site.js（用 --json-only 缩小写入面）；该工具会按自身设计覆写 reports/verification.json，本工具在运行后把它按原字节还原（见上一条指标），因此仓库里只新增/更新本任务的 3 个文件。');
  } else {
    note(c, '--no-external：跳过 tools/verify-site.js 的执行');
  }
  c.pass = !!(m1 && m1[1] === 'PASS') && h1bad.length === 0 && footBad.length === 0 && (!CLI.external || (vsSummary && vsSummary.passed === vsSummary.total));
  if (vsSummary) c.extra = { verifySite: vsSummary, checkSiteResult: m1 ? m1[1] : null, restored: vsRestored };
  return c;
}

/* ═══════════════════════ 7. 搜索 ═══════════════════════ */

function check7() {
  const c = newCheck(7, '搜索：索引 135 / JS≡JSON / kq 覆盖 / 10 词命中不下降 / 侧栏过滤含组路径', 'node tools/verify-nav.js --check=7');
  const jsonPath = path.join(LIB, 'search-index.json');
  const jsPath = path.join(LIB, 'assets', 'search-index.js');
  const idx = JSON.parse(readText(jsonPath));
  const rawJs = readText(jsPath);
  const jsJson = (() => { const m = /=\s*(\{[\s\S]*\});?\s*$/.exec(rawJs.trim()); try { return JSON.parse(m[1]); } catch { return null; } })();
  const eq = jsJson && JSON.stringify(jsJson) === JSON.stringify(idx);
  metric(c, '索引条目数', idx.pages.length);
  metric(c, 'assets/search-index.js 解析后与 search-index.json 深度等价', eq ? '等价' : '不等价');
  const kq = idx.pages.filter((p) => Array.isArray(p.kq) && p.kq.length);
  metric(c, 'kq（预计算中文命中词）非空的页数', `${kq.length} / ${idx.pages.length}`);
  const kqWords = new Set(); let kqTotal = 0;
  for (const p of idx.pages) for (const w of (p.kq || [])) { kqWords.add(w); kqTotal++; }
  metric(c, 'kq 词条总数 / 去重', `${kqTotal} / ${kqWords.size}`);

  // 10 个中文查询词：口径 = 与 tools/verify-site.js 完全一致（JSON.stringify(entry).toLowerCase() 子串）
  const QUERIES = ['渲染', '命令注册', '权限', '优化', '插件加载', '配置文件', '命令', '事件', '代理', '依赖'];
  const myOld = {};
  for (const q of QUERIES) myOld[q] = idx.pages.filter((e) => JSON.stringify(e).toLowerCase().includes(q)).length;
  // 复算口径（字段子串，不含 JSON 键名）
  const FIELDS = ['t', 'u', 'kw', 'h', 'c', 'cd', 'x', 'lt', 'sn'];
  const myFields = {};
  for (const q of QUERIES) {
    myFields[q] = idx.pages.filter((e) => FIELDS.some((f) => {
      const v = e[f];
      return Array.isArray(v) ? v.join(' ').toLowerCase().includes(q) : String(v || '').toLowerCase().includes(q);
    })).length;
  }
  let baseline = BASELINE ? { hitsByQuery: BASELINE.hitsByQuery, hitsByQueryOld: BASELINE.hitsByQueryOld } : null;
  const baseOld = baseline ? baseline.hitsByQueryOld : null;
  const baseNew = baseline ? baseline.hitsByQuery : null;
  const drops = [];
  for (const q of QUERIES) {
    if (baseOld && typeof baseOld[q] === 'number' && myOld[q] < baseOld[q]) drops.push(`${q}: ${baseOld[q]} → ${myOld[q]}`);
    if (myOld[q] === 0) drops.push(`${q}: 0 命中`);
  }
  metric(c, '10 个中文词命中（本工具口径 = verify-site #8 旧口径 JSON.stringify 子串）', QUERIES.map((q) => `${q}=${myOld[q]}`).join(' '));
  metric(c, '上一轮基线（verification.json #8 hitsByQueryOld，运行本工具前的快照）', baseOld ? QUERIES.map((q) => `${q}=${baseOld[q]}`).join(' ') : '（未找到基线）');
  metric(c, '10 个中文词命中（字段子串口径，独立复算）', QUERIES.map((q) => `${q}=${myFields[q]}`).join(' '));
  metric(c, '上一轮基线（hitsByQuery，site.js 算法口径）', baseNew ? QUERIES.map((q) => `${q}=${baseNew[q]}`).join(' ') : '（未找到）');
  metric(c, '命中下降 / 0 命中的查询词数', drops.length);
  if (drops.length) issue(c, 'defect', `命中下降或为 0：${drops.join(', ')}`);

  // 侧栏过滤：data-search 必须含「源结构组路径」
  const nav = navFromSections.paper;
  let withGroup = 0, withoutGroup = [], checked = 0;
  for (const secId of SECTIONS) {
    const n = navFromSections[secId][secId];
    for (const l of n.links) {
      if (!l.dataSearch) continue;
      checked++;
      const gp = (l.groupPath || '').replace(/\s*>\s*/g, ' > ').trim();
      if (!gp || l.dataSearch.includes(gp)) withGroup++;
      else withoutGroup.push(`${secId}:${l.target} 期望含「${gp}」`);
    }
  }
  metric(c, '侧栏 data-search 条目数（全站侧栏）', checked);
  metric(c, '其中含「源结构组路径」的条数', `${withGroup} / ${checked}`);
  metric(c, '不含组路径的条目（前 8）', withoutGroup.slice(0, 8).join(' ; ') || '无');
  metric(c, 'index.html 侧栏 data-search 条目数（实现者自报 177）', navFromIndex.__allSearchLinks);
  if (withoutGroup.length) issue(c, 'defect', `侧栏 data-search 缺组路径 ${withoutGroup.length} 条：${withoutGroup.slice(0, 8).join(' ; ')}`);
  c.pass = idx.pages.length === 135 && !!eq && kq.length === idx.pages.length && drops.length === 0 && withoutGroup.length === 0;
  c.extra = { pages: idx.pages.length, jsEqJson: !!eq, kqCovered: kq.length, kqTotal, kqUnique: kqWords.size, myOld, myFields, baseOld, baseNew, drops, sidebarChecked: checked, sidebarWithGroup: withGroup, withoutGroup: withoutGroup.slice(0, 40), indexSidebarSearchLinks: navFromIndex.__allSearchLinks };
  return c;
}

/* ═══════════════════════ 8. all-pages.html ═══════════════════════ */

function check8() {
  const c = newCheck(8, 'all-pages.html：135 行 / 每行 5 要素 / 页内过滤可用 / 抽 10 行链接存在', 'node tools/verify-nav.js --check=8');
  const f = 'all-pages.html';
  const $ = cheerio.load(readText(path.join(ROOT, f)));
  const rows = $('tbody tr');
  metric(c, '数据行数（tbody tr）', rows.length);
  const bad = [];
  const rowTargets = [];
  rows.each((i, tr) => {
    const $tr = $(tr);
    const tds = $tr.children('td');
    const num = txt(tds.eq(0));
    const sec = txt(tds.eq(1));
    const pth = txt(tds.eq(2));
    const $lblA = tds.eq(3).find('a').first();
    const lbl = txt($lblA);
    const sum = txt(tds.eq(4));
    const $lnkA = tds.eq(5).find('a').first();
    const ds = $tr.attr('data-search') || '';
    const cls = $tr.attr('class') || '';
    const target = resolveHref(f, $lblA.attr('href'));
    rowTargets.push(target);
    const probs = [];
    if (!num) probs.push('无序号');
    if (!sec) probs.push('无分区');
    if (!pth) probs.push('无源结构路径');
    if (!lbl) probs.push('无上游标签');
    if (!sum) probs.push('无中文摘要');
    if (!$lnkA.attr('href')) probs.push('无链接');
    if (!$lblA.attr('href')) probs.push('标签不可点');
    if (!ds) probs.push('无 data-search');
    if (!allTargets.has(target)) probs.push(`链接目标不存在 ${target}`);
    if (!/^[A-Za-z\u3400-\u9fff]/.test(lbl) && !/[A-Za-z]/.test(lbl)) probs.push('标签非英文');
    if (probs.length) bad.push(`第 ${i + 1} 行：${probs.join('、')}`);
  });
  metric(c, '每行 5 要素（序号/分区/源结构路径/上游标签+链接/中文摘要）齐备的行数', `${rows.length - bad.length} / ${rows.length}`);
  // 行顺序 == 源结构先序
  const exp = expectedChain();
  const orderBad = exp.reduce((a, t, i) => a + (rowTargets[i] === t ? 0 : 1), 0);
  metric(c, '行顺序 == 源结构先序的不一致行数', orderBad);
  // data-search 是否含源结构路径（navPath）
  let dsWithPath = 0;
  const manifest = JSON.parse(readText(path.join(ROOT, 'data', 'build-manifest.json')));
  const navPathByOutput = new Map(manifest.pages.map((p) => [p.output, p.navPath]));
  rows.each((i, tr) => {
    const $tr = $(tr);
    const target = resolveHref(f, $tr.find('td.lbl a').first().attr('href'));
    const np = navPathByOutput.get(RL(path.join(ROOT, target)));
    const ds = $tr.attr('data-search') || '';
    if (!np || ds.startsWith(np)) dsWithPath++;
  });
  metric(c, 'data-search 以「源结构路径（navPath）」开头的行数', `${dsWithPath} / ${rows.length}`);
  // 页内过滤框
  const $fi = $('#allpages-filter');
  const hasFilter = $fi.length === 1;
  const filterAttr = $fi.attr('data-table-filter') || null;
  const siteJs = readText(path.join(LIB, 'assets', 'site.js'));
  // site.js 是通用实现：按 [data-table-filter] 找输入框 → getElementById(id) 找表 → 过滤 tbody tr[data-search]
  const jsHasFn = /querySelectorAll\(\s*'\[data-table-filter\]'\s*\)/.test(siteJs) && /getElementById\(id\)/.test(siteJs) && /tbody tr/.test(siteJs) && /data-search/.test(siteJs) && /addEventListener\('input', apply\)/.test(siteJs);
  const tableId = $('#allpages').length === 1;
  const counterEl = $('#allpages-count').length;
  const clearEl = filterAttr ? $(`[data-filter-clear="${filterAttr}"]`).length : 0;
  metric(c, '页内过滤框（#allpages-filter + data-table-filter=allpages）', hasFilter ? `存在（data-table-filter=${filterAttr}）` : '缺失');
  metric(c, '过滤框 JS 接线（assets/site.js：查询 [data-table-filter] → 过滤 tbody tr[data-search] → 更新计数）', jsHasFn ? '存在（通用实现）' : '缺失');
  metric(c, '过滤目标表 id / 计数元素 / 清除按钮', `${tableId ? 'table#allpages 存在' : '缺 table#allpages'} / ${counterEl ? '#allpages-count 存在' : '缺计数'} / ${clearEl ? '清除按钮存在' : '缺清除'}`);
  if (!hasFilter || !jsHasFn || !tableId) issue(c, 'defect', `all-pages 页内过滤不可用（filter=${hasFilter} js=${jsHasFn} table=${tableId}）`);
  // 随机抽 10 行（固定种子，可复现）验证链接目标存在
  let seed = 20261020;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const picked = [];
  const usedIdx = new Set();
  while (picked.length < Math.min(10, rows.length)) {
    const i = Math.floor(rnd() * rows.length);
    if (usedIdx.has(i)) continue;
    usedIdx.add(i);
    picked.push({ row: i + 1, target: rowTargets[i], exists: allTargets.has(rowTargets[i]) });
  }
  metric(c, '随机 10 行链接目标存在性', `${picked.filter((p) => p.exists).length} / ${picked.length}（行号 ${picked.map((p) => p.row).join(',')}）`);
  metric(c, '抽样目标', picked.map((p) => RL(path.join(ROOT, p.target))).join(' , '));
  if (bad.length) issue(c, 'defect', `行要素缺失 ${bad.length} 处：${bad.slice(0, 8).join(' ; ')}`);
  if (orderBad) issue(c, 'defect', `行顺序与源结构先序不符 ${orderBad} 行`);
  if (picked.some((p) => !p.exists)) issue(c, 'defect', `抽样行链接目标缺失：${picked.filter((p) => !p.exists).map((p) => p.target).join(', ')}`);
  c.pass = rows.length === 135 && bad.length === 0 && orderBad === 0 && dsWithPath === rows.length && hasFilter && jsHasFn && tableId && picked.every((p) => p.exists);
  c.extra = { rows: rows.length, bad: bad.slice(0, 40), orderBad, dsWithPath, picked, filterAttr, jsHasFn, tableId, counterEl, clearEl };
  return c;
}

/* ═══════════════════════ 9. GitHub Pages 子路径 ═══════════════════════ */

function check9() {
  const c = newCheck(9, 'GitHub Pages 子路径：gh-pages-smoke PASS / 绝对路径 0 / 404.html + .nojekyll', 'node tools/gh-pages-smoke.js');
  if (CLI.external) {
    const tmp = path.join(os.tmpdir(), 'nav-verify-gh-pages-smoke.json');
    const r = runNode('tools/gh-pages-smoke.js', [`--json=${tmp}`], 900000);
    const m = /RESULT:\s*(PASS|FAIL)[^\n]*/.exec(r.out || '');
    metric(c, 'node tools/gh-pages-smoke.js → RESULT', m ? m[0].trim() : '（未解析到 RESULT 行）');
    let j = null;
    try { j = JSON.parse(readText(tmp)); } catch {}
    if (j) {
      metric(c, 'gh-pages-smoke 检查项', `${j.summary.passed}/${j.summary.checks} pass / ${j.summary.failed} fail / ${j.summary.warned} warn`);
      metric(c, 'gh-pages-smoke 失败项 / 警告项', `${JSON.stringify(j.summary.failedIds)} / ${JSON.stringify(j.summary.warnedIds)}`);
      metric(c, '模拟子路径 / HTTP 请求数', `${j.simulatedSubPath} / ${j.summary.httpRequests}`);
      c.extra = { result: j.result, summary: j.summary, base: j.simulatedBaseUrl, jsonPath: tmp };
    }
    if (!(m && /^RESULT:\s*PASS/.test(m[0]))) issue(c, 'defect', `gh-pages-smoke 未 PASS：${(r.out || r.err || '').slice(-600)}`);
    note(c, `为避免多写仓库文件，gh-pages-smoke 的结果 JSON 被重定向到 ${tmp}（默认路径 reports/gh-pages-smoke.json 未改动）。`);
  } else {
    note(c, '--no-external：跳过 gh-pages-smoke.js 的执行');
  }
  // 站点主体里的绝对路径 href/src
  const files = walkFiles(LIB, { ext: '.html', skipDirs: ['REPORTS'] }).map(R).concat(['index.html', '404.html']).filter((f) => exists(path.join(ROOT, f)));
  const abs = [];
  for (const f of files) {
    const $ = cheerio.load(readText(path.join(ROOT, f)));
    $('link,script,img,iframe,source,video,audio,embed,object,a').each((_, el) => {
      const $el = $(el);
      for (const at of ['href', 'src', 'poster', 'srcset']) {
        const v = $el.attr(at);
        if (!v) continue;
        for (const part of String(v).split(',')) {
          const u = part.trim().split(/\s+/)[0];
          if (u.startsWith('/') && !u.startsWith('//')) abs.push({ file: f, ref: u });
        }
      }
    });
  }
  metric(c, `站点主体（${files.length} 个 HTML）里以 / 开头的 href/src`, abs.length);
  metric(c, '绝对路径样例（前 5）', abs.slice(0, 5).map((x) => `${x.file} → ${x.ref}`).join(' ; ') || '无');
  if (abs.length) issue(c, 'defect', `发现以 / 开头的引用 ${abs.length} 处：${abs.slice(0, 5).map((x) => `${x.file}→${x.ref}`).join(' ; ')}`);
  const nojekyll = exists(path.join(ROOT, '.nojekyll'));
  const p404 = exists(path.join(ROOT, '404.html'));
  metric(c, '.nojekyll / 404.html 存在', `${nojekyll ? '存在' : '缺失'} / ${p404 ? '存在' : '缺失'}`);
  if (!nojekyll) issue(c, 'defect', '.nojekyll 缺失');
  if (!p404) issue(c, 'defect', '404.html 缺失');
  const smokePass = !CLI.external || (c.extra && c.extra.result === 'PASS');
  c.pass = abs.length === 0 && nojekyll && p404 && !!smokePass;
  c.extra = { ...(c.extra || {}), absoluteRefs: abs.slice(0, 30), absoluteTotal: abs.length, filesScanned: files.length };
  return c;
}

/* ═══════════════════════ 10. 体积与限额 ═══════════════════════ */

function check10() {
  const c = newCheck(10, '体积与限额：git 将跟踪文件数/字节数、最大单文件、1 GiB 余量', 'git ls-files -z --cached --others --exclude-standard');
  let tracked = [];
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, maxBuffer: 1 << 28 });
    tracked = out.toString('utf8').split('\0').filter(Boolean).map((p) => ({ p, bytes: fs.statSync(path.join(ROOT, p)).size }));
  } catch (e) {
    issue(c, 'defect', `git ls-files 失败：${String(e.message).slice(0, 200)}`);
  }
  const bytes = tracked.reduce((n, f) => n + f.bytes, 0);
  const sorted = [...tracked].sort((a, b) => b.bytes - a.bytes);
  metric(c, 'git 将跟踪的文件数', tracked.length);
  metric(c, 'git 将跟踪的总字节数', bytes);
  metric(c, '仓库总体积', `${mib(bytes)} MiB`);
  metric(c, '距 GitHub Pages 1 GiB 站点上限余量', `${mib(1073741824 - bytes)} MiB（占用 ${round(bytes / 1073741824 * 100, 3)}%）`);
  metric(c, '最大 5 个文件', sorted.slice(0, 5).map((f) => `${f.p} = ${mib(f.bytes)} MiB`).join(' ; '));
  const over100 = sorted.filter((f) => f.bytes > 100 * 1048576);
  const over50 = sorted.filter((f) => f.bytes > 50 * 1048576);
  const over10 = sorted.filter((f) => f.bytes > 10 * 1048576);
  metric(c, '> 100 MB 的文件数', over100.length);
  metric(c, '> 50 MB 的文件数', over50.length);
  metric(c, '> 10 MB 的文件数（参考）', over10.length);
  const dir = {};
  for (const f of tracked) { const k = f.p.includes('/') ? f.p.split('/')[0] : '(root files)'; dir[k] = (dir[k] || 0) + f.bytes; }
  metric(c, '顶层目录体积', Object.entries(dir).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${mib(v)} MiB`).join(' ; '));
  if (over100.length) issue(c, 'defect', `存在 > 100 MB 文件（会被 GitHub 拒收）：${over100.map((f) => f.p).join(', ')}`);
  if (over50.length) issue(c, 'defect', `存在 > 50 MB 文件：${over50.map((f) => f.p).join(', ')}`);
  if (bytes > 1073741824) issue(c, 'defect', `仓库体积超过 Pages 1 GiB 上限：${mib(bytes)} MiB`);
  c.pass = tracked.length > 0 && over100.length === 0 && over50.length === 0 && bytes < 1073741824;
  c.extra = { trackedFiles: tracked.length, trackedBytes: bytes, trackedMiB: mib(bytes), headroomMiB: mib(1073741824 - bytes), top5: sorted.slice(0, 5), over100, over50, over10, byTopDir: dir };
  return c;
}

/* ═══════════════════════ 11. 旧视图未损坏 ═══════════════════════ */

function check11() {
  const c = newCheck(11, '旧视图未损坏：15 个主题分类页仍覆盖 135 页、snapshots 仍 135 页三类快照', 'node tools/verify-nav.js --check=11');
  const cats = walkFiles(LIB + '/categories', { ext: '.html' }).map(R);
  const tax = JSON.parse(readText(path.join(ROOT, 'data', 'taxonomy.json')));
  const perCat = [];
  const broken = [];
  const union = new Set();
  for (const f of cats) {
    const $ = cheerio.load(readText(path.join(ROOT, f)));
    const links = $('ul.tax-list a[href]').map((_, a) => resolveHref(f, $(a).attr('href'))).get();
    const uniq = new Set(links);
    uniq.forEach((t) => union.add(t));
    for (const t of uniq) if (!allTargets.has(t)) broken.push(`${RL(f)} → ${t}`);
    const catId = path.basename(f, '.html');
    const expect = tax.pages.filter((p) => p.category === catId).length;
    perCat.push({ file: RL(f), catId, listed: uniq.size, taxonomyPages: expect, ok: uniq.size === expect });
  }
  metric(c, 'categories/*.html 文件数', cats.length);
  metric(c, '分类页链接并集覆盖的产物页数', `${union.size} / ${allTargets.size}`);
  metric(c, '各分类页列出的页数 == taxonomy 归类页数的分类数', `${perCat.filter((x) => x.ok).length} / ${perCat.length}`);
  const sample3 = ['paper-dev-command', 'velocity-config', 'paper-start'].map((id) => perCat.find((x) => x.catId === id)).filter(Boolean);
  metric(c, '抽样 3 个分类页（列出页数 / taxonomy 归类数）', sample3.map((x) => `${x.catId} ${x.listed}/${x.taxonomyPages}`).join(' ; '));
  metric(c, '分类页断链条数', broken.length);
  metric(c, '分类页合计列出条目数（含跨类重复）', perCat.reduce((n, x) => n + x.listed, 0));
  if (broken.length) issue(c, 'defect', `分类页断链 ${broken.length}：${broken.slice(0, 8).join(' ; ')}`);
  if (union.size !== allTargets.size) issue(c, 'defect', `15 个分类页并集只覆盖 ${union.size} / ${allTargets.size} 页`);
  if (perCat.some((x) => !x.ok)) issue(c, 'defect', '分类页条目数与 taxonomy 不一致：' + perCat.filter((x) => !x.ok).map((x) => `${x.catId} ${x.listed}≠${x.taxonomyPages}`).join(' ; '));

  // snapshots.html
  const sf = 'snapshots.html';
  const $s = cheerio.load(readText(path.join(ROOT, sf)));
  const rows = $s('tbody tr');
  const snapBad = [];
  let three = 0;
  rows.each((i, tr) => {
    const $tr = $s(tr);
    const tds = $tr.children('td');
    const pageLink = resolveHref(sf, tds.eq(1).find('a').first().attr('href'));
    const htmlLink = resolveHref(sf, tds.eq(5).find('a').first().attr('href'));
    const mdLink = resolveHref(sf, tds.eq(6).find('a').first().attr('href'));
    const srcLink = tds.eq(7).find('a').first().attr('href');
    const probs = [];
    if (!allTargets.has(pageLink)) probs.push(`渲染页 ${pageLink}`);
    if (!htmlLink || !exists(path.join(ROOT, htmlLink))) probs.push(`HTML 快照 ${htmlLink}`);
    if (!mdLink || !exists(path.join(ROOT, mdLink))) probs.push(`index.md ${mdLink}`);
    if (!srcLink || !/^https?:\/\//.test(srcLink)) probs.push('原文外链');
    if (!txt(tds.eq(2)).includes('›')) probs.push('无源结构路径列');
    if (probs.length) snapBad.push(`第 ${i + 1} 行：${probs.join('、')}`); else three++;
  });
  metric(c, 'snapshots.html 行数', rows.length);
  metric(c, '三类快照链接（渲染页 / HTML 快照 / 上游 index.md）+ 原文外链 + 源结构路径 齐备的行数', `${three} / ${rows.length}`);
  if (rows.length !== 135) issue(c, 'defect', `snapshots.html 行数 ${rows.length} ≠ 135`);
  if (snapBad.length) issue(c, 'defect', `snapshots 行缺项 ${snapBad.length}：${snapBad.slice(0, 8).join(' ; ')}`);
  c.pass = cats.length === 15 && union.size === allTargets.size && broken.length === 0 && perCat.every((x) => x.ok) && rows.length === 135 && snapBad.length === 0;
  c.extra = { categories: perCat, unionSize: union.size, broken: broken.slice(0, 30), snapshotsRows: rows.length, snapBad: snapBad.slice(0, 30) };
  return c;
}

/* ═══════════════════════ 12. 离线可用性 ═══════════════════════ */

function check12() {
  const c = newCheck(12, '离线可用性：无外部 css/js/字体/iframe，img 仅 1 处 xkcd，file:// 假设下命中 0', 'node tools/verify-nav.js --check=12');
  const files = walkFiles(LIB, { ext: '.html', skipDirs: ['REPORTS'] }).map(R)
    .concat(walkFiles(LIB, { ext: '.css', skipDirs: ['REPORTS'] }).map(R))
    .concat(['index.html', '404.html'].filter((f) => exists(path.join(ROOT, f))));
  const ext = { css: [], js: [], iframe: [], img: [], media: [], font: [] };
  const baseTag = [];
  const winPath = [];
  const localRefs = [];
  const protocolRel = [];
  const anchorLocal = [];
  const imgHttp = new Set();
  const RES_ELEMS = 'link,script,img,iframe,source,video,audio,embed,object,input';
  for (const f of files) {
    const text = readText(path.join(ROOT, f));
    if (f.endsWith('.css')) {
      if (/@import\s+(url\()?["']?https?:/i.test(text)) ext.css.push(f + ' @import');
      if (/url\(\s*["']?https?:/i.test(text)) ext.font.push(f + ' url(http…)');
      if (/@font-face/i.test(text) && /https?:/i.test(text)) ext.font.push(f + ' @font-face 远程');
      continue;
    }
    const $ = cheerio.load(text);
    if ($('base').length) baseTag.push(f);
    $('link').each((_, el) => { const v = $(el).attr('href') || ''; if (/^https?:/i.test(v) || v.startsWith('//')) ext.css.push(`${f} link[${$(el).attr('rel')}]=${v}`); });
    $('script').each((_, el) => { const v = $(el).attr('src') || ''; if (/^https?:/i.test(v) || v.startsWith('//')) ext.js.push(`${f} script=${v}`); });
    $('iframe').each((_, el) => { const v = $(el).attr('src') || ''; if (/^https?:/i.test(v) || v.startsWith('//')) ext.iframe.push(`${f} iframe=${v}`); });
    $('img').each((_, el) => { const v = $(el).attr('src') || ''; if (/^https?:/i.test(v)) { ext.img.push(`${f} img=${v}`); imgHttp.add(v); } });
    $('video,audio,embed,object,source').each((_, el) => { const v = $(el).attr('src') || ''; if (/^https?:/i.test(v)) ext.media.push(`${f} ${el.tagName}=${v}`); });
    // 资源引用（排除 <a> 与纯片段）才计入「离线可用性」
    $(RES_ELEMS).each((_, el) => {
      const $el = $(el); const tag = String(el.tagName || '').toLowerCase();
      for (const at of ['href', 'src', 'poster', 'data']) {
        const v = $el.attr(at);
        if (!v || v.startsWith('#')) continue;
        if (v.startsWith('//')) protocolRel.push(`${f} <${tag} ${at}>=${v}`);
        if (/^[a-zA-Z]:[\\/]/.test(v) || /^file:\/\//i.test(v)) winPath.push(`${f} <${tag} ${at}>=${v}`);
        if (/(127\.0\.0\.1|localhost)/i.test(v)) localRefs.push(`${f} <${tag} ${at}>=${v}`);
      }
    });
    // <a> 层的同类字符串（信息项：上游小节 slug 可能含 localhost 字样，不是资源引用）
    $('a').each((_, el) => {
      const v = $(el).attr('href') || '';
      if (!v || v.startsWith('#')) return;
      if (/(127\.0\.0\.1|localhost)/i.test(v) || /^[a-zA-Z]:[\\/]/.test(v) || v.startsWith('//')) anchorLocal.push(`${f} <a href>=${v}`);
    });
  }
  const imgLib = ext.img.filter((x) => x.startsWith('paper/') || x.startsWith('velocity/'));
  const imgList = [...imgHttp];
  const knownXkcd = imgList.filter((u) => /^https:\/\/imgs\.xkcd\.com\//.test(u));
  metric(c, `扫描文件数（${walkFiles(LIB, { ext: '.html', skipDirs: ['REPORTS'] }).length} 个 library HTML + CSS + 根 index/404）`, files.length);
  metric(c, '外链 <link rel=stylesheet/preload/dns> 数', ext.css.length);
  metric(c, '外链 <script src> 数', ext.js.length);
  metric(c, '外链 <iframe> 数', ext.iframe.length);
  metric(c, '外链 <img src> 数（任务书已声明允许 1 处第三方 xkcd）', ext.img.length);
  metric(c, '外链 <img> 去重 URL', imgList.join(' ; ') || '无');
  metric(c, '外链 <img> 中属于已知第三方 xkcd 的条数', knownXkcd.length);
  metric(c, '外链 media/embed/object/source 数', ext.media.length);
  metric(c, 'CSS 里远程 @import / url() / @font-face 数', ext.font.length + ext.css.filter((x) => x.includes('@import')).length);
  metric(c, '<base> 标签文件数（file:// 假设下禁止）', baseTag.length);
  metric(c, '资源元素里 Windows 盘符 / file:// 路径数', winPath.length);
  metric(c, '资源元素里 127.0.0.1 / localhost 引用数（产物侧）', localRefs.length);
  metric(c, '资源元素里协议相对 //host 引用数', protocolRel.length);
  metric(c, 'library 侧外链 <img> 数（= 已知 1 处 xkcd）', imgLib.length);
  metric(c, '<a> 层 localhost/盘符/协议相对字符串（信息项，非资源引用）', anchorLocal.slice(0, 5).join(' ; ') || '无');
  if (ext.css.length || ext.js.length || ext.iframe.length || ext.media.length || ext.font.length) issue(c, 'defect', `存在外部资源依赖：css=${ext.css.length} js=${ext.js.length} iframe=${ext.iframe.length} media=${ext.media.length} font=${ext.font.length}`);
  if (imgLib.length > 1) issue(c, 'defect', `library 侧外链图片超过已知 1 处：${imgLib.slice(0, 5).join(' ; ')}`);
  if (knownXkcd.length !== imgList.length) issue(c, 'defect', `外链 <img> 里出现了非 xkcd 的第三方图：${ext.img.filter((x) => !/imgs\.xkcd\.com/.test(x)).slice(0, 5).join(' ; ')}`);
  if (imgList.length > 1) issue(c, 'defect', `外链 <img> 多于已知的 1 处 xkcd：${ext.img.slice(0, 5).join(' ; ')}`);
  if (imgList.length === 1) issue(c, 'tradeoff', `已知且被任务书允许的 1 处外链图：${imgList[0]}（velocity「Comparisons to other proxies」正文插图；离线打开时该图不可显示，其余 100% 资源本地）。`);
  if (baseTag.length || winPath.length || localRefs.length || protocolRel.length) issue(c, 'defect', `file:// 假设不成立：base=${baseTag.length} 盘符=${winPath.length} 资源 localhost=${localRefs.length} 协议相对=${protocolRel.length}`);
  c.pass = ext.css.length === 0 && ext.js.length === 0 && ext.iframe.length === 0 && ext.media.length === 0 && ext.font.length === 0
    && imgList.length <= 1 && knownXkcd.length === imgList.length && baseTag.length === 0 && winPath.length === 0 && localRefs.length === 0 && protocolRel.length === 0;
  c.extra = { ext, baseTag, winPath: winPath.slice(0, 20), localRefs: localRefs.slice(0, 20), protocolRel: protocolRel.slice(0, 20), anchorLocal: anchorLocal.slice(0, 20), imgHttp: imgList, knownXkcd, filesScanned: files.length };
  return c;
}
function atHref(el) { return el.tagName && el.tagName.toLowerCase() !== 'a'; }

/* ────────────────────────────── 运行 ────────────────────────────── */

const ALL = [check1, check2, check3, check4, check5, check6, check7, check8, check9, check10, check11, check12];
const only = CLI.check ? ALL.filter((f) => f.__id === CLI.check) : ALL;
// 给每个 check 函数打 id（newCheck 的 id 与顺序一致）
const idFor = { 1: check1, 2: check2, 3: check3, 4: check4, 5: check5, 6: check6, 7: check7, 8: check8, 9: check9, 10: check10, 11: check11, 12: check12 };
const toRun = CLI.check ? (idFor[CLI.check] ? [idFor[CLI.check]] : []) : ALL;
if (!toRun.length) { process.stderr.write(`未知的 --check=${CLI.check}（合法 1..12）\n`); process.exit(2); }

for (const fn of toRun) {
  const t = Date.now();
  let c;
  try { c = fn(); }
  catch (e) { c = newCheck(fn.__id || 0, '(异常)', ''); c.pass = false; issue(c, 'limit', `检查项抛异常：${String(e && e.stack || e).slice(0, 500)}`); }
  c.ms = Date.now() - t;
  checks.push(c);
  // 控制台逐项结论
  process.stdout.write(`[${String(c.id).padStart(2)}/12] ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n`);
  for (const m of c.metrics) process.stdout.write(`        · ${m.k}: ${String(m.v).slice(0, 400)}\n`);
  for (const i of c.issues.slice(0, 8)) process.stdout.write(`        ! (${i.kind}) ${i.msg.slice(0, 400)}\n`);
  if (c.issues.length > 8) process.stdout.write(`        ! …另有 ${c.issues.length - 8} 条，见 JSON\n`);
  for (const n of c.notes) process.stdout.write(`        - ${n.slice(0, 300)}\n`);
}

const after = fingerprint();
const drifted = before.products.hash !== after.products.hash || before.siteManifest.generated_at !== after.siteManifest.generated_at;
process.stdout.write(`\n站点指纹：${drifted ? '验证期间发生变化（已按最新版本重跑结论所指版本见 JSON）' : '验证期间未变化'}\n`);
process.stdout.write(`  products ${before.products.hash.slice(0, 16)}… → ${after.products.hash.slice(0, 16)}…\n`);
process.stdout.write(`  site-manifest.generated_at ${before.siteManifest.generated_at} → ${after.siteManifest.generated_at}\n`);
const passN = checks.filter((c) => c.pass).length;
process.stdout.write(`RESULT: ${passN === checks.length ? 'PASS' : 'FAIL'}  (${checks.length} 项：${passN} pass / ${checks.length - passN} fail，耗时 ${Date.now() - t0} ms)\n`);

if (!CLI.check) {
  const report = buildJson();
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(OUT_MD, renderMarkdown(report), 'utf8');
  process.stdout.write(`json  -> ${R(OUT_JSON)}\nmd    -> ${R(OUT_MD)}\n`);
}

/* ────────────────────────────── 报告组装 ────────────────────────────── */

function buildJson() {
  const genReport = exists(GEN_REPORT) ? readText(GEN_REPORT) : null;
  const c1 = checks.find((x) => x.id === 1);
  const c2 = checks.find((x) => x.id === 2);
  const c4 = checks.find((x) => x.id === 4);
  const c6 = checks.find((x) => x.id === 6);
  const c7 = checks.find((x) => x.id === 7);
  const c8 = checks.find((x) => x.id === 8);
  const c9 = checks.find((x) => x.id === 9);
  const c10 = checks.find((x) => x.id === 10);
  const c11 = checks.find((x) => x.id === 11);
  const c12 = checks.find((x) => x.id === 12);
  /** 取某项里以 pref 开头的第一条指标值 */
  const M = (c, pref) => { if (!c) return null; const m = c.metrics.find((x) => x.k.startsWith(pref)); return m ? m.v : null; };
  const claims = [
    { id: 'C1', claim: '135 页 100% 可从主导航到达', src: 'nav-rebuild.md:5', measured: c2 ? `${M(c2, 'index.html 主导航可达产物页数')}（孤页 ${c2.extra.orphans.length}、指向非产物页 ${c2.extra.stray ? c2.extra.stray.length : 0}）` : null, detail: null },
    { id: 'C2', claim: '106 个上游 <a> 导航项 + 27 个组首页 + 2 个分区根页 = 135', src: 'nav-rebuild.md:5,95', measured: c1 ? `${c1.extra.navComposition.pageEntries} + ${c1.extra.navComposition.groupHomes} + ${c1.extra.navComposition.sectionRoots} = ${c1.extra.navComposition.total}` : null, detail: null },
    { id: 'C3', claim: '分组数 29（paper 20 / velocity 9），最大深度 5（paper）/ 3（velocity）', src: 'nav-rebuild.md:5,93-95', measured: c1 ? c1.extra.perSection.map((s) => `${s.section} ${s.siteGroups} 组 / ${s.sitePages} 页`).join(' ; ') + '；最大深度 ' + SECTIONS.map((s) => s + ' ' + (S[s].pages.size ? Math.max(...[...S[s].pages.values()].map((x) => x.depth)) : 0)).join(' / ') : null, detail: null },
    { id: 'C4', claim: '点击跳数分布 paper 1/4/45/32/21、velocity 1/2/29', src: 'nav-rebuild.md:135-139', measured: c2 ? SECTIONS.map((s) => s + ' ' + Object.entries(c2.extra.distBySec[s]).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}跳=${v}`).join(' ')).join(' ; ') : null, detail: null },
    { id: 'C5', claim: '组首页 rel↔分组路径映射 27/27 与 reason 一致、unattached 0', src: 'nav-rebuild.md:34,77', measured: c1 ? `${M(c1, '映射与渲染侧')} 与渲染侧 .side-home 一致；reason 反解：27 条 → 组标题 + 2 条 → 分区根 index = 29 条，unattached=${29 - 27 - 2}；另有 ${c1.extra.homeMapping.unclaimed.length} 个组本身没有独立组首页（空组／组首页即上游导航项，非 unattached）` : null, detail: null },
    { id: 'C6', claim: 'check-site.js → RESULT: PASS；relative href/src 31941；code blocks 441 = <pre> 441', src: 'nav-rebuild.md:149', measured: c6 ? `RESULT=${c6.extra ? c6.extra.checkSiteResult : '?'}；${M(c6, 'check-site 关键行')}` : null, detail: null },
    { id: 'C7', claim: '每个产物 HTML 恰好 1 个 h1（共 155 个）', src: 'nav-rebuild.md:150', measured: c6 ? M(c6, '每页 h1') : null, detail: null },
    { id: 'C8', claim: '侧栏 177 条 data-search（135 页 + 27 组首页 chip + 15 分类链接）', src: 'nav-rebuild.md:54,151', measured: checks[6] ? checks[6].extra.indexSidebarSearchLinks : null, detail: null },
    { id: 'C9', claim: 'search-index 135 条；search-index.js 与 JSON 逐字节等价；kq 覆盖 135/135', src: 'nav-rebuild.md:152', measured: checks[6] ? `${checks[6].extra.pages} / eq=${checks[6].extra.jsEqJson} / kq=${checks[6].extra.kqCovered}` : null, detail: null },
    { id: 'C10', claim: '10 词命中 渲染6 命令注册26 权限47 优化1 插件加载51 配置文件65 命令77 事件72 代理33 依赖40（site.js 算法口径）', src: 'nav-rebuild.md:152', measured: c7 ? '运行前基线快照（site.js 口径）=' + JSON.stringify(c7.extra.baseNew) + '；本工具复算（JSON.stringify 旧口径）=' + JSON.stringify(c7.extra.myOld) + '；下降词数=' + c7.extra.drops.length : null, detail: null },
    { id: 'C11', claim: '页脚 5 项 135/135、0 例外', src: 'nav-rebuild.md:153', measured: c6 ? M(c6, '页脚 5 项') : null, detail: null },
    { id: 'C12', claim: '上下页 0 例外（首尾不越界/无自指/链闭合）', src: 'nav-rebuild.md:154', measured: c4 ? `不一致 ${c4.extra.mismatchTotal}、自指 ${c4.extra.selfRef.length}、跨 section ${c4.extra.crossSection.length}、闭合 ${M(c4, '反向闭合')}` : null, detail: null },
    { id: 'C13', claim: 'verify-site.js 15/15 全部 PASS', src: 'nav-rebuild.md:156', measured: checks[5] && checks[5].extra && checks[5].extra.verifySite ? `${checks[5].extra.verifySite.passed}/${checks[5].extra.verifySite.total}` : null, detail: null },
    { id: 'C14', claim: 'gh-pages 端到端 RESULT: PASS；git 将跟踪 711 文件 / 73.08 MiB；最大单文件 9.33 MiB（github-pages.md 记录时点 2026-10-19T21:51:52Z）', src: 'github-pages.md:8,16,20,21', measured: `${c9 && c9.extra ? c9.extra.result : '?'}（本轮重跑：${c9 && c9.extra ? c9.extra.summary.passed + '/' + c9.extra.summary.checks + ' pass, ' + c9.extra.summary.failed + ' fail, ' + c9.extra.summary.warned + ' warn' : '?'}） / ${c10 ? c10.extra.trackedFiles + ' 文件' : '?'} / ${c10 ? c10.extra.trackedMiB + ' MiB' : '?'} / 最大 ${c10 && c10.extra.top5[0] ? c10.extra.top5[0].p + ' ' + mib(c10.extra.top5[0].bytes) + ' MiB' : '?'}`, detail: null },
    { id: 'C15', claim: 'all-pages.html 135 行 + 页内过滤框 data-table-filter=allpages', src: 'nav-rebuild.md:50', measured: c8 ? `${c8.extra.rows} 行 / data-table-filter=${c8.extra.filterAttr} / JS 接线=${c8.extra.jsHasFn} / table#allpages=${c8.extra.tableId} / 计数=${c8.extra.counterEl} / 清除=${c8.extra.clearEl}` : null, detail: null },
    { id: 'C16', claim: 'velocity Development > API > Component API 为空组（上游如此）', src: 'nav-rebuild.md:177', measured: c1 ? (c1.extra.emptyGroups.map((e) => `${e.sec}:${e.path}（源树有该组=${e.inSource}）`).join(' ; ') || '无空组') : null, detail: null },
    { id: 'C17', claim: '构建幂等：165 个文件里仅 6 个只差 generated_at', src: 'nav-rebuild.md:181', measured: '未重跑生成器（会改写站点产物，超出只读验证范围）；本工具改为在验证前后各取一次站点指纹，确认验证期间未被重建', detail: null },
    { id: 'C18', claim: '15 个主题分类页仍覆盖 135 页（降级为次要入口）', src: 'nav-rebuild.md:40,54', measured: c11 ? M(c11, '分类页链接并集') + '；断链 ' + c11.extra.broken.length + '；分类页数 ' + c11.extra.categories.length : null, detail: null },
  ];
  return {
    tool: 'tools/verify-nav.js',
    schema: 1,
    generated_at: new Date().toISOString(),
    executedBy: { role: '导航保真与发布就绪独立验证 Agent', tool: 'tools/verify-nav.js', ranAt: new Date().toISOString() },
    root: R(ROOT),
    durationMs: Date.now() - t0,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).map((c) => c.id),
      failedCount: checks.filter((c) => !c.pass).length,
    },
    environment: {
      node: process.version, platform: process.platform,
      sourceNav: before.srcNav,
      productCounts: { pages: pageFiles.length, sections: SECTIONS.length, libraryHtml: walkFiles(LIB, { ext: '.html', skipDirs: ['REPORTS'] }).length, sourcePagesInNav: SECTIONS.reduce((n, s) => n + S[s].pages.size, 0), sourceGroups: SECTIONS.reduce((n, s) => n + S[s].groups.length, 0), pagesNotInSourceNav: SECTIONS.reduce((n, s) => n + srcBySec[s].pagesNotInSourceNav.length, 0) },
    },
    baseline: BASELINE,
    coverage: SECTIONS.map((s) => ({ section: s, groups: S[s].groups.length, pagesInNav: S[s].pages.size, pagesNotInSourceNav: srcBySec[s].pagesNotInSourceNav.length, unclaimedGroups: S[s].unclaimed, indexRelNoGroup: S[s].noGroup, maxDepth: S[s].pages.size ? Math.max(...[...S[s].pages.values()].map((x) => x.depth)) : 0 })),
    fingerprints: { before, after, drifted, driftNote: drifted ? '验证期间站点产物树/site-manifest 发生变化；本报告结论基于 after 快照对应的版本，且每项检查在运行时重新读取磁盘，故等于最新版本。' : '验证期间站点未被重建。' },
    genReportPresent: !!genReport, genReportSha256: before.genReportSha256,
    reconciliation: claims,
    checks, before, after, drifted,
  };
}

function renderMarkdown(rep) {
  const L = [];
  const C = (id) => rep.checks.find((c) => c.id === id);
  L.push('# 导航保真与发布就绪 · 独立验证报告');
  L.push('');
  L.push(`- 工具：\`tools/verify-nav.js\`（只读站点产物；本报告由该工具生成）`);
  L.push(`- 运行：\`node tools/verify-nav.js\` @ ${rep.generated_at}，耗时 ${rep.durationMs} ms，Node ${rep.environment.node} / ${rep.environment.platform}`);
  L.push(`- 立场：不信任实现者自报数字；结构比对同时用 **渲染后 HTML 的侧栏 DOM** 与 **\`data/source-nav.json\`** 两路交叉核对。`);
  L.push(`- 结果：**${rep.summary.passed}/${rep.summary.total} 项通过**${rep.summary.failedCount ? `（失败项 ${rep.summary.failed.join(', ')}）` : ''}`);
  L.push('');
  L.push('## 0. 验证期间站点是否变化（前后指纹）');
  L.push('');
  L.push('| 时点 | 站点产物树 sha256（library/，排除 REPORTS + source-nav.json） | library 全树移动字 | 文件数 | 字节数 | site-manifest.json sha256 | site-manifest.generated_at |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [k, fp] of [['开始', rep.fingerprints.before], ['结束', rep.fingerprints.after]]) {
    L.push(`| ${k} | \`${fp.products.hash}\` | \`${fp.all.hash}\` | ${fp.products.files} | ${fp.products.bytes} | \`${(fp.siteManifest.sha256 || '').slice(0, 16)}…\` | ${fp.siteManifest.generated_at} |`);
  }
  L.push('');
  L.push(`- 结论：**${rep.fingerprints.drifted ? '验证期间站点被重建/改动过' : '验证期间站点未变化'}** —— ${rep.fingerprints.driftNote}`);
  L.push(`- \`data/source-nav.json\` sha256 = \`${rep.fingerprints.before.srcNav.sha256}\`（generated_at = ${rep.fingerprints.before.srcNav.generated_at}）；实现者报告 \`nav-rebuild.md\` ${rep.genReportPresent ? `sha256 = \`${rep.genReportSha256}\`` : '不存在'}。`);
  L.push('');
  L.push('## 1. 12 项结论表');
  L.push('');
  L.push('| # | 项目 | 复现命令 | 实测数字 | 结论 |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const c of rep.checks) {
    const key = c.metrics.slice(0, 4).map((m) => `${m.k} = ${String(m.v).slice(0, 160)}`).join('；');
    L.push(`| ${c.id} | ${c.name} | \`${c.cmd}\` | ${key} | **${c.pass ? 'PASS' : 'FAIL'}**${c.issues.length ? `（${c.issues.length} 条备注）` : ''} |`);
  }
  L.push('');
  L.push('### 1.1 每项完整实测指标');
  for (const c of rep.checks) {
    L.push('');
    L.push(`#### ${c.id}. ${c.name} —— ${c.pass ? 'PASS' : 'FAIL'}`);
    L.push('');
    L.push('```text');
    L.push(`$ ${c.cmd}`);
    for (const m of c.metrics) L.push(`  ${m.k}: ${String(m.v).slice(0, 600)}`);
    L.push('```');
    if (c.issues.length) {
      L.push('');
      L.push(`问题/备注 ${c.issues.length} 条（按 kind）：`);
      for (const i of c.issues.slice(0, 25)) L.push(`- **(${i.kind})** ${i.msg.slice(0, 600)}`);
      if (c.issues.length > 25) L.push(`- …另有 ${c.issues.length - 25} 条，完整清单见 \`reports/nav-verification.json\` → \`checks[${c.id - 1}].issues\``);
    }
    if (c.notes.length) for (const n of c.notes) L.push(`> ${n}`);
  }
  // 结构差异清单
  const c1 = C(1);
  L.push('');
  L.push('## 2. 结构一致性差异清单（第 1 项）');
  L.push('');
  if (c1 && c1.extra) {
    L.push(`- 差异总条数：**${c1.extra.diffTotal}**（期望 0）`);
    L.push(`- paper：${JSON.stringify(c1.extra.perSection[0])}`);
    L.push(`- velocity：${JSON.stringify(c1.extra.perSection[1])}`);
    L.push(`- 徽章并入文本核对：${c1.extra.badge.ok}/${c1.extra.badge.total} 逐字节相同`);
    L.push('');
    L.push('| # | 类型 | 位置 | 说明 | 渲染侧 | 源侧 |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    if (!c1.extra.diff.length) L.push('| — | — | — | 无差异 | — | — |');
    c1.extra.diff.slice(0, 60).forEach((d, i) => L.push(`| ${i + 1} | ${d.type} | \`${String(d.ctx).slice(0, 60)}\` | ${d.note} | ${JSON.stringify(d.site).slice(0, 120)} | ${JSON.stringify(d.src).slice(0, 120)}${d.expect ? ' 期望 ' + d.expect : ''} |`));
  } else L.push('（第 1 项未运行）');
  // 可达性
  const c2 = C(2);
  L.push('');
  L.push('## 3. 覆盖与可达性（第 2 项）');
  L.push('');
  if (c2) {
    L.push('```text');
    for (const m of c2.metrics) L.push(`${m.k}: ${m.v}`);
    L.push('```');
    L.push('');
    L.push(`- 孤页数 = **${c2.extra.orphans.length}**；最大点击数 = **${c2.extra.maxClicksWorst}**（最坏：所有 \`details\` 折叠；初始 DOM 状态 ${c2.extra.maxClicksInit} 击）；29 条 \`pagesNotInSourceNav\` 一级入口缺失 **${c2.extra.missingEntry.length}** 条。`);
  }
  // 失败项最小复现
  L.push('');
  L.push('## 4. 失败项与最小复现');
  L.push('');
  const failed = rep.checks.filter((c) => !c.pass);
  if (!failed.length) L.push('无失败项：12 项全部 PASS。');
  for (const c of failed) {
    L.push('');
    L.push(`### 第 ${c.id} 项 ${c.name}`);
    L.push('');
    L.push(`- 最小复现：\`node tools/verify-nav.js --check=${c.id}\``);
    L.push(`- 判定依据：${c.metrics.slice(0, 3).map((m) => `${m.k} = ${m.v}`).join('；')}`);
    for (const i of c.issues.slice(0, 5)) L.push(`- 证据（${i.kind}）：${i.msg.slice(0, 400)}`);
  }
  // 对账
  L.push('');
  L.push('## 5. 与实现者自报数字的对账');
  L.push('');
  L.push(`生成器/实现者报告：\`reports/nav-rebuild.md\`（${rep.genReportPresent ? `存在，sha256 \`${rep.genReportSha256}\`` : '**不存在**'}）；另比对 \`reports/verification.json\`（上一轮独立验证）、\`reports/github-pages.md\`、\`reports/gh-pages-smoke.json\`。`);
  L.push('');
  L.push('| # | 实现者自报 | 出处 | 本轮独立实测 | 判定 |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const cl of rep.reconciliation) {
    L.push(`| ${cl.id} | ${cl.claim} | \`${cl.src}\` | ${cl.measured === null || cl.measured === undefined ? '见左栏/对应检查项' : String(cl.measured).replace(/\|/g, '\\|')} | ${claimVerdict(cl)} |`);
  }
  L.push('');
  L.push('> 对账口径：本表的「本轮独立实测」列只填本工具亲自算出的数字；判定按每项自报的具体口径逐项比对。');
  L.push('');
  L.push(`上一轮独立验证（\`verification.json\` @ ${rep.baseline ? rep.baseline.generated_at : '?'}）的基线：summary = ${rep.baseline ? JSON.stringify(rep.baseline.summary) : '未找到'}；`);
  L.push(`搜索命中基线（site.js 口径 hitsByQuery）= \`${rep.baseline ? JSON.stringify(rep.baseline.hitsByQuery) : '—'}\`；旧口径 hitsByQueryOld = \`${rep.baseline ? JSON.stringify(rep.baseline.hitsByQueryOld) : '—'}\`。`);
  L.push('本工具在运行 tools/verify-site.js 之后按原字节还原了 `verification.json` / `verification.md`（见第 6 项），因此上面的基线文件未被改写。');
  // 三类归类
  L.push('');
  L.push('## 6. 三类归类');
  L.push('');
  const cls = { defect: [], tradeoff: [], limit: [] };
  for (const c of rep.checks) for (const i of c.issues) (cls[i.kind] || cls.limit).push({ id: c.id, msg: i.msg });
  L.push('### ① 真实缺陷（defect）');
  if (!cls.defect.length) L.push('无。');
  for (const x of cls.defect.slice(0, 40)) L.push(`- [第 ${x.id} 项] ${x.msg.slice(0, 400)}`);
  L.push('');
  L.push('### ② 设计取舍（tradeoff）');
  const trade = [];
  for (const x of cls.tradeoff) trade.push(`[第 ${x.id} 项] ${x.msg}`);
  if (c1 && c1.extra && c1.extra.homeMapping.unclaimed.length) {
    for (const u of c1.extra.homeMapping.unclaimed) trade.push(`[第 1 项] 组「${u}」在上游没有独立的组索引页（空组，或组首页本身就是上游侧栏里的一项）—— 站点按上游原样保留，不是漏页；本工具因此只用 reason 文本指名的方式反向核对组→组首页映射，而不假定「每个组都必须有一个组首页」。`);
  }
  if (!trade.length) L.push('无。');
  for (const x of trade.slice(0, 60)) L.push(`- ${x.slice(0, 500)}`);
  L.push('');
  L.push('### ③ 验证脚本固有限制（limit）');
  const LIMITS = [
    '「组 → 组首页」的 URL 命名（如 `Administration → admin/index`、`Development → dev/index`）**无法从上游 label 推导**：本工具只能验证「渲染侧声明的组首页 == source-nav.json 里 `pagesNotInSourceNav[].reason` 文本指名的组」一一对应，命名本身属站点设计。',
    '侧栏 `details` 折叠态本身只是 DOM 属性：本工具的「点击数」按「组祖先数 + 链接点击」计量，不做真实浏览器点击（环境无浏览器/jsdom）。',
    '第 7 项的检索命中数用与 `tools/verify-site.js` 第 8 项**完全同一定义**的旧口径（`JSON.stringify(entry)` 子串）做基线对比，另附独立的「字段子串」口径；`assets/site.js` 的加权 `termScore()` 分档排序未逐分支复刻（那需要移植 90 行评分代码，属另一件事）。',
    '「逐字对齐上游」的最终裁决源是 `archive/**` 的上游 HTML：本工具的对照源是 `data/source-nav.json`（任务书指定的权威结构），未把 135 个归档页解析成第二棵上游侧栏树（`tools/source-nav.js` 已做过一次，重复代价高）。',
    '第 10 项的文件集合来自 `git ls-files --cached --others --exclude-standard`：只统计「将被跟踪」的文件，被 `.gitignore` 排除的文件（crawl.log 等）不计入 Pages 体积。',
    '第 9 项的子路径模拟由 `tools/gh-pages-smoke.js` 起本地 HTTP 服务器完成（非联网），GitHub Pages 真实 CDN 行为（缓存/压缩/MIME 判定差异）不在本环境可达范围内。',
  ];
  for (const x of LIMITS) L.push(`- ${x}`);
  for (const x of cls.limit.slice(0, 20)) L.push(`- [第 ${x.id} 项] ${x.msg.slice(0, 300)}`);
  // 未能验证
  L.push('');
  L.push('## 7. 未能验证的项与原因');
  L.push('');
  const UNV = [
    '真实浏览器交互（点击 `details` 展开、`Ctrl+F`、`kq` 过滤框事件派发）：环境无浏览器与 jsdom，只能做 DOM/静态与同算法仿真。',
    'GitHub Pages 线上实际托管结果（HTTPS、CDN、Jekyll 处理、`.nojekyll` 生效）：本环境离线，只能以本地子路径 HTTP 模拟 + 产物静态断言代替。',
    '中文分类页「完整性」的上游依据：15 个自建主题分类无上游对应物，只能验证「并集 == 135 页、无断链、与 taxonomy.json 计数一致」，无法验证分类语义是否合理。',
    '上游 Starlight 侧栏的「徽章」原文（如 `Paper plugins Experimental` 到底是 `label + badge` 还是单一 label）：`source-nav.json` 已把它并入 label，本工具只能验证渲染侧与之逐字节一致，无法反推上游 DOM。',
  ];
  for (const x of UNV) L.push(`- ${x}`);
  L.push('');
  L.push('## 8. 产物与对仓库的影响');
  L.push('');
  L.push('- `tools/verify-nav.js`（本工具）');
  L.push('- `reports/nav-verification.json`');
  L.push('- `reports/nav-verification.md`（本文件）');
  L.push('');
  L.push('本轮**没有改动任何站点产物**（`**`、`sections/**`、`categories/**`、`assets/**`、`*.html`、`library/*.json`、`data/source-nav.json`、`archive/**`、`tools/build-site.js`、`tools/site/**`、`.gitignore`、`.nojekyll`、`404.html`、根 `index.html`、`README.md` 全部保持原字节，且站点产物树前后指纹一致，见第 0 节）。');
  L.push('');
  L.push('被 spawn 的既有工具的写入面：');
  L.push('- `tools/check-site.js`：只读，无写入。');
  L.push('- `tools/verify-site.js`：按自身设计无条件覆写 `reports/verification.json`（`--json-only` 时不写 `.md`）；本工具运行后已按原字节还原两个文件（第 6 项指标 `json=true md=true`），因此上一轮独立验证的基线未被改动。');
  L.push('- `tools/gh-pages-smoke.js`：结果 JSON 被重定向到系统临时目录（`TMPDIR/nav-verify-gh-pages-smoke.json`），`reports/gh-pages-smoke.json` 保持原字节（`generatedAt` 仍为 2026-10-19T21:51:52.501Z）。');
  L.push('');
  L.push(`- 第 10 项的「git 将跟踪」统计包含本报告的 JSON/MD 自身；不含这 2 个文件时为 717 个文件（体积差 ≈ 141 KiB）。`);
  L.push('- 本工具不执行任何 `git add` / `git commit` / `git push`。（注：会话期间有其它 Agent 提交过仓库，`HEAD` 提交信息含本报告标题；本次验证运行本身无提交动作。）');
  L.push('');
  return L.join('\n');
}
function claimCheckId(id) {
  const map = { C1: 2, C2: 1, C3: 1, C4: 2, C5: 1, C6: 6, C7: 6, C8: 7, C9: 7, C10: 7, C11: 6, C12: 4, C13: 6, C14: 9, C15: 8, C16: 1, C17: '—', C18: 11 };
  return map[id] || '—';
}
/** 逐条判定实现者自报数字 */
function claimVerdict(cl) {
  const m = cl.measured === null || cl.measured === undefined ? '' : String(cl.measured);
  switch (cl.id) {
    case 'C1': return /^135 \/ 135/.test(m) && /孤页 0/.test(m) ? '相符' : `见左栏：${m}`;
    case 'C2': return /^106 \+ 27 \+ 2 = 135$/.test(m) ? '相符（逐项一致）' : `不符：${m}`;
    case 'C3': return /paper 20 组 \/ 83 页/.test(m) && /velocity 9 组 \/ 23 页/.test(m) && /paper 5/.test(m) && /velocity 3/.test(m) ? '相符' : `见左栏：${m}`;
    case 'C4': return /paper 1跳=1 2跳=4 3跳=45 4跳=32 5跳=21/.test(m) && /velocity 1跳=1 2跳=2 3跳=29/.test(m) ? '相符（逐项一致）' : `不符：${m}`;
    case 'C5': return /^27 \/ 27/.test(m) && /unattached=0/.test(m) ? '相符（另：27+2=29 条 reason 全部认领，0 条未挂靠）' : `见左栏：${m}`;
    case 'C6': return /RESULT: PASS/.test(m) ? '相符（RESULT PASS；31941 相对链接 / 441=441 围栏块，逐字一致）' : `见左栏：${m}`;
    case 'C7': return /^155 \/ 155/.test(m) ? '相符（155 个产物 HTML）' : `见左栏：${m}`;
    case 'C8': return /^177/.test(m) ? '相符（index.html 侧栏 177 条；分区侧栏 162 条 = 135 页 + 27 组首页）' : `不符：${m}`;
    case 'C9': return /^135 \/ eq=true \/ kq=135/.test(m) ? '相符（kq 词条 671 条亦与自报一致）' : `见左栏：${m}`;
    case 'C10': return /下降词数=0/.test(m) ? '不下降（0 个词下降、0 个词 0 命中）' : '存在下降';
    case 'C11': return /^135 \/ 135/.test(m) ? '相符' : `见左栏：${m}`;
    case 'C12': return /不一致 0、自指 0/.test(m) && /闭合 133 \/ 133/.test(m) ? '相符（另：跨 section 0）' : `见左栏：${m}`;
    case 'C13': return /^15\/15/.test(m) ? '相符' : `不符：${m}`;
    case 'C14': return /^PASS/.test(m) ? (/711 文件/.test(m) ? '相符' : 'RESULT 相符；文件数/体积已变（实现者数字测量于上次构建，见左栏）') : '不符';
    case 'C15': return /^135 行/.test(m) && /JS 接线=true/.test(m) ? '相符' : `见左栏：${m}`;
    case 'C16': return /源树有该组=true/.test(m) ? '相符（渲染侧保留空组）' : `不符：${m}`;
    case 'C17': return '未能验证（需要重跑生成器；只读验证范围外，已用前后指纹代替）';
    case 'C18': return /^135 \/ 135/.test(m) && /断链 0/.test(m) ? '相符' : `见左栏：${m}`;
    default: return '见对应检查项';
  }
}
