'use strict';
/**
 * cr2ia-side.js — 侧栏每一条链接的可见性分类（权威口径）
 * 判定：完全不可见 = 落在 closed <details> 内 或 offsetParent 为 null 或 rect 高度为 0
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2ia');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const DUMP = () => {
  const s = document.querySelector('#sidebar');
  const r = s.getBoundingClientRect();
  const rows = [];
  for (const a of s.querySelectorAll('a[href]')) {
    const b = a.getBoundingClientRect();
    const closed = a.closest('details:not([open])');
    const inClosed = !!closed;
    const laid = b.width > 0 && b.height > 0;
    const inBox = laid && b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
    rows.push({
      t: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30),
      top: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width),
      inClosedDetails: inClosed,
      closedSummary: inClosed ? ((closed.querySelector('summary') || {}).textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26) : null,
      offsetParentNull: a.offsetParent === null,
      laid, inBox,
    });
  }
  const laid = rows.filter((x) => x.laid);
  const inBox = rows.filter((x) => x.inBox);
  return {
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    clientH: s.clientHeight, scrollH: s.scrollHeight,
    total: rows.length,
    laidOut: laid.length,
    hiddenInClosedDetails: rows.filter((x) => x.inClosedDetails).length,
    visibleInBox: inBox.length,
    visibleButBelowFold: laid.length - inBox.length,
    visibleTexts: laid.map((x) => x.t),
    first30: rows.slice(0, 30),
    histTop: (() => { const o = {}; for (const x of laid) { const k = Math.round(x.top / 100) * 100; o[k] = (o[k] || 0) + 1; } return o; })(),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const R = {};
  for (const [name, url] of [['landing', '/'], ['dialogs', '/paper/dev/dialogs/'], ['basics', '/paper/dev/command-api/basics/introduction/']]) {
    await page.goto(BASE + url, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    R[name] = await page.evaluate(DUMP);
  }
  fs.writeFileSync(path.join(OUT, 'side.json'), JSON.stringify(R, null, 2), 'utf8');
  const L = [];
  for (const k of Object.keys(R)) {
    const v = R[k];
    L.push('### ' + k + ' rect=' + JSON.stringify(v.rect) + ' clientH=' + v.clientH + ' scrollH=' + v.scrollH);
    L.push('   total=' + v.total + ' laidOut=' + v.laidOut + ' hiddenInClosedDetails=' + v.hiddenInClosedDetails + ' visibleInBox=' + v.visibleInBox + ' laidButBelowFold=' + v.visibleButBelowFold);
    L.push('   visible list (' + v.visibleTexts.length + '): ' + JSON.stringify(v.visibleTexts));
    L.push('   topHist=' + JSON.stringify(v.histTop));
  }
  const txt = L.join('\n');
  fs.writeFileSync(path.join(OUT, 'side.txt'), txt, 'utf8');
  console.log(txt);
  await browser.close();
})();
