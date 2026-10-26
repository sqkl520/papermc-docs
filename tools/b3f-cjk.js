'use strict';
/**
 * b3f-cjk.js — 审计 `--fs-2xs`(11.5px) 的归属是否违反 §2.4 的中文可读性约束。
 *
 * §2.4 原文：「11.5px 可用于『非关键装饰』，不可用于任何需要阅读的中文；
 *             本方案的中文下限是 12.5px，且 --fs-2xs（11.5）在中文语境下
 *             只允许承载『数字 / 拉丁』内容。」
 * 并且点名：「`.grp-zh`（纯中文）必须走 `--fs-xs`(12.5)，不能走 `--fs-2xs`(11.5)。
 *             这会与 upz-ladder.json 的 bucket 归属冲突 —— **以本文为准**。」
 *
 * 本脚本对每个被赋予 --fs-2xs 的选择器，在真实渲染的 177 页里采样其文本内容，
 * 判定是否含 CJK —— 含则必须升到 --fs-xs。
 *
 * 用法：node tools/b3f-cjk.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

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

/* 取样页：覆盖 首页/分区/分类/内容/配置/all-pages/snapshots/404 —— 每种模板至少 1 页 */
const SAMPLE = [
  'index.html', 'all-pages.html', 'snapshots.html', '404.html',
  'paper/index.html', 'velocity/index.html', 'folia/index.html',
  'sections/paper.html', 'categories/paper-dev-command.html',
  'paper/dev/dialogs/index.html',
  'paper/reference/world-configuration/index.html',
  'paper/reference/configuration/index.html',
  'paper/dev/pdc/index.html',
  'velocity/tuning/index.html',
];
const allPages = walk(ROOT, []);
const pages = SAMPLE.filter((p) => allPages.indexOf(p) !== -1);

/* 待审选择器：**直接从当前 SITE_CSS 里**找所有 font-size:var(--fs-2xs) 的规则。
   不能再用 b3f-map3d.json —— 那份是"改造计划"，改完后计划里的 token 已经落地，
   map 会认为没有待改项而给出空集（假绿）。本脚本必须审**现状**。 */
const { SITE_CSS } = require('./site/assets.js');
const twoXs = [];
{
  /* 扁平扫：匹配 "选择器{...font-size:var(--fs-2xs)...}" */
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(SITE_CSS)) !== null) {
    const sel = m[1].trim();
    const body = m[2];
    if (!sel || sel.startsWith('@')) continue;
    if (!/font-size\s*:\s*var\(--fs-2xs\)/.test(body)) continue;
    twoXs.push({ sel });
  }
}

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
const stripPseudo = (s) => s.replace(PSEUDO_RE, '').trim() || '*';

/* 每个选择器（剥壳后）的取样探针 */
const PROBE = (sels) => {
  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
  const res = {};
  for (const s of sels) {
    let nodes = [];
    try { nodes = [...document.querySelectorAll(s)]; } catch (e) { res[s] = { error: true }; continue; }
    const texts = nodes.map((n) => (n.textContent || '').trim()).filter(Boolean);
    res[s] = {
      count: nodes.length,
      cjkCount: texts.filter((t) => CJK.test(t)).length,
      latinCount: texts.filter((t) => !CJK.test(t)).length,
      samples: texts.slice(0, 4).map((t) => t.slice(0, 18)),
      cjkSamples: texts.filter((t) => CJK.test(t)).slice(0, 3).map((t) => t.slice(0, 18)),
    };
  }
  return res;
};

(async () => {
  if (!EXE) throw new Error('找不到 chromium');
  const targets = [...new Set(twoXs.map((r) => stripPseudo(splitSel(r.sel)[0])))];
  /* 单选择器规则的完整选择器列表（多选择器规则要逐个探） */
  const probeList = [];
  for (const r of twoXs) for (const s of splitSel(r.sel)) probeList.push(stripPseudo(s));
  const uniq = [...new Set(probeList)];

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const agg = {};
  for (const s of uniq) agg[s] = { count: 0, cjkCount: 0, latinCount: 0, cjkSamples: [], samples: [] };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const rel of pages) {
    await page.goto('file:///' + path.join(ROOT, rel).replace(/\\/g, '/'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    /* 搜索面板结果与移动 TOC 需要交互才出现 —— 但 CSS 归属判定用静态页足够；
       这里额外把所有 <details> 打开，覆盖折叠态里的元素 */
    await page.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); });
    const r = await page.evaluate(PROBE, uniq);
    for (const s of uniq) {
      const x = r[s];
      if (!x || x.error) continue;
      agg[s].count += x.count;
      agg[s].cjkCount += x.cjkCount;
      agg[s].latinCount += x.latinCount;
      if (agg[s].cjkSamples.length < 4) agg[s].cjkSamples.push(...x.cjkSamples);
      if (agg[s].samples.length < 4) agg[s].samples.push(...x.samples);
    }
  }
  await browser.close();

  console.log('=== --fs-2xs(11.5px) 的 ' + uniq.length + ' 个选择器：是否承载中文 ===');
  console.log('页样本 ' + pages.length + ' 个；所有 <details> 已展开\n');
  const VIOLATE = [];
  const OK = [];
  for (const s of uniq.sort()) {
    const a = agg[s];
    const hasCjk = a.cjkCount > 0;
    (hasCjk ? VIOLATE : OK).push({ sel: s, ...a });
    console.log((hasCjk ? '✗ 中文' : '✓ 拉丁/数字').padEnd(13) + s.slice(0, 52).padEnd(54)
      + 'n=' + String(a.count).padStart(4) + ' cjk=' + String(a.cjkCount).padStart(4)
      + (hasCjk ? '  「' + a.cjkSamples.slice(0, 2).join('」「') + '」' : '  ' + a.samples.slice(0, 2).join(' | ')));
  }

  console.log('\n=== 违规（必须升到 --fs-xs 12.5）' + VIOLATE.length + ' 个 ===');
  for (const v of VIOLATE) console.log('  · ' + v.sel + '   cjk=' + v.cjkCount + '/' + v.count);
  console.log('\n=== 合规（可留 11.5，仅数字/拉丁）' + OK.length + ' 个 ===');
  for (const o of OK) console.log('  · ' + o.sel);

  fs.writeFileSync(path.join(os.tmpdir(), 'b3f-cjk.json'), JSON.stringify({ violate: VIOLATE, ok: OK }, null, 2), 'utf8');
  console.log('\nJSON → ' + path.join(os.tmpdir(), 'b3f-cjk.json'));
})().catch((e) => { console.error(e); process.exit(1); });
