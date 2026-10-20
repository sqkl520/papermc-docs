#!/usr/bin/env node
'use strict';
/**
 * audit-render.js — 渲染元素保真度审计（HTML → Markdown）
 *
 * 只审计"结构化元素有没有丢/坏"这一类缺陷，共 6 项：
 *   1. 围栏代码块（div.expressive-code vs ``` 块：数量/内容/语言/title）
 *   2. GitHub 告警（aside.starlight-aside[--type] vs > [!TYPE]）
 *   3. <details>/<summary>
 *   4. 表格（table tr/th+td vs GFM 表格）
 *   5. 文件树 / Tab（starlight-file-tree、starlight-tabs）
 *   6. 图片（img vs ![]()，含本地存在性与 alt）
 *
 * 用法：
 *   node tools/audit-render.js [archiveDir …]
 *   例：node tools/audit-render.js archives/paper archives/velocity
 *
 * 输出：
 *   控制台摘要 + reports/audit-render.json
 *
 * 真值来源：archives/<section>/html/**（原始 HTML，离线可读）
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const REPO = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(REPO, 'reports');
const DEFAULT_ARCHIVES = ['archive/paper', 'archive/velocity'];
const argv = process.argv.slice(2).filter((a) => a && a[0] !== '-');
const ARCHIVE_ARGS = argv.length ? argv : DEFAULT_ARCHIVES;

const ALERT_TYPES = ['note', 'tip', 'caution', 'danger', 'important', 'warning'];
const ALERT_NAME = {
  note: 'NOTE', tip: 'TIP', caution: 'CAUTION',
  danger: 'DANGER', important: 'IMPORTANT', warning: 'WARNING',
};
const ASSET_HOSTS = ['docs.papermc.io', 'assets.papermc.io'];

// ------------------------------------------------------------------ utilities

function walk(dir, out = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const nbsp = (s) => String(s == null ? '' : s).replace(/\u00a0/g, ' ');

/** 单行文本归一化：折叠所有空白、去首尾 */
const normWS = (s) => nbsp(s).replace(/\s+/g, ' ').trim();

/** 代码块内容归一化：去 \r、去行尾空白、去首尾空行 */
function normCode(s) {
  const lines = nbsp(s).replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** 代码块比较键：逐行去首尾空白 + 行内空白折叠（对缩进不敏感，只关心内容） */
function keyOf(s) {
  return normCode(s).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
}

/** 去掉行首的 blockquote 前缀（`> ` / `>` / 多层），用于比对嵌在告警里的代码块 */
function dequoteCode(s) {
  return String(s == null ? '' : s).split('\n')
    .map((l) => l.replace(/^[ \t]*(?:>[ ]?)+/, ''))
    .join('\n');
}

/** 彻底去空白，用于判断"内容是否还存在（哪怕换了个位置/形态）" */
const squash = (s) => String(s == null ? '' : s).replace(/\s+/g, '');

/** 表格单元格比对：剥掉 Markdown 行内标记，只留可见文本 */
function stripInline(s) {
  return normWS(String(s == null ? '' : s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/!\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*\)/g, '$1')
    .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*\)/g, '$1')
    .replace(/<\/?(?:sup|sub|kbd|b|i|strong|em|u|code|span)(?=[\s/>])[^>]*>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<![*\\])\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\\\|/g, '|')
    .replace(/\s+/g, ' '));
}

const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

/** 配对键：只看非空行内容（空行位置单独比对），对缩进/行内空白不敏感 */
function keyContent(s) {
  return normCode(s).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l !== '').join('\n').trim();
}

function fileLines(f, from, count) {
  // 返回文件里以 1 起算的行片段，用于证据摘录
  try {
    const all = fs.readFileSync(f, 'utf8').split('\n');
    return all.slice(from, from + count).map((l) => l.replace(/\s+$/, ''));
  } catch { return []; }
}

// ------------------------------------------------------------ markdown parser

/** 解析围栏代码块（支持 3+ 反引号 / 波浪线、行首缩进、以及 blockquote（GitHub 告警内）前缀） */
function parseFences(md) {
  const lines = String(md).replace(/\r/g, '').split('\n');
  const blocks = [];
  const prefixRe = '[ \\t]*(?:>[ \\t]?)*';
  let i = 0;
  while (i < lines.length) {
    const m = new RegExp('^(' + prefixRe + ')(`{3,}|~{3,})(.*)$').exec(lines[i]);
    if (!m) { i++; continue; }
    const indent = m[1];
    const fence = m[2];
    const ch = fence[0];
    const closeRe = new RegExp('^' + prefixRe + (ch === '`' ? '`' : '~') + '{' + fence.length + ',}[ \\t]*$');
    const info = m[3].trim();
    const langTok = (info.split(/\s+/)[0] || '').trim();
    // info string 里 `title="x"` / `title='x'` / `title=x`
    let title = '';
    const tm = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(info);
    if (tm) title = (tm[1] != null ? tm[1] : tm[2] != null ? tm[2] : tm[3] || '').trim();
    const body = [];
    const startLine = i + 1;
    const quoted = />/.test(indent) || />/.test(lines[i] || '');
    i++;
    while (i < lines.length && !closeRe.test(lines[i])) { body.push(lines[i]); i++; }
    const closed = i < lines.length;
    i++;
    blocks.push({
      indent: indent.length,
      quoted,
      fence: ch.repeat(fence.length),
      info, lang: langTok, title,
      code: body.join('\n'),
      startLine, endLine: i, closed,
    });
  }
  return blocks;
}

/** 解析 GitHub 告警：> [!TYPE] 标题 */
function parseAlerts(md) {
  const out = [];
  const lines = String(md).replace(/\r/g, '').split('\n');
  lines.forEach((l, idx) => {
    if (!/^\s*>/.test(l)) return;
    const m = /^\s*>\s*\[!([A-Za-z]+)\]\s*(.*)$/.exec(l);
    if (!m) return;
    out.push({ type: m[1].toUpperCase(), title: normWS(m[2]), line: idx + 1 });
  });
  return out;
}

/** 解析 markdown 里的 <details><summary>…</summary>…</details> */
function parseDetails(md) {
  const out = [];
  const s = String(md).replace(/\r/g, '');
  const re = /<details([^>]*)>\s*<summary([^>]*)>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const body = m[4] || '';
    out.push({
      openAttr: normWS(m[1]), summaryAttr: normWS(m[2]),
      summary: normWS(String(m[3]).replace(/<[^>]+>/g, ' ')),
      body,
      bodyFences: (body.match(/^[ \t]*(?:>[ \t]?)*```/gm) || []).length,
      bodyTabsSections: (body.match(/^[ \t]*#{4,6}\s+/gm) || []).length,
      bodyTableRows: (body.match(/^[ \t]*(?:>[ \t]?)*\|/gm) || []).length,
      bodyImages: (body.match(/!\[[^\]]*\]\(/g) || []).length,
      bodyLen: body.replace(/\s+/g, '').length,
      line: s.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

/** 解析 GFM 表格 */
function parseTables(md) {
  const lines = String(md).replace(/\r/g, '').split('\n');
  const sepRe = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    if (!sepRe.test(lines[i + 1])) continue;
    const rows = [lines[i]];
    const startLine = i + 1;
    let j = i + 2;
    while (j < lines.length && /^\s*\|/.test(lines[j]) && !sepRe.test(lines[j])) { rows.push(lines[j]); j++; }
    const splitCells = (l) => {
      let t = l.trim();
      if (t.startsWith('|')) t = t.slice(1);
      if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
      const cells = [];
      let buf = '';
      for (let k = 0; k < t.length; k++) {
        const c = t[k];
        if (c === '\\' && t[k + 1] === '|') { buf += '|'; k++; continue; }
        if (c === '|') { cells.push(buf); buf = ''; continue; }
        buf += c;
      }
      cells.push(buf);
      return cells.map((c) => normWS(c));
    };
    out.push({
      header: splitCells(rows[0]),
      sepCols: splitCells(lines[i + 1]).length,
      body: rows.slice(1).map(splitCells),
      rowCount: rows.length,
      startLine,
      raw: rows,
    });
    i = j - 1;
  }
  return out;
}

/** 解析 markdown 图片 */
function parseImages(md) {
  const out = [];
  const s = String(md).replace(/\r/g, '');
  const re = /!\[([^\]]*)\]\(\s*([^)\s]*)(?:\s+["']([^"']*)["'])?\s*\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push({ alt: m[1], src: m[2], title: m[3] || '', line: s.slice(0, m.index).split('\n').length });
  }
  return out;
}

// --------------------------------------------------------------- html reader

function loadContainer(html) {
  const $ = cheerio.load(html);
  let container = $('.sl-markdown-content').first();
  if (!container.length) container = $('main .content-panel').first();
  if (!container.length) container = $('main').first();
  const multi = $('.sl-markdown-content').length;
  return { $, container, multi };
}

/** div.expressive-code → { lang, title, code, lines } */
function readCodeBlocks($, container) {
  const out = [];
  container.find('div.expressive-code').each((i, el) => {
    const $el = $(el);
    const title = normWS($el.find('figcaption .title').first().text());
    const pre = $el.find('pre').first();
    const lang = normWS(pre.attr('data-language') || pre.attr('data-lang') || '');
    const lines = [];
    let collapseMarkers = 0;
    const ecLines = pre.find('.ec-line').toArray();
    if (ecLines.length) {
      for (const ln of ecLines) {
        const $ln = $(ln);
        const codeChild = $ln.children('.code').first();
        let text;
        if (codeChild.length) text = codeChild.text();
        else if ($ln.children('.gutter').length) text = '';
        else text = $ln.text();
        text = nbsp(text).replace(/\r/g, '').replace(/\n/g, '');
        if (/^\d+\s+collapsed lines?$/i.test(text.replace(/\s+$/, ''))) { collapseMarkers++; continue; }
        lines.push(text);
      }
    } else {
      lines.push(nbsp(pre.find('code').first().text() || pre.text()).replace(/\r/g, '').replace(/\n/g, ''));
    }
    out.push({
      index: out.length, title, lang,
      code: lines.join('\n'),
      lines,
      collapseMarkers,
      gutterLn: pre.find('.gutter .ln').length,
      hasTitleEl: $el.find('figcaption .title').length > 0,
      hasCopyBtn: $el.find('button').length > 0,
      // 祖先结构决定 Markdown 会怎么承载它（告警→blockquote, details→内层重转换, li→缩进）
      inAside: $el.closest('aside.starlight-aside').length > 0,
      inDetails: $el.closest('details').length > 0,
      inTab: $el.closest('starlight-tabs').length > 0,
      inList: $el.closest('li').length > 0,
      inNodeRoot: $el.closest('.node-root, .not-content.node').length > 0,
    });
  });
  return out;
}

function readAsides($, container) {
  const out = [];
  container.find('aside.starlight-aside').each((i, el) => {
    const $el = $(el);
    const cls = ' ' + ($el.attr('class') || '') + ' ';
    let type = '';
    for (const t of ALERT_TYPES) {
      if (cls.indexOf(' starlight-aside--' + t + ' ') !== -1) { type = t; break; }
    }
    const titleEl = $el.find('.starlight-aside__title').first();
    const title = normWS(titleEl.clone().children('svg').remove().end().text() || titleEl.text());
    const content = $el.find('.starlight-aside__content').first();
    out.push({
      index: out.length,
      type,
      typeRaw: (cls.match(/starlight-aside--([a-z]+)/) || [])[1] || '',
      title,
      body: normWS(content.length ? content.text() : $el.text()),
      inNodeRoot: $el.closest('.node-root, .not-content.node').length > 0,
      inFileTree: $el.closest('starlight-file-tree').length > 0,
      inTab: $el.closest('starlight-tabs').length > 0,
    });
  });
  return out;
}

function readDetails($, container) {
  const out = [];
  container.find('details').each((i, el) => {
    const $el = $(el);
    if ($el.closest('div.expressive-code').length) return; // Expressive Code 的 “N collapsed lines” UI 折叠器，不是正文 details
    const summary = normWS($el.children('summary').first().text());
    const bucket = $el.closest('starlight-file-tree').length ? 'file-tree'
      : $el.closest('.node-root, .not-content.node').length ? 'config-node'
        : $el.closest('starlight-tabs').length ? 'tab'
          : 'content';
    if (bucket !== 'content') return;
    out.push({
      index: out.length, summary,
      hasDirectSummary: $el.children('summary').length > 0,
      isCollapseUi: /^\d+\s+collapsed lines?$/i.test(summary),
      text: clip($el.text(), 120),
      inner: {
        ec: $el.find('div.expressive-code').length,
        tables: $el.find('table').length,
        tabs: $el.find('starlight-tabs').length,
        trees: $el.find('starlight-file-tree').length,
        images: $el.find('img').length,
        nodeRoot: $el.find('.node-root, .not-content.node').length,
        linkCards: $el.find('.sl-link-card').length,
        asides: $el.find('aside.starlight-aside').length,
      },
    });
  });
  return out;
}

function readTables($, container) {
  const out = [];
  container.find('table').each((i, el) => {
    const $t = $(el);
    const rows = [];
    $t.find('tr').each((j, tr) => {
      const cells = $(tr).children('th, td').toArray();
      if (!cells.length) return;
      rows.push({
        isHeaderRow: $(tr).children('th').length > 0 || $(tr).closest('thead').length > 0,
        cells: cells.map((c) => normWS($(c).text())),
        hasBr: $(tr).find('br').length > 0,
        html: $(tr).html() || '',
      });
    });
    out.push({
      index: out.length,
      rows,
      rowCount: rows.length,
      colCount: rows.length ? Math.max(...rows.map((r) => r.cells.length)) : 0,
      inNodeRoot: $t.closest('.node-root, .not-content.node').length > 0,
    });
  });
  return out;
}

/** 文件树：独立于 convert.js 的实现，走 .tree-entry / li 文本 */
function readFileTrees($, container) {
  const out = [];
  container.find('starlight-file-tree').each((i, el) => {
    const entries = [];
    const liCount = $(el).find('li').length;
    const walk = (ul, depth) => {
      $(ul).children('li').each((k, li) => {
        const $li = $(li);
        const childUl = $li.find('ul').first();
        const clone = $li.clone();
        clone.find('ul').remove();
        clone.find('svg, .sr-only').remove();
        const entryEl = clone.find('.tree-entry').first();
        const name = normWS(entryEl.length ? entryEl.text() : clone.text());
        if (name) entries.push({ name, depth, liClass: $li.attr('class') || '' });
        if (childUl.length) walk(childUl, depth + 1);
      });
    };
    const rootUl = $(el).find('ul').first();
    walk(rootUl.length ? rootUl : $(el), 0);
    out.push({
      index: out.length, entries, liCount,
      expected: entries.map((e) => '  '.repeat(e.depth) + e.name).join('\n'),
      nestedDetails: $(el).find('details').length,
    });
  });
  return out;
}

function readTabs($, container) {
  const out = [];
  container.find('starlight-tabs').each((i, el) => {
    const $el = $(el);
    const labels = $el.find('[role=tablist] [role=tab]').toArray().map((a) => normWS($(a).text()));
    const panels = $el.children('[role=tabpanel]').toArray();
    const allPanels = $el.find('[role=tabpanel]').toArray();
    out.push({
      index: out.length,
      syncKey: $el.attr('data-sync-key') || '',
      labels,
      panelCount: panels.length,
      allPanelCount: allPanels.length,
      panelTexts: panels.map((p) => clip($(p).text(), 80)),
    });
  });
  return out;
}

function readImages($, container, pageUrl) {
  const out = [];
  container.find('img').each((i, el) => {
    const $el = $(el);
    const raw = ($el.attr('src') || '').trim();
    let abs = raw;
    try { abs = new URL(raw, pageUrl || 'https://docs.papermc.io/').href; } catch { /* keep */ }
    out.push({
      index: out.length,
      src: abs,
      rawSrc: raw,
      alt: $el.attr('alt') == null ? null : $el.attr('alt'),
      inFileTree: $el.closest('starlight-file-tree').length > 0,
      inTab: $el.closest('starlight-tabs').length > 0,
      cls: $el.attr('class') || '',
    });
  });
  return out;
}

// ------------------------------------------------------------------- checking

function makeIssue(o) {
  return {
    check: o.check,
    severity: o.severity,
    kind: o.kind,
    archive: o.archive,
    rel: o.rel,
    message: o.message,
    evidence: (o.evidence || []).slice(0, 3),
    suggestion: o.suggestion || '',
    converter_suspect: o.converter_suspect !== false,
    count: o.count || 1,
  };
}

function assetRelFromUrl(u) {
  try {
    const p = new URL(u);
    if (!ASSET_HOSTS.includes(p.hostname)) return null;
    return 'assets/' + p.hostname + decodeURIComponent(p.pathname);
  } catch { return null; }
}

function checkPage(ctx) {
  const {
    archive, rel, htmlFile, mdFile, html, md, pageUrl,
    seenMdFenceKeys, seenMdTableIdx, seenMdAlertIdx, seenMdDetailsIdx, seenMdImgIdx,
  } = ctx;
  const issues = [];
  const stats = {};
  const { $, container, multi } = loadContainer(html);
  if (!container.length) {
    issues.push(makeIssue({ check: 'page', severity: 'high', kind: 'no-container', archive, rel,
      message: 'HTML 里找不到 .sl-markdown-content / main 正文容器，无法确定真值',
      evidence: [clip(html, 160)], suggestion: '检查 crawl 保存的 HTML 是否完整' }));
    return { stats, issues, ok: false };
  }
  if (multi > 1) {
    issues.push(makeIssue({ check: 'page', severity: 'low', kind: 'multi-container', archive, rel,
      message: `页面存在 ${multi} 个 .sl-markdown-content，仅取第一个作为真值`,
      evidence: [], suggestion: '仅影响真值选择，不影响结论' }));
  }

  const htmlCode = readCodeBlocks($, container);
  const htmlAsides = readAsides($, container);
  const htmlDetails = readDetails($, container);
  const htmlTables = readTables($, container);
  const htmlTrees = readFileTrees($, container);
  const htmlTabs = readTabs($, container);
  const htmlImgs = readImages($, container, pageUrl);

  const mdCode = parseFences(md);
  const mdAlerts = parseAlerts(md);
  const mdDetails = parseDetails(md);
  const mdTables = parseTables(md);
  const mdImgs = parseImages(md);

  // ---------------------------------------------------------- 1. 围栏代码块
  {
    const c = { html: htmlCode.length, md: mdCode.length, paired: 0, md_extra: 0, md_extra_expected: 0 };
    const used = new Array(mdCode.length).fill(false);
    // Markdown 围栏块的"渲染后正文"：带 blockquote 前缀的（GitHub 告警内）要先剥掉前缀
    const mdRender = mdCode.map((b) => (b.quoted ? dequoteCode(b.code) : b.code));
    const keyIndex = new Map();
    mdCode.forEach((b, i) => {
      const k = keyContent(mdRender[i]);
      if (!k) return;
      if (!keyIndex.has(k)) keyIndex.set(k, []);
      keyIndex.get(k).push(i);
    });
    const mdFlat = squash(dequoteCode(md));
    let missing = 0, langDiff = 0, titleDiff = 0, blankLoss = 0, lostContent = 0, indentOnly = 0, contentDiff = 0;

    for (const hb of htmlCode) {
      const kRaw = keyContent(hb.code);
      const cands = (keyIndex.get(kRaw) || []).filter((i) => !used[i]);
      let pick = cands.length ? cands[0] : -1;
      if (pick < 0 && kRaw) {
        // 兜底：非空行内容整体一致（仅空行数量/位置不同）
        const flat = squash(kRaw);
        for (let i = 0; i < mdCode.length && pick < 0; i++) {
          if (!used[i] && squash(keyContent(mdRender[i])) === flat) pick = i;
        }
      }
      if (pick < 0) {
        // 兜底：内容整体还在文档里，只是形态/位置变了（告警 blockquote、列表缩进等）
        const present = mdFlat.indexOf(squash(hb.code)) !== -1;
        if (!present) {
          missing++; lostContent++;
          issues.push(makeIssue({ check: 'fenced_code', severity: 'high', kind: 'block-lost', archive, rel,
            message: `HTML 代码块 #${hb.index + 1}（lang=${hb.lang || 'none'}${hb.title ? ', title=' + hb.title : ''}，${hb.lines.length} 行）的内容在整篇 Markdown 中完全找不到`,
            evidence: ['HTML: <pre data-language="' + hb.lang + '">' + (hb.title ? ' + figcaption "' + hb.title + '"' : '') + '（' + hb.lines.length + ' 行）',
              '祖先链: ' + [hb.inAside && 'aside.starlight-aside', hb.inDetails && 'details', hb.inTab && 'starlight-tabs', hb.inList && 'li'].filter(Boolean).join(' > ') || '(顶层)',
              clip(hb.lines[0] || '', 90)],
            suggestion: '查 convert.js：rawNode() 的 RAWHASHTOKEN 在嵌套 convertHtml()（normalizeDetails/normalizeTabs）里会被 substituteRaw() 落空而丢弃',
          }));
        } else {
          missing++; indentOnly++;
          issues.push(makeIssue({ check: 'fenced_code', severity: 'low', kind: 'matched-by-fallback', archive, rel,
            message: `HTML 代码块 #${hb.index + 1} 未能精确配对到某个围栏块（内容仍在文档中，形态不同）`,
            evidence: [clip(hb.lines[0] || '', 90)], suggestion: '仅提示，通常由 blockquote/列表缩进造成',
            converter_suspect: false }));
        }
        continue;
      }
      used[pick] = true;
      c.paired++;
      seenMdFenceKeys.add(mdCode[pick].startLine);
      const mb = mdCode[pick];
      const hLang = hb.lang === 'text' || hb.lang === 'plaintext' ? '' : hb.lang;
      if (normWS(mb.lang) !== normWS(hLang)) {
        langDiff++;
        issues.push(makeIssue({ check: 'fenced_code', severity: 'medium', kind: 'lang-mismatch', archive, rel,
          message: `代码块 #${hb.index + 1} 语言不一致：HTML data-language="${hb.lang}" → Markdown "${mb.lang}"`,
          evidence: ['HTML: data-language="' + hb.lang + '" title="' + hb.title + '"',
            'MD  : ```' + mb.info, clip(hb.lines[0] || '', 80)],
          suggestion: '检查 convert.js normalizeCodeBlocks() 的 pre[data-language] 读取与 text/plaintext 映射',
        }));
      }
      if (normWS(mb.title) !== normWS(hb.title)) {
        titleDiff++;
        issues.push(makeIssue({ check: 'fenced_code', severity: 'high', kind: 'title-mismatch', archive, rel,
          message: `代码块 #${hb.index + 1} 文件名丢失/不一致：HTML title="${hb.title}" → Markdown title="${mb.title}"`,
          evidence: ['HTML: <figcaption class="header"><span class="title">' + hb.title + '</span></figcaption>',
            'MD  : ```' + mb.info, clip(hb.lines[0] || '', 80)],
          suggestion: '检查 convert.js normalizeCodeBlocks() 是否取到 figcaption .title；注意 title 是否被 fenceFor() 的引号转义破坏',
        }));
      }
      // 内容逐行比对（先按需去掉 blockquote 前缀）
      const hLines = hb.lines.map((l) => l.replace(/[ \t]+$/, ''));
      const mLines = mdRender[pick].split('\n').map((l) => l.replace(/[ \t]+$/, ''));
      const hNonBlank = hLines.filter((l) => l.trim() !== '');
      const mNonBlank = mLines.filter((l) => l.trim() !== '');
      const hBlank = hLines.length - hNonBlank.length;
      const mBlank = mLines.length - mNonBlank.length;
      const sameText = JSON.stringify(hNonBlank.map((l) => l.trim())) === JSON.stringify(mNonBlank.map((l) => l.trim()));
      if (!sameText) {
        contentDiff++;
        const diffAt = hNonBlank.findIndex((l, i) => l.trim() !== (mNonBlank[i] || '\u0000').trim());
        issues.push(makeIssue({ check: 'fenced_code', severity: 'high', kind: 'content-diff', archive, rel,
          message: `代码块 #${hb.index + 1} 代码正文不一致（HTML ${hNonBlank.length} 非空行 / Markdown ${mNonBlank.length} 非空行，首个差异在第 ${diffAt + 1} 行）`,
          evidence: ['HTML: ' + clip(hNonBlank[diffAt] || '(空)', 95),
            'MD  : ' + clip(mNonBlank[diffAt] || '(空)', 95),
            'MD  第 ' + mb.startLine + ' 行起',
            '代码块祖先: ' + (hb.inAside ? 'aside ' : '') + (hb.inDetails ? 'details ' : '') + (hb.inTab ? 'tabs ' : '') + (hb.inList ? 'li' : '') || '(顶层)'],
          suggestion: '检查 convert.js preBlock 规则的逐行文本抽取与 tidy()' }));
      } else if (hBlank > mBlank) {
        blankLoss++;
        issues.push(makeIssue({ check: 'fenced_code', severity: 'medium', kind: 'blank-line-collapse', archive, rel,
          message: `代码块 #${hb.index + 1} 内部空行被吞：HTML ${hBlank} 个空行 → Markdown ${mBlank} 个（正文文本一致）`,
          evidence: ['HTML: <pre data-language="' + hb.lang + '">（' + hLines.length + ' 行，含 ' + hBlank + ' 空行）',
            'MD  : ' + (mb.indent ? ' '.repeat(mb.indent) : '') + '```' + mb.info + '（' + mLines.length + ' 行，含 ' + mBlank + ' 空行）',
            '正文首个空行位置: HTML 第 ' + (hLines.findIndex((l) => l.trim() === '') + 1) + ' 行'],
          suggestion: 'convert.js tidy() 的 .replace(/\\n{3,}/g, "\\n\\n") 会穿透围栏代码块，把块内连续空行压掉',
        }));
      }
      void hNonBlank;
    }

    // 未配对的 markdown 围栏块分类
    for (let i = 0; i < mdCode.length; i++) {
      if (used[i]) continue;
      const b = mdCode[i];
      c.md_extra++;
      const indented = b.indent >= 2 || /^[ \t]*(?:>[ ]?)+/.test(b.code.split('\n')[0] || '');
      const looksTree = b.lang === '' && !b.title && !/^\s*[|>#]/.test(b.code);
      if (/^ya?ml$/i.test(b.lang) && (b.indent >= 2 || b.title === '')) { c.md_extra_expected++; continue; } // 配置查看器值块
      if (looksTree && htmlTrees.length) { c.md_extra_expected++; continue; }                                 // 文件树
      issues.push(makeIssue({ check: 'fenced_code', severity: 'low', kind: 'md-extra-block', archive, rel,
        message: `Markdown 第 ${b.startLine} 行存在 HTML 中无对应源的围栏块（lang="${b.lang}"${b.title ? ', title="' + b.title + '"' : ''}，${b.code.split('\n').length} 行）`,
        evidence: ['MD  : ' + (b.indent ? ' '.repeat(b.indent) : '') + '```' + b.info,
          clip(b.code.split('\n')[0] || '', 90), clip(b.code.split('\n')[1] || '', 90)],
        suggestion: '确认为文件树/配置值块的合成产物；若否，检查 convert.js 是否重复输出或误吞段落',
        converter_suspect: false,
      }));
    }
    // 折叠提示行不应出现在 Markdown
    const collapseLines = htmlCode.reduce((n, b) => n + b.collapseMarkers, 0);
    if (collapseLines) {
      const leaked = mdCode.filter((b) => /\d+\s+collapsed lines?/i.test(b.code)).length;
      if (leaked) {
        issues.push(makeIssue({ check: 'fenced_code', severity: 'high', kind: 'collapse-marker-leak', archive, rel,
          message: `"N collapsed lines" UI 提示行泄漏进 Markdown（${leaked} 处）`,
          evidence: [clip((mdCode.find((b) => /\d+\s+collapsed lines?/i.test(b.code)) || {}).code || '', 120)],
          suggestion: 'convert.js 的 COLLAPSE_MARKER_RE 未覆盖该形态' }));
      }
    }
    // 行号泄漏
    const lnLeak = mdCode.filter((b) => b.code.split('\n').some((l) => /^\s*\d{1,4}\s*$/.test(l)) && htmlCode.some((h) => h.gutterLn > 0));
    stats.fenced_code = {
      html_blocks: htmlCode.length,
      md_blocks: mdCode.length,
      paired: c.paired,
      html_with_title: htmlCode.filter((b) => b.title).length,
      md_with_title: mdCode.filter((b) => b.title).length,
      md_title_unique: new Set(mdCode.filter((b) => b.title).map((b) => b.title)).size,
      html_with_collapse_marker: collapseLines,
      html_blocks_with_gutter: htmlCode.filter((b) => b.gutterLn > 0).length,
      unmatched: missing, lost_content: lostContent, indent_only_fallback: indentOnly,
      lang_mismatch: langDiff, title_mismatch: titleDiff, blank_line_collapse: blankLoss, content_diff: contentDiff,
      html_blocks_with_inner_blank_lines: htmlCode.filter((b) => b.lines.some((l) => l.trim() === '') ).length,
      html_blocks_with_2plus_consecutive_blanks: htmlCode.filter((b) => /\n\s*\n\s*\n/.test(b.code)).length,
      html_blocks_in_aside: htmlCode.filter((b) => b.inAside).length,
      html_blocks_in_details: htmlCode.filter((b) => b.inDetails && !b.inTab).length,
      html_blocks_in_tab: htmlCode.filter((b) => b.inTab).length,
      md_extra: c.md_extra, md_extra_expected_source: c.md_extra_expected,
      md_suspected_linenumber_leak_blocks: lnLeak.length,
      html_lang_histogram: hist(htmlCode.map((b) => b.lang || '(none)')),
      md_lang_histogram: hist(mdCode.map((b) => b.lang || '(none)')),
    };
  }

  // -------------------------------------------------------------- 2. 告警
  {
    const htmlTypes = hist_all(htmlAsides.map((a) => a.type || '(unknown)'));
    const mdTypes = hist_all(mdAlerts.map((a) => a.type));
    const usedMd = new Array(mdAlerts.length).fill(false);
    let matched = 0, lost = 0, typeDiff = 0, titleDiff = 0;
    for (const ha of htmlAsides) {
      const want = ALERT_NAME[ha.type] || 'NOTE';
      let mi = mdAlerts.findIndex((a, i) => !usedMd[i] && a.type === want && normWS(a.title) === normWS(ha.title));
      if (mi < 0) mi = mdAlerts.findIndex((a, i) => !usedMd[i] && a.type === want);
      if (mi >= 0) {
        usedMd[mi] = true; matched++;
        seenMdAlertIdx.add(mdAlerts[mi].line);
        if (normWS(mdAlerts[mi].title) !== normWS(ha.title)) {
          titleDiff++;
          issues.push(makeIssue({ check: 'alerts', severity: 'medium', kind: 'title-mismatch', archive, rel,
            message: `告警标题不一致：HTML aside[--${ha.type}] 标题="${ha.title}" → Markdown "[!${want}] ${mdAlerts[mi].title}"`,
            evidence: ['HTML: <aside class="starlight-aside starlight-aside--' + ha.type + '" aria-label="' + ha.title + '">',
              'HTML: <p class="starlight-aside__title">' + ha.title + '</p>',
              'MD  : > [!' + mdAlerts[mi].type + '] ' + mdAlerts[mi].title],
            suggestion: '检查 convert.js normalizeAsides() 的 data-aside-title 传递' }));
        }
        continue;
      }
      lost++;
      issues.push(makeIssue({ check: 'alerts', severity: 'high', kind: 'aside-missing', archive, rel,
        message: `HTML 告警（${ha.type}，标题"${ha.title}"）在 Markdown 中没有对应 > [!TYPE] 行`,
        evidence: ['HTML: <aside class="starlight-aside starlight-aside--' + ha.type + '">',
          'HTML 正文: ' + clip(ha.body, 110), 'MD 计数: ' + mdAlerts.length + ' 条告警'],
        suggestion: '检查 convert.js normalizeAsides()/starlightAside 规则是否被上层结构（tabs/details/嵌套 aside）影响',
        converter_suspect: true }));
    }
    mdAlerts.forEach((a, i) => {
      if (usedMd[i]) return;
      issues.push(makeIssue({ check: 'alerts', severity: 'low', kind: 'md-extra-alert', archive, rel,
        message: `Markdown 第 ${a.line} 行有多余告警 > [!${a.type}] ${a.title}`,
        evidence: ['MD  : > [!' + a.type + '] ' + a.title],
        suggestion: '确认是否为 HTML 中重复/嵌套 aside 的正常展开',
        converter_suspect: false }));
    });
    stats.alerts = {
      html_asides: htmlAsides.length,
      md_alerts: mdAlerts.length,
      matched, lost, title_mismatch: titleDiff,
      html_types: htmlTypes, md_types: mdTypes,
      asides_default_title_like: htmlAsides.filter((a) => /^(note|tip|caution|danger|important|warning)$/i.test(a.title)).length,
      asides_in_tab: htmlAsides.filter((a) => a.inTab).length,
      asides_in_node_root: htmlAsides.filter((a) => a.inNodeRoot).length,
    };
  }

  // ------------------------------------------------------- 3. details/summary
  {
    const usedMd = new Array(mdDetails.length).fill(false);
    let matched = 0, lost = 0, diff = 0, bodyLoss = 0;
    for (const hd of htmlDetails) {
      let mi = mdDetails.findIndex((d, i) => !usedMd[i] && d.summary === hd.summary);
      if (mi < 0) mi = mdDetails.findIndex((d, i) => !usedMd[i]);
      if (mi >= 0) {
        usedMd[mi] = true; matched++; seenMdDetailsIdx.add(mdDetails[mi].line);
        const md = mdDetails[mi];
        if (md.summary !== hd.summary) {
          diff++;
          issues.push(makeIssue({ check: 'details', severity: 'medium', kind: 'summary-diff', archive, rel,
            message: `details 的 summary 文本不一致：HTML "${hd.summary}" → Markdown "${md.summary}"`,
            evidence: ['HTML: <summary>' + hd.summary + '</summary>',
              'MD  : <summary>' + md.summary + '</summary>'],
            suggestion: '检查 convert.js normalizeDetails() 的 summary 抽取' }));
        }
        // 折叠体保真：HTML 里 details 内含的结构化元素，是否还出现在 Markdown 的 details 折叠体里
        const innerCount = hd.inner.ec + hd.inner.tables + hd.inner.tabs + hd.inner.trees;
        const mdCount = md.bodyFences + md.bodyTabsSections + (md.bodyTableRows ? 1 : 0);
        if (innerCount > 0 && md.bodyLen === 0) {
          bodyLoss++;
          issues.push(makeIssue({ check: 'details', severity: 'high', kind: 'details-body-lost', archive, rel,
            message: `<details summary="${hd.summary}"> 的折叠体被整段丢弃：HTML 内含 ${innerCount} 个结构化元素（代码块 ${hd.inner.ec}、表格 ${hd.inner.tables}、Tab 组 ${hd.inner.tabs}、文件树 ${hd.inner.trees}），Markdown 折叠体为空`,
            evidence: ['HTML: <details><summary>' + hd.summary + '</summary> … ' + innerCount + ' 个结构化元素 … </details>',
              'MD  : <details><summary>' + md.summary + '</summary>（折叠体为空）</details>',
              'MD  第 ' + md.line + ' 行'],
            suggestion: 'convert.js：rawNode() 写入的 RAWHASHTOKEN 在 normalizeDetails()/normalizeTabs() 的嵌套 convertHtml() 中被 substituteRaw() 落空，应让嵌套转换共享 ctx.raw',
          }));
        } else if (innerCount > 0 && mdCount === 0 && md.bodyLen > 0) {
          bodyLoss++;
          issues.push(makeIssue({ check: 'details', severity: 'high', kind: 'details-body-degraded', archive, rel,
            message: `<details summary="${hd.summary}"> 折叠体里的结构化元素丢失：HTML ${innerCount} 个（代码块 ${hd.inner.ec}、表格 ${hd.inner.tables}、Tab ${hd.inner.tabs}、文件树 ${hd.inner.trees}），Markdown 折叠体里只剩 ${md.bodyLen} 字符纯文本`,
            evidence: ['HTML: <details><summary>' + hd.summary + '</summary> 内 ec=' + hd.inner.ec + ' table=' + hd.inner.tables + ' tabs=' + hd.inner.tabs + '</details>',
              'MD  折叠体: ' + clip(md.body, 110)],
            suggestion: '检查 convert.js 嵌套 convertInner 对 raw token / 结构化元素的处理' }));
        }
        continue;
      }
      lost++;
      issues.push(makeIssue({ check: 'details', severity: 'high', kind: 'details-missing', archive, rel,
        message: `HTML <details>（summary="${hd.summary}"）在 Markdown 中未以原始 HTML 形式保留`,
        evidence: ['HTML: <details><summary>' + hd.summary + '</summary>',
          clip(hd.text, 110), 'MD raw <details> 计数: ' + mdDetails.length],
        suggestion: '检查 convert.js normalizeDetails() 是否被更早的规则（tabs/table/file-tree）抢先消费' }));
    }
    mdDetails.forEach((d, i) => {
      if (usedMd[i]) return;
      issues.push(makeIssue({ check: 'details', severity: 'low', kind: 'md-extra-details', archive, rel,
        message: `Markdown 第 ${d.line} 行有多余 <details>（summary="${d.summary}"）`,
        evidence: ['MD  : <details><summary>' + d.summary + '</summary>'],
        suggestion: '确认来源（嵌套 details / 源 HTML 差异）', converter_suspect: false }));
    });
    stats.details = {
      html_content_details: htmlDetails.length,
      md_details: mdDetails.length,
      matched, lost, summary_mismatch: diff, body_loss: bodyLoss,
      html_details_containing_structure: htmlDetails.filter((d) => d.inner.ec + d.inner.tables + d.inner.tabs + d.inner.trees > 0).length,
      html_summaries: htmlDetails.map((d) => d.summary),
      md_summaries: mdDetails.map((d) => d.summary),
    };
  }

  // ---------------------------------------------------------------- 4. 表格
  {
    const mdT = mdTables;
    let matched = 0;
    const usedMd = new Array(mdT.length).fill(false);
    for (const ht of htmlTables) {
      let mi = -1;
      for (let i = 0; i < mdT.length; i++) {
        if (usedMd[i]) continue;
        if (mdT[i].header.length === ht.colCount || mdT[i].header.length === (ht.rows[0] ? ht.rows[0].cells.length : 0)) { mi = i; break; }
      }
      if (mi < 0) {
        issues.push(makeIssue({ check: 'tables', severity: 'high', kind: 'table-missing', archive, rel,
          message: `HTML 表格（${ht.rowCount} 行 × ${ht.colCount} 列）在 Markdown 中找不到 GFM 表格`,
          evidence: ['HTML 首行: ' + clip((ht.rows[0] ? ht.rows[0].cells.join(' | ') : ''), 110),
            'HTML 行数: ' + ht.rowCount],
          suggestion: '检查 convert.js normalizeTables()/renderTable() 是否被 not-content 清理或 details 抢先替换' }));
        continue;
      }
      usedMd[mi] = true; matched++;
      seenMdTableIdx.add(mdT[mi].startLine);
      const mt = mdT[mi];
      if (mt.rowCount !== ht.rowCount) {
        issues.push(makeIssue({ check: 'tables', severity: 'high', kind: 'row-count', archive, rel,
          message: `表格行数不一致：HTML ${ht.rowCount} 行 → Markdown ${mt.rowCount} 行`,
          evidence: ['HTML 首行: ' + clip(ht.rows[0].cells.join(' | '), 110),
            'MD  header: | ' + mt.header.join(' | ') + ' |',
            'MD  第 ' + mt.startLine + ' 行起，共 ' + mt.rowCount + ' 行'],
          suggestion: '检查 convert.js renderTable() 的 tr 遍历' }));
      }
      // 列数
      const hCols = ht.rows[0] ? ht.rows[0].cells.length : ht.colCount;
      if (mt.header.length !== hCols) {
        issues.push(makeIssue({ check: 'tables', severity: 'high', kind: 'col-count', archive, rel,
          message: `表格列数不一致：HTML 表头 ${hCols} 列 → Markdown ${mt.header.length} 列`,
          evidence: ['HTML: <tr>' + clip(ht.rows[0].html, 120) + '</tr>',
            'MD  : | ' + mt.header.join(' | ') + ' |'],
          suggestion: '检查 renderTable() 的 th/td 选择器与 colspan 处理' }));
      }
      // 单元格文本：Markdown 侧先剥掉行内标记（`code`、**粗**、[链接](url)、<sup>…</sup>），再与 HTML 纯文本比
      let badCells = [];
      for (let r = 0; r < Math.min(mt.rowCount, ht.rowCount); r++) {
        const hr = ht.rows[r], mr = r === 0 ? mt.header : (mt.body[r - 1] || []);
        for (let c2 = 0; c2 < Math.max(hr.cells.length, mr.length); c2++) {
          const hc = normWS(hr.cells[c2] || '');
          const mc = stripInline(normWS(mr[c2] || ''));
          if (hc !== mc) badCells.push({ r, c: c2, html: clip(hc, 70), md: clip(mr[c2] || '', 70) });
        }
      }
      if (badCells.length) {
        issues.push(makeIssue({ check: 'tables', severity: 'medium', kind: 'cell-text', archive, rel,
          message: `表格单元格文本不一致 ${badCells.length} 处（HTML ≤ 与 Markdown）`,
          evidence: badCells.slice(0, 3).map((b) => `[r${b.r}c${b.c}] HTML="${b.html}" MD="${b.md}"`),
          suggestion: '检查 cellText() 的 <br> 转换与转义', count: badCells.length }));
      }
    }
    mdT.forEach((mt, i) => {
      if (usedMd[i]) return;
      issues.push(makeIssue({ check: 'tables', severity: 'medium', kind: 'md-extra-table', archive, rel,
        message: `Markdown 第 ${mt.startLine} 行有多余表格（${mt.rowCount} 行 × ${mt.header.length} 列），HTML 中无对应 <table>`,
        evidence: ['MD  : | ' + mt.header.join(' | ') + ' |'],
        suggestion: '可能是 HTML 表格被合并/拆分，或 CSS 布局被误判为表格', converter_suspect: false }));
    });
    stats.tables = {
      html_tables: htmlTables.length,
      md_tables: mdT.length,
      matched,
      html_rows: htmlTables.reduce((n, t) => n + t.rowCount, 0),
      md_rows: mdT.reduce((n, t) => n + t.rowCount, 0),
      html_cells_with_br: htmlTables.reduce((n, t) => n + t.rows.reduce((m, r) => m + (r.hasBr ? 1 : 0), 0), 0),
    };
  }

  // ------------------------------------------------------- 5a. 文件树
  {
    let matched = 0, lineDiff = 0, lost = 0;
    const usedF = new Set();
    for (const ht of htmlTrees) {
      const expKey = keyOf(ht.expected);
      if (!ht.entries.length) {
        issues.push(makeIssue({ check: 'file_tree', severity: 'low', kind: 'empty-tree', archive, rel,
          message: `HTML starlight-file-tree 没有任何可见条目（${ht.liCount} 个空 <li>），Markdown 侧无需输出`,
          evidence: ['HTML: <starlight-file-tree class="not-content …"><ul>…</ul></starlight-file-tree>'],
          suggestion: '仅提示', converter_suspect: false }));
        continue;
      }
      let ci = -1;
      for (let i = 0; i < mdCode.length; i++) {
        if (usedF.has(i)) continue;
        if (keyOf(mdCode[i].code) === expKey) { ci = i; break; }
        if (ht.entries.length && keyOf(mdCode[i].code).indexOf(keyOf(ht.entries[0].name)) !== -1 &&
          Math.abs(mdCode[i].code.split('\n').length - ht.entries.length) <= 3) { ci = i; break; }
      }
      if (ci < 0) {
        // 宽松匹配：找包含首个条目名的无语言围栏块
        for (let i = 0; i < mdCode.length; i++) {
          if (usedF.has(i)) continue;
          if (mdCode[i].lang === '' && ht.entries.length && mdCode[i].code.indexOf(ht.entries[0].name) !== -1) { ci = i; break; }
        }
      }
      if (ci < 0) {
        lost++;
        issues.push(makeIssue({ check: 'file_tree', severity: 'high', kind: 'tree-missing', archive, rel,
          message: `HTML 文件树（${ht.liCount} 个 <li>，${ht.entries.length} 条目）在 Markdown 中没有对应目录树代码块`,
          evidence: ['HTML 根条目: ' + clip(ht.entries.slice(0, 3).map((e) => e.name).join(' / '), 110),
            'HTML: <starlight-file-tree class="not-content …">'],
          suggestion: '检查 convert.js normalizeFileTrees() 的 starlight-file-tree 选择器是否命中' }));
        continue;
      }
      usedF.add(ci); matched++;
      seenMdFenceKeys.add(mdCode[ci].startLine);
      const ml = mdCode[ci].code.split('\n').filter((l) => l.trim() !== '').length;
      if (ml !== ht.entries.length) {
        lineDiff++;
        issues.push(makeIssue({ check: 'file_tree', severity: 'high', kind: 'line-count', archive, rel,
          message: `文件树条目数不一致：HTML ${ht.entries.length} 条目（${ht.liCount} 个 li）→ Markdown ${ml} 行`,
          evidence: ['HTML 条目: ' + clip(ht.entries.map((e) => e.name).join(' | '), 110),
            'MD  第 ' + mdCode[ci].startLine + ' 行块: ' + clip(mdCode[ci].code.split('\n').slice(0, 3).join(' / '), 110)],
          suggestion: '检查 convert.js renderFileTree() 的嵌套 details>ul 遍历是否漏掉一层' }));
      }
      // 缩进层级
      const mdDepths = mdCode[ci].code.split('\n').filter((l) => l.trim() !== '')
        .map((l) => (l.match(/^( *)/) || ['', ''])[1].length / 2);
      const htmlDepths = ht.entries.map((e) => e.depth);
      if (JSON.stringify(mdDepths) !== JSON.stringify(htmlDepths)) {
        issues.push(makeIssue({ check: 'file_tree', severity: 'medium', kind: 'indent-depth', archive, rel,
          message: `文件树层级不一致：HTML 深度 [${htmlDepths.join(',')}] → Markdown 缩进层级 [${mdDepths.join(',')}]`,
          evidence: ['HTML: ' + clip(ht.expected.split('\n').slice(0, 3).join(' ⏎ '), 110),
            'MD  : ' + clip(mdCode[ci].code.split('\n').slice(0, 3).join(' ⏎ '), 110)],
          suggestion: '检查 renderFileTree() 的 depth 递增' }));
      }
    }
    stats.file_tree = {
      html_trees: htmlTrees.length,
      html_li: htmlTrees.reduce((n, t) => n + t.liCount, 0),
      html_entries: htmlTrees.reduce((n, t) => n + t.entries.length, 0),
      matched, lost, line_count_diff: lineDiff,
      tree_entries_sample: htmlTrees.slice(0, 3).map((t) => t.entries.map((e) => '  '.repeat(e.depth) + e.name).slice(0, 8)),
    };
  }

  // ------------------------------------------------------- 5b. Tab
  {
    let matched = 0, labelMissing = 0, panelDiff = 0;
    const missingLabels = new Set();
    const mdH4 = [];
    md.replace(/\r/g, '').split('\n').forEach((l, i) => {
      const m = /^#{4,6}\s+(.*)$/.exec(l);
      if (m) mdH4.push({ text: normWS(m[1]), line: i + 1 });
    });
    htmlTabs.forEach((ht, gi) => {
      const found = ht.labels.filter((lb) => mdH4.some((h) => h.text === lb));
      const missing = ht.labels.filter((lb) => !mdH4.some((h) => h.text === lb));
      if (!missing.length) matched++;
      else {
        labelMissing += missing.length;
        missing.forEach((l) => missingLabels.add(l));
        issues.push(makeIssue({ check: 'tabs', severity: 'high', kind: 'tab-label-missing', archive, rel,
          message: `Tab 标签在 Markdown 中缺少对应 "#### 标签" 小节：${missing.map((s) => '"' + s + '"').join(', ')}（HTML 面板 ${ht.panelCount} 个）`,
          evidence: ['HTML: <a role="tab">' + clip(ht.labels.join('</a> <a role="tab">'), 110) + '</a>',
            'MD  存在的 h4+: ' + clip(mdH4.map((h) => h.text).filter((t) => ht.labels.includes(t)).join(' | ') || '(无)', 110)],
          suggestion: '检查 convert.js normalizeTabs() 的 [role=tab] 与 [role=tabpanel] 配对',
          count: missing.length }));
      }
      if (ht.panelCount === 0 && ht.labels.length) {
        issues.push(makeIssue({ check: 'tabs', severity: 'medium', kind: 'tab-panel-shape', archive, rel,
          message: `starlight-tabs 的 [role=tabpanel] 不是直接子元素（labels=${ht.labels.length} panels=${ht.panelCount}），convert.js 用 children() 会取不到面板`,
          evidence: ['HTML: <starlight-tabs data-sync-key="' + ht.syncKey + '">',
            'HTML: labels=' + ht.labels.length + ' directPanels=' + ht.panelCount + ' descendantPanels=' + ht.allPanelCount],
          suggestion: 'convert.js normalizeTabs() 的 $el.children("[role=tabpanel]") 应改为 find()' }));
      }
      // 每个标签出现次数应与同名面板数一致（整页聚合，避免多组同名标签误报）
      if (gi === 0) {
        const htmlLabelCounts = {};
        htmlTabs.forEach((t) => t.labels.forEach((lb) => { htmlLabelCounts[lb] = (htmlLabelCounts[lb] || 0) + 1; }));
        const alreadyMissing = missingLabels;
        for (const [lb, n] of Object.entries(htmlLabelCounts)) {
          if (alreadyMissing.has(lb)) continue; // 已作为“标签整段丢失”报告过，不重复计
          const got = mdH4.filter((h) => h.text === lb).length;
          if (got !== n) {
            panelDiff++;
            issues.push(makeIssue({ check: 'tabs', severity: 'medium', kind: 'tab-count', archive, rel,
              message: `Tab 标签 "${lb}" 数量不一致：HTML ${n} 个同名面板 → Markdown ${got} 个 "#### ${lb}" 小节`,
              evidence: ['HTML: labels=' + clip(htmlTabs.map((t) => t.labels.join(' | ')).join(' || '), 110),
                'MD  全页 "#### ' + lb + '" 计数 = ' + got + '，HTML 同名面板 = ' + n],
              suggestion: '检查 normalizeTabs() 面板/标签索引配对' }));
          }
        }
      }
    });
    stats.tabs = {
      html_tabs: htmlTabs.length,
      html_panels: htmlTabs.reduce((n, t) => n + t.panelCount, 0),
      html_labels: htmlTabs.reduce((n, t) => n + t.labels.length, 0),
      matched, label_missing: labelMissing, count_diff: panelDiff,
      md_h4_total: mdH4.length,
      labels_sample: htmlTabs.slice(0, 4).map((t) => t.labels.join(' | ')),
    };
  }

  // ---------------------------------------------------------------- 6. 图片
  {
    const mdDir = path.dirname(mdFile);
    const usedMd = new Array(mdImgs.length).fill(false);
    let matched = 0, lost = 0, missingFile = 0, altLost = 0, notLocalized = 0, external = 0, dataUri = 0;
    const isData = (s) => /^data:/i.test(s);
    const isRemote = (s) => /^https?:\/\//i.test(s);
    for (const hi of htmlImgs) {
      if (hi.inFileTree) continue;
      const want = hi.src;
      let mi = mdImgs.findIndex((m, i) => !usedMd[i] && (m.src === want || (assetRelFromUrl(want) && m.src.endsWith(path.basename(assetRelFromUrl(want))))));
      if (mi < 0) mi = mdImgs.findIndex((m, i) => !usedMd[i] && m.alt === hi.alt && hi.alt);
      if (mi < 0) {
        lost++;
        issues.push(makeIssue({ check: 'images', severity: 'high', kind: 'image-missing', archive, rel,
          message: `HTML <img>（alt="${hi.alt || ''}"，src=${clip(want, 60)}）在 Markdown 中找不到对应 ![]()`,
          evidence: ['HTML: <img src="' + clip(want, 80) + '" alt="' + (hi.alt || '') + '">'],
          suggestion: '检查 convert.js cleanup() 是否误删图片容器（div.figure 等）' }));
        continue;
      }
      usedMd[mi] = true; matched++;
      seenMdImgIdx.add(mdImgs[mi].line);
      const m = mdImgs[mi];
      // alt
      const hAlt = normWS(hi.alt == null ? '' : hi.alt);
      if (normWS(m.alt) !== hAlt) {
        altLost++;
        issues.push(makeIssue({ check: 'images', severity: 'medium', kind: 'alt-mismatch', archive, rel,
          message: `图片 alt 文本不一致：HTML alt="${hAlt}" → Markdown alt="${m.alt}"`,
          evidence: ['HTML: <img src="' + clip(want, 70) + '" alt="' + hAlt + '">',
            'MD  : ![' + m.alt + '](' + clip(m.src, 60) + ')'],
          suggestion: '检查 absolutize()/turndown 的 alt 保留' }));
      }
      // 本地化与存在性
      if (isData(m.src)) {
        dataUri++; // 内联 data: URI，自带内容，无需文件系统校验
      } else if (isRemote(m.src)) {
        const remoteAsset = assetRelFromUrl(want);
        if (remoteAsset) {
          notLocalized++;
          issues.push(makeIssue({ check: 'images', severity: 'medium', kind: 'image-not-localized', archive, rel,
            message: `站点资产图片仍是远程 URL，未落到本地 assets（资源下载失败时 crawl.js 不会重写）：${clip(m.src, 80)}`,
            evidence: ['MD  : ![' + m.alt + '](' + clip(m.src, 80) + ')',
              'HTML: <img src="' + clip(want, 80) + '">',
              '期望本地路径: ' + remoteAsset],
            suggestion: '检查 crawl.js 资产下载与 rewriteAssetLinks()，或该 URL 是否被上游删除',
            converter_suspect: false }));
        } else {
          external++; // 第三方外链图片（如 imgs.xkcd.com），保持远程是正确行为
        }
      } else {
        const abs = path.resolve(mdDir, m.src);
        if (!fs.existsSync(abs)) {
          missingFile++;
          issues.push(makeIssue({ check: 'images', severity: 'high', kind: 'image-file-missing', archive, rel,
            message: `Markdown 图片路径在文件系统上不存在：${m.src}`,
            evidence: ['MD  : ![' + m.alt + '](' + m.src + ')', '解析为: ' + clip(abs, 120)],
            suggestion: '检查 crawl.js rewriteAssetLinks() 的相对路径计算',
            converter_suspect: false }));
        } else if (assetRelFromUrl(want)) {
          const expect = path.resolve(path.join(REPO, archive, assetRelFromUrl(want)));
          if (path.resolve(abs).toLowerCase() !== expect.toLowerCase()) {
            issues.push(makeIssue({ check: 'images', severity: 'low', kind: 'image-path-mismatch', archive, rel,
              message: '图片路径与 HTML 源 URL 推出的本地资产路径不一致',
              evidence: ['MD  : ' + clip(m.src, 90),
                '期望: ' + clip(path.relative(mdDir, expect).split(path.sep).join('/'), 90)],
              suggestion: '检查 crawl.js 资产命名规则', converter_suspect: false }));
          }
        }
      }
    }
    mdImgs.forEach((m, i) => {
      if (usedMd[i]) return;
      let exists = null;
      if (!isRemote(m.src) && !isData(m.src)) exists = fs.existsSync(path.resolve(mdDir, m.src));
      issues.push(makeIssue({ check: 'images', severity: exists === false ? 'high' : 'low',
        kind: exists === false ? 'md-extra-image-missing-file' : 'md-extra-image', archive, rel,
        message: `Markdown 第 ${m.line} 行有多余图片 ![](${clip(m.src, 60)})${exists === false ? '（本地文件不存在）' : ''}`,
        evidence: ['MD  : ![' + m.alt + '](' + clip(m.src, 80) + ')'],
        suggestion: '确认来源（HTML 中可能来自 <picture>/<source> 或 CSS 背景）', converter_suspect: false }));
    });
    stats.images = {
      html_imgs: htmlImgs.length,
      md_imgs: mdImgs.length,
      matched, lost, alt_mismatch: altLost, missing_file: missingFile, not_localized: notLocalized,
      external_md: mdImgs.filter((m) => isRemote(m.src)).length,
      data_uri_md: mdImgs.filter((m) => isData(m.src)).length,
      external_thirdparty: external, data_uri_html: dataUri,
      no_alt_html: htmlImgs.filter((i) => !normWS(i.alt || '')).length,
      checked_on_disk: mdImgs.filter((m) => !isRemote(m.src) && !isData(m.src)).length,
    };
  }

  return { stats, issues, html, md };
}

function hist(arr) {
  const h = {};
  arr.forEach((a) => { h[a] = (h[a] || 0) + 1; });
  return Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1]));
}
const hist_all = hist;

// ------------------------------------------------------------------- main run

function auditArchive(archiveArg) {
  const archive = archiveArg.split(path.sep).join('/').replace(/\/+$/, '');
  const dir = path.resolve(REPO, archive);
  const htmlRoot = path.join(dir, 'html');
  const mdRoot = path.join(dir, 'markdown');
  const htmlFiles = walk(htmlRoot).filter((f) => f.toLowerCase().endsWith('.html')).sort();
  // manifest 提供 rel → 原始页面 URL，用于把 HTML 里的根相对 src（/_astro/…）还原成绝对 URL
  const relUrl = new Map();
  let manifestPrefix = 'https://docs.papermc.io/';
  try {
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    manifestPrefix = man.prefix || manifestPrefix;
    for (const p of man.pages || []) if (p.rel) relUrl.set(p.rel, p.url);
  } catch { /* manifest 缺失时退化为前缀推导 */ }
  const pages = [];
  const allIssues = [];
  const seenMdFenceKeys = new Set();
  const tail = { alert: new Set(), table: new Set(), details: new Set(), image: new Set() };

  for (const htmlFile of htmlFiles) {
    // html/<rel>.html  ↔  markdown/<rel>.md（rel 形如 anti-xray/index）
    const rel = path.relative(htmlRoot, htmlFile).split(path.sep).join('/').replace(/\.html$/i, '');
    const mdFile = path.join(mdRoot, rel + '.md');
    const page = { rel, html: path.relative(REPO, htmlFile).split(path.sep).join('/'), md: path.relative(REPO, mdFile).split(path.sep).join('/') };
    if (!fs.existsSync(mdFile)) {
      allIssues.push(makeIssue({ check: 'page', severity: 'high', kind: 'md-missing', archive, rel,
        message: 'Markdown 产物缺失：' + page.md,
        evidence: [page.html], suggestion: '重新运行 tools/crawl.js --from-html', converter_suspect: false }));
      pages.push({ ...page, status: 'md-missing' });
      continue;
    }
    let html = '', md = '';
    try { html = fs.readFileSync(htmlFile, 'utf8'); md = fs.readFileSync(mdFile, 'utf8'); } catch (e) {
      pages.push({ ...page, status: 'read-error:' + e.message });
      continue;
    }
    const pageUrl = relUrl.get(rel) || (manifestPrefix + rel.replace(/\/index$/, '') + '/');
    try {
      const res = checkPage({
        archive, rel, htmlFile, mdFile, html, md, pageUrl,
        seenMdFenceKeys, seenMdTableIdx: tail.table, seenMdAlertIdx: tail.alert,
        seenMdDetailsIdx: tail.details, seenMdImgIdx: tail.image,
      });
      allIssues.push(...res.issues);
      pages.push({ ...page, status: 'ok', stats: res.stats });
    } catch (e) {
      pages.push({ ...page, status: 'check-error:' + e.message });
      allIssues.push(makeIssue({ check: 'page', severity: 'medium', kind: 'check-crash', archive, rel,
        message: '审计过程异常：' + e.message, evidence: [String(e.stack || '').split('\n')[1] || ''],
        suggestion: '脚本对该页结构处理失败，需单独查看', converter_suspect: false }));
    }
  }
  return { archive, dir: path.relative(REPO, dir).split(path.sep).join('/'), pages, issues: allIssues };
}

function summarize(archive, checks) {
  const rows = {};
  const pageOk = new Set(archive.pages.filter((p) => p.status === 'ok').map((p) => p.rel));
  for (const c of checks) {
    const issues = archive.issues.filter((i) => i.check === c);
    const affected = new Set(issues.filter((i) => i.severity !== 'low').map((i) => i.rel));
    rows[c] = {
      pages_checked: pageOk.size,
      pages_with_issue: affected.size,
      pages_passed: pageOk.size - affected.size,
      issues: issues.length,
      issues_by_severity: { high: issues.filter((i) => i.severity === 'high').length, medium: issues.filter((i) => i.severity === 'medium').length, low: issues.filter((i) => i.severity === 'low').length },
      affected_elements: issues.filter((i) => i.severity !== 'low').reduce((n, i) => n + (i.count || 1), 0),
    };
  }
  return rows;
}

const CHECKS = [
  ['fenced_code', '围栏代码块'],
  ['alerts', 'GitHub 告警'],
  ['details', '<details>/<summary>'],
  ['tables', '表格'],
  ['file_tree', '文件树'],
  ['tabs', 'Tab 组'],
  ['images', '图片'],
  ['page', '页面级'],
];

// 每个检查项在页级 stats 里的计数指标，用于汇总"影响面/覆盖面"
const METRICS = [
  ['fenced_code', 'fenced_code', 'html_blocks', 'HTML div.expressive-code 代码块'],
  ['fenced_code', 'fenced_code', 'md_blocks', 'Markdown 围栏块'],
  ['fenced_code', 'fenced_code', 'paired', '精确配对成功'],
  ['fenced_code', 'fenced_code', 'html_with_title', 'HTML 带文件名 (figcaption .title)'],
  ['fenced_code', 'fenced_code', 'md_with_title', 'Markdown 带 title="…"'],
  ['fenced_code', 'fenced_code', 'html_blocks_in_aside', '代码块位于告警内'],
  ['fenced_code', 'fenced_code', 'html_blocks_in_details', '代码块位于 details 内'],
  ['fenced_code', 'fenced_code', 'html_blocks_with_2plus_consecutive_blanks', '含连续空行的代码块'],
  ['fenced_code', 'fenced_code', 'html_with_collapse_marker', '"N collapsed lines" UI 行'],
  ['alerts', 'alerts', 'html_asides', 'HTML aside.starlight-aside'],
  ['alerts', 'alerts', 'md_alerts', 'Markdown > [!TYPE]'],
  ['alerts', 'alerts', 'matched', '类型+标题完全一致'],
  ['details', 'details', 'html_content_details', 'HTML 正文 <details>'],
  ['details', 'details', 'md_details', 'Markdown <details>'],
  ['details', 'details', 'html_details_containing_structure', '折叠体内含结构化元素'],
  ['tables', 'tables', 'html_tables', 'HTML <table>'],
  ['tables', 'tables', 'md_tables', 'Markdown GFM 表格'],
  ['tables', 'tables', 'html_rows', 'HTML 表格行'],
  ['tables', 'tables', 'md_rows', 'Markdown 表格行'],
  ['file_tree', 'file_tree', 'html_trees', 'HTML starlight-file-tree'],
  ['file_tree', 'file_tree', 'html_li', 'HTML 树内 <li>'],
  ['file_tree', 'file_tree', 'html_entries', 'HTML 树条目（去图标/SR 文本）'],
  ['file_tree', 'file_tree', 'matched', 'Markdown 目录树代码块配对成功'],
  ['tabs', 'tabs', 'html_tabs', 'HTML starlight-tabs'],
  ['tabs', 'tabs', 'html_panels', 'HTML tabpanel'],
  ['tabs', 'tabs', 'html_labels', 'HTML tab 标签'],
  ['tabs', 'tabs', 'matched', 'Tab 组标签全部落到 Markdown'],
  ['images', 'images', 'html_imgs', 'HTML 正文 <img>'],
  ['images', 'images', 'md_imgs', 'Markdown ![]()'],
  ['images', 'images', 'matched', '图片配对成功'],
  ['images', 'images', 'checked_on_disk', '在文件系统上校验的本地图片'],
  ['images', 'images', 'no_alt_html', 'HTML 缺 alt 的图片'],
];

function collectMetrics(pageList, check, statKey, subKey) {
  let n = 0;
  for (const p of pageList) {
    const s = p.stats && p.stats[statKey];
    if (s && typeof s[subKey] === 'number') n += s[subKey];
  }
  return n;
}

function main() {
  const run = { generated_at: new Date().toISOString(), repo: REPO, archives: [] };
  const totalsByCheck = {};
  for (const a of ARCHIVE_ARGS) {
    const res = auditArchive(a);
    res.summary = summarize(res, CHECKS.map((c) => c[0]));
    res.metrics = {};
    for (const [check, statKey, subKey, label] of METRICS) {
      if (!res.metrics[check]) res.metrics[check] = [];
      res.metrics[check].push({ label, value: collectMetrics(res.pages, check, statKey, subKey) });
    }
    run.archives.push(res);
  }
  // 合并统计
  for (const [k, label] of CHECKS) {
    const t = { label, archives: 0, pages_checked: 0, pages_passed: 0, pages_with_issue: 0, issues: 0, high: 0, medium: 0, low: 0, affected_elements: 0 };
    for (const a of run.archives) {
      const s = a.summary[k];
      if (!s) continue;
      t.archives++;
      t.pages_checked += s.pages_checked;
      t.pages_passed += s.pages_passed;
      t.pages_with_issue += s.pages_with_issue;
      t.issues += s.issues;
      t.high += s.issues_by_severity.high;
      t.medium += s.issues_by_severity.medium;
      t.low += s.issues_by_severity.low;
      t.affected_elements += s.affected_elements;
    }
    totalsByCheck[k] = t;
  }
  run.metrics = {};
  for (const [check, statKey, subKey, label] of METRICS) {
    if (!run.metrics[check]) run.metrics[check] = [];
    const all = run.metrics[check];
    const found = all.find((m) => m.label === label);
    const sum = run.archives.reduce((n, a) => n + collectMetrics(a.pages, check, statKey, subKey), 0);
    if (found) found.value += sum; else all.push({ label, value: sum });
  }
  run.totals_by_check = totalsByCheck;
  run.totals = {
    pages: run.archives.reduce((n, a) => n + a.pages.length, 0),
    pages_ok: run.archives.reduce((n, a) => n + a.pages.filter((p) => p.status === 'ok').length, 0),
    issues: run.archives.reduce((n, a) => n + a.issues.length, 0),
    issues_real: run.archives.reduce((n, a) => n + a.issues.filter((i) => i.severity !== 'low').length, 0),
    by_severity: {
      high: run.archives.reduce((n, a) => n + a.issues.filter((i) => i.severity === 'high').length, 0),
      medium: run.archives.reduce((n, a) => n + a.issues.filter((i) => i.severity === 'medium').length, 0),
      low: run.archives.reduce((n, a) => n + a.issues.filter((i) => i.severity === 'low').length, 0),
    },
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const outFile = path.join(REPORTS_DIR, 'audit-render.json');
  fs.writeFileSync(outFile, JSON.stringify(run, null, 2) + '\n', 'utf8');

  // ---------------------------------------------------------------- console
  console.log('渲染元素保真度审计 — HTML → Markdown');
  console.log('生成时间: ' + run.generated_at);
  console.log('');
  for (const a of run.archives) {
    console.log('=== ' + a.archive + '  (' + a.pages.length + ' 页) ===');
    for (const [k, label] of CHECKS) {
      const s = a.summary[k];
      if (!s) continue;
      const flag = s.issues_by_severity.high ? 'HIGH' : s.issues_by_severity.medium ? 'MED ' : s.issues ? 'LOW ' : 'OK  ';
      console.log(
        '  [' + flag + '] ' + label.padEnd(20) +
        ' 页 ' + String(s.pages_passed).padStart(3) + '/' + s.pages_checked +
        ' 通过  问题 ' + String(s.issues).padStart(4) +
        '  (H' + s.issues_by_severity.high + '/M' + s.issues_by_severity.medium + '/L' + s.issues_by_severity.low + ')' +
        '  影响元素 ' + s.affected_elements
      );
    }
    console.log('');
  }
  console.log('=== 合计 ===');
  console.log('  页数 ' + run.totals.pages_ok + '/' + run.totals.pages + ' 审计成功');
  console.log('  问题 ' + run.totals.issues + ' 条（真实缺陷 ' + run.totals.issues_real +
    '，低置信/提示 ' + run.totals.by_severity.low + '）  H' + run.totals.by_severity.high +
    ' / M' + run.totals.by_severity.medium + ' / L' + run.totals.by_severity.low);
  console.log('  JSON: ' + path.relative(REPO, outFile).split(path.sep).join('/'));
  return run;
}

if (require.main === module) main();
module.exports = { main, parseFences, parseAlerts, parseDetails, parseTables, parseImages, loadContainer };
