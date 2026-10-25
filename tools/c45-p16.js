'use strict';
/**
 * c45-p16.js — P1-6（侧栏组名 pill 截断）的根因定位 + 候选补丁实测
 *
 * 现象：现行规则（批 3 已落地在 tools/site/assets.js）把 .grp-name 改成
 *       flex:1 1 auto;min-width:0，并把 .grp-zh 改成 flex:0 1 auto;min-width:0，
 *       但截断数一动不动（9 → 9），且 OFF/ON 两个 arm 的几何**逐像素相同**。
 *
 * 怀疑：CSS 层叠自相冲突 —— 紧随其后的老规则
 *       .side-group-title .grp-zh{...;flex:0 0 auto}   （同选择器、同特异性、更靠后）
 *       把 flex:0 1 auto 覆盖回 flex:0 0 auto，于是 .grp-zh **不可收缩**，
 *       grp-name 无论如何都拿不到更多宽度。
 *
 * 本工具：对同一页面注入若干候选补丁，逐个量测「组名截断数」与「中文名被裁剪数」，
 * 用数据判定根因、并给出验证过的补丁文本。
 *
 * 用法: node tools/c45-p16.js [--json=reports/.c45-p16.json]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const BASE = opt('base', 'http://127.0.0.1:8787');
const OUT = path.resolve(ROOT, opt('json', 'reports/.c45-p16.json'));

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const MEASURE = () => {
  const names = Array.from(document.querySelectorAll('.side-group-title .grp-name'));
  const rows = names.map((n) => {
    const p = n.parentElement;
    const zh = p ? p.querySelector('.grp-zh') : null;
    const cnt = p ? p.querySelector('.side-count') : null;
    const home = p ? p.querySelector('.side-home') : null;
    const csZh = zh ? getComputedStyle(zh) : null;
    return {
      text: (n.textContent || '').trim(),
      cw: Math.round(n.clientWidth), sw: Math.round(n.scrollWidth),
      truncated: n.scrollWidth > n.clientWidth + 1,
      flex: getComputedStyle(n).flex,
      minWidth: getComputedStyle(n).minWidth,
      zhFs: zh ? parseFloat(csZh.fontSize) : null,
      zhFlex: zh ? csZh.flex : null,
      zhW: zh ? Math.round(zh.getBoundingClientRect().width) : null,
      zhSw: zh ? Math.round(zh.scrollWidth) : null,
      zhClipped: zh ? zh.scrollWidth > zh.clientWidth + 1 : null,
      homeW: home ? Math.round(home.getBoundingClientRect().width) : null,
      cntW: cnt ? Math.round(cnt.getBoundingClientRect().width) : null,
      titleW: p ? Math.round(p.getBoundingClientRect().width) : null,
      gap: p ? getComputedStyle(p).gap : null,
    };
  });
  const t = document.querySelector('.side-group-title');
  return {
    pills: rows.length,
    truncated: rows.filter((r) => r.truncated).length,
    zhClipped: rows.filter((r) => r.zhClipped).length,
    sidebarW: t ? Math.round(t.getBoundingClientRect().width) : null,
    truncatedTexts: rows.filter((r) => r.truncated).map((r) => r.text),
    rows: rows.slice(0, 6),
  };
};

/* 候选补丁：先证实层叠冲突，再给可落地的修法 */
const VARIANTS = [
  { id: 'status-quo', css: '', note: '现状（批 3 规则已落地）' },
  {
    id: 'root-cause', note: '只把 .grp-zh 的 flex 从 0 0 auto 改回 0 1 auto（证明层叠冲突是根因）',
    css: '.side-group-title .grp-zh{flex:0 1 auto!important;min-width:0!important}',
  },
  {
    id: 'rc+zh69', note: '根因 + .grp-zh 字号回收 11.52→10.88px(.68rem)',
    css: '.side-group-title .grp-zh{flex:0 1 auto!important;min-width:0!important;font-size:.68rem!important}',
  },
  {
    id: 'rc+tighter', note: '根因 + 组内 gap .3rem→.18rem + .side-home 内边距收紧',
    css: '.side-group-title .grp-zh{flex:0 1 auto!important;min-width:0!important;font-size:.68rem!important}'
      + '.side-group-title{gap:.18rem!important}'
      + '.side-group-title a.side-home{padding:0 .25em!important}',
  },
  {
    id: 'v2', note: '根因 + gap .12rem + zh .66rem + home padding .18em',
    css: '.side-group-title .grp-zh{flex:0 1 auto!important;min-width:0!important;font-size:.66rem!important}'
      + '.side-group-title{gap:.12rem!important}'
      + '.side-group-title a.side-home{padding:0 .18em!important}',
  },
  {
    id: 'v2b', note: 'v2 + 中文件名 .64rem + gap .1rem（争取中文名也不被裁）',
    css: '.side-group-title .grp-zh{flex:0 1 auto!important;min-width:0!important;font-size:.62rem!important}'
      + '.side-group-title{gap:.1rem!important}'
      + '.side-group-title a.side-home{padding:0 .14em!important}',
  },
  {
    id: 'v3', note: 'v2 + .side-count 字号 .7rem→.66rem + 组内左右内边距 .4rem→.28rem',
    css: '.side-group-title .grp-zh{flex:0 1 auto!important;min-width:0!important;font-size:.66rem!important}'
      + '.side-group-title{gap:.12rem!important;padding-left:.28rem!important;padding-right:.28rem!important}'
      + '.side-group-title a.side-home{padding:0 .18em!important}'
      + '.side-group-title .side-count{font-size:.66rem!important}',
  },
  {
    id: 'v4', note: 'v3 + 中文件名给 max-width 上限（超出用省略号，优先保组名）',
    css: '.side-group-title .grp-zh{flex:0 1 auto!important;min-width:0!important;font-size:.66rem!important;max-width:38px!important}'
      + '.side-group-title{gap:.12rem!important;padding-left:.28rem!important;padding-right:.28rem!important}'
      + '.side-group-title a.side-home{padding:0 .18em!important}'
      + '.side-group-title .side-count{font-size:.66rem!important}',
  },
  {
    id: 'rc+hidezh', note: '根因 + 窄侧栏时隐藏中文名（最激进，验证收益上限）',
    css: '.side-group-title .grp-zh{display:none!important}',
  },
];

(async () => {
  if (!EXE) throw new Error('no Chrome executable found');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/paper/dev/dialogs/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(500);

  const out = { tool: 'tools/c45-p16.js', base: BASE, generated_at: new Date().toISOString(), variants: [] };

  // 先直接读一次现状的层叠证据（不注入任何东西）
  const cascade = await page.evaluate(() => {
    const zh = document.querySelector('.side-group-title .grp-zh');
    const name = document.querySelector('.side-group-title .grp-name');
    return {
      zh_flex_computed: zh ? getComputedStyle(zh).flex : null,
      zh_minWidth_computed: zh ? getComputedStyle(zh).minWidth : null,
      name_flex_computed: name ? getComputedStyle(name).flex : null,
      name_minWidth_computed: name ? getComputedStyle(name).minWidth : null,
      zh_fontSize_computed: zh ? getComputedStyle(zh).fontSize : null,
    };
  });
  out.cascade = cascade;
  console.log('=== 现状 computed 值（层叠证据）: ' + JSON.stringify(cascade));

  for (const v of VARIANTS) {
    let handle = null;
    if (v.css) {
      handle = await page.addStyleTag({ content: v.css });
      await page.waitForTimeout(250);
    }
    const m = await page.evaluate(MEASURE);
    out.variants.push({ id: v.id, note: v.note, css: v.css, ...m });
    console.log('\n--- ' + v.id + '  （' + v.note + '）');
    console.log('    pills=' + m.pills + '  组名截断=' + m.truncated + '  中文名被裁剪=' + m.zhClipped
      + '  侧栏宽=' + m.sidebarW);
    if (m.truncatedTexts.length) console.log('    截断: ' + m.truncatedTexts.join(', '));
    if (m.rows[0]) console.log('    样本: ' + JSON.stringify(m.rows[0]));
    if (handle) await handle.evaluate((el) => el.remove());
    await page.waitForTimeout(150);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('\nwrote ' + path.relative(ROOT, OUT).split(path.sep).join('/'));
  await browser.close();
})().catch((e) => { console.error('ERR', (e && e.stack) || e); process.exit(1); });
