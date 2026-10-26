'use strict';
/**
 * verify-ranker.js —— `loadShippedRanker()` 与 kq 预计算的回归测试。
 *
 * 为什么需要这个工具（2026-10-26）：
 *   `build-site.js` 的 `loadShippedRanker()` 用两个**函数名字符串**定位 SITE_JS 里的切片
 *   （`function norm(s)` … `function setCount(`）。该区间随 SITE_JS 增长而变大；
 *   自 `5d0831b`（C3 断崖）起，区间内混入了顶层语句
 *     `var searchRaf = window.requestAnimationFrame || …`
 *     `if (!(window.__LIBRARY_SEARCH__ && …)) {`
 *   于是 `new Function(...)(...)` 在**调用时**抛 `ReferenceError: window is not defined`
 *   → 被 catch 吞掉 → 返回 null → 每页的 `kq` 字段**从未写入** → `verify-nav` 的
 *   「kq 覆盖」门禁**空转了 8 个月**（只留一条容易忽略的 warning）。
 *
 *   本次修复 = window/document 垫片 + must-fix 诊断 + 本回归测试。
 *
 * 用法：
 *   node tools/verify-ranker.js            # 3 条断言，任一失败 exit 1
 *   node tools/verify-ranker.js --verbose  # 额外打印抽样的重算明细
 *
 * 只读：不写任何站点产物。断言对象是**磁盘上的 search-index.json** 与**源码**。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');

const results = [];
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '   ← ' + detail : ''));
}

/* ─── 从 tools/site/assets.js 取出 SITE_JS（模板字符串），复刻 build-site 的切片 ─── */
function extractSiteJs() {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'site', 'assets.js'), 'utf8');
  const i = src.indexOf('const SITE_JS');
  if (i < 0) throw new Error('tools/site/assets.js 里找不到 `const SITE_JS`');
  const tickStart = src.indexOf('`', i);
  if (tickStart < 0) throw new Error('SITE_JS 后面的反引号找不到');
  let j = tickStart + 1;
  while (j < src.length) {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === '`') break;
    j++;
  }
  return src.slice(tickStart + 1, j);
}

/* 与 build-site.js:loadShippedRanker() 完全同构的垫片（改一处必须改另一处） */
const SHIM_WINDOW = {
  requestAnimationFrame: (f) => setTimeout(f, 16),
  cancelAnimationFrame: (h) => clearTimeout(h),
  __LIBRARY_SEARCH__: null,
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
const SHIM_DOC = {
  documentElement: { setAttribute() {}, getAttribute: () => null, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {} },
  body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {}, appendChild() {} },
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
};

function loadShippedRanker() {
  const SITE_JS = extractSiteJs();
  const start = SITE_JS.indexOf('function norm(s)');
  const end = SITE_JS.indexOf('function setCount(');
  if (start === -1 || end === -1 || end <= start) {
    return { ranker: null, why: '切片标记缺失（"function norm(s)" / "function setCount("）：start=' + start + ' end=' + end };
  }
  const snippet = SITE_JS.slice(start, end);
  const S = require('./site/search.js');
  const phraseMap = {};
  for (const p of S.PHRASES) phraseMap[p.q] = p;
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function('ALIASES', 'CJK', 'PHRASE_BY_Q', 'window', 'document', 'self', 'globalThis',
      snippet + '\nreturn { score: score, termScore: termScore, partScore: partScore, compareHits: compareHits };');
    const ranker = factory(S.ALIASES, /[\u3400-\u9fff]/, phraseMap, SHIM_WINDOW, SHIM_DOC, SHIM_WINDOW, SHIM_WINDOW);
    if (!ranker || typeof ranker.termScore !== 'function') {
      return { ranker: null, why: '调用成功但没拿到 termScore（返回 ' + typeof ranker + '）' };
    }
    return { ranker, why: null, snippetLen: snippet.length };
  } catch (e) {
    return { ranker: null, why: 'new Function 调用抛异常：' + e.message };
  }
}

/* ─── 断言 1：loadShippedRanker() 返回非 null 且 termScore 是函数 ─── */
console.log('════ verify-ranker ════');
const loaded = loadShippedRanker();
assert('A1 loadShippedRanker() 返回非 null 且 termScore 是函数',
  loaded.ranker !== null,
  loaded.ranker ? ('切片 ' + loaded.snippetLen + ' 字符，termScore=function') : loaded.why);

if (!loaded.ranker) {
  console.log('\n后续断言依赖 ranker，无法继续。');
  console.log('RESULT: FAIL（1/3 通过）');
  process.exitCode = 1;
  process.exit();
}

const S = require('./site/search.js');

/* ─── 断言 2：search-index.json 里带 kq 的页数 === 141（动态取自源结构声明的页数） ─── */
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'search-index.json'), 'utf8'));
const withKq = idx.pages.filter((p) => Array.isArray(p.kq) && p.kq.length);

/* 期望页数：与 verify-nav 的 CONTENT_PAGE_COUNT 同源 —— data/source-nav.json 的内容页数 */
const srcNav = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'source-nav.json'), 'utf8'));
const countPages = (nodes) => (nodes || []).reduce((n, x) => n + (x.kind === 'group' ? countPages(x.children) : 1), 0);
const EXPECTED_PAGES = srcNav.sections.reduce((n, s) => n + countPages(s.groups) + (s.pagesNotInSourceNav || []).length, 0);

assert('A2 search-index.json 里带 kq 的页数 == 源结构声明的内容页数',
  withKq.length === EXPECTED_PAGES && idx.pages.length === EXPECTED_PAGES,
  'kq 页数 ' + withKq.length + ' / 索引页数 ' + idx.pages.length + ' / 期望 ' + EXPECTED_PAGES);

/* ─── 断言 3：抽样 5 个词，索引里的 kq 与用 ranker 重算的结果一致 ─── */
const SAMPLE_WORDS = S.PHRASES.slice(0, 5).map((p) => p.q);
const sampleDetail = [];
let mismatch = 0, checkedPairs = 0;
for (const w of SAMPLE_WORDS) {
  const inIndex = new Set(idx.pages.filter((p) => Array.isArray(p.kq) && p.kq.includes(w)).map((p) => p.p));
  const recomputed = new Set(idx.pages.filter((e) => loaded.ranker.termScore(e, w).s > 0).map((e) => e.p));
  const onlyIdx = [...inIndex].filter((x) => !recomputed.has(x));
  const onlyRec = [...recomputed].filter((x) => !inIndex.has(x));
  checkedPairs += inIndex.size + recomputed.size;
  if (onlyIdx.length || onlyRec.length) {
    mismatch++;
    sampleDetail.push(w + ': 索引独有 ' + onlyIdx.length + ' / 重算独有 ' + onlyRec.length);
  } else {
    sampleDetail.push(w + ': ' + inIndex.size + ' 页一致');
  }
  if (VERBOSE) console.log('   词「' + w + '」索引 ' + inIndex.size + ' 页 / 重算 ' + recomputed.size + ' 页');
}
assert('A3 抽样 ' + SAMPLE_WORDS.length + ' 个词：索引 kq 与 ranker 重算结果一致',
  mismatch === 0,
  sampleDetail.join(' ; '));

/* ─── 汇总 ─── */
const passN = results.filter((r) => r.ok).length;
console.log('');
console.log('RESULT: ' + (passN === results.length ? 'PASS' : 'FAIL')
  + '（' + passN + '/' + results.length + ' 通过）');
if (passN !== results.length) {
  console.log('');
  console.log('修复提示：');
  console.log('  · 若 A1 失败 → build-site.js:loadShippedRanker() 的切片边界或 window/document 垫片需调整');
  console.log('  · 若 A2 失败 → 先跑 node tools/build-site.js（kq 由构建期写入，不在源里）');
  console.log('  · 若 A3 失败 → build-site.js 的 kq 预计算与 assets/site.js 的排序实现已经漂移');
  process.exitCode = 1;
}
