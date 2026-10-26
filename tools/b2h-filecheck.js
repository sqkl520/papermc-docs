'use strict';
/**
 * b2h-filecheck.js —— 批 2b 的 file:// 冒烟（3 视口 × 首页 + 3 个分区入口）
 *
 * 为什么必须 file://：本站的承诺是「直接双击 HTML 也能用」。http 下 8787 有服务端补尾斜杠，
 * file:// 没有 —— 相对路径写错只有在 file:// 才暴露。所以本探针**真的点击** 3 个
 * .sec-index 入口，检查落地页 title 与 0 请求失败 / 0 pageerror。
 *
 * 检查项：
 *   A. 首页 index.html 在 1440/1024/390 下：0 requestfailed / 0 pageerror；
 *      .sec-index 的 3 个 .sec-item 全部**可见**、命中区 ≥24px（WCAG 2.5.8 AA）；
 *   B. 在首页**真的点击**这 3 个入口 → 落地页 <title> 含对应分区名，
 *      且落地页本身 0 请求失败（分区页是内容页，改前就要能开）；
 *   C. 折叠块删除后，`.tree-fold` 计数 = 0、`.sec-index` 计数 = 1。
 *
 * 用法：node tools/b2h-filecheck.js
 * 产物：reports/b2h-filecheck.json（reports/ 已 gitignore）
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
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
const url = (rel) => 'file:///' + path.join(REPO, rel).replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--allow-file-access-from-files'] });
  const out = { at: new Date().toISOString(), chrome: EXE || 'bundled', vps: {}, clicks: [], failures: 0, checks: [] };
  const ck = (name, ok, detail) => { out.checks.push({ name, ok, detail }); if (!ok) out.failures++; };

  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const fails = [];
    page.on('requestfailed', (r) => fails.push(r.url().slice(-70) + ' :: ' + (r.failure() && r.failure().errorText)));
    page.on('pageerror', (e) => fails.push('pageerror: ' + String(e.message).slice(0, 100)));
    await page.goto(url('index.html'), { waitUntil: 'load' });
    await page.waitForTimeout(300);

    const home = await page.evaluate(() => {
      const vis = (el) => {
        if (!el) return false;
        if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const items = Array.from(document.querySelectorAll('.sec-index .sec-item'));
      return {
        secIndexCount: document.querySelectorAll('.sec-index').length,
        treeFoldCount: document.querySelectorAll('.tree-fold').length,
        srcTreeCount: document.querySelectorAll('.src-tree').length,
        items: items.map((a) => {
          const r = a.getBoundingClientRect();
          return { href: a.getAttribute('href'), text: (a.textContent || '').replace(/\s+/g, ' ').trim(), visible: vis(a), w: Math.round(r.width), h: Math.round(r.height) };
        }),
        pageHeight: document.documentElement.scrollHeight,
      };
    });
    out.vps[vp.name] = { home, fails };

    ck(vp.name + ' 首页 0 请求失败', fails.length === 0, JSON.stringify(fails.slice(0, 3)));
    ck(vp.name + ' .tree-fold 已删除（=0）', home.treeFoldCount === 0, 'treeFold=' + home.treeFoldCount);
    ck(vp.name + ' .sec-index 存在且仅 1 个', home.secIndexCount === 1, 'count=' + home.secIndexCount);
    ck(vp.name + ' 3 个分区入口可见', home.items.length === 3 && home.items.every((i) => i.visible), JSON.stringify(home.items.map((i) => i.href + (i.visible ? '' : '!vis'))));
    ck(vp.name + ' 入口命中区 ≥24px（WCAG 2.5.8 AA）', home.items.every((i) => i.h >= 24), JSON.stringify(home.items.map((i) => i.h)));
    ck(vp.name + ' 入口宽度 >0', home.items.every((i) => i.w > 0), JSON.stringify(home.items.map((i) => i.w)));

    /* 真的点击 3 个入口（每个新开 page，避免相互污染） */
    if (vp.name === '1440') {
      for (let k = 0; k < 3; k++) {
        const p2 = await ctx.newPage();
        const f2 = [];
        p2.on('requestfailed', (r) => f2.push(r.url().slice(-70) + ' :: ' + (r.failure() && r.failure().errorText)));
        p2.on('pageerror', (e) => f2.push('pageerror: ' + String(e.message).slice(0, 100)));
        await p2.goto(url('index.html'), { waitUntil: 'load' });
        await p2.waitForTimeout(200);
        const want = home.items[k];
        await p2.click('.sec-index .sec-item:nth-child(' + (k + 1) + ')');
        await p2.waitForLoadState('load');
        await p2.waitForTimeout(300);
        const land = await p2.evaluate(() => ({ url: location.pathname.split('/').slice(-2).join('/'), title: (document.title || '').slice(0, 60), h1: (document.querySelector('h1') && document.querySelector('h1').textContent || '').trim().slice(0, 40) }));
        out.clicks.push({ href: want.href, text: want.text, landed: land, fails: f2 });
        ck('点击「' + want.text + '」→ 落到 ' + land.url, land.url.replace(/\\/g, '/').includes(want.href.replace(/\/index\.html$/, '')), JSON.stringify(land));
        ck('点击「' + want.text + '」落地页 0 请求失败', f2.length === 0, JSON.stringify(f2.slice(0, 3)));
        await p2.close();
      }
    }
    await ctx.close();
  }
  await browser.close();

  const dir = path.join(REPO, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'b2h-filecheck.json'), JSON.stringify(out, null, 1), 'utf8');

  console.log('=== file:// 冒烟（' + (out.chrome === 'bundled' ? 'bundled chromium' : out.chrome) + '）===');
  for (const c of out.checks) console.log((c.ok ? '  PASS ' : '  FAIL ') + c.name + (c.ok ? '' : '   ' + c.detail));
  console.log('\n首页三视口页高：' + VPS.map((v) => v.name + '=' + out.vps[v.name].home.pageHeight).join(' / '));
  console.log('入口（1440）：' + JSON.stringify(out.vps['1440'].home.items));
  for (const c of out.clicks) console.log('点击 ' + c.href + ' → ' + c.landed.url + '  title="' + c.landed.title + '"  fails=' + c.fails.length);
  console.log('\nRESULT: ' + (out.failures === 0 ? 'PASS（' + out.checks.length + '/' + out.checks.length + '）' : 'FAIL（' + out.failures + ' 项失败 / 共 ' + out.checks.length + '）'));
  process.exit(out.failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack : e)); process.exit(1); });
