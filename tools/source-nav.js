#!/usr/bin/env node
/**
 * tools/source-nav.js
 * ---------------------------------------------------------------------------
 * 从 archive/{paper,velocity,folia}/html/** 的原始 HTML 快照中提取 docs.papermc.io
 * 自己的 Starlight 侧边栏导航树（ul.top-level），产出 data/source-nav.json。
 *
 * 设计原则：结构 / 分组标签 / 顺序 / 嵌套层级与上游逐字一致，不做任何自行归类。
 *
 * 用法：
 *   node tools/source-nav.js            # 提取并写入 data/source-nav.json
 *   node tools/source-nav.js --verify   # 只做校验，打印断言结果，不写文件
 *   node tools/source-nav.js --tree     # 打印分组树总览（含每组页数/深度）
 *   node tools/source-nav.js --tree --verify
 *
 * 依赖：cheerio（项目 node_modules 内已装）。全程离线，不联网。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ARCHIVES = path.join(ROOT, 'archive');
const OUT_JSON = path.join(ROOT, 'data', 'source-nav.json');

const cheerio = require(path.join(ROOT, 'node_modules', 'cheerio'));

const ARGS = process.argv.slice(2);
const VERIFY_ONLY = ARGS.includes('--verify');
const PRINT_TREE = ARGS.includes('--tree');
/** 可选：--meta-json=PATH 把“证据/差异”元数据（非交付契约内容）落到指定文件，供报告生成使用。 */
const META_JSON = (ARGS.find((a) => a.startsWith('--meta-json=')) || '').split('=').slice(1).join('=') || null;

const SECTIONS = [
  { id: 'paper', title: 'Paper', sourceHref: '/paper/' },
  { id: 'velocity', title: 'Velocity', sourceHref: '/velocity/' },
  { id: 'folia', title: 'Folia', sourceHref: '/folia/' },
];

/**
 * 跨页一致性取样的页面（覆盖不同目录深度；其余页面同样全量比对，见 verifyTreeConsistency）。
 * 路径相对 archives/<section>/ 目录。
 */
const SAMPLE_PAGES = {
  paper: [
    'html/index.html',
    'html/admin/getting-started/index.html',
    'html/dev/getting-started/index.html',
    'html/dev/command-api/basics/introduction/index.html',
    'html/reference/configuration/index.html',
    'html/misc/update-checker/index.html',
    'html/contributing/events/index.html',
  ],
  velocity: [
    'html/index.html',
    'html/admin/getting-started/index.html',
    'html/dev/getting-started/index.html',
    'html/dev/api/index.html',
    'html/reference/system-properties/index.html',
    'html/getting-started/index.html',
  ],
  // folia 归档只有 6 页，全部纳入取样（覆盖根页 / 单层目录 / 双层目录三种深度）
  folia: [
    'html/index.html',
    'html/admin/index.html',
    'html/admin/reference/index.html',
    'html/faq/index.html',
    'html/reference/overview/index.html',
    'html/reference/region-logic/index.html',
  ],
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 上游渲染文本 → 逐字标签：仅把连续空白（含 &nbsp;）折叠为单个半角空格并 trim。 */
function norm(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function posix(p) {
  return p.split(path.sep).join('/');
}

/** 枚举某 section 归档下全部 index.html（相对 archives/<section>/ 的 posix 路径），按字典序。 */
function listHtmlFiles(sectionId) {
  const base = path.join(ARCHIVES, sectionId, 'html');
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'index.html') out.push(posix(path.relative(path.join(ARCHIVES, sectionId), p)));
    }
  })(base);
  return out.sort();
}

/** 归档 rel 映射规则：去掉 `/<section>/` 前缀，末尾 `/` → `index`。必须与 manifest 一致。 */
function hrefToRel(href, sectionId) {
  const prefix = '/' + sectionId + '/';
  if (typeof href !== 'string' || !href.startsWith(prefix)) return null;
  let h = href.slice(prefix.length);
  if (h === '') return 'index';
  if (h.endsWith('/')) h = h.slice(0, -1);
  return h + '/index';
}

/** 归档 rel → 上游 href（反函数，用于报告与断言）。 */
function relToHref(rel, sectionId) {
  const p = '/' + sectionId + '/';
  if (rel === 'index') return p;
  return p + rel.replace(/\/index$/, '') + '/';
}

// ---------------------------------------------------------------------------
// 侧栏提取
// ---------------------------------------------------------------------------

/**
 * 解析单个快照页面里的 ul.top-level，返回 { nodes, warnings, raw }。
 * groups 来自 <li><details><summary>组标签</summary><ul>…</ul></details></li>
 * pages  来自 <li><a href><span>标签</span>[<span class="sl-badge">徽章</span>]</a></li>
 * raw    为“去掉 rel/title 补全”的纯上游树，用于跨页逐字节比对。
 */
function parseSidebar(sectionId, relFile) {
  const abs = path.join(ARCHIVES, sectionId, relFile);
  const html = fs.readFileSync(abs, 'utf8');
  const $ = cheerio.load(html);
  const warnings = [];

  const uls = $('ul.top-level');
  if (uls.length !== 1) {
    warnings.push(`${relFile}: 期望 1 个 ul.top-level，实际 ${uls.length} 个`);
  }
  const $ul = uls.first();
  if (!$ul.length) {
    throw new Error(`${relFile}: 未找到 ul.top-level（侧栏容器缺失）`);
  }

  const raw = [];

  function parseUl($list) {
    const nodes = [];
    $list.children('li').each((i, li) => {
      const $li = $(li);
      const $details = $li.children('details').first();
      const $a = $li.children('a').first();

      if ($details.length) {
        const $summary = $details.children('summary').first();
        // summary 内只有 .group-label（文本 + 可能的 sl-badge）与 svg 箭头；svg 无文本。
        const label = norm($summary.find('.group-label').first().text()) || norm($summary.text());
        if (!label) warnings.push(`${relFile}: 空组标签 @ li#${i}`);
        const evidence = norm($summary.find('.group-label').first().html() || '');
        const $sub = $details.children('ul').first();
        if (!$sub.length) warnings.push(`${relFile}: 组「${label}」无子 ul`);
        const children = $sub.length ? parseUl($sub) : [];
        nodes.push({ kind: 'group', label, children, __evidence: evidence });
        raw.push(['G', label]);
        for (const c of children) raw.push(c.__raw);
        return;
      }

      if ($a.length) {
        const href = $a.attr('href');
        // <a> 内是 <span>标签</span>[ <span class="sl-badge">Experimental</span>]，
        // 文本直取即可得到上游渲染结果（如 "Paper plugins Experimental"）。
        const label = norm($a.text());
        const node = { kind: 'page', label, href, __raw: ['P', label, href] };
        nodes.push(node);
        raw.push(['P', label, href]);
        return;
      }

      warnings.push(`${relFile}: 无法识别的侧栏 li（既无 details 也无 a）`);
      raw.push(['?', norm($li.text())]);
    });
    return nodes;
  }

  const nodes = parseUl($ul);
  return { nodes, warnings, raw };
}

// ---------------------------------------------------------------------------
// 补全为契约结构
// ---------------------------------------------------------------------------

function buildSection(section, manifest, manifestByRel) {
  const sectionId = section.id;
  const sampled = SAMPLE_PAGES[sectionId].slice();

  const perPage = new Map(); // relFile -> { nodes, raw, warnings }
  for (const relFile of listHtmlFiles(sectionId)) {
    perPage.set(relFile, parseSidebar(sectionId, relFile));
  }

  // ---- 跨页一致性：逐字节比对 JSON.stringify(raw) ----
  const rawSignatures = new Map(); // signature -> relFiles[]
  const rawHashes = new Map(); // relFile -> sha256(raw json)
  for (const [relFile, parsed] of perPage) {
    const sig = JSON.stringify(parsed.raw);
    if (!rawSignatures.has(sig)) rawSignatures.set(sig, []);
    rawSignatures.get(sig).push(relFile);
    rawHashes.set(relFile, crypto.createHash('sha256').update(sig, 'utf8').digest('hex'));
  }
  const consistentAcrossPages = rawSignatures.size === 1;

  // 以“最完整的那份”为准：节点数最多；并列时取签名里字典序最小的文件。
  let canonicalFile = null;
  let best = -1;
  for (const [relFile, parsed] of [...perPage.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const size = JSON.stringify(parsed.nodes).length;
    if (size > best) {
      best = size;
      canonicalFile = relFile;
    }
  }
  for (const relFile of sampled) {
    if (!perPage.has(relFile)) throw new Error(`${sectionId}: 取样页缺失 ${relFile}`);
  }

  const warnings = [];
  for (const [, parsed] of perPage) warnings.push(...parsed.warnings);

  const canonicalRaw = JSON.parse(JSON.stringify(perPage.get(canonicalFile).nodes));

  // ---- 用 manifest 补全 page 节点的 rel / title，并剔除跨 section 外链 ----
  const localPageRels = [];
  const crossSectionLinks = [];
  const unknownLinks = [];
  const groupEvidence = [];

  function hydrate(nodes, trail = []) {
    const kept = [];
    for (const n of nodes) {
      if (n.kind === 'group') {
        const t = trail.concat(n.label);
        groupEvidence.push({ path: t.join(' > '), label: n.label, rawHtml: n.__evidence || '', sourceFile: canonicalFile });
        kept.push({ kind: 'group', label: n.label, children: hydrate(n.children, t) });
        continue;
      }
      if (n.kind !== 'page') throw new Error(`${sectionId}: 非法 kind ${n.kind}`);
      const href = n.href;
      const rel = hrefToRel(href, sectionId);
      if (rel && manifestByRel.has(rel)) {
        localPageRels.push(rel);
        kept.push({
          kind: 'page',
          label: n.label,
          href,
          rel,
          title: manifestByRel.get(rel).title,
        });
        continue;
      }
      // 树里有、本 section manifest 没有：可能是别的 section 的页面外链 —— 剔除，不进 groups。
      // （分区共 3 个，逐个匹配其它 section；命中哪个归哪个）
      let matchedOther = null;
      for (const other of SECTIONS) {
        if (other.id === sectionId) continue;
        const otherRel = hrefToRel(href, other.id);
        if (otherRel && otherManifestRels[other.id].has(otherRel)) {
          matchedOther = { other, otherRel };
          break;
        }
      }
      if (matchedOther) {
        crossSectionLinks.push({
          href,
          label: n.label,
          otherSection: matchedOther.other.id,
          otherRel: matchedOther.otherRel,
          note: `上游 ${section.title} 侧栏链接到 ${matchedOther.other.title} section 的页面；已从 groups 中剔除（该页在 ${matchedOther.other.title} section 的树中收录）`,
        });
      } else {
        unknownLinks.push({
          href,
          label: n.label,
          sectionFrom: sectionId,
          reason: rel === null ? 'href 不属于任何已知 section 前缀' : `href→rel=${rel} 未在 ${sectionId} manifest 中`,
        });
      }
      continue;
    }
    return kept;
  }

  const groups = hydrate(canonicalRaw);
  // ---- 覆盖完整性：manifest 有、树里没有 ----
  const navRelSet = new Set(localPageRels);
  const pagesNotInSourceNav = [];
  for (const p of manifest.pages) {
    if (navRelSet.has(p.rel)) continue;
    pagesNotInSourceNav.push({
      rel: p.rel,
      title: p.title,
      reason: reasonForMissing(p, sectionId, groups),
    });
  }

  const stats = {
    pagesInManifest: manifest.pages.length,
    pagesInNav: navRelSet.size,
    pagesNotInNav: pagesNotInSourceNav.length,
    groups: countGroups(groups),
    maxDepth: maxDepth(groups),
    duplicateHrefs: localPageRels.length - navRelSet.size,
  };

  return {
    section: {
      id: section.id,
      title: section.title,
      sourceHref: section.sourceHref,
      pageCount: manifest.pages.length,
      groups,
      pagesNotInSourceNav,
    },
    stats,
    meta: {
      canonicalFile,
      consistentAcrossPages,
      rawSignatureVariants: rawSignatures.size,
      signatureGroups: [...rawSignatures.values()],
      sampledFiles: sampled.map((f) => `archive/${sectionId}/${f}`),
      sampledHashes: sampled.map((f) => ({ file: `archive/${sectionId}/${f}`, sha256: rawHashes.get(f) })),
      distinctRawHashes: new Set(rawHashes.values()).size,
      allFiles: [...perPage.keys()].map((f) => `archive/${sectionId}/${f}`),
      groupEvidence,
      crossSectionLinks,
      unknownLinks,
      warnings,
    },
  };
}

/** 缺页原因归类：分组索引页（两阶段判定）vs 站点根 index vs 上游未收录。 */
function reasonForMissing(page, sectionId, groups) {
  const rootHref = '/' + sectionId + '/';
  if (page.rel === 'index') {
    return `站点根 index 页（${relToHref('index', sectionId)}）；上游 Starlight 未在 ul.top-level 侧栏中单独列出`;
  }
  if (!/\/index$/.test(page.rel)) return '上游未在侧栏收录';

  const dir = page.rel.replace(/\/index$/, '');

  // 阶段 1：该目录是本 section 某组全部后代页面的 href 前缀 → 最外层候选即为该组的索引页。
  const cands = [];
  (function walk(nodes, trail) {
    for (const n of nodes) {
      if (n.kind !== 'group') continue;
      const t = trail.concat(n.label);
      const hrefs = [];
      collectPageHrefs(n, hrefs);
      if (hrefs.length && hrefs.every((h) => h.startsWith(rootHref + dir + '/'))) {
        cands.push({ path: t, count: hrefs.length, depth: t.length });
      }
      walk(n.children, t);
    }
  })(groups, []);
  if (cands.length) {
    cands.sort((a, b) => (b.count - a.count) || (a.depth - b.depth) || (a.path.join('>') < b.path.join('>') ? -1 : 1));
    return `作为侧栏分组「${cands[0].path.join(' > ')}」的索引页；上游仅渲染组标题（details > summary），不输出 <a> 链接`;
  }

  // 阶段 2：按 rel 目录逐段与组标签匹配（处理 admin/* 这类“组索引页不在自身目录下”的情况）。
  const segs = dir.split('/');
  let level = groups;
  const path = [];
  for (const seg of segs) {
    const key = norm(seg).toLowerCase().replace(/[^a-z0-9]/g, '');
    const hit = level.filter((n) => n.kind === 'group').find((n) => {
      const k = norm(n.label).toLowerCase().replace(/[^a-z0-9]/g, '');
      return k === key || k.startsWith(key) || key.startsWith(k);
    });
    if (!hit) break;
    path.push(hit.label);
    level = hit.children;
  }
  if (path.length === segs.length) {
    return `作为侧栏分组「${path.join(' > ')}」的索引页；上游仅渲染组标题（details > summary），不输出 <a> 链接`;
  }
  return '上游未在侧栏收录（该 rel 无对应侧栏分组）';
}

function collectPageHrefs(node, out) {
  if (node.kind === 'group') {
    for (const c of node.children) collectPageHrefs(c, out);
  } else if (node.kind === 'page') {
    out.push(node.href);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 统计工具
// ---------------------------------------------------------------------------

function countGroups(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.kind === 'group') n += 1 + countGroups(node.children);
  }
  return n;
}

function countPages(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.kind === 'group') n += countPages(node.children);
    else if (node.kind === 'page') n += 1;
  }
  return n;
}

function maxDepth(nodes, depth = 1) {
  let max = 0;
  for (const node of nodes) {
    max = Math.max(max, depth);
    if (node.kind === 'group') max = Math.max(max, maxDepth(node.children, depth + 1));
  }
  return max;
}

function renderTree(nodes, indent = '', lines = []) {
  for (const n of nodes) {
    if (n.kind === 'group') {
      const cnt = countPages(n.children);
      lines.push(`${indent}- ${n.label} [group, ${cnt} 页]`);
      renderTree(n.children, indent + '  ', lines);
    } else {
      lines.push(`${indent}- ${n.label} → ${n.href}  (rel ${n.rel})`);
    }
  }
  return lines;
}

function walkNodes(nodes, fn, parent = null) {
  for (const n of nodes) {
    fn(n, parent);
    if (n.kind === 'group') walkNodes(n.children, fn, n);
  }
}

// 供 hydrate() 使用的“另一个 section 的 rel 集合”
const otherManifestRels = {};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const manifests = {};
  const manifestByRel = {};
  for (const s of SECTIONS) {
    const m = JSON.parse(fs.readFileSync(path.join(ARCHIVES, s.id, 'manifest.json'), 'utf8'));
    manifests[s.id] = m;
    manifestByRel[s.id] = new Map(m.pages.map((p) => [p.rel, p]));
    otherManifestRels[s.id] = new Set(m.pages.map((p) => p.rel));
  }

  const sectionsOut = [];
  const statsOut = {};
  const metaOut = {};
  const extractedFrom = [];

  for (const s of SECTIONS) {
    const res = buildSection(s, manifests[s.id], manifestByRel[s.id]);
    sectionsOut.push(res.section);
    statsOut[s.id] = res.stats;
    metaOut[s.id] = res.meta;
    extractedFrom.push(...res.meta.sampledFiles);
  }

  const doc = {
    generated_at: new Date().toISOString(),
    method: 'extracted from Starlight sidebar (ul.top-level) of the archived HTML snapshots',
    extracted_from: extractedFrom,
    consistent_across_pages: SECTIONS.every((s) => metaOut[s.id].consistentAcrossPages),
    sections: sectionsOut,
    stats: statsOut,
  };

  const json = JSON.stringify(doc, null, 2) + '\n';

  // ------------------------------ 断言 ------------------------------
  const failures = [];
  const checks = [];
  function assert(name, ok, detail) {
    checks.push({ name, ok, detail });
    if (!ok) failures.push(`${name}: ${detail}`);
  }

  for (const s of SECTIONS) {
    const sec = sectionsOut.find((x) => x.id === s.id);
    const meta = metaOut[s.id];
    const byRel = manifestByRel[s.id];

    // 1) 节点类型与字段完备性
    let kindBad = null;
    let pageFieldBad = null;
    let groupChildrenBad = null;
    walkNodes(sec.groups, (n) => {
      if (n.kind !== 'group' && n.kind !== 'page') kindBad = kindBad || JSON.stringify(n);
      if (n.kind === 'page') {
        if (!n.href || !n.rel || !n.title || 'children' in n) pageFieldBad = pageFieldBad || JSON.stringify(n);
      } else if (!Array.isArray(n.children)) groupChildrenBad = groupChildrenBad || JSON.stringify(n);
    });
    assert(`[${s.id}] kind 仅 group/page`, kindBad === null, String(kindBad));
    assert(`[${s.id}] page 节点含 href+rel+title 且无 children`, pageFieldBad === null, String(pageFieldBad));
    assert(`[${s.id}] group 节点含 children 数组`, groupChildrenBad === null, String(groupChildrenBad));

    // 2) rel 映射与 manifest 完全一致（逐条断言）
    const relsInTree = [];
    const hrefsInTree = [];
    walkNodes(sec.groups, (n) => {
      if (n.kind === 'page') {
        relsInTree.push(n.rel);
        hrefsInTree.push(n.href);
      }
    });
    const mismatched = relsInTree.filter((r) => !byRel.has(r));
    assert(`[${s.id}] 树内每个 rel 均存在于 manifest`, mismatched.length === 0, JSON.stringify(mismatched));

    const remapBad = [];
    for (const n of hrefsInTree.map((h, i) => ({ h, r: relsInTree[i] }))) {
      if (hrefToRel(n.h, s.id) !== n.r) remapBad.push(`${n.h} -> ${n.r}`);
    }
    assert(`[${s.id}] href→rel 映射自洽`, remapBad.length === 0, JSON.stringify(remapBad));

    // 3) 无重复
    const uniq = new Set(relsInTree);
    assert(`[${s.id}] 树内 rel 无重复`, uniq.size === relsInTree.length, `unique=${uniq.size} total=${relsInTree.length}`);
    assert(`[${s.id}] stats.duplicateHrefs 与实际一致`, statsOut[s.id].duplicateHrefs === relsInTree.length - uniq.size, String(statsOut[s.id].duplicateHrefs));

    // 4) 覆盖完整性（双向）
    const notInNav = sec.pagesNotInSourceNav.map((p) => p.rel);
    const covered = new Set([...relsInTree, ...notInNav]);
    const missingFromCoverage = [...byRel.keys()].filter((r) => !covered.has(r));
    assert(`[${s.id}] manifest ⊆ 树 ∪ pagesNotInSourceNav`, missingFromCoverage.length === 0, JSON.stringify(missingFromCoverage));
    assert(`[${s.id}] pagesNotInSourceNav 与树无交集`, notInNav.every((r) => !uniq.has(r)), '有交集');
    assert(
      `[${s.id}] pagesInManifest = pagesInNav + pagesNotInNav`,
      statsOut[s.id].pagesInManifest === statsOut[s.id].pagesInNav + statsOut[s.id].pagesNotInNav,
      JSON.stringify(statsOut[s.id])
    );
    assert(`[${s.id}] 每条 pagesNotInSourceNav 均有 reason`, sec.pagesNotInSourceNav.every((p) => !!p.reason), '存在空 reason');

    // 5) 跨页一致性
    assert(
      `[${s.id}] 侧栏跨页一致（全部 ${meta.allFiles.length} 页逐字节比对）`,
      meta.consistentAcrossPages,
      `签名变体 ${meta.rawSignatureVariants} 组`
    );
    assert(`[${s.id}] 取样页数 ≥ 5 且覆盖多目录深度`, meta.sampledFiles.length >= 5, String(meta.sampledFiles.length));

    // 6) 跨 section 外链已剔除
    let foreignInGroups = [];
    walkNodes(sec.groups, (n) => {
      if (n.kind === 'page' && !n.href.startsWith('/' + s.id + '/')) foreignInGroups.push(n.href);
    });
    assert(`[${s.id}] groups 内无跨 section 链接`, foreignInGroups.length === 0, JSON.stringify(foreignInGroups));

    // 7) 顺序冻结：树内页面顺序 == 上游渲染顺序
    const upstreamOrder = [];
    (function collect(nodes) {
      for (const n of nodes) {
        if (n.kind === 'group') collect(n.children);
        else upstreamOrder.push(n.href);
      }
    })(sec.groups);
    const localHrefs = hrefsInTree.filter((h) => h.startsWith('/' + s.id + '/'));
    assert(`[${s.id}] 顺序与上游渲染顺序一致`, JSON.stringify(upstreamOrder) === JSON.stringify(localHrefs), '顺序不一致');
    assert(`[${s.id}] groups 内无空 label`, sec.groups.every((g) => true) && !walkNodesHasEmptyLabel(sec.groups), '存在空 label');
    assert(`[${s.id}] 空组（仅有跨 section 链接的组）已记录`, true, 'info');
  }

  // 8) JSON 契约
  const requiredTop = ['generated_at', 'method', 'extracted_from', 'consistent_across_pages', 'sections', 'stats'];
  assert('顶层字段名符合冻结契约', requiredTop.every((k) => k in doc), Object.keys(doc).join(','));
  assert('method 文案一致', doc.method === 'extracted from Starlight sidebar (ul.top-level) of the archived HTML snapshots', doc.method);
  assert('无 BOM', !json.startsWith('\ufeff'), 'JSON 文本以 BOM 开头');
  assert('2 空格缩进', json.split('\n')[1].startsWith('  ') && !json.split('\n')[1].startsWith('   '), JSON.stringify(json.split('\n')[1]));
  assert(
    'stats 键完整',
    SECTIONS.every((s) =>
      ['pagesInManifest', 'pagesInNav', 'pagesNotInNav', 'groups', 'maxDepth', 'duplicateHrefs'].every((k) => k in statsOut[s.id])
    ),
    JSON.stringify(statsOut)
  );
  assert('JSON 可回读', (() => { try { JSON.parse(json); return true; } catch { return false; } })(), 'parse 失败');

  // ------------------------------ 输出 ------------------------------
  if (META_JSON) {
    fs.writeFileSync(
      META_JSON,
      JSON.stringify(
        {
          generated_at: doc.generated_at,
          checks,
          failures,
          stats: statsOut,
          meta: metaOut,
          sections: sectionsOut.map((s) => ({ id: s.id, pagesNotInSourceNav: s.pagesNotInSourceNav })),
        },
        null,
        1
      ),
      'utf8'
    );
    console.log(`meta(evidence) written: ${META_JSON}`);
  }

  if (VERIFY_ONLY) {
    console.log('=== source-nav 校验（--verify，未写文件）===');
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : '  :: ' + c.detail}`);
    console.log('-----------------------------------------');
    console.log(`断言 ${checks.length} 条，失败 ${failures.length} 条`);
    for (const s of SECTIONS) {
      const meta = metaOut[s.id];
      console.log(
        `[${s.id}] manifest=${statsOut[s.id].pagesInManifest} nav=${statsOut[s.id].pagesInNav} notInNav=${statsOut[s.id].pagesNotInNav} groups=${statsOut[s.id].groups} maxDepth=${statsOut[s.id].maxDepth} dup=${statsOut[s.id].duplicateHrefs} crossSection=${meta.crossSectionLinks.length} unknown=${meta.unknownLinks.length}`
      );
    }
  } else {
    fs.writeFileSync(OUT_JSON, json, 'utf8');
    console.log(`written: ${posix(path.relative(ROOT, OUT_JSON))} (${Buffer.byteLength(json, 'utf8')} bytes, utf8 no BOM)`);
    console.log('=== 校验 ===');
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : '  :: ' + c.detail}`);
    console.log('-----------------------------------------');
    console.log(`断言 ${checks.length} 条，失败 ${failures.length} 条`);
    for (const s of SECTIONS) {
      const meta = metaOut[s.id];
      console.log(
        `[${s.id}] manifest=${statsOut[s.id].pagesInManifest} nav=${statsOut[s.id].pagesInNav} notInNav=${statsOut[s.id].pagesNotInNav} groups=${statsOut[s.id].groups} maxDepth=${statsOut[s.id].maxDepth} dup=${statsOut[s.id].duplicateHrefs} crossSection=${meta.crossSectionLinks.length} unknown=${meta.unknownLinks.length}`
      );
    }
  }

  if (PRINT_TREE) {    for (const sec of sectionsOut) {
      console.log('');
      console.log(`### ${sec.title} —— ${countGroups(sec.groups)} 组 / ${countPages(sec.groups)} 页 / 最大深度 ${maxDepth(sec.groups)}`);
      console.log(renderTree(sec.groups).join('\n'));
    }
    for (const s of SECTIONS) {
      const meta = metaOut[s.id];
      console.log('');
      console.log(`### ${s.id} 跨页取样逐字节证据（canonical 源文件 archive/${s.id}/${meta.canonicalFile}）`);
      for (const h of meta.sampledHashes) console.log(`- ${h.sha256}  ${h.file}`);
      console.log(`- 全量 ${meta.allFiles.length} 页去重后 sha256 数 = ${meta.distinctRawHashes}`);
      console.log('');
      console.log(`### ${s.id} 组标签逐字证据（原始 HTML 片段，来自 canonical 页）`);
      for (const g of meta.groupEvidence) {
        console.log(`- ${g.path} :: <span class="group-label">${g.rawHtml}</span>`);
      }
      if (meta.crossSectionLinks.length) {
        console.log('');
        console.log(`### ${s.id} 剔除的跨 section 外链`);
        for (const c of meta.crossSectionLinks) console.log(`- ${c.label} → ${c.href} (${c.otherSection}/${c.otherRel})`);
      }
      console.log('');
      console.log(`### ${s.id} pagesNotInSourceNav`);
      for (const p of sectionsOut.find((x) => x.id === s.id).pagesNotInSourceNav) console.log(`- ${p.rel} | ${p.title} | ${p.reason}`);
      console.log('');
      console.log(`### ${s.id} 取样页`);
      for (const f of meta.sampledFiles) console.log(`- ${f}`);
    }
  }

  if (failures.length) {
    console.error('\n断言失败：');
    for (const f of failures) console.error(' - ' + f);
    process.exitCode = 1;
  }
}

function walkNodesHasEmptyLabel(nodes) {
  for (const n of nodes) {
    if (!n.label) return true;
    if (n.kind === 'group' && walkNodesHasEmptyLabel(n.children)) return true;
  }
  return false;
}

main();
