'use strict';
/**
 * b3f-tbtn.js — 定位 .tbtn 计算字号 16.8px 的来源（3d 后出现，需确认是否违反 R9）。
 *
 * R9（ups-plan §9.1）：**顶栏内部字号不参与令牌化** —— 理由是 .brand 已 139px 宽，
 * 若把 .topbar .brand-name（1rem=16）改成 --fs-lg(17.5) 会让 390 档顶栏溢出。
 *
 * 3d 之后实测 .tbtn = 16.8px（改前 13.12px）。本脚本枚举**所有** .tbtn 实例，
 * 打印其 computed font-size / 是否在顶栏内 / 文本 / 盒尺寸，判断是哪条规则命中的。
 */
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => require('fs').existsSync(p));

const PROBE = () => {
  const cs = getComputedStyle;
  return [...document.querySelectorAll('.tbtn')].map((el) => {
    const c = cs(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className,
      inTopbar: !!el.closest('.topbar'),
      text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 24),
      fontSize: c.fontSize,
      display: c.display,
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      visible: r.width > 0 && r.height > 0 && c.display !== 'none',
    };
  });
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  for (const vp of [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    for (const rel of ['index.html', 'paper/dev/dialogs/index.html']) {
      await page.goto('file:///' + path.join(ROOT, rel).replace(/\\/g, '/'), { waitUntil: 'load' });
      await page.waitForTimeout(150);
      const rows = await page.evaluate(PROBE);
      console.log('\n=== ' + rel + ' @' + vp.n + ' : .tbtn 共 ' + rows.length + ' 个 ===');
      for (const r of rows) {
        console.log('  ' + (r.inTopbar ? '[顶栏]' : '[正文]').padEnd(8)
          + r.fontSize.padStart(8) + '  ' + String(r.w).padStart(7) + '×' + String(r.h).padStart(6)
          + '  ' + (r.visible ? '可见' : '隐藏') + '  ' + r.tag + '.' + String(r.cls).replace(/\s+/g, '.') + '  「' + r.text + '」');
      }
      const tb = rows.filter((r) => r.inTopbar && r.visible);
      if (tb.length) {
        console.log('  → 顶栏内可见 .tbtn 字号：' + [...new Set(tb.map((r) => r.fontSize))].join(' / '));
      }
    }
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
