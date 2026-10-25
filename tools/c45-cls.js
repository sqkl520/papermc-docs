'use strict';
/**
 * c45-cls.js — P1-1 的 CLS 验收（A/B 同源对照）
 *
 * 关键设计：**同一次运行内对照**，而不是"改前跑一次 / 改后跑一次"。
 *   基线 08:09Z 测到的 0.08018 与任务书里的 0.1258 不一致，说明跨构建跨时间对比不可信。
 *   本工具对同一份已构建 HTML 做两个 arm：
 *     with     —— 原样（构建期已写 width/height）
 *     without  —— 用 Playwright route 在 **HTML 解析前** 剥掉 content-img 的 width/height
 *                 （等价于"未实施 P1-1"的旧产物，且除该属性外字节完全一致）
 *   两个 arm 同样 CDP 冷缓存 + 220KB/s 限速 + 滚到底触发 lazy，因此差值就是 P1-1 的净效果。
 *   另加 control arm：把 width/height 换成**同比例的占位值**（如 100x56），
 *   用于证明"消除 CLS 靠的是宽高比，不是某个特定像素值"。
 *
 * 用法: node tools/c45-cls.js [--tag=after] [--json=reports/.c45-cls.json]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('base', 'http://127.0.0.1:8787');
const TAG = opt('tag', 'after');
const OUT = path.resolve(ROOT, opt('json', path.join(ROOT, 'reports', '.c45-cls-' + TAG + '.json')));
const THROUGHPUT = Number(opt('throughput', String(220 * 1024)));
const LATENCY = Number(opt('latency', '120'));
// 滚动节奏会影响 lazy 图在视口内到达的时机 → 直接影响 CLS 数值的可比性。
// 两个 arm 用完全相同的节奏，所以内部可比；如需复现旧口径的数字可调这两个参数。
const STEP_FRAC = Number(opt('step', '0.8'));
const SCROLL_WAIT = Number(opt('scrollwait', '200'));

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* 目标：dialogs 是有实质 CLS 的页；后 3 页无内容图，作"不得变差"的对照 */
const PAGES = [
  { name: 'dialogs', rel: '/paper/dev/dialogs/', hasImages: true },
  { name: 'paper-faq', rel: '/paper/faq/', hasImages: false },
  { name: 'velocity-faq', rel: '/velocity/faq/', hasImages: false },
  { name: 'folia-faq', rel: '/folia/faq/', hasImages: false },
];
const VPS = [
  { vp: '1440x900', w: 1440, h: 900, mobile: false },
  { vp: '390x844', w: 390, h: 844, mobile: true },
];

const INIT = () => {
  window.__cls = { total: 0, max: 0, count: 0, entries: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls.total += e.value;
        window.__cls.count += 1;
        if (e.value > window.__cls.max) window.__cls.max = e.value;
        window.__cls.entries.push({
          v: +e.value.toFixed(5),
          t: Math.round(e.startTime),
          src: (e.sources || []).map((s) => {
            const n = s.node;
            if (!n) return '';
            const t = (n.tagName || '').toLowerCase();
            const src = (n.currentSrc || (n.getAttribute && n.getAttribute('src')) || '');
            return t + (src ? ':' + String(src).split('/').pop().slice(0, 52) : '');
          }).slice(0, 3),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* unsupported */ }
};

const MEASURE = () => {
  const imgs = Array.from(document.querySelectorAll('img'));
  const content = imgs.filter((im) => im.classList.contains('content-img'));
  const ratios = content.map((im) => {
    const r = im.getBoundingClientRect();
    const cs = getComputedStyle(im);
    const aw = parseInt(im.getAttribute('width') || '0', 10);
    const ah = parseInt(im.getAttribute('height') || '0', 10);
    // 关键：img.content-img 带 border:1px，且 box-sizing:border-box，
    // 所以 1px 边框会挤掉内容盒 → 用 border-box 的 rect 直接算比例会有 ~1-5% 的假漂移。
    // 变形判定必须用**内容盒**（rect 减去 border+padding）与 naturalWidth/Height 比。
    const bw = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const bh = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const pw = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const ph2 = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const cw = r.width - bw - pw;
    const ch = r.height - bh - ph2;
    const natAR = im.naturalHeight > 0 ? im.naturalWidth / im.naturalHeight : null;
    const contentAR = ch > 0 ? cw / ch : null;
    return {
      n: (im.currentSrc || im.getAttribute('src') || '').split('/').pop().slice(0, 46),
      w: Math.round(r.width), h: Math.round(r.height),
      content: Math.round(cw) + 'x' + Math.round(ch),
      natural: im.naturalWidth + 'x' + im.naturalHeight,
      attr: (aw || '-') + 'x' + (ah || '-'),
      boxSizing: cs.boxSizing,
      border: bw + 'x' + bh,
      naturalAR: natAR === null ? null : +natAR.toFixed(4),
      contentAR: contentAR === null ? null : +contentAR.toFixed(4),
      attrAR: (aw > 0 && ah > 0) ? +(aw / ah).toFixed(4) : null,
      // contentAR 与 naturalAR 的相对偏差；图片未解码(naturalWidth=0)时为 null
      arDrift: (natAR && contentAR) ? +(Math.abs(contentAR - natAR) / natAR).toFixed(5) : null,
      // 对照：border-box 比值漂移（会把 1px 边框算成"变形"，仅作说明用）
      boxDrift: (natAR && r.height > 0) ? +(Math.abs((r.width / r.height) - natAR) / natAR).toFixed(5) : null,
    };
  });
  const dlg = document.getElementById('lightbox');
  const ph = imgs.filter((im) => !im.hasAttribute('src'));
  return {
    cls: +window.__cls.total.toFixed(5),
    maxShift: +window.__cls.max.toFixed(5),
    shiftCount: window.__cls.count,
    shifts: window.__cls.entries.slice(0, 8),
    imgAll: imgs.length,
    contentImgs: content.length,
    contentWithDims: content.filter((im) => im.getAttribute('width') && im.getAttribute('height')).length,
    placeholders: ph.length,
    placeholdersWithDims: ph.filter((im) => im.getAttribute('width') || im.getAttribute('height')).length,
    ratios,
    maxArDrift: ratios.reduce((m, r) => Math.max(m, r.arDrift === null ? 0 : r.arDrift), 0),
    maxBoxDrift: ratios.reduce((m, r) => Math.max(m, r.boxDrift === null ? 0 : r.boxDrift), 0),
    articleH: Math.round((document.querySelector('article.article') || document.body).getBoundingClientRect().height),
    docH: document.documentElement.scrollHeight,
    lightboxPresent: !!dlg,
  };
};

/** rewrite one HTML body for the requested arm (runs before parse, via route fulfil) */
function rewriteHtml(html, arm) {
  if (arm === 'with') return html;
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    if (!/class="[^"]*\bcontent-img\b[^"]*"/.test(tag)) return tag;
    if (arm === 'without') {
      return tag.replace(/\s(?:width|height)="\d+"/g, '');
    }
    // control: keep the aspect ratio, change the absolute pixels (100 x round(100/AR))
    const w = parseInt((tag.match(/\swidth="(\d+)"/) || [])[1] || '0', 10);
    const h = parseInt((tag.match(/\sheight="(\d+)"/) || [])[1] || '0', 10);
    if (!w || !h) return tag;
    const nw = 100;
    const nh = Math.max(1, Math.round(100 * h / w));
    return tag
      .replace(/\swidth="\d+"/, ' width="' + nw + '"')
      .replace(/\sheight="\d+"/, ' height="' + nh + '"');
  });
}

async function runArm(browser, vp, pageCfg, arm) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
    isMobile: vp.mobile, hasTouch: vp.mobile,
  });
  const page = await ctx.newPage();

  if (arm !== 'with') {
    // intercept only the document itself, fulfil with the rewritten markup
    await page.route('**/*', async (route) => {
      const req = route.request();
      if (req.resourceType() !== 'document') return route.continue();
      let body = null;
      try {
        const resp = await route.fetch();
        body = await resp.text();
        // avoid double-rewrite on redirect targets that already went through
        const out = rewriteHtml(body, arm);
        await route.fulfill({ response: resp, body: out, headers: { ...resp.headers(), 'content-type': 'text/html; charset=utf-8' } });
      } catch (e) {
        await route.continue();
      }
    });
  }

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: LATENCY, downloadThroughput: THROUGHPUT, uploadThroughput: THROUGHPUT,
  });
  await page.addInitScript(INIT);

  let navErr = null;
  try {
    await page.goto(BASE + pageCfg.rel, { waitUntil: 'load', timeout: 60000 });
  } catch (e) { navErr = String((e && e.message) || e).split('\n')[0]; }
  await page.waitForTimeout(400);

  // scroll to the bottom so every lazy image is requested (same cadence for both arms)
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.round(vp.h * STEP_FRAC);
  for (let y = 0; y <= total; y += step) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(SCROLL_WAIT);
  }
  await page.waitForFunction(() => Array.from(document.images).every((im) => im.complete), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const m = await page.evaluate(MEASURE);
  await ctx.close();
  return { page: pageCfg.name, rel: pageCfg.rel, viewport: vp.vp, arm, navErr, ...m };
}

(async () => {
  if (!EXE) throw new Error('no Chrome executable found (CHROME_PATH / ms-playwright / Program Files)');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];

  for (const vp of VPS) {
    for (const pc of PAGES) {
      const arms = pc.hasImages ? ['without', 'with', 'control'] : ['without', 'with'];
      for (const arm of arms) {
        const r = await runArm(browser, vp, pc, arm);
        results.push(r);
        console.log('  ' + vp.vp + '  ' + pc.name.padEnd(13) + arm.padEnd(8)
          + ' CLS=' + String(r.cls).padStart(8) + '  max=' + String(r.maxShift).padStart(7)
          + '  n=' + r.shiftCount + '  dims ' + r.contentWithDims + '/' + r.contentImgs
          + (pc.hasImages ? '  drift=' + r.maxArDrift : ''));
      }
    }
    console.log('');
  }

  // ---- summary: per page+viewport, the three arms side by side
  const key = (r) => r.viewport + ' ' + r.page;
  const grid = {};
  for (const r of results) {
    const k = key(r);
    if (!grid[k]) grid[k] = { viewport: r.viewport, page: r.page, rel: r.rel, arms: {} };
    grid[k].arms[r.arm] = {
      cls: r.cls, maxShift: r.maxShift, shiftCount: r.shiftCount,
      contentWithDims: r.contentWithDims, contentImgs: r.contentImgs,
      placeholders: r.placeholders, placeholdersWithDims: r.placeholdersWithDims,
      maxArDrift: r.maxArDrift, maxBoxDrift: r.maxBoxDrift,
      docH: r.docH, articleH: r.articleH, shifts: r.shifts,
    };
  }

  const payload = {
    tool: 'tools/c45-cls.js', tag: TAG, base: BASE, generated_at: new Date().toISOString(),
    throttle: { downloadThroughputBps: THROUGHPUT, latencyMs: LATENCY, cacheDisabled: true },
    scroll: { stepFrac: STEP_FRAC, waitMs: SCROLL_WAIT },
    arms: ['without', 'with', 'control'],
    grid, results,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');

  console.log('=== CLS: without (P1-1 未实施) -> with (现状) ===');
  for (const g of Object.values(grid)) {
    const a = g.arms.without || {};
    const b = g.arms.with || {};
    const c = g.arms.control || {};
    const delta = (a.cls !== undefined && b.cls !== undefined) ? (b.cls - a.cls) : null;
    const pct = (a.cls > 0 && delta !== null) ? ((delta / a.cls) * 100).toFixed(1) + '%' : 'n/a';
    console.log('  ' + g.viewport.padEnd(9) + g.page.padEnd(14)
      + ' without=' + String(a.cls).padStart(8) + '  with=' + String(b.cls).padStart(8)
      + (c.cls !== undefined ? '  control=' + String(c.cls).padStart(8) : '')
      + '  Δ=' + String(delta).padStart(9) + ' (' + pct + ')');
  }
  const dialogs = Object.values(grid).filter((g) => g.page === 'dialogs');
  console.log('\n  aspect drift (content-box AR vs natural AR, 应 ≈0): '
    + dialogs.map((g) => g.viewport + '=' + g.arms.with.maxArDrift).join('  '));
  console.log('  aspect drift (border-box AR, 含 1px 边框的假漂移，仅对照): '
    + dialogs.map((g) => g.viewport + '=' + g.arms.with.maxBoxDrift).join('  '));
  console.log('  placeholders with dims (must be 0): '
    + [...new Set(Object.values(grid).map((g) => g.arms.with.placeholdersWithDims + '/' + g.arms.with.placeholders))].join(' '));
  console.log('wrote ' + path.relative(ROOT, OUT).split(path.sep).join('/'));
  await browser.close();
})().catch((e) => { console.error('ERR', (e && e.stack) || e); process.exit(1); });
