'use strict';
/**
 * b3f-dead.js — 3a 死规则存活检测（**不照抄规划里的清单，自己测**）。
 *
 * 判定口径（三条缺一不可，否则会误删活规则）：
 *   ① **伪元素剥壳**：`::before/::after/...` 无法 querySelectorAll，先剥掉用宿主选择器判定。
 *      （首轮实测教训：不剥壳时 9 条活的伪元素规则被误判成死规则。）
 *   ② **多选择器逐条判定**：规则里任一拆分选择器有命中 ⇒ 整条规则是活的。
 *   ③ **4 视口 × 全站 177 页**：断点层规则只在特定视口生效，单视口会误杀。
 *
 * 口径边界：本脚本只证明「选择器**从不匹配静态 DOM**」。若某个类只由 SITE_JS 在运行期
 * 注入（例如 .sr-* 只出现在搜索面板渲染后），静态 DOM 命中为 0 但规则并非死规则。
 * 因此对 SR_JS_CLASSES 强制豁免，并在输出里单列。
 *
 * 用法：node tools/b3f-dead.js [--pages=N] [--tag=x]
 * 输出：%TEMP%\b3f-dead-<tag>.json
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* SITE_JS 在运行期注入的类（搜索面板）：静态 DOM 恒 0 命中，但**不是**死规则。 */
const SR_JS_CLASSES = ['.sr-path', '.sr-snip', '.sr-chip', '.sr-empty', '.sr-hits', '.sr-ttl', '.sr-count'];
const isJsInjected = (sel) => SR_JS_CLASSES.some((c) => sel.indexOf(c) !== -1);

/* ---------- 收集页清单 ---------- */
const SKIP_DIR = /[\\/](archive|node_modules|_pre-mobile|_shadow)[\\/]/;
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (SKIP_DIR.test(full)) continue;
    if (e.isDirectory()) walk(full, acc);
    else if (e.isFile() && e.name.endsWith('.html')) acc.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return acc;
}
let pages = walk(ROOT, []).sort();
const lim = Number(arg('pages', '0'));
if (lim > 0) pages = pages.slice(0, lim);

/* ---------- 读 cssmap ---------- */
const mapFile = path.join(os.tmpdir(), 'b3f-cssmap.json');
if (!fs.existsSync(mapFile)) {
  console.error('先跑 node tools/b3f-cssmap.js');
  process.exit(1);
}
const cmap = JSON.parse(fs.readFileSync(mapFile, 'utf8'));

function splitSel(sel) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const PSEUDO_RE = /::?(before|after|marker|backdrop|placeholder|selection|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)\b/g;
const hasPseudo = (s) => { PSEUDO_RE.lastIndex = 0; const r = PSEUDO_RE.test(s); PSEUDO_RE.lastIndex = 0; return r; };
const stripPseudo = (s) => {
  PSEUDO_RE.lastIndex = 0;
  const stripped = s.replace(PSEUDO_RE, '').trim();
  PSEUDO_RE.lastIndex = 0;
  return stripped || '*';
};

const targets = [];
for (const r of cmap.rulesWithFs) {
  for (const s of splitSel(r.sel)) {
    const pseudo = hasPseudo(s);
    targets.push({
      idx: r.idx, line: r.line, ctx: r.ctx.join(' > '), ruleSel: r.sel,
      sel: s, probe: pseudo ? stripPseudo(s) : s, isPseudo: pseudo, fs: r.fontSizes,
    });
  }
}
const uniqProbes = [...new Set(targets.map((t) => t.probe))];

const VPS = [
  { name: '320', w: 320, h: 568 },
  { name: '390', w: 390, h: 844 },
  { name: '800', w: 800, h: 900 },
  { name: '1440', w: 1440, h: 900 },
];

const PROBE = (sels) => {
  const res = {};
  for (let i = 0; i < sels.length; i++) {
    let n = 0;
    try { n = document.querySelectorAll(sels[i]).length; } catch (e) { n = -1; }
    res[sels[i]] = n;
  }
  return res;
};

(async () => {
  if (!EXE) throw new Error('找不到 chromium');
  const tag = arg('tag', 'run');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const totals = {};
  const perVp = {};
  const badSels = new Set();
  const pageErrors = [];

  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(vp.name + ' ' + String(e).slice(0, 120)));
    perVp[vp.name] = {};
    for (const rel of pages) {
      const url = 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { continue; }
      const hits = await page.evaluate(PROBE, uniqProbes);
      for (const s of uniqProbes) {
        const n = hits[s];
        if (n === -1) badSels.add(s);
        perVp[vp.name][s] = (perVp[vp.name][s] || 0) + Math.max(0, n);
        totals[s] = (totals[s] || 0) + Math.max(0, n);
      }
    }
    await ctx.close();
    process.stdout.write('  ' + vp.name + ' 档完成（' + pages.length + ' 页）\n');
  }
  await browser.close();

  const byIdx = new Map();
  for (const t of targets) {
    if (!byIdx.has(t.idx)) byIdx.set(t.idx, []);
    byIdx.get(t.idx).push(t);
  }
  const deadRules = [];
  const liveRules = [];
  const jsInjected = [];
  for (const pair of byIdx) {
    const list = pair[1];
    const hits = list.map((t) => totals[t.probe] || 0);
    const rec = {
      idx: pair[0], line: list[0].line, ctx: list[0].ctx, sel: list[0].ruleSel, fs: list[0].fs,
      probes: list.map((t) => t.probe), hits,
      totalHits: hits.reduce((a, b) => a + b, 0),
      jsInjected: list.every((t) => isJsInjected(t.probe)),
      perVp: VPS.reduce((o, v) => { o[v.name] = list.reduce((a, t) => a + (perVp[v.name][t.probe] || 0), 0); return o; }, {}),
    };
    if (rec.totalHits > 0) liveRules.push(rec);
    else if (rec.jsInjected) jsInjected.push(rec);
    else deadRules.push(rec);
  }
  deadRules.sort((a, b) => a.idx - b.idx);
  jsInjected.sort((a, b) => a.idx - b.idx);

  const out = {
    tag, at: new Date().toISOString(),
    pages: pages.length, vps: VPS.map((v) => v.name),
    probeCount: uniqProbes.length,
    invalidSelectors: Array.from(badSels),
    pageErrors: pageErrors.slice(0, 20),
    deadCount: deadRules.length,
    deadRules,
    jsInjectedCount: jsInjected.length,
    jsInjected,
    liveRuleCount: liveRules.length,
    lowestLive: liveRules.slice().sort((a, b) => a.totalHits - b.totalHits).slice(0, 25),
  };
  const outFile = path.join(os.tmpdir(), 'b3f-dead-' + tag + '.json');
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');

  console.log('\n=== 死规则普查 tag=' + tag + '（' + pages.length + ' 页 × ' + VPS.length + ' 视口）===');
  console.log('宿主选择器 ' + uniqProbes.length + ' 个；带 font-size 的规则 ' + byIdx.size + ' 条');
  console.log('无效选择器 ' + badSels.size + ' 个 ' + (badSels.size ? JSON.stringify(Array.from(badSels)) : ''));
  console.log('\n【SITE_JS 运行期注入，静态 0 命中但**不删**】' + jsInjected.length + ' 条：');
  for (const d of jsInjected) {
    console.log('  #' + String(d.idx).padStart(3) + ' L' + String(d.line).padStart(4)
      + '  ' + d.sel.slice(0, 72) + '  fs=' + d.fs.join('/'));
  }
  console.log('\n【真死规则】0 命中 ' + deadRules.length + ' 条：');
  for (const d of deadRules) {
    console.log('  #' + String(d.idx).padStart(3) + ' L' + String(d.line).padStart(4)
      + '  ' + (d.ctx ? '[' + d.ctx + '] ' : '') + d.sel.slice(0, 76)
      + '  fs=' + d.fs.join('/'));
  }
  console.log('\n命中数最低的 12 条活规则（防误删）：');
  for (const l of out.lowestLive.slice(0, 12)) {
    console.log('  #' + String(l.idx).padStart(3) + '  hits=' + String(l.totalHits).padStart(6)
      + '  ' + l.sel.slice(0, 66) + '  ' + JSON.stringify(l.perVp));
  }
  console.log('\nJSON → ' + outFile);
})().catch((e) => { console.error(e); process.exit(1); });
