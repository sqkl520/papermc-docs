'use strict';
/**
 * cr2ia-gates.js — 删除安全性论证所需的最后取证
 *  a. /paper/ 分区页主内容的真实构成（是否还有一份树）
 *  b. 侧栏对 141 页的覆盖（侧栏是否是内容的完备入口）
 *  c. 到最深页面的点击成本
 *  d. 门禁脚本对首页区块的断言强度（删区块会不会挂门禁）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'cr2ia');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

// ---- d. 门禁纯文本扫描（不运行门禁）----
const gateFiles = ['tools/check-site.js', 'tools/verify-site.js', 'tools/validate.js', 'tools/privacy-scan.js'];
const needles = ['src-tree', 'class="stat"', 'entry-card', 'quickbar', 'cat-anchorbar', '目录结构', '按主题浏览', '关于本站', 'sections/', 'snapshots.html', 'all-pages.html', 'index.html'];
const gate = {};
for (const f of gateFiles) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const lines = s.split('\n');
  gate[f] = {};
  for (const n of needles) {
    const hits = [];
    lines.forEach((ln, i) => { if (ln.includes(n)) hits.push(i + 1); });
    gate[f][n] = hits;
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const R = { gate };

  // a. /paper/ 主内容构成
  await page.goto(BASE + '/paper/', { waitUntil: 'load' }); await page.waitForTimeout(400);
  R.paperSection = await page.evaluate(() => {
    const main = document.querySelector('#main');
    const blocks = [...main.children].filter((e) => e.getBoundingClientRect().height >= 2).map((e) => ({
      tag: e.tagName.toLowerCase(), cls: (e.className || '').toString().split(' ')[0],
      h: Math.round(e.getBoundingClientRect().height),
      a: e.querySelectorAll('a[href]').length,
      head: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    }));
    return {
      docH: Math.round(document.documentElement.scrollHeight),
      blocks,
      catBlocks: document.querySelectorAll('.cat-block').length,
      catLinks: document.querySelectorAll('.cat-links a').length,
      srcTree: document.querySelectorAll('.src-tree').length,
      mainUniq: new Set([...document.querySelectorAll('#main a[href]')].map((a) => a.getAttribute('href'))).size,
    };
  });

  // b. 侧栏覆盖 vs 全站 141 页
  //    从 all-pages 表拿到全部页面 href，再与侧栏链接集合比对
  await page.goto(BASE + '/all-pages.html', { waitUntil: 'load' }); await page.waitForTimeout(400);
  R.coverage = await page.evaluate(() => {
    const norm = (h) => {
      const u = new URL(h, location.href);
      let p = u.pathname;
      if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      return p;
    };
    const pages = new Set([...document.querySelectorAll('table.allpages tbody tr td.lnk a')].map((a) => norm(a.getAttribute('href'))));
    const side = new Set([...document.querySelectorAll('#sidebar a[href]')].map((a) => norm(a.getAttribute('href'))));
    const catMain = new Set([...document.querySelectorAll('#main .cat-links a, #main .tax-list a')].map((a) => norm(a.getAttribute('href'))));
    const missing = [...pages].filter((p) => !side.has(p));
    return {
      pages: pages.size,
      side: side.size,
      missingFromSidebar: missing.length,
      missingSample: missing.slice(0, 10),
      sideCoversAll: missing.length === 0,
      categoryLinksOnPage: catMain.size,
    };
  });

  // c. 点击/滚动成本：到最深页面
  R.cost = {};
  for (const [name, url] of [['landing', '/'], ['dialogs', '/paper/dev/dialogs/'], ['basics', '/paper/dev/command-api/basics/introduction/']]) {
    await page.goto(BASE + url, { waitUntil: 'load' }); await page.waitForTimeout(400);
    R.cost[name] = await page.evaluate(() => {
      const s = document.querySelector('#sidebar');
      const act = s.querySelector('a[aria-current="page"]');
      const out = { scrollH: s.scrollHeight, clientH: s.clientHeight, docH: Math.round(document.documentElement.scrollHeight) };
      if (act) {
        const r = s.getBoundingClientRect();
        // 先记下 act 相对 sidebar 滚动内容的偏移
        const off = act.getBoundingClientRect().top - r.top + s.scrollTop;
        out.activeText = (act.textContent || '').trim().slice(0, 40);
        out.activeOffsetInSidebar = Math.round(off);
        out.needsSidebarScroll = off > s.scrollHeight - s.clientHeight + 5 ? 'beyond' : 'within';
        out.pagesOfSidebarScroll = Math.round((s.scrollHeight / s.clientHeight) * 10) / 10;
        // 侧栏里该 link 所处 details 嵌套层数
        let d = 0, n = act;
        while (n && n !== s) { if (n.tagName === 'DETAILS') d++; n = n.parentElement; }
        out.detailsNest = d;
        // 从侧栏第一条到该条之间有多少条链接（线性扫描成本）
        const links = [...s.querySelectorAll('a[href]')];
        const vis = links.filter((a) => a.checkVisibility && a.checkVisibility());
        out.positionInVisibleList = vis.indexOf(act);
        out.visibleCount = vis.length;
      } else {
        out.activeText = null;
        const vis = [...s.querySelectorAll('a[href]')].filter((a) => a.checkVisibility && a.checkVisibility());
        out.visibleCount = vis.length;
      }
      return out;
    });
  }

  // e. 首页区块的 <details> 折叠成本（首页树是否可折叠）
  await page.goto(BASE + '/', { waitUntil: 'load' }); await page.waitForTimeout(300);
  R.landingDetails = await page.evaluate(() => {
    const main = document.querySelector('#main');
    return {
      detailsInMain: main.querySelectorAll('details').length,
      treeBlocks: main.querySelectorAll('.src-tree').length,
      treeHeight: Math.round([...main.querySelectorAll('.src-tree')].reduce((n, e) => n + e.getBoundingClientRect().height, 0)),
      mainHeight: Math.round(main.getBoundingClientRect().height),
      pageHeight: Math.round(document.documentElement.scrollHeight),
      firstContentBelowTreeY: (() => {
        const tax = document.querySelector('#tax');
        return tax ? Math.round(tax.getBoundingClientRect().top + window.scrollY) : null;
      })(),
      // 折叠线：首屏 900，落到 .src-tree 之后要到多少屏
      treeStartY: (() => { const t = main.querySelector('.src-tree'); return t ? Math.round(t.getBoundingClientRect().top + window.scrollY) : null; })(),
      treeEndY: (() => { const t = [...main.querySelectorAll('.src-tree')].pop(); return t ? Math.round(t.getBoundingClientRect().bottom + window.scrollY) : null; })(),
      // 9 张统计卡的总高 / 是否在首屏
      statsRect: (() => { const s = main.querySelector('.stats'); if (!s) return null; const r = s.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY), h: Math.round(r.height) }; })(),
      entryRect: (() => { const s = main.querySelector('.entry-cards'); if (!s) return null; const r = s.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY), h: Math.round(r.height) }; })(),
      heroRect: (() => { const s = main.querySelector('.hero'); if (!s) return null; const r = s.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY), h: Math.round(r.height) }; })(),
      quickbarRect: (() => { const s = main.querySelector('.quickbar'); if (!s) return null; const r = s.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY), h: Math.round(r.height) }; })(),
    };
  });

  fs.writeFileSync(path.join(OUT, 'gates.json'), JSON.stringify(R, null, 2), 'utf8');

  const L = [];
  L.push('== a. /paper/ SECTION PAGE ==');
  L.push('docH=' + R.paperSection.docH + ' srcTree=' + R.paperSection.srcTree + ' catBlocks=' + R.paperSection.catBlocks + ' catLinks=' + R.paperSection.catLinks);
  for (const b of R.paperSection.blocks) L.push('   +' + String(b.h).padStart(5) + ' ' + (b.tag + '.' + b.cls).padEnd(20) + ' a=' + String(b.a).padStart(3) + ' ' + b.head);
  L.push('');
  L.push('== b. SIDEBAR COVERAGE == ' + JSON.stringify(R.coverage));
  L.push('');
  L.push('== c. COST ==');
  for (const k of Object.keys(R.cost)) L.push(k + ' ' + JSON.stringify(R.cost[k]));
  L.push('');
  L.push('== e. LANDING BLOCK GEOMETRY ==');
  L.push(JSON.stringify(R.landingDetails, null, 1));
  L.push('');
  L.push('== d. GATE ANCHORS (line numbers) ==');
  for (const f of Object.keys(R.gate)) {
    const hits = Object.entries(R.gate[f]).filter(([, v]) => v.length).map(([k, v]) => k + '@' + v.slice(0, 6).join(','));
    L.push(f + ': ' + (hits.join('  ') || '(none)'));
  }
  const txt = L.join('\n');
  fs.writeFileSync(path.join(OUT, 'gates.txt'), txt, 'utf8');
  console.log(txt);
  await browser.close();
})();
