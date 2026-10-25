'use strict';
/**
 * cr2lp-k2.js — hit-test 修正版（只读）：
 *  elementFromPoint 只对当前视口有效，故先把目标行 scrollIntoView，再取点命中。
 *  目的：验证「整行可点」的 ::after 伪元素拉伸是否真的生效，
 *  以免把 <a> 自身 25px 误报成「触控目标只有 25px」。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-k2.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

async function run(page) {
  return await page.evaluate(async () => {
    const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const out = [];
    const items = [...document.querySelectorAll('.src-item')].slice(0, 4);
    for (const it of items) {
      it.scrollIntoView({ block: 'center' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b = R(it);
      const link = it.querySelector('a.src-link');
      const pts = [
        { name: 'left', dx: 5, dy: Math.round(b.h / 2) },
        { name: 'right', dx: b.w - 5, dy: Math.round(b.h / 2) },
        { name: 'bottom-right', dx: b.w - 5, dy: b.h - 3 },
      ];
      const res = pts.map((p) => {
        const el = document.elementFromPoint(b.x + p.dx, b.y + p.dy);
        const anc = el && el.closest ? el.closest('a.src-link') : null;
        return { at: p.name, hit: el ? el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '') : null, isLink: !!anc, href: anc ? anc.getAttribute('href') : null };
      });
      out.push({ rowH: b.h, rowW: b.w, linkOwnH: link ? R(link).h : null, href: link ? link.getAttribute('href') : null, res });
    }
    return out;
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), data: {}, errors: [] };
  for (const [site, url] of Object.entries({ new: 'http://127.0.0.1:8787/', old: 'http://127.0.0.1:8788/' })) {
    for (const vp of [{ name: '390x844', width: 390, height: 844 }, { name: '1440x900', width: 1440, height: 900 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(250);
        out.data[site + '@' + vp.name] = await run(page);
      } catch (e) { out.errors.push({ site, vp: vp.name, err: String(e && e.message) }); }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  for (const [k, v] of Object.entries(out.data)) {
    console.log('[' + k + ']');
    for (const r of v) console.log('   rowH=' + r.rowH + ' rowW=' + r.rowW + ' linkOwnH=' + r.linkOwnH + ' ' + JSON.stringify(r.res));
  }
  console.log('errors=' + out.errors.length + ' ' + JSON.stringify(out.errors));
})().catch((e) => { console.error(e); process.exit(1); });
