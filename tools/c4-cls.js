/* tools/c4-cls.js — CLS probe for batch-3 P1-1 (image intrinsic width/height).
 *
 * Measures cumulative layout shift (PerformanceObserver 'layout-shift', hadRecentInput excluded)
 * on a cold cache with a throttled connection, scrolling to the bottom to trigger lazy images.
 *
 * Usage:
 *   node tools/c4-cls.js --tag=before --vp=1440x900 --out=reports/_c4-cls-before-1440.json \
 *        --pages=/paper/dev/dialogs/,/paper/faq/,/velocity/faq/,/folia/faq/
 *
 * Never writes absolute host paths into the JSON.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith('--' + n + '='));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const BASE = arg('base', 'http://127.0.0.1:8787');
const TAG = arg('tag', 'run');
const OUT = path.resolve(ROOT, arg('out', 'reports/_c4-cls.json'));
const VPS = arg('vp', '1440x900').split(',').map((s) => s.trim()).filter(Boolean);
const PAGES = arg('pages', '/paper/dev/dialogs/').split(',').map((s) => s.trim()).filter(Boolean);
// 220 KB/s ≈ 225280 B/s, plus 120 ms RTT (slow-4G-ish, forces progressive image arrival)
const THROUGHPUT = Number(arg('throughput', String(220 * 1024)));
const LATENCY = Number(arg('latency', '120'));

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

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
            const tag = (n.tagName || '').toLowerCase();
            const src = n.currentSrc || n.getAttribute && n.getAttribute('src') || '';
            return tag + (src ? ':' + String(src).split('/').pop().slice(0, 60) : '');
          }).slice(0, 3),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* layout-shift unsupported */ }
};

async function measureInPage(page) {
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const content = imgs.filter((im) => im.classList.contains('content-img'));
    return {
      cls: +window.__cls.total.toFixed(5),
      maxShift: +window.__cls.max.toFixed(5),
      shiftCount: window.__cls.count,
      shifts: window.__cls.entries.slice(0, 10),
      imgAll: imgs.length,
      contentImgs: content.length,
      contentImgWithDims: content.filter((im) => im.getAttribute('width') && im.getAttribute('height')).length,
      // geometry fingerprint: visible size of content images + article height (visual no-change check)
      geometry: content.map((im) => {
        const r = im.getBoundingClientRect();
        return {
          n: (im.currentSrc || im.getAttribute('src') || '').split('/').pop().slice(0, 48),
          w: Math.round(r.width),
          h: Math.round(r.height),
          nat: im.naturalWidth + 'x' + im.naturalHeight,
          attr: (im.getAttribute('width') || '') + 'x' + (im.getAttribute('height') || ''),
        };
      }),
      articleH: Math.round((document.querySelector('article.article') || document.body).getBoundingClientRect().height),
      docH: document.documentElement.scrollHeight,
    };
  });
}

(async () => {
  if (!EXE) throw new Error('no Chrome executable found (CHROME_PATH / ms-playwright / Program Files)');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];

  for (const vp of VPS) {
    const [W, H] = vp.split('x').map(Number);
    for (const p of PAGES) {
      // fresh context per page ⇒ cold HTTP cache; CDP also forces cache off + throttling
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: LATENCY,
        downloadThroughput: THROUGHPUT, uploadThroughput: THROUGHPUT,
      });
      await page.addInitScript(INIT);
      const url = BASE + p;
      let navErr = null;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      } catch (e) { navErr = String(e && e.message || e).split('\n')[0]; }
      await page.waitForTimeout(400);
      // scroll to the bottom in viewport-ish steps so every lazy image is requested
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y <= total; y += Math.round(H * 0.8)) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(200);
      }
      // wait for all images to settle (decoded or broken)
      await page.waitForFunction(() => Array.from(document.images).every((im) => im.complete), null, { timeout: 30000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);

      const m = await measureInPage(page);
      results.push({ page: p, viewport: vp, url, navErr, ...m });
      console.log('  ' + vp + ' ' + p + '  CLS=' + m.cls + ' (max ' + m.maxShift + ', n=' + m.shiftCount
        + ')  content-img ' + m.contentImgWithDims + '/' + m.contentImgs + ' with dims');
      await ctx.close();
    }
  }

  const summary = {};
  for (const r of results) summary[r.viewport + ' ' + r.page] = r.cls;
  const payload = {
    tag: TAG, base: BASE, generated_at: new Date().toISOString(),
    throttle: { downloadThroughputBps: THROUGHPUT, latencyMs: LATENCY, cacheDisabled: true },
    summary, results,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8');
  console.log('\n' + TAG + ' CLS summary:');
  for (const r of results) {
    console.log('  ' + r.viewport.padEnd(9) + r.page.padEnd(34) + String(r.cls).padStart(8)
      + '  max=' + String(r.maxShift).padStart(7) + '  imgs ' + r.contentImgWithDims + '/' + r.contentImgs);
  }
  console.log('wrote ' + path.relative(ROOT, OUT).replace(/\\/g, '/'));
  await browser.close();
})().catch((e) => { console.error('ERR', (e && e.stack) || e); process.exit(1); });
