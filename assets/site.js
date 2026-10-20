/* PaperMC docs offline library — front-end behaviour (no dependencies, file:// safe). */
(function () {
  'use strict';
  var doc = document;
  var html = doc.documentElement;

  /* ---------- theme ---------- */
  function applyTheme(t) {
    html.setAttribute('data-theme', t);
    try { localStorage.setItem('lcb-theme', t); } catch (e) {}
    var btn = doc.getElementById('theme-toggle');
    if (btn) btn.textContent = t === 'light' ? '浅色' : (t === 'dark' ? '深色' : '跟随系统');
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('lcb-theme'); } catch (e) {}
    applyTheme(saved || 'auto');
  }

  /* ---------- library root (assets/ lives at the library root) ---------- */
  function libraryRoot() {
    var scripts = doc.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      var idx = src.indexOf('assets/search-index.js');
      if (idx !== -1) return src.slice(0, idx);
    }
    var s2 = doc.getElementsByTagName('script');
    for (var j = 0; j < s2.length; j++) {
      var src2 = s2[j].getAttribute('src') || '';
      var k = src2.indexOf('assets/');
      if (k !== -1) return src2.slice(0, k);
    }
    return '';
  }

  /* ---------- sidebar filter ----------
     Matches the data-search attribute on the <a>, which carries the page title + Chinese
     summary + the source-structure group path (Paper > Development > … > ). Only <li>
     parents are hidden; group <details> (side-sec / side-group / side-cat) collapse when
     none of their entries match. */
  function initSidebar() {
    var filter = doc.getElementById('side-filter');
    if (!filter) return;
    var groups = doc.querySelectorAll('.side-group, .side-sec, .side-cat');
    var links = doc.querySelectorAll('.sidebar a[data-search]');
    var empty = doc.getElementById('side-empty');
    var total = links.length;

    /** 一个分组里“还看得见”的条目数：跳过已被隐藏的子孙分组，避免外层白留 */
    function visibleIn(g) {
      var n = 0;
      var lis = g.querySelectorAll('li');
      for (var i = 0; i < lis.length; i++) {
        var li = lis[i];
        if (li.style.display === 'none') continue;
        // 只数真正承载页面链接的 <li>（分组外层包裹的 <li> 不算条目）
        var isItem = false;
        for (var c = 0; c < li.children.length; c++) {
          var kid = li.children[c];
          if (kid.tagName === 'A' && kid.getAttribute('data-search') !== null) { isItem = true; break; }
        }
        if (!isItem) continue;
        var hid = false;
        var p = li.parentNode;
        while (p && p !== g) {
          if (p.style && p.style.display === 'none') { hid = true; break; }
          p = p.parentNode;
        }
        if (!hid) n++;
      }
      var own = g.querySelectorAll('a[data-search]');
      for (var j = 0; j < own.length; j++) {
        var host = own[j].parentNode;
        if (host && host.tagName && host.tagName.toLowerCase() !== 'li' && own[j].style.display !== 'none') n++;
      }
      return n;
    }

    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      var shown = 0;
      if (!q) {
        // 清空过滤：恢复全部条目与分组（包括上游那个没有子项的「Component API」空组）
        for (var r = 0; r < links.length; r++) {
          var h0 = links[r].parentNode;
          if (h0 && h0.tagName && h0.tagName.toLowerCase() === 'li') h0.style.display = '';
          links[r].style.display = '';
        }
        for (var g0 = 0; g0 < groups.length; g0++) groups[g0].style.display = '';
        if (empty) empty.style.display = 'none';
        return;
      }
      for (var k = 0; k < links.length; k++) {
        var hay = (links[k].getAttribute('data-search') || links[k].textContent || '').toLowerCase();
        var ok = !q || hay.indexOf(q) !== -1;
        var host = links[k].parentNode;
        if (host && host.tagName && host.tagName.toLowerCase() === 'li') host.style.display = ok ? '' : 'none';
        else links[k].style.display = ok ? '' : 'none';
        if (ok) shown += 1;
      }
      // 由内到外：querySelectorAll 是文档顺序，倒着走就能先算完内层分组
      for (var i = groups.length - 1; i >= 0; i--) {
        var vis = visibleIn(groups[i]);
        groups[i].style.display = vis ? '' : 'none';
        if (q && vis) groups[i].open = true;
      }
      if (empty) {
        empty.style.display = shown ? 'none' : 'block';
        empty.textContent = shown ? '' : ('没有匹配的页面（共 ' + total + ' 个条目，可试试更短的词）');
      }
    });
    var toggle = doc.getElementById('nav-toggle');
    if (toggle) toggle.addEventListener('click', function () { doc.body.classList.toggle('nav-open'); });
    // 组标题里的「组首页 →」链接：只导航，不要顺带折叠/展开所属分组
    doc.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('a.side-home')) ev.stopPropagation();
    }, true);
  }

  /* ---------- 全部页面清单：页内过滤（Ctrl+F 之外的第二条路） ---------- */
  function initTableFilter() {
    var inputs = doc.querySelectorAll('[data-table-filter]');
    for (var i = 0; i < inputs.length; i++) {
      (function (inp) {
        var id = inp.getAttribute('data-table-filter');
        var table = doc.getElementById(id);
        if (!table) return;
        var rows = table.querySelectorAll('tbody tr');
        var counter = doc.getElementById(id + '-count');
        var clearBtn = doc.querySelector('[data-filter-clear="' + id + '"]');
        var apply = function () {
          var q = inp.value.trim().toLowerCase();
          var shown = 0;
          for (var r = 0; r < rows.length; r++) {
            var hay = (rows[r].getAttribute('data-search') || rows[r].textContent || '').toLowerCase();
            var ok = !q || hay.indexOf(q) !== -1;
            rows[r].style.display = ok ? '' : 'none';
            if (ok) shown += 1;
          }
          if (counter) counter.textContent = shown + ' / ' + rows.length + ' 行';
        };
        inp.addEventListener('input', apply);
        if (clearBtn) clearBtn.addEventListener('click', function () { inp.value = ''; apply(); inp.focus(); });
      })(inputs[i]);
    }
  }

  /* ---------- copy buttons ---------- */
  function initCopy() {
    doc.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-copy-code]') : null;
      if (!btn) return;
      var fig = btn.closest('.code-block');
      var code = fig ? fig.querySelector('code') : null;
      if (!code) return;
      var text = code.textContent;
      var done = function () {
        btn.textContent = '已复制';
        btn.classList.add('done');
        setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('done'); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else { fallbackCopy(text, done); }
    });
  }
  function fallbackCopy(text, done) {
    var ta = doc.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    doc.body.appendChild(ta); ta.select();
    try { doc.execCommand('copy'); done(); } catch (e) {}
    doc.body.removeChild(ta);
  }

  /* ---------- image lightbox ---------- */
  function initLightbox() {
    var dlg = doc.getElementById('lightbox');
    if (!dlg || !dlg.showModal) return;
    var img = dlg.querySelector('img');
    var cap = dlg.querySelector('.lb-cap');
    doc.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== 'IMG' || !t.getAttribute('data-zoom')) return;
      img.src = t.getAttribute('src');
      img.alt = t.getAttribute('alt') || '';
      if (cap) {
        var fig = t.closest('.code-block');
        cap.textContent = (t.getAttribute('alt') || '') + (fig ? '' : '');
      }
      dlg.showModal();
    });
    dlg.addEventListener('click', function (ev) {
      if (ev.target === dlg || (ev.target.classList && ev.target.classList.contains('lb-close'))) dlg.close();
    });
  }

  /* ---------- table of contents scroll spy ---------- */
  function initToc() {
    var links = doc.querySelectorAll('.toc-side a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    var map = {};
    var targets = [];
    for (var i = 0; i < links.length; i++) {
      var id = decodeURIComponent(links[i].getAttribute('href').slice(1));
      var el = doc.getElementById(id);
      if (el) { map[id] = links[i]; targets.push(el); }
    }
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        if (!entries[e].isIntersecting) continue;
        var id2 = entries[e].target.id;
        if (current && current.classList) current.classList.remove('active');
        current = map[id2];
        if (current) current.classList.add('active');
      }
    }, { rootMargin: '-60px 0px -70% 0px', threshold: [0, 1] });
    for (var t = 0; t < targets.length; t++) io.observe(targets[t]);
  }

  /* ---------- search ----------
     Ranking model (kept in sync with the fields the build writes into the index):
       title 60/30 · tag exact 32+position · tag substring 20+position · summary 18
       headings 12 · category 8 · body 5
       Latin alias tiers: title 26 > heading 18 > summary/tag/category 10 > body 2
     Tiers (used for deterministic tie breaking): 4 = title · 3 = heading ·
     2 = summary/tag/category · 1 = body · 0 = unknown.
     Chinese queries with zero direct hits fall back to the curated phrase table (x0.6) and then
     to "all bigrams must match" (x0.45). */
  var INDEX = (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages) || [];
  var ALIASES = (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.aliases) || {};
  var PHRASE_BY_Q = {};
  ((window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.phrases) || []).forEach(function (p) { PHRASE_BY_Q[p.q] = p; });
  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

  function norm(s) { return String(s || '').toLowerCase(); }

  /** real heading list only: the index never stores derived entries in h anymore */
  function headingText(e) {
    return norm((e.h || []).filter(function (x) { return String(x).indexOf('关键词：') !== 0; }).join(' \u0001 '));
  }

  function directScore(e, q) {
    var out = { s: 0, fields: [], body: false, tier: 0 };
    var title = norm(e.t), sum = norm(e.u);
    var heads = headingText(e);
    var cat = norm((e.c || '') + ' ' + (e.cd || ''));
    var body = norm(e.x);
    var tags = e.kw || [];
    if (title.indexOf(q) === 0) { out.s += 60; out.fields.push('标题'); out.tier = 4; }
    else if (title.indexOf(q) !== -1) { out.s += 30; out.fields.push('标题'); out.tier = 4; }
    for (var i = 0; i < tags.length; i++) {
      var tg = norm(tags[i]);
      if (!tg) continue;
      if (tg === q) { out.s += 32 + Math.max(0, 8 - i * 3); out.fields.push('标签 ' + tags[i]); out.tier = Math.max(out.tier, 2); }
      else if (tg.indexOf(q) !== -1) { out.s += 20 + Math.max(0, 6 - i * 2); out.fields.push('标签 ' + tags[i]); out.tier = Math.max(out.tier, 2); }
    }
    if (sum.indexOf(q) !== -1) { out.s += 18; out.fields.push('摘要'); out.tier = Math.max(out.tier, 2); }
    if (heads.indexOf(q) !== -1) { out.s += 12; out.fields.push('小节'); out.tier = Math.max(out.tier, 3); }
    if (cat.indexOf(q) !== -1) { out.s += 8; out.fields.push('分类'); out.tier = Math.max(out.tier, 2); }
    if (body.indexOf(q) !== -1) { out.s += 5; out.body = true; out.fields.push('正文'); out.tier = Math.max(out.tier, 1); }
    // Latin alias, graded by the field it hits: title > heading > summary/tag/category > body
    var al = ALIASES[q];
    if (al && al.length) {
      var has = function (hay) {
        for (var j = 0; j < al.length; j++) if (hay.indexOf(al[j]) !== -1) return al[j];
        return '';
      };
      var tok = '';
      if ((tok = has(title))) { out.s += 26; out.fields.push('标题别名 ' + tok); out.tier = 4; }
      else if ((tok = has(heads))) { out.s += 18; out.fields.push('小节别名 ' + tok); out.tier = Math.max(out.tier, 3); }
      else if ((tok = has(norm([e.u, (e.kw || []).join(' '), e.c, e.cd, e.lt].join(' \u0001 '))))) {
        out.s += 10; out.fields.push('摘要/标签别名 ' + tok); out.tier = Math.max(out.tier, 2);
      } else if ((tok = has(body))) { out.s += 2; out.body = true; out.tier = Math.max(out.tier, 1); }
    }
    return out;
  }

  /** pure, deterministic ordering: score desc, then tier, order asc, title length, title, id */
  function compareHits(a, b) {
    if (b.s !== a.s) return b.s - a.s;
    if ((b.tier || 0) !== (a.tier || 0)) return (b.tier || 0) - (a.tier || 0);
    var ao = typeof a.e.o === 'number' ? a.e.o : 1e9;
    var bo = typeof b.e.o === 'number' ? b.e.o : 1e9;
    if (ao !== bo) return ao - bo;
    var at = String(a.e.t || ''), bt = String(b.e.t || '');
    if (at.length !== bt.length) return at.length - bt.length;
    var c = at.localeCompare(bt, 'zh-Hans-CN');
    if (c !== 0) return c;
    return String(a.e.id || '').localeCompare(String(b.e.id || ''));
  }

  function bigrams(q) {
    var g = [];
    for (var i = 0; i + 1 < q.length; i++) g.push(q.substr(i, 2));
    return g;
  }

  /** score one phrase part: literal match first, then its Latin alias tokens */
  function partScore(e, part) {
    var r = directScore(e, part);
    if (r.s > 0) return r;
    var al = ALIASES[part];
    if (al && al.length) {
      // same tiering as directScore: title 26 > heading 18 > summary/tag/category 10 > body 2
      var title = norm(e.t), heads = headingText(e), x = norm(e.x);
      var meta = norm([e.u, (e.kw || []).join(' '), e.c, e.cd, e.lt].join(' \u0001 '));
      var hit = function (hay) {
        for (var i = 0; i < al.length; i++) if (hay.indexOf(al[i]) !== -1) return al[i];
        return '';
      };
      var tok = '';
      if ((tok = hit(title))) return { s: 26, fields: ['标题别名 ' + tok], body: false, tier: 4 };
      if ((tok = hit(heads))) return { s: 18, fields: ['小节别名 ' + tok], body: false, tier: 3 };
      if ((tok = hit(meta))) return { s: 10, fields: ['摘要/标签别名 ' + tok], body: false, tier: 2 };
      if ((tok = hit(x))) return { s: 2, fields: ['正文'], body: true, tier: 1 };
    }
    return { s: 0, fields: [], body: false, tier: 0 };
  }

  function termScore(e, q) {
    var r = directScore(e, q);
    if (r.s > 0) return { s: r.s, fields: r.fields, body: r.body, tier: r.tier, fuzzy: false };
    // curated multi-word phrase: every part must match somewhere ("插件加载" -> 插件 + 加载)
    var ph = PHRASE_BY_Q[q];
    if (ph) {
      var ptotal = 0;
      var pfields = [];
      var pbody = false;
      var ptier = 0;
      for (var p = 0; p < ph.parts.length; p++) {
        var pr = partScore(e, ph.parts[p]);
        if (!pr.s) { ptotal = 0; break; }
        ptotal += pr.s;
        ptier = Math.max(ptier, pr.tier || 0);
        if (pr.body) pbody = true;
        for (var pf = 0; pf < pr.fields.length; pf++) if (pfields.indexOf(pr.fields[pf]) === -1) pfields.push(pr.fields[pf]);
      }
      if (ptotal > 0) return { s: Math.round(ptotal * 0.6), fields: pfields, body: pbody, tier: ptier, fuzzy: true };
    }
    if (q.length >= 3 && CJK.test(q)) {
      var gs = bigrams(q);
      var total = 0;
      var fields = [];
      var tier = 0;
      for (var i = 0; i < gs.length; i++) {
        var gr = directScore(e, gs[i]);
        if (gr.s <= 0) return { s: 0, fields: [], body: false, tier: 0, fuzzy: false };
        total += gr.s;
        tier = Math.max(tier, gr.tier || 0);
        for (var f = 0; f < gr.fields.length; f++) if (fields.indexOf(gr.fields[f]) === -1) fields.push(gr.fields[f]);
      }
      if (total > 0) return { s: Math.round(total * 0.45), fields: fields, body: true, tier: tier, fuzzy: true };
    }
    return { s: 0, fields: [], body: false, tier: 0, fuzzy: false };
  }

  function score(entry, terms) {
    var total = 0;
    var fields = [];
    var body = false;
    var tier = 0;
    for (var i = 0; i < terms.length; i++) {
      var r = termScore(entry, terms[i]);
      if (!r.s) return null;
      total += r.s;
      if (r.body) body = true;
      tier = Math.max(tier, r.tier || 0);
      for (var f = 0; f < r.fields.length; f++) if (fields.indexOf(r.fields[f]) === -1) fields.push(r.fields[f]);
    }
    return { s: total, fields: fields, body: body, tier: tier };
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function reEsc(s) { return String(s).replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&'); }

  /** snippet always comes from the field that produced the hit, with the query highlighted */
  function snippet(entry, terms, useBody) {
    var text = useBody && entry.x ? entry.x : (entry.u || entry.x || '');
    if (!text) return '';
    var low = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < terms.length; i++) {
      if (!terms[i]) continue;
      var p = low.indexOf(terms[i]);
      if (p !== -1 && (at === -1 || p < at)) at = p;
    }
    var start = at > 60 ? at - 50 : 0;
    var s = (start > 0 ? '…' : '') + text.slice(start, start + 200);
    for (var j = 0; j < terms.length; j++) {
      if (!terms[j]) continue;
      s = s.replace(new RegExp('(' + reEsc(terms[j]) + ')', 'gi'), '<mark class="sr-hit">$1</mark>');
    }
    return s;
  }

  var MAX_RESULTS = 40;

  function runSearch(q) {
    var query = q.trim().toLowerCase();
    var list = doc.getElementById('search-results');
    if (!list) return;
    list.innerHTML = '';
    if (!query) {
      renderEmpty('输入关键词开始检索：中文支持子串与分词近似（如 <b>渲染</b>、<b>命令注册</b>、<b>插件加载</b>），英文支持前缀（如 <b>yaml</b>、<b>anti</b>）。');
      setCount('');
      return;
    }
    var terms = query.split(/\s+/).filter(Boolean);
    var hits = [];
    for (var i = 0; i < INDEX.length; i++) {
      var r = score(INDEX[i], terms);
      if (r && r.s > 0) hits.push({ e: INDEX[i], s: r.s, tier: r.tier, fields: r.fields, body: r.body });
    }
    hits.sort(compareHits);
    if (!hits.length) {
      renderEmpty('没有匹配 <b>' + esc(q) + '</b> 的页面。试试更短的词、去掉标点，或改用英文关键词（如 <b>permission</b>、<b>tuning</b>）。');
      setCount('0 个结果');
      return;
    }
    var root = libraryRoot();
    var max = Math.min(hits.length, MAX_RESULTS);
    for (var k = 0; k < max; k++) {
      var hit = hits[k];
      var e = hit.e;
      var li = doc.createElement('li');
      var a = doc.createElement('a');
      a.href = root + (e.p || '');
      var chips = hit.fields.slice(0, 3).map(function (f) { return '<span class="sr-chip">命中：' + esc(f) + '</span>'; }).join('');
      a.innerHTML = '<div class="sr-ttl">' + esc(e.t || '') + '</div>'
        + '<div class="sr-path">' + esc(e.sn || [e.s, e.c].filter(Boolean).join(' · ')) + '</div>'
        + (chips ? '<div class="sr-hits">' + chips + '</div>' : '')
        + '<div class="sr-snip">' + (snippet(e, terms, hit.body) || esc(e.u || '')) + '</div>';
      li.appendChild(a);
      list.appendChild(li);
    }
    setCount(hits.length > max
      ? ('显示前 ' + max + ' / 共 ' + hits.length + ' 个结果')
      : (hits.length + ' 个结果'));
  }

  function setCount(text) {
    var info = doc.getElementById('search-count');
    if (info) info.textContent = text || '';
  }

  function renderEmpty(htmlStr) {
    var list = doc.getElementById('search-results');
    if (!list) return;
    var div = doc.createElement('div');
    div.className = 'sr-empty';
    div.innerHTML = htmlStr;
    list.appendChild(div);
  }

  function initSearch() {
    var dlg = doc.getElementById('search-dialog');
    var input = doc.getElementById('search-input');
    if (!dlg || !input || !dlg.showModal) return;
    var lastFocus = null;
    function open() {
      lastFocus = doc.activeElement;
      if (!dlg.open) dlg.showModal();
      input.focus(); input.select();
    }
    doc.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('[data-open-search]')) { ev.preventDefault(); open(); }
    });
    doc.addEventListener('keydown', function (ev) {
      var k = ev.key || '';
      if ((ev.ctrlKey || ev.metaKey) && (k === 'k' || k === 'K')) { ev.preventDefault(); open(); return; }
      if (k === 'Escape' && dlg.open) { dlg.close(); return; }
      if (k === '/' && !dlg.open && doc.activeElement && doc.activeElement.tagName !== 'INPUT'
          && doc.activeElement.tagName !== 'TEXTAREA') { ev.preventDefault(); open(); }
    });
    var timer = null;
    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { runSearch(input.value); }, 90);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        var first = doc.querySelector('#search-results a');
        if (first) window.location.href = first.getAttribute('href');
      }
    });
    dlg.addEventListener('close', function () { if (lastFocus && lastFocus.focus) lastFocus.focus(); });

    /* 首页 / 清单页的大搜索框：聚焦即打开搜索弹窗并把已输入内容带过去 */
    var hero = doc.querySelector('[data-hero-search]');
    if (hero) {
      var carry = function (takeFocus) {
        var q = hero.value;
        if (!dlg.open) { lastFocus = doc.activeElement; dlg.showModal(); }
        input.value = q;
        runSearch(q);
        if (takeFocus) { input.focus(); input.select(); }
      };
      hero.addEventListener('focus', function () { carry(false); });
      hero.addEventListener('input', function () { carry(false); });
      hero.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          carry(false);
          var first = doc.querySelector('#search-results a');
          if (first) window.location.href = first.getAttribute('href');
        }
      });
    }
  }

  function init() {
    initTheme();
    var btn = doc.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', function () {
      var cur = html.getAttribute('data-theme') || 'auto';
      applyTheme(cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto'));
    });
    initSidebar();
    initCopy();
    initLightbox();
    initToc();
    initSearch();
    initTableFilter();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
