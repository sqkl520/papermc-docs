'use strict';
/**
 * cr2cp-deep.js — 补充实测：侧栏构成 / 抽屉目录可达性 / 首屏导航占比 / TOC 初始态 /
 * 全站「无标题长块」统计（静态）+ 长页「回到顶部」抓手。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cheerio = require('cheerio');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'cr2cp');
fs.mkdirSync(OUT, { recursive: true });
const NEW = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

// ---------------- 静态：全站无标题长块 + 侧栏构成 ----------------
const files = [];
for (const s of ['paper', 'velocity', 'folia']) {
  const d = path.join(ROOT, s);
  if (!fs.existsSync(d)) continue;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'index.html') files.push(p);
    }
  })(d);
}

const NOHEAD = 834; // 任务给定的阈值
const deep = [];
for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const $ = cheerio.load(fs.readFileSync(abs, 'utf8'));
  const art = $('article.article').first();
  if (!art.length) continue;

  // 无 h2-h6 分隔的连续正文块（按字符）
  const runs = [];
  let run = 0; let startTag = null;
  art.children().each((i, el) => {
    const tag = (el.tagName || '').toLowerCase();
    if (/^h[2-6]$/.test(tag)) {
      if (run > NOHEAD) runs.push(run);
      run = 0;
    } else {
      run += $(el).text().replace(/\s+/g, ' ').trim().length;
    }
  });
  if (run > NOHEAD) runs.push(run);

  // 侧栏：属于当前 section 的链接 vs 其他 section
  const sec = rel.split('/')[0];
  const side = $('.sidebar');
  const sideAll = side.find('a[href]').length;
  // 侧栏每个 .side-sec 段
  const secCounts = {};
  side.find('.side-sec').each((i, el) => {
    const name = $(el).find('.sec-name').first().text().trim();
    secCounts[name] = $(el).find('a[href]').length;
  });
  const groupOpen = side.find('details.side-group[open]').length;
  const groupTotal = side.find('details.side-group').length;
  const secFoldOpen = side.find('details.side-sec[open]').length;
  // 「按主题浏览（自定义）」
  const customCats = side.find('.side-cat a').length;

  deep.push({
    rel, section: sec,
    contentChars: art.text().replace(/\s+/g, ' ').trim().length,
    runs, maxRun: runs.length ? Math.max(...runs) : 0, runCount: runs.length,
    h2to6: art.find('h2,h3,h4,h5,h6').length,
    sideAll, secCounts, groupOpen, groupTotal, secFoldOpen, customCats,
    hasToc: $('.toc-side').length > 0,
  });
}

const withLongNohead = deep.filter((r) => r.runCount > 0);
const worst = [...deep].sort((a, b) => b.maxRun - a.maxRun);
const summary = {
  pages: deep.length,
  pagesWithNohead834: withLongNohead.length,
  pctNohead: +(withLongNohead.length / deep.length * 100).toFixed(1),
  totalNoheadRuns: deep.reduce((n, r) => n + r.runCount, 0),
  maxRun: worst[0] ? { rel: worst[0].rel, maxRun: worst[0].maxRun, chars: worst[0].contentChars } : null,
  sideAllMax: Math.max(...deep.map((r) => r.sideAll)),
  sideAllMin: Math.min(...deep.map((r) => r.sideAll)),
  sideAllAvg: Math.round(deep.reduce((n, r) => n + r.sideAll, 0) / deep.length),
  customCatLinks: deep[0] ? deep[0].customCats : 0,
  groupTotalSample: deep.find((r) => r.rel.indexOf('dialogs') >= 0),
  secCountSample: deep.find((r) => r.rel.indexOf('dialogs') >= 0).secCounts,
  pagesNoTocWithLongText: deep.filter((r) => !r.hasToc && r.contentChars > 4000).map((r) => ({ rel: r.rel, chars: r.contentChars, h2to6: r.h2to6 })),
};

// ---------------- 浏览器：抽屉目录 + 首屏导航 + TOC 初始态 ----------------
const DRAWER = () => {
  const inViewX = (r) => r.left >= -1 && r.left < window.innerWidth;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
  const vh = window.innerHeight;
  const links = [...document.querySelectorAll('a[href]')].filter((e) => { const r = e.getBoundingClientRect(); return vis(e) && r.top < vh && r.bottom > 0 && inViewX(r); });
  const navLinks = links.filter((e) => e.closest('.topbar,.sidebar,nav.crumbs,.toc-side,nav.pager,.side-cat'));
  const contentLinks = links.filter((e) => e.closest('article') && !e.closest('.crumbs,.pager,.toc-side'));
  return {
    vh,
    linksFirstScreen: links.length,
    navLinksFirstScreen: navLinks.length,
    contentLinksFirstScreen: contentLinks.length,
    navLinkTexts: navLinks.slice(0, 22).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22)),
    firstScreenContentShare: +(contentLinks.length / Math.max(1, links.length)).toFixed(2),
  };
};

const DRAWER_OPEN = () => {
  const sb = document.querySelector('.sidebar');
  const tb = document.querySelector('[data-drawer-toc]');
  const r = sb ? sb.getBoundingClientRect() : null;
  const tr = tb ? tb.getBoundingClientRect() : null;
  const sum = tb ? tb.querySelector('summary') : null;
  const h1 = document.querySelector('article h1,.page-head h1');
  return {
    vh: window.innerHeight,
    sidebarRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    sidebarScrollTop: sb ? sb.scrollTop : null,
    drawerTocY: tr ? Math.round(tr.top) : null,
    drawerTocH: tr ? Math.round(tr.height) : null,
    drawerTocOpen: tb ? tb.hasAttribute('open') : null,
    drawerTocTitle: sum ? sum.textContent.replace(/\s+/g, ' ').trim() : null,
    drawerTocVisibleInViewport: tr ? (tr.top >= 0 && tr.top < window.innerHeight) : false,
    // 抽屉滚到哪了
    firstVisibleItem: (() => {
      if (!sb) return null;
      const items = [...sb.querySelectorAll('a[href]')].filter((e) => { const b = e.getBoundingClientRect(); return b.top >= 50 && b.top < window.innerHeight; });
      return items[0] ? items[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : null;
    })(),
    activeItem: (() => { const a = sb && sb.querySelector('a.active,[aria-current="page"]'); return a ? a.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : null; })(),
    activeItemY: (() => { const a = sb && sb.querySelector('a.active,[aria-current="page"]'); if (!a) return null; return Math.round(a.getBoundingClientRect().top); })(),
    h1Y: h1 ? Math.round(h1.getBoundingClientRect().top + window.scrollY) : null,
  };
};

async function run() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const live = {};

  // 1) 390 抽屉：全新打开（未滚动页面）
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(350);
    live.mobileFirstScreen = await page.evaluate(DRAWER);
    live.drawerClosedState = await page.evaluate(() => {
      const tb = document.querySelector('[data-drawer-toc]');
      return { present: !!tb, open: tb ? tb.hasAttribute('open') : null };
    });
    await page.click('#nav-toggle');
    await page.waitForTimeout(500);
    live.drawerFresh = await page.evaluate(DRAWER_OPEN);
    // 抽屉里「本页目录」是否要滚才看得到：滚到顶看看
    await page.evaluate(() => { const sb = document.querySelector('.sidebar'); if (sb) sb.scrollTop = 0; });
    await page.waitForTimeout(200);
    live.drawerAtTop = await page.evaluate(DRAWER_OPEN);
    await ctx.close();
  }

  // 2) TOC 初始（scrollY=0）是否高亮
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(700);
    live.tocInitial = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      active: [...document.querySelectorAll('.toc-side a.active')].map((a) => a.textContent.trim()),
      activeCount: document.querySelectorAll('.toc-side a.active').length,
      // 首个 h2 是否在首屏
      firstH2Y: (() => { const h = document.querySelector('article h2'); return h ? Math.round(h.getBoundingClientRect().top) : null; })(),
      firstH2Text: (() => { const h = document.querySelector('article h2'); return h ? h.textContent.replace(/#$/, '').trim() : null; })(),
    }));
    // 滚到第一个 h2 附近再测
    await page.evaluate(() => { const h = document.querySelector('article h2'); if (h) window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 40); });
    await page.waitForTimeout(700);
    live.tocAtFirstH2 = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      active: [...document.querySelectorAll('.toc-side a.active')].map((a) => a.textContent.trim()),
    }));

    // 3) 长页抓手：world-configuration 中段与末段，记录可见的粘性元素
    await page.goto(NEW + '/paper/reference/world-configuration/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    live.longPage = await page.evaluate(() => {
      const vh = window.innerHeight;
      const doc = document.scrollingElement || document.documentElement;
      const absY = (el) => el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
      return {
        docH: Math.round(doc.scrollHeight),
        h1: absY(document.querySelector('article h1')),
        toc: !!document.querySelector('.toc-side'),
        pager: absY(document.querySelector('nav.pager')),
        footer: absY(document.querySelector('.page-footer')),
        headingsInArticle: document.querySelectorAll('article h2,article h3,article h4').length,
        anchors: document.querySelectorAll('a.heading-anchor').length,
        backToTopCandidates: [...document.querySelectorAll('a,button')].filter((e) => /顶部|回到|↑|top/i.test(e.textContent || '')).map((e) => (e.textContent || '').trim().slice(0, 20)),
        stickyEls: [...document.querySelectorAll('*')].filter((e) => {
          const cs = getComputedStyle(e);
          return (cs.position === 'sticky' || cs.position === 'fixed') && e.getBoundingClientRect().height > 0;
        }).map((e) => ({ tag: e.tagName.toLowerCase(), cls: (e.getAttribute('class') || '').slice(0, 30), h: Math.round(e.getBoundingClientRect().height) })),
        // 正文里可点的链接数 vs 纯文本
        articleLinks: document.querySelectorAll('article a[href]').length,
      };
    });

    // 4) 长页滚到 50%：还剩哪些抓手
    await page.evaluate(() => { const d = document.scrollingElement || document.documentElement; window.scrollTo(0, Math.round(d.scrollHeight * 0.5)); });
    await page.waitForTimeout(400);
    live.longPageMid = await page.evaluate(() => {
      const vh = window.innerHeight;
      const visible = [...document.querySelectorAll('a,button,summary')].filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.height > 0 && r.top >= 0 && r.top < vh && cs.visibility !== 'hidden';
      });
      return {
        scrollY: Math.round(window.scrollY),
        visibleControls: visible.length,
        byKind: visible.reduce((m, e) => {
          const k = e.closest('.topbar') ? 'topbar' : e.closest('.sidebar') ? 'sidebar' : e.closest('.toc-side') ? 'toc'
            : e.closest('nav.pager') ? 'pager' : e.closest('article') ? 'article-inline' : 'other';
          m[k] = (m[k] || 0) + 1; return m;
        }, {}),
      };
    });
    await ctx.close();
  }

  // 5) 320 档：长页首屏
  {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/reference/world-configuration/', { waitUntil: 'load' });
    await page.waitForTimeout(350);
    live.mobile320Long = await page.evaluate(DRAWER);
    live.mobile320Toc = await page.evaluate(() => ({
      tocPresent: !!document.querySelector('.toc-side'),
      drawerTocPresent: !!document.querySelector('[data-drawer-toc]'),
      h1Y: (() => { const h = document.querySelector('article h1,.page-head h1'); return h ? Math.round(h.getBoundingClientRect().top + window.scrollY) : null; })(),
      docH: Math.round((document.scrollingElement || document.documentElement).scrollHeight),
    }));
    await ctx.close();
  }

  const dump = { static: summary, deep, live };
  fs.writeFileSync(path.join(OUT, 'deep.json'), JSON.stringify(dump, null, 1), 'utf8');

  const L = (s) => console.log(s);
  L('==== 静态：无标题长块（阈值 ' + NOHEAD + ' 字符）====');
  L('  内容页          ' + summary.pages);
  L('  含 >834 无标题块 ' + summary.pagesWithNohead834 + ' (' + summary.pctNohead + '%)');
  L('  无标题块总数     ' + summary.totalNoheadRuns);
  L('  最长一块         ' + (summary.maxRun ? summary.maxRun.maxRun + ' 字符 @ ' + summary.maxRun.rel + ' (全文 ' + summary.maxRun.chars + ')' : 'n/a'));
  L('  侧栏链接 max/min/avg ' + summary.sideAllMax + ' / ' + summary.sideAllMin + ' / ' + summary.sideAllAvg);
  L('  自定义分类链接   ' + summary.customCatLinks);
  L('  侧栏分组 open/total ' + (summary.groupTotalSample ? summary.groupTotalSample.groupOpen + '/' + summary.groupTotalSample.groupTotal : 'n/a'));
  L('  侧栏各分区链接   ' + JSON.stringify(summary.secCountSample));
  L('  无TOC且正文>4000字 ' + summary.pagesNoTocWithLongText.length + ' 页');
  summary.pagesNoTocWithLongText.forEach((r) => L('    ' + r.rel.padEnd(56) + ' chars=' + r.chars + ' h2-6=' + r.h2to6));
  L('\n  最长 10 个无标题块：');
  worst.slice(0, 10).forEach((r) => L('    ' + r.rel.padEnd(56) + ' maxRun=' + String(r.maxRun).padStart(6) + ' 全文=' + String(r.contentChars).padStart(6) + ' h2-6=' + r.h2to6 + (r.hasToc ? ' TOC' : ' NO-TOC')));
  L('\n==== 浏览器 ====');
  L('390 首屏: ' + JSON.stringify(live.mobileFirstScreen));
  L('390 抽屉(刚打开): ' + JSON.stringify(live.drawerFresh));
  L('390 抽屉(滚到顶): ' + JSON.stringify(live.drawerAtTop));
  L('TOC 初始: ' + JSON.stringify(live.tocInitial));
  L('TOC @首个h2: ' + JSON.stringify(live.tocAtFirstH2));
  L('长页世界配置: ' + JSON.stringify(live.longPage));
  L('长页中段: ' + JSON.stringify(live.longPageMid));
  L('320 长页: ' + JSON.stringify(live.mobile320Toc));
  L('320 首屏: ' + JSON.stringify(live.mobile320Long));
  L('\nJSON -> ' + path.join(OUT, 'deep.json'));
}
run().catch((e) => { console.error('FAIL', e); process.exit(1); });
