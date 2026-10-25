'use strict';
/**
 * c45-final.js — 收尾复核：把 P1-6 / P2-2 在**多个视口**下量化，避免单点口径误导。
 *
 * P1-6：组名截断数随侧栏宽度变化，1440 只是一个点 —— 1280/1366/1440/1600 各测一次现状，
 *       并对每个视口同时给"现行规则"和"候选补丁 v2"两个 arm。
 * P2-2：320px 下把"全部词中断 / 其中在 <code> 内 / 可避免"分开统计，
 *       因为 <code> 里的长 API 签名（natural > 可用宽）在任何 overflow-wrap 下都会被折断，
 *       不属于这条规则能修的范围。
 *
 * 用法: node tools/c45-final.js [--json=reports/.c45-final.json]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const BASE = opt('base', 'http://127.0.0.1:8787');
const OUT = path.resolve(ROOT, opt('json', 'reports/.c45-final.json'));

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* 候选补丁 v2（已由 tools/c45-p16.js 逐个变体验证过，此处跨视口复核） */
const V2 = '.side-group-title .grp-zh{flex:0 1 auto;min-width:0;font-size:.66rem}'
  + '.side-group-title{gap:.12rem}'
  + '.side-group-title a.side-home{padding:0 .18em}';

const M_PILL = () => {
  const names = Array.from(document.querySelectorAll('.side-group-title .grp-name'));
  const rows = names.map((n) => ({
    text: (n.textContent || '').trim(),
    cw: Math.round(n.clientWidth), sw: Math.round(n.scrollWidth),
    truncated: n.scrollWidth > n.clientWidth + 1,
  }));
  const zh = Array.from(document.querySelectorAll('.side-group-title .grp-zh'));
  const t = document.querySelector('.side-group-title');
  return {
    pills: rows.length,
    truncated: rows.filter((r) => r.truncated).length,
    truncatedTexts: rows.filter((r) => r.truncated).map((r) => r.text),
    zhClipped: zh.filter((z) => z.scrollWidth > z.clientWidth + 1).length,
    zhTotal: zh.length,
    sidebarW: t ? Math.round(t.getBoundingClientRect().width) : null,
  };
};

const M_WRAP = () => {
  const cells = Array.from(document.querySelectorAll('.table-wrap td, .table-wrap th'));
  const broken = [];
  const meas = document.createElement('span');
  meas.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:nowrap;visibility:hidden';
  document.body.appendChild(meas);
  const wordRe = /[^\s\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]+/g;
  for (const td of cells) {
    const cs = getComputedStyle(td);
    const avail = td.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT, null);
    const range = document.createRange();
    let tn;
    while ((tn = walker.nextNode())) {
      const txt = tn.nodeValue || '';
      if (!txt.trim()) continue;
      let m;
      wordRe.lastIndex = 0;
      while ((m = wordRe.exec(txt))) {
        const word = m[0];
        if (word.length < 2) continue;
        range.setStart(tn, m.index);
        range.setEnd(tn, m.index + word.length);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
        if (rects.length > 1) {
          meas.style.font = cs.font;
          meas.style.letterSpacing = cs.letterSpacing;
          meas.textContent = word;
          const natural = meas.getBoundingClientRect().width;
          broken.push({
            word: word.length > 32 ? word.slice(0, 32) + '…' : word,
            unavoidable: natural > avail, inCode: !!(tn.parentElement && tn.parentElement.closest('code')),
          });
        }
      }
    }
  }
  meas.remove();
  const wraps = Array.from(document.querySelectorAll('.table-wrap'))
    .map((w) => Math.max(0, w.scrollWidth - w.clientWidth));
  return {
    cells: cells.length,
    broken: broken.length,
    inCode: broken.filter((b) => b.inCode).length,
    plainText: broken.filter((b) => !b.inCode).length,
    avoidable: broken.filter((b) => !b.unavoidable).length,
    unavoidable: broken.filter((b) => b.unavoidable).length,
    textSamples: broken.filter((b) => !b.inCode).slice(0, 8).map((b) => b.word),
    wrapsOverflowing: wraps.filter((x) => x > 0).length,
  };
};

(async () => {
  if (!EXE) throw new Error('no Chrome executable found');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { tool: 'tools/c45-final.js', base: BASE, generated_at: new Date().toISOString(), p16: [], p22: [] };

  /* ---- P1-6 多视口 ---- */
  for (const vw of [1280, 1366, 1440, 1600, 1920]) {
    const row = { vw };
    for (const arm of ['current', 'patch-v2']) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/index.html', { waitUntil: 'load' });
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      await page.waitForTimeout(400);
      if (arm === 'patch-v2') { await page.addStyleTag({ content: V2 }); await page.waitForTimeout(250); }
      row[arm] = await page.evaluate(M_PILL);
      await ctx.close();
    }
    out.p16.push(row);
    console.log('P1-6 @' + String(vw).padEnd(5) + ' 现状=' + row.current.truncated + '/' + row.current.pills
      + '  中文名裁剪=' + row.current.zhClipped + '   |  patch-v2=' + row['patch-v2'].truncated
      + '  中文名裁剪=' + row['patch-v2'].zhClipped);
  }

  /* ---- P2-2 320px，8 个表格页 ---- */
  const TABLE_PAGES = [
    'paper/dev/dialogs/index.html',
    'paper/dev/command-api/basics/arguments-and-literals/index.html',
    'paper/dev/command-api/basics/argument-suggestions/index.html',
    'paper/dev/command-api/basics/custom-arguments/index.html',
    'paper/dev/command-api/misc/basic-command/index.html',
    'paper/reference/commands/index.html',
    'paper/dev/command-api/basics/executors/index.html',
    'velocity/dev/creating-your-first-plugin/index.html',
  ];
  for (const rel of TABLE_PAGES) {
    const row = { page: rel };
    for (const arm of ['current', 'patch-off']) {
      const ctx = await browser.newContext({ viewport: { width: 320, height: 720 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(BASE + '/' + rel, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      if (arm === 'patch-off') {
        await page.addStyleTag({ content: '.table-wrap td{overflow-wrap:anywhere}' });
        await page.waitForTimeout(250);
      }
      row[arm] = await page.evaluate(M_WRAP);
      await ctx.close();
    }
    out.p22.push(row);
    console.log('P2-2 ' + rel.padEnd(58) + ' break-word=' + String(row.current.broken).padStart(3)
      + ' (code ' + row.current.inCode + ', 纯文本 ' + row.current.plainText + ', 可避免 ' + row.current.avoidable + ')'
      + '   anywhere=' + String(row['patch-off'].broken).padStart(3));
  }

  const sum = (arm, k) => out.p22.reduce((s, r) => s + r[arm][k], 0);
  out.p22totals = {};
  for (const arm of ['current', 'patch-off']) {
    out.p22totals[arm] = { broken: sum(arm, 'broken'), inCode: sum(arm, 'inCode'), plainText: sum(arm, 'plainText'), avoidable: sum(arm, 'avoidable'), unavoidable: sum(arm, 'unavoidable'), overflow: sum(arm, 'wrapsOverflowing') };
  }
  console.log('\nP2-2 汇总(8 页/320px)  break-word=' + JSON.stringify(out.p22totals.current));
  console.log('P2-2 汇总(8 页/320px)  anywhere  =' + JSON.stringify(out.p22totals['patch-off']));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('\nwrote ' + path.relative(ROOT, OUT).split(path.sep).join('/'));
  await browser.close();
})().catch((e) => { console.error('ERR', (e && e.stack) || e); process.exit(1); });
