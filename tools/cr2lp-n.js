'use strict';
/**
 * cr2lp-n.js — 可靠的 hit-test（只读）：分两次 evaluate，保证 rect 与命中点同一帧同一视口。
 * 目标：验证目录树「整行可点」是否真生效（决定我在报告里怎么写可点击面积）。
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

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = {};
  for (const [site, url] of Object.entries({ new: 'http://127.0.0.1:8787/', old: 'http://127.0.0.1:8788/' })) {
    for (const vp of [{ name: '1440x900', width: 1440, height: 900 }, { name: '390x844', width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(250);

      // 1) 把第 2 个 src-item 滚到视口中央（用 window.scrollTo，按文档坐标）
      const target = await page.evaluate(() => {
        const it = document.querySelectorAll('.src-item')[1];
        if (!it) return null;
        const r = it.getBoundingClientRect();
        const docTop = r.top + window.scrollY;
        window.scrollTo(0, Math.max(0, docTop - window.innerHeight / 2));
        return null;
      });
      await page.waitForTimeout(150);

      // 2) 同一帧里取 rect + elementFromPoint
      const res = await page.evaluate(() => {
        const it = document.querySelectorAll('.src-item')[1];
        if (!it) return null;
        const r = it.getBoundingClientRect();
        const link = it.querySelector('a.src-link');
        const lr = link ? link.getBoundingClientRect() : null;
        const pts = [
          { at: 'row-left-edge', x: r.left + 5, y: r.top + r.height / 2 },
          { at: 'row-right-edge', x: r.right - 5, y: r.top + r.height / 2 },
          { at: 'row-bottom', x: r.left + r.width / 2, y: r.bottom - 4 },
          { at: 'link-center', x: lr ? lr.left + lr.width / 2 : r.left + 30, y: lr ? lr.top + lr.height / 2 : r.top + 10 },
        ];
        const hits = pts.map((p) => {
          const el = document.elementFromPoint(p.x, p.y);
          const a = el && el.closest ? el.closest('a.src-link') : null;
          return { at: p.at, insideViewport: p.y >= 0 && p.y <= window.innerHeight, hit: el ? el.tagName + '.' + (String(el.className || '').split(' ')[0] || '') : null, resolvesToLink: !!a };
        });
        return {
          rowTopInViewport: Math.round(r.top), rowH: Math.round(r.height), rowW: Math.round(r.width),
          linkOwnW: lr ? Math.round(lr.width) : null, linkOwnH: lr ? Math.round(lr.height) : null,
          href: link ? link.getAttribute('href') : null, hits,
        };
      });
      out[site + '@' + vp.name] = res;
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(os.tmpdir(), 'cr2lp-n.json'), JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out)) console.log(k + ' :: ' + JSON.stringify(v));
})().catch((e) => { console.error(e); process.exit(1); });
