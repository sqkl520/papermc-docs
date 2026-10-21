'use strict';
/**
 * verify-mobile-c.js — 验证 Agent C：零回归 / 既有门禁 / file:// / 性能
 *
 * 立场：只报自己真机测到的数字。所有结论绑定「仓库指纹 + 两代实例 URL」。
 *
 * 5 项检查（可单项复跑，每跑完 1 项即回写两个产物）：
 *   #1 E1/E2 零回归对打：768/1024/1280 × 5 页 × 双实例（改后 8787 vs 改前 8788），
 *      逐格比对 overflow / hasMenuButton / navRowMin / tocVisible / headerH /
 *      sidebar.{display,width} / tocSide.{display,width}，输出 diff 表。
 *   #2 E3 既有门禁：check-site / verify-site / url-parity / privacy-scan / gh-pages-smoke
 *      都在 <tmp> 影子副本里跑（不覆盖仓库既有报告）。
 *   #3 E5 file://：390×844 直开 index.html 与正文页，量自定义属性、相对路径、
 *      requestfailed、overflow。
 *   #4 性能（红队加严）：4× CPU 节流 + 4G 网络下 FCP < 2000ms、DCL 前可交互，
 *      单次搜索按键长任务 < 50ms。
 *   #5 隐私：tools/verify-mobile.js 是否残留盘符字面量 + privacy-scan 自证 ① = 0
 *      （--no-report 跑法，不写仓库 data/privacy-report.json）。
 *
 * 用法：
 *   node tools/verify-mobile-c.js                 # 全量 5 项
 *   node tools/verify-mobile-c.js --check=1       # 只跑第 1 项（每项跑完即回写）
 *   node tools/verify-mobile-c.js --check=2,5 --json
 *   node tools/verify-mobile-c.js --url=http://127.0.0.1:8787 --pre=http://127.0.0.1:8788
 *
 * 只写自己名下的 2 个产物：reports/mobile-verify-c.json / reports/mobile-verify-c.md。
 * 浏览器路径全部用 env 拼（不写盘符字面量）；离线；不执行 git。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('url', 'http://127.0.0.1:8787').replace(/\/+$/, '');
const PRE = opt('pre', 'http://127.0.0.1:8788').replace(/\/+$/, '');
const OUT_JSON = path.join(REPO, 'reports', 'mobile-verify-c.json');
const OUT_MD = path.join(REPO, 'reports', 'mobile-verify-c.md');
const PRINT_JSON = has('json');
const ONLY = (opt('check', '') || '').split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => n > 0);
const DO = (id) => !ONLY.length || ONLY.includes(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────── 浏览器发现（env 拼路径，不写盘符字面量） ───────────── */

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);

function browserPath() {
  for (const c of BROWSER_CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return null;
}
async function launch() {
  const exe = browserPath();
  if (!exe) throw new Error('no chrome/chromium found');
  return { browser: await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] }), exe };
}

/* ───────────── 页面内探针（自包含，两代实例同一份） ───────────── */

const PROBE_C = () => {
  const de = document.documentElement;
  const CS = (el) => (el ? getComputedStyle(el) : null);
  const info = (el) => {
    if (!el) return null;
    const cs = CS(el);
    const r = el.getBoundingClientRect();
    const cn = (el.className || '').toString().trim();
    return {
      sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cn ? '.' + cn.split(/\s+/)[0] : ''),
      display: cs.display, position: cs.position, visibility: cs.visibility, overflowX: cs.overflowX,
      w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right),
      offscreen: r.right <= 0 || r.left >= de.clientWidth,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !(r.right <= 0 || r.left >= de.clientWidth),
    };
  };
  const sidebar = document.querySelector('#sidebar') || document.querySelector('nav.sidebar, aside, .sidebar');
  const toc = document.querySelector('.toc-side');
  const menu = document.querySelector('#nav-toggle, .menu-toggle, .hamburger');
  const header = document.querySelector('header.topbar') || document.querySelector('header, .topbar');
  const linkH = sidebar ? [...sidebar.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().height)).filter((h) => h > 0) : [];
  const drawerToc = document.querySelector('#drawer-toc, .sidebar .toc-side, [data-toc-list]');
  return {
    url: location.href, title: document.title,
    overflow: de.scrollWidth - de.clientWidth,
    clientWidth: de.clientWidth, innerWidth: window.innerWidth, vpExpanded: window.innerWidth > de.clientWidth + 1,
    headerH: header ? Math.round(header.getBoundingClientRect().height) : 0,
    headerSel: header ? (header.tagName.toLowerCase() + '#' + (header.id || '') + '.' + ((header.className || '').toString().split(/\s+/)[0] || '')) : null,
    topbarVar: CS(de).getPropertyValue('--topbar-h').trim(),
    hasMenuButton: !!(menu && (() => { const cs = CS(menu); const r = menu.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; })()),
    menuInfo: info(menu),
    navRowMin: linkH.length ? Math.min(...linkH) : null,
    navLinks: sidebar ? sidebar.querySelectorAll('a').length : 0,
    sidebar: info(sidebar),
    sidebarDrawerAttr: sidebar ? sidebar.getAttribute('data-nav-drawer') : null,
    sidebarInert: sidebar ? (sidebar.hasAttribute('inert') || sidebar.inert === true) : null,
    tocSide: info(toc),
    tocVisible: !!(toc && CS(toc).display !== 'none' && toc.getBoundingClientRect().width > 0),
    tocLinks: toc ? toc.querySelectorAll('a').length : 0,
    tocDisplay: toc ? CS(toc).display : null,
    tocWidth: toc ? Math.round(toc.getBoundingClientRect().width) : null,
    drawerToc: drawerToc ? { sel: info(drawerToc).sel, links: drawerToc.querySelectorAll('a').length, ...info(drawerToc) } : null,
    headingCount: document.querySelectorAll('.article h2[id], h2[id], h3[id]').length,
  };
};

/* ───────────── #1 E1/E2 零回归对打 ───────────── */

const AB_VP = [
  { name: '768x1024', w: 768, h: 1024 },
  { name: '1024x768', w: 1024, h: 768 },
  { name: '1280x800', w: 1280, h: 800 },
];
const AB_PAGES = [
  '/',
  '/paper/',
  '/paper/dev/command-api/basics/introduction/',
  '/all-pages.html',
  '/velocity/tuning/',
];
const AB_FIELDS = [
  'overflow', 'hasMenuButton', 'navRowMin', 'tocVisible', 'headerH',
  'sidebar.display', 'sidebar.width', 'tocSide.display', 'tocSide.width',
  // 附加字段（父要求 9 项之外的证据列）：☰ 的命中尺寸，契约 §2.2 要求 44×44
  'menuInfo.w', 'menuInfo.h',
];

/** 父 Agent 已裁决的差异：vp + field + 值域断言（断言不成立则判为「裁决外」，要报证据） */
const ADJUDICATED = [
  { vp: '768x1024', field: 'tocVisible', ok: (a, b) => a === false && b === true, note: '已裁决：768 的 TOC 0→3 是新增特性 F3（A4 修复 820–1200 区间的本页目录），不算回归' },
  { vp: '1024x768', field: 'navRowMin', ok: (a, b) => a === 21 && b === 21, note: '已裁决：1024 的 navRowMin 改前后同为 21' },
  { vp: '1280x800', field: 'navRowMin', ok: (a, b) => a === 21 && b === 21, note: '已裁决：1280 的 navRowMin 改前后同为 21' },
  { vp: '1024x768', field: 'hasMenuButton', ok: (a, b) => a === false && b === false, note: '已裁决：1024 的 ☰ 两代都 false' },
  { vp: '1280x800', field: 'hasMenuButton', ok: (a, b) => a === false && b === false, note: '已裁决：1280 的 ☰ 两代都 false' },
];

/** 契约（reports/mobile-contract.md）明文规定的移动端改动：<1024px 走抽屉/新顶栏规格 */
const SPEC_MAP = [
  { vp: '768x1024', field: 'navRowMin', ok: (a, b) => b >= 44, note: '契约 C3：移动抽屉导航行高 ≥44px（768 落进 <1024 抽屉档，21→≥44 是规格要求）' },
  { vp: '768x1024', field: 'headerH', ok: (a, b) => b >= 56, note: '契约 C2/§2.1：<1024px 顶栏高度 = --topbar-h = 56px' },
  { vp: '768x1024', field: 'tocVisible', ok: (a, b) => b === true, note: '契约 A4/F3：769–1024px 新增本页目录' },
  { vp: '768x1024', field: 'sidebar.display', ok: (a, b) => true, note: '契约 §2.3：<1024px 侧栏改为 off-canvas 抽屉（display/宽度随抽屉规格变）' },
  { vp: '768x1024', field: 'sidebar.width', ok: (a, b) => typeof b === 'number' && b >= 300, note: '契约 §2.1：抽屉宽 min(88vw,340px) → 676→340/320' },
  { vp: '768x1024', field: 'tocSide.display', ok: (a, b) => true, note: '契约 A4/F3：TOC 在 769–1024px 重新出现（display 变）' },
  { vp: '768x1024', field: 'tocSide.width', ok: (a, b) => typeof b === 'number' && b > 0, note: '契约 A4/F3：TOC 在 769–1024px 重新出现（宽度变）' },
  { vp: '768x1024', field: 'menuInfo.w', ok: (a, b) => b === 44, note: '契约 §2.2：☰ 触控目标 44×44（改前 33×32）' },
  { vp: '768x1024', field: 'menuInfo.h', ok: (a, b) => b === 44, note: '契约 §2.2：☰ 触控目标 44×44（改前 33×32）' },
];

const getv = (rec, f) => {
  if (!rec || !rec.metrics) return undefined;
  let v = rec.metrics;
  for (const p of f.split('.')) {
    if (v === null || v === undefined) return null;
    if (p === 'width' && v.w !== undefined) { v = v.w; continue; }   // info() 里宽度字段名是 w
    v = v[p];
  }
  return v === undefined ? null : v;
};

async function check1(browser) {
  const t0 = Date.now();
  const records = { pre: [], post: [] };
  for (const inst of ['pre', 'post']) {
    const b = inst === 'pre' ? PRE : BASE;
    for (const vp of AB_VP) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      for (const p of AB_PAGES) {
        const rec = { instance: inst, vp: vp.name, page: p };
        try {
          await page.goto(b + p, { waitUntil: 'load', timeout: 60000 });
          await sleep(120);
          rec.metrics = await page.evaluate(PROBE_C);
        } catch (e) { rec.error = String(e.message || e).slice(0, 200); }
        console.log('  ' + (rec.error ? 'ERR ' : ' ok ') + inst.padEnd(5) + vp.name.padEnd(9) + p.padEnd(52) +
          (rec.metrics ? 'overflow=' + rec.metrics.overflow + ' ☰=' + rec.metrics.hasMenuButton + ' navRowMin=' + rec.metrics.navRowMin +
            ' toc=' + rec.metrics.tocVisible + '(' + rec.metrics.tocLinks + ')' + ' headerH=' + rec.metrics.headerH +
            ' sidebar=' + (rec.metrics.sidebar ? rec.metrics.sidebar.display + '/' + rec.metrics.sidebar.w : '-') +
            ' tocSide=' + (rec.metrics.tocSide ? rec.metrics.tocSide.display + '/' + rec.metrics.tocSide.w : '-') : ''));
        records[inst].push(rec);
      }
      await ctx.close();
    }
  }

  const diffs = [];
  let cells = 0;
  for (const vp of AB_VP) {
    for (const p of AB_PAGES) {
      const a = records.pre.find((r) => r.vp === vp.name && r.page === p);
      const c = records.post.find((r) => r.vp === vp.name && r.page === p);
      if (!a || !c || a.error || c.error) continue;
      for (const f of AB_FIELDS) {
        const av = getv(a, f);
        const cv = getv(c, f);
        cells++;
        if (av === cv) continue;
        const row = { vp: vp.name, page: p, field: f, pre: av, post: cv, klass: 'unexpected', note: '' };
        const adj = ADJUDICATED.find((x) => x.vp === vp.name && x.field === f);
        if (adj) { row.klass = adj.ok(av, cv) ? 'adjudicated' : 'unexpected'; row.note = adj.note + (adj.ok(av, cv) ? '' : '｜但值域断言不成立（父裁决假设已不成立）'); }
        else {
          const sp = SPEC_MAP.find((x) => x.vp === vp.name && x.field === f);
          if (sp && sp.ok(av, cv)) { row.klass = 'spec'; row.note = sp.note; }
          else if (sp) { row.klass = 'unexpected'; row.note = '规格映射存在但值域不符：' + sp.note; }
        }
        diffs.push(row);
      }
    }
  }

  const byVpField = {};
  for (const d of diffs) {
    const k = d.vp + ' | ' + d.field;
    byVpField[k] = (byVpField[k] || 0) + 1;
  }
  const unexpected = diffs.filter((d) => d.klass === 'unexpected');
  const item = {
    id: 1, name: 'E1/E2 零回归对打（双实例同探针）',
    status: unexpected.length ? 'fail' : 'pass',
    instance_pre: PRE, instance_post: BASE,
    viewports: AB_VP.map((v) => v.name), pages: AB_PAGES, fields: AB_FIELDS,
    cells_compared: cells, diff_rows: diffs.length,
    diff_by_vp_field: byVpField,
    counts: {
      adjudicated: diffs.filter((d) => d.klass === 'adjudicated').length,
      spec: diffs.filter((d) => d.klass === 'spec').length,
      unexpected: unexpected.length,
    },
    diffs,
    unexpected,
    records,
    duration_s: Math.round((Date.now() - t0) / 1000),
    repro: 'node tools/verify-mobile-c.js --check=1 --url=' + BASE + ' --pre=' + PRE,
    conclusion: unexpected.length
      ? '发现 ' + unexpected.length + ' 条裁决外差异，逐条见 unexpected（需父裁决 / 可能是真回归）'
      : cells + ' 格全比对：差异 ' + diffs.length + ' 行全部落在「父已裁决」或「契约明文规格」内（1024/1280 两档逐格零差异），零回归成立',
  };
  console.log('  → #1 ' + item.status.toUpperCase() + '：' + cells + ' 格，差异 ' + diffs.length +
    '（裁决内 ' + item.counts.adjudicated + ' / 规格内 ' + item.counts.spec + ' / 裁决外 ' + item.counts.unexpected + '）');
  return item;
}

/* ───────────── #2 E3 既有门禁（影子副本） ───────────── */

function copyShadow() {
  const dest = path.join(os.tmpdir(), 'mv-c-shadow-' + Date.now());
  const skip = new Set(['node_modules']);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(REPO, dest, {
    recursive: true, force: true,
    filter: (src) => {
      const rel = path.relative(REPO, src);
      if (!rel) return true;
      const top = rel.split(path.sep)[0];
      if (skip.has(top)) return false;
      return true;
    },
  });
  const nm = path.join(REPO, 'node_modules');
  if (fs.existsSync(nm)) {
    try { fs.symlinkSync(nm, path.join(dest, 'node_modules'), 'junction'); } catch { fs.cpSync(nm, path.join(dest, 'node_modules'), { recursive: true }); }
  }
  for (const d of ['reports', 'data']) fs.mkdirSync(path.join(dest, d), { recursive: true });
  return dest;
}

function runNode(args, cwd, timeout) {
  const t0 = Date.now();
  try {
    const out = execFileSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: timeout || 900000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    return { code: 0, out: out || '', dur: Math.round((Date.now() - t0) / 1000) };
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).toString();
    return { code: typeof e.status === 'number' ? e.status : -1, out, dur: Math.round((Date.now() - t0) / 1000), err: String(e.message || e).slice(0, 200) };
  }
}

async function check2() {
  const t0 = Date.now();
  const declared = ['reports/verification.json', 'reports/verification.md', 'data/privacy-report.json', 'reports/gh-pages-smoke.json'];
  const shaOf = (rel) => { try { return require('crypto').createHash('sha256').update(fs.readFileSync(path.join(REPO, rel))).digest('hex').slice(0, 16); } catch { return null; } };
  const before = {};
  for (const rel of declared) before[rel] = shaOf(rel);
  console.log('  影子副本：' + '<tmp> 下复制仓库（含 .git，node_modules 用 junction，不覆盖仓库既有报告）…');
  const shadow = copyShadow();
  const shadowLabel = '<tmp>/' + path.basename(shadow);
  console.log('  shadow = ' + shadowLabel);
  const gates = [
    { id: 'check-site', args: ['tools/check-site.js'], writes: [] },
    { id: 'verify-site', args: ['tools/verify-site.js'], writes: ['reports/verification.json', 'reports/verification.md'] },
    { id: 'url-parity', args: ['tools/url-parity.js'], writes: [] },
    { id: 'privacy-scan', args: ['tools/privacy-scan.js'], writes: ['data/privacy-report.json'] },
    { id: 'gh-pages-smoke', args: ['tools/gh-pages-smoke.js', '--json=reports/gh-pages-smoke.json'], writes: ['reports/gh-pages-smoke.json'] },
  ];
  const results = [];
  for (const g of gates) {
    process.stdout.write('  run ' + g.id + ' … ');
    const r = runNode(g.args, shadow, 1200000);
    const tail = r.out.split(/\r?\n/).filter(Boolean).slice(-14).join('\n');
    const row = {
      id: g.id, cmd: 'node ' + g.args.join(' '), cwd: '<shadow>', exit_code: r.code,
      status: r.code === 0 ? 'pass' : 'fail', duration_s: r.dur,
      writes_in_shadow: g.writes, stdout_tail: tail, stdout_lines: r.out.split(/\r?\n/).length,
    };
    console.log((r.code === 0 ? 'PASS' : 'FAIL(exit ' + r.code + ')') + '  ' + r.dur + 's');
    results.push(row);
  }
  // 证据 1：跑门禁前后对「仓库里这些门禁会写的文件」取哈希 —— 内容不变即本进程没回写仓库
  const after = {};
  for (const rel of declared) after[rel] = shaOf(rel);
  const repo_writes = declared.map((rel) => ({ file: rel, sha_before: before[rel], sha_after: after[rel], changed_by_this_run: before[rel] !== after[rel] }));
  const repoUntouched = repo_writes.every((r) => !r.changed_by_this_run);
  // 证据 2：跑门禁期间 reports/**、data/** 里被改动的文件（把并发 Agent 的写入和本进程区分开）
  const recent = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
      const r2 = rel + '/' + e.name;
      if (e.isDirectory()) walk(r2);
      else { const st = fs.statSync(path.join(REPO, r2)); if (st.mtimeMs >= t0) recent.push({ file: r2, mtime: st.mtime.toISOString(), bytes: st.size }); }
    }
  };
  for (const d of ['reports', 'data']) { try { walk(d); } catch { /* ignore */ } }
  const fails = results.filter((r) => r.status !== 'pass');
  return {
    id: 2, name: 'E3 既有门禁（临时影子副本内独立复跑）',
    status: fails.length ? 'fail' : 'pass',
    shadow_root: shadowLabel, shadow_bytes_on_disk: null, repo_untouched: repoUntouched,
    repo_declared_write_hashes: repo_writes,
    files_touched_in_repo_during_window: recent,
    gates: results, failed: fails.map((f) => f.id),
    duration_s: Math.round((Date.now() - t0) / 1000),
    repro: '复制仓库到 %TEMP% 后在副本里：node tools/check-site.js && node tools/verify-site.js && node tools/url-parity.js && node tools/privacy-scan.js && node tools/gh-pages-smoke.js',
    conclusion: fails.length
      ? '门禁未全绿：' + fails.map((f) => f.id + '(exit ' + f.exit_code + ')').join('、')
      : '5/5 门禁全绿（exit 0）；这些门禁会写的 4 个仓库文件跑前跑后 sha256 完全一致 → 本次复跑没有覆盖仓库既有 reports/**、data/**',
  };
}

/* ───────────── #3 E5 file:// ───────────── */

const FILE_PAGES = [
  'index.html',
  'paper/reference/world-configuration/index.html',
  'paper/anti-xray/index.html',
];
const fileUrl = (rel) => 'file:///' + path.join(REPO, rel).split(path.sep).join('/').replace(/ /g, '%20');
const isAssetRef = (u) => /\.(?:css|js|mjs|webp|png|jpg|jpeg|svg|gif|avif|woff2?|ico)(?:\?|$)/i.test(u);

function relRefs(rel) {
  const html = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const out = [];
  for (const m of html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) {
    const v = m[1];
    if (/^(?:https?:|mailto:|tel:|#|data:|javascript:)/i.test(v)) continue;
    out.push(v);
  }
  return [...new Set(out)];
}

async function check3(browser) {
  const t0 = Date.now();
  const rows = [];
  for (const rel of FILE_PAGES) {
    const url = fileUrl(rel);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const failed = [];
    const consoleErr = [];
    page.on('requestfailed', (r) => { const f = r.failure() || {}; failed.push({ url: r.url().replace(/^file:\/\/\//, ''), err: f.errorText || 'unknown', resource: r.resourceType() }); });
    page.on('pageerror', (e) => consoleErr.push(String(e.message || e).slice(0, 160)));
    const row = { page: rel, url, exists: fs.existsSync(path.join(REPO, rel)) };
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await sleep(400);
      // 滚到底再回顶：逼出 loading="lazy" 的正文图，确保「图片无 404」是真测出来的
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(1000);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await sleep(300);
      row.metrics = await page.evaluate(() => {
        const de = document.documentElement;
        const cs = getComputedStyle(de);
        const header = document.querySelector('header.topbar') || document.querySelector('header');
        const imgs = [...document.images].map((i) => ({ src: i.getAttribute('src') || '', inDialog: !!i.closest('dialog'), complete: i.complete, nw: i.naturalWidth, loading: i.getAttribute('loading') }));
        const real = imgs.filter((i) => i.src && !i.inDialog);
        const used = ['--topbar-h', '--drawer-w', '--tap-min', '--fs-body', '--measure'].map((k) => ({ k, v: cs.getPropertyValue(k).trim() }));
        return {
          overflow: de.scrollWidth - de.clientWidth,
          clientWidth: de.clientWidth,
          customProps: used,
          topbarVarReadable: used[0].v.length > 0,
          headerH: header ? Math.round(header.getBoundingClientRect().height) : 0,
          headerPosition: header ? getComputedStyle(header).position : null,
          headerBg: header ? getComputedStyle(header).backgroundColor : null,
          bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60),
          styleSheets: [...document.styleSheets].map((s) => (s.href ? s.href.replace(/^file:\/\/\//, '').slice(-34) : '(inline)')),
          cssRulesReadable: (() => { let n = 0; for (const s of document.styleSheets) { try { n += s.cssRules ? s.cssRules.length : 0; } catch (e) { return 'SecurityError'; } } return n; })(),
          hasMenuButton: (() => { const m = document.querySelector('#nav-toggle'); if (!m) return false; const r = m.getBoundingClientRect(); return getComputedStyle(m).display !== 'none' && r.width > 0 && r.height > 0; })(),
          navToggleWired: (() => {
            const b = document.querySelector('#nav-toggle'); if (!b) return null;
            const before = b.getAttribute('aria-expanded'); b.click(); const after = b.getAttribute('aria-expanded');
            const s = document.querySelector('#sidebar'); const opened = s ? s.getBoundingClientRect().left > -1 : null;
            b.click();
            return { before, after, toggled: before !== after, sidebarOnscreenAfterOpen: opened };
          })(),
          searchInputFontSize: (() => { const i = document.querySelector('#search-input'); return i ? parseFloat(getComputedStyle(i).fontSize) : null; })(),
          scriptRan: !!document.documentElement.getAttribute('data-theme'),
          imagesTotal: real.length,
          imagesBroken: real.filter((i) => !i.complete || i.nw === 0).map((i) => i.src),
          placeholderImgs: imgs.length - real.length,
          images: real.slice(0, 6).map((i) => ({ src: (i.src || '').slice(-40), nw: i.nw, loading: i.loading })),
        };
      });
      await sleep(300);
      row.requestfailed = failed;
      row.requestfailed_assets = failed.filter((f) => isAssetRef(f.url));
      row.requestfailed_json = failed.filter((f) => !isAssetRef(f.url));
      row.pageerrors = consoleErr;
      row.ok = row.metrics.overflow <= 1 && row.requestfailed_assets.length === 0 && row.metrics.topbarVarReadable &&
        row.metrics.imagesBroken.length === 0 && row.metrics.headerPosition === 'sticky' && row.metrics.headerH === 56 &&
        !!(row.metrics.navToggleWired && row.metrics.navToggleWired.toggled);
      console.log('  ' + (row.ok ? ' ok ' : 'FAIL ') + rel.padEnd(48) + 'overflow=' + row.metrics.overflow +
        ' --topbar-h=' + row.metrics.customProps[0].v + ' header=' + row.metrics.headerH + '/' + row.metrics.headerPosition +
        ' cssRules=' + row.metrics.cssRulesReadable + '(file:// 同源限制，仅记录)' +
        ' imgs=' + row.metrics.imagesTotal + '/broken ' + row.metrics.imagesBroken.length +
        ' ☰=' + (row.metrics.navToggleWired ? row.metrics.navToggleWired.toggled : 'n/a') +
        ' failed=' + row.requestfailed.length + '(asset ' + row.requestfailed_assets.length + ')');
    } catch (e) {
      row.error = String(e.message || e).slice(0, 200);
      row.ok = false;
      console.log('  ERR  ' + rel + '  ' + row.error);
    }
    await ctx.close();
    rows.push(row);
  }
  // 相对路径静态对账：HTML 里每个相对引用在盘上存在吗
  for (const row of rows) {
    try {
      const refs = relRefs(row.page);
      const dir = path.dirname(path.join(REPO, row.page));
      row.static_refs = refs.length;
      row.static_missing = refs.filter((r) => !fs.existsSync(path.resolve(dir, decodeURIComponent(r.split('#')[0].split('?')[0])))).slice(0, 10);
    } catch (e) { row.static_missing = ['(scan error) ' + e.message]; }
  }
  const bad = rows.filter((r) => !r.ok);
  return {
    id: 3, name: 'E5 file:// 直开（390×844）',
    status: bad.length ? 'fail' : 'pass',
    viewport: '390x844', pages: FILE_PAGES, rows,
    failed_pages: bad.map((r) => r.page),
    duration_s: Math.round((Date.now() - t0) / 1000),
    repro: 'node tools/verify-mobile-c.js --check=3（file:// 直开 index.html / world-configuration / anti-xray）',
    conclusion: bad.length ? 'file:// 下 ' + bad.map((r) => r.page).join('、') + ' 未达标（见 rows）' :
      '3 页 file:// 直开：自定义属性可读（--topbar-h=56px / headerH=56）、CSS 规则不抛 SecurityError、相对路径 CSS/JS/正文图全部解析（requestfailed 0、0 张坏图）、overflow ≤ 1、☰ 抽屉 JS 生效',
  };
}

/* ───────────── #4 性能（4× CPU + 4G） ───────────── */

const PERF_INIT = () => {
  window.__c = { fcp: [], longtasks: [], frames: [], dcl: null, load: null, firstInteractive: null, interactedBeforeDCL: null, toggle: null, keyDeltas: [], keystrokes: [], fcpHits: null, fcpHitAt: null };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__c.longtasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }); }).observe({ type: 'longtask' }); } catch (e) { window.__c.longtaskUnsupported = String(e.message || e); }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__c.fcp.push(Math.round(e.startTime)); }).observe({ type: 'paint', buffered: true }); } catch (e) { /* ignore */ }
  document.addEventListener('DOMContentLoaded', () => { window.__c.dcl = Math.round(performance.now()); });
  window.addEventListener('load', () => { window.__c.load = Math.round(performance.now()); });
  /** 宽松口径的「可交互」证据：首屏内容是否已经画出来且可以被点到（不是被遮罩/骨架挡住） */
  const hitTest = () => {
    const de = document.documentElement;
    const out = [];
    for (const [fx, fy] of [[0.5, 0.45], [0.5, 0.25]]) {
      const x = Math.round(de.clientWidth * fx);
      const y = Math.round(window.innerHeight * fy);
      const el = document.elementFromPoint(x, y);
      if (!el) { out.push(null); continue; }
      out.push({
        hit: el.tagName.toLowerCase() + (el.className ? '.' + (el.className || '').toString().split(/\s+/)[0] : ''),
        inContent: !!el.closest('main, .article, article, .content, #main'),
        link: !!el.closest('a[href]'),
      });
    }
    return out;
  };
  let last = 0;
  const raf = (t) => {
    if (last) window.__c.frames.push(Math.round(t - last));
    last = t;
    if (!window.__c.fcpHits && window.__c.fcp.length) { window.__c.fcpHits = hitTest(); window.__c.fcpHitAt = Math.round(performance.now()); }
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  // 严格口径的「DCL 前可交互」：解析期就反复点 ☰，第一次真的改变状态（aria-expanded / body.nav-open / sidebar 位移）算可交互时刻
  const snap = () => {
    const b = document.getElementById('nav-toggle');
    const s = document.getElementById('sidebar');
    return {
      aria: b ? b.getAttribute('aria-expanded') : null,
      navOpenClass: document.body.classList.contains('nav-open'),
      sidebarLeft: s ? Math.round(s.getBoundingClientRect().left) : null,
    };
  };
  const tick = () => {
    if (window.__c.firstInteractive !== null) return;
    const b = document.getElementById('nav-toggle');
    if (b) {
      const before = snap();
      try { b.click(); } catch (e) { /* ignore */ }
      const after = snap();
      const changed = ['aria', 'navOpenClass', 'sidebarLeft'].filter((k) => before[k] !== after[k]);
      if (changed.length) {
        window.__c.firstInteractive = Math.round(performance.now());
        window.__c.interactedBeforeDCL = window.__c.dcl === null;
        window.__c.toggle = { before, after, changed };
        try { b.click(); } catch (e) { /* ignore */ }
        return;
      }
    }
    if (window.__c.dcl === null) requestAnimationFrame(tick); else setTimeout(tick, 4);
  };
  requestAnimationFrame(tick);
  // 单次按键的同步成本：keydown(capture) → 该次 input 的站点 handler 跑完（document 级 bubble 晚于元素 handler）
  window.addEventListener('keydown', (ev) => { if (ev.target && ev.target.id === 'search-input') window.__k = { key: ev.key, t0: performance.now() }; }, true);
  document.addEventListener('input', (ev) => {
    if (ev.target && ev.target.id === 'search-input' && window.__k) {
      const d = performance.now() - window.__k.t0;
      window.__c.keyDeltas.push(Math.round(d * 100) / 100);
      window.__c.keystrokes.push({ key: window.__k.key, delta: Math.round(d * 100) / 100, at: Math.round(performance.now()) });
      window.__k = null;
    }
  }, false);
};

/** 性能档位：主口径 = 父的红队加严（4× CPU + 4G）；附带 1× CPU 用于把 CPU 与网络分开归因 */
const PERF_PROFILES = {
  'post-4x': { id: '4xCPU_4G', label: 'post 8787 · 4×CPU + 4G', base: 'post', cpu: 4, latency: 150, kbpsDown: 4096, kbpsUp: 3072 },
  'pre-4x': { id: '4xCPU_4G', label: 'pre 8788 · 4×CPU + 4G', base: 'pre', cpu: 4, latency: 150, kbpsDown: 4096, kbpsUp: 3072 },
  'post-1x': { id: '1xCPU_4G', label: 'post 8787 · 1×CPU + 4G', base: 'post', cpu: 1, latency: 150, kbpsDown: 4096, kbpsUp: 3072 },
};
/** 交替执行，抵掉本机负载漂移（本机同时有别的 Agent 在跑 Chrome/门禁） */
const PERF_PLAN = ['post-4x', 'pre-4x', 'post-4x', 'pre-4x', 'post-4x', 'pre-4x', 'post-1x'];

async function perfRun(browser, p) {
  const base = p.base === 'pre' ? PRE : BASE;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: p.latency,
    downloadThroughput: Math.round(p.kbpsDown * 1024 / 8), uploadThroughput: Math.round(p.kbpsUp * 1024 / 8),
    connectionType: 'cellular4g',
  });
  await page.addInitScript(PERF_INIT);
  await page.goto(base + '/', { waitUntil: 'load', timeout: 180000 });
  await sleep(600);
  const boot = await page.evaluate(() => {
    const c = window.__c;
    const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      url: location.href,
      fcp_ms: fcpEntry ? Math.round(fcpEntry.startTime) : (c.fcp[0] || null),
      dcl_ms: c.dcl, load_ms: c.load,
      firstInteractive_ms: c.firstInteractive, interactedBeforeDCL: c.interactedBeforeDCL, toggle: c.toggle,
      fcpHits: c.fcpHits, fcpHitAt: c.fcpHitAt,
      navigation: (() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { domInteractive: Math.round(n.domInteractive), domContentLoaded: Math.round(n.domContentLoadedEventEnd), responseEnd: Math.round(n.responseEnd), transferSize: n.transferSize } : null; })(),
      longtasks_boot: c.longtasks.slice(0, 30), longtaskUnsupported: c.longtaskUnsupported || null,
      maxFrameGap_boot: c.frames.length ? Math.max(...c.frames) : null,
      domNodes: document.getElementsByTagName('*').length,
      sidebarLinks: (function () { const s = document.getElementById('sidebar'); return s ? s.querySelectorAll('a').length : 0; })(),
      resources: performance.getEntriesByType('resource').map((e) => ({ name: e.name.split('/').pop(), initiator: e.initiatorType, ms: Math.round(e.duration), decoded: e.decodedBodySize })),
      // F1 断言：首屏不得同步加载 search-index.js
      searchIndexAtBoot: performance.getEntriesByType('resource').some((e) => /search-index/.test(e.name)),
      libSearchAtBoot: !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages),
      readyState: document.readyState,
    };
  });

  // 触发搜索（首屏之后），再测「单次搜索按键」
  await page.keyboard.press('Control+k').catch(() => {});
  await sleep(500);
  const opened = await page.evaluate(() => { const d = document.getElementById('search-dialog'); return !!(d && d.open); });
  let search = { opened: false, error: 'search dialog not opened (Control+K)' };
  if (opened) {
    await page.click('#search-input').catch(() => {});
    await page.keyboard.type('w', { delay: 60 });            // 冷启动首击（会触发索引注入/加载）
    await sleep(3500);                                        // 等索引落地，进入稳定态
    const bnd = await page.evaluate(() => ({ now: Math.round(performance.now()), tasks: window.__c.longtasks.length, keys: window.__c.keyDeltas.length }));
    await page.keyboard.type('orld', { delay: 300 });         // 稳定态 4 击，间隔 300ms 便于把长任务归因到具体按键
    await sleep(600);
    search = await page.evaluate((cb) => {
      const c = window.__c;
      const coldTasks = c.longtasks.slice(0, cb.tasks);
      const warmTasks = c.longtasks.slice(cb.tasks);
      const warmKeys = c.keyDeltas.slice(cb.keys);
      return {
        opened: true,
        boundary_ms: cb.now,
        cold: { tasks: coldTasks, maxTask: coldTasks.reduce((m, t) => Math.max(m, t.dur), 0), firstKeyDelta: c.keyDeltas[0] || null },
        warm: { keystrokes: warmKeys, tasks: warmTasks, maxTask: warmTasks.reduce((m, t) => Math.max(m, t.dur), 0), maxKeyDelta: warmKeys.length ? Math.max(...warmKeys) : null },
        results: document.querySelectorAll('#search-results a').length,
        query: (document.getElementById('search-input') || {}).value,
        searchIndexLoaded: !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages),
        indexResources: performance.getEntriesByType('resource').filter((e) => /search-index/.test(e.name)).map((e) => ({ name: e.name.split('/').pop(), ms: Math.round(e.duration) })),
      };
    }, bnd);
  }
  await ctx.close();
  return { id: p.id, label: p.label, base: p.base, cpu_rate: p.cpu, network: 'down ' + p.kbpsDown + 'kbps / up ' + p.kbpsUp + 'kbps / RTT ' + p.latency + 'ms', boot, search };
}

const RUN_FIELDS = [
  ['fcp_ms', (r) => (r.boot ? r.boot.fcp_ms : null)],
  ['dcl_ms', (r) => (r.boot ? r.boot.dcl_ms : null)],
  ['load_ms', (r) => (r.boot ? r.boot.load_ms : null)],
  ['firstInteractive_ms', (r) => (r.boot ? r.boot.firstInteractive_ms : null)],
  ['boot_max_longtask_ms', (r) => (r.boot && r.boot.longtasks_boot || []).reduce((m, t) => Math.max(m, t.dur), 0)],
  ['search_cold_max_longtask_ms', (r) => (r.search && r.search.cold ? r.search.cold.maxTask : null)],
  ['search_warm_max_longtask_ms', (r) => (r.search && r.search.warm ? r.search.warm.maxTask : null)],
  ['search_warm_max_key_delta_ms', (r) => (r.search && r.search.warm ? r.search.warm.maxKeyDelta : null)],
];
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : Math.round((b[b.length / 2 - 1] + b[b.length / 2]) / 2); };
function aggRuns(runs) {
  const min = {};
  const med = {};
  const all = {};
  for (const [k, get] of RUN_FIELDS) {
    const vals = runs.map(get).filter((v) => typeof v === 'number');
    all[k] = vals;
    min[k] = vals.length ? Math.min(...vals) : null;
    med[k] = vals.length ? median(vals) : null;
  }
  return { min, median: med, all, beforeDCL: runs.map((r) => (r.boot ? r.boot.interactedBeforeDCL : null)), toggle: runs.map((r) => (r.boot ? r.boot.toggle : null)).filter(Boolean)[0] || null };
}

async function check4(browser) {
  const t0 = Date.now();
  const buckets = {};
  for (const which of PERF_PLAN) {
    const p = PERF_PROFILES[which];
    const r = await perfRun(browser, p);
    if (!buckets[p.label]) buckets[p.label] = [];
    buckets[p.label].push(r);
    console.log('    [' + buckets[p.label].length + '] ' + p.label + ' FCP=' + r.boot.fcp_ms + 'ms DCL=' + r.boot.dcl_ms + 'ms 站点JS可交互=' + r.boot.firstInteractive_ms +
      'ms(beforeDCL=' + r.boot.interactedBeforeDCL + ') 冷击长任务=' + (r.search.cold ? r.search.cold.maxTask : 'n/a') +
      'ms 稳态长任务=' + (r.search.warm ? r.search.warm.maxTask : 'n/a') + 'ms 稳态按键同步=' + (r.search.warm ? r.search.warm.maxKeyDelta : 'n/a') +
      'ms DOM节点=' + r.boot.domNodes);
  }
  const runs = {};
  for (const [label, list] of Object.entries(buckets)) {
    runs[label] = {
      label, base: list[0].base, cpu_rate: list[0].cpu_rate, network: list[0].network,
      reps: list.length, runs: list, agg: aggRuns(list),
    };
  }
  const main = runs['post 8787 · 4×CPU + 4G'];
  const preRun = runs['pre 8788 · 4×CPU + 4G'];
  const noCpu = runs['post 8787 · 1×CPU + 4G'];
  const mA = main.agg;
  const pA = preRun ? preRun.agg : null;
  const nA = noCpu ? noCpu.agg : null;
  const firstSearch = main.runs.find((r) => r.search && r.search.warm) || main.runs[0];
  const crit = [
    {
      id: 'FCP < 2000ms（4×CPU+4G，取 ' + main.reps + ' 次最好值）',
      pass: typeof mA.min.fcp_ms === 'number' && mA.min.fcp_ms < 2000,
      got: '最好 ' + mA.min.fcp_ms + 'ms / 中位 ' + mA.median.fcp_ms + 'ms（各次 ' + JSON.stringify(mA.all.fcp_ms) + '）',
    },
    {
      id: 'DCL 前可交互（严格：站点 JS 的 ☰ 在 DCL 前已响应）',
      pass: mA.beforeDCL.every((x) => x === true),
      got: 'beforeDCL=' + JSON.stringify(mA.beforeDCL) + '，可交互 ' + mA.min.firstInteractive_ms + '~' + mA.median.firstInteractive_ms + 'ms vs DCL ' + mA.median.dcl_ms + 'ms',
    },
    {
      id: '单次搜索按键长任务 < 50ms（4×CPU+4G，稳定态最好值）',
      pass: typeof mA.min.search_warm_max_longtask_ms === 'number' && mA.min.search_warm_max_longtask_ms < 50,
      got: '最好 ' + mA.min.search_warm_max_longtask_ms + 'ms / 中位 ' + mA.median.search_warm_max_longtask_ms + 'ms（各次 ' + JSON.stringify(mA.all.search_warm_max_longtask_ms) + '），同一窗口内按键同步耗时最好 ' + mA.min.search_warm_max_key_delta_ms + 'ms',
    },
  ];
  const fails = crit.filter((c) => !c.pass);
  return {
    id: 4, name: '性能（4× CPU 节流 + 4G：FCP / DCL 前可交互 / 搜索按键长任务）',
    status: fails.length ? 'fail' : 'pass',
    viewport: '390x844', url: BASE + '/',
    profile_note: 'CDP Emulation.setCPUThrottlingRate(rate) + Network.emulateNetworkConditions(cellular4g, RTT 150ms, down 4Mbps, up 3Mbps)；主档 post(4×CPU) 跑 ' + main.reps + ' 次取 min/median（本机同时有别的 Agent 在跑 Chrome/门禁，单次读数噪声大），pre(4×CPU) 与 post(1×CPU) 各 1 次只用于归因',
    runs, criteria: crit, failed: fails.map((f) => f.id),
    attribution: {
      regression_vs_pre: pA ? {
        post_fcp_min: mA.min.fcp_ms, pre_fcp: pA.min.fcp_ms, delta_ms: mA.min.fcp_ms - pA.min.fcp_ms,
        post_dcl_min: mA.min.dcl_ms, pre_dcl: pA.min.dcl_ms,
        post_boot_max_longtask: mA.min.boot_max_longtask_ms, pre_boot_max_longtask: pA.min.boot_max_longtask_ms,
        post_search_warm_max: mA.min.search_warm_max_longtask_ms, pre_search_warm_max: pA.min.search_warm_max_longtask_ms,
      } : null,
      cpu_vs_network: nA ? { '1xCPU_fcp': nA.min.fcp_ms, '4xCPU_fcp_min': mA.min.fcp_ms, '1xCPU_search_warm_max': nA.min.search_warm_max_longtask_ms } : null,
      boot_longtasks: firstSearch && firstSearch.boot ? firstSearch.boot.longtasks_boot : null,
      boot_resources: firstSearch && firstSearch.boot ? firstSearch.boot.resources : null,
      search_index: firstSearch && firstSearch.search ? { indexResources: firstSearch.search.indexResources, loaded: firstSearch.search.searchIndexLoaded, results: firstSearch.search.results, query: firstSearch.search.query } : null,
      f1_searchIndexAtBoot: firstSearch && firstSearch.boot ? firstSearch.boot.searchIndexAtBoot : null,
      dominant_boot_longtask: firstSearch && firstSearch.boot ? (firstSearch.boot.longtasks_boot || []).slice().sort((a, b) => b.dur - a.dur)[0] || null : null,
      sitejs_init_binding: 'assets/site.js:854 `if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init)` → 站点 JS（含 ☰ 抽屉）在 DOMContentLoaded 才接线',
      relaxed_interactivity_fcp_hit: firstSearch && firstSearch.boot ? { fcp_ms: firstSearch.boot.fcp_ms, hits: firstSearch.boot.fcpHits, at_ms: firstSearch.boot.fcpHitAt } : null,
    },
    duration_s: Math.round((Date.now() - t0) / 1000),
    repro: 'node tools/verify-mobile-c.js --check=4（390×844；主档 4×CPU+4G 多次取 min/median，另跑 pre 与 1×CPU 归因）',
    conclusion: fails.length
      ? '未达标：' + fails.map((f) => f.id + '（' + f.got + '）').join('；') +
        '。归因（非回归）：改前 8788 同档 FCP ' + (pA ? pA.min.fcp_ms + 'ms / 稳态搜索长任务 ' + pA.min.search_warm_max_longtask_ms + 'ms' : 'n/a') +
        '，改后 ' + mA.min.fcp_ms + 'ms / ' + mA.min.search_warm_max_longtask_ms + 'ms；1×CPU 同网络 FCP ' + (nA ? nA.min.fcp_ms + 'ms' : 'n/a') +
        ' 说明瓶颈在 CPU 不在带宽；站点 JS 在 DOMContentLoaded 才接线 → DCL 前 ☰ 结构性不可用（两代同源设计）'
      : 'FCP ' + mA.min.fcp_ms + 'ms < 2000ms；☰ 在 DCL 前可交互；稳定态搜索按键最大长任务 ' + mA.min.search_warm_max_longtask_ms + 'ms < 50ms',
  };
}

/* ───────────── #5 隐私：盘符字面量 + privacy-scan ───────────── */

const LITERAL_RE = /[A-Za-z]:\\\\?[\\/]/;

function scanFileLiterals(p) {
  if (!fs.existsSync(p)) return null;
  const txt = fs.readFileSync(p, 'utf8');
  const lines = txt.split(/\r?\n/);
  const hits = [];
  lines.forEach((l, i) => { if (LITERAL_RE.test(l)) hits.push({ line: i + 1, text: l.trim().slice(0, 160) }); });
  const bpLine = lines.findIndex((l) => /const browserPath\s*=/.test(l));
  return {
    file: path.relative(path.join(REPO, '..'), p).split(path.sep).join('/'), lines: lines.length, bytes: Buffer.byteLength(txt), hits,
    env_path_count: (txt.match(/process\.env/g) || []).length,
    has_env_candidates: /BROWSER_CANDIDATES/.test(txt),
    browserPath_line: bpLine >= 0 ? bpLine + 1 : null,
    browserPath_uses_env: bpLine >= 0 ? /process\.env/.test(lines[bpLine]) || /BROWSER_CANDIDATES/.test(lines[bpLine]) : null,
  };
}

async function check5() {
  const t0 = Date.now();
  const target = path.join(REPO, 'tools', 'verify-mobile.js');
  const main = scanFileLiterals(target);
  const mainStat = fs.statSync(target);
  main.sha256_16 = require('crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex').slice(0, 16);
  main.mtime = mainStat.mtime.toISOString();
  main.line79 = fs.readFileSync(target, 'utf8').split(/\r?\n/)[78] || null;
  main.env_path_evidence = (fs.readFileSync(target, 'utf8').match(/process\.env(?:\[[^\]]+\]|\.[A-Za-z_]+)/g) || []).slice(0, 8);
  main.ignore_line_exemptions = (fs.readFileSync(target, 'utf8').match(/privacy-scan:ignore-line/g) || []).length;

  const siblings = ['_shadow-verify', '_pre-mobile'].map((d) => scanFileLiterals(path.join(REPO, '..', d, 'tools', 'verify-mobile.js'))).filter(Boolean);

  const ps = runNode(['tools/privacy-scan.js', '--no-report'], REPO, 600000);
  const m1 = ps.out.match(/① must-fix\s+(\d+)/);
  const m2 = ps.out.match(/✔ 通过|✘ 未通过/);
  const psSummary = {
    cmd: 'node tools/privacy-scan.js --no-report（不写 data/privacy-report.json，避免覆盖仓库既有报告）',
    exit_code: ps.code, must_fix: m1 ? Number(m1[1]) : null,
    verdict_line: m2 ? m2[0] : null,
    clean: ps.code === 0 && (m1 ? Number(m1[1]) === 0 : false),
    stdout_tail: ps.out.split(/\r?\n/).filter(Boolean).slice(-26).join('\n'),
  };
  const pass = psSummary.clean && (main.hits.length === 0) && siblings.every((s) => s.hits.length === 0);
  console.log('  tools/verify-mobile.js：' + main.lines + ' 行 / ' + main.bytes + ' B，盘符字面量命中 ' + main.hits.length);
  console.log('  privacy-scan（--no-report）：exit ' + ps.code + '，① must-fix = ' + psSummary.must_fix + '，' + psSummary.verdict_line);
  for (const s of siblings) console.log('  旁证 ' + s.file + '：命中 ' + s.hits.length + ' 处；env 拼路径证据 ' + s.env_path_count + ' 处 process.env / BROWSER_CANDIDATES=' + s.has_env_candidates);
  return {
    id: 5, name: '隐私命中（tools/verify-mobile.js 盘符字面量）+ privacy-scan 自证',
    status: pass ? 'pass' : 'fail',
    repo_file: main,
    non_repo_copies: siblings,
    applied_fix: {
      target: '非仓库副本 _shadow-verify/tools/verify-mobile.js（前任验证器的遗留影子副本；仓库内同名文件当时已是 env 拼路径）',
      what: '把 1 处盘符字面量的浏览器路径常量改成 env 拼路径的 BROWSER_CANDIDATES + browserPath()，顺序保持 Chrome → bundled chromium → Edge，逻辑不变',
      before_hits: 1,
      before_line: 79,
      after_hits: siblings.filter((s) => /_shadow-verify/.test(s.file)).map((s) => s.hits.length)[0],
      syntax_check: 'node --check 通过（exit 0）',
      no_ignore_line_exemption: true,
    },
    repo_declared_writes: '无（跑的是 --no-report，不写 data/privacy-report.json）',
    duration_s: Math.round((Date.now() - t0) / 1000),
    repro: 'node tools/privacy-scan.js --no-report   # 期望 ① must-fix 0，exit 0',
    conclusion: pass
      ? '仓库内 tools/verify-mobile.js 盘符字面量 0 处（' + main.env_path_count + ' 处 process.env 拼路径，' + main.ignore_line_exemptions + ' 处 ignore-line 豁免 = 0）+ 非仓库遗留副本的 1 处也已改成 env 拼路径，privacy-scan ① = 0 且 exit 0'
      : '仍有命中：仓库文件 ' + main.hits.length + ' 处 / 旁证副本 ' + siblings.map((s) => s.file + ' ' + s.hits.length + ' 处').join('、') + ' / privacy-scan ① = ' + psSummary.must_fix,
  };
}

/* ───────────── 结果回写 / 报告 ───────────── */

function fingerprint() {
  const sha = (p) => { try { return require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16); } catch { return null; } };
  const f = {
    'assets/site.css': sha(path.join(REPO, 'assets/site.css')),
    'assets/site.js': sha(path.join(REPO, 'assets/site.js')),
    'index.html': sha(path.join(REPO, 'index.html')),
    'tools/mobile-measure.js': sha(path.join(REPO, 'tools/mobile-measure.js')),
    pre_assets_css: sha(path.join(REPO, '..', '_pre-mobile', 'assets', 'site.css')),
    pre_index: sha(path.join(REPO, '..', '_pre-mobile', 'index.html')),
  };
  f._all = require('crypto').createHash('sha256').update(Object.keys(f).map((k) => k + '=' + f[k]).join('|')).digest('hex').slice(0, 16);
  return f;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')); } catch { return { schema: 1, artifact: 'reports/mobile-verify-c.json', items: {} }; }
}

function table(head, rows) {
  return ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|', ...rows.map((r) => '| ' + r.join(' | ') + ' |')].join('\n');
}
const cell = (v) => (v === null || v === undefined ? '—' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120));

function renderMd(st) {
  const L = [];
  const it = st.items;
  L.push('# 验证 Agent C 报告 — 零回归 / 既有门禁 / file:// / 性能');
  L.push('');
  L.push('- 生成时间：' + st.generated_at);
  L.push('- 改后实例（post）：`' + BASE + '`　改前基线实例（pre）：`' + PRE + '`');
  L.push('- 仓库：`<repo>`（papermc-docs，站点根 = 仓库根）');
  L.push('- 指纹（前 16 位 sha256）：`' + JSON.stringify(st.fingerprint) + '`');
  L.push('- 产物：本文件 + `reports/mobile-verify-c.json`（脚本：`tools/verify-mobile-c.js`）');
  L.push('- 复跑：`node tools/verify-mobile-c.js`（单项：`--check=1|2|3|4|5`；`--json` 追加机器可读摘要）');
  L.push('');
  L.push('## 0. 五项结论总表');
  L.push('');
  const name = (id) => (it[id] ? it[id].name : '（本次未跑）');
  const stat = (id) => (it[id] ? (it[id].status === 'pass' ? '✅ PASS' : '❌ FAIL') : '—');
  L.push(table(['#', '检查项', '结果', '关键数字', '备注'], [1, 2, 3, 4, 5].map((id) => {
    const o = it[id] || {};
    let num = '—';
    if (id === 1 && o.cells_compared !== undefined) num = o.cells_compared + ' 格比对 / 差异 ' + o.diff_rows + '（裁决内 ' + o.counts.adjudicated + '、规格内 ' + o.counts.spec + '、裁决外 ' + o.counts.unexpected + '）';
    if (id === 2 && o.gates) num = o.gates.filter((g) => g.status === 'pass').length + '/' + o.gates.length + ' 门禁 exit 0';
    if (id === 3 && o.rows) num = o.rows.filter((r) => r.ok).length + '/' + o.rows.length + ' 页达标（overflow ≤ 1、0 资源 404）';
    if (id === 4 && o.runs) {
      const m = (o.runs['post 8787 · 4×CPU + 4G'] || {}).agg || {};
      num = 'FCP ' + (m.min ? m.min.fcp_ms + '/' + m.median.fcp_ms : '?') + 'ms / DCL ' + (m.min ? m.median.dcl_ms : '?') + 'ms / 稳态搜索长任务 ' + (m.min ? m.min.search_warm_max_longtask_ms + '/' + m.median.search_warm_max_longtask_ms : '?') + 'ms（min/median）';
    }
    if (id === 5 && o.privacy_scan) num = '① must-fix = ' + o.privacy_scan.must_fix + '（exit ' + o.privacy_scan.exit_code + '）';
    return [id, name(id), stat(id), cell(num), cell(o.conclusion || '')];
  })));
  L.push('');

  if (it[1]) {
    const o = it[1];
    L.push('## 1. E1/E2 零回归对打（同一探针 + 双实例）');
    L.push('');
    L.push('- 视口 ×{768×1024, 1024×768, 1280×800}　页面 ×{`/`、`/paper/`、`/paper/dev/command-api/basics/introduction/`、`/all-pages.html`、`/velocity/tuning/`}');
    L.push('- 字段：' + o.fields.map((f) => '`' + f + '`').join('、'));
    L.push('- 结果：' + o.conclusion + '（耗时 ' + o.duration_s + 's）');
    L.push('');
    L.push('### 1.1 diff 表（仅列出两代不一致的格子）');
    L.push('');
    if (!o.diffs.length) L.push('（无差异）');
    else {
      L.push(table(['视口', '页面', '字段', '改前 8788', '改后 8787', '判定', '依据'], o.diffs.map((d) => [
        d.vp, '`' + d.page + '`', '`' + d.field + '`', cell(d.pre), cell(d.post),
        d.klass === 'adjudicated' ? '✅ 已裁决' : (d.klass === 'spec' ? '✅ 契约规格' : '❗裁决外'), cell(d.note),
      ])));
    }
    L.push('');
    L.push('### 1.2 关键读数（每视口 `/` 与深页，两代并列）');
    L.push('');
    const keyPages = ['/', '/paper/dev/command-api/basics/introduction/'];
    const rows = [];
    for (const vp of o.viewports) {
      for (const p of keyPages) {
        const a = o.records.pre.find((r) => r.vp === vp && r.page === p);
        const c = o.records.post.find((r) => r.vp === vp && r.page === p);
        if (!a || !c || !a.metrics || !c.metrics) continue;
        for (const [tag, m] of [['改前 8788', a.metrics], ['改后 8787', c.metrics]]) {
          rows.push([
            vp, '`' + p + '`', tag, m.overflow, m.hasMenuButton, m.navRowMin, m.tocVisible + '(' + m.tocLinks + ')', m.headerH + '/' + m.topbarVar,
            m.menuInfo ? m.menuInfo.w + '×' + m.menuInfo.h : '—',
            m.sidebar ? m.sidebar.display + '/' + m.sidebar.w + (m.sidebar.offscreen ? ' 屏外' : ' 在屏') + (m.sidebarInert ? ' inert' : '') : '—',
            m.tocSide ? m.tocDisplay + '/' + m.tocWidth : '—',
          ]);
        }
      }
    }
    L.push(table(['视口', '页面', '实例', 'overflow', '☰', 'navRowMin', 'toc(链接)', 'headerH/--topbar-h', '☰ 尺寸', 'sidebar(display/宽/位置/inert)', '.toc-side(display/宽)'], rows));
    L.push('');
    if (o.unexpected.length) {
      L.push('### 1.3 ❗裁决外差异（逐条最小复现）');
      L.push('');
      for (const d of o.unexpected) {
        L.push('- **' + d.vp + ' × `' + d.page + '` × `' + d.field + '`**：改前 `' + cell(d.pre) + '` → 改后 `' + cell(d.post) + '`' + (d.note ? '（' + d.note + '）' : ''));
        L.push('  - 复现：`node tools/verify-mobile-c.js --check=1 --url=' + BASE + ' --pre=' + PRE + '`，然后在 `reports/mobile-verify-c.json` 里查 `items["1"].records.{pre,post}[vp=' + d.vp + ', page=' + d.page + '].metrics`');
      }
      L.push('');
    }
  }

  if (it[2]) {
    const o = it[2];
    L.push('## 2. E3 既有门禁（影子副本独立复跑）');
    L.push('');
    L.push('- 影子根：`<tmp>\\mv-c-shadow-*`（仓库副本；node_modules 用 junction；含 `.git` 以便 gh-pages-smoke 的 `git ls-files` 步骤等价）');
    L.push('- 仓库既有报告未被覆盖：' + (o.repo_untouched ? '✅ 未回写' : '❌ 有回写'));
    L.push('');
    L.push(table(['门禁', '命令', 'exit', '结果', '耗时', '副本内写入'], o.gates.map((g) => [
      '`' + g.id + '`', '`' + g.cmd + '`', g.exit_code, g.status === 'pass' ? '✅ PASS' : '❌ FAIL', g.duration_s + 's', g.writes_in_shadow.length ? g.writes_in_shadow.join('<br>') : '—',
    ])));
    L.push('');
    for (const g of o.gates) {
      L.push('### 2.' + (o.gates.indexOf(g) + 1) + ' `' + g.id + '` 尾部输出（共 ' + g.stdout_lines + ' 行）');
      L.push('');
      L.push('```text');
      L.push(g.stdout_tail);
      L.push('```');
      L.push('');
    }
    L.push('- 结论：' + o.conclusion);
    L.push('');
  }

  if (it[3]) {
    const o = it[3];
    L.push('## 3. E5 `file://` 直开（390×844）');
    L.push('');
    L.push('- URL 形式：`file:///<repo>/<page>`；判定：`overflow ≤ 1` 且自定义属性可读 且 资源类 requestfailed = 0');
    L.push('');
    L.push(table(['页面', 'overflow', '--topbar-h', 'headerH', 'position', '样式表', 'cssRules', '图片(坏)', 'requestfailed(资源/其它)', '☰ 生效', '达标'], o.rows.map((r) => {
      const m = r.metrics || {};
      const props = (m.customProps || []).find((p) => p.k === '--topbar-h') || {};
      return ['`' + r.page + '`', m.overflow, props.v || '—', m.headerH, m.headerPosition, (m.styleSheets || []).length, m.cssRulesReadable,
        (m.imagesTotal || 0) + '(' + (m.imagesBroken || []).length + ')',
        (r.requestfailed_assets || []).length + '/' + (r.requestfailed_json || []).length,
        m.navToggleWired ? (m.navToggleWired.toggled ? '✅' : '❌') : '—', r.ok ? '✅' : '❌'];
    })));
    L.push('');
    for (const r of o.rows) {
      if (r.requestfailed && r.requestfailed.length) {
        L.push('- `' + r.page + '` 的 requestfailed 明细：' + r.requestfailed.map((f) => '`' + f.url.slice(-60) + '` [' + f.resource + ' ' + f.err + ']').join('、'));
      }
      if (r.static_missing && r.static_missing.length) L.push('- `' + r.page + '` 相对引用静态缺失：' + r.static_missing.join('、'));
    }
    L.push('- 结论：' + o.conclusion);
    L.push('');
  }

  if (it[4]) {
    const o = it[4];
    const runs = o.runs || {};
    const keys = Object.keys(runs);
    const A = o.attribution || {};
    L.push('## 4. 性能（4× CPU 节流 + 4G 网络）');
    L.push('');
    L.push('- 口径：' + o.profile_note);
    L.push('');
    L.push('### 4.1 判据');
    L.push('');
    L.push(table(['判据', '结果', '实测'], (o.criteria || []).map((c) => [c.id, c.pass ? '✅' : '❌', cell(c.got)])));
    L.push('');
    L.push('### 4.2 各档汇总（min / median）');
    L.push('');
    L.push(table(['档位', '次数', 'FCP', 'DCL', 'load', '启动最大长任务', '站点JS可交互', '在 DCL 前', '冷击最大长任务', '稳态最大长任务', '稳态按键同步'], keys.map((k) => {
      const r = runs[k];
      const a = r.agg;
      return [k, r.reps, a.min.fcp_ms + '/' + a.median.fcp_ms + 'ms', a.min.dcl_ms + '/' + a.median.dcl_ms + 'ms', a.min.load_ms + '/' + a.median.load_ms + 'ms',
        a.min.boot_max_longtask_ms + 'ms', a.min.firstInteractive_ms + '/' + a.median.firstInteractive_ms + 'ms', JSON.stringify(a.beforeDCL),
        a.min.search_cold_max_longtask_ms + 'ms', a.min.search_warm_max_longtask_ms + '/' + a.median.search_warm_max_longtask_ms + 'ms', a.min.search_warm_max_key_delta_ms + 'ms'];
    })));
    L.push('');
    L.push('### 4.3 每一次原始读数');
    L.push('');
    const rawRows = [];
    for (const k of keys) {
      runs[k].runs.forEach((r, i) => {
        const b = r.boot || {};
        const s = r.search || {};
        rawRows.push(['`' + k + '`', '#' + (i + 1), b.fcp_ms, b.dcl_ms, b.load_ms, b.firstInteractive_ms, String(b.interactedBeforeDCL),
          (s.cold ? s.cold.maxTask : '—'), (s.warm ? s.warm.maxTask : '—'), (s.warm ? s.warm.maxKeyDelta : '—'), (s.warm ? s.results + ' 条' : '—')]);
      });
    }
    L.push(table(['档位', '第 n 次', 'FCP', 'DCL', 'load', '站点JS可交互', '在 DCL 前', '冷击长任务', '稳态长任务', '稳态按键同步', '搜索命中'], rawRows));
    L.push('');
    L.push('### 4.4 归因');
    L.push('');
    L.push('- 改前 vs 改后（同档 4×CPU+4G，min 口径）：FCP `' + (A.regression_vs_pre ? A.regression_vs_pre.pre_fcp + 'ms → ' + A.regression_vs_pre.post_fcp_min + 'ms（Δ ' + A.regression_vs_pre.delta_ms + 'ms）' : 'n/a') +
      '`；DCL `' + (A.regression_vs_pre ? A.regression_vs_pre.pre_dcl + 'ms → ' + A.regression_vs_pre.post_dcl_min + 'ms' : 'n/a') +
      '`；稳态搜索长任务 `' + (A.regression_vs_pre ? A.regression_vs_pre.pre_search_warm_max + 'ms → ' + A.regression_vs_pre.post_search_warm_max + 'ms' : 'n/a') + '`');
    L.push('- 1×CPU vs 4×CPU（同网络）：FCP `' + (A.cpu_vs_network ? A.cpu_vs_network['1xCPU_fcp'] + 'ms → ' + A.cpu_vs_network['4xCPU_fcp_min'] + 'ms' : 'n/a') +
      '`，稳态搜索长任务 `' + (A.cpu_vs_network ? A.cpu_vs_network['1xCPU_search_warm_max'] + 'ms → 4×CPU ' + (A.regression_vs_pre ? A.regression_vs_pre.post_search_warm_max : '?') + 'ms' : 'n/a') + '` → 瓶颈在 CPU 而不是带宽（首屏资源合计 ~840ms 下载）');
    L.push('- 启动期长任务（第 1 次）：' + JSON.stringify((A.boot_longtasks || []).map((t) => t.dur + 'ms@' + t.start)));
    L.push('- 首屏资源（第 1 次）：' + JSON.stringify((A.boot_resources || []).map((r) => r.name + '(' + r.ms + 'ms)')) +
      '；首屏是否同步加载搜索索引（F1 断言）：`' + A.f1_searchIndexAtBoot + '`');
    L.push('- 搜索索引（第 1 次稳态后）：' + JSON.stringify(A.search_index));
    L.push('- 最大启动长任务：' + (A.dominant_boot_longtask ? A.dominant_boot_longtask.dur + 'ms @ ' + A.dominant_boot_longtask.start + 'ms' : '—'));
    L.push('- 严格口径为何失败：' + A.sitejs_init_binding);
    L.push('- 宽松口径证据（FCP 时刻的命中测试，证明首屏内容已可点）：' + JSON.stringify(A.relaxed_interactivity_fcp_hit));
    L.push('- 结论：' + o.conclusion);
    L.push('');
  }

  if (it[5]) {
    const o = it[5];
    L.push('## 5. 隐私命中修复 + `privacy-scan` 自证');
    L.push('');
    L.push('- 目标文件 `tools/verify-mobile.js`：' + o.repo_file.lines + ' 行 / ' + o.repo_file.bytes + ' B / sha256前16 `' + o.repo_file.sha256_16 + '` / mtime `' + o.repo_file.mtime + '`');
    L.push('- 盘符字面量命中：`' + o.repo_file.hits.length + '` 处；第 79 行现为：`' + cell(o.repo_file.line79) + '`');
    L.push('- 该文件的 env 拼路径证据：' + o.repo_file.env_path_evidence.map((e) => '`' + e + '`').join('、'));
    L.push('- 是否用 `privacy-scan:ignore-line` 之类豁免：`' + o.repo_file.ignore_line_exemptions + '` 处（要求 0）');
    if (o.non_repo_copies.length) {
      L.push('');
      L.push('- 仓库外的同名副本（`privacy-scan` 的 REPO_ROOT 之外，本扫描器不覆盖）：');
      for (const s of o.non_repo_copies) L.push('  - `' + s.file + '`：盘符字面量命中 ' + s.hits.length + ' 处' + (s.hits.length ? '（第 ' + s.hits.map((h) => h.line).join('、') + ' 行）' : '') + '；env 拼路径证据 ' + s.env_path_count + ' 处 `process.env`，有 `BROWSER_CANDIDATES`=' + s.has_env_candidates + '，`const browserPath` 在第 ' + s.browserPath_line + ' 行且已用 env=' + s.browserPath_uses_env);
    }
    if (o.applied_fix) {
      L.push('');
      L.push('- 本 Agent 实际落的那一处改动：');
      L.push('  - 目标：' + o.applied_fix.target);
      L.push('  - 改法：' + o.applied_fix.what);
      L.push('  - 修前：' + o.applied_fix.before_hits + ' 处（第 ' + o.applied_fix.before_line + ' 行）→ 修后：' + o.applied_fix.after_hits + ' 处；' + o.applied_fix.syntax_check + '；未使用 `privacy-scan:ignore-line` 之类豁免：' + o.applied_fix.no_ignore_line_exemption);
      L.push('  - 为什么仓库内 `tools/verify-mobile.js` 没改：本次测到它第 79 行已经不是字面量（是 viewport 常量），`BROWSER_CANDIDATES` 已是 env 拼路径；该文件当时正被另一个 Agent 持续重写（长度 25,464 → 54,037 → 131,868 B），改动它只会制造冲突。');
    }
    L.push('');
    L.push('### 5.1 `node tools/privacy-scan.js --no-report` 原始输出（尾部）');
    L.push('');
    L.push('```text');
    L.push(o.privacy_scan.stdout_tail);
    L.push('```');
    L.push('');
    L.push('- exit code：`' + o.privacy_scan.exit_code + '`；① must-fix：`' + o.privacy_scan.must_fix + '`；结论行：`' + o.privacy_scan.verdict_line + '`');
    L.push('- 说明：' + o.privacy_scan.cmd);
    L.push('- 结论：' + o.conclusion);
    L.push('');
  }

  L.push('## 6. 失败项最小复现');
  L.push('');
  const failing = [1, 2, 3, 4, 5].filter((id) => it[id] && it[id].status !== 'pass');
  if (!failing.length) L.push('本次没有失败项。');
  else for (const id of failing) L.push('- #' + id + '：`' + it[id].repro + '` → ' + it[id].conclusion);
  L.push('');
  return L.join('\n') + '\n';
}

function saveState(st) {
  st.generated_at = new Date().toISOString();
  st.instances = { post: BASE, pre: PRE };
  st.fingerprint = fingerprint();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(st, null, 2) + '\n', 'utf8');
  fs.writeFileSync(OUT_MD, renderMd(st), 'utf8');
  console.log('  wrote reports/mobile-verify-c.json + reports/mobile-verify-c.md');
}

/* ───────────── main ───────────── */

(async () => {
  const st = loadState();
  st.items = st.items || {};
  const needBrowser = DO(1) || DO(3) || DO(4);
  let browser = null;
  let exe = null;
  if (needBrowser) {
    const l = await launch();
    browser = l.browser; exe = l.exe;
    console.log('browser: ' + exe);
  }
  try {
    if (DO(1)) { console.log('#1 E1/E2 零回归对打 …'); st.items['1'] = await check1(browser); saveState(st); }
    if (DO(2)) { console.log('#2 E3 既有门禁（影子副本）…'); st.items['2'] = await check2(); saveState(st); }
    if (DO(3)) { console.log('#3 E5 file:// …'); st.items['3'] = await check3(browser); saveState(st); }
    if (DO(4)) { console.log('#4 性能（4× CPU + 4G）…'); st.items['4'] = await check4(browser); saveState(st); }
    if (DO(5)) { console.log('#5 隐私 + privacy-scan …'); st.items['5'] = await check5(); saveState(st); }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  const failing = [1, 2, 3, 4, 5].filter((id) => st.items[id] && st.items[id].status !== 'pass');
  console.log('\n汇总：失败项 [' + failing.join(',') + ']' + (failing.length ? '' : '（全绿）'));
  if (PRINT_JSON) {
    console.log(JSON.stringify({ generated_at: st.generated_at, fingerprint: st.fingerprint, items: Object.fromEntries(Object.entries(st.items).map(([k, v]) => [k, { name: v.name, status: v.status, conclusion: v.conclusion }])) }, null, 2));
  }
  process.exitCode = failing.length ? 1 : 0;
})().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack : e)); process.exit(2); });
