'use strict';
/**
 * cr2lp-k.js — 最后两项核对（只读）：
 *  1) hit-test：目录树 .src-item 行末点击是否落在 .src-link 上（验证 ::after 伪元素拉伸是否真的生效）
 *     —— 避免把「a 元素 25px」误报成「触控目标 25px」。
 *  2) 390 下 hero 各子元素改前/改后高度差，解释 heroH 383 vs 365 的 +18px。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2lp-k.json');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

function PROBE() {
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };

  // --- hit test：取前 5 个 src-item，按行的右下角 / 右中部取点，看命中的是不是 src-link ---
  const hits = [];
  const items = [...document.querySelectorAll('.src-item')].slice(0, 5);
  for (const it of items) {
    const b = R(it);
    const link = it.querySelector('a.src-link');
    const pts = [
      { name: 'row-left', dx: 6, dy: Math.round(b.h / 2) },
      { name: 'row-right', dx: b.w - 6, dy: Math.round(b.h / 2) },
      { name: 'row-bottom-right', dx: b.w - 6, dy: b.h - 4 },
    ];
    const res = [];
    for (const p of pts) {
      const px = b.x + p.dx; const py = b.y - window.scrollY + p.dy;
      const el = document.elementFromPoint(px, py);
      const anc = el && el.closest ? el.closest('a.src-link') : null;
      res.push({ at: p.name, hitTag: el ? el.tagName + '.' + (el.className || '') : null, resolvesToSrcLink: !!anc });
    }
    hits.push({ rowH: b.h, rowW: b.w, linkBoxH: link ? R(link).h : null, res });
  }

  // --- hero 子元素 ---
  const hero = document.querySelector('.hero');
  const heroKids = hero ? [...hero.children].map((el) => ({ tag: el.tagName.toLowerCase(), cls: el.className, h: R(el).h, y: R(el).y })) : [];
  const hs = hero ? R(hero) : null;
  const hsp = hero ? [...hero.querySelectorAll('p')].map((p) => ({ cls: p.className, h: R(p).h, y: R(p).y, lines: Math.round(R(p).h / parseFloat(getComputedStyle(p).lineHeight)) })) : [];

  return { vw: window.innerWidth, vh: window.innerHeight, pageHeight: document.documentElement.scrollHeight, hero: hs, heroKids, heroPs: hsp, hits };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { generatedAt: new Date().toISOString(), data: {}, errors: [] };
  for (const [site, url] of Object.entries({ new: 'http://127.0.0.1:8787/', old: 'http://127.0.0.1:8788/' })) {
    for (const vp of [{ name: '390x844', width: 390, height: 844 }, { name: '320x568', width: 320, height: 568 }, { name: '1440x900', width: 1440, height: 900 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(250);
        out.data[site + '@' + vp.name] = await page.evaluate(PROBE);
      } catch (e) { out.errors.push({ site, vp: vp.name, err: String(e && e.message) }); }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE ' + OUT);
  for (const [k, d] of Object.entries(out.data)) {
    console.log(`[${k}] hero=${JSON.stringify(d.hero)}`);
    console.log('   heroKids=' + JSON.stringify(d.heroKids));
    console.log('   heroPs=' + JSON.stringify(d.heroPs));
    console.log('   hits=' + JSON.stringify(d.hits));
  }
})().catch((e) => { console.error(e); process.exit(1); });
