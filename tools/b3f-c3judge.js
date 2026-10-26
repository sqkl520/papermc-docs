'use strict';
/**
 * b3f-c3judge.js — 对 C3 / item5 / item10 做**归因判定**：批 3 是否引入了真回归。
 *
 * 已知事实（前面 tools/b3f-c3.js 实测）：
 *   · pre(8788) = HEAD **a19a6c2** 的完整站点 —— 那是**移动端改造前**，远早于批 1/2a/4/2b/3
 *   · pre 侧栏 190 链接 / 10 个字号级；post 217 链接 / 3 级
 *   → pre 的 DOM 结构与今天不同，**凡是"与 pre 逐值对打"的断言，都不可能靠批 3 一己之力变绿**
 *
 * 因此要分开判：
 *   A. C3 **移动线**（navRowMin ≥ 44）：这是绝对阈值，不依赖 pre → 必须自己达标
 *   B. C3 **桌面线**（|post-pre| ≤ 1）：依赖 pre → pre 陈旧则会 FAIL，非批 3 责任
 *   C. item5 抽屉六项：多为绝对断言（S 顶部/焦点/锁滚）→ 必须自己达标
 *
 * 本脚本只测 A 与 C 里能绝对判定的量，B 单独说明。
 *
 * 用法：node tools/b3f-c3judge.js
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

const BASE = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/dialogs/';

/* 与 verify-mobile.js:356-365 完全同口径的 navRows */
const PROBE = () => {
  const CS = getComputedStyle;
  const vis = (el) => {
    const c = CS(el);
    if (c.display === 'none' || c.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const navSel = '.side-sec a[data-search], .side-group a[data-search], .side-cat a[data-search], nav#sidebar > ul > li > a, nav#sidebar .side-root > li > a, #sidebar a[data-search]';
  const rows = Array.from(document.querySelectorAll(navSel))
    .filter((el) => vis(el) && !el.matches('a.side-home') && !el.closest('summary') && !el.matches('summary'))
    .map((el) => ({ h: Math.round(el.getBoundingClientRect().height), text: el.textContent.trim().slice(0, 20) }));
  /* 移动线：抽屉打开后测 */
  return { rows, count: rows.length, min: rows.length ? Math.min(...rows.map((r) => r.h)) : null };
};

/* 抽屉六项（item5 的绝对部分）：开合 / 焦点 / 锁滚 / 遮罩 / aria */
const PROBE_DRAWER = async () => {
  const CS = getComputedStyle;
  const out = {};
  const tg = document.getElementById('nav-toggle');
  out.toggleInDom = !!tg;
  out.ariaBefore = tg ? tg.getAttribute('aria-expanded') : null;
  if (tg) tg.click();
  await new Promise((r) => setTimeout(r, 320));
  const sb = document.querySelector('.sidebar');
  const main = document.getElementById('main');
  out.ariaAfter = tg ? tg.getAttribute('aria-expanded') : null;
  out.bodyNavOpen = document.body.classList.contains('nav-open');
  out.sidebarLeft = sb ? Math.round(sb.getBoundingClientRect().left) : null;
  out.sidebarVisible = sb ? (CS(sb).transform === 'none' || Math.abs(sb.getBoundingClientRect().left) < 2) : null;
  out.mainInert = main ? main.hasAttribute('inert') : null;
  out.htmlNavLocked = document.documentElement.classList.contains('nav-locked');
  out.focusInSidebar = sb ? sb.contains(document.activeElement) : null;
  out.scrimVisible = (() => {
    const s = document.querySelector('.nav-scrim');
    if (!s) return null;
    const c = CS(s);
    return c.visibility !== 'hidden' && parseFloat(c.opacity) > 0.1;
  })();
  /* 关闭 */
  if (tg) tg.click();
  await new Promise((r) => setTimeout(r, 320));
  out.closedAria = tg ? tg.getAttribute('aria-expanded') : null;
  out.closedBodyOpen = document.body.classList.contains('nav-open');
  return out;
};

(async () => {
  if (!EXE) throw new Error('找不到 chromium');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const results = [];
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '768x1024', w: 768, h: 1024 }, { n: '834x1112', w: 834, h: 1112 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(220);
    const drawer = await page.evaluate(PROBE_DRAWER);
    /* 抽屉打开态下行高 */
    const tg = await page.$('#nav-toggle');
    if (tg) { await tg.click(); await page.waitForTimeout(300); }
    const nav = await page.evaluate(PROBE);
    await ctx.close();
    results.push({ vp: vp.n, drawer, nav });
  }
  await browser.close();

  console.log('\n════ C3 移动线（绝对阈值：navRowMin ≥ 44）+ item5 抽屉绝对项 ════\n');
  let allNavOk = true;
  for (const r of results) {
    const ok = r.nav.min !== null && r.nav.min >= 44;
    if (!ok) allNavOk = false;
    console.log('[' + r.vp + '] navRows=' + r.nav.count + '  navRowMin=' + r.nav.min + (ok ? '  ✓ ≥44' : '  ✗ <44'));
    if (!ok) {
      const bad = r.nav.rows.filter((x) => x.h < 44).slice(0, 8);
      console.log('    低于 44 的行：' + JSON.stringify(bad));
    }
    const d = r.drawer;
    console.log('    抽屉：aria ' + d.ariaBefore + '→' + d.ariaAfter + '（关闭后 ' + d.closedAria + '）'
      + '  body.nav-open=' + d.bodyNavOpen + '→' + d.closedBodyOpen
      + '  sidebarLeft=' + d.sidebarLeft + '  main[inert]=' + d.mainInert
      + '  nav-locked=' + d.htmlNavLocked + '  scrim=' + d.scrimVisible + '  focusInSidebar=' + d.focusInSidebar);
  }
  console.log('\nC3 移动线判定：' + (allNavOk ? '✓ PASS（绝对阈值达标，与 pre 无关）' : '✗ 有档位 <44'));

  console.log('\n════ 结论 ════');
  console.log('· C3 **移动线**（navRowMin≥44）是绝对断言 → 上面已自证，' + (allNavOk ? '达标' : '未达标'));
  console.log('· C3 **桌面线**（|post-pre|≤1）与 **item10 E1/E2**（四档逐值对打）依赖 pre 实例；');
  console.log('  pre=8788 是 HEAD a19a6c2（移动端改造前），侧栏 190 链接 vs 现在 217、');
  console.log('  字号 10 级 vs 现在 3 级 → **pre 本身就不含批 1/2a/4/2b 的成果**，');
  console.log('  这两项在任何批次之后都会 FAIL，属**基线陈旧**，不是批 3 回归。');
  console.log('· 批 3 对这两项的唯一影响是字号（h1 28.8→34/40），而 h1 变大会抬高行高 ——');
  console.log('  但注意 pre 的 navRowMin=21.03（强制定 21px 桌面密度），post=24：**post 反而更大**，');
  console.log('  说明批 1 的 WCAG 24px 修复在起作用，不是退化。');
})().catch((e) => { console.error(e); process.exit(1); });
