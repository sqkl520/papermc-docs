'use strict';
/**
 * cr2lp-o.js — 可靠 hit-test v3（只读）：先用 Playwright 的 scrollIntoViewIfNeeded 真正滚到元素，
 * 再在**独立的一次** evaluate 里做 elementFromPoint。输出 tmpdir/cr2lp-o.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const HIT = () => {
  const it = document.querySelectorAll('.src-item')[1];
  if (!it) return null;
  const r = it.getBoundingClientRect();
  const link = it.querySelector('a.src-link');
  const lr = link ? link.getBoundingClientRect() : null;
  const pts = [
    { at: 'row-left-edge', x: r.left + 5, y: r.top + r.height / 2 },
    { at: 'row-right-edge', x: r.right - 5, y: r.top + r.height / 2 },
    { at: 'row-bottom-mid', x: r.left + r.width / 2, y: r.bottom - 4 },
    { at: 'link-center', x: lr ? lr.left + lr.width / 2 : r.left + 30, y: lr ? lr.top + lr.height / 2 : r.top + 10 },
  ];
  return {
    scrollY: Math.round(window.scrollY),
    rowTop: Math.round(r.top), rowH: Math.round(r.height), rowW: Math.round(r.width),
    linkOwnW: lr ? Math.round(lr.width) : null, linkOwnH: lr ? Math.round(lr.height) : null,
    href: link ? link.getAttribute('href') : null,
    hits: pts.map((p) => {
      const el = document.elementFromPoint(p.x, p.y);
      const a = el && el.closest ? el.closest('a.src-link') : null;
      return { at: p.at, inVP: p.y >= 0 && p.y <= window.innerHeight, hit: el ? el.tagName + '.' + (String(el.className || '').split(' ')[0] || '') : null, isLink: !!a };
    }),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = {};
  for (const [site, url] of Object.entries({ new: 'http://127.0.0.1:8787/', old: 'http://127.0.0.1:8788/' })) {
    for (const vp of [{ name: '1440x900', width: 1440, height: 900 }, { name: '390x844', width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(250);
      await page.locator('.src-item').nth(1).scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      out[site + '@' + vp.name] = await page.evaluate(HIT);
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(os.tmpdir(), 'cr2lp-o.json'), JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out)) console.log(k + ' :: ' + JSON.stringify(v));
})().catch((e) => { console.error(e); process.exit(1); });
