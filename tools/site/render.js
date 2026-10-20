'use strict';
/**
 * render.js — Markdown -> HTML for the offline library.
 *
 * Handles the constructs the archived Markdown actually contains:
 *   - fenced code blocks with `title="file.yml"` info strings (figure + figcaption)
 *   - GitHub alerts (`> [!NOTE] title`) -> <aside class="alert">, plain quotes stay blockquotes
 *   - raw <details>/<summary> (kept as raw HTML; inner Markdown is still rendered by marked)
 *   - GFM tables wrapped in a horizontal-scroll container
 *   - stable heading ids (GitHub slug rules, CJK preserved) + permalinks + TOC collection
 *   - link/image rewriting is deferred via data-lcb-href / data-lcb-src placeholders so that
 *     cross-page fragment resolution and assets/ path mapping happen in a second pass.
 *
 * Links are never emitted as final hrefs here: finalizeHtml() owns that.
 */

const path = require('path');
const markedModule = require('marked');
const { marked, Marked } = markedModule;
const MarkedClass = Marked || (marked && marked.Marked);
const hljs = require('highlight.js');
const U = require('./util');

const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution', 'danger'];
const DEFAULT_ALERT_TITLE = {
  note: 'Note', tip: 'Tip', important: 'Important',
  warning: 'Warning', caution: 'Caution', danger: 'Danger',
};

/** info-string languages that highlight.js names differently */
const LANG_ALIASES = {
  yml: 'yaml', yaml: 'yaml',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', bash: 'bash',
  ps1: 'powershell', 'ps': 'powershell',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  md: 'markdown', markdown: 'markdown',
  kts: 'kotlin', kotlin: 'kotlin', java: 'java', groovy: 'groovy', gradle: 'groovy',
  js: 'javascript', javascript: 'javascript', ts: 'typescript', typescript: 'typescript',
  py: 'python', python: 'python', json: 'json', json5: 'json', diff: 'diff',
  ini: 'ini', toml: 'ini', properties: 'properties', sql: 'sql', css: 'css', scss: 'scss',
};

/** languages we treat as "no highlighting" instead of guessing */
const PLAIN_LANGS = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'log', 'none', 'output', 'unknown']);

/**
 * Parse a fence info string such as: yaml title="paper-world-defaults.yml"
 * @returns {{lang:string,title:string,tag:string}}
 */
function parseInfoString(info) {
  const raw = String(info || '').trim();
  let title = '';
  let lang = '';
  if (!raw) return { lang: '', title: '', tag: 'text' };
  // split on whitespace but keep quoted values together
  const parts = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.*)$/);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/^["']|["']$/g, '');
      if (key === 'title' || key === 'file' || key === 'filename') title = title || val;
      continue; // never treat a key=value token as the language
    }
    if (!lang) lang = part.replace(/^["']|["']$/g, '');
  }
  return { lang, title, tag: lang ? displayLang(lang) : 'text' };
}

function displayLang(lang) {
  const l = String(lang || '').toLowerCase();
  const known = { yml: 'yaml', sh: 'bash', shell: 'bash', console: 'bash', ps1: 'powershell', kts: 'kotlin', txt: 'text' };
  return known[l] || l || 'text';
}

/** highlight with highlight.js, never throwing on unknown languages */
function highlightCode(text, lang, onUnknown) {
  const key = LANG_ALIASES[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase();
  if (key && !PLAIN_LANGS.has(key) && hljs.getLanguage(key)) {
    try {
      return hljs.highlight(text, { language: key, ignoreIllegals: true }).value;
    } catch (e) {
      if (onUnknown) onUnknown(lang, e.message);
    }
  } else if (lang && !PLAIN_LANGS.has(key) && onUnknown) {
    onUnknown(lang, 'unknown language');
  }
  return U.escapeHtml(text);
}

let BLOCK_SEQ = 0;

class MarkdownRenderer {
  constructor(opts = {}) {
    this.warn = opts.warn || (() => {});
    this.counts = {
      code: 0, codeWithTitle: 0, alert: 0, table: 0, link: 0, image: 0,
      heading: 0, list: 0, blockquote: 0, rawDetails: 0,
    };
    this.alertTypes = {};
    this.toc = [];
    this.ids = [];
    this.markdownTitle = null;
    this._slugCounts = new Map();
    this._blocks = [];
    this._inst = this._createInstance();
  }

  /** allocate a unique id (used for the shell page-title h1 and for recovered anchors) */
  uniqueSlug(base) {
    return this._uniqueSlug(base);
  }

  _createInstance() {
    const inst = new MarkedClass();
    const self = this;
    inst.use({
      gfm: true,
      breaks: false,
      pedantic: false,
      renderer: {
        code(token) { return self._code(token, this); },
        heading(token) { return self._heading(token, this); },
        table(token) { return self._table(token, this); },
        link(token) { return self._link(token, this); },
        image(token) { return self._image(token, this); },
      },
    });
    return inst;
  }

  /** render a full Markdown document (may be called recursively for alert bodies) */
  render(md) {
    this.counts.rawDetails += countMatches(md, /^[ \t]*<details[\s>]/gim);
    const processed = this._preprocess(md);
    const html = this._inst.parse(processed);
    return { html: this._substitute(html), toc: this.toc, ids: this.ids, counts: this.counts };
  }

  /** inline-only rendering (alert titles, table cells handled through parseInline) */
  inline(md) {
    return this._inst.parseInline(md);
  }

  _uniqueSlug(base) {
    let slug = base;
    if (!this._slugCounts.has(slug)) {
      this._slugCounts.set(slug, 0);
      return slug;
    }
    let n = this._slugCounts.get(slug);
    do {
      n += 1;
      slug = base + '-' + n;
    } while (this._slugCounts.has(slug));
    this._slugCounts.set(base, n);
    this._slugCounts.set(slug, 0);
    return slug;
  }

  _addBlock(html) {
    const idx = this._blocks.length;
    this._blocks.push(html);
    return '@@LCB-BLOCK-' + idx + '@@';
  }

  _substitute(html) {
    const blocks = this._blocks;
    return html
      .replace(/<p>\s*@@LCB-BLOCK-(\d+)@@\s*<\/p>/g, (m, i) => (blocks[+i] !== undefined ? blocks[+i] : m))
      .replace(/@@LCB-BLOCK-(\d+)@@/g, (m, i) => (blocks[+i] !== undefined ? blocks[+i] : m));
  }

  /**
   * Line-level preprocessing: GitHub alerts become raw HTML blocks.
   * Fenced code is copied verbatim so alert-looking lines inside code stay code.
   * <details>/<summary> is left to marked, which keeps the raw tags and still
   * renders the Markdown between them.
   */
  _preprocess(md) {
    const lines = String(md).split('\n');
    const out = [];
    let i = 0;
    let fence = null; // {marker, len}
    while (i < lines.length) {
      const line = lines[i];
      const open = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/) || line.match(/^[ \t]{4,}(`{3,})\s*$/);
      if (!fence && open) {
        fence = { marker: open[1][0], len: open[1].length };
        out.push(line);
        i += 1;
        continue;
      }
      if (fence) {
        out.push(line);
        const close = line.match(/^[ \t]*([`~]{3,})[ \t]*$/);
        if (close && close[1][0] === fence.marker && close[1].length >= fence.len) fence = null;
        i += 1;
        continue;
      }
      const alert = line.match(/^[ \t]{0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\][ \t]*(.*)$/i);
      if (alert) {
        const type = alert[1].toLowerCase();
        let title = alert[2].trim();
        const body = [];
        i += 1;
        while (i < lines.length) {
          const l = lines[i];
          if (/^[ \t]{0,3}>/.test(l)) {
            body.push(l.replace(/^[ \t]{0,3}>[ \t]?/, ''));
            i += 1;
            continue;
          }
          // a blank line without ">" ends the quote; the next "> [!TYPE]" starts a new alert
          break;
        }
        const innerMd = body.join('\n').replace(/\n+$/, '');
        const innerHtml = innerMd.trim() ? this._renderBlock(innerMd) : '';
        if (!title) title = DEFAULT_ALERT_TITLE[type] || type;
        const titleHtml = this.inline(title).replace(/\s+$/, '');
        this.counts.alert += 1;
        this.alertTypes[type] = (this.alertTypes[type] || 0) + 1;
        const block = '<aside class="alert alert-' + type + '" role="note" data-alert-type="' + type + '">'
          + '<p class="alert-title">' + titleHtml + '</p>'
          + '<div class="alert-body">' + innerHtml + '</div>'
          + '</aside>';
        out.push('', this._addBlock(block), '');
        continue;
      }
      out.push(line);
      i += 1;
    }
    return out.join('\n');
  }

  _renderBlock(md) {
    const processed = this._preprocess(md);
    const html = this._inst.parse(processed);
    return this._substitute(html);
  }

  // ---- renderer hooks (ctx is the marked Renderer instance, which owns .parser) ----

  _code(token) {
    const info = parseInfoString(token.lang);
    const self = this;
    const body = highlightCode(token.text, info.lang, (lang, reason) => {
      self.warn('highlight-unknown', 'code fence language "' + lang + '" is not in highlight.js (' + reason + ')');
    });
    this.counts.code += 1;
    if (info.title) this.counts.codeWithTitle += 1;
    const langAttr = info.lang ? ' data-lang="' + U.attr(info.lang) + '"' : '';
    const caption = '<figcaption class="code-title">'
      + '<span class="code-lang">' + U.escapeHtml(info.tag) + '</span>'
      + (info.title ? '<span class="code-file" title="' + U.attr(info.title) + '">' + U.escapeHtml(info.title) + '</span>' : '<span class="code-file"></span>')
      + '<button class="code-copy" type="button" data-copy-code aria-label="复制代码">复制</button>'
      + '</figcaption>';
    const code = '<pre class="code-pre"><code class="hljs language-' + U.attr(info.tag) + '"' + langAttr + '>'
      + body + '</code></pre>';
    return '<figure class="code-block' + (info.title ? ' has-title' : '') + '"' + langAttr + '>'
      + caption + code + '</figure>\n';
  }

  _heading(token, ctx) {
    let depth = token.depth;
    let inner;
    try {
      inner = ctx.parser.parseInline(token.tokens);
    } catch (e) {
      inner = U.escapeHtml(token.text || '');
    }
    const plain = U.decodeAttrText(inner).replace(/`/g, '').replace(/\s+/g, ' ').trim();
    const id = this._uniqueSlug(U.slugify(plain) || ('section-' + (this.ids.length + 1)));
    this.ids.push(id);
    this.counts.heading += 1;

    // The page title h1 is owned by the shell (one h1 per document): the first Markdown h1 is
    // dropped here (its id is handed to the shell h1) and any further h1 is demoted to h2 and
    // joins the TOC, so the TOC always mirrors the article's h2-h4 exactly.
    if (depth === 1) {
      if (!this.markdownTitle) {
        this.markdownTitle = { id, text: plain };
        return '';
      }
      depth = 2;
      this.counts.demotedH1 = (this.counts.demotedH1 || 0) + 1;
    }

    if (depth >= 2 && depth <= 4) {
      this.toc.push({ level: depth, id, text: plain || id });
    }
    const anchor = '<a class="heading-anchor" href="#' + U.attr(id) + '" aria-label="本节链接" title="本节链接">#</a>';
    return '<h' + depth + ' id="' + U.attr(id) + '" class="heading heading-' + depth + '">'
      + inner + anchor + '</h' + depth + '>\n';
  }

  _table(token, ctx) {
    this.counts.table += 1;
    const align = Array.isArray(token.align) ? token.align : [];
    const cellHtml = (cell, tag, i) => {
      const a = align[i] ? ' style="text-align:' + align[i] + '"' : '';
      return '<' + tag + a + '>' + ctx.parser.parseInline(cell.tokens) + '</' + tag + '>';
    };
    let head = '<thead><tr>';
    (token.header || []).forEach((cell, i) => { head += cellHtml(cell, 'th', i); });
    head += '</tr></thead>';
    let body = '';
    if (token.rows && token.rows.length) {
      body = '<tbody>' + token.rows.map((row) => '<tr>'
        + row.map((cell, i) => cellHtml(cell, 'td', i)).join('')
        + '</tr>').join('') + '</tbody>';
    }
    return '<div class="table-wrap">' + '<table>' + head + body + '</table>' + '</div>\n';
  }

  _link(token, ctx) {
    this.counts.link += 1;
    const title = token.title ? ' title="' + U.attr(token.title) + '"' : '';
    let inner;
    try {
      inner = ctx.parser.parseInline(token.tokens);
    } catch (e) {
      inner = U.escapeHtml(token.text || '');
    }
    return '<a data-lcb-href="' + U.attr(token.href) + '"' + title + '>' + inner + '</a>';
  }

  _image(token) {
    this.counts.image += 1;
    const title = token.title ? ' title="' + U.attr(token.title) + '"' : '';
    return '<img data-lcb-src="' + U.attr(token.href) + '" alt="' + U.attr(token.text || '') + '"' + title + '>';
  }
}

function countMatches(s, re) {
  const m = String(s).match(re);
  return m ? m.length : 0;
}

/**
 * Second pass over rendered HTML:
 *   - rewrite raw <a href>/<img src> that came from literal HTML in the Markdown
 *   - rewrite the data-lcb placeholders produced by the renderer
 *   - decorate <details>/<summary>
 *   - repair footnote anchors (#user-content-fn-N / #user-content-fnref-N)
 * Never produces absolute filesystem paths; everything stays relative for file:// use.
 */
function finalizeHtml(html, page, linker) {
  let out = html;

  // 1. literal HTML anchors (data-lcb attrs are not present yet at this point)
  out = out.replace(/<a\b([^>]*?)\shref="([^"]*)"([^>]*)>/g, (m, pre, href, post) => {
    const r = linker.resolveLink(page, U.decodeEntities(href));
    if (!r.changed) return m;
    const attrs = [pre, 'href="' + U.attr(r.href) + '"'];
    if (r.cls) attrs.push('class="' + U.attr(r.cls) + '"');
    if (r.title) attrs.push('title="' + U.attr(r.title) + '"');
    if (r.target) attrs.push('target="' + r.target + '"');
    if (r.rel) attrs.push('rel="' + r.rel + '"');
    return '<a ' + attrs.join(' ').trim() + ' ' + post.replace(/^\s+/, '') + '>';
  });

  // 2. literal HTML images
  out = out.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*?)\/?>/g, (m, pre, src, post) => {
    const r = linker.resolveImage(page, U.decodeEntities(src));
    const attrs = [pre, 'src="' + U.attr(r.src) + '"'];
    if (r.cls) attrs.push('class="' + U.attr(r.cls) + '"');
    if (r.title) attrs.push('title="' + U.attr(r.title) + '"');
    if (r.zoom) attrs.push('data-zoom="1"');
    if (r.lazy) attrs.push('loading="lazy"', 'decoding="async"');
    if (r.referrerPolicy) attrs.push('referrerpolicy="no-referrer"');
    const note = r.note ? '<span class="external-image-note">' + U.escapeHtml(r.note) + '</span>' : '';
    return '<img ' + attrs.join(' ').trim() + ' ' + post.replace(/^\s+/, '') + '/>' + note;
  });

  // 3. renderer-produced links
  out = out.replace(/<a data-lcb-href="([^"]*)"([^>]*)>/g, (m, rawHref, rest) => {
    const r = linker.resolveLink(page, U.decodeEntities(rawHref));
    const attrs = ['href="' + U.attr(r.href) + '"'];
    if (r.cls) attrs.push('class="' + U.attr(r.cls) + '"');
    if (r.title) attrs.push('title="' + U.attr(r.title) + '"');
    if (r.target) attrs.push('target="' + r.target + '"');
    if (r.rel) attrs.push('rel="' + r.rel + '"');
    return '<a ' + attrs.join(' ') + rest + '>';
  });

  // 4. renderer-produced images
  out = out.replace(/<img data-lcb-src="([^"]*)"([^>]*?)>/g, (m, rawSrc, rest) => {
    const r = linker.resolveImage(page, U.decodeEntities(rawSrc));
    const attrs = ['src="' + U.attr(r.src) + '"'];
    if (r.cls) attrs.push('class="' + U.attr(r.cls) + '"');
    if (r.title) attrs.push('title="' + U.attr(r.title) + '"');
    if (r.zoom) attrs.push('data-zoom="1"');
    if (r.lazy) attrs.push('loading="lazy"', 'decoding="async"');
    if (r.referrerPolicy) attrs.push('referrerpolicy="no-referrer"');
    const note = r.note ? '<span class="external-image-note">' + U.escapeHtml(r.note) + '</span>' : '';
    return '<img ' + attrs.join(' ') + rest + '>' + note;
  });

  // 5. details / summary decoration (inner Markdown was already rendered by marked)
  out = out.replace(/<details\b(?![^>]*class=)/g, '<details class="details-block"')
    .replace(/<summary\b(?![^>]*class=)/g, '<summary class="details-summary"');

  // 5b. guarantee a meaningful alt on every content image (upstream Markdown leaves many empty)
  out = out.replace(/<img\b([^>]*)>/g, (m, attrs) => {
    const altMatch = attrs.match(/\salt="([^"]*)"/);
    if (altMatch && altMatch[1].trim()) return m;
    const srcMatch = attrs.match(/\ssrc="([^"]*)"/);
    let fallback = '插图';
    if (srcMatch) {
      const s = srcMatch[1];
      if (/^https?:/i.test(s)) {
        const host = (s.match(/^https?:\/\/([^/]+)/i) || [])[1] || '';
        fallback = '外链插图' + (host ? '（' + host + '）' : '');
      } else if (s.startsWith('data:')) {
        fallback = '内联插图（data URI）';
      } else {
        const base = decodeURIComponent(s.split('/').pop().split('?')[0] || '') || '插图';
        fallback = '插图：' + base;
      }
    }
    if (altMatch) return m.replace(/\salt="[^"]*"/, ' alt="' + U.attr(fallback) + '"');
    return m.replace('<img', '<img alt="' + U.attr(fallback) + '"');
  });

  // 6. footnote anchors
  out = linker.repairFootnotes(out, page);

  return out;
}

/** plain text for the search index (tags removed, entities decoded) */
function htmlToText(html) {
  return U.decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ')
      .replace(/<(br|\/p|\/li|\/tr|\/h[1-6]|\/div|\/pre)>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  ).replace(/[ \t\u00a0]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

module.exports = {
  MarkdownRenderer, parseInfoString, highlightCode, finalizeHtml, htmlToText,
  displayLang, ALERT_TYPES, LANG_ALIASES,
};
