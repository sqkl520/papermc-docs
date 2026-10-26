'use strict';
/**
 * b3f-diag.js — 口径对账：解释"24 级 vs 25 级"的差异来源。
 *
 * 背景：主 Agent 实测 paper/dev/dialogs @1440 = **25 级**，本 Agent 实测 = **24 级**。
 * 两侧差集是 `11.2px`。本脚本把 11.2px 的**所有候选元素**逐一列出来，并打印每条可见性判据的
 * 中间值（display / visibility / opacity / 盒尺寸 / getClientRects 数），使差异可归因而非猜测。
 *
 * 用法：node tools/b3f-diag.js [--page=paper/dev/dialogs/index.html] [--vp=1440]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PROBE = (targetPx) => {
  const cs = getComputedStyle;
  const hasText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  };
  const details = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg')) continue;
    const px = parseFloat(cs(el).fontSize);
    if (Math.abs(px - targetPx) > 0.001) continue;
    if (!hasText(el)) continue;
    const c = cs(el);
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    details.push({
      sel: tag + cls,
      text: el.textContent.trim().slice(0, 24),
      display: c.display,
      visibility: c.visibility,
      opacity: c.opacity,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      rects: el.getClientRects().length,
      visibleByStrict: c.display !== 'none' && c.visibility !== 'hidden'
        && parseFloat(c.opacity) !== 0 && r.width > 0 && r.height > 0 && el.getClientRects().length > 0,
    });
  }
  return details;
};

(async () => {
  if (!EXE) throw new Error('找不到 chromium');
  const rel = arg('page', 'paper/dev/dialogs/index.html');
  const w = Number(arg('vp', '1440'));
  const target = Number(arg('target', '11.2'));
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('file:///' + path.join(ROOT, rel).replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const d = await page.evaluate(PROBE, target);
  await browser.close();

  console.log('\n口径对账：' + rel + ' @' + w + '，目标 ' + target + 'px');
  console.log('有直接文本节点且计算字号 = ' + target + 'px 的元素共 ' + d.length + ' 个\n');
  console.log('strict可见  display   visibility  opacity    w×h          rects  选择器');
  console.log('-'.repeat(104));
  for (const x of d) {
    console.log(String(x.visibleByStrict).padEnd(12) + x.display.padEnd(10) + x.visibility.padEnd(12)
      + String(x.opacity).padEnd(10) + (x.w + '×' + x.h).padEnd(13) + String(x.rects).padEnd(8) + x.sel);
  }
  const strict = d.filter((x) => x.visibleByStrict).length;
  console.log('\n严格可见（display≠none, visibility≠hidden, opacity≠0, 盒>0, rects>0）: ' + strict + ' / ' + d.length);
  if (strict < d.length) {
    console.log('→ 被 strict 判据排除的元素就是两侧口径差的来源：');
    for (const x of d.filter((y) => !y.visibleByStrict)) {
      console.log('   · ' + x.sel + '  opacity=' + x.opacity + '  w×h=' + x.w + '×' + x.h + '  「' + x.text + '」');
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
