'use strict';
/**
 * b1g-pixdiff.js - pixel-level before/after comparison for batch-1 shots.
 *
 * Decodes the PNG pairs inside a headless browser canvas (no extra deps) and
 * reports: size mismatch, differing-pixel count, differing bounding box, and
 * the first-difference row (so "where on screen" is checkable by a human).
 *
 * Usage:
 *   node tools/b1g-pixdiff.js                      # light pairs
 *   node tools/b1g-pixdiff.js --dark
 *   node tools/b1g-pixdiff.js --threshold=8
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const DARK = argv.includes('--dark');
const THRESH = Number(opt('threshold', '8'));
const ROOT = path.join('reports', 'b1-shots');
const MAN = path.join(ROOT, DARK ? '_shotmanifest-dark.json' : '_shotmanifest.json');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));
const stems = [...new Set(man.shots.map((s) => s.stem))];

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('about:blank');

  const results = [];
  for (const stem of stems) {
    for (const kind of ['fold', 'full']) {
      const a = path.join(ROOT, 'before', stem + '.' + kind + '.png');
      const b = path.join(ROOT, 'after', stem + '.' + kind + '.png');
      if (!fs.existsSync(a) || !fs.existsSync(b)) { console.log('  skip ' + stem + '.' + kind); continue; }
      const da = 'data:image/png;base64,' + fs.readFileSync(a).toString('base64');
      const db = 'data:image/png;base64,' + fs.readFileSync(b).toString('base64');
      const r = await page.evaluate(async ([da, db, thresh]) => {
        const load = (src) => new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = () => rej(new Error('img load'));
          i.src = src;
        });
        const [ia, ib] = await Promise.all([load(da), load(db)]);
        const w = Math.min(ia.width, ib.width);
        const h = Math.min(ia.height, ib.height);
        const c1 = document.createElement('canvas'); c1.width = ia.width; c1.height = ia.height;
        const c2 = document.createElement('canvas'); c2.width = ib.width; c2.height = ib.height;
        const g1 = c1.getContext('2d'); g1.drawImage(ia, 0, 0);
        const g2 = c2.getContext('2d'); g2.drawImage(ib, 0, 0);
        const d1 = g1.getImageData(0, 0, w, h).data;
        const d2 = g2.getImageData(0, 0, w, h).data;
        let n = 0;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        const rows = new Map();
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const dd = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2]));
            if (dd > thresh) {
              n++;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              rows.set(y, (rows.get(y) || 0) + 1);
            }
          }
        }
        // first rows with heavy differences (content, not chrome)
        const heavy = [...rows.entries()].filter(([, c]) => c > w * 0.02).sort((a, b) => a[0] - b[0]).slice(0, 6);
        return {
          wa: ia.width, ha: ia.height, wb: ib.width, hb: ib.height,
          cmpW: w, cmpH: h, diffPixels: n,
          pct: Math.round((n / (w * h)) * 10000) / 100,
          bbox: n ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
          heavyRows: heavy.map(([y, c]) => ({ y, px: c })),
          distinctDiffRows: rows.size,
        };
      }, [da, db, THRESH]);
      results.push({ stem, kind, before: a, after: b, ...r });
      console.log('  ' + stem.padEnd(26) + kind.padEnd(5) +
        'size ' + r.wa + 'x' + r.ha + ' vs ' + r.wb + 'x' + r.hb +
        '  diff=' + r.diffPixels + ' (' + r.pct + '%)' +
        ' bbox=' + JSON.stringify(r.bbox));
    }
  }
  await browser.close();

  const out = path.join(ROOT, DARK ? '_pixdiff-dark.json' : '_pixdiff.json');
  fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), scheme: DARK ? 'dark' : 'light', threshold: THRESH, results }, null, 2), 'utf8');
  console.log('\nwrote ' + out);
})();
