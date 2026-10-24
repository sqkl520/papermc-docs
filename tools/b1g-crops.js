'use strict';
/**
 * b1g-crops.js - compose before/after comparison crops (stacked) for the
 * regions the report points at, so a human can verify differences by eye.
 *
 * Output: reports/b1-shots/crops/<name>.png  (BEFORE on top, AFTER below,
 * a 3px red separator, plus a 22px caption strip).
 *
 * Usage: node tools/b1g-crops.js [--dark]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const DARK = argv.includes('--dark');
const ROOT = path.join('reports', 'b1-shots');
const tag = DARK ? 'dark-' : 'light-';

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const REGIONS = [
  { name: '1440-dialogs-lead-paragraph', stem: tag + '1440-dialogs', file: 'fold', x: 300, y: 370, w: 880, h: 90, note: 'first prose paragraph: line breaks move' },
  { name: '1440-dialogs-toc-head', stem: tag + '1440-dialogs', file: 'fold', x: 1180, y: 56, w: 260, h: 130, note: 'right TOC header + count' },
  { name: '1440-dialogs-code-block', stem: tag + '1440-dialogs', file: 'fold', x: 300, y: 520, w: 880, h: 140, note: 'image/code column width' },
  { name: '1440-world-config-callout', stem: tag + '1440-world-config', file: 'fold', x: 300, y: 230, w: 980, h: 160, note: 'callout box width 836 -> 848.8' },
  { name: '390-dialogs-top', stem: tag + '390-dialogs', file: 'fold', x: 0, y: 50, w: 390, h: 190, note: 'mobile TOC bar + H1 position' },
  { name: '390-tuning-top', stem: tag + '390-tuning', file: 'fold', x: 0, y: 50, w: 390, h: 190, note: 'mobile TOC bar + H1 position' },
  { name: '390-all-pages-top', stem: tag + '390-all-pages', file: 'fold', x: 0, y: 50, w: 390, h: 300, note: 'all-pages: table -> cards' },
];

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await page.goto('about:blank');
  fs.mkdirSync(path.join(ROOT, 'crops'), { recursive: true });

  const index = [];
  for (const r of REGIONS) {
    const aPath = path.join(ROOT, 'before', r.stem + '.' + r.file + '.png');
    const bPath = path.join(ROOT, 'after', r.stem + '.' + r.file + '.png');
    if (!fs.existsSync(aPath) || !fs.existsSync(bPath)) { console.log('  skip ' + r.name); continue; }
    const da = 'data:image/png;base64,' + fs.readFileSync(aPath).toString('base64');
    const db = 'data:image/png;base64,' + fs.readFileSync(bPath).toString('base64');
    const dataUrl = await page.evaluate(async ([da, db, reg]) => {
      const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const [ia, ib] = await Promise.all([load(da), load(db)]);
      const CAP = 22;
      const W = reg.w;
      const H = CAP + reg.h * 2 + 3 + CAP;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      const draw = (img, label, dy) => {
        g.fillStyle = '#111'; g.font = '13px monospace';
        g.fillText(label, 4, dy - 6);
        const sw = Math.min(reg.w, Math.max(0, img.width - reg.x));
        const sh = Math.min(reg.h, Math.max(0, img.height - reg.y));
        g.drawImage(img, reg.x, reg.y, sw, sh, 0, dy, sw, sh);
      };
      draw(ia, 'BEFORE  ' + reg.stem + '  (' + ia.width + 'x' + ia.height + ')', CAP);
      g.fillStyle = '#e11'; g.fillRect(0, CAP + reg.h, W, 3);
      draw(ib, 'AFTER   ' + reg.stem + '  (' + ib.width + 'x' + ib.height + ')', CAP + reg.h + 3 + CAP);
      return c.toDataURL('image/png');
    }, [da, db, { x: r.x, y: r.y, w: r.w, h: r.h, stem: r.stem }]);
    const outName = (DARK ? 'dark-' : '') + r.name + '.png';
    fs.writeFileSync(path.join(ROOT, 'crops', outName), Buffer.from(dataUrl.split(',')[1], 'base64'));
    index.push({ name: outName, region: r, note: r.note });
    console.log('  wrote crops/' + outName);
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'crops', DARK ? '_index-dark.json' : '_index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log('\n' + index.length + ' crops in ' + path.join(ROOT, 'crops'));
})();
