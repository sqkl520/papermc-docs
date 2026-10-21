'use strict';
/**
 * f6-probe.js — F6 指标探针：索引热身状态下「单次搜索按键」的长任务分布。
 *
 * 协议（与 reports/mobile-search-perf.md §2 一致，改前/改后同口径）：
 *   390×844 · deviceScaleFactor=2 · isMobile+hasTouch（移动仿真）
 *   CDP `Emulation.setCPUThrottlingRate = 4`；叠加档再开
 *   `Network.emulateNetworkConditions` Slow 4G（400kbps / 400kbps / 400ms）
 *   热身：DOM 直调打开搜索（规避 390px 顶栏溢出遮挡搜索按钮）→ 等索引就绪 → 预热查询 + 静置
 *   测量：逐字符**真实按键**（page.keyboard.type），每键后静置 settle ms，
 *         PerformanceObserver(type=longtask) 记录该键窗口内的长任务（>50ms = 预算超标）
 *
 * 用法：
 *   node tools/f6-probe.js [--url=http://127.0.0.1:8787] [--pre=http://127.0.0.1:8788]
 *     [--side=post|pre|both] [--rounds=3] [--cpu=4] [--slow4g]
 *     [--queries=权限,配置,性能] [--json=reports/f6-probe.json] [--settle=700]
 *     [--mode=measure|semantic|recount] [--headed]
 *
 *   --mode=measure  ：长任务测量（默认）
 *   --mode=semantic ：抓每个查询的结果 DOM（条数 + 逐条 href/标题），供改前/改后逐条比对
 *   --mode=recount  ：离线复算。切片 `assets/site.js` / `_pre-mobile/assets/site.js` 里的**同一份**
 *                     打分与排序代码，在 Node 里对各自的 search-index.json 复算命中集与顺序。
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const num = (n, d) => { const v = Number(opt(n, d)); return Number.isFinite(v) ? v : d; };

const ROOT = path.resolve(__dirname, '..');
const POST_URL = opt('url', 'http://127.0.0.1:8787').replace(/\/$/, '');
const PRE_URL = opt('pre', 'http://127.0.0.1:8788').replace(/\/$/, '');
const SIDE = opt('side', 'post');                      // post | pre | both
const MODE = opt('mode', 'measure');                   // measure | semantic | recount
const ROUNDS = Math.max(1, num('rounds', 3) | 0);
const CPU = num('cpu', 4);
const SLOW4G = has('slow4g') || opt('slow4g', '0') === '1';
const SETTLE = num('settle', 700);
const OPEN_TIMEOUT = num('open-timeout', SLOW4G ? 90000 : 30000);
const PAGE = opt('page', '/');
const HEADED = has('headed');
const QUERIES = opt('queries', '权限,配置,性能').split(',').map((s) => s.trim()).filter(Boolean);
const JSON_OUT = opt('json', MODE === 'measure' ? path.join('reports', 'f6-probe.json') : '');
const INDEX_POST = opt('index', path.join(ROOT, 'search-index.json'));
const INDEX_PRE = opt('pre-index', path.join(ROOT, '..', '_pre-mobile', 'search-index.json'));
const SITE_JS_POST = opt('site-js', path.join(ROOT, 'assets', 'site.js'));
const SITE_JS_PRE = opt('pre-site-js', path.join(ROOT, '..', '_pre-mobile', 'assets', 'site.js'));

const VIEWPORT = { width: 390, height: 844 };

/** 浏览器二进制：env 拼路径优先（不出现盘符字面量） */
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);

function browserPath() { for (const c of CANDIDATES) if (fs.existsSync(c)) return c; return null; }

/** 写盘：Node fs，utf8、无 BOM、LF */
function writeOut(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.replace(/\r\n/g, '\n'), 'utf8');
}

const round2 = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ *
 * 页面内注入的探针（只读观测，不改变任何行为）
 * ------------------------------------------------------------------ */
const INSTALL = () => {
  if (window.__f6) return;
  const f6 = (window.__f6 = { lt: [], sync: [], tKey: 0, events: [] });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const at = (e.attribution || [])[0] || {};
        f6.lt.push({
          name: e.name, dur: Math.round(e.duration * 100) / 100,
          start: Math.round(e.startTime * 100) / 100,
          ctype: at.containerType || at.name || '', csrc: at.containerSrc || '',
        });
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch (err) { f6.ltErr = String(err && err.message); }
  const input = document.getElementById('search-input');
  if (!input) { f6.noInput = true; return; }
  window.addEventListener('keydown', () => { f6.tKey = performance.now(); }, true);
  // 气泡阶段、注册在站点处理器之后 → 记录「keydown → 输入处理器返回」的同步耗时
  input.addEventListener('input', () => { f6.sync.push(Math.round((performance.now() - f6.tKey) * 100) / 100); }, false);
  // 纯同步路径耗时：直接派发 input 事件并对 dispatchEvent 计时（不含浏览器按键处理）
  f6.dispatch = function (v) {
    const el = document.getElementById('search-input');
    el.value = v;
    const t0 = performance.now();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return Math.round((performance.now() - t0) * 100) / 100;
  };
  f6.reset = function () { f6.lt = []; f6.sync = []; f6.tKey = 0; f6.lastMut = 0; f6.mutN = 0; };
  f6.clearInput = function () {
    const el = document.getElementById('search-input');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /* 结果列表的变更时间（用于「渲染静默」判定与渲染总耗时归因；只观察 list 的 childList）*/
  const list = document.getElementById('search-results');
  if (list && typeof MutationObserver === 'function') {
    new MutationObserver(() => { f6.lastMut = performance.now(); f6.mutN++; }).observe(list, { childList: true });
  }
};

/** 等到结果列表连续 quietMs 无变更（不截断分片渲染），返回等待耗时 */
async function waitQuiet(page, quietMs, timeout) {
  const t0 = Date.now();
  await page.waitForFunction((q) => (window.__f6.lastMut || 0) > 0 && (performance.now() - window.__f6.lastMut) > q,
    quietMs, { timeout }).catch(() => {});
  return Date.now() - t0;
}

const COLLECT = () => {
  const f6 = window.__f6 || {};
  const base = f6.tKey ? { tKey: f6.tKey } : null;
  const lt = (f6.lt || []).map((e) => ({
    dur: e.dur, start: e.start, name: e.name, ctype: e.ctype,
    phase: base ? (e.start - base.tKey < 24 ? 'key' : 'post') : 'post',
  }));
  return {
    lt, sync: (f6.sync || []).slice(),
    keyPhaseMax: lt.filter((e) => e.phase === 'key').reduce((m, e) => Math.max(m, e.dur), 0),
    max: lt.reduce((m, e) => Math.max(m, e.dur), 0),
    count: lt.length,
    rows: document.querySelectorAll('#search-results a').length,
    countText: (document.getElementById('search-count') || {}).textContent || '',
    renderMs: (f6.tKey && f6.lastMut) ? Math.round(f6.lastMut - f6.tKey) : null,
    mutations: f6.mutN || 0,
  };
};

/** 打开搜索框：DOM 直调（390px 下顶栏溢出会遮挡搜索按钮，普通点击不可达） */
const OPEN_SEARCH = () => {
  const btn = document.querySelector('[data-open-search]');
  if (btn) { try { btn.click(); } catch (e) {} }
  const dlg = document.getElementById('search-dialog');
  if (dlg && !dlg.open && dlg.showModal) { try { dlg.showModal(); } catch (e) {} }
  const i = document.getElementById('search-input');
  if (i) { i.focus(); i.select(); }
  return { open: !!(dlg && dlg.open), focused: document.activeElement === i };
};

const SEMANTIC = () => {
  const links = Array.from(document.querySelectorAll('#search-results a'));
  return {
    count: (document.getElementById('search-count') || {}).textContent || '',
    n: links.length,
    items: links.map((a) => ({
      href: a.getAttribute('href'),
      ttl: ((a.querySelector('.sr-ttl') || {}).textContent || '').trim(),
      path: ((a.querySelector('.sr-path') || {}).textContent || '').trim(),
      snip: ((a.querySelector('.sr-snip') || {}).textContent || '').trim().slice(0, 120),
    })),
  };
};

/** href 归一化：剥掉相对前缀后再比对（否则是假 firstDiff=0） */
function normHref(h) {
  return String(h || '').replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
}

function stats(nums) {
  if (!nums.length) return { n: 0 };
  const s = nums.slice().sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, min: s[0], median: med, max: s[s.length - 1] };
}

/* ------------------------------------------------------------------ *
 * 离线复算：切片站点产物里**同一份**打分/排序代码
 * ------------------------------------------------------------------ */
function sliceCore(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('var INDEX = (window.__LIBRARY_SEARCH__');
  if (a < 0) throw new Error('core start marker missing in ' + file);
  let b = src.indexOf('var MAX_RESULTS', a);
  if (b < 0) b = src.indexOf('function runSearch', a);
  if (b < 0) throw new Error('core end marker missing in ' + file);
  return { code: src.slice(a, b), bytes: src.length, from: a, to: b };
}

function loadCore(file, indexFile) {
  const { code, bytes, from, to } = sliceCore(file);
  const data = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const win = { __LIBRARY_SEARCH__: data };
  const f = new Function('window', 'globalThis',
    code + '\nreturn { INDEX: INDEX, ALIASES: ALIASES, PHRASE_BY_Q: PHRASE_BY_Q, score: score, compareHits: compareHits,'
    + ' reset: (typeof resetScanCache === "function" ? resetScanCache : function(){}),'
    + ' bitsReady: function(){ return (typeof BITS_READY !== "undefined") ? BITS_READY : null; } };');
  const core = f(win, win);
  return { core, data, slice: { file, bytes, from, to } };
}

function recountOne(core, query) {
  const q = String(query).trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (let i = 0; i < core.INDEX.length; i++) {
    const ent = core.INDEX[i];
    const r = core.score(ent, terms);
    if (r && r.s > 0) hits.push({ e: ent, s: r.s, tier: r.tier, fields: r.fields, body: r.body });
  }
  hits.sort(core.compareHits);
  return {
    query: String(query), total: hits.length,
    top: hits.slice(0, 40).map((h) => ({ href: normHref(h.e.p), t: h.e.t, s: h.s, tier: h.tier })),
  };
}

/* ------------------------------------------------------------------ *
 * 浏览器测量
 * ------------------------------------------------------------------ */
async function withThrottle(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  if (SLOW4G) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 400,
      downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((400 * 1024) / 8),
      connectionType: 'cellular4g',
    });
  }
  return cdp;
}

async function openAndWarm(page, base, log) {
  const t0 = Date.now();
  await page.goto(base + PAGE, { waitUntil: 'load', timeout: OPEN_TIMEOUT });
  await page.evaluate(INSTALL);
  const opened = await page.evaluate(OPEN_SEARCH);
  await page.waitForFunction(() => !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages && window.__LIBRARY_SEARCH__.pages.length),
    null, { timeout: OPEN_TIMEOUT });
  const indexLoadMs = Date.now() - t0;
  // 预热：跑一次查询让位图/缓存建立（改后侧 warmBodyBits 分片进行），再静置
  await page.evaluate((q) => { window.__f6.reset(); window.__f6.dispatch(q); }, QUERIES[0]);
  await page.waitForTimeout(SLOW4G ? 3000 : 2500);
  await page.evaluate((q) => { window.__f6.reset(); window.__f6.dispatch(q); }, QUERIES[0]);
  await page.waitForTimeout(SLOW4G ? 1500 : 900);
  const warm = await page.evaluate(COLLECT);
  const idxBytes = await page.evaluate(() => {
    const d = window.__LIBRARY_SEARCH__;
    return { entries: (d && d.pages && d.pages.length) || 0, generated_at: (d && d.generated_at) || '' };
  });
  log('  index ready in ' + indexLoadMs + 'ms · entries=' + idxBytes.entries + ' · open=' + JSON.stringify(opened) + ' · warmKeyMax=' + round2(warm.max));
  return { indexLoadMs, warm, opened, index: idxBytes };
}

async function runRound(browser, base, log) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN',
  });
  const page = await ctx.newPage();
  const out = { side: SIDE, ok: false };
  try {
    await withThrottle(ctx, page);
    out.warm = await openAndWarm(page, base, log);
    out.queries = [];
    for (const q of QUERIES) {
      await page.evaluate(() => window.__f6.clearInput());
      await page.waitForTimeout(SETTLE);
      const keys = [];
      for (const ch of q) {
        await page.evaluate(() => { window.__f6.reset(); });
        await page.keyboard.type(ch, { delay: 0 });
        await page.waitForTimeout(SETTLE);
        await waitQuiet(page, 200, 6000);        /* 不截断分片渲染：等结果列表静默 */
        const rec = await page.evaluate(COLLECT);
        keys.push({
          ch, max: round2(rec.max), keyPhaseMax: round2(rec.keyPhaseMax), count: rec.count,
          syncHandler: rec.sync[0] != null ? rec.sync[0] : null,
          rows: rec.rows, renderMs: rec.renderMs, mutations: rec.mutations, countText: rec.countText,
          durs: rec.lt.map((e) => e.dur), lt: rec.lt,
        });
      }
      await page.waitForTimeout(SETTLE);
      const syncPathMs = await page.evaluate((v) => window.__f6.dispatch(v), q);
      const last = keys[keys.length - 1] || {};
      const row = {
        query: q,
        keys,
        rows: last.rows, renderMs: last.renderMs, mutations: last.mutations, countText: last.countText,
        keyMax: round2(Math.max(0, ...keys.map((k) => k.max))),
        keyPhaseMax: round2(Math.max(0, ...keys.map((k) => k.keyPhaseMax))),
        syncPathMs,
      };
      out.queries.push(row);
      log('  「' + q + '」按键 longtask: ' + keys.map((k) => k.max).join(' / ') + ' ms  → max ' + row.keyMax
        + 'ms · keyPhaseMax ' + row.keyPhaseMax + 'ms · syncPath ' + syncPathMs + 'ms · 行数 ' + row.rows
        + ' · 渲染完成 ' + row.renderMs + 'ms/' + row.mutations + ' 片 · ' + row.countText);
    }
    out.ok = true;
  } catch (e) {
    out.error = String((e && e.message) || e);
    log('  ERROR ' + out.error);
  }
  await ctx.close();
  return out;
}

async function runSemantic(browser, base, log) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const out = { side: SIDE, queries: [] };
  try {
    await withThrottle(ctx, page);
    const warm = await openAndWarm(page, base, log);
    out.warm = { indexLoadMs: warm.indexLoadMs, entries: warm.index.entries, generated_at: warm.index.generated_at };
    for (const q of QUERIES) {
      await page.evaluate((v) => { window.__f6.clearInput(); window.__f6.dispatch(v); }, q);
      await page.waitForTimeout(SETTLE * 2);
      const sem = await page.evaluate(SEMANTIC);
      out.queries.push({ query: q, count: sem.count, n: sem.n, items: sem.items.map((it) => ({ ...it, hrefNorm: normHref(it.href) })) });
      log('  「' + q + '」' + sem.count + ' · DOM 行数 ' + sem.n + ' · 首条 ' + (sem.items[0] ? normHref(sem.items[0].href) : '-'));
    }
  } catch (e) {
    out.error = String((e && e.message) || e);
    log('  ERROR ' + out.error);
  }
  await ctx.close();
  return out;
}

async function runTrace(browser, base, log) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const out = { side: SIDE, traces: [] };
  try {
    const cdp = await withThrottle(ctx, page);
    out.warm = await openAndWarm(page, base, log);
    for (const q of QUERIES) {
      await page.evaluate(() => window.__f6.clearInput());
      await page.waitForTimeout(SETTLE);
      const evs = [];
      const onData = (d) => { for (const e of d.value) evs.push(e); };
      cdp.on('Tracing.dataCollected', onData);
      await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,devtools.timeline.invalidationTracking,blink.user_timing,benchmark,disabled-by-default-devtools.timeline.invalidationTracking',
        options: 'record-command-line',
      });
      await page.evaluate(() => window.__f6.reset());
      await page.evaluate((m) => performance.mark(m), 'F6START');
      for (const ch of q) { await page.keyboard.type(ch, { delay: 0 }); await page.waitForTimeout(SETTLE); }
      await page.waitForTimeout(SETTLE);
      const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
      await cdp.send('Tracing.end');
      await done;
      cdp.off('Tracing.dataCollected', onData);
      const lt = await page.evaluate(COLLECT);
      const docH = await page.evaluate(() => document.documentElement.scrollHeight);
      // t0 = 页内 performance.mark('F6START') 的 trace 时间戳（µs）→ 与 trace ts 同一时间基
      let t0 = null;
      for (const e of evs) if (e.name === 'F6START' && e.ph === 'R') { t0 = e.ts; break; }
      if (t0 == null) t0 = Math.min.apply(null, evs.filter((e) => e.ph === 'X' && e.ts).map((e) => e.ts));
      // 只保留 t0 之后、时长 > 0 的完整事件
      const keep = ['Layout', 'UpdateLayoutTree', 'Paint', 'Layerize', 'Commit', 'CompositeLayers', 'PrePaint',
        'HitTest', 'EventDispatch', 'FunctionCall', 'TimerFire', 'TimerInstall', 'ScheduleStyleRecalculation',
        'InvalidateLayout', 'StyleRecalcInvalidationTracking', 'LayoutInvalidationTracking', 'RecalcStyle', 'UpdateLayerTree'];
      const by = new Map();
      const paints = [];
      const longest = [];
      const inval = new Map();
      for (const e of evs) {
        if (e.ph !== 'X' || typeof e.dur !== 'number' || !e.ts) continue;
        if (e.ts < t0 - 50) continue;
        const rel = Math.round((e.ts - t0) / 1000);
        if (/Invalidat|RecalcStyle/.test(e.name)) {
          const d = (e.args && e.args.data) || {};
          const st = (d.stackTrace || d.stack || [])[0] || {};
          const key = e.name + '|' + (d.nodeName || '-') + '|' + (d.reason || d.invalidatedSelectorId || '-') + '|' + (st.functionName || st.url || '-');
          const cur = inval.get(key) || { event: e.name, node: d.nodeName || '-', reason: d.reason || '-', fn: (st.functionName || '') + '@' + String(st.url || '').replace(/^.*\//, '') + ':' + (st.lineNumber || 0), count: 0, total: 0 };
          cur.count++; cur.total += e.dur / 1000;
          inval.set(key, cur);
        }
        if (keep.includes(e.name)) {
          const cur = by.get(e.name) || { name: e.name, count: 0, total: 0, max: 0 };
          cur.count++; cur.total += e.dur / 1000; cur.max = Math.max(cur.max, e.dur / 1000);
          by.set(e.name, cur);
        }
        if (e.name === 'Paint') {
          const clip = (e.args && e.args.data && e.args.data.clip) || null;
          let area = 0;
          if (clip && clip.length === 8) area = Math.abs(clip[2] - clip[0]) * Math.abs(clip[5] - clip[1]);
          paints.push({ dur: Math.round(e.dur / 1000), clip, area, layer: (e.args && e.args.data && e.args.data.layerId) || '' });
        }
        if (e.dur / 1000 > 8 && keep.includes(e.name)) longest.push({ name: e.name, dur: Math.round(e.dur / 1000), at: rel });
      }
      const agg = Array.from(by.values())
        .map((x) => ({ name: x.name, count: x.count, total: Math.round(x.total), max: Math.round(x.max) }))
        .sort((a, b) => b.total - a.total);
      const clips = new Map();
      for (const p of paints) {
        const c = p.clip ? p.clip.join(',') : 'none';
        const cur = clips.get(c) || { clip: c, count: 0, total: 0, max: 0, area: p.area };
        cur.count++; cur.total += p.dur; cur.max = Math.max(cur.max, p.dur);
        clips.set(c, cur);
      }
      const row = {
        query: q, longtaskMax: round2(lt.max), longtaskCount: lt.count, longtasks: lt.lt.map((e) => ({ dur: e.dur, phase: e.phase, ctype: e.ctype })),
        docHeight: docH, byName: agg,
        paints: Array.from(clips.values()).sort((a, b) => b.total - a.total).slice(0, 6),
        longest: longest.sort((a, b) => b.dur - a.dur).slice(0, 12),
        invalidations: Array.from(inval.values()).sort((a, b) => b.total - a.total).slice(0, 12)
          .map((x) => ({ ...x, total: Math.round(x.total) })),
      };
      out.traces.push(row);
      log('  「' + q + '」trace events ' + evs.length + ' · longtask ' + row.longtaskMax + 'ms · docH=' + row.docHeight);
      log('    top: ' + agg.slice(0, 6).map((x) => x.name + ' ' + x.total + 'ms/' + x.count + '(max ' + x.max + ')').join(' · '));
      log('    paint clips: ' + row.paints.map((p) => '[' + p.clip + '] ' + p.total + 'ms x' + p.count + ' area=' + p.area).join(' | '));
      log('    longest: ' + row.longest.map((x) => x.name + '@' + x.at + 'ms ' + x.dur + 'ms').join(' · '));
      log('    invalidations: ' + row.invalidations.slice(0, 6).map((x) => x.node + '/' + x.reason + ' x' + x.count + ' (' + x.total + 'ms) ' + x.fn).join(' | '));
    }
  } catch (e) {
    out.error = String((e && e.message) || e);
    log('  ERROR ' + out.error);
  }
  await ctx.close();
  return out;
}

/* ------------------------------------------------------------------ */
function compareSemantic(pre, post, log) {
  const cmp = [];
  for (const q of QUERIES) {
    const a = (pre.queries || []).find((x) => x.query === q);
    const b = (post.queries || []).find((x) => x.query === q);
    if (!a || !b) { cmp.push({ query: q, ok: false, reason: 'missing side' }); continue; }
    const ha = a.items.map((i) => i.hrefNorm), hb = b.items.map((i) => i.hrefNorm);
    let firstDiff = -1;
    for (let i = 0; i < Math.max(ha.length, hb.length); i++) if (ha[i] !== hb[i]) { firstDiff = i; break; }
    const ok = firstDiff === -1 && a.count === b.count && a.n === b.n;
    cmp.push({
      query: q, ok, countPre: a.count, countPost: b.count, rowsPre: a.n, rowsPost: b.n,
      firstDiff, firstDiffPre: firstDiff === -1 ? null : ha[firstDiff], firstDiffPost: firstDiff === -1 ? null : hb[firstDiff],
      titleDiff: ha.map((h, i) => (a.items[i].ttl === b.items[i].ttl ? null : i)).filter((x) => x !== null),
    });
    log('  「' + q + '」count ' + a.count + ' vs ' + b.count + ' · firstDiff=' + firstDiff + (ok ? '  ✅ 一致' : '  ❌ 不一致'));
  }
  return cmp;
}

function compareRecount(preR, postR, log) {
  const cmp = [];
  for (const q of QUERIES) {
    const a = preR.find((x) => x.query === q), b = postR.find((x) => x.query === q);
    const ha = a.top.map((i) => i.href), hb = b.top.map((i) => i.href);
    let firstDiff = -1;
    for (let i = 0; i < Math.max(ha.length, hb.length); i++) if (ha[i] !== hb[i]) { firstDiff = i; break; }
    const sdiff = a.top.filter((x, i) => b.top[i] && b.top[i].s !== x.s).length;
    cmp.push({ query: q, ok: firstDiff === -1 && a.total === b.total, totalPre: a.total, totalPost: b.total, firstDiff, scoreDiffs: sdiff });
    log('  「' + q + '」offline total ' + a.total + ' vs ' + b.total + ' · top40 firstDiff=' + firstDiff + ' · scoreDiff=' + sdiff + (cmp[cmp.length - 1].ok ? '  ✅' : '  ❌'));
  }
  return cmp;
}

(async () => {
  const t00 = Date.now();
  const report = {
    generated_at: new Date().toISOString(),
    tool: 'tools/f6-probe.js', mode: MODE, cwd: process.cwd(),
    protocol: {
      viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, page: PAGE,
      cpuThrottleRate: CPU, slow4g: SLOW4G,
      slow4gDetail: SLOW4G ? { latency: 400, downloadThroughputBps: 51200, uploadThroughputBps: 51200 } : null,
      settleMs: SETTLE, rounds: ROUNDS, queries: QUERIES,
      openVia: 'DOM 直调（[data-open-search].click() + dialog.showModal()），规避 390px 顶栏遮挡',
    },
    urls: { post: POST_URL, pre: PRE_URL }, side: SIDE,
  };

  if (MODE === 'recount') {
    const log = console.log;
    const preRec = loadCore(SITE_JS_PRE, INDEX_PRE);
    const postRec = loadCore(SITE_JS_POST, INDEX_POST);
    log('[recount] pre  slice ' + preRec.slice.from + '..' + preRec.slice.to + ' of ' + SITE_JS_PRE + ' · index entries ' + preRec.core.INDEX.length);
    log('[recount] post slice ' + postRec.slice.from + '..' + postRec.slice.to + ' of ' + SITE_JS_POST + ' · index entries ' + postRec.core.INDEX.length);
    const preR = QUERIES.map((q) => recountOne(preRec.core, q));
    const postR = QUERIES.map((q) => recountOne(postRec.core, q));
    report.recount = {
      pre: { slice: preRec.slice, entries: preRec.core.INDEX.length, index: INDEX_PRE, generated_at: preRec.data.generated_at, results: preR },
      post: { slice: postRec.slice, entries: postRec.core.INDEX.length, index: INDEX_POST, generated_at: postRec.data.generated_at, results: postR },
    };
    report.recount.compare = compareRecount(preR, postR, log);
    log('[recount] done in ' + (Date.now() - t00) + 'ms');
  } else {
    const exe = browserPath();
    if (!exe) { console.error('no chrome/chromium found'); process.exit(1); }
    report.browser = exe;
    const browser = await chromium.launch({ executablePath: exe, headless: !HEADED, args: ['--no-sandbox'] });
    const sides = SIDE === 'both' ? ['post', 'pre'] : [SIDE];
    try {
      if (MODE === 'trace') {
        report.trace = await runTrace(browser, sides[0] === 'pre' ? PRE_URL : POST_URL, console.log);
      } else if (MODE === 'semantic') {
        const sem = {};
        for (const s of sides) {
          const base = s === 'pre' ? PRE_URL : POST_URL;
          console.log('[semantic] ' + s + ' ← ' + base);
          sem[s] = await runSemantic(browser, base, console.log);
        }
        report.semantic = sem;
        if (sem.pre && sem.post) report.semantic.compare = compareSemantic(sem.pre, sem.post, console.log);
      } else {
        for (const s of sides) {
          const base = s === 'pre' ? PRE_URL : POST_URL;
          report[s] = [];
          for (let r = 1; r <= ROUNDS; r++) {
            console.log('[measure] side=' + s + ' round ' + r + '/' + ROUNDS + ' ← ' + base + '  cpu=' + CPU + 'x slow4g=' + SLOW4G);
            const res = await runRound(browser, base, console.log);
            res.round = r;
            report[s].push(res);
            const all = res.queries ? res.queries.map((q) => q.keyMax) : [];
            if (all.length) console.log('  round ' + r + ' 每查询最大按键 longtask: ' + all.join(' / ') + ' ms  → 本档 max ' + Math.max(...all) + 'ms');
            if (JSON_OUT) { report.partial = true; writeOut(JSON_OUT, JSON.stringify(report, null, 2)); }
          }
          delete report.partial;
          const maxes = report[s].filter((x) => x.queries).flatMap((x) => x.queries.map((q) => q.keyMax));
          const syncs = report[s].filter((x) => x.queries).flatMap((x) => x.queries.map((q) => q.syncPathMs));
          const rms = report[s].filter((x) => x.queries).map((x) => x.renderMs).filter((x) => typeof x === 'number');
          console.log('[' + s + '] 全部按键 longtask stats: ' + JSON.stringify(stats(maxes)) + '  syncPath: ' + JSON.stringify(stats(syncs)) + '  renderMs: ' + JSON.stringify(stats(rms)));
        }
      }
    } finally {
      await browser.close();
    }
  }

  report.elapsedMs = Date.now() - t00;
  if (JSON_OUT) { writeOut(JSON_OUT, JSON.stringify(report, null, 2)); console.log('wrote ' + JSON_OUT); }
  else console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error('FATAL ' + ((e && e.stack) || e)); process.exit(1); });
