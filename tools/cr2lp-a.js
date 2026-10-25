'use strict';
/**
 * cr2lp-a.js — 「首页锐评」主测量脚本（只读 DOM，不写站点文件）。
 *
 * 产出（JSON 写到 os.tmpdir()）：
 *   blocks[]      首屏/整页区块几何 + 文案字数（1440x900 / 390x844）
 *   cards[]       卡片清单（entry-card / qa / stat）标题 / 高度 / href / 是否可点
 *   firstDoc       第一个「真实文档链接」的 y 坐标（区分 section 根页 vs 叶子页）
 *   styleCounts   边框色 / 阴影 / 圆角 / 字号 / 背景色 的去重计数
 *   screens[]      逐屏滚动时可见区块摘要（1440 / 390 各前 5 屏）
 *   baseline       8788 (a19a6c2) 首页的区块/卡片/链接计数，用于 A/B
 *
 * 用法：node tools/cr2lp-a.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-a.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787/';
const OLD = 'http://127.0.0.1:8788/';

const VPS = [
  { name: '1440x900', width: 1440, height: 900, mobile: false },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

/** 在页面里跑：把 article 的一级子区块全部量出来 */
function PROBE() {
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const cjkCount = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;

  const art = document.querySelector('.article') || document.querySelector('main');
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // ---- article 一级区块 ----
  const blocks = [];
  if (art) {
    for (const el of art.children) {
      const b = R(el);
      if (b.h === 0 && b.w === 0) continue;
      const t = txt(el);
      const links = el.querySelectorAll('a[href]').length;
      const inFold = Math.max(0, Math.min(b.y + b.h, vh) - Math.max(b.y, 0));
      blocks.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className || '',
        id: el.id || '',
        y: b.y, h: b.h, w: b.w,
        inFold,
        foldPctOfVh: Math.round((inFold / vh) * 1000) / 10,
        links,
        chars: t.length,
        cjk: cjkCount(t),
        head: t.slice(0, 150),
      });
    }
  }

  // ---- hero 细节 ----
  const hero = document.querySelector('.hero');
  const h1 = document.querySelector('h1');
  const heroPs = hero ? [...hero.querySelectorAll('p')] : [];
  const heroDetail = {
    heroY: hero ? R(hero).y : null,
    heroH: hero ? R(hero).h : null,
    h1: h1 ? Object.assign(R(h1), { size: getComputedStyle(h1).fontSize, text: txt(h1) }) : null,
    ps: heroPs.map((p) => {
      const r = R(p); const t = txt(p);
      return { cls: p.className, y: r.y, h: r.h, w: r.w, chars: t.length, cjk: cjkCount(t), lines: Math.round(r.h / parseFloat(getComputedStyle(p).lineHeight)), text: t.slice(0, 260) };
    }),
    heroChars: hero ? txt(hero).length : 0,
    heroCjk: hero ? cjkCount(txt(hero)) : 0,
    heroH2Total: hero ? R(hero).h : 0,
  };

  // ---- 第一个真实文档链接 ----
  const allLinks = [...(art ? art.querySelectorAll('a[href]') : [])].map((a) => ({
    href: a.getAttribute('href'), text: txt(a).slice(0, 80), y: R(a).y, h: R(a).h,
    cls: a.className || '',
  }));
  const isSectionRoot = (h) => /^[a-z]+\/index\.html$/.test(h || '') || /^\/[a-z]+\/?$/.test(h || '');
  const isLeafDoc = (h) => !!h && /^[a-z]+\/.+\/index\.html$/.test(h) && !/^[a-z]+\/index\.html$/.test(h);
  const firstSection = allLinks.find((l) => isSectionRoot(l.href));
  const firstLeaf = allLinks.find((l) => isLeafDoc(l.href));
  const firstAny = allLinks.find((l) => l.y > (h1 ? R(h1).y : 0));

  // ---- 卡片清单 ----
  const cards = [];
  const grab = (sel, kind) => {
    for (const el of document.querySelectorAll(sel)) {
      const a = el.matches('a[href]') ? el : el.querySelector('a[href]');
      const b = R(el);
      const t = txt(el);
      cards.push({
        kind, sel, title: t.slice(0, 70), text: t, h: b.h, w: b.w, y: b.y,
        clickable: !!a, href: a ? a.getAttribute('href') : null,
        borderStyle: getComputedStyle(el).borderStyle,
      });
    }
  };
  grab('.entry-card', 'entry');
  grab('.quickbar .qa', 'quick');
  grab('.stats .stat', 'stat');

  // ---- 样式去重计数 ----
  const styleCounts = () => {
    const scope = art || document.body;
    const bc = new Map(); const sh = new Map(); const rad = new Map(); const fs_ = new Map(); const bg = new Map();
    const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    for (const el of [scope, ...scope.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        const w = parseFloat(cs['border' + side + 'Width']);
        if (w > 0 && cs['border' + side + 'Style'] !== 'none') bump(bc, cs['border' + side + 'Color']);
      }
      if (cs.boxShadow && cs.boxShadow !== 'none') bump(sh, cs.boxShadow);
      if (parseFloat(cs.borderTopLeftRadius) > 0) bump(rad, cs.borderTopLeftRadius);
      if ((el.textContent || '').trim().length) bump(fs_, cs.fontSize);
      bump(bg, cs.backgroundColor);
    }
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return {
      borderColors: { distinct: bc.size, top: top(bc, 12) },
      shadows: { distinct: sh.size, top: top(sh, 12) },
      radii: { distinct: rad.size, top: top(rad, 12) },
      fontSizes: { distinct: fs_.size, top: top(fs_, 20) },
      backgrounds: { distinct: bg.size, top: top(bg, 10) },
    };
  };

  // ---- 逐屏摘要（前 5 屏） ----
  const screens = [];
  const maxS = Math.min(5, Math.ceil(document.documentElement.scrollHeight / vh));
  for (let i = 0; i < maxS; i++) {
    const top = i * vh; const bot = top + vh;
    const vis = blocks.filter((b) => b.y < bot && b.y + b.h > top)
      .map((b) => ({
        cls: b.cls, head: b.head.slice(0, 110),
        sharePct: Math.round((Math.min(b.y + b.h, bot) - Math.max(b.y, top)) / vh * 1000) / 10,
        links: b.links,
      }));
    screens.push({ screen: i + 1, scrollY: top, visible: vis });
  }

  return {
    url: location.href,
    title: document.title,
    vw, vh,
    pageHeight: document.documentElement.scrollHeight,
    screensCount: Math.ceil(document.documentElement.scrollHeight / vh),
    art: art ? R(art) : null,
    sidebar: document.querySelector('.sidebar') ? R(document.querySelector('.sidebar')) : null,
    heroDetail,
    blocks,
    cards,
    linkCount: allLinks.length,
    firstSection, firstLeaf, firstAnyLink: firstAny,
    styleCounts: styleCounts(),
    screens,
    // 统计卡数值单独列，用于「可从页面推出」核对
    statValues: [...document.querySelectorAll('.stats .stat')].map((el) => ({
      v: (el.querySelector('b') || {}).textContent || null,
      k: (el.querySelector('span') || {}).textContent || null,
    })),
  };
}

/** 8788 基线：只取"有几个区块/几张卡/多少链接"这类可比值 */
function PROBE_BASE() {
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const art = document.querySelector('.article') || document.querySelector('main');
  const blocks = art ? [...art.children].map((el) => ({
    tag: el.tagName.toLowerCase(), cls: el.className || '', h: R(el).h, y: R(el).y,
    links: el.querySelectorAll('a[href]').length, chars: txt(el).length, head: txt(el).slice(0, 110),
  })).filter((b) => b.h > 0) : [];
  return {
    url: location.href, title: document.title,
    vw: window.innerWidth, vh: window.innerHeight,
    pageHeight: document.documentElement.scrollHeight,
    art: art ? R(art) : null,
    blocks,
    blockCount: blocks.length,
    linkCount: art ? art.querySelectorAll('a[href]').length : 0,
    sidebarLinks: document.querySelectorAll('.sidebar a[href]').length,
    cardsTotal: document.querySelectorAll('.card, .entry-card, .qa, .stat, .sr-item').length,
    h1: document.querySelector('h1') ? { text: txt(document.querySelector('h1')).slice(0, 60), y: R(document.querySelector('h1')).y } : null,
    h2s: [...document.querySelectorAll('.article h2')].map((h) => txt(h)),
    statValues: [...document.querySelectorAll('.stats .stat')].map((el) => ({
      v: (el.querySelector('b') || {}).textContent || null, k: (el.querySelector('span') || {}).textContent || null,
    })),
    heroParas: [...document.querySelectorAll('.hero p')].map((p) => ({ cls: p.className, h: R(p).h, chars: txt(p).length, text: txt(p).slice(0, 200) })),
    firstLeafLink: (() => {
      const ls = [...(art ? art.querySelectorAll('a[href]') : [])];
      const l = ls.find((a) => /^[a-z]+\/.+\/index\.html$/.test(a.getAttribute('href') || ''));
      return l ? { href: l.getAttribute('href'), y: R(l).y, text: txt(l).slice(0, 60) } : null;
    })(),
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), exe: EXE, new: {}, baseline: {}, errors: [] };

  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await ctx.newPage();
    try {
      await page.goto(NEW, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(400);
      out.new[vp.name] = await page.evaluate(PROBE);
    } catch (e) { out.errors.push({ vp: vp.name, url: NEW, err: String(e && e.message) }); }
    await ctx.close();
  }

  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
    const page = await ctx.newPage();
    try {
      await page.goto(OLD, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(400);
      out.baseline[vp.name] = await page.evaluate(PROBE_BASE);
    } catch (e) { out.errors.push({ vp: vp.name, url: OLD, err: String(e && e.message) }); }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  console.log('errors=' + out.errors.length);
  for (const k of Object.keys(out.new)) {
    const n = out.new[k];
    console.log(`[new ${k}] pageH=${n.pageHeight} screens=${n.screensCount} blocks=${n.blocks.length} cards=${n.cards.length} artLinks=${n.linkCount} h1.y=${n.heroDetail.h1 && n.heroDetail.h1.y} firstLeaf.y=${n.firstLeaf && n.firstLeaf.y}`);
  }
  for (const k of Object.keys(out.baseline)) {
    const b = out.baseline[k];
    console.log(`[base ${k}] pageH=${b.pageHeight} blocks=${b.blockCount} cards=${b.cardsTotal} artLinks=${b.linkCount} h1.y=${b.h1 && b.h1.y} firstLeaf.y=${b.firstLeafLink && b.firstLeafLink.y}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
