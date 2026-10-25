'use strict';
/**
 * b2b-d2.js — D 组的**决定性**测试：构建期补 width/height 的真前后对比
 *
 * 为什么不沿用 b2b-d.js 的「事后 JS 设属性」：CLS 在页面加载期已经累积完毕，
 * 事后设属性无法回溯修正首屏位移（d.js 实测：particles 0.0681 → 0.0681，纹丝不动）。
 * 正确做法是让浏览器**在解析 HTML 时**就拿到固有尺寸。
 *
 * 本脚本用 page.route 拦截 document，把每个 <img> 补上真实 width/height 后返回：
 *   第 1 遍：正常加载 → 收集 src → naturalWidth/naturalHeight 映射
 *   第 2 遍：用映射改写 HTML 再加载 → 重测 CLS
 * 两遍同进程、同视口、同 CLS 观察器，可直接对拍。
 *
 * 用法：node tools/b2b-d2.js
 * 产出：<tmp>\b2b\d2.json
 */
const L = require('./b2b-lib');

const PAGES = [
  { name: 'particles', url: '/paper/dev/particles/' },
  { name: 'dialogs', url: '/paper/dev/dialogs/' },
  { name: 'command-tree', url: '/paper/dev/command-api/basics/command-tree/' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/' },
];

const CLS_INIT = () => {
  window.__cls = { value: 0, entries: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls.value += e.value;
        for (const s of e.sources || []) {
          const n = s.node;
          window.__cls.entries.push({
            v: Math.round(e.value * 10000) / 10000,
            tag: n && n.nodeName ? n.nodeName.toLowerCase() : null,
            cls: n && typeof n.className === 'string' ? n.className.slice(0, 40) : null,
            src: n && n.currentSrc ? n.currentSrc.split('/').pop().slice(0, 40) : null,
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) { window.__cls = { value: null, entries: [], err: String(err) }; }
};

async function settle(page) {
  // 触发 lazy 图 + 等网络静默 + 等 3 帧，让 layout-shift 全部结算
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    const step = Math.max(240, Math.round(window.innerHeight * 0.85));
    for (let y = 0; y < h; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 20)));
    }
    window.scrollTo(0, h);
    await new Promise((r) => setTimeout(r, 150));
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
}

/** 给 HTML 里的 <img> 补 width/height（按 src 解析成绝对路径查表） */
function injectDims(html, pageUrl, dimMap) {
  let hit = 0, miss = 0;
  const out = html.replace(/<img\b[^>]*>/g, (tag) => {
    if (/\bwidth\s*=/.test(tag) && /\bheight\s*=/.test(tag)) return tag;
    const m = tag.match(/\bsrc\s*=\s*"([^"]*)"/);
    if (!m) { miss++; return tag; }
    let abs;
    try { abs = new URL(m[1], pageUrl).pathname; } catch { miss++; return tag; }
    const d = dimMap[abs];
    if (!d) { miss++; return tag; }
    hit++;
    return tag.replace(/<img\b/, `<img width="${d[0]}" height="${d[1]}"`);
  });
  return { html: out, hit, miss };
}

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    for (const build of ['new', 'old']) {
      const base = L.baseUrl(build);
      for (const pg of PAGES) {
        const url = base + pg.url;

        // 第 1 遍：收集固有尺寸 + base CLS
        const ctx1 = await L.makeContext(browser, build, { width: 1280, height: 900 });
        const p1 = await ctx1.newPage();
        await p1.addInitScript(CLS_INIT);
        await p1.goto(url, { waitUntil: 'load', timeout: 60000 });
        await p1.waitForTimeout(200);
        const clsBase = await p1.evaluate(() => window.__cls.value);
        const entBase = await p1.evaluate(() => window.__cls.entries.slice(0, 10));
        await settle(p1);
        const clsBaseSettled = await p1.evaluate(() => window.__cls.value);
        const dims = await p1.evaluate(() => {
          const m = {};
          for (const i of document.querySelectorAll('img')) {
            const p = new URL(i.currentSrc || i.src, location.href).pathname;
            if (i.naturalWidth > 0) m[p] = [i.naturalWidth, i.naturalHeight];
          }
          return m;
        });
        const html = await p1.content();
        await ctx1.close();

        // 第 2 遍：改写 HTML，注入 width/height
        const pageUrl = new URL(url).href;
        const { html: patched, hit, miss } = injectDims(html, pageUrl, dims);

        const ctx2 = await L.makeContext(browser, build, { width: 1280, height: 900 });
        const p2 = await ctx2.newPage();
        await p2.addInitScript(CLS_INIT);
        await p2.route('**/*', (route) => {
          const rq = route.request();
          if (rq.resourceType() === 'document' && decodeURIComponent(new URL(rq.url()).pathname) === pg.url) {
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: patched });
          }
          return route.continue();
        });
        await p2.goto(url, { waitUntil: 'load', timeout: 60000 });
        await p2.waitForTimeout(200);
        const clsFix = await p2.evaluate(() => window.__cls.value);
        const entFix = await p2.evaluate(() => window.__cls.entries.slice(0, 10));
        await settle(p2);
        const clsFixSettled = await p2.evaluate(() => window.__cls.value);
        const verify = await p2.evaluate(() => {
          const imgs = [...document.querySelectorAll('img')];
          return {
            count: imgs.length,
            withDims: imgs.filter((i) => i.hasAttribute('width') && i.hasAttribute('height')).length,
          };
        });
        await ctx2.close();

        const rec = {
          build, page: pg.name, url: pg.url,
          imgs: verify.count, imgsWithDims: verify.withDims, patchedTags: hit, missedTags: miss,
          clsBase: Math.round(clsBase * 10000) / 10000,
          clsBaseSettled: Math.round(clsBaseSettled * 10000) / 10000,
          clsFix: Math.round(clsFix * 10000) / 10000,
          clsFixSettled: Math.round(clsFixSettled * 10000) / 10000,
          entBase: entBase.slice(0, 5), entFix: entFix.slice(0, 5),
        };
        out.push(rec);
        L.log({
          b: build, pg: pg.name, imgs: rec.imgs, dims: rec.imgsWithDims, patched: hit, missed: miss,
          clsBase: rec.clsBase, clsFix: rec.clsFix,
          baseSettled: rec.clsBaseSettled, fixSettled: rec.clsFixSettled,
          drop: rec.clsBase > 0 ? Math.round((1 - rec.clsFix / rec.clsBase) * 100) + '%' : 'n/a',
        });
      }
    }
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('d2.json', out));
})();
