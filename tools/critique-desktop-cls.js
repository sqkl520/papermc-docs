/* critique-desktop-cls.js — measure layout shift and final geometry of lazy images
 * Usage: node tools/critique-desktop-cls.js [--base=...] [--vp=1440x900] [--page=/paper/dev/dialogs/]
 * Writes reports/_critique-desktop-cls.json
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const h = process.argv.find(a => a.startsWith('--' + n + '=')); return h ? h.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:8787');
const [VW, VH] = arg('vp', '1440x900').split('x').map(Number);
const PAGE = arg('page', '/paper/dev/dialogs/');
const OUT = path.join(ROOT, 'reports', '_critique-desktop-cls.json');
const EXE = [process.env.CHROME_PATH,
process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find(p => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // track layout shifts in the page
  await page.addInitScript(() => {
    window.__cls = []; window.__clsTotal = 0;
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) { window.__clsTotal += e.value; window.__cls.push({ v: +e.value.toFixed(5), t: Math.round(e.startTime), src: (e.sources || []).map(s => (s.node && (s.node.currentSrc || s.node.tagName)) || '').slice(0, 3) }); }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) { }
  });
  await page.goto(BASE + PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('.article img')).map(im => { const r = im.getBoundingClientRect(); return { src: (im.currentSrc || im.src || '').split('/').pop(), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y + scrollY), nat: im.naturalWidth + 'x' + im.naturalHeight, complete: im.complete, loading: im.getAttribute('loading'), dims: !!(im.getAttribute('width') && im.getAttribute('height')) }; });
    return { docH: document.documentElement.scrollHeight, imgs, cls: window.__clsTotal, shifts: window.__cls.slice(0, 12) };
  });
  // scroll through slowly to trigger lazy loads
  const H = before.docH;
  for (let y = 0; y <= H; y += Math.round(VH * 0.8)) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(180); }
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('.article img')).map(im => { const r = im.getBoundingClientRect(); return { src: (im.currentSrc || im.src || '').split('/').pop(), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y + scrollY), nat: im.naturalWidth + 'x' + im.naturalHeight, complete: im.complete, loading: im.getAttribute('loading'), dims: !!(im.getAttribute('width') && im.getAttribute('height')) }; });
    return { docH: document.documentElement.scrollHeight, imgs, cls: window.__clsTotal, shifts: window.__cls.slice(0, 20), articleH: Math.round((document.querySelector('.article') || document.body).getBoundingClientRect().height) };
  });
  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, page: PAGE, viewport: VW + 'x' + VH, before, after }, null, 1), 'utf8');
  console.log('docH before/after', before.docH, after.docH, 'cls', before.cls, after.cls);
  console.log('imgs before', before.imgs.map(i => i.src + ':' + i.w + 'x' + i.h).join(' | '));
  console.log('imgs after ', after.imgs.map(i => i.src + ':' + i.w + 'x' + i.h + '(nat' + i.nat + ')').join(' | '));
  console.log('shifts', JSON.stringify(after.shifts.slice(0, 10)));
  console.log('wrote', OUT);
  await browser.close();
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
