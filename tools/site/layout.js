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
  let parts = '<button class="tbtn sidebar-toggle" id="nav-toggle" type="button" aria-label="切换侧栏">☰</button>'
    + '<a class="brand" href="' + libUrl(prefix, 'index.html') + '">'
    + '<span class="brand-dot" aria-hidden="true"></span><span>' + U.escapeHtml(SITE_TITLE) + '</span></a>';
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
      parts += '<a class="tbtn" href="' + U.attr(src) + '" title="页面源 Markdown">页面源 Markdown</a>';
    }
  }
  parts += '<button class="tbtn" type="button" data-open-search title="搜索全部页面">'
    + '<span aria-hidden="true">🔍</span><span>搜索</span><kbd>Ctrl</kbd><kbd>K</kbd></button>'
    + '<button class="tbtn" id="theme-toggle" type="button" title="切换主题">跟随系统</button>';
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

/** 侧栏里一条页面链接；data-search 同时含标题 / 中文摘要 / 源结构组路径（供过滤框使用） */
function sidePageItem(opts) {
  const { href, label, search, active, badge } = opts;
  return '<li><a href="' + U.attr(href) + '"'
    + (opts.cls ? ' class="' + U.attr(opts.cls) + '"' : '')
    + ' data-search="' + U.attr(search) + '"'
    + (active ? ' aria-current="page"' : '')
    + (opts.title ? ' title="' + U.attr(opts.title) + '"' : '')
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
  const open = ctx.openGroupKeys.has(g.key) ? ' open' : '';
  const homeMeta = g.homeKey ? sec.navForRel.get(g.home) : null;
  const homeHref = g.homeKey ? pageHref(prefix, sec.id, g.home) : '';
  const homeHay = sideSearchHay(g.homePage, g.label, (homeMeta && homeMeta.groupPath) || g.path.join(' > '), sec.title);
  let html = '<details class="side-group" data-nav-key="' + U.attr(g.key) + '"'
    + ' data-nav-path="' + U.attr(g.path.join(' > ')) + '"' + open + '>'
    + '<summary class="side-group-title">'
    + '<span class="grp-name">' + U.escapeHtml(g.label) + '</span>'
    + (g.zh ? '<span class="grp-zh">' + U.escapeHtml(g.zh) + '</span>' : '')
    + (g.homeKey
      ? '<a class="side-home" href="' + U.attr(homeHref) + '" data-search="' + U.attr(homeHay) + '"'
        + ' title="组首页：' + U.attr(g.homeTitle || g.label) + '（上游仅渲染组标题，不输出 &lt;a&gt;）">组首页 →</a>'
      : '')
    + '<span class="side-count">' + (g.pageCount || 0) + '</span>'
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

/** left sidebar: 源结构树（Paper / Velocity 并列）+ 底部「按主题浏览（自定义）」 */
function sidebarHtml(site, prefix, active) {
  const a = active || {};
  const nav = site.sourceNav;
  let html = '<nav class="sidebar" id="sidebar" aria-label="文档导航">'
    + '<label class="visually-hidden" for="side-filter" hidden>过滤页面</label>'
    + '<input class="side-filter" id="side-filter" type="search" placeholder="过滤：标题 / 摘要 / 源结构路径…" autocomplete="off">'
    + '<div class="side-legend">主导航 = 上游 docs.papermc.io 侧栏结构</div>';
  if (nav && nav.sections.length) {
    for (const sec of nav.sections) {
      const open = !a.sectionId || a.sectionId === sec.id;
      html += '<details class="side-sec" data-section="' + U.attr(sec.id) + '"' + (open ? ' open' : '') + '>'
        + '<summary class="side-section-title">'
        + '<span class="sec-name">' + U.escapeHtml(sec.title) + '</span>'
        + '<span class="side-count">' + sec.preorder.length + '</span></summary>'
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
    for (const sec of site.sections) {
      html += '<div class="side-section" data-section="' + U.attr(sec.id) + '">'
        + '<a class="side-section-title" href="' + libUrl(prefix, 'sections/' + sec.id + '.html') + '">'
        + U.escapeHtml(sec.title) + '<span class="side-count">' + sec.pageCount + '</span></a></div>';
    }
  }
  // 自建中文分类：降级为次要入口（折叠）
  const cats = site.categories || [];
  if (cats.length) {
    html += '<details class="side-cat" data-cat="taxonomy"' + (a.categoryId ? ' open' : '') + '>'
      + '<summary>按主题浏览（自定义）<span class="side-count">' + cats.length + '</span></summary><ul>';
    for (const cat of cats) {
      const sec = site.sectionById.get(cat.section);
      html += '<li><a href="' + libUrl(prefix, 'categories/' + cat.id + '.html') + '"'
        + ' data-search="' + U.attr([cat.title, cat.description || '', (sec && sec.title) || '', '按主题浏览'].join(' ')) + '"'
        + (a.categoryId === cat.id ? ' class="active" aria-current="page"' : '')
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

/** right-hand "本页目录"; returns '' when the page has no h2-h4 headings */
function tocHtml(toc) {
  if (!toc || !toc.length) return '';
  let html = '<aside class="toc-side" aria-label="本页目录"><div class="toc-title">本页目录</div><ol>';
  for (const h of toc) {
    html += '<li class="lvl-' + h.level + '"><a href="#' + U.attr(h.id) + '">' + U.escapeHtml(h.text) + '</a></li>';
  }
  html += '</ol></aside>';
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
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>' + U.escapeText(title) + '</title>\n'
    + (description ? '<meta name="description" content="' + U.attr(description) + '">\n' : '')
    + (canonical ? '<link rel="canonical" href="' + U.attr(canonical) + '">\n' : '')
    + '<meta name="generator" content="papermc-docs offline library">\n'
    + '<link rel="icon" href="' + libUrl(prefix, 'assets/favicon.svg') + '" type="image/svg+xml">\n'
    + '<link rel="stylesheet" href="' + libUrl(prefix, 'assets/site.css') + '">\n'
    + '<script>(function(){try{var t=localStorage.getItem("lcb-theme")||"auto";document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>\n'
    + '<script src="' + libUrl(prefix, 'assets/search-index.js') + '" defer></script>\n'
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
    + '<div class="layout' + (hasTocEntries ? ' has-toc' : '') + '">'
    + sidebarHtml(site, prefix, active)
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
function infoFooter(prefix) {
  return '<footer class="page-footer info-footer">'
    + '<span>来源：<a class="external" href="https://docs.papermc.io/paper/" target="_blank" rel="noopener">docs.papermc.io/paper</a>'
    + ' · <a class="external" href="https://docs.papermc.io/velocity/" target="_blank" rel="noopener">docs.papermc.io/velocity</a>'
    + ' · <a class="external" href="https://docs.papermc.io/folia/" target="_blank" rel="noopener">docs.papermc.io/folia</a></span>'
    + '<span>内容版权归 <b>PaperMC</b> 及其贡献者所有（BSD-2-Clause）'
    + ' · <a href="' + U.attr(libUrl(prefix, REPO_LICENSE)) + '">' + REPO_LICENSE + '</a></span>'
    + '<span>更新方式：仓库根执行 <code>node tools/build-site.js</code> 即可全量重建本站</span>'
    + '</footer>';
}

/** 站点根 index.html —— 真正的落地页（不做 meta refresh 跳转） */
function overviewPage(site, stats, opts) {
  const prefix = opts.prefix || '';
  const nav = site.sourceNav;
  const secs = (nav && nav.sections.length) ? nav.sections : (site.sections || []);
  const h1 = SITE_TITLE;
  let content = '<div class="hero">'
    + '<h1 class="page-head-h1">' + U.escapeHtml(h1) + '</h1>'
    + '<p class="hero-tag">' + U.escapeHtml(SITE_TAGLINE) + '</p>'
    + '<p>' + stats.pages + ' 个页面完全离线可用：正文逐字取自上游 Markdown，'
    + 'URL 与 <a class="external" href="https://docs.papermc.io/" target="_blank" rel="noopener">docs.papermc.io</a> '
    + '逐段一致，支持全站检索、主题切换与页面间相对跳转（直接双击 HTML 也能用）。</p>'
    + heroSearchHtml(prefix, stats)
    + '</div>';

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
    + '<a class="qa" href="' + libUrl(prefix, 'snapshots.html') + '"><b>原始快照索引</b><span>渲染页 / HTML 快照 / 上游 index.md 对照</span></a>'
    + '<a class="qa" href="#tax"><b>按主题浏览（' + site.categories.length + ' 类）</b><span>自定义中文主题视图（次要入口）</span></a>'
    + '</div>';

  content += statsHtml(stats);

  if (secs.length) {
    content += '<div class="section-head"><h2>目录结构</h2>'
      + '<p>与上游 Starlight 侧栏逐字一致（分组标签、嵌套层级与排列顺序全部取自上游，不做任何自行归类）。'
      + '点击分组标题右侧的「组首页 →」可进入该分组的索引页。</p></div>';
    for (const sec of secs) content += treeSectionHtml(sec, prefix, { heading: 2, linkTitle: true });
  }

  content += '<div class="section-head" id="tax"><h2>按主题浏览（' + site.categories.length + ' 类）</h2>'
    + '<p>' + U.escapeHtml(opts.taxonomyMode) + '。这些中文分类是本离线库自建的次要入口，'
    + '与上游侧栏结构无关；主导航以上面的目录结构为准。</p></div>';
  content += '<div class="cat-anchorbar">' + site.categories.map((cat) =>
    '<a href="' + libUrl(prefix, 'categories/' + cat.id + '.html') + '">' + U.escapeHtml(cat.title)
    + ' <span class="side-count">' + cat.pages.length + '</span></a>').join('') + '</div>';

  content += '<div class="section-head"><h2>关于本站</h2></div>'
    + '<p class="page-desc">本站是 docs.papermc.io（Paper / Velocity / Folia）的离线镜像。'
    + '页面路径与上游 URL 逐段一致（例如上游 <code>/paper/dev/command-api/basics/introduction/</code> '
    + '对应本站 <code>paper/dev/command-api/basics/introduction/index.html</code>）。'
    + '原始镜像（Markdown / 页面源 / HTML 快照 / 图片）保存在 <code>archive/</code> 下，'
    + '本站页面通过相对路径引用其中的图片。</p>'
    + '<p class="page-meta"><span class="chip">生成于 ' + U.escapeHtml(opts.generatedAt) + '</span>'
    + '<span class="chip">导航来源 data/source-nav.json</span>'
    + (opts.sourceNavSha ? '<span class="chip">源结构 SHA-256 <code class="sha">' + U.escapeHtml(opts.sourceNavSha) + '</code></span>' : '')
    + '</p>';

  content += infoFooter(prefix);
  return shell({
    site, prefix, title: SITE_TITLE + ' · ' + SITE_TAGLINE.split('·')[0].trim(),
    description: 'docs.papermc.io（Paper / Velocity / Folia）离线镜像文档站，URL 与上游逐段一致，支持全站检索',
    canonical: PUBLIC_BASE,
    active: {}, crumbs: '', toc: null, content, pager: '', page: null,
  });
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
  content += '<div class="table-wrap"><table><thead><tr>'
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
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
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
  SITE_TITLE, SITE_TAGLINE, PUBLIC_BASE, REPO_LICENSE_FALLBACK, setLicenseFile, publicUrl,
  shell, overviewPage, allPagesPage, categoryPage, sectionPage, snapshotsPage,
  notFoundPage, robotsTxt, sitemapXml, infoFooter,
  libUrl, pageHref, crumbsHtml, pagerHtml, sidebarHtml, tocHtml, footerHtml, pageCard,
  statsHtml, sourceTreeHtml, treeSectionHtml,
};
