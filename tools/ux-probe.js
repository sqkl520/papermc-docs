#!/usr/bin/env node
/* ux-probe.js — read-only UX/readability probes for the offline library.
   Usage: node tools/ux-probe.js <probe> [args]
   Probes: inv tax duptitles home cat pager search a11y offline pages nav quality consist drift struct raw
   Writes nothing. Prints a text report to stdout (UTF-8). Run from the repo root.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT);
const tax = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));
const manifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'build-manifest.json'), 'utf8')); } catch (e) { return null; } })();
const crosslinks = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'crosslinks.json'), 'utf8')); } catch (e) { return null; } })();

const out = [];
function p(...a) { out.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); }
function flush() { process.stdout.write(out.join('\n') + '\n'); }
const cjkRe = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

function listHtml(dir) {
  const res = [];
  (function w(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, ent.name);
      if (ent.isDirectory()) w(fp);
      else if (ent.name.endsWith('.html')) res.push(fp);
    }
  })(dir);
  return res;
}
const pageFiles = listHtml(path.join(LIB));
function libRel(fp) { return path.relative(LIB, fp).replace(/\\/g, '/'); }
function load(fp) { return cheerio.load(fs.readFileSync(fp, 'utf8')); }

/* ---------------- inv ---------------- */
function probeInv() {
  p('== manifest ==');
  if (manifest) {
    p('top keys: ' + Object.keys(manifest).join(', '));
    p('manifest bytes: ' + JSON.stringify(manifest).length);
    for (const k of Object.keys(manifest)) {
      const v = manifest[k];
      if (Array.isArray(v)) p('  ' + k + ': array len ' + v.length);
      else if (v && typeof v === 'object') p('  ' + k + ': object keys ' + Object.keys(v).slice(0, 12).join(','));
      else p('  ' + k + ': ' + String(v).slice(0, 120));
    }
    if (manifest.counts) p('counts: ' + JSON.stringify(manifest.counts));
  }
  p('');
  p('== crosslinks ==');
  if (crosslinks) {
    for (const kk of Object.keys(crosslinks)) {
      const v = crosslinks[kk];
      if (Array.isArray(v)) p('  ' + kk + ': ' + v.length + ' items; sample ' + JSON.stringify(v[0]).slice(0, 200));
      else p('  ' + kk + ': ' + JSON.stringify(v).slice(0, 300));
    }
  }
  p('');
  p('== counts ==');
  p('pages html: ' + pageFiles.length + ' | taxonomy pages: ' + tax.pages.length + ' | categories: ' + tax.categories.length);
  p('largest pages:');
  pageFiles.map(f => [libRel(f), fs.statSync(f).size]).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([r, s]) => p('  ' + s + '\t' + r));
  p('smallest pages:');
  pageFiles.map(f => [libRel(f), fs.statSync(f).size]).sort((a, b) => a[1] - b[1]).slice(0, 12)
    .forEach(([r, s]) => p('  ' + s + '\t' + r));
  flush();
}

/* ---------------- tax ---------------- */
function probeTax() {
  p('== categories ==');
  for (const c of [...tax.categories].sort((a, b) => (a.section + a.order).localeCompare(b.section + b.order))) {
    const pages = tax.pages.filter(x => x.category === c.id);
    p(`${c.section}/${c.id} order=${c.order} pages=${pages.length} title="${c.title}"`);
    p(`    desc: ${c.description || '(none)'}`);
  }
  p('');
  p('== per-category order values ==');
  for (const c of tax.categories) {
    const pages = tax.pages.filter(x => x.category === c.id).sort((a, b) => a.order - b.order);
    p(`${c.id}: ` + pages.map(x => x.order + ':' + x.rel).join(' | '));
  }
  p('');
  p('== summary lengths ==');
  const noSum = tax.pages.filter(x => !x.summary || !x.summary.trim());
  p('pages without summary: ' + noSum.length + ' -> ' + noSum.map(x => x.id).join(', '));
  const lens = tax.pages.map(x => (x.summary || '').length);
  p('summary len min/max/avg: ' + Math.min(...lens) + '/' + Math.max(...lens) + '/' + Math.round(lens.reduce((a, b) => a + b, 0) / lens.length));
  const noDesc = tax.pages.filter(x => !x.description || !x.description.trim());
  p('pages without upstream description: ' + noDesc.length + ' -> ' + noDesc.map(x => x.id).join(', '));
  const noTags = tax.pages.filter(x => !x.tags || !x.tags.length);
  p('pages without tags: ' + noTags.length);
  const tagCount = {};
  tax.pages.forEach(x => (x.tags || []).forEach(t => tagCount[t] = (tagCount[t] || 0) + 1));
  p('tag histogram (top 25): ' + Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => k + '=' + v).join(', '));
  p('distinct tags: ' + Object.keys(tagCount).length);
  p('');
  p('== non-Chinese upstream descriptions ==');
  const enOnly = tax.pages.filter(x => x.description && x.description.trim() && !cjkRe.test(x.description));
  p('count with latin description: ' + enOnly.length + ' of ' + tax.pages.length);
  flush();
}

/* ---------------- duplicate / near-duplicate titles ---------------- */
function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
function probeDuptitles() {
  const files = [path.join(LIB, 'index.html'), path.join(LIB, 'snapshots.html'),
    ...listHtml(path.join(LIB, 'sections')), ...listHtml(path.join(LIB, 'categories')), ...pageFiles];
  p('== exact duplicate <title> across all HTML ==');
  const byTitle = {};
  for (const f of files) {
    const t = (load(f)('title').first().text() || '').trim();
    (byTitle[t] = byTitle[t] || []).push(libRel(f));
  }
  const dups = Object.entries(byTitle).filter(([, v]) => v.length > 1);
  p('total files: ' + files.length + ', distinct titles: ' + Object.keys(byTitle).length + ', duplicate-title groups: ' + dups.length);
  dups.forEach(([t, v]) => p('  "' + t + '" x' + v.length + '\n     ' + v.join('\n     ')));
  p('');
  p('== duplicate h1 text (same visible title on 2+ pages) ==');
  const byH1 = {};
  for (const f of files) {
    const h = (load(f)('h1').first().text() || '').replace(/\s+/g, ' ').trim();
    (byH1[h] = byH1[h] || []).push(libRel(f));
  }
  Object.entries(byH1).filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length)
    .forEach(([t, v]) => p('  h1 "' + t + '" x' + v.length + '\n     ' + v.join('\n     ')));
  p('');
  p('== same category, similar titles (lev<=4 or substring) ==');
  for (const c of tax.categories) {
    const pages = tax.pages.filter(x => x.category === c.id);
    for (let i = 0; i < pages.length; i++) for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i], b = pages[j];
      const ta = a.title, tb = b.title;
      const d = levenshtein(ta, tb);
      const sub = ta.length > 3 && tb.length > 3 && (ta.toLowerCase().includes(tb.toLowerCase()) || tb.toLowerCase().includes(ta.toLowerCase()));
      if (d <= 4 || sub) p(`  [${c.id}] "${ta}" (${a.rel}) <-> "${tb}" (${b.rel}) lev=${d}${sub ? ' SUBSTR' : ''}`);
    }
  }
  p('');
  p('== title tokens repeated >=4 times ==');
  const tok = {};
  tax.pages.forEach(x => x.title.split(/[\s:,()/]+/).forEach(w => { if (w.length > 2) (tok[w.toLowerCase()] = tok[w.toLowerCase()] || []).push(x.rel); }));
  Object.entries(tok).filter(([, v]) => v.length >= 4).sort((a, b) => b[1].length - a[1].length).slice(0, 20)
    .forEach(([w, v]) => p('  ' + w + ' x' + v.length + ': ' + v.join(', ')));
  flush();
}

/* ---------------- home ---------------- */
function probeHome() {
  const $ = load(path.join(LIB, 'index.html'));
  p('== <head> ==');
  p('title: ' + $('title').text());
  p('html lang: ' + $('html').attr('lang') + ' | data-theme: ' + $('html').attr('data-theme'));
  p('meta description: ' + ($('meta[name=description]').attr('content') || '(none)'));
  p('');
  p('== top-level body children ==');
  $('body').children().each((i, el) => p('  <' + el.tagName + '> class=' + (el.attribs && el.attribs.class || '')));
  p('');
  p('== hero ==');
  $('.hero').each((i, el) => p('  ' + $(el).text().replace(/\s+/g, ' ').trim().slice(0, 400)));
  p('');
  p('== stats ==');
  $('.stat').each((i, el) => p('  ' + $(el).text().replace(/\s+/g, ' ').trim()));
  p('');
  p('== banner ==');
  $('.banner').each((i, el) => p('  [' + $(el).text().replace(/\s+/g, ' ').trim().slice(0, 400) + ']'));
  p('');
  p('== section-head blocks ==');
  $('.section-head').each((i, el) => p('  ' + $(el).text().replace(/\s+/g, ' ').trim().slice(0, 300)));
  p('');
  p('== h1/h2/h3 in main ==');
  $('h1,h2,h3').each((i, el) => p('  h' + el.tagName.slice(1) + ': ' + $(el).text().replace(/\s+/g, ' ').trim().slice(0, 160)));
  p('');
  p('== cards ==');
  $('.card').each((i, el) => {
    p('  [' + i + '] ' + $(el).text().replace(/\s+/g, ' ').trim().slice(0, 260));
    p('      links: ' + $(el).find('a').map((j, a) => $(a).attr('href')).get().join(' , '));
  });
  p('');
  p('== cat-block (category index on home) ==');
  $('.cat-block').each((i, el) => {
    p('  block h3=' + $(el).find('h3').first().text().trim() + ' | desc=' + ($(el).find('.cat-desc').text().trim().slice(0, 120)));
    p('      entries=' + $(el).find('.cat-links > li').length + ' | with-summary=' + $(el).find('.cat-links .sum').length);
    $(el).find('.cat-links > li > a').slice(0, 3).each((j, a) => p('      e.g. ' + $(a).text().replace(/\s+/g, ' ').trim().slice(0, 140)));
  });
  p('');
  p('== search affordances on home ==');
  p('data-open-search elements: ' + $('[data-open-search]').length);
  p('search-dialog present: ' + ($('#search-dialog').length > 0));
  p('input[type=search] on home: ' + $('input[type=search]').length);
  p('');
  p('== task-path keywords present on home? ==');
  const body = $('body').text();
  ['入门路径', '从这里开始', '我想', '典型路径', '快速开始', '常见任务', '迁移', '调优'].forEach(k => p('  ' + k + ': ' + (body.includes(k) ? 'YES' : 'no')));
  p('');
  p('== links on home ==');
  const hrefs = [];
  $('a[href]').each((i, a) => hrefs.push($(a).attr('href')));
  p('total anchors: ' + hrefs.length + ' unique: ' + new Set(hrefs).size);
  p('');
  p('== classes used on home but absent from site.css ==');
  const css = fs.readFileSync(path.join(LIB, 'assets', 'site.css'), 'utf8');
  const cls = new Set();
  $('[class]').each((i, el) => String(el.attribs.class).split(/\s+/).forEach(c => c && cls.add(c)));
  p('  missing: ' + [...cls].filter(c => !css.includes('.' + c)).join(', '));
  flush();
}

/* ---------------- category pages ---------------- */
function probeCat() {
  for (const f of listHtml(path.join(LIB, 'categories')).sort()) {
    const $ = load(f);
    p('### ' + libRel(f));
    p('title: ' + $('title').text());
    p('h1: ' + $('h1').first().text().trim());
    p('crumbs: ' + $('.crumbs').text().replace(/\s+/g, ' ').trim());
    p('page-desc: ' + ($('.page-desc').text().trim() || '(none)'));
    const rows = [];
    $('.tax-list li').each((i, el) => {
      rows.push('    ' + $(el).find('a b').text().trim() + '  ::  ' + $(el).find('.sum').text().trim().slice(0, 90)
        + '  [chips=' + $(el).find('.page-meta .chip').map((j, c) => $(c).text().trim()).get().join('|') + ']');
    });
    p('entries: ' + rows.length);
    p(rows.join('\n'));
    p('toc-side: ' + $('.toc-side').length + ' | article: ' + $('.article').length + ' | head chips: ' + $('.page-head .page-meta .chip').map((i, el) => $(el).text().trim()).get().join('|'));
    p('');
  }
  flush();
}

/* ---------------- pager continuity ---------------- */
function probePager() {
  const want = ['paper-start', 'paper-dev-basics', 'paper-dev-command', 'paper-ref', 'velocity-start', 'velocity-dev-api'];
  for (const cid of want) {
    const pages = tax.pages.filter(x => x.category === cid).sort((a, b) => a.order - b.order);
    p('### ' + cid + ' (' + pages.length + ' pages, taxonomy order)');
    for (const pg of pages) {
      const alt = path.join(LIB, pg.section, pg.rel + '.html');
      const fp = path.join(LIB, pg.section, pg.rel.split('/').filter(Boolean).slice(0, -1).concat('index.html').join(path.sep));
      const file = fs.existsSync(fp) ? fp : (fs.existsSync(alt) ? alt : null);
      if (!file) { p('  MISSING FILE for ' + pg.id); continue; }
      const $ = load(file);
      const links = $('.pager a');
      const prev = links.eq(0).attr('href') || '';
      const nxt = links.length > 1 ? (links.eq(1).attr('href') || '') : '(none)';
      const prevT = links.eq(0).find('.ttl').text().trim();
      const nextT = links.length > 1 ? links.eq(1).find('.ttl').text().trim() : '(none)';
      p(`  o=${pg.order} ${pg.rel}  prev="${prevT}" (${prev})  next="${nextT}" (${nxt})  links=${links.length}`);
    }
    p('');
  }
  flush();
}

/* ---------------- search ---------------- */
function loadIndex() {
  const src = fs.readFileSync(path.join(LIB, 'assets', 'search-index.js'), 'utf8');
  const m = src.match(/window\.__LIBRARY_SEARCH__\s*=\s*([\s\S]*?);?\s*$/);
  if (!m) throw new Error('cannot parse search-index.js');
  return JSON.parse(m[1].replace(/;\s*$/, ''));
}
function scoreOf(entry, terms) {
  const title = (entry.t || '').toLowerCase();
  const heads = (entry.h || []).join(' \u0001 ').toLowerCase();
  const sum = (entry.u || '').toLowerCase();
  const body = (entry.x || '').toLowerCase();
  let total = 0;
  for (const q of terms) {
    if (!q) continue;
    let s = 0;
    if (title.indexOf(q) === 0) s += 40; else if (title.indexOf(q) !== -1) s += 26;
    if (heads.indexOf(q) !== -1) s += 14;
    if (sum.indexOf(q) !== -1) s += 8;
    if (body.indexOf(q) !== -1) s += 4;
    if (!s) return 0;
    total += s;
  }
  return total + Math.min(6, (entry.n || 0) / 6);
}
function probeSearch() {
  const idx = loadIndex();
  p('== search index shape ==');
  p('top keys: ' + Object.keys(idx).join(', '));
  p('note: ' + idx.note);
  p('pages: ' + idx.pages.length + ' | bodyCapBytes: ' + idx.bodyCapBytes);
  p('fields: ' + Object.keys(idx.pages[0]).join(','));
  const xl = idx.pages.map(e => (e.x || '').length);
  p('body text len min/avg/max: ' + Math.min(...xl) + '/' + Math.round(xl.reduce((a, b) => a + b, 0) / xl.length) + '/' + Math.max(...xl));
  p('empty x: ' + idx.pages.filter(e => !e.x || !e.x.trim()).length
    + ' | empty u: ' + idx.pages.filter(e => !e.u || !e.u.trim()).length
    + ' | empty h: ' + idx.pages.filter(e => !e.h || !e.h.length).length
    + ' | x contains "<": ' + idx.pages.filter(e => (e.x || '').includes('<')).length);
  p('index bytes: ' + fs.statSync(path.join(LIB, 'assets', 'search-index.js')).size);
  p('');
  const qs = process.argv.slice(3).length ? process.argv.slice(3) : ['anti-xray', '启动脚本', '权限', 'plugin.yml', '代理', '性能', '渲染', '命令注册',
    'yaml', 'anti', 'Paper', 'velocity', '世界', '配置', '升级', '报错', 'timings', 'permissions', 'proxy', '转发', 'event'];
  for (const raw of qs) {
    const query = raw.trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const hits = [];
    for (const e of idx.pages) { const s = scoreOf(e, terms); if (s > 0) hits.push({ e, s }); }
    hits.sort((a, b) => b.s - a.s);
    p(`\n--- query "${raw}" (terms=${JSON.stringify(terms)}, CJK=${cjkRe.test(raw)}) -> ${hits.length} page hits (UI shows max 40)`);
    hits.slice(0, 5).forEach((h, i) => {
      const e = h.e;
      const low = (e.x || '').toLowerCase();
      let at = -1;
      for (const t of terms) { const q2 = low.indexOf(t); if (q2 !== -1 && (at === -1 || q2 < at)) at = q2; }
      const start = at > 60 ? at - 50 : 0;
      const snip = ((start > 0 ? '…' : '') + (e.x || '').slice(start, start + 180)).replace(/\s+/g, ' ');
      p(`  ${i + 1}. score=${h.s.toFixed(1)} "${e.t}" [${e.c}] len=${(e.x || '').length} bodyHitAt=${at}`);
      p(`      ${snip.slice(0, 190)}`);
    });
    const fieldStats = { title: 0, heads: 0, summary: 0, bodyOnly: 0 };
    for (const h of hits) {
      const e = h.e, t = (e.t || '').toLowerCase(), hd = (e.h || []).join(' ').toLowerCase(), su = (e.u || '').toLowerCase();
      if (terms.every(x => t.includes(x))) fieldStats.title++;
      else if (terms.every(x => hd.includes(x))) fieldStats.heads++;
      else if (terms.every(x => su.includes(x))) fieldStats.summary++;
      else fieldStats.bodyOnly++;
    }
    p('  hit provenance: title=' + fieldStats.title + ' headings=' + fieldStats.heads + ' summary=' + fieldStats.summary + ' body-only=' + fieldStats.bodyOnly);
    if (hits.length) p('  score spread: top=' + hits[0].s.toFixed(1) + ' p40=' + (hits[Math.min(hits.length, 40) - 1] ? hits[Math.min(hits.length, 40) - 1].s.toFixed(1) : '-') + ' last=' + hits[hits.length - 1].s.toFixed(1));
  }
  flush();
}

/* ---------------- a11y ---------------- */
function probeA11y() {
  const files = [path.join(LIB, 'index.html'), path.join(LIB, 'snapshots.html'),
    ...listHtml(path.join(LIB, 'sections')), ...listHtml(path.join(LIB, 'categories')), ...pageFiles];
  let langBad = [], h1Bad = [], altBad = [], btnBad = [], jumpBad = [], imgTotal = 0, altHist = {};
  for (const f of files) {
    const $ = load(f);
    const r = libRel(f);
    if (($('html').attr('lang') || '') !== 'zh-CN') langBad.push(r + ' lang=' + $('html').attr('lang'));
    const h1n = $('h1').length;
    if (h1n !== 1) h1Bad.push(r + ' h1=' + h1n);
    $('img').each((i, el) => {
      imgTotal++;
      const a = $(el).attr('alt');
      const key = a === undefined ? '(missing)' : (a === '' ? '(empty)' : a);
      altHist[key] = (altHist[key] || 0) + 1;
      if (a === undefined) altBad.push(r + ' src=' + $(el).attr('src'));
    });
    $('button').each((i, el) => {
      const txt = $(el).text().replace(/\s+/g, ' ').trim();
      const lbl = $(el).attr('aria-label') || '';
      if (!txt && !lbl) btnBad.push(r + ' button#' + ($(el).attr('id') || '') + ' class=' + ($(el).attr('class') || ''));
    });
    let prev = 0;
    $('.article h1,.article h2,.article h3,.article h4,.article h5,.article h6').each((i, el) => {
      const lv = +el.tagName.slice(1);
      if (prev && lv > prev + 1) jumpBad.push(r + ' jump h' + prev + '->h' + lv + ' @ "' + $(el).text().trim().slice(0, 40) + '"');
      prev = lv;
    });
  }
  p('== lang ==');
  p('non zh-CN: ' + langBad.length + (langBad.length ? '\n  ' + langBad.slice(0, 10).join('\n  ') : ''));
  p('');
  p('== h1 count != 1 ==');
  const hist = {};
  h1Bad.forEach(x => { const n = x.split('h1=')[1]; hist[n] = (hist[n] || 0) + 1; });
  p('distribution of h1 counts (files with != 1): ' + JSON.stringify(hist));
  const pgFiles = pageFiles.map(libRel);
  p('content pages with exactly 2 h1: ' + h1Bad.filter(x => x.split('h1=')[1] === '2' && pgFiles.includes(x.split(' h1=')[0])).length);
  const pgBadSet = new Set(h1Bad.map(x => x.split(' h1=')[0]));
  p('content pages NOT in the bad list: ' + pageFiles.filter(f => !pgBadSet.has(libRel(f))).map(libRel).join(', '));
  p('files with !=1 h1: ' + h1Bad.length);
  p('');
  p('== images ==');
  p('total <img>: ' + imgTotal + ' (includes the per-page lightbox <img>)');
  p('alt histogram (top 20): ' + Object.entries(altHist).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => v + 'x "' + k + '"').join(', '));
  p('missing alt attribute: ' + altBad.length);
  p('');
  p('== buttons without readable text or aria-label ==');
  p(btnBad.length + (btnBad.length ? '\n  ' + btnBad.slice(0, 15).join('\n  ') : ''));
  p('');
  p('== heading level jumps in .article ==');
  p('count: ' + jumpBad.length);
  jumpBad.slice(0, 25).forEach(x => p('  ' + x));
  p('');
  p('== landmarks / skip link (index.html) ==');
  const $i = load(path.join(LIB, 'index.html'));
  p('main element: ' + $i('main').length + ' | a[href^="#"] on home: ' + $i('a[href^="#"]').length);
  p('aria-label on nav: ' + ($i('nav').attr('aria-label') || '(none)'));
  p('label[for=side-filter] hidden attr: ' + ($i('label[for=side-filter]').attr('hidden') !== undefined));
  p('search dialog aria-label: ' + ($i('#search-dialog').attr('aria-label') || '(none)'));
  p('');
  p('== :focus / outline rules in css ==');
  const css = fs.readFileSync(path.join(LIB, 'assets', 'site.css'), 'utf8');
  const focusRules = css.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes(':focus') || l.includes('outline'));
  p('rules: ' + focusRules.length);
  focusRules.forEach(([n, l]) => p('  L' + n + ': ' + l.trim().slice(0, 160)));
  p('');
  p('== hard-coded colors in css (non-var) ==');
  css.split('\n').forEach((l, i) => { if (/#[0-9a-fA-F]{3,8}\b/.test(l)) p('  L' + (i + 1) + ': ' + l.trim().slice(0, 150)); });
  flush();
}

/* ---------------- offline ---------------- */
function probeOffline() {
  const files = [path.join(LIB, 'index.html'), path.join(LIB, 'snapshots.html'),
    ...listHtml(path.join(LIB, 'sections')), ...listHtml(path.join(LIB, 'categories')), ...pageFiles];
  const ext = {}, imgSrc = {}, scriptSrc = {}, linkHref = {};
  let httpLinks = 0;
  for (const f of files) {
    const $ = load(f);
    httpLinks += $('a[href^="http"]').length;
    $('img').each((i, el) => {
      const s = $(el).attr('src') || '';
      const key = s.slice(0, 3).includes('..') ? s.split('/').slice(0, 2).join('/') : s.slice(0, 24);
      imgSrc[key] = (imgSrc[key] || 0) + 1;
      if (/^https?:/.test(s)) ext['img http ' + s.slice(0, 60)] = 1;
    });
    $('script[src]').each((i, el) => scriptSrc[$(el).attr('src')] = (scriptSrc[$(el).attr('src')] || 0) + 1);
    $('link[href]').each((i, el) => linkHref[$(el).attr('href')] = (linkHref[$(el).attr('href')] || 0) + 1);
  }
  p('== assets referenced ==');
  p('scripts: ' + JSON.stringify(scriptSrc));
  p('links: ' + JSON.stringify(linkHref));
  p('http(s) <a> total across all pages: ' + httpLinks);
  p('');
  p('== img src patterns (top 20) ==');
  Object.entries(imgSrc).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, v]) => p('  ' + v + 'x ' + k));
  p('external img: ' + JSON.stringify(ext));
  p('');
  p('== css network deps ==');
  const css = fs.readFileSync(path.join(LIB, 'assets', 'site.css'), 'utf8');
  p('url() in css: ' + (css.match(/url\(/g) || []).length + ' | @import: ' + (css.match(/@import/g) || []).length);
  p('font stacks: ' + [...new Set(css.match(/--font:[^\n]*|--mono:[^\n]*/g) || [])].join(' | ').slice(0, 300));
  p('');
  p('== file:// specific risks in site.js ==');
  const js = fs.readFileSync(path.join(LIB, 'assets', 'site.js'), 'utf8');
  p('uses fetch(): ' + /fetch\(/.test(js) + ' | XHR: ' + /XMLHttpRequest/.test(js) + ' | localStorage: ' + /localStorage/.test(js));
  p('navigator.clipboard: ' + /navigator\.clipboard/.test(js) + ' | execCommand fallback: ' + /execCommand/.test(js));
  p('snippet injected via innerHTML unescaped: ' + /innerHTML\s*=\s*'<div class="sr-ttl">/.test(js));
  p('');
  p('== does any page mention a local server / file:// ? ==');
  let hint = 0; const hintWhere = [];
  for (const f of files) {
    if (/本地服务器|需要启动服务|python -m http\.server|file:\/\/|双击打开/.test(fs.readFileSync(f, 'utf8'))) { hint++; hintWhere.push(libRel(f)); }
  }
  p('pages: ' + hint + ' -> ' + hintWhere.slice(0, 10).join(', '));
  p('');
  p('== snapshots.html ==');
  const $s = load(path.join(LIB, 'snapshots.html'));
  p('title: ' + $s('title').text());
  p('h1: ' + $s('h1').first().text().trim());
  p('rows: ' + $s('table tbody tr').length + ' | cols: ' + $s('thead th').length + ' ' + JSON.stringify($s('thead th').map((i, el) => $s(el).text().trim()).get()));
  p('crumbs: ' + $s('.crumbs').length + ' | toc-side: ' + $s('.toc-side').length);
  p('row1: ' + String($s('tbody tr').first().text()).replace(/\s+/g, ' ').trim().slice(0, 240));
  p('intro: ' + String($s('main').text() || '').replace(/\s+/g, ' ').slice(0, 420));
  flush();
}

/* ---------------- per-page article metrics ---------------- */
function probePages() {
  const rows = [];
  for (const f of pageFiles) {
    const $ = load(f);
    const art = $('.article');
    let maxDepth = 0;
    art.find('li').each((i, el) => {
      let d = 0, n = el;
      while (n && n.tagName) { if (n.tagName === 'ul' || n.tagName === 'ol') d++; n = n.parent; }
      maxDepth = Math.max(maxDepth, d);
    });
    let maxCodeLine = 0, codeLines = 0;
    art.find('pre code').each((i, el) => {
      const lines = $(el).text().split('\n');
      codeLines += lines.length;
      for (const l of lines) maxCodeLine = Math.max(maxCodeLine, l.replace(/\t/g, '  ').length);
    });
    let maxCols = 0, maxTableRows = 0, longCell = 0;
    art.find('table').each((i, el) => {
      maxTableRows = Math.max(maxTableRows, $(el).find('tr').length);
      $(el).find('tr').each((j, tr) => { const c = $(tr).children().length; if (c > maxCols) maxCols = c; });
    });
    art.find('td,th').each((i, el) => { if ($(el).text().trim().length > 120) longCell++; });
    const alerts = {};
    art.find('.alert').each((i, el) => {
      const c = (el.attribs.class || '').split(/\s+/).find(x => x.startsWith('alert-') && x !== 'alert-body') || 'alert';
      alerts[c] = (alerts[c] || 0) + 1;
    });
    rows.push({
      r: libRel(f),
      kb: Math.round(fs.statSync(f).size / 1024),
      h2: art.find('h2').length,
      h3: art.find('h3').length,
      toc: $('.toc-side a').length,
      pre: art.find('pre').length,
      codeLines,
      maxCodeLine,
      tables: art.find('table').length,
      maxCols,
      maxTableRows,
      longCell,
      details: art.find('details').length,
      imgs: art.find('img').length,
      alerts: Object.entries(alerts).map(([k, v]) => k + ':' + v).join(','),
      depth: maxDepth,
      textLen: art.text().replace(/\s+/g, ' ').trim().length,
      tocPresent: $('.toc-side').length > 0,
      crumbDepth: $('.crumbs .sep').length + 1,
      pager: $('.pager a').length,
      unmirrored: $('a.unmirrored').length,
      unresolved: $('a.unresolved').length,
      anchorMissing: $('a.anchor-missing').length,
      extImg: art.find('img[src^="http"]').length,
      missingImg: art.find('img.img-missing').length,
    });
  }
  p('== page metrics (' + rows.length + ' pages) ==');
  p('rel\tkb\th2\th3\ttoc\tpre\tcodeLines\tmaxCodeLine\ttables\tmaxCols\tmaxRows\tlongCell\tdetails\timgs\talerts\tdepth\ttextLen\ttocPanel\tcrumbs\tpager\tunmirrored\tunresolved\tanchorMissing\textImg\tmissingImg');
  rows.forEach(x => p([x.r, x.kb, x.h2, x.h3, x.toc, x.pre, x.codeLines, x.maxCodeLine, x.tables, x.maxCols, x.maxTableRows, x.longCell, x.details, x.imgs, x.alerts, x.depth, x.textLen, x.tocPresent, x.crumbDepth, x.pager, x.unmirrored, x.unresolved, x.anchorMissing, x.extImg, x.missingImg].join('\t')));
  p('');
  p('== aggregates ==');
  const sum = k => rows.reduce((a, b) => a + b[k], 0);
  p('pages with code: ' + rows.filter(x => x.pre).length + ' | total pre: ' + sum('pre') + ' | pages with maxCodeLine>96: ' + rows.filter(x => x.maxCodeLine > 96).length);
  p('pages with tables: ' + rows.filter(x => x.tables).length + ' | pages with longCell>0: ' + rows.filter(x => x.longCell > 0).length);
  p('pages with details: ' + rows.filter(x => x.details).length + ' | pages with imgs: ' + rows.filter(x => x.imgs).length + ' | pages with alerts: ' + rows.filter(x => x.alerts).length);
  p('pages with nested list depth>=4: ' + rows.filter(x => x.depth >= 4).length + ' -> ' + rows.filter(x => x.depth >= 4).map(x => x.r + '(d' + x.depth + ')').join(', '));
  p('pages with no h2: ' + rows.filter(x => !x.h2).length + ' -> ' + rows.filter(x => !x.h2).map(x => x.r).slice(0, 20).join(', '));
  p('pages without .toc-side panel: ' + rows.filter(x => !x.tocPresent).length);
  p('pages with 0 toc entries: ' + rows.filter(x => x.toc === 0).length);
  p('pages with pager links != 2: ' + rows.filter(x => x.pager !== 2).length + ' -> ' + rows.filter(x => x.pager !== 2).map(x => x.r).slice(0, 20).join(', '));
  p('pages with unmirrored links: ' + rows.filter(x => x.unmirrored).length + ' total ' + sum('unmirrored'));
  p('pages with anchor-missing: ' + rows.filter(x => x.anchorMissing).length + ' total ' + sum('anchorMissing'));
  p('pages with img.img-missing: ' + rows.filter(x => x.missingImg).length + ' | with external img: ' + rows.filter(x => x.extImg).length);
  p('longest text pages: ' + rows.slice().sort((a, b) => b.textLen - a.textLen).slice(0, 10).map(x => x.r + '(' + x.textLen + ')').join(', '));
  p('shortest text pages: ' + rows.slice().sort((a, b) => a.textLen - b.textLen).slice(0, 10).map(x => x.r + '(' + x.textLen + ')').join(', '));
  flush();
}

/* ---------------- nav ---------------- */
function probeNav() {
  const $ = load(path.join(LIB, 'paper', 'adding-plugins', 'index.html'));
  p('== sidebar markup sample ==');
  p($('#sidebar').html().slice(0, 1600));
  p('');
  p('== sidebar on a category page ==');
  const $c = load(path.join(LIB, 'categories', 'paper-start.html'));
  p('sidebar: ' + $c('#sidebar').length + ' | side-cat: ' + $c('.side-cat').length + ' | open: ' + $c('.side-cat[open]').length);
  p('active on cat page: ' + JSON.stringify($c('.sidebar a.active').map((i, a) => $c(a).attr('href')).get()));
  p('');
  p('== active link on a deep page ==');
  p('active: ' + JSON.stringify($('a.active').map((i, a) => $(a).attr('href')).get()));
  p('open details: ' + $('.side-cat[open]').length + ' / ' + $('.side-cat').length);
  p('details data-cat: ' + JSON.stringify($('.side-cat').map((i, el) => $(el).attr('data-cat') + ($(el).attr('open') !== undefined ? '(open)' : '')).get()));
  p('aria-current count: ' + $('[aria-current]').length);
  p('');
  p('== crumbs at 4 levels ==');
  for (const f of [path.join(LIB, 'index.html'), path.join(LIB, 'snapshots.html'), path.join(LIB, 'sections', 'paper.html'), path.join(LIB, 'categories', 'paper-start.html'), path.join(LIB, 'paper', 'adding-plugins', 'index.html')]) {
    const $$ = load(f);
    p('  ' + libRel(f) + ' -> ' + ($$('.crumbs').text().replace(/\s+/g, ' ').trim() || '(no crumbs)'));
  }
  p('');
  p('== sidebar filter attribute placement ==');
  p('li with data-search: ' + $('.side-cat li[data-search]').length + ' | a with data-search: ' + $('.side-cat li a[data-search]').length + ' | li total: ' + $('.side-cat li').length);
  p('sidebar links to categories/: ' + $('.sidebar a[href*="categories/"]').length);
  p('section titles: ' + JSON.stringify($('.side-section-title').map((i, a) => $(a).text().replace(/\s+/g, ' ').trim()).get()));
  flush();
}

/* ---------------- quality: contrast, alt, code width, toc-empty, chips, pager ends ---------------- */
function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex) {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  return 0.2126 * srgb(parseInt(f.slice(0, 2), 16)) + 0.7152 * srgb(parseInt(f.slice(2, 4), 16)) + 0.0722 * srgb(parseInt(f.slice(4, 6), 16));
}
function ratio(a, b) { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
function probeQuality() {
  p('== contrast (computed from site.css variables) ==');
  const light = { bg: '#ffffff', soft: '#f7f8fa', elev: '#f2f3f7', fg: '#1c1f26', muted: '#5c6470', accent: '#2563eb', soft2: '#e8efff', note: '#2563eb', tip: '#0f9d58', important: '#7c3aed', warning: '#d97706', caution: '#ea7c1f', danger: '#dc2626' };
  const dark = { bg: '#14161a', soft: '#191c21', elev: '#20242b', fg: '#e6e8ec', muted: '#9aa3af', accent: '#7aa2ff', soft2: '#1d2634', note: '#6aa2ff', tip: '#3ddc97', important: '#b388ff', warning: '#f0b429', caution: '#ff9d4d', danger: '#ff6b6b' };
  const report = (t, name) => {
    p('-- ' + name + ' --');
    const chk = [
      ['fg on bg', t.fg, t.bg], ['muted on bg', t.muted, t.bg], ['muted on bg-soft', t.muted, t.soft],
      ['muted on bg-elev (chip/code)', t.muted, t.elev], ['accent on bg (links)', t.accent, t.bg],
      ['accent on accent-soft (active nav)', t.accent, t.soft2],
      ['white on tip (alert icon)', '#ffffff', t.tip], ['white on warning (alert icon)', '#ffffff', t.warning],
      ['white on caution (alert icon)', '#ffffff', t.caution], ['white on note (alert icon)', '#ffffff', t.note],
      ['white on important (alert icon)', '#ffffff', t.important], ['white on danger (alert icon)', '#ffffff', t.danger],
      ['fg on bg-soft (card text)', t.fg, t.soft],
    ];
    for (const [label, a, b] of chk) {
      const r = ratio(a, b);
      p('  ' + label.padEnd(34) + a + ' on ' + b + ' = ' + r.toFixed(2) + '  ' + (r >= 4.5 ? 'OK' : (r >= 3 ? 'LARGE-ONLY' : 'FAIL')));
    }
  };
  report(light, 'light theme'); report(dark, 'dark theme');
  p('');
  p('== content image alt (lightbox img excluded) ==');
  const altHist = {}; let content = 0; const badPages = {}, diagramPages = {};
  for (const f of pageFiles) {
    const $ = load(f);
    $('.lightbox img').remove();
    $('img').each((i, el) => {
      content++;
      const a = $(el).attr('alt');
      const key = a === undefined ? '(missing)' : (a === '' ? '(empty)' : a);
      altHist[key] = (altHist[key] || 0) + 1;
      if (a === undefined || a === '') (badPages[libRel(f)] = badPages[libRel(f)] || []).push($(el).attr('src'));
      if (a === 'Diagram') (diagramPages[libRel(f)] = diagramPages[libRel(f)] || []).push($(el).attr('src'));
    });
  }
  const sorted = Object.entries(altHist).sort((a, b) => b[1] - a[1]);
  const degenerate = sorted.filter(([k]) => k === '(empty)' || k === '(missing)' || k === 'Diagram').reduce((a, b) => a + b[1], 0);
  p('content <img>: ' + content + ' | degenerate alt: ' + degenerate + ' (' + Math.round(degenerate / content * 100) + '%)');
  sorted.slice(0, 12).forEach(([k, v]) => p('  ' + v + 'x "' + k + '"'));
  p('pages with empty/missing alt (' + Object.keys(badPages).length + '): ' + Object.keys(badPages).slice(0, 20).join(', '));
  p('pages with alt="Diagram" (' + Object.keys(diagramPages).length + '):');
  for (const k of Object.keys(diagramPages)) p('  ' + k + ' x' + diagramPages[k].length + ' e.g. ' + diagramPages[k][0]);
  p('');
  p('== code width: longest code line per page ==');
  const widths = [];
  for (const f of pageFiles) {
    const $ = load(f);
    let mx = 0;
    $('.article pre code').each((i, el) => { for (const l of $(el).text().split('\n')) mx = Math.max(mx, l.replace(/\t/g, '  ').length); });
    if (mx) widths.push([libRel(f), mx]);
  }
  widths.sort((a, b) => b[1] - a[1]);
  p('  >96: ' + widths.filter(x => x[1] > 96).length + '  >110: ' + widths.filter(x => x[1] > 110).length + '  >130: ' + widths.filter(x => x[1] > 130).length + ' of ' + widths.length + ' pages with code');
  p('  top 10: ' + widths.slice(0, 10).map(([r, w]) => r + '(' + w + ')').join(', '));
  p('');
  p('== toc-empty rendering ==');
  const empt = [];
  for (const f of pageFiles) {
    const $ = load(f);
    if (!$('.toc-side a').length) empt.push(libRel(f));
  }
  p('count: ' + empt.length);
  empt.forEach(x => p('  ' + x));
  p('');
  p('== category page: internal-id chip leak ==');
  for (const f of listHtml(path.join(LIB, 'categories')).sort()) {
    const $ = load(f);
    const chips = $('.tax-list .page-meta .chip').map((i, el) => $(el).text().trim()).get();
    p('  ' + libRel(f) + ' -> ' + chips.length + ' chips; first 6: ' + JSON.stringify(chips.slice(0, 6)));
  }
  p('');
  p('== page-head chips on content pages ==');
  const headChips = {};
  for (const f of pageFiles) {
    const $ = load(f);
    $('.page-head .page-meta .chip').each((i, el) => { const t = $(el).text().trim(); headChips[t] = (headChips[t] || 0) + 1; });
  }
  p('distinct page-head chips: ' + JSON.stringify(Object.entries(headChips).sort((a, b) => b[1] - a[1]).slice(0, 12)));
  p('');
  p('== pager markup at category ends ==');
  for (const rel of ['paper/index', 'paper/faq/index', 'paper/admin/index', 'velocity/index']) {
    const fp = path.join(LIB, rel.split('/')[0], rel.split('/').slice(1).join('/') + '.html');
    const $ = load(fp);
    p('  ' + libRel(fp) + ' :: ' + String($('.pager').html() || '(no pager)').replace(/\s+/g, ' ').slice(0, 300));
  }
  p('');
  p('== sidebar accordion default state ==');
  for (const rel of ['index.html', 'snapshots.html', 'sections/paper.html', 'categories/paper-start.html', 'pages/velocity/faq/index.html']) {
    const $ = load(path.join(LIB, rel));
    p('  ' + rel + ' open=' + $('.side-cat[open]').length + '/' + $('.side-cat').length + ' activeLinks=' + JSON.stringify($('.sidebar a.active').map((i, a) => $(a).attr('href')).get()));
  }
  p('');
  p('== empty text-bearing blocks ==');
  let bo = 0, pe = 0;
  for (const f of pageFiles) {
    const $ = load(f);
    $('.article blockquote').each((i, el) => { if (!$(el).text().trim()) bo++; });
    $('.article pre').each((i, el) => { if (!$(el).text().trim()) pe++; });
  }
  p('empty blockquote: ' + bo + ' | empty pre: ' + pe);
  flush();
}

/* ---------------- consistency ---------------- */
function countIn(files, re) { let n = 0; for (const f of files) { const m = fs.readFileSync(f, 'utf8').match(re); if (m) n += m.length; } return n; }
function probeConsist() {
  const terms = [
    ['服务端', /服务端/g], ['服务器', /服务器/g], ['代理端', /代理端/g], ['代理', /代理/g],
    ['服主', /服主/g], ['管理员', /管理员/g], ['玩家', /玩家/g],
    ['插件', /插件/g], ['plugin', /plugin/gi],
    ['配置文件', /配置文件/g], ['yml', /yml/gi], ['YAML', /YAML/g],
    ['Paper', /Paper/g], ['Velocity', /Velocity/g], ['velocity.toml', /velocity\.toml/g],
    ['索引页', /索引页/g], ['总览', /总览/g], ['入门', /入门/g],
    ['排错', /排错/g], ['排查', /排查/g], ['故障', /故障/g],
  ];
  p('== terminology counts: taxonomy.json ==');
  const taxSrc = JSON.stringify(tax);
  for (const [name, re] of terms) p('  ' + name.padEnd(14) + (taxSrc.match(re) || []).length);
  p('');
  p('== terminology counts: page chrome ==');
  const chrome = [path.join(LIB, 'index.html'), path.join(LIB, 'snapshots.html')]
    .concat(listHtml(path.join(LIB, 'sections'))).concat(listHtml(path.join(LIB, 'categories')));
  for (const [name, re] of terms) p('  ' + name.padEnd(14) + countIn(chrome, re));
  p('');
  p('== sidebar label duplicates ==');
  const $nav = load(path.join(LIB, 'index.html'));
  const navLabels = $nav('.side-cat a .ttl').map((i, el) => $nav(el).text()).get();
  const lc = {};
  navLabels.forEach(l => lc[l] = (lc[l] || 0) + 1);
  p('labels=' + navLabels.length + ' | duplicate exact labels: ' + JSON.stringify(Object.entries(lc).filter(x => x[1] > 1)));
  p('first 16 rows: ' + JSON.stringify($nav('.side-cat li').map((i, el) => $nav(el).find('.ord').text() + ' ' + $nav(el).find('.ttl').text()).get().slice(0, 16)));
  p('velocity-start rows: ' + JSON.stringify($nav('details[data-cat="velocity-start"] li').map((i, el) => $nav(el).find('.ord').text() + ' ' + $nav(el).find('.ttl').text()).get()));
  p('');
  p('== page-desc language on content pages ==');
  let en = 0, zh = 0, none = 0; const absent = [];
  for (const f of pageFiles) {
    const $ = load(f);
    const d = ($('.page-desc').text() || '').trim();
    if (!d) { none++; if (absent.length < 6) absent.push(libRel(f) + ' | nodes=' + $('.page-desc').length + ' | meta=' + ($('meta[name=description]').attr('content') || '').slice(0, 26)); }
    else if (cjkRe.test(d)) zh++; else en++;
  }
  p('page-desc: english=' + en + ' chinese=' + zh + ' empty=' + none);
  absent.forEach(x => p('   ' + x));
  p('');
  p('== visible page-desc vs meta description ==');
  for (const rel of ['paper/adding-plugins/index', 'paper/admin/how-to/index', 'paper/anti-xray/index']) {
    const $ = load(path.join(LIB, rel.split('/')[0], rel.split('/').slice(1).join('/') + '.html'));
    p('  ' + rel + '\n     visible : ' + ($('.page-desc').text().trim() || '(none)') + '\n     meta    : ' + ($('meta[name=description]').attr('content') || '(none)'));
  }
  p('');
  p('== image figure/caption structure ==');
  let fig = 0, imgTotal = 0, inFigure = 0;
  for (const f of pageFiles) {
    const $ = load(f);
    $('.lightbox img').remove();
    fig += $('.article figure').length;
    $('.article img').each((i, el) => { imgTotal++; if ($(el).closest('figure').length) inFigure++; });
  }
  p('article <figure>: ' + fig + ' | content img: ' + imgTotal + ' | img inside figure: ' + inFigure);
  p('');
  p('== keyboard / ARIA on search + lightbox (index.html) ==');
  const $i = load(path.join(LIB, 'index.html'));
  p('  #search-results role: ' + JSON.stringify($i('#search-results').attr('role')) + ' | aria-live: ' + JSON.stringify($i('#search-results').attr('aria-live')));
  p('  #search-count aria-live: ' + JSON.stringify($i('#search-count').attr('aria-live')));
  p('  lightbox aria-label: ' + JSON.stringify($i('#lightbox').attr('aria-label')));
  p('  main id: ' + JSON.stringify($i('main').attr('id')) + ' | main count: ' + $i('main').length);
  p('  img[data-zoom] tabindex: ' + JSON.stringify($i('.article img[data-zoom]').attr('tabindex')));
  p('  theme-toggle text: ' + JSON.stringify($i('#theme-toggle').text()) + ' | aria-label: ' + JSON.stringify($i('#theme-toggle').attr('aria-label')));
  p('');
  p('== section pages ==');
  for (const f of listHtml(path.join(LIB, 'sections'))) {
    const $ = load(f);
    p('### ' + libRel(f) + ' title=' + $('title').text());
    p('  h1=' + $('h1').first().text().trim() + ' | crumbs=' + $('.crumbs').text().replace(/\s+/g, ' ').trim());
    p('  h2=' + JSON.stringify($('h2').map((i, el) => $(el).text().replace(/\s+/g, ' ').trim()).get()));
    p('  h3=' + JSON.stringify($('h3').map((i, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().slice(0, 20)));
    p('  links=' + $('a[href]').length + ' | toc-side=' + $('.toc-side').length + ' | cards=' + $('.card').length + ' | cat-block=' + $('.cat-block').length + ' | stats=' + $('.stat').length);
  }
  p('');
  p('== snapshots.html ==');
  const $s = load(path.join(LIB, 'snapshots.html'));
  p('  h1=' + $s('h1').first().text().trim() + ' | rows=' + $s('tbody tr').length + ' | crumbs=' + $s('.crumbs').length + ' | toc=' + $s('.toc-side').length);
  p('  cols=' + $s('thead th').length + ' -> ' + JSON.stringify($s('thead th').map((i, el) => $s(el).text().trim()).get()));
  p('  row1=' + String($s('tbody tr').first().html()).replace(/\s+/g, ' ').slice(0, 320));
  flush();
}

/* ---------------- drift ---------------- */
function probeDrift() {
  const pagePath = pg => path.join(LIB, pg.section, pg.rel.split('/').slice(0, -1).concat('index.html').join(path.sep));
  const mism = [], gone = [];
  for (const pg of tax.pages) {
    const f = pagePath(pg);
    if (!fs.existsSync(f)) { gone.push(pg.id); continue; }
    const $ = load(f);
    const meta = ($('meta[name=description]').attr('content') || '').trim();
    const sum = (pg.summary || '').trim();
    if (sum && meta !== sum) mism.push(pg.id + '\n     html: ' + meta.slice(0, 60) + '\n     tax : ' + sum.slice(0, 60));
  }
  p('== taxonomy summary vs built <meta name=description> ==');
  p('missing files for taxonomy pages: ' + gone.length + ' -> ' + gone.slice(0, 10).join(', '));
  p('summary text mismatches: ' + mism.length + ' / ' + tax.pages.length);
  mism.slice(0, 15).forEach(x => p('  ' + x));
  p('');
  p('== taxonomy categories vs built category pages ==');
  const catMis = [];
  for (const c of tax.categories) {
    const $ = load(path.join(LIB, 'categories', c.id + '.html'));
    const htmlDesc = ($('.page-desc').text() || '').trim();
    if (htmlDesc !== (c.description || '').trim()) catMis.push(c.id + ' desc differs\n     html: ' + htmlDesc.slice(0, 50) + '\n     tax : ' + (c.description || '').slice(0, 50));
    const titles = $('.tax-list li a b').map((i, el) => $(el).text().trim()).get();
    const taxTitles = tax.pages.filter(x => x.category === c.id).sort((a, b) => a.order - b.order).map(x => x.title);
    if (JSON.stringify(titles) !== JSON.stringify(taxTitles)) catMis.push(c.id + ' entry titles/order differ\n     html: ' + JSON.stringify(titles.slice(0, 4)) + '\n     tax : ' + JSON.stringify(taxTitles.slice(0, 4)));
  }
  p('mismatched categories: ' + catMis.length + ' / ' + tax.categories.length);
  catMis.slice(0, 12).forEach(x => p('  ' + x));
  p('');
  p('== build timestamps ==');
  p('  taxonomy.json mtime : ' + fs.statSync(path.join(ROOT, 'data', 'taxonomy.json')).mtime.toISOString());
  p('  manifest mtime      : ' + fs.statSync(path.join(ROOT, 'data', 'build-manifest.json')).mtime.toISOString());
  p('  index.html mtime    : ' + fs.statSync(path.join(LIB, 'index.html')).mtime.toISOString());
  p('  manifest.generated_at    : ' + (manifest && manifest.generated_at));
  p('  manifest.taxonomy.gen_at : ' + (manifest && manifest.taxonomy && manifest.taxonomy.generated_at));
  p('  taxonomy.generated_at    : ' + tax.generated_at);
  flush();
}

/* ---------------- raw dump ---------------- */
function probeRaw() {
  const rel = process.argv[3];
  const needle = process.argv[4] || '';
  const len = +(process.argv[5] || 4000);
  const s = fs.readFileSync(path.join(LIB, rel), 'utf8');
  if (!needle) { p(s.slice(0, len)); flush(); return; }
  let from = 0, n = 0;
  while (n < 6) {
    const i = s.indexOf(needle, from);
    if (i === -1) break;
    p('--- match at char ' + i + ' ---');
    p(s.slice(i, i + len));
    p('');
    from = i + needle.length; n++;
  }
  if (!n) p('(no match for ' + needle + ')');
  flush();
}

/* ---------------- dom skeleton ---------------- */
function probeStruct() {
  const $ = load(path.join(LIB, process.argv[3]));
  const maxDepth = +(process.argv[4] || 4);
  const lines = [];
  (function walk(el, d) {
    if (d > maxDepth || !el.tagName || ['#comment', 'script', 'style'].includes(el.tagName)) return;
    const cls = (el.attribs && el.attribs.class) ? '.' + el.attribs.class.split(/\s+/).join('.') : '';
    const id = (el.attribs && el.attribs.id) ? '#' + el.attribs.id : '';
    const txt = (el.children || []).filter(c => c.type === 'text').map(c => c.data.replace(/\s+/g, ' ').trim()).join(' ').slice(0, 70);
    lines.push('  '.repeat(d) + el.tagName + id + cls + (txt ? '  "' + txt + '"' : ''));
    for (const c of el.children || []) walk(c, d + 1);
  })($('body').get(0), 0);
  p('### ' + process.argv[3]);
  p(lines.join('\n'));
  flush();
}

const map = {
  inv: probeInv, tax: probeTax, duptitles: probeDuptitles, home: probeHome, cat: probeCat,
  pager: probePager, search: probeSearch, a11y: probeA11y, offline: probeOffline, pages: probePages,
  nav: probeNav, quality: probeQuality, consist: probeConsist, drift: probeDrift, raw: probeRaw, struct: probeStruct,
};
const probe = process.argv[2] || 'inv';
if (!map[probe]) { console.error('unknown probe: ' + probe + ' | available: ' + Object.keys(map).join(', ')); process.exit(1); }
map[probe]();
