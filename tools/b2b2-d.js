'use strict';
/**
 * b2b2-d.js — D 组：图片固有尺寸属性覆盖率 + 实测 CLS（批 3 的 P1-1）
 *
 * 1. 全站扫描（静态解析 HTML 产物，只读）：<img> 总数、带 width、带 height、
 *    带 loading、带 decoding、是否 external-image 等
 * 2. 实测 CLS：PerformanceObserver({type:'layout-shift'})，只累加 !hadRecentInput；
 *    冷启动（新 context，禁用缓存）+ 慢网（限速）+ 滚动全文触发懒加载
 * 3. 注入「JS 给所有 img 补 naturalWidth/naturalHeight」后 CLS 变化
 *
 * CLS 测法要点：默认 loading=lazy 的图在滚动到视口才加载 → 不滚到底就等于没测。
 * 本脚本先滚到底再滚回顶，全程累积 layout-shift。
 *
 * 用法：node tools/b2b2-d.js
 * 产出：%TEMP%\b2b2\d.json
 */
const fs = require('fs');
const path = require('path');
const L = require('./b2b2-lib');

/* ---------- 1. 静态扫描 img 属性 ---------- */
function scanStatic() {
  const htmls = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'archive' || e.name === 'tools') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) htmls.push(p);
    }
  };
  walk(L.ROOT);
  const per = [];
  let total = 0; let w = 0; let h = 0; let both = 0; let lazy = 0; let ext = 0;
  const noAttrPages = [];
  for (const f of htmls) {
    const s = fs.readFileSync(f, 'utf8');
    const tags = s.match(/<img\b[^>]*>/gi) || [];
    if (!tags.length) continue;
    let pw = 0; let ph = 0; let pb = 0;
    for (const t of tags) {
      total++;
      const hasW = /\swidth\s*=/.test(t);
      const hasH = /\sheight\s*=/.test(t);
      if (hasW) { w++; pw++; }
      if (hasH) { h++; ph++; }
      if (hasW && hasH) { both++; pb++; }
      if (/loading\s*=\s*["']?lazy/.test(t)) lazy++;
      if (/external-image|external-img/.test(t)) ext++;
    }
    per.push({ file: path.relative(L.ROOT, f), imgs: tags.length, withW: pw, withH: ph, withBoth: pb });
    if (!pb) noAttrPages.push(path.relative(L.ROOT, f));
  }
  // 是否有 CSS aspect-ratio 兜底
  const css = fs.readFileSync(path.join(L.ROOT, 'assets', 'site.css'), 'utf8');
  return {
    htmlFiles: htmls.length,
    pagesWithImg: per.length,
    total, withW: w, withH: h, withBoth: both, lazy, external: ext,
    aspectRatioInCss: /aspect-ratio/.test(css),
    perPage: per.sort((a, b) => b.imgs - a.imgs).slice(0, 12),
    noAttrPages: noAttrPages.slice(0, 12),
  };
}

/* ---------- 2. CLS 采集 ---------- */
const CLS_INIT = () => {
  window.__cls = { value: 0, entries: 0, max: 0, list: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls.value += e.value;
        window.__cls.entries++;
        if (e.value > window.__cls.max) window.__cls.max = e.value;
        if (window.__cls.list.length < 40) {
          window.__cls.list.push({
            v: Math.round(e.value * 10000) / 10000,
            t: Math.round(e.startTime),
            src: (e.sources || []).map((s) => (s.node ? (s.node.nodeName + '.' + (s.node.className || '')).slice(0, 60) : '?')),
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) { window.__cls.error = String(err); }
};

/** 补 naturalWidth/naturalHeight → 显式 width/height 属性（等价于渲染期回填） */
const PATCH_IMGS = () => {
  let n = 0;
  for (const img of document.querySelectorAll('img')) {
    if (img.getAttribute('width') && img.getAttribute('height')) continue;
    if (img.naturalWidth && img.naturalHeight) {
      img.setAttribute('width', String(img.naturalWidth));
      img.setAttribute('height', String(img.naturalHeight));
      n++;
    }
  }
  return n;
};

const SNAP = () => ({
  cls: Math.round(window.__cls.value * 10000) / 10000,
  entries: window.__cls.entries,
  max: Math.round(window.__cls.max * 10000) / 10000,
  list: window.__cls.list.slice(0, 12),
  imgs: document.querySelectorAll('img').length,
  imgsNoDim: [...document.querySelectorAll('img')].filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).length,
  pageHeight: document.documentElement.scrollHeight,
});

const PAGES = [
  { name: 'dialogs', url: '/paper/dev/dialogs/' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/' },
  { name: 'tuning', url: '/velocity/tuning/' },
  { name: 'paper', url: '/paper/' },
];

async function scrollAll(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.7);
    const max = document.documentElement.scrollHeight;
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
  });
}

(async () => {
  const staticScan = scanStatic();
  L.log({ static: { total: staticScan.total, withW: staticScan.withW, withH: staticScan.withH, both: staticScan.withBoth, lazy: staticScan.lazy, aspect: staticScan.aspectRatioInCss } });

  const browser = await L.launch();
  const out = { static: staticScan, cls: [] };
  try {
    for (const build of ['new', 'b0', 'old']) {
      for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
        for (const pg of PAGES) {
          for (const patch of [false, true]) {
            const ctx = await L.makeContext(browser, build, { width: vp.w, height: vp.h });
            await ctx.addInitScript(CLS_INIT);
            // 冷缓存 + 慢网：放大图片迟到导致的位移
            const page = await ctx.newPage();
            const cdp = await ctx.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
            await cdp.send('Network.emulateNetworkConditions', {
              offline: false, latency: 120, downloadThroughput: 220 * 1024, uploadThroughput: 220 * 1024,
            });
            let patched = 0;
            try {
              await page.goto(L.baseUrl(build) + pg.url, { waitUntil: 'load', timeout: 90000 });
              await page.waitForTimeout(400);
              if (patch) patched = await page.evaluate(PATCH_IMGS);
              await scrollAll(page);
              const snap = await page.evaluate(SNAP);
              out.cls.push({ build, vp: vp.w, page: pg.name, patch, patched, ...snap });
              L.log({ b: build, vp: vp.w, pg: pg.name, patch, patched, cls: snap.cls, entries: snap.entries, max: snap.max, imgs: snap.imgs, noDim: snap.imgsNoDim });
            } catch (e) {
              out.cls.push({ build, vp: vp.w, page: pg.name, patch, error: String((e && e.message) || e).slice(0, 140) });
              L.log({ b: build, vp: vp.w, pg: pg.name, patch, err: String((e && e.message) || e).slice(0, 90) });
            }
            await ctx.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('d.json', out));
})();
