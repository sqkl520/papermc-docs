/* tools/c4-geom.js — rendered-geometry snapshot of every content image (visual no-change proof).
 *
 * For each page that has .content-img, records the on-screen size of every content image plus
 * the article height, at two viewports. Re-running after the build-time width/height change must
 * produce byte-identical geometry (the attributes only reserve space; CSS keeps height:auto).
 *
 * Usage: node tools/c4-geom.js --tag=before --out=reports/_c4-geom-before.json
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
const OUT = path.resolve(ROOT, arg('out', 'reports/_c4-geom.json'));
const VPS = arg('vp', '1440x900,390x844').split(',').map((s) => s.trim()).filter(Boolean);

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/** site pages that contain content images (scan the built tree) */
function pagesWithContentImages() {
  const skip = new Set(['node_modules', 'archive', 'assets', 'data', 'tools', 'reports', '.git']);
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(p); }
      else if (e.name.endsWith('.html')) {
        const html = fs.readFileSync(p, 'utf8');
        const n = (html.match(/class="[^"]*\bcontent-img\b[^"]*"/g) || []).length;
        if (n) out.push({ url: '/' + path.relative(ROOT, p).replace(/\\/g, '/'), imgs: n });
      }
    }
  };
  for (const r of ['paper', 'velocity', 'folia']) {
    const a = path.join(ROOT, r);
    if (fs.existsSync(a)) walk(a);
  }
  return out.sort((a, b) => a.url.localeCompare(b.url));
}

(async () => {
  if (!EXE) throw new Error('no Chrome executable found');
  // directory URLs work for both pretty URLs (/x/y/) and index.html
  const pages = pagesWithContentImages().map((p) => p.url.replace(/\/index\.html$/, '/'));
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];
  for (const vp of VPS) {
    const [W, H] = vp.split('x').map(Number);
    for (const p of pages) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(BASE + p, { waitUntil: 'load', timeout: 45000 });
      // force every lazy image to load: scroll through, then come back
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y <= h; y += Math.round(H * 0.9)) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(60);
      }
      await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 30000 })
        .catch(() => {});
      await page.waitForTimeout(200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(120);
      const m = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img.content-img'));
        return {
          articleH: Math.round((document.querySelector('article.article') || document.body).getBoundingClientRect().height),
          docH: document.documentElement.scrollHeight,
          imgs: imgs.map((im) => {
            const r = im.getBoundingClientRect();
            return {
              n: (im.currentSrc || im.getAttribute('src') || '').split('/').pop().slice(0, 44),
              w: Math.round(r.width), h: Math.round(r.height),
              nat: im.naturalWidth + 'x' + im.naturalHeight,
              attr: (im.getAttribute('width') || '-') + 'x' + (im.getAttribute('height') || '-'),
              ok: im.complete && im.naturalWidth > 0,
            };
          }),
        };
      });
      results.push({ page: p, viewport: vp, ...m });
      console.log('  ' + vp.padEnd(9) + p.padEnd(56) + ' imgs=' + String(m.imgs.length).padStart(2)
        + ' articleH=' + m.articleH);
      await ctx.close();
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ tag: TAG, base: BASE, generated_at: new Date().toISOString(), results }, null, 1), 'utf8');
  console.log('\n' + TAG + ': ' + results.length + ' measurements over ' + pages.length + ' pages → '
    + path.relative(ROOT, OUT).replace(/\\/g, '/'));
  await browser.close();
})().catch((e) => { console.error('ERR', (e && e.stack) || e); process.exit(1); });
