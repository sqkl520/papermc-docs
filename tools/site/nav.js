'use strict';
/**
 * nav.js — source-structure navigation model (主导航 = docs.papermc.io 自己的 Starlight 侧栏结构).
 *
 * Input : data/source-nav.json  (只读，由 tools/source-nav.js 产出)
 *         sections[] = { id, title, sourceHref, pageCount, groups[], pagesNotInSourceNav[] }
 *         groups[]   = 递归树，节点 { kind:'group', label, children[] } | { kind:'page', label, href, rel, title }
 *
 * Output: 供 layout.js / build-site.js 使用的“源结构主导航模型”：
 *         · 逐字保留上游分组标签与嵌套顺序（不新增、不重排、不改名）
 *         · 把 pagesNotInSourceNav 里的“组首页”按 rel ↔ 分组路径 的映射挂回对应分组
 *           （映射算法与 tools/source-nav.js 的 reasonForMissing 一致：目录前缀 → 逐段标签匹配）
 *         · 先序遍历（source-preorder）给出同 section 内的上一页/下一页顺序
 *         · 每页给出源结构面包屑（Paper › Development › API › Command API › Basics › Introduction）
 *
 * 本模块只看 source-nav.json + 传入的 pageByKey，不读归档、不写文件。
 */

const fs = require('fs');
const path = require('path');
const U = require('./util');

const SOURCE_NAV_REL = 'data/source-nav.json';

/** 上游分组标签的中文辅注（仅作 tooltip/浅色后缀，标签本身始终是上游英文原文） */
const GROUP_ZH = {
  'Administration': '服务端管理',
  'Development': '插件开发',
  'Contributing': '参与贡献',
  'Getting started': '入门',
  'How-to guides': '操作指南',
  'Reference': '参考手册',
  'Miscellaneous': '其他',
  'Configuration': '配置文件',
  'API': 'API',
  'Command API': '命令 API',
  'Component API': '文本组件 API',
  'Entity API': '实体 API',
  'Event API': '事件 API',
  'Inventories': '容器菜单',
  'Lifecycle API': '生命周期 API',
  'Basics': '基础',
  'Arguments': '参数',
};

function norm(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** aggressive label key, identical to tools/source-nav.js reasonForMissing() */
function labelKey(s) {
  return norm(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** archive rel ("dev/command-api/…" / "index") -> upstream href ("/paper/dev/command-api/…/") */
function relToHref(rel, sectionId) {
  const p = '/' + sectionId + '/';
  if (rel === 'index') return p;
  return p + rel.replace(/\/index$/, '') + '/';
}

/** 站点页面的相对路径：rel 直接展开（'index' -> '<section>/index.html'），与上游 URL 逐段一致 */
function pageUrl(sectionId, rel) {
  return sectionId + '/' + rel + '.html';
}

function pathKey(pathArr) {
  return pathArr.join(' > ');
}

function collectPageHrefs(node, out) {
  if (node.kind === 'group') {
    for (const c of node.children) collectPageHrefs(c, out);
  } else if (node.kind === 'page') {
    out.push(node.href);
  }
  return out;
}

/**
 * rel 的目录 -> 分组路径。两阶段（与 tools/source-nav.js 的 reasonForMissing 完全一致）：
 *   阶段 1：某组全部后代页面的 href 都以 `<section>/<dir>/` 开头 → 该组即此目录索引页的归属组
 *   阶段 2：按目录逐段与组标签匹配（处理 admin/getting-started 这类“组索引页不在自身目录下”的情况）
 */
function mapDirToGroup(tree, dir, sectionId) {
  const rootHref = '/' + sectionId + '/';
  const cands = [];
  (function walk(nodes, trail) {
    for (const n of nodes) {
      if (n.kind !== 'group') continue;
      const t = trail.concat(n.label);
      const hrefs = collectPageHrefs(n, []);
      if (hrefs.length && hrefs.every((h) => String(h).startsWith(rootHref + dir + '/'))) {
        cands.push({ path: t, count: hrefs.length, depth: t.length });
      }
      walk(n.children, t);
    }
  })(tree, []);
  if (cands.length) {
    cands.sort((a, b) => (b.count - a.count) || (a.depth - b.depth)
      || (a.path.join('>') < b.path.join('>') ? -1 : 1));
    return { path: cands[0].path, phase: 1 };
  }
  const segs = dir.split('/');
  let level = tree;
  const p = [];
  for (const seg of segs) {
    const k = labelKey(seg);
    const hit = level.filter((n) => n.kind === 'group').find((n) => {
      const kk = labelKey(n.label);
      return kk === k || kk.startsWith(k) || k.startsWith(kk);
    });
    if (!hit) break;
    p.push(hit.label);
    level = hit.children;
  }
  if (p.length === segs.length) return { path: p, phase: 2 };
  return null;
}

/** 「Administration > Getting started」→ ['Administration','Getting started']（reason 文本里的分组路径） */
function reasonPath(reason) {
  const m = /「(.+?)」/.exec(String(reason || ''));
  if (!m) return null;
  return m[1].split(/\s*>\s*/).map((s) => norm(s)).filter(Boolean);
}

function maxDepthOf(nodes, depth) {
  let max = 0;
  for (const n of nodes) {
    max = Math.max(max, depth);
    if (n.kind === 'group') max = Math.max(max, maxDepthOf(n.children, depth + 1));
  }
  return max;
}

function countGroupsOf(nodes) {
  let n = 0;
  for (const node of nodes) if (node.kind === 'group') n += 1 + countGroupsOf(node.children);
  return n;
}

function countPagesOf(nodes) {
  let n = 0;
  for (const node of nodes) n += node.kind === 'group' ? countPagesOf(node.children) : 1;
  return n;
}

/**
 * @param {{pageByKey: Map<string,object>, sections: Array<{id:string,title:string,sourceHref?:string}>}} opts
 */
function loadSourceNav(opts) {
  const warnings = [];
  const warn = (kind, message, extra) => warnings.push(Object.assign({ kind, message }, extra || {}));
  const abs = path.join(U.ROOT, SOURCE_NAV_REL);
  const out = {
    present: false, path: SOURCE_NAV_REL, sha256: null, generatedAt: null, method: null,
    sections: [], totals: {}, mapping: { checked: 0, mismatched: [], unattached: [] },
    coverage: { ok: false, problems: [] },
  };
  if (!fs.existsSync(abs)) {
    warn('source-nav-missing', '未找到 ' + SOURCE_NAV_REL + '，无法使用源结构主导航');
    return out;
  }
  const buf = fs.readFileSync(abs);
  out.sha256 = U.sha256(buf);
  let doc;
  try {
    doc = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    warn('source-nav-invalid', SOURCE_NAV_REL + ' 解析失败：' + e.message);
    return out;
  }
  out.present = true;
  out.generatedAt = doc.generated_at || null;
  out.method = doc.method || null;
  out.consistentAcrossPages = !!doc.consistent_across_pages;

  const sectionCfg = new Map((opts.sections || []).map((s) => [s.id, s]));
  const seenPageKeys = new Set();

  for (const raw of doc.sections || []) {
    const cfg = sectionCfg.get(raw.id) || { id: raw.id, title: raw.title || raw.id };
    const sec = {
      id: raw.id,
      title: raw.title || cfg.title || raw.id,
      sourceHref: raw.sourceHref || ('/' + raw.id + '/'),
      manifestPageCount: raw.pageCount || 0,
      tree: [],
      groupsByPath: new Map(),
      pagesInNav: 0,
      pagesNotInNav: 0,
      groupCount: 0,
      maxDepth: 0,
      rootRel: null,
      rootKey: null,
      rootTitle: null,
      extras: [],
      preorder: [],
      groupHomes: 0,
      statsFromSource: (doc.stats || {})[raw.id] || null,
    };

    // ---- 1. 深拷贝上游树，补导航元数据（标签/嵌套/顺序逐字不改） ----
    let gSeq = 0;
    const buildTree = (nodes, trail) => nodes.map((n) => {
      if (n.kind === 'group') {
        const p = trail.concat(n.label);
        gSeq += 1;
        const node = {
          kind: 'group', label: n.label,
          zh: GROUP_ZH[norm(n.label)] || '',
          path: p, key: raw.id + '::' + pathKey(p), id: 'nav-' + raw.id + '-g' + gSeq,
          depth: p.length, home: null, homeKey: null, homeTitle: null, pageCount: 0, children: [],
        };
        sec.groupsByPath.set(pathKey(p), node);
        node.children = buildTree(n.children || [], p, node);
        node.pageCount = countPagesOf(node.children);
        return node;
      }
      const rel = n.rel;
      const page = opts.pageByKey ? opts.pageByKey.get(raw.id + ':' + rel) : null;
      if (!page) {
        warn('source-nav-page-missing', raw.id + ': 源结构导航引用了不存在的页面 ' + rel);
      }
      seenPageKeys.add(raw.id + ':' + rel);
      sec.pagesInNav += 1;
      return {
        kind: 'page', label: n.label, href: n.href, rel, title: n.title,
        key: raw.id + ':' + rel, id: 'nav-' + raw.id + '-p' + (sec.pagesInNav),
        page, ancestors: [],
      };
    });
    sec.tree = buildTree(raw.groups || [], []);
    // 页节点的祖先链换成“分组对象”引用（面包屑 / 展开路径都要用标签与组首页）
    (function bindAncestors(nodes, trail) {
      for (const n of nodes) {
        if (n.kind === 'group') bindAncestors(n.children, trail.concat(n));
        else n.ancestors = trail.slice();
      }
    })(sec.tree, []);

    // ---- 2. pagesNotInSourceNav -> 分组首页 / 分区根页 ----
    for (const notIn of raw.pagesNotInSourceNav || []) {
      const rel = notIn.rel;
      const key = raw.id + ':' + rel;
      sec.pagesNotInNav += 1;
      if (seenPageKeys.has(key)) {
        warn('source-nav-duplicate', raw.id + ': ' + rel + ' 同时在树与 pagesNotInSourceNav 中');
      }
      const page = opts.pageByKey ? opts.pageByKey.get(key) : null;
      if (!page) warn('source-nav-page-missing', raw.id + ': pagesNotInSourceNav 引用了不存在的页面 ' + rel);
      const entry = { rel, key, title: notIn.title || rel, reason: notIn.reason || '', page };

      if (rel === 'index') {
        // 站点根 index 页：挂在 section 标题上
        sec.rootRel = rel;
        sec.rootKey = key;
        sec.rootTitle = entry.title;
        sec.rootPage = page || null;
        entry.scope = 'section';
        sec.extras.push(entry);
        continue;
      }
      const dir = /\/index$/.test(rel) ? rel.replace(/\/index$/, '') : null;
      const mapped = dir ? mapDirToGroup(sec.tree, dir, raw.id) : null;
      const fromReason = reasonPath(notIn.reason);
      if (mapped && fromReason) {
        out.mapping.checked += 1;
        if (pathKey(mapped.path) !== pathKey(fromReason)) {
          out.mapping.mismatched.push({ section: raw.id, rel, computed: pathKey(mapped.path), reason: pathKey(fromReason) });
        }
      }
      let targetPath = mapped ? mapped.path : null;
      const target = targetPath ? sec.groupsByPath.get(pathKey(targetPath)) : null;
      if (!target) {
        out.mapping.unattached.push({ section: raw.id, rel, title: entry.title, reason: notIn.reason || '' });
        warn('source-nav-unattached', raw.id + ': ' + rel + ' 无法按 rel ↔ 分组路径映射到任何分组，已挂在分区标题上');
        entry.scope = 'section';
        sec.extras.push(entry);
        continue;
      }
      if (target.home) {
        warn('source-nav-group-home-conflict', raw.id + ': 分组「' + pathKey(target.path) + '」已有首页 '
          + target.home + '，忽略 ' + rel);
        entry.scope = 'section';
        sec.extras.push(entry);
        continue;
      }
      target.home = rel;
      target.homeKey = key;
      target.homeTitle = entry.title;
      target.homePage = page || null;
      target.homePhase = mapped.phase;
      target.pageCount = countPagesOf(target.children) + 1;
      entry.scope = 'group';
      entry.group = target;
      sec.groupsByPath.set('home:' + pathKey(target.path), entry);
    }

    // ---- 3. 统计 ----
    sec.groupCount = countGroupsOf(sec.tree);
    sec.maxDepth = maxDepthOf(sec.tree, 1);
    sec.groupHomes = sec.groupsByPath.size
      ? [...sec.groupsByPath.values()].filter((n) => n && n.home).length : 0;

    // ---- 4. 先序遍历：section 根页 → 组（有首页则先首页）→ 子节点 ----
    const pre = [];
    if (sec.rootKey) pre.push({ key: sec.rootKey, rel: sec.rootRel, title: sec.rootTitle, kind: 'section-root' });
    (function walk(nodes) {
      for (const n of nodes) {
        if (n.kind === 'group') {
          if (n.homeKey) pre.push({ key: n.homeKey, rel: n.home, title: n.homeTitle, kind: 'group-home', group: n });
          walk(n.children);
        } else {
          pre.push({ key: n.key, rel: n.rel, title: n.title, kind: 'page', node: n });
        }
      }
    })(sec.tree);
    sec.preorder = pre;
    pre.forEach((e, i) => {
      e.index = i + 1;
      e.total = pre.length;
      e.prevKey = i > 0 ? pre[i - 1].key : null;
      e.nextKey = i < pre.length - 1 ? pre[i + 1].key : null;
    });
    sec.preorderByKey = new Map(pre.map((e) => [e.key, e]));

    // ---- 5. 每页导航元数据（面包屑 / 源结构路径 / 祖先分组） ----
    sec.navOf = new Map();
    sec.navForRel = new Map();
    const annotate = (spec) => {
      const pre = sec.preorderByKey.get(spec.key) || {};
      const ancestors = spec.ancestors || [];
      const crumbs = [{ label: sec.title, href: 'sections/' + sec.id + '.html' }];
      const pathParts = [sec.title];
      for (const g of ancestors) {
        crumbs.push({ label: g.label, zh: g.zh || '', href: g.home ? pageUrl(sec.id, g.home) : null, group: true });
        pathParts.push(g.label);
      }
      if (spec.isGroupHome) {
        // 组首页自身：末级面包屑就是这个分组，不再重复链接到当前页
        const last = crumbs[crumbs.length - 1];
        if (last && last.group && last.label === spec.label) last.href = null;
      } else {
        crumbs.push({ label: spec.label, href: null });
        pathParts.push(spec.label);
      }
      const meta = {
        key: spec.key, label: spec.label, title: spec.title, rel: spec.rel,
        groupPath: ancestors.map((g) => g.label).join(' > '),
        groupPathParts: ancestors.map((g) => g.label),
        groupKeys: ancestors.map((g) => g.key),
        pathParts, pathText: pathParts.join(' › '), crumbs,
        isGroupHome: !!spec.isGroupHome,
        isSectionRoot: !!spec.isSectionRoot,
        group: spec.group || null,
        index: pre.index || 0, total: pre.total || 0,
        prevKey: pre.prevKey || null, nextKey: pre.nextKey || null,
        inNav: !spec.isGroupHome && !spec.isSectionRoot,
      };
      sec.navOf.set(spec.key, meta);
      sec.navForRel.set(spec.rel, meta);
      return meta;
    };
    for (const e of sec.extras) {
      annotate({
        key: e.key, rel: e.rel, label: e.title, title: e.title, ancestors: [],
        isSectionRoot: e.rel === 'index', inNav: false,
      });
    }
    (function walk(nodes, trail) {
      for (const n of nodes) {
        if (n.kind === 'group') {
          const t = trail.concat(n);
          if (n.homeKey) {
            annotate({
              key: n.homeKey, rel: n.home, label: n.label, title: n.homeTitle,
              ancestors: t, isGroupHome: true, group: n,
            });
          }
          walk(n.children, t);
        } else {
          annotate({
            key: n.key, rel: n.rel, label: n.label, title: n.title, ancestors: n.ancestors,
          });
        }
      }
    })(sec.tree, []);

    // ---- 6. 覆盖校验 ----
    const relsOnDisk = [];
    for (const [k] of opts.pageByKey || []) {
      if (k.startsWith(raw.id + ':')) relsOnDisk.push(k.slice(raw.id.length + 1));
    }
    const covered = new Set(sec.preorder.map((e) => e.rel));
    const missing = relsOnDisk.filter((r) => !covered.has(r));
    const extra = [...covered].filter((r) => !relsOnDisk.includes(r));
    const dupes = sec.preorder.map((e) => e.rel).filter((r, i, a) => a.indexOf(r) !== i);
    const st = sec.statsFromSource || {};
    sec.coverage = {
      diskPages: relsOnDisk.length,
      manifestPageCount: sec.manifestPageCount,
      preorderPages: sec.preorder.length,
      pagesInNav: sec.pagesInNav,
      pagesNotInNav: sec.pagesNotInNav,
      missingFromNav: missing,
      extraInNav: extra,
      duplicates: [...new Set(dupes)],
      statsMatch: {
        groups: st.groups === undefined ? null : st.groups === sec.groupCount,
        maxDepth: st.maxDepth === undefined ? null : st.maxDepth === sec.maxDepth,
        pagesInNav: st.pagesInNav === undefined ? null : st.pagesInNav === sec.pagesInNav,
        pagesNotInNav: st.pagesNotInNav === undefined ? null : st.pagesNotInNav === sec.pagesNotInNav,
      },
    };
    const covOk = missing.length === 0 && extra.length === 0 && dupes.length === 0
      && sec.preorder.length === relsOnDisk.length
      && sec.preorder.length === sec.manifestPageCount
      && sec.pagesInNav + sec.pagesNotInNav === sec.manifestPageCount;
    sec.coverage.ok = covOk;
    if (!covOk) {
      out.coverage.problems.push(raw.id + ': disk=' + relsOnDisk.length + ' preorder=' + sec.preorder.length
        + ' manifest=' + sec.manifestPageCount + ' nav=' + sec.pagesInNav + ' notInNav=' + sec.pagesNotInNav
        + ' missing=' + missing.length + ' extra=' + extra.length + ' dup=' + dupes.length);
    }
    out.sections.push(sec);
    out.totals[raw.id] = {
      groups: sec.groupCount, maxDepth: sec.maxDepth,
      pagesInNav: sec.pagesInNav, pagesNotInNav: sec.pagesNotInNav,
      preorderPages: sec.preorder.length, groupHomes: sec.groupHomes,
      sourceHref: sec.sourceHref,
    };
  }

  out.coverage.ok = out.coverage.problems.length === 0
    && out.sections.every((s) => s.coverage.ok);
  out.pageById = new Map();
  for (const sec of out.sections) {
    for (const [key, meta] of sec.navOf) out.pageById.set(key, Object.assign({ section: sec.id }, meta));
  }
  // 全部页面（含未接入导航的，理论上不该有）都能查到
  if (opts.pageByKey) {
    for (const key of opts.pageByKey.keys()) {
      if (!out.pageById.has(key)) {
        warn('source-nav-page-uncovered', key + ' 不在源结构导航模型内');
      }
    }
  }
  out.warnings = warnings;
  out.lookup = (sectionId, rel) => {
    const sec = out.sections.find((s) => s.id === sectionId);
    if (!sec) return null;
    return sec.navForRel.get(rel) || null;
  };
  out.sectionById = new Map(out.sections.map((s) => [s.id, s]));
  return out;
}

module.exports = {
  loadSourceNav, relToHref, pageUrl, pathKey, GROUP_ZH, SOURCE_NAV_REL,
  mapDirToGroup, reasonPath, labelKey,
};
