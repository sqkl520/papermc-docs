/* PaperMC docs offline library — front-end behaviour (no dependencies, file:// safe). */
(function () {
  'use strict';
  var doc = document;
  var html = doc.documentElement;

  /* ---------- theme ---------- */
  function themeIcon(t) { return t === 'light' ? '☀' : (t === 'dark' ? '🌙' : '🖥'); }
  function applyTheme(t) {
    html.setAttribute('data-theme', t);
    try { localStorage.setItem('lcb-theme', t); } catch (e) {}
    var btn = doc.getElementById('theme-toggle');
    if (!btn) return;
    var label = t === 'light' ? '浅色' : (t === 'dark' ? '深色' : '跟随系统');
    var lbl = btn.querySelector('.lbl');
    var ic = btn.querySelector('.theme-icon');
    if (lbl && ic) {
      lbl.textContent = label;
      ic.textContent = themeIcon(t);
      btn.setAttribute('aria-label', '切换主题：' + label);
      btn.setAttribute('title', '切换主题（当前：' + label + '）');
    } else {
      btn.textContent = label;
    }
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

  /* 红队 F6/M3：每条目的小写副本只算一次（原实现每次按键都对 ~700KB 正文 toLowerCase）。
     用 WeakMap 缓存，避免把临时字段写进索引对象被序列化。 */
  var LC = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function lc(e) {
    var c = LC ? LC.get(e) : null;
    if (c) return c;
    var kw = e.kw || [];
    var lkw = [];
    for (var i = 0; i < kw.length; i++) lkw.push(norm(kw[i]));
    c = {
      t: norm(e.t), u: norm(e.u),
      h: headingText(e),
      c: norm((e.c || '') + ' ' + (e.cd || '')),
      x: norm(e.x),
      m: norm([e.u, kw.join(' '), e.c, e.cd, e.lt].join(' \u0001 ')),
      kw: lkw
    };
    if (LC) LC.set(e, c);
    return c;
  }

  /* 红队 F6/M3 第二步：正文预筛位图（单字 + 相邻双字哈希）。
     位图只用来跳过“肯定没有”的正文；出现假阳性时照旧走精确 indexOf，
     因此命中集合、分数与排序与改造前完全一致。 */
  var BITS = (typeof WeakMap === 'function') ? new WeakMap() : null;
  var BIT_WORDS = 1024;
  var BIT_MASK = (BIT_WORDS << 5) - 1;
  var BODY_IDX = new Map();
  function hbits(s, i, n) {
    var h = 2166136261;
    for (var k = 0; k < n; k++) { h ^= s.charCodeAt(i + k); h = (h * 16777619) >>> 0; }
    return h & BIT_MASK;
  }
  function bodyBits(e) {
    var bits = BITS ? BITS.get(e) : null;
    if (bits) return bits;
    bits = new Uint32Array(BIT_WORDS);
    var x = lc(e).x;
    for (var i = 0; i < x.length; i++) {
      var h1 = hbits(x, i, 1);
      bits[h1 >>> 5] |= (1 << (h1 & 31));
      if (i + 1 < x.length) { var h2 = hbits(x, i, 2); bits[h2 >>> 5] |= (1 << (h2 & 31)); }
    }
    if (BITS) BITS.set(e, bits);
    return bits;
  }
  function bitMayHave(bits, term) {
    var n = term.length;
    if (!n) return true;
    if (n === 1) { var h = hbits(term, 0, 1); return (bits[h >>> 5] & (1 << (h & 31))) !== 0; }
    for (var i = 0; i + 1 < n; i++) { var hh = hbits(term, i, 2); if ((bits[hh >>> 5] & (1 << (hh & 31))) === 0) return false; }
    return true;
  }
  /** 正文里 term 的首次出现位置；同一查询内跨条目/跨函数复用（含 snippet） */
  function bodyIndexOf(e, term) {
    if (!term) return -1;
    var m = BODY_IDX.get(term);
    if (!m) { m = new Map(); BODY_IDX.set(term, m); }
    if (m.has(e)) return m.get(e);
    var x = lc(e).x;
    var idx = (!x || !bitMayHave(bodyBits(e), term)) ? -1 : x.indexOf(term);
    m.set(e, idx);
    return idx;
  }
  function hasBodyAlias(e, al) {
    for (var i = 0; i < al.length; i++) if (al[i] && bodyIndexOf(e, al[i]) !== -1) return true;
    return false;
  }
  function resetScanCache() { BODY_IDX = new Map(); }
  /** 索引就绪后分片预热位图，避免首次按键承担 72MB 扫描（每片 <12ms） */
  function warmBodyBits() {
    var i = 0;
    (function step() {
      var t0 = Date.now();
      while (i < INDEX.length && Date.now() - t0 < 12) { bodyBits(INDEX[i]); i++; }
      if (i < INDEX.length) setTimeout(step, 0);
    })();
  }

  function directScore(e, q) {
    var out = { s: 0, fields: [], body: false, tier: 0 };
    var l = lc(e);
    var title = l.t, sum = l.u;
    var heads = l.h;
    var cat = l.c;
    var body = l.x;
    var tags = e.kw || [];
    if (title.indexOf(q) === 0) { out.s += 60; out.fields.push('标题'); out.tier = 4; }
    else if (title.indexOf(q) !== -1) { out.s += 30; out.fields.push('标题'); out.tier = 4; }
    for (var i = 0; i < tags.length; i++) {
      var tg = l.kw[i];
      if (!tg) continue;
      if (tg === q) { out.s += 32 + Math.max(0, 8 - i * 3); out.fields.push('标签 ' + tags[i]); out.tier = Math.max(out.tier, 2); }
      else if (tg.indexOf(q) !== -1) { out.s += 20 + Math.max(0, 6 - i * 2); out.fields.push('标签 ' + tags[i]); out.tier = Math.max(out.tier, 2); }
    }
    if (sum.indexOf(q) !== -1) { out.s += 18; out.fields.push('摘要'); out.tier = Math.max(out.tier, 2); }
    if (heads.indexOf(q) !== -1) { out.s += 12; out.fields.push('小节'); out.tier = Math.max(out.tier, 3); }
    if (cat.indexOf(q) !== -1) { out.s += 8; out.fields.push('分类'); out.tier = Math.max(out.tier, 2); }
    if (bodyIndexOf(e, q) !== -1) { out.s += 5; out.body = true; out.fields.push('正文'); out.tier = Math.max(out.tier, 1); }
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
      else if ((tok = has(l.m))) {
        out.s += 10; out.fields.push('摘要/标签别名 ' + tok); out.tier = Math.max(out.tier, 2);
      } else if (hasBodyAlias(e, al)) { out.s += 2; out.body = true; out.tier = Math.max(out.tier, 1); }
    }
    return out;
  }

  /** pure, deterministic ordering: score desc, then tier, order asc, title length, title, id
   *  红队 M3 追加修复（2026-10-21 第二轮）：本函数是按键路径上最后的热点 —— 4x CPU + CDP Profiler
   *  实测 compareHits 自身耗时 68–78ms/次（每次排序对 60+ 条命中调用 localeCompare(x, locale)，
   *  每次都要重新解析 locale 串）。改为复用一个 Intl.Collator(locale) 实例：默认选项与
   *  localeCompare(other, locale) 一致（usage=sort / sensitivity=variant），排序结果逐字节不变
   *  （probe-render.js 的 htmlSha 对拍：4 个查询的命中数与结果 DOM 哈希全部相同）。 */
  var ZH_COLL = (typeof Intl !== 'undefined' && Intl.Collator) ? new Intl.Collator('zh-Hans-CN') : null;
  function zhCompare(x, y) { return ZH_COLL ? ZH_COLL.compare(x, y) : String(x).localeCompare(String(y), 'zh-Hans-CN'); }
  function compareHits(a, b) {
    if (b.s !== a.s) return b.s - a.s;
    if ((b.tier || 0) !== (a.tier || 0)) return (b.tier || 0) - (a.tier || 0);
    var ao = typeof a.e.o === 'number' ? a.e.o : 1e9;
    var bo = typeof b.e.o === 'number' ? b.e.o : 1e9;
    if (ao !== bo) return ao - bo;
    var at = String(a.e.t || ''), bt = String(b.e.t || '');
    if (at.length !== bt.length) return at.length - bt.length;
    var c = zhCompare(at, bt);
    if (c !== 0) return c;
    return zhCompare(String(a.e.id || ''), String(b.e.id || ''));
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
      var l = lc(e);
      var title = l.t, heads = l.h, x = l.x;
      var meta = l.m;
      var hit = function (hay) {
        for (var i = 0; i < al.length; i++) if (hay.indexOf(al[i]) !== -1) return al[i];
        return '';
      };
      var tok = '';
      if ((tok = hit(title))) return { s: 26, fields: ['标题别名 ' + tok], body: false, tier: 4 };
      if ((tok = hit(heads))) return { s: 18, fields: ['小节别名 ' + tok], body: false, tier: 3 };
      if ((tok = hit(meta))) return { s: 10, fields: ['摘要/标签别名 ' + tok], body: false, tier: 2 };
      for (var bi = 0; bi < al.length; bi++) if (al[bi] && bodyIndexOf(e, al[bi]) !== -1) return { s: 2, fields: ['正文'], body: true, tier: 1 };
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
    var l = lc(entry);
    var byBody = !!(useBody && entry.x);
    var text = byBody ? entry.x : (entry.u || entry.x || '');
    if (!text) return '';
    var low = (byBody || !entry.u) ? l.x : l.u;
    var at = -1;
    var bodyText = (byBody || !entry.u);
    for (var i = 0; i < terms.length; i++) {
      if (!terms[i]) continue;
      var p = bodyText ? bodyIndexOf(entry, terms[i]) : low.indexOf(terms[i]);
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
  /* 查询代次：切片的渲染任务用它判断「这一片是否已被新查询取代」（红队 M3 追加修复） */
  var searchGen = 0;

  function runSearch(q) {
    resetScanCache();
    var query = q.trim().toLowerCase();
    var list = doc.getElementById('search-results');
    if (!list) return;
    if (!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages)) {
      list.innerHTML = '';
      renderEmpty('正在加载搜索索引…');
      setCount('');
      ensureIndex(function () { runSearch(q); });
      return;
    }
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
    /* 红队 M3 追加修复（2026-10-21 第二轮）：小写缓存/位图把「打分」降到 ~5–26ms，但 40 行结果
       一次性插入仍会在 4x CPU 下产生 50–240ms 的长任务（CDP LayoutDuration 实测占主导，非 JS）。
       这里把渲染切片：每片 ≤6 行且 ≤6ms 实时，片间让出主线程；最终 DOM（顺序/内容/条数/链接）
       与一次性渲染逐项一致，命中集合与排序也不受影响。首行同步渲染，保证 Enter 立即导航可用。 */
    var gen = ++searchGen;
    var rendered = 0;
    var total = max;
    function paintCount() {
      setCount(hits.length > total
        ? ('显示前 ' + total + ' / 共 ' + hits.length + ' 个结果')
        : (hits.length + ' 个结果'));
    }
    function renderOne(idx) {
      var hit = hits[idx];
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
    if (total > 0) { renderOne(0); rendered = 1; }
    paintCount();
    if (rendered < total) {
      (function step() {
        if (gen !== searchGen) return;           /* 已有新查询 → 丢弃本次剩余切片 */
        var t0 = Date.now();
        var n = 0;
        while (rendered < total && n < 3 && Date.now() - t0 < 4) { renderOne(rendered); rendered++; n++; }
        if (rendered < total) setTimeout(step, 0);
      })();
    }
  }

  function setCount(text) {
    var info = doc.getElementById('search-count');
    if (info) info.textContent = text || '';
  }

  /* ---------- off-canvas 抽屉导航（契约 §2.3：<=1023.98px 抽屉；>=1024px 复位为常驻侧栏） ---------- */
  function initDrawer() {
    var toggle = doc.getElementById('nav-toggle');
    var side = doc.getElementById('sidebar');
    var scrim = doc.getElementById('nav-scrim') || doc.querySelector('[data-nav-scrim], .nav-scrim, .nav-overlay');
    if (!toggle || !side) return;
    var wide = window.matchMedia('(min-width:1024px)');
    var supportsGutter = !!(window.CSS && window.CSS.supports && window.CSS.supports('scrollbar-gutter', 'stable'));
    function isWide() { return wide.matches; }
    function isOpen() { return doc.body.classList.contains('nav-open'); }
    function setInert(on) {
      try { side.inert = !!on; } catch (e) {}
      if (on) side.setAttribute('inert', ''); else side.removeAttribute('inert');
    }
    function lockScroll(on) {
      if (on) {
        doc.body.style.overflow = 'hidden';
        if (supportsGutter) html.classList.add('nav-locked');
        else {
          var gap = window.innerWidth - html.clientWidth;
          if (gap > 0) doc.body.style.paddingRight = gap + 'px';
        }
      } else {
        doc.body.style.overflow = '';
        doc.body.style.paddingRight = '';
        html.classList.remove('nav-locked');
      }
    }
    function openDrawer() {
      if (isWide() || isOpen()) return;
      doc.body.classList.add('nav-open');
      toggle.setAttribute('aria-expanded', 'true');
      setInert(false);
      lockScroll(true);
      var first = side.querySelector('a[href], button, input, summary');
      if (first && first.focus) { try { first.focus(); } catch (e) {} }
    }
    function closeDrawer(refocus) {
      var wasOpen = isOpen();
      doc.body.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
      lockScroll(false);
      if (!isWide()) setInert(true);
      if (wasOpen && refocus !== false && toggle.focus) { try { toggle.focus(); } catch (e) {} }
    }
    toggle.addEventListener('click', function () { if (isOpen()) closeDrawer(); else openDrawer(); });
    if (scrim) scrim.addEventListener('click', function () { closeDrawer(); });
    side.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('a[href]') && !isWide()) closeDrawer(false);
      else if (t && t.closest && t.closest('input, summary, button') && !isWide()) openDrawer();
    });
    doc.addEventListener('keydown', function (ev) {
      var k = ev.key || '';
      if ((k === 'Escape' || k === 'Esc') && isOpen()) { ev.preventDefault(); closeDrawer(); }
    });
    function applyMode() {
      if (isWide()) { closeDrawer(false); setInert(false); }
      else if (!isOpen()) setInert(true);
    }
    if (wide.addEventListener) wide.addEventListener('change', applyMode);
    else if (wide.addListener) wide.addListener(applyMode);
    applyMode();
  }

  /* ---------- 代码块 / 表格的横向滚动容器与键盘可达（契约 §2.2 / DoD D1-D3） ---------- */
  function codeLabel(pre, overflowing) {
    var code = pre.querySelector('code');
    var lang = '';
    if (code && code.className) {
      var m = String(code.className).match(/language-([A-Za-z0-9_+.#-]+)/);
      if (m) lang = m[1] === 'text' ? '' : ('（' + m[1] + '）');
    }
    var fig = pre.closest ? pre.closest('.code-block') : null;
    var file = fig ? fig.querySelector('.code-file') : null;
    var title = file && file.textContent ? ('：' + file.textContent.trim()) : '';
    return '代码块' + lang + title + (overflowing ? '，可横向滚动（左右方向键）' : '');
  }
  function initScrollRegions() {
    var pres = doc.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      var host = null;
      var q = pre.parentElement;
      for (var k = 0; k < 3 && q && q !== doc.body; k++) {
        var cs = getComputedStyle(q);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') { host = q; break; }
        q = q.parentElement;
      }
      if (!host) {
        host = doc.createElement('div');
        host.className = 'code-scroll';
        pre.parentNode.insertBefore(host, pre);
        host.appendChild(pre);
      }
      host.setAttribute('tabindex', '0');
      host.setAttribute('role', 'region');
      if (!host.getAttribute('aria-label')) host.setAttribute('aria-label', codeLabel(pre, false));
    }
    var tables = doc.querySelectorAll('table');
    for (var t = 0; t < tables.length; t++) {
      var tb = tables[t];
      var wrap = tb.closest ? tb.closest('.table-wrap') : null;
      if (!wrap) {
        wrap = doc.createElement('div');
        wrap.className = 'table-wrap';
        tb.parentNode.insertBefore(wrap, tb);
        wrap.appendChild(tb);
      }
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('role', 'region');
      if (!wrap.getAttribute('aria-label')) wrap.setAttribute('aria-label', '数据表格，可用左右方向键横向滚动');
    }
    syncScrollRegions();
  }
  /** 只有真的溢出时才标记 data-overflowing（契约 v2 §6：避免给不溢出的块加噪音语义） */
  function syncScrollRegions() {
    var hosts = doc.querySelectorAll('.code-scroll');
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      var pre = host.querySelector('pre');
      var over = pre ? (pre.scrollWidth > pre.clientWidth + 1 || host.scrollWidth > host.clientWidth + 1) : false;
      if (over) host.setAttribute('data-overflowing', ''); else host.removeAttribute('data-overflowing');
      if (pre) host.setAttribute('aria-label', codeLabel(pre, over));
    }
    var wraps = doc.querySelectorAll('.table-wrap');
    for (var w = 0; w < wraps.length; w++) {
      var el = wraps[w];
      if (el.scrollWidth > el.clientWidth + 1) el.setAttribute('data-overflowing', ''); else el.removeAttribute('data-overflowing');
    }
  }

  /* ---------- 搜索索引按需加载（契约 v2 F1）：首屏不加载 ~800KB 索引 ---------- */
  var indexState = 'idle';
  var indexWaiters = [];
  function applySearchData() {
    var data = window.__LIBRARY_SEARCH__;
    INDEX = (data && data.pages) || [];
    ALIASES = (data && data.aliases) || {};
    PHRASE_BY_Q = {};
    ((data && data.phrases) || []).forEach(function (p) { PHRASE_BY_Q[p.q] = p; });
    try { warmBodyBits(); } catch (e) {}
  }
  function loadJsonFallback(done) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', libraryRoot() + 'search-index.json', true);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { window.__LIBRARY_SEARCH__ = JSON.parse(xhr.responseText); done(true); return; } catch (e) {}
        }
        done(false);
      };
      xhr.onerror = function () { done(false); };
      xhr.send();
    } catch (e) { done(false); }
  }
  function ensureIndex(cb) {
    if (indexState === 'ready') { if (cb) cb(); return; }
    if (cb) indexWaiters.push(cb);
    if (indexState === 'loading' || indexState === 'failed') return;
    indexState = 'loading';
    var done = function (ok) {
      indexState = ok ? 'ready' : 'failed';
      if (ok) applySearchData();
      var waiters = indexWaiters.slice();
      indexWaiters.length = 0;
      for (var i = 0; i < waiters.length; i++) { try { waiters[i](); } catch (e) {} }
    };
    var sc = doc.createElement('script');
    sc.src = libraryRoot() + 'assets/search-index.js';
    sc.async = true;
    sc.onload = function () { done(!!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages)); };
    sc.onerror = function () { loadJsonFallback(done); };
    doc.head.appendChild(sc);
  }
  function preloadIndex() { if (indexState === 'idle') ensureIndex(null); }


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
    initDrawer();
    initScrollRegions();
    initCopy();
    initLightbox();
    initToc();
    initSearch();
    initTableFilter();
  }

  var rsTimer = null;
  window.addEventListener('resize', function () {
    if (rsTimer) clearTimeout(rsTimer);
    rsTimer = setTimeout(syncScrollRegions, 150);
  });
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (window.requestIdleCallback) window.requestIdleCallback(preloadIndex, { timeout: 3000 });
      else preloadIndex();
    }, 1200);
  });

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
