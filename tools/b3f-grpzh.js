'use strict';
/**
 * b3f-grpzh.js — 复测 R1（红队 B 警告：`.grp-zh` 10.88 → 12.5 会让组名截断 5 → 9）。
 *
 * 关键：批 1 已把 `.sidebar .grp-zh{display:none}`，所以「可见元素的截断数」恒为 0 ——
 * 那是**结构性消除**，不是"字号没影响"。本脚本把两层分开测，避免用假绿交差：
 *
 *   A. 现状（批 1 之后）：.grp-zh 的计算 display 与是否参与布局
 *   B. **反事实**：临时把 .grp-zh 强制 display:inline 并测截断 —— 回答
 *      「如果批 1 没做，现在 12.5px 会导致几个截断」
 *   C. 同时测 .grp-name（那个是**真的可见**的，不受批 1 影响）在 3d 后的截断
 *
 * 用法：node tools/b3f-grpzh.js [--tag=after3d]
 */
const fs = require('fs');
const os = require('os');
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

const PROBE_STATE = () => {
  const g = document.querySelector('.sidebar .grp-zh');
  const n = document.querySelector('.sidebar .grp-name');
  const d = (el) => el ? getComputedStyle(el).display : null;
  const fs2 = (el) => el ? getComputedStyle(el).fontSize : null;
  return {
    grpZh: g ? { display: d(g), fontSize: fs2(g), text: g.textContent.trim().slice(0, 12) } : null,
    grpName: n ? { display: d(n), fontSize: fs2(n), text: n.textContent.trim().slice(0, 24) } : null,
    grpNameCount: document.querySelectorAll('.sidebar .grp-name').length,
    grpZhCount: document.querySelectorAll('.sidebar .grp-zh').length,
  };
};

/* 反事实：把 .grp-zh 强制显示，再数截断 */
const PROBE_COUNTERFACTUAL = () => {
  const style = document.createElement('style');
  style.textContent = '.sidebar .grp-zh{display:inline !important}';
  document.head.appendChild(style);
  void document.body.offsetWidth;
  const trunc = (sel) => [...document.querySelectorAll(sel)]
    .filter((e) => e.getClientRects().length > 0)
    .filter((e) => e.scrollWidth > e.clientWidth + 1)
    .map((e) => ({ text: e.textContent.trim().slice(0, 16), sw: e.scrollWidth, cw: e.clientWidth }));
  const zh = trunc('.sidebar .grp-zh');
  const name = trunc('.sidebar .grp-name');
  return {
    zhTruncatedIfShown: zh.length,
    nameTruncated: name.length,
    zhFontSizeIfShown: (() => { const e = document.querySelector('.sidebar .grp-zh'); return e ? getComputedStyle(e).fontSize : null; })(),
    samples: zh.slice(0, 6).map((x) => x.text + ' (' + x.cw + '/' + x.sw + ')'),
  };
};

(async () => {
  if (!EXE) throw new Error('找不到 chromium');
  const tag = arg('tag', 'run');
  const PAGES = ['paper/dev/dialogs/index.html', 'paper/reference/world-configuration/index.html'];
  const VPS = [{ name: '1440x900', w: 1440, h: 900 }, { name: '1024x768', w: 1024, h: 768 }];
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = [];
  for (const rel of PAGES) {
    for (const vp of VPS) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto('file:///' + path.join(ROOT, rel).replace(/\\/g, '/'), { waitUntil: 'load' });
      await page.waitForTimeout(200);
      const st = await page.evaluate(PROBE_STATE);
      const cf = await page.evaluate(PROBE_COUNTERFACTUAL);
      out.push({ page: rel, vp: vp.name, ...st, ...cf });
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(os.tmpdir(), 'b3f-grpzh-' + tag + '.json'), JSON.stringify(out, null, 2), 'utf8');

  console.log('\n=== R1 复测：.grp-zh 截断（tag=' + tag + '）===');
  console.log('page'.padEnd(46) + 'vp'.padEnd(10) + 'zhDisplay'.padStart(11) + 'zhFs'.padStart(8) + 'nameFs'.padStart(8)
    + 'zh截断(反事实)'.padStart(16) + 'name截断(实际)'.padStart(15));
  for (const r of out) {
    console.log(r.page.padEnd(46) + r.vp.padEnd(10)
      + String(r.grpZh && r.grpZh.display).padStart(11)
      + String(r.grpZh && r.grpZh.fontSize).padStart(8)
      + String(r.grpName && r.grpName.fontSize).padStart(8)
      + String(r.zhTruncatedIfShown + '/' + r.grpZhCount).padStart(16)
      + String(r.nameTruncated + '/' + r.grpNameCount).padStart(15));
  }
  const anyName = out.some((r) => r.nameTruncated > 0);
  const anyZhIfShown = out.some((r) => r.zhTruncatedIfShown > 0);
  console.log('\n结论：');
  console.log('  · .grp-zh 现状 display = ' + (out[0].grpZh ? out[0].grpZh.display : 'n/a')
    + '（批 1 已结构性隐藏 → 实际截断恒为 0，与字号无关）');
  console.log('  · 反事实（强制显示时）截断 = ' + (anyZhIfShown ? '**有**，说明 12.5px 真会截断，只是被批 1 挡住' : '0，12.5px 也不截断'));
  console.log('  · .grp-name（真可见）截断 = ' + (anyName ? '**有 ' + out.filter((r) => r.nameTruncated > 0).map((r) => r.vp + ':' + r.nameTruncated).join(', ') + '**' : '0（R1 未回归）'));
  if (out[0].samples && out[0].samples.length) console.log('  样例：' + out[0].samples.join(' | '));
  process.exit(anyName ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
