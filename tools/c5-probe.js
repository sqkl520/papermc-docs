'use strict';
/**
 * c5-probe.js — C5（P2 收尾 6 条）的单一探针，改前/改后各跑一次同一份代码。
 *
 * 覆盖 6 条验收 + 2 条回归：
 *   P2-1  .article h5 计算字号（应 ≥17px 且 > 正文 16px）；全站 h5 计数
 *   P2-2  320px 下 .table-wrap td 的"词中断"数（应 ≤5）
 *   P2-3  all-pages.html 滚到 5000px 后 .filter-bar 是否仍可见（sticky）
 *   P2-4  桌面 TOC 当前项 aria-current 数量（应恰好 1）+ 层级缩进（lvl-2/3/4 的 paddingLeft）
 *   ▸     侧栏 summary 的 AX 名是否含 ▸ / \25B8；::before 是否仍用文字三角
 *   P1-6  侧栏组名 pill 被截断（ellipsis 生效）的个数（应 0）
 *   回归1 横向溢出 == 0（8 档 × 6 页）
 *   回归2 桌面 TOC 仍 sticky（1440 档 position/吸附行为）
 *
 * 用法: node tools/c5-probe.js --tag=before|after [--json=<path>]
 * 只读站点（http://127.0.0.1:8787），不写产物。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const TAG = opt('tag', 'before');
const BASE = opt('base', 'http://127.0.0.1:8787');
const OUT_JSON = opt('json', path.join(ROOT, 'reports', '.c5-probe-' + TAG + '.json'));

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* 6 页 × 8 档（与 b2p-verify 的抽页集一致，外加 cli-arguments 作为 h5 主战场） */
const PAGES = [
  ['dialogs', '/paper/dev/dialogs/index.html'],
  ['cliargs', '/paper/reference/cli-arguments/index.html'],
  ['worldcfg', '/paper/reference/world-configuration/index.html'],
  ['tuning', '/velocity/tuning/index.html'],
  ['landing', '/index.html'],
  ['allpages', '/all-pages.html'],
];
const VP_OVERFLOW = [320, 390, 768, 1024, 1025, 1280, 1440, 1920];

const out = {
  tool: 'tools/c5-probe.js', tag: TAG, base: BASE,
  generatedAt: new Date().toISOString(),
  chrome: EXE || null,
  p21: null, p22: null, p23: null, p24: null, triangles: null, p16: null,
  overflow: null, tocSticky: null,
};

/* ---------- 页面内测量函数（都会被 toString 序列化进浏览器） ---------- */

// P2-1：h5 与正文的字号
const M_H5 = () => {
  const h5s = Array.from(document.querySelectorAll('.article h5, .article h6'));
  const fsOf = (e) => (e ? parseFloat(getComputedStyle(e).fontSize) : null);
  const cs = h5s.map((e) => ({ t: (e.textContent || '').trim().slice(0, 40), fs: fsOf(e) }));
  const art = document.querySelector('.article');
  const isProse = (el) => {
    if (!el) return false;
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = art ? Array.from(art.querySelectorAll('p')).filter(isProse) : [];
  const bodyFs = paras.length ? fsOf(paras[0]) : null;
  const h5fs = cs.length ? cs.map((x) => x.fs) : [];
  return {
    count: cs.length,
    min: h5fs.length ? Math.min.apply(null, h5fs) : null,
    max: h5fs.length ? Math.max.apply(null, h5fs) : null,
    sample: cs.slice(0, 5),
    bodyFs,
    // 正文段落的中位字号，作为"正文 16px"的实测口径
    bodyFsAll: Array.from(new Set(paras.map((p) => fsOf(p)))),
  };
};

// P2-2：320px 下表格单元格的词中断
// 口径（对齐 ui-ruling.md:99 / critique-typography.md:457 的"逐字符 Range + 行聚类"）：
//   对 td/th 里每个"词"（不含空白、不含 CJK —— CJK 天然可断，不算词中断）取 Range 的
//   client rects；一个词出现 >1 个 rect ⇒ 它被折到多行 ⇒ 记 1 处词中断。
// 关键补充：把「不可避」与「可避」分开 ——
//   若该词的自然宽度（nowrap 实测）> 单元格内容宽，则任何 overflow-wrap 都救不了它（不可避）；
//   若自然宽度 ≤ 单元格内容宽却仍被折断，说明列被压到 min-content 以下（可避，正是 P2-2 要修的）。
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
          // 自然宽度：同字体、nowrap 实测
          meas.style.font = cs.font;
          meas.style.letterSpacing = cs.letterSpacing;
          meas.textContent = word;
          const natural = meas.getBoundingClientRect().width;
          broken.push({
            word: word.length > 44 ? word.slice(0, 44) + '…' : word,
            parts: rects.length,
            cellW: Math.round(td.clientWidth),
            avail: Math.round(avail),
            natural: Math.round(natural),
            unavoidable: natural > avail,
            inCode: !!tn.parentElement && !!tn.parentElement.closest('code'),
          });
        }
      }
    }
  }
  meas.remove();
  const wraps = Array.from(document.querySelectorAll('.table-wrap')).map((w) => ({
    scrollW: w.scrollWidth, clientW: w.clientWidth, over: Math.max(0, w.scrollWidth - w.clientWidth),
  }));
  return {
    cells: cells.length,
    brokenWords: broken.length,
    brokenInCode: broken.filter((b) => b.inCode).length,
    avoidable: broken.filter((b) => !b.unavoidable).length,
    unavoidable: broken.filter((b) => b.unavoidable).length,
    samples: broken.slice(0, 12),
    wrapsOverflowing: wraps.filter((w) => w.over > 0).length,
    wraps: wraps.slice(0, 20),
    vw: window.innerWidth,
  };
};

// P2-3：筛选项吸顶 —— 滚到 5000px 后 filter-bar 是否仍在视口内
// 注意：html{scroll-behavior:smooth} 会让 window.scrollTo 变成动画，测量必须用
// behavior:'instant'，否则读到的是滚动前的几何（首版探针就栽在这）。
const M_FILTERBAR = () => {
  const fb = document.querySelector('.filter-bar');
  if (!fb) return { found: false };
  const target = Math.min(5000, document.documentElement.scrollHeight - window.innerHeight - 1);
  window.scrollTo({ top: target, left: 0, behavior: 'instant' });
  const r = fb.getBoundingClientRect();
  const cs = getComputedStyle(fb);
  const probeY = Math.round(Math.max(r.top + Math.min(r.height / 2, 12), 4));
  const hit = document.elementFromPoint(Math.round(r.left + Math.min(60, r.width / 2)), probeY);
  return {
    found: true,
    position: cs.position,
    top: cs.top,
    zIndex: cs.zIndex,
    rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) },
    scrollY: Math.round(window.scrollY),
    requestedScroll: 5000,
    scrollReached: Math.abs(window.scrollY - 5000) < 2,
    docH: Math.round(document.documentElement.scrollHeight),
    inViewport: r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.height > 0,
    // 吸顶后被正文盖住吗（命中测试是否仍是 filter-bar 的子孙）
    topIsSelf: !!(hit && (hit === fb || fb.contains(hit))),
    hitCls: hit ? (hit.className || hit.tagName).toString().slice(0, 40) : null,
  };
};

// P2-4：桌面 TOC 当前项 aria-current + 层级缩进
const M_TOC = () => {
  const side = document.querySelector('.toc-side');
  const links = Array.from(document.querySelectorAll('.toc-side a[href^="#"]'));
  const linksWithAria = links.filter((a) => a.hasAttribute('aria-current'));
  const inDocAriaCurrent = Array.from(document.querySelectorAll('[aria-current]')).map((e) => ({
    tag: e.tagName, cls: (e.className || '').toString().slice(0, 48),
    val: e.getAttribute('aria-current'), text: (e.textContent || '').trim().slice(0, 30),
  }));
  const pad = {};
  for (const lvl of [2, 3, 4]) {
    const li = document.querySelector('.toc-side li.lvl-' + lvl);
    pad['lvl' + lvl] = li ? parseFloat(getComputedStyle(li).paddingLeft) : null;
  }
  const active = document.querySelector('.toc-side a.active, .toc-side a[aria-current]');
  return {
    hasSide: !!side,
    linkCount: links.length,
    linksWithAriaCurrent: linksWithAria.length,
    ariaCurrentValues: linksWithAria.map((a) => a.getAttribute('aria-current')),
    ariaCurrentTotalInDoc: inDocAriaCurrent.length,
    ariaCurrentAll: inDocAriaCurrent,
    activeText: active ? (active.textContent || '').trim().slice(0, 40) : null,
    activeIsAria: active ? active.hasAttribute('aria-current') : null,
    levelPadding: pad,
  };
};

// ▸：侧栏 summary 的 ::before 三角实现方式（文字 vs border）+ 可访问名
const M_TRI = () => {
  const sums = Array.from(document.querySelectorAll('summary.side-section-title, .side-cat>summary, .side-group-title, .side-toc-title, .toc-title'));
  return sums.slice(0, 400).map((s) => {
    const cs = getComputedStyle(s, '::before');
    return {
      cls: (s.className || '').toString().slice(0, 40),
      content: cs.content,
      borderLeftWidth: cs.borderLeftWidth,
      borderTopWidth: cs.borderTopWidth,
      w: cs.width, h: cs.height,
    };
  });
};

// P1-6：侧栏组名 pill 是否被截断（scrollWidth > clientWidth ⇒ ellipsis 生效）
const M_PILL = () => {
  const names = Array.from(document.querySelectorAll('.side-group-title .grp-name'));
  const rows = names.map((n) => {
    const zh = n.parentElement ? n.parentElement.querySelector('.grp-zh') : null;
    const cnt = n.parentElement ? n.parentElement.querySelector('.side-count') : null;
    const home = n.parentElement ? n.parentElement.querySelector('.side-home') : null;
    return {
      text: (n.textContent || '').trim(),
      clientW: Math.round(n.clientWidth),
      scrollW: Math.round(n.scrollWidth),
      truncated: n.scrollWidth > n.clientWidth + 1,
      // flex 收缩证据
      flex: getComputedStyle(n).flex,
      minWidth: getComputedStyle(n).minWidth,
      zhFs: zh ? parseFloat(getComputedStyle(zh).fontSize) : null,
      zhW: zh ? Math.round(zh.getBoundingClientRect().width) : null,
      homeW: home ? Math.round(home.getBoundingClientRect().width) : null,
      cntW: cnt ? Math.round(cnt.getBoundingClientRect().width) : null,
    };
  });
  return {
    pills: rows.length,
    truncated: rows.filter((r) => r.truncated).length,
    truncatedList: rows.filter((r) => r.truncated).slice(0, 12),
    sample: rows.slice(0, 3),
  };
};

// 回归1：横向溢出
const M_OVERFLOW = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  return {
    vw,
    docScrollW: de.scrollWidth,
    total: Math.max(0, de.scrollWidth - vw),
    bodyScrollW: document.body.scrollWidth,
  };
};

// 回归2：桌面 TOC 是否仍 sticky
const M_TOCSTICKY = () => {
  const side = document.querySelector('.toc-side');
  if (!side) return { found: false, hasToc: false };
  const cs = getComputedStyle(side);
  const before = side.getBoundingClientRect();
  window.scrollTo({ top: 900, left: 0, behavior: 'instant' });
  const after = side.getBoundingClientRect();
  return {
    found: true,
    hasToc: true,
    position: cs.position,
    top: cs.top,
    maxHeight: cs.maxHeight,
    overflowY: cs.overflowY,
    beforeTop: Math.round(before.top), afterTop: Math.round(after.top),
    // sticky 的判据：滚动后 top 保持（不随文档滚走）
    stayed: Math.abs(after.top - before.top) < 3,
    scrollY: Math.round(window.scrollY),
    vh: window.innerHeight,
    docH: Math.round(document.documentElement.scrollHeight),
  };
};

/* ---------- 驱动 ---------- */
(async () => {
  if (!EXE) { console.error('no chrome executable found'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function withPage(vp, rel, fn, opts = {}) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: !!opts.isMobile, hasTouch: !!opts.hasTouch });
    const page = await ctx.newPage();
    await page.goto(BASE + rel, { waitUntil: 'load' });
    await page.waitForTimeout(opts.wait || 350);
    try { return await fn(page, ctx); } finally { await ctx.close(); }
  }

  /* ===== P2-1 h5 字号（1440 桌面档，cli-arguments 是主战场） ===== */
  {
    const rows = [];
    for (const [name, rel] of PAGES) {
      const r = await withPage({ width: 1440, height: 900 }, rel, (p) => p.evaluate(M_H5));
      rows.push({ page: name, rel, ...r });
    }
    // 全站 h5 计数由 c5-static.js 提供，这里再对 390 档复测一次（移动端不应更小）
    const narrow = await withPage({ width: 390, height: 844 }, '/paper/reference/cli-arguments/index.html', (p) => p.evaluate(M_H5), { isMobile: true, hasTouch: true });
    out.p21 = {
      pages: rows,
      totalH5Sampled: rows.reduce((s, r) => s + r.count, 0),
      mainPage: rows.find((r) => r.page === 'cliargs'),
      narrow,
    };
    process.stderr.write('P2-1 done; cliargs count=' + (out.p21.mainPage.count) + ' min=' + out.p21.mainPage.min + ' bodyFs=' + out.p21.mainPage.bodyFs + '\n');
  }

  /* ===== P2-2 320px 词中断（全站 18 个含表页，取表格最多的几页 + 全站抽样） ===== */
  {
    const staticInfo = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', '.c5-static.json'), 'utf8')); } catch { return null; }
    })();
    // 取含表页里 wraps 最多的前若干页；320 是最窄档
    const tablePages = (staticInfo && staticInfo.tables ? staticInfo.tables.slice() : [])
      .sort((a, b) => b.wraps - a.wraps).slice(0, 8).map((t) => t.page);
    const list = tablePages.length ? tablePages : ['paper/reference/cli-arguments/index.html'];
    const rows = [];
    for (const rel of list) {
      const r = await withPage({ width: 320, height: 720 }, '/' + rel, (p) => p.evaluate(M_WRAP), { isMobile: true, hasTouch: true, wait: 450 });
      rows.push({ page: rel, ...r });
    }
    out.p22 = {
      vp: '320x720',
      pagesProbed: rows.length,
      rows,
      totalBrokenWords: rows.reduce((s, r) => s + r.brokenWords, 0),
      totalAvoidable: rows.reduce((s, r) => s + r.avoidable, 0),
      totalUnavoidable: rows.reduce((s, r) => s + r.unavoidable, 0),
      totalInCode: rows.reduce((s, r) => s + r.brokenInCode, 0),
      totalCells: rows.reduce((s, r) => s + r.cells, 0),
      perPageMax: rows.reduce((m, r) => Math.max(m, r.brokenWords), 0),
    };
    process.stderr.write('P2-2 done; broken=' + out.p22.totalBrokenWords + ' avoidable=' + out.p22.totalAvoidable +
      ' unavoidable=' + out.p22.totalUnavoidable + ' cells=' + out.p22.totalCells + ' pages=' + rows.length + '\n');
  }

  /* ===== P2-3 all-pages.html 筛选框吸顶 ===== */
  {
    const r = await withPage({ width: 1440, height: 900 }, '/all-pages.html', (p) => p.evaluate(M_FILTERBAR), { wait: 500 });
    const r320 = await withPage({ width: 390, height: 844 }, '/all-pages.html', (p) => p.evaluate(M_FILTERBAR), { isMobile: true, hasTouch: true, wait: 500 });
    out.p23 = { desktop: r, mobile: r320 };
    process.stderr.write('P2-3 done; pos=' + r.position + ' inViewport=' + r.inViewport + ' topIsSelf=' + r.topIsSelf + '\n');
  }

  /* ===== P2-4 桌面 TOC aria-current + 层级缩进 =====
     注意：cli-arguments 页**没有 TOC**（它只有 h5，正是 P2-1 要修的层级倒置），
     所以 aria-current 必须在一份真有 h2-h3 目录的页面上量。 */
  {
    const tocPages = [
      ['dialogs', '/paper/dev/dialogs/index.html'],
      ['tuning', '/velocity/tuning/index.html'],
      ['permissions', '/paper/reference/permissions/index.html'],
    ];
    const perPage = [];
    for (const [name, rel] of tocPages) {
      const init = await withPage({ width: 1440, height: 900 }, rel, (p) => p.evaluate(M_TOC), { wait: 700 });
      const scrolled = await withPage({ width: 1440, height: 900 }, rel, async (p) => {
        const res = [];
        for (const frac of [0.25, 0.55, 0.85]) {
          await p.evaluate((f) => {
            const h = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo({ top: Math.round(h * f), left: 0, behavior: 'instant' });
          }, frac);
          await p.waitForTimeout(700);
          res.push({ frac, ...(await p.evaluate(M_TOC)) });
        }
        return res;
      }, { wait: 700 });
      perPage.push({ page: name, rel, init, scrolled });
      process.stderr.write('P2-4 ' + name + ' aria init=' + init.linksWithAriaCurrent + '/' + init.linkCount +
        ' scrolled=' + scrolled.map((s) => s.linksWithAriaCurrent).join('/') + '\n');
    }
    out.p24 = { pages: perPage, primary: perPage[0] };
    process.stderr.write('P2-4 done; primary init=' + perPage[0].init.linksWithAriaCurrent +
      '/' + perPage[0].init.linkCount + ' pad=' + JSON.stringify(perPage[0].init.levelPadding) + '\n');
  }

  /* ===== 侧栏 ▸ ===== */
  {
    const rel = '/paper/dev/dialogs/index.html';
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(BASE + rel, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.evaluate(() => { document.querySelectorAll('.sidebar details').forEach((d) => { d.open = true; }); });
    await page.waitForTimeout(350);
    const styles = await page.evaluate(M_TRI);
    // 逐个 summary 取 computed 的 AX 名（用 element.getAttribute + 文本兜底），再用 CDP 取真正的 AX 树
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const pick = (role) => nodes.filter((n) => n.role && n.role.value === role)
      .map((n) => ({ name: n.name ? n.name.value : null }));
    const discl = pick('DisclosureTriangle');
    const triChar = /[\u25b8\u25b6\u25be\u25bc]/;
    const namesWithTri = discl.filter((d) => d.name && triChar.test(d.name));
    // 展开按钮（details 的 summary 在 Chromium 里 role=DisclosureTriangle）
    const btnNames = (() => { const b = pick('button'); const g = pick('group'); return { buttons: b, groups: g }; })();
    const allNames = nodes.filter((n) => n.name && n.name.value && triChar.test(n.name.value))
      .map((n) => ({ role: n.role ? n.role.value : null, name: n.name.value.slice(0, 60) }));
    out.triangles = {
      summariesStyled: styles.length,
      stillLiteralContent: styles.filter((s) => s.content && triChar.test(s.content)).length,
      borderBased: styles.filter((s) => !triChar.test(s.content || '') && parseFloat(s.borderLeftWidth) > 0).length,
      contentSamples: Array.from(new Set(styles.map((s) => s.content))).slice(0, 8),
      disclosureCount: discl.length,
      axNamesWithTriangle: namesWithTri.length,
      axNameSamples: namesWithTri.slice(0, 10),
      allAxNamesWithTriangle: allNames.slice(0, 10),
      buttonCount: btnNames.buttons.length,
    };
    // 再测抽屉（移动端）里的 ▸
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const b = document.querySelector('#nav-toggle'); if (b) b.click(); });
    await page.waitForTimeout(500);
    const cdp2 = await ctx.newCDPSession(page);
    await cdp2.send('Accessibility.enable');
    const { nodes: n2 } = await cdp2.send('Accessibility.getFullAXTree');
    const names2 = n2.filter((n) => n.name && n.name.value && triChar.test(n.name.value))
      .map((n) => ({ role: n.role ? n.role.value : null, name: n.name.value.slice(0, 60) }));
    out.triangles.mobileAxNamesWithTriangle = names2.length;
    out.triangles.mobileSamples = names2.slice(0, 8);
    const mobStyles = await page.evaluate(M_TRI);
    out.triangles.mobileLiteralContent = mobStyles.filter((s) => s.content && triChar.test(s.content)).length;
    await ctx.close();
    process.stderr.write('TRI done; literal=' + out.triangles.stillLiteralContent + ' axTri=' + out.triangles.axNamesWithTriangle +
      ' mobileTri=' + out.triangles.mobileAxNamesWithTriangle + '\n');
  }

  /* ===== P1-6 组名 pill 截断（侧栏需要展开才能量到全部 pill） ===== */
  {
    const rel = '/paper/dev/dialogs/index.html';
    const r = await withPage({ width: 1440, height: 900 }, rel, async (p) => {
      // 先把所有 details 展开，确保 pill 都有布局宽度
      await p.evaluate(() => {
        document.querySelectorAll('details').forEach((d) => { d.open = true; });
      });
      await p.waitForTimeout(450);
      return p.evaluate(M_PILL);
    }, { wait: 600 });
    out.p16 = r;
    process.stderr.write('P1-6 done; pills=' + r.pills + ' truncated=' + r.truncated + '\n');
  }

  /* ===== 回归1：横向溢出 8 档 × 6 页 ===== */
  {
    const rows = [];
    for (const vw of VP_OVERFLOW) {
      for (const [name, rel] of PAGES) {
        const vp = { width: vw, height: vw <= 390 ? 844 : (vw <= 768 ? 1024 : 900) };
        const r = await withPage(vp, rel, (p) => p.evaluate(M_OVERFLOW), { isMobile: vw <= 768, hasTouch: vw <= 768, wait: 300 });
        rows.push({ vw, page: name, ...r });
      }
      process.stderr.write('overflow vp ' + vw + ' done\n');
    }
    out.overflow = {
      cells: rows.length,
      nonZero: rows.filter((r) => r.total > 0),
      maxTotal: rows.reduce((m, r) => Math.max(m, r.total), 0),
      rows,
    };
  }

  /* ===== 回归2：桌面 TOC 仍 sticky（1025/1280/1440/1920） ===== */
  {
    const rows = [];
    for (const vw of [1025, 1280, 1440, 1920]) {
      const r = await withPage({ width: vw, height: 900 }, '/paper/dev/dialogs/index.html', (p) => p.evaluate(M_TOCSTICKY), { wait: 700 });
      rows.push({ vw, ...r });
    }
    out.tocSticky = { page: 'paper/dev/dialogs/index.html', rows, allSticky: rows.every((r) => r.found && r.stayed) };
    process.stderr.write('TOCSTICKY done; ' + rows.map((r) => r.vw + ':' + r.position + '/' + r.stayed).join(' ') + '\n');
  }

  await browser.close();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  console.log('wrote ' + OUT_JSON);
  console.log(JSON.stringify({
    tag: TAG,
    p21_cliargs: { count: out.p21.mainPage.count, min: out.p21.mainPage.min, bodyFs: out.p21.mainPage.bodyFs },
    p22_broken: out.p22.totalBrokenWords, p22_avoidable: out.p22.totalAvoidable,
    p22_unavoidable: out.p22.totalUnavoidable, p22_cells: out.p22.totalCells, p22_pages: out.p22.pagesProbed,
    p23: { pos: out.p23.desktop.position, inViewport: out.p23.desktop.inViewport, topIsSelf: out.p23.desktop.topIsSelf, top: out.p23.desktop.rect && out.p23.desktop.rect.top, reached: out.p23.desktop.scrollReached },
    p24: {
      pages: out.p24.pages.map((p) => ({ page: p.page, tocLinks: p.init.linkCount, initAria: p.init.linksWithAriaCurrent, scrolled: p.scrolled.map((s) => s.linksWithAriaCurrent), docAria: p.init.ariaCurrentTotalInDoc })),
      pad: out.p24.primary.init.levelPadding,
    },
    triangles: { literal: out.triangles.stillLiteralContent, axTri: out.triangles.axNamesWithTriangle, mobileTri: out.triangles.mobileAxNamesWithTriangle },
    p16: { pills: out.p16.pills, truncated: out.p16.truncated },
    overflow: { cells: out.overflow.cells, nonZero: out.overflow.nonZero.length, max: out.overflow.maxTotal },
    tocSticky: { all: out.tocSticky.allSticky, rows: out.tocSticky.rows.map((r) => ({ vw: r.vw, pos: r.position, stayed: r.stayed, hasToc: r.hasToc })) },
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
