'use strict';
/**
 * b2h-height.js —— 批 2b 页高预算分解（只读）
 *
 * 为什么单列一份：任务书的目标「首页页高 @1440 1,138 → ≤800」是从
 * ups-plan §7 批 2 的预期表来的，但那张表把 −438px 归给了 tree-fold。
 * 实测 tree-fold 默认 closed、只占 50px —— 删它最多省 50px。所以必须把
 * 1132px 逐块拆开，证明「≤800 在不动受保护块的前提下不可达」，而不是含糊地说"没达标"。
 *
 * 口径：document.documentElement.scrollHeight 为总量；逐块给 top / height / 上下 margin。
 *
 * 用法：node tools/b2h-height.js [--page=index.html] [--vp=1440,1024,390]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const h = argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d; };
const PAGE = arg('page', 'index.html');
const VPS = [
  { name: '1440', w: 1440, h: 900 },
  { name: '1024', w: 1024, h: 768 },
  { name: '390', w: 390, h: 844 },
];

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

function BUDGET() {
  const out = [];
  const px = (v) => Math.round(parseFloat(v) || 0);
  const main = document.querySelector('main');
  const topbar = document.querySelector('.topbar, header');
  if (topbar) {
    const r = topbar.getBoundingClientRect();
    out.push({ part: 'topbar', top: 0, h: Math.round(r.height), mt: 0, mb: 0, cls: 'topbar' });
  }
  for (const el of Array.from(main.children)) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.height === 0 && cs.display === 'none') continue;
    out.push({
      part: (el.className || el.tagName).toString().split(/\s+/)[0] || el.tagName.toLowerCase(),
      top: Math.round(r.top + window.scrollY),
      h: Math.round(r.height),
      mt: px(cs.marginTop), mb: px(cs.marginBottom),
      cls: (el.className || '').toString(),
    });
  }
  const mcs = getComputedStyle(main);
  return {
    total: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    parts: out,
    mainPad: { t: px(mcs.paddingTop), b: px(mcs.paddingBottom) },
    mainTop: Math.round(main.getBoundingClientRect().top + window.scrollY),
    mainH: Math.round(main.getBoundingClientRect().height),
    bodyChildren: Array.from(document.body.children).map((el) => ({
      cls: (el.className || el.tagName).toString().split(/\s+/)[0], h: Math.round(el.getBoundingClientRect().height),
    })),
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--allow-file-access-from-files'] });
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('file:///' + path.join(REPO, PAGE).replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.waitForTimeout(220);
    const b = await page.evaluate(BUDGET);
    await ctx.close();

    console.log('\n===== ' + PAGE + ' @' + vp.name + '  总页高=' + b.total + '  （main top=' + b.mainTop + ' h=' + b.mainH + '） =====');
    console.log('  part                          top    h   mt   mb   top+mt..bottom+mb');
    let sum = 0;
    for (const p of b.parts) {
      const occ = p.h + p.mt + p.mb;
      sum += occ;
      console.log('  ' + p.part.padEnd(28) + ' ' + String(p.top).padStart(5) + String(p.h).padStart(5)
        + String(p.mt).padStart(5) + String(p.mb).padStart(5) + '   ' + occ);
    }
    console.log('  合计占位（含 margin）= ' + sum + '  ；main 内空白（padding 等）= ' + (b.mainH - b.parts.filter((p) => p.part !== 'topbar').reduce((n, p) => n + p.h + p.mt + p.mb, 0)));
    console.log('  body 直接子：' + JSON.stringify(b.bodyChildren));
  }
  await browser.close();
})().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack : e)); process.exit(1); });
