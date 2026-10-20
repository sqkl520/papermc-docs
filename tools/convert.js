'use strict';
/**
 * convert.js — HTML -> Markdown for the PaperMC Docs site (Astro + Starlight).
 *
 * The site is Astro/Starlight. Document body lives in `.sl-markdown-content` and uses
 * a handful of custom components:
 *   - div.expressive-code / figure.frame / figcaption.title + pre[data-language]   (code blocks)
 *   - aside.starlight-aside--note|tip|caution|danger                               (callouts)
 *   - starlight-file-tree  (nested ul/li.project.directory|file)                    (file trees)
 *   - starlight-tabs + [role=tablist] + [role=tabpanel]                            (tabs)
 *   - div.not-content.node.node-root > section                                     (YAML config viewers)
 *   - div.sl-link-card / div.card-grid                                             (card links)
 *   - details>summary.line (config leaves)                                          (config leaves)
 *   - div.sl-heading-wrapper (h1..h6 + anchor link)
 *
 * Strategy: normalise the component soup into a small set of synthetic elements
 * (`ec-block`, `md-raw`) plus plain HTML that Turndown already understands, then run
 * Turndown with GFM tables disabled in favour of our own table builder.
 */

const cheerio = require('cheerio');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

const ASIDE_TYPES = ['note', 'tip', 'caution', 'danger', 'important', 'warning'];
const ALERT_NAME = {
  note: 'NOTE',
  tip: 'TIP',
  caution: 'CAUTION',
  danger: 'DANGER',
  important: 'IMPORTANT',
  warning: 'WARNING',
};

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const unb64 = (s) => Buffer.from(String(s || ''), 'base64').toString('utf8');

// ---------------------------------------------------------------- small helpers

function normSpace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function fenceFor(code, lang, title) {
  let fence = '```';
  while (code.includes(fence)) fence += '`';
  let info = '';
  if (lang) info += lang;
  if (title) info += (info ? ' ' : '') + 'title="' + String(title).replace(/"/g, "'") + '"';
  return fence + info + '\n' + code.replace(/[ \t]+$/gm, '').replace(/\s+$/, '') + '\n' + fence;
}

function indentBlock(md, spaces) {
  const pad = ' '.repeat(spaces);
  return md
    .split('\n')
    .map((l) => (l.trim() ? pad + l : ''))
    .join('\n');
}

function cellText(md) {
  return md
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('<br>')
    .replace(/(?<!\\)\|/g, '\\|')
    .trim();
}

// ------------------------------------------------------------ turndown instance

function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    br: '  \n',
  });

  td.use(gfm);

  // Code blocks are carried in <pre> so that domino's whitespace collapsing leaves
  // them alone; this rule renders them with language + title from attributes.
  td.addRule('preBlock', {
    filter: (n) => tagName(n) === 'pre',
    replacement: (c, n) => {
      const lines = [];
      const walk = (el) => {
        for (const ch of el.childNodes || el.children || []) {
          if (tagName(ch) === 'div') {
            const codeChild = (ch.childNodes || ch.children || []).find(
              (x) => tagName(x) === 'div' && hasClass(x, 'code')
            );
            if (codeChild) lines.push(nodeText(codeChild));
            else walk(ch);
          }
        }
      };
      walk(n);
      let code = lines.length ? lines.join('\n') : nodeText(n);
      code = code.replace(/\u00a0/g, ' ').replace(/^\n+/, '').replace(/\s+$/, '');
      let lang = getAttr(n, 'data-language') || getAttr(n, 'data-lang');
      if (lang === 'text' || lang === 'plaintext' || lang === 'txt') lang = '';
      const title = getAttr(n, 'data-title');
      return '\n\n' + fenceFor(code, lang, title) + '\n\n';
    },
  });

  // Starlight callouts -> GitHub alerts.
  td.addRule('starlightAside', {
    filter: (n) => tagName(n) === 'aside' && hasClass(n, 'starlight-aside'),
    replacement: (content, n) => {
      const cls = ' ' + getAttr(n, 'class') + ' ';
      let type = 'note';
      for (const t of ASIDE_TYPES) {
        if (cls.indexOf(' starlight-aside--' + t + ' ') !== -1) { type = t; break; }
      }
      const title = normSpace(getAttr(n, 'data-aside-title'));
      const body = content.trim();
      const head = '> [!' + (ALERT_NAME[type] || 'NOTE') + ']' + (title ? ' ' + title : '');
      const lines = body.split('\n').map((l) => (l.trim() ? '> ' + l : '>'));
      return '\n\n' + head + '\n' + lines.join('\n') + '\n\n';
    },
  });

  td.addRule('supSub', {
    filter: ['sup', 'sub'],
    replacement: (content, n) => '<' + tagName(n) + '>' + content + '</' + tagName(n) + '>',
  });

  td.addRule('kbdTag', {
    filter: 'kbd',
    replacement: (content) => '<kbd>' + content + '</kbd>',
  });

  // Anchored headings lose their visible heading text in the anchor span; drop anchors.
  td.addRule('anchorIcon', {
    filter: (n) => tagName(n) === 'a' && hasClass(n, 'sl-anchor-link'),
    replacement: () => '',
  });

  // A gentler escaper than Turndown's default (which escapes every `_` and `-`).
  td.escape = function (string) {
    return String(string)
      .replace(/\\/g, '\\\\')
      .replace(/^(#{1,6}) /gm, '\\$1 ')
      .replace(/^(\d+)\. /gm, '$1\\. ')
      .replace(/^- /gm, '\\- ');
  };

  return td;
}

function textOf(node) {
  if (!node) return '';
  // cheerio/domhandler uses { type: 'text', data }; domino/browser uses { nodeName: '#text', data }
  if (node.type === 'text' || node.nodeName === '#text') return node.data || '';
  const kids = node.childNodes || node.children || [];
  let out = '';
  for (const ch of kids) out += textOf(ch);
  return out;
}

function nodeText(node) {
  if (!node) return '';
  if (typeof node.textContent === 'string') return node.textContent;
  return textOf(node);
}

/**
 * Tag name, lower-cased, for both node shapes:
 *  - cheerio/domhandler: tagName / name, no nodeName
 *  - turndown's internal DOM (domino): nodeName / tagName, upper-case
 */
function tagName(node) {
  const raw = (node && (node.tagName || node.nodeName || node.name)) || '';
  return String(raw).toLowerCase();
}

function getAttr(node, name) {
  if (!node) return '';
  if (node.attribs && typeof node.attribs[name] === 'string') return node.attribs[name];
  if (typeof node.getAttribute === 'function') {
    const v = node.getAttribute(name);
    if (v != null) return v;
  }
  if (node.attributes) {
    const found = Array.prototype.find.call(
      node.attributes,
      (a) => a && (a.name === name)
    );
    if (found) return found.value != null ? found.value : '';
  }
  return '';
}

function hasClass(node, cls) {
  if (node && node.classList && typeof node.classList.contains === 'function') {
    return node.classList.contains(cls);
  }
  return String(getAttr(node, 'class')).split(/\s+/).indexOf(cls) !== -1;
}

// --------------------------------------------------------------- preprocessing

function isEmptyEl($, el) {
  const tag = el.tagName;
  if (['BR', 'HR', 'IMG'].includes(tag.toUpperCase())) return false;
  return $(el).text().trim() === '' && $(el).find('img').length === 0;
}

function absolutize($, baseUrl) {
  const base = new URL(baseUrl);
  $('a[href]').each((i, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:|data:)/i.test(href)) return;
    try {
      const abs = new URL(href, base);
      $(el).attr('href', abs.href);
    } catch { /* keep as-is */ }
  });
  $('img[src]').each((i, el) => {
    const src = ($(el).attr('src') || '').trim();
    if (!src || /^data:/i.test(src)) return;
    try {
      $(el).attr('src', new URL(src, base).href);
    } catch { /* keep as-is */ }
  });
}

function cleanup($) {
  $('script, style, link, meta, template, noscript, button, svg, canvas, input, select').remove();
  $('.sr-only').remove();
  $('a.sl-anchor-link').remove();
  $('.copy, .starlight-aside__icon, .sl-anchor-icon').remove();
  $('[aria-hidden="true"]').each((i, el) => {
    // decorative wrappers that still carry real text are kept; icon-only ones are empty
    if (isEmptyEl($, el)) $(el).remove();
  });
  $('iframe').each((i, el) => {
    const src = $(el).attr('src') || '';
    $(el).replaceWith($('<a></a>').attr('href', src).text('[embedded content] ' + src));
  });
  // Unwrap heading wrappers so h2..h6 sit directly in the flow.
  const wrappers = $('div.sl-heading-wrapper').toArray();
  for (const w of wrappers) $(w).replaceWith($(w).contents());
  // Drop empty paragraphs/divs left behind by removed components.
  // Never touch anything inside <pre>: blank .code lines are meaningful there.
  $('p, div').each((i, el) => {
    if ($(el).parents('pre').length) return;
    if (isEmptyEl($, el)) $(el).remove();
  });
}

// --- code blocks -------------------------------------------------------------

// Expressive Code renders a "N collapsed lines" affordance as its own .ec-line.
const COLLAPSE_MARKER_RE = /^\d+\s+collapsed lines?$/i;

function normalizeCodeBlocks($) {
  $('div.expressive-code').each((i, el) => {
    const $el = $(el);
    const title = normSpace($el.find('figcaption .title').first().text());
    const pre = $el.find('pre').first();
    let lang = normSpace(pre.attr('data-language') || '');
    if (!lang || lang === 'text' || lang === 'plaintext') lang = '';
    const lines = [];
    const ecLines = pre.find('.ec-line').toArray();
    if (ecLines.length) {
      for (const ln of ecLines) {
        const $ln = $(ln);
        const codeChild = $ln.children('.code').first();
        let text;
        if (codeChild.length) {
          text = textOf(codeChild.get(0));
        } else if ($ln.children('.gutter').length) {
          text = ''; // blank source line: the gutter removed the only child
        } else {
          text = textOf(ln);
        }
        if (COLLAPSE_MARKER_RE.test(text.replace(/\s+$/, ''))) continue; // UI affordance, not code
        lines.push(text);
      }
    } else {
      const code = pre.find('code').first();
      lines.push(textOf((code.length ? code : pre).get(0)));
    }
    const block = $('<pre></pre>')
      .attr('data-lang', lang)
      .attr('data-title', title);
    block.text(lines.join('\n'));
    $el.replaceWith(block);
  });
}

// --- callouts ----------------------------------------------------------------

function normalizeAsides($) {
  $('aside.starlight-aside').each((i, el) => {
    const $el = $(el);
    const titleEl = $el.find('.starlight-aside__title').first();
    const title = normSpace(titleEl.text());
    titleEl.remove();
    if (title) $el.attr('data-aside-title', title);
  });
}

// --- file trees --------------------------------------------------------------

function renderFileTree($, el) {
  const lines = [];
  // Starlight wraps nested directories in <details>, so a child <ul> is not always a
  // direct child of the <li>. Always take the first descendant <ul> of the entry.
  const walk = (ul, depth) => {
    $(ul).children('li').each((i, li) => {
      const $li = $(li);
      const childUl = $li.find('ul').first();
      const clone = $li.clone();
      clone.find('ul').remove();
      const name = normSpace(clone.text());
      if (name) lines.push('  '.repeat(depth) + name);
      if (childUl.length) walk(childUl, depth + 1);
    });
  };
  const rootUl = $(el).find('ul').first();
  walk(rootUl.length ? rootUl : $(el), 0);
  return fenceFor(lines.join('\n'), '', '');
}

function normalizeFileTrees($, ctx) {
  $('starlight-file-tree').each((i, el) => {
    const md = renderFileTree($, el);
    $(el).replaceWith(rawNode($, ctx, md));
  });
}

// --- YAML config viewers -----------------------------------------------------

function renderConfigSections($, sections, depth, ctx) {
  const out = [];
  const pad = '  '.repeat(depth);
  $(sections).each((i, sec) => {
    const $sec = $(sec);
    const details = $sec.children('details').first();
    const head = details.length
      ? details.children('summary.line').first()
      : $sec.children('div.line').first();

    // "message" rows carry no key: a comment line (message-inline, e.g. the eula.txt
    // header) or a prose note (e.g. "This is a single entry in the root array ...").
    // They used to render as an empty bullet, which dropped their text entirely.
    if (!head.length) {
      const msg = $sec.children('div.block').first();
      if (msg.length) {
        const inline = hasClass(msg.get(0), 'message-inline');
        if (inline) {
          const clone = msg.clone();
          clone.find('p').each((n, p) => $(p).replaceWith('\n'));
          const raw = textOf(clone.get(0)).replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{2,}/g, '\n').trim();
          if (raw) out.push(indentBlock(fenceFor(raw, '', ''), pad.length) + '\n');
        } else {
          const md = ctx.convertInner($, msg).trim();
          if (md) out.push(indentBlock(md, pad.length) + '\n');
        }
      }
      const subMsg = $sec.children('div.not-content.node').first();
      if (subMsg.length) {
        const childSections = subMsg.children('section');
        if (childSections.length) out.push(renderConfigSections($, childSections, depth + 1, ctx));
      }
      return;
    }

    const key = normSpace(head.find('span.key').first().text()) || normSpace(head.text()).replace(/:$/, '');
    const single = head.find('span.value').first();
    const multi = head.find('p.value').first();
    const block = details.length ? details.children('div.block').first() : $();

    let line = pad + '- `' + key.replace(/`/g, '\\`') + '`';
    let valueBlock = '';
    if (single.length) {
      const v = normSpace(single.text());
      if (v) line += ': `' + v.replace(/`/g, '\\`') + '`';
    } else if (multi.length) {
      line += ':';
      const raw = textOf(multi.get(0)).replace(/\r/g, '');
      valueBlock = indentBlock(fenceFor(raw.replace(/^\n+/, ''), 'yaml', ''), pad.length + 2);
    }
    line += ' ';

    let descBlock = '';
    if (block.length) {
      const desc = ctx.convertInner($, block).trim();
      if (!desc) {
        /* nothing */
      } else if (!desc.includes('\n') && desc.length <= 220) {
        line += '\u2014 ' + desc;
      } else {
        descBlock = indentBlock(desc, pad.length + 2);
      }
    }
    out.push(line.replace(/\s+$/, ''));
    if (valueBlock) out.push(valueBlock);
    if (descBlock) out.push(descBlock);

    const sub = $sec.children('div.not-content.node').first();
    if (sub.length) {
      const childSections = sub.children('section');
      if (childSections.length) out.push(renderConfigSections($, childSections, depth + 1, ctx));
    }
  });
  return out.filter((s) => s !== '').join('\n');
}

function normalizeConfigNodes($, ctx) {
  $('div.node-root, div.not-content.node').each((i, el) => {
    const $el = $(el);
    // only handle roots (skip nodes already handled via their parent)
    if ($el.closest('.node-root').get(0) !== el && $el.hasClass('node-root') === false) return;
    const sections = $el.children('section');
    if (!sections.length) return;
    const md = renderConfigSections($, sections, 0, ctx);
    if (md) $el.replaceWith(rawNode($, ctx, md));
  });
}

// --- tabs --------------------------------------------------------------------

function normalizeTabs($, ctx) {
  $('starlight-tabs').each((i, el) => {
    const $el = $(el);
    const labels = $el
      .find('[role=tablist] [role=tab]')
      .toArray()
      .map((a) => normSpace($(a).text()));
    const panels = $el.children('[role=tabpanel]').toArray();
    const parts = [];
    panels.forEach((p, idx) => {
      const label = labels[idx] || 'Tab ' + (idx + 1);
      const body = ctx.convertInner($, $(p)).trim();
      parts.push('#### ' + label + '\n\n' + body);
    });
    if (!parts.length) return;
    $el.replaceWith(rawNode($, ctx, parts.join('\n\n')));
  });
}

// --- tables ------------------------------------------------------------------

function renderTable($, el, ctx) {
  const rows = [];
  $(el)
    .find('tr')
    .each((i, tr) => {
      const cells = $(tr)
        .children('th, td')
        .toArray()
        .map((c) => cellText(ctx.convertInner($, $(c))));
      if (cells.length) rows.push(cells);
    });
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => { while (r.length < width) r.push(''); return r; };
  const header = pad(rows[0].slice());
  const out = ['| ' + header.join(' | ') + ' |', '| ' + header.map(() => '---').join(' | ') + ' |'];
  for (const r of rows.slice(1)) out.push('| ' + pad(r.slice()).join(' | ') + ' |');
  return out.join('\n');
}

function normalizeTables($, ctx) {
  $('table').each((i, el) => {
    const md = renderTable($, el, ctx);
    $(el).replaceWith(rawNode($, ctx, md || ''));
  });
}

// --- link cards ---------------------------------------------------------------

function cardMarkdown($, el) {
  const $el = $(el);
  const a = $el.find('a').first();
  const href = a.attr('href') || '';
  const title = normSpace($el.find('.title').first().text()) || normSpace(a.text());
  const desc = normSpace($el.find('.description').first().text());
  return '- **[' + title + '](' + href + ')**' + (desc ? ' \u2014 ' + desc : '');
}

function normalizeLinkCards($, ctx) {
  // Card grids first, so their cards are not replaced one by one.
  const grids = $('div.card-grid').toArray();
  for (const g of grids) {
    const $g = $(g);
    const cards = $g.find('div.sl-link-card').toArray();
    const md = cards.length
      ? cards.map((c) => cardMarkdown($, c)).join('\n')
      : $g.text().trim();
    $g.replaceWith(rawNode($, ctx, md));
  }
  $('div.sl-link-card').each((i, el) => {
    $(el).replaceWith(rawNode($, ctx, cardMarkdown($, el)));
  });
}

// --- plain <details> ---------------------------------------------------------

function normalizeDetails($, ctx) {
  $('details').each((i, el) => {
    const $el = $(el);
    const $tmp = cheerio.load($el.html() || '', null, false);
    const summary = normSpace($tmp('summary').first().text());
    $tmp('summary').remove();
    const body = ctx.convertHtml($tmp.root().html() || '').trim();
    const md =
      '<details>\n<summary>' + (summary || 'Details') + '</summary>\n\n' +
      (body || '') +
      '\n\n</details>';
    $el.replaceWith(rawNode($, ctx, md));
  });
}

// --- raw node ----------------------------------------------------------------

const TOKEN_RE = /RAWHASHTOKEN(\d+)END/g;

/**
 * Block-level raw markdown carrier.
 *
 * The raw markdown never enters the DOM: it is stored in ctx.raw and the DOM only
 * holds an opaque text token, because Turndown re-parses its input through domino
 * (which drops unknown elements and collapses whitespace in text nodes).
 */
function rawNode($, ctx, md) {
  const index = ctx.raw.length;
  ctx.raw.push(String(md == null ? '' : md));
  return $('<div data-raw="1"></div>').text('RAWHASHTOKEN' + index + 'END');
}

/**
 * Replace tokens with their payloads, repeatedly, until no further token resolves.
 *
 * A nested conversion (e.g. the body of <details>) runs with its own registry, so a token
 * produced by the OUTER pass can end up inside a payload string. A single pass would leave
 * such tokens behind and, worse, deleting unknown tokens silently drops content (that is how
 * a <details> containing a <starlight-tabs> lost its whole body). So:
 *   - an unknown token is left as-is (the enclosing pass owns it), and
 *   - passes repeat until the text reaches a fixed point.
 */
function substituteRaw(md, list) {
  let out = String(md);
  for (let pass = 0; pass < 8; pass++) {
    const re = new RegExp(TOKEN_RE.source, 'g');
    let replaced = false;
    const next = out.replace(re, (m, i) => {
      const payload = list[Number(i)];
      if (payload == null) return m; // owned by an enclosing pass
      replaced = true;
      return '\n\n' + String(payload).trim() + '\n\n';
    });
    out = next;
    if (!replaced) break;
  }
  return out;
}

// ------------------------------------------------------------------- pipeline

function makeContext(baseUrl) {
  const td = createTurndown();
  const ctx = {
    baseUrl,
    td,
    raw: [],
    depth: 0,
    debug: null, // set to an object with { dir, name } to dump pipeline stages to disk
    stageLog: null, // set to an array to capture full stage HTML in memory
    convertHtml(html) {
      const $ = cheerio.load(html || '', null, false);
      return convertRoot($, ctx);
    },
    convertInner($, el) {
      return ctx.convertHtml($.html(el) || '');
    },
  };
  return ctx;
}

function snap(ctx, $, stage) {
  if (ctx.stageLog) ctx.stageLog.push({ stage, depth: ctx.depth || 0, html: $.root().html() || '' });
  if (!ctx.debug) return;
  try {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(ctx.debug.dir, { recursive: true });
    fs.appendFileSync(
      path.join(ctx.debug.dir, ctx.debug.name + '.stages.txt'),
      '\n\n########## ' + stage + ' (depth ' + (ctx.depth || 0) + ') ##########\n' + ($.root().html() || '').slice(0, 60000),
      'utf8'
    );
  } catch { /* ignore */ }
}

function convertRoot($, ctx) {
  ctx.depth = (ctx.depth || 0) + 1;
  const prevRaw = ctx.raw;
  ctx.raw = [];
  $('body').each((i, el) => $(el).replaceWith($(el).contents()));
  snap(ctx, $, 'input');
  absolutize($, ctx.baseUrl);
  cleanup($);
  snap(ctx, $, 'cleanup');
  normalizeAsides($);
  normalizeCodeBlocks($);
  snap(ctx, $, 'codeblocks');
  normalizeFileTrees($, ctx);
  normalizeConfigNodes($, ctx);
  normalizeTabs($, ctx);
  normalizeTables($, ctx);
  normalizeLinkCards($, ctx);
  normalizeDetails($, ctx);
  snap(ctx, $, 'final-dom');
  const raw = ctx.raw;
  ctx.raw = prevRaw;
  ctx.depth -= 1;
  const md = ctx.td.turndown($.root().html() || '');
  return tidy(substituteRaw(md, raw));
}

/**
 * Final whitespace pass — fence aware.
 *
 * Collapsing runs of blank lines must never reach inside a fenced code block: consecutive
 * empty lines are meaningful there (two pages in the archive have them). So the document is
 * split into fenced and non-fenced segments and only the non-fenced ones are collapsed.
 */
function tidy(md) {
  const text = String(md).replace(/\r/g, '');
  const blocks = [];
  let cur = { fence: false, lines: [] };
  let fenceMark = '';
  for (const line of text.split('\n')) {
    const m = /^[ \t]*(```+|~~~+)/.exec(line);
    if (m && !cur.fence) {
      blocks.push(cur);
      cur = { fence: true, lines: [] };
      fenceMark = m[1][0];
    } else if (m && cur.fence && m[1][0] === fenceMark) {
      cur.lines.push(line);
      blocks.push(cur);
      cur = { fence: false, lines: [] };
      fenceMark = '';
      continue;
    }
    cur.lines.push(line);
  }
  blocks.push(cur);

  const out = blocks
    .map((b) => {
      const lines = b.lines.map((l) => l.replace(/[ \t]+$/, ''));
      const joined = lines.join('\n');
      return b.fence ? joined : joined.replace(/\n{3,}/g, '\n\n');
    })
    .join('\n');

  return out.replace(/^\s+/, '').replace(/\s+$/, '') + '\n';
}

// ---------------------------------------------------------------- page facade

/**
 * Extract the article of a full documentation page.
 * @returns {{title:string, description:string, markdown:string, html:string,
 *            links:string[], assets:string[]}}
 */
function extractPage(html, url) {
  const $ = cheerio.load(html);
  const title =
    normSpace($('h1').first().text()) ||
    normSpace($('title').first().text().replace(/\s*\|\s*PaperMC Docs\s*$/i, ''));
  const description = normSpace($('meta[name="description"]').attr('content') || '');

  let container = $('.sl-markdown-content').first();
  if (!container.length) container = $('main .content-panel').first();
  if (!container.length) container = $('main').first();

  const bodyHtml = container.length ? container.html() || '' : '';
  const ctx = makeContext(url);
  const markdown = ctx.convertHtml(bodyHtml);

  const links = [];
  const assets = [];
  const absolutizeUrl = (raw) => {
    if (!raw || /^(mailto:|tel:|javascript:|data:)/i.test(raw)) return null;
    try { return new URL(raw, url).href; } catch { return null; }
  };
  $('.sl-markdown-content a[href]').each((i, el) => {
    const abs = absolutizeUrl($(el).attr('href') || '');
    if (abs) links.push(abs);
  });
  $('.sl-markdown-content img[src]').each((i, el) => {
    const abs = absolutizeUrl($(el).attr('src') || '');
    if (abs) assets.push(abs);
  });

  return {
    title,
    description,
    markdown,
    html: bodyHtml,
    links: [...new Set(links)],
    assets: [...new Set(assets)],
  };
}

module.exports = { extractPage, makeContext, tidy };
