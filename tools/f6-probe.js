#!/usr/bin/env node
'use strict';
/* eslint-disable */
/**
 * tools/f6-probe.js —— 移动端「搜索面板」性能探针（第五次全量重跑 / 严格协议版）
 *
 * 接口（任务书要求）：
 *   node tools/f6-probe.js [--url=…] [--pre=…] [--rounds=N] [--json=…]
 * 常用附加参数：
 *   [--mode=measure|semantic|recount] [--only=post|pre|both] [--side=post|pre|both]
 *   [--cpu-mode=cpu|stack|both] [--page=/paper/] [--text=permissions]
 *   [--interval=120] [--settle=2500] [--stable=600] [--queries=权限,配置,性能] [--headful|--headed]
 *
 * ── mode=measure（默认）：严格测量协议 ────────────────────────────────────────
 *   1) 改前侧必须 force 点击搜索入口：390px 下改前顶栏溢出会遮挡搜索按钮，普通点击静默落空。
 *      依次尝试 page.click('[data-open-search]', {force:true}) → DOM 级 click() → Ctrl+K →
 *      showModal()，并回报实际生效的那一档（open=<way>）。
 *   2) 热身到「结果非空」（不是等固定毫秒）：输入一个字符 → 等结果 DOM 出现 → 清空 →
 *      等稳定（稳定的定义：连续 --stable ms 内没有新的 longtask）。
 *   3) 按 keydown 分档记录 longtask（t ∈ [key 起, key+interval)），并**同时**报告：
 *      · 每键纯同步 dispatch 耗时（window 捕获端 → 冒泡端 performance.now 差值 = 传播路径上
 *        全部 handler 的同步耗时；另附 Event Timing processingEnd-processingStart 与官方口径的
 *        合成 input dispatch 单次采样，后者故意放在整轮窗口之外以免污染读数）
 *      · 整轮（含最后一次按键后的 settle 2.5s）长任务：个数 / 总和 / 单次最大 / 完整列表
 *      > 只统计「最后一次按键之前」的窗口会漏掉 debounce 后那次执行。
 *   4) 每组 ≥3 轮取中位，并打印每轮原始列表。
 *   5) 档位：4×CPU（cpu4x）与 4×CPU + Slow 4G（slow4g+cpu4x，1.6Mbps/0.75Mbps/150ms —— 与
 *      tools/verify-mobile.js --check=14 官方口径一致），视口 390×844 / DSF 2 / isMobile+hasTouch，
 *      页面 /paper/，输入 --text（默认 permissions，11 键，键间隔 120ms）。
 *
 * ── mode=semantic：抓每个查询的结果 DOM（条数 + 逐条 href/标题）供改前/改后逐条比对 ──
 * ── mode=recount ：离线复算：切片站点产物里同一份打分/排序代码，对各自 search-index.json 复算 ──
 *
 * 只读站点；只写 --json 指定的文件。不碰 assets/**、data/**，不执行 git。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ══════════════════════════ 参数 ══════════════════════════ */
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
function opt(n, d) {
  const p = '--' + n + '=';
  const h = argv.find((a) => a.startsWith(p));
  return h === undefined ? d : h.slice(p.length);
}
const num = (n, d) => { const v = Number(opt(n, d)); return Number.isFinite(v) ? v : d; };

const ROOT = path.resolve(__dirname, '..');
const POST_URL = String(opt('url', 'http://127.0.0.1:8787')).replace(/\/$/, '');
const PRE_URL = String(opt('pre', 'http://127.0.0.1:8788')).replace(/\/$/, '');
const MODE = String(opt('mode', 'measure'));                 // measure | semantic | recount
const SIDE = String(opt('side', 'both'));                    // post | pre | both（与 --only 等价）
const ONLY = String(opt('only', SIDE === 'both' ? 'both' : SIDE));
const ROUNDS = Math.max(1, num('rounds', 3) | 0);
const CPU = num('cpu', 4);
const SLOW4G = has('slow4g') || opt('slow4g', '0') === '1';
const CPUMODE = String(opt('cpu-mode', SLOW4G ? 'stack' : 'both'));   // cpu | stack | both
const SETTLE = num('settle', 2500);
const STABLE = num('stable', 600);
const INTERVAL = num('interval', 120);
const TEXT = String(opt('text', 'permissions'));
const PAGE = String(opt('page', '/paper/'));
const HEADED = has('headed') || has('headful');
const QUERIES = String(opt('queries', '权限,配置,性能')).split(',').map((s) => s.trim()).filter(Boolean);
const JSON_OUT = opt('json', '');
const OPEN_TIMEOUT = num('open-timeout', 180000);
const INDEX_POST = opt('index', path.join(ROOT, 'search-index.json'));
const INDEX_PRE = opt('pre-index', path.join(ROOT, '..', '_pre-mobile', 'search-index.json'));
const SITE_JS_POST = opt('site-js', path.join(ROOT, 'assets', 'site.js'));
const SITE_JS_PRE = opt('pre-site-js', path.join(ROOT, '..', '_pre-mobile', 'assets', 'site.js'));

const VIEWPORT = { width: num('vw', 390), height: num('vh', 844) };
const THROTTLE = { downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8), uploadThroughput: Math.round(750 * 1024 / 8), latency: 150 };

/** 浏览器二进制：env 拼路径（脚本内不出现盘符字面量） */
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);

function browserPath() {
  const seen = new Set();
  for (const c of CANDIDATES) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    try { if (fs.existsSync(c)) return c; } catch (e) { /* ignore */ }
  }
  return null;
}

/** 写盘：Node fs，utf8、无 BOM、LF */
function writeOut(file, text) {
  const p = path.resolve(file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(text).replace(/\r\n/g, '\n'), 'utf8');
}

const round1 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const maxOf = (a) => (a.length ? a.reduce((m, x) => Math.max(m, x), 0) : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function median(a) {
  const v = a.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
}
function stats(nums) {
  if (!nums.length) return { n: 0 };
  const s = nums.slice().sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, min: s[0], median: med, max: s[s.length - 1] };
}
function charKey(ch) {
  if (ch === ' ') return 'Space';
  if (/^[A-Z]$/.test(ch)) return 'Shift+' + ch;
  return ch;
}

function profilesFromMode() {
  const list = [];
  if (CPUMODE === 'cpu' || CPUMODE === 'both') list.push({ name: 'cpu4x', cpu: true, net: false });
  if (CPUMODE === 'stack' || CPUMODE === 'both') list.push({ name: 'slow4g+cpu4x', cpu: true, net: true });
  return list;
}
function sidesFromOnly() {
  if (ONLY === 'pre') return ['pre'];
  if (ONLY === 'post') return ['post'];
  return ['post', 'pre'];
}
const urlOf = (s) => (s === 'pre' ? PRE_URL : POST_URL);

/* ───────── 产物指纹：逐轮前后校验被测构建是否被换过（并发写者检测） ─────────
   默认指纹仓库工作树；--fp-root/--fp-root-pre 指向冻结快照目录时，指纹跟着快照走
   （站点若为快照副本，指纹必须跟快照；否则并发写者改仓库会误报 unstable）。 */
const FP_ROOT = opt('fp-root', ROOT);
const FP_ROOT_PRE = opt('fp-root-pre', path.join(ROOT, '..', '_pre-mobile'));
const FP_FILES = [
  ['post/assets/site.js', path.join(FP_ROOT, 'assets', 'site.js')],
  ['post/assets/site.css', path.join(FP_ROOT, 'assets', 'site.css')],
  ['post/search-index.json', path.join(FP_ROOT, 'search-index.json')],
  ['pre/assets/site.js', path.join(FP_ROOT_PRE, 'assets', 'site.js')],
  ['pre/assets/site.css', path.join(FP_ROOT_PRE, 'assets', 'site.css')],
  ['pre/search-index.json', path.join(FP_ROOT_PRE, 'search-index.json')],
];
function fingerprint() {
  const out = {};
  for (const pair of FP_FILES) {
    const label = pair[0], file = pair[1];
    try {
      const b = fs.readFileSync(file);
      out[label] = b.length + ':' + crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);
    } catch (e) { out[label] = 'missing'; }
  }
  return out;
}
const fpKey = (fp) => Object.keys(fp).map((k) => k + '=' + fp[k]).join('|');
async function withThrottle(ctx, page, prof) {
  const cdp = await ctx.newCDPSession(page);
  if (prof.net) {
    await cdp.send('Network.enable').catch(() => {});
    await cdp.send('Network.emulateNetworkConditions', Object.assign({ offline: false, connectionType: 'cellular4g' }, THROTTLE)).catch(() => {});
  }
  if (prof.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.rate || CPU }).catch(() => {});
  return cdp;
}

/* ══════════════════════ mode=measure：严格协议 ══════════════════════ */
/* 页面内插桩（document start，纯观测） */
const INIT_SRC = `(() => {
  const F = { lt: [], sync: [], et: [], marks: [], frames: [], t0: null, rec: {} };
  window.__f6 = F;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) F.lt.push({ t: Math.round(e.startTime * 100) / 100, d: Math.round(e.duration * 100) / 100 });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { F.ltErr = String(e && e.message); }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'keydown' || e.name === 'keyup' || e.name === 'input') {
          F.et.push({ n: e.name, t: Math.round(e.startTime * 100) / 100, proc: Math.round((e.processingEnd - e.processingStart) * 100) / 100 });
        }
      }
    }).observe({ type: 'event', durationThreshold: 0 });
  } catch (e) { F.etErr = String(e && e.message); }
  const TYPES = ['keydown', 'keyup', 'input'];
  const pend = {};
  for (const ty of TYPES) {
    window.addEventListener(ty, () => { pend[ty] = performance.now(); }, true);
    window.addEventListener(ty, (ev) => {
      const s = pend[ty];
      if (s === undefined) return;
      delete pend[ty];
      F.sync.push({ type: ty, t: Math.round(s * 100) / 100, ms: Math.round((performance.now() - s) * 1000) / 1000, key: ev.key || '' });
    }, false);
  }
  const tick = () => {
    F.frames.push(Math.round(performance.now() * 100) / 100);
    if (F.frames.length > 6000) F.frames.splice(0, 3000);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

/** 协议 1：打开搜索面板（force 优先，逐档回退并回报生效者） */
async function openSearch(page) {
  const isOpen = () => page.evaluate(() => { const d = document.getElementById('search-dialog'); return !!(d && d.open); });
  if (await isOpen()) return 'already-open';
  try {
    await page.click('[data-open-search]', { force: true, timeout: 4000 });
    await page.waitForTimeout(200);
    if (await isOpen()) return 'click(force)';
  } catch (e) { /* 落空 → 下一档 */ }
  try {
    await page.evaluate(() => { const b = document.querySelector('[data-open-search]'); if (b) b.click(); });
    await page.waitForTimeout(200);
    if (await isOpen()) return 'js-click';
  } catch (e) { /* ignore */ }
  try {
    await page.keyboard.press('Control+K');
    await page.waitForTimeout(250);
    if (await isOpen()) return 'ctrl+K';
  } catch (e) { /* ignore */ }
  await page.evaluate(() => {
    const d = document.getElementById('search-dialog');
    if (d && !d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
  });
  await page.waitForTimeout(200);
  return (await isOpen()) ? 'forced-showModal' : 'FAILED';
}
async function focusInput(page) {
  await page.evaluate(() => { const i = document.getElementById('search-input'); if (i) { i.focus(); i.select(); } });
}
async function setValue(page, v) {
  try { await page.fill('#search-input', v, { force: true, timeout: 3000 }); return 'fill'; } catch (e) { /* fallthrough */ }
  await page.evaluate((val) => {
    const i = document.getElementById('search-input');
    if (!i) return;
    i.value = val;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  return 'evaluate';
}

/** 协议 2：热身到结果非空 → 清空 → 稳定 */
async function warmUp(page, log) {
  await focusInput(page);
  await setValue(page, '');
  await sleep(320);
  await focusInput(page);
  await page.keyboard.type(TEXT.slice(0, 1));
  let rowsSeen = 0;
  try {
    await page.waitForFunction(() => document.querySelectorAll('#search-results a[href]').length > 0, null, { timeout: OPEN_TIMEOUT, polling: 200 });
    rowsSeen = await page.evaluate(() => document.querySelectorAll('#search-results a[href]').length);
  } catch (e) { log.push('warn: warmup 未等到非空结果'); }
  await sleep(300);
  await focusInput(page);
  await setValue(page, '');
  try {
    await page.waitForFunction(() => document.querySelectorAll('#search-results a[href]').length === 0, null, { timeout: 60000, polling: 120 });
  } catch (e) { log.push('warn: 清空后结果列表未归零'); }
  await page.evaluate((ms) => new Promise((res) => {
    const F = window.__f6;
    let last = performance.now();
    let n = F.lt.length;
    const iv = setInterval(() => {
      if (F.lt.length !== n) { n = F.lt.length; last = performance.now(); }
      if (performance.now() - last > ms) { clearInterval(iv); res(null); }
    }, 40);
  }), STABLE);
  return rowsSeen;
}

/** 协议 3+4：单轮测量 */
async function runRoundStrict(page, tag, log) {
  const rowsWarm = await warmUp(page, log);
  const before = await page.evaluate(() => {
    const F = window.__f6;
    F.lt.length = 0; F.sync.length = 0; F.et.length = 0; F.marks.length = 0; F.frames.length = 0;
    const i = document.getElementById('search-input');
    if (i) { i.focus(); i.select(); }
    F.t0 = performance.now();
    F.rec.before = {
      value: i ? i.value : null,
      rows: document.querySelectorAll('#search-results a[href]').length,
      countText: ((document.getElementById('search-count') || {}).textContent || '').trim(),
    };
    if (!F.marksHooked) { F.marksHooked = true; window.addEventListener('keydown', () => { F.marks.push(performance.now()); }, true); }
    return F.rec.before;
  });

  const chars = TEXT.split('');
  for (let i = 0; i < chars.length; i++) {
    await page.keyboard.press(charKey(chars[i]));
    if (i < chars.length - 1) await sleep(INTERVAL);
  }
  await sleep(SETTLE);                                   /* 含最后一次按键后的 settle 2.5s */

  const raw = await page.evaluate(() => {
    const F = window.__f6;
    const c = document.getElementById('search-count');
    return {
      t0: F.t0, lt: F.lt, sync: F.sync, et: F.et, marks: F.marks, frames: F.frames, before: F.rec.before,
      after: {
        value: (document.getElementById('search-input') || {}).value,
        rows: document.querySelectorAll('#search-results a[href]').length,
        countText: c ? c.textContent.trim() : null,
      },
      ltErr: F.ltErr || null, etErr: F.etErr || null,
    };
  });

  /* 官方口径的合成 input 同步 dispatch（单次采样，放在整轮窗口之外） */
  const synth = await page.evaluate(() => {
    const i = document.getElementById('search-input');
    if (!i) return null;
    const t = performance.now();
    try { i.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* ignore */ }
    return Math.round((performance.now() - t) * 10) / 10;
  });
  await sleep(400);

  const t0 = raw.t0;
  const marks = raw.marks.map((m) => round1(m - t0));
  const ltList = raw.lt.map((e) => ({ t: round1(e.t - t0), d: e.d }));
  const syncList = raw.sync.map((y) => ({ type: y.type, t: round1(y.t - t0), ms: y.ms, key: y.key }));
  const perKey = [];
  for (let i = 0; i < marks.length; i++) {
    const s = marks[i], e = marks[i] + INTERVAL;
    const inWin = ltList.filter((x) => x.t >= s && x.t < e);
    const si = syncList.filter((y) => y.type === 'input' && y.t >= s && y.t < e);
    const sk = syncList.filter((y) => y.type === 'keydown' && y.t >= s && y.t < e);
    perKey.push({
      i: i + 1, ch: chars[i] || null, t: s,
      ltCount: inWin.length, ltSum: round1(sum(inWin.map((x) => x.d))), ltMax: round1(maxOf(inWin.map((x) => x.d))),
      ltList: inWin.map((x) => x.d),
      syncInputMax: round1(maxOf(si.map((y) => y.ms))), syncInputSum: round1(sum(si.map((y) => y.ms))),
      syncKeydownMax: round1(maxOf(sk.map((y) => y.ms))),
    });
  }
  const tailStart = marks.length ? marks[marks.length - 1] + INTERVAL : 0;
  const tail = ltList.filter((x) => x.t >= tailStart);
  const syncIn = syncList.filter((y) => y.type === 'input').map((y) => y.ms);
  const syncKd = syncList.filter((y) => y.type === 'keydown').map((y) => y.ms);
  const frames = raw.frames;
  const busyFrames = frames.map((f, i) => (i === 0 ? 0 : f - frames[i - 1])).filter((d) => d > 50).length;

  return {
    tag, rowsWarm, before, after: raw.after, keys: marks.length, marks,
    fpEnd: fingerprint(),
    ltCount: ltList.length, ltSum: round1(sum(ltList.map((x) => x.d))), ltMax: round1(maxOf(ltList.map((x) => x.d))), ltList,
    perKey,
    tail: { count: tail.length, sum: round1(sum(tail.map((x) => x.d))), max: round1(maxOf(tail.map((x) => x.d))), list: tail.map((x) => x.d) },
    perKeyAgg: {
      ltMax: round1(maxOf(perKey.map((k) => k.ltMax))), ltSum: round1(sum(perKey.map((k) => k.ltSum))),
      syncInputMax: round1(maxOf(perKey.map((k) => k.syncInputMax))), syncInputSum: round1(sum(perKey.map((k) => k.syncInputMax))),
    },
    sync: {
      inputCount: syncIn.length, inputMax: round1(maxOf(syncIn)), inputSum: round1(sum(syncIn)),
      keydownMax: round1(maxOf(syncKd)), keydownSum: round1(sum(syncKd)), list: syncList,
    },
    syncDispatchOfficial: synth, et: raw.et, busyFrames, ltErr: raw.ltErr, etErr: raw.etErr,
  };
}

async function openGroup(browser, name, url, prof, log) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: 'light', reducedMotion: 'no-preference', locale: 'zh-CN',
  });
  await ctx.addInitScript(INIT_SRC);
  const page = await ctx.newPage();
  await withThrottle(ctx, page, prof);

  const tNav = Date.now();
  await page.goto(url + PAGE, { waitUntil: 'load', timeout: OPEN_TIMEOUT });
  const navMs = Date.now() - tNav;
  const how = await openSearch(page);
  log.push(name + '@' + prof.name + ': open=' + how + ' nav=' + navMs + 'ms url=' + url + PAGE);
  if (how === 'FAILED') throw new Error('搜索面板未能打开：' + url + PAGE);
  return { ctx, page, name, url: url + PAGE, profile: prof.name, open: how, navMs, rounds: [], fpOpen: fingerprint() };
}

function finalizeGroup(h) {
  const rounds = h.rounds;
  return {
    name: h.name, url: h.url, profile: h.profile, open: h.open, navMs: h.navMs, fpOpen: h.fpOpen, rounds,
    median: {
      ltCount: median(rounds.map((x) => x.ltCount)),
      ltSum: median(rounds.map((x) => x.ltSum)),
      ltMax: median(rounds.map((x) => x.ltMax)),
      perKeyLtMax: median(rounds.map((x) => x.perKeyAgg.ltMax)),
      perKeyLtSum: median(rounds.map((x) => x.perKeyAgg.ltSum)),
      syncInputMax: median(rounds.map((x) => x.perKeyAgg.syncInputMax)),
      syncInputSum: median(rounds.map((x) => x.perKeyAgg.syncInputSum)),
      syncKeydownMax: median(rounds.map((x) => x.sync.keydownMax)),
      tailMax: median(rounds.map((x) => x.tail.max)),
      tailSum: median(rounds.map((x) => x.tail.sum)),
      busyFrames: median(rounds.map((x) => x.busyFrames)),
    },
  };
}

async function runMeasure(browser, log) {
  const profiles = profilesFromMode();
  const sides = sidesFromOnly();
  const report = { protocol: protocolRecord(), groups: [], log };
  for (const prof of profiles) {
    const handles = [];
    for (const s of sides) {
      process.stdout.write('== ' + s + ' @ ' + prof.name + '  ' + urlOf(s) + PAGE + '  (cpu=' + CPU + 'x' + (prof.net ? ' + Slow4G' : '') + ') ==\n');
      handles.push(await openGroup(browser, s, urlOf(s), prof, log));
    }
    /* 轮流配对：每一轮内 pre/post 紧邻交替（奇偶轮反向），使机器上的并发漂移对两侧等价 */
    for (let r = 1; r <= ROUNDS; r++) {
      const order = (r % 2 === 1) ? handles : handles.slice().reverse();
      for (const h of order) {
        const res = await runRoundStrict(h.page, r, log);
        h.rounds.push(res);
        process.stdout.write('  [' + h.name + ' ' + h.profile + '] round ' + r +
          ': lt n=' + res.ltCount + ' sum=' + res.ltSum + 'ms max=' + res.ltMax + 'ms' +
          ' | 每键 sync(input) max=' + res.perKeyAgg.syncInputMax + ' sum=' + res.perKeyAgg.syncInputSum + 'ms' +
          ' | rows=' + res.after.rows + ' "' + res.after.countText + '"' +
          (fpKey(h.fpOpen) === fpKey(res.fpEnd) ? ' | artifactsStable=true' : ' | ⚠️ artifactsStable=FALSE（构建在轮内被换，本轮作废）') + '\n');
      }
    }
    for (const h of handles) {
      await h.ctx.close().catch(() => {});
      report.groups.push(finalizeGroup(h));
    }
  }
  return report;
}

function protocolRecord() {
  return {
    mode: 'measure', strict: true,
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, page: PAGE,
    cpuThrottleRate: CPU,
    profiles: profilesFromMode().map((p) => p.name),
    slow4gDetail: THROTTLE, fpRoot: FP_ROOT, fpRootPre: FP_ROOT_PRE, fpOpen: fingerprint(),   /* 与 verify-mobile.js --check=14 一致：1.6Mbps/0.75Mbps/150ms */
    text: TEXT, keys: TEXT.length, keyIntervalMs: INTERVAL, settleMs: SETTLE, stableMs: STABLE, rounds: ROUNDS,
    openVia: 'force click [data-open-search] → DOM click → Ctrl+K → showModal（回报生效档）',
    warmup: '输入 1 字符 → 等结果 DOM 非空 → 清空 → 等 stableMs 无新 longtask',
    longtaskBuckets: 't ∈ [keydown 起, keydown+keyIntervalMs)；整轮 = 第一次 keydown 起至采集时刻（含 settle）',
    syncDispatch: 'window 捕获端→冒泡端 performance.now 差值；另附 Event Timing processingEnd-processingStart 与官方合成 input dispatch 单次采样',
    median: '≥3 轮取中位，每轮原始列表随报告给出',
  };
}

/* ══════════════════ 其它模式共用：页面内插桩（供 semantic） ══════════════════ */
const INSTALL = () => {
  if (window.__f6 && window.__f6.dispatch) return;
  const f6 = (window.__f6 = window.__f6 || { lt: [], sync: [], tKey: 0, seen: [] });
  if (!f6.lt) f6.lt = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const at = (e.attribution || [])[0] || {};
        f6.lt.push({ name: e.name, dur: Math.round(e.duration * 100) / 100, start: Math.round(e.startTime * 100) / 100, ctype: at.containerType || at.name || '' });
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch (err) { f6.ltErr = String(err && err.message); }
  window.addEventListener('keydown', () => { f6.kd = (f6.kd || 0) + 1; f6.tKey = performance.now(); }, true);
  f6.dispatch = function (v) {
    const el = document.getElementById('search-input');
    el.value = v;
    const t0 = performance.now();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return Math.round((performance.now() - t0) * 100) / 100;
  };
  f6.reset = function () { f6.lt = []; f6.sync = []; f6.lastMut = 0; f6.mutN = 0; };
  f6.clearInput = function () {
    const el = document.getElementById('search-input');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  f6.attachMutations = function () {
    if (f6.mut) return;
    const list = document.getElementById('search-results');
    f6.lastMut = performance.now(); f6.mutN = 0;
    if (list && typeof MutationObserver === 'function') {
      new MutationObserver(() => { f6.lastMut = performance.now(); f6.mutN++; }).observe(list, { childList: true });
    }
    f6.mut = true;
  };
};

async function waitQuiet(page, quietMs, timeout) {
  await page.evaluate(() => { window.__f6.attachMutations(); });
  await page.waitForFunction((q) => (performance.now() - (window.__f6.lastMut || 0)) > q, quietMs, { timeout }).catch(() => {});
}

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
function normHref(h) { return String(h || '').replace(/^(\.\.\/)+/, '').replace(/^\.\//, ''); }

async function runSemantic(browser, base, prof, log) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const out = { queries: [] };
  try {
    await withThrottle(ctx, page, prof);
    const t0 = Date.now();
    await page.goto(base + PAGE, { waitUntil: 'load', timeout: OPEN_TIMEOUT });
    await page.evaluate(INSTALL);
    const opened = await openSearch(page);
    await page.waitForFunction(() => !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages && window.__LIBRARY_SEARCH__.pages.length), null, { timeout: OPEN_TIMEOUT });
    const entries = await page.evaluate(() => window.__LIBRARY_SEARCH__.pages.length);
    log('semantic ' + base + ': open=' + opened + ' indexReady=' + (Date.now() - t0) + 'ms entries=' + entries);
    await page.evaluate(() => { window.__f6.attachMutations(); });
    for (const q of QUERIES) {
      await page.evaluate((v) => { window.__f6.clearInput(); window.__f6.dispatch(v); }, q);
      await page.waitForTimeout(SETTLE);
      await waitQuiet(page, 400, 20000);
      const sem = await page.evaluate(SEMANTIC);
      out.queries.push({ query: q, count: sem.count, n: sem.n, items: sem.items.map((it) => Object.assign({}, it, { hrefNorm: normHref(it.href) })) });
      log('  「' + q + '」' + sem.count + ' · DOM 行数 ' + sem.n + ' · 首条 ' + (sem.items[0] ? normHref(sem.items[0].href) : '-'));
    }
  } catch (e) {
    out.error = String((e && e.message) || e);
    log('  ERROR ' + out.error);
  }
  await ctx.close().catch(() => {});
  return out;
}

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
      query: q, ok, countPre: a.count, countPost: b.count, rowsPre: a.n, rowsPost: b.n, firstDiff,
      firstDiffPre: firstDiff === -1 ? null : ha[firstDiff], firstDiffPost: firstDiff === -1 ? null : hb[firstDiff],
    });
    log('  「' + q + '」count ' + a.count + ' vs ' + b.count + ' · firstDiff=' + firstDiff + (ok ? '  ✅ 一致' : '  ❌ 不一致'));
  }
  return cmp;
}

/* ══════════════════════ 离线复算（recount） ══════════════════════ */
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
    + ' maxResults: (typeof MAX_RESULTS !== "undefined") ? MAX_RESULTS : null };');
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
function compareRecount(preR, postR, log) {
  const cmp = [];
  for (const q of QUERIES) {
    const a = preR.find((x) => x.query === q), b = postR.find((x) => x.query === q);
    const ha = a.top.map((i) => i.href), hb = b.top.map((i) => i.href);
    let firstDiff = -1;
    for (let i = 0; i < Math.max(ha.length, hb.length); i++) if (ha[i] !== hb[i]) { firstDiff = i; break; }
    const sdiff = a.top.filter((x, i) => b.top[i] && b.top[i].s !== x.s).length;
    const ok = firstDiff === -1 && a.total === b.total;
    cmp.push({ query: q, ok, totalPre: a.total, totalPost: b.total, firstDiff, scoreDiffs: sdiff });
    log('  「' + q + '」offline total ' + a.total + ' vs ' + b.total + ' · top40 firstDiff=' + firstDiff + ' · scoreDiff=' + sdiff + (ok ? '  ✅' : '  ❌'));
  }
  return cmp;
}
async function runRecount(log) {
  const preRec = loadCore(SITE_JS_PRE, INDEX_PRE);
  const postRec = loadCore(SITE_JS_POST, INDEX_POST);
  log('[recount] pre  slice ' + preRec.slice.from + '..' + preRec.slice.to + ' of ' + SITE_JS_PRE + ' · entries ' + preRec.core.INDEX.length + ' · MAX_RESULTS=' + preRec.core.maxResults);
  log('[recount] post slice ' + postRec.slice.from + '..' + postRec.slice.to + ' of ' + SITE_JS_POST + ' · entries ' + postRec.core.INDEX.length + ' · MAX_RESULTS=' + postRec.core.maxResults);
  const preR = QUERIES.map((q) => recountOne(preRec.core, q));
  const postR = QUERIES.map((q) => recountOne(postRec.core, q));
  return {
    pre: { slice: preRec.slice, entries: preRec.core.INDEX.length, index: INDEX_PRE, results: preR },
    post: { slice: postRec.slice, entries: postRec.core.INDEX.length, index: INDEX_POST, results: postR },
    compare: compareRecount(preR, postR, log),
  };
}

/* ══════════════════════════ 主流程 ══════════════════════════ */
(async () => {
  const t00 = Date.now();
  const log = [];
  const emit = (m) => { log.push(m); console.log(m); };
  const report = {
    generated_at: new Date().toISOString(), tool: 'tools/f6-probe.js', mode: MODE,
    urls: { post: POST_URL, pre: PRE_URL }, only: ONLY, browser: browserPath(),
  };

  if (MODE === 'recount') {
    report.recount = await runRecount(emit);
  } else {
    const exe = browserPath();
    if (!exe) { console.error('no chrome/chromium found (set CHROME_PATH)'); process.exit(1); }
    const { chromium } = require('playwright-core');
    const browser = await chromium.launch({ executablePath: exe, headless: !HEADED, args: ['--no-sandbox'] });
    try {
      if (MODE === 'semantic') {
        const prof = { name: 'slow4g+cpu4x', cpu: true, net: true };
        const sem = {};
        for (const s of sidesFromOnly()) {
          console.log('[semantic] ' + s + ' ← ' + urlOf(s));
          sem[s] = await runSemantic(browser, urlOf(s), prof, emit);
        }
        report.semantic = sem;
        if (sem.pre && sem.post) report.semantic.compare = compareSemantic(sem.pre, sem.post, emit);
      } else {
        const m = await runMeasure(browser, log);
        report.protocol = m.protocol;
        report.groups = m.groups;
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  if (MODE === 'measure' && report.groups && report.groups.length) {
    console.log('\n=== 中位（每轮原始列表见 JSON / 下方） ===');
    console.log(['组', '轮', 'lt 个数', 'lt 总和', 'lt 单次最大', '每键 lt max', '每键 lt sum', '每键 sync input max', '每键 sync input sum'].join(' | '));
    for (const g of report.groups) {
      const m = g.median;
      console.log([g.name + '@' + g.profile, g.rounds.length, m.ltCount, m.ltSum, m.ltMax, m.perKeyLtMax, m.perKeyLtSum, m.syncInputMax, m.syncInputSum].join(' | '));
    }
    console.log('\n=== 逐轮原始（整轮 = 第一次 keydown 起，含 settle ' + SETTLE + 'ms） ===');
    for (const g of report.groups) {
      console.log('-- ' + g.name + ' @ ' + g.profile + ' (' + g.url + ', open=' + g.open + ', nav=' + g.navMs + 'ms) --');
      for (const r of g.rounds) {
        console.log('  round ' + r.tag + ': max=' + r.ltMax + 'ms sum=' + r.ltSum + 'ms n=' + r.ltCount
          + ' | tail(最后键+' + INTERVAL + 'ms 后): n=' + r.tail.count + ' max=' + r.tail.max + ' sum=' + r.tail.sum
          + ' | 每键 sync(input) max=' + r.perKeyAgg.syncInputMax + ' sum=' + r.perKeyAgg.syncInputSum
          + ' | keydown sync max=' + r.sync.keydownMax
          + ' | 官方合成 dispatch=' + r.syncDispatchOfficial + 'ms'
          + ' | rows=' + r.after.rows + ' "' + r.after.countText + '" | 热身 rows=' + r.rowsWarm + ' | 慢帧(>50ms)=' + r.busyFrames);
        console.log('          整轮列表: ' + (r.ltList.length ? r.ltList.map((x) => x.d + '@' + x.t + 'ms').join(', ') : '(空)'));
        console.log('          每键分档: ' + r.perKey.map((k) => '#' + k.i + '[' + k.ch + '] n=' + k.ltCount + ' max=' + k.ltMax + ' ' + (k.ltList.length ? '[' + k.ltList.join(',') + ']' : '') + ' syncIn=' + k.syncInputMax).join(' | '));
      }
    }
    console.log('\n=== 达标判定（目标1：单次最大长任务<50ms；目标2：总阻塞与单次最大不劣于改前） ===');
    const unusable = [];
    for (const g of report.groups) {
      for (const r of g.rounds) if (fpKey(g.fpOpen) !== fpKey(r.fpEnd)) unusable.push(g.name + '@' + g.profile + '#r' + r.tag);
    }
    console.log('artifactsStable：' + (unusable.length ? '⚠️ 以下轮构建在轮内被换过（作废）：' + unusable.join(', ') : '全部轮 OK（构建未被换）'));
    console.log('产物指纹（每组开局）：' + JSON.stringify(report.groups[0].fpOpen));
    for (const g of report.groups.filter((x) => x.name === 'post')) {
      const q = report.groups.find((x) => x.name === 'pre' && x.profile === g.profile);
      const p = g.median;
      const t1 = p.ltMax === null ? '无数据' : (p.ltMax < 50 ? 'PASS(单次最大 ' + p.ltMax + 'ms <50)' : 'FAIL(单次最大 ' + p.ltMax + 'ms ≥50)');
      const t2 = q ? ('总阻塞 ' + p.ltSum + ' vs ' + q.median.ltSum + ' → ' + (p.ltSum <= q.median.ltSum ? '不劣' : '劣化') + ' ; 单次最大 ' + p.ltMax + ' vs ' + q.median.ltMax + ' → ' + (p.ltMax <= q.median.ltMax ? '不劣' : '劣化')) : '(无改前对照)';
      console.log(g.profile + ': 目标1 ' + t1 + ' | 目标2 ' + t2);
    }
  }

  report.log = log;
  report.elapsedMs = Date.now() - t00;
  if (JSON_OUT) { writeOut(JSON_OUT, JSON.stringify(report, null, 2)); console.log('\nJSON → ' + path.resolve(JSON_OUT)); }
})().catch((e) => { console.error('FATAL ' + ((e && e.stack) || e)); process.exit(1); });
