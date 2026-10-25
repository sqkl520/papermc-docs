'use strict';
/**
 * c45-ab.js — P2 的**同源 A/B 对照**（CSS 规则级，隔离单条规则的效果）
 *
 * 为什么需要它：reports/.c5-probe-before.json 是规划阶段（旧构建）的快照，
 * 跨构建、跨时间，且期间 C3 还在改 tools/site/assets.js —— 直接"改前/改后"对比会把
 * 别人的改动算到自己头上。本工具对**同一份正在服务的站点**注入/撤销单条 CSS 规则：
 *     off = 该规则失效（用更高优先级的样式覆盖回旧行为）
 *     on  = 站点现状（构建期已含该规则）
 * 两个 arm 之间只差这一条规则，因此差值就是这条规则的净效果。
 *
 * 覆盖：
 *   P2-1  .article h5{font-size:1.0625rem}          off: .article h5{font-size:.95rem}
 *   P2-2  .table-wrap td{overflow-wrap:break-word}  off: .table-wrap td{overflow-wrap:anywhere}
 *   P2-3  .filter-bar{position:sticky}              off: .filter-bar{position:static}
 *   P1-6  .grp-name{flex:1 1 auto;min-width:0}      off: 复原为旧规则（无 flex/min-width）
 *
 * 用法: node tools/c45-ab.js [--json=reports/.c45-ab.json]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const BASE = opt('base', 'http://127.0.0.1:8787');
const OUT = path.resolve(ROOT, opt('json', 'reports/.c45-ab.json'));

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const OFF_CSS = {
  'p2-1': '.article h5{font-size:.95rem!important;color:var(--fg-muted)!important}',
  'p2-2': '.table-wrap td{overflow-wrap:anywhere!important}',
  'p2-3': '.filter-bar{position:static!important}',
  'p1-6': '.side-group-title .grp-name{flex:0 1 auto!important;min-width:auto!important}'
    + '.side-group-title .grp-zh{flex:0 0 auto!important;min-width:auto!important}',
};

/* ---------- 页内测量 ---------- */

// P2-1: h5 与正文的 computed 字号
const M_H5 = () => {
  const h5 = Array.from(document.querySelectorAll('.article h5'));
  const fsOf = (e) => parseFloat(getComputedStyle(e).fontSize);
  const paras = Array.from(document.querySelectorAll('.article p'))
    .filter((p) => {
      if (p.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat')) return false;
      return (p.textContent || '').trim().length >= 40;
    });
  const body = paras.length ? fsOf(paras[0]) : null;
  const sizes = h5.map(fsOf);
  return {
    h5Count: h5.length,
    h5Min: sizes.length ? Math.min(...sizes) : null,
    h5Max: sizes.length ? Math.max(...sizes) : null,
    bodyFs: body,
    h5GtBody: sizes.length && body ? Math.min(...sizes) > body : null,
    sample: h5.slice(0, 3).map((e) => ({ t: (e.textContent || '').trim().slice(0, 32), fs: fsOf(e) })),
  };
};

// P2-2: 320px 下 .table-wrap td/th 内的词中断
// 口径与 reports/critique-typography.md:457 一致：逐字符 Range + 行聚类；
// 额外区分 inCode / 纯文本，并单独报"可避免"（自然宽度 <= 单元格可用宽 却仍被折断）
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
            word: word.length > 40 ? word.slice(0, 40) + '…' : word,
            parts: rects.length,
            cellW: Math.round(td.clientWidth),
            avail: Math.round(avail),
            natural: Math.round(natural),
            unavoidable: natural > avail,
            inCode: !!(tn.parentElement && tn.parentElement.closest('code')),
          });
        }
      }
    }
  }
  meas.remove();
  const wraps = Array.from(document.querySelectorAll('.table-wrap'))
    .map((w) => ({ scrollW: w.scrollWidth, clientW: w.clientWidth, over: Math.max(0, w.scrollWidth - w.clientWidth) }));
  return {
    cells: cells.length,
    broken: broken.length,
    inCode: broken.filter((b) => b.inCode).length,
    avoidable: broken.filter((b) => !b.unavoidable).length,
    unavoidable: broken.filter((b) => b.unavoidable).length,
    wrapsOverflowing: wraps.filter((w) => w.over > 0).length,
    samples: broken.filter((b) => !b.unavoidable).slice(0, 6),
    vw: window.innerWidth,
  };
};

// P2-3: 滚 5000px 后筛选框是否仍在视口内、且命中自身
const M_FILTER = () => {
  const fb = document.querySelector('.filter-bar');
  if (!fb) return { found: false };
  const target = Math.min(5000, document.documentElement.scrollHeight - window.innerHeight - 1);
  window.scrollTo({ top: target, left: 0, behavior: 'instant' });
  const r = fb.getBoundingClientRect();
  const cs = getComputedStyle(fb);
  const y = Math.round(Math.max(r.top + Math.min(r.height / 2, 12), 4));
  const hit = document.elementFromPoint(Math.round(r.left + Math.min(60, r.width / 2)), y);
  return {
    found: true, position: cs.position, zIndex: cs.zIndex, top: cs.top,
    rectTop: Math.round(r.top), scrollY: Math.round(window.scrollY),
    docH: Math.round(document.documentElement.scrollHeight),
    inViewport: r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.height > 0,
    topIsSelf: !!(hit && (hit === fb || fb.contains(hit))),
    hitCls: hit ? String(hit.className || hit.tagName).slice(0, 30) : null,
  };
};

// P1-6: 侧栏组名 pill 是否被 ellipsis 截断（scrollWidth > clientWidth）
const M_PILL = () => {
  const names = Array.from(document.querySelectorAll('.side-group-title .grp-name'));
  const rows = names.map((n) => {
    const zh = n.parentElement ? n.parentElement.querySelector('.grp-zh') : null;
    const cnt = n.parentElement ? n.parentElement.querySelector('.side-count') : null;
    const home = n.parentElement ? n.parentElement.querySelector('.side-home') : null;
    return {
      text: (n.textContent || '').trim(),
      cw: Math.round(n.clientWidth), sw: Math.round(n.scrollWidth),
      truncated: n.scrollWidth > n.clientWidth + 1,
      flex: getComputedStyle(n).flex, minWidth: getComputedStyle(n).minWidth,
      zhFs: zh ? parseFloat(getComputedStyle(zh).fontSize) : null,
      zhW: zh ? Math.round(zh.getBoundingClientRect().width) : null,
      zhClipped: zh ? zh.scrollWidth > zh.clientWidth + 1 : null,
      homeW: home ? Math.round(home.getBoundingClientRect().width) : null,
      cntW: cnt ? Math.round(cnt.getBoundingClientRect().width) : null,
    };
  });
  const titleW = (() => {
    const t = document.querySelector('.side-group-title');
    return t ? Math.round(t.getBoundingClientRect().width) : null;
  })();
  return {
    pills: rows.length,
    truncated: rows.filter((r) => r.truncated).length,
    zhClipped: rows.filter((r) => r.zhClipped).length,
    titleW,
    list: rows.filter((r) => r.truncated).slice(0, 10),
    sample: rows.slice(0, 3),
  };
};

/* ---------- 驱动 ---------- */
(async () => {
  if (!EXE) throw new Error('no Chrome executable found');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function run(vp, rel, measureFn, arm, openDetails) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: vp.width <= 768, hasTouch: vp.width <= 768 });
    const page = await ctx.newPage();
    await page.goto(BASE + rel, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    if (openDetails) {
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      await page.waitForTimeout(400);
    }
    if (arm === 'off' && OFF_CSS[currentRule]) {
      await page.addStyleTag({ content: OFF_CSS[currentRule] });
      await page.waitForTimeout(200);
    }
    const r = await page.evaluate(measureFn);
    await ctx.close();
    return r;
  }

  let currentRule = null;
  const result = { tool: 'tools/c45-ab.js', base: BASE, generated_at: new Date().toISOString(), rules: {} };

  const jobs = [
    {
      id: 'p2-1', desc: '.article h5 font-size 17px vs 15.2px',
      vp: { width: 1440, height: 900 }, rel: '/paper/reference/cli-arguments/index.html', fn: M_H5,
    },
    {
      id: 'p2-2', desc: '.table-wrap td overflow-wrap break-word vs anywhere (320px)',
      vp: { width: 320, height: 720 }, rel: '/paper/dev/dialogs/index.html', fn: M_WRAP,
    },
    {
      id: 'p2-3', desc: '.filter-bar sticky vs static (scroll 5000px)',
      vp: { width: 1440, height: 900 }, rel: '/all-pages.html', fn: M_FILTER,
    },
    {
      id: 'p1-6', desc: 'side-group-title .grp-name flex shrink (1440, all details open)',
      vp: { width: 1440, height: 900 }, rel: '/paper/dev/dialogs/index.html', fn: M_PILL, openDetails: true,
    },
  ];

  for (const j of jobs) {
    currentRule = j.id;
    const off = await run(j.vp, j.rel, j.fn, 'off', j.openDetails);
    const on = await run(j.vp, j.rel, j.fn, 'on', j.openDetails);
    result.rules[j.id] = { desc: j.desc, viewport: j.vp.width + 'x' + j.vp.height, page: j.rel, off, on };
    console.log('\n=== ' + j.id + '  ' + j.desc);
    console.log('  OFF(旧行为): ' + JSON.stringify(j.id === 'p1-6'
      ? { pills: off.pills, truncated: off.truncated, zhClipped: off.zhClipped, titleW: off.titleW, list: (off.list || []).map((x) => x.text + ' ' + x.cw + '/' + x.sw) }
      : off));
    console.log('  ON (现状) : ' + JSON.stringify(j.id === 'p1-6'
      ? { pills: on.pills, truncated: on.truncated, zhClipped: on.zhClipped, titleW: on.titleW, list: (on.list || []).map((x) => x.text + ' ' + x.cw + '/' + x.sw) }
      : on));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log('\nwrote ' + path.relative(ROOT, OUT).split(path.sep).join('/'));
  await browser.close();
})().catch((e) => { console.error('ERR', (e && e.stack) || e); process.exit(1); });
