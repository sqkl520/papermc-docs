'use strict';
/**
 * b2b-d.js — D 组：图片固有尺寸与 CLS（批 3 的 P1-1）
 *
 * 测三件事：
 *   1. 全站 <img> 里有多少带 width/height 属性（静态扫描 HTML，不靠浏览器）
 *   2. 实测 CLS：PerformanceObserver 监听 layout-shift，排除 hadRecentInput，
 *      取**加载完成后稳定窗口**内的累计值（图片是 loading=lazy，必须滚动到底触发加载）
 *   3. 注入模拟：JS 给所有 img 写 width/height = naturalWidth/naturalHeight 后重测 CLS
 *
 * 用法：node tools/b2b-d.js
 * 产出：<tmp>\b2b\d.json
 */
const fs = require('fs');
const path = require('path');
const L = require('./b2b-lib');

const PAGES = [
  { name: 'particles', url: '/paper/dev/particles/', note: '19 图（全站最多）' },
  { name: 'dialogs', url: '/paper/dev/dialogs/', note: '7 图' },
  { name: 'command-tree', url: '/paper/dev/command-api/basics/command-tree/', note: '10 图' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/', note: '0 图（对照）' },
];

/** 静态扫描：全站 img 标签属性统计 */
function scanStatic() {
  const root = L.ROOT;
  const skip = /\\(node_modules|archive|reports|tools)\\/i;
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.test(p + '\\')) walk(p); }
      else if (e.name.endsWith('.html')) files.push(p);
    }
  })(root);
  let all = 0, withBoth = 0, withW = 0, withH = 0, contentImg = 0, lazy = 0;
  const perPage = [];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const tags = [...t.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    if (!tags.length) continue;
    let c = 0, cb = 0;
    for (const tag of tags) {
      all++;
      const hasW = /\bwidth\s*=/.test(tag);
      const hasH = /\bheight\s*=/.test(tag);
      if (hasW) withW++;
      if (hasH) withH++;
      if (hasW && hasH) { withBoth++; cb++; }
      if (/class="(?:content-img|external-image)"/.test(tag)) contentImg++;
      if (/loading="lazy"/.test(tag)) lazy++;
    }
    c = tags.length;
    perPage.push({ page: path.relative(root, f).replace(/\\/g, '/'), imgs: c, withDims: cb });
  }
  perPage.sort((a, b) => b.imgs - a.imgs);
  return { files: files.length, all, withW, withH, withBoth, contentImg, lazy, topPages: perPage.slice(0, 10) };
}

/** 在页面里装 CLS 观察器（必须在导航前 addInitScript，才能抓到首屏位移） */
const CLS_INIT = () => {
  window.__cls = { value: 0, entries: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls.value += e.value;
        for (const s of e.sources || []) {
          const n = s.node;
          window.__cls.entries.push({
            v: Math.round(e.value * 10000) / 10000,
            tag: n && n.nodeName ? n.nodeName.toLowerCase() : null,
            cls: n && n.className && typeof n.className === 'string' ? n.className.slice(0, 60) : null,
            src: n && n.currentSrc ? n.currentSrc.split('/').pop().slice(0, 50) : null,
            t: Math.round(e.startTime),
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) { window.__cls = { value: null, entries: [], err: String(err) }; }
};

/** 触发 lazy 图片加载：分步滚到底再回顶，等网络静默 */
async function loadAllImages(page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    const step = Math.max(200, Math.round(window.innerHeight * 0.8));
    for (let y = 0; y < h; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16)));
    }
    window.scrollTo(0, h);
    await new Promise((r) => setTimeout(r, 120));
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

const IMG_STATS = () => {
  const imgs = [...document.querySelectorAll('img')];
  return {
    count: imgs.length,
    withDimsAttr: imgs.filter((i) => i.hasAttribute('width') && i.hasAttribute('height')).length,
    loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    noDims: imgs.filter((i) => !(i.hasAttribute('width') && i.hasAttribute('height'))).length,
    heights: imgs.map((i) => ({
      src: (i.currentSrc || i.src || '').split('/').pop().slice(0, 40),
      naturalW: i.naturalWidth, naturalH: i.naturalHeight,
      boxW: Math.round(i.getBoundingClientRect().width), boxH: Math.round(i.getBoundingClientRect().height),
      hasDims: i.hasAttribute('width') && i.hasAttribute('height'),
    })),
  };
};

(async () => {
  const stat = scanStatic();
  L.log({ staticScan: { all: stat.all, withBoth: stat.withBoth, contentImg: stat.contentImg, lazy: stat.lazy } });

  const browser = await L.launch();
  const out = [];
  try {
    for (const build of ['new', 'b0', 'old']) {
      for (const variant of ['base', 'dims']) {
        const ctx = await L.makeContext(browser, build, { width: 1280, height: 900 });
        const page = await ctx.newPage();
        await page.addInitScript(CLS_INIT);
        const base = L.baseUrl(build);
        const rows = [];
        for (const pg of PAGES) {
          await page.goto(base + pg.url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(150);
          // 等首屏 CLS 稳定
          await page.waitForTimeout(500);
          if (variant === 'dims') {
            // 注入模拟：给所有 img 写真实 intrinsic 尺寸
            await page.evaluate(() => {
              for (const i of document.querySelectorAll('img')) {
                if (i.naturalWidth > 0) {
                  i.setAttribute('width', String(i.naturalWidth));
                  i.setAttribute('height', String(i.naturalHeight));
                }
              }
            });
            await page.waitForTimeout(150);
          }
          // 重新装一个观察器只统计「图片加载期」的位移
          await page.evaluate(() => {
            window.__cls2 = { value: 0, entries: [] };
            new PerformanceObserver((list) => {
              for (const e of list.getEntries()) {
                if (e.hadRecentInput) continue;
                window.__cls2.value += e.value;
                for (const s of e.sources || []) {
                  const n = s.node;
                  window.__cls2.entries.push({
                    v: Math.round(e.value * 10000) / 10000,
                    tag: n && n.nodeName ? n.nodeName.toLowerCase() : null,
                    cls: n && n.className && typeof n.className === 'string' ? n.className.slice(0, 40) : null,
                    src: n && n.currentSrc ? n.currentSrc.split('/').pop().slice(0, 40) : null,
                  });
                }
              }
            }).observe({ type: 'layout-shift', buffered: false });
          });
          await loadAllImages(page);
          const r = await page.evaluate(() => ({
            cls0: window.__cls.value,
            clsLoad: window.__cls2.value,
            entries0: window.__cls.entries.slice(0, 12),
            entriesLoad: window.__cls2.entries.slice(0, 12),
          }));
          const img = await page.evaluate(IMG_STATS);
          rows.push({ page: pg.name, ...r, img });
        }
        await ctx.close();
        out.push({ build, variant, rows });
        for (const r of rows) {
          L.log({
            b: build, v: variant, pg: r.page,
            cls0: Math.round(r.cls0 * 10000) / 10000,
            clsLoad: Math.round(r.clsLoad * 10000) / 10000,
            imgs: r.img.count, loaded: r.img.loaded, noDims: r.img.noDims,
            shiftTop: r.entries0.slice(0, 3).map((e) => `${e.tag}.${e.cls || '-'}:${e.v}`).join(' | '),
            shiftLoad: r.entriesLoad.slice(0, 3).map((e) => `${e.tag}.${e.cls || '-'}:${e.v}`).join(' | '),
          });
        }
      }
    }
  } finally {
    await browser.close();
  }
  out.push({ staticScan: stat });
  console.log('wrote ' + L.save('d.json', out));
})();
