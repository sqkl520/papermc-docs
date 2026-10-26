'use strict';
/**
 * layout.js — HTML shells: page frame (topbar / sidebar / article / TOC / footer),
 * overview pages (landing page, all-pages, sections, categories, snapshots).
 *
 * 站点根 = 仓库根（GitHub Pages project pages：https://sqkl520.github.io/papermc-docs/）。
 * 页面产物路径 = rel 直接展开：`paper/dev/project-setup/index.html`，与上游 URL 逐段一致。
 *
 * 主导航 = docs.papermc.io 自己的源侧栏结构（data/source-nav.json，经 site/nav.js 建模）：
 *   · 侧栏逐字渲染上游分组标签与嵌套顺序，Paper / Velocity / Folia 三个 section 并列
 *   · 组标题可点：pagesNotInSourceNav 的“组首页”挂在对应分组上
 *   · 面包屑 = 源结构路径（Paper › Development › API › Command API › Basics › Introduction）
 *   · 上一页 / 下一页 = 同 section 内的源结构先序遍历
 *   · 我自建的 17 个中文分类降级为侧栏底部的「按主题浏览（自定义）」折叠区块
 *
 * Every internal URL is built as `prefix + <site-relative path>`, where `prefix` is the
 * relative path from the current document's directory back to the site root. That keeps
 * all links relative, so file:// double-click works with no server.
 */

const path = require('path');
const U = require('./util');
const NAV = require('./nav');

const SITE_TITLE = 'PaperMC 文档库';
const SITE_TAGLINE = 'docs.papermc.io（Paper + Velocity + Folia）离线镜像 · 与上游 URL 逐段一致的静态文档站';
/* R3-1：H1 下的一行任务导向副标题。原两段开发自述（"N 个页面完全离线可用…
   直接双击 HTML 也能用"）讲的是镜像保真度，属维护者信息，已移入页脚。 */
const HERO_LEDE = '给服主：装插件、迁移、升级、排障。给开发者：插件 API、事件、命令。';
/* R3-1（cr2-landing §5 S2）：首屏必须有 ≥6 个具体文档链接 —— 原来首屏
   通向文档的链接是 0 个。这四条是服主最高频的四个任务，href 均已在构建期
   用 Test-Path 验证存在（缺任一条则整块不渲染，避免死链）。 */
const HOST_PATHS = [
  { href: 'paper/adding-plugins/index.html', title: '装插件', desc: '怎么找、怎么装、装完不生效怎么查' },
  { href: 'paper/migration/index.html', title: '迁移', desc: '从原版 / Spigot / CraftBukkit 搬过来' },
  { href: 'paper/updating/index.html', title: '升级', desc: '更新 Paper 与插件，避免踩坑' },
  { href: 'paper/basic-troubleshooting/index.html', title: '排障', desc: '服务端起不来、卡顿、崩溃怎么查' },
];
/** 公网部署地址（project pages）；canonical / sitemap / robots 里使用 */
const PUBLIC_BASE = 'https://sqkl520.github.io/papermc-docs/';
/** 落地页分区入口卡片的中文标题（与上游分区一一对应） */
const SECTION_CARD_TITLE = {
  paper: 'Paper 服务端文档',
  velocity: 'Velocity 代理端文档',
  folia: 'Folia 区域化服务端文档',
};
const REPO_LICENSE_FALLBACK = 'THIRD-PARTY-NOTICES.md';
/** 仓库根的实际许可/来源声明文件名：构建期探测（治理文件可能被改名），兜底用 fallback */
let REPO_LICENSE = REPO_LICENSE_FALLBACK;
function setLicenseFile(name) { if (name) REPO_LICENSE = name; }
/** R3-1：供 build-site.js 取当前许可文件名（用于落地页「服主四条路」的存在性白名单） */
function getLicenseFile() { return REPO_LICENSE; }

/** 站点相对 HTML 路径 -> 公网绝对 URL（`paper/index.html` -> …/paper/） */
function publicUrl(siteRelHtml) {
  let rel = String(siteRelHtml || '').split(path.sep).join('/').replace(/^\.?\//, '');
  if (rel === 'index.html') rel = '';
  else if (/\/index\.html$/.test(rel)) rel = rel.replace(/index\.html$/, '');
  else if (/\.html$/.test(rel)) rel = rel; // 扁平页（all-pages.html / snapshots.html / 404.html）保持文件名
  return PUBLIC_BASE + rel;
}

function libUrl(prefix, rel) {
  return prefix + rel;
}

function pageHref(prefix, sectionId, rel) {
  return prefix + NAV.pageUrl(sectionId, rel);
}

/**
 * 顶栏：站点名 + 分区切换 + 页面动作（查看原文 ↗ / 页面源 Markdown）+ 搜索 + 主题切换。
 * opts: { sections:[{id,title}], activeSectionId, page }
 */
function topbar(prefix, pageTitle, opts) {
  const o = opts || {};
  let parts = '<button class="tbtn sidebar-toggle" id="nav-toggle" type="button" aria-label="切换侧栏导航"'
    + ' aria-controls="sidebar" aria-expanded="false">☰</button>'
    + '<a class="brand" href="' + libUrl(prefix, 'index.html') + '">'
    + '<span class="brand-dot" aria-hidden="true"></span><span class="brand-name">' + U.escapeHtml(SITE_TITLE) + '</span></a>';
  const secs = o.sections || [];
  if (secs.length) {
    parts += '<nav class="sec-switch" aria-label="分区切换">'
      + secs.map((s) => '<a href="' + U.attr(prefix + s.id + '/index.html') + '"'
        + (o.activeSectionId === s.id ? ' class="on" aria-current="true"' : '')
        + '>' + U.escapeHtml(s.title) + '</a>').join('')
      + '</nav>';
  }
  parts += '<span class="spacer"></span>';
  if (o.page) {
    if (o.page.sourceUrl) {
      parts += '<a class="tbtn external" href="' + U.attr(o.page.sourceUrl) + '" target="_blank" rel="noopener"'
        + ' title="上游原文：' + U.attr(o.page.sourceUrl) + '">查看原文 ↗</a>';
    }
    const src = (o.page.snapshotLinks || {}).source || (o.page.snapshotLinks || {}).markdown;
    if (src) {
      parts += '<a class="tbtn page-source" href="' + U.attr(src) + '" title="页面源 Markdown">页面源 Markdown</a>';
    }
  }
  parts += '<button class="tbtn" type="button" data-open-search title="搜索全部页面">'
    + '<span aria-hidden="true">🔍</span><span class="lbl">搜索</span><kbd>Ctrl</kbd><kbd>K</kbd></button>'
    + '<button class="tbtn" id="theme-toggle" type="button" title="切换主题" aria-label="切换主题：跟随系统">'
    + '<span aria-hidden="true" class="theme-icon">🖥</span><span class="lbl">跟随系统</span></button>';
  return '<header class="topbar">' + parts + '</header>';
}

function searchDialog() {
  return '<dialog class="search-dialog" id="search-dialog" aria-label="站内搜索">'
    + '<div class="search-box"><span aria-hidden="true">🔍</span>'
    + '<input id="search-input" type="search" placeholder="搜索页面标题、标签、小节或正文…  (中文子串 / 英文前缀)" autocomplete="off" spellcheck="false">'
    + '<span class="search-hint"><kbd>Esc</kbd></span></div>'
    + '<ul class="search-results" id="search-results"></ul>'
    + '<div class="sr-count" id="search-count"></div>'
    + '</dialog>';
}

function lightbox() {
  return '<dialog class="lightbox" id="lightbox"><button class="lb-close" type="button" aria-label="关闭">✕</button>'
    + '<div><img alt=""></div><div class="lb-cap"></div></dialog>';
}

// ---------------------------------------------------------------------------
// sidebar — 源结构主导航
// ---------------------------------------------------------------------------

/** 侧栏里一条页面链接；data-search 同时含标题 / 中文摘要 / 源结构组路径（供过滤框使用）。
 *  批 1：badge（「组首页」/「根页」标签）视觉上不占行，改为并入 title —— 信息不丢，只是不再常显。 */
function sidePageItem(opts) {
  const { href, label, search, active, badge } = opts;
  const title = [opts.title, badge].filter(Boolean).join(' · ');
  return '<li><a href="' + U.attr(href) + '"'
    + (opts.cls ? ' class="' + U.attr(opts.cls) + '"' : '')
    + ' data-search="' + U.attr(search) + '"'
    + (active ? ' aria-current="page"' : '')
    + (title ? ' title="' + U.attr(title) + '"' : '')
    + '><span class="ttl">' + U.escapeHtml(label) + '</span>'
    + (badge ? '<span class="tag">' + U.escapeHtml(badge) + '</span>' : '')
    + '</a></li>';
}

function sideSearchHay(page, label, groupPath, sectionTitle) {
  const p = page || {};
  return [label, p.title && p.title !== label ? p.title : '', p.summary || p.description || '', groupPath || '', sectionTitle || '']
    .filter(Boolean).join(' ');
}

function sideNodesHtml(nodes, prefix, sec, ctx) {
  let html = '';
  for (const n of nodes) {
    if (n.kind === 'group') {
      // 用 <li> 包住 <details>：侧栏保持合法列表结构（分组节点本身可折叠）
      html += '<li class="nav-group-item">' + sideGroupHtml(n, prefix, sec, ctx) + '</li>';
      continue;
    }
    const meta = sec.navForRel.get(n.rel);
    const hay = sideSearchHay(n.page, n.label, meta ? meta.groupPath : '', sec.title);
    html += sidePageItem({
      href: pageHref(prefix, sec.id, n.rel), label: n.label, search: hay,
      active: ctx.activeRel === n.rel,
      cls: ctx.activeRel === n.rel ? 'active' : '',
      title: n.page && n.page.summary ? n.page.summary : '',
    });
  }
  return html;
}

function sideGroupHtml(g, prefix, sec, ctx) {
  /* ══════════ 批 5a（5a）：折叠规则 open ⇔ (depth ≠ 4) ∨ 含当前页 ══════════
   *
   * 为什么不是字面的 `depth ≠ 3`（上游口径）：
   *   上游侧栏的 `ulDepth` 到 3 是最深组层，所以"第 3 层关"= "最深一层关"。
   *   我们的树是 **5 层**（d1×6 / d2×14 / d3×8 / d4×3），最深**组**层是 **4**
   *   （`Basics` / `Arguments` / `Miscellaneous`，三个全在 Paper 的 `Command API` 里）。
   *   → 对齐的是**思想**（最深一层默认关、其余开），不是字面数字。
   *   若照抄 depth≠3：Paper 的 7 个 d3 组会全关（用户要多点 7 次），
   *   而 3 个 d4 组会「open 但父 d3 关着」→ 开了也看不见，逻辑上无意义。
   *
   * 另一半条件 `∨ 含当前页` 是**不可省的**（红队 A 的翻车 #1）：
   *   上游 2,360 样本的真判定式是 `(ulDepth≠3) ∨ 含当前页`，误判 0；
   *   只用 depth 而丢掉"含当前页"会误判 44/2360，且**恰好折掉当前页所在组**
   *   —— 用户看不到自己所在的章节，是最刺眼的回归。
   *   我们的 `pdc` / `dialogs` / `velocity/tuning` / `world-configuration`
   *   当前页都在 depth-3 组内，丢掉这半个条件就会翻车。
   *
   * 实测收益（`tools/b5x-fold.js` 用 data/source-nav.json 反事实模拟）：
   *   Paper 树可见行 min/med/max：现状 4/23/34 → 本规则 **87/87/95**
   *   展开组数（无当前页时）：0 → **18**（总 20 组）
   *   Velocity：7/9/11 → 32/32/32（全展开，因它最深组层只有 2）
   *
   * 状态来源：`build-site.js:752` 的 `p.navGroupKeys = meta.groupKeys`（当前页祖先链），
   * `nav.js:353` 的 `groupKeys: ancestors.map((g) => g.key)`。
   * `g.depth` 来自 `nav.js:214` 的 `depth: p.length`（组嵌套深度，从 1 起）。
   */
  const isAncestorOfCurrentPage = ctx.openGroupKeys.has(g.key);
  const byDepth = g.depth !== 4;                       // 最深**组**层（=4）默认关，其余开
  const open = (byDepth || isAncestorOfCurrentPage) ? ' open' : '';
  const homeMeta = g.homeKey ? sec.navForRel.get(g.home) : null;
  const homeHref = g.homeKey ? pageHref(prefix, sec.id, g.home) : '';
  const homeHay = sideSearchHay(g.homePage, g.label, (homeMeta && homeMeta.groupPath) || g.path.join(' > '), sec.title);
  /* 批 1（侧栏行内降噪）：一个组标题行原来挤了 5 件东西 —— 组名 + 中文名 + 「组首页 →」pill
     + 页数徽章 + 折叠三角。现在中文名与页数改由**本行的 title / aria-label 承载**，
     视觉行只剩「组名 + 折叠三角」。
     aria-label 用全量（组名 + 中文名 + 页数 + 组首页目标），读屏反而比改前多得到信息；
     可见文本「Administration」是其子串，满足 WCAG 2.5.3（label in name）。
     注意：<summary> 上的 aria-label 会覆盖子元素的无障碍名，故 pill 必须重述自身名字，
     否则读屏把它读成「Administration 服务端管理 · 29 页」——见下方 pill 的 aria-label。 */
  const groupTitle = [g.label, g.zh, (g.pageCount || 0) + ' 页'].filter(Boolean).join(' · ')
    + (g.homeKey ? ' · 组首页：' + (g.homeTitle || g.label) : '');
  let html = '<details class="side-group" data-nav-key="' + U.attr(g.key) + '"'
    + ' data-nav-path="' + U.attr(g.path.join(' > ')) + '"' + open + '>'
    + '<summary class="side-group-title" title="' + U.attr(groupTitle) + '"'
    + ' aria-label="' + U.attr(groupTitle) + '">'
    + '<span class="grp-name">' + U.escapeHtml(g.label) + '</span>'
    + (g.zh ? '<span class="grp-zh">' + U.escapeHtml(g.zh) + '</span>' : '')
    + (g.homeKey
      ? '<a class="side-home" href="' + U.attr(homeHref) + '" data-search="' + U.attr(homeHay) + '"'
        + ' aria-label="组首页：' + U.attr(g.homeTitle || g.label) + '"'
        + ' title="组首页：' + U.attr(g.homeTitle || g.label) + '（上游仅渲染组标题，不输出 &lt;a&gt;）">组首页 →</a>'
      : '')
    + '<span class="side-count" aria-hidden="true">' + (g.pageCount || 0) + '</span>'
    + '</summary><ul>';
  if (g.homeKey) {
    html += sidePageItem({
      href: homeHref, label: g.homeTitle || g.label, search: homeHay,
      active: ctx.activeRel === g.home, cls: 'nav-home',
      badge: '组首页', title: '分组「' + g.path.join(' > ') + '」的索引页',
    });
  }
  html += sideNodesHtml(g.children, prefix, sec, ctx);
  html += '</ul></details>';
  return html;
}

/** left sidebar: 源结构树（Paper / Velocity 并列）+ 抽屉内「本页目录」+ 底部「按主题浏览（自定义）」 */
function sidebarHtml(site, prefix, active, toc) {
  const a = active || {};
  const nav = site.sourceNav;
  /* 批 1：这里原有 <div class="side-legend">主导航 = 上游 docs.papermc.io 侧栏结构</div>。
     它是**元信息**（解释这一列是什么），不是导航目标，也不帮助决定点哪一条 ——
     实测 11.2px、首屏占 1 行且与紧随其后的「过滤框 + 分区标题」语义重复。
     批 1 直接删除（连同 .side-legend 的 CSS 规则），侧栏首屏少 1 个非条目元素。 */
  let html = '<nav class="sidebar" id="sidebar" data-nav-drawer aria-label="文档导航">'
    + '<label class="visually-hidden" for="side-filter" hidden>过滤页面</label>'
    + '<input class="side-filter" id="side-filter" type="search" placeholder="过滤：标题 / 摘要 / 源结构路径…" autocomplete="off">';
  // 分区切换：≤1023.98px 顶栏那份隐藏，这里放进抽屉（契约 v2 §3）；data-search 保证侧栏过滤可命中
  if (nav && nav.sections.length) {
    html += '<div class="side-secs" role="group" aria-label="分区切换">'
      + nav.sections.map((s) => '<a href="' + U.attr(prefix + s.id + '/index.html') + '"'
        + (a.sectionId === s.id ? ' class="on" aria-current="true"' : '')
        + ' data-search="' + U.attr([s.title, '分区切换', '分区入口'].join(' ')) + '">'
        + U.escapeHtml(s.title) + '</a>').join('')
      + '</div>';
  }
  // 抽屉内「本页目录」（红队 F3：<1024px 也要有真目录；与右栏同一 toc 数组）
  html += drawerTocHtml(toc);
  if (nav && nav.sections.length) {
    for (const sec of nav.sections) {
      const open = !a.sectionId || a.sectionId === sec.id;
      html += '<details class="side-sec" data-section="' + U.attr(sec.id) + '"' + (open ? ' open' : '') + '>'
        + '<summary class="side-section-title" title="' + U.attr(sec.title + ' · ' + sec.preorder.length + ' 页') + '"'
        + ' aria-label="' + U.attr(sec.title + ' · ' + sec.preorder.length + ' 页') + '">'
        + '<span class="sec-name">' + U.escapeHtml(sec.title) + '</span>'
        + '<span class="side-count" aria-hidden="true">' + sec.preorder.length + '</span></summary>'
        + '<div class="side-sec-body">';
      if (sec.rootKey) {
        const root = sec.navForRel.get(sec.rootRel);
        html += '<ul class="side-root">' + sidePageItem({
          href: pageHref(prefix, sec.id, sec.rootRel), label: root ? root.label : sec.rootTitle,
          search: sideSearchHay(sec.rootPage, sec.rootTitle, '', sec.title),
          active: a.rel === sec.rootRel, cls: 'nav-home', badge: '根页',
          title: '分区根页（上游 Starlight 未在侧栏单独列出）',
        }) + '</ul>';
      }
      html += '<ul>'
        + sideNodesHtml(sec.tree, prefix, sec, {
          activeRel: a.sectionId === sec.id ? a.rel : null,
          openGroupKeys: new Set(a.sectionId === sec.id ? (a.navGroupKeys || []) : []),
        })
        + '</ul></div></details>';
    }
  } else {
    /* 批 1：这一分支（无 sourceNav 时的降级导航）也把页数从视觉行移进 title。 */
    for (const sec of site.sections) {
      html += '<div class="side-section" data-section="' + U.attr(sec.id) + '">'
        + '<a class="side-section-title" href="' + libUrl(prefix, 'sections/' + sec.id + '.html') + '"'
        + ' title="' + U.attr(sec.title + ' · ' + sec.pageCount + ' 页') + '">'
        + U.escapeHtml(sec.title) + '<span class="side-count" aria-hidden="true">' + sec.pageCount + '</span></a></div>';
    }
  }
  // 自建中文分类：降级为次要入口（折叠）
  const cats = site.categories || [];
  if (cats.length) {
    /* 批 1：主题块的「N」与分类条目上的分区名 tag 同样非常显 —— 数字进 summary 的 title/aria-label，
       分区名进条目 <a> 的 title。**结构一行未动**：<details class="side-cat"> 与 <summary> 保留，
       verify-site.js:1044 的 /class="side-cat"/ 硬断言照旧命中。 */
    html += '<details class="side-cat" data-cat="taxonomy"' + (a.categoryId ? ' open' : '') + '>'
      + '<summary title="按主题浏览（自定义）· ' + U.attr(String(cats.length)) + ' 类"'
      + ' aria-label="按主题浏览（自定义）· ' + U.attr(String(cats.length)) + ' 类">按主题浏览（自定义）'
      + '<span class="side-count" aria-hidden="true">' + cats.length + '</span></summary><ul>';
    for (const cat of cats) {
      const sec = site.sectionById.get(cat.section);
      html += '<li><a href="' + libUrl(prefix, 'categories/' + cat.id + '.html') + '"'
        + ' data-search="' + U.attr([cat.title, cat.description || '', (sec && sec.title) || '', '按主题浏览'].join(' ')) + '"'
        + (a.categoryId === cat.id ? ' class="active" aria-current="page"' : '')
        + (sec ? ' title="' + U.attr(cat.title + ' · ' + sec.title) + '"' : '')
        + '><span class="ttl">' + U.escapeHtml(cat.title) + '</span>'
        + '<span class="tag">' + U.escapeHtml(sec ? sec.title : cat.section) + '</span></a></li>';
    }
    html += '</ul></details>';
  }
  html += '<div class="side-empty" id="side-empty">没有匹配的页面</div>';
  const sideTotal = (nav && nav.sections.length)
    ? nav.sections.reduce((n, s) => n + s.preorder.length, 0)
    : (site.sections || []).reduce((n, s) => n + (s.pageCount || 0), 0);
  html += '<div class="side-section">'
    + '<a class="side-section-title" href="' + libUrl(prefix, 'index.html') + '">文档库首页</a>'
    + '<a class="side-section-title" href="' + libUrl(prefix, 'all-pages.html') + '">全部文章（' + sideTotal + '）</a>'
    + '<a class="side-section-title" href="' + libUrl(prefix, 'snapshots.html') + '">原始快照索引</a></div>';
  html += '</nav>';
  return html;
}

/** right-hand "本页目录"; returns '' when the page has no h2-h4 headings.
 *  <details> 形态：≥1025px 与改前一致地作为常驻右栏（标题行看起来就是原来的 toc-title），
 *  <1025px 由 CSS 提到正文顶部成为可折叠的「本页目录」（红队 F3 / 契约 A4：移动端要有真目录）。
 *  默认【折叠】（P0-1）：390 档 24 项目录展开时高 1173px > 视口 844，H1 被推到 y=1317（1.56 屏）。
 *  折叠后 H1 ≈202。桌面档由 site.js 的 matchMedia('(min-width:1025px)') 强制展开，右栏不受影响。
 *
 *  D5（红队）：HTML 里**保留 open** 作无 JS 降级 —— 否则禁用 JS 时桌面右栏是空白（实测
 *  83 条链接高度全为 0）。真正的"默认折叠"由 site.js 在窄屏首帧移除 open 实现；
 *  无 JS 的窄屏用户会看到展开列表，但那仍比"什么都没有"更可用。 */
function tocHtml(toc) {
  if (!toc || !toc.length) return '';
  let html = '<aside class="toc-side" id="page-toc" data-page-toc aria-label="本页目录">'
    + '<details class="toc-fold" open><summary class="toc-title">本页目录<span class="toc-count">' + toc.length + '</span></summary><ol>';
  for (const h of toc) {
    html += '<li class="lvl-' + h.level + '"><a href="#' + U.attr(h.id) + '">' + U.escapeHtml(h.text) + '</a></li>';
  }
  html += '</ol></details></aside>';
  return html;
}

/** 抽屉内的「本页目录」（同一 toc 数组；≤1024px 显示，默认折叠以免撑长抽屉）。
 *  批 1：条目数从视觉行移进 title/aria-label（`.side-count` 已统一 display:none）。 */
function drawerTocHtml(toc) {
  if (!toc || !toc.length) return '';
  let html = '<details class="side-toc page-toc" id="drawer-toc" data-page-toc data-toc data-drawer-toc>'
    + '<summary class="side-toc-title" title="本页目录 · ' + U.attr(String(toc.length)) + ' 项"'
    + ' aria-label="本页目录 · ' + U.attr(String(toc.length)) + ' 项">本页目录'
    + '<span class="side-count" aria-hidden="true">' + toc.length + '</span></summary><ol>';
  for (const h of toc) {
    html += '<li class="lvl-' + h.level + '"><a href="#' + U.attr(h.id) + '">' + U.escapeHtml(h.text) + '</a></li>';
  }
  html += '</ol></details>';
  return html;
}

/** 面包屑：总览 › <分区> › 源结构分组 … › 当前页 */
function crumbsHtml(items) {
  const parts = items.map((it, i) => {
    const sep = i ? '<span class="sep">/</span>' : '';
    const zh = it.zh ? '<span class="crumb-zh">' + U.escapeHtml(it.zh) + '</span>' : '';
    return sep + (it.href ? '<a href="' + U.attr(it.href) + '">' + U.escapeHtml(it.label) + '</a>'
      : '<span>' + U.escapeHtml(it.label) + '</span>') + zh;
  });
  return '<nav class="crumbs" aria-label="面包屑">' + parts.join('') + '</nav>';
}

function pagerHtml(prev, next, prefix) {
  if (!prev && !next) return '';
  let html = '<nav class="pager" aria-label="上一页 / 下一页">';
  html += prev
    ? '<a class="prev" href="' + U.attr(prefix + prev.section + '/' + prev.rel + '.html') + '">'
      + '<span class="dir">← 上一页</span><span class="ttl">' + U.escapeHtml(prev.title) + '</span>'
      + (prev.navPathText ? '<span class="pth">' + U.escapeHtml(prev.navPathText) + '</span>' : '')
      + '</a>'
    : '<span></span>';
  html += next
    ? '<a class="next" href="' + U.attr(prefix + next.section + '/' + next.rel + '.html') + '">'
      + '<span class="dir">下一页 →</span><span class="ttl">' + U.escapeHtml(next.title) + '</span>'
      + (next.navPathText ? '<span class="pth">' + U.escapeHtml(next.navPathText) + '</span>' : '')
      + '</a>'
    : '<span></span>';
  return html + '</nav>';
}

function footerHtml(page) {
  const bits = [];
  bits.push('<span>内容版权归 <b>PaperMC</b> 及其贡献者所有（BSD-2-Clause）'
    + ' · <a href="' + U.attr(licenseHref(page)) + '">' + REPO_LICENSE + '</a></span>');
  if (page.url) {
    bits.push('<a class="external" href="' + U.attr(page.url) + '" target="_blank" rel="noopener">来源 URL ' + U.escapeHtml(page.url) + '</a>');
  }
  const snap = page.snapshotLinks || {};
  if (snap.source) bits.push('<a href="' + U.attr(snap.source) + '">页面源 Markdown（source/）</a>');
  if (snap.markdown) bits.push('<a href="' + U.attr(snap.markdown) + '">转换后 Markdown（markdown/）</a>');
  if (snap.html) bits.push('<a href="' + U.attr(snap.html) + '">原始 HTML 快照</a>');
  if (page.fetchedAt) bits.push('<span>抓取时间 ' + U.escapeHtml(page.fetchedAt) + '</span>');
  if (page.sha256) bits.push('<span>内容 SHA-256 <code class="sha">' + U.escapeHtml(page.sha256) + '</code></span>');
  if (page.markdownBytes) bits.push('<span>Markdown ' + page.markdownBytes + ' B</span>');
  bits.push('<span>本站由 tools/build-site.js 离线生成</span>');
  return '<footer class="page-footer">' + bits.join('') + '</footer>';
}

/** 仓库根许可文件相对当前页面的路径（页脚每页都要能点开） */
function licenseHref(page) {
  const prefix = page && page.prefix ? page.prefix : '';
  return prefix + REPO_LICENSE;
}

function head(prefix, title, description, canonical) {
  return '<!DOCTYPE html>\n<html lang="zh-CN" data-theme="auto">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">\n'
    + '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">\n'
    + '<meta name="theme-color" content="#14161a" media="(prefers-color-scheme: dark)">\n'
    + '<title>' + U.escapeText(title) + '</title>\n'
    + (description ? '<meta name="description" content="' + U.attr(description) + '">\n' : '')
    + (canonical ? '<link rel="canonical" href="' + U.attr(canonical) + '">\n' : '')
    + '<meta name="generator" content="papermc-docs offline library">\n'
    + '<link rel="icon" href="' + libUrl(prefix, 'assets/favicon.svg') + '" type="image/svg+xml">\n'
    + '<link rel="stylesheet" href="' + libUrl(prefix, 'assets/site.css') + '">\n'
    + '<script>(function(){try{var t=localStorage.getItem("lcb-theme")||"auto";document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>\n'
    // 搜索索引（~800 KB）首屏不加载：assets/site.js 只在首次搜索交互（聚焦搜索框 / 点搜索按钮 / 首次输入）时注入（契约 v2 F1；不再做空闲预取）
    + '<script src="' + libUrl(prefix, 'assets/site.js') + '" defer></script>\n'
    + '</head>\n<body>\n'
    + '<a class="skip" href="#main">跳到正文</a>\n';
}

function tail() {
  return '<div class="search-dialog-host">' + searchDialog() + '</div>' + lightbox() + '</body>\n</html>\n';
}

/**
 * Full document shell.
 * opts: {site, prefix, title, description, active, crumbs, toc, content, pager:{prev,next}, page}
 */
function shell(opts) {
  const { site, prefix, title, description, active, crumbs, toc, content, pager, page } = opts;
  const a = active || {};
  const hasTocEntries = !!(toc && toc.length);
  const secsList = (site.sourceNav && site.sourceNav.sections.length)
    ? site.sourceNav.sections.map((s) => ({ id: s.id, title: s.title }))
    : (site.sections || []).map((s) => ({ id: s.id, title: s.title }));
  return head(prefix, title, description, opts.canonical)
    + topbar(prefix, title, { sections: secsList, activeSectionId: a.sectionId, page })
    + '<div class="nav-scrim" id="nav-scrim" data-nav-scrim aria-hidden="true"></div>'
    + '<div class="layout' + (hasTocEntries ? ' has-toc' : '') + '">'
    + sidebarHtml(site, prefix, active, toc)
    + '<main id="main" class="content">' + crumbs + content + (pager || '') + (page ? footerHtml(page) : '') + '</main>'
    + (hasTocEntries ? tocHtml(toc) : '')
    + '</div>\n'
    + tail();
}

// ---------------------------------------------------------------------------
// 源结构树（首页 / 分区页共用）
// ---------------------------------------------------------------------------

/** 递归渲染上游树：分组标签逐字 + 组首页链接 + 页面（上游标签 + 中文摘要） */
function sourceTreeHtml(nodes, prefix, sec, depth) {
  let html = '<ul class="src-list" data-depth="' + depth + '">';
  for (const n of nodes) {
    if (n.kind === 'group') {
      const home = n.homeKey ? pageHref(prefix, sec.id, n.home) : '';
      html += '<li class="src-group" style="--d:' + depth + '">'
        + '<div class="tg-label">'
        + '<span class="tg-name">' + U.escapeHtml(n.label) + '</span>'
        + (n.zh ? '<span class="tg-zh">' + U.escapeHtml(n.zh) + '</span>' : '')
        + '<span class="tg-count">' + (n.pageCount || 0) + ' 页</span>'
        + (n.homeKey ? '<a class="tg-home" href="' + U.attr(home) + '">组首页 · ' + U.escapeHtml(n.homeTitle || '') + ' →</a>' : '')
        + '</div>'
        + (n.children.length ? sourceTreeHtml(n.children, prefix, sec, depth + 1) : '')
        + '</li>';
    } else {
      const p = n.page || {};
      html += '<li class="src-item" style="--d:' + depth + '">'
        + '<a class="src-link" href="' + U.attr(pageHref(prefix, sec.id, n.rel)) + '">'
        + U.escapeHtml(n.label) + '</a>'
        + (p.summary ? '<span class="src-sum">' + U.escapeHtml(p.summary) + '</span>' : '')
        + '<span class="src-rel">' + U.escapeHtml(n.rel) + '</span>'
        + '</li>';
    }
  }
  return html + '</ul>';
}

function treeSectionHtml(sec, prefix, opts) {
  const o = opts || {};
  const h = o.heading || 2;
  const t = sec.statsFromSource || {};
  const title = o.linkTitle
    ? '<a href="' + libUrl(prefix, 'sections/' + sec.id + '.html') + '">' + U.escapeHtml(sec.title) + '</a>'
    : U.escapeHtml(sec.title);
  return '<section class="src-tree" id="tree-' + U.attr(sec.id) + '">'
    + '<div class="section-head"><h' + h + '>' + title + '</h' + h + '>'
    + '<p>上游侧栏 <code>' + U.escapeHtml(sec.sourceHref) + '</code>'
    + ' · ' + sec.preorder.length + ' 页 · ' + sec.groupCount + ' 组 · 最大深度 ' + sec.maxDepth
    + ' · 组首页/根页 ' + sec.pagesNotInNav + ' 个（挂在组标题上）'
    + (t.groups !== undefined ? ' · 源自 source-nav.json: groups=' + t.groups + ', maxDepth=' + t.maxDepth : '')
    + '</p></div>'
    + sourceTreeHtml(sec.tree, prefix, sec, 1)
    + '</section>';
}

// ---------------------------------------------------------------------------
// index / sections / all-pages / categories / snapshots
// ---------------------------------------------------------------------------

function statsHtml(stats) {
  const rows = [
    ['页面', stats.pages],
    ['目录分组', stats.sourceGroups !== undefined ? stats.sourceGroups : stats.sourceNavGroups],
    ['代码块', stats.codeBlocks],
    ['小节 h2–h6', stats.subsections],
    ['本页目录条目', stats.tocEntries],
    ['告警块', stats.alerts],
    ['表格', stats.tables],
    ['图片', stats.images],
    ['主题分类', stats.categories],
  ].filter(([, v]) => v !== undefined && v !== null);
  return '<div class="stats">' + rows.map(([k, v]) =>
    '<div class="stat"><b>' + v + '</b><span>' + U.escapeHtml(String(k)) + '</span></div>').join('') + '</div>';
}

function heroSearchHtml(prefix, stats) {
  return '<div class="hero-search">'
    + '<input id="hero-search" type="search" data-hero-search placeholder="搜索 ' + stats.pages
    + ' 个页面：标题 / 中文摘要 / 标签 / 正文…（也可按 Ctrl+K）" autocomplete="off" spellcheck="false">'
    + '<button class="tbtn" type="button" data-open-search>🔍 打开搜索</button>'
    + '<a class="tbtn" href="' + libUrl(prefix, 'all-pages.html') + '">📄 全部文章（' + stats.pages + '）</a>'
    + '</div>';
}

/** 落地页 / 分类页 / 快照页共用的信息页脚（来源 / 许可 / 更新方式） */
function infoFooterInner(prefix) {
  return '<span>来源：<a class="external" href="https://docs.papermc.io/paper/" target="_blank" rel="noopener">docs.papermc.io/paper</a>'
    + ' · <a class="external" href="https://docs.papermc.io/velocity/" target="_blank" rel="noopener">docs.papermc.io/velocity</a>'
    + ' · <a class="external" href="https://docs.papermc.io/folia/" target="_blank" rel="noopener">docs.papermc.io/folia</a></span>'
    + '<span>内容版权归 <b>PaperMC</b> 及其贡献者所有（BSD-2-Clause）'
    + ' · <a href="' + U.attr(libUrl(prefix, REPO_LICENSE)) + '">' + REPO_LICENSE + '</a></span>'
    + '<span>更新方式：仓库根执行 <code>node tools/build-site.js</code> 即可全量重建本站</span>';
}

function infoFooter(prefix) {
  return '<footer class="page-footer info-footer">' + infoFooterInner(prefix) + '</footer>';
}

/** 站点根 index.html —— 真正的落地页（不做 meta refresh 跳转） */
function overviewPage(site, stats, opts) {
  const prefix = opts.prefix || '';
  const nav = site.sourceNav;
  const secs = (nav && nav.sections.length) ? nav.sections : (site.sections || []);
  const h1 = SITE_TITLE;
  /* R3-1（cr2-ruling §4.1）：首屏曾把 46.3% 的像素花在「本站自己」上 ——
     两段开发自述（"141 个页面完全离线可用…直接双击 HTML 也能用"）在 320 档
     吃掉 39.3% 首屏，而首屏通向具体文档的链接是 0 个。把自述降级到页脚，
     H1 下只留一行任务导向的副标题（用户来是为了"怎么装插件/怎么排障"）。 */
  let content = '<div class="hero">'
    + '<h1 class="page-head-h1">' + U.escapeHtml(h1) + '</h1>'
    + '<p class="hero-tag">' + U.escapeHtml(SITE_TAGLINE) + '</p>'
    + '<p class="hero-lede">' + HERO_LEDE + '</p>'
    + heroSearchHtml(prefix, stats)
    + '</div>';

  /* R3-1：服主四条路必须排在分区卡**之前** —— 裁决 §4.3 的 S2/S3 顺序。
     原顺序把 3 张 154px 的分区卡摆在最前，导致 320 档首屏只装得下 1 个链接。
     仅渲染实际存在的页面，避免死链。 */
  const exists = (rel) => {
    const e = opts.existing;
    if (!e) return false;
    return typeof e.has === 'function' ? e.has(rel) : e.indexOf(rel) !== -1;
  };
  const hostCards = HOST_PATHS.filter((h) => exists(h.href));
  if (hostCards.length) {
    content += '<div class="host-paths">'
      + hostCards.map((h) => '<a class="host-card" href="' + U.attr(prefix + h.href) + '">'
        + '<span class="hc-title">' + U.escapeHtml(h.title) + '</span>'
        + '<span class="hc-desc">' + U.escapeHtml(h.desc) + '</span></a>').join('')
      + '</div>';
  }

  // 三个大入口卡：Paper / Velocity / Folia
  content += '<div class="entry-cards">';
  for (const sec of secs) {
    const pages = sec.preorder ? sec.preorder.length : (sec.pageCount || 0);
    const groups = sec.groupCount !== undefined ? sec.groupCount : 0;
    const depth = sec.maxDepth !== undefined ? sec.maxDepth : '—';
    content += '<a class="entry-card" href="' + U.attr(prefix + sec.id + '/index.html') + '">'
      + '<span class="ec-kicker">' + U.escapeHtml(sec.title) + '</span>'
      + '<span class="ec-title">' + U.escapeHtml(SECTION_CARD_TITLE[sec.id] || (sec.title + ' 文档')) + '</span>'
      + '<span class="ec-meta"><b>' + pages + '</b> 个页面 · <b>' + groups + '</b> 个分组 · 最大深度 ' + depth + '</span>'
      + '<span class="ec-url">/' + U.escapeHtml(sec.id) + '/</span></a>';
  }
  content += '</div>';

  content += '<div class="quickbar">'
    + '<a class="qa" href="' + libUrl(prefix, 'all-pages.html') + '"><b>全部文章（' + stats.pages + '）</b><span>' + stats.pages + ' 行扁平清单 · 页内过滤</span></a>'
    + '</div>';

  /* R3-1：删除 9 张统计卡（cr2-landing §4：0 张可点、982 与 936 报同一个数字、
     .stat b 21.6px 比入口卡标题 20px 还大）。只保留「页面数」——它已在搜索框
     placeholder 里（heroSearchHtml 早已带 stats.pages），不另设卡片。 */

  /* 批 2b（ups-plan §5.2 / §7 批 2b）：原 `tree-fold` 是首页 `<main>` 的 89.0%
     （37,968 / 42,764 字符、141 条链接），而 <details> 默认 closed → **对首屏贡献 0、
     对 DOM 贡献 89%**；且它是 `treeSectionHtml` 的第二份树（与侧栏 `sidebarHtml`
     不同模板、`sameSet=false`，差异无任何断言覆盖）。
     裁决（方案 b）：降级为 3 行分区入口（~380 字符 / 3 链接）。
     全站地图由 `all-pages.html`（141 行 + 页内过滤）与侧栏（≥1200px 常驻 / 窄屏抽屉）承接。
     ⚠ 删它安全：`verify-nav.js:401` 的 sameIdx 取的是**侧栏**（navFromIndex），不是这里。 */
  if (secs.length) {
    content += '<div class="sec-index">' + secs.map((sec) => {
      const pages = sec.preorder ? sec.preorder.length : (sec.pageCount || 0);
      return '<a class="sec-item" href="' + U.attr(prefix + sec.id + '/index.html') + '">'
        + '<span class="si-name">' + U.escapeHtml(SECTION_CARD_TITLE[sec.id] || (sec.title + ' 文档')) + '</span>'
        + '<span class="si-count">' + pages + ' 页</span></a>';
    }).join('') + '</div>';
  }

  content += '<div class="section-head" id="tax"><h2>按主题浏览（' + site.categories.length + ' 类）</h2></div>';
  content += '<div class="cat-anchorbar">' + site.categories.map((cat) =>
    '<a href="' + libUrl(prefix, 'categories/' + cat.id + '.html') + '">' + U.escapeHtml(cat.title)
    + ' <span class="side-count">' + cat.pages.length + '</span></a>').join('') + '</div>';

  /* R3-1：原来「关于本站」章节 + 镜像说明 + page-meta（生成时间 / SHA-256）
     共 150px 占据首页尾部，其中 SHA-256 对用户零价值。全部降级到页脚。 */
  content += overviewFooter(prefix, stats, opts);
  return shell({
    site, prefix, title: SITE_TITLE + ' · ' + SITE_TAGLINE.split('·')[0].trim(),
    description: 'docs.papermc.io（Paper / Velocity / Folia）离线镜像文档站，URL 与上游逐段一致，支持全站检索',
    canonical: PUBLIC_BASE,
    active: {}, crumbs: '', toc: null, content, pager: '', page: null,
  });
}

/** R3-1：落地页页脚 —— 承接从首屏移走的「维护者信息」。
 *  原样保留镜像说明与 SHA-256（`verify-site.js` 对外壳自证有硬断言，只在**内容页**
 *  页脚要求；落地页这份是给维护者核对用的，挪进 <details> 折叠即可）。 */
function overviewFooter(prefix, stats, opts) {
  const sha = opts.sourceNavSha
    ? '<span class="chip">源结构 SHA-256 <code class="sha">' + U.escapeHtml(opts.sourceNavSha) + '</code></span>'
    : '';
  return '<footer class="page-footer info-footer">'
    + '<details class="about-site"><summary>关于本站（维护者信息）</summary>'
    + '<p class="page-desc">本站是 docs.papermc.io（Paper / Velocity / Folia）的离线镜像，'
    + stats.pages + ' 个页面完全离线可用：正文逐字取自上游 Markdown，URL 与上游逐段一致，'
    + '支持全站检索、主题切换与页面间相对跳转（直接双击 HTML 也能用）。'
    + '原始镜像（Markdown / 页面源 / HTML 快照 / 图片）保存在 <code>archive/</code> 下，'
    + '本站页面通过相对路径引用其中的图片。</p>'
    + '<p class="page-meta"><span class="chip">生成于 ' + U.escapeHtml(opts.generatedAt) + '</span>'
    + '<span class="chip">导航来源 data/source-nav.json</span>' + sha + '</p>'
    + '</details>'
    + infoFooterInner(prefix)
    + '</footer>';
}

/** library/sections/<id>.html — 该 section 的完整源结构树 */
function sectionPage(site, sec, opts) {
  const prefix = opts.prefix;
  const nav = site.sourceNav;
  const nsec = nav ? nav.sectionById.get(sec.id) : null;
  const crumbs = crumbsHtml([
    { label: '总览', href: libUrl(prefix, 'index.html') },
    { label: sec.title },
  ]);
  let content = crumbs + '<div class="page-head"><h1>' + U.escapeHtml(sec.title) + '</h1>'
    + '<p class="page-desc">' + U.escapeHtml(sec.subtitle || '') + ' —— 上游侧栏结构（逐字标签 / 逐层嵌套 / 原始顺序）</p>'
    + '<p class="page-meta">'
    + (nsec ? '<span class="chip">' + nsec.preorder.length + ' 页</span><span class="chip">' + nsec.groupCount + ' 组</span>'
      + '<span class="chip">最大深度 ' + nsec.maxDepth + '</span><span class="chip">组首页 ' + nsec.groupHomes + '</span>'
      + '<span class="chip">上游侧栏 <code>' + U.escapeHtml(nsec.sourceHref) + '</code></span>' : '')
    + '<a class="tbtn" href="' + libUrl(prefix, 'all-pages.html') + '">全部页面清单</a>'
    + '<a class="tbtn" href="' + libUrl(prefix, 'index.html') + '">返回总览</a></p></div>';
  if (nsec) {
    content += treeSectionHtml(nsec, prefix, { heading: 2 });
  }
  content += '<div class="section-head"><h2>按主题浏览（自定义）</h2>'
    + '<p>该分区在本离线库自建分类体系下的入口（次要导航，与上游结构无关）。</p></div>';
  for (const cat of sec.categories) {
    content += '<div class="cat-block"><h3><a href="' + libUrl(prefix, 'categories/' + cat.id + '.html') + '">'
      + U.escapeHtml(cat.title) + '</a> <span class="chip">' + cat.pages.length + ' 页</span></h3>'
      + '<p class="cat-desc">' + U.escapeHtml(cat.description || '') + '</p><ul class="cat-links">'
      + cat.pages.map((p) => pageCard(p, prefix)).join('') + '</ul></div>';
  }
  content += infoFooter(prefix);
  return shell({
    site, prefix, title: sec.title + ' · ' + SITE_TITLE,
    description: sec.title + ' 分区的完整目录结构（与上游 docs.papermc.io 侧栏一致）',
    canonical: PUBLIC_BASE + sec.id + '/',
    active: { sectionId: sec.id }, crumbs: '', toc: null, content, pager: '', page: null,
  });
}

/** library/all-pages.html — 141 页扁平清单（源树先序），支持页内过滤与 Ctrl+F */
function allPagesPage(site, rows, opts) {
  const prefix = opts.prefix || '';
  const crumbs = crumbsHtml([
    { label: '总览', href: libUrl(prefix, 'index.html') },
    { label: '全部页面清单' },
  ]);
  let content = crumbs + '<div class="page-head"><h1>全部页面清单（' + rows.length + ' 页）</h1>'
    + '<p class="page-desc">按各分区源结构树的<b>先序</b>排列（分区 → 组首页 → 组内页面，与上游侧栏顺序一致）。'
    + '每行给出分区、源结构路径、上游标签、中文摘要与链接；可用下面的过滤框缩小范围，也可直接用浏览器 Ctrl+F。</p>'
    + '<p class="page-meta"><span class="chip">' + rows.length + ' 页</span>'
    + '<span class="chip">源结构先序</span>'
    + '<span class="chip">生成于 ' + U.escapeHtml(opts.generatedAt || '') + '</span></p></div>';
  content += '<div class="filter-bar">'
    + '<input id="allpages-filter" type="search" data-table-filter="allpages"'
    + ' placeholder="过滤：标题 / 摘要 / 组路径 / 分区 / rel…" autocomplete="off">'
    + '<button class="tbtn" type="button" data-filter-clear="allpages">清除</button>'
    + '<span class="filter-count" id="allpages-count">' + rows.length + ' / ' + rows.length + ' 行</span></div>';
  content += '<div class="table-wrap"><table class="allpages" id="allpages"><thead><tr>'
    + '<th>#</th><th>分区</th><th>源结构路径（组 › 组）</th><th>上游标签</th><th>中文摘要</th><th>链接</th>'
    + '</tr></thead><tbody>';
  for (const r of rows) {
    const hay = [r.pathText, r.label, r.title, r.summary, r.sectionTitle, r.rel, r.kind].filter(Boolean).join(' ');
    content += '<tr data-search="' + U.attr(hay) + '">'
      + '<td class="num">' + r.index + '</td>'
      + '<td>' + U.escapeHtml(r.sectionTitle) + '</td>'
      + '<td class="pth">' + U.escapeHtml(r.groupPath ? r.groupPath.replace(/ > /g, ' › ') : '（分区根级）')
      + (r.kind === 'page' ? '<span class="tag">导航项</span>' : (r.kind === 'section-root' ? '<span class="tag">根页</span>' : '<span class="tag">组首页</span>'))
      + '</td>'
      + '<td class="lbl"><a href="' + U.attr(r.href) + '">' + U.escapeHtml(r.label) + '</a></td>'
      + '<td class="sum">' + U.escapeHtml(r.summary || '—') + '</td>'
      + '<td class="lnk"><a href="' + U.attr(r.href) + '">打开页面</a></td>'
      + '</tr>';
  }
  content += '</tbody></table></div>';
  content += infoFooter(prefix);
  return shell({
    site, prefix, title: '全部文章 · ' + SITE_TITLE,
    description: '按源结构先序排列的全部 ' + rows.length + ' 篇文章',
    canonical: PUBLIC_BASE + 'all-pages.html',
    active: {}, crumbs: '', toc: null, content, pager: '', page: null,
  });
}

/** card used on category / section pages */
function pageCard(p, prefix) {
  const sum = p.summary || p.description || '';
  return '<li><a href="' + libUrl(prefix, p.section + '/' + p.rel + '.html') + '">'
    + '<span><span class="ttl">' + U.escapeHtml(p.title) + '</span>'
    + (p.navPathText ? '<span class="pth">' + U.escapeHtml(p.navPathText) + '</span>' : '')
    + (sum ? '<span class="sum">' + U.escapeHtml(sum) + '</span>' : '')
    + '</span></a></li>';
}

function categoryPage(site, cat, opts) {
  const prefix = opts.prefix;
  const sec = site.sectionById.get(cat.section);
  const crumbs = crumbsHtml([
    { label: '总览', href: libUrl(prefix, 'index.html') },
    { label: '按主题浏览（自定义）', href: libUrl(prefix, 'index.html') + '#tax' },
    { label: cat.title },
  ]);
  let content = crumbs + '<div class="page-head"><h1>' + U.escapeHtml(cat.title) + '</h1>'
    + '<p class="page-desc">' + U.escapeHtml(cat.description || '') + '</p>'
    + '<p class="page-meta"><span class="chip">' + U.escapeHtml(sec.title) + '</span>'
    + '<span class="chip">' + cat.pages.length + ' 页</span>'
    + '<span class="chip">次要入口：本离线库自建主题分类（主导航请看源结构）</span>'
    + '<a class="tbtn" href="' + U.attr(libUrl(prefix, 'sections/' + sec.id + '.html')) + '">本分区源结构树</a></p></div>';
  content += '<ul class="tax-list">' + cat.pages.map((p) =>
    '<li><a href="' + libUrl(prefix, p.section + '/' + p.rel + '.html') + '"><b>'
    + U.escapeHtml(p.title) + '</b></a>'
    + (p.navPathText ? '<div class="pth">' + U.escapeHtml(p.navPathText) + '</div>' : '')
    + '<div class="sum">' + U.escapeHtml(p.summary || p.description || '') + '</div></li>').join('') + '</ul>';
  content += infoFooter(prefix);
  return shell({
    site, prefix, title: cat.title + ' · ' + sec.title + ' · ' + SITE_TITLE,
    description: cat.description || cat.title,
    canonical: PUBLIC_BASE + 'categories/' + cat.id + '.html',
    active: { categoryId: cat.id, sectionId: sec.id },
    crumbs: '', toc: null, content, pager: '', page: null,
  });
}

/**
 * library/snapshots.html — one row per mirrored page: rendered page / raw HTML snapshot /
 * upstream index.md, so a reviewer can diff the three artefacts.
 * rows: [{title, sectionTitle, navPath, rel, url, pageHref, htmlHref, sourceHref, exists:{html,source}}]
 */
function snapshotsPage(site, rows, opts) {
  const prefix = opts.prefix || '';
  const crumbs = crumbsHtml([
    { label: '总览', href: libUrl(prefix, 'index.html') },
    { label: '快照对照表' },
  ]);
  const missingHtml = rows.filter((r) => r.exists && !r.exists.html).length;
  const missingSrc = rows.filter((r) => r.exists && !r.exists.source).length;
  let content = crumbs + '<div class="page-head"><h1>快照对照表</h1>'
    + '<p class="page-desc">全部 ' + rows.length + ' 个镜像页面的三类产物一一对应：本站渲染页、抓取时的原始 HTML 快照、上游站点原稿 index.md。</p>'
    + '<p class="page-meta"><span class="chip">' + rows.length + ' 页</span>'
    + '<span class="chip">HTML 快照缺失 ' + missingHtml + '</span>'
    + '<span class="chip">index.md 缺失 ' + missingSrc + '</span>'
    + '<span class="chip">生成于 ' + U.escapeHtml(opts.generatedAt || '') + '</span></p></div>';
  content += '<div class="banner"><b>说明</b>：原始 HTML 快照（<code>archive/&lt;section&gt;/html/&lt;rel&gt;.html</code>）'
    + '是抓取时刻线上页面的副本，其样式依赖线上资源（字体、CDN CSS），离线打开只用于内容核对，版式不保证；'
    + '页面源 Markdown（<code>archive/&lt;section&gt;/source/</code>）是站点作者原稿，保留 <code>&lt;PageCards /&gt;</code> 等未展开的组件标签；'
    + '转换后的 Markdown 在 <code>archive/&lt;section&gt;/markdown/</code>。'
    + '本站渲染页才做了代码高亮、告警、表格与内链的离线化处理。</div>';
  content += '<div class="table-wrap"><table class="snapshots"><thead><tr>'
    + '<th>#</th><th>页面</th><th>分区 / 源结构路径</th><th>rel</th>'
    + '<th>本地渲染页</th><th>原始 HTML 快照</th><th>上游 index.md</th><th>线上原文</th>'
    + '</tr></thead><tbody>';
  rows.forEach((r, i) => {
    content += '<tr>'
      + '<td>' + (i + 1) + '</td>'
      + '<td><a href="' + U.attr(r.pageHref) + '">' + U.escapeHtml(r.title) + '</a></td>'
      + '<td>' + U.escapeHtml(r.sectionTitle) + ' / ' + U.escapeHtml(r.navPath || '—') + '</td>'
      + '<td><code>' + U.escapeHtml(r.rel) + '</code></td>'
      + '<td><a href="' + U.attr(r.pageHref) + '">渲染页</a></td>'
      + '<td>' + (r.exists && r.exists.html
        ? '<a href="' + U.attr(r.htmlHref) + '">HTML</a>'
        : '<span class="chip">不可用</span>') + '</td>'
      + '<td>' + (r.exists && r.exists.source
        ? '<a href="' + U.attr(r.sourceHref) + '">index.md</a>'
        : '<span class="chip">不可用</span>') + '</td>'
      + '<td>' + (r.url ? '<a class="external" target="_blank" rel="noopener" href="' + U.attr(r.url) + '">原文</a>' : '') + '</td>'
      + '</tr>';
  });
  content += '</tbody></table></div>';
  content += infoFooter(prefix);
  return shell({
    site, prefix, title: '原始快照索引 · ' + SITE_TITLE,
    description: '全部镜像页面的渲染页 / 原始 HTML 快照 / 页面源 Markdown 对照表',
    canonical: PUBLIC_BASE + 'snapshots.html',
    active: { sectionId: opts.activeSectionId }, crumbs: '', toc: null, content, pager: '', page: null,
  });
}

// ---------------------------------------------------------------------------
// robots.txt / sitemap.xml / 404.html
// ---------------------------------------------------------------------------

/** 依赖审计用的 robots.txt */
function robotsTxt() {
  return 'User-agent: *\nAllow: /\n\nSitemap: ' + PUBLIC_BASE + 'sitemap.xml\n';
}

/**
 * sitemap.xml —— 141 个内容页 + 落地页 / all-pages.html / snapshots.html，全部公网绝对 URL。
 * rows: [{loc, lastmod}]
 */
function sitemapXml(rows) {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const r of rows) {
    parts.push('  <url>');
    parts.push('    <loc>' + U.escapeText(r.loc) + '</loc>');
    if (r.lastmod) parts.push('    <lastmod>' + U.escapeText(r.lastmod) + '</lastmod>');
    parts.push('  </url>');
  }
  parts.push('</urlset>');
  return parts.join('\n') + '\n';
}

/**
 * 404.html —— 自定义 404。样式内联（任意深度的无效路径下 404.html 都可能被就地返回，
 * 相对路径此时未必解析得到 assets/），只保留三个相对链接：首页 / 全部文章 / 原始快照索引。
 * 另附一段脚本：在 project pages 子路径（/<repo>/…）下把相对链接改写回 /<repo>/…。
 */
function notFoundPage(opts) {
  const o = opts || {};
  const pageCount = Number.isFinite(o.pageCount) ? o.pageCount : null;
  return '<!DOCTYPE html>\n<html lang="zh-CN" data-theme="auto">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">\n'
    + '<meta name="robots" content="noindex">\n'
    + '<title>404 · 页面不存在 · ' + U.escapeText(SITE_TITLE) + '</title>\n'
    + '<meta name="generator" content="papermc-docs offline library">\n'
    + '<link rel="icon" href="./assets/favicon.svg" type="image/svg+xml">\n'
    + '<style>\n'
    + '  :root { color-scheme: light dark; --bg:#f7f7f8; --fg:#1f2328; --mut:#57606a; --line:#d8dee4; --acc:#1d4ed8; }\n'
    + '  @media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --fg:#e6edf3; --mut:#9198a1; --line:#30363d; --acc:#7aa2ff; } }\n'
    + '  * { box-sizing: border-box; }\n'
    + '  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);\n'
    + '         font:16px/1.7 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; padding:2rem; }\n'
    + '  main { max-width:44rem; }\n'
    + '  .code { font-size:3.5rem; font-weight:700; color:var(--acc); margin:0; }\n'
    + '  h1 { font-size:1.5rem; margin:.2rem 0 1rem; }\n'
    + '  a { color:var(--acc); }\n'
    + '  ul { padding-left:1.2rem; }\n'
    + '  code { background:color-mix(in srgb, currentColor 12%, transparent); padding:.15em .4em; border-radius:.3em; }\n'
    + '  .mut { color:var(--mut); }\n'
    + '</style>\n'
    + '</head>\n<body>\n'
    + '<main>\n'
    + '  <p class="code">404</p>\n'
    + '  <h1>页面不存在</h1>\n'
    + '  <p class="mut">请求的路径不在这份离线文档库里。可以回到下面任一入口：</p>\n'
    + '  <ul>\n'
    + '    <li><a href="./index.html" data-gh-pages-link="./index.html">文档库首页 —— <code>index.html</code></a>：三个分区入口（Paper / Velocity / Folia）、全站搜索与统计</li>\n'
    + '    <li><a href="./all-pages.html" data-gh-pages-link="./all-pages.html">全部文章（' + (pageCount === null ? '…' : pageCount) + '）—— <code>all-pages.html</code></a>：一份带过滤框的扁平清单</li>\n'
    + '    <li><a href="./snapshots.html" data-gh-pages-link="./snapshots.html">原始快照索引 —— <code>snapshots.html</code></a>：渲染页 / HTML 快照 / 页面源 Markdown 对照</li>\n'
    + '  </ul>\n'
    + '  <p>正文页路径与上游 <a class="ext" href="https://docs.papermc.io/" target="_blank" rel="noopener">docs.papermc.io</a> 逐段一致，'
    + '例如上游 <code>/paper/dev/command-api/basics/introduction/</code> 对应本站 <code>paper/dev/command-api/basics/introduction/index.html</code>。</p>\n'
    + '  <p class="mut">内容版权归 PaperMC 及其贡献者所有（BSD-2-Clause）。</p>\n'
    + '</main>\n'
    + '<script>\n'
    + '/* GitHub Pages project pages：站点挂在 /<repo>/ 子路径下。\n'
    + '   深层无效路径被回退到 404.html 时，相对链接 ./index.html 会解析成 /<repo>/aaa/bbb/index.html —— 仍是 404。\n'
    + '   这里按子路径把它们改写成 /<repo>/index.html 这样的绝对路径。' + ' */\n'
    + '(function () {\n'
    + '  var p = location.pathname;\n'
    + '  var seg = p.split("/").filter(Boolean);\n'
    + '  var base = seg.length > 1 ? "/" + seg[0] + "/" : "/";\n'
    + '  var links = document.querySelectorAll("[data-gh-pages-link]");\n'
    + '  for (var i = 0; i < links.length; i++) {\n'
    + '    var rel = links[i].getAttribute("data-gh-pages-link") || "";\n'
    + '    links[i].setAttribute("href", base + rel.replace(/^\\.\\//, ""));\n'
    + '  }\n'
    + '})();\n'
    + '</script>\n'
    + '</body>\n</html>\n';
}

module.exports = {
  SITE_TITLE, SITE_TAGLINE, PUBLIC_BASE, REPO_LICENSE_FALLBACK, setLicenseFile, getLicenseFile, publicUrl,
  shell, overviewPage, allPagesPage, categoryPage, sectionPage, snapshotsPage,
  notFoundPage, robotsTxt, sitemapXml, infoFooter,
  libUrl, pageHref, crumbsHtml, pagerHtml, sidebarHtml, tocHtml, footerHtml, pageCard,
  statsHtml, sourceTreeHtml, treeSectionHtml,
};
