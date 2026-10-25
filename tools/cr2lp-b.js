'use strict';
/**
 * cr2lp-b.js — 首页「信息重复 / 冗余」深挖（只读）。
 *
 * 1) 正文链接 vs 侧栏链接的重复率（目录结构树是否只是侧栏的镜像）
 * 2) 首屏内「可点的具体文档页」链接数（叶子页，排除分区根/组首页）
 * 3) 数字重复：141 / 103 / 17 等在最前面几屏出现多少次
 * 4) 每个区块的「任务价值分类」所需数据：链接目标类型分布
 * 5) 首屏像素预算：fold 内每类内容（自述 / 导航 / 统计 / 标题）占比
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-b.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const URL = 'http://127.0.0.1:8787/';
const VPS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
];

function PROBE() {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const art = document.querySelector('.article') || document.querySelector('main');
  const side = document.querySelector('.sidebar');
  const vh = window.innerHeight;

  const hrefs = (root) => [...(root ? root.querySelectorAll('a[href]') : [])].map((a) => a.getAttribute('href'));
  const artHrefs = hrefs(art);
  const sideHrefs = hrefs(side);

  // 去重集合
  const artSet = new Set(artHrefs);
  const sideSet = new Set(sideHrefs);
  const overlap = [...artSet].filter((h) => sideSet.has(h));

  // 链接分类
  const cls = (h) => {
    if (!h) return 'none';
    if (h.startsWith('#')) return 'fragment';
    if (/^https?:/.test(h)) return 'external';
    if (/^[a-z]+\/index\.html$/.test(h)) return 'sectionRoot';
    if (/^[a-z]+\/.+\/index\.html$/.test(h)) {
      // 组首页链接 vs 叶子页：靠 class 区分不方便，交给调用方
      return 'leafDoc';
    }
    if (/^(all-pages|snapshots)\.html$/.test(h)) return 'utility';
    return 'other';
  };

  // 首屏内的链接（y < vh）
  const inFoldLinks = [...art.querySelectorAll('a[href]')].map((a) => ({
    href: a.getAttribute('href'), y: R(a).y, cls: a.className || '', t: txt(a).slice(0, 60),
  })).filter((l) => l.y < vh);

  const foldByKind = {};
  for (const l of inFoldLinks) {
    const k = l.cls.includes('tg-home') ? 'groupHome' : cls(l.href);
    foldByKind[k] = (foldByKind[k] || 0) + 1;
  }

  // 组首页 vs 叶子页 全站计数
  let groupHome = 0; let srcLeaf = 0;
  for (const a of (art ? art.querySelectorAll('a[href]') : [])) {
    if ((a.className || '').includes('tg-home')) groupHome++;
    else if (cls(a.getAttribute('href')) === 'leafDoc') srcLeaf++;
  }

  // 数字重复：在 body 可见文本里数 "141""103""31""17" 出现次数（按区块）
  const bodyTxt = txt(document.body);
  const numRep = {};
  for (const n of ['141', '103', '31', '17', '441', '982', '936', '221', '89', '30']) {
    numRep[n] = (bodyTxt.match(new RegExp('(^|\\D)' + n + '(\\D|$)', 'g')) || []).length;
  }

  // 首屏像素预算分类
  const budget = [];
  const push = (sel, label) => {
    for (const el of document.querySelectorAll(sel)) {
      const b = R(el);
      if (b.y >= vh) continue;
      const vis = Math.min(b.y + b.h, vh) - Math.max(b.y, 0);
      if (vis <= 0) continue;
      budget.push({ label, cls: el.className || '', y: b.y, h: b.h, vis, pct: Math.round((vis / vh) * 1000) / 10 });
    }
  };
  push('.hero .page-head-h1', '标题 H1');
  push('.hero .hero-tag', '自述·tagline');
  push('.hero p:not(.hero-tag)', '自述·正文段');
  push('.hero-search', '搜索框');
  push('.entry-card', '分区入口卡');
  push('.quickbar .qa', '工具卡');
  push('.stats', '统计卡组');
  push('.section-head', '区块说明文');

  // 「有用」链接判定：站内叶子文档页 + 工具页（all-pages）
  const usefulInFold = inFoldLinks.filter((l) => {
    const k = l.cls.includes('tg-home') ? 'groupHome' : cls(l.href);
    return k === 'leafDoc' || k === 'groupHome' || k === 'utility';
  }).length;

  // 最靠上的「真实文档内容链接」（不是分区/工具）
  const docLinks = [...art.querySelectorAll('a[href]')].map((a) => ({
    href: a.getAttribute('href'), y: R(a).y, cls: a.className || '', t: txt(a).slice(0, 70),
  })).filter((l) => /^[a-z]+\/.+\/index\.html$/.test(l.href));
  const firstDoc = docLinks[0] || null;

  return {
    vw: window.innerWidth, vh,
    pageHeight: document.documentElement.scrollHeight,
    artHrefTotal: artHrefs.length,
    artHrefUnique: artSet.size,
    sideHrefTotal: sideHrefs.length,
    sideHrefUnique: sideSet.size,
    overlapCount: overlap.length,
    overlapPctOfArtUnique: Math.round((overlap.length / artSet.size) * 1000) / 10,
    overlapSample: overlap.slice(0, 15),
    artOnlySample: [...artSet].filter((h) => !sideSet.has(h)).slice(0, 20),
    groupHome, srcLeaf,
    inFoldLinks: inFoldLinks.length,
    foldByKind,
    usefulInFold,
    usefulInFoldPct: Math.round((usefulInFold / inFoldLinks.length) * 1000) / 10 || 0,
    firstDoc,
    numRep,
    budget: budget.sort((a, b) => a.y - b.y),
    sideHeight: side ? R(side).h : null,
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), data: {}, errors: [] };
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(300);
      out.data[vp.name] = await page.evaluate(PROBE);
    } catch (e) { out.errors.push({ vp: vp.name, err: String(e && e.message) }); }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  for (const k of Object.keys(out.data)) {
    const d = out.data[k];
    console.log(`[${k}] artLinks=${d.artHrefTotal}/${d.artHrefUnique}u sideLinks=${d.sideHrefTotal}/${d.sideHrefUnique}u overlap=${d.overlapCount} (${d.overlapPctOfArtUnique}%) groupHome=${d.groupHome} leaf=${d.srcLeaf} inFold=${d.inFoldLinks} usefulInFold=${d.usefulInFold} firstDoc.y=${d.firstDoc && d.firstDoc.y}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
